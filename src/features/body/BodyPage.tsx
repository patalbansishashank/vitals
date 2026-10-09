/**
 * Your body (`/body`, design/screens/your-body.md). Also first-run setup steps 3–5: `/body?setup=basics|shape|habits`
 * and the "Choose a start" hand-over (`?setup=start`). Deep links: `#basics`, `#shape`, `#habits`, `?focus=waist`.
 *
 * Data flow: profile store (raw inputs, SI, touched sliders only) → summarizeBody (engine posterior + resolveProfile
 * maintenance) and deriveFigure (what the figure draws) on every change, synchronously (~1 ms), so the figure and
 * every readout follow a drag frame by frame; the store persists with a 300 ms debounce.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useShallow } from 'zustand/react/shallow';
import { Engraved, Key, KeyLink, MQ, Page, useMediaQuery, formatNumber, formatRange } from '@/components';
import { ActionBar, TopBar } from '@/app/shell';
import { paths } from '@/app/paths';
import { SafetyModeChip, useSafetyAccess } from '@/features/onboarding';
import { describeAvatar } from '@/features/body/avatar';
import { defaultFigureFrame, useBodyValues, useProfileStore, type BodyProfileValues, type SetupStep } from '@/state/profileStore';
import { useSettingsStore } from '@/state/settingsStore';
import { BasicsFace } from './components/BasicsFace';
import { EstimatesFace } from './components/EstimatesFace';
import { FigureFace } from './components/FigureFace';
import { HabitsFace } from './components/HabitsFace';
import { LabsFace } from './components/LabsFace';
import { ChooseStart, MiniFigure, SetupProgress, type SetupView } from './components/Setup';
import { ShapeFace } from './components/ShapeFace';
import { CONTINUE, EST, SAVE, SETUP, TITLE } from './copy';
import { DEFAULTS } from '@/engine/core/defaults';
import { deriveFigure, withFrame, type FigureView } from './figure';
import { useDraftView } from './shapeDraft';
import { useCommittedSnapshot, useSaveStatus } from './hooks';
import { bodyContextOf, summarizeBody, withIntakeActivity } from './model';
import { IntakeReminderChip, MaintenanceFace, NormalDaySummary, intakePath, useBodyFlowContext, useIntakeDoc } from '@/features/intake';
import { maintenanceShown } from './units';
import { kgToLb } from '@/lib/units';
import { sendCommand } from '@/features/lib/sendCommand';
import '@/commands/defs/profile'; // registers the commands dispatched here
import './body.css';

type Mode = 'normal' | SetupView | 'start';
const SETUP_VIEWS: readonly SetupView[] = ['basics', 'shape', 'habits'];
const MISSING_WORD = { sex: 'sex', age: 'age', height: 'height', weight: 'weight' } as const;

function modeOf(param: string | null): Mode {
  if (param === 'basics' || param === 'shape' || param === 'habits' || param === 'start') return param;
  return 'normal';
}

/** The floating figure follows the sliders as they move, without re-rendering the page (see ./shapeDraft). */
function LiveMiniFigure({ v, view, visible, onReturn }: { v: BodyProfileValues; view: FigureView; visible: boolean; onReturn: () => void }) {
  const drawn = useDraftView(v, view);
  return <MiniFigure params={drawn.params} frame={drawn.frame} visible={visible} onReturn={onReturn} />;
}

