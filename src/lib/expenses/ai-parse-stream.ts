/**
 * Streaming AI-assisted expense parsing.
 *
 * Opens an upstream OpenAI-compatible chat completion with `stream: true`,
 * unwraps the SSE deltas, accumulates the assistant `content`, and runs an
 * incremental brace-aware JSON scanner that emits a typed event whenever a
 * top-level JSON key just gained a complete value. The caller (the SSE
 * route handler) re-encodes these events as SSE frames for the browser.
 *
 * The shared schemas, normalizers, and split-row builder all live in
 * `ai-schema.ts` so this file stays focused on the streaming machinery.
 */

import 'server-only';
import {
  EXPENSE_PARSE_IMAGE_ONLY_USER_PROMPT,
  buildExpenseParseSystemPrompt,
} from '@/lib/expenses/ai-prompts';
import {
  buildSplitRows,
  normalizeAmount,
  normalizeCurrency,
  normalizeFxRate,
  normalizeNote,
  normalizeOccurredAt,
  normalizeShortText,
  normalizeTags,
  normalizeTitle,
  resolveMemberId,
  type ParseFieldName,
  type ParseStreamEvent,
  type CurrentSnapshot,
} from '@/lib/expenses/ai-schema';
import { resolveAiConfig } from '@/lib/expenses/ai-parse';

const MAX_INPUT_CHARS = 1_000;
const TOTAL_TIMEOUT_MS = 120_000;
/** Abort if no upstream byte arrives for this long (catches stuck streams). */
const IDLE_TIMEOUT_MS = 30_000;

export interface AiParseStreamInput {
  text: string;
  images?: { mime: string; dataUrl: string; name?: string }[];
  members: { id: string; displayName: string }[];
  groupName: string;
  defaultCurrency: string;
  locale: string;
  current?: CurrentSnapshot;
}

/**
 * Call the upstream LLM with streaming on and yield normalized events as
 * each top-level field completes. The returned generator is the source
 * of truth — caller is responsible for wrapping each yield into an SSE
 * frame.
 */
export async function* aiParseExpenseStream(
  input: AiParseStreamInput,
  signal: AbortSignal,
): AsyncGenerator<ParseStreamEvent, void, void> {
  const { apiKey, gatewayToken, model, url, supportsImageContext } =
    resolveAiConfig();
  if (!gatewayToken) {
    yield { type: 'error', code: 'NOT_CONFIGURED' };
    return;
  }

  const text = input.text.trim();
  const images = input.images ?? [];
  if (!text && images.length === 0) {
    yield { type: 'error', code: 'EMPTY_INPUT' };
    return;
  }
  if (text.length > MAX_INPUT_CHARS) {
    yield { type: 'error', code: 'TOO_LONG' };
    return;
  }
  if (images.length > 0 && !supportsImageContext) {
    yield { type: 'error', code: 'IMAGE_UNSUPPORTED' };
    return;
  }

  // Bridge the caller's signal with our own timeout-driven aborts.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  const totalTimer = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
  };
  resetIdleTimer();

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
    stream: true,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildExpenseParseSystemPrompt(input) },
      { role: 'user', content: userContent },
    ],
  });

  const startedAt = performance.now();
  const cleanup = () => {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(totalTimer);
    signal.removeEventListener('abort', onAbort);
  };

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
  } catch (e) {
    cleanup();
    if ((e as Error).name === 'AbortError') {
      yield { type: 'error', code: signal.aborted ? 'STREAM_INTERRUPTED' : 'TIMEOUT' };
      return;
    }
    yield { type: 'error', code: 'UPSTREAM_FAILED', detail: (e as Error).message };
    return;
  }

  if (!res.ok || !res.body) {
    cleanup();
    yield { type: 'error', code: 'UPSTREAM_FAILED', detail: `HTTP ${res.status}` };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let sseBuf = '';
  const emitter = new FieldEmitter(input.members);

  try {
    while (true) {
      let read: ReadableStreamReadResult<Uint8Array>;
      try {
        read = await reader.read();
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          yield { type: 'error', code: signal.aborted ? 'STREAM_INTERRUPTED' : 'TIMEOUT' };
          return;
        }
        yield { type: 'error', code: 'UPSTREAM_FAILED', detail: (e as Error).message };
        return;
      }
      if (read.done) break;
      resetIdleTimer();
      sseBuf += decoder.decode(read.value, { stream: true });

      let idx: number;
      while ((idx = sseBuf.indexOf('\n\n')) !== -1) {
        const frame = sseBuf.slice(0, idx);
        sseBuf = sseBuf.slice(idx + 2);
        const delta = parseOpenAiSseFrame(frame);
        if (delta === SSE_DONE) {
          // Upstream finished; flush remaining events and stop.
          for (const ev of emitter.flush()) yield ev;
          yield {
            type: 'done',
            tookMs: Math.round(performance.now() - startedAt),
          };
          return;
        }
        if (typeof delta === 'string' && delta.length > 0) {
          for (const ev of emitter.feed(delta)) yield ev;
        }
      }
    }
    // Stream ended without an explicit [DONE]. Flush whatever we got.
    for (const ev of emitter.flush()) yield ev;
    yield { type: 'done', tookMs: Math.round(performance.now() - startedAt) };
  } finally {
    cleanup();
    try {
      reader.cancel();
    } catch {
      // ignore
    }
  }
}

