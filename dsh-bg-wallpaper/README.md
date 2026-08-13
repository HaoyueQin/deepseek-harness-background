# dsh-bg-wallpaper

[![GitHub stars](https://img.shields.io/github/stars/HaoyueQin/deepseek-harness-background?style=flat-square&logo=github)](https://github.com/HaoyueQin/deepseek-harness-background/stargazers)
[![GitHub release](https://img.shields.io/github/v/release/HaoyueQin/deepseek-harness-background?style=flat-square&logo=github)](https://github.com/HaoyueQin/deepseek-harness-background/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/HaoyueQin/deepseek-harness-background/ci.yml?style=flat-square&logo=githubactions&logoColor=white)](https://github.com/HaoyueQin/deepseek-harness-background/actions)
[![GitHub issues](https://img.shields.io/github/issues/HaoyueQin/deepseek-harness-background?style=flat-square&logo=github)](https://github.com/HaoyueQin/deepseek-harness-background/issues)
[![GitHub last commit](https://img.shields.io/github/last-commit/HaoyueQin/deepseek-harness-background?style=flat-square&logo=github)](https://github.com/HaoyueQin/deepseek-harness-background/commits)
[![License](https://img.shields.io/github/license/HaoyueQin/deepseek-harness-background?style=flat-square)](LICENSE)

English | [中文](README.zh.md)

A user-customizable background image plugin for the DeepSeek Harness Web GUI. Set a background image (one per light/dark theme) behind the whole app surface, tune opacity and a readability scrim with a live preview, and edit everything from the plugin settings page.

## Features

- **Settings entry in the official settings page** — a "Custom Background" card in the plugin configuration section; click it to open the self-drawn settings overlay.
- **Light/dark images** — one URL per color scheme, swapped live when the theme flips (no reload).
- **Opacity & scrim sliders with live preview** — what you see in the preview is exactly what the app paints.
- **Fit modes** — `cover` (fills the frame, crops) or `contain` (fits the whole image, letterboxes).
- **Persisted in the official settings document** — `$DSH_HOME/settings.yaml`, survives restarts; external edits hot-reload.
- **Clean teardown** — disabling or uninstalling restores the original background exactly; the plugin only ever removes what it wrote.

## Installation

The plugin is a standard out-of-tree dsh bundle. Install it with the dsh CLI:

```sh
dsh plugin --profile web add /path/to/dsh-bg-wallpaper
```

From a fresh source checkout, run the same command through pnpm:

```sh
pnpm dsh plugin --profile web add /path/to/dsh-bg-wallpaper
```

`dsh plugin add` links the package into the profile and appends it to `dsh.profile.bundles`. Restart the server to load it:

```sh
dsh --profile web
```

### Installing from git

```sh
dsh plugin --profile web add github:you/dsh-bg-wallpaper#<commit>
```

A git install fetches sources, and pnpm runs the `prepare` script to build `lib/` afterwards. pnpm ≥ 10 refuses to run a git dependency's `prepare` until it is explicitly allowlisted: copy the exact package key pnpm prints into the profile's `pnpm-workspace.yaml` `allowBuilds` section and re-run the `add`. Only allow packages whose source you trust.

### Local checkout installs

`dsh plugin add ./path` is a pnpm **link** — the built `lib/` is used as-is and no `prepare` runs. After changing the source, rebuild before restarting:

```sh
cd dsh-bg-wallpaper && pnpm run build
```

## Usage

1. Start the Web UI: `dsh --profile web`, open the printed URL in a browser.
2. Open **Settings** (bottom-left) → **Plugins** → find the **Custom Background** card.
3. Click the card — a settings overlay opens with a live preview of the background.
4. Configure the section:

| Control | Meaning |
| --- | --- |
| Enabled | Render the custom background at all. |
| Light image / Dark image | Background image URLs for the light and dark color schemes (http(s) or any URL the browser can load). |
| Opacity | `0..1` image opacity; lowering it fades the image toward the surface color. |
| Scrim | `0..0.95` readability veil over the image — white over light art, black over dark art. |
| Fit | `cover` (fill, crop) or `contain` (whole image, letterboxed). |

5. Click **Save** — the preview and the live background are the same picture; the section persists across restarts.
6. Switch the color scheme — the background swaps images immediately.

## Configuration file

The section lives in the official settings document and hot-reloads on external edits:

```yaml
ui-background:
  enabled: true
  lightUrl: https://example.com/light.jpg
  darkUrl: https://example.com/dark.jpg
  opacity: 0.8
  scrim: 0.3
  fit: cover
```

## How it works

- The settings **entry card** is registered into the official `settings.plugin.item` slot; the editable **overlay** floats over the whole app through the `shell.overlay` slot.
- The plugin's own host route (`/api/bg-wallpaper/settings`, GET/POST, same-origin fence) reads and writes the section through the settings provider. A custom route family is used because the api-proxy settings allowlist does not expose third-party namespaces over the settings RPC.
- The background is painted on `body` as three stacked layers — a surface fade at `1 - opacity`, a readability veil at `scrim`, then the image — and swaps live on `data-ds-dark-theme` changes.
- Every write is recorded and restored on disable/unload; the `data-ds-dark-theme` observer is disconnected on dispose.

## Development

```sh
pnpm install          # first time; runs prepare (build)
pnpm run typecheck    # tsc
pnpm test             # vitest + jsdom contract tests
pnpm run build        # tsdown: lib/index.js (host) + lib/client.js (browser bundle)
```

```
dsh-bg-wallpaper/
├── package.json          # dsh.bundle.patch + dsh.client.inject declarations
├── cordis.patch.yml      # inserts the ui-bg-wallpaper row into the web plugin roster
├── tsdown.config.ts      # official clientBundle preset (self-contained port)
├── src/
│   ├── index.ts          # host half: ui-background namespace + API routes
│   ├── routes.ts         # /api/bg-wallpaper/settings (GET/POST, same-origin fence)
│   ├── schema.ts         # host-side schemastery schema
│   ├── settings.ts       # constants/types shared with the client
│   └── client/
│       ├── index.ts          # background painter + entry card/overlay registration
│       ├── entry-card.tsx    # settings-page entry card (opens the overlay)
│       ├── overlay.tsx       # self-drawn settings overlay (live preview + controls)
│       ├── settings-client.ts# fetch transport for the section
│       └── locales.ts        # zh/en copy
└── tests/                   # 16 contract tests (painter, overlay, entry card, schema)
```

## Feedback

Questions, suggestions, or problems? Open an [issue](https://github.com/HaoyueQin/deepseek-harness-background/issues) — feature ideas, compatibility reports, and edge cases are all welcome. When reporting a bug, please include the dsh version you run (`dsh --version`) and the plugin revision, so it can be reproduced quickly.

## License

MIT
