# DeepSeek Harness Background
│       ├── timeline.tsx     # 会话时间线导航轨（官方 ScrollNav 结构 × 本插件玻璃体系）
│       ├── timeline-css.ts  # 时间线样式（dsbt- 前缀，官方度量）

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

[English](README.md) | 中文

一个 **DeepSeek Harness Web GUI**（`dsh web`）的**自定义背景图片插件**：上传一张本地图片，或粘贴一个图片链接，把它绘制在整个应用界面背后，并可调节**不透明度**、**可读性遮罩**、**面板透明**与**毛玻璃模糊** —— 全部在设置面板内实时预览、松手自动保存。

外观（固定壁纸层 + 主题自适应遮罩 + 由 `--dsw-*` 设计 token 驱动的半透明玻璃面板）借鉴了社区 `dsh-wallpaper-engine` 的实现。

## 截图

|  |  |
| --- | --- |
| **首页** | <img src="docs/images/home.jpg" alt="首页上的自定义背景" width="640"> |
| **会话界面** | <img src="docs/images/conversation.jpg" alt="会话背后的自定义背景" width="640"> |
| **设置界面** | <img src="docs/images/settings.jpg" alt="带实时预览的背景设置行" width="640"> |

## 功能

- **本地上传** —— 从电脑选择 JPG / PNG / WebP / GIF 图片；插件存入 harness home 目录，经同源路由提供（仅当声明的 MIME、探测到的文件签名与扩展名三者一致才被接受）。
- **粘贴 URL** —— 输入 `http(s)` 图片链接后回车即可。
- **面板内实时预览** —— 设置行顶部有预览卡：图片 + 遮罩 + 毛玻璃气泡；拖动任意滑块即时重绘，所见即所存。
- **阻尼滑块** —— 比例类滑块按 **5% 步进**、模糊类按 1/2px 步进吸附；拖动过程只改画面，**松手才保存**（每次手势一次写入，不再抖动）。
- **五个调节项** —— 壁纸不透明度、可读性遮罩、面板不透明度、毛玻璃模糊、壁纸模糊。
- **填充方式** —— `cover`（铺满、裁剪）或 `contain`（完整、留白）。
- **主题自适应遮罩** —— 浅色主题用白色纱帘（把图片提亮保持深色文字对比度），深色主题自动换成黑色纱帘（压暗图片保持浅色文字对比度）。
- **毛玻璃（白名单制）** —— 启用背景后，只有以小卡片/小按钮形态悬浮在壁纸上的表面才会变成半透明玻璃（顶部白色高光渐变 + `backdrop-filter`）：输入框卡片与消息气泡、代码块 / 终端 / diff / 工具 IO 卡 / 技能与 MCP 调用卡与行内代码、agent 任务条、三个铬件按钮（新会话、输入框加号、回到底部）、标题栏展开的子代理列表面板，以及首页右上角的「预览版」徽标。阅读型表面——对话框、设置界面、菜单、Tooltip、Toast、悬停填充与所有强调色（发送键保持品牌蓝）——一律保留**官方不透明样式**，保证可读性。模糊半径由「毛玻璃模糊」滑块驱动；「面板不透明度」调至 100% 时白名单表面也恢复官方原样。
- **会话时间线** —— 长会话右缘的 DeepSeek 官网风格滚动导航轨：毛玻璃胶囊上每条用户消息一枚指示刻度；悬停展开为列出全部提问的毛玻璃面板（当前阅读位置品牌蓝高亮）；点击跳转到对应消息。**重点书签**——展开面板内点击 ★ 标记重点提问（按会话持久化）：已标记项在折叠胶囊上显示金色加宽刻度，「★ 只看标记」一键筛选；跳转期间冻结高亮跟踪（消除中途乱跳），被回退撤回的消息自动从轨道剔除。折叠态与展开态**共用同一高度**（零跳变），裁切边缘带官方同款 **32px 淡化渐变**，导航轨自身始终采用 DeepSeek 官网同款毛玻璃配色，不随面板参数变化。可在设置行内用「会话时间线」开关关闭；若同时安装了第三方 dsh-chat-timeline 插件，本轨道会自动让位避免重叠。
- **持久化到官方设置文档** —— 存于 `$DSH_HOME/settings.yaml`，跨重启保留。
- **干净卸载** —— 关闭、清除或卸载后完整恢复原背景；插件只移除自己写过的内容。

## 安装

这是一个标准的 out-of-tree dsh bundle，已发布到 npm：

```sh
dsh plugin --profile web add deepseek-harness-background
```

从本地 checkout 安装（开发用）：

```sh
dsh plugin --profile web add /path/to/deepseek-harness-background
```

从源代码检出安装：

```sh
pnpm dsh plugin --profile web add /path/to/deepseek-harness-background
```

或从 git 安装：

```sh
dsh plugin --profile web add github:<you>/deepseek-harness-background#<commit>
```

安装后重启：

```sh
dsh --profile web
```

## 使用

