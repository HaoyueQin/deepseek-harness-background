/** Durable background-image settings — pure constants/types shared by both halves. */

/** Settings namespace owned by the background-image plugin. */
export const BACKGROUND_SETTINGS_NAMESPACE = 'ui-background'

/** Minimum scrim opacity (0 = no veil at all). */
export const SCRIM_MIN = 0

/** Maximum scrim opacity (a nearly opaque veil keeps text legible over any art). */
export const SCRIM_MAX = 0.95

/** Default scrim strength applied over user art (a light readability veil). */
export const DEFAULT_SCRIM = 0.25

/** Default background image opacity (1 = fully opaque). */
export const DEFAULT_OPACITY = 1

/** Minimum background image opacity (0 = fully invisible). */
export const OPACITY_MIN = 0

/** Maximum background image opacity (1 = fully opaque). */
export const OPACITY_MAX = 1

/** Default background rendering mode. */
export const DEFAULT_FIT = 'cover'

/** Image positioning modes. `cover` fills the frame (cropping as needed); `contain` fits the whole image inside the frame (letterboxing). */
export const FIT_MODES = ['cover', 'contain'] as const

/** Background rendering mode. */
export type BackgroundFit = typeof FIT_MODES[number]

/** User-owned background section, resolved from schema defaults + user layer. */
export interface BackgroundSettings {
  /** Whether the custom background renders at all. */
  enabled: boolean
  /** Background image URL for the light color scheme. */
  lightUrl: string
  /** Background image URL for the dark color scheme. */
  darkUrl: string
  /** Background image opacity (0..1); the image fades toward the surface color. */
  opacity: number
  /** Readability scrim strength (0..1) layered between the art and the UI. */
  scrim: number
  /** How the image fits the frame. */
  fit: BackgroundFit
}
