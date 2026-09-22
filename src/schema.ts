/** Host-side schema for the `ui-background` settings namespace. */

import z from '@deepseek-ai/schemastery'
import {
  BACKGROUND_SETTINGS_NAMESPACE, BLUR_MAX, BLUR_MIN, DEFAULT_BLUR,
  DEFAULT_FIT, DEFAULT_OPACITY, DEFAULT_PANEL_OPACITY, DEFAULT_SCRIM,
  DEFAULT_TIMELINE, DEFAULT_WALLPAPER_BLUR, FIT_MODES, OPACITY_MAX, OPACITY_MIN,
  PANEL_OPACITY_MAX, PANEL_OPACITY_MIN, SCRIM_MAX, SCRIM_MIN,
  WALLPAPER_BLUR_MAX, type BackgroundFit, type BackgroundSettings,
} from './settings.ts'

export {
  BACKGROUND_SETTINGS_NAMESPACE, DEFAULT_FIT, DEFAULT_OPACITY, DEFAULT_PANEL_OPACITY,
  DEFAULT_SCRIM, DEFAULT_TIMELINE, FIT_MODES, OPACITY_MAX, OPACITY_MIN, SCRIM_MAX, SCRIM_MIN,
  type BackgroundFit, type BackgroundSettings,
} from './settings.ts'

/**
 * The section's fields, in schema order — ONE definition feeding both
 * generations. Field schemas are immutable builders (`volatile()` clones),
 * so deriving the volatile view below leaves this one unmarked.
 */
const BackgroundSettingsFields = {
  enabled: z.boolean().default(false),
  /** Content-addressed local upload id or empty. */
  uploadId: z.string().default(''),
  /** Image URL or empty (mutually exclusive with uploadId at runtime). */
  url: z.string().default(''),
  opacity: z.number().min(OPACITY_MIN).max(OPACITY_MAX).default(DEFAULT_OPACITY),
  scrim: z.number().min(SCRIM_MIN).max(SCRIM_MAX).default(DEFAULT_SCRIM),
  panelOpacity: z.number().min(PANEL_OPACITY_MIN).max(PANEL_OPACITY_MAX).default(DEFAULT_PANEL_OPACITY),
  blur: z.number().min(BLUR_MIN).max(BLUR_MAX).default(DEFAULT_BLUR),
  wallpaperBlur: z.number().min(BLUR_MIN).max(WALLPAPER_BLUR_MAX).default(DEFAULT_WALLPAPER_BLUR),
  fit: z.union([...FIT_MODES]).default(DEFAULT_FIT),
  timeline: z.boolean().default(DEFAULT_TIMELINE),
}

/**
 * Durable background section; also the wire envelope the browser scope
 * validates against and the namespace schema registered on dsh 0.1.5/0.1.6.
 * `uploadId` and `url` name the two exclusive sources; the schema stays
 * structural (no trim/transform — a function callback would break the
 * schema's toJSON wire serialization).
 */
export const BackgroundSettingsSchema: z<BackgroundSettings> = z.object(BackgroundSettingsFields)

/** The same fields, each marked volatile (the marker is cloned, so the plain
 *  view above stays unmarked). */
function volatileFields<T extends Record<string, z>>(fields: T): T {
  return Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [key, field.volatile()]),
  ) as T
}

/**
 * The plugin's live configuration as dsh 0.1.7+ reads it: the settings
 * service projects each active profile entry's exported `Config` into a form
 * and keys the section on the entry id. Every field is volatile — "editable
 * without remounting" — which is exactly what a wholesale
 * `settings.replace(entryId, section)` demands of each written path
 * (`isVolatilePath` walks to a volatile ancestor or refuses the write).
 *
 * The wire schema above stays unmarked: it is also the 0.1.5/0.1.6
 * registration schema, where `volatile` has no meaning.
 */
export const Config: z<BackgroundSettings> = z.object(volatileFields(BackgroundSettingsFields))
