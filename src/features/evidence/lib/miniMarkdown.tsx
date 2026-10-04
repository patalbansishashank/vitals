/**
 * A deliberately small Markdown reader for bundled project documents (the validation report). No dependency and no
 * raw HTML: every piece of text becomes a React text node, so nothing in the file can inject markup.
 *
 * Supported: ATX headings (# … ######), paragraphs, "-", "*" and "1." lists (one level; indented lines continue the
 * item), pipe tables with a header separator row, fenced code blocks, block quotes, horizontal rules, and inline
 * **bold**, *italic* / _italic_, `code` and [links](https://…). Relative links (other repository files) render as
 * plain text because those files are not part of the app.
 */
import { Fragment, type ReactNode } from 'react';

export type MdBlock =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string; id: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][]; align: Array<'left' | 'right' | 'center' | null> }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'rule' };

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[`*_[\]()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));

const isTableSep = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const LIST_RE = /^\s{0,3}([-*+]|\d+[.)])\s+(.*)$/;

/** Parse Markdown text into blocks (pure; exported for tests). */
export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: MdBlock[] = [];
  const used = new Map<string, number>();
  let i = 0;
  const isBlank = (l: string | undefined) => l === undefined || l.trim() === '';
  const startsBlock = (l: string) => /^\s{0,3}(#{1,6}\s|```|>|(-{3,}|\*{3,}|_{3,})\s*$)/.test(l) || LIST_RE.test(l);
  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line)) {
      i++;
      continue;
    }
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const text = h[2]!;
      const base = slug(text) || 'section';
      const n = used.get(base) ?? 0;
      used.set(base, n + 1);
      out.push({ kind: 'heading', level: h[1]!.length as 1, text, id: n ? `${base}-${n}` : base });
      i++;
      continue;
    }
    if (/^\s{0,3}```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s{0,3}```/.test(lines[i]!)) body.push(lines[i++]!);
      i++; // closing fence
      out.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push({ kind: 'rule' });
      i++;
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s{0,3}>\s?/, ''));
      out.push({ kind: 'quote', text: body.join(' ') });
      continue;
    }
    if (line.includes('|') && isTableSep(lines[i + 1] ?? '')) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]!).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null));
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && !isBlank(lines[i]) && lines[i]!.includes('|')) rows.push(splitRow(lines[i++]!));
      out.push({ kind: 'table', head, rows, align });
      continue;
    }
    const li = LIST_RE.exec(line);
    if (li) {
      const ordered = /\d/.test(li[1]!);
      const items: string[] = [];
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i]!);
        if (m) {
          items.push(m[2]!);
          i++;
        } else if (!isBlank(lines[i]) && /^\s{2,}\S/.test(lines[i]!) && items.length) {
          items[items.length - 1] += ` ${lines[i++]!.trim()}`; // continuation or nested line, flattened
        } else break;
      }
      out.push({ kind: 'list', ordered, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && !isBlank(lines[i]) && !(para.length && startsBlock(lines[i]!))) para.push(lines[i++]!.trim());
    out.push({ kind: 'paragraph', text: para.join(' ') });
  }
  return out;
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))/g;

/** Inline spans → React nodes (text only; no HTML is ever interpreted). */
export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const t = m[0];
    if (m[1]) out.push(<code key={k++}>{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k++}>{renderInline(t.slice(2, -2))}</strong>);
    else if (m[3]) out.push(<em key={k++}>{renderInline(t.slice(1, -1))}</em>);
    else {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t)!;
      const href = lm[2]!;
      out.push(
        /^https?:\/\//.test(href) ? (
          <a key={k++} href={href} target="_blank" rel="noopener noreferrer" className="lm-link">
            {renderInline(lm[1]!)}
          </a>
        ) : (
          <Fragment key={k++}>{renderInline(lm[1]!)}</Fragment>
        ),
      );
    }
    last = at + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export interface MarkdownProps {
  source: string;
  /** Heading level offset so a document's "#" can sit below the page title (default 1: "#" renders as h2). */
  headingOffset?: number;
  className?: string;
}

/** Render bundled Markdown as plain semantic HTML. */
export function Markdown({ source, headingOffset = 1, className }: MarkdownProps) {
  const blocks = parseMarkdown(source);
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'heading': {
            const H = `h${Math.min(6, b.level + headingOffset)}` as 'h2';
            return (
              <H key={i} id={b.id}>
                {renderInline(b.text)}
              </H>
            );
          }
          case 'paragraph':
            return <p key={i}>{renderInline(b.text)}</p>;
          case 'quote':
            return <blockquote key={i}>{renderInline(b.text)}</blockquote>;
          case 'rule':
            return <hr key={i} />;
          case 'code':
            return (
              <pre key={i}>
                <code>{b.text}</code>
              </pre>
            );
          case 'list': {
            const L = b.ordered ? 'ol' : 'ul';
            return (
              <L key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </L>
            );
          }
          case 'table':
            return (
              <div key={i} className="ev-md__table" role="region" aria-label="Table" tabIndex={0}>
                <table>
                  <thead>
                    <tr>
                      {b.head.map((c, j) => (
                        <th key={j} scope="col" style={b.align[j] ? { textAlign: b.align[j]! } : undefined}>
                          {renderInline(c)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, k) => (
                          <td key={k} style={b.align[k] ? { textAlign: b.align[k]! } : undefined}>
                            {renderInline(c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
