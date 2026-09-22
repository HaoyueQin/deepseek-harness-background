/** Schema contract for the `ui-background` section: defaults and bounds drive
 * the settings row and the resolved value the browser paints.
 * A schemastery schema is callable — `schema(section)` resolves defaults and
 * validates (throwing on invalid input). Inputs are cast because defaults
 * make every partial section valid at runtime though the schema's input type
 * is the full section. */
import { describe, expect, it } from 'vitest'
import { BackgroundSettingsSchema, Config } from '../src/schema.ts'
import { BACKGROUND_SETTINGS_FIELDS, type BackgroundSettings } from '../src/settings.ts'

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

/**
 * dsh 0.1.7 keys a plugin's settings section on its profile entry and takes
 * the schema from the module's exported `Config`. Every field must sit under a
 * volatile node, or `settings.replace(entryId, section)` refuses the write
 * ("Config field ... is not volatile"). The wire schema stays unmarked: it is
 * also the 0.1.5/0.1.6 registration schema and the browser envelope.
 */
describe('Config (dsh 0.1.7 profile-entry schema)', () => {
  /** Unwrap one resolved field: the volatile view yields a `Volatile` per
   *  field, and this is the unwrapping `plainConfig` does before projecting. */
  function unwrap(value: unknown): unknown {
    if (value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function') {
      return (value as { get(): unknown }).get()
    }
    return value
  }

  /** The volatile view resolved to plain values. */
  function plain(section: Partial<BackgroundSettings>): Record<string, unknown> {
    const resolved = Config(section as BackgroundSettings) as unknown as Record<string, unknown>
    return Object.fromEntries(Object.entries(resolved).map(([key, value]) => [key, unwrap(value)]))
  }

  it('resolves the same section as the wire schema', () => {
    expect(plain({})).toEqual(BackgroundSettingsSchema({} as BackgroundSettings))
    expect(plain({ enabled: true, opacity: 0.4 }))
      .toEqual(BackgroundSettingsSchema({ enabled: true, opacity: 0.4 } as BackgroundSettings))
  })

  it('marks every field volatile, leaving the wire schema unmarked', () => {
    const configFields = Config.dict as Record<string, { meta: { volatile?: boolean } }>
    const wireFields = BackgroundSettingsSchema.dict as Record<string, { meta: { volatile?: boolean } }>
    for (const field of BACKGROUND_SETTINGS_FIELDS) {
      expect(configFields[field]?.meta.volatile, `${field} must be volatile`).toBe(true)
      expect(wireFields[field]?.meta.volatile, `${field} must stay plain`).toBeUndefined()
    }
  })
})
