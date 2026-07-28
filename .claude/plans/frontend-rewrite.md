# 前端全面重写计划

## 已确认的三个决策

1. **卡片规范以首页为准** —— 业务界面 13 处 `rounded-xl` + `shadow-soft` 全部改为 `rounded-2xl` + 无阴影，`shadow-soft` token 从 `globals.css` 删除。
2. **分摊模型不动** —— 保留「份额 + 额外金额」单一模型与 `EXACT` 持久化，只重做分摊编辑器的 UI 与移动端布局。不碰后端契约。
3. **先搭组件测试** —— 加 jsdom + Testing Library，为新原语写冒烟测试，再开始改造。

---

## 现状基线（四份调研汇总）

**已经达标的**：语义色 token 纪律（原生调色板全库 0 匹配）、`useModalLayer` 的模态语义、Tabs 的 ARIA 与键盘支持、skip link 与 `aria-current`。

**量化的漂移**：

| 维度 | 现状 |
| --- | --- |
| `rounded-*` | 122 处 9 种值；`rounded-2xl` 仅 2 处；裸 `rounded` 21 处；`rounded-[2px]` 1 处 |
| `font-medium` | 48 处 / 21 文件（规范禁止），其中约 30 处在三个表格组件的 `th`/`td` |
| 微型字号 | `text-[8/9/10/11/13px]` 共 34 处 |
| `tracking-[…]` | 25 种值，规范只定义 4 种；`0.12em` 用了 7 次 vs 规范 `0.13em` |
| 卡片阴影 | 12 处 `shadow-soft` 叠在已有边框的静态卡上；另有 4 处 off-token `shadow-md` |
| 非等宽数字 | 约 10 处，含数字键盘主读数 |
| 负号 | 全库零处使用 U+2212，`formatMinor` 输出 ASCII 连字符 |
| 视口单位 | `app-layout` 用 `dvh`、`home` 用 `svh`，规范定 `svh` |
| 安全区内边距 | 4 种写法并存 |

**移动端硬伤**：
- 账单流列表右列硬占 108px，375px 下标题只剩 219px；三个 32px 图标按钮间距 2px，删除键在最右
- 底栏 64px + 安全区 ≈ 98px，但 `main` 写死 `pb-20`(80px)，刘海屏永久遮挡 18px
- 金额输入框在 375px 下仅 147px 却渲染 `text-3xl`，约 8 字符即溢出
- 数字键盘 sheet 占视口 50%+，无 scroll-into-view，编辑靠后字段等于盲打
- 触屏下 `NumericInput` 是 `readOnly`，导致 `required` 被 HTML 规范排除在约束校验外，手机端原生校验完全失效
- 复选框 `size-4`(16px)，是移动端分摊列表主控件
- 结算汇总表移动端只显示一个数字，桌面版有「结算前/当前」两列 —— **数据不对等**
- `min-w-[42rem]` 表格在 640–671px 区间横向滚动且无提示
- 640–1024px 区间同时出现 Tab 栏与底栏两套冗余导航

**信息架构错位**：
- 「结算」这一最重要动作藏在无标签 `⋯` 菜单里，与「导出」同级；`LedgerPageHeader` 的 `primaryAction` 槽位从未被使用
- 结算与重开是一个状态机的两半，却分散在头部菜单与设置 Tab
- 群组列表不显示余额，却给货币代码一个专属列
- `SettlementStatus`（全页最响亮的深色卡）在第二个 Tab，首屏不可见
- 分摊差额提示写在默认折叠的 `<details>` 内，用户只看到变灰的保存按钮而无任何解释
- 移动端无法切换群组（群组列表只在 `lg:flex` 侧栏）
- 登录页是纯重定向，外部端点失败时会陷入无提示的重定向循环

**一致性崩坏**：卡片表面 7 种、页头 4 种、返回导航 3 种、空状态 3 种、徽章 5 种、display 字距 7 个值。`EmptyState` 只被用 1 次，`ui/dropdown-menu.tsx` 闲置而 `LedgerActionsMenu` 手写一套，两套确认弹窗系统并存。

**测试现状**：vitest `environment: node`，`include` 只有 `.ts`，19 个测试文件全是纯函数单测，**组件测试为零** —— 可以重写 100% 标记而 `pnpm check` 保持全绿。真正的护栏只有 `prettier --check`（Tailwind 插件强制类名顺序）、`tsc --noEmit`、`vite build`。

---

## 批次划分

每批独立提交，跑 `pnpm format && pnpm check`。

### 批次 0 — 测试地基与文档校正

- `vitest.config.ts`：改 `environment: 'jsdom'`，`include` 增加 `.tsx`
- 装 `jsdom`、`@testing-library/react`、`@testing-library/jest-dom`、`@testing-library/user-event`
- 新增 `src/test/setup.ts`
- 修订 `docs/design-language.md`：卡片规范锁定 `rounded-2xl` + 无阴影 + `p-5 sm:p-6`；补充本次确定的 token（sunken surface 透明度、scrim、safe-area、`svh`）

### 批次 1 — 设计 token 与跨切面修复

