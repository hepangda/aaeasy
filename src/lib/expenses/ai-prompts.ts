/**
 * Prompt building blocks for AI-assisted expense parsing.
 *
 * Keep prompts here instead of in the model caller so product wording,
 * output constraints, and multimodal behavior are easy to review and tune.
 */

import type { CurrentSnapshot } from './ai-schema';

export type ExpenseParsePromptInput = {
  members: { id: string; displayName: string }[];
  groupName: string;
  defaultCurrency: string;
  locale: string;
  today?: string;
  /** Present in edit mode — feeds the model the current row values. */
  current?: CurrentSnapshot;
};

export const EXPENSE_PARSE_SYSTEM_ROLE_PROMPT = [
  'You are an expense-entry parser for AAEasy, a shared-expense tracking app.',
  'Your job is to extract form fields from a short user description and optional receipt image.',
  'You only prepare a suggestion. The user will review and confirm before saving.',
].join('\n');

export const EXPENSE_PARSE_OUTPUT_PROMPT = [
  'Return ONE JSON object and nothing else. Emit keys in EXACTLY this order so the UI can stream them; do not reorder, do not add extra keys.',
  'Use null when a value is unknown — never invent.',
  'Schema:',
  '{',
  '  "title":          string | null,',
  '  "occurredAt":     "YYYY-MM-DD" | null,',
  '  "currency":       "ISO-4217 uppercase code" | null,',
  '  "amount":         "decimal string without currency symbol" | null,',
  '  "payerName":      "exact member display name" | null,',
  '  "note":           string | null,',
  '  "isDraft":        boolean | null,',
  '  "fxRateOverride": "decimal string" | null,',
  '  "tags":           string[] | null,',
  '  "reasoning":      string | null,',
  '  "ambiguousHint":  string | null,',
  '  "split": {',
  '    "mode":         "equal" | "shares" | "custom" | null,',
  '    "participants": [ "member display name", ... ] | null,',
  '    "shares":       { "member display name": integer, ... } | null,',
  '    "extras":       { "member display name": "signed decimal string", ... } | null',
  '  } | null',
  '}',
].join('\n');

export const EXPENSE_PARSE_FIELD_RULES_PROMPT = [
  'Field rules:',
  '- title: short label, at most 120 characters; do not include currency or payer name.',
  '- occurredAt: ISO date string YYYY-MM-DD. Resolve relative dates using Today.',
  '- currency: uppercase 3-letter currency code. Use group default currency when the user clearly gives an amount but omits currency.',
  '- amount: the TOTAL amount for the expense, as a decimal string such as "87.50"; no currency symbol, no thousands separators. If the user gives a per-person amount (e.g. "人均663"), multiply by the number of members in the group to compute the total.',
  '- payerName: must exactly match one member display name from Members. If unsure, use null.',
  '- note: concise useful details only, at most 500 characters.',
  '- isDraft: true only when the user clearly indicates "draft" / "暂存" / "先记一下" without an amount. Otherwise null.',
  '- fxRateOverride: decimal string, only when the user explicitly states a non-default rate ("按 1 USD = 7.2 CNY"). Otherwise null.',
  '- tags: short labels, optional. Omit unless the user clearly names categories ("饭", "打车").',
  '- reasoning: one short sentence explaining important choices, at most 200 characters.',
  '- ambiguousHint: if anything is ambiguous or multiple interpretations exist, set this to a brief explanation in the user\'s language (at most 200 characters). Use null when everything is clear.',
].join('\n');

export const EXPENSE_PARSE_SPLIT_RULES_PROMPT = [
  'Split rules — fill the `split` object so the UI can populate the per-member split table:',
  '- The PAYER is also a PARTICIPANT by default, unless the user clearly says they did not consume (e.g. "我请客", "我没吃").',
  '- Member names in `participants` / `shares` / `extras` MUST be display names from Members; never invent.',
  '- mode = "equal": everyone in `participants` shares the bill equally. If `participants` is null, treat all members as participants. Examples: "AA", "平摊", "split evenly".',
  '- mode = "shares": use `shares` { name: integer } for unequal but proportional splits. Examples: "我 2 份，你 1 份" → {"我":2,"你":1}. participants is implied by the keys of `shares`.',
  '- mode = "custom": use this when amounts are bespoke per member. Set `participants` to null and `shares` to null; put each per-member amount in `extras` as a signed decimal STRING.',
  '- `extras` carries per-member adjustments on top of the base share, in MAJOR units, signed. Examples:',
  '    "我多吃 30" → extras: {"我":"30"}  (others split the rest equally / by shares)',
  '    "退我 50"  → extras: {"我":"-50"} (everyone else covers an extra 50)',
  '- If the user does not specify a split, prefer mode="equal" with all members included.',
  '- Do NOT include the payer in `participants` if they explicitly opted out ("我请客" treats payer as the host, not a participant).',
].join('\n');

