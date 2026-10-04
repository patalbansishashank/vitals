import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, Check, CircleHelp, Minus, X } from 'lucide-react';
import { CATEGORY_LABEL, Chip, Icon, StatusMark, Swatch, VisuallyHidden } from '@/components';
import type { EvidenceCategory, Myth } from '@/content/evidence/schema';
import { DISCLAIMER, VERDICT_TEXT } from '../copy';
import type { Segment } from '../data/search';
import { metricGoalHref, metricInfo, metricResultsHref } from '../metricLabels';

/** Text with matched words marked (achromatic wash, never yellow). */
export function Highlighted({ segments }: { segments: readonly Segment[] }) {
  // Plain runs stay bare text nodes so their spaces survive accessible-name computation.
  return (
    <>
      {segments.map((s, i) =>
        s.hit ? (
          <mark key={i} className="ev-hit">
            {s.text}
          </mark>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        ),
      )}
    </>
  );
}

/** "■ fuel & ketosis" — the category hue on the swatch only, the name in words. */
export function CategoryMark({ category }: { category: EvidenceCategory }) {
  return (
    <span className="ev-cat">
      <Swatch category={category} shape="square" />
      {CATEGORY_LABEL[category]}
    </span>
  );
}

const VERDICT_ICON = {
  'not-supported': X,
  oversimplified: Minus,
  unproven: CircleHelp,
  'supported-with-caveats': Check,
} as const;

/** Claim verdict: glyph + words (no colour coding). */
export function VerdictChip({ verdict }: { verdict: Myth['verdict'] }) {
  return (
    <Chip icon={VERDICT_ICON[verdict]} className="ev-verdict">
      <VisuallyHidden>Verdict: </VisuallyHidden>
      {VERDICT_TEXT[verdict]}
    </Chip>
  );
}

/** External link that always opens in a new tab without leaking the opener or referrer. */
export function ExternalLink({
  href,
  children,
  offline,
  className,
}: {
  href: string;
  children: ReactNode;
  offline?: boolean;
  className?: string;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className ?? 'ev-ext'}>
      {children}
      <Icon icon={ArrowUpRight} size={14} />
      <VisuallyHidden> (opens in a new tab{offline ? '; you are offline' : ''})</VisuallyHidden>
      {offline ? (
        <span className="ev-ext__hint" aria-hidden="true">
          opens a website
        </span>
      ) : null}
    </a>
  );
}

/** A metric chip that links to Results with that metric focused. */
export function MetricChipLink({ id }: { id: string }) {
  const m = metricInfo(id);
  return (
    <Link
      to={metricResultsHref(id)}
      className="lm-chip ev-chiplink"
      data-kind="metric"
      title={`Show ${m.label} in your results`}
    >
      {m.category ? <Swatch category={m.category} /> : null}
      <span className="lm-chip__text">{m.label}</span>
    </Link>
  );
}

/** "used by" chips; renders nothing when the mechanism drives no metric yet. */
export function UsedByChips({ ids, label = true }: { ids: readonly string[]; label?: boolean }) {
  if (!ids.length) return null;
  return (
    <div className="ev-usedby">
      {label ? <span className="lm-eng">used by</span> : null}
      <ul className="ev-chiprow" aria-label="Metrics this mechanism drives">
        {ids.map((id) => (
          <li key={id}>
            <MetricChipLink id={id} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Use as a goal" links, only for goal-eligible metrics. */
export function GoalLinks({ ids }: { ids: readonly string[] }) {
  const goals = ids
    .map((id) => ({ id, href: metricGoalHref(id) }))
    .filter((g): g is { id: string; href: string } => Boolean(g.href));
  if (!goals.length) return null;
  return (
    <p className="ev-goals">
      {goals.map((g) => (
        <Link key={g.id} to={g.href} className="ev-link">
          Use as a goal: {metricInfo(g.id).label}
        </Link>
      ))}
    </p>
  );
}

/** One-line disclaimer (information, not medical advice). */
export function Disclaimer({ className }: { className?: string }) {
  return (
    <p className={['ev-disclaimer', className].filter(Boolean).join(' ')}>
      <StatusMark severity="info" size={16} />
      <span>{DISCLAIMER}</span>
    </p>
  );
}
