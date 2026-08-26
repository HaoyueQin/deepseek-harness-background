
/**
 * Frosted-glass registry — the public integration surface other plugins use
 * to join this plugin's frosted-glass system.
 *
 * Third-party panels (diff viewers, file peeks, tool cards...) often fill
 * with an official --dsw-* token that the painter already turns translucent
 * under a wallpaper, but nothing adds the shared blur/sheen chain to THEM,
 * so they read as bare transparency instead of frosted glass (or stay fully
 * opaque when they carry their own literal fills). This registry lets their
 * authors register CSS selectors; every registered surface receives the
 * exact unified recipe the whitelisted official surfaces use:
 *
 * - mode 'token' (default) — adds ONLY the wet-glass sheen gradient and the
 *   shared backdrop-filter chain. Pick it when the panel already paints with
 *   a token the painter overrides (--dsw-specific-input-major,
 *   --dsw-specific-bubble, --dsw-alias-markdown-code-block,
 *   --dsw-alias-markdown-code-block-banner, --dsw-alias-markdown-inline-code,
 *   --dsw-specific-tip): its fill then follows the panel-opacity slider
 *   automatically. Same treatment as the composer dock family.
 * - mode 'fill' — also takes over the fill itself
 *   (background-color: var(--dsh-specific-input-major)). Pick it when the
 *   panel carries its own opaque/literal background today. Same explicit
 *   recipe as the chrome buttons and the lineage popover.
 *
 * Rules are generated under the body[data-dsh-bg-glass] gate, so glass
 * toggling (wallpaper disabled, source cleared, or the user maxing the
 * panel-opacity slider) restores the registered surfaces' own paints with
 * ZERO extra coordination — the gate is the same one the built-in whitelist
 * keys on.
 *
 * Transport: because plugin client bundles load in no guaranteed order, the
 * api is published on window.__DSH_BACKGROUND_GLASS__ and announced with the
 * 'dsh-background-glass:ready' CustomEvent (detail = the api). Consumers
 * either poll the global or await the event; both are covered by the
 * copy-paste helper in docs/GLASS_API.md. The whole bridge is torn down when
 * this plugin's client fiber disposes.
 */

import { GLASS_ATTR } from './background-css.ts'

/** Semantic version of this bridge contract (bumped on breaking changes). */
export const GLASS_BRIDGE_VERSION = 1 as const

/** Property name on window where the api is published. */
export const GLASS_BRIDGE_GLOBAL = '__DSH_BACKGROUND_GLASS__'

/** DOM event announced once the api becomes available (detail = the api). */
export const GLASS_READY_EVENT = 'dsh-background-glass:ready'

/** Style-tag dedup key of the registry stylesheet (data-plugin-css). */
const REGISTRY_CSS_TAG = 'deepseek-harness-background/glass-registry'

/** Plugin identity stamped onto the registry <style> element. */
const PLUGIN_ID = 'deepseek-harness-background'

/**
 * Fill strategy for a registered surface.
 * - 'token': the surface paints with an overridden --dsw-* token; only the
 *   sheen + blur chain is added (its fill follows the sliders).
 * - 'fill': the surface keeps its own opaque paint today; the registry takes
 *   the fill over too (--dsw-specific-input-major, the composer's white).
 */
export type GlassSurfaceMode = 'token' | 'fill'

/** Registration payload passed to BackgroundGlassApi.register. */
export interface GlassSurfaceSpec {
  /**
   * Caller identity, conventionally the consumer package name (e.g.
   * 'dsh-diff-stat'). Used for diagnostics only — registrations from
   * different plugins never conflict.
   */
  plugin: string
  /** One selector or a list. Each must match a stable anchor you render. */
  selectors: string | readonly string[]
  /** Fill strategy; defaults to 'token'. */
  mode?: GlassSurfaceMode
}

/** The object published at window.__DSH_BACKGROUND_GLASS__. */
export interface BackgroundGlassApi {
  /** Contract version (currently GLASS_BRIDGE_VERSION). */
  readonly version: typeof GLASS_BRIDGE_VERSION
  /** Publisher identity — lets consumers assert WHO owns the global. */
  readonly bridgeId: 'deepseek-harness-background'
  /**
   * Whether the frosted glass is ON right now (wallpaper active AND
   * panelOpacity < 1). Registrations made while this is false simply wait
   * under the gate until the glass turns on.
   */
  isActive(): boolean
  /**
   * Register surfaces to receive the unified frosted-glass recipe while the
   * glass is on. Idempotent per (plugin, mode, selector): re-registering the
   * same triple replaces the earlier entry. Returns an unregister function —
   * idempotent, safe to call twice, and the right cleanup inside a cordis
   * effect/fiber dispose.
   */
  register(spec: GlassSurfaceSpec): () => void
}

/**
 * Characters whose presence would let a selector escape its rule context.
 * ',' is refused too: inside the generated rule body
 * (`body[gate] <selector> { … }`) a comma lets one registration broaden the
 * rule to ARBITRARY extra subjects (`.x, html body`) — an unintended
 * widening of the glass sheet beyond the registered surface. Multiple
 * surfaces stay supported through the selectors ARRAY.
 */
