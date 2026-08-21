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

/** Apply with slots/locale stubs (the renderer is not mounted in jsdom). */
async function mount() {
  const ctx = new Context()
  ctx.provide('slots', { inject: () => () => {}, register: () => () => {} } as never)
  ctx.provide('locale', { register: () => () => {} } as never)
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
  it('declares the framework service injections (slots, locale)', () => {
    expect(inject).toEqual(['slots', 'locale'])
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

  it('paints the universal glass tokens for menus, code, panels and buttons', async () => {
    mockFetch()
    await mount()
    const style = document.body.style
    // Surface family: white-glass rgba on every token that feeds an opaque
    // surface (menus, dialogs/layers, code blocks, inline code, dock cards,
    // the plus button, the new-session button, hover-solid fills).
    for (const token of [
      '--dsw-specific-menu',
      '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3',
      '--dsw-alias-markdown-code-block', '--dsw-alias-markdown-code-block-banner',
      '--dsw-alias-markdown-inline-code',
      '--dsw-alias-bg-module-platform', '--dsw-alias-bg-overlay',
      '--dsw-specific-tip', '--dsw-specific-selector',
      '--dsw-alias-button-elevated-fill', '--dsw-alias-button-floating-fill',
      '--dsw-alias-interactive-bg-hover-solid',
    ]) {
      expect(style.getPropertyValue(token), token).toContain('rgba(')
    }
    // Accent family: official hue kept (send button stays blue in light).
    expect(style.getPropertyValue('--dsw-alias-button-info-fill'))
      .toMatch(/^rgba\(65, 118, 230, 0\.\d{3}\)$/)
    expect(style.getPropertyValue('--dsw-alias-tooltip-bg')).toContain('rgba(')
    expect(style.getPropertyValue('--dsw-alias-state-warn-tertiary')).toContain('rgba(')
  })

  it('clears every universal token when panelOpacity is at maximum', async () => {
    mockFetch()
    await mount()
    section = { ...SECTION, panelOpacity: 1 }
    await settingsClient.load()
    await vi.waitFor(() => {
      expect(document.body.style.getPropertyValue('--dsw-specific-input-major')).toBe('')
    })
    for (const token of [
      '--dsw-specific-menu', '--dsw-alias-bg-layer-2',
      '--dsw-alias-markdown-code-block', '--dsw-alias-markdown-inline-code',
      '--dsw-alias-button-info-fill', '--dsw-alias-tooltip-bg',
    ]) {
      expect(document.body.style.getPropertyValue(token), token).toBe('')
    }
  })

  it('repaints the accent tokens with the dark hue when the theme flips', async () => {
    mockFetch()
    await mount()
    expect(document.body.style.getPropertyValue('--dsw-alias-button-info-fill'))
      .toContain('65, 118, 230')
    document.body.dataset.dsDarkTheme = ''
    await vi.waitFor(() => {
      expect(document.body.style.getPropertyValue('--dsw-alias-button-info-fill'))
        .toContain('103, 158, 254')
    })
  })

  it('restores a pre-existing universal token value on dispose', async () => {
    document.body.style.setProperty('--dsw-specific-menu', 'rgb(1, 2, 3)')
    mockFetch()
    await mount()
    expect(document.body.style.getPropertyValue('--dsw-specific-menu')).toContain('rgba(')
    await fiber?.dispose()
    fiber = undefined
    expect(document.body.style.getPropertyValue('--dsw-specific-menu')).toBe('rgb(1, 2, 3)')
  })

  it('injects blur/sheen anchors for the universal surfaces', async () => {
    mockFetch()
    await mount()
    const cssTag = document.querySelector('style[data-plugin-css="deepseek-harness-background/styles"]')
    const cssText = cssTag?.textContent ?? ''
    // Code surfaces incl. inline code and the sticky banner wrap.
    expect(cssText).toContain('.md-code-block')
    expect(cssText).toContain('[data-terminal]')
    expect(cssText).toContain('_ioCard')
    expect(cssText).toContain(':not(pre) > code')
    expect(cssText).toContain('_bannerWrap')
    // Menus, dialogs/panels, cards.
    expect(cssText).toContain('[role="menu"]')
    expect(cssText).toContain('_dialog')
    expect(cssText).toContain('_panel')
    expect(cssText).toContain('_card')
    // Buttons & chips: new session, plus, send, attachment rail, toasts.
    expect(cssText).toContain('_newSession')
    expect(cssText).toContain('_add')
    expect(cssText).toContain('_primary')
    expect(cssText).toContain('_rail')
    expect(cssText).toContain('_toBottom')
    expect(cssText).toContain('_toast')
    // Empty-state hero glow dims so the wallpaper stays visible.
    expect(cssText).toContain('_heroGlow')
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
    // Dark scheme keeps the reference engine's slight lift + full sheen.
    document.body.dataset.dsDarkTheme = ''
    await vi.waitFor(() => {
      expect(style.getPropertyValue('--bg-glass-brightness')).toBe('1.04')
      expect(style.getPropertyValue('--bg-glass-sheen')).toBe('0.16')
      expect(style.getPropertyValue('--bg-glass-sheen-mid')).toBe('0.05')
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
    const f = ctx.plugin({ apply })
    await f.await()
    fiber = f
    await vi.waitFor(() => {
      expect(settingsClient.getSnapshot().status).toBe('error')
    })
    expect(layer()).toBeNull()
  })
})
