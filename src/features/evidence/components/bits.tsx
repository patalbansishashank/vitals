import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, Check, CircleHelp, Minus, X } from 'lucide-react';
import { CATEGORY_LABEL, Chip, Icon, KeyLink, Swatch, VisuallyHidden } from '@/components';
import type { EvidenceCategory, Myth } from '@/content/evidence/schema';
import { DISCLAIMER, VERDICT_TEXT, sentence } from '../copy';
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

/** "Fuel & ketosis": the category in words (the word carries the meaning; no colour mark). */
export function CategoryMark({ category }: { category: EvidenceCategory }) {
  return <span className="ev-cat">{sentence(CATEGORY_LABEL[category])}</span>;
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

/**
 * The metrics a mechanism drives (article › Used by): one row per metric — its swatch and name, which open it in the
 * Simulator, and "Set as goal" at the trailing edge for a goal-eligible one (r068 EV-7: the same metrics are not
 * listed twice, as chips and again as goal links). Renders nothing when it drives none yet.
 */
export function UsedByChips({ ids }: { ids: readonly string[] }) {
  if (!ids.length) return null;
  return (
    <ul className="ev-usedby" aria-label="Metrics this mechanism drives">
      {ids.map((id) => {
        const m = metricInfo(id);
        const goal = metricGoalHref(id);
        return (
          <li key={id} className="ev-usedrow">
            <Link
              to={metricResultsHref(id)}
              className="ev-usedrow__link"
              title={`Show ${m.label} in your results`}
            >
              {m.category ? <Swatch category={m.category} /> : null}
              <span className="ev-usedrow__name">{m.label}</span>
            </Link>
            {goal ? (
              <KeyLink to={goal} variant="text" size="sm" aria-label={`Use as a goal: ${m.label}`}>
                Set as goal
              </KeyLink>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** One-line disclaimer (information, not medical advice), plain small text at the end of a reading. */
export function Disclaimer({ className }: { className?: string }) {
  return <p className={['ev-disclaimer', className].filter(Boolean).join(' ')}>{DISCLAIMER}</p>;
}
