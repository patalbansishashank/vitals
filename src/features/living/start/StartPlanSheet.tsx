/**
 * "Start this plan" and its start sheet (design/screens/plan-ladder.md §6.7; COMPONENTS §13.19; IA §4.7), Cancel · title
 * · Start: plan name, start date (today · tomorrow · next Monday · pick a date ≤ 28 days) with the anchoring note,
 * weekly check-in day, weigh-in time, training days, what to do if a session is missed. Starting builds the
 * plan documents through `plan.start` (the preview — anchoring note, start-date check — uses E5's pure start function,
 * `startPlanFromOption`), lands on Today and offers Undo (`plan.discard`) in the toast. With a plan already running the
 * key reads "Replace active plan…", needs the typed word and dispatches `plan.replace` (the old plan stays restorable for
 * 7 days). The scenario variant (`scenario` prop; IA §4.7 "Simulator scenario → Start this plan", SUITE_SPEC §3.1) starts
 * a Simulator scenario as a `custom` plan through `plan.start { source: { scenarioId } }` (E5's `startFromScenario`); its
 * preview is the calendar anchoring of the scenario's schedule.
 * C5 (D4-01/D4-02/D4-03): the sheet states the plan's safety status as a word (Verified · Unchecked · Limit conflict ·
 * Review; a scenario is Unchecked as a prescription). A known violation or a limit conflict cannot be started; the command
 * revalidates current safety at start either way (a stored result never authorizes by itself). With an unresolved
 * concerning symptom, exercise reads Review; a kidney nutrition scope reads its word (D4-07: Entered · Review · Incomplete).
 * A1-001: the sheet reads the same startability as the command. What no start-time check can settle blocks the key before
 * any write — a failed safety audit (never retried) or a required limit the plan cannot be checked against — and the sheet
 * offers the concrete next step (Find plans again · Review limits · Edit scenario). Any other Unchecked plan is checked by
 * the command at start; a refusal keeps the sheet open, says why, disables Start (no silent retry) and offers that step.
 */
import '../living.css';
import './start.css';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  DottedTrack,
  Field,
  InfoKey,
  InfoPanel,
  Key,
  KeyBank,
  MonoMeta,
  ResponsivePanel,
  Section,
  StatusMark,
  Switch,
  TextInput,
  toast,
} from '@/components';
import type { PersonProfile, Schedule } from '@/engine';
import { habitualSessionsFor } from '@/engine/core/compileSchedule';
import { resolveProfile } from '@/engine/core/resolveProfile';
import { usePersonProfile } from '@/state/profileStore';
import type { OptionSafety, PlanOption, PlannerRequest } from '@/engine/planner/domain/types';
import { paths } from '@/app/paths';
import { dispatch, mintConfirmation } from '@/commands';
import { sendCommand } from '@/features/lib/sendCommand';
import { startPlanFromOption } from '@/features/planner/startPlan';
import {
  RUNG_OF_OPTION,
  addDays,
  anchorSchedule,
  daysBetween,
  isAllowedStartDate,
  startDateChoices,
  templateOfDay,
  weekdayOf,
  type LocalDate,
  type PlannerProvenanceV2,
  type Weekday,
} from '@/living';
import { currentDay, useLivingClock } from '../clock';
import { START_COPY } from '../copy';
import { fmtDay, fmtMonth } from '../format';
import { useActivePlan } from '../mode';
import { TypedConfirmDialog } from '../components/TypedConfirmDialog';
import { plainReason } from './plainReason';
import type { SafetyStatus } from '@/lib/bodyContracts';
import { SAFETY_STATUS_WORD } from '@/features/planner/ladder';
import { useSafetyAccess } from '@/features/onboarding';
import { exerciseInReview } from '@/features/onboarding/SafetySummary';
import { exerciseSymptomGate } from '@/lib/safetyPolicy';
import { useBodyContext } from '@/state/profileStore';
import { DayDots } from '../components/DayDots';
import { infoSpec } from '../components/info';
import { INFO } from '../plan/copy';
import { planTrack } from '../model/planTrack';

