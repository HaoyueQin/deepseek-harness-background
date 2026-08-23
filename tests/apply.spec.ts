// @vitest-environment jsdom
/**
 * apply() paints the background from the plugin's own settings transport
 * (fetch against /api/bg-wallpaper/settings) and registers the settings row
 * into the General section. Assert the surface contract: paint a loaded
 * section (wallpaper layer + scrim + data-dsh-bg + glass tokens), retract on
 * disable and on teardown, and the injection declaration. The transport fetch
 * is mocked; the painter runs on the real DOM.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { apply, inject } from '../src/client/index.ts'
import { paintPreviewSurface } from '../src/client/backdrop.ts'
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

let section: BackgroundSettings = { ...SECTION }
let fiber: Fiber | undefined

/** Mock the transport fetch; the current `section` is what the host serves. */
function mockFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'POST') {
      section = JSON.parse(String(init.body)) as BackgroundSettings
    }
    if (url.endsWith('/api/bg-wallpaper/settings')) {
      return {
        ok: true,
        json: async () => ({ ok: true, value: { ...section } }),
      } as Response
    }
    return { ok: false, json: async () => ({ ok: false }) } as Response
  }))
}

/** Apply with slots/locale/sessions stubs (no renderer is mounted in jsdom). */
async function mount() {
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
}

/** The wallpaper layer currently attached to body (null when absent). */
function layer(): HTMLDivElement | null {
  return document.querySelector('.dsh-bg-layer') as HTMLDivElement | null
}

function scrim(): HTMLDivElement | null {
  return document.querySelector('.dsh-bg-scrim') as HTMLDivElement | null
}

function img(): HTMLImageElement | null {
  return document.querySelector('.dsh-bg-layer img') as HTMLImageElement | null
}

afterEach(async () => {
  await fiber?.dispose()
  fiber = undefined
  document.body.removeAttribute('data-dsh-bg')
  delete document.body.dataset.dsDarkTheme
  document.body.style.cssText = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  section = { ...SECTION }
  ;(settingsClient as unknown as { snapshot: unknown }).snapshot = { status: 'loading' }
})

