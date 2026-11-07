/**
 * The activity sheet (§V4.3: edit and detail), Cancel · the activity · Save. In order:
 *  - the type: search, the suggested type pinned first, then recent types;
 *  - the time: the minute chart of the window (steps, else heart rate) with a start and end scrubber; a recording that
 *    was stopped late is trimmed here ("Movement stopped at 07:50 · End there");
 *  - where the phone was (pocket, hand, desk) for a walk or run;
 *  - "This was my planned …" (the plan-match hint, never applied without the person);
 *  - how hard, and the kcal a machine showed (booked as reported);
 *  - the estimate: what is booked, its scenario range and the comparisons (vendor kcal labelled, never booked);
 *  - heart-rate zones and Heart Points.
 * Saving sends `activity.edit` with what changed (the edited activity counts), including what was removed (`clear`);
 * saving with no change approves a pending one. The estimate shown is exactly what Save books (`usePreview`: the
 * commands' own inputs, UI audit #3); without a weight on record it reads "Needs weight" with a field to add one.
 * Quiet mode drops every kcal, the minutes and the points' number (words only, 0.6.3 S31). Energy reads and is typed in
 * the person's unit (kcal or kJ); what is stored and sent stays kcal (`fromEnergyUnit` on entry). The booked figure is
 * labelled as the gross energy of the activity, apart from Train's above-rest preview.
 */
import { useId, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  Chip,
  Field,
  Key,
  KeyBank,
  NumberField,
  ResponsivePanel,
  ScaleRange,
  Section,
  Switch,
  TextInput,
  clockText,
  formatNumber,
  fromEnergyUnit,
  toEnergyUnit,
  toast,
  type EnergyUnitChoice,
} from '@/components';
import { editedDecision, type ActivityEditChanges, type EditClearable } from '@/commands/living/activity';
import {
  hcMotionMinutes,
  type ActivityCarry,
  type ActivityIntensity,
  type ReviewRow,
  type WindowMinutes,
} from '@/living/activityCandidates';
import { kgToLb, lbToKg } from '@/lib/units';
import { useEnergyUnit, useSettingsStore } from '@/state/settingsStore';
import { useLivingActions } from '../data/actions';
import type { GaugeTimeline } from '@/net/gauge';
import { ACTIVITY_COPY as C } from '../copy';
import { useActivityData } from './data';
import { HrZoneChart } from './HrZoneChart';
import { StepsWindowChart } from './StepsWindowChart';
import { lanesOfEvidence, lanesOfTimeline, windowSteps } from './stepsTime';
import { calendarDate } from '@/features/ring/model';
import {
  activityName,
  DETECTED_WORDS,
  autoNoteText,
  AUTO_NOTE_STICKS,
  rowName,
  bookedKcalText,
  energyText,
  evidenceWords,
  isGaitType,
  lastMovingMinute,
  partOfDayWords,
  rowTimeText,
  scrubModel,
  searchTypes,
  TIME_NOT_GIVEN,
} from './model';
import './activity.css';

export interface PlannedSlot {
  itemId: string;
  /** "walk", "lift" */
  name: string;
  startH: number;
}

export interface ActivitySheetProps {
  row: ReviewRow | null;
  onClose: () => void;
  quiet: boolean;
  /** Types the person approved recently (most recent first). */
  recent?: readonly string[];
  /** The day's planned sessions (for "This was my planned …"). */
  planned?: readonly PlannedSlot[];
}

const MIN = 60_000;

