/** Schema contract for the `ui-background` section: defaults and bounds drive
 * the settings row and the resolved value the browser paints.
 * A schemastery schema is callable — `schema(section)` resolves defaults and
 * validates (throwing on invalid input). Inputs are cast because defaults
 * make every partial section valid at runtime though the schema's input type
 * is the full section. */
import { describe, expect, it } from 'vitest'
import { BackgroundSettingsSchema } from '../src/schema.ts'
import type { BackgroundSettings } from '../src/settings.ts'

/** Resolve one (possibly partial) user section through the schema. */
function resolve(section: object): BackgroundSettings {
  return BackgroundSettingsSchema(section as BackgroundSettings)
}

describe('ui-background schema', () => {
  it('resolves defaults for an empty section', () => {
    expect(resolve({})).toEqual({
      enabled: false,
      uploadId: '',
      url: '',
      opacity: 1,
      scrim: 0.25,
      panelOpacity: 0.15,
      blur: 16,
      wallpaperBlur: 0,
      fit: 'cover',
      timeline: true,
    })
  })

  it('accepts a full valid section (upload source)', () => {
    expect(resolve({
      enabled: true,
      uploadId: 'up-abc123',
      url: '',
      opacity: 0.6,
      scrim: 0.6,
      panelOpacity: 0.4,
      blur: 20,
      wallpaperBlur: 5,
      fit: 'contain',
      timeline: false,
    })).toEqual({
      enabled: true,
      uploadId: 'up-abc123',
      url: '',
      opacity: 0.6,
      scrim: 0.6,
      panelOpacity: 0.4,
      blur: 20,
      wallpaperBlur: 5,
      fit: 'contain',
      timeline: false,
    })
  })

  it('accepts a URL source with empty uploadId', () => {
    const resolved = resolve({ enabled: true, url: 'https://example.com/a.jpg', uploadId: '' })
    expect(resolved.url).toBe('https://example.com/a.jpg')
    expect(resolved.uploadId).toBe('')
  })

  it('accepts empty urls and rejects out-of-range scrim, opacity, panelOpacity, blur, or fit', () => {
    expect(resolve({ url: '' }).url).toBe('')
    expect(() => resolve({ scrim: 1.2 })).toThrow()
    expect(() => resolve({ opacity: 1.5 })).toThrow()
    expect(() => resolve({ panelOpacity: 1.2 })).toThrow()
    expect(() => resolve({ blur: 100 })).toThrow()
    expect(() => resolve({ fit: 'stretch' as BackgroundSettings['fit'] })).toThrow()
    expect(() => resolve({ timeline: 'yes' as unknown as boolean })).toThrow()
  })

  it('accepts every numeric bound exactly at its edge', () => {
    const resolved = resolve({ scrim: 0.95, opacity: 1, panelOpacity: 1, blur: 40, wallpaperBlur: 60 })
    expect(resolved.scrim).toBe(0.95)
    expect(resolved.opacity).toBe(1)
    expect(resolved.panelOpacity).toBe(1)
    expect(resolved.blur).toBe(40)
    expect(resolved.wallpaperBlur).toBe(60)
  })
})