const FORBIDDEN_SELECTOR_CHARS = ['{', '}', ';', '@', '<', '>', ','] as const

/** Hard cap on one selector's length (diagnostics-friendly, abuse-proof). */
const MAX_SELECTOR_LENGTH = 500

/** Hard cap on selectors per registration call. */
const MAX_SELECTORS_PER_SPEC = 64

/**
 * Validate one raw selector string. Structural checks only: anything that
 * could escape the generated rule body ({}, ;, @, <, >) is rejected, and a
 * backslash is refused too (escape sequences have no business in an anchor
 * selector); ordinary CSS mistakes (a typo'd pseudo-class) are left to the
 * browser, which drops just that one rule — a safe failure mode.
 * @returns an error message, or null when the selector is acceptable.
 */
function selectorProblem(selector: unknown): string | null {
  if (typeof selector !== 'string') return 'must be a string'
  const trimmed = selector.trim()
  if (trimmed === '') return 'must not be empty'
  if (trimmed.length > MAX_SELECTOR_LENGTH) {
    return 'exceeds the ' + MAX_SELECTOR_LENGTH + '-character limit (' + trimmed.length + ')'
  }
  for (const ch of FORBIDDEN_SELECTOR_CHARS) {
    if (trimmed.includes(ch)) {
      return 'contains a forbidden character (' + JSON.stringify(ch) + ')'
    }
  }
  if (trimmed.includes(String.fromCharCode(92))) {
    return 'contains a backslash (escape sequences are not accepted)'
  }
  return null
}

/** Normalize a spec into validated (plugin, mode, selector) triples.
 * @returns the accepted triples plus one warning line per rejected selector. */
function normalizeSpec(spec: GlassSurfaceSpec): {
  rows: { plugin: string; mode: GlassSurfaceMode; selector: string }[]
  warnings: string[]
} {
  const plugin = typeof spec?.plugin === 'string' && spec.plugin.trim() !== '' ? spec.plugin.trim() : '(anonymous)'
  const mode: GlassSurfaceMode = spec?.mode === 'fill' ? 'fill' : 'token'
  const raw: unknown[] = Array.isArray(spec?.selectors) ? [...spec.selectors] : [spec?.selectors]
  const rows: { plugin: string; mode: GlassSurfaceMode; selector: string }[] = []
  const warnings: string[] = []
  if (raw.length > MAX_SELECTORS_PER_SPEC) {
    warnings.push('[glass-registry] ' + plugin + ': ' + raw.length + ' selectors exceeds the '
      + MAX_SELECTORS_PER_SPEC + '-selector cap; extra entries dropped.')
  }
  for (const item of raw.slice(0, MAX_SELECTORS_PER_SPEC)) {
    // selectorProblem already covers non-strings; the typeof check below is
    // what narrows `item` to string on the accepted path.
    const problem = selectorProblem(item)
    if (typeof item !== 'string' || problem !== null) {
      warnings.push('[glass-registry] ' + plugin + ': rejected selector '
        + JSON.stringify(item) + ' — ' + (problem ?? 'must be a string') + '.')
      continue
    }
    rows.push({ plugin, mode, selector: item.trim() })
  }
  return { rows, warnings }
}

/** The shared sheen gradient declaration (identical to the built-in sheet). */
const SHEEN_DECL = 'background-image: linear-gradient(180deg, rgba(255, 255, 255, var(--bg-glass-sheen, 0.07)), rgba(255, 255, 255, var(--bg-glass-sheen-mid, 0.02)) 38%, rgba(255, 255, 255, 0.01));'

/** The shared exposure chain (blur follows the glass-blur slider). */
const FILTER_DECL = '-webkit-backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01); backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);'

/**
 * Render one registered surface as a gated CSS rule — the same recipes the
 * built-in sheets emit for their explicit-fill families.
 */
function ruleFor(row: { mode: GlassSurfaceMode; selector: string }): string {
  const gate = 'body[' + GLASS_ATTR + ']'
  const fill = row.mode === 'fill'
    ? 'background-color: var(--dsw-specific-input-major); ' + SHEEN_DECL + ' ' + FILTER_DECL
    : SHEEN_DECL + ' ' + FILTER_DECL
  return gate + ' ' + row.selector + ' { ' + fill + ' }'
}

/**
 * Owns the registered surfaces and the registry stylesheet.
 */
export class GlassRegistry {
  private readonly entries = new Map<string, { row: { plugin: string; mode: GlassSurfaceMode; selector: string }; owner: object }>()
  private styleEl: HTMLStyleElement | null = null
  private disposed = false

