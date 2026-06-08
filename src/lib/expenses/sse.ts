/**
 * Tiny helpers for encoding Server-Sent Events frames.
 *
 * Frame layout: `event: <NAME>\ndata: <JSON>\n\n`. Multi-line JSON is fine
 * because we always serialize with `JSON.stringify` (no embedded newlines
 * in the output). Comment lines (`:`-prefixed) are used as heartbeats and
 * a "connected" marker so EventSource fires `onopen` quickly.
 */

const encoder = new TextEncoder();

export function encodeSse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function encodeSseComment(line: string): Uint8Array {
  return encoder.encode(`: ${line}\n\n`);
}
