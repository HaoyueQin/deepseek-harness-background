/**
 * Timeline CSS — the conversation scroll-navigation rail (DeepSeek web
 * ScrollNav structure, rebuilt on this plugin's frosted-glass system).
 *
 * Structure and metrics mirror the official chat.deepseek.com stylesheet
 * (module map extracted from the shipped bundle; v0.1.4 of the reference port
 * dsh-chat-timeline widens the panel to 260px and adds bookmarks):
 *   nav 34px-wide rail, fixed right edge, vertically centered; collapsed
 *   blurred capsule (height − 8px); expanding panel (max 260px, radius 16)
 *   whose scroll area holds 30px rows (tick indicator + fading-in title);
 *   32px gradient fade veils top/bottom, expanded-only, shown while that
 *   side actually clips.
 *
 * Deviations from the reference port, all fidelity fixes:
 *   - The filter bar collapses to zero height while idle instead of staying
 *     in layout invisibly (it pushed every tick ~33px down).
 *   - Short stacks center vertically; overflowing stacks are bottom-pinned
 *     by the component so the newest tick hugs the capsule's bottom edge
 *     (the official idle strategy — the reference port flowed ticks from
 *     the top and clipped the newest away).
 *
 * Glass integration: the official chat.deepseek.com paints (light
 * rgba(255,255,255,.8)/.94, dark rgba(21,21,23,.6)/rgba(28,28,32,.95),
 * 5px collapsed / 16px expanded blur) remain as the NO-GLASS fallback.
 * While the plugin's glass system is on (`body[data-dsh-bg-glass]`), the
 * rail joins the SAME unified recipe as the composer card and bubbles:
 * fill = the painter's `--dsw-specific-input-major` token, blur/saturate/
 * brightness = the shared `--bg-glass-*` variables, i.e. the glass-blur
 * slider. Class prefix `dsbt-` deliberately avoids every
 * `[class*="_xxx"]` anchor of the plugin's glass sheet (underscores only).
 */

/** Unique id stamped on the injected style element (dedup key). */
export const TIMELINE_CSS_TAG = 'deepseek-harness-background/timeline'

/**
 * Expanded-row title size in px. The canvas width measurement in timeline.tsx
 * reads this same constant — a fitted panel width must track the real text
 * metrics, so the two can never drift apart.
 */
export const TIMELINE_TITLE_FONT_PX = 13

