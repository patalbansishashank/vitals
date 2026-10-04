import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Copy } from 'lucide-react';
import { Chip, IconKey, StatusMark, toast } from '@/components';
import type { KeyNumber, Mechanism } from '@/content/evidence/schema';
import {
  formatCitation,
  referenceLinks,
  studyTags,
  verificationFlag,
  verificationSummary,
  VERIFICATION_TEXT,
  type NumberedReference,
} from '../data/citations';
import { useOnline } from '../hooks';
import { sourceAnchor } from '../links';
import { ExternalLink } from './bits';

/* ------------------------------------------------------------------ equation */

/**
 * The formal equation as authored (plain text / unicode). Runs of two or more
 * spaces separate an expression from its note, so aligned notes stay aligned.
 */
export function EquationBlock({ equation }: { equation: string }) {
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
    <figure className="ev-eq">
      <figcaption className="lm-eng">the equation, as published in the research</figcaption>
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
          aria-label={`Source ${n}: ${ref.authors.split(',')[0]} ${ref.year}`}
        >
          [{n}]
        </a>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ table */

/** Horizontal scroll region with a right-edge fade and a "scroll →" hint when it overflows. */
function ScrollRegion({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ over: false, end: true });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const over = el.scrollWidth > el.clientWidth + 1;
      const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
      setOverflow((o) => (o.over === over && o.end === end ? o : { over, end }));
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
  }, []);
  return (
    <div className="ev-scrollwrap">
      <div
        ref={ref}
        className="ev-scroll"
        data-overflow={overflow.over || undefined}
        data-end={overflow.end || undefined}
        tabIndex={overflow.over ? 0 : undefined}
        role={overflow.over ? 'region' : undefined}
        aria-label={overflow.over ? `${label} (scrolls sideways)` : undefined}
      >
        {children}
      </div>
      {overflow.over ? (
        <p className="ev-scrollhint lm-eng" aria-hidden="true" data-end={overflow.end || undefined}>
          {overflow.end ? '← scroll' : 'scroll →'}
        </p>
      ) : null}
    </div>
  );
}

export function KeyNumbersTable({
  mechanism,
  numbers,
}: {
  mechanism: Mechanism;
  numbers: ReadonlyMap<string, NumberedReference>;
}) {
  const rows: KeyNumber[] = mechanism.keyNumbers;
  const anySources = rows.some((k) => k.referenceIds?.some((id) => numbers.has(id)));
  const note = `${rows.length} ${rows.length === 1 ? 'value' : 'values'} as reported in the research${anySources ? '; numbers in brackets link to the sources below' : ''}.`;
  return (
    <>
      <p className="ev-tablenote lm-eng" aria-hidden="true">
        {note}
      </p>
      <ScrollRegion label="Key numbers">
        <table className="ev-table">
          <caption className="lm-sr">
            Key numbers for “{mechanism.title}”: {note}
          </caption>
          <thead>
            <tr>
              <th scope="col">quantity</th>
              <th scope="col">value</th>
              {anySources ? <th scope="col">sources</th> : null}
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
      </ScrollRegion>
    </>
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

export function SourceItem({ item }: { item: NumberedReference }) {
  const { n, ref: source } = item;
  const online = useOnline();
  const flag = verificationFlag(source);
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
        </p>
        <div className="ev-source__meta">
          {links.map((l) => (
            <ExternalLink key={l.href} href={l.href} offline={!online}>
              {l.label}
            </ExternalLink>
          ))}
          {tags.map((t) => (
            <Chip key={t} className="ev-tag">
              {t}
            </Chip>
          ))}
          {flag ? (
            <span className="ev-flag" data-flag={flag}>
              <StatusMark severity={flag === 'unverified' ? 'caution' : 'info'} size={16} />
              <span>{VERIFICATION_TEXT[flag].short}</span>
              <span className="lm-sr">. {VERIFICATION_TEXT[flag].long}</span>
            </span>
          ) : null}
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

/** Numbered sources with an honest count of what could not be fully checked. */
export function SourcesList({ refs, lead }: { refs: readonly NumberedReference[]; lead?: ReactNode }) {
  const counts = verificationSummary(refs);
  const legendId = useId();
  const parts = [`${refs.length} ${refs.length === 1 ? 'source' : 'sources'}`];
  if (counts.abstract) parts.push(`${counts.abstract} checked at abstract level only`);
  if (counts.unverified) parts.push(`${counts.unverified} unverified`);
  return (
    <>
      <p className="ev-sources__summary" id={legendId}>
        {parts.join(' · ')}
        {lead}
      </p>
      {counts.abstract || counts.unverified ? (
        <p className="ev-sources__explain">
          {counts.abstract ? <>{VERIFICATION_TEXT.abstract.long} </> : null}
          {counts.unverified ? VERIFICATION_TEXT.unverified.long : null}
        </p>
      ) : null}
      <ol className="ev-sources" aria-describedby={legendId}>
        {refs.map((r) => (
          <SourceItem key={r.ref.id} item={r} />
        ))}
      </ol>
    </>
  );
}
