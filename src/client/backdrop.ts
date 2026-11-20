/**
 * Background painter — renders the user background behind the whole app frame:
 * a fixed `z-index:-2` wallpaper element plus a `z-index:-1` scrim on
 * `document.body`, driven by the `data-dsh-bg` body attribute and a set of
 * CSS variables. It also applies the frosted-glass surface tokens so the
 * wallpaper shows through translucent input / bubble panels.
 *
 * Retraction discipline mirrors the reference skin plugins: every property /
 * DOM node this painter owns is restored to its prior state on dispose, and
 * the `data-ds-dark-theme` observer is disconnected.
 */

import { ACTIVE_ATTR, DARK_READY_ATTR, GLASS_ATTR, injectBackgroundCss } from './background-css.ts'
import {
  BACKGROUND_API_PREFIX, backgroundSourceUrl,
  type BackgroundScheme, type BackgroundSettings,
} from '../settings.ts'

/** Class names the layer and scrim elements carry. */
const LAYER_CLASS = 'dsh-bg-layer'
const IMAGE_CLASS = 'dsh-bg-image'

/** The two schemes a wallpaper layer is mounted for, in document order. */
const SCHEMES = ['light', 'dark'] as const
const SCRIM_CLASS = 'dsh-bg-scrim'

/** Body style properties the painter owns while a wallpaper paints: the app
 * frame and sidebar fills go transparent so every column shares one art.
 * Inline values outrank any stylesheet rule (the body[data-dsh-bg] gate only
 * covers the CSS copy), so a sourceless section must actively restore them. */
const FRAME_TOKENS = ['--dsw-alias-bg-base', '--dsw-specific-sidebar-fill'] as const

/**
 * White-glass tokens — the WHITELISTED surfaces only. Everything that floats
 * as a small card over the wallpaper: the composer input stack, message
 * bubbles, the markdown code surfaces (blocks + banner + inline code), and
 * the agent task strip family (`--dsw-specific-tip`: TodoPanel + GoalBar +
 * QueueDock share one dock column and one fill token). Menus, dialogs, the
 * settings UI, tooltips, toasts, hover fills and every accent keep the
 * OFFICIAL token values — they are reading surfaces and must stay legible.
 * `factor` scales the alpha relative to the input surface.
 */
const GLASS_SURFACE_TOKENS: readonly { token: string; factor: number }[] = [
  { token: '--dsw-specific-input-major', factor: 1 },
  { token: '--dsw-specific-bubble', factor: 0.8 },
  { token: '--dsw-alias-markdown-code-block', factor: 1 },
  { token: '--dsw-alias-markdown-code-block-banner', factor: 1 },
  { token: '--dsw-alias-markdown-inline-code', factor: 0.9 },
  { token: '--dsw-specific-tip', factor: 1 },
]

/** Every token the glass owns (save/restore key set). */
const GLASS_TOKENS: readonly string[] = GLASS_SURFACE_TOKENS.map(({ token }) => token)

/** Fraction of the official white surface alpha kept at the most transparent panel setting. */
const GLASS_MIN_ALPHA = 0.05

/** Base white-glass alpha for one panelOpacity (the curve every surface shares). */
function glassAlpha(panelOpacity: number): number {
  const alpha = GLASS_MIN_ALPHA + panelOpacity * (0.9 - GLASS_MIN_ALPHA)
  return Math.max(0, Math.min(0.9, alpha))
}

/**
 * Saturation boost that rides the blur radius. Gentler than the reference
 * engine (1.1 + blur * 0.02, capped at 1.6): stacking a hot saturate on top of
 * the brightness/sheen layers pushed bright wallpapers into clipping.
 */
function glassSaturate(blur: number): number {
  if (blur <= 0) return 1
  // Round off float dust (1.1 + 16 * 0.02 is 1.4200000000000002 raw).
  return Math.round(Math.min(1.6, 1.1 + blur * 0.02) * 1000) / 1000
}

