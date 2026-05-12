/**
 * AI-assisted expense parsing.
 *
 * Sends a free-form natural-language description of a single expense to a
 * chat completion endpoint (DeepSeek's OpenAI-compatible API by default)
 * and asks the model to return a strict JSON object describing what to
 * pre-fill in the create-expense form.
 *
 * The result is treated as advisory — the user always reviews and confirms
 * the values before submission. We never auto-submit anything.
 *
 * Configuration (env):
 *   AI_API_KEY        Preferred bearer token for the OpenAI-compatible API.
 *   DASHSCOPE_API_KEY Optional fallback token for Aliyun DashScope.
 *   AI_API_URL        Optional. Defaults to DashScope when using Qwen,
 *                     otherwise DeepSeek's chat-completions URL.
 *   AI_MODEL          Optional. Defaults to `deepseek-chat`.
 *   AI_PROVIDER       Optional. Set to `aliyun` to force DashScope defaults.
 *   AI_ENABLE_IMAGE_CONTEXT Optional. Set to `true` to force-enable images.
 *
 * The endpoint must support `response_format: { type: 'json_object' }`.
 */

import 'server-only';
import { z } from 'zod';
import { isCurrencyCode } from '@/lib/money';
import {
  EXPENSE_PARSE_IMAGE_ONLY_USER_PROMPT,
  buildExpenseParseSystemPrompt,
} from '@/lib/expenses/ai-prompts';

export type AiParseInput = {
  /** Free-form text from the user (e.g. "昨天午餐 87.5 块，张三付的，三个人平摊"). */
  text: string;
  /** Optional images to provide visual context for extraction. Data URLs only. */
  images?: { mime: string; dataUrl: string; name?: string }[];
  /** Members of the target group, used to resolve the payer. */
  members: { id: string; displayName: string }[];
  /** The group's default currency, used as the fallback when the model
   *  doesn't pick one explicitly. */
  defaultCurrency: string;
  /** Locale of the caller, surfaced to the model so it picks a date format
   *  the user expects. */
  locale: string;
};

export type AiParsedExpense = {
  /** Free-text title of the expense (≤ 120 chars). */
  title: string | null;
  /** ISO date string, YYYY-MM-DD. May be null if the model couldn't tell. */
  occurredAt: string | null;
  /** Currency code, uppercase 3-letter. May be null. */
  currency: string | null;
  /** Decimal amount as a string, e.g. "87.50". May be null in draft scenarios. */
  amount: string | null;
  /** id of the matched payer member, or null. */
  payerMemberId: string | null;
  /** Free-form note (≤ 500 chars), or null. */
  note: string | null;
  /** A short rationale the model returned, to surface to the user. */
  reasoning: string | null;
};

export class AiParseError extends Error {
  constructor(
    public code:
      | 'NOT_CONFIGURED'
      | 'EMPTY_INPUT'
      | 'TOO_LONG'
      | 'IMAGE_UNSUPPORTED'
      | 'UPSTREAM_FAILED'
      | 'UPSTREAM_INVALID'
      | 'TIMEOUT',
    message?: string,
  ) {
    super(message ?? code);
  }
}

const MAX_INPUT_CHARS = 1_000;
const TIMEOUT_MS = 60_000;
const DASHSCOPE_COMPAT_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const DEEPSEEK_CHAT_URL = 'https://api.deepseek.com/chat/completions';

function shouldLogTiming() {
  return process.env.AI_DEBUG_TIMING === 'true';
}

function resolveAiConfig() {
  const model = process.env.AI_MODEL ?? 'deepseek-chat';
  const provider = process.env.AI_PROVIDER?.toLowerCase();
  const explicitUrl = process.env.AI_API_URL;
  const isQwen = /qwen/i.test(model);
  const isDashScope =
    provider === 'aliyun' ||
    provider === 'dashscope' ||
    isQwen ||
    explicitUrl?.includes('dashscope.aliyuncs.com') === true;

  return {
    apiKey: process.env.AI_API_KEY ?? process.env.DASHSCOPE_API_KEY,
    model,
    url: explicitUrl ?? (isDashScope ? DASHSCOPE_COMPAT_URL : DEEPSEEK_CHAT_URL),
    supportsImageContext:
      process.env.AI_ENABLE_IMAGE_CONTEXT === 'true' || isDashScope,
  };
}

/** Schema we ask the model to conform to. We accept null for every field
 *  so partial extractions don't bork the whole request. */
