import type { MouseEvent } from 'react';
import { Copy } from 'lucide-react';
import { IconKey, VisuallyHidden, formatNumber, toast } from '@/components';
import type { KeyNumber, Mechanism } from '@/content/evidence/schema';
import { formatCitation, referenceLinks, studyTags, type NumberedReference } from '../data/citations';
import { useOnline } from '../hooks';
import { sourceAnchor } from '../links';
import { ExternalLink } from './bits';
import { revealInDetails } from './PageNav';

/* ------------------------------------------------------------------ equation */

/**
 * The formal equation as authored (plain text / unicode). Runs of two or more
 * spaces separate an expression from its note, so aligned notes stay aligned.
 */
export function EquationBlock({ equation, label = 'Equation' }: { equation: string; label?: string }) {
  const lines = equation
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) =>
      l
        .split(/\s{2,}/)
        .map((p) => p.trim())
        .filter(Boolean),
    );
  const twoCol = lines.some((parts) => parts.length > 1);
  return (
    <figure className="ev-eq" aria-label={label}>
      <div className="ev-eq__lines" data-cols={twoCol ? '2' : '1'}>
        {lines.map((parts, i) => (
          <div key={i} className="ev-eq__line">
            <span className="ev-eq__expr" data-span={parts.length === 1 || undefined}>
              {parts[0]}
            </span>
            {parts.length > 1 ? <span className="ev-eq__note">{parts.slice(1).join('  ')}</span> : null}
          </div>
        ))}
      </div>
    </figure>
  );
}

/* ------------------------------------------------------------------ source refs */

/** A source link's target may sit in the closed Sources list: open it before the browser jumps. */
function openTarget(e: MouseEvent<HTMLAnchorElement>): void {
  const id = e.currentTarget.getAttribute('href')?.slice(1);
  if (id) revealInDetails(document.getElementById(id));
}

/** "[1] [3]" links to numbered sources. */
export function SourceRefs({
  ids,
  numbers,
  label,
}: {
  ids: readonly string[] | undefined;
  numbers: ReadonlyMap<string, NumberedReference>;
  label?: string;
}) {
  const refs = (ids ?? []).map((id) => numbers.get(id)).filter((r): r is NumberedReference => Boolean(r));
  if (!refs.length) return null;
  return (
    <span className="ev-refs" aria-label={label}>
      {refs.map(({ n, ref }) => (
        <a
          key={ref.id}
          href={`#${sourceAnchor(ref.id)}`}
          className="ev-refs__a"
          onClick={openTarget}
          aria-label={`Source ${n}: ${ref.authors.split(',')[0]} ${ref.year}`}
        >
          [{n}]
        </a>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ table */

/** Key numbers as a table; below 640 px each row stacks (quantity over value), so nothing scrolls sideways. */
export function KeyNumbersTable({
  mechanism,
  numbers,
}: {
  mechanism: Mechanism;
  numbers: ReadonlyMap<string, NumberedReference>;
}) {
  const rows: KeyNumber[] = mechanism.keyNumbers;
  const anySources = rows.some((k) => k.referenceIds?.some((id) => numbers.has(id)));
  return (
    <table className="ev-table ev-table--keys">
      <caption className="lm-sr">Key numbers for “{mechanism.title}”</caption>
      <thead>
        <tr>
          <th scope="col">Quantity</th>
          <th scope="col">Value</th>
          {anySources ? <th scope="col">Sources</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((k, i) => (
          <tr key={i}>
            <th scope="row">{k.label}</th>
            <td className="ev-table__value">
              {k.value}
              {k.note ? <span className="ev-table__note">{k.note}</span> : null}
            </td>
            {anySources ? (
              <td className="ev-table__refs">
                <SourceRefs ids={k.referenceIds} numbers={numbers} label={`Sources for ${k.label}`} />
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ sources */

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

const SHORT_LINK: Record<ReturnType<typeof referenceLinks>[number]['kind'], string> = {
  pubmed: 'PubMed',
  doi: 'DOI',
  fulltext: 'Full text',
  web: 'Website',
};
/** The identifier part of a link's full label ("PubMed 5475323" → "5475323", "doi:10.1/x" → "10.1/x"), read out only. */
const linkDetail = (label: string): string => label.replace(/^(PubMed|doi:|Full text)\s*/i, '').trim();

export function SourceItem({ item }: { item: NumberedReference }) {
  const { n, ref: source } = item;
  const online = useOnline();
  const links = referenceLinks(source);
  const tags = studyTags(source);
  return (
    <li id={sourceAnchor(source.id)} className="ev-source" tabIndex={-1}>
      <span className="ev-source__n" aria-hidden="true">
        {n}
      </span>
      <div className="ev-source__body">
        <p className="ev-source__cite">
          <span className="lm-sr">{n}. </span>
          {source.authors.replace(/[.,;]+$/, '')} ({source.year}).{' '}
          <span className="ev-source__title">{source.title.replace(/\.+$/, '')}.</span>{' '}
          <i>{source.journal.replace(/[.;,]+$/, '')}</i>.
          {tags.length ? <span className="ev-source__tags"> {tags.join(' · ')}</span> : null}
        </p>
        <div className="ev-source__meta">
          {/* short one-line labels ("PubMed", "DOI", "Full text"); the identifier stays in the link's name and the copied
              citation, so a long DOI or host never breaks mid-token on a phone (r068 V-EV-4) */}
          {links.map((l) => (
            <ExternalLink key={l.href} href={l.href} offline={!online}>
              {SHORT_LINK[l.kind]}
              {linkDetail(l.label) ? (
                <>
                  {' '}
                  <VisuallyHidden>{linkDetail(l.label)}</VisuallyHidden>
                </>
              ) : null}
            </ExternalLink>
          ))}
          <IconKey
            size="sm"
            icon={Copy}
            label="Copy citation"
            className="ev-source__copy"
            onClick={() => {
              void copyText(formatCitation(source)).then((ok) =>
                toast(ok ? 'Citation copied' : 'Couldn’t copy. Select the text instead.'),
              );
            }}
          />
        </div>
      </div>
    </li>
  );
}

/**
 * The numbered sources as one closed disclosure, "Sources 50", at the end of an article or topic. Source links ("[3]",
 * "#ref-6", "On this page › Sources") open it before they jump.
 */
export function SourcesSection({ id, refs }: { id: string; refs: readonly NumberedReference[] }) {
  const hId = `${id}-title`;
  return (
    <details id={id} className="ev-sec ev-disclose">
      <summary className="ev-disclose__sum">
        <h3 id={hId} className="ev-sec__h" tabIndex={-1}>
          Sources
        </h3>
        <span className="ev-count">{formatNumber(refs.length)}</span>
      </summary>
      <ol className="ev-sources" aria-labelledby={hId}>
        {refs.map((r) => (
          <SourceItem key={r.ref.id} item={r} />
        ))}
      </ol>
    </details>
  );
}