/**
 * Exposure calibration per scheme. Light glass neither boosts brightness nor
 * stacks a heavy sheen (mainstream frosted recipes — macOS vibrancy, Windows
 * acrylic, common web glass — blur + saturate + tint without a positive
 * brightness gain); dark glass keeps the reference engine's slight lift, which
 * stops the white-glass fills from turning muddy.
 */
function glassExposure(inDark: boolean): { brightness: string; sheen: string; sheenMid: string } {
  return inDark
    ? { brightness: '1.04', sheen: '0.16', sheenMid: '0.05' }
    : { brightness: '0.98', sheen: '0.07', sheenMid: '0.02' }
}

/**
 * The theme-aware base alpha for one panelOpacity — THE curve every glass
 * surface shares (surface tokens, bare alpha knobs and the settings preview
 * included). Single-sourced here so the live painter and the preview card
 * cannot drift.
 */
function glassBaseAlpha(panelOpacity: number, inDark: boolean): number {
  return glassAlpha(panelOpacity) * (inDark ? 0.4 : 0.8)
}

/**
 * The theme-aware glass surface alphas for one panelOpacity: the input-surface
 * token and the bubble token share one curve, dimmed per scheme. Shared by the
 * live painter and the settings-row preview card so the two cannot drift.
 */
function glassSurfaceAlphas(panelOpacity: number, inDark: boolean): { major: string; bubble: string } {
  const alpha = glassBaseAlpha(panelOpacity, inDark)
  return {
    major: `rgba(255, 255, 255, ${alpha.toFixed(3)})`,
    bubble: `rgba(255, 255, 255, ${(alpha * 0.8).toFixed(3)})`,
  }
}

/**
 * The scheme the document is currently rendering.
 * @returns 'dark' while the shell marks the body with its dark-scheme attribute.
 */
export function activeScheme(): BackgroundScheme {
  return document.body.dataset.dsDarkTheme !== undefined ? 'dark' : 'light'
}

/**
 * Resolve the effective background image url for a section in one scheme.
 * @param settings - resolved background section.
 * @param uploadBase - the API base used to turn an upload id into a url.
 * @param scheme - the scheme whose art should paint (defaults to the live one).
 * @returns the image url, or '' when neither the scheme nor its light fallback has a source.
 */
export function backgroundImageUrl(
  settings: BackgroundSettings,
  uploadBase: string,
  scheme: BackgroundScheme = activeScheme(),
): string {
  return backgroundSourceUrl(settings, uploadBase, scheme)
}

/**
 * Manage the behind-body wallpaper + scrim layers and the glass surface.
 */
export class BackgroundPainter {
  private layer: HTMLDivElement | null = null
  /** One wallpaper element per scheme: both stay mounted and decoded so the
   * theme flip is a pure CSS visibility swap (see BACKGROUND_CSS). */
  private readonly images: Partial<Record<BackgroundScheme, HTMLImageElement>> = {}
  private scrim: HTMLDivElement | null = null
  private observer: MutationObserver | undefined
  private active = false
  private settings: BackgroundSettings | undefined
  /** The exact object last passed to apply(), used to drop a stale async
   *  readiness callback that belongs to a superseded section. */
  private paintedSettings: BackgroundSettings | undefined
  /** Whether the current section resolves to an actual image source. */
  private hasSource = false
  private readonly savedTokens = new Map<string, string>()
  private readonly savedVars = new Map<string, string>()

  /** Remember + hijack a property only once so dispose restores the original. */
  private rememberOnce(prop: string): void {
    if (this.savedTokens.has(prop) || this.savedVars.has(prop)) return
    const value = document.body.style.getPropertyValue(prop)
    if (GLASS_TOKENS.includes(prop)) {
      this.savedTokens.set(prop, value)
    } else {
      this.savedVars.set(prop, value)
    }
  }

