// @vitest-environment jsdom
/**
 * apply() paints the body background from the plugin's own settings transport
 * (fetch against /api/bg-wallpaper/settings) and registers the entry card +
 * overlay. Assert the surface contract: paint from a loaded section, live
 * dark/light flip, disable restore, teardown restore, and the injection
 * declaration. The transport fetch is mocked; the render logic runs on the
 * real DOM.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { apply, inject } from '../src/client/index.ts'
import { settingsClient } from '../src/client/settings-client.ts'
import type { BackgroundSettings } from '../src/settings.ts'

const SECTION: BackgroundSettings = {
  enabled: true,
  lightUrl: 'https://example.com/light.png',
  darkUrl: 'https://example.com/dark.png',
  opacity: 1,
  scrim: 0.25,
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
    return { ok: false, json: async () => ({}) } as Response
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

afterEach(async () => {
  await fiber?.dispose()
  fiber = undefined
  document.body.removeAttribute('data-ds-dark-theme')
  document.body.style.cssText = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  section = { ...SECTION }
  ;(settingsClient as unknown as { snapshot: unknown }).snapshot = { status: 'loading' }
})

describe('dsh-bg-wallpaper apply', () => {
  it('declares the framework service injections (slots, locale)', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('paints the background from the loaded section when enabled', async () => {
    mockFetch()
    await mount()
    expect(document.body.style.backgroundImage).toContain('https://example.com/light.png')
    expect(document.body.style.backgroundSize).toBe('cover')
    expect(document.body.style.backgroundAttachment).toBe('fixed')
  })

  it('swaps to the dark image with a black veil when the theme flips dark', async () => {
    mockFetch()
    await mount()
    expect(document.body.style.backgroundImage).toContain('https://example.com/light.png')

    document.body.dataset.dsDarkTheme = ''
    await vi.waitFor(() => {
      expect(document.body.style.backgroundImage).toContain('https://example.com/dark.png')
    })

    delete document.body.dataset.dsDarkTheme
    await vi.waitFor(() => {
      expect(document.body.style.backgroundImage).toContain('https://example.com/light.png')
    })
  })

  it('restores the plain surface when the section disables the background', async () => {
    mockFetch()
    await mount()
    expect(document.body.style.backgroundImage).toContain('example.com/light.png')

    section = { ...SECTION, enabled: false }
    await settingsClient.load()
    await vi.waitFor(() => {
      expect(document.body.style.backgroundImage).toBe('')
    })
    // The theme observer is gone: flipping dark paints nothing.
    document.body.dataset.dsDarkTheme = ''
    await Promise.resolve()
    expect(document.body.style.backgroundImage).toBe('')
  })

  it('retracts every owned property on fiber dispose', async () => {
    document.body.style.backgroundImage = 'url(previous.png)'
    mockFetch()
    await mount()
    expect(document.body.style.backgroundImage).toContain('example.com/light.png')

    await fiber?.dispose()
    fiber = undefined
    expect(document.body.style.backgroundImage).toBe('url("previous.png")')
    expect(document.body.style.backgroundAttachment).toBe('')
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
    expect(document.body.style.backgroundImage).toBe('')
  })
})
