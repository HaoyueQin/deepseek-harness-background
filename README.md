# deepseek-harness-background

[English](README.md) | [中文](README.zh.md)

A custom **background image plugin** for the DeepSeek Harness Web GUI (`dsh web`): upload a local picture, or paste an image URL, and render it behind the whole app surface with adjustable **opacity**, **readability scrim**, **panel transparency** and **frosted-glass blur** — everything live-previewed and persisted automatically.

The look (fixed wallpaper layer + scrim + translucent glass panels driven by `--dsw-*` design tokens) is modeled on the community `dsh-wallpaper-engine` and `DeepSeek-Reasonix` wallpaper themes.

## Features

- **Local upload** — pick a JPG / PNG / WebP / GIF from your computer; the plugin stores it under the harness home and serves it over a same-origin route (admitted only when the declared MIME, detected signature and extension all agree).
- **Paste a URL** — drop an `http(s)` image link and press Enter.
- **Live preview** — dragging any slider repaints immediately; what you see is what persists.
- **Five controls** — wallpaper opacity, readability scrim, panel opacity, frosted-glass blur, and wallpaper blur.
- **Fit modes** — `cover` (fill, crop) or `contain` (whole image).
- **Frosted glass** — while a background is active, the composer card and message bubbles turn into translucent glass over the wallpaper (specular sheen + `backdrop-filter`), with the blur radius driven by the glass-blur slider. `panelOpacity` at 100% restores the official opaque surfaces.
- **Persisted in the official settings document** (`$DSH_HOME/settings.yaml`), waits out restarts.
- **Clean teardown** — disabling, clearing or uninstalling restores the original background exactly; the plugin only ever removes what it wrote.

## Install

The plugin is a standard out-of-tree dsh bundle:

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
3. **Upload** an image or **paste a URL** — the background applies immediately.
4. Tune the controls — each slider is live:

| Control | Meaning |
| --- | --- |
| 不透明度 / Opacity | `0..1` image opacity; lowering it fades the wallpaper toward the surface. |
| 遮罩 / Scrim | `0..0.95` readability veil over the image so text stays legible. |
| 面板不透明度 / Panel opacity | `0..1` surface transparency; at `1` the official panels stay opaque (no glass). |
| 毛玻璃模糊 / Glass blur | `0..40px` `backdrop-filter` blur on the translucent surfaces. |
| 壁纸模糊 / Wallpaper blur | `0..60px` blur of the wallpaper image itself. |
| 填充方式 / Fit | `cover` or `contain`. |

5. **清除背景** removes the background and restores the stock look.

## How it works

- The **settings row** lives in the official General settings section (`settings.general.item` slot), next to the Appearance row.
- The plugin's own host routes (`/api/bg-wallpaper/*`: `settings`, `upload`, `image/<id>`) read/write the section and serve uploads with same-origin + size caps + MIME/signature checks + a path-escape fence. A custom route family is used because the api-proxy settings allowlist does not expose third-party namespaces over the settings RPC.
- The background is drawn as a fixed `z-index:-2` wallpaper layer plus a `z-index:-1` scrim on `body`, toggled by the `data-dsh-bg` attribute; the frosted-glass effect overrides the shell's surface design tokens.
- Uploads live under `$DSH_HOME/deepseek-harness-background/` (content-addressed ids). Disable / uninstall leaves nothing behind.

## Development

```sh
pnpm install          # first time; runs prepare (build)
pnpm run typecheck    # tsc
pnpm test             # vitest contract tests
pnpm run build        # tsdown: lib/index.js (host) + lib/client.js (browser bundle)
```

```
deepseek-harness-background/
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
│       ├── backdrop.ts       # fixed wallpaper layer + scrim + glass surface
│       ├── background-css.ts # injected stylesheet (layers, glass, variables)
│       ├── SettingsRow.tsx   # the General-settings live row
│       ├── settings-client.ts# fetch transport (read/write/upload)
│       └── locales.ts        # zh/en copy
└── tests/                  # schema, routes, apply (painter) contracts
```

## License

MIT
