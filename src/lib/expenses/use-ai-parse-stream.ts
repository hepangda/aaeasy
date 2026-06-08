'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AiParseErrorCode,
  ParseFieldName,
  CurrentSnapshot,
} from '@/lib/expenses/ai-schema';
import type { SplitInputRow } from '@/lib/split/input-state';

export interface AiImage {
  name: string;
  mime: string;
  dataUrl: string;
}

export interface UseAiParseStreamOptions {
  groupId: string;
  onField: (name: ParseFieldName, value: unknown) => void;
  onSplit: (
    mode: 'equal' | 'shares' | 'custom',
    rows: SplitInputRow[],
  ) => void;
  onMeta: (unresolved: {
    payerName?: string;
    participants?: string[];
  }) => void;
  onError: (code: AiParseErrorCode, detail?: string) => void;
  onDone?: (tookMs: number) => void;
}

export interface StartRequest {
  text: string;
  images?: AiImage[];
  current?: CurrentSnapshot;
}

/**
 * Client-side wrapper around the SSE parse endpoint. Uses `fetch` rather
 * than `EventSource` so we can POST a JSON body and abort cleanly on
 * unmount or user-driven stop.
 *
 * The hook is non-blocking from React's perspective: callbacks fire as each
 * frame arrives. `pending` reflects whether a stream is currently open.
 */
export function useAiParseStream(opts: UseAiParseStreamOptions) {
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const [pending, setPending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const start = useCallback(
    async (req: StartRequest) => {
      stop();
      const controller = new AbortController();
      abortRef.current = controller;
      setPending(true);

      try {
        const res = await fetch(
          `/api/groups/${optsRef.current.groupId}/expenses/parse/stream`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'text/event-stream',
            },
            body: JSON.stringify({
              text: req.text,
              images: req.images ?? [],
              ...(req.current ? { current: req.current } : {}),
            }),
            signal: controller.signal,
          },
        );

        if (!res.ok) {
          let code: AiParseErrorCode = 'UPSTREAM_FAILED';
          let detail: string | undefined;
          try {
            const payload = (await res.json()) as {
              error?: string;
              detail?: string;
            };
            if (payload.error) code = payload.error as AiParseErrorCode;
            detail = payload.detail;
          } catch {
            // ignore body parse failure
          }
          optsRef.current.onError(code, detail);
          return;
        }

        if (!res.body) {
          optsRef.current.onError('UPSTREAM_FAILED', 'no_body');
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        while (true) {
          let read: ReadableStreamReadResult<Uint8Array>;
          try {
            read = await reader.read();
          } catch (e) {
            if ((e as Error).name === 'AbortError') return;
            optsRef.current.onError('STREAM_INTERRUPTED', (e as Error).message);
            return;
          }
          if (read.done) return;
          buf += decoder.decode(read.value, { stream: true });

          let idx: number;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            handleFrame(frame, optsRef.current);
          }
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        optsRef.current.onError('UPSTREAM_FAILED', (e as Error).message);
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setPending(false);
      }
    },
    [stop],
  );

  return { pending, start, stop };
}

/**
 * Parse one SSE frame and dispatch to the right callback. Comments
 * (`:`-prefixed lines) and unknown events are silently ignored — the
 * server may add new event types later without breaking older clients.
 */
function handleFrame(frame: string, opts: UseAiParseStreamOptions): void {
  const lines = frame.split('\n');
  let event = '';
  const dataParts: string[] = [];
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataParts.push(line.slice(5).trimStart());
    }
  }
  if (!event || dataParts.length === 0) return;
  let data: unknown;
  try {
    data = JSON.parse(dataParts.join('\n'));
  } catch {
    return;
  }

  switch (event) {
    case 'FIELD': {
      const d = data as { name?: string; value?: unknown };
      if (typeof d.name === 'string') {
        opts.onField(d.name as ParseFieldName, d.value);
      }
      return;
    }
    case 'SPLIT': {
      const d = data as {
        mode?: 'equal' | 'shares' | 'custom';
        rows?: SplitInputRow[];
      };
      if (d.mode && Array.isArray(d.rows)) {
        opts.onSplit(d.mode, d.rows);
      }
      return;
    }
    case 'META': {
      const d = data as {
        unresolved?: { payerName?: string; participants?: string[] };
      };
      if (d.unresolved) opts.onMeta(d.unresolved);
      return;
    }
    case 'DONE': {
      const d = data as { tookMs?: number };
      opts.onDone?.(d.tookMs ?? 0);
      return;
    }
    case 'ERROR': {
      const d = data as { code?: string; detail?: string };
      opts.onError((d.code as AiParseErrorCode) ?? 'UPSTREAM_FAILED', d.detail);
      return;
    }
    default:
      return;
  }
}