- `globals.css`：删 `--surface-shadow`/`shadow-soft`；加 `--scrim`、2–3 档 sunken surface、统一 tracking 与微型字号 token
- `packages/core/src/money.ts`：`formatMinor` 输出 U+2212；同步更新 `src/lib/money/index.test.ts`
- 全局 `dvh` → `svh`（6 处）
- 安全区内边距统一为一个工具类（4 种写法收敛）
- `bottom-sheet` 的 `bg-black/40` → `--scrim`

### 批次 2 — 新原语

新建，各配冒烟测试：

| 原语 | 说明 |
| --- | --- |
| `ui/card.tsx` | `Card`/`CardHeader`/`CardBody`，tone: default/danger/inverted |
| `ui/eyebrow.tsx` | 收编 17 处 6 种写法 |
| `ui/page-header.tsx` | `PageHeader` + `SectionHeader`，含 backLink/action/badge/divider |
| `ui/amount-row.tsx` | 规范化的金额列表行，含符号与语义色 |
| `ui/checkbox.tsx` | 44px 触控区（当前缺失） |
| `ui/field.tsx` | Label + 控件 + 错误，接线 `aria-invalid`/`aria-describedby` |
| `ui/form-dialog.tsx` | 收编 5 处手写 Dialog + 7 处重复 footer |
| `ui/danger-zone.tsx` | 收编 2 处近乎逐字重复的危险区块 |
| `hooks/use-async-action.ts` | 收编 31 处 `showI18nError` + 18 处 `useTransition` 五步骤 |

同时扩展 `ConfirmOptions` 加 `body?: ReactNode`，让 Group B 的 5 处手写 Dialog 能并入。

### 批次 3 — 布局与导航重设计

- 断点策略统一：内容与导航都在 `md`(768) 分支，消灭 640–1024px 的双导航区间
- 底栏高度改为 `calc(4rem + env(safe-area-inset-bottom))`，`main` 的 `pb` 跟随该值
- 移动端头部加返回按钮与页面标题；加群组切换入口（drawer 或头部下拉）
- 底栏导航项集稳定化，记账页保留返回路径
- 所有触控目标提到 44px：分页 `size-8`→`size-11`、群组行 `min-h-9`→`min-h-11`、Dialog 关闭键、feed 图标按钮
- 加骨架屏层级，消除连续两次全页 spinner 的 gate
- 加路由变更时的焦点重置与朗读
- 底栏 `aria-label` 从「操作」改为正确的导航标签
- `FloatingPanel` 并入 `useModalLayer`，补 `pointerdown`/触屏关闭

### 批次 4 — 列表与表格（移动端重灾区）

- `expense-feed`：重排为规范列表行，右列改自适应；操作键收进 overflow 菜单或加大间距；日期分组头改用 `Eyebrow`
- `ledger-summary-table`：删掉双份 markup，改为单一响应式卡片列表；**补齐移动端缺失的「结算前/当前」数据**
- `draft-fill-panel`：同上，去掉 `min-w-[480px]`
- 三处表格的 ~30 个 `font-medium` 随之消失

### 批次 5 — 业务页面改造

按页套用新原语：`groups`（加余额列，去货币列）、`group-detail`（结算提到 `primaryAction`，结算/重开归位到一处）、`account`、`share`、`auth`（补失败状态与返回出口）、`page-state`。同时把 `LedgerActionsMenu` 换成 `ui/dropdown-menu`，5+ 处手写空状态换成 `EmptyState`。

### 批次 6 — 记账表单

- 拆分为 `expense-form/` 目录：`use-split-rows.ts`、`split-editor.tsx`、`ai-assist-panel.tsx`、`use-receipt-staging.ts`、`form-shell.tsx`，纯函数移入 `lib/split/`
- `baseText` 改为 `useMemo` 派生而非存储，消除 `recomputeKey` 效应与 eslint 抑制
- title/date/payer/note/fx 改为受控，让 AI 写入走 React，统一高亮反馈
- **分摊差额提示移到折叠面板外**，紧邻保存按钮，加 `role="alert"` 与非纯颜色信号
- 金额输入改为 `Input variant="display"`；货币选择器收窄为代码 chip
- 数字键盘加 scroll-into-view 与醒目的字段标签＋数值回显
- 修复移动端 `required` 失效（改为显式校验而非依赖原生约束）
- 复选框换用新 `Checkbox` 原语

### 批次 7 — 收尾

Tier 3/4 零散组件、裸 `rounded` 21 处、`rounded-[2px]`、`shadow-md` 4 处、残留 `font-medium`、非等宽数字 10 处、成员头像色板亮度校验（当前白字配琥珀色对比度不足）、清理死代码（`void extraMinors` 等）、重复常量 `MAX_BYTES`/`ALLOWED` 提取。

---

## 风险与约定

- **每批必须 `pnpm format` 在前**，否则 Tailwind 类名顺序会让 `format:check` 失败
- 批次 1 的 U+2212 改动会破坏 `src/lib/money/index.test.ts`，需同批更新
- i18n 的 391 个 key 全部复用，不新增不重命名；如 IA 调整需要新文案，在该批次内同步补 `messages/{en,zh}.json`
- 批次 3 之后建议你在真机或 375px 视口过一遍再继续
- 批次 6 体量最大，可再拆为「拆文件」与「改 UI」两次提交
