/**
 * "I did something else" (and "Something else…" from the swap sheet), and "Log an activity" (§V4.4, an activity outside
 * the plan). Pick from the catalogue (names and aliases, the ones on your equipment first; before anything is typed, the
 * common activities, the new types included) or type it ("wooden wheel rollouts 3 × 10"). Typed items the catalogue
 * doesn't know are resolved into what they most likely train and added — never rejected.
 * Then the minutes (or sets), how hard (a stated class), the speed and incline for walking and running, and a live
 * estimate from `projectActivity`: energy above rest with its scenario range, and Heart Points (Fit-compatible). Against
 * a planned session the EquivalenceMeter shows the verdict before saving; a logged activity has nothing to compare with.
 * Quiet mode drops the energy; Heart Points stay. Sheet header: Cancel · title · Save (Log).
 */
import { Activity, Bike, ChevronRight, Dumbbell, Footprints, Waves } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import type { Catalogue, EquivalenceResult, ExerciseRecord, PerformedExercise } from '@/catalogues';
import { sessionEquivalence } from '@/catalogues';
import type { LocalDate } from '@/living';
import { Checkbox, Field, InlineWarning, Key, KeyBank, NumberField, ResponsivePanel, Section, CardHead, HeroNumber, MonoMeta, Icon, TextInput, formatNumber } from '@/components';
import { useEnergyUnit } from '@/state/settingsStore';
import { EquivalenceMeter } from '../../components/EquivalenceMeter';
import { TRAIN_COPY } from '../copy';
import { COMMON_ACTIVITY_IDS, GENERIC_LOG_ACTIVITY_ID, clockOf, logManualInput, manualLogPreview, manualPreview, onTreadmill, perfIntensity, previewKcalText, quietPointsText, roundEnergy, speedApplies, spokenPreview, startHOf, startHOfClock, type Effort, type ManualDose, type ManualPreview } from '../manualLog';
import {
  catalogueWith,
  concreteOf,
  defaultDoneDose,
  isMinutesExercise,
  parseDone,
  perfFor,
  resolveTyped,
  searchDone,
  shortName,
  targetOf,
  type DoneDose,
  type SessionModel,
  type TrainSetup,
} from '../session';
import { activityName, rowTimeText } from '../../activity/model';
import { useActivityData } from '../../activity/data';
import { useLivingClock } from '../../clock';
import { StepsWindowChart } from '../../activity/StepsWindowChart';
import { lanesOfTimeline, windowSteps } from '../../activity/stepsTime';
import { calendarDate } from '@/features/ring/model';
import { useCheckManualActivity, type ActivityLogManualInput, type ManualCheck, type ManualResolution } from '../v3Adapter';

const C = TRAIN_COPY.else;

export interface ElseSaveInput {
  record: ExerciseRecord;
  /** New to the catalogue (resolved from free text). */
  isNew: boolean;
  perf: PerformedExercise;
  /** Against the planned session; null for a logged activity (nothing to compare with). */
  result: EquivalenceResult | null;
  /** A logged activity: the `activity.logManual` input. Null when it replaces planned work. */
  manual: ActivityLogManualInput | null;
}

export interface ElsePanelProps {
  /** The planned session it replaces; null = log an activity outside the plan. */
  model: SessionModel | null;
  /** The item it replaces; null = the whole session. */
  index: number | null;
  date: LocalDate;
  today: LocalDate;
  setup: TrainSetup;
  /** Quiet mode: words only (no kcal; Heart Points as a word; no clock times), aria too. */
  quiet?: boolean;
  /** The hour of the day now (a log on today ends now unless the person sets the start). */
  nowH?: number;
  /** The app day's rollover hour (a typed start before it is after midnight). */
  rolloverH?: number;
  /** (0.6.3 A33) The estimate waits for the person's own setup: false while it loads or could not be read. */
  estimates?: boolean;
  onClose: () => void;
  /** Resolves to an error message, or null when saved. */
  onSave: (input: ElseSaveInput) => Promise<string | null>;
}

interface Chosen {
  record: ExerciseRecord;
  isNew: boolean;
  /** What was typed, kept with new items. */
  text: string | null;
}

/** (0.6.3 A5) The three answers to an overlap with a recording. */
const RESOLUTIONS: ReadonlyArray<{ value: ManualResolution; label: string }> = [
  { value: 'replace', label: C.resolve.replace },
  { value: 'link', label: C.resolve.link },
  { value: 'separate', label: C.resolve.separate },
];

