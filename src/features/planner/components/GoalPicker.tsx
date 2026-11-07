import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Check, Search } from 'lucide-react';
import { CATEGORY_LABEL, Icon, Key, MQ, Popover, Sheet, Swatch, TextInput, useMediaQuery } from '@/components';
import type { MetricId } from '@/engine/types/metrics';
import { gradeDHelp, GOAL_METRICS, groupedMetrics, matchesGoalQuery, type GoalMetric } from '../catalogue';

/** Group headings in sentence case (the catalogue's names are lowercase for use mid-sentence). */
const sentenceCase = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

export interface GoalPickerProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  /** Metrics already ranked. */
  selected: ReadonlySet<string>;
  /** Six goals reached: adding is refused with the design's message. */
  full: boolean;
  onPick: (metric: MetricId) => void;
  /** Physiology sex, to hide the other sex's markers. */
  sex?: 'male' | 'female' | null;
  /** "Suggest from my answers" (planner-goals.md §12), the picker's first row: closes the picker and proposes goals. */
  onSuggest?: () => void;
  suggesting?: boolean;
  /** Why suggesting is unavailable (Your body unfinished, a run in progress). */
  suggestDisabledReason?: string;
}

/**
 * Add-a-goal picker (planner-goals.md §4 "Add a goal"): desktop Popover 480 × 560 anchored to the key, mobile full
 * Sheet. The metric catalogue grouped by the 8 categories, with search, grade badges, goal-eligibility (metrics that
 * are not goal-eligible are listed with the reason and cannot be added) and each metric's mandatory caveat.
 */
export function GoalPicker({ open, onClose, anchorRef, selected, full, onPick, sex, onSuggest, suggesting, suggestDisabledReason }: GoalPickerProps) {
  const desktop = useMediaQuery(MQ.lg);
  const suggest = onSuggest ? (
    <div className="lp-picker__suggest">
      <Key variant="action" size="sm" block onClick={onSuggest} loading={suggesting} disabledReason={suggestDisabledReason}>
        Suggest from my answers
      </Key>
    </div>
  ) : null;
  const body = <PickerBody selected={selected} full={full} sex={sex} onPick={onPick} lead={suggest} />;
  if (desktop)
    return (
      <Popover open={open} onOpenChange={(o) => !o && onClose()} anchorRef={anchorRef} label="Add a goal" className="lp-picker-pop" placement="bottom-start">
        {body}
      </Popover>
    );
  return (
    <Sheet open={open} onClose={onClose} title="Add a goal" detents={['full']} defaultDetent="full">
      {body}
    </Sheet>
  );
}

function PickerBody({ selected, full, sex, onPick, lead }: { selected: ReadonlySet<string>; full: boolean; sex?: 'male' | 'female' | null; onPick: (m: MetricId) => void; lead?: ReactNode }) {
  const [query, setQuery] = useState('');
  const [onlyGoals, setOnlyGoals] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => {
    const list = GOAL_METRICS.filter((m) => (!m.sexes || !sex || m.sexes.includes(sex)) && matchesGoalQuery(m, query) && (!onlyGoals || m.eligible));
    return groupedMetrics(list);
  }, [query, onlyGoals, sex]);
  const count = groups.reduce((a, g) => a + g.metrics.length, 0);
  return (
    <div className="lp-picker">
      {lead}
      <div className="lp-picker__search">
        <Icon icon={Search} size={16} className="lp-picker__search-icon" />
        <TextInput
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search outcomes, e.g. ketones"
          aria-label="Search outcomes"
          autoComplete="off"
        />
      </div>
      <div className="lp-picker__bar">
        <label className="lp-picker__toggle">
          <input type="checkbox" checked={onlyGoals} onChange={(e) => setOnlyGoals(e.target.checked)} />
          <span>Goals only</span>
        </label>
        <span className="lm-eng" aria-live="polite">
          {count} outcome{count === 1 ? '' : 's'}
          {full ? ' · six goals chosen' : ''}
        </span>
      </div>
      {full ? <p className="lp-picker__full">Up to six goals. Remove one to add another.</p> : null}
      <div className="lp-picker__groups">
        {groups.length === 0 ? <p className="lp-picker__empty">No outcome matches “{query}”. Try a plain word such as “fat”, “ketones” or “blood pressure”.</p> : null}
        {groups.map((grp) => {
          const eligible = grp.metrics.filter((m) => m.eligible).length;
          return (
            <section key={grp.category} className="lp-picker__group" aria-label={sentenceCase(CATEGORY_LABEL[grp.category])}>
              <h3 className="lp-picker__cat">
                <Swatch category={grp.category} shape="square" />
                <span>{sentenceCase(CATEGORY_LABEL[grp.category])}</span>
                <span className="lp-picker__count lm-num">
                  {eligible}/{grp.metrics.length}
                </span>
              </h3>
              <ul className="lp-picker__list">
                {grp.metrics.map((m) => (
                  <PickerRow key={m.id} metric={m} added={selected.has(m.id)} full={full} onPick={onPick} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function PickerRow({ metric: m, added, full, onPick }: { metric: GoalMetric; added: boolean; full: boolean; onPick: (m: MetricId) => void }) {
  const disabledReason = !m.eligible ? m.reason : added ? 'Already in your goals.' : full ? 'Up to six goals. Remove one to add another.' : null;
  const detailId = `pick-${m.id}-detail`;
  return (
    <li className="lp-pick" data-eligible={m.eligible || undefined} data-added={added || undefined}>
      <button
        type="button"
        className="lp-pick__btn"
        aria-disabled={disabledReason ? true : undefined}
        aria-describedby={detailId}
        onClick={() => {
          if (!disabledReason) onPick(m.id);
        }}
      >
        {/* r068 W2-16: a row is the name and its unit; the whole row adds (an added row shows its check). The grade and
            the C6 "scenario" status word stay in the accessible name and in the goal's Explain sheet once added. */}
        <span className="lp-pick__name">{m.label}</span>
        <span className="lp-pick__unit">{m.unit}</span>
        <span className="lp-pick__act" aria-hidden="true">
          {added ? <Icon icon={Check} size={16} /> : null}
        </span>
        <span className="lm-sr">
          {`, evidence grade ${m.grade}${m.eligible && m.availability === 'scenario' ? ', scenario' : ''}`}
          {added ? ', added' : m.eligible ? ', add as a goal' : ', not a goal'}
        </span>
      </button>
      <div id={detailId} className="lp-pick__detail">
        {!m.eligible ? <p className="lp-pick__reason">Not a goal · {m.reason}</p> : null}
        {m.eligible && m.grade === 'D' ? <p className="lp-pick__help">{gradeDHelp(m.id)}</p> : null}
        {m.eligible && m.caveat && (m.grade === 'D' || m.id === 'autophagyIdx') ? <p className="lp-pick__caveat">{m.caveat}</p> : null}
      </div>
    </li>
  );
}
