import { Fragment, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronDown } from 'lucide-react';
import {
  CATEGORY_LABEL,
  EmptyStage,
  Faceplate,
  Key,
  KeyBank,
  ProgressRule,
  Section,
  Skeleton,
  Swatch,
  formatNumber,
} from '@/components';
import type { EvidenceCategory } from '@/content/evidence/schema';
import { CATEGORY_ORDER, hasFilters, type GroupBy, type IndexUrlState } from '../data/filters';
import type { MechanismDoc } from '../data/search';
import type { EvidenceSearchState } from '../hooks';
import { topicHref, type EvidenceNavState } from '../links';
import { ClaimRow, MechanismRow, MetricStrip } from './Rows';

export const PAGE_SIZE = 40;
const CLAIMS_PREVIEW = 6;
const NAV_STATE: EvidenceNavState = { from: 'evidence' };

/** ↑/↓ (and Home/End) move between result links; Tab still walks every control. */
export function onResultsKeyDown(e: KeyboardEvent<HTMLElement>): void {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const target = e.target as HTMLElement;
  if (!target.classList.contains('ev-row__link')) return;
  const links = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('.ev-row__link'));
  const i = links.indexOf(target);
  const next =
    e.key === 'Home' ? 0 : e.key === 'End' ? links.length - 1 : i + (e.key === 'ArrowDown' ? 1 : -1);
  const el = links[Math.max(0, Math.min(links.length - 1, next))];
  if (el && el !== target) {
    e.preventDefault();
    el.focus();
  }
}

/** Focus the first result link inside `root` (↓ from the search field). */
export function focusFirstResult(root: HTMLElement | null): void {
  window.requestAnimationFrame(() => root?.querySelector<HTMLElement>('.ev-row__link')?.focus());
}

function LoadingRows() {
  return (
    <ul className="ev-list" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="ev-row ev-row--skeleton">
          <Skeleton width={120} height={10} />
          <Skeleton width="70%" height={14} />
          <Skeleton lines={2} height={11} />
        </li>
      ))}
    </ul>
  );
}

function Progress({ search }: { search: EvidenceSearchState }) {
  if (search.settled) return null;
  return (
    <ProgressRule
      value={search.total ? search.loaded / search.total : 0}
      label={`Loading the library: ${search.loaded} of ${search.total} topics`}
      className="ev-progress"
    />
  );
}

function loadingCaption(search: EvidenceSearchState): string | null {
  return search.settled ? null : `loading ${search.loaded} of ${search.total} topics`;
}

interface Group {
  key: string;
  header: ReactNode;
  count: number;
  rows: MechanismDoc[];
}

function groupRows(all: MechanismDoc[], shown: number, by: GroupBy): Group[] {
  const ordered =
    by === 'category'
      ? [...all].sort(
          (a, b) =>
            CATEGORY_ORDER.indexOf(a.mechanism.category) - CATEGORY_ORDER.indexOf(b.mechanism.category) ||
            a.order - b.order,
        )
      : all;
  const totals = new Map<string, number>();
  const keyOf = (d: MechanismDoc) => (by === 'category' ? d.mechanism.category : d.topic.slug);
  for (const d of ordered) totals.set(keyOf(d), (totals.get(keyOf(d)) ?? 0) + 1);
  const groups: Group[] = [];
  for (const d of ordered.slice(0, shown)) {
    const key = keyOf(d);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      const header =
        by === 'category' ? (
          <span className="ev-grouphead">
            <Swatch category={d.mechanism.category as EvidenceCategory} shape="square" />
            {CATEGORY_LABEL[d.mechanism.category]}
          </span>
        ) : (
          <span className="ev-grouphead">
            <Link to={topicHref(d.topic.slug)} state={NAV_STATE} className="ev-link">
              {d.topic.title}
            </Link>
          </span>
        );
      g = { key, header, count: totals.get(key) ?? 0, rows: [] };
      groups.push(g);
    }
    g.rows.push(d);
  }
  return groups;
}

function ShowMore({ shown, total, onShowMore }: { shown: number; total: number; onShowMore: () => void }) {
  if (shown >= total) return null;
  return (
    <div className="ev-more">
      <Key icon={ChevronDown} onClick={onShowMore}>
        Show {formatNumber(Math.min(PAGE_SIZE, total - shown))} more
      </Key>
      <span className="lm-eng">
        {formatNumber(shown)} of {formatNumber(total)} shown
      </span>
    </div>
  );
}

export interface ResultsProps {
  search: EvidenceSearchState;
  state: IndexUrlState;
  shown: number;
  onShowMore: () => void;
  onQuery: (q: string) => void;
  onClearFilters: () => void;
  onGroup: (g: GroupBy) => void;
  onExplainMetric: (metricId: string) => void;
}