const EFFORTS: ReadonlyArray<{ value: Effort; label: string }> = [
  { value: 'light', label: C.efforts.light },
  { value: 'moderate', label: C.efforts.moderate },
  { value: 'vigorous', label: C.efforts.vigorous },
];

/**
 * (0.6.3 S31) The preview is energy ABOVE the person's resting burn; Today books the gross energy of the activity (its
 * resting part included), which reads larger. Both are labelled so the change on saving is not a surprise.
 */
export const PREVIEW_WORDS = {
  spokenAbove: 'above your resting burn',
  grossNote: 'Today books everything burned during it (gross), resting part included, so its number reads larger.',
} as const;

/** The estimate: energy above rest with its range (hidden in quiet mode) and Heart Points. */
function Preview({ p, quiet }: { p: ManualPreview; quiet: boolean }) {
  const unit = useEnergyUnit();
  const lo = roundEnergy(p.lo, unit);
  const hi = roundEnergy(p.hi, unit);
  const pts = p.points.lo === p.points.hi ? formatNumber(p.points.hi) : `${formatNumber(p.points.lo)}–${formatNumber(p.points.hi)}`;
  return (
    <div className="lv-train-preview">
      <span className="lm-sr" role="status" aria-live="polite">
        {quiet ? spokenPreview(p, true, unit) : spokenPreview(p, false, unit).replace(' estimated, scenario range;', ` ${PREVIEW_WORDS.spokenAbove}, estimated, scenario range;`)}
      </span>
      {quiet ? (
        <p className="lm-eng">
          {quietPointsText(p.points)} · {C.pointsChip}
        </p>
      ) : null}
      {!quiet ? <>
        <CardHead icon={Activity} title={C.energy} as="h3" info={{ title: C.energy, body: `${C.energyInfo} ${PREVIEW_WORDS.grossNote}`, source: { kind: 'estimate', words: `${p.method} · ${p.version}` } }} />
        <HeroNumber value={`≈ ${formatNumber(roundEnergy(p.kcal, unit))}`} unit={unit} size="num" label={`${C.energy}: ${previewKcalText(p, unit)}`} range={`Likely ${formatNumber(lo)}–${formatNumber(hi)}`} />
        <MonoMeta>{pts} {C.points} · {C.pointsChip}</MonoMeta>
      </> : null}
    </div>
  );
}

/** (r063 FX3 aR16) The linked recording as the booking saves it: its window, minutes (not in quiet mode) and sources. */
function linkedText(l: NonNullable<ManualCheck['linked']>, estimate: ManualCheck['estimate'], quiet: boolean): string {
  const ring = l.refs.some((r) => r.startsWith('gauge:'));
  const hc = l.refs.some((r) => r.startsWith('hc:') || r.startsWith('hc-'));
  const from = ring && hc ? 'ring and Health Connect' : hc ? 'Health Connect recording' : 'ring recording';
  const when = rowTimeText(new Date(l.window.start).toISOString(), new Date(l.window.end).toISOString(), quiet);
  return C.resolve.linked(when, quiet ? null : formatNumber(l.durationMin, 0), from, !!estimate?.hrSource);
}

