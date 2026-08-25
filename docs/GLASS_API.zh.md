# 毛玻璃注册表 —— 第三方插件对接接口（v1）

其他插件可以把自家面板注册进本插件的毛玻璃系统，使这些表面获得与内置玻璃面
（输入卡、消息气泡、代码块等）**完全一致的配方**：半透明白色填充、湿玻璃高光
渐变，以及由用户「毛玻璃模糊」滑杆实时驱动的共享 `backdrop-filter` 链。

典型消费方：diff 查看器、文件预览、工具结果卡片、悬浮工具栏——任何以小卡片
形态浮在壁纸之上、当前呈不透明（或"半透明却无模糊"）状态的表面。

- **零依赖**：无需安装任何 npm 包，无运行时耦合。
- **优雅降级**：本插件未安装时，桥接根本不会出现，你的插件行为不变。
- **门控驱动**：注册只在毛玻璃开启时生效；用户关闭壁纸或将面板不透明度拉满时，
  你的表面自动回到自己的涂料，全程零协调成本。

---

## 1. 工作机制

```
你的插件                     本插件（deepseek-harness-background）
────────────                 ──────────────────────────────────────────
register(选择器) ──────────▶ GlassRegistry（内存注册表）
                                   │ 条目变化时重新合成 CSS
                                   ▼
                             <style data-plugin-css="deepseek-harness-background/glass-registry">
                               body[data-dsh-bg-glass] <你的选择器> { 高光 + 模糊链 }
                             </style>
                                   ▲
      画家写入旋钮变量              │ 仅当毛玻璃 ON 时才存在该门控属性
      --bg-glass-blur 等 ─────────╯ （壁纸开启 且 面板不透明度 < 100%）
```

整个契约只依赖两个浏览器全局通道：

| 通道 | 值 |
| --- | --- |
| 全局对象 | `window.__DSH_BACKGROUND_GLASS__` —— 即 `BackgroundGlassApi`，本插件客户端 apply 后立即可用 |
| DOM 事件 | `dsh-background-glass:ready` —— `CustomEvent`，`detail` 就是同一个 api，在发布后同步派发 |

由于 DSH 加载各插件客户端 bundle 的顺序不确定，消费方必须同时处理两种到达
次序：先轮询全局对象，再等待事件（下文的快速上手 helper 正是这么做的）。

### 毛玻璃什么时候才算真正开着？

注册表规则挂在 body 属性 `data-dsh-bg-glass` 上，画家恰好在以下条件同时
成立时才设置它：

1. 背景节 **enabled**；
2. 存在图像源（上传或 URL）；
3. **面板不透明度 < 100%**（拉满时所有官方表面回归不透明涂料——注册的表面
   同样如此）。

随时可通过 `api.isActive()` 查询该状态。注册动作本身不受状态影响：玻璃关闭
期间注册的条目只是在门控下待命，玻璃一开立即点亮。主题切换、滑杆拖动、开关
循环全部由共享画家处理，永远不需要重新注册。

---

## 2. 快速上手

把这份 helper 复制进你的客户端 bundle（约 20 行，无任何导入）：

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

/** 取得背景插件的玻璃 api；插件不存在时返回 null。
 * 无论哪条路径先到，计时器与监听器都会被清理。 */
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

再接入 cordis 客户端 `apply`，让注销跟随你的 fiber 生命周期：

