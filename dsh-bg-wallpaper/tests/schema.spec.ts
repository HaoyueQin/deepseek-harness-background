/** Schema contract for the `ui-background` section: defaults and bounds drive
 * the plugin-configuration form and the resolved value the browser paints.
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
      lightUrl: '',
      darkUrl: '',
      opacity: 1,
      scrim: 0.25,
      fit: 'cover',
    })
  })

  it('accepts a full valid section', () => {
    expect(resolve({
      enabled: true,
      lightUrl: 'https://example.com/l.jpg',
      darkUrl: 'https://example.com/d.jpg',
      opacity: 0.6,
      scrim: 0.6,
      fit: 'contain',
    })).toEqual({
      enabled: true,
      lightUrl: 'https://example.com/l.jpg',
      darkUrl: 'https://example.com/d.jpg',
      opacity: 0.6,
      scrim: 0.6,
      fit: 'contain',
    })
  })

  it('accepts an empty url string and rejects out-of-range scrim, opacity, or fit', () => {
    expect(resolve({ lightUrl: '' }).lightUrl).toBe('')
    expect(() => resolve({ scrim: 1.2 })).toThrow()
    expect(() => resolve({ opacity: 1.5 })).toThrow()
    expect(() => resolve({ fit: 'stretch' as BackgroundSettings['fit'] })).toThrow()
  })
})
