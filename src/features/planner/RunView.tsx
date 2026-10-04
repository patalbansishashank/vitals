import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, RotateCcw } from 'lucide-react';
import { Faceplate, Key, KeyLink, Notice, ProgressRule, Swatch, formatNumber, toast, useReducedMotion } from '@/components';
import { paths } from '@/app/paths';
import type { ConvergencePoint, PlanKind } from '@/engine/planner/domain/types';
import type { PlannerRunState } from '@/state/plannerStore';
import { goalMetric } from './catalogue';
import { fmtPct, fmtWeeks } from './format';
import { PLAN_KINDS, RUNG_TITLE } from './ladder';
import type { PlannerModel } from './model';
import { cancelPlannerRun, continueSearch, plateauOf, stopPlannerRun, useLadderRun } from './run';
import { LadderConvergence } from './components/LadderConvergence';
import { RungKey } from './components/RungKey';

/** Stage ranks: the v0.1 search (S0-S6) and the ladder search (P0-P8 or named stages) read on one scale. */
function stageRank(stage: string): number {
  const s = stage.toLowerCase();
  if (/^(s0|p0|calib|setup|baseline|probe)/.test(s)) return 0;
  if (/^(s1|p1|seed)/.test(s)) return 1;
  if (/^(s2|p2|race)/.test(s)) return 2;
  if (/^(s3|p3|stage)/.test(s)) return 3;
  if (/^(s4|p4|p5|qd|ladder|rung)/.test(s)) return 4;
  if (/^(p6|ideal|limit)/.test(s)) return 5;
  if (/^(s5|p7|robust|holdout)/.test(s)) return 6;
  if (/^(s6|p8|verify|explain|ttt|rival|compose|shop)/.test(s)) return 7;
  return -1;
}

/** Plain names for optimiser stages (planner-goals.md §6 stage line); never the internal stage code. */
export function stageLabel(stage: string, goalCount: number): string {
  if (stage === 'S2') return 'checking what’s possible';
  if (stage === 'S4') return 'finding different options';
  if (stage === 'ttt') return 'working out how long each target needs';
  const r = stageRank(stage);
  if (r === 3) {
    const k = Number(stage.split('.')[1] ?? '1');
    return goalCount > 1 && Number.isFinite(k) ? `honouring goal ${k}` : 'honouring your goal';
  }
  return ['checking where you start', 'trying building blocks', 'racing plan structures', '', 'building the ladder', 'pricing your limits', 'testing against uncertainty', 'explaining the trade-offs'][r] || 'searching';
}

const STAGE_LIST = [2, 3, 4, 5, 6] as const;
const STAGE_NAME: Record<(typeof STAGE_LIST)[number], string> = { 2: 'racing plan structures', 3: 'honouring goals in order', 4: 'building the ladder', 5: 'pricing your limits', 6: 'testing against uncertainty' };

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Seconds since the run started, ticking 5× a second while it runs. */
export function useElapsed(run: PlannerRunState): number {
  const active = run.status === 'running' || run.status === 'stopping';
  const [now, setNow] = useState(clock);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(clock()), 200);
    return () => window.clearInterval(id);
  }, [active]);
  if (run.startedAt === null) return 0;
  const end = active ? now : (run.endedAt ?? run.startedAt);
  return Math.max(0, (end - run.startedAt) / 1000);
}

/** "about 9 min left" from the time spent and the share done (null until the estimate is meaningful). */
export function timeLeft(elapsedS: number, fraction: number): string | null {
  if (!(fraction > 0.02) || fraction >= 1 || elapsedS < 5) return null;
  const left = (elapsedS * (1 - fraction)) / fraction;
  if (left < 60) return 'under a minute left';
  const min = Math.round(left / 60);
  return min >= 90 ? `about ${formatNumber(left / 3600, 1)} h left` : `about ${min} min left`;
}

/** The plateau prompt of an exhaustive search: two rounds without a better plan → Continue or Stop here. */
export function usePlateau(): boolean {
  const { convergence, tier, plateauSeenAt } = useLadderRun();
  const p = plateauOf(convergence);
  return tier === 'X' && p.plateau && p.rounds >= plateauSeenAt;
}

export function PlateauPrompt() {
  return (
    <Notice
      severity="info"
      layout="ruled"
      title="The last two rounds found nothing better."
      actions={
        <span className="lp-run__actions">
          <Key size="sm" onClick={continueSearch}>
            Continue
          </Key>
          <Key size="sm" variant="quiet" onClick={stopPlannerRun}>
            Stop here
          </Key>
        </span>
      }
    >
      Continuing may still find a better plan, more slowly. Stopping keeps the plans found so far.
    </Notice>
  );
}

