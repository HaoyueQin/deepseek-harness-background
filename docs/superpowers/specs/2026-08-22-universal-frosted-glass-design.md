# Universal frosted glass — design

> **SUPERSEDED (2026-08-23):** the universal scope proved too aggressive —
> reading surfaces (settings UI, dialogs, menus, tooltips) turned washy. The
> shipped design is a WHITELIST: glass only on surfaces that float as small
> cards over the wallpaper (composer, bubbles, code/tool-IO/skill cards,
> task strip, the three chrome buttons, subagent popover, hero preview badge)
> plus the self-frosted timeline rail; every other surface keeps official
> paints via the `data-dsh-bg-glass` gate. See src/client/background-css.ts.

Date: 2026-08-22
Scope: extend the existing wallpaper plugin so every opaque UI surface (not
just the composer card and message bubbles) turns into the same frosted glass,
driven by the existing `panelOpacity` / `blur` settings. Also record the
0.1.1-rc.2 adaptation conclusion (no code change required there; deps bumped).

## Upstream adaptation (0.1.1-rc.2)

Diff `dsh-v0.1.1-rc.1..dsh-v0.1.1-rc.2` over the plugin-facing packages:

- `dsh-client-ui-slots`, `dsh-client-locale`, `dsh-settings`, `dsh-host-webserver`:
  version bumps only, zero API change.
- `dsh-client-runtime`: `SessionsPort.create` dropped `sessionId` /
  `reuseWorkspaceBlank` (the breaking change heard about) plus internal
  workspace-manager refactors. The plugin never imports `SessionsPort`; its
  imports are `cordis`, `dsh-settings`, `dsh-host-webserver`, `schemastery`,
  `dsh-client-ui-slots` only.
- Web UI sources (`packages/web/web`, `apps/web` src): unchanged (tests and
  snapshots only). All DOM anchors below are valid on rc.2.

Action: bump the six `@deepseek-ai/*` ranges `^0.1.1-rc.1 → ^0.1.1-rc.2`
(semver: same-tuple prereleases already matched, the bump documents intent).

## Audit result (what is opaque today)

The painter already transparentizes `--dsw-alias-bg-base` and
`--dsw-specific-sidebar-fill`. An exhaustive sweep of `packages/client/ui-*`
(~80 surfaces, verified per file) shows every remaining opaque fill flows
through ~20 `--dsw-*` tokens defined on `body` in
`ui-theme/src/styles/design-platform.css` — plus three literal-color spots
(HoverCard `#2C2C2E`, buildRevision badge painted with the label-ink token,
hero glow asset). Token values verified in both themes.

## Design

Two mechanisms, exactly like today's composer/bubble glass, just widened:

1. **Translucency via token overrides** on `document.body` inline style
   (beats the theme's `body {}` rule for the whole subtree). Extends the
   existing `SURFACE_TOKENS` save/restore list, the `panelOpacity >= 1`
   restore gate, and the `data-ds-dark-theme` observer repaint — all already
   generic loops.
2. **Frosted blur + sheen via the injected stylesheet**, scoped to
   `body[data-dsh-bg]`, reusing the existing effect block (sheen gradient,
   `backdrop-filter: blur(var(--bg-glass-blur)) …`, glassy box-shadow).

### Token families

**Surface family** — white-glass curve, i.e. today's `glassSurfaceAlphas`
(`alpha = 0.05 + panelOpacity * 0.85`, theme factor 0.8 light / 0.4 dark),
relative factor noted:

| token | factor | covers |
|---|---|---|
| `--dsw-specific-input-major` (existing) | 1.0 | composer card, approval/question/plan-review cards, attachment chips, lightbox bar |
| `--dsw-specific-bubble` (existing) | 0.8 | message bubbles |
| `--dsw-specific-menu` | 1.0 | all menus/popovers (Menu primitive, model select, slash-command palette, input-trigger menus, context meter, feedback panel, lineage popover, jobs menu) |
| `--dsw-alias-bg-layer-1/2/3` | 1.0 | modal dialogs, settings panel, trajectory views, plugin cards, pills, JSON tree |
| `--dsw-alias-markdown-code-block` | 1.0 | code blocks, terminal, diff, read/search/web/json cards, tool IO cards |
| `--dsw-alias-markdown-code-block-banner` | 1.0 | code-block header bars |
| `--dsw-alias-markdown-inline-code` | 0.9 | inline code chips |
| `--dsw-alias-bg-module-platform` | 1.0 | settings form selects |
| `--dsw-alias-bg-overlay` | 1.0 | overlay chips |
| `--dsw-specific-tip` | 1.0 | todo/goal/queue dock cards |
| `--dsw-specific-selector` | 0.9 | composer plus button |
| `--dsw-alias-button-elevated-fill` | 0.9 | new-session button, rename input |
| `--dsw-alias-button-floating-fill` | 0.9 | scroll-to-bottom, column drag handles |
| `--dsw-alias-interactive-bg-hover-solid` | 0.9 | hovered rows/chips (load-older button, plus hover) |

**Accent family** — keep the official hue, alpha `clamp(0.45 + alpha, ≤0.92)`
(small controls stay readable), rgb from `--dsw-static-*` values:

| token | light rgb | dark rgb |
|---|---|---|
| `--dsw-alias-button-info-fill` (send) | 65,118,230 | 103,158,254 |
| `--dsw-alias-button-primary-fill` | 15,17,21 | 249,250,251 |
| `--dsw-alias-button-contrast-fill` (toast, attachment remove) | 97,102,107 | 249,250,251 |
| `--dsw-alias-tooltip-bg` | 44,44,46 | 67,69,74 |
| `--dsw-alias-state-warn-tertiary` (plan chip, warning bands) | 254,245,231 | 39,36,31 |

**Deliberately untouched**: mask/veil tokens (by design), skeleton shimmer,
scrollbar tokens (thin, theme-owned), connection banner (semantic alert),
boot page (transient), `--dsw-alias-label-primary` (text token — the
buildRevision badge gets a selector-based background instead), semantic
success/error tertiary tints (rare, keep official), HoverCard literal
`#2C2C2E` (no unique anchor; stays opaque — known limitation).

### Blur/sheen selector list (all `body[data-dsh-bg]`-scoped)

```
.md-code-block                                  /* :global anchor, code cards */
[data-terminal], [data-diff], [data-read], [data-search], [data-web]
[class*="_ioCard"]                              /* tool IO cards */
[class*="_markdown"] :not(pre) > code           /* inline code */
[role="menu"]                                   /* every menu (DOM-verified) */
[class*="_dialog"], [class*="_panel"]           /* modals, settings, docks */
[class*="_card"]                                /* approval/plan/feedback/plugin cards */
[class*="_newSession"], [class*="_add"], [class*="_primary"], [class$="_rail"],
[class*="_toBottom"], [class*="_toast"]         /* buttons & chips */
```

Collision audit (all `*.module.css` in `packages/client/*/src`):

- `[class$="_rail"]` — end-anchored so sidebar's `.railIn` modifier (a
  full-height transparent container) does NOT match; AttachmentRail's rail
  is single-class (`className={css.rail}`).
