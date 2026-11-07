/**
 * Your body (`/body`, design/screens/your-body.md). Also first-run setup steps 3–5: `/body?setup=basics|shape|habits`
 * and the "Choose a start" hand-over (`?setup=start`). Deep links: `#basics`, `#shape`, `#habits`, `#drawing`,
 * `?focus=waist`.
 *
 * Data flow: profile store (raw inputs, SI, touched sliders only) → summarizeBody (engine posterior + resolveProfile
 * maintenance) and deriveFigure (what the figure draws) on every change, synchronously (~1 ms), so the figure and
 * every readout follow a drag frame by frame; the store persists with a 300 ms debounce.
 *
 * Shell (SPEC §4): one header ("Your body", the setup scale on setup steps, a status capsule, the one ⋯); the way on
 * into the planning tools is the header's primary pill only when the navigation does not already hold them. The setup
 * steps are a focused flow: no navigation pill (while no plan is live), and Back · Skip · Next dock at the foot on phones.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useShallow } from 'zustand/react/shallow';
import { Key, KeyLink, MQ, Page, useMediaQuery, formatNumber, formatRange, toast } from '@/components';
import { ActionBar, TopBar, useChromeless, useShellNav, type MenuEntry } from '@/app/shell';
import { paths } from '@/app/paths';
import { SafetyModeChip, useSafetyAccess } from '@/features/onboarding';
import { describeAvatar } from '@/features/body/avatar';
import { defaultFigureFrame, useBodyValues, useProfileStore, type BodyProfileValues, type SetupStep } from '@/state/profileStore';
import { useQuietMode, useSettingsStore } from '@/state/settingsStore';
import { BasicsFace } from './components/BasicsFace';
import { EstimatesFace } from './components/EstimatesFace';
import { FigureFace } from './components/FigureFace';
import { HabitsFace } from './components/HabitsFace';
import { LabsFace } from './components/LabsFace';
import { MaintenanceCard } from './components/MaintenanceCard';
import { ChooseStart, MiniFigure, SetupProgress, type SetupView } from './components/Setup';
import { ShapeFace } from './components/ShapeFace';
import { CONTINUE, EST, SAVE, SETUP, TITLE } from './copy';
import { DEFAULTS } from '@/engine/core/defaults';
import { describeFigureQuiet, deriveFigure, withFrame, type FigureView } from './figure';
import { useDraftView } from './shapeDraft';
import { useCommittedSnapshot, useSaveStatus } from './hooks';
import { bodyContextOf, summarizeBody, withIntakeActivity } from './model';
import { IntakeReminderChip, intakePath, useBodyFlowContext, useIntakeDoc } from '@/features/intake';
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
  const showFigure = useSettingsStore((s) => s.showFigure);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const nav = useShellNav();
  const mode = modeOf(params.get('setup'));
  const coarse = useMediaQuery(MQ.coarsePointer);
  const desktop = useMediaQuery(MQ.lg);
  // phones and tablets read Basics as summary rows (the inline form is the desktop's and the first run's); it is the
  // inverse of MQ.lg as its own query so a test without matchMedia keeps the inline form
  const narrow = useMediaQuery('(max-width: 63.99rem)');
  // SPEC Q7: quiet mode in effect (the setting, or gentle's default): no digit from a reading on this page
  const quiet = useQuietMode().on;

  // stable slices for the memoised cards (a shape drag leaves them untouched)
  const basics = useProfileStore(
    useShallow((s) => ({ sex: s.sex, ageYears: s.ageYears, heightCm: s.heightCm, weightKg: s.weightKg, ethnicity: s.ethnicity })),
  );
  const habitInputs = useProfileStore(useShallow((s) => ({ habits: s.habits, training: s.training, cycle: s.cycle, menopause: s.menopause, sex: s.sex })));

  // "a normal day" answers (intake) set the maintenance drivers and band
  const intakeDoc = useIntakeDoc();
  const intakeActivity = intakeDoc.activity;
  const summary = useMemo(() => summarizeBody(withIntakeActivity(v, intakeActivity)), [v, intakeActivity]);
  const derived = useMemo(() => deriveFigure(v, summary), [v, summary]);
  // Figure › Adjust the drawing: the frame follows a drag frame by frame (draft) while profile.patch is sent every 250 ms
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

  /* ---- saving is silent: only a failed save says so, once, as a toast ---- */
  const saveStatus = useSaveStatus();
  useEffect(() => {
    if (saveStatus === 'unavailable') toast(SAVE.unavailable);
  }, [saveStatus]);

  /* ---- first run: return to the unfinished setup step (IA §4.1 "leaving mid-way returns to the same step") ---- */
  const storedStep: SetupStep = v.setup;
  useEffect(() => {
    if (mode === 'normal' && storedStep !== 'done' && !location.hash) {
      navigate({ search: `?setup=${storedStep}` }, { replace: true });
    }
  }, [mode, storedStep, location.hash, navigate]);

  /* ---- deep links: #basics / #shape / #habits / #drawing, ?focus=waist ---- */
  const focus = params.get('focus');
  // the waist row lives in Shape › Fine-tune shape: a deep link to it (or to Shape) opens the disclosure first
  const wantsFineTune = focus === 'waist' || location.hash === '#shape';
  // every shape scale shows by default (they reshape the figure beside them); the disclosure only folds them away
  const [fineTune, setFineTune] = useState(true);
  const [linkedFineTune, setLinkedFineTune] = useState(wantsFineTune);
  if (wantsFineTune !== linkedFineTune) {
    // a new deep link while on the page (adjusted during render, not in an effect)
    setLinkedFineTune(wantsFineTune);
    if (wantsFineTune) setFineTune(true);
  }
  const handledLink = useRef<string | null>(null);
  useEffect(() => {
    const key = `${focus}|${location.hash}`;
    if (handledLink.current === key) return;
    const id = focus === 'waist' ? 'body-waist' : location.hash ? `body-${location.hash.slice(1)}` : null;
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return; // not drawn yet (a disclosure opening, a lazy card): tried again on the next render
    handledLink.current = key;
    el.scrollIntoView?.({ block: 'start' });
    if (focus === 'waist') el.querySelector<HTMLInputElement>('input[role="switch"]')?.focus({ preventScroll: true });
  }, [focus, location.hash, fineTune, drawingOpen, mode]);

  /* ---- screen-reader snapshot: the figure's name and the live region change on release, not per frame ---- */
  const heightText = units === 'metric' ? `${Math.round(summary.heightCm)} cm` : `${Math.floor(Math.round(summary.heightCm / 2.54) / 12)} ft ${Math.round(summary.heightCm / 2.54) % 12} in`;
  const needsWeight = summary.missing.includes('weight');
  const ctxAge = rawContext.ageYears;
  const ctxBmi = rawContext.bmi === undefined ? undefined : Math.round(rawContext.bmi * 10) / 10;
  const ctxBf = rawContext.bodyFatPct === undefined ? undefined : Math.round(rawContext.bodyFatPct * 10) / 10;
  const ctxSex = rawContext.sex;
  const ctxLoad = rawContext.highTrainingLoad;
  const current = useMemo(
    () => ({
      // the safety layer gets the committed body too (no re-evaluation on every drag frame)
      bodyContext: { ageYears: ctxAge, bmi: ctxBmi, bodyFatPct: ctxBf, sex: ctxSex, highTrainingLoad: ctxLoad },
      label: quiet
        ? describeFigureQuiet(view, twoLayer ? 'two-layer' : 'envelope')
        : describeAvatar(view.params, {
            frame: view.frame,
            heightText,
            muscle: `Muscle ${view.muscle.figureWords} for this size.`,
            layers: twoLayer ? 'two-layer' : 'envelope',
          }),
      spoken: needsWeight
        ? `Estimates ${EST.needsWeight}.`
        : EST.spoken(
            `${formatNumber(summary.bodyFatPct, 1)} percent, likely ${formatRange(summary.bodyFatBand80[0], summary.bodyFatBand80[1], 1).replace('–', ' to ')}`,
            units === 'imperial' ? `${formatNumber(kgToLb(summary.leanMassKg), 1)} pounds` : `${formatNumber(summary.leanMassKg, 1)} kilograms`,
          ),
    }),
    [view, quiet, twoLayer, heightText, needsWeight, summary, units, ctxAge, ctxBmi, ctxBf, ctxSex, ctxLoad],
  );
  const a11y = useCommittedSnapshot(current);
  const bodyContext = a11y.value.bodyContext;
  const safety = useSafetyAccess(bodyContext);
  const gentle = safety.ready && safety.outcome.restrictions.includes('R1');
  // the numbers of a reading wait behind "Show numbers" in quiet mode and in gentle mode alike
  const calm = quiet || gentle;
  const figureHidden: false | 'settings' | 'gentle' = !showFigure ? 'settings' : gentle && !gentleFigure ? 'gentle' : false;
  const intakeCtx = useBodyFlowContext(intakeDoc, gentle);
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

  /* ---- setup: a focused flow (no navigation pill while no plan is live; its keys dock at the foot on phones) ---- */
  const setupView = mode === 'basics' || mode === 'shape' || mode === 'habits' ? mode : null;
  const focusedSetup = setupView !== null && nav.mode === 'planning' && !nav.override;
  useChromeless(focusedSetup);
  const go = (m: Mode) => setParams(m === 'normal' ? {} : { setup: m }, { replace: false });
  const setup = (step: SetupStep, skipped?: { shape?: boolean; habits?: boolean }) =>
    void sendCommand('profile.setSetupStep', { step, ...(skipped?.shape !== undefined ? { shapeSkipped: skipped.shape } : {}), ...(skipped?.habits !== undefined ? { habitsSkipped: skipped.habits } : {}) });
  const missingBasics = summary.missing.map((f) => MISSING_WORD[f]);
  const setupKeys = (step: SetupView) => {
    const idx = SETUP_VIEWS.indexOf(step);
    // v0.2: after shape the first run continues into the intake (a normal day … devices → summary → choose a start)
    const toIntake = () => navigate(intakePath('activity', { from: 'setup' }));
    const next = () => {
      if (step === 'basics') setup('shape');
      else if (step === 'shape') setup('habits');
      else setup('done');
      if (step === 'shape') toIntake();
      else go(step === 'habits' ? 'start' : SETUP_VIEWS[idx + 1]!);
    };
    const skip = () => {
      if (step === 'shape') setup('habits', { shape: true });
      else setup('done', { habits: true });
      if (step === 'shape') toIntake();
      else go('start');
    };
    return (
      <>
        {idx > 0 ? (
          <Key variant="outlined" data-role="back" onClick={() => go(SETUP_VIEWS[idx - 1]!)}>
            {SETUP.back}
          </Key>
        ) : null}
        {step !== 'basics' ? (
          <Key variant="outlined" onClick={skip}>
            {SETUP.skip}
          </Key>
        ) : null}
        <Key variant="primary" onClick={next} disabledReason={step === 'basics' && missingBasics.length ? SETUP.missing(missingBasics) : undefined}>
          {SETUP.next[step]}
        </Key>
      </>
    );
  };

  /* ---- the way on into the planning tools: only where the navigation does not hold them (Living, no override) ---- */
  const navHasPlanning = nav.primary.some((item) => item.id === 'plan' || item.id === 'simulate');
  const wayOn = mode === 'normal' && !navHasPlanning;
  const menu = useMemo<MenuEntry[] | undefined>(
    () => (wayOn ? [{ id: 'simulate', label: CONTINUE.simulate, onSelect: () => navigate(paths.simulate) }] : undefined),
    [wayOn, navigate],
  );
  const safetyChip = safety.ready && safety.outcome.modeName !== 'standard' ? <SafetyModeChip context={bodyContext} /> : null;
  const status =
    mode === 'normal' ? (
      <>
        {safetyChip}
        {reminderNode}
      </>
    ) : (
      (safetyChip ?? undefined)
    );

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

  // read-only on the basics step: the figure follows height, weight and sex there, the scales come at step 2
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
      twoLayer={twoLayer}
      readOnly={readOnly}
      drawing={readOnly ? undefined : drawing}
      drawingId="body-drawing"
      quiet={quiet}
    />
  );
  const estimates = (
    // keyed by the mode: turning quiet mode on again brings back the words, not the numbers an earlier "Show numbers" showed
    <EstimatesFace key={`estimates-${calm ? 'calm' : 'plain'}`} id="body-estimates" summary={summary} units={units} spoken={calm ? EST.quietSpoken : a11y.value.spoken} calm={calm} calmWord={view.muscle.figureWords} />
  );
  // the step's keys ride in the card's foot on desktop (setup), as the intake's do
  const shape = (footer?: ReactNode) => (
    <ShapeFace
      footer={footer}
      id="body-shape"
      waistId="body-waist"
      v={v}
      view={view}
      summary={summary}
      units={units}
      onLive={onLive}
      onCommit={commit}
      fineTune={fineTune}
      onFineTuneChange={setFineTune}
      quiet={quiet}
    />
  );

  return (
    <>
      <TopBar
        title={mode === 'start' ? SETUP.startTitle : TITLE}
        progress={setupView ? <SetupProgress step={setupView} /> : undefined}
        // the focused setup hides the dock, so its header keeps a way out: ✕ leaves for Today (home; the setup resumes on
        // this step next time). The step keys at the foot go back a step (r068 V1)
        back={focusedSetup ? { close: true, label: 'setup', to: '/today', mobileOnly: true } : undefined}
        status={status}
        primary={
          wayOn ? (
            <KeyLink to={paths.planGoals} variant="primary" size="sm">
              {CONTINUE.plan}
            </KeyLink>
          ) : undefined
        }
        menu={menu}
      />
      {/* phones: the step's keys dock at the foot (a focused flow); desktop: they sit right under the step's card */}
      {setupView && setupView !== 'habits' && !desktop ? (
        <ActionBar>
          <div className="lm-body-setup-actions">{setupKeys(setupView)}</div>
        </ActionBar>
      ) : null}
      <Page>
        <div className="lm-body" data-mode={mode}>
          {mode === 'start' ? (
            <ChooseStart />
          ) : mode === 'basics' ? (
            // step 1 asks for four facts first; the figure and the estimates follow them (beside them from 768 px)
            <>
              <div className="lm-body-step" data-step="basics">
                <BasicsFace
                  id="body-basics"
                  v={basics}
                  bmi={summary.bmi}
                  units={units}
                  more={false}
                  footer={desktop ? <div className="lm-body-setup-actions">{setupKeys('basics')}</div> : undefined}
                />
              </div>
              <div className="lm-body-mid">
                {figure(true)}
                {estimates}
              </div>
            </>
          ) : mode === 'shape' ? (
            // inputs first; the figure and the estimates follow (beside them from 768 px)
            <>
              <div className="lm-body-step" data-step="shape">
                {shape(desktop ? <div className="lm-body-setup-actions">{setupKeys('shape')}</div> : undefined)}
              </div>
              <div className="lm-body-mid">
                {figure()}
                {estimates}
              </div>
            </>
          ) : mode === 'habits' ? (
            // the habits step is retired in v0.2: an unfinished first run resumes in the intake
            <Navigate to={intakePath('activity', { from: 'setup' })} replace />
          ) : (
            // desktop: two stacks that end together (r068 V-BD-3) — what the page works out on the left (the figure, its
            // estimates, maintenance, lab values); what you tell it on the right, the shape scales beside the figure (every
            // move visibly reshapes it), then basics and habits. Phones read one column in the CSS `order`.
            <div className="lm-body-cols">
              <div className="lm-body-stack">
                {figure()}
                {estimates}
                <MaintenanceCard key={`maintenance-${calm ? 'calm' : 'plain'}`} id="body-maintenance" ctx={intakeCtx} calm={calm} />
                <LabsFace key={`labs-${calm ? 'calm' : 'plain'}`} id="body-labs" labs={v.labs} open={labsOpen} onOpenChange={setLabsOpen} calm={calm} />
              </div>
              <div className="lm-body-stack">
                {shape()}
                <BasicsFace id="body-basics" v={basics} bmi={summary.bmi} units={units} rows={narrow} calm={calm} />
                <HabitsFace id="body-habits" v={habitInputs} defaults={habitDefaults} open={habitsOpen} onOpenChange={setHabitsOpen} />
              </div>
            </div>
          )}
        </div>
        {missingBasics.length && mode === 'normal' ? <p className="lm-sr">{SETUP.missing(missingBasics)}</p> : null}
        {!figureHidden && (mode === 'normal' || mode === 'shape') ? <LiveMiniFigure v={v} view={view} visible={mini} onReturn={returnToStage} /> : null}
      </Page>
    </>
  );
}
