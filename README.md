<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/banner-dark.svg">
    <img src="docs/banner.svg" alt="DeepSeek Harness Background" width="720">
  </picture>
</p>

# DeepSeek Harness Background

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
[![GitHub stars](https://img.shields.io/github/stars/HaoyueQin/deepseek-harness-background?style=flat-square&logo=github)](https://github.com/HaoyueQin/deepseek-harness-background/stargazers)
[![GitHub release](https://img.shields.io/github/v/release/HaoyueQin/deepseek-harness-background?style=flat-square&logo=github)](https://github.com/HaoyueQin/deepseek-harness-background/releases)
[![npm version](https://img.shields.io/npm/v/deepseek-harness-background?style=flat-square&logo=npm&label=npm)](https://www.npmjs.com/package/deepseek-harness-background)
[![npm downloads](https://img.shields.io/npm/dt/deepseek-harness-background?style=flat-square&logo=npm)](https://www.npmjs.com/package/deepseek-harness-background)
[![CI](https://img.shields.io/github/actions/workflow/status/HaoyueQin/deepseek-harness-background/ci.yml?style=flat-square&logo=githubactions&logoColor=white)](https://github.com/HaoyueQin/deepseek-harness-background/actions)
[![GitHub issues](https://img.shields.io/github/issues/HaoyueQin/deepseek-harness-background?style=flat-square&logo=github)](https://github.com/HaoyueQin/deepseek-harness-background/issues)
[![GitHub last commit](https://img.shields.io/github/last-commit/HaoyueQin/deepseek-harness-background?style=flat-square&logo=github)](https://github.com/HaoyueQin/deepseek-harness-background/commits)
[![Commit activity](https://img.shields.io/github/commit-activity/t/HaoyueQin/deepseek-harness-background?style=flat-square&logo=github)](https://github.com/HaoyueQin/deepseek-harness-background/graphs/commit-activity)
[![Top language](https://img.shields.io/github/languages/top/HaoyueQin/deepseek-harness-background?style=flat-square&logo=typescript)](https://github.com/HaoyueQin/deepseek-harness-background)
[![Repo size](https://img.shields.io/github/repo-size/HaoyueQin/deepseek-harness-background?style=flat-square&logo=github)](https://github.com/HaoyueQin/deepseek-harness-background)
[![License](https://img.shields.io/github/license/HaoyueQin/deepseek-harness-background?style=flat-square)](LICENSE)

[English](README.md) | [中文](README.zh.md)

A custom **background image plugin** for the DeepSeek Harness Web GUI (`dsh web`): upload a local picture, or paste an image URL, and render it behind the whole app surface with adjustable **opacity**, **readability scrim**, **panel transparency** and **frosted-glass blur** — everything live-previewed inside the settings panel and committed automatically on release.

The look (fixed wallpaper layer + theme-aware scrim + translucent glass panels driven by `--dsw-*` design tokens) is modeled on the community `dsh-wallpaper-engine` implementation.

<p align="center">
  <img src="docs/demo.svg" alt="demo: upload a wallpaper, the whole app turns to frosted glass, then jump between turns on the timeline">
</p>

## Screenshots

|  |  |
| --- | --- |
| **Home** | <img src="docs/images/home.jpg" alt="Custom background on the home screen" width="640"> |
| **Conversation** | <img src="docs/images/conversation.jpg" alt="Custom background behind the conversation" width="640"> |
| **Settings** | <img src="docs/images/settings.jpg" alt="Background settings row with live preview" width="640"> |

## Features

- **Local upload** — pick a JPG / PNG / WebP / GIF from your computer; the plugin stores it under the harness home and serves it over a same-origin route (admitted only when the declared MIME, detected signature and extension all agree).
- **Paste a URL** — drop an `http(s)` image link and press Enter.
- **In-panel live preview** — a preview surface at the top of the row renders the image + scrim + a frosted glass bubble; dragging any slider repaints it instantly.
- **Stepped sliders** — ratio controls snap in **5% steps**, blur radii in 1/2px steps; dragging only repaints, **release commits** (one write per gesture, no jank).
- **Five controls** — wallpaper opacity, readability scrim, panel opacity, frosted-glass blur, and wallpaper blur.
- **Fit modes** — `cover` (fill, crop) or `contain` (whole image).
- **Theme-aware scrim** — the light theme uses a white veil (lifts the art so dark text keeps contrast); the dark theme automatically switches to a black veil (dims the art so light text keeps contrast).
- **Frosted glass (whitelisted)** — while a background is active, only the surfaces that float as small cards over the wallpaper turn into translucent glass (specular sheen + `backdrop-filter`): the composer card and message bubbles, code blocks / terminal / diff / tool-IO cards / skill & MCP call cards and inline code, the agent task strips and their takeover panels (approval / question / plan review), the chrome buttons (new session, composer plus, scroll-to-bottom), the load-earlier history button, the subagent lineage popover, the sidebar build badge, and the home hero "preview" badge — every glassed surface carries the full recipe (fill + sheen + blur), never translucency without frost. Reading surfaces — dialogs, the settings UI, menus, tooltips, toasts, hover fills and every accent (the send button stays blue) — keep their **official opaque paints** so nothing legible turns washy (the one documented exception: the turn rail's hover preview, which is rail chrome over the art and joins the glass sheet). The blur radius is driven by the glass-blur slider; `panelOpacity` at 100% restores the official paints on the whitelisted list too.
- **Third-party glass registry** — any plugin can register its own panels into the same frosted-glass system through the published bridge (`window.__DSH_BACKGROUND_GLASS__` global + the `dsh-background-glass:ready` event): *token* mode adds the missing sheen + blur chain when the panel already fills with an overridden `--dsw-*` token, *fill* mode takes the fill over as well; every rule sits under the `data-dsh-bg-glass` gate so it toggles with the glass automatically. Consumers take zero dependencies and degrade gracefully when this plugin is absent; the whole bridge tears down with it. See [docs/GLASS_API.md](docs/GLASS_API.md).
- **Conversation timeline** — the DeepSeek-web turn-navigation rail at the right edge of long conversations, one tick per question, with a hover/focus preview of that turn's prompt. Two frontends, one backend, chosen by what the running kernel supports:
  - **dsh ≥ 0.1.2-rc.1 (enhancement)** — the kernel ships this rail already, so the plugin renders nothing of its own and only fixes its behaviour (a capability check on the rail's own published metrics, never a version compare). Clicks on a **loaded** mark become a **smooth glide** instead of the stock instant jump (ease-in-out, distance-paced, cancelled the moment the reader scrolls, `prefers-reduced-motion` places directly). The rail's full ladder (`turnOutline` outline + loaded window) leaves **unloaded** marks to the kernel's own loadThrough jump — and while one of those kernel jumps is still paging (the mark pulses `aria-busy`) the plugin stands down entirely. Because the official hover preview card paints an opaque fill, it joins the glass sheet under the wallpaper gate instead (same explicit-fill recipe as the composer card, driven by the glass-blur slider); the tick column carries the DeepSeek-web edge dissolve (paint layer only, hit-testing untouched). The rail's active-mark state stays the kernel's own — the glide scrolls the real scrollport, so the stock scroll handler keeps updating it and the persisted scroll position. The bottom-follow state is detached one frame before the glide (streaming growth / turn-end re-renders cannot yank it back to the floor). Toggle it off with the timeline switch in the row.
- **Persisted in the official settings document** (`$DSH_HOME/settings.yaml`), waits out restarts.
- **Clean teardown** — disabling, clearing or uninstalling restores the original background exactly; the plugin only ever removes what it wrote.

## Version compatibility

| Plugin release | Supported dsh versions |
| --- | --- |
| **Current (≥ 0.5.3)** | **dsh ≥ 0.1.2-rc.1** |
| 0.5.2 | dsh 0.1.1-rc.2 and 0.1.2-alpha.1 ~ alpha.5 |

⚠️ **On older dsh (0.1.1-rc.2, 0.1.2-alpha.x or earlier) install an older
plugin release** (`dsh plugin --profile web add deepseek-harness-background@0.5.2`);
this plugin no longer adapts to the pre-rc.1 kernels.

## Install

The plugin is a standard out-of-tree dsh bundle, published on npm:

```sh
dsh plugin --profile web add deepseek-harness-background
```

From a local checkout (development):

```sh
dsh plugin --profile web add /path/to/deepseek-harness-background
```

From a source checkout:

```sh
pnpm dsh plugin --profile web add /path/to/deepseek-harness-background
```

Or from git:

```sh
dsh plugin --profile web add github:<you>/deepseek-harness-background#<commit>
```

Restart to load it:

```sh
dsh --profile web
```

## Usage

1. Start the Web UI (`dsh --profile web`) and open it in a browser.
2. Open **Settings** (bottom-left) → **General** → the **Custom Background** row (in the same area as the Appearance row).
3. **Upload** an image or **paste a URL** — the background applies immediately and the preview surface above updates in sync.
4. Tune the controls — sliders snap in steps and **commit on release**:

| Control | Meaning |
| --- | --- |
| 不透明度 / Opacity | `0..100%` image opacity (5% steps); lowering it fades the wallpaper toward the surface. |
| 遮罩 / Scrim | `0..95%` readability veil over the image (5% steps); white in light mode, black in dark mode. |
| 面板不透明度 / Panel opacity | `0..100%` surface transparency (5% steps); at `100%` the official panels stay opaque (no glass). |
| 毛玻璃模糊 / Glass blur | `0..40px` `backdrop-filter` blur on the translucent surfaces (1px steps). |
| 壁纸模糊 / Wallpaper blur | `0..60px` blur of the wallpaper image itself (2px steps). |
| 填充方式 / Fit | `cover` or `contain`. |
| 会话时间线 / Timeline | on/off switch for the conversation timeline (default on). On dsh ≥ 0.1.2-rc.1 the row is labelled 会话时间线增强 / *enhancement*: the official rail stays and this only improves its behaviour (smooth jumps for loaded turns); turning it off restores stock behaviour. |

5. **清除背景** removes the background and restores the stock look.

## How it works

- The **settings row** lives in the official General settings section (`settings.general.item` slot), next to the Appearance row. Its chrome uses only `--dsw-alias-*` design tokens (buttons / pills / segmented control / slider track match the official shell); sliders are native `input[type=range]` with 5% / 1–2px steps and release-commit.
- The plugin's own host routes (`/api/bg-wallpaper/*`: `settings`, `upload`, `image/<id>`) read/write the section and serve uploads with same-origin + size caps + MIME/signature checks + a path-escape fence. A custom route family is used because the api-proxy settings allowlist does not expose third-party namespaces over the settings RPC.
- The background is drawn as a fixed `z-index:-2` wallpaper layer plus a `z-index:-1` scrim on `body`, toggled by the `data-dsh-bg` attribute; the scrim switches white/black by `data-ds-dark-theme` in the injected stylesheet. Frosted glass is whitelist-scoped: only the whitelisted surfaces get `--dsw-*` surface-token overrides, while everything else is painted by explicit `data-dsh-bg-glass`-gated rules carrying the FULL recipe (fill + sheen + blur chain): the three chrome buttons, the load-earlier history button, the composer dock family (agent task strips TodoPanel / GoalBar / QueueDock and their takeover panels — approval, question, plan review — whose tokens turn translucent and need the blur added), the subagent lineage popover, the home hero preview badge and the sidebar build badge — every other official token and reading surface (menus, dialogs, tooltips, toasts) stays untouched.
- The **timeline** is registered into the `conversation.input.dock` slot (per-session lifecycle). Detection is a capability check on the slot props rather than a version compare: the official rail is rendered from the very index `ui-chat` publishes as a session hook (`useChat(s => s.navigation.items())`, dsh >= 0.1.2), so the presence of that hook *is* the presence of the official rail — and it survives pre-releases, forks and deployments that mount a different conversation target. With the hook the plugin renders nothing and intercepts clicks on the official rail's **loaded** marks in the **capture** phase (React 18 dispatches `onClick` from the root container during the bubble phase, so a capture listener on the rail runs first and `stopImmediatePropagation()` keeps the stock handler from ever firing) — resolving the click index against the merged ladder the kernel actually renders (`turnOutline` outline + loaded window, mirroring `mergeTurnRailItems` in ui-chat), with marks outside the loaded window (no anchor key) left to the kernel's own load-through jump — and while one of those kernel jumps is still paging (a mark pulses `aria-busy`) the plugin stands down entirely, because the kernel's loaded branch cancels its own pending jump before landing and an interception would bypass that cancellation. The official hover preview joins the glass sheet under the wallpaper gate (same explicit fill recipe as the composer card), and the tick column carries the DeepSeek-web edge dissolve. Supported baseline: dsh >= `0.1.2-rc.1`; older dsh (0.1.2-alpha.x and 0.1.1-rc.2 or earlier) installs an older plugin release (see Version compatibility).
- The **third-party glass registry** (`src/client/glass-registry.ts`) publishes its bridge on client apply — before any repaint can race it: `register({ plugin, selectors, mode })` is idempotent per (plugin, mode, selector) triple and synthesizes explicit `body[data-dsh-bg-glass]`-gated recipe rules into a dedicated `<style data-plugin-css>` tag; selectors are structurally validated first (no `{ } ; @ < > ,`, no backslashes, 500-char cap) with per-selector warn-and-drop that never blocks valid siblings; disposing the client fiber retracts the whole bridge (stylesheet, entries, window key). Contract docs in `docs/GLASS_API.md` / `GLASS_API.zh.md`; behavior locked by `tests/glass-registry.spec.ts`.
- Uploads live under `$DSH_HOME/deepseek-harness-background/` (content-addressed ids). Switching to a new image or clearing the background deletes the superseded upload file, so the directory does not accumulate dead images in normal use. (An upload that is never saved into the section — e.g. the tab closes right after an upload — can leave one orphaned file behind.) Disable / uninstall leaves nothing behind.

## Development

```sh
pnpm install          # first time; runs prepare (build)
pnpm run typecheck    # tsc
pnpm test             # vitest contract tests
pnpm run build        # tsdown: lib/index.js (host) + lib/client.js (browser bundle)
```

```
deepseek-harness-background/          # the plugin repo (package name stays the npm-style id)
├── package.json          # dsh.bundle.patch + dsh.client.inject declarations
├── cordis.patch.yml      # inserts the deepseek-harness-background row into the web roster
├── tsdown.config.ts      # official clientBundle preset
├── src/
│   ├── index.ts          # host half: ui-background namespace + API routes
│   ├── routes.ts         # /api/bg-wallpaper/{settings,upload,image/<id>}
│   ├── schema.ts         # host-side schemastery schema
│   ├── settings.ts       # constants/types shared with the client
│   ├── harness-home.ts   # $DSH_HOME / ~/.dsh resolution
│   └── client/
│       ├── index.ts          # painter lifecycle + settings row registration
│       ├── backdrop.ts       # fixed wallpaper layer + scrim + glass surface + preview vars
│       ├── background-css.ts # injected stylesheet (layers, glass, light/dark scrim, variables, read_image card)
│       ├── glass-registry.ts # third-party glass registry (window bridge + gated rule synthesis)
│       ├── timeline/
│       │   ├── index.tsx            # dock entry: official-rail capability probe + re-exports
│       │   ├── official-enhance.tsx # dsh>=0.1.2-rc.1: smooth-jump interception for loaded marks
│       │   ├── jump.ts              # shared jump engine (paging + glide)
│       │   ├── rail-pointer.ts      # frame-rail tick geometry & full-ladder merge
│       │   └── types.ts             # shared shapes
│       ├── SettingsRow.tsx   # the General-settings row (preview surface + stepped sliders)
│       ├── SettingsRow.module.css # row styles (official tokens)
│       ├── settings-client.ts# fetch transport (read/write/upload)
│       └── locales.ts        # zh/en copy
└── tests/                  # schema, routes, apply (painter), settings-row contracts
```

## Activity

[![HaoyueQin/deepseek-harness-background GitStock K-Line Chart](https://gitstock.org/HaoyueQin/deepseek-harness-background/stock.svg)](https://gitstock.org/HaoyueQin/deepseek-harness-background)

## License

MIT
