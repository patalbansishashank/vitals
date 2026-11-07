import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Plus } from 'lucide-react';
import { aiPorts, dispatch, dispatchSync } from '@/commands';
import { sendCommand } from '@/features/lib/sendCommand';
import { useIntakeDoc } from '@/features/intake/doc';
import { intakePath } from '@/features/intake/paths';
import { Chip, Faceplate, Icon, Key, KeyBank, Swatch, toast } from '@/components';
import { paths } from '@/app/paths';
import { ExplainDrawer } from '@/features/evidence';
import { FastingTierControls } from '@/features/onboarding';
import type { MetricId } from '@/engine/types/metrics';
import type { GoalSuggestion, SuggestPurpose } from '@/engine/planner/domain/suggestGoals';
import type { Strictness } from '@/engine/planner/domain/types';
import { MAX_PLANNER_GOALS, usePlannerStore, type GoalMode } from '@/state/plannerStore';
import { SUGGESTED_GOALS, goalMetric, modeSpec, newGoal, type GoalMetric } from './catalogue';
import type { PlannerModel } from './model';
import type { HintAction } from './preflight';
import { connectorsByRow, goalRelations } from './relations';
import { goalDomainIssue } from './request';
import { GoalPicker } from './components/GoalPicker';
import { GoalRankList } from './components/GoalRankList';
import { HorizonPicker } from './components/HorizonPicker';
import { LimitsPanel } from './components/LimitsPanel';
import { PreflightList } from './components/PreflightList';
import { PlannerSafetyPanel } from './components/SafetyPanel';
import { editGoals, editGoalsLater } from './commands';
import { SuggestionCard, type SuggestionState } from './components/SuggestionCard';
import { isUntouchedSuggestion, suggestionOps, suggestionWhy, type ApplyMode } from './suggestApply';
import { answersFingerprint, setSuggestContext } from './suggestInput';

const WEIGHT_GOALS = new Set(['fatMass', 'scaleWeight', 'bodyFatPct', 'waist']);

/** Starter chips under the header's Add a goal while there are no goals: one key plus three chips keeps first use to four choices. */
export const STARTER_GOAL_LIMIT = 3;

/**
 * The starter goals the empty Goals card offers: the catalogue's starters in order, skipping any the person's safety
 * answers rule out (no weight-loss goal) so every chip adds a usable goal, capped at {@link STARTER_GOAL_LIMIT}.
 * Every other outcome stays in the Add a goal picker.
 */
export function starterGoals(noWeightLoss: boolean): Array<{ metric: GoalMetric; mode: GoalMode }> {
  const out: Array<{ metric: GoalMetric; mode: GoalMode }> = [];
  for (const s of SUGGESTED_GOALS) {
    if (out.length >= STARTER_GOAL_LIMIT) break;
    const metric = goalMetric(s.metric);
    if (!metric?.eligible) continue;
    if (noWeightLoss && WEIGHT_GOALS.has(s.metric) && (s.mode === 'lose' || s.mode === 'lower')) continue;
    out.push({ metric, mode: s.mode });
  }
  return out;
}

type GoalOps = Parameters<typeof editGoalsLater>[0];

/**
 * The goal edit a "Before you run" action makes (null: the action only points at the limits). Extending the horizon,
 * allowing 24-hour fasts and raising the longest fast to the opted-in tier's maximum are each one undoable edit.
 */
export function hintOps(a: HintAction): GoalOps | null {
  if (a.kind === 'extend') return [{ op: 'setHorizon', days: a.weeks * 7 }];
  if (a.kind === 'allow-fast') return [{ op: 'setLimits', patch: { longestFastH: 24 } }];
  if (a.kind === 'set-longest-fast') return [{ op: 'setLimits', patch: { longestFastH: a.hours } }];
  return null;
}

