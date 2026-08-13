# dsh-bg-wallpaper — DeepSeek Harness 自定义背景图片插件 · 方案

> 日期：2026-08-13 ｜ 状态：研究完成，待实现
> 上游：`D:\Project\deepseek-harness`（克隆）｜ 参考：`D:\Project\dsh-web-ui-check`（dsh-web-ui 克隆，仅作模式参考，**无依赖、不耦合**）

## 0. 结论先行

- **dsh-web-ui 没有用户自定义背景功能**（只有 7 款预置皮肤，皮肤自带静态 art；皮肤中心无上传/URL 入口）→ 方向不重复，继续。
- **可行性：成立**。所有接缝现成：settings seam 存配置、body 背景直写（whale-song 皮肤先例）、明暗主题 MutationObserver 切换。
- 形态：**独立 out-of-tree bundle**（民间插件，`dsh plugin add` 安装，不动上游仓库）。
- 范围：**MVP = URL 输入**；本地文件上传与内置图库列为二期，不在本期做。

## 1. 目标（可验证）

用户通过"设置 → 插件配置"填入图片 URL，启用后 Web UI 背景显示该图（含明暗遮罩自适应），关闭或卸载后背景完全还原。

验证标准：
- [ ] 单元测试（vitest + jsdom）：apply 设置 body 背景 / dispose 全部撤回 / 明暗切换换图。
- [ ] 手动验证：`dsh plugin add` 安装成功；`dsh --profile web` 下背景生效、设置页可改、重启后配置持久化。

## 2. 架构与接缝（对应 deepseek-harness 真实机制）

| 需求 | 机制 | 依据 |
|---|---|---|
| 用户配置持久化 | host 半注册 settings namespace（schemastery schema），存 `$DSH_HOME/settings.yaml` | `docs/subsystems/settings.zh.md`；先例 `packages/client/ui-theme/src/theme-settings.ts` |
| 设置 UI | host 半暴露 namespace 后，`ui-settings-plugins` 自动渲染为"插件配置"卡片（**MVP 无需手写 React 设置 UI**，实现期先核实自动渲染的 schema 字段类型限制） | `packages/client/ui-settings-plugins/src/client/index.ts`；`apps/web/tests/plugin-config.e2e.ts` |
| 背景渲染 | client 半 `apply()` 直写 `body.style`（`background-image: <scrim>, url(...)`；`cover`/`fixed`），不设 body attr、不引入 CSS 文件（纯动态值） | 先例 `packages/skins/whale-song/src/client/index.ts`（scrim 叠加 + MutationObserver 换图 + previous-Map 撤回） |
| 明暗主题 | `MutationObserver` 监听 `body[data-ds-dark-theme]`，实时切换 light/dark 双图与遮罩强度 | 同 whale-song |
| 卸载/关闭还原 | disposer 里 `delete` 自己写的每个 style 属性（previous Map 回写原值） | whale-song 模式；`docs/web-styling.zh.md` 的"只撤自己写的"纪律 |
| 与 dsh-web-ui | **完全解耦**：不 import、不依赖、不考虑共存（民间插件各自独立，用户按需安装） | 用户决策 |

## 3. 插件包结构（out-of-tree bundle 四件套）

仿 dsh-web-ui 皮肤标准（`dsh-web-ui-check/.dsh/skills/skin-developer/SKILL.md`）+ 官方外部插件教程（`deepseek-harness/docs/user/develop/basic/publish.md`）：

```
dsh-bg-wallpaper/
├── package.json          # 声明 "dsh": { "bundle": { "patch": "cordis.patch.yml" } };
│                         # "client": { "platform": "web", "inject": ["ui-bg-wallpaper"] }
│                         # prepare = tsdown 自包含构建 lib/
├── cordis.patch.yml      # bundle patch：插入 dshClient 行（ui-bg-wallpaper）
├── tsconfig.json
├── tsdown.config.ts      # 参照 dsh-web-ui packages/skins/tsdown.client.ts 的 standalone 移植
├── src/
│   ├── index.ts          # host 半：注册 settings namespace 'ui-bg-wallpaper'（enabled/lightUrl/darkUrl/scrimStrength/fit）
│   ├── settings.ts       # schema（schemastery）：enabled=boolean, lightUrl/darkUrl=string, scrimStrength=number(0-1), fit='cover'|'contain'
│   └── client/
│       └── index.ts      # client 半：apply(ctx) — 订阅 settings → 应用/撤回 body 背景 + MutationObserver
└── tests/
    └── apply.spec.ts     # vitest + jsdom：设置/撤回/明暗切换断言
```

