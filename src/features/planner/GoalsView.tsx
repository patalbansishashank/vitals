import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Plus } from 'lucide-react';
import { aiPorts, dispatch, dispatchSync } from '@/commands';
import { sendCommand } from '@/features/lib/sendCommand';
import { useIntakeDoc } from '@/features/intake/doc';
import { intakePath } from '@/features/intake/paths';
import { Chip, EmptyStage, Faceplate, Icon, Key, KeyBank, KeyLink, Notice, Swatch, toast } from '@/components';
import { paths } from '@/app/paths';
import { ExplainDrawer } from '@/features/evidence';
import type { MetricId } from '@/engine/types/metrics';
import type { GoalSuggestion } from '@/engine/planner/domain/suggestGoals';
import type { Strictness } from '@/engine/planner/domain/types';
import { MAX_PLANNER_GOALS, usePlannerStore } from '@/state/plannerStore';
import { SUGGESTED_GOALS, goalMetric, modeSpec, newGoal } from './catalogue';
import type { PlannerModel } from './model';
import type { HintAction } from './preflight';
import { connectorsByRow, goalRelations } from './relations';
import { GoalPicker } from './components/GoalPicker';
import { GoalRankList } from './components/GoalRankList';
import { HorizonPicker } from './components/HorizonPicker';
import { LimitsPanel } from './components/LimitsPanel';
import { PreflightList } from './components/PreflightList';
import { editGoals, editGoalsLater } from './commands';
import { SuggestionCard, type SuggestionState } from './components/SuggestionCard';
import { isUntouchedSuggestion, suggestionOps, suggestionWhy, type ApplyMode } from './suggestApply';
import { answersFingerprint, setSuggestContext } from './suggestInput';

const WEIGHT_GOALS = new Set(['fatMass', 'scaleWeight', 'bodyFatPct', 'waist']);

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
export function addGoalByMetric(id: string, mode?: Parameters<typeof newGoal>[1]): 'added' | 'full' | 'duplicate' | 'ineligible' {
  const m = goalMetric(id);
  if (!m || !m.eligible) return 'ineligible';
  return (editGoals([{ op: 'add', goal: newGoal(m, mode) }])[0] as 'added' | 'full' | 'duplicate' | undefined) ?? 'full';
}

function reportAdd(outcome: ReturnType<typeof addGoalByMetric>, id: string) {
  const m = goalMetric(id);
  if (outcome === 'full') toast('Up to six goals. Remove one to add another.', { id: 'planner-goal-full' });
  else if (outcome === 'duplicate') toast(`${m?.label ?? id} is already one of your goals.`, { id: 'planner-goal-dup' });
  else if (outcome === 'ineligible') toast(m ? `${m.label} can’t be a goal. ${m.reason ?? ''}` : 'That outcome isn’t in the catalogue.', { id: 'planner-goal-no' });
}

