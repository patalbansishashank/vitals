import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowLeftRight, Info, Link2 } from 'lucide-react';
import { Faceplate, Icon, IconKey, Key, KeyBank, KeyLink, Notice, Section, Tab, TabList, TabPanel, Tabs, cx, energyInText, formatNumber, useReducedMotion } from '@/components';
import { paths } from '@/app/paths';
import { formatValueRange } from '@/features/charts';
import { ExplainDrawer, type ExplainReading } from '@/features/evidence';
import { DISCLAIMER } from '@/features/onboarding/copy';
import { PlannerDisclaimer } from '@/features/onboarding';
import { StartPlanSheet, type StartPlanEntryProps } from '@/features/living/start/StartPlanSheet';
import { START_COPY } from '@/features/living/copy';
import { useActivePlan } from '@/features/living/mode';
import { toV1Option } from '@/engine/planner/domain/compat';
import { STOPPED_BEFORE_PLAN } from '@/engine/planner/domain/stoppedLadder';
import type { PlannerRequestV2, PlannerResult, PlannerResultV2, RungSummary } from '@/engine/planner/domain/types';
import { usePlannerStore, type ConstraintDraft } from '@/state/plannerStore';
import type { EnergyUnit, UnitSystem } from '@/state/settingsStore';
import { useEnergyUnit, useSettingsStore } from '@/state/settingsStore';
import { goalMetric } from './catalogue';
import { fmtClock, fmtMetric, fmtPct, toDisplay } from './format';
import {
  PLAN_KINDS,
  RUNG_IDS,
  RUNG_TITLE,
  SAME_AS_HARD_LINE,
  collapsedChips,
  comparisonRows,
  fmtTrainingTime,
  idealSameAsHard,
  isRung,
  outcomeView,
  planLabel,
  planOf,
  presentKinds,
  v1OptionOf,
  type LadderPlan,
  type PlanKind,
  type RungId,
  basedOnAnswersLine,
} from './ladder';
import type { PlannerModel } from './model';
import { goalText, phaseFacts, phaseKcal, phaseBalance, type PhaseFact } from './planFacts';
import { buildPrescription, downloadFile, prescriptionCsv, prescriptionText, type Prescription } from './prescription';
import { staleReason } from './request';
import { AdoptLimitsPanel } from './components/AdoptLimitsPanel';
import { DaysTab } from './components/DaysTab';
import { CollapsedChip, LadderCard, cardRows } from './components/LadderCard';
import { LadderMarkerBanner } from '@/markers/ui/ladder'; // E20: markers
import { LadderCurves } from './components/LadderCurves';
import { LadderScale } from './components/LadderScale';
import { LadderTable } from './components/LadderTable';
import { LimitCosts } from './components/LimitCosts';
import { PlanFigure } from './components/PlanFigure';
import { LimitsTab, OverviewTab, SafetyTab } from './components/ResultTabs';
import { safetyItemsOf } from './components/PlanParts';
import type { LadderSummary } from './components/PrintPrescription';
import { editGoalsLater } from './commands';

type TabId = 'overview' | 'days' | 'curves' | 'limits' | 'safety';
export type LadderView = 'cards' | 'table';

const STALE_TITLE = { body: 'Your body changed', safety: 'Your safety settings changed', goals: 'Your goals or limits changed' } as const;
const TABS: readonly TabId[] = ['overview', 'days', 'curves', 'limits', 'safety'];
const TIER_WORD = { S: 'quick', M: 'standard', L: 'thorough', X: 'exhaustive' } as const;

function safeRx(p: LadderPlan, profile: Parameters<typeof buildPrescription>[1]): Prescription | null {
  try {
    return buildPrescription(p.schedule, profile, p.simulation);
  } catch {
    return null;
  }
}

