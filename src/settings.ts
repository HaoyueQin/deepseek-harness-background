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
  'enabled', 'uploadId', 'url', 'darkUploadId', 'darkUrl', 'opacity', 'scrim',
  'panelOpacity', 'blur', 'wallpaperBlur', 'fit', 'offsetX', 'offsetY', 'timeline',
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

/** Default background rendering mode. */
export const DEFAULT_FIT = 'cover'

/** Image positioning modes. `cover` fills the frame (cropping as needed); `contain` fits the whole image inside the frame (letterboxing). */
export const FIT_MODES = ['cover', 'contain'] as const

/** Background rendering mode. */
export type BackgroundFit = typeof FIT_MODES[number]

/** Minimum framing offset (0 = flush to the left/top edge of the crop window). */
export const OFFSET_MIN = 0

/** Maximum framing offset (1 = flush to the right/bottom edge of the crop window). */
export const OFFSET_MAX = 1

/** Default framing offset — the image sits centered on both axes. */
export const DEFAULT_OFFSET = 0.5

/**
 * Which scheme's art to paint. Purely a render-time selector: both schemes'
 * sources live in the same section.
 */
export type BackgroundScheme = 'light' | 'dark'

/** The raw source of one scheme's OWN slot (no fallback). */
function ownSourceUrl(settings: BackgroundSettings, uploadBase: string, scheme: BackgroundScheme): string {
  const uploadId = scheme === 'dark' ? settings.darkUploadId : settings.uploadId
  if (uploadId !== '') return `${uploadBase}/image/${uploadId}`
  return scheme === 'dark' ? settings.darkUrl : settings.url
}

/**
 * Resolve the effective image url for one scheme, falling back to the other
 * scheme's art when this one has none of its own.
 * @param settings - resolved background section.
 * @param uploadBase - the API base used to turn an upload id into a url.
 * @param scheme - the scheme whose art should paint.
 * @returns the image url, or '' when neither slot has a source.
 */
export function backgroundSourceUrl(
  settings: BackgroundSettings,
  uploadBase: string,
  scheme: BackgroundScheme,
): string {
  const own = ownSourceUrl(settings, uploadBase, scheme)
  if (own !== '') return own
  // No art for this scheme: reuse the other scheme's image so the frame is
  // never left empty while the section still holds a picture.
  return ownSourceUrl(settings, uploadBase, scheme === 'dark' ? 'light' : 'dark')
}

/**
 * Whether one scheme's OWN slot carries art (never counting the fallback).
 * @param settings - resolved background section.
 * @param scheme - the scheme to test.
 */
export function hasOwnSource(settings: BackgroundSettings, scheme: BackgroundScheme): boolean {
  return scheme === 'dark'
    ? settings.darkUploadId !== '' || settings.darkUrl !== ''
    : settings.uploadId !== '' || settings.url !== ''
}

/**
 * Whether the section carries any art at all (either slot).
 * @param settings - resolved background section.
 */
export function hasAnySource(settings: BackgroundSettings): boolean {
  return hasOwnSource(settings, 'light') || hasOwnSource(settings, 'dark')
}

/**
 * User-owned background section, resolved from schema defaults + user layer.
 *
 * The wallpaper is a LIGHT/DARK pair. Each scheme carries its own source, and
 * a source is either a local upload id (host serves it via
 * `/api/bg-wallpaper/image/<id>`) or a raw HTTP(S) image URL the browser
 * loads; within one scheme exactly one of the id/url pair is set.
 *
 * The pair degrades gracefully in BOTH directions: a scheme with no art of
 * its own falls back to the other scheme's art. A pre-0.7 section (light art
 * only) therefore keeps its single image in either scheme — the dark slot is
 * purely opt-in — and a dark-only section still paints something in light
 * mode instead of handing the shell a transparent frame over a bare page. Only
 * when BOTH pairs are empty does no background render.
 *
 * Everything else (opacity, scrim, glass, fit, framing) is shared by the two
 * schemes — the pair only swaps the art.
 */
export interface BackgroundSettings {
  /** Whether the custom background renders at all. */
  enabled: boolean
  /** Local upload id when the active source is an uploaded file. */
  uploadId: string
  /** Image URL when the active source is a remote URL. */
  url: string
  /** Dark-scheme local upload id; empty means "follow the light image". */
  darkUploadId: string
  /** Dark-scheme remote image URL; empty means "follow the light image". */
  darkUrl: string
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
  /**
   * Horizontal framing (0..1; 0.5 = centered). Maps to the CSS
   * `object-position` x — it only has a visible effect under `cover` when the
   * image is cropped horizontally (a portrait source in a landscape frame).
   */
  offsetX: number
  /**
   * Vertical framing (0..1; 0.5 = centered). Maps to the CSS
   * `object-position` y — it only has a visible effect under `cover` when the
   * image is cropped vertically (a landscape source in a portrait frame).
   */
  offsetY: number
  /** Whether the conversation timeline rail renders at the right edge. */
  timeline: boolean
}