/** The sheet's words that `ACTIVITY_COPY` does not hold (UI audit #1). */
export const SHEET_WORDS = {
  /** (0.6.3 INT) quiet: the trim line without its clock time */
  trimQuiet: 'Movement stopped before the end',
  /** (r068 S1) the estimate's range and method lines */
  likely: 'Likely',
  from: 'From',
  needsWeight: 'Needs weight',
  needsWeightLine: 'Vitals needs your body weight to estimate this activity’s energy. It never guesses one.',
  weight: 'Your weight',
  addWeight: 'Add weight',
  weightSaved: 'Weight added',
  saveNeedsWeight: 'Add your weight first',
  /** (UI audit #16) the machine kcal can be removed again (Save then books the estimate). */
  clearMachine: 'Remove the machine’s number',
  /** (0.6.3) what an explicit 0 from the machine books. */
  zeroBooked: 'no energy above your rest is counted for this activity',
  /** (0.6.3 S31) quiet: whether the activity carries Heart Points, never their number. */
  pointsQuiet: (some: boolean) => `${some ? 'Earns' : 'No'} ${C.heartPointsLabel}`,
  /** (r063 S16/A19) the Health Connect speed or power the estimate did not use, and why. */
  evidence: 'Also recorded',
  /** (0.6.5) a counted activity can be taken off again (a mistaken log, a test, a duplicate) */
  remove: 'Remove this activity',
  removeConfirm: 'Remove it? It stops counting toward your day.',
  removeYes: 'Remove',
  removeNo: 'Keep it',
  removed: (name: string) => `Removed ${name}`,
} as const;

/**
 * (0.6.3 S31) The machine's number in the display unit: kcal as typed, kJ as whole kJ. Typing converts back to kcal (stored
 * to 0.1 kcal, so the kJ the person typed reads back the same).
 */
export function machineShown(kcal: number | null, unit: EnergyUnitChoice): number | null {
  return kcal === null ? null : unit === 'kcal' ? kcal : Math.round(toEnergyUnit(kcal, unit));
}
export function machineStored(shown: number, unit: EnergyUnitChoice): number {
  return unit === 'kcal' ? shown : Math.round(fromEnergyUnit(shown, unit) * 10) / 10;
}
/** (r068 V10) The minute bars' axis marks: now beside the shared steps chart (r069 D3). */
export { timeAxisMarks } from './StepsWindowChart';

const COMMON_TYPES = ['walk', 'walk_brisk', 'jog_outdoor', 'cycle_outdoor', 'stair_climb', 'hike'];

/** The window's minute evidence from the day's timeline, when the candidate carries none. */
export function minutesFromTimeline(t: GaugeTimeline | null): WindowMinutes | null {
  if (!t) return null;
  const first = t.start ? Date.parse(t.start) : Date.parse(`${t.date}T00:00:00`);
  // (r063 S16/A19) with the day's Health Connect speed and power, as the import hands them to the estimate
  return {
    first,
    steps: t.steps.selected,
    hr: { bpm: t.hr.bpm, supportedS: t.hr.supportedS },
    ...hcMotionMinutes(t, t.steps.selected.length),
  };
}

export function ActivitySheet(props: ActivitySheetProps) {
  if (!props.row) return <ResponsivePanel open={false} onClose={props.onClose} title="" />;
  return <SheetBody key={`${props.row.id}:${props.row.revision}`} {...props} row={props.row} />;
}