  /**
   * Apply the latest settings. Idempotent.
   * @param settings - resolved background section.
   * @param uploadBase - the API base for resolving uploads.
   */
  apply(settings: BackgroundSettings, uploadBase: string): void {
    this.settings = settings
    this.paintedSettings = settings
    if (!settings.enabled) {
      this.dispose()
      return
    }
    injectBackgroundCss()

    const url = backgroundImageUrl(settings, uploadBase, activeScheme())
    if (url === '') {
      // No source: the frame transparency is owned only while a wallpaper
      // paints — hand the base/sidebar fills back (a sourceless "enabled"
      // section must never leave transparent chrome over the bare page), and
      // drop the theme observer + glass tokens whose flip handler would
      // otherwise re-write translucent panels over that bare page too.
      this.observer?.disconnect()
      this.observer = undefined
      this.restoreFrameTokens()
      this.applySurfaceGlass(settings, true)
      this.active = false
      this.hasSource = false
      this.removeLayers()
      document.body.removeAttribute(ACTIVE_ATTR)
      document.body.removeAttribute(DARK_READY_ATTR)
      return
    }

    // Transparent frame: all columns share the wallpaper behind the UI.
    for (const prop of FRAME_TOKENS) {
      this.rememberOnce(prop)
      document.body.style.setProperty(prop, 'transparent')
    }

    // Wallpaper layer + one element per scheme. Both are kept mounted so a
    // theme flip never has to create, fetch or decode anything.
    if (!this.layer) {
      this.layer = document.createElement('div')
      this.layer.className = LAYER_CLASS
      for (const scheme of SCHEMES) {
        const el = document.createElement('img')
        el.className = IMAGE_CLASS
        el.alt = ''
        el.dataset.scheme = scheme
        // Remote-url sources must not leak the local origin via Referer.
        el.referrerPolicy = 'no-referrer'
        // A dead source (404 / network error / revoked upload) must not leave
        // a blank frozen backdrop: hide the broken layer and say so once on
        // the console. Pointing it at a different URL clears the failure.
        el.onerror = () => {
          if (el.dataset.failed === '1') return
          el.dataset.failed = '1'
          el.style.visibility = 'hidden'
          console.warn('[deepseek-harness-background] wallpaper image failed to load:', el.getAttribute('src'))
        }
        // A DARK layer that finishes loading must unlock the dark pairing
        // immediately, without waiting for some unrelated re-apply. This is the
        // engine-independent belt to decode()'s braces: `load` fires once the
        // bytes AND the decoded frame are available.
        if (scheme === 'dark') {
          el.onload = () => {
            const current = this.settings
            // Ignore a load that belongs to a section already superseded, and
            // one that lands for a url this layer no longer holds.
            if (current === undefined || current !== this.paintedSettings) return
            if (el.getAttribute('src') !== backgroundImageUrl(current, BACKGROUND_API_PREFIX, 'dark')) return
            document.body.setAttribute(DARK_READY_ATTR, 'on')
          }
        }
        this.images[scheme] = el
        this.layer.appendChild(el)
      }
      document.body.appendChild(this.layer)
    }
    // Point BOTH layers at the art their scheme resolves to (each scheme falls
    // back to the other's art, so a single-image section yields the same url
    // twice). Every layer holds a decoded frame before the flip can happen:
    // the visible one is already painted, and the hidden one is preloaded and
    // decoded below.
    this.syncLayers(settings, uploadBase)

    if (!this.scrim) {
      this.scrim = document.createElement('div')
      this.scrim.className = SCRIM_CLASS
      document.body.appendChild(this.scrim)
    }
    document.body.setAttribute(ACTIVE_ATTR, 'on')
    this.active = true
    this.hasSource = true

    // Push the knobs into CSS variables.
    const s = document.body.style
    this.setVar('--bg-object-fit', settings.fit)
    // Framing: normalized percentages map to CSS `object-position`, whose
    // percent semantics ("image p% aligns with container p%") are exactly the
    // relative position inside the crop overflow — so the stored value needs
    // no re-scaling when the window or the source changes.
    this.setVar('--bg-offset-x', String(settings.offsetX))
    this.setVar('--bg-offset-y', String(settings.offsetY))
    this.setVar('--bg-opacity', String(settings.opacity))
    this.setVar('--bg-wallpaper-blur', `${settings.wallpaperBlur}px`)
    this.setVar('--bg-wallpaper-scale', (1 + settings.wallpaperBlur * 0.006).toFixed(4))
    this.setVar('--bg-scrim', String(settings.scrim))
    this.setVar('--bg-glass-blur', `${settings.blur}px`)
    this.setVar('--bg-glass-saturate', String(glassSaturate(settings.blur)))

    // Glass surface: theme-aware translucent token (panelOpacity === 1 keeps
    // the official opaque surfaces and disables the blur).
    this.applySurfaceGlass(settings, false)

    // Theme observer: the WALLPAPER swap needs no observer at all (the layers
    // and the scrim are keyed on the body attribute in CSS, which is what
    // makes the flip atomic and instant). Only the frosted-glass alphas are
    // written from JS, because they are computed per scheme.
    if (!this.observer) {
      this.observer = new MutationObserver(() => {
        this.applySurfaceGlass(this.settings, false)
      })
      this.observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    }
  }