export function Results({
  search,
  state,
  shown,
  onShowMore,
  onQuery,
  onClearFilters,
  onGroup,
  onExplainMetric,
}: ResultsProps) {
  const [allClaims, setAllClaims] = useState(false);
  const hasQuery = search.tokens.length > 0;
  const filtered = hasFilters(state);
  const mechs = search.mechanisms;
  const mechDocs = mechs.map((h) => h.doc);

  if (search.loaded === 0 && !search.settled) {
    return (
      <Faceplate title="Mechanisms" caption={loadingCaption(search)}>
        <Progress search={search} />
        <LoadingRows />
      </Faceplate>
    );
  }

  if (search.loaded === 0 && search.settled) {
    return null; // the failure notice above explains
  }

  const example = (word: string) => (
    <button type="button" className="ev-inline-key" onClick={() => onQuery(word)}>
      {word}
    </button>
  );

  if (hasQuery) {
    const none = !mechs.length && !search.myths.length && !search.metrics.length;
    const summary = `${mechs.length} ${mechs.length === 1 ? 'mechanism' : 'mechanisms'}, ${search.myths.length} ${search.myths.length === 1 ? 'claim' : 'claims'} and ${search.metrics.length} ${search.metrics.length === 1 ? 'metric' : 'metrics'} match “${state.q.trim()}”${search.settled ? '' : ' so far'}.`;
    if (none) {
      return (
        <>
          <p className="lm-sr" role="status">
            {search.settled ? `No mechanism matches “${state.q.trim()}”.` : ''}
          </p>
          {search.settled ? (
            <EmptyStage
              title={`No mechanism matches “${state.q.trim()}”.`}
              action={
                <>
                  <Key onClick={() => onQuery('')}>Clear search</Key>
                  {filtered ? (
                    <Key variant="quiet" onClick={onClearFilters}>
                      Clear filters
                    </Key>
                  ) : null}
                </>
              }
              art={null}
            >
              Try a metric name, like {example('ketones')} or {example('hunger')}.
              {filtered ? ' Filters are on, too.' : ''}
            </EmptyStage>
          ) : (
            <Faceplate title="Mechanisms" caption={loadingCaption(search)}>
              <Progress search={search} />
              <p className="ev-muted-line">
                No matches yet. Still searching the topics that haven’t loaded.
              </p>
            </Faceplate>
          )}
        </>
      );
    }
    const claims = allClaims ? search.myths : search.myths.slice(0, CLAIMS_PREVIEW);
    return (
      <div className="ev-results" onKeyDown={onResultsKeyDown}>
        <p className="lm-sr" role="status">
          {summary}
        </p>
        {search.metrics.length ? (
          <Faceplate
            title="Metrics"
            caption={`${search.metrics.length} ${search.metrics.length === 1 ? 'channel' : 'channels'} in the Simulator · open one to explain it`}
          >
            <MetricStrip
              docs={search.metrics.map((h) => h.doc)}
              tokens={search.tokens}
              onExplain={onExplainMetric}
            />
          </Faceplate>
        ) : null}
        {mechs.length ? (
          <Faceplate
            title="Mechanisms"
            caption={
              loadingCaption(search) ??
              `${formatNumber(mechs.length)} ${mechs.length === 1 ? 'match' : 'matches'}`
            }
            data-results="mechanisms"
          >
            <Progress search={search} />
            <ul className="ev-list">
              {mechs.slice(0, shown).map((h) => (
                <MechanismRow key={h.doc.id} doc={h.doc} tokens={search.tokens} context="both" />
              ))}
            </ul>
            <ShowMore shown={Math.min(shown, mechs.length)} total={mechs.length} onShowMore={onShowMore} />
          </Faceplate>
        ) : null}
        {search.myths.length ? (
          <Faceplate
            title="Common claims"
            caption={`${search.myths.length} ${search.myths.length === 1 ? 'match' : 'matches'}`}
          >
            <ul className="ev-list">
              {claims.map((h) => (
                <ClaimRow key={h.doc.id} doc={h.doc} tokens={search.tokens} />
              ))}
            </ul>
            {search.myths.length > CLAIMS_PREVIEW && !allClaims ? (
              <div className="ev-more">
                <Key icon={ChevronDown} onClick={() => setAllClaims(true)}>
                  Show all {formatNumber(search.myths.length)} claims
                </Key>
              </div>
            ) : null}
          </Faceplate>
        ) : null}
      </div>
    );
  }

  if (!mechs.length) {
    return (
      <EmptyStage
        title="No mechanism has these filters."
        action={
          <Key variant="solid" onClick={onClearFilters}>
            Clear filters
          </Key>
        }
        art={null}
      >
        {search.settled ? 'Try another grade or category.' : 'Some topics are still loading.'}
      </EmptyStage>
    );
  }

  const groups = groupRows(mechDocs, shown, state.group);
  const caption =
    loadingCaption(search) ??
    (filtered
      ? `${formatNumber(mechs.length)} of ${formatNumber(search.totalMechanisms)}`
      : `${formatNumber(mechs.length)} in ${formatNumber(search.total)} topics`);
  return (
    <Faceplate
      title="Mechanisms"
      caption={caption}
      actions={
        <KeyBank
          size="sm"
          label="Group by"
          value={state.group}
          onChange={onGroup}
          options={[
            { value: 'category', label: 'by category' },
            { value: 'topic', label: 'by topic' },
          ]}
        />
      }
      data-results="mechanisms"
    >
      <Progress search={search} />
      <div className="ev-groups" onKeyDown={onResultsKeyDown}>
        {groups.map((g) => (
          <Fragment key={g.key}>
            <Section
              labelAs="h3"
              label={g.header}
              aside={<span className="ev-count">{formatNumber(g.count)}</span>}
              className="ev-group"
            >
              <ul className="ev-list">
                {g.rows.map((d) => (
                  <MechanismRow
                    key={d.id}
                    doc={d}
                    context={state.group === 'category' ? 'topic' : 'category'}
                  />
                ))}
              </ul>
            </Section>
          </Fragment>
        ))}
      </div>
      <ShowMore shown={Math.min(shown, mechs.length)} total={mechs.length} onShowMore={onShowMore} />
    </Faceplate>
  );
}
