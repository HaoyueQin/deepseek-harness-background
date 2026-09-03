/**
 * Background CSS — the stylesheet injected once into the document when the
 * plugin first runs. It defines the behind-body wallpaper layer, the scrim,
 * and the frosted-glass surfaces, all driven by CSS variables the painter
 * writes onto `document.body`. Kept in a single idempotent
 * `<style data-plugin-css>` tag (mirrors the reference `dsh-wallpaper-engine`
 * bundle).
 */

/** Unique id stamped on the injected style element (dedup key). */
export const BACKGROUND_CSS_TAG = 'deepseek-harness-background/styles'

/** Body attribute the painter sets while a wallpaper is active. */
export const ACTIVE_ATTR = 'data-dsh-bg'

/**
 * Body attribute the painter sets only while the glass is actually on (a
 * wallpaper is active AND panelOpacity < 1). The explicit-fill rules below —
 * whitelisted buttons, popovers and badges whose official fills are not
 * token-mediated — key on this gate so they return to the exact official
 * paints when the user maxes the panel-opacity slider.
 */
export const GLASS_ATTR = 'data-dsh-bg-glass'

/**
 * The backdrop CSS. The wallpaper is a fixed `z-index:-2` element (below the
 * scrim at `-1`, below the UI). While active, the app frame + sidebar fills
 * turn transparent so all columns share one backdrop.
 *
 * Frosted glass is a WHITELIST, not a blanket: only the surfaces that float
 * as small cards/buttons over the wallpaper are glassed — composer card,
 * message bubbles, code surfaces (blocks, inline code, tool IO cards,
 * skill/MCP call cards), the three chrome buttons (new session, composer +
 * button, scroll-to-bottom), the load-earlier history button, the composer
 * dock family (agent task strips: TodoPanel / GoalBar / QueueDock) and its
 * takeover panels (approval, question, plan review), the subagent lineage
 * popover, the home hero "preview" badge, the sidebar build badge, and the
 * timeline rail (the official-rail rules below).
 * Every glassed surface shares ONE recipe:
 * fill from the painter's --dsw-specific-input-major token (same alpha
 * curve + theme dimming), the full shared blur/saturate/brightness chain
 * driven by the glass-blur slider, and the shared sheen vars — so no
 * surface reads heavier than the composer card. Dialogs, the settings UI,
 * menus, tooltips, toasts and every hover/accent fill keep the OFFICIAL
 * opaque paints — they are reading surfaces and must stay legible.
 *
 * Selectors target authored attributes (`data-dsh-bg`, `data-composer-card`,
 * `data-terminal`…), the `:global` `.md-code-block` anchor, and CSS-module
 * SUFFIX conventions (`_bubble`, `_newSession`…) audited for collisions.
 *
 * MAINTENANCE NOTE: the suffix anchors are the host's only stable-enough
 * integration surface today, but a host restyle that renames them silently
 * drops the glass. Upgrade path: once the host ships stable data-* anchors
 * for these surfaces, swap the selector lists below to them and delete the
 * suffix entries.
 * `_bubble` excludes `role="tooltip"` (Tooltip.module.css shares the suffix),
 * `_add` is scoped under `[data-composer-card]` (DiffBlock line markers share
 * it), `_newSession` excludes `Label` (the button's inner label span) and
 * `_toBottom` excludes `Slot` (the zero-height sticky wrapper) — both share
 * the substring with the chrome control but must keep their own paint, and
 * the subagent popover is `role="tree"` + `_menu` so the generic menu
 * surface stays untouched.
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

  /* ---- Whitelisted frosted-glass sheet ---------------------------------
     Fills come from the --dsw-* tokens the painter overrides on body ONLY for
     this list's own surfaces (input/bubble/code/tip); this block adds the
     shared wet-glass sheen + blur from --bg-glass-blur. Exposure is calibrated
     per scheme (the painter writes --bg-glass-brightness / --bg-glass-sheen):
     light glass slightly DIMS, dark glass keeps a slight lift. Gated on the
     GLASS ATTR (wallpaper active AND panelOpacity < 1): maxing the panel
     slider returns these surfaces to the exact official paints. */
  body[data-dsh-bg-glass] [data-composer-card],
  body[data-dsh-bg-glass] [class*="_bubble"]:not([role="tooltip"]),
  /* The read_image toolview (dsh >= 0.1.2-rc.1 ToolRow) collapses its result
     into an image body card; glass it like the other content blocks. */
  body[data-dsh-bg-glass] [class*="_imageBody"],
  body[data-dsh-bg-glass] .md-code-block,
  body[data-dsh-bg-glass] [data-terminal],
  body[data-dsh-bg-glass] [data-diff],
  body[data-dsh-bg-glass] [data-read],
  body[data-dsh-bg-glass] [data-search],
  body[data-dsh-bg-glass] [data-web],
  body[data-dsh-bg-glass] [class*="_ioCard"],
  body[data-dsh-bg-glass] [class*="_instructionsCard"],
  body[data-dsh-bg-glass] [class*="_markdown"] :not(pre) > code {
    background-image: linear-gradient(180deg, rgba(255, 255, 255, var(--bg-glass-sheen, 0.07)), rgba(255, 255, 255, var(--bg-glass-sheen-mid, 0.02)) 38%, rgba(255, 255, 255, 0.01));
    -webkit-backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
    backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.32),
      inset 0 -1px 0 rgba(255, 255, 255, 0.08),
      inset 0 0 0 0.5px rgba(255, 255, 255, 0.08),
      0 12px 40px rgba(0, 0, 0, 0.12);
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

  /* The empty-state hero glow asset would wash out the wallpaper behind the
     welcome message — dim it so the art stays visible. */
  body[data-dsh-bg] [class*="_heroGlow"] {
    opacity: 0.2;
  }

  /* ---- Whitelisted chrome buttons --------------------------------------
     These three buttons' official fills ride button-* tokens shared with
     unrelated surfaces, so instead of overriding the tokens they get explicit
     paints — but the SAME glass recipe as the composer card and bubbles:
     fill = the painter's --dsw-specific-input-major token (the identical
     translucent white + theme curve), filter = the sheet's exact
     blur/saturate/brightness chain (blur follows the glass-blur slider, no
     caps), sheen = the shared sheen vars. Hover = the same white glass at the
     boosted alpha var. Gated on data-dsh-bg-glass (off when the panel is
     fully opaque). */
  body[data-dsh-bg-glass] [class*="_newSession"]:not([class*="Label"]),
  body[data-dsh-bg-glass] [data-composer-card] [class*="_add"],
  body[data-dsh-bg-glass] [class*="_toBottom"]:not([class*="Slot"]) {
    background-color: var(--dsw-specific-input-major);
    background-image: linear-gradient(180deg, rgba(255, 255, 255, var(--bg-glass-sheen, 0.07)), rgba(255, 255, 255, var(--bg-glass-sheen-mid, 0.02)) 38%, rgba(255, 255, 255, 0.01));
    -webkit-backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
    backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.32),
      inset 0 0 0 0.5px rgba(255, 255, 255, 0.12),
      0 4px 14px rgba(0, 0, 0, 0.08);
  }
  body[data-dsh-bg-glass] [class*="_newSession"]:not([class*="Label"]):hover,
  body[data-dsh-bg-glass] [data-composer-card] [class*="_add"]:hover:not(:disabled),
  body[data-dsh-bg-glass] [class*="_toBottom"]:not([class*="Slot"]):hover {
    background-color: color-mix(in srgb, rgb(255 255 255) calc(var(--bg-glass-alpha-strong, 0.8) * 100%), transparent);
  }
  /* Collapsed rail renders the new-session control as a bare icon — keep the
     official transparent paint (and its official translucent hover). */
  body[data-dsh-bg-glass] [class*="_collapsed"] [class*="_newSession"],
  body[data-dsh-bg-glass] [class*="_collapsed"] [class*="_newSession"]:hover {
    background-color: transparent;
    background-image: none;
    box-shadow: none;
  }

  /* ---- Subagent lineage popover (title-bar expanded list) --------------
     Its official fill rides the menu token shared with every dropdown; glass
     THIS popover explicitly via its role="tree" + _menu combination so real
     menus stay officially opaque and legible. Same unified recipe: the
     composer fill token + the full shared filter chain (the official
     elevation shadow stays). */
  body[data-dsh-bg-glass] [role="tree"][class*="_menu"] {
    background-color: var(--dsw-specific-input-major);
    background-image: linear-gradient(180deg, rgba(255, 255, 255, var(--bg-glass-sheen, 0.07)), rgba(255, 255, 255, var(--bg-glass-sheen-mid, 0.02)) 38%, rgba(255, 255, 255, 0.01));
    -webkit-backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
    backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
  }

  /* ---- Home hero "preview" badge (top-right superscript pill) ----------
     Officially the state-business-tertiary pastel; re-emit the same hue as
     glass but with the UNIFIED alpha curve (color-mix against the painter's
     --bg-glass-alpha) and the shared blur chain, so it sits on the wallpaper
     with exactly the glass strength of the composer card. */
  body[data-dsh-bg-glass] [class*="_previewBadge"] {
    background-color: color-mix(in srgb, rgb(228 237 253) calc(var(--bg-glass-alpha, 0.72) * 100%), transparent);
    -webkit-backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
    backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
  }
  body[data-ds-dark-theme][data-dsh-bg-glass] [class*="_previewBadge"] {
    background-color: color-mix(in srgb, rgb(52 65 91) calc(var(--bg-glass-alpha, 0.72) * 100%), transparent);
  }

  /* ---- Composer dock family: task strips + takeover panels --------------
     The agent task strips (TodoPanel, GoalBar, QueueDock — one dock column
     above the composer) and the composer takeovers (approval, question,
     plan review) paint with tokens the painter turns translucent
     (--dsw-specific-tip / --dsw-specific-input-major) but their own styles
     never blur anything: translucent-without-blur reads as bare
     transparency, not frosted glass. Give each the shared sheen + filter
     chain; their fills stay token-driven so the panel-opacity slider keeps
     driving them. Anchors are the components' own stable data attributes
     plus a structural child, so no generic class suffix is swept in. */
  body[data-dsh-bg-glass] [data-testid="todo-panel"],
  body[data-dsh-bg-glass] [data-goal-bar] > div,
  body[data-dsh-bg-glass] [data-queue-dock] > div,
  body[data-dsh-bg-glass] [data-approval-key] > div,
  body[data-dsh-bg-glass] [data-question-key] > section,
  body[data-dsh-bg-glass] [data-plan-review-key] > section {
    background-image: linear-gradient(180deg, rgba(255, 255, 255, var(--bg-glass-sheen, 0.07)), rgba(255, 255, 255, var(--bg-glass-sheen-mid, 0.02)) 38%, rgba(255, 255, 255, 0.01));
    -webkit-backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
    backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
  }

  /* ---- "Load earlier" history button (top of long conversations) --------
     Its official fill is an opaque solid button token that is deliberately
     NOT overridden, so unlike the tip family it needs an explicit glass
     fill too — same recipe as the three chrome buttons above. */
  body[data-dsh-bg-glass] [class*="_older"] button {
    background-color: var(--dsw-specific-input-major);
    background-image: linear-gradient(180deg, rgba(255, 255, 255, var(--bg-glass-sheen, 0.07)), rgba(255, 255, 255, var(--bg-glass-sheen-mid, 0.02)) 38%, rgba(255, 255, 255, 0.01));
    -webkit-backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
    backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.32),
      inset 0 0 0 0.5px rgba(255, 255, 255, 0.12),
      0 4px 14px rgba(0, 0, 0, 0.08);
  }
  body[data-dsh-bg-glass] [class*="_older"] button:hover:not(:disabled) {
    background-color: color-mix(in srgb, rgb(255 255 255) calc(var(--bg-glass-alpha-strong, 0.8) * 100%), transparent);
  }

  /* Sidebar build badge: translucent ink already, but it sat directly on
     the wallpaper without frost. Join the shared blur chain under the same
     gate (its theme-aware ink fills from the active block above). */
  body[data-dsh-bg-glass] [class*="_buildRevision"] {
    -webkit-backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
    backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
  }

  /* ---- Official turn rail (dsh >= 0.1.2, TurnNavigator) -----------------
     The enhance mode borrows the kernel's rail untouched, so its hover
     preview card keeps the OFFICIAL opaque fill (bg-layer-1, not mediated
     by any overridden token) — the "悬浮反馈形态不透明" complaint. Glass it
     explicitly with the same explicit-fill recipe as the chrome buttons
     (fill = the painter's composer token + shared blur/sheen). Anchors are
     structural, never class names: the kernel's module-CSS class hashes are
     not a stable contract, but nav[style*="--turn-natural-height"] (its
     inline rail metrics) and the preview's role="tooltip" are. No edge
     dissolve on the marks column: the first and last tick dashes straddle
     the marks box edges by 1px, so a fade zone sized off the box height
     swallows them instead of the band. */
  body[data-dsh-bg-glass] nav[style*="--turn-natural-height"] [role="tooltip"] {
    background-color: var(--dsw-specific-input-major);
    background-image: linear-gradient(180deg, rgba(255, 255, 255, var(--bg-glass-sheen, 0.07)), rgba(255, 255, 255, var(--bg-glass-sheen-mid, 0.02)) 38%, rgba(255, 255, 255, 0.01));
    -webkit-backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
    backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
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
