# 记一笔 · 备注改为「渐进式披露」的可选项

## 问题

1. **尺寸说了谎。** `expense-form.tsx` 里备注是 `Textarea rows={2}` + `min-h-24`（96px），
   和金额/事由/垫付人这些必填项一样重。用户看到一个大框，自然以为该写长文。
2. **可选项占了必填项的版面。** 它常驻在表单底部、Save 栏正上方，是提交前最后看到的东西。
3. **上限自相矛盾。** `packages/contracts/src/expenses.ts:49` 是 `max(2000)`，
   而同文件 `:70`（结算备注）是 `max(200)`。消费流里备注根本不渲染正文 ——
   `expense-feed.tsx:135` 只把它挂成 `<h3 title>`，`:149` 只显示一个 `StickyNote` 图标。
   产品实际定位就是「一句话补充」。

## 方案：折叠触发 + 单行自增高

### 空状态（新建，且无既有备注）
备注区只渲染一个低调的 ghost 文字按钮：`+ 添加备注`，一行高，左对齐，
`text-muted-foreground text-sm`，配 `StickyNote` 小图标（与消费流的图标语言一致）。

### 展开态
点击后原地替换为一个 auto-grow 的 `textarea`：
- `rows={1}`，`field-sizing: content`（Tailwind v4 已支持 `field-sizing-content`），
  搭配 `min-h-0 max-h-24 resize-none`，即 1 行起、最多约 3 行后内部滚动。
- 挂载即 `focus()`。
- `placeholder` 给出示范，暗示长度期望。
- 右侧一个 `X` 图标按钮：收起并清空（回到空状态）。
- 失焦且内容为空时自动收起。

### 编辑既有费用
`defaults?.note` 非空时默认就是展开态，不需要多点一次。

### 长度
统一收紧到 **200**，与结算备注、与消费流的单行展示对齐。
接近上限（≥160）时才在右下角显示 `n/200` 计数，平时不显示。

## 改动清单

1. **`packages/contracts/src/expenses.ts:49`** — `max(2000)` → `max(200)`。
2. **数据迁移** — 新增 `drizzle/0001_truncate_expense_note.sql`：
   `UPDATE expenses SET note = left(note, 200) WHERE length(note) > 200;`
   （按你的确认：直接截断。`expenses.note` 是 `text`，不加列约束，只做一次性数据清理。）
3. **新组件 `src/components/ui/optional-note.tsx`** — 受控/非受控皆可的
   「折叠 → 展开」备注字段，内部持有 `open` 状态，对外仍渲染一个
   `name="note"` 的原生 textarea，因此 `src/spa/actions/expenses.ts:18`
   的 `formString(formData, 'note')` 完全不用改。
4. **`src/components/expense/expense-form.tsx:815-825`** — 换成 `<OptionalNote>`，
   `maxLength` 200，`defaultValue={defaults?.note ?? ''}`。
5. **文案 `messages/zh.json` / `en.json`**（`expenses` 段）：
   - `note` 从「备注（可选）」改为「备注」（可选性现在由交互本身表达，不再靠括号）
   - 新增 `note_add`：`添加备注` / `Add a note`
   - 新增 `note_placeholder`：`一句话就好，例如「含小费」` / `One line is enough, e.g. "incl. tip"`
   - 新增 `note_remove`：`删除备注` / `Remove note`

## 不做

- 不改 `expense-feed.tsx` 的展示（图标 + tooltip 的现状与新定位一致）。
- 不动 `settlementEntrySchema.note`（本来就是 200）。
- 不动 `packages/db/src/schema.ts` 的 `text` 列类型。

## 验证

- `pnpm test` + `pnpm lint`
- 手动：新建费用（不展开备注 → 保存成功、note 为 null）；展开写一行 → 保存；
  编辑一条既有带备注的费用 → 默认展开且内容正确；点 X → 清空并收起。