/** "hunger: high · 4 h training a week · window 8 h (12:00–20:00) · 3 meals". */
export function dayToDay(s: RungSummary, rx: Prescription | null): string {
  const parts = [s.hunger.rating === 'unknown' ? 'hunger: not modelled yet' : `hunger: ${s.hunger.rating}`];
  parts.push(s.weeklyTrainingMin > 0 ? `${fmtTrainingTime(s.weeklyTrainingMin).replace(/ a week$/, '')} training a week` : 'no training');
  const eating = rx ? rx.days.filter((d) => !d.zero && !d.fast && d.windowStartH !== null && d.windowEndH !== null) : [];
  const mid = <T,>(xs: T[], key: (x: T) => number) => (xs.length ? key([...xs].sort((a, b) => key(a) - key(b))[Math.floor(xs.length / 2)]!) : NaN);
  const winStart = mid(eating, (d) => d.windowStartH!);
  const winEnd = mid(eating, (d) => d.windowEndH!);
  if (Number.isFinite(s.meanWindowH) && s.meanWindowH > 0)
    parts.push(`window ${formatNumber(s.meanWindowH, s.meanWindowH % 1 ? 1 : 0)} h${Number.isFinite(winStart) && Number.isFinite(winEnd) ? ` (${fmtClock(winStart)}–${fmtClock(winEnd)})` : ''}`);
  const meals = mid(eating, (d) => d.meals.length);
  if (Number.isFinite(meals) && meals > 0) parts.push(`${meals} meal${meals === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** The selected plan's value of a goal metric for the Explain drawer: end (or mean) value, likely range, start and target. */
function planReading(kind: PlanKind, plan: LadderPlan, request: PlannerRequestV2, metricId: string, units: UnitSystem, energy: EnergyUnit): ExplainReading | null {
  const i = request.goals.findIndex((g) => g.metric === metricId);
  const o = plan.summary.outcomes.find((x) => x.goal === i);
  if (!o) return null;
  const g = request.goals[i];
  const change = g?.targetKind === 'change';
  const shift = change ? o.start : 0;
  const v = toDisplay(metricId, o.p50 - shift, units, energy);
  const weeks = Math.round(request.horizonDays / 7);
  const range = o.band ? formatValueRange(toDisplay(metricId, o.band.p10 - shift, units, energy).value, toDisplay(metricId, o.band.p90 - shift, units, energy).value, v.decimals) : undefined;
  const target = o.target !== null ? ` · target ${fmtMetric(metricId, o.target, units, { energy })}` : '';
  return {
    when: `${RUNG_TITLE[kind]} plan · ${g?.functional === 'mean' ? `average over ${weeks} weeks` : `end of week ${weeks}`}${change ? ' · change from the start' : ''}`,
    value: change ? fmtMetric(metricId, o.p50 - shift, units, { signed: true, unit: false, energy }) : formatNumber(v.value, v.decimals),
    unit: v.unit,
    range,
    note: `Start ${fmtMetric(metricId, o.start, units, { energy })}${target}. Open the plan in the Simulator to read any day.`,
  };
}

/** "a muscle goal is …" → "A muscle goal is ….": engine reasons are fragments. */
const sentence = (t: string) => {
  const x = t.trim();
  return x ? `${x.charAt(0).toUpperCase()}${x.slice(1)}${/[.!?]$/.test(x) ? '' : '.'}` : x;
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

/** A stopped longer search left the earlier ladder in place (`PlannerResultV2.keptAfterStop`): said, with why. */
function keptAfterStopTitle(stopped: PlannerResultV2['provenance']['tier'], shown: PlannerResultV2['provenance']['tier']): string {
  return `The ${stopped === 'X' ? 'long' : TIER_WORD[stopped]} search was stopped; showing the plans from the ${TIER_WORD[shown]} search.`;
}
const KEPT_AFTER_STOP: Record<NonNullable<PlannerResultV2['keptAfterStop']>['why'], string> = {
  noPlan: 'It had not found a plan yet.',
  fewerRungs: 'It had found fewer plans than these.',
  weakerHard: 'Its Hard plan reached less of your first goal than this one.',
  nothingNew: 'It had not found a better plan than these yet.',
};
const listAnd = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export interface ResultsViewProps {
  model: PlannerModel;
  result: PlannerResult;
  selected: PlanKind;
  view: LadderView;
  /** The `cards · table` switch below the ladder strip on phones (the context bar carries it on desktop). */
  onView?: (v: LadderView) => void;
  onFindPlans: () => void;
  onOpenInSimulator: (kind: RungId) => void;
  /** Apply limits from the Ideal on the goal screen and find plans with them. */
  onAdopt: (patch: Partial<ConstraintDraft>) => void;
  /** An exhaustive search for these goals is replacing these results (Start waits for it). */
  replacing?: boolean;
  /** "Adopt some of these limits" panel (opened from the Ideal card or the mobile action bar). */
  adoptOpen: boolean;
  onAdoptOpen: (open: boolean) => void;
}

export interface RungStartProps {
  model: PlannerModel;
  result: PlannerResult;
  v2: PlannerResultV2;
  kind: RungId;
  replacing?: boolean;
}

/** Why a plan cannot start under the current safety settings (its fasts are longer than they allow), else null. */
export function outsideSafety(p: LadderPlan, maxFastHours: number): string | null {
  const lf = p.summary.fasting.longestFastH ?? p.fasting.longestFastH ?? 0;
  return p.summary.fasting.used && Number.isFinite(maxFastHours) && lf > maxFastHours + 0.5
    ? `This plan uses fasts over ${formatNumber(Math.max(0, maxFastHours), 0)} hours, which your current safety settings don’t allow.`
    : null;
}

/** "Start this plan" for a rung (never the Ideal): the start sheet with the rung's v1 option, or the key disabled with a reason. */
export function RungStart({ model, result, v2, kind, replacing = false }: RungStartProps) {
  const p = v2.rungs[kind];
  if (!p) return null;
  const reason = outsideSafety(p, model.access.fasting.maxFastHours);
  if (reason)
    return (
      <Key variant="solid" disabledReason={reason}>
        Start this plan
      </Key>
    );
  const request = (model.run.request ?? model.request!) as PlannerRequestV2;
  const option = v1OptionOf(result, kind) ?? toV1Option(p);
  const provenance = { ...result.provenance, plannerVersion: 2 as const, holdoutGap: v2.provenance.holdoutGap, difficultyWeights: v2.provenance.difficultyWeights };
  return <SolidStartEntry option={option} request={request} provenance={provenance} name={planLabel(kind, p.summary.subtitle)} stale={model.stale || replacing} />;
}

/** The entry key and its start sheet; "Start this plan" is the only solid key in the ladder view (plan-ladder.md §4, §6.2). */
function SolidStartEntry(p: StartPlanEntryProps) {
  const [open, setOpen] = useState(false);
  const live = useActivePlan();
  return (
    <div className="lv-start-entry">
      <Key variant="solid" onClick={() => setOpen(true)} disabledReason={p.stale ? 'Find plans again first: these plans were made for different goals or limits.' : undefined}>
        {live ? START_COPY.replace : START_COPY.entry}
      </Key>
      {open ? <StartPlanSheet {...p} open onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

/** Results (design/screens/plan-ladder.md): the ladder strip, Hard · Medium · Easy ‖ Ideal cards or the table, tabs. */
export function ResultsView(props: ResultsViewProps) {
  const { result, onFindPlans } = props;
  const v2 = result.v2 ?? null;
  if (!v2) {
    return (
      <Faceplate title="These plans came from an earlier version of the Planner." className="lp-nosafe">
        <p className="lp-plain">Find plans again to see them as a ladder: Hard, Medium and Easy within your limits, and the Ideal without them.</p>
        <div className="lp-run__actions">
          <Key variant="signal" shape="pill" onClick={onFindPlans}>
            Find plans again
          </Key>
        </div>
      </Faceplate>
    );
  }
  return <Ladder {...props} v2={v2} />;
}

function Ladder({ model, result, v2, selected, view, onView, onFindPlans, onOpenInSimulator, onAdopt, replacing = false, adoptOpen, onAdoptOpen: setAdoptOpen }: ResultsViewProps & { v2: PlannerResultV2 }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const reduced = useReducedMotion();
  const request = (model.run.request ?? model.request!) as PlannerRequestV2;
  const units = model.units;
  const energy = useEnergyUnit();
  const gentle = model.access.outcome.modeName === 'gentle';
  const showFigure = useSettingsStore((s) => s.showFigure) && !gentle;
  // E19 (wired by I2): "Goals based on your answers." when the goals of this result came from goals.suggest
  const suggested = usePlannerStore((s) => s.suggested);
  const goalKeys = usePlannerStore((s) => s.goals.map((g) => g.key).join('|'));
  const answersLine = useMemo(() => basedOnAnswersLine(suggested, goalKeys ? goalKeys.split('|') : []), [suggested, goalKeys]);
  const tabParam = params.get('tab') as TabId | null;
  const tab: TabId = tabParam && TABS.includes(tabParam) ? tabParam : 'overview';
  const railRef = useRef<HTMLDivElement>(null);
  const [explain, setExplain] = useState<string | null>(null);
  const [showNumbers, setShowNumbers] = useState(false);

  const kinds = useMemo(() => presentKinds(v2), [v2]);
  const sameAsHard = useMemo(() => idealSameAsHard(v2), [v2]);
  const rx = useMemo(() => new Map(kinds.map((k) => [k, safeRx(planOf(v2, k)!, request.profile)])), [kinds, v2, request.profile]);
  const phases = useMemo(() => new Map<PlanKind, PhaseFact[]>(kinds.map((k) => [k, rx.get(k) ? phaseFacts(planOf(v2, k)!, rx.get(k)!) : []])), [kinds, v2, rx]);
  const sel: PlanKind = kinds.includes(selected) ? selected : (kinds[0] ?? 'hard');
  const plan = planOf(v2, sel);

  const setQuery = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    next.delete('plan');
    setParams(next, { replace: true });
  };
  const select = (k: PlanKind) => setQuery({ rung: k });

  // keep the selected card in view on the mobile rail (on arrival: Medium)
  useEffect(() => {
    const rail = railRef.current;
    const card = rail?.querySelector<HTMLElement>(`[data-col="${sel}"]`);
    if (!card || !rail || rail.scrollWidth <= rail.clientWidth + 4) return;
    // scroll the rail only: scrollIntoView would also scroll the page down past the header to the (tall) card
    const pad = parseFloat(getComputedStyle(rail).scrollPaddingLeft) || 0;
    const left = card.getBoundingClientRect().left - rail.getBoundingClientRect().left + rail.scrollLeft - pad;
    rail.scrollTo?.({ left, behavior: reduced ? 'auto' : 'smooth' });
  }, [sel, reduced, view]);

  const onKeyNav = (e: KeyboardEvent<HTMLElement>, k: PlanKind) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = kinds.indexOf(k);
    const next = kinds[(i + d + kinds.length) % kinds.length]!;
    select(next);
    const root = (e.currentTarget as HTMLElement).closest('.lp-ladder');
    root?.querySelector<HTMLButtonElement>(`article[data-rung="${next}"] .lp-lcard__toggle`)?.focus();
  };

  const goTab = (t: TabId, scroll = false) => {
    setQuery({ tab: t });
    if (scroll) window.setTimeout(() => document.getElementById('lp-plan-tabs')?.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }), 0);
  };

  /* ---- states without a ladder ---- */
  if (v2.status === 'blocked' || v2.status === 'invalid') {
    return (
      <Faceplate title={v2.status === 'blocked' ? 'The Planner can’t make plans for this profile.' : 'These goals can’t be planned as they are.'}>
        <p className="lp-plain">{v2.message}</p>
        {v2.status === 'blocked' ? <p className="lp-plain">The Simulator still works.</p> : null}
        <div className="lp-run__actions">
          <KeyLink to={paths.planGoals} variant="solid">
            Adjust goals
          </KeyLink>
          <KeyLink to={paths.simulate}>Open the Simulator</KeyLink>
        </div>
      </Faceplate>
    );
  }

  const weeks = Math.round(request.horizonDays / 7);
  const g1 = request.goals[0];
  const ideal = v2.ideal;
  /** The Ideal as a card of its own (not when it is Hard's own plan). */
  const idealCard = ideal && !sameAsHard ? ideal : null;
  const adoptDisabled = model.run.status === 'running' || model.run.status === 'stopping' ? 'Plans are being found' : undefined;
  const adoptPanel = ideal ? (
    <AdoptLimitsPanel
      open={adoptOpen}
      onClose={() => setAdoptOpen(false)}
      ideal={ideal}
      current={model.constraints}
      goals={request.goals}
      units={units}
      energy={energy}
      disabledReason={adoptDisabled}
      onAdopt={(patch) => {
        setAdoptOpen(false);
        onAdopt(patch);
      }}
    />
  ) : null;

  if (v2.status === 'noSafePlan' || kinds.filter(isRung).length === 0) {
    const f = result.feasibility[0];
    const need = f?.requiredWeeks ? Math.ceil(f.requiredWeeks) : null;
    const g1Name = g1 ? (goalMetric(g1.metric)?.label.toLowerCase() ?? g1.metric) : null;
    return (
      <div className="lp-results">
        <Faceplate title={!v2.complete && v2.message === STOPPED_BEFORE_PLAN ? STOPPED_BEFORE_PLAN : g1Name ? `No safe plan reaches ${g1Name} ${goalText(g1!, units)} in ${weeks} weeks within your limits.` : 'No safe plan was found within your limits.'} className="lp-nosafe">
          {f?.text ? <p className="lp-plain">{f.text}</p> : null}
          {f && f.bestAchievable !== null && Number.isFinite(f.bestAchievable) ? (
            <p className="lp-plain">
              The best safe plan reaches {fmtMetric(f.metric, f.bestAchievable, units, { energy })}
              {need ? `. About ${need} weeks would be needed.` : '.'}
            </p>
          ) : null}
          {v2.noSafePlanReasons.length ? (
            <>
              <p className="lm-eng">what blocked it</p>
              <ul className="lp-plain-list">
                {v2.noSafePlanReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          ) : null}
          {ideal ? (
            <>
              <p className="lp-plain lp-nosafe__ideal">Without your practical limits it’s reachable — here’s what blocks it:</p>
              <LimitCosts ideal={ideal} goals={request.goals} units={units} energy={energy} extras={false} />
            </>
          ) : null}
          <div className="lp-run__actions">
            {need && need <= 26 ? (
              <Key
                variant="solid"
                onClick={() => {
                  editGoalsLater([{ op: 'setHorizon', days: need * 7 }]);
                  navigate(paths.planGoals);
                }}
              >
                Extend to {need} weeks
              </Key>
            ) : null}
            {ideal ? <Key onClick={() => setAdoptOpen(true)}>Adopt some of these limits</Key> : null}
            <KeyLink to={paths.planGoals} variant="quiet">
              Adjust goals and limits
            </KeyLink>
          </div>
        </Faceplate>
        {ideal ? (
          <div className="lp-nosafe__card">
            <LadderCard
              kind="ideal"
              plan={ideal}
              v2={v2}
              request={request}
              phases={phases.get('ideal') ?? []}
              dayToDay={dayToDay(ideal.summary, rx.get('ideal') ?? null)}
              units={units}
              energy={energy}
              selected={false}
              gentle={gentle}
              showNumbers={showNumbers}
              onShowNumbers={() => setShowNumbers(true)}
              onSelect={() => undefined}
              onAdopt={() => setAdoptOpen(true)}
              standalone
            />
          </div>
        ) : null}
        {adoptPanel}
      </div>
    );
  }

  const selPlan = plan!;
  const selRx = rx.get(sel) ?? null;
  const rows = cardRows(request.goals.length);
  const maxFast = model.access.fasting.maxFastHours;
  /* ---- exports and print (named by the rung, never a letter) ---- */
  const ladderSummary: LadderSummary = (() => {
    const keep = new Set(['effort', 'time', 'hunger', 'training', 'window', 'fasting', 'buy', 'limits', 'safety']);
    const rowsAll = comparisonRows(v2, request.goals, units, { energy, gentle });
    return {
      columns: kinds.map((k) => RUNG_TITLE[k]),
      rows: rowsAll.filter((r) => keep.has(r.id) || r.id.startsWith('goal-')).map((r) => ({ label: r.label, cells: kinds.map((k) => r.cells[k] ?? '—') })),
    };
  })();
  const exportsFor = (k: PlanKind, p: LadderPlan) => {
    const r = rx.get(k) ?? null;
    const subtitle = p.summary.subtitle;
    const title = `${RUNG_TITLE[k]} plan`;
    const file = `vitals-plan-${k}-${slug(subtitle)}`;
    return {
      csv: () => r && downloadFile(`${file}.csv`, prescriptionCsv(r, planLabel(k, subtitle), energy), 'text/csv;charset=utf-8'),
      text: () =>
        r &&
        downloadFile(
          `${file}.txt`,
          prescriptionText(r, {
            planTitle: title,
            planName: subtitle,
            scorecard: request.goals.map((g, i) => {
              const o = p.summary.outcomes.find((x) => x.goal === i);
              if (!o) return `${i + 1}. ${goalMetric(g.metric)?.label ?? g.metric}`;
              const v = outcomeView(o, g, k, units, { energy });
              return `${i + 1}. ${goalMetric(g.metric)?.label ?? g.metric} ${goalText(g, units)}: ${v.value}${v.range ? ` (${v.range})` : ''} · ${v.verdict}`;
            }),
            phases: (phases.get(k) ?? []).map((ph) => {
              const pct = ph.enginePct !== null ? `${fmtPct(ph.enginePct)}${ph.enginePctOtherDays ? ' on the other days' : ''} of maintenance at this plan’s activity` : null;
              const kcal = phaseKcal(ph, energy);
              const head = [energyInText(ph.name, energy), phaseBalance(ph), pct].filter(Boolean).join(' · ');
              return `weeks ${Math.floor(ph.startDay / 7) + 1}–${Math.ceil(ph.endDay / 7)}: ${head}${kcal ? ` (${kcal} a day)` : ''}${ph.summary ? ` · ${energyInText(ph.summary, energy)}` : ''}`;
            }),
            safety: safetyItemsOf({ safetyItems: p.safetyItems ?? p.summary.safetyItems, safetyNotes: p.safetyNotes }).map((it) => (it.severity === 'info' ? it.text : `${it.severity}: ${it.text}`)),
            disclaimer: `${DISCLAIMER.plannerCard} ${DISCLAIMER.resultsLine}`,
            energy,
          }),
          'text/plain;charset=utf-8',
        ),
      json: () =>
        downloadFile(
          `${file}.json`,
          JSON.stringify(
            {
              vitals: 'plan',
              exportedAt: new Date().toISOString(),
              plan: {
                rung: k,
                title,
                subtitle,
                schedule: p.schedule,
                outcomes: p.summary.outcomes,
                effort: p.summary.difficulty,
                phases: p.phases,
                hunger: p.hunger,
                fasting: p.summary.fasting,
                limitsItPresses: p.summary.bindingLimits,
                equipment: p.summary.equipment,
                safetyItems: p.safetyItems ?? p.summary.safetyItems,
                explanation: p.explanation,
                ...(k === 'ideal' && ideal ? { limitCosts: ideal.limitCosts.map(({ euSpent: _e, ...c }) => c), relaxed: ideal.relaxed, advised: ideal.advised } : {}),
              },
              goals: request.goals,
              horizonDays: request.horizonDays,
              startDate: request.startDate,
              constraints: request.constraints,
              strictness: request.strictness,
              feasibility: v2.feasibility,
              relations: v2.relations,
              search: {
                kind: TIER_WORD[v2.provenance.tier],
                evaluations: v2.provenance.euUsed,
                seed: v2.provenance.seed,
                engineVersion: v2.provenance.engineVersion,
                registryHash: v2.provenance.registryHash,
                libraryVersion: v2.provenance.libraryVersion,
                plannerVersion: v2.provenance.plannerVersion,
              },
              complete: v2.complete,
            },
            null,
            2,
          ),
          'application/json',
        ),
    };
  };
  const ex = exportsFor(sel, selPlan);
  const ready = RUNG_IDS.filter((k) => v2.rungs[k]).map((k) => RUNG_TITLE[k]);
  const hasIdeal = !!idealCard;
  const chips = collapsedChips(v2);
  // the grid holds only the cards that exist: n columns (rungs ‖ Ideal), no slot for a collapsed rung
  const inside = kinds.filter(isRung).length;
  const gridStyle = { '--lp-rows': rows.length, '--lp-rows2': rows.length * 2, '--lp-row2': rows.length + 1, '--lp-inside': inside } as CSSProperties;

  const card = (k: PlanKind, pos: number) => {
    const p = planOf(v2, k);
    if (!p) return null;
    return (
      <div key={k} className="lp-ladder__col lp-ladder__col--card" data-col={k} data-pos={pos} data-x={pos % 2} data-y={Math.floor(pos / 2)}>
        <LadderCard
          kind={k}
          plan={p}
          v2={v2}
          request={request}
          phases={phases.get(k) ?? []}
          dayToDay={dayToDay(p.summary, rx.get(k) ?? null)}
          units={units}
          energy={energy}
          selected={k === sel}
          gentle={gentle}
          showNumbers={showNumbers}
          onShowNumbers={() => setShowNumbers(true)}
          sameAsIdeal={k === 'hard' ? sameAsHard : null}
          onExplain={(metric) => {
            select(k);
            setExplain(metric);
          }}
          onSelect={() => select(k)}
          onKeyNav={(e) => onKeyNav(e, k)}
          onSafety={() => {
            select(k);
            goTab('safety', true);
          }}
          onOpenInSimulator={isRung(k) && !replacing ? () => onOpenInSimulator(k) : undefined}
          onAdopt={k === 'ideal' ? () => setAdoptOpen(true) : undefined}
          start={isRung(k) && k === sel ? <RungStart model={model} result={result} v2={v2} kind={k} replacing={replacing} /> : undefined}
          outsideSafety={outsideSafety(p, maxFast)}
        />
      </div>
    );
  };

  return (
    <div className={cx('lp-results', 'lp-results--ladder', model.stale && 'is-stale')}>
      {model.stale ? (
        <Notice
          severity="info"
          layout="ruled"
          className="lp-notice"
          title={`${STALE_TITLE[staleReason(model.run.request, model.request)]} since these plans were found · Find plans again`}
          actions={
            <Key size="sm" onClick={onFindPlans}>
              Find plans again
            </Key>
          }
        >
          Goals, limits, your body or safety settings differ from the ones these plans were made for.
        </Notice>
      ) : null}
      {!v2.complete ? (
        <Notice severity="info" layout="ruled" className="lp-notice" title={`Stopped at ${Math.round((model.run.progress?.fraction ?? 0) * 100)} %.`}>
          {`${listAnd(ready)} ${ready.length === 1 ? 'is' : 'are'} ready; range checks were skipped, so ranges may be too narrow.`}
          {hasIdeal ? ' Some limit costs weren’t checked.' : ''}
          {v2.idealSkipped === 'stopped' ? ' The Ideal (your plan without the practical limits) wasn’t searched.' : ''}
        </Notice>
      ) : null}
      {v2.keptAfterStop ? (
        <Notice severity="info" layout="ruled" className="lp-notice lp-notice--kept" title={keptAfterStopTitle(v2.keptAfterStop.tier, v2.provenance.tier)}>
          {KEPT_AFTER_STOP[v2.keptAfterStop.why]}
        </Notice>
      ) : null}
      {v2.stubModules.length ? (
        <Notice severity="info" layout="ruled" className="lp-notice" title="Some physiology is still being built.">
          These parts of the model are placeholders, so their curves and anything that depends on them are not meaningful yet: {v2.stubModules.join(', ')}.
        </Notice>
      ) : null}

      <Faceplate title="The ladder" className="lp-ladder-face">
        {answersLine ? <p className="lp-plain lp-ladder__answers">{answersLine}</p> : null}
        <LadderScale v2={v2} goal1={g1} units={units} energy={energy} selected={sel} onSelect={select} hideValues={gentle && !showNumbers && !!g1 && /fatMass|scaleWeight|bodyFatPct|waist|visceralFat/.test(g1.metric)} />
        {chips.length ? (
          <ul className="lp-lchips" aria-label="Plans the ladder did not keep">
            {chips.map((c) => (
              <CollapsedChip key={c.kind} kind={c.kind} title={c.title} text={c.text} />
            ))}
          </ul>
        ) : null}
      </Faceplate>
      {/* E20: markers — active blood-marker notes, above the cards */}
      <LadderMarkerBanner request={request} />
      {onView ? (
        <div className="lp-viewswitch lg:hidden">
          <KeyBank<LadderView>
            size="sm"
            label="Show the plans as"
            value={view}
            onChange={onView}
            options={[
              { value: 'cards', label: 'cards' },
              { value: 'table', label: 'table' },
            ]}
          />
        </div>
      ) : null}

      {view === 'table' ? (
        <>
          {sameAsHard ? <p className="lp-plain lp-ltable__same">{SAME_AS_HARD_LINE}</p> : null}
          <LadderTable v2={v2} goals={request.goals} units={units} energy={energy} selected={sel} onSelect={select} gentle={gentle && !showNumbers} />
        </>
      ) : (
        <div className="lp-ladder-wrap">
          <div ref={railRef} className="lp-ladder" data-ideal={hasIdeal || undefined} data-n={kinds.length} data-inside={inside} style={gridStyle} role="group" aria-label="Plans">
            {kinds.filter(isRung).map((k, i) => card(k, i))}
            {hasIdeal ? (
              <div className="lp-ladder__rule" aria-hidden="true">
                <span>beyond your limits</span>
              </div>
            ) : null}
            {hasIdeal ? card('ideal', inside) : null}
          </div>
          {kinds.length > 1 ? (
            <div className="lm-sr">
              <button type="button" onClick={() => select(kinds[(kinds.indexOf(sel) - 1 + kinds.length) % kinds.length]!)}>
                Previous plan
              </button>
              <button type="button" onClick={() => select(kinds[(kinds.indexOf(sel) + 1) % kinds.length]!)}>
                Next plan
              </button>
            </div>
          ) : null}
          {kinds.length > 1 ? (
            <div className="lp-dots" role="group" aria-label="Plan position">
              {kinds.map((k, i) => (
                <button
                  key={k}
                  type="button"
                  className="lp-dot"
                  data-gap={k === 'ideal' || undefined}
                  data-on={k === sel || undefined}
                  aria-label={`Plan ${i + 1} of ${kinds.length}: ${RUNG_TITLE[k]}`}
                  aria-current={k === sel ? 'true' : undefined}
                  onClick={() => select(k)}
                />
              ))}
            </div>
          ) : null}
        </div>
      )}
      <PlannerDisclaimer className="lp-cards__disclaimer" />

      {v2.relations.length || v2.fasting.reason ? (
        <Section label="Between your goals" className="lp-between">
          {v2.fasting.reason ? (
            <p className="lp-why-face__fasting">
              <span className="lm-eng">fasting</span> <span>{sentence(v2.fasting.reason)}</span>
            </p>
          ) : null}
          {v2.relations.length ? (
            <ul className="lp-relations">
              {v2.relations.map((t, i) => {
                const conflict = /conflict|pull|against|trade/i.test(t);
                return (
                  <li key={i}>
                    <Icon icon={conflict ? ArrowLeftRight : Link2} size={16} />
                    <span>
                      <strong>{conflict ? 'Conflict' : 'Synergy'}:</strong> {t}
                    </span>
                    {g1 ? <IconKey icon={Info} size="sm" variant="quiet" label="Why: open the evidence" onClick={() => setExplain(g1.metric)} /> : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </Section>
      ) : null}

      <div id="lp-plan-tabs" className="lp-tabs">
        <Tabs value={tab} onChange={(v) => goTab(v as TabId)}>
          <div className="lp-tabs__bar">
            <TabList label={`${RUNG_TITLE[sel]} plan details`} size="md">
              <Tab value="overview">overview</Tab>
              <Tab value="days">days</Tab>
              <Tab value="curves">curves</Tab>
              <Tab value="limits">limits</Tab>
              <Tab value="safety" badge={safetyItemsOf({ safetyItems: selPlan.safetyItems ?? selPlan.summary.safetyItems, safetyNotes: selPlan.safetyNotes }).some((it) => it.severity !== 'info')}>
                safety
              </Tab>
            </TabList>
            <span className="lm-eng lp-tabs__for">
              for {RUNG_TITLE[sel]} · {selPlan.summary.subtitle}
            </span>
          </div>
          <TabPanel value="overview" className="lp-tabpanel">
            <OverviewTab
              kind={sel}
              plan={selPlan}
              v2={v2}
              request={request}
              phases={phases.get(sel) ?? []}
              rx={selRx}
              feasibility={v2.feasibility}
              units={units}
              onWhy={setExplain}
              relations={v2.relations}
              gentle={gentle}
              figure={showFigure && model.body.complete && sel !== 'ideal' ? <PlanFigure start={model.body.estimate} sim={selPlan.simulation} planTitle={RUNG_TITLE[sel]} size="sm" /> : undefined}
            />
          </TabPanel>
          <TabPanel value="days" className="lp-tabpanel">
            {selRx ? (
              <DaysTab
                key={sel}
                planTitle={`${RUNG_TITLE[sel]} plan`}
                rx={selRx}
                sessions={selPlan.sessions}
                ladderSummary={ladderSummary}
                onCsv={ex.csv}
                onText={ex.text}
                onJson={ex.json}
                planName={selPlan.summary.subtitle}
                disclaimer={`${DISCLAIMER.plannerCard} ${DISCLAIMER.resultsLine}`}
              />
            ) : (
              <p className="lp-plain">This plan’s schedule could not be compiled for the day-by-day view. Open it in the Simulator to see every day.</p>
            )}
          </TabPanel>
          <TabPanel value="curves" className="lp-tabpanel">
            {tab === 'curves' ? <LadderCurves v2={v2} request={request} units={units} energy={energy} selected={sel} gentle={gentle} showNumbers={showNumbers} /> : null}
          </TabPanel>
          <TabPanel value="limits" className="lp-tabpanel">
            <LimitsTab kind={sel} plan={selPlan} v2={v2} request={request} units={units} />
          </TabPanel>
          <TabPanel value="safety" className="lp-tabpanel">
            <SafetyTab kind={sel} plan={selPlan} request={request} locks={model.access.plannerLocks} />
          </TabPanel>
        </Tabs>
      </div>

      <ExplainDrawer
        open={explain !== null}
        onClose={() => setExplain(null)}
        metricId={explain ?? undefined}
        reading={explain ? planReading(sel, selPlan, request, explain, units, energy) : null}
        returnTo={{ to: `${paths.planResults}?${params.toString()}`, label: 'Planner results' }}
      />
      {adoptPanel}
    </div>
  );
}

/** For the page header: the lowest evidence grade among the plans' goal outcomes. */
export function lowestGrade(v2: PlannerResultV2 | null): 'A' | 'B' | 'C' | 'D' | null {
  if (!v2) return null;
  const rank = { A: 0, B: 1, C: 2, D: 3 } as const;
  let low: 'A' | 'B' | 'C' | 'D' | null = null;
  for (const k of PLAN_KINDS) for (const o of planOf(v2, k)?.summary.outcomes ?? []) if (low === null || rank[o.grade] > rank[low]) low = o.grade;
  return low;
}