  /**
   * Point each scheme layer at the art that scheme resolves to, then make the
   * hidden one ready before any flip can happen.
   *
   * The swap itself is CSS (`.dsh-bg-image[data-scheme]` + the scrim, both
   * keyed on `data-ds-dark-theme`), so it costs one style recalculation and is
   * atomic with the veil. This method only keeps the two layers' `src`
   * attributes correct and pre-decodes the one that is not painted yet.
   * @param settings - the section being painted.
   * @param uploadBase - the API base used to resolve upload ids.
   */
  private syncLayers(settings: BackgroundSettings, uploadBase: string): void {
    for (const scheme of SCHEMES) {
      const el = this.images[scheme]
      if (el === undefined) continue
      const url = backgroundImageUrl(settings, uploadBase, scheme)
      // Compare the *attribute* (the raw value we set) rather than the .src
      // property, which resolves to an absolute URL and would make this check
      // always-true for relative urls. Same-value writes are no-ops in the DOM.
      if (el.getAttribute('src') === url) continue
      delete el.dataset.failed
      el.style.visibility = ''
      el.src = url
    }
    this.markDarkReadyWhenDecoded()
  }

  /**
   * Publish whether the DARK layer is decoded, which is what lets the dark
   * pairing (black veil + dark art) take over at all.
   *
   * Why this exists: the veil is pure CSS, so it flips the instant the theme
   * attribute changes, while the art behind it can still be arriving over the
   * network (a 4K PNG is seconds). Without this gate the app showed a BLACK
   * veil over the LIGHT picture and then swapped the picture in — the "it just
   * got darker for a moment" the user reported. While the flag is absent the
   * whole dark pairing stays off, so the light veil and the light art remain
   * paired; the moment the dark frame is decoded the flag lands and the pair
   * swaps together.
   *
   * The flag is only ever REMOVED when the dark layer has an own source that is
   * not ready yet. A section whose dark slot merely falls back to the light art
   * is ready by definition (same url, same decoded frame), and a section with
   * no dark pairing at all (single-image) never shows the black veil on a
   * different picture, so it is ready too.
   */
  private markDarkReadyWhenDecoded(): void {
    const el = this.images.dark
    const dark = this.settings === undefined
      ? ''
      : backgroundImageUrl(this.settings, BACKGROUND_API_PREFIX, 'dark')
    if (el === undefined || dark === '') {
      document.body.removeAttribute(DARK_READY_ATTR)
      return
    }
    const light = this.settings === undefined
      ? ''
      : backgroundImageUrl(this.settings, BACKGROUND_API_PREFIX, 'light')
    // Falling back to the light art: the two layers are the same picture, so
    // the pairing is visually identical whether or not the flag is set.
    if (dark === light) {
      document.body.setAttribute(DARK_READY_ATTR, 'on')
      return
    }
    // `complete` covers both "already decoded in this document" and "cached";
    // naturalWidth > 0 rules out the broken-image state (complete is true for
    // a 404 too, and that must not enable the dark pairing).
    const decodedNow = el.complete && el.naturalWidth > 0
    if (decodedNow) document.body.setAttribute(DARK_READY_ATTR, 'on')
    else document.body.removeAttribute(DARK_READY_ATTR)

    // Older engines and non-browser environments (jsdom) have no decode().
    if (typeof el.decode !== 'function') return
    // decode() rejects with EncodingError on a source that never loads; it
    // resolves once the frame is cached. Only a resolution may enable the flag,
    // and only while this is still the section being painted.
    try {
      void el.decode().then(() => {
        if (this.settings !== this.paintedSettings) return
        if (this.images.dark?.getAttribute('src') !== dark) return
        document.body.setAttribute(DARK_READY_ATTR, 'on')
      }).catch(() => {})
    } catch {
      // A synchronous throw (detached element) means no warm-up; the flag then
      // simply flips on the next apply once the image is complete.
    }
  }

