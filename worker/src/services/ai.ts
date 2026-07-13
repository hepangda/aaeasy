import type { WorkerEnv } from '../env';
import { z } from 'zod';

export type AiMember = { id: string; displayName: string };
export type SplitRow = {
  memberId: string;
  checked: boolean;
  shares: string;
  extraText: string;
};

export type CurrentExpenseSnapshot = {
  title?: string | null;
  occurredAt?: string | null;
  currency?: string | null;
  amount?: string | null;
  payerMemberId?: string | null;
  note?: string | null;
  isDraft?: boolean;
  splitRows?: SplitRow[];
  fxRateOverride?: string | null;
};

export type AiSuggestion = {
  title: string | null;
  occurredAt: string | null;
  currency: string | null;
  amount: string | null;
  payerMemberId: string | null;
  note: string | null;
  isDraft: boolean | null;
  fxRateOverride: string | null;
  tags: string[] | null;
  split: { mode: 'equal' | 'shares' | 'custom'; rows: SplitRow[] } | null;
  unresolved: { payerName?: string; participants?: string[] };
  reasoning: string | null;
  ambiguousHint: string | null;
};

export class AiParseError extends Error {
  constructor(
    public readonly code:
      | 'NOT_CONFIGURED'
      | 'EMPTY_INPUT'
      | 'TOO_LONG'
      | 'IMAGE_UNSUPPORTED'
      | 'UPSTREAM_FAILED'
      | 'UPSTREAM_INVALID'
      | 'TIMEOUT',
    detail?: string,
  ) {
    super(detail ?? code);
  }
}

const responseSchema = z.object({
  title: z.string().max(120).nullable().optional(),
  occurredAt: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  amount: z.union([z.string(), z.number()]).nullable().optional(),
  payerName: z.string().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  isDraft: z.boolean().nullable().optional(),
  fxRateOverride: z.union([z.string(), z.number()]).nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).nullable().optional(),
  reasoning: z.string().max(300).nullable().optional(),
  ambiguousHint: z.string().max(300).nullable().optional(),
  split: z
    .object({
      mode: z.enum(['equal', 'shares', 'custom']).nullable().optional(),
      participants: z.array(z.string()).max(200).nullable().optional(),
      shares: z
        .record(z.string(), z.union([z.number(), z.string()]))
        .nullable()
        .optional(),
      extras: z
        .record(z.string(), z.union([z.number(), z.string()]))
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

function resolveMember(name: string, members: AiMember[]): string | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  return (
    members.find((member) => member.displayName.toLowerCase() === wanted)?.id ??
    members.find((member) => member.displayName.toLowerCase().includes(wanted))?.id ??
    null
  );
}

function normalizeDecimal(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value)
    .trim()
    .replace(/[^\d.]/gu, '');
  return /^\d+(\.\d+)?$/u.test(normalized) ? normalized : null;
}

function normalizeText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, max) : null;
}

function splitRows(
  members: AiMember[],
  split: NonNullable<z.infer<typeof responseSchema>['split']>,
) {
  const mode = split.mode ?? 'equal';
  const unresolved: string[] = [];
  const participantIds = new Set<string>();
  for (const name of split.participants ?? []) {
    const id = resolveMember(name, members);
    if (id) participantIds.add(id);
    else unresolved.push(name);
  }
  if (mode === 'equal' && participantIds.size === 0) {
    for (const member of members) participantIds.add(member.id);
  }
  const shares = new Map<string, number>();
  for (const [name, raw] of Object.entries(split.shares ?? {})) {
    const id = resolveMember(name, members);
    if (!id) {
      unresolved.push(name);
      continue;
    }
    const value = Math.floor(Number(raw));
    if (Number.isFinite(value) && value > 0) shares.set(id, value);
  }
  const extras = new Map<string, string>();
  for (const [name, raw] of Object.entries(split.extras ?? {})) {
    const id = resolveMember(name, members);
    if (!id) {
      unresolved.push(name);
      continue;
    }
    const value = String(raw).trim();
    if (value) extras.set(id, value);
  }

  return {
    mode,
    rows: members.map((member): SplitRow => {
      if (mode === 'custom') {
        return {
          memberId: member.id,
          checked: false,
          shares: '0',
          extraText: extras.get(member.id) ?? '',
        };
      }
      if (mode === 'shares') {
        const share = shares.get(member.id) ?? 0;
        return {
          memberId: member.id,
          checked: share > 0,
          shares: String(share),
          extraText: extras.get(member.id) ?? '',
        };
      }
      const checked = participantIds.has(member.id);
      return {
        memberId: member.id,
        checked,
        shares: checked ? '1' : '0',
        extraText: extras.get(member.id) ?? '',
      };
    }),
    unresolved: [...new Set(unresolved)],
  };
}

