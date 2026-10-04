/**
 * Test doubles for the network port. Not imported by app code.
 *
 * `fakeFetch` answers from a queue of canned responses and records every request. Streaming bodies are split into
 * small byte chunks at awkward boundaries so parsers are exercised the way real networks deliver data.
 */

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export type FakeReply =
  | { status?: number; headers?: Record<string, string>; json: unknown }
  | { status?: number; headers?: Record<string, string>; text: string; chunkSize?: number }
  | { throws: unknown };

/** SSE text from data objects: each becomes `data: <json>\n\n`; strings are inserted verbatim. */
export function sse(...items: Array<unknown>): string {
  return items.map((i) => (typeof i === 'string' ? i : `data: ${JSON.stringify(i)}\n\n`)).join('');
}

/** Anthropic-style SSE with `event:` names. */
export function sseEvents(...items: Array<{ event: string; data: unknown }>): string {
  return items.map((i) => `event: ${i.event}\ndata: ${JSON.stringify(i.data)}\n\n`).join('');
}

export function chunkedStream(text: string, chunkSize = 7): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= bytes.length) return controller.close();
      controller.enqueue(bytes.subarray(i, i + chunkSize));
      i += chunkSize;
    },
  });
}

export interface FakeFetch {
  fetch: typeof fetch;
  requests: RecordedRequest[];
  /** Replies not yet consumed. */
  pending(): number;
}

/**
 * Replies are consumed in order; a function reply can inspect the request. When the queue is empty the fake throws,
 * which makes an unexpected extra request fail the test loudly.
 */
export function fakeFetch(replies: Array<FakeReply | ((req: RecordedRequest) => FakeReply)>): FakeFetch {
  const queue = [...replies];
  const requests: RecordedRequest[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const raw = init?.body;
    let body: unknown = raw;
    if (typeof raw === 'string') {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    const rec: RecordedRequest = { url: String(input instanceof Request ? input.url : input), method: init?.method ?? 'GET', headers, body };
    requests.push(rec);
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const next = queue.shift();
    if (!next) throw new Error(`fakeFetch: unexpected request ${rec.method} ${rec.url}`);
    const reply = typeof next === 'function' ? next(rec) : next;
    if ('throws' in reply) throw reply.throws;
    const status = reply.status ?? 200;
    if ('json' in reply) {
      return new Response(JSON.stringify(reply.json), { status, headers: { 'content-type': 'application/json', ...reply.headers } });
    }
    return new Response(chunkedStream(reply.text, reply.chunkSize), {
      status,
      headers: { 'content-type': 'text/event-stream', ...reply.headers },
    });
  };
  return { fetch: fn as typeof fetch, requests, pending: () => queue.length };
}

/** Sleep that resolves at once and records the requested delays. */
export function instantSleep(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = [];
  return { sleep: async (ms) => void delays.push(ms), delays };
}

/** Drains an async iterable into an array. */
export async function drain<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}
