# AAEasy 前端设计语言

从首页（`src/spa/pages/home.tsx`）提炼的统一规范。所有新界面按此书写，旧界面逐步收敛。

---

## 0. 核心原则

1. **账本感，不是营销页**。界面是一张干净的纸质账本：白卡片、细边框、清晰的行与列。金额是主角，装饰退让。
2. **边框优先于阴影**。层级用 `border-border` 分隔，阴影只留给真正浮起的东西（对话框、bottom sheet、悬浮卡）。
3. **移动优先**。先写窄屏单列样式，再用 `sm:` / `md:` / `lg:` 加宽。任何时候 375px 宽都必须可用。
4. **语义色，不写死颜色**。永远用 token（`text-positive-ink`），不要 `text-green-600`。
5. **克制的动效**。只有进场和状态反馈，120–360ms，且尊重 `prefers-reduced-motion`。

---

## 1. 色彩

全部来自 `src/styles/globals.css` 的 CSS 变量，light/dark 自动切换。**禁止使用 Tailwind 原生调色板**（`blue-500`、`gray-200` 等）。

### 表面层级

| 用途 | Token | 说明 |
| --- | --- | --- |
| 页面底色 | `bg-background` | 略带蓝的浅灰，让卡片浮出来 |
| 卡片 / 内容面板 | `bg-card` | 纯白（暗色下为浅一档的深蓝灰） |
| 次级填充块 | `bg-secondary` | 结论区、强调小块（如"谁该还谁"） |
| 弱化分区 | `bg-muted/30` | 同卡片内的副栏，不要用满 `bg-muted` |
| 凹陷面板 | `bg-sunken` / `bg-sunken-strong` | 表单内的分组区、AI 面板等"陷进去"的块 |
| 导航面 | `bg-sidebar` | 侧栏；配 `text-sidebar-foreground` |
| 状态色块 | `Card tone="brand"` / `tone="positive"` | 结算状态等需要着色表达的区域 |
| 浮层遮罩 | `bg-scrim` | dialog / sheet 背后的蒙版，不要写 `bg-black/40` |

> **透明度不要凭感觉写。** 需要半透明表面时用上面的 `sunken` / `scrim` token；禁止新增 `bg-secondary/48`、`bg-background/65` 这类一次性数值。

> **明度必须连贯。** 所有表面的明度落在一条窄带内（浅色主题约 0.94–1.0），相邻表面差值不超过约 0.04。**禁止深色反色块**：曾经的侧栏（L=0.17）与结算卡（L=0.145）在 0.982 的页面上形成明度断崖，让用户一登录就从明快的落地页跌进一块黑板。需要强调时用**着色**（`tone="brand"` / `tone="positive"`）而不是拉暗，用**边框**而不是反色。

### 文字层级

只有三级，不要发明第四级：

- `text-foreground` — 标题、金额、关键内容
- `text-muted-foreground` — 说明、标签、次要元信息
- `text-primary-ink` / `text-positive-ink` / `text-destructive-ink` — 语义强调**文字**

> `-ink` 变体是"文字专用色"，对比度已调过；`--primary` / `--positive` 本体是填充色，只用于 `bg-*`，不要拿来当文字色。

### 语义色

| 含义 | 填充 | 文字 |
| --- | --- | --- |
| 主操作 / 品牌 | `bg-primary text-primary-foreground` | `text-primary-ink` |
| 应收（正） | `bg-positive text-positive-foreground` | `text-positive-ink` |
| 应付（负） | — | `text-primary-ink`（首页写法，保持一致） |
| 危险 / 删除 | `bg-destructive text-destructive-foreground` | `text-destructive-ink` |
| 提示 / 中性高亮 | `bg-signal text-signal-foreground` | — |

**金额符号约定**：正数带 `+`，负数用真减号 `−`（U+2212，不是连字符），保证等宽对齐。这条由 `formatMinor` / `formatMoney` 在格式化层统一保证，**调用点不要自己拼符号**。