function SheetBody({
  row,
  onClose,
  quiet,
  recent = [],
  planned = [],
}: ActivitySheetProps & { row: ReviewRow }) {
  const data = useActivityData();
  const eu = useEnergyUnit();
  const uid = useId();
  const doc = data.useCandidate(row.id);
  // (r069 D3) the calendar day the window starts on (an activity after midnight, before the day's rollover, is on the
  // next calendar day's timeline)
  const timeline = data.useTimeline(calendarDate(Date.parse(row.startAt)));
  const zones = data.useZoneBoundaries(row.id);
  const evidence = doc?.evidence ?? minutesFromTimeline(timeline);
  const start0 = Date.parse(row.startAt);
  const end0 = Date.parse(row.endAt);
  const decision = doc?.decision ?? null;
  // (0.6.7 AD-VITALS) a detected activity without a suggested type: nothing is pressed until the person chooses
  const needsType = row.detection?.needsType === true && !decision;
  const [exerciseId, setExerciseId] = useState(needsType ? '' : row.exerciseId);
  const [query, setQuery] = useState('');
  const [win, setWin] = useState<[number, number]>([start0, end0]);
  const [carry, setCarry] = useState<ActivityCarry | null>(decision?.carry ?? null);
  const [asItemId, setAsItemId] = useState<string | null>(decision?.asItemId ?? null);
  const [effort, setEffort] = useState<ActivityIntensity['class'] | null>(decision?.intensity?.class ?? null);
  const [machine, setMachine] = useState<number | null>(decision?.kcalOverride ?? null);
  const [saving, setSaving] = useState(false);

  const scrub = useMemo(() => scrubModel({ start: start0, end: end0 }, evidence), [start0, end0, evidence]);
  // (r069 D3) the minutes drawn: the day's timeline (each source's own count too), else the candidate's stored evidence
  const lanes = useMemo(() => (timeline ? lanesOfTimeline(timeline) : evidence ? lanesOfEvidence(evidence) : null), [timeline, evidence]);
  const stepsModel = useMemo(
    () => windowSteps({ start: start0, end: end0 }, lanes, 15, { start: win[0], end: win[1] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [start0, end0, lanes, win[0], win[1]],
  );
  const lateStop = useMemo(
    () => lastMovingMinute({ start: start0, end: end0 }, evidence),
    [start0, end0, evidence],
  );
  const span = { start: win[0], end: win[1] };

  // (UI audit #3, #16) what changed, merged over the earlier decision as the command merges it: a new effort keeps the
  // stated speed, grade, power and rating; switching "This was my planned …" off or emptying the machine kcal clears them
  const clear: EditClearable[] = [
    ...(asItemId === null && decision?.asItemId ? (['asItemId'] as const) : []),
    ...(machine === null && decision?.kcalOverride !== undefined ? (['kcalOverride'] as const) : []),
  ];
  const changes: ActivityEditChanges = {
    ...(exerciseId && (exerciseId !== row.exerciseId || needsType) ? { exerciseId } : {}),
    ...(win[0] !== start0 ? { startAt: new Date(win[0]).toISOString() } : {}),
    ...(win[1] !== end0 ? { endAt: new Date(win[1]).toISOString() } : {}),
    ...(effort && effort !== (decision?.intensity?.class ?? null)
      ? { intensity: { ...(decision?.intensity ?? {}), class: effort } }
      : {}),
    ...(carry && carry !== (decision?.carry ?? null) ? { carry } : {}),
    ...(asItemId && asItemId !== (decision?.asItemId ?? null) ? { asItemId } : {}),
    ...(machine !== null && machine !== (decision?.kcalOverride ?? null) ? { kcalOverride: machine } : {}),
    ...(clear.length ? { clear } : {}),
  };
  const changed = Object.keys(changes).length > 0;
  const changesKey = JSON.stringify(changes);
  // `changesKey` stands for `changes` (a new object each render)
  const draft = useMemo(
    () => (changed && doc ? editedDecision(doc, changes) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [changed, doc, changesKey],
  );
  const outcome = data.usePreview(row.id, draft);
  const preview = outcome.estimate;
  const needsWeight = outcome.missing === 'weight';

  const name = exerciseId ? activityName(exerciseId) : rowName(row);
  const suggested = needsType ? null : (doc?.suggested.exerciseId ?? row.exerciseId);
  // the suggested type first, then recent ones, then the common recorded types; (0.6.7) a detected activity's own choices
  // (air bike, stationary bike, strength, mudgar or gada for an ambiguous one) come first
  const pinned = [...new Set([...(suggested ? [suggested] : []), ...(row.detection?.choices ?? []), ...recent, ...COMMON_TYPES])].slice(0, row.detection ? 8 : 6);
  const results = query.trim()
    ? searchTypes(query, pinned).slice(0, 8)
    : pinned.map((id) => ({ id, name: activityName(id) })).sort((a, b) => Number(b.id === suggested) - Number(a.id === suggested));
  const match = row.planMatch ? planned.find((p) => p.itemId === row.planMatch!.itemId) : null;
  const slot = match ?? planned[0] ?? null;

  const save = () => {
    // nothing changed on a decided activity that still stands: nothing to book
    if (!changed && row.status !== 'pending' && row.status !== 'possible' && !row.updated) return onClose();
    setSaving(true);
    const p = changed
      ? data.edit({ id: row.id, revision: row.revision, ...changes })
      : data.approve(row.id, row.revision);
    void p.then((o) => {
      setSaving(false);
      if (!o.ok) return void toast(o.message ?? C.failed);
      toast(C.saved(name), o.undo ? { action: { label: C.undo, onClick: () => void o.undo?.() } } : {});
      onClose();
    });
  };

  // (0.6.5) remove a counted activity: the late rejection takes its session off the day and every projection after it
  const [confirmRemove, setConfirmRemove] = useState(false);
  const remove = () => {
    setSaving(true);
    void data.reject(row.id).then((o) => {
      setSaving(false);
      setConfirmRemove(false);
      if (!o.ok) return void toast(o.message ?? C.failed);
      toast(
        SHEET_WORDS.removed(name),
        o.undo ? { action: { label: C.undo, onClick: () => void o.undo?.() } } : {},
      );
      onClose();
    });
  };

  const spanMin = Math.round((scrub.to - scrub.from) / MIN);
  const offset = (t: number) => Math.round((t - scrub.from) / MIN);
  // (0.6.3 INT) quiet mode: the thumbs and the trim line say the part of the day, never a clock time
  const clock = (m: number) =>
    quiet ? partOfDayWords(scrub.from + m * MIN) : clockText(scrub.from + m * MIN);
  const booked = preview?.booked ?? null;
  // (r063 S16/A19) which Health Connect speed and power the estimate used, and why not otherwise
  const motionWords = evidenceWords(preview?.evidence);

  return (
    <ResponsivePanel
      open
      onClose={onClose}
      title={name}
      onDone={save}
      doneLabel="Save"
      {...(saving
        ? { doneDisabledReason: 'Saving…' }
        : needsType && !exerciseId
          ? { doneDisabledReason: DETECTED_WORDS.chooseFirst }
        : needsWeight
          ? { doneDisabledReason: SHEET_WORDS.saveNeedsWeight }
          : {})}
    >
      <div className="lv-asheet">
        <p className="lv-asheet__when lm-num">
          {row.timeUnknown
            ? TIME_NOT_GIVEN
            : rowTimeText(new Date(win[0]).toISOString(), new Date(win[1]).toISOString(), quiet)}
          {quiet ? null : ` · ${Math.round((win[1] - win[0]) / MIN)} min`}
        </p>
        {/* (r070) counted automatically: where it came from, and that the person's edit or removal sticks */}
        {row.auto ? (
          <p className="lm-help lv-asheet__auto">
            {autoNoteText(row.auto.from)} {AUTO_NOTE_STICKS}
          </p>
        ) : null}

        <Section label={C.type}>
          <Field label={C.typeSearch} hideLabel>
            <TextInput
              type="search"
              placeholder={C.typeSearch}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </Field>
          <div className="lv-asheet__types" role="group" aria-label={C.type}>
            {results.map((t) => (
              <Chip
                key={t.id}
                kind="filter"
                pressed={t.id === exerciseId}
                onPressedChange={() => setExerciseId(t.id)}
              >
                {/* (r068 S1) the suggestion is a gold dot (named for screen readers), not a word inside the chip */}
                {t.id === suggested ? <span className="lv-asheet__pin" aria-hidden="true" /> : null}
                {t.name}
                {t.id === suggested ? <span className="lm-sr">, {C.suggested.toLowerCase()}</span> : null}
              </Chip>
            ))}
          </div>
        </Section>

        {/* (r063 FX2 sR16) a log without a clock time has no window to scrub and no heart rate of its own */}
        {row.timeUnknown ? null : (
          <Section label={C.time}>
            {/* (r069 D3) the window's steps: the same chart as "Log an activity" and every other activity sheet */}
            <StepsWindowChart model={stepsModel} range={{ start: win[0], end: win[1] }} quiet={quiet}>
            <ScaleRange
              label={C.startEnd}
              value={[offset(win[0]), offset(win[1])]}
              min={0}
              max={spanMin}
              step={1}
              minGap={1}
              thumbLabels={[C.start, C.end]}
              format={(m) => clock(m)}
              valueText={(m, which) => `${which === 'low' ? C.start : C.end} ${clock(m)}`}
              labels={false}
              onChange={([a, b]) => setWin([scrub.from + a * MIN, scrub.from + b * MIN])}
            />
            {lateStop !== null && win[1] > lateStop ? (
              <div className="lv-asheet__trim">
                <span>{quiet ? SHEET_WORDS.trimQuiet : C.trimTo(clockText(lateStop))}</span>
                <Key variant="action" size="sm" onClick={() => setWin([win[0], lateStop])}>
                  {C.trimKey}
                </Key>
              </div>
            ) : null}
            </StepsWindowChart>
          </Section>
        )}

        {isGaitType(exerciseId) ? (
          <Section label={C.carry}>
            <KeyBank
              label={C.carry}
              block
              options={(['pocket', 'hand', 'desk'] as const).map((v) => ({ value: v, label: C.carries[v] }))}
              {...(carry ? { value: carry } : {})}
              onChange={(v) => setCarry(v)}
            />
          </Section>
        ) : null}

        {slot ? (
          <Switch
            checked={asItemId === slot.itemId}
            onChange={(on) => setAsItemId(on ? slot.itemId : null)}
            label={C.planned(slot.name)}
            labelStyle="sentence"
            className="lv-switch-row"
          />
        ) : null}

        <Section label={C.intensity}>
          <KeyBank
            label={C.intensity}
            block
            options={(['light', 'moderate', 'vigorous'] as const).map((v) => ({
              value: v,
              label: C.intensities[v],
            }))}
            {...(effort ? { value: effort } : {})}
            onChange={(v) => setEffort(v)}
          />
        </Section>

        {!quiet ? (
          <Field label={C.machineKcal} help={C.machineKcalHelp}>
            {/* (0.6.3) 0 is allowed: "the machine showed 0" is booked as 0, never estimated (as `activity.edit` takes it) */}
            <NumberField
              value={machineShown(machine, eu)}
              onChange={(v) => setMachine(machineStored(v, eu))}
              min={0}
              max={Math.round(toEnergyUnit(5000, eu))}
              step={1}
              unit={eu}
              name={`${eu} the machine showed`}
            />
          </Field>
        ) : null}
        {!quiet && machine !== null ? (
          <Key variant="text" size="sm" className="lv-asheet__clear" onClick={() => setMachine(null)}>
            {SHEET_WORDS.clearMachine}
          </Key>
        ) : null}

        {needsWeight ? <NeedsWeight date={row.date} /> : null}

        {!quiet && booked && !(needsType && !exerciseId) ? (
          <Section label={C.estimate} className="lv-asheet__estimate">
            <dl className="lv-asheet__est">
              <div>
                <dt>{C.booked}</dt>
                {/* (r068 S1) the answer first and large, its likely range and its method as quiet lines under it */}
                <dd className="lm-num">
                  {booked.estimator === 'reported' ? (
                    <>
                      <span className="lv-asheet__big">{bookedKcalText(booked.grossKcal, booked.envelope, 'reported', eu)}</span>
                      {booked.grossKcal === 0 ? <span className="lv-asheet__method">{SHEET_WORDS.zeroBooked}</span> : null}
                    </>
                  ) : (
                    <>
                      <span className="lv-asheet__big">
                        <span className="lm-display">{energyText(booked.grossKcal, eu)}</span>
                        <span className="lm-unit">{eu}</span>
                      </span>
                      {booked.envelope && Number.isFinite(booked.envelope.lo) && Number.isFinite(booked.envelope.hi) ? (
                        <span className="lv-asheet__rng">
                          {SHEET_WORDS.likely} {energyText(booked.envelope.lo, eu)}–{energyText(booked.envelope.hi, eu)}
                        </span>
                      ) : null}
                    </>
                  )}
                </dd>
              </div>
              {motionWords.notes.length ? (
                <div>
                  <dt>{SHEET_WORDS.evidence}</dt>
                  <dd>
                    <ul className="lv-asheet__cmp">
                      {motionWords.notes.map((n) => (
                        <li key={n} className="lm-num">
                          {n}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ) : null}
            </dl>
            {/* (r068 V10) how the figure is worked out and what else estimated it: one disclosure, closed */}
            {booked.estimator !== 'reported' || preview!.comparisons.length || preview!.vendor.length ? (
              <details className="lv-asheet__how">
                <summary>
                  {C.howWorkedOut}
                  <ChevronDown className="lv-asheet__how-chev" size={16} strokeWidth={1.5} aria-hidden="true" />
                </summary>
                <ul className="lv-asheet__cmp">
                  {booked.estimator !== 'reported' ? (
                    <li>
                      {SHEET_WORDS.from} {[C.method[booked.estimator] ?? booked.estimator, motionWords.method].filter(Boolean).join(' ')}
                    </li>
                  ) : null}
                  {preview!.comparisons.map((c) => (
                    <li key={c.estimator} className="lm-num">
                      {C.method[c.estimator] ?? c.estimator}: {energyText(c.grossKcal, eu)} {eu}
                    </li>
                  ))}
                  {preview!.vendor.map((v) => (
                    <li key={v.source} className="lm-num">
                      {C.vendor(v.source)}: {energyText(v.kcal, eu)} {eu}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </Section>
        ) : null}

        {row.timeUnknown ? null : (
          <Section label={C.heartRate}>
            <HrZoneChart
              window={span}
              minutes={evidence}
              boundaries={zones}
              quiet={quiet}
              {...(doc?.pauses?.length ? { pauses: doc.pauses } : {})}
            />
          </Section>
        )}

        {preview?.heartPoints !== null && preview?.heartPoints !== undefined ? (
          <p className="lv-asheet__points lm-num" id={`${uid}-pts`}>
            {quiet
              ? SHEET_WORDS.pointsQuiet(preview.heartPoints > 0)
              : `${formatNumber(Math.round(preview.heartPoints), 0)} ${C.heartPointsLabel}`}
          </p>
        ) : null}

        {row.status === 'approved' || row.status === 'edited' ? (
          <div className="lv-asheet__remove">
            {confirmRemove ? (
              <>
                <p className="lm-help">{SHEET_WORDS.removeConfirm}</p>
                <span className="lv-asheet__remove-keys">
                  <Key variant="danger" size="sm" disabled={saving} onClick={remove}>
                    {SHEET_WORDS.removeYes}
                  </Key>
                  <Key variant="text" size="sm" onClick={() => setConfirmRemove(false)}>
                    {SHEET_WORDS.removeNo}
                  </Key>
                </span>
              </>
            ) : (
              <Key variant="text" size="sm" onClick={() => setConfirmRemove(true)}>
                {SHEET_WORDS.remove}
              </Key>
            )}
          </div>
        ) : null}
      </div>
    </ResponsivePanel>
  );
}

/**
 * (UI audit #1) No weight on record: no estimate (never one from an invented mass), and a field to add one here. The weigh-in
 * is logged on the activity's day (the estimators read the latest weigh-in on or before it), then the estimate appears.
 */
function NeedsWeight({ date }: { date: string }) {
  const actions = useLivingActions();
  const imperial = useSettingsStore((s) => s.units) === 'imperial';
  const unit = imperial ? 'lb' : 'kg';
  const [value, setValue] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (value === null || !(value > 0)) return;
    setBusy(true);
    const kg = imperial ? lbToKg(value) : value;
    const o = await actions.logWeight(date, Math.round(kg * 10) / 10);
    setBusy(false);
    if (!o.ok) return void toast(o.message ?? C.failed);
    toast(SHEET_WORDS.weightSaved);
  };
  return (
    <Section label={C.estimate} className="lv-asheet__estimate">
      <p className="lv-asheet__needs">
        <Chip kind="status" severity="caution">
          {SHEET_WORDS.needsWeight}
        </Chip>{' '}
        {SHEET_WORDS.needsWeightLine}
      </p>
      <div className="lv-asheet__weigh">
        <Field label={SHEET_WORDS.weight}>
          <NumberField
            value={value}
            onChange={setValue}
            min={imperial ? kgToLb(25) : 25}
            max={imperial ? kgToLb(350) : 350}
            step={0.1}
            unit={unit}
            name="your weight"
          />
        </Field>
        <Key
          variant="action"
          size="sm"
          disabled={busy || value === null || !(value > 0)}
          onClick={() => void add()}
        >
          {SHEET_WORDS.addWeight}
        </Key>
      </div>
    </Section>
  );
}