/** Context-bar chip while an exhaustive search runs in the background (plan-ladder.md §8). */
export function ExhaustiveChip({ run }: { run: PlannerRunState }) {
  const tier = useLadderRun((s) => s.tier);
  const elapsed = useElapsed(run);
  const plateau = usePlateau();
  const running = run.status === 'running' || run.status === 'stopping';
  if (!running || tier !== 'X') return null;
  const f = run.progress?.fraction ?? 0;
  const left = timeLeft(elapsed, f);
  return (
    <span className="lp-xchip">
      <KeyLink to={paths.planRun} size="sm" variant="quiet" className="lp-xchip__link">
        {`exhaustive search · ${Math.round(f * 100)} %${left ? ` · ${left}` : ''}`}
      </KeyLink>
      {plateau ? (
        <>
          <Key size="sm" onClick={continueSearch}>
            Continue
          </Key>
          <Key size="sm" variant="quiet" onClick={stopPlannerRun}>
            Stop here
          </Key>
        </>
      ) : null}
    </span>
  );
}

export interface RunViewProps {
  model: PlannerModel;
  onRetry: () => void;
}

type Slot = { title: string; D: number | null; pct: number | null };

/** Running state (plan-ladder.md §8 "Running"; COMPONENTS §8 OptimiserProgress with four slots). */
export function RunView({ model, onRetry }: RunViewProps) {
  const { run } = model;
  const reduced = useReducedMotion();
  const elapsed = useElapsed(run);
  const ladder = useLadderRun();
  const goals = run.request?.goals ?? [];
  const days = run.request?.horizonDays ?? model.horizonDays;
  const p = run.progress;
  const stage = p?.stage ?? 'S0';
  const exhaustive = ladder.tier === 'X';
  const plateau = usePlateau();

  // provisional rungs as found (the ladder search), else the v0.1 slots in rung order
  const slots: Partial<Record<PlanKind, Slot>> = useMemo(() => {
    const out: Partial<Record<PlanKind, Slot>> = {};
    for (const [k, v] of Object.entries(ladder.provisional)) if (v) out[k as PlanKind] = { title: v.title, D: v.D, pct: v.percentOfAchievable[0] ?? null };
    if (!Object.keys(out).length)
      (['hard', 'medium', 'easy'] as const).forEach((k, i) => {
        const f = run.found[i];
        if (f) out[k] = { title: f.name, D: null, pct: f.percentOfAchievable[0] ?? null };
      });
    return out;
  }, [ladder.provisional, run.found]);
  const anyFound = Object.keys(slots).length > 0;

  // convergence: the ladder search's points, else the engine's score per progress tick
  const points: ConvergencePoint[] = useMemo(() => {
    if (ladder.convergence.length >= 2) return ladder.convergence;
    return run.traces.best.map((G, i) => ({ eu: i, wallMs: 0, stage: '', keyHard: [], G, hvLadder: Number.NaN }));
  }, [ladder.convergence, run.traces.best]);

  // polite announcements at stage changes only (not every tick)
  const [announce, setAnnounce] = useState('');
  const lastStage = useRef('');
  useEffect(() => {
    if (!p || p.stage === lastStage.current) return;
    lastStage.current = p.stage;
    setAnnounce(`Finding plans: ${stageLabel(p.stage, goals.length)}.`);
  }, [p, goals.length]);

  if (run.status === 'failed') {
    return (
      <div className="lp-run">
        <Faceplate title="The Planner stopped unexpectedly." className="lp-run__face">
          <p className="lp-run__lead">Your goals are saved. This is a problem on our side, not with your goals.</p>
          <div className="lp-run__actions">
            <Key variant="solid" icon={RotateCcw} onClick={onRetry}>
              Try again
            </Key>
            <Key
              icon={Copy}
              onClick={() => {
                void navigator.clipboard?.writeText(`Vitals Planner error\n${run.error ?? ''}\nrequest ${run.requestHash ?? ''}`).then(
                  () => toast('Details copied'),
                  () => toast('Could not copy the details'),
                );
              }}
            >
              Copy details
            </Key>
            <KeyLink to={paths.planGoals} variant="quiet">
              Back to goals
            </KeyLink>
          </div>
        </Faceplate>
      </div>
    );
  }
  if (run.status === 'cancelled') {
    return (
      <div className="lp-run">
        <Faceplate title="Stopped before a plan was found." className="lp-run__face">
          <p className="lp-run__lead">Nothing was kept. Your goals and limits are unchanged.</p>
          <div className="lp-run__actions">
            <Key variant="solid" icon={RotateCcw} onClick={onRetry}>
              Find plans again
            </Key>
            <KeyLink to={paths.planGoals} variant="quiet">
              Back to goals
            </KeyLink>
          </div>
        </Faceplate>
      </div>
    );
  }

  const fraction = p?.fraction ?? 0;
  const left = timeLeft(elapsed, fraction);
  const rank = stageRank(stage);
  const lateStage = rank >= 6;
  const slowNote = !exhaustive && elapsed > 40 && !!slots.hard && !lateStage;
  const slot = (k: PlanKind) => {
    const f = slots[k];
    const status = f ? (lateStage && k !== 'ideal' ? 'ready' : 'provisional') : k === 'hard' ? 'searching' : k === 'ideal' ? 'fills last' : 'comes later';
    return (
      <li key={k} className="lp-slot" data-rung={k} data-filled={f ? true : undefined}>
        <RungKey kind={k} size="sm" pressed={!!f} />
        <span className="lp-slot__text">
          <span className="lp-slot__name">{RUNG_TITLE[k]}</span>
          <span className="lp-slot__status">{status}</span>
          {f ? (
            <span className="lp-slot__plan" title={f.title}>
              {f.title && f.title !== RUNG_TITLE[k] ? `${f.title} · ` : ''}
              {f.D !== null && Number.isFinite(f.D) ? <span className="lm-num">effort {Math.round(f.D * 100)}</span> : null}
              {f.pct !== null && Number.isFinite(f.pct) ? <span className="lp-slot__pct lm-num">{f.D !== null ? ' · ' : ''}goal 1 at {fmtPct(f.pct)}</span> : null}
            </span>
          ) : null}
        </span>
      </li>
    );
  };

  return (
    <div className="lp-run">
      <Faceplate
        className="lp-run__face"
        title={run.status === 'stopping' ? 'Stopping…' : exhaustive ? 'Finding the best possible plan…' : 'Finding plans…'}
        caption={`${goals.length} goal${goals.length === 1 ? '' : 's'} · ${fmtWeeks(days)} · ${exhaustive ? `exhaustive search${left ? ` · ${left}` : ''}` : 'usually under a minute on this device'}`}
      >
        <ProgressRule value={fraction} label="Optimiser progress" reducedText={`${Math.round(fraction * 100)} % · ${formatNumber(elapsed, 1)} s`} />
        <div role="status" className="lm-sr">
          {announce}
        </div>
        <ol className="lp-slots" aria-label="Plan slots" data-named={anyFound || undefined}>
          {PLAN_KINDS.map(slot)}
        </ol>
        {points.length >= 2 ? (
          <div className="lp-run__chart">
            <LadderConvergence points={points} />
          </div>
        ) : (
          <div className="lp-run__chart lp-run__chart--empty" aria-hidden="true">
            <span className="lm-eng">the first plan appears after goal 1 is settled</span>
          </div>
        )}
        {plateau ? <PlateauPrompt /> : null}
        <dl className="lp-counters">
          <div>
            <dt className="lm-eng">evaluations</dt>
            <dd className="lm-num">
              {formatNumber(p?.euUsed ?? 0, 0)}
              <span className="lm-unit">/ {formatNumber(p?.euBudget ?? 0, 0)}</span>
            </dd>
          </div>
          {typeof p?.score === 'number' && Number.isFinite(p.score) ? (
            <div>
              <dt className="lm-eng">best score</dt>
              <dd className="lm-num">{formatNumber(p.score, 2)}</dd>
            </div>
          ) : null}
          <div>
            <dt className="lm-eng">progress</dt>
            <dd className="lm-num">
              {Math.round(fraction * 100)}
              <span className="lm-unit">%</span>
            </dd>
          </div>
          <div>
            <dt className="lm-eng">elapsed</dt>
            <dd className="lm-num">
              {elapsed >= 120 ? formatNumber(elapsed / 60, 0) : formatNumber(elapsed, 1)}
              <span className="lm-unit">{elapsed >= 120 ? 'min' : 's'}</span>
            </dd>
          </div>
        </dl>
        <ol className="lp-stages" aria-label="Stages">
          {STAGE_LIST.map((r) => {
            const state = rank > r ? 'done' : rank === r ? 'now' : 'next';
            return (
              <li key={r} data-state={state}>
                {r === 3 && rank === 3 ? stageLabel(stage, goals.length) : STAGE_NAME[r]}
              </li>
            );
          })}
        </ol>
        {slowNote ? (
          <Notice severity="info" layout="ruled" title="Taking longer than usual.">
            Hard is ready now; the other plans are still being found. You can stop and keep what’s found.
          </Notice>
        ) : null}
        <div className="lp-run__actions">
          {anyFound ? (
            <Key onClick={stopPlannerRun} disabled={run.status === 'stopping'} loading={run.status === 'stopping'}>
              Stop and keep what’s found
            </Key>
          ) : (
            <Key variant="quiet" onClick={cancelPlannerRun}>
              Cancel
            </Key>
          )}
          {reduced ? null : <span className="lm-eng lp-run__hint">you can leave this screen; a note appears when the plans are ready</span>}
        </div>
      </Faceplate>
      <aside className="lp-run__goals" aria-label="Goals being planned">
        <p className="lm-eng">your goals, in order</p>
        <ol>
          {goals.map((g, i) => {
            const m = goalMetric(g.metric);
            return (
              <li key={g.metric}>
                <span className="lm-num lp-run__rank">{i + 1}</span>
                {m ? <Swatch category={m.category} /> : null}
                <span>{m?.label ?? g.metric}</span>
              </li>
            );
          })}
        </ol>
      </aside>
    </div>
  );
}