export function ElsePanel({ model, index, date, today, setup, quiet = false, nowH, rolloverH = 4, estimates = true, onClose, onSave }: ElsePanelProps) {
  const logMode = model === null;
  const effortId = useId();
  const resolveId = useId();
  const check = useCheckManualActivity();
  // (0.6.3 A27) when it happened: a typed start (on today it ends now until one is typed), or "time not known"
  const [startText, setStartText] = useState<string | null>(null);
  const [timeUnknown, setTimeUnknown] = useState(false);
  const [resolution, setResolution] = useState<ManualResolution | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [dose, setDose] = useState<DoneDose>({});
  const [effort, setEffort] = useState<Effort | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const [grade, setGrade] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const item = model && index !== null ? model.session.items[index] : undefined;
  const prescribed = useMemo(() => (!model ? [] : item ? [item.perf] : model.session.items.map((i) => i.perf)), [item, model]);
  const target = model ? targetOf(date, today, item ? shortName(item.name) : model.noun) : '';
  const results = useMemo(() => searchDone(query, setup.catalogue, setup.profile), [query, setup]);
  const common = useMemo(() => COMMON_ACTIVITY_IDS.map((id) => setup.catalogue.exercise(id)).filter((e): e is ExerciseRecord => !!e), [setup.catalogue]);

  const catalogue: Catalogue = useMemo(() => {
    if (!chosen?.isNew) return setup.catalogue;
    const own = setup.catalogue.exercises.filter((e) => e.origin !== 'seed' && e.id !== chosen.record.id);
    return catalogueWith([...own, chosen.record]);
  }, [chosen, setup.catalogue]);

  const gait = speedApplies(chosen?.record);
  const treadmill = onTreadmill(chosen?.record);
  const choices: ManualDose = { minutes: dose.minutes ?? 0, effort, speedKmh: gait ? speed : null, gradePct: gait && treadmill ? grade : null };
  const perf = useMemo(() => {
    if (!chosen) return null;
    const base = perfFor(chosen.record, dose, chosen.isNew && chosen.text ? chosen.text : undefined);
    return { ...base, ...perfIntensity(chosen.record, { minutes: dose.minutes ?? 0, effort, speedKmh: speed, gradePct: grade }) };
  }, [chosen, dose, effort, speed, grade]);
  const result = useMemo(() => (perf && !logMode ? sessionEquivalence(prescribed, [perf], catalogue, setup.ctx) : null), [perf, logMode, prescribed, catalogue, setup.ctx]);
  // minutes of a set-based item come from its dose (sets × reps × pace), as the session card counts them
  const minutes = chosen && perf ? (dose.minutes !== undefined && dose.sets === undefined ? dose.minutes : concreteOf(chosen.record, perf, [], setup.ctx).minutes) : 0;
  // (0.6.3 A27) one placement for the preview, the overlap check and the log: the typed start, else (today) ending now
  const startH = !logMode || timeUnknown ? undefined : startText !== null ? startHOfClock(startText, rolloverH) : startHOf(date, today, nowH ?? Number.NaN, minutes);
  const whenKnown = timeUnknown || startH !== undefined;
  const draft = logMode && chosen ? logManualInput(chosen.record.id, date, { ...choices, minutes }, startH) : null;
  // (r063 FX3 aR16) the chosen resolution joins the check: "the same activity" previews the linked recording's window and
  // evidence, exactly what the booking saves
  const asked = draft && resolution ? { ...draft, resolution } : draft;
  const draftKey = asked ? JSON.stringify(asked) : '';
  // (0.6.3 S12/A26) the log's preview is the estimate it books (dated weigh-ins, the booked MET's Heart Points)
  const checked = useMemo(() => (asked && estimates ? check(asked) : null), [draftKey, estimates, check, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const linked = checked?.linked ?? null;
  // (r070) a hand log replaces what only the automatic rules counted, without a question; only the person's own decisions ask
  const conflicts = (checked?.conflicts ?? []).filter((o) => !o.auto);
  // (0.6.3 INT, S2) a replaced session's preview prices from the body context: on a typical placeholder body it refuses,
  // like the log's own check ("Needs weight"), never an estimate from a weight nobody entered
  const needsWeight = logMode ? checked?.missing === 'weight' : !!setup.typicalBody;
  const preview = !chosen || !estimates || needsWeight ? null : logMode ? manualLogPreview(checked?.estimate ?? null) : manualPreview(chosen.record.id, { ...choices, minutes }, setup.ctx);
  // (r069 D3) the steps the ring and phone counted in the time being logged: the same chart as the activity sheet, so a
  // hand log shows what the sensors saw then (a linked recording keeps its own window)
  const place = logMode && checked?.placement.timeKnown ? (linked?.window ?? checked.placement) : null;
  const timeline = useActivityData().useTimeline(place ? calendarDate(place.start) : date);
  const clockNow = useLivingClock().now().getTime();
  const stepsModel = useMemo(() => (place && timeline ? windowSteps({ start: place.start, end: place.end }, lanesOfTimeline(timeline)) : null), [place?.start, place?.end, timeline]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (record: ExerciseRecord, isNew: boolean) => {
    const typed = parseDone(query);
    setChosen({ record, isNew, text: isNew ? query.trim() : null });
    const hasTyped = typed.sets !== undefined || typed.minutes !== undefined;
    // a logged activity is always minutes (the log needs its duration); a replaced session keeps its natural unit
    setDose(logMode ? { minutes: typed.minutes ?? record.defaultDose.durationMin ?? 30 } : defaultDoneDose(record, hasTyped ? typed : null));
    setSpeed(null);
    setGrade(null);
  };
  const useTyped = () => {
    const r = resolveTyped(query, setup.catalogue);
    choose(r.record, r.isNew);
  };
  // `activity.logManual` only takes a type the catalogue has, so a typed name that matched nothing cannot be logged as a
  // new record: the log offers the catalogue's generic "other" activity instead (the person states how hard it was)
  const generic = useMemo(() => setup.catalogue.exercise(GENERIC_LOG_ACTIVITY_ID) ?? null, [setup.catalogue]);
  const blocked = logMode && (!whenKnown || needsWeight || (conflicts.length > 0 && !resolution));
  const save = async () => {
    if (!chosen || !perf || busy || (!logMode && !result) || blocked) return;
    setBusy(true);
    setError(null);
    const manual = draft ? { ...draft, ...(conflicts.length > 0 && resolution ? { resolution } : {}) } : null;
    const msg = await onSave({ record: chosen.record, isNew: chosen.isNew, perf, result, manual });
    setBusy(false);
    if (msg) {
      setError(msg);
      // a recording may have arrived meanwhile: check the overlap again
      setAttempt((n) => n + 1);
    }
  };

  const minutesDose = dose.minutes !== undefined && dose.sets === undefined;
  const typedName = parseDone(query).name || query.trim();
  const title = logMode ? C.logTitle : item ? C.titleItem(shortName(item.name)) : C.title;
  const showEffort = chosen ? logMode || isMinutesExercise(chosen.record) : false;
  return (
    <ResponsivePanel open onClose={onClose} title={title} defaultDetent="full" onDone={() => void save()} doneLabel={logMode ? C.log : C.save} doneDisabled={!chosen || busy || blocked}>
      <div className="lv-train-panel">
        <Field label={C.field} hideLabel>
          <TextInput
            value={query}
            placeholder={logMode ? C.logPlaceholder : C.placeholder}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.currentTarget.value);
              setChosen(null);
            }}
          />
        </Field>
        {chosen ? null : query.trim() ? (
          <>
            {results.length > 0 ? (
              <ul className="lv-train-results" aria-label={C.results}>
                {results.map(({ ex, ready }) => (
                  <li key={ex.id}>
                    <button type="button" className="lv-train-result" onClick={() => choose(ex, false)}>
                      <Icon icon={/swim/.test(ex.id) ? Waves : /cycl|bike/.test(ex.id) ? Bike : /walk|run/.test(ex.id) ? Footprints : /resist|strength/.test(ex.id) ? Dumbbell : Activity} size={20} className="lv-train-result__icon" /><span className="lv-train-result__name">{ex.name}</span>
                      <span className="lm-eng">{ready ? C.ready : C.needsKit}</span>
                      <ChevronRight size={16} strokeWidth={1.5} className="lv-train-result__chev" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lm-eng">{C.noMatch}</p>
            )}
            {!logMode ? (
              <Key variant="text" onClick={useTyped}>
                {C.asTyped(typedName)}
              </Key>
            ) : generic ? (
              <Key variant="text" onClick={() => choose(generic, false)}>
                {C.asOther(generic.name)}
              </Key>
            ) : null}
          </>
        ) : common.length > 0 ? (
          <Section label={C.common}>
            <ul className="lv-train-results" aria-label={C.common}>
              {common.map((ex) => (
                <li key={ex.id}>
                  <button type="button" className="lv-train-result" onClick={() => choose(ex, false)}>
                    <Icon icon={/swim/.test(ex.id) ? Waves : /cycl|bike/.test(ex.id) ? Bike : /walk|run/.test(ex.id) ? Footprints : /resist|strength/.test(ex.id) ? Dumbbell : Activity} size={20} className="lv-train-result__icon" /><span className="lv-train-result__name">{ex.name}</span>
                    <ChevronRight size={16} strokeWidth={1.5} className="lv-train-result__chev" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
        {chosen && perf && (logMode || result) ? (
          <section className="lv-train-chosen" aria-label={C.picked}>
            <div className="lv-train-picked">
              <div className="lv-train-picked__head">
                <div className="lv-train-picked__what">
                  <p className="lv-train-swap__name">{chosen.record.name}</p>
                  {chosen.isNew ? <p className="lm-eng">{C.newItem}</p> : null}
                </div>
                <Key size="sm" variant="outlined" aria-label={C.another} onClick={() => setChosen(null)}>
                  {C.change}
                </Key>
              </div>
              <div className="lv-train-sets__row">
                {minutesDose ? (
                  <Field label={C.time}>
                    <NumberField value={dose.minutes ?? null} onChange={(v) => setDose({ minutes: Math.max(1, v) })} min={1} max={600} step={1} inputMode="numeric" unit="min" name={C.minutes} />
                  </Field>
                ) : (
                  <>
                    <NumberField value={dose.sets ?? null} onChange={(v) => setDose((d) => ({ ...d, sets: Math.max(1, v) }))} min={1} max={30} step={1} inputMode="numeric" unit={C.sets} name={C.sets} />
                    {dose.reps !== undefined ? (
                      <NumberField value={dose.reps} onChange={(v) => setDose((d) => ({ ...d, reps: Math.max(1, v) }))} min={1} max={500} step={1} inputMode="numeric" unit={C.reps} name={C.reps} />
                    ) : null}
                  </>
                )}
                {gait ? (
                  <Field label={TRAIN_COPY.fields.speed}>
                    <NumberField value={speed} onChange={(v) => setSpeed(v)} min={1} max={30} step={0.1} inputMode="decimal" unit="km/h" name={TRAIN_COPY.fields.speed} />
                  </Field>
                ) : null}
                {gait && treadmill ? (
                  <Field label={TRAIN_COPY.fields.incline}>
                    <NumberField value={grade} onChange={(v) => setGrade(v)} min={0} max={30} step={0.5} inputMode="decimal" unit="%" name={TRAIN_COPY.fields.incline} />
                  </Field>
                ) : null}
              </div>
              {showEffort ? (
                <div className="lv-train-effort">
                  <span className="lv-train-effort__label" id={effortId}>
                    {C.effort}
                  </span>
                  <KeyBank<Effort> size="sm" labelledBy={effortId} options={EFFORTS} value={effort ?? undefined} onChange={setEffort} />
                </div>
              ) : null}
            </div>
            {logMode ? (
              <div className="lv-train-when">
                <div className="lv-train-sets__row">
                  <Field label={C.when.start} disabled={timeUnknown} {...(startH !== undefined && !quiet && !timeUnknown ? { help: C.when.ends(clockOf(startH + minutes / 60)) } : {})}>
                    <TextInput
                      type="time"
                      step={300}
                      disabled={timeUnknown}
                      value={startH !== undefined ? clockOf(startH) : ''}
                      onChange={(e) => {
                        setStartText(e.currentTarget.value);
                        setResolution(null);
                      }}
                    />
                  </Field>
                </div>
                <Checkbox
                  checked={timeUnknown}
                  onChange={(v) => {
                    setTimeUnknown(v);
                    setResolution(null);
                  }}
                  label={C.when.unknown}
                />
                {!whenKnown ? <p className="lm-eng">{C.when.needed}</p> : null}
                {stepsModel && place && place.start < clockNow ? (
                  <div className="lv-train-steps" role="group" aria-label={C.when.steps}>
                    <span className="lv-train-effort__label">{C.when.steps}</span>
                    <StepsWindowChart model={stepsModel} range={place} quiet={quiet} />
                  </div>
                ) : null}
              </div>
            ) : null}
            {!estimates ? (
              <p className="lm-eng">{C.loading}</p>
            ) : needsWeight ? (
              <InlineWarning severity="caution">{C.needsWeight}</InlineWarning>
            ) : preview ? (
              <Preview p={preview} quiet={quiet} />
            ) : chosen.isNew ? (
              <p className="lm-eng">{C.noEstimate}</p>
            ) : null}
            {logMode && conflicts.length > 0 ? (
              <div className="lv-train-overlap" role="group" aria-labelledby={resolveId}>
                <p className="lv-train-effort__label" id={resolveId}>
                  {C.resolve.title(conflicts.map((o) => `${activityName(o.exerciseId).toLowerCase()} ${rowTimeText(o.startAt, o.endAt, quiet)}`).join(' and '))}
                </p>
                <KeyBank<ManualResolution> size="sm" orientation="vertical" block labelledBy={resolveId} options={RESOLUTIONS} value={resolution ?? undefined} onChange={setResolution} />
                {linked ? <p className="lm-eng">{linkedText(linked, checked?.estimate ?? null, quiet)}</p> : null}
              </div>
            ) : null}
            {result ? <EquivalenceMeter result={result} target={target} detail /> : null}
          </section>
        ) : null}
        {error ? (
          <InlineWarning severity="caution" alert>
            {error}
          </InlineWarning>
        ) : null}
      </div>
    </ResponsivePanel>
  );
}