**语义不能只靠颜色**。欠/被欠除了 `-ink` 色，必须同时有符号（`+`/`−`）或图标 —— 色盲用户看不出红绿差异，而这是本应用的核心语义。

---

## 2. 字体

三套字族各司其职，不要混用：

| 字族 | 类名 | 用于 |
| --- | --- | --- |
| Sans | 默认（`font-sans`） | 全部正文、按钮、表单 |
| Display | `font-display` | 仅 h1 / 页面级大标题 / 步骤标题 |
| Mono | `font-mono` | **所有数字**：金额、编号、头像首字母 |

> 规则：只要是会被用户逐位比对的字符（钱、日期序号、ID），就用 `font-mono`。

### 字号阶梯

窄屏用小值，宽屏用 `sm:` 升一档。

| 角色 | 类名 |
| --- | --- |
| Hero 标题 | `font-display text-[clamp(3.15rem,5.4vw,4.75rem)] leading-[0.99] tracking-[-0.072em] font-bold` |
| 区块标题 | `font-display text-lg sm:text-xl font-semibold tracking-[-0.04em]` |
| 卡片标题 | `text-sm sm:text-base font-bold tracking-[-0.025em]` |
| 正文 | `text-sm leading-6`（长段落 `text-base leading-7 sm:text-lg sm:leading-8`） |
| 次要 / 行内元信息 | `text-xs leading-5` |
| 分区小标签 | `text-[10px] font-bold tracking-[0.13em] uppercase text-muted-foreground` |
| 金额（主） | `font-mono text-base font-bold tracking-[-0.04em]` |
| 金额（列表内） | `font-mono text-xs font-bold` |

**字距是这套语言的签名**：字号越大，`tracking` 负得越多（−0.072em → −0.04em → −0.025em）；只有全大写小标签反向放宽到 `+0.13em`。

**字距只有这四个值**，不要发明第五个。曾经散落的 `-0.012 / -0.02 / -0.03 / -0.035 / -0.045 / -0.05 / -0.055em` 与 `+0.04 / +0.12 / +0.14 / +0.15 / +0.16em` 一律归并到最近的一档。

**微型字号只有一个**：小标签的 `text-[10px]`。`text-[8px]` / `text-[9px]` / `text-[11px]` / `text-[13px]` 全部禁止 —— 需要更小的层级说明信息架构出了问题，不是字号不够小。

### 字重

只用三档：`font-semibold`（默认可交互文本）、`font-bold`（标题与金额）、常规（正文）。不要 `font-medium` / `font-black`。

---

## 3. 间距与圆角

### 圆角阶梯（语义绑定尺寸）

| 元素 | 圆角 |
| --- | --- |
| 大容器：主卡片、bottom sheet、对话框 | `rounded-2xl` |
| 卡内子块、结论块、浮标 | `rounded-xl` |
| 图标底板（size-9 及以下的方块） | `rounded-lg` |
| 按钮、输入框、小控件 | `rounded-md` |
| 头像、序号徽章、纯圆点 | `rounded-full` |

一条规则：**外层比内层大一档**。`rounded-2xl` 卡片里放 `rounded-xl` 块，块里放 `rounded-lg` 图标。

**裸 `rounded` 和任意值 `rounded-[Npx]` 一律禁止** —— 必须落在上面五档里的某一档。

### 内边距

| 场景 | 类名 |
| --- | --- |
| 页面容器 | `mx-auto w-full max-w-7xl px-5 sm:px-8 lg:px-10` |
| 页面纵向 | `py-14 sm:py-16 lg:py-20`（内容页可降到 `py-8 sm:py-10`） |
| 卡片区块 | `p-5 sm:p-6` |
| 卡内子块 | `p-4` |
| 列表行 | `py-3`（配 `border-b last:border-b-0`） |
| 结论小块 | `px-4 py-3.5` |

元素间距用 `gap-*`，不要用 margin 堆叠：行内 `gap-3`，卡片间 `gap-4`，区块间 `gap-8`，主栏分栏 `gap-12 lg:gap-16`。