/** Add a goal by metric id with the design's messages (shared by the picker, suggestions and `?add=`). */
export function addGoalByMetric(
  id: string,
  mode?: Parameters<typeof newGoal>[1],
): 'added' | 'full' | 'duplicate' | 'ineligible' {
  const m = goalMetric(id);
  if (!m || !m.eligible) return 'ineligible';
  return (
    (editGoals([{ op: 'add', goal: newGoal(m, mode) }])[0] as 'added' | 'full' | 'duplicate' | undefined) ??
    'full'
  );
}

function reportAdd(outcome: ReturnType<typeof addGoalByMetric>, id: string) {
  const m = goalMetric(id);
  if (outcome === 'full') toast('Up to six goals. Remove one to add another.', { id: 'planner-goal-full' });
  else if (outcome === 'duplicate')
    toast(`${m?.label ?? id} is already one of your goals.`, { id: 'planner-goal-dup' });
  else if (outcome === 'ineligible')
    toast(m ? `${m.label} can’t be a goal. ${m.reason ?? ''}` : 'That outcome isn’t in the catalogue.', {
      id: 'planner-goal-no',
    });
}

/** Where a missing answer is given (the suggestion card's [Add] links). */
export function missingLink(question: string): string | null {
  const [area, q] = question.split('.');
  if (area === 'body') return q === 'waist' ? `${paths.body}#shape` : paths.body;
  if (area === 'activity') return intakePath('activity', { from: 'body' });
  if (area === 'training') return intakePath('training', { from: 'body' });
  if (area === 'food') return intakePath('diet', { from: 'body' });
  if (area === 'markers') return intakePath('markers', { from: 'body' });
  return null;
}

/** C6/D7-02 status chips of a goal whose forecast is unsupported by an out-of-domain measured lab value. */
export const UNSUPPORTED_OWN = 'Unsupported · measured value outside the model’s range';
export const UNSUPPORTED_DEPENDENCY = 'Unsupported · forecast from a value outside the model’s range';

export interface GoalsViewProps {
  model: PlannerModel;
  onFindPlans: () => void;
}