  /**
   * Register one spec. See BackgroundGlassApi.register.
   * @param spec - the surfaces to glass.
   * @returns the unregister function (idempotent).
   */
  register(spec: GlassSurfaceSpec): () => void {
    // A disposed registry — or one superseded by a reinstall — must stay
    // INERT: accepting entries would orphan them outside the live fiber's
    // teardown (the stale api closure can outlive this plugin's disposal).
    if (this.disposed || (publishedRegistry !== undefined && publishedRegistry !== this)) {
      console.warn('[glass-registry] registration ignored: this bridge is no longer the live publication')
      return () => {}
    }
    let normalized: { rows: { plugin: string; mode: GlassSurfaceMode; selector: string }[]; warnings: string[] }
    try {
      normalized = normalizeSpec(spec)
    } catch (error) {
      // Hostile input (e.g. an array with a throwing getter) degrades to
      // warn-and-skip exactly like any other malformed spec — never throws.
      console.warn('[glass-registry] spec rejected: ' + (error instanceof Error ? error.message : String(error)))
      normalized = { rows: [], warnings: [] }
    }
    const { rows, warnings } = normalized
    for (const message of warnings) console.warn(message)
    const owner = {}
    const keys: string[] = []
    for (const row of rows) {
      // JSON encoding makes the three-part key unambiguous BY CONSTRUCTION:
      // control characters smuggled into any part cannot forge another triple.
      const key = JSON.stringify([row.plugin, row.mode, row.selector])
      this.entries.set(key, { row, owner })
      keys.push(key)
    }
    this.sync()
    let unregistered = false
    return () => {
      if (unregistered) return
      unregistered = true
      // The ownership check keeps a STALE handle from unregistering a newer
      // registration that replaced the same key (idempotent re-register).
      for (const key of keys) {
        const entry = this.entries.get(key)
        if (entry !== undefined && entry.owner === owner) this.entries.delete(key)
      }
      this.sync()
    }
  }

  /** Rebuild the registry stylesheet from the live entries. */
  private sync(): void {
    if (this.entries.size === 0) {
      this.styleEl?.remove()
      this.styleEl = null
      return
    }
    // Distinct rule texts only: two plugins may legitimately register the
    // same selector; cascade resolves duplicates anyway, but emitting one
    // identical rule keeps the sheet honest.
    const seen = new Set<string>()
    const rules: string[] = []
    for (const { row } of this.entries.values()) {
      const rule = ruleFor(row)
      if (!seen.has(rule)) {
        seen.add(rule)
        rules.push(rule)
      }
    }
    if (this.styleEl === null) {
      this.styleEl = document.createElement('style')
      this.styleEl.dataset.plugin = PLUGIN_ID
      this.styleEl.dataset.pluginCss = REGISTRY_CSS_TAG
      document.head.appendChild(this.styleEl)
    }
    this.styleEl.textContent = rules.join(String.fromCharCode(10))
  }

  /** Tear everything down: entries, stylesheet, and the window publication. */
  dispose(): void {
    this.disposed = true
    this.entries.clear()
    this.sync()
    const w = window as unknown as Record<string, unknown>
    if (w[GLASS_BRIDGE_GLOBAL] === this.api) delete w[GLASS_BRIDGE_GLOBAL]
    if (publishedRegistry === this) publishedRegistry = undefined
  }

  /** The published api face over this registry. */
  readonly api: BackgroundGlassApi = {
    version: GLASS_BRIDGE_VERSION,
    bridgeId: 'deepseek-harness-background',
    isActive: (): boolean =>
      typeof document !== 'undefined' && document.body !== null && document.body.hasAttribute(GLASS_ATTR),
    register: (spec: GlassSurfaceSpec): (() => void) => this.register(spec),
  }
}

/** The registry whose api is CURRENTLY published on window. Module-level on
 * purpose: the published api face deliberately carries no dispose member
 * (internal teardown stays unreachable for consumers), so reinstall-time
 * cleanup needs a handle the window key cannot provide. */
let publishedRegistry: GlassRegistry | undefined

/**
 * Publish the glass registry bridge onto window and announce it. Safe to
 * call repeatedly: a previous publication's REGISTRY is disposed first, so
 * exactly one bridge — and one stylesheet — is ever live.
 * @returns the bridge handle — call .dispose() when this plugin's client
 *   fiber tears down.
 */
export function installGlassBridge(): { api: BackgroundGlassApi; dispose(): void } {
  // A stale publication (hot reload of this very plugin) must not linger:
  // disposing its REGISTRY removes its stylesheet and clears its window
  // key. Dispose is idempotent, so a stale reference left behind by an
  // earlier fiber dispose is harmless to dispose again here.
  publishedRegistry?.dispose()
  // Belt-and-suspenders for the path where the module factory itself was
  // re-evaluated without a prior fiber dispose (closure state reset, so
  // publishedRegistry above is already undefined): any stylesheet carrying
  // our dedup key can only belong to a stale bridge — drop it.
  document.querySelector('style[data-plugin-css="' + REGISTRY_CSS_TAG + '"]')?.remove()
  const registry = new GlassRegistry()
  publishedRegistry = registry
  ;(window as unknown as Record<string, unknown>)[GLASS_BRIDGE_GLOBAL] = registry.api
  // Announce right after publishing: consumers that already polled the
  // global see it immediately; listeners get the event synchronously now.
  window.dispatchEvent(new CustomEvent(GLASS_READY_EVENT, { detail: registry.api }))
  return { api: registry.api, dispose: () => registry.dispose() }
}