---

## 4. 组件规范

### 按钮（`components/ui/button.tsx`）

- 高度：`sm` 36px / `default` 40px / `lg` 44px。**移动端主操作一律 `size="lg"` + `w-full sm:w-auto`**（44px 是触控下限）。
- 变体优先级：一屏只有一个 `default`（实心主色）；配套操作用 `outline`；行内低权重操作用 `ghost`；文字跳转用 `link`。
- 图标在文字后用 `data-icon="inline-end"`，尺寸由基类统一控制（`size-4`），不要手动写。
- 反馈：hover 变色 + `active:translate-y-px`，不要加 hover 位移或缩放。

### 卡片

**一律使用 `components/ui/card.tsx` 的 `Card` / `CardHeader` / `CardBody`，不要手写卡片外壳。** 其结构即首页 `LedgerPreview` 范本：

```
border-border bg-card rounded-2xl border overflow-hidden
  └ CardHeader:  border-b px-5 py-5 sm:px-6   （图标底板 + 标题 + 右侧头像组/操作）
  └ CardBody:    p-5 sm:p-6                    （多栏用 md:grid-cols-*，分栏线 md:border-r）
```

卡片默认**不带阴影**。只有脱离文档流的浮层才加 `shadow-lifted`。`shadow-soft` 已废弃删除；`shadow-md` 不是本系统的 token，禁止使用。

`tone` 可选 `default` / `danger`（危险区）/ `inverted`（深色反色，如结算状态）。

### 列表行

金额类列表统一左右两端对齐：

```
flex items-center justify-between gap-4 border-b border-border py-3 last:border-b-0
  左：text-xs text-muted-foreground（名称）
  右：font-mono text-xs font-bold（金额，带语义 ink 色）
```

带图标的条目：`size-9` 图标底板 + `min-w-0 flex-1` 文本区 + 右侧金额。文本必须 `truncate`。

#### 等高行

同一列表内的行必须等高，即使内容多寡不同。行高由内容决定时，"只有一个徽章"的行会明显矮于"带三个图标按钮"的行。做法：给行设 `min-h-*` 下限，并给操作区设 `min-h-11` 占位。

#### 内容行的三段式

账单流这类"每行是一条记录"的列表，遵循固定结构：

```
[身份锚点 size-9]  [标题 text-sm semibold]        [金额 font-mono text-lg bold]  [操作]
                   [元信息 text-xs muted 单行]
```

四条硬规则：

1. **一行只有一个视觉重心**，就是金额。它是唯一允许用 `text-lg` 和 `font-bold` 的元素。
2. **一行最多三档字号**：标题 `text-sm`、元信息 `text-xs`、金额 `text-lg`。元信息行内的所有元素——付款人、分摊方式、标签、状态——必须同一尺寸同一颜色，谁都不许突出。
3. **左侧锚点必须承载信息**。用头像、语义色块这类每行都不同的东西。**禁止每行放同一个图标**——那不是设计，是 36px 的空白。
4. **元信息压成一行**。备注、长描述不占独立行；放 `title` 属性或详情页，行内至多给一个小图标提示存在。

行内操作用 `opacity` 弱化（`md:opacity-60` + `group-hover:opacity-100`），不与内容争夺注意力。

### 表单