const SSE_DONE = Symbol('SSE_DONE');

/**
 * Parse one OpenAI-style SSE frame. The frame may contain multiple `data:`
 * lines (per the SSE spec) and zero or more comment lines (starting with `:`).
 * Returns the concatenated delta content string, the SSE_DONE sentinel, or
 * null if the frame has no parseable delta.
 */
function parseOpenAiSseFrame(frame: string): string | typeof SSE_DONE | null {
  const lines = frame.split('\n');
  const dataParts: string[] = [];
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    if (!line.startsWith('data:')) continue;
    dataParts.push(line.slice(5).trimStart());
  }
  if (dataParts.length === 0) return null;
  const payload = dataParts.join('\n');
  if (payload === '[DONE]') return SSE_DONE;
  try {
    const parsed = JSON.parse(payload) as {
      choices?: { delta?: { content?: string } }[];
    };
    return parsed.choices?.[0]?.delta?.content ?? null;
  } catch {
    return null;
  }
}

/**
 * Incremental scanner over the accumulated JSON text.
 *
 * State we track:
 *   - depth:        brace/bracket nesting depth
 *   - inString:     are we inside a JSON string?
 *   - escape:       was the previous in-string char a backslash?
 *   - stringIsKey:  when a top-level string is being read, is it a key
 *                   (no colon seen yet for this key) or a string value?
 *   - currentKey:   the most recently completed top-level key, awaiting
 *                   its value
 *   - valueStart:   byte offset where the current value begins; set when
 *                   we encounter the first non-whitespace char after the
 *                   colon, regardless of value type
 *
 * Emission triggers:
 *   - A string value completes (closing quote at depth 1).
 *   - A nested object/array value completes (`}`/`]` returning depth to 1).
 *   - A primitive (number/bool/null) value completes — detected when we
 *     hit a comma at depth 1 or the root closing `}`.
 *
 * Unknown / null / unparsable values are silently dropped so the stream
 * stays alive even when the model returns junk.
 */
class FieldEmitter {
  private buf = '';
  private cursor = 0;
  private depth = 0;
  private inString = false;
  private escape = false;
  private stringIsKey = false;
  private currentKey: string | null = null;
  private valueStart: number | null = null;
  private members: { id: string; displayName: string }[];
  private unresolvedPayer: string | null = null;
  private unresolvedParticipants: string[] = [];
  private emitted = new Set<string>();

  constructor(members: { id: string; displayName: string }[]) {
    this.members = members;
  }

