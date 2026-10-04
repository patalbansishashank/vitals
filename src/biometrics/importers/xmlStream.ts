/**
 * Minimal push-style (SAX) XML tokenizer for multi-GB Apple Health exports (tier H, no DOM, no DOMParser).
 * Emits open/close tag events with decoded attributes; text nodes are ignored. Comments, processing instructions, CDATA and
 * the DOCTYPE (including its internal subset, which Apple's export has) are skipped. Input may be split at any byte or
 * character boundary: an incomplete tag stays in the carry buffer until the next chunk. Memory is bounded by the largest
 * single tag.
 */

export interface XmlHandler {
  open(name: string, attrs: Record<string, string>, selfClosing: boolean): void;
  close(name: string): void;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decodes the five predefined entities and numeric character references; unknown entities are left as written. */
export function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return m;
      try {
        return String.fromCodePoint(cp);
      } catch {
        return m;
      }
    }
    return NAMED[e] ?? m;
  });
}

const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseAttrs(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(body))) out[m[1]!] = decodeEntities(m[2] ?? m[3] ?? '');
  return out;
}

/** Index of the '>' closing a tag that starts at `from` (after '<'), honouring quoted attribute values; -1 when incomplete. */
function tagEnd(buf: string, from: number): number {
  let q = '';
  for (let i = from; i < buf.length; i++) {
    const c = buf[i]!;
    if (q) {
      if (c === q) q = '';
    } else if (c === '"' || c === "'") q = c;
    else if (c === '>') return i;
  }
  return -1;
}

/** End index (of the final '>') of a DOCTYPE starting at `from`, tracking the [ ... ] internal subset; -1 when incomplete. */
function doctypeEnd(buf: string, from: number): number {
  let depth = 0;
  let q = '';
  for (let i = from; i < buf.length; i++) {
    const c = buf[i]!;
    if (q) {
      if (c === q) q = '';
    } else if (c === '"' || c === "'") q = c;
    else if (c === '[') depth++;
    else if (c === ']') depth--;
    else if (c === '>' && depth <= 0) return i;
  }
  return -1;
}

const MAX_TAG = 4 * 1024 * 1024;

export class XmlTokenizer {
  private buf = '';
  constructor(private readonly h: XmlHandler) {}

  /** Feeds decoded text. May call the handler many times. */
  push(text: string): void {
    this.buf += text;
    let pos = 0;
    const b = this.buf;
    for (;;) {
      const lt = b.indexOf('<', pos);
      if (lt < 0) {
        pos = b.length;
        break;
      }
      let end: number;
      if (b.startsWith('<!--', lt)) {
        const e = b.indexOf('-->', lt + 4);
        if (e < 0) { pos = lt; break; }
        pos = e + 3;
        continue;
      } else if (b.startsWith('<![CDATA[', lt)) {
        const e = b.indexOf(']]>', lt + 9);
        if (e < 0) { pos = lt; break; }
        pos = e + 3;
        continue;
      } else if (b.startsWith('<?', lt)) {
        const e = b.indexOf('?>', lt + 2);
        if (e < 0) { pos = lt; break; }
        pos = e + 2;
        continue;
      } else if (b.startsWith('<!', lt)) {
        end = doctypeEnd(b, lt + 2);
        if (end < 0) { pos = lt; break; }
        pos = end + 1;
        continue;
      } else if (lt + 1 >= b.length || (b[lt + 1] === '!' && b.length < lt + 4)) {
        pos = lt;
        break;
      }
      end = tagEnd(b, lt + 1);
      if (end < 0) { pos = lt; break; }
      const inner = b.slice(lt + 1, end);
      if (inner[0] === '/') this.h.close(inner.slice(1).trim());
      else {
        const selfClosing = inner.endsWith('/');
        const body = selfClosing ? inner.slice(0, -1) : inner;
        const sp = body.search(/[\s]/);
        const name = sp < 0 ? body : body.slice(0, sp);
        this.h.open(name, sp < 0 ? {} : parseAttrs(body.slice(sp)), selfClosing);
        if (selfClosing) this.h.close(name);
      }
      pos = end + 1;
    }
    this.buf = b.slice(pos);
    if (this.buf.length > MAX_TAG) throw new Error('XML tag exceeds 4 MB: not a valid export');
  }
}

/** Decodes a byte stream to text chunks (streaming UTF-8, BOM stripped). `bytes` is the running count of consumed bytes. */
export async function* textChunks(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<{ text: string; bytes: number }> {
  const dec = new TextDecoder('utf-8');
  const reader = stream.getReader();
  let n = 0;
  let first = true;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      let text = dec.decode(value, { stream: true });
      if (first && text.length > 0) {
        first = false;
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      }
      yield { text, bytes: n };
    }
    const tail = dec.decode();
    if (tail) yield { text: tail, bytes: n };
  } finally {
    reader.releaseLock();
  }
}
