# Frosted-Glass Registry — third-party integration API (v1)

Other plugins can register their own panels into this plugin's frosted-glass
system, so their surfaces get the **exact same recipe** as the built-in glass
(composer card, message bubbles, code blocks...): translucent white fill,
the wet-glass sheen gradient, and the shared `backdrop-filter` chain whose
blur follows the user's **glass-blur** slider.

Typical consumers: diff viewers, file peeks, tool result cards, floating
toolbars — any surface that floats as a small card over the wallpaper and is
painted opaque (or translucent-without-blur) today.

- **Zero dependencies.** No npm package to install, no runtime coupling.
- **Zero-coupling fallback.** If this plugin is not installed, the bridge
  simply never appears and your plugin runs unchanged.
- **Gate-driven.** Your registration lights up only while the glass is on;
  when the user disables the wallpaper or maxes the panel-opacity slider,
  your surfaces return to their own paints automatically.

---

## 1. How it works

```
your plugin                    this plugin (deepseek-harness-background)
────────────                   ──────────────────────────────────────────
register(selectors) ────────▶ GlassRegistry (in-memory entries)
                                     │  synthesizes CSS on change
                                     ▼
                               <style data-plugin-css="deepseek-harness-background/glass-registry">
                                 body[data-dsh-bg-glass] <your-selector> { sheen + blur chain }
                               </style>
                                     ▲
        painter writes knobs         │  gate attr present ONLY while
        --bg-glass-blur etc. ───────╯  glass is ON (wallpaper + panelOpacity < 1)
```

The whole contract lives in two browser-global values:

| Channel | Value |
| --- | --- |
| Global object | `window.__DSH_BACKGROUND_GLASS__` — the `BackgroundGlassApi`, published as soon as this plugin's client applies |
| DOM event | `dsh-background-glass:ready` — a `CustomEvent` whose `detail` is that same api, dispatched synchronously right after publication |

Because DSH loads plugin client bundles in no guaranteed order, a consumer
must handle BOTH arrival orders: poll the global first, then wait for the
event (the quick-start helper below does exactly that).

### When is the glass actually ON?

The registry's rules are keyed on the body attribute
`data-dsh-bg-glass`, which the painter sets exactly when:

1. a background section is **enabled**, AND
2. an image source exists (upload or URL), AND
3. **panel opacity < 100%** (at 100% every official surface returns to its
   opaque paint — registered ones behave the same).

You can query this state at any time via `api.isActive()`. Registrations are
unaffected by the state: registering while the glass is OFF just waits under
the gate and lights up when the glass turns on. No re-registration needed,
ever — theme flips, slider drags and enable/disable cycles are all handled by
the shared painter.

---

## 2. Quick start

Copy this helper into your client bundle (~20 lines, no imports):

```ts
type GlassApi = {
  version: number
  bridgeId: 'deepseek-harness-background'
  isActive(): boolean
  register(spec: {
    plugin: string
    selectors: string | readonly string[]
    mode?: 'token' | 'fill'
  }): () => void
}

const GLASS_GLOBAL = '__DSH_BACKGROUND_GLASS__'
const GLASS_EVENT = 'dsh-background-glass:ready'

/** Resolve the background plugin's glass api, or null when it is absent.
 * Cleans up both the timer AND the listener whichever path wins. */
function whenGlassReady(timeoutMs = 10_000): Promise<GlassApi | null> {
  const existing = (window as unknown as Record<string, unknown>)[GLASS_GLOBAL] as GlassApi | undefined
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve) => {
    const onReady = (event: Event): void => {
      clearTimeout(timer)
      window.removeEventListener(GLASS_EVENT, onReady)
      resolve((event as CustomEvent<GlassApi>).detail)
    }
    const timer = setTimeout(() => {
      window.removeEventListener(GLASS_EVENT, onReady)
      resolve(null)
    }, timeoutMs)
    window.addEventListener(GLASS_EVENT, onReady)
  })
}
```

Then wire it into your cordis client `apply` so unregistration rides your
fiber's disposal:

```ts
export function apply(ctx: Context): void {
  ctx.effect(() => {
    let unregister: (() => void) | undefined
    let disposed = false
    void whenGlassReady().then((glass) => {
      if (disposed || !glass || glass.version !== 1) return
      unregister = glass.register({
        plugin: 'your-package-name',
        selectors: ['[data-your-panel]'],
      })
    })
    return () => {
      disposed = true
      unregister?.()
    }
  }, 'your-package-name: frosted-glass surfaces')
}
```

That is the entire integration.


---

## 3. API reference

### `window.__DSH_BACKGROUND_GLASS__: BackgroundGlassApi | undefined`

| Member | Type | Description |
| --- | --- | --- |
| `version` | `1` | Contract version. Check it before using new members; v1 makes no further guarantees. |
| `bridgeId` | `'deepseek-harness-background'` | Publisher identity — assert this before trusting the global. |
| `isActive()` | `() => boolean` | Whether the glass is ON right now (`body[data-dsh-bg-glass]` present). See §1. |
| `register(spec)` | `(spec: GlassSurfaceSpec) => () => void` | Register surfaces. Returns the **unregister** function: idempotent, safe to call twice, and the correct cleanup for a cordis effect/fiber dispose. |

### `GlassSurfaceSpec`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `plugin` | `string` | yes | Caller identity, conventionally your package name. Diagnostics only — different plugins never conflict. Falls back to `(anonymous)` in warnings if blank. |
| `selectors` | `string \| readonly string[]` | yes | One selector or a list (max 64). Each must match elements YOU render; see §5 for constraints. |
| `mode` | `'token' \| 'fill'` | no (default `'token'`) | Fill strategy; see §4. |

### Registration semantics

- **Idempotent per `(plugin, mode, selector)` triple**: re-registering a triple
  you already registered replaces that entry (useful on hot reload). The
  handle returned by the OLDER call becomes inert — it will not remove the
  newer entry.
- **Cross-plugin overlap is allowed**: two plugins may register the same
  selector. Identical rule text is emitted once; cascade resolves who wins.
- **Rejected selectors do not abort the call**: each invalid selector is
  dropped with one `console.warn`; valid siblings in the same spec apply.

### Ready event

`window.addEventListener('dsh-background-glass:ready', handler)` — `handler`
receives `CustomEvent<BackgroundGlassApi>`. The event fires once per bridge
publication, synchronously during this plugin's client apply (i.e. before any
painting happens), and again if the bridge is re-installed after a hot reload
(your listener with `{ once: true }` would miss the second one; prefer the
poll-first helper).

---

## 4. Choosing the mode

Both modes emit the SAME filter chain; they differ only in whether the
registry also takes over your `background-color`.

### `mode: 'token'` (default) — your fill already follows the sliders

Use when your panel paints with one of the tokens this plugin turns
translucent while the glass is on:

| Token | Covers |
| --- | --- |
| `--dsw-specific-input-major` | composer-grade white glass |
| `--dsw-specific-bubble` | message bubbles |
| `--dsw-alias-markdown-code-block` | code blocks / diff & terminal & tool-IO cards |
| `--dsw-alias-markdown-code-block-banner` | code-block header bars |
| `--dsw-alias-markdown-inline-code` | inline code chips |
| `--dsw-specific-tip` | todo / goal / queue dock cards |

Your fill alpha then tracks the **panel-opacity** slider automatically
(theme-aware curve, see §6) and the registry only adds the missing frost:

```css
body[data-dsh-bg-glass] <your-selector> {
  background-image: linear-gradient(180deg, ...sheen...);
  -webkit-backdrop-filter: blur(...) saturate(...) brightness(...) contrast(1.01);
  backdrop-filter: blur(...) saturate(...) brightness(...) contrast(1.01);
}
```

### `mode: 'fill'` — the registry takes your fill too

Use when your panel carries its own opaque/literal background (a hardcoded
hex/rgba, or a token NOT in the table above). The generated rule additionally
sets `background-color: var(--dsw-specific-input-major)` — the same explicit
recipe as the chrome buttons and the lineage popover. Your own
`background-color` declaration loses the cascade battle while the glass is on
and comes back untouched when it turns off.

Not sure which you need? Inspect the element in DevTools: if the winning
`background` declaration names a token from the table, pick `token`;
otherwise pick `fill`.

