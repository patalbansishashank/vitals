import { useId, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import {
  CATEGORY_LABEL,
  EmptyStage,
  Faceplate,
  Icon,
  Key,
  ProgressRule,
  Skeleton,
  formatNumber,
} from '@/components';
import { sentence } from '../copy';
import { CATEGORY_ORDER, hasFilters, type GroupBy, type IndexUrlState } from '../data/filters';
import type { MechanismDoc } from '../data/search';
import type { EvidenceSearchState } from '../hooks';
import { topicHref, type EvidenceNavState } from '../links';
import { ClaimRow, MechanismRow, MetricStrip } from './Rows';
import { countGrades, GradeShare } from './GradeShare';

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
    <ul className="ev-list lm-material" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="ev-row ev-row--skeleton">
          <div className="ev-row__head">
            <Skeleton width="70%" height={14} />
            <Skeleton width={48} height={18} className="ev-skel-grade" />
          </div>
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

function loadingLine(search: EvidenceSearchState): string | null {
  return search.settled ? null : `Loading ${search.loaded} of ${search.total} topics`;
}

interface Group {
  key: string;
  title: string;
  /** The topic page (topic groups). */
  href?: string;
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
      g =
        by === 'category'
          ? {
              key,
              title: sentence(CATEGORY_LABEL[d.mechanism.category]),
              count: totals.get(key) ?? 0,
              rows: [],
            }
          : {
              key,
              title: d.topic.title,
              href: topicHref(d.topic.slug),
              count: totals.get(key) ?? 0,
              rows: [],
            };
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
      <Key variant="outlined" icon={ChevronDown} onClick={onShowMore}>
        Show {formatNumber(Math.min(PAGE_SIZE, total - shown))} more
      </Key>
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
  onExplainMetric: (metricId: string) => void;
  /** Offer "Clear filters" beside the count (phones, where the filters sit in a closed sheet; desktop has its column). */
  clearInline?: boolean;
}

export function Results({
  search,
  state,
  shown,
  onShowMore,
  onQuery,
  onClearFilters,
  onExplainMetric,
  clearInline = true,
}: ResultsProps) {
  const [allClaims, setAllClaims] = useState(false);
  const headingId = useId();
  const hasQuery = search.tokens.length > 0;
  const filtered = hasFilters(state);
  const mechs = search.mechanisms;

  if (search.loaded === 0 && !search.settled) {
    return (
      <section className="ev-library" aria-labelledby={headingId} aria-busy="true">
        <h2 id={headingId} className="lm-sr">
          Mechanisms
        </h2>
        <p className="ev-status">{loadingLine(search)}</p>
        <Progress search={search} />
        <LoadingRows />
      </section>
    );
  }

  if (search.loaded === 0 && search.settled) {
    return null; // the failure state above says what happened
  }

  const example = (word: string) => (
    <button type="button" className="ev-inline-key" onClick={() => onQuery(word)}>
      {word}
    </button>
  );

  if (hasQuery) {
    const none = !mechs.length && !search.myths.length && !search.metrics.length;
    const q = state.q.trim();
    const summary = `${mechs.length} ${mechs.length === 1 ? 'mechanism' : 'mechanisms'}, ${search.myths.length} ${search.myths.length === 1 ? 'claim' : 'claims'} and ${search.metrics.length} ${search.metrics.length === 1 ? 'metric' : 'metrics'} match “${q}”${search.settled ? '' : ' so far'}.`;
    if (none) {
      return (
        <>
          <p className="lm-sr" role="status">
            {search.settled ? `No mechanism matches “${q}”.` : ''}
          </p>
          {search.settled ? (
            <EmptyStage
              title={`No mechanism matches “${q}”.`}
              action={
                <>
                  <Key onClick={() => onQuery('')}>Clear search</Key>
                  {filtered ? (
                    <Key variant="text" onClick={onClearFilters}>
                      Clear filters
                    </Key>
                  ) : null}
                </>
              }
            >
              Try {example('ketones')} or {example('hunger')}.
            </EmptyStage>
          ) : (
            <div className="ev-results">
              <p className="ev-status">{loadingLine(search)}</p>
              <Progress search={search} />
            </div>
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
          <Faceplate title="Metrics">
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
              loadingLine(search) ??
              `${formatNumber(mechs.length)} ${mechs.length === 1 ? 'match' : 'matches'}`
            }
            data-results="mechanisms"
          >
            <Progress search={search} />
            <ul className="ev-list">
              {mechs.slice(0, shown).map((h) => (
                <MechanismRow key={h.doc.id} doc={h.doc} tokens={search.tokens} showTopic />
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
                <Key variant="text" icon={ChevronDown} onClick={() => setAllClaims(true)}>
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
      >
        {search.settled ? null : 'Some topics are still loading.'}
      </EmptyStage>
    );
  }

  const groups = groupRows(
    mechs.map((h) => h.doc),
    shown,
    state.group,
  );
  const line =
    loadingLine(search) ??
    (filtered ? `${formatNumber(mechs.length)} of ${formatNumber(search.totalMechanisms)} mechanisms` : null);
  return (
    <section className="ev-library" aria-labelledby={headingId} data-results="mechanisms">
      <h2 id={headingId} className="lm-sr">
        Mechanisms
      </h2>
      {line || (filtered && clearInline) ? (
        <div className="ev-statusrow">
          {line ? <p className="ev-status">{line}</p> : null}
          {filtered && clearInline ? (
            <Key variant="text" size="sm" icon={RotateCcw} onClick={onClearFilters}>
              Clear filters
            </Key>
          ) : null}
        </div>
      ) : null}
      <Progress search={search} />
      <div className="ev-groups" onKeyDown={onResultsKeyDown}>
        {groups.map((g) => {
          const id = `ev-group-${g.key}`;
          return (
            <section key={g.key} className="ev-group" aria-labelledby={id}>
              <div className="ev-group__head">
                <h3 id={id} className="ev-group__title">
                  {g.href ? (
                    // the whole heading row is the link's target; its count and chevron sit together at the trailing edge
                    <Link to={g.href} state={NAV_STATE} className="ev-group__link">
                      {g.title}
                    </Link>
                  ) : (
                    g.title
                  )}
                </h3>
                <span className="ev-group__end">
                  <GradeShare counts={countGrades(g.rows.map((row) => row.mechanism))} />
                  {/* (r068 final M18) a group cut short by the page says how much of it shows ("9 of 15") */}
                  <span className="ev-count">
                    {g.rows.length < g.count
                      ? `${formatNumber(g.rows.length)} of ${formatNumber(g.count)}`
                      : formatNumber(g.count)}
                  </span>
                  {g.href ? <Icon icon={ChevronRight} size={18} /> : null}
                </span>
              </div>
              <ul className="ev-list lm-material">
                {g.rows.map((d) => (
                  <MechanismRow key={d.id} doc={d} showTopic={state.group === 'category'} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <ShowMore shown={Math.min(shown, mechs.length)} total={mechs.length} onShowMore={onShowMore} />
    </section>
  );
}
