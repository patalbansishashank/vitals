import { Link } from 'react-router';
import { Chip, GradeBadge, VisuallyHidden } from '@/components';
import { topicDisplayName } from '@/content/evidence/sources';
import { STATUS_TEXT } from '../copy';
import {
  containsHit,
  highlight,
  makeSnippet,
  type MechanismDoc,
  type MetricDoc,
  type MythDoc,
} from '../data/search';
import { claimAnchor, mechanismHref, topicHref, type EvidenceNavState } from '../links';
import { CategoryMark, Highlighted, UsedByChips, VerdictChip } from './bits';

const NAV_STATE: EvidenceNavState = { from: 'evidence' };

let lastOpened: string | null = null;
/** The row the reader last opened (focus returns to it once, on "back"). */
export const takeLastOpenedRow = (): string | null => {
  const id = lastOpened;
  lastOpened = null;
  return id;
};

/** What the engraved context line shows. */
export type RowContext = 'category' | 'topic' | 'both';

export interface MechanismRowProps {
  doc: MechanismDoc;
  tokens?: readonly string[];
  context?: RowContext;
}

/**
 * Index row: engraved context, name + grade, one-line statement (or the passage
 * that matched), "used by" chips. The whole row is the link; chips are separate links.
 */
export function MechanismRow({ doc, tokens = [], context = 'both' }: MechanismRowProps) {
  const m = doc.mechanism;
  const titleHit = tokens.length > 0 && containsHit(m.title, tokens);
  const snippet = tokens.length > 0 && !titleHit ? makeSnippet(doc, tokens) : null;
  return (
    <li className="ev-row" data-row-id={doc.id}>
      <div className="ev-row__eng lm-eng">
        {context !== 'topic' ? <CategoryMark category={m.category} /> : null}
        {context !== 'category' ? <span>{topicDisplayName(doc.topic.slug, doc.topic.title)}</span> : null}
        {m.status === 'contested' ? (
          <span className="ev-row__status">{STATUS_TEXT.contested.label}</span>
        ) : null}
      </div>
      <div className="ev-row__head">
        <Link
          to={mechanismHref(m.id)}
          state={NAV_STATE}
          className="ev-row__link ev-row__title"
          onClick={() => {
            lastOpened = doc.id;
          }}
        >
          <Highlighted
            segments={tokens.length ? highlight(m.title, tokens) : [{ text: m.title, hit: false }]}
          />
        </Link>
        <GradeBadge grade={m.grade} size="sm" tooltip={false} />
      </div>
      {snippet ? (
        <p className="ev-row__sum">
          {snippet.field !== 'summary' ? <span className="ev-row__where">{snippet.field}: </span> : null}
          <Highlighted segments={snippet.segments} />
        </p>
      ) : (
        <p className="ev-row__sum">
          <Highlighted
            segments={tokens.length ? highlight(m.summary, tokens) : [{ text: m.summary, hit: false }]}
          />
        </p>
      )}
      {m.relatedMetricIds.length ? (
        <div className="ev-row__chips">
          <UsedByChips ids={m.relatedMetricIds} />
        </div>
      ) : null}
    </li>
  );
}

/** A common claim in search results: links to the claim on its topic page. */
export function ClaimRow({ doc, tokens = [] }: { doc: MythDoc; tokens?: readonly string[] }) {
  const y = doc.myth;
  const snippet = tokens.length && !containsHit(y.claim, tokens) ? makeSnippet(doc, tokens) : null;
  return (
    <li className="ev-row" data-row-id={doc.id}>
      <div className="ev-row__eng lm-eng">
        <span>common claim · {topicDisplayName(doc.topic.slug, doc.topic.title)}</span>
      </div>
      <div className="ev-row__head">
        <Link
          to={topicHref(doc.topic.slug, claimAnchor(y.id))}
          state={NAV_STATE}
          className="ev-row__link ev-row__title"
        >
          “<Highlighted segments={highlight(y.claim, tokens)} />”
        </Link>
      </div>
      <div className="ev-row__verdict">
        <VerdictChip verdict={y.verdict} />
      </div>
      <p className="ev-row__sum">
        <Highlighted segments={snippet ? snippet.segments : highlight(y.explanation, tokens)} />
      </p>
    </li>
  );
}

/** Metrics that match a search: chips in their category hue; each opens Explain. */
export function MetricStrip({
  docs,
  tokens = [],
  onExplain,
}: {
  docs: readonly MetricDoc[];
  tokens?: readonly string[];
  onExplain: (metricId: string) => void;
}) {
  return (
    <ul className="ev-chiprow ev-metricstrip">
      {docs.map((d) => (
        <li key={d.id}>
          <Chip kind="metric" category={d.metric.category ?? 'body'} onClick={() => onExplain(d.id)}>
            <VisuallyHidden>Explain </VisuallyHidden>
            <Highlighted segments={highlight(d.metric.label, tokens)} />
          </Chip>
        </li>
      ))}
    </ul>
  );
}
