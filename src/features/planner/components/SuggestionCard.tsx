import { useEffect, useRef, useState } from 'react';
import { Chip, Faceplate, Key, NumberField, ProgressRule, ResponsivePanel } from '@/components';
import type {
  GoalSuggestion,
  SuggestedConstraints,
  SuggestedGoal,
  SuggestedCandidate,
  SuggestPurpose,
} from '@/engine/planner/domain/suggestGoals';
import type { ConstraintDraft } from '@/state/plannerStore';
import type { UnitSystem } from '@/state/settingsStore';
import { goalMetric } from '../catalogue';
import { fmtClock, fmtMetric } from '../format';
import '../suggest.css';

export type SuggestionState =
  | { status: 'loading'; source: 'rule' | 'ai' }
  | { status: 'ready'; suggestion: GoalSuggestion; stale: boolean }
  | { status: 'error'; message: string };

export interface SuggestionCardProps {
  state: SuggestionState;
  /** Goals already on the list (Apply then replaces them). */
  goalCount: number;
  /** The limits in effect now (the "current" side of each limit row). */
  constraints: ConstraintDraft;
  /** The person opted into longer fasts (else the fasting row says they have not). */
  fastingOptedIn: boolean;
  units: UnitSystem;
  onApply: () => void;
  onAppend: () => void;
  onClear: () => void;
  onAgain: () => void;
  onPurpose?: (purpose: SuggestPurpose) => void;
  onCandidate?: (candidate: SuggestedCandidate, amount: number) => void;
  /** Route for a missing answer's [Add] link (null: no link). */
  linkFor: (question: string) => string | null;
  onOpen: (to: string) => void;
}

const TYPE_WORD: Readonly<Record<SuggestedGoal['mode'], string>> = {
  lose: 'lose',
  keep: 'keep',
  gain: 'gain',
  raise: 'raise',
  lower: 'lower',
};

function goalTarget(g: SuggestedGoal, units: UnitSystem): string {
  const word = g.metric === 'skeletalMuscle' && g.mode === 'keep' ? 'keep and build' : TYPE_WORD[g.mode];
  if (g.target !== undefined) return `${word} ${fmtMetric(g.metric, g.target, units)}`;
  if (g.mode === 'keep') return `${word}${g.metric === 'skeletalMuscle' ? '' : ' ±0.5 kg'}`;
  return word;
}

const days = (r: readonly [number, number]) => (r[0] === r[1] ? `${r[1]} a week` : `${r[0]}–${r[1]} a week`);
const span = (a: number, b: number) => `${fmtClock(a)}–${fmtClock(b)}`;

/** Limit rows: label · current → suggested ("(from your answers)" when the suggestion keeps it). */
function limitRows(
  c: SuggestedConstraints,
  now: ConstraintDraft,
  fastingOptedIn: boolean,
): Array<{ label: string; text: string }> {
  const row = (label: string, cur: string, next: string) => ({
    label,
    text: cur === next ? `${next} (from your answers)` : `${cur} → ${next} (from your answers)`,
  });
  const out: Array<{ label: string; text: string }> = [];
  if (c.trainingDays) out.push(row('training days', days(now.trainingDays), days(c.trainingDays)));
  if (c.maxSessionMin !== undefined)
    out.push(row('longest session', `${now.maxSessionMin} min`, `${c.maxSessionMin} min`));
  if (c.trainingTimeH !== undefined)
    out.push(row('training time', fmtClock(now.trainingTimeH), fmtClock(c.trainingTimeH)));
  if (c.earliestH !== undefined && c.latestH !== undefined)
    out.push(row('eating between', span(now.earliestH, now.latestH), span(c.earliestH, c.latestH)));
  if (c.sleepFixed !== undefined)
    out.push(
      row(
        'sleep',
        now.sleepFixed ? 'kept as it is' : 'may change',
        c.sleepFixed ? 'kept as it is' : 'may move earlier',
      ),
    );
  if (c.longestFastH !== undefined)
    out.push(row('longest fast', `${now.longestFastH} h`, `${c.longestFastH} h`));
  else if (!fastingOptedIn) out.push({ label: 'fasting', text: 'no longer fasts (you haven’t opted in)' });
  return out;
}