  /** Append a chunk of model content and yield any newly-completed events. */
  *feed(chunk: string): Generator<ParseStreamEvent, void, void> {
    this.buf += chunk;
    yield* this.scan();
  }

  /** Final pass after the upstream stream ends — surfaces the META event. */
  *flush(): Generator<ParseStreamEvent, void, void> {
    if (this.unresolvedPayer || this.unresolvedParticipants.length > 0) {
      yield {
        type: 'meta',
        unresolved: {
          ...(this.unresolvedPayer ? { payerName: this.unresolvedPayer } : {}),
          ...(this.unresolvedParticipants.length > 0
            ? { participants: dedupeStrings(this.unresolvedParticipants) }
            : {}),
        },
      };
    }
  }

  private *scan(): Generator<ParseStreamEvent, void, void> {
    while (this.cursor < this.buf.length) {
      const ch = this.buf[this.cursor]!;

      if (this.inString) {
        if (this.escape) {
          this.escape = false;
          this.cursor++;
          continue;
        }
        if (ch === '\\') {
          this.escape = true;
          this.cursor++;
          continue;
        }
        if (ch === '"') {
          this.inString = false;
          // Closed a top-level string. If it was a key, capture it.
          if (this.depth === 1 && this.stringIsKey) {
            const keyEnd = this.cursor;
            const keyStart = this.valueStart!;
            this.currentKey = this.buf.slice(keyStart + 1, keyEnd);
            this.valueStart = null;
            this.stringIsKey = false;
            this.cursor++;
            continue;
          }
          // Otherwise it was a string value at depth 1; emit it.
          if (this.depth === 1 && this.currentKey && this.valueStart !== null) {
            const valueText = this.buf.slice(this.valueStart, this.cursor + 1);
            yield* this.emitField(this.currentKey, valueText);
            this.resetField();
          }
        }
        this.cursor++;
        continue;
      }

      if (ch === '"') {
        this.inString = true;
        this.escape = false;
        if (this.depth === 1) {
          if (this.currentKey === null) {
            // Start of a top-level KEY.
            this.stringIsKey = true;
            this.valueStart = this.cursor;
          } else if (this.valueStart === null) {
            // Start of a top-level STRING value.
            this.stringIsKey = false;
            this.valueStart = this.cursor;
          }
        }
        this.cursor++;
        continue;
      }

      if (ch === '{' || ch === '[') {
        if (ch === '{' && this.depth === 0) {
          // Entering the root object — nothing to do beyond depth bump.
        } else if (
          this.depth === 1 &&
          this.currentKey &&
          this.valueStart === null
        ) {
          this.valueStart = this.cursor;
        }
        this.depth++;
        this.cursor++;
        continue;
      }

      if (ch === '}' || ch === ']') {
        // If this close drops a nested value at depth 1 back to root, emit it.
        if (
          this.depth === 2 &&
          this.currentKey &&
          this.valueStart !== null
        ) {
          const valueText = this.buf.slice(this.valueStart, this.cursor + 1);
          yield* this.emitField(this.currentKey, valueText);
          this.resetField();
        }
        this.depth--;
        // Root `}`: flush any pending primitive value before depth hits 0.
        if (
          this.depth === 0 &&
          this.currentKey &&
          this.valueStart !== null
        ) {
          const valueText = this.buf.slice(this.valueStart, this.cursor).trim();
          if (valueText) yield* this.emitField(this.currentKey, valueText);
          this.resetField();
        }
        this.cursor++;
        continue;
      }

      if (
        this.depth === 1 &&
        ch === ':' &&
        this.currentKey &&
        this.valueStart === null
      ) {
        this.cursor++;
        // Skip whitespace to the first char of the value.
        while (
          this.cursor < this.buf.length &&
          /\s/.test(this.buf[this.cursor]!)
        ) {
          this.cursor++;
        }
        if (this.cursor >= this.buf.length) return;
        const next = this.buf[this.cursor]!;
        if (next === '{' || next === '[' || next === '"') {
          // Let the normal opener handlers above mark valueStart.
          continue;
        }
        // Primitive: number / true / false / null. Mark start; emit on `,`
        // at depth 1 or on the root closing `}`.
        this.valueStart = this.cursor;
        continue;
      }

      if (
        this.depth === 1 &&
        ch === ',' &&
        this.currentKey &&
        this.valueStart !== null
      ) {
        const valueText = this.buf.slice(this.valueStart, this.cursor).trim();
        if (valueText) yield* this.emitField(this.currentKey, valueText);
        this.resetField();
        this.cursor++;
        continue;
      }

      // Reset between fields: a comma at depth 1 with no pending value just
      // clears the currentKey marker so we can read the next key.
      if (this.depth === 1 && ch === ',' && this.currentKey === null) {
        this.cursor++;
        continue;
      }

      this.cursor++;
    }
  }

