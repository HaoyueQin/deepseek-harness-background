/** Durable background settings — pure constants/types shared by both halves. */

/** Settings namespace owned by the background plugin. */
export const BACKGROUND_SETTINGS_NAMESPACE = 'ui-background'

/**
 * The schema's field names, in schema order. Used as a whitelist when a
 * section write commits: the settings layer keeps unknown keys in the user
 * document (a legacy schema field would linger forever under a merge-only
 * write), so the write path strips everything outside this list.
 */
export const BACKGROUND_SETTINGS_FIELDS = [
  'enabled', 'uploadId', 'url', 'opacity', 'scrim',
  'panelOpacity', 'blur', 'wallpaperBlur', 'fit', 'timeline',
] as const

/** Browser-facing base path of the background API (shared with the host routes). */
export const BACKGROUND_API_PREFIX = '/api/bg-wallpaper'

/** Minimum scrim opacity (0 = no veil at all). */
export const SCRIM_MIN = 0

/** Maximum scrim opacity (1 = fully opaque veil — hides the wallpaper entirely).
 * Kept at 1 so every percent-unit slider shares one 0..1 domain: the same
 * displayed percentage puts every thumb at the same fraction of its track. */
export const SCRIM_MAX = 1

/** Default scrim strength applied over user art (a light readability veil). */
export const DEFAULT_SCRIM = 0.25

/** Default background image opacity (1 = fully opaque). */
export const DEFAULT_OPACITY = 1

/** Minimum background image opacity (0 = fully invisible). */
export const OPACITY_MIN = 0

/** Maximum background image opacity (1 = fully opaque). */
export const OPACITY_MAX = 1

/** Default panel opacity (0..1); 1 = fully opaque official surfaces, 0 = fully transparent glass. */
export const DEFAULT_PANEL_OPACITY = 0.15

/** Minimum panel opacity. */
export const PANEL_OPACITY_MIN = 0

/** Maximum panel opacity (opaque — effectively disables the glass). */
export const PANEL_OPACITY_MAX = 1

/** Default frosted-glass blur radius in px (0 disables backdrop-filter). */
export const DEFAULT_BLUR = 16

/** Minimum glass blur radius. */
export const BLUR_MIN = 0

/** Maximum glass blur radius. */
export const BLUR_MAX = 40

/** Default wallpaper blur radius in px (blurs the image itself). */
export const DEFAULT_WALLPAPER_BLUR = 0

/** Maximum wallpaper blur radius. */
export const WALLPAPER_BLUR_MAX = 60

/** Whether the DeepSeek-style conversation timeline rail renders (default on). */
export const DEFAULT_TIMELINE = true

/**
 * Session-projection key this plugin owns in the client-visible value map —
 * the host fold registers it (src/projection.ts) and the rail reads it
 * (src/client/timeline.tsx); one shared constant so the two can never drift.
 */
export const TIMELINE_PROJECTION_KEY = 'bgTimeline'

/** Default background rendering mode. */
export const DEFAULT_FIT = 'cover'

/** Image positioning modes. `cover` fills the frame (cropping as needed); `contain` fits the whole image inside the frame (letterboxing). */
export const FIT_MODES = ['cover', 'contain'] as const

/** Background rendering mode. */
export type BackgroundFit = typeof FIT_MODES[number]

/**
 * User-owned background section, resolved from schema defaults + user layer.
 * The active source is either a local upload id (host serves it via
 * `/api/bg-wallpaper/image/<id>`) or a raw HTTP(S) image URL the browser
 * loads; exactly one of `uploadId` / `url` is set — when both are empty no
 * background renders.
 */
export interface BackgroundSettings {
  /** Whether the custom background renders at all. */
  enabled: boolean
  /** Local upload id when the active source is an uploaded file. */
  uploadId: string
  /** Image URL when the active source is a remote URL. */
  url: string
  /** Background image opacity (0..1); the image fades toward the surface color. */
  opacity: number
  /** Readability scrim strength (0..1) layered between the art and the UI. */
  scrim: number
  /** Panel transparency (0..1): 0 = fully transparent surfaces, 1 = unaffected. */
  panelOpacity: number
  /** Frosted-glass blur radius on opaque surfaces (px; 0 disables). */
  blur: number
  /** Blur of the wallpaper image itself (px; 0 disables). */
  wallpaperBlur: number
  /** How the image fits the frame. */
  fit: BackgroundFit
  /** Whether the conversation timeline rail renders at the right edge. */
  timeline: boolean
}
