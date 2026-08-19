// @vitest-environment jsdom
/**
 * Settings row surface contract: renders the preview card, the stepped
 * sliders (5% snap for ratios), and defers persistence to gesture release —
 * the previous implementation saved on every onChange tick, which made the
 * slider janky. The transport fetch is mocked; the row renders with React.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { paintBackground } from '../src/client/backdrop.ts'
import { BackgroundSettingsRow } from '../src/client/SettingsRow.tsx'
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

/** In-memory store the mock fetch reads/writes. */
let persisted: BackgroundSettings = { ...SECTION }

const t = (key: string): string => key

beforeEach(() => {
  persisted = { ...SECTION }
  settingsClient.load = vi.fn(async () => {
    ;(settingsClient as unknown as { snapshot: unknown }).snapshot = { status: 'ready', value: { ...persisted } }
  })
  settingsClient.save = vi.fn(async (section: BackgroundSettings) => {
    persisted = { ...section }
    ;(settingsClient as unknown as { snapshot: unknown }).snapshot = { status: 'ready', value: { ...section } }
    return true
  })
  settingsClient.upload = vi.fn(async () => null)
  void settingsClient.load()
})

afterEach(() => {
  cleanup()
  document.body.removeAttribute('data-dsh-bg')
  document.body.style.cssText = ''
  vi.restoreAllMocks()
})

function renderRow(): void {
  render(<BackgroundSettingsRow t={t} />)
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

  it('snaps ratio sliders to 5% steps and px sliders to coarse steps', async () => {
    renderRow()
    await screen.findByText('background.opacity')
    const ranges = document.querySelectorAll('input[type="range"]') as NodeListOf<HTMLInputElement>
    const spec = Object.fromEntries(
      [...ranges].map((r) => [r.getAttribute('aria-label'), r.step]),
    )
    expect(spec['background.opacity']).toBe('0.05')
    expect(spec['background.scrim']).toBe('0.05')
    expect(spec['background.panelOpacity']).toBe('0.05')
    expect(spec['background.blur']).toBe('2')
    expect(spec['background.wallpaperBlur']).toBe('5')
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
})