```ts
export function apply(ctx: Context): void {
  ctx.effect(() => {
    let unregister: (() => void) | undefined
    let disposed = false
    void whenGlassReady().then((glass) => {
      if (disposed || !glass || glass.version !== 1) return
      unregister = glass.register({
        plugin: '你的包名',
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

对接到此为止。


---

## 3. API 参考

### `window.__DSH_BACKGROUND_GLASS__: BackgroundGlassApi | undefined`

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `version` | `1` | 契约版本。使用新成员前先检查它；v1 之外不作任何承诺。 |
| `bridgeId` | `'deepseek-harness-background'` | 发布方标识——信任这个全局之前先断言它。 |
| `isActive()` | `() => boolean` | 毛玻璃此刻是否开启（即 body 上存在 `data-dsh-bg-glass`）。见 §1。 |
| `register(spec)` | `(spec: GlassSurfaceSpec) => () => void` | 注册表面。返回**注销函数**：幂等、可安全调用两次，是 cordis effect / fiber dispose 的正确清理点。 |

### `GlassSurfaceSpec`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `plugin` | `string` | 是 | 调用方标识，惯例用你的包名。仅用于诊断——不同插件之间永不冲突。留空时警告信息里显示为 `(anonymous)`。 |
| `selectors` | `string \| readonly string[]` | 是 | 单个选择器或列表（上限 64 条）。每条都必须匹配你自己渲染的元素；约束见 §5。 |
| `mode` | `'token' \| 'fill'` | 否（默认 `'token'`） | 填充策略；见 §4。 |

### 注册语义

- **按 `(plugin, mode, selector)` 三元组幂等**：重复注册同一三元组会替换
  该条目（热重载场景正需要这一点）。旧句柄随即失效——它不会误删新条目。
- **跨插件重叠是允许的**：两个插件可以注册同一个选择器。规则文本相同时只
  输出一份；谁生效由 CSS 级联决定。
- **非法选择器不会中断整个调用**：每条无效选择器单独丢弃并打一条
  `console.warn`，同一 spec 里合法的兄弟条目照常生效。

### 就绪事件

`window.addEventListener('dsh-background-glass:ready', handler)` —— handler
收到 `CustomEvent<BackgroundGlassApi>`。每次桥发布都会触发一次，时机是本
插件客户端 apply 期间（早于任何绘制），热重载后重新发布时会再触发一次（若
你的监听器带 `{ once: true }` 就会漏掉第二次——请优先用"先轮询"的 helper）。

---

## 4. 模式怎么选

两种模式输出的滤镜链完全相同；区别仅在于注册表是否连你的 `background-color`
一起接管。

### `mode: 'token'`（默认）——你的填充已随滑杆联动

适用于：你的面板用了本插件在玻璃开启时会转为半透明的 token：

| Token | 覆盖范围 |
| --- | --- |
| `--dsw-specific-input-major` | 输入卡级白玻璃 |
| `--dsw-specific-bubble` | 消息气泡 |
| `--dsw-alias-markdown-code-block` | 代码块 / diff、终端、工具 IO 卡 |
| `--dsw-alias-markdown-code-block-banner` | 代码块标题栏 |
| `--dsw-alias-markdown-inline-code` | 行内代码片 |
| `--dsw-specific-tip` | todo / goal / 队列 dock 卡 |

此时你的填充透明度自动跟随**面板不透明度**滑杆（主题感知曲线见 §6），注册
表只需补上缺失的磨砂：

```css
body[data-dsh-bg-glass] <你的选择器> {
  background-image: linear-gradient(180deg, ...高光...);
  -webkit-backdrop-filter: blur(...) saturate(...) brightness(...) contrast(1.01);
  backdrop-filter: blur(...) saturate(...) brightness(...) contrast(1.01);
}
```

### `mode: 'fill'` ——注册表连填充一起接管

适用于：面板自带不透明/字面背景（硬编码 hex/rgba，或上表之外的 token）。
生成的规则会额外声明 `background-color: var(--dsw-specific-input-major)`
——与 chrome 按钮、lineage 弹层同一套显式配方。玻璃开启期间你自己的
`background-color` 在级联中落败；玻璃关闭后原样回归。

拿不准？在 DevTools 里看该元素的生效 `background` 声明：引用了上表中的
token 就选 `token`，否则选 `fill`。

一个例外要注意：**内联样式**（由 JS/JSX 写进 style 属性的背景）优先级高于任何
样式表规则，`fill` 模式接管不了内联设置的背景——请先把该声明挪进样式表类名。

---

## 5. 选择器规则

选择器会被嵌入生成的样式表，因此写入前会做结构性校验：

| 约束 | 值 |
| --- | --- |
| 禁用字符 | `{` `}` `;` `@` `<` `>` 与反斜杠（它们可能逃逸出规则上下文；锚点选择器用不到它们） |
| 单条长度上限 | trim 后 500 字符 |
| 每次 `register` 上限 | 64 条 |
| 空白处理 | 自动去除首尾空白 |

失败模式：违规的选择器被单独丢弃并打一条
`console.warn('[glass-registry] <插件名>: rejected selector ...')`；同一
spec 里合法的兄弟条目照常生效。普通 CSS 笔误（写错的伪类）不在此校验范围
——浏览器只会丢弃那一条规则，属于安全无害的降级。

好的锚点是你自己渲染的稳定属性（首选 `data-*`）或自家 CSS module 的结构
类名。避免裸元素选择器（`div`、`section`）——它们会把不属于你的表面也
玻璃化。

---

## 6. 你的表面收到的确切配方

所有声明都由画家写在 body 上的变量驱动，因此你的表面对每个控制项实时响应：

| 声明 / 变量 | 由谁驱动 |
| --- | --- |
| `--bg-glass-blur` | **毛玻璃模糊**滑杆（0–40px） |
| `--bg-glass-saturate` | 派生：`1.1 + blur × 0.02`，上限 1.6；blur = 0 时恰为 `1` |
| `--bg-glass-brightness` | 主题校准（浅色 `0.98`，深色 `1.04`） |
| `--bg-glass-sheen` / `--bg-glass-sheen-mid` | 高光渐变端点（浅色 `0.07/0.02`，深色 `0.16/0.05`） |
| `background-color`（仅 fill 模式）经 `--dsw-specific-input-major` | **面板不透明度**滑杆——alpha `= clamp(0.05 + panelOpacity * 0.85, ≤ 0.9) × (浅色 0.8 / 深色 0.4)`，白色 |

输出的完整声明与内置显式填充家族逐字节一致：

```css
/* token 模式 */
body[data-dsh-bg-glass] <选择器> {
  background-image: linear-gradient(180deg,
    rgba(255, 255, 255, var(--bg-glass-sheen, 0.07)),
    rgba(255, 255, 255, var(--bg-glass-sheen-mid, 0.02)) 38%,
    rgba(255, 255, 255, 0.01));
  -webkit-backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
  backdrop-filter: blur(var(--bg-glass-blur, 16px)) saturate(var(--bg-glass-saturate, 1.42)) brightness(var(--bg-glass-brightness, 1)) contrast(1.01);
}

