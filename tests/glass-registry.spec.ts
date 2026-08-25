// @vitest-environment jsdom
/**
 * glass-registry — the third-party frosted-glass bridge. Assert the public
 * contract end to end on the real DOM: the window publication + ready event,
 * gated rule synthesis for both fill modes, idempotent re-register and
 * unregister, structural selector validation, isActive() truthfulness
 * against the REAL painter, and full teardown on fiber dispose.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { GLASS_ATTR } from '../src/client/background-css.ts'
import { GLASS_BRIDGE_GLOBAL, GLASS_READY_EVENT, installGlassBridge } from '../src/client/glass-registry.ts'
import type { BackgroundGlassApi } from '../src/client/glass-registry.ts'
import { backgroundPainter, paintBackground } from '../src/client/backdrop.ts'
import { apply } from '../src/client/index.ts'
import { settingsClient } from '../src/client/settings-client.ts'
import type { BackgroundSettings } from '../src/settings.ts'

const SECTION: BackgroundSettings = {
  enabled: true,
  uploadId: 'up-abc',
  url: '',
  opacity: 1,
  scrim: 0.25,
  panelOpacity: 0.15,
  blur: 16,
  wallpaperBlur: 0,
  fit: 'cover',
  timeline: true,
}

/** The registry stylesheet tag (null when nothing is registered). */
function registryStyle(): HTMLStyleElement | null {
  return document.querySelector('style[data-plugin-css="deepseek-harness-background/glass-registry"]')
}

/** The current window publication (undefined when unpublished). */
function globalApi(): unknown {
  return (window as unknown as Record<string, unknown>)[GLASS_BRIDGE_GLOBAL]
}

let fiber: Fiber | undefined

afterEach(async () => {
  await fiber?.dispose()
  fiber = undefined
  backgroundPainter.dispose()
  document.body.removeAttribute('data-dsh-bg')
  document.body.removeAttribute(GLASS_ATTR)
  document.body.style.cssText = ''
  document.head.innerHTML = ''
  delete (window as unknown as Record<string, unknown>)[GLASS_BRIDGE_GLOBAL]
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
});

describe('glass bridge publication', () => {
  it('publishes the api on window and announces the ready event synchronously', () => {
    const events: unknown[] = []
    window.addEventListener(GLASS_READY_EVENT, (e) => events.push((e as CustomEvent).detail))
    const { api } = installGlassBridge()
    expect(globalApi()).toBe(api)
    expect(api.version).toBe(1)
    expect(api.bridgeId).toBe('deepseek-harness-background')
    expect(events).toEqual([api])
  });

  it('replaces a stale publication on re-install (hot reload) via its own dispose', () => {
    const first = installGlassBridge()
    // Give the stale bridge real state: a registration creates its stylesheet.
    first.api.register({ plugin: 'old-plugin', selectors: ['.stale-row'] })
    expect(registryStyle()).not.toBeNull()
    const before = globalApi()
    const second = installGlassBridge()
    expect(globalApi()).toBe(second.api)
    expect(globalApi()).not.toBe(before)
    // The stale REGISTRY was disposed by the reinstall: its stylesheet is
    // gone and the fresh bridge starts empty.
    expect(registryStyle()).toBeNull()
    // Re-registering on the new bridge recreates exactly one stylesheet.
    second.api.register({ plugin: 'new-plugin', selectors: ['.fresh-row'] })
    const css = registryStyle()?.textContent ?? ''
    expect(css).toContain('.fresh-row')
    expect(css).not.toContain('.stale-row')
    // The stale bridge's dispose already ran; calling it again is harmless.
    first.dispose()
    expect(globalApi()).toBe(second.api)
    expect(registryStyle()?.textContent ?? '').toContain('.fresh-row')
  });

  it('a factory re-evaluation without dispose still leaves no ghost stylesheet', () => {
    // Simulate the loader re-running the bundle factory WITHOUT disposing
    // the previous fiber: closure state (publishedRegistry) is gone, but a
    // stale stylesheet tag with our dedup key is still in the document.
    const ghost = document.createElement('style')
    ghost.dataset.pluginCss = 'deepseek-harness-background/glass-registry'
    ghost.textContent = 'body[data-dsh-bg-glass] .ghost-row { color: red }'
    document.head.appendChild(ghost)
    // A fresh install must sweep it before publishing.
    installGlassBridge()
    expect(document.contains(ghost)).toBe(false)
    expect(registryStyle()).toBeNull()
  });

  it('isActive() mirrors the real painter gate across its three states', () => {
    const { api } = installGlassBridge()
    expect(api.isActive()).toBe(false)
    paintBackground(SECTION)
    expect(api.isActive()).toBe(true)
    // User maxes the panel-opacity slider: glass off, wallpaper still on.
    paintBackground({ ...SECTION, panelOpacity: 1 })
    expect(api.isActive()).toBe(false)
    // Section disabled entirely: no wallpaper at all.
    paintBackground({ ...SECTION, enabled: false })
    expect(api.isActive()).toBe(false)
    // Sourceless-enabled edge case: attribute cleared, glass off.
    paintBackground({ ...SECTION, uploadId: '', url: '' })
    expect(api.isActive()).toBe(false)
  });
});


