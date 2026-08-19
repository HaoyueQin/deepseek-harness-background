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