  /** Write one owned CSS variable onto body. */
  private setVar(name: string, value: string): void {
    this.rememberOnce(name)
    document.body.style.setProperty(name, value)
  }

  /**
   * Return the owned frame-transparency properties to their saved state (or
   * remove them when this session never overrode them). dispose() restores
   * everything wholesale; this targeted variant serves the sourceless path,
   * where the painter keeps running for a later source.
   */
  private restoreFrameTokens(): void {
    for (const prop of FRAME_TOKENS) {
      this.rememberOnce(prop)
      const original = this.savedVars.get(prop)
      if (original !== undefined && original !== '') document.body.style.setProperty(prop, original)
      else document.body.style.removeProperty(prop)
    }
  }

  /**
   * Update one effect knob without re-running the full apply. This is the hot
   * path for slider drags (many events per second): only the single CSS
   * variable changes, the DOM layers are untouched.
   * @param key - the knob to update.
   * @param value - its new value in its canonical unit.
   */
  setKnob(key: 'opacity' | 'scrim' | 'panelOpacity' | 'blur' | 'wallpaperBlur' | 'fit' | 'offsetX' | 'offsetY', value: number | BackgroundSettings['fit']): void {
    if (this.settings === undefined || !this.settings.enabled) return
    switch (key) {
      case 'opacity':
        this.setVar('--bg-opacity', String(value))
        break
      case 'scrim':
        this.setVar('--bg-scrim', String(value))
        break
      case 'panelOpacity': {
        // The glass surface tokens depend on the panel opacity; repaint ONLY
        // them (the slider hot path — no layer churn, no full apply). The
        // stored section adopts the value so a later theme flip repaints with
        // the fresh opacity, and a sourceless section keeps the official
        // opaque surfaces (forceRestore) exactly like the full apply does.
        const next = { ...this.settings, panelOpacity: Number(value) }
        this.settings = next
        this.applySurfaceGlass(next, !this.hasSource)
        break
      }
      case 'blur': {
        this.setVar('--bg-glass-blur', `${value}px`)
        this.setVar('--bg-glass-saturate', String(glassSaturate(Number(value))))
        break
      }
      case 'wallpaperBlur': {
        this.setVar('--bg-wallpaper-blur', `${value}px`)
        this.setVar('--bg-wallpaper-scale', (1 + Number(value) * 0.006).toFixed(4))
        break
      }
      case 'fit':
        this.setVar('--bg-object-fit', String(value))
        break
      case 'offsetX':
        this.setVar('--bg-offset-x', String(value))
        break
      case 'offsetY':
        this.setVar('--bg-offset-y', String(value))
        break
    }
  }

