/**
 * "Start this plan" and its start sheet (design/screens/plan-ladder.md §6.7; COMPONENTS §13.19; IA §4.7): plan name,
 * start date (today · tomorrow · next Monday · pick a date ≤ 28 days) with the anchoring note, weekly check-in day,
 * weigh-in time, training days, what to do if a session is missed, things to do before day 1. Starting builds the
 * plan documents through `plan.start` (the preview — anchoring note, start-date check — uses E5's pure start function,
 * `startPlanFromOption`), lands on Today and offers Undo (`plan.discard`) in the toast. With a plan already running the
 * key reads "Replace active plan…", needs the typed word and dispatches `plan.replace` (the old plan stays restorable for
 * 7 days). The scenario variant (`scenario` prop; IA §4.7 "Simulator scenario → Start this plan", SUITE_SPEC §3.1) starts
 * a Simulator scenario as a `custom` plan through `plan.start { source: { scenarioId } }` (E5's `startFromScenario`); its
 * preview is the calendar anchoring of the scenario's schedule.
 */
import '../living.css';
import './start.css';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Chip, Engraved, Field, Key, KeyBank, ResponsivePanel, Section, Stepper, TextInput, toast } from '@/components';
import type { PersonProfile, Schedule } from '@/engine';
import { habitualSessionsFor } from '@/engine/core/compileSchedule';
import { resolveProfile } from '@/engine/core/resolveProfile';
import { usePersonProfile } from '@/state/profileStore';
import type { PlanOption, PlannerRequest } from '@/engine/planner/domain/types';
import { dispatch, mintConfirmation } from '@/commands';
import { sendCommand } from '@/features/lib/sendCommand';
import { startPlanFromOption } from '@/features/planner/startPlan';
import { RUNG_OF_OPTION, addDays, anchorSchedule, daysBetween, isAllowedStartDate, startDateChoices, templateOfDay, weekdayOf, type LocalDate, type PlannerProvenanceV2, type Weekday } from '@/living';
import { currentDay, useLivingClock } from '../clock';
import { START_COPY } from '../copy';
import { fmtDay, fmtMonth } from '../format';
import { useActivePlan } from '../mode';
import { TypedConfirmDialog } from '../components/TypedConfirmDialog';

const RUNG_TITLE = { hard: 'Hard', medium: 'Medium', easy: 'Easy' } as const;
const WD: Array<{ value: string; label: string }> = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d, i) => ({ value: String(i), label: d }));

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

export type StartPlanSheetProps = (StartPlanEntryProps | ScenarioStartProps) & { open: boolean; onClose: () => void };