describe('deepseek-harness-background apply', () => {
  it('declares the framework service injections (slots, locale, sessions)', () => {
    expect(inject).toEqual(['slots', 'locale', 'sessions'])
  })

  it('paints a background layer + scrim with the resolved image and active attribute', async () => {
    mockFetch()
    await mount()
    expect(layer()).not.toBeNull()
    expect(scrim()).not.toBeNull()
    expect(img()?.src).toContain('/api/bg-wallpaper/image/up-abc')
    expect(document.body.getAttribute('data-dsh-bg')).toBe('on')
    // Glass surface token applied (panel not fully opaque).
    expect(document.body.style.getPropertyValue('--dsw-specific-input-major')).toContain('rgba(')
    // Owned CSS variables present.
    expect(document.body.style.getPropertyValue('--bg-scrim')).toBe('0.25')
    expect(document.body.style.getPropertyValue('--bg-glass-blur')).toBe('16px')
    // The image opacity knob is written so the wallpaper fades with the slider.
    expect(document.body.style.getPropertyValue('--bg-opacity')).toBe('1')
  })

  it('writes the image opacity knob onto body', async () => {
    section = { ...SECTION, opacity: 0.4 }
    mockFetch()
    await mount()
    expect(document.body.style.getPropertyValue('--bg-opacity')).toBe('0.4')
  })

  it('uses a white scrim in the light theme and a black one in the dark theme', async () => {
    mockFetch()
    await mount()
    const scrimStyle = document.querySelector('.dsh-bg-scrim') as HTMLElement | null
    expect(scrimStyle).not.toBeNull()
    // The scrim element itself carries no inline background; the theme split
    // lives in the injected stylesheet (white veil in light, black in dark).
    const cssTag = document.querySelector('style[data-plugin-css="deepseek-harness-background/styles"]')
    const cssText = cssTag?.textContent ?? ''
    expect(cssText).toContain('rgba(255, 255, 255, var(--bg-scrim')
    expect(cssText).toContain('body[data-ds-dark-theme] .dsh-bg-scrim')
    expect(cssText).toContain('rgba(0, 0, 0, var(--bg-scrim')
  })

  it('repaints the glass tokens when the theme flips (observer)', async () => {
    mockFetch()
    await mount()
    const lightValue = document.body.style.getPropertyValue('--dsw-specific-input-major')
    expect(lightValue).not.toBe('')
    // Flip to dark: the observer should rewrite the surface token with the
    // dark-scheme alpha.
    document.body.dataset.dsDarkTheme = ''
    await vi.waitFor(() => {
      const darkValue = document.body.style.getPropertyValue('--dsw-specific-input-major')
      expect(darkValue).not.toBe('')
      expect(darkValue).not.toBe(lightValue)
    })
    // Flip back to light: the token returns to the light-scheme value.
    delete document.body.dataset.dsDarkTheme
    await vi.waitFor(() => {
      expect(document.body.style.getPropertyValue('--dsw-specific-input-major')).toBe(lightValue)
    })
  })

  it('restores the official opaque surfaces when panelOpacity is at maximum', async () => {
    mockFetch()
    await mount()
    expect(document.body.style.getPropertyValue('--dsw-specific-input-major')).toContain('rgba(')
    section = { ...SECTION, panelOpacity: 1 }
    await settingsClient.load()
    await vi.waitFor(() => {
      expect(document.body.style.getPropertyValue('--dsw-specific-input-major')).toBe('')
    })
    // Blur is disabled with the glass.
    expect(document.body.style.getPropertyValue('--bg-glass-blur')).toBe('0px')
  })

  it('renders a URL source directly when no upload is selected', async () => {
    section = { ...SECTION, uploadId: '', url: 'https://example.com/a.jpg' }
    mockFetch()
    await mount()
    expect(img()?.src).toBe('https://example.com/a.jpg')
  })

  it('retracts the layers when the section disables the background', async () => {
    mockFetch()
    await mount()
    expect(layer()).not.toBeNull()

    section = { ...SECTION, enabled: false }
    await settingsClient.load()
    await vi.waitFor(() => {
      expect(layer()).toBeNull()
      expect(scrim()).toBeNull()
    })
    expect(document.body.getAttribute('data-dsh-bg')).toBeNull()
  })

  it('retracts every owned property and node on fiber dispose', async () => {
    document.body.style.backgroundImage = 'url(previous.png)'
    mockFetch()
    await mount()
    expect(layer()).not.toBeNull()

    await fiber?.dispose()
    fiber = undefined
    expect(layer()).toBeNull()
    expect(scrim()).toBeNull()
    expect(document.body.getAttribute('data-dsh-bg')).toBeNull()
    expect(document.body.style.getPropertyValue('--bg-scrim')).toBe('')
    // The original background-image was restored.
    expect(document.body.style.backgroundImage).toBe('url("previous.png")')
  })

  it('paints ONLY the whitelisted glass tokens and leaves the rest official', async () => {
    mockFetch()
    await mount()
    const style = document.body.style
    // Whitelist: composer input stack, message bubbles, the markdown code
    // surfaces, and the agent task strip family (--dsw-specific-tip).
    for (const token of [
      '--dsw-specific-input-major', '--dsw-specific-bubble',
      '--dsw-alias-markdown-code-block', '--dsw-alias-markdown-code-block-banner',
      '--dsw-alias-markdown-inline-code', '--dsw-specific-tip',
    ]) {
      expect(style.getPropertyValue(token), token).toContain('rgba(')
    }
    // Rollback contract: menus, dialog/settings layers, generic layers,
    // platform rows, overlays, selectors, buttons, sidebar items, hover
    // fills and accents are NOT overridden — they keep official paints so
    // reading surfaces (settings UI, tooltips, dropdowns) stay legible.
    for (const token of [
      '--dsw-specific-menu', '--dsw-specific-selector',
      '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3',
      '--dsw-alias-bg-module-platform', '--dsw-alias-bg-overlay',
      '--dsw-alias-button-elevated-fill', '--dsw-alias-button-floating-fill',
      '--dsw-alias-button-floating-hover', '--dsw-alias-button-ghost-active-fill',
      '--dsw-alias-button-tool-bar-fill', '--dsw-alias-button-tool-bar-hover',
      '--dsw-specific-sidebar-nav-item-hover', '--dsw-specific-sidebar-nav-item-active',
      '--dsw-alias-interactive-bg-hover-solid',
      '--dsw-alias-button-info-fill', '--dsw-alias-tooltip-bg',
      '--dsw-alias-state-warn-tertiary', '--dsw-alias-state-business-tertiary',
      '--dsw-alias-state-success-tertiary',
    ]) {
      expect(style.getPropertyValue(token), token).toBe('')
    }
  })

  it('clears every whitelisted token and the glass gate at maximum panel opacity', async () => {
    mockFetch()
    await mount()
    section = { ...SECTION, panelOpacity: 1 }
    await settingsClient.load()
    await vi.waitFor(() => {
      expect(document.body.style.getPropertyValue('--dsw-specific-input-major')).toBe('')
    })
    for (const token of [
      '--dsw-specific-bubble', '--dsw-alias-markdown-code-block',
      '--dsw-alias-markdown-inline-code', '--dsw-specific-tip',
    ]) {
      expect(document.body.style.getPropertyValue(token), token).toBe('')
    }
    // The explicit-fill rules (chrome buttons, subagent popover, preview
    // badge) key on this attribute — it must go with the glass.
    expect(document.body.getAttribute('data-dsh-bg-glass')).toBeNull()
  })

  it('sets the glass gate while the glass is on and removes it on disable', async () => {
    mockFetch()
    await mount()
    expect(document.body.getAttribute('data-dsh-bg-glass')).toBe('on')
    section = { ...SECTION, enabled: false }
    await settingsClient.load()
    await vi.waitFor(() => {
      expect(document.body.getAttribute('data-dsh-bg-glass')).toBeNull()
    })
  })

  it('restores a pre-existing whitelisted token value on dispose', async () => {
    document.body.style.setProperty('--dsw-specific-tip', 'rgb(1, 2, 3)')
    mockFetch()
    await mount()
    expect(document.body.style.getPropertyValue('--dsw-specific-tip')).toContain('rgba(')
    await fiber?.dispose()
    fiber = undefined
    expect(document.body.style.getPropertyValue('--dsw-specific-tip')).toBe('rgb(1, 2, 3)')
  })

  it('injects blur/sheen anchors for exactly the whitelisted surfaces', async () => {
    mockFetch()
    await mount()
    const cssTag = document.querySelector('style[data-plugin-css="deepseek-harness-background/styles"]')
    const cssText = cssTag?.textContent ?? ''
    // Composer + bubbles (tooltip suffix excluded), code surfaces incl.
    // inline code and the sticky banner wrap, tool IO + skill cards.
    expect(cssText).toContain('[data-composer-card]')
    expect(cssText).toContain('[class*="_bubble"]:not([role="tooltip"])')
    expect(cssText).toContain('.md-code-block')
    expect(cssText).toContain('[data-terminal]')
    expect(cssText).toContain('_ioCard')
    expect(cssText).toContain('_instructionsCard')
    expect(cssText).toContain(':not(pre) > code')
    expect(cssText).toContain('_bannerWrap')
    // Whitelisted chrome buttons (explicit fills behind the glass gate).
    expect(cssText).toContain('_newSession')
    expect(cssText).toContain('[data-composer-card] [class*="_add"]')
    expect(cssText).toContain('_toBottom')
    expect(cssText).toContain('data-dsh-bg-glass')
    // Substring-collision exclusions: the new-session button's inner label
    // span and the zero-height toBottom sticky slot share the suffix but must
    // keep their own paints (a glassed slot paints a full-width shadow band,
    // a glassed label doubles the button fill).
    expect(cssText).toContain('[class*="_newSession"]:not([class*="Label"])')
    expect(cssText).toContain('[class*="_toBottom"]:not([class*="Slot"])')
    // Unified recipe: chrome buttons + popover fill from the composer token,
    // badge keeps its hue via color-mix on the shared alpha var, and NO
    // surface caps the blur away from the glass-blur slider or pins a fixed
    // heavier fill.
    expect(cssText).toContain('var(--dsw-specific-input-major)')
    expect(cssText).toContain('color-mix(in srgb')
    expect(cssText).not.toContain('min(var(--bg-glass-blur')
    expect(cssText).not.toContain('rgba(255, 255, 255, 0.62')
    expect(cssText).not.toContain('rgba(255, 255, 255, 0.9)')
    // Subagent lineage popover + home hero preview badge.
    expect(cssText).toContain('[role="tree"][class*="_menu"]')
    expect(cssText).toContain('_previewBadge')
    // Empty-state hero glow dims so the wallpaper stays visible.
    expect(cssText).toContain('_heroGlow')
    // Rollback: no blanket anchors for menus/dialogs/panels/cards/toasts/
    // toolbars/send/rail, and no HoverCard ink re-scope.
    expect(cssText).not.toContain('[role="menu"]')
    expect(cssText).not.toContain('_dialog')
    expect(cssText).not.toContain('_panel')
    expect(cssText).not.toContain('[class*="_card"]')
    expect(cssText).not.toContain('_toast')
    expect(cssText).not.toContain('_toolbar')
    expect(cssText).not.toContain('_primary')
    expect(cssText).not.toContain('class$="_rail"')
    expect(cssText).not.toContain('--dsw-hovercard-bg')
  })

  it('calibrates the glass exposure: dimmed in light, lifted in dark', async () => {
    mockFetch()
    await mount()
    const style = document.body.style
    // Light scheme: no brightness boost and a halved sheen, so bright
    // wallpapers no longer blow out through the stacked glass layers.
    expect(style.getPropertyValue('--bg-glass-brightness')).toBe('0.98')
    expect(style.getPropertyValue('--bg-glass-sheen')).toBe('0.07')
    expect(style.getPropertyValue('--bg-glass-sheen-mid')).toBe('0.02')
    // Saturate rides a gentler capped slope: 1.1 + blur * 0.02 (max 1.6).
    expect(style.getPropertyValue('--bg-glass-saturate')).toBe('1.42')
    // Bare alpha knobs: every glass surface shares one curve (panelOpacity
    // 0.15 -> base 0.142 light, hover boost capped at 0.9).
    expect(style.getPropertyValue('--bg-glass-alpha')).toBe('0.142')
    expect(style.getPropertyValue('--bg-glass-alpha-strong')).toBe('0.213')
    // Dark scheme keeps the reference engine's slight lift + full sheen and
    // the dimmed dark alpha.
    document.body.dataset.dsDarkTheme = ''
    await vi.waitFor(() => {
      expect(style.getPropertyValue('--bg-glass-brightness')).toBe('1.04')
      expect(style.getPropertyValue('--bg-glass-sheen')).toBe('0.16')
      expect(style.getPropertyValue('--bg-glass-sheen-mid')).toBe('0.05')
      expect(style.getPropertyValue('--bg-glass-alpha')).toBe('0.071')
    })
  })

  it('neutralizes the exposure once the glass turns off', async () => {
    mockFetch()
    await mount()
    section = { ...SECTION, panelOpacity: 1 }
    await settingsClient.load()
    await vi.waitFor(() => {
      expect(document.body.style.getPropertyValue('--dsw-specific-input-major')).toBe('')
    })
    expect(document.body.style.getPropertyValue('--bg-glass-brightness')).toBe('1')
  })

  it('mirrors the calibrated exposure on the settings preview surface', async () => {
    const el = document.createElement('div')
    paintPreviewSurface(el, { ...SECTION })
    expect(el.style.getPropertyValue('--bg-glass-brightness')).toBe('0.98')
    expect(el.style.getPropertyValue('--bg-glass-saturate')).toBe('1.42')
    document.body.dataset.dsDarkTheme = ''
    paintPreviewSurface(el, { ...SECTION })
    expect(el.style.getPropertyValue('--bg-glass-brightness')).toBe('1.04')
    delete document.body.dataset.dsDarkTheme
    // Glass off (panelOpacity 1): the preview filter goes fully neutral.
    paintPreviewSurface(el, { ...SECTION, panelOpacity: 1 })
    expect(el.style.getPropertyValue('--bg-glass-brightness')).toBe('1')
    expect(el.style.getPropertyValue('--bg-glass-blur')).toBe('0px')
  })

  it('is a no-op while the transport has not loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      json: async () => ({ ok: false }),
    }) as Response))
    const ctx = new Context()
    ctx.provide('slots', { inject: () => () => {}, register: () => () => {} } as never)
    ctx.provide('locale', { register: () => () => {} } as never)
    ctx.provide('sessions', { binding: () => undefined } as never)
    const f = ctx.plugin({ apply })
    await f.await()
    fiber = f
    await vi.waitFor(() => {
      expect(settingsClient.getSnapshot().status).toBe('error')
    })
    expect(layer()).toBeNull()
  })
})
