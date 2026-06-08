/**
 * AI-assisted expense parsing (non-streaming).
 *
 * Sends a free-form natural-language description of a single expense to a
 * chat completion endpoint (DeepSeek's OpenAI-compatible API by default)
 * and asks the model to return a strict JSON object describing what to
 * pre-fill in the create-expense form.
 *
 * The result is treated as advisory — the user always reviews and confirms
 * the values before submission. We never auto-submit anything.
 *
 * Kept for non-streaming callers (scripts, fallback). The live form goes
 * through `aiParseExpenseStream` instead. Both share schemas/normalizers
 * via `ai-schema.ts`.
 *
 * Configuration (env):
 *   AI_GATEWAY_TOKEN  Required Cloudflare AI Gateway bearer token. Sent as
 *                     `cf-aig-authorization`.
 *   AI_API_KEY        Optional upstream bearer token for direct API calls.
 *   DASHSCOPE_API_KEY Optional upstream fallback token for direct DashScope.
 *   AI_API_URL        Optional. Defaults to DashScope when using Qwen,
 *                     otherwise DeepSeek's chat-completions URL.
 *   AI_MODEL          Optional. Defaults to `deepseek-chat`.
 *   AI_PROVIDER       Optional. Set to `aliyun` to force DashScope defaults.
 *   AI_ENABLE_IMAGE_CONTEXT Optional. Set to `true` to force-enable images.
 *
 * The endpoint must support `response_format: { type: 'json_object' }`.
 */

import 'server-only';
import {
  EXPENSE_PARSE_IMAGE_ONLY_USER_PROMPT,
  buildExpenseParseSystemPrompt,
} from '@/lib/expenses/ai-prompts';
import {
  AiParseError,
  aiResponseSchemaV2,
  buildSplitRows,
  normalizeAmount,
  normalizeCurrency,
  normalizeFxRate,
  normalizeNote,
  normalizeOccurredAt,
  normalizeShortText,
  normalizeTitle,
  resolveMemberId,
  type CurrentSnapshot,
} from '@/lib/expenses/ai-schema';
import type { SplitInputRow } from '@/lib/split/input-state';

export { AiParseError } from '@/lib/expenses/ai-schema';

export type AiParseInput = {
  text: string;
  images?: { mime: string; dataUrl: string; name?: string }[];
  members: { id: string; displayName: string }[];
  groupName: string;
  defaultCurrency: string;
  locale: string;
  current?: CurrentSnapshot;
};

export type AiParsedExpense = {
  title: string | null;
  occurredAt: string | null;
  currency: string | null;
  amount: string | null;
  payerMemberId: string | null;
  note: string | null;
  isDraft: boolean | null;
  fxRateOverride: string | null;
  split: {
    mode: 'equal' | 'shares' | 'custom';
    rows: SplitInputRow[];
  } | null;
  unresolved: {
    payerName?: string;
    participants?: string[];
  };
  reasoning: string | null;
  ambiguousHint: string | null;
};

const MAX_INPUT_CHARS = 1_000;
const TIMEOUT_MS = 60_000;
const DASHSCOPE_COMPAT_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const DEEPSEEK_CHAT_URL = 'https://api.deepseek.com/chat/completions';

function shouldLogTiming() {
  return process.env.AI_DEBUG_TIMING === 'true';
}

export function resolveAiConfig() {
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
    gatewayToken: process.env.AI_GATEWAY_TOKEN,
    model,
    url: explicitUrl ?? (isDashScope ? DASHSCOPE_COMPAT_URL : DEEPSEEK_CHAT_URL),
    supportsImageContext: process.env.AI_ENABLE_IMAGE_CONTEXT === 'true' || isDashScope,
  };
}

/** Call the upstream LLM and return a normalized suggestion. */
export async function aiParseExpense(input: AiParseInput): Promise<AiParsedExpense> {
  const { apiKey, gatewayToken, model, url, supportsImageContext } = resolveAiConfig();
  if (!gatewayToken) throw new AiParseError('NOT_CONFIGURED');

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
        'cf-aig-authorization': `Bearer ${gatewayToken}`,
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
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
      aiGateway: Boolean(gatewayToken),
      textChars: text.length,
      imageCount: images.length,
      requestBytes: Buffer.byteLength(requestBody),
      upstreamMs: upstreamMs === null ? null : Math.round(upstreamMs),
      responseBytes,
      totalMs: Math.round(performance.now() - timingStartedAt),
    });
  }

  const content = (
    raw as {
      choices?: { message?: { content?: string } }[];
    }
  )?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new AiParseError('UPSTREAM_INVALID');

  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
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

  const parsed = aiResponseSchemaV2.safeParse(json);
  if (!parsed.success) throw new AiParseError('UPSTREAM_INVALID');
  const data = parsed.data;

  const unresolved: { payerName?: string; participants?: string[] } = {};

  let payerMemberId: string | null = null;
  if (data.payerName) {
    payerMemberId = resolveMemberId(data.payerName, input.members);
    if (!payerMemberId) unresolved.payerName = data.payerName;
  }

  let split: AiParsedExpense['split'] = null;
  if (data.split) {
    const built = buildSplitRows({ members: input.members, split: data.split });
    split = { mode: built.mode, rows: built.rows };
    if (built.unresolvedParticipants.length > 0) {
      unresolved.participants = built.unresolvedParticipants;
    }
  }

  return {
    title: normalizeTitle(data.title),
    occurredAt: normalizeOccurredAt(data.occurredAt),
    currency: normalizeCurrency(data.currency),
    amount: normalizeAmount(data.amount),
    payerMemberId,
    note: normalizeNote(data.note),
    isDraft: typeof data.isDraft === 'boolean' ? data.isDraft : null,
    fxRateOverride: normalizeFxRate(data.fxRateOverride),
    split,
    unresolved,
    reasoning: normalizeShortText(data.reasoning, 300),
    ambiguousHint: normalizeShortText(data.ambiguousHint, 300),
  };
}