/** Inject the timeline stylesheet once. Idempotent (dedup key on the tag). */
export function injectTimelineCss(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css="${TIMELINE_CSS_TAG}"]`)) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'deepseek-harness-background'
  tag.dataset.pluginCss = TIMELINE_CSS_TAG
  tag.textContent = TIMELINE_CSS
  document.head.appendChild(tag)
}

export const TIMELINE_CSS = `
  .dsbt-nav {
    user-select: none; -webkit-user-select: none;
    /* Filter-bar chrome height shared by the bar itself and the top veil's
       expanded offset. */
    --dsbt-bar-h: 33px;
    z-index: 90; align-items: center; width: 34px;
    height: var(--dsbt-h, 300px);
    transition: right .2s ease, opacity .2s ease;
    display: flex; position: fixed; top: 50%; right: 16px;
    transform: translateY(-50%); pointer-events: auto;
  }
  @media (max-width: 767px) { .dsbt-nav { display: none; } }

  /* Collapsed capsule — frosted strip behind the tick marks. Official paint:
     light rgba(255,255,255,.8), dark rgba(21,21,23,.6), 5px blur. */
  .dsbt-bg {
    background-color: rgba(255, 255, 255, .8);
    -webkit-backdrop-filter: blur(5px);
    backdrop-filter: blur(5px);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, .28),
      inset 0 0 0 .5px rgba(255, 255, 255, .1),
      0 6px 18px rgba(0, 0, 0, .07);
    border-radius: 16px; width: 34px;
    height: calc(var(--dsbt-h, 300px) - 8px); max-height: calc(var(--dsbt-h, 300px) - 8px);
    position: absolute; top: 50%; right: 0; transform: translateY(-50%);
    transition: opacity .2s ease; pointer-events: none;
  }
  body[data-ds-dark-theme] .dsbt-bg {
    background-color: rgba(21, 21, 23, .6);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, .09),
      inset 0 0 0 .5px rgba(255, 255, 255, .05),
      0 6px 18px rgba(0, 0, 0, .3);
  }
  .dsbt-bg.dsbt-bg-hide { opacity: 0; }

  /* Expanding panel — exactly the capsule's box (identical height in both
     states), width animates 34px -> measured fit (max 260px). Official
     hover-state paint: white/black frosted glass at ~94% alpha, 16px blur. */
  .dsbt-wrap {
    width: 34px;
    height: calc(var(--dsbt-h, 300px) - 8px); max-height: calc(var(--dsbt-h, 300px) - 8px);
    border: 1px solid transparent; border-radius: 16px;
    flex-direction: column; align-items: stretch;
    transition: width .22s cubic-bezier(.4, 0, .2, 1), background-color .2s ease,
      box-shadow .2s ease, border-color .2s ease;
    display: flex; position: absolute; top: 50%; right: 0;
    transform: translateY(-50%);
    overflow: hidden; box-sizing: border-box; background: transparent;
    pointer-events: none;
  }
  .dsbt-wrap.dsbt-show {
    pointer-events: auto;
    width: min(var(--dsbt-w, 260px), 260px);
    background-color: rgba(255, 255, 255, .94);
    -webkit-backdrop-filter: blur(16px);
    backdrop-filter: blur(16px);
    border-color: rgba(0, 0, 0, .06);
    box-shadow: 0 10px 30px rgba(0, 0, 0, .08), 0 2px 8px rgba(0, 0, 0, .04);
  }
  body[data-ds-dark-theme] .dsbt-wrap.dsbt-show {
    background-color: rgba(28, 28, 32, .95);
    border-color: rgba(255, 255, 255, .08);
    box-shadow: 0 10px 30px rgba(0, 0, 0, .45), 0 2px 8px rgba(0, 0, 0, .25);
  }

  /* Content fade veils — the official ::before/::after pair rebuilt as
     elements: a bar of the panel's OWN fill color masked to nothing over
     32px (solid -> mask == gradient-to-transparent, but works with the
     translucent fill). They belong to the EXPANDED panel only — the idle
     capsule hard-clips its ticks at the rounded ends like the official
     strip — and while expanded the top veil starts BELOW the filter bar,
     not over it. Shown only while that side actually clips. */
  .dsbt-fade {
    z-index: 2; pointer-events: none; opacity: 0;
    background-color: rgba(255, 255, 255, .94);
    -webkit-mask-image: linear-gradient(#000 20.19%, transparent 100%);
    mask-image: linear-gradient(#000 20.19%, transparent 100%);
    width: 100%; height: 32px; transition: opacity .2s ease;
    position: absolute; left: 0; top: 0;
  }
  body[data-ds-dark-theme] .dsbt-fade { background-color: rgba(28, 28, 32, .95); }
  .dsbt-fade.dsbt-fade-bot { top: auto; bottom: 0; transform: rotate(180deg); }
  .dsbt-wrap.dsbt-show .dsbt-fade.dsbt-fade-on { opacity: 1; }
  .dsbt-wrap.dsbt-show .dsbt-fade:not(.dsbt-fade-bot) { top: var(--dsbt-bar-h, 33px); }

  /* Filter bar — "marked only" toggle pinned above the scroll area while
     expanded. Collapsed, it collapses to ZERO height (not just opacity): a
     transparent-but-in-layout bar pushed every tick ~33px down, one of the
     reasons the idle capsule read as off-alignment. */
  .dsbt-filterbar {
    height: var(--dsbt-bar-h, 33px);
    padding: 8px 12px 4px; display: flex; justify-content: flex-end;
    align-items: center; border-bottom: 1px solid rgba(0, 0, 0, .05);
    box-sizing: border-box; flex: none; overflow: hidden;
    transition: opacity .2s ease, height .2s ease, padding .2s ease,
      border-color .2s ease;
  }
  .dsbt-wrap:not(.dsbt-show) .dsbt-filterbar {
    height: 0; padding-top: 0; padding-bottom: 0; opacity: 0;
    border-bottom-color: transparent;
  }
  body[data-ds-dark-theme] .dsbt-filterbar { border-bottom-color: rgba(255, 255, 255, .06); }
  .dsbt-filterbtn {
    font-size: 11px; line-height: 16px; padding: 2px 8px; border-radius: 10px;
    border: 1px solid rgba(0, 0, 0, .1); background: rgba(0, 0, 0, .03);
    color: rgba(0, 0, 0, .65); cursor: pointer; transition: all .15s ease;
    display: inline-flex; align-items: center; gap: 3px; font-family: inherit;
  }
  .dsbt-filterbtn:hover { background: rgba(0, 0, 0, .07); color: rgba(0, 0, 0, .9); }
  .dsbt-filterbtn.dsbt-filteron {
    background: rgba(245, 158, 11, .12); border-color: #f59e0b;
    color: #b45309; font-weight: 600;
  }
  body[data-ds-dark-theme] .dsbt-filterbtn {
    border-color: rgba(255, 255, 255, .12); background: rgba(255, 255, 255, .05);
    color: rgba(255, 255, 255, .7);
  }
  body[data-ds-dark-theme] .dsbt-filterbtn:hover { background: rgba(255, 255, 255, .1); color: rgba(255, 255, 255, .95); }
  body[data-ds-dark-theme] .dsbt-filterbtn.dsbt-filteron {
    background: rgba(251, 191, 36, .18); border-color: #fbbf24; color: #fbbf24;
  }

  /* Scroll area — rows hug the right edge; scrolls only when overfull. The
     auto-margin pseudo pair vertically centers the stack when it fits the
     capsule (short conversations), and resolves to zero free space when it
     overflows, so bottom-pinned scrolling behaves like a plain column. */
  .dsbt-page {
    padding: 15px 0 15px 24px; box-sizing: border-box;
    overscroll-behavior: contain; flex: 1 1 auto; min-height: 0;
    flex-direction: column; align-items: flex-end; display: flex;
    position: relative; width: 100%; overflow: hidden;
  }
  .dsbt-page::before, .dsbt-page::after {
    content: ''; flex: none; margin-block: auto;
  }
  .dsbt-wrap.dsbt-show .dsbt-page {
    overflow-y: auto; overflow-x: hidden;
    scrollbar-width: thin; scrollbar-color: rgba(0, 0, 0, .15) transparent;
  }
  body[data-ds-dark-theme] .dsbt-wrap.dsbt-show .dsbt-page { scrollbar-color: rgba(255, 255, 255, .25) transparent; }
  .dsbt-page::-webkit-scrollbar { width: 4px; }
  .dsbt-page::-webkit-scrollbar-track { background: transparent; }
  .dsbt-page::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, .15); border-radius: 4px; }
  body[data-ds-dark-theme] .dsbt-page::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, .25); }

  /* Empty state (filtered list with no marks). */
  .dsbt-empty {
    font-size: 12px; line-height: 18px; padding: 16px 12px;
    color: rgba(0, 0, 0, .45); text-align: center; width: 100%; box-sizing: border-box;
  }
  body[data-ds-dark-theme] .dsbt-empty { color: rgba(255, 255, 255, .45); }

  /* One message row: 30px, star bookmark + tick indicator at the right,
     title fading in. */
  /* Row shell: layout + shared ink only — the interactive hit areas are the
     sibling .dsbt-jump / .dsbt-star buttons below. */
  .dsbt-item {
    height: 30px; min-height: 30px; flex-shrink: 0;
    justify-content: flex-end; align-items: center;
    width: calc(100% - 4px); margin-right: 4px;
    display: flex; box-sizing: border-box;
    color: var(--dsw-alias-label-tertiary, rgba(0, 0, 0, .65));
    transition: color .15s ease;
  }

  /* Jump target: a real button so Enter/Space work natively without nesting
     an interactive element inside another. */
  .dsbt-jump {
    cursor: pointer; background: none; border: none; margin: 0; padding: 0;
    font: inherit; line-height: 20px; text-align: right; color: inherit;
    flex: 1 1 auto; min-width: 0; height: 100%;
    display: flex; align-items: center; justify-content: flex-end;
  }
  .dsbt-jump:focus-visible { outline: 1px solid currentColor; outline-offset: -1px; border-radius: 6px; }
  .dsbt-jump:disabled { cursor: default; opacity: .55; }
  .dsbt-jump:disabled .dsbt-title { text-decoration: line-through; text-decoration-color: currentColor; }
  .dsbt-item:hover { color: var(--dsw-alias-label-primary, rgba(0, 0, 0, .95)); }
  body[data-ds-dark-theme] .dsbt-item { color: rgba(255, 255, 255, .65); }
  body[data-ds-dark-theme] .dsbt-item:hover { color: rgba(255, 255, 255, .95); }
  .dsbt-title {
    font-size: ${TIMELINE_TITLE_FONT_PX}px; line-height: 20px; flex: 1 1 auto; min-width: 0;
    text-overflow: ellipsis; white-space: nowrap; overflow: hidden;
    margin-right: 6px; text-align: right; color: inherit;
    opacity: 0; transition: opacity .12s ease, color .15s ease;
  }
  .dsbt-show .dsbt-title { opacity: 1; }

  /* Star bookmark — appears on row hover while the panel is expanded; gold
     when marked. A real sibling button next to the jump target, so marking
     stays keyboard-operable without nested interactive elements. */
  .dsbt-star {
    font-size: ${TIMELINE_TITLE_FONT_PX}px; line-height: 16px; width: 18px; height: 18px;
    display: inline-flex; align-items: center; justify-content: center;
    opacity: 0; cursor: pointer; transition: all .15s ease; margin-right: 6px;
    flex-shrink: 0; color: rgba(0, 0, 0, .25); border-radius: 4px; user-select: none;
    -webkit-user-select: none;
    background: none; border: none; padding: 0; font-family: inherit;
  }
  .dsbt-star:focus-visible { outline: 1px solid currentColor; outline-offset: 1px; opacity: .9; }
  .dsbt-wrap.dsbt-show .dsbt-item:hover .dsbt-star { opacity: .75; }
  .dsbt-wrap.dsbt-show .dsbt-star:hover { opacity: 1; transform: scale(1.2); color: #d97706; }
  .dsbt-wrap.dsbt-show .dsbt-star.dsbt-staron { opacity: 1; color: #f59e0b; }
  body[data-ds-dark-theme] .dsbt-star { color: rgba(255, 255, 255, .25); }
  body[data-ds-dark-theme] .dsbt-wrap.dsbt-show .dsbt-star:hover { color: #fde047; }
  body[data-ds-dark-theme] .dsbt-wrap.dsbt-show .dsbt-star.dsbt-staron { opacity: 1; color: #fbbf24; }

  .dsbt-ind { flex-shrink: 0; justify-content: center; align-items: center; width: 16px; height: 20px; display: flex; }
  .dsbt-line {
    background-color: var(--dsw-alias-border-l4, rgba(0, 0, 0, .16));
    border-radius: 4px; flex-shrink: 0; width: 8px; height: 2px;
    transition: background-color .2s ease, transform .2s ease, width .2s ease, height .2s ease;
  }
  .dsbt-item:hover .dsbt-line { background-color: var(--dsw-alias-label-primary, rgba(0, 0, 0, .9)); }
  .dsbt-item.dsbt-active { color: var(--dsw-alias-state-business-primary, #4d6bfe); }
  .dsbt-item.dsbt-active .dsbt-title { color: var(--dsw-alias-state-business-primary, #4d6bfe); font-weight: 500; }
  .dsbt-item.dsbt-active .dsbt-line {
    background-color: var(--dsw-alias-state-business-primary, #4d6bfe);
    transform-origin: 50%; transform: scale(1.5);
  }
  body[data-ds-dark-theme] .dsbt-item.dsbt-active { color: var(--dsw-alias-state-business-primary, #4d6bfe); }
  body[data-ds-dark-theme] .dsbt-line { background-color: rgba(255, 255, 255, .2); }
  body[data-ds-dark-theme] .dsbt-item:hover .dsbt-line { background-color: rgba(255, 255, 255, .9); }

  /* Marked (key-point) rows: a wider golden tick in both themes; the active
     state keeps its brand-blue scale so reading position always wins. */
  .dsbt-item.dsbt-marked .dsbt-line { background-color: #d97706; width: 10px; height: 2.5px; }
  .dsbt-item.dsbt-marked:hover .dsbt-line { background-color: #b45309; }
  .dsbt-item.dsbt-marked.dsbt-active .dsbt-line {
    background-color: var(--dsw-alias-state-business-primary, #4d6bfe);
    transform-origin: 50%; transform: scale(1.5);
  }
  body[data-ds-dark-theme] .dsbt-item.dsbt-marked .dsbt-line { background-color: #fbbf24; width: 10px; height: 2.5px; }
  body[data-ds-dark-theme] .dsbt-item.dsbt-marked:hover .dsbt-line { background-color: #fde047; }

  /* ---- Unified glass integration -----------------------------------------
     Glass system on (wallpaper active + panelOpacity < 1): the rail joins
     the composer/bubble recipe — the same translucent fill token and the
     same blur/saturate/brightness chain (the glass-blur slider drives it,
     no fixed 5/16px). Placed after the dark-theme rules so equal-specificity
     overrides win in both schemes. */
  body[data-dsh-bg-glass] .dsbt-bg,
  body[data-dsh-bg-glass] .dsbt-wrap.dsbt-show {
    background-color: var(--dsw-specific-input-major);
    -webkit-backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
    backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
  }
  body[data-dsh-bg-glass] .dsbt-fade {
    background-color: var(--dsw-specific-input-major);
  }

  @media (prefers-reduced-motion: reduce) {
    .dsbt-nav, .dsbt-bg, .dsbt-wrap, .dsbt-fade, .dsbt-title, .dsbt-line, .dsbt-jump, .dsbt-star, .dsbt-filterbtn, .dsbt-filterbar { transition: none; }
  }
`
