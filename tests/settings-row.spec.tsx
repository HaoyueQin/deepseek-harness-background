// @vitest-environment jsdom
/**
 * Settings row surface contract: renders the preview card, the stepped
 * sliders (5% snap for ratios), and defers persistence to gesture release —
 * the previous implementation saved on every onChange tick, which made the
 * slider janky. The transport fetch is mocked; the row renders with React.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { paintBackground } from '../src/client/backdrop.ts'
import { BackgroundSettingsRow } from '../src/client/SettingsRow.tsx'
import { settingsClient, type SaveResult } from '../src/client/settings-client.ts'
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

/** In-memory store the mock fetch reads/writes. */
let persisted: BackgroundSettings = { ...SECTION }

const t = (key: string): string => key

beforeEach(() => {
  persisted = { ...SECTION }
  settingsClient.load = vi.fn(async () => {
    ;(settingsClient as unknown as { snapshot: unknown }).snapshot = { status: 'ready', value: { ...persisted } }
  })
  settingsClient.save = vi.fn(async (section: BackgroundSettings): Promise<SaveResult> => {
    persisted = { ...section }
    ;(settingsClient as unknown as { snapshot: unknown }).snapshot = { status: 'ready', value: { ...section } }
    return 'ok'
  })
  settingsClient.upload = vi.fn(async () => null)
  void settingsClient.load()
})

