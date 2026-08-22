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
 * The backdrop CSS. The wallpaper is a fixed \`z-index:-2\` element (below the
 * scrim at \`-1\`, below the UI). While active, the official surface tokens are
 * made transparent (so the wallpaper shows through every column) and the
 * opaque surfaces turn into translucent frosted glass. Selectors target
 * authored attributes (\`data-dsh-bg\`, \`data-composer-card\`, \`data-terminal\`…),
 * the \`:global\` \`.md-code-block\` anchor, \`role="menu"\`, and CSS-module SUFFIX
 * conventions (\`_bubble\`, \`_newSession\`…) — the stable anchors the reference
 * engine uses, since hashed prefixes change across shell rebuilds.
 */
export const BACKGROUND_CSS = `
  .dsh-bg-layer {
    position: fixed; inset: 0; z-index: -2; overflow: hidden; pointer-events: none;
  }
  .dsh-bg-layer .dsh-bg-image {
    width: 100%; height: 100%; display: block; border: 0; background: transparent;
    object-fit: var(--bg-object-fit, cover);
    opacity: var(--bg-opacity, 1);
    filter: blur(var(--bg-wallpaper-blur, 0px));
    /* Blur thins the edges; scale the image up to hide the fringe. */
    transform: scale(var(--bg-wallpaper-scale, 1));
    transform-origin: center;
  }
  /* Scrim is theme-aware: a WHITE veil in the light scheme (it lifts the art
     toward the near-white surface so dark text keeps contrast) and a BLACK veil
     in the dark scheme (it dims the art so light text keeps contrast). */
  .dsh-bg-scrim {
    position: fixed; inset: 0; z-index: -1; pointer-events: none;
    background: rgba(255, 255, 255, var(--bg-scrim, 0.25));
  }
  body[data-ds-dark-theme] .dsh-bg-scrim {
    background: rgba(0, 0, 0, var(--bg-scrim, 0.25));
  }

  /* Active: make the app frame + sidebar background transparent so all columns
     share the same wallpaper + scrim backdrop. */
  body[data-dsh-bg] {
    --dsw-alias-bg-base: transparent;
    --dsw-specific-sidebar-fill: transparent;
  }

  /* Frosted glass over every opaque surface. Fill translucency comes from the
     --dsw-* token overrides the painter writes onto body (theme-aware, driven
     by panelOpacity); this block adds the shared wet-glass sheen + blur from
     --bg-glass-blur. Exposure is calibrated per scheme (the painter writes
     --bg-glass-brightness / --bg-glass-sheen[-mid]): light glass slightly
     DIMS and wears a halved sheen — mainstream frosted recipes (macOS
     vibrancy, Windows acrylic, common web glass) never stack a positive
     brightness gain on the blur, and ours used to blow out on bright
     wallpapers; dark glass keeps the reference engine's slight lift.
     Coverage: composer card + message bubbles (authored anchors), code
     surfaces (.md-code-block and the data-* block cards, inline code, tool
     IO cards), every menu (role="menu"), dialogs/settings/dock panels and
     cards, and the chrome buttons (new session, plus, send, attachment rail,
     scroll-to-bottom, toasts). Suffix collisions audited — see
     docs/superpowers/specs/2026-08-22-universal-frosted-glass-design.md. */
  body[data-dsh-bg] [data-composer-card],
  body[data-dsh-bg] [class*="_bubble"],
  body[data-dsh-bg] .md-code-block,
  body[data-dsh-bg] [data-terminal],
  body[data-dsh-bg] [data-diff],
  body[data-dsh-bg] [data-read],
  body[data-dsh-bg] [data-search],
  body[data-dsh-bg] [data-web],
  body[data-dsh-bg] [class*="_ioCard"],
  body[data-dsh-bg] [class*="_markdown"] :not(pre) > code,
  body[data-dsh-bg] [role="menu"],
  body[data-dsh-bg] [class*="_dialog"],
  body[data-dsh-bg] [class*="_panel"],
  body[data-dsh-bg] [class*="_card"],
  body[data-dsh-bg] [class*="_bannerWrap"],
  body[data-dsh-bg] [class*="_buildRevision"],
  body[data-dsh-bg] [class*="_newSession"],
  body[data-dsh-bg] [class*="_add"],
  body[data-dsh-bg] [class*="_primary"],
  body[data-dsh-bg] [class$="_rail"],
  body[data-dsh-bg] [class*="_toBottom"],
  body[data-dsh-bg] [class*="_toast"],
  body[data-dsh-bg] [class*="_toolbar"] {
    background-image: linear-gradient(180deg, rgba(255, 255, 255, var(--bg-glass-sheen, 0.07)), rgba(255, 255, 255, var(--bg-glass-sheen-mid, 0.02)) 38%, rgba(255, 255, 255, 0.01));
    -webkit-backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
    backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, var(--bg-glass-highlight, 0.32)),
      inset 0 -1px 0 rgba(255, 255, 255, 0.08),
      inset 0 0 0 0.5px rgba(255, 255, 255, 0.08),
      0 12px 40px rgba(0, 0, 0, var(--bg-glass-shadow, 0.12));
  }

  /* The sticky code-block header officially occludes scrolled code with
     bg-base (transparent under a wallpaper): refill it with the banner token
     (itself translucent glass) so code stays hidden beneath the sticky bar. */
  body[data-dsh-bg] .md-code-block [class*="_bannerWrap"] {
    background-color: var(--dsw-alias-markdown-code-block-banner);
  }

  /* The sidebar build badge paints with the label-ink token — a TEXT token we
     must not override globally — so it gets a theme-aware translucent ink. */
  body[data-dsh-bg] [class*="_buildRevision"] {
    background-color: rgba(15, 17, 21, 0.62);
  }
  body[data-ds-dark-theme][data-dsh-bg] [class*="_buildRevision"] {
    background-color: rgba(249, 250, 251, 0.62);
  }

  /* HoverCard defines its own component-level ink (--dsw-hovercard-bg:
     #2C2C2E) on the card element — the one literal fill no token reaches.
     Re-scope that variable to the translucent ink on card-classed elements
     while the glass is active; only HoverCard consumes the variable, and it
     already carries the shared blur via the [_card] anchor above. */
  body[data-dsh-bg] [class*="_card"] {
    --dsw-hovercard-bg: rgba(44, 44, 46, 0.78);
  }

  /* The empty-state hero glow asset would wash out the wallpaper behind the
     welcome message — dim it so the art stays visible. */
  body[data-dsh-bg] [class*="_heroGlow"] {
    opacity: 0.2;
  }
`

/**
 * Inject the backdrop stylesheet once. Safe to call repeatedly; a second call
 * is a no-op (dedup key on the style tag).
 */
export function injectBackgroundCss(): void {
  if (document.querySelector(`style[data-plugin-css="${BACKGROUND_CSS_TAG}"]`)) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'deepseek-harness-background'
  tag.dataset.pluginCss = BACKGROUND_CSS_TAG
  tag.textContent = BACKGROUND_CSS
  document.head.appendChild(tag)
}