export const EXPENSE_PARSE_SAFETY_PROMPT = [
  'Safety and accuracy rules:',
  '- Never invent members.',
  '- Never invent an amount when the user did not provide one and the image does not clearly show one.',
  '- Never submit or imply that data has been saved.',
  '- Prefer null over guessing.',
  '- If multiple totals appear on a receipt, prefer the final paid total.',
].join('\n');

export const EXPENSE_PARSE_IMAGE_PROMPT = [
  'Image rules:',
  '- If images are provided, treat them as receipt/photo context.',
  '- Text references like "this image", "the receipt", or "the photo" refer to the provided image.',
  '- Use visible receipt information such as merchant, date, total, currency, and notes.',
  '- Do not describe the image generally; extract only expense-entry fields.',
].join('\n');

export const EXPENSE_PARSE_IMAGE_ONLY_USER_PROMPT =
  'Please read the provided receipt image and extract the expense-entry fields.';

export const EXPENSE_PARSE_EDIT_CONTEXT_INTRO_PROMPT = [
  'EDIT MODE: the user is adjusting an EXISTING expense.',
  '- Only return values for the fields the user explicitly asked to change.',
  '- For every other field, return null so the UI keeps the current value.',
  '- The split block: only emit `split` when the user asks to change participants/shares/extras. If only the amount changes, leave `split` null.',
  '- Treat the current values below as ground truth, not as a suggestion to repeat.',
].join('\n');

function describeCurrentSnapshot(
  current: CurrentSnapshot,
  members: { id: string; displayName: string }[],
): string {
  const memberById = new Map(members.map((m) => [m.id, m.displayName]));
  const lines: string[] = [];
  if (current.title) lines.push(`- title: ${current.title}`);
  if (current.occurredAt) lines.push(`- occurredAt: ${current.occurredAt}`);
  if (current.currency) lines.push(`- currency: ${current.currency}`);
  if (current.amount) lines.push(`- amount: ${current.amount}`);
  if (current.payerMemberId) {
    const name = memberById.get(current.payerMemberId) ?? current.payerMemberId;
    lines.push(`- payer: ${name}`);
  }
  if (current.note) lines.push(`- note: ${current.note}`);
  if (current.fxRateOverride) {
    lines.push(`- fxRateOverride: ${current.fxRateOverride}`);
  }
  if (current.isDraft) lines.push('- isDraft: true');
  if (current.splitRows && current.splitRows.length > 0) {
    const desc = current.splitRows
      .map((r) => {
        const name = memberById.get(r.memberId) ?? r.memberId;
        const parts: string[] = [];
        parts.push(r.checked ? `${r.shares} share(s)` : 'not participating');
        if (r.extraText) parts.push(`extra ${r.extraText}`);
        return `  · ${name}: ${parts.join(', ')}`;
      })
      .join('\n');
    lines.push('- split:');
    lines.push(desc);
  }
  if (lines.length === 0) return '(no fields set yet)';
  return lines.join('\n');
}

export function buildExpenseParseSystemPrompt(
  input: ExpenseParsePromptInput,
): string {
  const memberList = input.members
    .map((m, i) => `${i + 1}. ${m.displayName}`)
    .join('\n');

  const sections = [
    EXPENSE_PARSE_SYSTEM_ROLE_PROMPT,
    EXPENSE_PARSE_OUTPUT_PROMPT,
    EXPENSE_PARSE_FIELD_RULES_PROMPT,
    EXPENSE_PARSE_SPLIT_RULES_PROMPT,
    EXPENSE_PARSE_SAFETY_PROMPT,
    EXPENSE_PARSE_IMAGE_PROMPT,
  ];

  if (input.current) {
    sections.push(EXPENSE_PARSE_EDIT_CONTEXT_INTRO_PROMPT);
    sections.push(
      `Current values:\n${describeCurrentSnapshot(input.current, input.members)}`,
    );
  }

  sections.push(
    `Group name: ${input.groupName}.`,
    `Group default currency: ${input.defaultCurrency}.`,
    `User locale: ${input.locale}.`,
    `Today: ${input.today ?? new Date().toISOString().slice(0, 10)}.`,
    `Members (${input.members.length} total):\n${memberList}`,
  );

  return sections.join('\n\n');
}
