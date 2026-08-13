# dsh-bg-wallpaper

[![GitHub stars](https://img.shields.io/github/stars/HaoyueQin/deepseek-harness-background?style=flat-square&logo=github)](https://github.com/HaoyueQin/deepseek-harness-background/stargazers)
[![GitHub release](https://img.shields.io/github/v/release/HaoyueQin/deepseek-harness-background?style=flat-square&logo=github)](https://github.com/HaoyueQin/deepseek-harness-background/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/HaoyueQin/deepseek-harness-background/ci.yml?style=flat-square&logo=githubactions&logoColor=white)](https://github.com/HaoyueQin/deepseek-harness-background/actions)
[![GitHub issues](https://img.shields.io/github/issues/HaoyueQin/deepseek-harness-background?style=flat-square&logo=github)](https://github.com/HaoyueQin/deepseek-harness-background/issues)
[![GitHub last commit](https://img.shields.io/github/last-commit/HaoyueQin/deepseek-harness-background?style=flat-square&logo=github)](https://github.com/HaoyueQin/deepseek-harness-background/commits)
[![License](https://img.shields.io/github/license/HaoyueQin/deepseek-harness-background?style=flat-square)](LICENSE)

[English](README.md) | 中文

DeepSeek Harness Web UI 的自定义背景图片插件：为整个应用界面设置背景图片（明/暗主题各一张），可调不透明度与遮罩强度、实时预览，全部在设置页完成。

## 功能

- **官方设置页入口**：插件配置区出现「自定义背景」卡片，点击打开自绘设置浮层。
- **明暗双图**：浅色/深色主题各一张背景图，主题切换时实时换图（无需刷新）。
- **不透明度与遮罩滑块 + 实时预览**：预览里看到的就是界面实际画出来的。
- **填充方式**：`cover`（铺满裁剪）或 `contain`（完整显示留白）。
- **持久化到官方设置文档**：存入 `$DSH_HOME/settings.yaml`，重启保留；外部编辑热生效。
- **干净还原**：关闭或卸载插件时背景完全还原，插件只撤自己写过的东西。

## 安装

插件是标准的 out-of-tree dsh bundle，用 dsh CLI 安装：

```sh
dsh plugin --profile web add /path/to/dsh-bg-wallpaper
```

从源码检出环境运行时，用 pnpm 执行同样命令：

```sh
pnpm dsh plugin --profile web add /path/to/dsh-bg-wallpaper
```

`dsh plugin add` 会把包 link 进 profile 并追加到 `dsh.profile.bundles`。重启服务即可加载：

```sh
dsh --profile web
```

### 从 git 安装

```sh
dsh plugin --profile web add github:you/dsh-bg-wallpaper#<commit>
```

git 安装只拉源码，pnpm 安装后会运行 `prepare` 构建 `lib/`。pnpm ≥ 10 首次会拒绝运行 git 依赖的 `prepare`，需要把 pnpm 打印的包名加入 profile 的 `pnpm-workspace.yaml` `allowBuilds` 后重试（只允许信任来源的包）。

### 本地目录安装

`dsh plugin add ./路径` 是 pnpm **link**——直接使用已构建的 `lib/`，不会跑 `prepare`。改过源码后请先重建再重启：

```sh
cd dsh-bg-wallpaper && pnpm run build
```

## 使用

1. 启动 Web UI：`dsh --profile web`，用浏览器打开打印的地址。
2. 打开左下角 **设置** → **插件**，找到 **自定义背景** 卡片。
3. 点击卡片——弹出带实时预览的设置浮层。
4. 配置分节：

| 控件 | 说明 |
| --- | --- |
| 启用 | 是否渲染自定义背景。 |
| 浅色图片 / 深色图片 | 浅色/深色主题的背景图 URL（http(s) 或浏览器可加载的任意 URL）。 |
| 不透明度 | `0..1` 图片不透明度；调低时图片向表面色淡出。 |
| 遮罩强度 | `0..0.95` 图片上的可读性遮罩——浅色图垫白色、深色图垫黑色。 |
| 填充方式 | `cover`（铺满裁剪）或 `contain`（完整显示留白）。 |

5. 点 **保存**——预览与界面实际背景是同一张画；配置跨重启保留。
6. 切换明暗主题——背景立即换图。

## 配置文件

配置存放在官方设置文档中，外部编辑会热生效：

```yaml
ui-background:
  enabled: true
  lightUrl: https://example.com/light.jpg
  darkUrl: https://example.com/dark.jpg
  opacity: 0.8
  scrim: 0.3
  fit: cover
```

## 工作原理

- 设置**入口卡**注册进官方 `settings.plugin.item` 插槽；可编辑的**浮层**通过 `shell.overlay` 插槽悬浮在整个界面之上。
- 插件自己的 host 路由（`/api/bg-wallpaper/settings`，GET/POST，带同源栅栏）经 settings 提供方读写配置分节。之所以用自定义路由族，是因为 api-proxy 的 settings 白名单不会把第三方 namespace 暴露给 settings RPC。
- 背景画在 `body` 上，三层叠加——`1 - opacity` 的表面淡出层、`scrim` 的可读性遮罩层、图片层——并随 `data-ds-dark-theme` 实时切换。
- 所有写入都有记录，禁用/卸载时逐一还原；`data-ds-dark-theme` 观察器在 dispose 时断开。

## 开发

```sh
pnpm install          # 首次；会跑 prepare（构建）
pnpm run typecheck    # tsc
pnpm test             # vitest + jsdom 契约测试
pnpm run build        # tsdown：lib/index.js（host 半）+ lib/client.js（浏览器 bundle）
```

```
dsh-bg-wallpaper/
├── package.json          # dsh.bundle.patch + dsh.client.inject 声明
├── cordis.patch.yml      # 向 web 插件点名册插入 ui-bg-wallpaper 行
├── tsdown.config.ts      # 官方 clientBundle 预设（自包含移植）
├── src/
│   ├── index.ts          # host 半：ui-background namespace + API 路由
│   ├── routes.ts         # /api/bg-wallpaper/settings（GET/POST，同源栅栏）
│   ├── schema.ts         # host 侧 schemastery schema
│   ├── settings.ts       # 与 client 共享的常量/类型
│   └── client/
│       ├── index.ts          # 背景渲染器 + 入口卡/浮层注册
│       ├── entry-card.tsx    # 设置页入口卡（打开浮层）
│       ├── overlay.tsx       # 自绘设置浮层（实时预览 + 控件）
│       ├── settings-client.ts# 配置分节的 fetch 传输
│       └── locales.ts        # 中英文案
└── tests/                   # 16 个契约测试（渲染/浮层/入口卡/schema）
```

## 反馈

有任何建议、问题或改进想法，欢迎提交 [Issue](https://github.com/HaoyueQin/deepseek-harness-background/issues)——新功能点子、兼容性问题、边界情况都欢迎。报告 bug 时请附上 `dsh --version` 的版本号与插件版本，方便快速复现定位。

## License

MIT