- `[class*="_add"]` extra hits (`.addCard/.addButton/...`) live inside the
  glassed settings panel — nested glass, benign.
- `[class*="_panel"]` extra hits (`.panelImage/.usagePanel`) are trajectory
  cells inside a glassed page — benign.
- `[class*="_card"]`, `[class*="_dialog"]`, `[class*="_primary"]`,
  `[class*="_toast"]`, `[class*="_newSession"]`, `_ioCard`: hits are all
  filled card/button surfaces.
- Plugin's own `SettingsRow` classes don't match (`.btnPrimary` ≠ `_primary`;
  CSS attribute selectors are case-sensitive).

Special rules:

- Code-block sticky `bannerWrap` officially occludes with `bg-base` (now
  transparent): give it the banner token fill + glass so scrolled code
  doesn't slide visibly under the sticky header.
- Empty-state hero glow asset would cover the wallpaper: dim to 0.2.
- buildRevision badge: theme-aware translucent ink background
  (`rgba(15,17,21,.62)` light / `rgba(249,250,251,.62)` dark).

Hover-state shorthand (`background:` on `.add:hover` etc.) resets the sheen
gradient while hovered — accepted (blur + translucency persist).

## Error handling / retraction

Unchanged semantics, widened lists: every new token flows through
`rememberOnce` → restore on dispose / on `panelOpacity === 1` / on empty
source; theme flips repaint via the existing observer. If the host renames a
token in a future release, an override simply stops matching (official opaque
surface returns) — graceful degradation, no breakage.

## Testing

TDD against `tests/apply.spec.ts` (jsdom, real painter):

1. painted body carries the new surface + accent tokens as `rgba(...)` ;
2. `panelOpacity: 1` clears all of them and zeroes the blur var;
3. theme flip repaints accent tokens (rgb triplet changes);
4. a pre-existing inline token value is restored on dispose;
5. `BACKGROUND_CSS` contains the new anchors (`.md-code-block`, `[role="menu"]`,
   `_newSession`, `_add`, inline-code selector, heroGlow dim);
6. full existing suite stays green; typecheck + build pass.

## Steps → verification

1. Design doc (this file) → committed only on user request.
2. Failing tests → `pnpm test` red on the new assertions.
3. Implement token table + CSS → `pnpm test` green, `pnpm typecheck`, `pnpm build`.
4. Deps `^0.1.1-rc.2` + `pnpm install` → lockfile updated, suite green again.
5. README/README.zh coverage note → docs match behavior.

## Post-review calibration (2026-08-22, same day)

