/** Host-side schema for the `ui-background` settings namespace. */

import z from '@deepseek-ai/schemastery'
import {
  BACKGROUND_SETTINGS_NAMESPACE, DEFAULT_FIT, DEFAULT_OPACITY, DEFAULT_SCRIM,
  FIT_MODES, OPACITY_MAX, OPACITY_MIN, SCRIM_MAX, SCRIM_MIN,
  type BackgroundSettings,
} from './settings.ts'

export {
  BACKGROUND_SETTINGS_NAMESPACE, DEFAULT_FIT, DEFAULT_OPACITY, DEFAULT_SCRIM,
  FIT_MODES, OPACITY_MAX, OPACITY_MIN, SCRIM_MAX, SCRIM_MIN,
  type BackgroundFit, type BackgroundSettings,
} from './settings.ts'

/**
 * Durable background section; also the wire envelope the browser scope
 * validates against. URLs are free strings (remote http(s) or any URL the
 * browser can load); the schema stays structural (no trim/transform — a
 * function callback would break the schema's toJSON wire serialization).
 */
export const BackgroundSettingsSchema: z<BackgroundSettings> = z.object({
  enabled: z.boolean().default(false),
  lightUrl: z.string().default(''),
  darkUrl: z.string().default(''),
  opacity: z.number().min(OPACITY_MIN).max(OPACITY_MAX).default(DEFAULT_OPACITY),
  scrim: z.number().min(SCRIM_MIN).max(SCRIM_MAX).default(DEFAULT_SCRIM),
  fit: z.union([...FIT_MODES]).default(DEFAULT_FIT),
})