  /**
   * Apply the translucent-glass surface tokens (or restore the official ones
   * when the panel is fully opaque / there is no background).
   * @param settings - resolved section (for panelOpacity).
   * @param forceRestore - true to restore official surfaces regardless (used
   *   when no source is set, so leftover glass tokens never linger).
   */
  private applySurfaceGlass(settings: BackgroundSettings | undefined, forceRestore: boolean): void {
    const s = document.body.style
    const inDark = document.body.dataset.dsDarkTheme !== undefined
    // Always remember the original surface values so a restore / dispose
    // returns them cleanly.
    for (const token of GLASS_TOKENS) this.rememberOnce(token)

    const restore = () => {
      for (const token of GLASS_TOKENS) {
        const original = this.savedTokens.get(token)
        if (original !== undefined && original !== '') s.setProperty(token, original)
        else s.removeProperty(token)
      }
    }

    if (forceRestore || settings === undefined || settings.panelOpacity >= 1) {
      restore()
      document.body.removeAttribute(GLASS_ATTR)
      // No blur and a neutral exposure when glass is off; the bare alpha
      // knobs only matter under the glass gate.
      this.setVar('--bg-glass-blur', '0px')
      this.setVar('--bg-glass-brightness', '1')
      s.removeProperty('--bg-glass-alpha')
      s.removeProperty('--bg-glass-alpha-strong')
      return
    }

    document.body.setAttribute(GLASS_ATTR, 'on')

    // Exposure calibration (theme-aware, mirrored by the preview surface).
    const exposure = glassExposure(inDark)
    this.setVar('--bg-glass-brightness', exposure.brightness)
    this.setVar('--bg-glass-sheen', exposure.sheen)
    this.setVar('--bg-glass-sheen-mid', exposure.sheenMid)

    // Dark scheme uses a lower white alpha (the wallpaper stays visible
    // without washing the surface), mirroring the reference engine.
    const base = glassBaseAlpha(settings.panelOpacity, inDark)
    for (const { token, factor } of GLASS_SURFACE_TOKENS) {
      s.setProperty(token, `rgba(255, 255, 255, ${(base * factor).toFixed(3)})`)
    }
    // Bare alpha knobs for the surfaces that keep their own hue (preview
    // badge, via color-mix) or need a hover boost (chrome buttons): the same
    // curve every glass surface shares.
    this.setVar('--bg-glass-alpha', base.toFixed(3))
    this.setVar('--bg-glass-alpha-strong', Math.min(0.9, base * 1.5).toFixed(3))
  }

  /** Remove the wallpaper + scrim layers and clear the active attribute. */
  private removeLayers(): void {
    if (this.layer) { this.layer.remove(); this.layer = null }
    for (const scheme of SCHEMES) delete this.images[scheme]
    if (this.scrim) { this.scrim.remove(); this.scrim = null }
  }

  /** Restore every owned property and remove the layers. */
  dispose(): void {
    this.observer?.disconnect()
    this.observer = undefined
    this.removeLayers()
    const s = document.body.style
    document.body.removeAttribute(ACTIVE_ATTR)
    document.body.removeAttribute(GLASS_ATTR)
    document.body.removeAttribute(DARK_READY_ATTR)
    for (const [prop, value] of this.savedTokens) s.setProperty(prop, value)
    for (const [prop, value] of this.savedVars) s.setProperty(prop, value)
    this.savedTokens.clear()
    this.savedVars.clear()
    this.active = false
    this.settings = undefined
    this.hasSource = false
  }

  /** @returns whether a wallpaper is currently rendered. */
  isActive(): boolean {
    return this.active
  }
}

/** Module-level painter singleton shared by the settings row preview and the live apply. */
export const backgroundPainter = new BackgroundPainter()

/**
 * Apply the given settings through the shared painter (idempotent). Convenience
 * used by the settings row for live previews and by the plugin apply to render
 * the persisted section.
 * @param settings - settings to apply (may be an unsaved draft for preview).
 */
