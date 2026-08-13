// @vitest-environment jsdom
/**
 * BackgroundOverlay behavior: closed by default, opens through the shared
 * overlay store, loads the section from the transport, previews draft edits
 * live, and saves through the transport.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BackgroundOverlay } from '../src/client/overlay.tsx'
import { overlayStore } from '../src/client/overlay-store.ts'
import { settingsClient } from '../src/client/settings-client.ts'
import { en } from '../src/client/locales.ts'
import type { BackgroundSettings } from '../src/settings.ts'

afterEach(() => {
  cleanup()
  overlayStore.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const SECTION: BackgroundSettings = {
  enabled: true,
  lightUrl: 'https://example.com/light.png',
  darkUrl: 'https://example.com/dark.png',
  opacity: 1,
  scrim: 0.25,
  fit: 'cover',
}

function mockFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/api/bg-wallpaper/settings')) {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as BackgroundSettings
        return { ok: true, json: async () => ({ ok: true, value: body }) } as Response
      }
      return { ok: true, json: async () => ({ ok: true, value: { ...SECTION } }) } as Response
    }
    return { ok: false, json: async () => ({}) } as Response
  }))
}

function mount() {
  render(<BackgroundOverlay t={(key) => en[key as keyof typeof en] ?? key} />)
}

describe('BackgroundOverlay', () => {
  it('renders nothing while closed', () => {
    mockFetch()
    mount()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens through the shared store and loads the section', async () => {
    mockFetch()
    mount()
    overlayStore.open()
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeTruthy()
    const preview = await screen.findByTestId('bg-overlay-preview')
    await waitFor(() => {
      expect(preview.style.backgroundImage).toContain('https://example.com/light.png')
    })
  })

  it('previews draft edits before saving (url, opacity)', async () => {
    mockFetch()
    mount()
    overlayStore.open()
    const preview = await screen.findByTestId('bg-overlay-preview')
    await waitFor(() => {
      expect(preview.style.backgroundImage).toContain('example.com/light.png')
    })

    const urlInput = screen.getByDisplayValue('https://example.com/light.png') as HTMLInputElement
    fireEvent.change(urlInput, { target: { value: 'https://example.com/two.png' } })
    expect(preview.style.backgroundImage).toContain('https://example.com/two.png')

    const ranges = screen.getAllByRole('slider') as HTMLInputElement[]
    fireEvent.change(ranges[0]!, { target: { value: '0.5' } })
    expect(preview.style.backgroundImage).toContain('rgba(255, 255, 255, 0.5)')
  })

  it('saves through the transport', async () => {
    mockFetch()
    mount()
    overlayStore.open()
    const preview = await screen.findByTestId('bg-overlay-preview')
    await waitFor(() => {
      expect(preview.style.backgroundImage).toContain('example.com/light.png')
    })

    const urlInput = screen.getByDisplayValue('https://example.com/light.png') as HTMLInputElement
    fireEvent.change(urlInput, { target: { value: 'https://example.com/two.png' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(settingsClient.getSnapshot().value?.lightUrl).toBe('https://example.com/two.png')
    })
  })

  it('closes on the backdrop click', async () => {
    mockFetch()
    mount()
    overlayStore.open()
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByText('Custom Background').parentElement!.parentElement!)
    expect(overlayStore.getSnapshot()).toBe(true)
  })
})