User feedback: bright wallpapers blew out through the glass. Root cause was
layer stacking, confirmed in code: the CSS `brightness(1.04)` fallback was
**never written by the painter** (a latent bug — the var existed but nothing
set it), `saturate` reached 1.63 at the default 16px (2.35 at 40px), and the
white sheen added up to 0.16 alpha on top of the token fill. Mainstream
recipes (macOS vibrancy, Windows 11 acrylic, common web glass) blur +
saturate + tint and never stack a positive brightness gain.

Calibration applied (theme-aware, written by the painter as
`--bg-glass-brightness` / `--bg-glass-sheen` / `--bg-glass-sheen-mid`):

| param | light | dark (unchanged) |
|---|---|---|
| brightness | 0.98 | 1.04 |
| sheen top / mid | 0.07 / 0.02 | 0.16 / 0.05 |
| saturate | 1.1 + blur·0.02, capped 1.6 (both schemes; was 1.15 + blur·0.03 uncapped) | same |

Glass-off (panelOpacity 1 / no source) now also neutralizes brightness to 1.
The settings-row preview filter gained the same `brightness()` term so the
card can't read brighter than the live surfaces. Version stays 0.2.1 — no
release bump without the user's say-so.

## 0.3.0 — conversation timeline + second-wave glass coverage

Date: 2026-08-22

### Timeline rail (DeepSeek web ScrollNav port)

Official design extracted from chat.deepseek.com's shipped bundle
(main.e80cdf62f5.js CSS-module map + main.1dbdc179ba.css; saved under
.research/): nav `_189b4a0` (34x300 fixed right edge, vertically centered),
capsule `_6ffc3c9` (blur 5px, rgba(255,255,255,.8)/dark rgba(21,21,23,.6)),
wrapper `_4ce999d` (fit-content max 240px, radius 16, show state =
--dsw-alias-bg-layer-1 + --dsw-shadow-lv3 + inverted border), fade veils
(::before/::after, 32px linear-gradient(fill 20.19%, transparent), shown by
.show and per-scroll top/bottom/none classes), page `_8dbd25b` (max-height
250px), items 30px, indicator 8x2 scale(1.5) active in brand color, title
13px fades in. The third-party dsh-chat-timeline port deviated: near-opaque
panel fills (.94/.95), collapsed capsule height vs content-sized panel
(height jump), and no fade veils at all.

Rebuilt in this plugin (`src/client/timeline.tsx` + `timeline-css.ts`,
`dsbt-` prefix avoids every `[class*="_xxx"]` glass anchor):

- **Glass integration**: capsule fill = overridden `--dsw-alias-bg-overlay`;
  expanded panel fill = official `--dsw-alias-bg-layer-1`; both blur via the
  shared --bg-glass-* knobs. panelOpacity drives them live; glass-off
  restores the official opaque surfaces automatically.
- **Equal heights**: --dsbt-h = clamp(count*30 + 38, 140, 300) on the nav;
  capsule and expanded panel share that exact box — no jump on expand.
- **Fade veils** as elements: a bar of the panel's own fill token masked
  (linear-gradient #000 20.19% -> transparent), rotated for the bottom edge;
  visibility follows the page's real scroll clip state.
- **Width**: >8 messages -> 240px; otherwise canvas-measured longest title
  clamped to [96, 240]; animates from the 34px collapsed width.
- **Data/jump logic** adapted from dsh-chat-timeline (MIT): chat-node
  collector -> bounded loadOlder loop; click loads history on demand then
  scrolls the row into view; reading position tracked nearest the 40%
  viewport line; right-edge avoidance from the conversation scrollport;
  hidden <768px; yields when a .dsct_nav (the other plugin) exists.

Settings: `timeline` boolean (default on) end-to-end — schema default,
routes validation ('invalid-timeline'), BACKGROUND_SETTINGS_FIELDS whitelist,
General-row switch, locale keys (background.timeline/timelineHint,
timeline.railLabel/roleUser/noText).

### Second-wave glass coverage (audit of packages/client @ this checkout)

Swept every background declaration across all client UI sources (891 files)
and bucketed by token vs literal. New surface overrides:
--dsw-alias-button-floating-hover / button-ghost-active-fill /
button-tool-bar-fill / button-tool-bar-hover (composer tool-row chips) /
specific-sidebar-nav-item-hover / specific-sidebar-nav-item-active.
New accent overrides (hue kept): button-info-hover, button-primary-hover,
state-business-tertiary, state-success-tertiary. HoverCard's component-level
ink (--dsw-hovercard-bg: #2C2C2E — the old audit's known limitation) is
re-scoped to a translucent ink via a body[data-dsh-bg] [_card] variable rule;
only HoverCard consumes it. The universal sheet gains [class*="_toolbar"]
(unique in-tree).

Deliberately NOT overridden, verified against definitions/usages:
interactive-bg-hover/-active/-hover-danger are already rgba translucent;
state-{business,error,success,warn}-primary are consumed as color/outline/
border/stroke far too widely (a global override would wash text);
fill-l2/fill-tsp-secondary are undefined tokens (render transparent);
mask/label/skeleton/boot families stay official as before.