/** Why a plan cannot be started for safety (C5): a known violation or an empty intersection of limits. */
export const SAFETY_BLOCK = 'This plan breaks one of your safety limits. Find plans again.';
/** A1-001: the plan's safety audit did not pass (a new planning attempt, never a silent retry). */
export const SAFETY_AUDIT_FAILED = 'This plan’s safety check did not pass. Find plans again.';
/** A1-001: a required limit has no supported check on this plan (Unchecked is never permission). */
export const SAFETY_UNCHECKABLE = 'A required limit can’t be checked on this plan. Review your limits.';

/** The concrete next step a safety block offers (A1-001). */
export type StartSafetyAction = 'findPlans' | 'reviewLimits' | 'editScenario';
export const START_SAFETY_ACTION_LABEL: Readonly<Record<StartSafetyAction, string>> = {
  findPlans: 'Find plans again',
  reviewLimits: 'Review limits',
  editScenario: 'Edit scenario',
};

/**
 * What the option's own safety record already settles before any write (C5/A1-001), the command's startability read
 * from the planner's evaluation: a known violation or limit conflict, a failed audit (one attempt per decision episode;
 * the record keeps it and nothing retries it), and a mandatory bound the plan cannot be checked against (unsupported or
 * unresolved) block. Optional bounds never block (no global lock from an irrelevant preference). Everything else —
 * Unchecked without a valid certificate, a scenario — is decided by the command's current check at start.
 */
export function startSafetyGate(
  safety: OptionSafety | undefined,
): { blocked: string; action: StartSafetyAction } | null {
  const status = safety?.status ?? 'unchecked';
  if (status === 'violation' || status === 'conflict') return { blocked: SAFETY_BLOCK, action: 'findPlans' };
  if (safety?.audit?.status === 'fail' || safety?.certificate?.status === 'failed')
    return { blocked: SAFETY_AUDIT_FAILED, action: 'findPlans' };
  if (
    safety?.evaluations?.some(
      (e) => e.mandatory && (e.capability === 'unsupported' || e.status === 'unchecked'),
    )
  )
    return { blocked: SAFETY_UNCHECKABLE, action: 'reviewLimits' };
  return null;
}

/** The next step after the command refused a start for safety (`safety_blocked`, its `reason` the boundary status). */
export function refusedStartAction(reason: string | undefined, scenario: boolean): StartSafetyAction {
  if (reason === 'unchecked') return 'reviewLimits';
  return scenario ? 'editScenario' : 'findPlans';
}

const RUNG_TITLE = { hard: 'Hard', medium: 'Medium', easy: 'Easy' } as const;
const WD: Array<{ value: string; label: string }> = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(
  (d, i) => ({ value: String(i), label: d }),
);

type StartChoice = 'today' | 'tomorrow' | 'nextMonday' | 'pick';

export interface StartPlanEntryProps {
  option: PlanOption;
  request: PlannerRequest;
  provenance: PlannerProvenanceV2 | null;
  /** The plan's display name in the results ("Steady cut"). */
  name: string;
  /** Results are out of date: starting waits for a fresh run. */
  stale?: boolean;
}

/** A Simulator scenario to start as a `custom` plan. */
export interface ScenarioStartProps {
  scenario: { id: string; name: string; schedule: Schedule };
  /** Why the scenario can't be started yet (nothing painted, a day with more macros than energy). */
  disabledReason?: string;
}

export type StartPlanSheetProps = (StartPlanEntryProps | ScenarioStartProps) & {
  open: boolean;
  onClose: () => void;
};