describe('registration contract', () => {
  it('token mode adds ONLY the sheen + filter chain under the gate', () => {
    const { api } = installGlassBridge()
    api.register({ plugin: 'dsh-diff-stat', selectors: ['[data-diff-window]'] })
    const sheet = registryStyle()
    expect(sheet).not.toBeNull()
    const css = sheet?.textContent ?? ''
    expect(css).toContain('body[' + GLASS_ATTR + '] [data-diff-window]')
    expect(css).toContain('backdrop-filter: blur(var(--bg-glass-blur')
    expect(css).toContain('var(--bg-glass-sheen')
    expect(css).not.toContain('background-color:')
  });

  it("mode 'fill' also takes over the surface fill (composer recipe)", () => {
    const { api } = installGlassBridge()
    api.register({ plugin: 'some-plugin', selectors: ['.my-panel'], mode: 'fill' })
    const css = registryStyle()?.textContent ?? ''
    expect(css).toContain('background-color: var(--dsw-specific-input-major)')
    expect(css).toContain('body[' + GLASS_ATTR + '] .my-panel')
  });

  it('accepts several selectors per spec and unregisters them with one handle', () => {
    const { api } = installGlassBridge()
    const off = api.register({ plugin: 'p', selectors: ['.alpha', '.beta'] })
    const css = registryStyle()?.textContent ?? ''
    expect(css).toContain('.alpha')
    expect(css).toContain('.beta')
    off()
    expect(registryStyle()).toBeNull()
    expect(() => off()).not.toThrow() // double-unregister is a safe no-op
  });

  it('re-registering the same triple replaces it and the stale handle is inert', () => {
    const { api } = installGlassBridge()
    const stale = api.register({ plugin: 'p', selectors: ['.row'] })
    api.register({ plugin: 'p', selectors: ['.row'], mode: 'fill' })
    stale() // must NOT remove the replacement
    const css = registryStyle()?.textContent ?? ''
    expect(css).toContain('.row')
    expect(css).toContain('background-color:')
    expect(css).not.toContain('.alpha')
  });

  it('trims selector whitespace; a blank plugin id surfaces as (anonymous) in warnings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { api } = installGlassBridge()
    api.register({ plugin: '   ', selectors: ['  .padded-row  ', '   '] })
    // The valid selector lands trimmed: no padded spaces survive in the rule.
    expect(registryStyle()?.textContent ?? '').toContain('body[' + GLASS_ATTR + '] .padded-row {')
    // The empty one is rejected, reported under the (anonymous) identity.
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0] ?? '')).toContain('(anonymous)')
  });

  it('deduplicates the identical rule text produced by two plugins', () => {
    const { api } = installGlassBridge()
    api.register({ plugin: 'plugin-a', selectors: ['.shared'] })
    api.register({ plugin: 'plugin-b', selectors: ['.shared'] })
    const css = registryStyle()?.textContent ?? ''
    expect(api.version).toBe(1)
    expect((css.match(/\.shared/g) ?? []).length).toBe(1)
  });
});

describe('stale-bridge guard (review findings F2/F4)', () => {
  it('a superseded bridge refuses registrations instead of orphaning them', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const first = installGlassBridge()
    const second = installGlassBridge()
    // Holding the STALE api object must be inert: no throw, no entry.
    expect(() => first.api.register({ plugin: 'late-comer', selectors: ['.orphan'] })).not.toThrow()
    second.api.register({ plugin: 'live-plugin', selectors: ['.live-row'] })
    const css = registryStyle()?.textContent ?? ''
    expect(css).toContain('.live-row')
    expect(css).not.toContain('.orphan')
    // Exactly ONE registry stylesheet tag exists despite the stale call.
    expect(document.querySelectorAll('style[data-plugin-css="deepseek-harness-background/glass-registry"]').length).toBe(1)
    expect(warn.mock.calls.some((c) => String(c[0]).includes('no longer the live publication'))).toBe(true)
  });

  it('hostile selector containers degrade to warn-and-skip instead of throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { api } = installGlassBridge()
    // An array whose element getter throws must not blow up register().
    const hostile = Object.defineProperty([], '0', { get() { throw new Error('boom') } })
    expect(() => api.register({ plugin: 'p2', selectors: hostile })).not.toThrow()
    expect(registryStyle()).toBeNull()
    expect(warn.mock.calls.some((c) => String(c[0]).includes('spec rejected'))).toBe(true)
  });
});