1. 启动 Web UI（`dsh --profile web`）并在浏览器打开。
2. 打开 **设置**（左下角）→ **通用** → 找到 **自定义背景** 一行（与「外观」行同一区域）。
3. **上传**图片或**粘贴 URL** —— 背景立即生效，面板顶部的预览卡同步显示。
4. 调整控件，滑块均为阻尼步进、**松手才保存**：

| 控件 | 说明 |
| --- | --- |
| 不透明度 | `0..100%` 图片不透明度（5% 步进）；调低让壁纸向表面色淡出。 |
| 遮罩 | `0..95%` 图片上方的可读性纱帘（5% 步进），浅色主题白色、深色主题黑色。 |
| 面板不透明度 | `0..100%` 表面透明程度（5% 步进）；为 `100%` 时官方面板保持不透明（无玻璃）。 |
| 毛玻璃模糊 | `0..40px` 半透明表面上的 `backdrop-filter` 模糊（1px 步进）。 |
| 壁纸模糊 | `0..60px` 壁纸图片本身的模糊（2px 步进）。 |
| 填充方式 | `cover`（铺满）或 `contain`（完整）。 |
| 会话时间线 | 会话右侧时间线导航轨的开关（默认开启）。 |

5. 点 **清除背景** 移除背景，恢复默认外观。

## 原理

- **设置行**位于官方「通用」设置分区的 `settings.general.item` 槽中，紧挨「外观」行。控件样式全部使用 `--dsw-alias-*` 设计 token（按钮 / 胶囊 / 分段控件 / 滑块轨道与官方 chrome 一致），滑块为原生 `input[type=range]` 的 5% / 1–2px 步进 + 松手提交。
- **会话时间线**注册进 `conversation.input.dock` 槽位（绑定每会话生命周期），portal 渲染到 `body`。数据来自运行时 sessions 服务（已加载聊天节点 + 有界 loadOlder 补全）；书签存于 localStorage（按会话隔离）；轨道自带官网同款毛玻璃配色，不依赖插件的 token 覆盖。
- 插件自有的 host 路由（`/api/bg-wallpaper/*`：`settings`、`upload`、`image/<id>`）负责读写设置与提供上传图片，带同源校验、大小上限、MIME/签名校验与路径穿越防护。使用自定义路由族，是因为 api-proxy 的 settings 白名单不向第三方命名空间开放 settings RPC。
- 背景以 `body` 上一张固定的 `z-index:-2` 壁纸层 + `z-index:-1` 遮罩绘制，由 `data-dsh-bg` 属性开关；遮罩在注入样式表里按 `data-ds-dark-theme` 切换白/黑纱帘。毛玻璃为白名单制：仅对输入/气泡/代码/任务条等白名单表面覆盖 `--dsw-*` surface token，其余表面（按钮、弹出面板、徽标）通过 `data-dsh-bg-glass` 门控的显式规则着色，全部官方 token 与阅读型界面保持原样。
- 上传文件存放在 `$DSH_HOME/deepseek-harness-background/`（内容寻址 id）。切换新图片或清除背景时，被替换的旧上传文件会被自动回收，正常使用下目录不会堆积死图片。（例外：上传后从未保存进设置——例如上传后立刻关闭标签页——会留下一个孤儿文件。）关闭 / 卸载后不留残留。

## 开发

```sh
pnpm install          # 首次；会运行 prepare（构建）
pnpm run typecheck    # tsc
pnpm test             # vitest 契约测试
pnpm run build        # tsdown：lib/index.js（host）+ lib/client.js（浏览器 bundle）
```

```
deepseek-harness-background/          # 插件仓库（包名保留 npm 风格 id）
├── package.json          # dsh.bundle.patch + dsh.client.inject 声明
├── cordis.patch.yml      # 向 web 插件名册插入 deepseek-harness-background 一行
├── tsdown.config.ts      # 官方 clientBundle 预设
├── src/
│   ├── index.ts          # host 半部：ui-background 命名空间 + API 路由
│   ├── routes.ts         # /api/bg-wallpaper/{settings,upload,image/<id>}
│   ├── schema.ts         # host 侧 schemastery schema
│   ├── settings.ts       # 两端共享的常量/类型
│   ├── harness-home.ts   # $DSH_HOME / ~/.dsh 解析
│   └── client/
│       ├── index.ts          # painter 生命周期 + 设置行注册
│       ├── backdrop.ts       # 固定壁纸层 + 遮罩 + 玻璃表面 + 预览变量
│       ├── background-css.ts # 注入的样式表（层、玻璃、明暗遮罩、变量）
│       ├── SettingsRow.tsx   # 通用设置中的设置行（预览卡 + 阻尼滑块）
│       ├── SettingsRow.module.css # 设置行样式（官方 token）
│       ├── settings-client.ts# fetch 传输层（读/写/上传）
│       └── locales.ts        # 中/英文案
└── tests/                  # 契约测试（schema、routes、apply/painter、设置行）
```

## License

MIT