  private resetField() {
    this.currentKey = null;
    this.valueStart = null;
    this.stringIsKey = false;
  }

  private *emitField(
    key: string,
    valueText: string,
  ): Generator<ParseStreamEvent, void, void> {
    if (this.emitted.has(key)) return;
    this.emitted.add(key);

    let raw: unknown;
    try {
      raw = JSON.parse(valueText);
    } catch {
      // Bad JSON for this field — skip it; the stream as a whole stays alive.
      return;
    }
    if (raw === null) return;

    switch (key) {
      case 'title': {
        const v = normalizeTitle(raw);
        if (v !== null) yield field('title', v);
        return;
      }
      case 'occurredAt': {
        const v = normalizeOccurredAt(raw);
        if (v !== null) yield field('occurredAt', v);
        return;
      }
      case 'currency': {
        const v = normalizeCurrency(raw);
        if (v !== null) yield field('currency', v);
        return;
      }
      case 'amount': {
        const v = normalizeAmount(raw);
        if (v !== null) yield field('amount', v);
        return;
      }
      case 'payerName': {
        if (typeof raw !== 'string') return;
        const id = resolveMemberId(raw, this.members);
        if (id) yield field('payerMemberId', id);
        else this.unresolvedPayer = raw;
        return;
      }
      case 'note': {
        const v = normalizeNote(raw);
        if (v !== null) yield field('note', v);
        return;
      }
      case 'isDraft': {
        if (typeof raw === 'boolean') yield field('isDraft', raw);
        return;
      }
      case 'fxRateOverride': {
        const v = normalizeFxRate(raw);
        if (v !== null) yield field('fxRateOverride', v);
        return;
      }
      case 'tags': {
        const v = normalizeTags(raw);
        if (v !== null) yield field('tags', v);
        return;
      }
      case 'reasoning': {
        const v = normalizeShortText(raw, 300);
        if (v !== null) yield field('reasoning', v);
        return;
      }
      case 'ambiguousHint': {
        const v = normalizeShortText(raw, 300);
        if (v !== null) yield field('ambiguousHint', v);
        return;
      }
      case 'split': {
        if (typeof raw !== 'object' || Array.isArray(raw)) return;
        const built = buildSplitRows({
          members: this.members,
          split: raw as Parameters<typeof buildSplitRows>[0]['split'],
        });
        if (built.unresolvedParticipants.length > 0) {
          this.unresolvedParticipants.push(...built.unresolvedParticipants);
        }
        yield { type: 'split', mode: built.mode, rows: built.rows };
        return;
      }
      default:
        // Unknown key — ignore.
        return;
    }
  }
}

function field(
  name: ParseFieldName,
  value: unknown,
): ParseStreamEvent {
  return { type: 'field', name, value };
}

function dedupeStrings(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

// Re-exports so tests can drive `FieldEmitter` directly.
export const __test = { FieldEmitter, parseOpenAiSseFrame };

// Re-export AiParseError so the route can `instanceof`-check without
// importing the schema module.
export { AiParseError } from '@/lib/expenses/ai-schema';
