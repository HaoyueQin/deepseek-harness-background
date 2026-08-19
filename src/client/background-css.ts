/**
 * Background CSS — the stylesheet injected once into the document when the
 * plugin first runs. It defines the behind-body wallpaper layer, the scrim,
 * and the frosted-glass panels, all driven by CSS variables the painter writes
 * onto `document.body`. Kept in a single idempotent `<style data-plugin-css>`
 * tag (mirrors the reference `dsh-wallpaper-engine` bundle).
 */

/** Unique id stamped on the injected style element (dedup key). */
export const BACKGROUND_CSS_TAG = 'deepseek-harness-background/styles'

/** Body attribute the painter sets while a wallpaper is active. */
export const ACTIVE_ATTR = 'data-dsh-bg'

/**
 * The backdrop CSS. The wallpaper is a fixed `z-index:-2` element (below the
 * scrim at `-1`, below the UI). While active, the official surface tokens are
 * made transparent (so the wallpaper shows through every column) and the
 * opaque input / bubble surfaces turn into translucent frosted glass.
 * Selectors target authored attributes (`data-dsh-bg`, `data-composer-card`)
 * and CSS-module SUFFIX conventions (`_bubble`) — the same stable anchors the
 * reference engine uses, since hashed prefixes change across shell rebuilds.
 */
export const BACKGROUND_CSS = `
  .dsh-bg-layer {
    position: fixed; inset: 0; z-index: -2; overflow: hidden; pointer-events: none;
  }
  .dsh-bg-layer .dsh-bg-image {
    width: 100%; height: 100%; display: block; border: 0; background: transparent;
    object-fit: var(--bg-object-fit, cover);
    filter: blur(var(--bg-wallpaper-blur, 0px));
    /* Blur thins the edges; scale the image up to hide the fringe. */
    transform: scale(var(--bg-wallpaper-scale, 1));
    transform-origin: center;
  }
  .dsh-bg-scrim {
    position: fixed; inset: 0; z-index: -1; pointer-events: none;
    background: rgba(0, 0, 0, var(--bg-scrim, 0.25));
  }

  /* Active: make the app frame + sidebar background transparent so all columns
     share the same wallpaper + scrim backdrop. */
  body[data-dsh-bg] {
    --dsw-alias-bg-base: transparent;
    --dsw-specific-sidebar-fill: transparent;
  }

  /* Frosted glass over the opaque conversation surfaces (composer + bubbles).
     The surface translucency is driven by --dsw-specific-input-major /
     --dsw-specific-bubble, which the painter writes (theme-aware) so that a
     fully-opaque panel restores the official surfaces. The blur here comes
     from --bg-glass-blur; a faint top-weighted specular sheen makes the
     translucent surfaces read as wet glass. */
  body[data-dsh-bg] [data-composer-card],
  body[data-dsh-bg] [class*="_bubble"] {
    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.05) 38%, rgba(255, 255, 255, 0.02));
    -webkit-backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.6)) brightness(var(--bg-glass-brightness, 1.04)) contrast(1.01);
    backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.6)) brightness(var(--bg-glass-brightness, 1.04)) contrast(1.01);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, var(--bg-glass-highlight, 0.32)),
      inset 0 -1px 0 rgba(255, 255, 255, 0.08),
      inset 0 0 0 0.5px rgba(255, 255, 255, 0.08),
      0 12px 40px rgba(0, 0, 0, var(--bg-glass-shadow, 0.12));
  }
`

/**
 * Inject the backdrop stylesheet once. Safe to call repeatedly; a second call
 * is a no-op (dedup key on the style tag).
 */
export function injectBackgroundCss(doc: Document = document): void {
  if (doc === undefined) return
  if (doc.querySelector(`style[data-plugin-css="${BACKGROUND_CSS_TAG}"]`)) return
  const tag = doc.createElement('style')
  tag.dataset.plugin = 'deepseek-harness-background'
  tag.dataset.pluginCss = BACKGROUND_CSS_TAG
  tag.textContent = BACKGROUND_CSS
  doc.head.appendChild(tag)
}