export function paintBackground(settings: BackgroundSettings): void {
  backgroundPainter.apply(settings, BACKGROUND_API_PREFIX)
}

/** Numeric effect knobs the slider drag path repaints. */
export type BackgroundKnob = 'opacity' | 'scrim' | 'panelOpacity' | 'blur' | 'wallpaperBlur' | 'fit' | 'offsetX' | 'offsetY'

/**
 * Update one effect knob on the live backdrop without re-running the full
 * apply — the hot path for slider drags (see BackgroundPainter.setKnob).
 * @param key - the knob to update.
 * @param value - its new value.
 */
export function paintBackgroundKnob(key: BackgroundKnob, value: number | BackgroundSettings['fit']): void {
  backgroundPainter.setKnob(key, value)
}

/** Preview variables the settings-surface preview card consumes. */
const PREVIEW_VARS = [
  '--bg-opacity', '--bg-scrim', '--bg-object-fit',
  '--bg-offset-x', '--bg-offset-y',
  '--bg-wallpaper-blur', '--bg-wallpaper-scale',
  '--bg-glass-blur', '--bg-glass-saturate', '--bg-glass-brightness',
  '--bg-preview-glass',
] as const

/**
 * Push the effect knobs onto one element (the settings-surface preview card)
 * so dragging a slider updates the card without touching the live backdrop.
 * The card's CSS reads the same variable names as the painter writes on body.
 * @param el - the preview element.
 * @param settings - the draft settings to render (may be unsaved).
 */
export function paintPreviewSurface(
  el: HTMLElement,
  settings: BackgroundSettings,
  scheme: BackgroundScheme = activeScheme(),
): void {
  const s = el.style
  // Preview the scheme the card is showing, not necessarily the live one:
  // while the user edits the dark slot in light mode the card must still show
  // the art that slot will paint.
  const inDark = scheme === 'dark'
  s.setProperty('--bg-object-fit', settings.fit)
  s.setProperty('--bg-offset-x', String(settings.offsetX))
  s.setProperty('--bg-offset-y', String(settings.offsetY))
  s.setProperty('--bg-opacity', String(settings.opacity))
  s.setProperty('--bg-scrim', String(settings.scrim))
  s.setProperty('--bg-wallpaper-blur', `${settings.wallpaperBlur}px`)
  s.setProperty('--bg-wallpaper-scale', (1 + settings.wallpaperBlur * 0.006).toFixed(4))
  // The glass bubble mirrors the live panel surface: below panelOpacity 1 its
  // alpha follows the same theme-aware curve as --dsw-specific-bubble (so the
  // panel-opacity slider is visible in the preview); at 1 the official opaque
  // surface returns — the bubble turns opaque and the blur switches off, just
  // like applySurfaceGlass does on the real backdrop.
  if (settings.panelOpacity >= 1) {
    s.setProperty('--bg-glass-blur', '0px')
    s.setProperty('--bg-glass-brightness', '1')
    s.setProperty('--bg-preview-glass', 'var(--dsw-alias-bg-layer-1)')
    return
  }
  s.setProperty('--bg-glass-blur', `${settings.blur}px`)
  s.setProperty('--bg-glass-saturate', String(glassSaturate(settings.blur)))
  // The preview filter mirrors the live exposure calibration (slightly dimmed
  // in light, lifted in dark) so the card never reads brighter than the app.
  s.setProperty('--bg-glass-brightness', glassExposure(inDark).brightness)
  // The preview bubble mirrors the live --dsw-specific-bubble token.
  s.setProperty('--bg-preview-glass', glassSurfaceAlphas(settings.panelOpacity, inDark).bubble)
}

/** Remove every preview variable from an element (restores CSS defaults). */
export function clearPreviewSurface(el: HTMLElement): void {
  for (const name of PREVIEW_VARS) el.style.removeProperty(name)
}
