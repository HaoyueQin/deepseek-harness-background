/**
 * Styles for the legacy port of the official turn rail (legacy-rail.tsx).
 *
 * A faithful port of `TurnNavigator.module.css` from dsh-client-ui-chat, kept
 * on the plugin's own `dsbt-` prefix because this rail isportaled to body
 * instead of living inside the chat scrollport. Metrics are the official ones
 * verbatim (28px column, 10px tick spacing, 6px end inset, 12/18/20px tick
 * widths, 420px height ceiling, 100px preview, 300px preview width).
 *
 * Glass + edge fade (unlike stock chrome): the rail is background plugin
 * chrome over the user's art, so the hover preview joins the shared glass
 * recipe under body[data-dsh-bg-glass] (fill = the painter's composer token
 * + the shared blur/sheen — the same strength as the composer card), and
 * the marks column gets the DeepSeek-web edge dissolve (top/bottom ticks
 * fade instead of hard-clipping). The fade is paint-only, always on; the
 * glass follows the wallpaper/panel-opacity sliders exactly like every
 * other glassed surface. Both kernel generations render identically.
 */

/** Unique id stamped on the injected style element (dedup key). */
export const TIMELINE_CSS_TAG = 'deepseek-harness-background/timeline'

/** Inject the rail stylesheet once. Idempotent (dedup key on the tag). */
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
  /* Portaled host: the official slot is a zero-height sticky box inside the
     chat scrollport; a fixed box centred on the transcript band is the
     equivalent outside it. */
  .dsbt-slot {
    position: fixed; top: 50%; right: 16px; transform: translateY(-50%);
    z-index: 6; display: flex; align-items: center; pointer-events: none;
  }
  @media (max-width: 767px) { .dsbt-slot { display: none; } }

  .dsbt-rail {
    position: relative; width: 28px; cursor: pointer; pointer-events: auto;
    transition: height 220ms cubic-bezier(.2, .8, .2, 1);
    height: min(var(--dsbt-natural-h, 12px), var(--dsbt-band, 420px), 420px);
  }

  .dsbt-marks {
    position: absolute; inset: var(--dsbt-inset, 6px) 0;
    /* DeepSeek-web edge dissolve: top and bottom ticks fade into the band.
       Paint-only — the rail's own geometry and hit-testing are untouched. */
    mask-image: linear-gradient(180deg, transparent 0%, #000 8%, #000 92%, transparent 100%);
    -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 8%, #000 92%, transparent 100%);
  }

  .dsbt-markPosition {
    position: absolute; top: min(var(--dsbt-natural, 0px), var(--dsbt-ratio, 0%));
    right: 0; left: 0; height: 10px; transform: translateY(-50%);
    transition: top 220ms cubic-bezier(.2, .8, .2, 1);
    animation: dsbt-mark-enter 150ms ease-out;
  }

  /* The rail owns pointer input for the whole column, so a mark is a keyboard
     destination that paints one tick — never a mouse target of its own. */
  .dsbt-mark {
    position: absolute; inset: 0 0 0 auto; width: 20px; padding: 0; border: 0;
    border-radius: 8px; background: transparent; cursor: pointer;
    pointer-events: none;
  }
  .dsbt-mark::before {
    position: absolute; top: 50%; right: 0; width: 12px; height: 2px;
    border-radius: 2px; background: var(--dsw-alias-border-l4);
    content: ''; transform: translateY(-50%);
    transition: width 140ms ease, background-color 140ms ease;
  }
  .dsbt-markPreview::before { width: 18px; background: var(--dsw-alias-label-tertiary); }
  .dsbt-markActive::before { width: 20px; background: var(--dsw-alias-label-primary); }
  .dsbt-mark:focus-visible::before {
    width: 20px; background: var(--dsw-alias-state-business-primary);
  }
  .dsbt-mark:focus-visible {
    outline: 1px solid var(--dsw-alias-state-business-primary);
    outline-offset: 2px;
  }
  /* Entries without an anchor key (early events lacking a durable id) cannot
     jump; dim them instead of silently eating the click. */
  .dsbt-mark:disabled::before { width: 8px; opacity: .5; }

  .dsbt-preview {
    --dsbt-preview-h: 100px;
    position: absolute;
    top: clamp(
      0px,
      calc(min(var(--dsbt-natural, 0px), var(--dsbt-ratio, 0%))
        + var(--dsbt-inset, 6px) - var(--dsbt-preview-h) / 2),
      calc(100% - var(--dsbt-preview-h))
    );
    right: calc(100% + 10px); box-sizing: border-box;
    width: min(300px, calc(100vw - 120px)); max-height: var(--dsbt-preview-h);
    overflow: hidden; padding: 10px 12px;
    border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px;
    color: var(--dsw-alias-label-primary);
    background: var(--dsw-alias-bg-layer-1); box-shadow: var(--dsw-shadow-lv2);
    font: var(--dsw-font-xs-strong-13); pointer-events: none;
    display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4;
    animation: dsbt-preview-enter 120ms ease-out;
    transition: top 140ms cubic-bezier(.2, .8, .2, 1);
    /* Content dissolve: a clamped preview's last lines soften out instead of
       hard-cutting, matching the rail's edge fade. No effect on short copy
       (the mask's fade zone rides the empty tail). */
    mask-image: linear-gradient(180deg, #000 86%, transparent 100%);
    -webkit-mask-image: linear-gradient(180deg, #000 86%, transparent 100%);
  }

  /* Hover preview is glass chrome just like the composer card: its official
     fill is the opaque bg-layer-1 token, so it needs the explicit-fill
     recipe (painter's composer token + shared blur/sheen chain). Gated on
     data-dsh-bg-glass like every other glassed surface. */
  body[data-dsh-bg-glass] .dsbt-preview {
    background-color: var(--dsw-specific-input-major);
    background-image: linear-gradient(180deg, rgba(255, 255, 255, var(--bg-glass-sheen, 0.07)), rgba(255, 255, 255, var(--bg-glass-sheen-mid, 0.02)) 38%, rgba(255, 255, 255, 0.01));
    -webkit-backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
    backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
  }

  @keyframes dsbt-mark-enter { from { opacity: 0; } to { opacity: 1; } }
  @keyframes dsbt-preview-enter {
    from { opacity: 0; transform: translateX(4px); }
    to { opacity: 1; transform: translateX(0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .dsbt-rail, .dsbt-markPosition, .dsbt-mark::before, .dsbt-preview {
      transition: none; animation: none;
    }
  }
`