/** The entry key on the planner results + its sheet. */
export function StartPlanEntry(p: StartPlanEntryProps) {
  const [open, setOpen] = useState(false);
  const live = useActivePlan();
  return (
    <div className="lv-start-entry">
      <Key
        onClick={() => setOpen(true)}
        disabledReason={
          p.stale ? 'Find plans again first: these plans were made for different goals or limits.' : undefined
        }
      >
        {live ? START_COPY.replace : START_COPY.entry}
      </Key>
      {open ? <StartPlanSheet {...p} open onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

/** Weekdays (0 = Monday) on which the person's habitual week trains — what a "training as usual" day trains. */
export function habitualWeekdays(profile: PersonProfile): Set<Weekday> {
  const resolved = resolveProfile(profile);
  const out = new Set<Weekday>();
  for (let wd = 0; wd < 7; wd++) if (habitualSessionsFor(resolved, wd).length > 0) out.add(wd as Weekday);
  return out;
}

/**
 * Training weekdays of a schedule's first week (0 = Monday), from the days that carry sessions. A "training as usual"
 * day counts only on the weekdays the person's habitual week actually trains (none for someone who doesn't lift).
 */
export function trainingWeekdays(s: Schedule, habitual: ReadonlySet<Weekday>): Weekday[] {
  const out = new Set<Weekday>();
  for (let d = 0; d < Math.min(7, s.horizonDays); d++) {
    const t = templateOfDay(s, d);
    const wd = weekdayOf(addDays(s.startDate, d)) as Weekday;
    if ((t.exercise?.length ?? 0) > 0 || (t.habitualTraining && habitual.has(wd))) out.add(wd);
  }
  return [...out].sort();
}

export function StartPlanSheet(props: StartPlanSheetProps) {
  const { open, onClose } = props;
  const scenario = 'scenario' in props ? props.scenario : null;
  const option = 'option' in props ? props.option : null;
  const navigate = useNavigate();
  const clock = useLivingClock();
  const today = currentDay(clock);
  const live = useActivePlan();
  const rung = option ? RUNG_OF_OPTION[option.id] : 'custom';
  const title = option ? RUNG_TITLE[RUNG_OF_OPTION[option.id]] : scenario!.name;
  const schedule = option ? option.schedule : scenario!.schedule;
  const choices = startDateChoices(today);
  const [when, setWhen] = useState<StartChoice>('tomorrow');
  const [picked, setPicked] = useState<LocalDate>(choices.tomorrow);
  const startDate =
    when === 'today'
      ? choices.today
      : when === 'tomorrow'
        ? choices.tomorrow
        : when === 'nextMonday'
          ? choices.nextMonday
          : picked;
  const [name, setName] = useState<string | null>(null);
  const shownName = name ?? (option ? START_COPY.defaultName(title, fmtMonth(startDate)) : scenario!.name);
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const checkInDay = (checkIn !== null ? Number(checkIn) : weekdayOf(startDate)) as Weekday;
  const [weighIn, setWeighIn] = useState<number | null>(7);
  const profile = usePersonProfile();
  const [days, setDays] = useState<Weekday[]>(() => trainingWeekdays(schedule, habitualWeekdays(profile)));
  const [missed, setMissed] = useState<'nextDay' | 'skip' | 'shorter'>('nextDay');
  const [confirming, setConfirming] = useState(false);
  const [safetyInfoOpen, setSafetyInfoOpen] = useState(false);
  const [experimentalTracking, setExperimentalTracking] = useState(false);
  const track = planTrack(1, schedule.horizonDays);

  const intentions = {
    ...(weighIn !== null ? { weighInClockH: weighIn } : {}),
    trainingWeekdays: days,
    missedSessionPlan: missed,
  };
  // Pure and cheap (anchoring + the forecast digest): recomputed on every change to show the anchoring note.
  let preview: { ok: true; anchorNotes: string[] } | { ok: false; reason: string };
  if (option && 'request' in props) {
    const ctx = {
      planId: `plan-${today}-${option.id.toLowerCase()}`,
      now: `${today}T12:00:00.000Z`,
      today,
      createdBy: { kind: 'user' as const },
      versions: {
        engineVersion: option.simulation.meta.engineVersion,
        registryHash: option.simulation.meta.registryHash,
        catalogueVersion: 'seed',
      },
    };
    preview = startPlanFromOption(ctx, option, props.request, props.provenance, {
      startDate,
      name: shownName,
      intentions,
      checkInWeekday: checkInDay,
    });
  } else if (!isAllowedStartDate(today, startDate))
    preview = { ok: false, reason: 'The start date must be today or within the next 28 days.' };
  else preview = { ok: true, anchorNotes: anchorSchedule(schedule, startDate).notices };
  // C5: the option's safety status (absent = Unchecked; a scenario is never a checked prescription)
  const [refused, setRefused] = useState<{
    text: string;
    status: SafetyStatus;
    action: StartSafetyAction;
  } | null>(null);
  const gate = startSafetyGate(option?.safety);
  // a refusal at start shows the boundary's own status word (Review, Unchecked…); a failed audit reads Review
  const safetyStatus: SafetyStatus =
    refused?.status ??
    (gate?.blocked === SAFETY_AUDIT_FAILED ? 'review' : (option?.safety?.status ?? 'unchecked'));
  // D4-02: the current screening's exercise gate (an unresolved concerning exertional symptom, or the answer still without
  // context) holds exercise progression in review; the command's revalidation at start reads the same current state
  const access = useSafetyAccess(useBodyContext());
  const sf = profile.safety?.flags;
  const exerciseGate = exerciseSymptomGate({
    screening:
      exerciseInReview(access.outcome) || sf?.faintingOrChestPain
        ? 'yes'
        : (sf?.answers?.faintingOrChestPain ?? null),
    symptoms: sf?.symptoms ?? null,
    envelopes: sf?.exerciseEnvelopes ?? null,
    today,
  });
  // a resolved structured report or a covering reviewed envelope lifts the review (same gate as the planner and lifecycle)
  const exerciseReview = exerciseGate.status === 'suspended' || exerciseGate.status === 'review';
  // D4-07: the kidney nutrition scope as one word (Entered · Review · Incomplete · Limit conflict); null without one
  const renal = access.outcome.renal;
  const renalWord =
    renal && renal.status !== 'none'
      ? renal.status === 'conflict'
        ? 'Limit conflict'
        : (renal.label ?? 'Review')
      : null;
  const blocked =
    ('disabledReason' in props ? props.disabledReason : undefined) ?? refused?.text ?? gate?.blocked;
  const safetyAction = refused?.action ?? gate?.action ?? null;
  const runSafetyAction = (a: StartSafetyAction) => {
    onClose();
    if (a === 'reviewLimits') navigate(paths.settings('safety'));
    else if (a === 'editScenario' && scenario) navigate(paths.schedule(scenario.id));
    // a new planning attempt (its own decision episode and audit) from the goals, built with the CURRENT safety — never a
    // rerun of the request these plans were found for
    else if (a === 'findPlans') navigate(paths.planGoals);
  };

  const [busy, setBusy] = useState(false);
  const start = async () => {
    const source = scenario ? { scenarioId: scenario.id } : { rung };
    const input = { source, startDate, name: shownName, intentions, checkInWeekday: checkInDay, ...(experimentalTracking ? { experimentalTracking: true, enforceDefaultDeficitCap: false } : {}) };
    setBusy(true);
    let r;
    if (live) {
      const replace = { ...input, reason: 'replaced' as const };
      r = await dispatch('plan.replace', replace, {
        confirmation: mintConfirmation('plan.replace', replace),
      });
    } else r = await dispatch('plan.start', input);
    setBusy(false);
    if (!r.ok || !('output' in r)) {
      // a refused start (C5 lifecycle revalidation) says why in plain words; the rule code stays in the record
      const text = plainReason((!r.ok && r.error.message) || '') || START_COPY.failed;
      toast(text);
      // A1-001: a safety refusal holds the sheet (no silent retry) and offers the step that can change the answer
      if (!r.ok && r.error.code === 'safety_blocked') {
        const reason = r.error.detail?.reason;
        const status: SafetyStatus =
          reason === 'violation' || reason === 'conflict' || reason === 'unchecked' ? reason : 'review';
        setRefused({ text, status, action: refusedStartAction(reason, !!scenario) });
      }
      return;
    }
    const planId = (r.output as { planId: string }).planId;
    onClose();
    navigate('/today');
    const whenText =
      startDate === today
        ? 'today'
        : startDate === addDays(today, 1)
          ? 'tomorrow'
          : `on ${fmtDay(startDate)}`;
    toast(START_COPY.startsToast(shownName, whenText), {
      duration: 10000,
      action: { label: START_COPY.undo, onClick: () => void sendCommand('plan.discard', { planId }) },
    });
  };

  // r068 SS2: the commit is a filled "Start plan" key in the sheet's footer (with a plan running it asks for the typed
  // word first), never gold text in the header
  const cannotStart = busy || !!blocked || !preview.ok;
  const startReason = blocked ?? (!preview.ok ? preview.reason : busy ? 'Starting…' : undefined);
  const statusLine = [
    experimentalTracking ? 'Experimental tracking' : `Safety · ${SAFETY_STATUS_WORD[safetyStatus]}`,
    exerciseReview ? 'Exercise · Review' : null,
    renalWord ? `Kidney nutrition · ${renalWord}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const statusSeverity =
    safetyStatus === 'verified' && !exerciseReview
      ? 'ok'
      : safetyStatus === 'violation' || safetyStatus === 'conflict'
        ? 'danger'
        : safetyStatus === 'unchecked'
          ? 'info'
          : 'caution';
  const hhmm = (h: number) =>
    `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

  return (
    <>
      <ResponsivePanel
        open={open}
        onClose={onClose}
        title={START_COPY.title(title)}
        footer={
          <Key
            variant="primary"
            block
            onClick={() => (live ? setConfirming(true) : void start())}
            disabledReason={cannotStart ? startReason : undefined}
          >
            {live ? START_COPY.replace : START_COPY.start}
          </Key>
        }
        defaultDetent="full"
      >
        <div className="lv-start">
          <div className="lv-start__preview" aria-label="Plan preview">
            <MonoMeta tone="ink">
              {schedule.horizonDays} days · {fmtDay(startDate)} –{' '}
              {fmtDay(addDays(startDate, schedule.horizonDays - 1))}
            </MonoMeta>
            <DottedTrack
              label="Plan length"
              value={track.value}
              goal={track.to}
              to={track.to}
              dots={track.dots}
              valueText={`Day 1 of ${track.to}`}
              goalText={`${track.to} days`}
              hue="plan"
            />
            <DayDots days={days} />
          </div>
          <div className="lv-start__status">
            <StatusMark severity={statusSeverity} size={16} />
            <MonoMeta tone="ink">{statusLine}</MonoMeta>
            <InfoKey
              label="About Safety check"
              onClick={() => setSafetyInfoOpen(true)}
              expanded={safetyInfoOpen}
            />
            {safetyAction && (safetyAction !== 'editScenario' || scenario) ? (
              <Key size="sm" variant="outlined" onClick={() => runSafetyAction(safetyAction)}>
                {START_SAFETY_ACTION_LABEL[safetyAction]}
              </Key>
            ) : null}
          </div>
          <Field label={START_COPY.name}>
            <TextInput value={shownName} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </Field>
          {scenario ? (
            <Section label="Plan mode">
              <Switch
                checked={experimentalTracking}
                onChange={(on) => { setExperimentalTracking(on); setRefused(null); }}
                label="Experimental tracking"
                labelStyle="sentence"
              />
              {experimentalTracking ? <p className="lv-start__note">Track your chosen routine with model limits in Plan Details. This exact program and forecast are unvalidated; medical restrictions still apply.</p> : null}
            </Section>
          ) : null}
          <Section label={START_COPY.startDate}>
            <KeyBank
              className="lv-start__when"
              label={START_COPY.startDate}
              value={when}
              onChange={setWhen}
              options={[
                { value: 'today', label: START_COPY.startChoices.today },
                { value: 'tomorrow', label: START_COPY.startChoices.tomorrow },
                { value: 'nextMonday', label: START_COPY.startChoices.nextMonday },
                { value: 'pick', label: START_COPY.startChoices.pick },
              ]}
            />
            {when === 'pick' ? (
              <Field label="Date" help={`Up to ${fmtDay(choices.latest)}`}>
                <TextInput
                  type="date"
                  value={picked}
                  min={choices.today}
                  max={choices.latest}
                  onChange={(e) => e.target.value && setPicked(e.target.value)}
                />
              </Field>
            ) : null}
            <p className="lv-start__note" role={preview.ok ? undefined : 'alert'}>
              {preview.ok
                ? (preview.anchorNotes[0] ??
                  `Starts ${fmtDay(startDate)}${daysBetween(today, startDate) === 1 ? ' (tomorrow)' : ''}`)
                : preview.reason}
            </p>
          </Section>
          <Section label={START_COPY.checkInDay}>
            <KeyBank
              label={START_COPY.checkInDay}
              value={String(checkInDay)}
              onChange={setCheckIn}
              options={WD}
              size="sm"
            />
          </Section>
          {/* a clock time, not a duration (r068 SS2) */}
          <Field label={START_COPY.weighInTime}>
            <TextInput
              type="time"
              className="lv-start__time"
              value={weighIn !== null ? hhmm(weighIn) : ''}
              min="04:00"
              max="12:00"
              step={900}
              onChange={(e) => {
                const m = /^(\d{2}):(\d{2})/.exec(e.target.value);
                if (!m) return;
                const h = Number(m[1]) + Number(m[2]) / 60;
                if (h >= 4 && h <= 12) setWeighIn(Math.round(h * 4) / 4);
              }}
            />
          </Field>
          <Section label={START_COPY.trainingDays}>
            {/* seven segments, several on: on is the gold tile, off is plain (r068 SS2) */}
            <div className="lv-start__days" role="group" aria-label={START_COPY.trainingDays}>
              {WD.map((d) => {
                const w = Number(d.value) as Weekday;
                const on = days.includes(w);
                return (
                  <button
                    key={d.value}
                    type="button"
                    className="lv-start__day"
                    aria-pressed={on}
                    onClick={() => setDays((cur) => (on ? cur.filter((x) => x !== w) : [...cur, w].sort()))}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </Section>
          <Section label={START_COPY.ifMissed}>
            <KeyBank
              className="lv-start__missed"
              label={START_COPY.ifMissed}
              value={missed}
              onChange={setMissed}
              options={[
                { value: 'nextDay', label: START_COPY.missedChoices.nextDay },
                { value: 'skip', label: START_COPY.missedChoices.skip },
                { value: 'shorter', label: START_COPY.missedChoices.shorter },
              ]}
            />
          </Section>
        </div>
      </ResponsivePanel>
      <InfoPanel {...infoSpec(INFO.safety)} open={safetyInfoOpen} onClose={() => setSafetyInfoOpen(false)} />
      {live ? (
        <TypedConfirmDialog
          open={confirming}
          onClose={() => setConfirming(false)}
          title={START_COPY.replaceTitle(live.name)}
          body={START_COPY.replaceBody}
          word="replace"
          instruction={START_COPY.replaceType}
          confirmLabel={START_COPY.replaceKey}
          onConfirm={() => {
            setConfirming(false);
            void start();
          }}
        />
      ) : null}
    </>
  );
}