- 控件高度 40px（`h-10`），与 `default` 按钮对齐。
- **每个字段用 `<Field>` 包裹**（`ui/field.tsx`）—— 它负责接线 `aria-invalid` 与 `aria-describedby`，把错误信息关联到控件。三个输入原语早就写好了 invalid 样式，不要再让它们闲置。
- 移动端字号已由 `globals.css` 在 `pointer: coarse` 下强制 16px 防 iOS 缩放 —— **不要覆盖**。
- 标签用 `<Label>`，`text-xs font-semibold`；错误信息 `text-xs text-destructive-ink`。
- 金额输入用 `NumericInput` + `NumericKeypad`，不要用裸 `<input type="number">`。大号金额展示用 `Input variant="display"`，不要靠一串 override 去取消边框和焦点环。
- 复选框用 `ui/checkbox.tsx`（含 44px 触控区），不要写裸 `<input type="checkbox">`。
- 下拉用 `ui/select.tsx`，**不要写裸 `<select>`**。它保留真实 `<select>` 以维持表单语义，但渲染自绘列表——原生下拉在移动端会交给系统选择器（iOS 的整屏滚轮、Android 的裸对话框），完全无视应用的字体、间距与暗色模式，也给不出 44px 触控行。
- **触屏下 `NumericInput` 是 `readOnly`，原生 `required` 校验对它无效**。金额必填必须走显式校验，不能依赖浏览器约束。
- 提交被禁用时，**必须在按钮旁边说明原因**，且该说明不得藏在折叠面板里。错误提示加 `role="alert"`。

### 浮层

移动端 bottom sheet，桌面 dialog —— 已有 `bottom-sheet.tsx` / `dialog.tsx` / `floating-panel.tsx`，新浮层复用它们，不要新写。统一 `rounded-2xl` + `shadow-lifted`，底部留 `pb-[env(safe-area-inset-bottom)]`。

### 空状态

统一走 `components/ui/empty-state.tsx`：图标（`text-muted-foreground`）+ 一行说明 `text-sm` + 一个主操作按钮。不要在页面里手写空状态，也不要用 `border-dashed` 的裸 `<p>`。

---

## 4.5 共享原语清单

**动手写任何界面前先查这张表。** 手写这些模式一律视为偏离。

| 原语 | 位置 | 取代 |
| --- | --- | --- |
| `Card` / `CardHeader` / `CardBody` | `ui/card.tsx` | 手写卡片外壳 |
| `PageHeader` / `SectionHeader` | `ui/page-header.tsx` | 手写页头、标题＋描述组合 |
| `Eyebrow` | `ui/eyebrow.tsx` | 全大写小标签、徽章、日期分组头 |
| `AmountRow` | `ui/amount-row.tsx` | 左名称右金额的列表行 |
| `EmptyState` | `ui/empty-state.tsx` | 手写空状态 |
| `Field` | `ui/field.tsx` | Label + 控件 + 错误的组合 |
| `Checkbox` | `ui/checkbox.tsx` | 裸 `<input type="checkbox">` |
| `Select` | `ui/select.tsx` | 裸 `<select>`（移动端会被系统接管） |
| `DatePicker` | `ui/date-picker.tsx` | 裸 `<input type="date">`（同上，且各浏览器行内样式互不相同） |
| `FormDialog` | `ui/form-dialog.tsx` | 手写 Dialog 的头尾与取消按钮 |
| `useConfirm` | `ui/confirm-dialog.tsx` | 手写确认弹窗（需要正文时传 `body`） |
| `DangerZone` | `ui/danger-zone.tsx` | 手写危险操作区 |
| `useAsyncAction` | `hooks/use-async-action.ts` | `useTransition` + `showI18nError` + `refresh` 五步骤 |
| `DropdownMenu` | `ui/dropdown-menu.tsx` | 手写的锚定菜单 |
| `MemberAvatar` / `LedgerMemberStack` | `ledger/member-avatar.tsx` | 手写头像圆片 |

浮层三件套（`dialog` / `bottom-sheet` / `floating-panel`）共用 `useModalLayer` 的焦点与滚动语义 —— 新浮层复用它们，不要另起一套关闭逻辑。

---

## 5. 移动端约定

**断点只有一个分界：`md`(768)。** 内容布局与导航必须在同一个断点切换，否则会出现两套导航并存的中间区间。`sm:` 仅用于内边距等微调，不要用它切换布局骨架。