/** Where a missing answer is given (the suggestion card's [Add] links). */
export function missingLink(question: string): string | null {
  const [area, q] = question.split('.');
  if (area === 'body') return q === 'waist' ? `${paths.body}#shape` : paths.body;
  if (area === 'activity') return intakePath('activity', { from: 'body' });
  if (area === 'training') return intakePath('training', { from: 'body' });
  if (area === 'food') return intakePath('diet', { from: 'body' });
  if (area === 'devices') return intakePath('devices', { from: 'body' });
  if (area === 'markers') return intakePath('markers', { from: 'body' });
  return null;
}

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

  /* ---- "Suggest from my answers" (planner-goals.md §12): a proposal only after the key is pressed ---- */
  const suggestedRecord = usePlannerStore((s) => s.suggested);
  const [sg, setSg] = useState<SuggestionState | null>(null);
  const [applied, setApplied] = useState<{ changeSetId: string | null } | null>(null);
  const sgRun = useRef(0);
  const sgPrint = useRef<string>('');
  const optedTier = access.fasting.optedTier;
  // what only this screen knows (effective limits, safety access) reaches the `goals.suggest` port
  useEffect(() => {
    setSuggestContext({
      constraints,
      safety: { outcome: access.outcome, plannerAccess: access.plannerAccess, optedTier, shortWindowOn: access.fasting.shortWindowOn },
      startDate: model.startDate,
      noWeightLossGoal: access.plannerLocks.some((l) => l.id === 'no-weight-loss-goal'),
      optedTier,
      maxFastHours: access.fasting.maxFastHours,
    });
  }, [constraints, access.outcome, access.plannerAccess, access.plannerLocks, access.fasting.shortWindowOn, access.fasting.maxFastHours, optedTier, model.startDate]);
  const suggest = async () => {
    const run = ++sgRun.current;
    const source = aiPorts().suggestGoals ? 'ai' : 'rule';
    setApplied(null);
    setSg({ status: 'loading', source });
    sgPrint.current = answersFingerprint();
    const r = await dispatch('goals.suggest', { source });
    if (run !== sgRun.current) return;
    if (r.ok && 'output' in r) setSg({ status: 'ready', suggestion: r.output as GoalSuggestion, stale: false });
    else setSg({ status: 'error', message: r.ok ? 'No suggestion came back. Try again.' : r.error.message });
  };
  const clearSuggestion = () => {
    sgRun.current++;
    setSg(null);
  };
  const applySuggestion = (mode: ApplyMode) => {
    if (sg?.status !== 'ready') return;
    const { ops, added } = suggestionOps(sg.suggestion, goals, mode);
    const r = dispatchSync('goals.edit', { ops });
    if (!r.ok) {
      toast(r.error.message, { id: 'planner-suggest' });
      return;
    }
    const changeSetId = ('changeSet' in r ? r.changeSet?.id : null) ?? null;
    setSg(null);
    setApplied({ changeSetId });
    toast(`${added.length === 1 ? 'One suggested goal' : `${added.length} suggested goals`} ${mode === 'replace' ? 'applied' : 'added'}.`, {
      id: 'planner-suggest',
      duration: 30_000,
      ...(changeSetId ? { action: { label: 'Undo', onClick: () => undoApplied(changeSetId) } } : {}),
    });
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
    if (answersFingerprint() !== sgPrint.current) setSg({ ...sgReady, stale: true });
  }, [sgReady, body.revision, body.updatedAt, intakeDoc]);

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
    if (outcome === 'added') toast(`${goalMetric(add)?.label} added as goal ${usePlannerStore.getState().goals.length}.`, { id: 'planner-goal-added' });
    else reportAdd(outcome, add);
    const next = new URLSearchParams(params);
    next.delete('add');
    setParams(next, { replace: true });
  }, [add, params, setParams]);

  const relations = useMemo(() => goalRelations(goals), [goals]);
  const connectors = useMemo(() => connectorsByRow(relations), [relations]);
  const noWeightLoss = access.plannerLocks.some((l) => l.id === 'no-weight-loss-goal');
  const flags = useMemo(() => {
    const map = new Map<string, ReactNode>();
    for (const g of goals) {
      if (noWeightLoss && WEIGHT_GOALS.has(g.metric) && (g.mode === 'lose' || g.mode === 'lower'))
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
        map.set(
          g.key,
          <>
            <span className="lm-eng">suggested</span>
            {why ? <p className="lp-goal__help lp-goal__why">{why}</p> : null}
          </>,
        );
      }
    }
    return map;
  }, [goals, noWeightLoss, body.measured.waist, navigate, suggestedRecord]);

  const suggestions = SUGGESTED_GOALS.filter((s) => !goals.some((g) => g.metric === s.metric));
  const selected = useMemo(() => new Set(goals.map((g) => g.metric as string)), [goals]);

  const onHint = (a: HintAction) => {
    const ops = hintOps(a);
    if (ops) editGoalsLater(ops);
    else {
      limitsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      limitsRef.current?.querySelector<HTMLElement>('input, button')?.focus({ preventScroll: true });
    }
  };

  const fastLockReason =
    access.fasting.maxFastHours <= 24 && access.fasting.optInTiers.length > 0
      ? 'fasts over 24 h need the opt-in under Safety settings at the top of this screen.'
      : access.fasting.maxFastHours < 24
        ? 'not available in safety mode.'
        : null;

  const running = model.run.status === 'running' || model.run.status === 'stopping';

  return (
    <>
      {model.stale && model.run.result ? (
        <Notice
          severity="info"
          layout="ruled"
          className="lp-notice"
          title="Changed since the last run · Find plans again"
          actions={
            <KeyLink to={paths.planResults} size="sm" variant="quiet">
              See the last plans
            </KeyLink>
          }
        >
          Your goals, limits, body or safety settings differ from the ones those plans were found for.
        </Notice>
      ) : null}
      {!body.complete ? (
        <Notice
          severity="info"
          layout="ruled"
          className="lp-notice"
          title="The Planner needs your body first."
          actions={
            <KeyLink to={paths.body} size="sm" variant="solid">
              Set up your body
            </KeyLink>
          }
        >
          Plans are fitted to your sex, age, height and weight. You can rank goals now; finding plans waits for Your body.
        </Notice>
      ) : null}

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
            caption={`${goals.length} of ${MAX_PLANNER_GOALS} · most important first`}
            actions={
              <Key
                onClick={() => void suggest()}
                loading={sg?.status === 'loading'}
                disabledReason={!body.complete ? 'Finish Your body first' : running ? 'Goals are read-only while plans are found.' : undefined}
              >
                Suggest from my answers
              </Key>
            }
            className="lp-goalsface"
            footer={
              goals.length > 1 ? (
                <div className="lp-strict">
                  <span className="lm-eng" id="lp-strict-l">
                    how firmly to keep the order
                  </span>
                  <KeyBank<Strictness>
                    labelledBy="lp-strict-l"
                    size="sm"
                    value={model.strictness}
                    onChange={(s) => editGoalsLater([{ op: 'setStrictness', value: s }])}
                    options={[
                      { value: 'strict', label: 'strict' },
                      { value: 'balanced', label: 'balanced' },
                      { value: 'flexible', label: 'flexible' },
                    ]}
                  />
                </div>
              ) : undefined
            }
          >
            {goals.length === 0 ? (
              <EmptyStage
                className="lp-goals-empty"
                titleAs="h3"
                art={<RankArt />}
                title="What do you want to change?"
                action={
                  <Key ref={addRef} icon={Plus} onClick={() => setPickerOpen(true)} aria-haspopup="dialog" aria-expanded={pickerOpen}>
                    Add a goal
                  </Key>
                }
              >
                Pick up to six goals and put them in order. Vitals keeps your first goal close to its best and uses what’s left to help the next.
              </EmptyStage>
            ) : (
              <GoalRankList
                goals={goals}
                onMove={(a, b) => editGoalsLater([{ op: 'move', from: a, to: b }])}
                onUpdate={(k, p) => editGoalsLater([{ op: 'update', key: k, patch: p as never }])}
                onRemove={(k) => editGoalsLater([{ op: 'remove', key: k }])}
                onExplain={setExplain}
                connectors={connectors}
                flags={flags}
                readOnly={running}
              />
            )}
            <div className="lp-add">
              {goals.length > 0 ? (
                <Key
                  ref={addRef}
                  icon={Plus}
                  size="sm"
                  onClick={() => setPickerOpen(true)}
                  aria-haspopup="dialog"
                  aria-expanded={pickerOpen}
                  disabledReason={full ? 'Up to six goals. Remove one to add another.' : running ? 'Goals are read-only while plans are found.' : undefined}
                >
                  Add a goal
                </Key>
              ) : null}
              {suggestions.length > 0 && !full ? (
                <div className="lp-suggest" role="group" aria-label="Suggested goals">
                  <span className="lm-eng">suggested</span>
                  {suggestions.map((s) => {
                    const m = goalMetric(s.metric)!;
                    const spec = modeSpec(m, s.mode);
                    return (
                      <button
                        key={s.metric}
                        type="button"
                        className="lp-suggest__chip"
                        disabled={running}
                        onClick={() => reportAdd(addGoalByMetric(s.metric, s.mode), s.metric)}
                      >
                        <Swatch category={m.category} />
                        <span>
                          {m.label}
                          {spec.target === 'zero' ? ': keep' : spec.direction === 'minimise' || spec.sign < 0 ? ' ↓' : ' ↑'}
                        </span>
                        <Icon icon={Plus} size={16} />
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </Faceplate>
          <HorizonPicker
            horizonDays={model.horizonDays}
            startDate={model.startDate}
            onHorizon={(d) => editGoalsLater([{ op: 'setHorizon', days: d }])}
            onStartDate={(iso) => editGoalsLater([{ op: 'setStartDate', date: iso }])}
            disabled={running}
          />
          <div className="lp-only-desktop">
            <PreflightList hints={model.hints} onAction={onHint} pending={model.reachPending} />
          </div>
        </div>
        <div className="lp-goals-grid__side" ref={limitsRef}>
          <LimitsPanel
            c={constraints}
            onChange={(p) => editGoalsLater([{ op: 'setLimits', patch: p as never }])}
            onReset={() => editGoalsLater([{ op: 'resetLimits' }])}
            customised={Object.keys(model.overrides).length > 0}
            safetyMaxFastH={access.fasting.maxFastHours}
            fastLockReason={fastLockReason}
            disabled={running}
          />
        </div>
        <div className="lp-only-mobile">
          <PreflightList hints={model.hints} onAction={onHint} pending={model.reachPending} />
        </div>
      </div>

      <GoalPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        anchorRef={addRef}
        selected={selected}
        full={full}
        sex={body.sex === 'male' || body.sex === 'female' ? body.sex : null}
        onPick={(id: MetricId) => {
          const outcome = addGoalByMetric(id);
          if (outcome !== 'added') reportAdd(outcome, id);
          else {
            toast(`${goalMetric(id)?.label} added as goal ${usePlannerStore.getState().goals.length}.`, { id: 'planner-goal-added', duration: 2500 });
            if (usePlannerStore.getState().goals.length >= MAX_PLANNER_GOALS) setPickerOpen(false);
          }
        }}
      />
      <ExplainDrawer open={explain !== null} onClose={() => setExplain(null)} metricId={explain ?? undefined} returnTo={{ to: paths.planGoals, label: 'Planner goals' }} />
    </>
  );
}

/** Empty-state line illustration: three ranked rows with grips (40 px, ink-3, 1.5 px strokes). */
function RankArt() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      {[9, 20, 31].map((y, i) => (
        <g key={y}>
          <path d={`M5 ${y - 2}h2M5 ${y + 2}h2`} />
          <text x="11" y={y + 3} fontSize="8" fill="currentColor" stroke="none" fontWeight="700">
            {i + 1}
          </text>
          <path d={`M18 ${y}h${18 - i * 5}`} />
        </g>
      ))}
    </svg>
  );
}