describe('selector validation', () => {
  it('rejects unsafe or malformed selectors with warnings, keeps valid siblings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { api } = installGlassBridge()
    api.register({
      plugin: 'naughty-plugin',
      selectors: [
        '.valid-row',
        '.escape {} .injected',
        'a; background:url(x)',
        '@media print',
        '',
        'x'.repeat(501),
        '.back' + String.fromCharCode(92) + 'slash-row',
      ],
    })
    expect(warn).toHaveBeenCalledTimes(6)
    const css = registryStyle()?.textContent ?? ''
    expect(css).toContain('.valid-row')
    expect(css).not.toContain('injected')
    expect(css).not.toContain('@media')
  });

  it('caps a spec at 64 selectors and reports the overflow once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { api } = installGlassBridge()
    const many = Array.from({ length: 70 }, (_unused, i) => '.cap-row-' + i)
    api.register({ plugin: 'cap-plugin', selectors: many })
    // Exactly the first 64 are accepted...
    const css = registryStyle()?.textContent ?? ''
    expect((css.match(/\.cap-row-/g) ?? []).length).toBe(64)
    // ...with one aggregate warning for the dropped tail.
    expect(warn.mock.calls.some((c) => String(c[0]).includes('exceeds the 64-selector cap'))).toBe(true)
  });

  it('reports non-string selectors with the must-be-a-string message', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { api } = installGlassBridge()
    // The runtime guard exists for JS consumers; the cast mirrors that reality.
    api.register({ plugin: 'types-plugin', selectors: [42] as unknown as string[] })
    expect(registryStyle()).toBeNull()
    expect(warn.mock.calls.some((c) => String(c[0]).includes('must be a string'))).toBe(true)
  });

  it('falls back to token mode on an unknown mode value', () => {
    const { api } = installGlassBridge()
    api.register({ plugin: 'modeless-plugin', selectors: ['.fallback-row'], mode: 'shiny' as never })
    const css = registryStyle()?.textContent ?? ''
    // Unknown mode degrades to the documented default: frost only, no fill takeover.
    expect(css).toContain('body[' + GLASS_ATTR + '] .fallback-row')
    expect(css).not.toContain('background-color:')
  });
});

describe('bridge teardown', () => {
  it('dispose clears the stylesheet, the entries, and the window key', () => {
    const { api, dispose } = installGlassBridge()
    api.register({ plugin: 'p', selectors: ['.row'] })
    dispose()
    expect(registryStyle()).toBeNull()
    expect(globalApi()).toBeUndefined()
    expect(api.isActive()).toBe(false)
  });
});

describe('client integration', () => {
  /** Mount the real client apply against a mocked transport; returns the api. */
  async function mount(section: BackgroundSettings): Promise<BackgroundGlassApi> {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, value: { ...section } }),
    }) as Response))
    const ctx = new Context()
    ctx.provide('slots', { inject: () => () => {}, register: () => () => {} } as never)
    ctx.provide('locale', { register: () => () => {} } as never)
    ctx.provide('sessions', { binding: () => undefined } as never)
    const f = ctx.plugin({ apply })
    await f.await()
    fiber = f
    await vi.waitFor(() => {
      expect(settingsClient.getSnapshot().status).toBe('ready')
    })
    const api = globalApi()
    expect(api).toBeDefined()
    return api as BackgroundGlassApi
  }

  it('apply publishes the bridge; fiber dispose retracts registration + publication', async () => {
    const api = await mount(SECTION)
    // A consumer registers while the wallpaper is live.
    api.register({ plugin: 'dsh-diff-stat', selectors: ['[data-diff-window]', '[data-diff-stat-peek]'] })
    expect(registryStyle()?.textContent ?? '').toContain('[data-diff-stat-peek]')
    expect(api.isActive()).toBe(true)
    await fiber?.dispose()
    fiber = undefined
    expect(globalApi()).toBeUndefined()
    expect(registryStyle()).toBeNull()
    // The existing painter retraction is untouched by the bridge.
    expect(document.querySelector('.dsh-bg-layer')).toBeNull()
    expect(document.body.hasAttribute(GLASS_ATTR)).toBe(false)
  });

  it('registrations made while the glass is OFF wait under the gate', async () => {
    const api = await mount({ ...SECTION, panelOpacity: 1 })
    api.register({ plugin: 'future-consumer', selectors: ['.peek-panel'] })
    // Rule synthesized, gate closed: nothing is glassed yet.
    expect(registryStyle()?.textContent ?? '').toContain('.peek-panel')
    expect(document.body.hasAttribute(GLASS_ATTR)).toBe(false)
    expect(api.isActive()).toBe(false)
    // The user drags the panel slider down: same rules light up, zero re-register.
    paintBackground(SECTION)
    expect(api.isActive()).toBe(true)
    expect(registryStyle()?.textContent ?? '').toContain('.peek-panel')
  });
});
