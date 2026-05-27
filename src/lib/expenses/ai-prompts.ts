/**
 * Prompt building blocks for AI-assisted expense parsing.
 *
 * Keep prompts here instead of in the model caller so product wording,
 * output constraints, and multimodal behavior are easy to review and tune.
 */

export type ExpenseParsePromptInput = {
  members: { id: string; displayName: string }[];
  groupName: string;
  defaultCurrency: string;
  locale: string;
  today?: string;
};

export const EXPENSE_PARSE_SYSTEM_ROLE_PROMPT = [
  'You are an expense-entry parser for AAEasy, a shared-expense tracking app.',
  'Your job is to extract form fields from a short user description and optional receipt image.',
  'You only prepare a suggestion. The user will review and confirm before saving.',
].join('\n');

export const EXPENSE_PARSE_OUTPUT_PROMPT = [
  'Return ONE JSON object and nothing else.',
  'All keys are required; use null when a value is unknown.',
  'Schema:',
  '{',
  '  "title": string | null,',
  '  "occurredAt": "YYYY-MM-DD" | null,',
  '  "currency": "ISO-4217 uppercase code" | null,',
  '  "amount": "decimal string without currency symbol" | null,',
  '  "payerName": "exact member display name" | null,',
  '  "note": string | null,',
  '  "reasoning": string | null,',
  '  "ambiguousHint": string | null',
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
  '- reasoning: one short sentence explaining important choices, at most 200 characters.',
  '- ambiguousHint: if anything is ambiguous or multiple interpretations exist, set this to a brief explanation in the user\'s language (at most 200 characters). Examples: currency is unclear, a name partially matches multiple members, date could be interpreted differently. Use null when everything is clear.',
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

export function buildExpenseParseSystemPrompt(
  input: ExpenseParsePromptInput,
): string {
  const memberList = input.members
    .map((m, i) => `${i + 1}. ${m.displayName}`)
    .join('\n');

  return [
    EXPENSE_PARSE_SYSTEM_ROLE_PROMPT,
    EXPENSE_PARSE_OUTPUT_PROMPT,
    EXPENSE_PARSE_FIELD_RULES_PROMPT,
    EXPENSE_PARSE_SAFETY_PROMPT,
    EXPENSE_PARSE_IMAGE_PROMPT,
    `Group name: ${input.groupName}.`,
    `Group default currency: ${input.defaultCurrency}.`,
    `User locale: ${input.locale}.`,
    `Today: ${input.today ?? new Date().toISOString().slice(0, 10)}.`,
    `Members (${input.members.length} total):`,
    memberList,
  ].join('\n\n');
}