关键约束（来自 web-styling.zh.md / skin-developer）：
- devDependencies 只用**真实发布版本**（tsdown / lightningcss / cordis / vitest / jsdom）；`@deepseek-ai/dsh-*` 未发布到 npm，运行时由宿主 shell module table 提供，**构建时 external**。
- 纯呈现层：不注入服务、不发 cordis 事件、不触及模型请求。
- 撤回语义：所有写入都在 disposer 里收回，且只撤自己写的（previous Map 记录原值）。

## 4. 实现里程碑

1. **M1 脚手架 + host 半**：包四件套 + settings namespace。
   验证：`dsh plugin add ./dsh-bg-wallpaper` 安装成功；设置页出现"插件配置"卡片。
2. **M2 client 半背景应用**：apply() 读 settings 写 body 背景。
   验证：jsdom 单测通过；`dsh --profile web` 下填 URL 后背景可见。
3. **M3 明暗切换 + 撤回 + 持久化**。
   验证：切换主题背景换图；关闭/卸载后背景还原；重启进程配置保留。

## 5. 待实现期核实的点

- [ ] `ui-settings-plugins` 自动渲染对 schema 字段类型的支持范围（number with min/max、enum 是否支持）。
- [ ] client 半订阅 settings 的确切 API（`ctx.settingsScope.bind` + `settings/updated` 事件，见 `packages/client/ui-settings/src/client/settings-scope.ts:227-270`）。
- [ ] 二次实现：本地图片文件上传（host 静态托管）与内置图库 —— 本期不做。

## 6. 参考文件索引

- `docs/architecture.zh.md`、`docs/web-styling.zh.md`、`docs/capability-seams.zh.md`
- `docs/subsystems/settings.zh.md`、`docs/user/develop/basic/publish.md`
- `packages/client/ui-theme/src/theme-settings.ts`（namespace 范例）
- `packages/client/ui-settings/src/client/settings-scope.ts`
- `D:\Project\dsh-web-ui-check\packages\skins\whale-song\src\client\index.ts`（背景直写先例）

## 7. 实现结果（2026-08-13 完成）

实现在 `dsh-bg-wallpaper/`，仿官方 standalone 皮肤（qq98）四件套形态。验证：`pnpm run typecheck` ✓、`pnpm test` 10/10 ✓、`pnpm run build` ✓、node 冒烟（host 半导入+schema 解析）✓。

实现期发现的坑（后续维护必读）：
- `@deepseek-ai/dsh-client-runtime@0.0.1-rc.1` 依赖**未发布的 `dsh-compact`**（npm 404），client 半不能 import 它 → 自声明 settingsScope 接口契约（形状镜像官方，运行时由宿主 ui-settings 提供）。
- schemastery 3.18 schema 无 `.parse()`，schema 本身可调用（`schema({})`）；无 `.trim()`（transform 回调会破坏 toJSON 序列化）。
- jsdom 规范 CSS 值：`center`→`'center center'`、`url(x)`→`url("x")`；MutationObserver 回调异步（断言用 `vi.waitFor`）。
- standalone 包构建传 **src 入口**（`['src/index.ts']`），非 monorepo 的 `lib/types/*`（无 tsc 前置阶段）。

**未验证项（归用户验收）**：`dsh plugin add` 实装冒烟——本机无 `dsh` CLI（全局未装、源码未构建 238 个 workspace 项目），需在装好 dsh 的机器上执行安装并按 §1 验证标准走一遍。