export default function BodyPage() {
  const v = useBodyValues();
  const units = useSettingsStore((s) => s.units);
  const energyUnit = useSettingsStore((s) => s.energyUnit);
  const showFigure = useSettingsStore((s) => s.showFigure);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const mode = modeOf(params.get('setup'));
  const coarse = useMediaQuery(MQ.coarsePointer);
  const desktop = useMediaQuery(MQ.lg);

  // stable slices for the memoised faceplates (a shape drag leaves them untouched)
  const basics = useProfileStore(
    useShallow((s) => ({ sex: s.sex, ageYears: s.ageYears, heightCm: s.heightCm, weightKg: s.weightKg, ethnicity: s.ethnicity })),
  );
  const habitInputs = useProfileStore(useShallow((s) => ({ habits: s.habits, training: s.training, cycle: s.cycle, menopause: s.menopause, sex: s.sex })));

  // "a normal day" answers (intake) set the maintenance drivers and band
  const intakeDoc = useIntakeDoc();
  const intakeActivity = intakeDoc.activity;
  const summary = useMemo(() => summarizeBody(withIntakeActivity(v, intakeActivity)), [v, intakeActivity]);
  const derived = useMemo(() => deriveFigure(v, summary), [v, summary]);
  // Shape › Adjust the drawing: the frame follows a drag frame by frame (draft) while profile.patch is sent every 250 ms
  const [frameDraft, setFrameDraft] = useState<number | null>(null);
  const storedFrame = v.figure.frame;
  // the draft only pins the drawing while the stored frame has not caught up; it is cleared by timer, never synchronously
  const draftPending = frameDraft !== null && !(storedFrame !== null && Math.abs(storedFrame - frameDraft) < 1e-3);
  useEffect(() => {
    if (frameDraft === null) return;
    // a write that never lands (or "match my basics") must not pin the drawing
    const t = setTimeout(() => setFrameDraft(null), draftPending ? 1500 : 0);
    return () => clearTimeout(t);
  }, [frameDraft, draftPending]);
  const view = useMemo(
    () => (frameDraft === null || !draftPending || frameDraft === derived.frame ? derived : { ...derived, frame: frameDraft, params: withFrame(derived.params, frameDraft) }),
    [derived, frameDraft, draftPending],
  );
  const [drawingOpen, setDrawingOpen] = useState(() => location.hash === '#drawing');
  const [twoLayer, setTwoLayer] = useState(true);
  const proteinDefault = Math.round((summary.maintenance.resolved.habitualProteinG / summary.weightKg) * 100) / 100;
  const carbDefault = DEFAULTS.habitualCarbPctEnergy[summary.equationSex];
  const habitDefaults = useMemo(() => ({ proteinGPerKg: proteinDefault, carbPct: carbDefault }), [proteinDefault, carbDefault]);
  const rawContext = bodyContextOf(summary);
  const [gentleFigure, setGentleFigure] = useState(false);

  const [habitsOpen, setHabitsOpen] = useState(false);
  const [labsOpen, setLabsOpen] = useState(false);
  const saveStatus = useSaveStatus();

  /* ---- first run: return to the unfinished setup step (IA §4.1 "leaving mid-way returns to the same step") ---- */
  const storedStep: SetupStep = v.setup;
  useEffect(() => {
    if (mode === 'normal' && storedStep !== 'done' && !location.hash) {
      navigate({ search: `?setup=${storedStep}` }, { replace: true });
    }
  }, [mode, storedStep, location.hash, navigate]);

  /* ---- deep links: #basics / #shape / #habits, ?focus=waist ---- */
  const focus = params.get('focus');
  useEffect(() => {
    const id = focus === 'waist' ? 'body-waist' : location.hash ? `body-${location.hash.slice(1)}` : null;
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView?.({ block: 'start' });
    if (focus === 'waist') el.querySelector<HTMLInputElement>('input[role="switch"]')?.focus({ preventScroll: true });
  }, [focus, location.hash]);

  /* ---- screen-reader snapshot: the figure's name and the live region change on release, not per frame ---- */
  const heightText = units === 'metric' ? `${Math.round(summary.heightCm)} cm` : `${Math.floor(Math.round(summary.heightCm / 2.54) / 12)} ft ${Math.round(summary.heightCm / 2.54) % 12} in`;
  const needsWeight = summary.missing.includes('weight');
  const maintText = `${formatNumber(maintenanceShown(summary.maintenance.kcal, energyUnit), 0)} ${energyUnit === 'kJ' ? 'kilojoules' : 'kilocalories'}`;
  const ctxAge = rawContext.ageYears;
  const ctxBmi = rawContext.bmi === undefined ? undefined : Math.round(rawContext.bmi * 10) / 10;
  const ctxBf = rawContext.bodyFatPct === undefined ? undefined : Math.round(rawContext.bodyFatPct * 10) / 10;
  const ctxSex = rawContext.sex;
  const ctxLoad = rawContext.highTrainingLoad;
  const current = useMemo(
    () => ({
      // the safety layer gets the committed body too (no re-evaluation on every drag frame)
      bodyContext: { ageYears: ctxAge, bmi: ctxBmi, bodyFatPct: ctxBf, sex: ctxSex, highTrainingLoad: ctxLoad },
      label: describeAvatar(view.params, {
        frame: view.frame,
        heightText,
        muscle: `Muscle ${view.muscle.figureWords} for this size.`,
        layers: twoLayer ? 'two-layer' : 'envelope',
      }),
      spoken: needsWeight
        ? `Estimates ${EST.needsWeight}.`
        : `${EST.spoken(
            `${formatNumber(summary.bodyFatPct, 1)} percent, likely ${formatRange(summary.bodyFatBand80[0], summary.bodyFatBand80[1], 1).replace('–', ' to ')}`,
            units === 'imperial' ? `${formatNumber(kgToLb(summary.leanMassKg), 1)} pounds` : `${formatNumber(summary.leanMassKg, 1)} kilograms`,
            maintText,
          )}`,
    }),
    [view.params, view.frame, view.muscle.figureWords, twoLayer, heightText, needsWeight, summary, maintText, units, ctxAge, ctxBmi, ctxBf, ctxSex, ctxLoad],
  );
  const a11y = useCommittedSnapshot(current);
  const bodyContext = a11y.value.bodyContext;
  const safety = useSafetyAccess(bodyContext);
  const gentle = safety.ready && safety.outcome.restrictions.includes('R1');
  const figureHidden: false | 'settings' | 'gentle' = !showFigure ? 'settings' : gentle && !gentleFigure ? 'gentle' : false;
  const intakeCtx = useBodyFlowContext(intakeDoc, gentle);
  const normalDayNode = useMemo(() => <NormalDaySummary doc={intakeDoc} ctx={intakeCtx} />, [intakeDoc, intakeCtx]);
  const reminderNode = useMemo(() => <IntakeReminderChip doc={intakeDoc} ctx={intakeCtx} />, [intakeDoc, intakeCtx]);

  /* ---- mini figure (mobile): visible while dragging with the stage out of view ---- */
  const stageRef = useRef<HTMLDivElement>(null);
  const stageVisible = useRef(true);
  const miniTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mini, setMini] = useState(false);
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => {
      stageVisible.current = Boolean(e?.isIntersecting);
      if (e?.isIntersecting) setMini(false);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [mode, figureHidden]);
  useEffect(() => () => {
    if (miniTimer.current) clearTimeout(miniTimer.current);
  }, []);
  const { live: freeze, commit } = a11y;
  const onLive = useCallback(() => {
    freeze();
    if (desktop || stageVisible.current || figureHidden) return;
    setMini(true);
    if (miniTimer.current) clearTimeout(miniTimer.current);
    miniTimer.current = setTimeout(() => setMini(false), 1500);
  }, [freeze, desktop, figureHidden]);

  /* ---- setup navigation ---- */
  const go = (m: Mode) => setParams(m === 'normal' ? {} : { setup: m }, { replace: false });
  const setup = (step: SetupStep, skipped?: { shape?: boolean; habits?: boolean }) =>
    void sendCommand('profile.setSetupStep', { step, ...(skipped?.shape !== undefined ? { shapeSkipped: skipped.shape } : {}), ...(skipped?.habits !== undefined ? { habitsSkipped: skipped.habits } : {}) });
  const missingBasics = summary.missing.map((f) => MISSING_WORD[f]);
  const setupKeys = (view: SetupView, where: 'bar' | 'top') => {
    const size = where === 'bar' ? 'md' : 'sm';
    const idx = SETUP_VIEWS.indexOf(view);
    // v0.2: after shape the first run continues into the intake (a normal day … devices → summary → choose a start)
    const toIntake = () => navigate(intakePath('activity', { from: 'setup' }));
    const next = () => {
      if (view === 'basics') setup('shape');
      else if (view === 'shape') setup('habits');
      else setup('done');
      if (view === 'shape') toIntake();
      else go(view === 'habits' ? 'start' : SETUP_VIEWS[idx + 1]!);
    };
    const skip = () => {
      if (view === 'shape') setup('habits', { shape: true });
      else setup('done', { habits: true });
      if (view === 'shape') toIntake();
      else go('start');
    };
    return (
      <>
        {idx > 0 ? (
          <Key variant="quiet" size={size} onClick={() => go(SETUP_VIEWS[idx - 1]!)}>
            {SETUP.back}
          </Key>
        ) : null}
        {view !== 'basics' ? (
          <Key variant="quiet" size={size} onClick={skip}>
            {SETUP.skip}
          </Key>
        ) : null}
        <Key variant="solid" size={size} onClick={next} disabledReason={view === 'basics' && missingBasics.length ? SETUP.missing(missingBasics) : undefined}>
          {SETUP.next[view]}
        </Key>
      </>
    );
  };

  /** Plain Your body: the way on into the two features; Find a plan is the primary key (it starts nothing, so not yellow). */
  const planKeys = (size: 'sm' | 'md') => (
    <>
      <KeyLink to={paths.simulate} size={size}>
        {CONTINUE.simulate}
      </KeyLink>
      <KeyLink to={paths.planGoals} variant="solid" size={size}>
        {CONTINUE.plan}
      </KeyLink>
    </>
  );

  const scrollToShape = () => document.getElementById('body-shape')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  const openDrawing = () => {
    setDrawingOpen(true);
    requestAnimationFrame(() => document.getElementById('body-drawing')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
  };
  const drawing = {
    open: drawingOpen,
    onOpenChange: setDrawingOpen,
    frame: view.frame,
    basicsFrame: defaultFigureFrame(v.sex),
    matchesBasics: storedFrame === null,
    onFrameDraft: setFrameDraft,
    twoLayer,
    onTwoLayerChange: (on: boolean) => {
      setTwoLayer(on);
      commit();
    },
  };
  const returnToStage = () => stageRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });

  const setupView = mode === 'basics' || mode === 'shape' || mode === 'habits' ? mode : null;
  const status = saveStatus === 'saving' ? SAVE.saving : saveStatus === 'unavailable' ? SAVE.unavailable : SAVE.saved;

  const figure = (readOnly = false) => (
    <FigureFace
      id="body-figure"
      v={v}
      view={view}
      summary={summary}
      units={units}
      coarse={coarse}
      label={a11y.value.label}
      onLive={onLive}
      onCommit={commit}
      hidden={figureHidden}
      onShowGentle={() => setGentleFigure(true)}
      onHideGentle={gentle ? () => setGentleFigure(false) : undefined}
      stageRef={stageRef}
      readOnly={readOnly}
      twoLayer={twoLayer}
      onAdjustDrawing={mode === 'normal' || mode === 'shape' ? openDrawing : undefined}
    />
  );
  const estimates = (
    <EstimatesFace
      id="body-estimates"
      summary={summary}
      muscleWords={view.muscle.figureWords}
      energyUnit={energyUnit}
      units={units}
      spoken={a11y.value.spoken}
      gentle={gentle}
      onRefine={mode === 'normal' ? scrollToShape : undefined}
    />
  );

  return (
    <>
      <TopBar
        title={TITLE}
        progress={setupView ? <SetupProgress step={setupView} /> : undefined}
        actions={
          <>
            <SafetyModeChip context={bodyContext} />
            <Engraved className="lm-body-save" data-setup={setupView ? 'true' : undefined}>
              {status}
            </Engraved>
            {setupView ? <span className="lm-body-setup-top">{setupKeys(setupView, 'top')}</span> : null}
            {mode === 'normal' ? <span className="lm-body-setup-top">{planKeys('sm')}</span> : null}
          </>
        }
      />
      {setupView ? <ActionBar><div className="lm-body-setup-actions">{setupKeys(setupView, 'bar')}</div></ActionBar> : null}
      {mode === 'normal' ? <ActionBar><div className="lm-body-setup-actions">{planKeys('md')}</div></ActionBar> : null}
      <Page>
        <div className="lm-body" data-mode={mode}>
          {mode === 'start' ? (
            <ChooseStart />
          ) : mode === 'basics' ? (
            <>
              <div className="lm-body-mid">
                {figure(true)}
                {estimates}
              </div>
              <BasicsFace id="body-basics" v={basics} bmi={summary.bmi} units={units} intro={SETUP.intro.basics} />
            </>
          ) : mode === 'shape' ? (
            <>
              <div className="lm-body-mid">
                {figure()}
                {estimates}
              </div>
              <ShapeFace
                id="body-shape"
                waistId="body-waist"
                drawingId="body-drawing"
                v={v}
                view={view}
                summary={summary}
                units={units}
                onLive={onLive}
                onCommit={commit}
                intro={SETUP.intro.shape}
                drawing={drawing}
              />
            </>
          ) : mode === 'habits' ? (
            // the habits step is retired in v0.2: an unfinished first run resumes in the intake
            <Navigate to={intakePath('activity', { from: 'setup' })} replace />
          ) : (
            <>
              <div className="lm-body-cols">
                <div className="lm-body-stack">
                  {figure()}
                  {estimates}
                  <BasicsFace id="body-basics" v={basics} bmi={summary.bmi} units={units} />
                  <HabitsFace
                    id="body-habits"
                    v={habitInputs}
                    defaults={habitDefaults}
                    open={habitsOpen}
                    onOpenChange={setHabitsOpen}
                    normalDay={normalDayNode}
                    chip={reminderNode}
                    resolvedSteps={summary.maintenance.activity?.source === 'intake' ? summary.maintenance.steps : undefined}
                  />
                  <LabsFace id="body-labs" labs={v.labs} open={labsOpen} onOpenChange={setLabsOpen} />
                </div>
                <div className="lm-body-stack">
                  <ShapeFace
                    id="body-shape"
                    waistId="body-waist"
                    drawingId="body-drawing"
                    v={v}
                    view={view}
                    summary={summary}
                    units={units}
                    onLive={onLive}
                    onCommit={commit}
                    drawing={drawing}
                  />
                  <div className="lm-body-maintenance">
                    <MaintenanceFace id="body-maintenance" doc={intakeDoc} ctx={intakeCtx} quiet={gentle} />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
        {missingBasics.length && mode === 'normal' ? <p className="lm-sr">{SETUP.missing(missingBasics)}</p> : null}
        {!figureHidden && mode !== 'start' && mode !== 'basics' && mode !== 'habits' ? (
          <LiveMiniFigure v={v} view={view} visible={mini} onReturn={returnToStage} />
        ) : null}
      </Page>
    </>
  );
}