/* fill 模式额外追加： */
body[data-dsh-bg-glass] <选择器> {
  background-color: var(--dsw-specific-input-major);
}
```

注册表刻意**不碰**你的文字颜色、边框、阴影与圆角——这些随你自由分层。

### 填充继承是全局的——即使从不注册也请读这一节

§4 表中的六个 token 是覆盖在 `document.body` 本体上的（内联样式），而 CSS
自定义属性会沿整棵文档树**继承**。在你做任何决定之前，先理解这个后果：

- 玻璃开启期间，**任何**使用这六个 token 的表面都会变半透明——无论官方还是
  第三方、无论是否注册。注册接口无法让你退出这一点；这是共享设计 token 的
  固有工作方式，官方 UI 内部同样如此。内置白名单只决定哪些表面额外获得
  高光/模糊链，从而呈现完整的「磨砂」而不是「裸透明」。
- 反向边界同样真实：未注册的第三方面板若用了 `--dsw-alias-markdown-code-block`，
  就会处于「半透明却无模糊」的状态。用默认的 token 模式注册它即可补全配方。
- 玻璃关闭时一切还原：面板不透明度拉满、停用背景节或清除图像源都会恢复
  官方 token 值，所有表面（包括你的）回到各自的涂料。

**如果你用了这六个 token 之一但不想要半透明**（例如大面积阅读面，磨砂会
损害可读性）：注册接口在这里帮不了你。要么把该表面换成本插件不覆盖的
token（例如 `--dsw-alias-bg-layer-1`）或字面颜色，要么在该表面的根元素上
自行重新声明这个 token（明暗两套值由你通过 `[data-ds-dark-theme]` 自己管理）。

---

## 7. 生命周期

| 事件 | 行为 |
| --- | --- |
| 本插件加载 | 桥发布 + 就绪事件派发早于首次快照重绘；先到的注册方不存在竞态。 |
| 玻璃关闭时注册 | 规则立即合成但挂在门控下待命；玻璃一开即点亮。 |
| 主题切换 / 滑杆拖动 | 共享画家重绘旋钮变量；你无需做任何事。 |
| 玻璃关闭（禁用、清除图像源、面板不透明度 = 100%） | 门控属性消失；你的表面回到自己的涂料。注册条目原地保留。 |
| 你的插件卸载 | 在 fiber dispose 里调用注销句柄（快速上手已示范）。 |
| 本插件热重载 | 旧桥先销毁（样式表移除、window 键替换），再发布新桥并重新派发事件；之后重新注册即可。 |
| 本插件卸载/停用 | 整座桥随客户端 fiber 一并拆除；你的任何注册都不会残留。 |

---

## 8. 实例——dsh-diff-stat

它的 diff 窗口（`diff-window.module.css` 的 `.window`）与文件预览
（`file-peek.module.css` 的 `.peek`）都以
`var(--dsw-alias-markdown-code-block)` 填充——该 token 在 §4 表中，所以
**token 模式**即为正确选择：它们的填充早已跟随面板不透明度滑杆半透明，缺的
只是磨砂。两个组件都带有稳定 data 锚点：

```ts
glass.register({
  plugin: 'dsh-diff-stat',
  selectors: ['[data-diff-window]', '[data-diff-stat-peek]'],
})
```

（轮末汇总卡按设计就是近透明着色，无需注册。）

---

## 9. FAQ

**如何感知毛玻璃开/关？**
通常不需要——门控已经处理了样式。若确有需要（例如更换某资源），观察 body
属性即可：

```ts
new MutationObserver(() => console.log(glass.isActive()))
  .observe(document.body, { attributes: true, attributeFilter: ['data-dsh-bg-glass'] })
