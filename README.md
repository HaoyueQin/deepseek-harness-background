# DeepSeek Harness Background

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
[![GitHub stars](https://img.shields.io/github/stars/HaoyueQin/deepseek-harness-background?style=flat-square&logo=github)](https://github.com/HaoyueQin/deepseek-harness-background/stargazers)
[![GitHub release](https://img.shields.io/github/v/release/HaoyueQin/deepseek-harness-background?style=flat-square&logo=github)](https://github.com/HaoyueQin/deepseek-harness-background/releases)
[![npm version](https://img.shields.io/npm/v/deepseek-harness-background?style=flat-square&logo=npm&label=npm)](https://www.npmjs.com/package/deepseek-harness-background)
[![npm downloads](https://img.shields.io/npm/dt/deepseek-harness-background?style=flat-square&logo=npm)](https://www.npmjs.com/package/deepseek-harness-background)
[![CI](https://img.shields.io/github/actions/workflow/status/HaoyueQin/deepseek-harness-background/ci.yml?style=flat-square&logo=githubactions&logoColor=white)](https://github.com/HaoyueQin/deepseek-harness-background/actions)
[![GitHub issues](https://img.shields.io/github/issues/HaoyueQin/deepseek-harness-background?style=flat-square&logo=github)](https://github.com/HaoyueQin/deepseek-harness-background/issues)
[![GitHub last commit](https://img.shields.io/github/last-commit/HaoyueQin/deepseek-harness-background?style=flat-square&logo=github)](https://github.com/HaoyueQin/deepseek-harness-background/commits)
[![Top language](https://img.shields.io/github/languages/top/HaoyueQin/deepseek-harness-background?style=flat-square&logo=typescript)](https://github.com/HaoyueQin/deepseek-harness-background)
[![Repo size](https://img.shields.io/github/repo-size/HaoyueQin/deepseek-harness-background?style=flat-square&logo=github)](https://github.com/HaoyueQin/deepseek-harness-background)
[![License](https://img.shields.io/github/license/HaoyueQin/deepseek-harness-background?style=flat-square)](LICENSE)

[English](README.md) | [中文](README.zh.md)

A custom **background image plugin** for the DeepSeek Harness Web GUI (`dsh web`): upload a local picture, or paste an image URL, and render it behind the whole app surface with adjustable **opacity**, **readability scrim**, **panel transparency** and **frosted-glass blur** — everything live-previewed inside the settings panel and committed automatically on release.

The look (fixed wallpaper layer + theme-aware scrim + translucent glass panels driven by `--dsw-*` design tokens) is modeled on the community `dsh-wallpaper-engine` implementation.

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
- **Frosted glass (whitelisted)** — while a background is active, only the surfaces that float as small cards over the wallpaper turn into translucent glass (specular sheen + `backdrop-filter`): the composer card and message bubbles, code blocks / terminal / diff / tool-IO cards / skill & MCP call cards and inline code, the agent task strip, the chrome buttons (new session, composer plus, scroll-to-bottom), the subagent lineage popover, and the home hero "preview" badge. Reading surfaces — dialogs, the settings UI, menus, tooltips, toasts, hover fills and every accent (the send button stays blue) — keep their **official opaque paints** so nothing legible turns washy. The blur radius is driven by the glass-blur slider; `panelOpacity` at 100% restores the official paints on the whitelisted list too.
- **Conversation timeline** — a DeepSeek-web-style scroll-navigation rail at the right edge of long conversations: one tick per user message on a frosted capsule; hovering expands it into a frosted panel listing every question (active one highlighted in brand blue); clicking jumps the chat to that message. **Key-point bookmarks** — star a question in the expanded panel (persisted per session): marked questions show a golden tick in the collapsed capsule and a "★ marked only" filter narrows the list. Jumps freeze the reading-position tracker until scrolling settles (no mid-jump jitter), and messages withdrawn by a rewind are dropped from the rail automatically. Collapsed and expanded share **one identical height** (no jump), clipped edges get the official **32px fade veils**, and the rail keeps the official DeepSeek frosted paints independent of the panel knobs. Toggle it off with the timeline switch in the row. If the third-party dsh-chat-timeline plugin is also installed, this rail steps aside instead of doubling it.
- **Persisted in the official settings document** (`$DSH_HOME/settings.yaml`), waits out restarts.
- **Clean teardown** — disabling, clearing or uninstalling restores the original background exactly; the plugin only ever removes what it wrote.

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
| 会话时间线 / Timeline | on/off switch for the conversation timeline rail (default on). |

5. **清除背景** removes the background and restores the stock look.

## How it works

- The **settings row** lives in the official General settings section (`settings.general.item` slot), next to the Appearance row. Its chrome uses only `--dsw-alias-*` design tokens (buttons / pills / segmented control / slider track match the official shell); sliders are native `input[type=range]` with 5% / 1–2px steps and release-commit.
- The plugin's own host routes (`/api/bg-wallpaper/*`: `settings`, `upload`, `image/<id>`) read/write the section and serve uploads with same-origin + size caps + MIME/signature checks + a path-escape fence. A custom route family is used because the api-proxy settings allowlist does not expose third-party namespaces over the settings RPC.
- The background is drawn as a fixed `z-index:-2` wallpaper layer plus a `z-index:-1` scrim on `body`, toggled by the `data-dsh-bg` attribute; the scrim switches white/black by `data-ds-dark-theme` in the injected stylesheet. Frosted glass is whitelist-scoped: only the whitelisted surfaces get `--dsw-*` surface-token overrides, while the buttons / popovers / badge are painted by explicit `data-dsh-bg-glass`-gated rules — every other official token and reading surface stays untouched.
- The **timeline rail** is registered into the `conversation.input.dock` slot (per-session lifecycle) and portals to `body`. Its data comes from the runtime sessions service (loaded chat nodes, then a bounded loadOlder loop); bookmarks persist in localStorage per session, and the rail carries the official DeepSeek frosted paints independent of the plugin's token overrides.
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
│       ├── background-css.ts # injected stylesheet (layers, glass, light/dark scrim, variables)
│       ├── timeline.tsx     # conversation timeline rail (ScrollNav port on the glass system)
│       ├── timeline-css.ts  # timeline stylesheet (dsbt- prefixed, official metrics)
│       ├── SettingsRow.tsx   # the General-settings row (preview surface + stepped sliders)
│       ├── SettingsRow.module.css # row styles (official tokens)
│       ├── settings-client.ts# fetch transport (read/write/upload)
│       └── locales.ts        # zh/en copy
└── tests/                  # schema, routes, apply (painter), settings-row contracts
```

## License

MIT