One caveat: an INLINE background (a style attribute set by JS/JSX) outranks
ANY stylesheet rule, so `fill` mode cannot take over a panel whose background
is applied inline — move that declaration into a stylesheet class first.

---

## 5. Selector rules

Selectors are embedded into a generated stylesheet, so they are validated
structurally before acceptance:

| Constraint | Value |
| --- | --- |
| Forbidden characters | `{` `}` `;` `@` `<` `>` and backslashes (they could escape the rule context; anchors never need them) |
| Max length | 500 characters after trim |
| Max per `register` call | 64 selectors |
| Whitespace | leading/trailing trimmed automatically |

Failure mode: the offending selector is dropped with a single
`console.warn('[glass-registry] <plugin>: rejected selector ...')`; valid
siblings still apply. Ordinary CSS mistakes (a typo'd pseudo-class) are NOT
checked here — the browser simply drops that one rule, which is a safe no-op.

Good anchors are stable attributes you already render (`data-*` preferred)
or structural classes from your own CSS modules. Avoid bare element
selectors (`div`, `section`) — they will glass surfaces you do not own.

---

## 6. The exact recipe your surfaces receive

All declarations are driven by variables the painter writes onto `body`,
so your surfaces respond live to every control:

| Declaration / variable | Driven by |
| --- | --- |
| `--bg-glass-blur` | **Glass blur** slider (0–40px) |
| `--bg-glass-saturate` | derived: `1.1 + blur * 0.02`, capped at 1.6 — exactly `1` when blur = 0 |
| `--bg-glass-brightness` | theme calibration (light `0.98`, dark `1.04`) |
| `--bg-glass-sheen` / `--bg-glass-sheen-mid` | sheen gradient stops (light `0.07/0.02`, dark `0.16/0.05`) |
| `background-color` (fill mode only) via `--dsw-specific-input-major` | **Panel opacity** slider — alpha `= clamp(0.05 + panelOpacity * 0.85, ≤ 0.9) × (light 0.8 / dark 0.4)`, as white |

The full emitted declarations, byte-identical to the built-in explicit-fill
families:

```css
/* token mode */
body[data-dsh-bg-glass] <selector> {
  background-image: linear-gradient(180deg,
    rgba(255, 255, 255, var(--bg-glass-sheen, 0.07)),
    rgba(255, 255, 255, var(--bg-glass-sheen-mid, 0.02)) 38%,
    rgba(255, 255, 255, 0.01));
  -webkit-backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
  backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
}

/* fill mode adds: */
body[data-dsh-bg-glass] <selector> {
  background-color: var(--dsw-specific-input-major);
}
```

The registry deliberately does NOT touch your text colors, borders, box
shadows or radii — layer those however you like.

### Fill inheritance is GLOBAL — read this even if you never register

The six tokens in the §4 table are overridden on `document.body` itself
(inline style), and CSS custom properties INHERIT down the whole tree.
That has a consequence you should understand before deciding anything:

- EVERY surface that paints with one of those tokens turns translucent
  while the glass is on — official or third-party, registered or not.
  Registration cannot opt out of it; this is how shared design tokens
  work, and it applies inside the official UI too. The built-in
  whitelist only decides which surfaces additionally receive the
  sheen/blur chain so they read as FROSTED rather than bare-transparent.
- The reverse edge is equally real: an unregistered third-party panel
  using `--dsw-alias-markdown-code-block` shows up translucent-without-
  blur. Registering it with the default token mode completes the recipe.
- Everything reverts when the glass goes off: panel opacity at 100%, a
  disabled section, or a cleared source restores the official token
  values and every surface — yours included — returns to its own paint.

**If you use one of the six tokens but do NOT want translucency** (e.g.
a large reading surface where frost would hurt legibility): registration
cannot help you there. Either switch that surface to a token this plugin
does not override (for example `--dsw-alias-bg-layer-1`) or to a literal
color, or re-declare the token yourself on the root element of that
surface (you then own its light/dark values via `[data-ds-dark-theme]`).

---

## 7. Lifecycle

| Event | What happens |
| --- | --- |
| This plugin loads | Bridge published + ready event dispatched BEFORE the first snapshot repaint. Early registrants cannot race it. |
| You register while glass is OFF | Rule is synthesized immediately but sits under the gate; lights up when the glass turns on. |
| Theme flips / sliders move | Shared painter repaints its knobs; nothing for you to do. |
| Glass turns OFF (disable, clear source, panel opacity = 100%) | Gate attribute disappears; your surfaces show their own paints again. Registration stays parked. |
| Your plugin unloads | Call the unregister handle in your fiber dispose (quick start does). |
| This plugin hot-reloads | Old bridge disposes first (stylesheet removed, window key replaced), then a fresh publication fires. Re-register afterwards — or keep a small re-registration timer if you must be bulletproof. |
| This plugin uninstalls/disables | Whole bridge torn down with the client fiber; nothing of yours remains registered anywhere. |

---

## 8. Worked example — dsh-diff-stat

Its diff window (`.window` in `diff-window.module.css`) and file peek
(`.peek` in `file-peek.module.css`) fill with
`var(--dsw-alias-markdown-code-block)` — a token from the §4 table — so
**token mode** is correct: their fills already turn translucent with the
panel-opacity slider; only the frost was missing. Both components carry
stable data anchors:

```ts
glass.register({
  plugin: 'dsh-diff-stat',
  selectors: ['[data-diff-window]', '[data-diff-stat-peek]'],
})
```

(The turn-summary card uses a near-transparent tint by design and needs no
registration.)

---

## 9. FAQ

**How do I react to the glass turning on/off?**
Usually you should not need to — the gate handles styling. If you genuinely
must (e.g. swap an asset), observe the body attribute:

```ts
new MutationObserver(() => console.log(glass.isActive()))
  .observe(document.body, { attributes: true, attributeFilter: ['data-dsh-bg-glass'] })
```

**Why not just import this plugin as an npm dependency?**
A runtime import would crash your bundle when users skip this plugin, and
DSH's frozen module table forbids cross-plugin value imports anyway. The
bridge is deliberately dependency-free; the only acceptable package-level use
is type-only imports, which bundlers erase.

**My component portals outside the app root — still covered?**
Yes. The generated rules match anywhere in the document; the gate lives on
`body`, which every portal ultimately hangs under.

**Will my text become unreadable?**
No more than the official glassed surfaces: the recipe only touches
`background-color`/`background-image`/`backdrop-filter`. Keep relying on
the official label tokens for ink.

**My surface sits inside a container with a filter / opacity animation — why no frost?**
`backdrop-filter` blurs whatever is painted BEHIND the element. An ancestor
with its own `filter`, `backdrop-filter`, or an `opacity` below 1 creates a
new containing context in which the effect can silently disappear. That is
standard browser behavior; animate transforms instead where possible.

**My panel uses a covered token but I never registered — why did it change?**
Fill inheritance is global (see §6): the token overrides live on `body` and
inherit everywhere. Registration only decides whether the sheen/blur chain is
added on top.

**Two plugins registered the same selector — who wins?**
CSS cascade decides (later stylesheet order wins for equal specificity). The
registry emits identical rule text once regardless of how many plugins asked.

---

## 10. Versioning promise

- `version === 1`: the contract above is stable. Additive changes (new
  optional spec fields, new members on the api) may land without a bump.
- Breaking changes bump `version`. Consumers should check `version`
  before calling `register` and degrade gracefully otherwise.
- The global key and event name stay constant across versions so discovery
  code never changes.

## 11. TypeScript declarations (copy into your project)

```ts
export interface GlassSurfaceSpec {
  plugin: string
  selectors: string | readonly string[]
  mode?: 'token' | 'fill'
}

export interface BackgroundGlassApi {
  readonly version: 1
  readonly bridgeId: 'deepseek-harness-background'
  isActive(): boolean
  register(spec: GlassSurfaceSpec): () => void
}

declare global {
  interface Window {
    __DSH_BACKGROUND_GLASS__?: BackgroundGlassApi
  }
}
```

Implementation reference: `src/client/glass-registry.ts` in
`deepseek-harness-background`; behavior locked by
`tests/glass-registry.spec.ts`.