```

**为什么不直接 npm 依赖本插件？**
运行时导入会在用户未安装本插件时让你的 bundle 直接崩溃，且 DSH 的冻结模块
表本就禁止跨插件值导入。桥刻意做成零依赖；包级别唯一可接受的用法是纯类型
导入（构建期即被擦除）。

**我的组件 portal 到应用根之外，还能覆盖到吗？**
能。生成规则匹配整棵文档树；门控挂在 body 上，任何 portal 最终都挂在它之下。

**文字可读性会受影响吗？**
不会超过官方玻璃面的程度：配方只动
`background-color`/`background-image`/`backdrop-filter`。文字墨色请继续
依赖官方 label token。

**我的表面在一个带 filter / opacity 动画的容器里，为什么没有磨砂效果？**
`backdrop-filter` 模糊的是绘制在该元素**背后**的内容。祖先自身带 `filter`、
`backdrop-filter` 或 `opacity` 小于 1 时会创建新的包含上下文，效果可能悄然
失效——这是浏览器标准行为，注册表无法解除；动画请尽量改用 transform。

**我的面板用了被覆盖的 token 但从未注册，为什么它变了？**
填充继承是全局的（见 §6）：token 覆盖写在 `body` 上并继承到每个角落。注册只决定要不要在其上补高光/模糊链。

**两个插件注册了同一个选择器，谁赢？**
CSS 级联决定（同等特异性时后者胜）。无论多少插件提出请求，相同规则文本只
输出一份。

---

## 10. 版本承诺

- `version === 1`：以上契约稳定。增量式变化（新增可选 spec 字段、api 新增
  成员）可以不经版本号递增直接落地。
- 破坏性变更递增 `version`。消费方应在调用 `register` 前检查 `version`，
  不匹配时优雅降级。
- 全局键与事件名跨版本保持不变，发现逻辑永远不用改。

## 11. TypeScript 类型声明（复制进你的项目）

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

实现参照 `deepseek-harness-background` 的 `src/client/glass-registry.ts`；
行为由 `tests/glass-registry.spec.ts` 锁定。