/** The "Suggest from my answers" proposal card (planner-goals.md §12.2–§12.3). */
export function SuggestionCard(p: SuggestionCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [candidate, setCandidate] = useState<SuggestedCandidate | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const ready = p.state.status === 'ready';
  // focus moves to the card title when it opens (never to Apply)
  useEffect(() => {
    if (ready) titleRef.current?.focus({ preventScroll: false });
  }, [ready]);

  const title = (
    <span ref={titleRef} tabIndex={-1} id="lp-sg-title">
      Suggested goals
    </span>
  );

  if (p.state.status === 'loading')
    return (
      <Faceplate as="article" aria-labelledby="lp-sg-title" className="lp-sg" title={title} titleAs="h3">
        <div className="lp-sg__body" role="status">
          <ProgressRule />
          <p className="lp-sg__plain">Reading your answers…</p>
          <div className="lp-sg__actions">
            <Key size="sm" variant="quiet" onClick={p.onClear}>
              Cancel
            </Key>
          </div>
        </div>
      </Faceplate>
    );

  if (p.state.status === 'error')
    return (
      <Faceplate as="article" aria-labelledby="lp-sg-title" className="lp-sg" title={title} titleAs="h3">
        <div className="lp-sg__body">
          <p className="lp-sg__plain">{p.state.message}</p>
          <div className="lp-sg__actions">
            <Key size="sm" onClick={p.onAgain}>
              Try again
            </Key>
            <Key size="sm" variant="quiet" onClick={p.onClear}>
              Clear
            </Key>
          </div>
        </div>
      </Faceplate>
    );

  const s = p.state.suggestion;
  const empty = s.goals.length === 0;
  const limits = empty ? [] : limitRows(s.constraints, p.constraints, p.fastingOptedIn);

  return (
    <Faceplate
      as="article"
      aria-labelledby="lp-sg-title"
      className="lp-sg"
      title={title}
      titleAs="h3"
      actions={
        empty ? (
          <Key size="sm" variant="quiet" onClick={p.onClear}>
            Clear
          </Key>
        ) : undefined
      }
    >
      <div className="lp-sg__body">
        {p.state.stale ? (
          <div className="lp-sg__collapsed">
            <Chip kind="status" severity="caution">
              Your answers changed since this was suggested.
            </Chip>
            <Key size="sm" onClick={p.onAgain}>
              Suggest again
            </Key>
          </div>
        ) : null}
        {s.fallback ? <p className="lp-sg__plain">{s.fallback}</p> : null}
        {s.clarify?.length ? (
          <section className="lp-sg__section" aria-label="The Coach asks">
            <span className="lm-eng lp-sg__label">the Coach asks</span>
            <ul className="lp-sg__list">
              {s.clarify.map((q) => (
                <li key={q} className="lp-sg__plain">
                  {q}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {empty ? (
          <p className="lp-sg__plain">
            <strong>Not enough answered to suggest goals.</strong> Answer what is listed below and try again.
          </p>
        ) : (
          <section className="lp-sg__section" aria-labelledby="lp-sg-goals">
            <span className="lm-eng lp-sg__label" id="lp-sg-goals">
              ranked goals
            </span>
            <ol className="lp-sg__list">
              {s.goals.map((g) => {
                const m = goalMetric(g.metric);
                return (
                  <li key={g.metric} className="lp-sg__goal">
                    <span className="lp-sg__rank" aria-hidden="true">
                      {g.rank}
                    </span>
                    <span className="lp-sg__head">
                      {m ? (
                        <Chip kind="metric" category={m.category}>
                          {m.label}
                        </Chip>
                      ) : (
                        <span>{g.metric}</span>
                      )}
                      <span className="lp-sg__target">{goalTarget(g, p.units)}</span>
                      {/* D4-06: a suggestion is a candidate, never an adopted ranking */}
                      <Chip kind="status" severity="info">
                        Optional
                      </Chip>
                      {g.because ? (
                        <Chip kind="status" severity="info">
                          because {g.because.label} {g.because.value} {g.because.unit}
                        </Chip>
                      ) : null}
                    </span>
                    <p className="lp-sg__why">{g.why}</p>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {limits.length ? (
          <section className="lp-sg__section" aria-labelledby="lp-sg-limits">
            <span className="lm-eng lp-sg__label" id="lp-sg-limits">
              practical limits
            </span>
            {limits.map((r) => (
              <div key={r.label} className="lp-sg__row">
                <span>{r.label}</span>
                <span>{r.text}</span>
              </div>
            ))}
          </section>
        ) : null}

        {s.notes.length ? (
          <section className="lp-sg__section" aria-labelledby="lp-sg-notes">
            <span className="lm-eng lp-sg__label" id="lp-sg-notes">
              also from your answers
            </span>
            <ul className="lp-sg__list">
              {s.notes.map((n) => (
                <li key={n.text} className="lp-sg__plain">
                  {n.text}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {s.missing.length ? (
          <section className="lp-sg__section" aria-labelledby="lp-sg-missing">
            <span className="lm-eng lp-sg__label" id="lp-sg-missing">
              missing
            </span>
            <ul className="lp-sg__list">
              {s.missing.map((m) => {
                const to = p.linkFor(m.question);
                return (
                  <li key={m.field} className="lp-sg__missing">
                    <span>{m.why}</span>
                    {to ? (
                      <Key
                        size="sm"
                        variant="quiet"
                        onClick={() => p.onOpen(to)}
                        aria-label={`Add: ${m.why}`}
                      >
                        Add
                      </Key>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <Key size="sm" variant="quiet" onClick={() => setDetailsOpen(true)}>
          Suggestion details
        </Key>
        <ResponsivePanel open={detailsOpen} onClose={() => setDetailsOpen(false)} title="Suggestion details">
          <div className="lp-sg__body">
            <dl>
              <dt>Purpose</dt>
              <dd>{s.purpose ?? 'Not chosen'}</dd>
              <dt>Source</dt>
              <dd>{s.version}</dd>
            </dl>
            {s.reference ? (
              <>
                <p>BMI-linked population reference · provisional</p>
                <dl>
                  <dt>Reference band</dt>
                  <dd>{s.reference.band.map((v) => v.toFixed(1)).join('–')} %</dd>
                  <dt>Current estimate</dt>
                  <dd>{s.reference.bfPct.toFixed(1)} %</dd>
                  <dt>Likely range</dt>
                  <dd>
                    {s.reference.interval
                      ? `${s.reference.interval.map((v) => v.toFixed(1)).join('–')} %`
                      : 'Unknown'}
                  </dd>
                </dl>
                <p>
                  Gallagher 2000 links body-fat estimates to BMI. This reference does not establish an
                  individual optimum or a need to lose fat. Numeric suggestions also require a supported route
                  through the full requested horizon.
                </p>
              </>
            ) : null}
          </div>
        </ResponsivePanel>
        {s.purposeAsk?.length ? (
          <div className="lp-sg__actions" role="group" aria-label="Optional planning purpose">
            {s.purposeAsk.map((purpose) => (
              <Key key={purpose} size="sm" variant="quiet" onClick={() => p.onPurpose?.(purpose)}>
                {purpose === 'fatLoss' ? 'Fat loss' : purpose[0]!.toUpperCase() + purpose.slice(1)}
              </Key>
            ))}
          </div>
        ) : null}
        {s.candidates?.map((c) => (
          <Key
            key={c.metric}
            size="sm"
            variant="quiet"
            onClick={() => {
              setCandidate(c);
              setAmount(null);
            }}
          >
            Choose {goalMetric(c.metric)?.label ?? c.metric}: {TYPE_WORD[c.mode]}
          </Key>
        ))}
        {candidate ? (
          <div className="lp-sg__actions">
            <NumberField
              name="Optional goal target (kg)"
              value={amount}
              onChange={setAmount}
              min={goalMetric(candidate.metric)?.target?.min ?? 0.5}
              max={goalMetric(candidate.metric)?.target?.max ?? 40}
              step={goalMetric(candidate.metric)?.target?.step ?? 0.5}
              decimals={1}
              unit="kg"
            />
            <Key
              size="sm"
              variant="action"
              disabledReason={amount === null ? 'Enter a target' : undefined}
              onClick={() => {
                if (amount !== null) {
                  p.onCandidate?.(candidate, amount);
                  setCandidate(null);
                }
              }}
            >
              Add to suggestion
            </Key>
            <Key size="sm" variant="quiet" onClick={() => setCandidate(null)}>
              Cancel
            </Key>
          </div>
        ) : null}
        {!empty ? (
          <div className="lp-sg__actions">
            <Key variant="primary" onClick={p.onApply}>
              {p.goalCount > 0
                ? `Replace my ${p.goalCount === 1 ? 'goal' : `${p.goalCount} goals`}`
                : 'Apply'}
            </Key>
            {p.goalCount > 0 ? (
              <Key variant="action" onClick={p.onAppend}>
                Add only new goals
              </Key>
            ) : null}
            <Key variant="quiet" onClick={p.onClear}>
              Clear
            </Key>
          </div>
        ) : null}
      </div>
    </Faceplate>
  );
}
