/** Host-side schema for the `ui-background` settings namespace. */

import z from '@deepseek-ai/schemastery'
import {
  BACKGROUND_SETTINGS_NAMESPACE, BLUR_MAX, BLUR_MIN, DEFAULT_BLUR,
  DEFAULT_FIT, DEFAULT_OPACITY, DEFAULT_PANEL_OPACITY, DEFAULT_SCRIM,
  DEFAULT_WALLPAPER_BLUR, FIT_MODES, OPACITY_MAX, OPACITY_MIN,
  PANEL_OPACITY_MAX, PANEL_OPACITY_MIN, SCRIM_MAX, SCRIM_MIN,
  WALLPAPER_BLUR_MAX, type BackgroundFit, type BackgroundSettings,
} from './settings.ts'

export {
  BACKGROUND_SETTINGS_NAMESPACE, DEFAULT_FIT, DEFAULT_OPACITY, DEFAULT_PANEL_OPACITY,
  DEFAULT_SCRIM, FIT_MODES, OPACITY_MAX, OPACITY_MIN, SCRIM_MAX, SCRIM_MIN,
  type BackgroundFit, type BackgroundSettings,
} from './settings.ts'

/**
 * Durable background section; also the wire envelope the browser scope
 * validates against. `uploadId` and `url` name the two exclusive sources; the
 * schema stays structural (no trim/transform — a function callback would break
 * the schema's toJSON wire serialization).
 */
export const BackgroundSettingsSchema: z<BackgroundSettings> = z.object({
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
})