const aiResponseSchema = z.object({
  title: z.string().max(120).nullable().optional(),
  occurredAt: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  amount: z.union([z.string(), z.number()]).nullable().optional(),
  payerName: z.string().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  reasoning: z.string().max(500).nullable().optional(),
});

/** Call the upstream LLM and return a normalized suggestion. */
export async function aiParseExpense(
  input: AiParseInput,
): Promise<AiParsedExpense> {
  const { apiKey, model, url, supportsImageContext } = resolveAiConfig();
  if (!apiKey) throw new AiParseError('NOT_CONFIGURED');

  const text = input.text.trim();
  const images = input.images ?? [];
  if (!text && images.length === 0) throw new AiParseError('EMPTY_INPUT');
  if (text.length > MAX_INPUT_CHARS) throw new AiParseError('TOO_LONG');
  if (images.length > 0 && !supportsImageContext) {
    throw new AiParseError('IMAGE_UNSUPPORTED');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const userContent =
    images.length === 0
      ? text
      : [
          {
            type: 'text' as const,
            text: text || EXPENSE_PARSE_IMAGE_ONLY_USER_PROMPT,
          },
          ...images.map((img) => ({
            type: 'image_url' as const,
            image_url: { url: img.dataUrl },
          })),
        ];
  const requestBody = JSON.stringify({
    model,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildExpenseParseSystemPrompt(input) },
      { role: 'user', content: userContent },
    ],
  });
  const timingStartedAt = performance.now();
  let upstreamMs: number | null = null;
  let responseBytes: number | null = null;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: requestBody,
      signal: controller.signal,
    });
    upstreamMs = performance.now() - timingStartedAt;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new AiParseError('TIMEOUT');
    throw new AiParseError('UPSTREAM_FAILED', (e as Error).message);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new AiParseError('UPSTREAM_FAILED', `HTTP ${res.status}`);
  }

  let raw: unknown;
  try {
    const rawText = await res.text();
    responseBytes = Buffer.byteLength(rawText);
    raw = JSON.parse(rawText);
  } catch {
    throw new AiParseError('UPSTREAM_INVALID');
  }

  if (shouldLogTiming()) {
    console.info('[ai-parse] upstream timing', {
      model,
      host: new URL(url).host,
      textChars: text.length,
      imageCount: images.length,
      requestBytes: Buffer.byteLength(requestBody),
      upstreamMs: upstreamMs === null ? null : Math.round(upstreamMs),
      responseBytes,
      totalMs: Math.round(performance.now() - timingStartedAt),
    });
  }

  // OpenAI-compatible shape: { choices: [{ message: { content: string } }] }
  const content = (raw as {
    choices?: { message?: { content?: string } }[];
  })?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new AiParseError('UPSTREAM_INVALID');

  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    // Some models occasionally wrap the JSON in markdown fences.
    const stripped = content
      .replace(/^```(?:json)?/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    try {
      json = JSON.parse(stripped);
    } catch {
      throw new AiParseError('UPSTREAM_INVALID');
    }
  }

  const parsed = aiResponseSchema.safeParse(json);
  if (!parsed.success) throw new AiParseError('UPSTREAM_INVALID');
  const data = parsed.data;

  // Normalize / sanity-check fields.
  const title = data.title?.trim() || null;
  const note = data.note?.trim() || null;
  const reasoning = data.reasoning?.trim() || null;

  let occurredAt: string | null = null;
  if (data.occurredAt) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(data.occurredAt);
    if (m) occurredAt = m[1] ?? null;
  }

  let currency: string | null = null;
  if (data.currency) {
    const c = data.currency.trim().toUpperCase();
    if (isCurrencyCode(c)) currency = c;
  }

  let amount: string | null = null;
  if (data.amount != null) {
    const a = String(data.amount).trim().replace(/[^\d.]/g, '');
    if (a && /^\d+(\.\d+)?$/.test(a)) amount = a;
  }

  let payerMemberId: string | null = null;
  if (data.payerName) {
    const want = data.payerName.trim().toLowerCase();
    const hit =
      input.members.find((m) => m.displayName.toLowerCase() === want) ??
      input.members.find((m) =>
        m.displayName.toLowerCase().includes(want),
      );
    payerMemberId = hit?.id ?? null;
  }

  return {
    title,
    occurredAt,
    currency,
    amount,
    payerMemberId,
    note,
    reasoning,
  };
}
