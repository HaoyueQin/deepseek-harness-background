/**
 * Shared backdrop rendering: one pure function produces the `background-image`
 * value the painter and the settings-card preview both use, so what the user
 * previews is exactly what the app paints.
 */

import type { BackgroundSettings } from '../settings.ts'

/**
 * Compose the layered background-image value for one resolved section.
 * @param settings - resolved background section.
 * @param dark - whether the dark color scheme is active.
 * @returns a CSS `background-image` value (multiple comma-separated layers).
 */
export function backdropImage(settings: BackgroundSettings, dark: boolean): string {
  // Theme-matched flat gradients: the surface color at `1 - opacity` fades
  // the image toward the surface, then the readability veil at `scrim`.
  const surface = dark ? '0, 0, 0' : '255, 255, 255'
  const veil = dark ? '0, 0, 0' : '255, 255, 255'
  const url = dark ? settings.darkUrl : settings.lightUrl
  return [
    `linear-gradient(rgba(${surface}, ${1 - settings.opacity}) 0%, rgba(${surface}, ${1 - settings.opacity}) 100%)`,
    `linear-gradient(rgba(${veil}, ${settings.scrim}) 0%, rgba(${veil}, ${settings.scrim}) 100%)`,
    `url(${url})`,
  ].join(', ')
}