/** Goals & constraints (design/screens/planner-goals.md). */
export function GoalsView({ model }: GoalsViewProps) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [explain, setExplain] = useState<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const limitsRef = useRef<HTMLDivElement>(null);
  const { goals, constraints, access, body } = model;
  const full = goals.length >= MAX_PLANNER_GOALS;

  /* ---- "Suggest from my answers" (planner-goals.md §12): the first row of the Add-a-goal picker; a proposal only ---- */
  const suggestedRecord = usePlannerStore((s) => s.suggested);
  const [purpose, setPurpose] = useState<SuggestPurpose | undefined>(
    () => suggestedRecord?.suggestion.purpose,
  );
  const [sg, setSg] = useState<SuggestionState | null>(null);
  const [applied, setApplied] = useState<{ changeSetId: string | null } | null>(null);
  const sgRun = useRef(0);
  const sgPrint = useRef<string>('');
  const optedTier = access.fasting.optedTier;
  // what only this screen knows (effective limits, safety access) reaches the `goals.suggest` port
  useEffect(() => {
    setSuggestContext({
      constraints,
      safety: {
        outcome: access.outcome,
        plannerAccess: access.plannerAccess,
        optedTier,
        shortWindowOn: access.fasting.shortWindowOn,
      },
      startDate: model.startDate,
      noWeightLossGoal: access.plannerLocks.some((l) => l.id === 'no-weight-loss-goal'),
      optedTier,
      maxFastHours: access.fasting.maxFastHours,
    });
  }, [
    constraints,
    access.outcome,
    access.plannerAccess,
    access.plannerLocks,
    access.fasting.shortWindowOn,
    access.fasting.maxFastHours,
    optedTier,
    model.startDate,
  ]);
  const suggest = async (choice = purpose) => {
    const run = ++sgRun.current;
    const source = aiPorts().suggestGoals ? 'ai' : 'rule';
    setApplied(null);
    setSg({ status: 'loading', source });
    sgPrint.current = answersFingerprint(choice);
    const r = await dispatch('goals.suggest', { source, ...(choice ? { purpose: choice } : {}) });
    if (run !== sgRun.current) return;
    if (r.ok && 'output' in r)
      setSg({ status: 'ready', suggestion: r.output as GoalSuggestion, stale: false });
    else setSg({ status: 'error', message: r.ok ? 'No suggestion came back. Try again.' : r.error.message });
  };
  const clearSuggestion = () => {
    sgRun.current++;
    setSg(null);
  };
  const applySuggestion = (mode: ApplyMode) => {
    if (sg?.status !== 'ready') return;
    const { ops } = suggestionOps(sg.suggestion, goals, mode);
    const r = dispatchSync('goals.edit', { ops });
    if (!r.ok) {
      toast(r.error.message, { id: 'planner-suggest' });
      return;
    }
    const changeSetId = ('changeSet' in r ? r.changeSet?.id : null) ?? null;
    setSg(null);
    setApplied({ changeSetId });
  };
  const undoApplied = (changeSetId: string) => {
    void sendCommand('history.undo', { changeSetId });
    setApplied(null);
  };
  // stale: the answers changed after the suggestion was made
  const sgReady = sg?.status === 'ready' ? sg : null;
  const intakeDoc = useIntakeDoc();
  useEffect(() => {
    if (!sgReady || sgReady.stale) return;
    if (answersFingerprint(purpose) !== sgPrint.current) setSg({ ...sgReady, stale: true });
  }, [sgReady, body.revision, body.updatedAt, intakeDoc, purpose]);

  // "Use as a goal" from Evidence: /plan/goals?add=<metricId>
  const add = params.get('add');
  const handledAdd = useRef<string | null>(null);
  useEffect(() => {
    if (!add) {
      handledAdd.current = null;
      return;
    }
    if (handledAdd.current === add) return; // StrictMode re-runs effects; add once per link
    handledAdd.current = add;
    const outcome = addGoalByMetric(add);
    if (outcome === 'added')
      toast(`${goalMetric(add)?.label} added as goal ${usePlannerStore.getState().goals.length}.`, {
        id: 'planner-goal-added',
      });
    else reportAdd(outcome, add);
    const next = new URLSearchParams(params);
    next.delete('add');
    setParams(next, { replace: true });
  }, [add, params, setParams]);

  const relations = useMemo(() => goalRelations(goals), [goals]);
  const connectors = useMemo(() => connectorsByRow(relations), [relations]);
  const noWeightLoss = access.plannerLocks.some((l) => l.id === 'no-weight-loss-goal');
  // D7-02: the profile the request was built from (marker labs merged): a goal forecast from a measured value outside the
  // model's range stays visible as Unsupported and is not planned (the measurement itself is kept exactly)
  const labProfile = model.request?.profile ?? null;
  const flags = useMemo(() => {
    const map = new Map<string, ReactNode>();
    for (const g of goals) {
      const domain = goalDomainIssue(labProfile, g.metric);
      if (domain)
        map.set(
          g.key,
          <Chip kind="status" severity="info">
            {domain === 'own' ? UNSUPPORTED_OWN : UNSUPPORTED_DEPENDENCY}
          </Chip>,
        );
      else if (noWeightLoss && WEIGHT_GOALS.has(g.metric) && (g.mode === 'lose' || g.mode === 'lower'))
        map.set(
          g.key,
          <Chip kind="status" severity="caution">
            not available with your safety answers
          </Chip>,
        );
      else if (g.metric === 'waist' && !body.measured.waist)
        map.set(
          g.key,
          <Chip kind="status" severity="info" onClick={() => navigate(`${paths.body}#shape`)}>
            estimated waist · add a measurement in Your body
          </Chip>,
        );
      else if (isUntouchedSuggestion(g, suggestedRecord)) {
        const why = suggestionWhy(g, suggestedRecord);
        if (why) map.set(g.key, <p className="lp-goal__help lp-goal__why">{why}</p>);
      }
    }
    return map;
  }, [goals, noWeightLoss, body.measured.waist, navigate, suggestedRecord, labProfile]);

  const starters = useMemo(
    () => (goals.length === 0 ? starterGoals(noWeightLoss) : []),
    [goals.length, noWeightLoss],
  );
  const selected = useMemo(() => new Set(goals.map((g) => g.metric as string)), [goals]);

  const onHint = (a: HintAction) => {
    const ops = hintOps(a);
    if (ops) editGoalsLater(ops);
    else {
      limitsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      limitsRef.current?.querySelector<HTMLElement>('input, button')?.focus({ preventScroll: true });
    }
  };

  // the fasting and short-window opt-ins sit under the "Longest fast" bank they unlock
  const fastingControls =
    access.outcome.fasting.optInTiers.length > 0 || access.outcome.fasting.shortWindowAvailable ? (
      <FastingTierControls context={model.bodyContext} />
    ) : null;

  const running = model.run.status === 'running' || model.run.status === 'stopping';
  const readOnly = running ? 'Goals are read-only while plans are found.' : undefined;
  const openPicker = () => setPickerOpen(true);

  return (
    <>
      <div className="lp-goals-grid">
        <div className="lp-goals-grid__main">
          {sg ? (
            <SuggestionCard
              state={sg}
              goalCount={goals.length}
              constraints={constraints}
              fastingOptedIn={optedTier !== null}
              units={model.units}
              onApply={() => applySuggestion('replace')}
              onAppend={() => applySuggestion('append')}
              onClear={clearSuggestion}
              onAgain={() => void suggest()}
              onPurpose={(choice) => {
                setPurpose(choice);
                void suggest(choice);
              }}
              onCandidate={(candidate, amount) => {
                if (
                  sg.status !== 'ready' ||
                  !Number.isFinite(amount) ||
                  amount <= 0 ||
                  (noWeightLoss && candidate.mode === 'lose')
                )
                  return;
                const suggestion = sg.suggestion;
                if (
                  suggestion.goals.some((g) => g.metric === candidate.metric) ||
                  suggestion.goals.length >= MAX_PLANNER_GOALS
                )
                  return;
                setSg({
                  ...sg,
                  suggestion: {
                    ...suggestion,
                    candidates: suggestion.candidates?.filter((c) => c.metric !== candidate.metric),
                    goals: [
                      ...suggestion.goals,
                      {
                        ...candidate,
                        rank: suggestion.goals.length + 1,
                        target: amount,
                        unit: 'kg',
                        targetFrom: 'user',
                      },
                    ],
                  },
                });
              }}
              linkFor={missingLink}
              onOpen={(to) => navigate(to)}
            />
          ) : applied ? (
            <div className="lp-sg__collapsed" role="status">
              <span>Suggestion applied</span>
              {applied.changeSetId ? (
                <Key size="sm" variant="quiet" onClick={() => undoApplied(applied.changeSetId!)}>
                  Undo
                </Key>
              ) : null}
            </div>
          ) : null}
          <Faceplate
            title="Goals"
            caption={goals.length >= MAX_PLANNER_GOALS - 1 ? `${goals.length} of ${MAX_PLANNER_GOALS}` : undefined}
            className="lp-goalsface"
            actions={
              <Key
                ref={addRef}
                variant="action"
                icon={Plus}
                size="sm"
                onClick={openPicker}
                aria-haspopup="dialog"
                aria-expanded={pickerOpen}
                disabledReason={full ? 'Up to six goals. Remove one to add another.' : readOnly}
              >
                Add a goal
              </Key>
            }
            footer={
              goals.length > 1 ? (
                <div className="lp-strict">
                  <span className="lp-label" id="lp-strict-l">
                    Keep the order
                  </span>
                  <KeyBank<Strictness>
                    labelledBy="lp-strict-l"
                    size="sm"
                    value={model.strictness}
                    onChange={(s) => editGoalsLater([{ op: 'setStrictness', value: s }])}
                    options={[
                      { value: 'strict', label: 'Strict' },
                      { value: 'balanced', label: 'Balanced' },
                      { value: 'flexible', label: 'Flexible' },
                    ]}
                  />
                </div>
              ) : undefined
            }
          >
            {goals.length > 0 ? (
              <GoalRankList
                goals={goals}
                profile={model.profile}
                onMove={(a, b) => editGoalsLater([{ op: 'move', from: a, to: b }])}
                onUpdate={(k, p) => editGoalsLater([{ op: 'update', key: k, patch: p as never }])}
                onRemove={(k) => editGoalsLater([{ op: 'remove', key: k }])}
                onExplain={setExplain}
                connectors={connectors}
                flags={flags}
                readOnly={running}
              />
            ) : null}
            {starters.length > 0 ? (
              <div className="lp-suggest" role="group" aria-label="Suggested goals">
                <p className="lp-label" aria-hidden="true">
                  Suggested
                </p>
                {starters.map(({ metric: m, mode }) => {
                  const spec = modeSpec(m, mode);
                  const dir =
                    spec.target === 'zero' ? ': keep' : spec.direction === 'minimise' || spec.sign < 0 ? ' ↓' : ' ↑';
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className="lp-suggest__row"
                      disabled={running}
                      onClick={() => reportAdd(addGoalByMetric(m.id, mode), m.id)}
                    >
                      <Swatch category={m.category} />
                      <span className="lp-suggest__name">
                        {m.label}
                        {dir}
                      </span>
                      <span className="lp-suggest__add" aria-hidden="true">
                        <Icon icon={Plus} size={16} />
                        Add
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </Faceplate>
        </div>
        {/* wide screens: a top row of (suggestion) goals | horizon · before you run, then the practical limits across
            the full width in two balanced columns (training | eating, nutrients | leave out); phones read goals ·
            horizon · practical limits · before you run (planner.css, grid order) */}
        <div className="lp-goals-grid__aside">
          <div className="lp-goals-grid__horizon">
            <HorizonPicker
              horizonDays={model.horizonDays}
              startDate={model.startDate}
              onHorizon={(d) => editGoalsLater([{ op: 'setHorizon', days: d }])}
              onStartDate={(iso) => editGoalsLater([{ op: 'setStartDate', date: iso }])}
              disabled={running}
            />
          </div>
          <div className="lp-goals-grid__preflight">
            <PreflightList hints={model.hints} onAction={onHint} pending={model.reachPending} />
          </div>
        </div>
        <div className="lp-goals-grid__limits" ref={limitsRef}>
          <LimitsPanel
            c={constraints}
            onChange={(p) => editGoalsLater([{ op: 'setLimits', patch: p as never }])}
            onReset={() => editGoalsLater([{ op: 'resetLimits' }])}
            customised={Object.keys(model.overrides).length > 0}
            safetyMaxFastH={access.fasting.maxFastHours}
            fastingControls={fastingControls}
            disabled={running}
          />
        </div>
      </div>
      <PlannerSafetyPanel access={access} context={model.bodyContext} />

      <GoalPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        anchorRef={addRef}
        selected={selected}
        full={full}
        onSuggest={() => {
          setPickerOpen(false);
          void suggest();
        }}
        suggesting={sg?.status === 'loading'}
        suggestDisabledReason={!body.complete ? 'Finish Your body first' : readOnly}
        sex={body.sex === 'male' || body.sex === 'female' ? body.sex : null}
        onPick={(id: MetricId) => {
          const outcome = addGoalByMetric(id);
          if (outcome !== 'added') reportAdd(outcome, id);
          else {
            toast(`${goalMetric(id)?.label} added as goal ${usePlannerStore.getState().goals.length}.`, {
              id: 'planner-goal-added',
              duration: 2500,
            });
            if (usePlannerStore.getState().goals.length >= MAX_PLANNER_GOALS) setPickerOpen(false);
          }
        }}
      />
      <ExplainDrawer
        open={explain !== null}
        onClose={() => setExplain(null)}
        metricId={explain ?? undefined}
        returnTo={{ to: paths.planGoals, label: 'Planner goals' }}
      />
    </>
  );
}
