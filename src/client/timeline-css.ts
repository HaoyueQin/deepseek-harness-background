/**
 * Timeline CSS — the conversation scroll-navigation rail (DeepSeek web
 * ScrollNav structure, rebuilt on this plugin's frosted-glass system).
 *
 * Structure and metrics mirror the official chat.deepseek.com stylesheet
 * (module map extracted from the shipped bundle):
 *   nav 34px-wide rail, fixed right edge, vertically centered; collapsed
 *   blurred capsule (height − 8px); expanding panel (max 240px, radius 16)
 *   whose scroll area holds 30px rows (tick indicator + fading-in title);
 *   32px gradient fade veils top/bottom shown while that side clips.
 *
 * Glass integration: fills come from the SAME `--dsw-*` surface tokens this
 * plugin overrides on body (`--dsw-alias-bg-overlay` capsule,
 * `--dsw-alias-bg-layer-1` panel), and blurs read the shared
 * `--bg-glass-*` knobs the painter writes — so the rail follows
 * panelOpacity/blur live and returns to the official opaque surfaces when
 * the glass is off. Class prefix `dsbt-` deliberately avoids every
 * `[class*="_xxx"]` anchor of the universal glass sheet (underscores only).
 */

/** Unique id stamped on the injected style element (dedup key). */
export const TIMELINE_CSS_TAG = 'deepseek-harness-background/timeline'

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
    z-index: 90; align-items: center; width: 34px;
    height: var(--dsbt-h, 300px);
    transition: width .22s cubic-bezier(.4, 0, .2, 1);
    display: flex; position: fixed; top: 50%; right: 16px;
    transform: translateY(-50%); pointer-events: auto;
  }
  @media (max-width: 767px) { .dsbt-nav { display: none; } }

  /* Collapsed capsule — frosted strip behind the tick marks. Fill rides the
     overridden overlay token (white glass while active, official color when
     the glass is off); blur reads the shared knob, capped for the tiny area. */
  .dsbt-bg {
    background-color: var(--dsw-alias-bg-overlay, rgba(255, 255, 255, .72));
    -webkit-backdrop-filter: blur(min(var(--bg-glass-blur, 16px), 8px)) saturate(var(--bg-glass-saturate, 1.42));
    backdrop-filter: blur(min(var(--bg-glass-blur, 16px), 8px)) saturate(var(--bg-glass-saturate, 1.42));
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
    background-color: var(--dsw-alias-bg-overlay, rgba(22, 22, 26, .55));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, .09),
      inset 0 0 0 .5px rgba(255, 255, 255, .05),
      0 6px 18px rgba(0, 0, 0, .3);
  }
  .dsbt-bg.dsbt-bg-hide { opacity: 0; }

  /* Expanding panel — exactly the capsule's box (identical height in both
     states), width animates 34px -> measured fit (max 240px). */
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
    width: min(var(--dsbt-w, 240px), 240px);
    background-color: var(--dsw-alias-bg-layer-1, rgba(255, 255, 255, .92));
    -webkit-backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1));
    backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1));
    border-color: var(--dsw-alias-border-inverted, rgba(0, 0, 0, .06));
    box-shadow: var(--dsw-shadow-lv3, 0 10px 30px rgba(0, 0, 0, .1), 0 2px 8px rgba(0, 0, 0, .05));
  }
  body[data-ds-dark-theme] .dsbt-wrap.dsbt-show {
    border-color: var(--dsw-alias-border-inverted, rgba(255, 255, 255, .08));
    box-shadow: var(--dsw-shadow-lv3, 0 10px 30px rgba(0, 0, 0, .45), 0 2px 8px rgba(0, 0, 0, .25));
  }

  /* Content fade veils — the official ::before/::after pair rebuilt as
     elements: a bar of the panel's OWN fill color masked to nothing over
     32px (solid -> mask == gradient-to-transparent, but works with the
     translucent glass token). Shown only while that side actually clips. */
  .dsbt-fade {
    z-index: 2; pointer-events: none; opacity: 0;
    background-color: var(--dsw-alias-bg-layer-1, rgba(255, 255, 255, .92));
    -webkit-mask-image: linear-gradient(#000 20.19%, transparent 100%);
    mask-image: linear-gradient(#000 20.19%, transparent 100%);
    width: 100%; height: 32px; transition: opacity .2s ease;
    position: absolute; left: 0; top: 0;
  }
  .dsbt-fade.dsbt-fade-bot { top: auto; bottom: 0; transform: rotate(180deg); }
  .dsbt-fade.dsbt-fade-on { opacity: 1; }

  /* Scroll area — rows hug the right edge; scrolls only when overfull. */
  .dsbt-page {
    padding: 15px 0 15px 24px; box-sizing: border-box;
    overscroll-behavior: contain; flex: 1 1 auto; min-height: 0;
    flex-direction: column; align-items: flex-end; display: flex;
    position: relative; width: 100%; overflow: hidden;
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

  /* One message row: 30px, tick indicator at the right, title fading in. */
  .dsbt-item {
    cursor: pointer; height: 30px; min-height: 30px; flex-shrink: 0;
    justify-content: flex-end; align-items: center;
    width: calc(100% - 6px); margin-right: 8px; line-height: 20px;
    display: flex; background: none; border: none; font: inherit;
    text-align: right; box-sizing: border-box; padding: 0;
    color: var(--dsw-alias-label-tertiary, rgba(0, 0, 0, .45));
    transition: color .15s ease;
  }
  .dsbt-item:hover { color: var(--dsw-alias-label-primary, rgba(0, 0, 0, .9)); }
  .dsbt-title {
    font-size: 13px; line-height: 20px; flex: 1 1 auto; min-width: 0;
    text-overflow: ellipsis; white-space: nowrap; overflow: hidden;
    margin-right: 12px; text-align: right; color: inherit;
    opacity: 0; transition: opacity .12s ease, color .15s ease;
  }
  .dsbt-show .dsbt-title { opacity: 1; }
  .dsbt-ind { flex-shrink: 0; justify-content: center; align-items: center; width: 16px; height: 20px; display: flex; }
  .dsbt-line {
    background-color: var(--dsw-alias-border-l4, rgba(0, 0, 0, .16));
    border-radius: 4px; flex-shrink: 0; width: 8px; height: 2px;
    transition: background-color .2s ease, transform .2s ease;
  }
  .dsbt-item:hover .dsbt-line { background-color: var(--dsw-alias-label-primary, rgba(0, 0, 0, .9)); }
  .dsbt-item.dsbt-active { color: var(--dsw-alias-state-business-primary, #4d6bfe); }
  .dsbt-item.dsbt-active .dsbt-title { color: var(--dsw-alias-state-business-primary, #4d6bfe); font-weight: 500; }
  .dsbt-item.dsbt-active .dsbt-line {
    background-color: var(--dsw-alias-state-business-primary, #4d6bfe);
    transform-origin: 50%; transform: scale(1.5);
  }

  @media (prefers-reduced-motion: reduce) {
    .dsbt-nav, .dsbt-bg, .dsbt-wrap, .dsbt-fade, .dsbt-title, .dsbt-line { transition: none; }
  }
`
