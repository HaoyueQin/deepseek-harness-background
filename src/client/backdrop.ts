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

import { ACTIVE_ATTR, GLASS_ATTR, injectBackgroundCss } from './background-css.ts'
import { BACKGROUND_API_PREFIX, type BackgroundSettings } from '../settings.ts'

/** Class names the layer and scrim elements carry. */
const LAYER_CLASS = 'dsh-bg-layer'
const IMAGE_CLASS = 'dsh-bg-image'
const SCRIM_CLASS = 'dsh-bg-scrim'

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
 * The theme-aware glass surface alphas for one panelOpacity: the input-surface
 * token and the bubble token share one curve, dimmed per scheme. Shared by the
 * live painter and the settings-row preview card so the two cannot drift.
 */
function glassSurfaceAlphas(panelOpacity: number, inDark: boolean): { major: string; bubble: string } {
  const alpha = glassAlpha(panelOpacity) * (inDark ? 0.4 : 0.8)
  return {
    major: `rgba(255, 255, 255, ${alpha.toFixed(3)})`,
    bubble: `rgba(255, 255, 255, ${(alpha * 0.8).toFixed(3)})`,
  }
}

/**
 * Resolve the effective background image url for a section.
 * @param settings - resolved background section.
 * @returns the image url, or '' when no source is set.
 */
export function backgroundImageUrl(settings: BackgroundSettings, uploadBase: string): string {
  if (settings.uploadId) return `${uploadBase}/image/${settings.uploadId}`
  return settings.url
}

/**
 * Manage the behind-body wallpaper + scrim layers and the glass surface.
 */
export class BackgroundPainter {
  private layer: HTMLDivElement | null = null
  private img: HTMLImageElement | null = null
  private scrim: HTMLDivElement | null = null
  private observer: MutationObserver | undefined
  private active = false
  private settings: BackgroundSettings | undefined
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
    if (!settings.enabled) {
      this.dispose()
      return
    }
    injectBackgroundCss()
    this.rememberOnce('--dsw-alias-bg-base')
    this.rememberOnce('--dsw-specific-sidebar-fill')
    document.body.style.setProperty('--dsw-alias-bg-base', 'transparent')
    document.body.style.setProperty('--dsw-specific-sidebar-fill', 'transparent')

    const url = backgroundImageUrl(settings, uploadBase)
    if (url === '') {
      // No source: leave the frame alone, restore the removed layers and any
      // glass-token overrides we may have written on a previous apply. The
      // theme observer must go too — a later light/dark flip would re-run
      // applySurfaceGlass with forceRestore=false and write the translucent
      // tokens back onto panels that no longer sit over a wallpaper.
      this.observer?.disconnect()
      this.observer = undefined
      this.applySurfaceGlass(settings, true)
      this.active = false
      this.removeLayers()
      document.body.removeAttribute(ACTIVE_ATTR)
      return
    }

    // Wallpaper layer + scrim.
    if (!this.layer) {
      this.layer = document.createElement('div')
      this.layer.className = LAYER_CLASS
      this.img = document.createElement('img')
      this.img.className = IMAGE_CLASS
      this.img.alt = ''
      // Remote-url sources must not leak the local origin via Referer.
      this.img.referrerPolicy = 'no-referrer'
      this.layer.appendChild(this.img)
      document.body.appendChild(this.layer)
    }
    // Compare the *attribute* (the raw value we set) rather than the .src
    // property, which resolves to an absolute URL and would make this check
    // always-true for relative urls. Same-value writes are no-ops in the DOM,
    // so this is a clarity fix, not a behavior fix.
    if (this.img && this.img.getAttribute('src') !== url) this.img.src = url

    if (!this.scrim) {
      this.scrim = document.createElement('div')
      this.scrim.className = SCRIM_CLASS
      document.body.appendChild(this.scrim)
    }
    document.body.setAttribute(ACTIVE_ATTR, 'on')
    this.active = true

    // Push the knobs into CSS variables.
    const s = document.body.style
    this.setVar('--bg-object-fit', settings.fit)
    this.setVar('--bg-opacity', String(settings.opacity))
    this.setVar('--bg-wallpaper-blur', `${settings.wallpaperBlur}px`)
    this.setVar('--bg-wallpaper-scale', (1 + settings.wallpaperBlur * 0.006).toFixed(4))
    this.setVar('--bg-scrim', String(settings.scrim))
    this.setVar('--bg-glass-blur', `${settings.blur}px`)
    this.setVar('--bg-glass-saturate', String(glassSaturate(settings.blur)))

    // Glass surface: theme-aware translucent token (panelOpacity === 1 keeps
    // the official opaque surfaces and disables the blur).
    this.applySurfaceGlass(settings, false)

    // Theme observer: repaint the glass tokens when the light/dark scheme
    // flips (the surface translucency differs between schemes). Disconnects
    // on dispose.
    if (!this.observer) {
      this.observer = new MutationObserver(() => this.applySurfaceGlass(this.settings, false))
      this.observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    }
  }

/** Write one owned CSS variable onto body. */
private setVar(name: string, value: string): void {
  this.rememberOnce(name)
  document.body.style.setProperty(name, value)
}

/**
 * Update one effect knob without re-running the full apply. This is the hot
 * path for slider drags (many events per second): only the single CSS
 * variable changes, the DOM layers are untouched.
 * @param key - the knob to update.
 * @param value - its new value in its canonical unit.
 */
setKnob(key: 'opacity' | 'scrim' | 'blur' | 'wallpaperBlur' | 'fit', value: number | BackgroundSettings['fit']): void {
  if (this.settings === undefined || !this.settings.enabled) return
  switch (key) {
    case 'opacity':
      this.setVar('--bg-opacity', String(value))
      break
    case 'scrim':
      this.setVar('--bg-scrim', String(value))
      break
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
    const base = glassAlpha(settings.panelOpacity) * (inDark ? 0.4 : 0.8)
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
    if (this.layer) { this.layer.remove(); this.layer = null; this.img = null }
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
    for (const [prop, value] of this.savedTokens) s.setProperty(prop, value)
    for (const [prop, value] of this.savedVars) s.setProperty(prop, value)
    this.savedTokens.clear()
    this.savedVars.clear()
    this.active = false
    this.settings = undefined
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
export type BackgroundKnob = 'opacity' | 'scrim' | 'blur' | 'wallpaperBlur' | 'fit'

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
export function paintPreviewSurface(el: HTMLElement, settings: BackgroundSettings): void {
  const s = el.style
  s.setProperty('--bg-object-fit', settings.fit)
  s.setProperty('--bg-opacity', String(settings.opacity))
  s.setProperty('--bg-scrim', String(settings.scrim))
  s.setProperty('--bg-wallpaper-blur', `${settings.wallpaperBlur}px`)
  s.setProperty('--bg-wallpaper-scale', (1 + settings.wallpaperBlur * 0.006).toFixed(4))
  // The glass bubble mirrors the live panel surface: below panelOpacity 1 its
  // alpha follows the same theme-aware curve as --dsw-specific-bubble (so the
  // panel-opacity slider is visible in the preview); at 1 the official opaque
  // surface returns — the bubble turns opaque and the blur switches off, just
  // like applySurfaceGlass does on the real backdrop.
  const inDark = document.body.dataset.dsDarkTheme !== undefined
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