/** The entry key on the planner results + its sheet. */
export function StartPlanEntry(p: StartPlanEntryProps) {
  const [open, setOpen] = useState(false);
  const live = useActivePlan();
  return (
    <div className="lv-start-entry">
      <Key onClick={() => setOpen(true)} disabledReason={p.stale ? 'Find plans again first: these plans were made for different goals or limits.' : undefined}>
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
  const startDate = when === 'today' ? choices.today : when === 'tomorrow' ? choices.tomorrow : when === 'nextMonday' ? choices.nextMonday : picked;
  const [name, setName] = useState<string | null>(null);
  const shownName = name ?? (option ? START_COPY.defaultName(title, fmtMonth(startDate)) : scenario!.name);
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const checkInDay = (checkIn !== null ? Number(checkIn) : weekdayOf(startDate)) as Weekday;
  const [weighIn, setWeighIn] = useState<number | null>(7);
  const profile = usePersonProfile();
  const [days, setDays] = useState<Weekday[]>(() => trainingWeekdays(schedule, habitualWeekdays(profile)));
  const [missed, setMissed] = useState<'nextDay' | 'skip' | 'shorter'>('nextDay');
  const [confirming, setConfirming] = useState(false);

  const intentions = { ...(weighIn !== null ? { weighInClockH: weighIn } : {}), trainingWeekdays: days, missedSessionPlan: missed };
  // Pure and cheap (anchoring + the forecast digest): recomputed on every change to show the anchoring note.
  let preview: { ok: true; anchorNotes: string[] } | { ok: false; reason: string };
  if (option && 'request' in props) {
    const ctx = {
      planId: `plan-${today}-${option.id.toLowerCase()}`,
      now: `${today}T12:00:00.000Z`,
      today,
      createdBy: { kind: 'user' as const },
      versions: { engineVersion: option.simulation.meta.engineVersion, registryHash: option.simulation.meta.registryHash, catalogueVersion: 'seed' },
    };
    preview = startPlanFromOption(ctx, option, props.request, props.provenance, { startDate, name: shownName, intentions, checkInWeekday: checkInDay });
  } else if (!isAllowedStartDate(today, startDate)) preview = { ok: false, reason: 'The start date must be today or within the next 28 days.' };
  else preview = { ok: true, anchorNotes: anchorSchedule(schedule, startDate).notices };
  const blocked = 'disabledReason' in props ? props.disabledReason : undefined;

  const [busy, setBusy] = useState(false);
  const start = async () => {
    const source = scenario ? { scenarioId: scenario.id } : { rung };
    const input = { source, startDate, name: shownName, intentions, checkInWeekday: checkInDay };
    setBusy(true);
    let r;
    if (live) {
      const replace = { ...input, reason: 'replaced' as const };
      r = await dispatch('plan.replace', replace, { confirmation: mintConfirmation('plan.replace', replace) });
    } else r = await dispatch('plan.start', input);
    setBusy(false);
    if (!r.ok || !('output' in r)) {
      toast((!r.ok && r.error.message) || START_COPY.failed);
      return;
    }
    const planId = (r.output as { planId: string }).planId;
    onClose();
    navigate('/today');
    const whenText = startDate === today ? 'today' : startDate === addDays(today, 1) ? 'tomorrow' : `on ${fmtDay(startDate)}`;
    toast(START_COPY.startsToast(shownName, whenText), {
      duration: 10000,
      action: { label: START_COPY.undo, onClick: () => void sendCommand('plan.discard', { planId }) },
    });
  };

  const footer = (
    <>
      <Key onClick={onClose}>{'Cancel'}</Key>
      <Key variant="solid" onClick={() => (live ? setConfirming(true) : void start())} disabledReason={busy ? START_COPY.starting : (blocked ?? (preview.ok ? undefined : preview.reason))}>
        {live ? START_COPY.replace : START_COPY.start}
      </Key>
    </>
  );

  return (
    <>
      <ResponsivePanel open={open} onClose={onClose} title={START_COPY.title(title)} footer={footer} defaultDetent="full">
        <div className="lv-start">
          <Field label={START_COPY.name}>
            <TextInput value={shownName} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </Field>
          <Section label={START_COPY.startDate.toLowerCase()}>
            <KeyBank
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
              <Field label="date" help={`Up to ${fmtDay(choices.latest)}.`}>
                <TextInput type="date" value={picked} min={choices.today} max={choices.latest} onChange={(e) => e.target.value && setPicked(e.target.value)} />
              </Field>
            ) : null}
            <p className="lv-start__note">
              {preview.ok ? (preview.anchorNotes[0] ?? `Starts ${fmtDay(startDate)}${daysBetween(today, startDate) === 1 ? ' (tomorrow)' : ''}.`) : preview.reason}
            </p>
          </Section>
          <Section label={START_COPY.checkInDay.toLowerCase()}>
            <KeyBank label={START_COPY.checkInDay} value={String(checkInDay)} onChange={setCheckIn} options={WD} size="sm" />
          </Section>
          <Field label={START_COPY.weighInTime} help="Morning, after the bathroom, before eating.">
            <Stepper value={weighIn} onChange={setWeighIn} min={4} max={12} step={0.25} decimals={2} name="weigh-in time" unit="h" />
          </Field>
          <Section label={START_COPY.trainingDays.toLowerCase()}>
            <div className="lv-start__days" role="group" aria-label={START_COPY.trainingDays}>
              {WD.map((d) => {
                const w = Number(d.value) as Weekday;
                const on = days.includes(w);
                return (
                  <Chip key={d.value} kind="filter" pressed={on} onPressedChange={(p) => setDays((cur) => (p ? [...cur, w].sort() : cur.filter((x) => x !== w)))}>
                    {d.label}
                  </Chip>
                );
              })}
            </div>
          </Section>
          <Section label={START_COPY.ifMissed.toLowerCase()}>
            <KeyBank
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
          <Section label={START_COPY.beforeDay1.toLowerCase()}>
            <p className="lv-start__note">{START_COPY.nothingToBuy}</p>
            <p className="lv-start__note">{START_COPY.groceries}</p>
          </Section>
          <Engraved>
            {scenario
              ? 'Starting copies this schedule as it is now; later edits to the scenario don’t change the plan.'
              : 'Starting from the Planner keeps this plan’s goals as fixed targets from your starting point.'}
          </Engraved>
        </div>
      </ResponsivePanel>
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