afterEach(() => {
  cleanup()
  document.body.removeAttribute('data-dsh-bg')
  document.body.style.cssText = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function renderRow(): RenderResult {
  return render(<BackgroundSettingsRow t={t} />)
}

/** CSS Modules hash the class names; match by suffix so jsdom works too. */
function byLocal(local: string): HTMLElement | null {
  return document.querySelector(`[class$="${local}"]`)
}

function byLocalAny(local: string): HTMLElement | null {
  return document.querySelector(`[class*="${local}"]`)
}

describe('BackgroundSettingsRow', () => {
  it('renders the preview surface, source controls and effect sliders', async () => {
    renderRow()
    await screen.findByText('background.opacity')
    expect(byLocalAny('preview')).not.toBeNull()
    expect(byLocalAny('previewImg')).not.toBeNull()
    // Five sliders + fit segmented control.
    const ranges = document.querySelectorAll('input[type="range"]')
    expect(ranges).toHaveLength(5)
    expect(byLocalAny('segGroup')).not.toBeNull()
    expect(document.querySelector('input[type="file"]')).not.toBeNull()
    expect(byLocalAny('urlInput')).not.toBeNull()
  })

  it('snaps ratio sliders to 5% steps and px sliders to fine steps', async () => {
    renderRow()
    await screen.findByText('background.opacity')
    const ranges = document.querySelectorAll('input[type="range"]') as NodeListOf<HTMLInputElement>
    const spec = Object.fromEntries(
      [...ranges].map((r) => [r.getAttribute('aria-label'), r.step]),
    )
    expect(spec['background.opacity']).toBe('0.05')
    expect(spec['background.scrim']).toBe('0.05')
    expect(spec['background.panelOpacity']).toBe('0.05')
    expect(spec['background.blur']).toBe('1')
    expect(spec['background.wallpaperBlur']).toBe('2')
  })

  it('writes the live preview variables while dragging and persists on release', async () => {
    // Activate a real background first so the slider drag exercises the
    // painter's single-knob hot path against an applied section.
    paintBackground({ ...persisted, enabled: true })
    renderRow()
    await screen.findByText('background.opacity')
    const slider = document.querySelector('input[type="range"]') as HTMLInputElement
    fireEvent.input(slider, { target: { value: '0.5' } })
    // Live preview: the variable lands on body and the preview surface
    // immediately (the parent .preview element precedes its children in DOM
    // order, so [class*="preview"] resolves to the container)…
    expect(document.body.style.getPropertyValue('--bg-opacity')).toBe('0.5')
    const preview = byLocalAny('preview')
    expect(preview?.style.getPropertyValue('--bg-opacity')).toBe('0.5')
    // …but nothing is persisted yet (release commits).
    expect(persisted.opacity).toBe(1)
    fireEvent.pointerUp(slider)
    await waitFor(() => {
      expect(persisted.opacity).toBe(0.5)
    })
  })

  it('commits a keyboard slider change on the key-up release', async () => {
    paintBackground({ ...persisted, enabled: true })
    renderRow()
    await screen.findByText('background.opacity')
    const slider = document.querySelector('input[type="range"]') as HTMLInputElement
    fireEvent.input(slider, { target: { value: '0.4' } })
    expect(persisted.opacity).toBe(1)
    fireEvent.keyUp(slider, { key: 'ArrowRight' })
    await waitFor(() => {
      expect(persisted.opacity).toBe(0.4)
    })
  })

  it('previews the panel-opacity effect on the glass bubble', async () => {
    paintBackground({ ...persisted, enabled: true })
    renderRow()
    await screen.findByText('background.opacity')
    const preview = byLocalAny('preview')
    // Default panelOpacity (0.15) renders a translucent white veil.
    expect(preview?.style.getPropertyValue('--bg-preview-glass')).toMatch(/^rgba\(255, 255, 255, 0\.\d+\)$/)
    // Dragging the panel-opacity slider to its max turns the bubble opaque
    // and switches the blur off, mirroring the live surface at 100%.
    const panel = [...document.querySelectorAll('input[type="range"]')]
      .find((r) => r.getAttribute('aria-label') === 'background.panelOpacity') as HTMLInputElement
    fireEvent.input(panel, { target: { value: '1' } })
    expect(preview?.style.getPropertyValue('--bg-preview-glass')).toBe('var(--dsw-alias-bg-layer-1)')
    expect(preview?.style.getPropertyValue('--bg-glass-blur')).toBe('0px')
  })

  it('rejects a non-http(s) url with an error and saves nothing', async () => {
    renderRow()
    await screen.findByText('background.opacity')
    const input = byLocalAny('urlInput') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'file:///C:/x.png' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    // The draft source stays empty and nothing persisted.
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('background.invalidUrl')
    })
    expect(persisted.url).toBe('')
    expect(persisted.uploadId).toBe('up-abc')
  })

  it('does not adopt a superseded save (an older save resolving after a newer one)', async () => {
    let release!: (result: SaveResult) => void
    const gated = new Promise<SaveResult>((resolve) => { release = resolve })
    let posts = 0
    settingsClient.save = vi.fn((section: BackgroundSettings): Promise<SaveResult> => {
      posts += 1
      if (posts === 1) return gated
      // The newer save commits and owns the snapshot.
      persisted = { ...section }
      ;(settingsClient as unknown as { snapshot: unknown }).snapshot = { status: 'ready', value: { ...section } }
      return Promise.resolve('ok')
    })
    paintBackground({ ...persisted, enabled: true })
    const view = renderRow()
    await screen.findByText('background.opacity')
    vi.useFakeTimers()
    try {
      const slider = document.querySelector('input[type="range"]') as HTMLInputElement
      // Gesture 1 → save #1 hangs; gesture 2 → save #2 commits 0.6.
      fireEvent.input(slider, { target: { value: '0.3' } })
      fireEvent.pointerUp(slider)
      await vi.advanceTimersByTimeAsync(120)
      expect(posts).toBe(1)
      fireEvent.input(slider, { target: { value: '0.6' } })
      fireEvent.pointerUp(slider)
      await vi.advanceTimersByTimeAsync(120)
      expect(persisted.opacity).toBe(0.6)
      // The older save resolves late, displaced — the draft must stay at 0.6.
      release('superseded')
      await vi.advanceTimersByTimeAsync(0)
      expect(slider.value).toBe('0.6')
      expect(screen.queryByRole('alert')).toBeNull()
    } finally {
      vi.useRealTimers()
      view.unmount()
    }
  })

  it('flushes a pending debounced commit on unmount exactly once', async () => {
    paintBackground({ ...persisted, enabled: true })
    const view = renderRow()
    await screen.findByText('background.opacity')
    vi.useFakeTimers()
    try {
      const slider = document.querySelector('input[type="range"]') as HTMLInputElement
      fireEvent.input(slider, { target: { value: '0.5' } })
      fireEvent.pointerUp(slider)
      // Unmount inside the debounce window: the armed commit must fire now.
      await vi.advanceTimersByTimeAsync(50)
      view.unmount()
      await vi.advanceTimersByTimeAsync(200)
      expect(persisted.opacity).toBe(0.5)
      expect(settingsClient.save).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not re-save on unmount when the debounced commit already ran', async () => {
    paintBackground({ ...persisted, enabled: true })
    const view = renderRow()
    await screen.findByText('background.opacity')
    vi.useFakeTimers()
    try {
      const slider = document.querySelector('input[type="range"]') as HTMLInputElement
      fireEvent.input(slider, { target: { value: '0.5' } })
      fireEvent.pointerUp(slider)
      // Let the debounce elapse naturally: the gesture is fully committed.
      await vi.advanceTimersByTimeAsync(200)
      expect(settingsClient.save).toHaveBeenCalledTimes(1)
      view.unmount()
      await vi.advanceTimersByTimeAsync(200)
      // A fired timer must not look like an armed one — no second POST.
      expect(settingsClient.save).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
