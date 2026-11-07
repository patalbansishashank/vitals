import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { GradeBadge, Icon, Swatch, VisuallyHidden } from '@/components';
import { topicDisplayName } from '@/content/evidence/sources';
import { STATUS_TEXT, sentence } from '../copy';
import {
  containsHit,
  highlight,
  makeSnippet,
  type MechanismDoc,
  type MetricDoc,
  type MythDoc,
} from '../data/search';
import { claimAnchor, mechanismHref, topicHref, type EvidenceNavState } from '../links';
import { Highlighted, VerdictChip } from './bits';

const NAV_STATE: EvidenceNavState = { from: 'evidence' };

let lastOpened: string | null = null;
/** The row the reader last opened (focus returns to it once, on "back"). */
export const takeLastOpenedRow = (): string | null => {
  const id = lastOpened;
  lastOpened = null;
  return id;
};

/** Characters a matched passage may run to: about three lines on a 360 px phone, one or two on a desk. */
const PASSAGE_CHARS = 110;

export interface MechanismRowProps {
  doc: MechanismDoc;
  tokens?: readonly string[];
  /** Name the topic in the row's fact line: search results, where no topic header above the row says it. */
  showTopic?: boolean;
}

/**
 * Library row: the name, its grade, and a fact line only when there is a fact to state (the topic where no header
 * above says it, "contested"). The mechanism's prose lives in its article; the row quotes a passage only during a
 * search whose match the title does not show. The whole row is the link.
 */
export function MechanismRow({ doc, tokens = [], showTopic = false }: MechanismRowProps) {
  const m = doc.mechanism;
  const passage =
    tokens.length > 0 && !containsHit(m.title, tokens) ? makeSnippet(doc, tokens, PASSAGE_CHARS) : null;
  const facts = [
    showTopic ? topicDisplayName(doc.topic.slug, doc.topic.title) : null,
    m.status === 'contested' ? STATUS_TEXT.contested.label.toLowerCase() : null,
  ].filter((f): f is string => Boolean(f));
  return (
    <li className="ev-row" data-row-id={doc.id}>
      <div className="ev-row__head">
        <Link
          to={mechanismHref(m.id)}
          state={NAV_STATE}
          className="ev-row__link ev-row__title"
          onClick={() => {
            lastOpened = doc.id;
          }}
        >
          <Highlighted segments={highlight(m.title, tokens)} />
        </Link>
        <GradeBadge grade={m.grade} size="sm" tooltip={false} />
      </div>
      {passage ? (
        <p className="ev-row__match">
          {passage.field !== 'summary' ? <span className="ev-row__where">{sentence(passage.field)}: </span> : null}
          <Highlighted segments={passage.segments} />
        </p>
      ) : null}
      {facts.length ? <p className="ev-row__meta">{sentence(facts.join(' · '))}</p> : null}
    </li>
  );
}

/**
 * A common claim in search results: links to the claim on its topic page, with its verdict and topic. It quotes the
 * explanation only when the match is there rather than in the claim.
 */
export function ClaimRow({ doc, tokens = [] }: { doc: MythDoc; tokens?: readonly string[] }) {
  const y = doc.myth;
  const passage = containsHit(y.claim, tokens) ? null : makeSnippet(doc, tokens, PASSAGE_CHARS);
  return (
    <li className="ev-row" data-row-id={doc.id}>
      <div className="ev-row__head">
        <Link
          to={topicHref(doc.topic.slug, claimAnchor(y.id))}
          state={NAV_STATE}
          className="ev-row__link ev-row__title"
        >
          “<Highlighted segments={highlight(y.claim, tokens)} />”
        </Link>
      </div>
      {passage ? (
        <p className="ev-row__match">
          <Highlighted segments={passage.segments} />
        </p>
      ) : null}
      <div className="ev-row__meta">
        <VerdictChip verdict={y.verdict} />
        <span>{topicDisplayName(doc.topic.slug, doc.topic.title)}</span>
      </div>
    </li>
  );
}

/** Metrics that match a search: compact rows (swatch, name, a chevron), each opening Explain (r068 EV-5). */
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
    <ul className="ev-usedby ev-metricstrip">
      {docs.map((d) => (
        <li key={d.id} className="ev-usedrow">
          <button type="button" className="ev-usedrow__link ev-usedrow__btn" onClick={() => onExplain(d.id)}>
            <Swatch category={d.metric.category ?? 'body'} />
            <span className="ev-usedrow__name">
              <VisuallyHidden>Explain </VisuallyHidden>
              <Highlighted segments={highlight(d.metric.label, tokens)} />
            </span>
            <Icon icon={ChevronRight} size={18} className="ev-usedrow__chev" />
          </button>
        </li>
      ))}
    </ul>
  );
}