1. **触控目标 ≥ 44×44**。图标按钮至少 `size-11`，相邻可点元素间距 ≥ 8px。列表行内并排的三个图标按钮是误触制造机 —— 收进 overflow 菜单。
2. **单列优先**。默认 `grid gap-4`，宽屏才 `md:grid-cols-2`。绝不横向滚动（表格用卡片列表替代）。**禁止 `min-w-[Nrem]` 撑开的表格**。
3. **不要写两份 markup**。响应式列表用同一棵 DOM 树表达，`hidden md:block` + `md:hidden` 的双份渲染会导致两个断点的数据逐渐不对等 —— 这已经真实发生过（移动端看不到结算前后对比）。
4. **视口高度用 `svh`**，不用 `vh` / `dvh`（避开 iOS 地址栏跳动）。首页 hero 即 `min-h-[calc(100svh-3.5rem)]`。
5. **安全区**。固定底栏、sheet 必须加安全区内边距，统一用工具类，不要写 inline style。固定底栏占位要用 `calc(高度 + env(safe-area-inset-bottom))`，不能写死一个 `pb-20`。
6. **长文本一律 `truncate` 或 `line-clamp-2`**，容器配 `min-w-0` 防 flex 撑破。
7. **窄屏隐藏装饰**。首页的旋转背卡 `hidden sm:block`、右下浮标 `hidden lg:block` —— 装饰元素在移动端一律不渲染，不是缩小。
8. **弹出的数字键盘不能遮住正在编辑的字段**：要么 scroll-into-view，要么在键盘顶部醒目回显字段名与当前值。

---

## 6. 动效

| Token | 值 | 用于 |
| --- | --- | --- |
| `--motion-fast` | 120ms | hover / 按压 |
| `--motion-base` | 200ms | 展开、切换 |
| `--motion-slow` | 360ms | 进场 |

- 缓动统一 `--ease-out`（`cubic-bezier(0.22, 1, 0.36, 1)`）。
- 进场用 `.interface-enter`，次要元素 `.interface-enter-delayed`（+90ms 错峰）。同屏最多两级延迟。
- 只动 `opacity` 和 `transform`，不要动 `height` / `top`。
- 焦点环全局已定义（`outline: 3px ring/34%`），**不要在组件里覆盖**。

---

## 7. 检查清单

提交界面前逐条核对：

**机械项（可 grep）**
- [ ] 没有 Tailwind 原生色（`grep -nE '-(gray|slate|zinc|red|blue|green|amber)-[0-9]'`）
- [ ] 没有 `font-medium` / `font-black` / `font-extrabold`
- [ ] 没有裸 `rounded` 或 `rounded-[Npx]`；没有 `shadow-soft` / `shadow-md`
- [ ] 没有裸 `<select>` / `<input type="checkbox">` / `<input type="date">`
- [ ] 没有 `text-[8px]` / `[9px]` / `[11px]` / `[13px]`
- [ ] 没有 `dvh` / `vh`（一律 `svh`）
- [ ] 字距落在四个允许值内
- [ ] 所有数字都是 `font-mono`

**结构项**
- [ ] 卡片、页头、空状态、金额行都走了共享原语，没有手写
- [ ] 卡片用边框而不是阴影，圆角遵守"外大内小"
- [ ] 表单字段用 `<Field>`，错误接到了 `aria-invalid`
- [ ] 没有 `hidden md:block` + `md:hidden` 的双份 markup

**移动端（375px 实测）**
- [ ] 无横向滚动、无文字溢出
- [ ] 主操作按钮 `w-full` 且 ≥44px 高；所有可点元素 ≥44px
- [ ] 固定底栏没有遮挡内容尾部（含安全区）
- [ ] 数字键盘弹出时能看见正在编辑的字段

**状态与可达性**
- [ ] 空状态、加载态、错误态都有；加载优先用骨架屏而非全页 spinner
- [ ] 禁用的提交按钮旁边有可见的原因说明
- [ ] 语义不只靠颜色（欠/被欠要有符号或图标）
- [ ] 暗色模式下检查过一遍
- [ ] 相邻表面明度差 ≤ 0.04，没有深色反色块
- [ ] 列表行只有一个视觉重心，字号不超过三档
- [ ] 同一列表内各行等高，不因操作多寡而参差
- [ ] 左侧图标每行都不同（否则删掉）