function buildPrompt(input: {
  groupName: string;
  defaultCurrency: string;
  locale: string;
  members: AiMember[];
  current?: CurrentExpenseSnapshot;
}) {
  const current = input.current
    ? `\nThis is edit mode. Only return fields explicitly requested by the user; use null for unchanged fields. Current values: ${JSON.stringify(input.current)}`
    : '';
  return `You extract one shared expense for AAEasy. Return exactly one JSON object, no markdown.
Use null instead of guessing. Never invent a member. Member names must exactly match the list.
Keys: title, occurredAt (YYYY-MM-DD), currency, amount (decimal string), payerName, note, isDraft, fxRateOverride, tags, reasoning, ambiguousHint, split.
split is null or {"mode":"equal|shares|custom","participants":[names]|null,"shares":{name:integer}|null,"extras":{name:"signed decimal"}|null}.
The payer participates unless the user explicitly says otherwise. If no split is given, split equally among all members.
Group: ${input.groupName}. Default currency: ${input.defaultCurrency}. Locale: ${input.locale}. Today: ${new Date().toISOString().slice(0, 10)}.
Members:\n${input.members.map((member) => `- ${member.displayName}`).join('\n')}${current}`;
}

function config(env: WorkerEnv) {
  const model = env.AI_MODEL || 'deepseek-chat';
  const dashscope =
    env.AI_PROVIDER?.toLowerCase() === 'aliyun' ||
    /qwen/iu.test(model) ||
    env.AI_API_URL?.includes('dashscope.aliyuncs.com');
  return {
    model,
    url:
      env.AI_API_URL ||
      (dashscope
        ? 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
        : 'https://api.deepseek.com/chat/completions'),
    apiKey: env.AI_API_KEY ?? env.DASHSCOPE_API_KEY,
    gatewayToken: env.AI_GATEWAY_TOKEN,
    supportsImages: env.AI_ENABLE_IMAGE_CONTEXT === 'true' || dashscope,
  };
}

export async function parseExpenseWithAi(
  env: WorkerEnv,
  input: {
    text: string;
    images: Array<{ mime: string; dataUrl: string; name?: string }>;
    members: AiMember[];
    groupName: string;
    defaultCurrency: string;
    locale: string;
    current?: CurrentExpenseSnapshot;
  },
): Promise<AiSuggestion> {
  const settings = config(env);
  if (!settings.gatewayToken && !settings.apiKey) throw new AiParseError('NOT_CONFIGURED');
  const text = input.text.trim();
  if (!text && input.images.length === 0) throw new AiParseError('EMPTY_INPUT');
  if (text.length > 1_000) throw new AiParseError('TOO_LONG');
  if (input.images.length > 0 && !settings.supportsImages) {
    throw new AiParseError('IMAGE_UNSUPPORTED');
  }
  const userContent =
    input.images.length === 0
      ? text
      : [
          { type: 'text' as const, text: text || 'Read the receipt and extract expense fields.' },
          ...input.images.map((image) => ({
            type: 'image_url' as const,
            image_url: { url: image.dataUrl },
          })),
        ];
  let response: Response;
  try {
    response = await fetch(settings.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.gatewayToken
          ? { 'cf-aig-authorization': `Bearer ${settings.gatewayToken}` }
          : {}),
        ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildPrompt(input) },
          { role: 'user', content: userContent },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new AiParseError('TIMEOUT');
    }
    throw new AiParseError('UPSTREAM_FAILED', error instanceof Error ? error.message : undefined);
  }
  if (!response.ok) throw new AiParseError('UPSTREAM_FAILED', `HTTP ${response.status}`);
  const payload = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
  } | null;
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new AiParseError('UPSTREAM_INVALID');
  let raw: unknown;
  try {
    raw = JSON.parse(
      content
        .replace(/^```(?:json)?/iu, '')
        .replace(/```\s*$/u, '')
        .trim(),
    );
  } catch {
    throw new AiParseError('UPSTREAM_INVALID');
  }
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new AiParseError('UPSTREAM_INVALID');
  const data = parsed.data;
  const unresolved: AiSuggestion['unresolved'] = {};
  let payerMemberId: string | null = null;
  if (data.payerName) {
    payerMemberId = resolveMember(data.payerName, input.members);
    if (!payerMemberId) unresolved.payerName = data.payerName;
  }
  let split: AiSuggestion['split'] = null;
  if (data.split) {
    const built = splitRows(input.members, data.split);
    split = { mode: built.mode, rows: built.rows };
    if (built.unresolved.length > 0) unresolved.participants = built.unresolved;
  }
  const occurredAt =
    typeof data.occurredAt === 'string'
      ? (/^\d{4}-\d{2}-\d{2}/u.exec(data.occurredAt.trim())?.[0] ?? null)
      : null;
  const currency =
    typeof data.currency === 'string' && /^[A-Z]{3}$/u.test(data.currency.trim().toUpperCase())
      ? data.currency.trim().toUpperCase()
      : null;
  return {
    title: normalizeText(data.title, 120),
    occurredAt,
    currency,
    amount: normalizeDecimal(data.amount),
    payerMemberId,
    note: normalizeText(data.note, 500),
    isDraft: typeof data.isDraft === 'boolean' ? data.isDraft : null,
    fxRateOverride: normalizeDecimal(data.fxRateOverride),
    tags: data.tags?.map((tag) => tag.trim().slice(0, 40)).filter(Boolean) ?? null,
    split,
    unresolved,
    reasoning: normalizeText(data.reasoning, 300),
    ambiguousHint: normalizeText(data.ambiguousHint, 300),
  };
}
