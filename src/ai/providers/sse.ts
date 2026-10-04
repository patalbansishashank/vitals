/**
 * Server-sent events parser over a byte stream. Handles CRLF/LF, multi-line `data:`, `event:` names, comment lines
 * (OpenRouter `: OPENROUTER PROCESSING` keep-alives) and chunks split anywhere, including inside a UTF-8 sequence.
 */

export interface SseMessage {
  event: string;
  data: string;
}

export async function* parseSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let event = '';
  let data: string[] = [];
  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener('abort', onAbort, { once: true });
  let ended = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) ended = true;
      buf += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.search(/\r\n|\r|\n/)) >= 0) {
        // A lone CR at the end may be the first half of a CRLF split across chunks.
        if (!done && buf[nl] === '\r' && nl === buf.length - 1) break;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + (buf[nl] === '\r' && buf[nl + 1] === '\n' ? 2 : 1));
        if (line === '') {
          if (data.length) yield { event: event || 'message', data: data.join('\n') };
          event = '';
          data = [];
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        let val = colon < 0 ? '' : line.slice(colon + 1);
        if (val.startsWith(' ')) val = val.slice(1);
        if (field === 'data') data.push(val);
        else if (field === 'event') event = val;
      }
      if (done) break;
    }
    if (buf.startsWith('data:')) data.push(buf.slice(5).trimStart());
    if (data.length) yield { event: event || 'message', data: data.join('\n') };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    // the consumer stopped early (e.g. after `response.completed`): cancel so the connection is released
    if (!ended) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Newline-delimited JSON (Ollama native endpoints). */
export async function* parseNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buf += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) yield JSON.parse(line);
      }
      if (done) break;
    }
    if (buf.trim()) yield JSON.parse(buf);
  } finally {
    reader.releaseLock();
  }
}
