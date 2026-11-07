/**
 * The (i) texts of the Sleep cards (r071, AUDIT cards 23 to 29): what used to be subtext and per-value popovers, plain and
 * second person, with where it comes from, the range it is read against and the table behind the picture. In quiet mode a
 * text carries no digit, and the tables of numbers (a range, a Table twin) are left out.
 */
import type { ReactNode } from 'react';
import { paths } from '@/app/paths';
import type { InfoSpec } from '@/components';
import { minutesText } from '@/features/ring/model';
import { SLEEP_COPY as C } from './copy';

const DEFICIT = { to: paths.mechanism('16-sleep-deficit-dynamics'), label: 'Sleep debt: how Vitals counts short sleep and how fast it builds and clears' };
const TIMING = { to: paths.mechanism('16-sleep-quality-timing-shift-work'), label: 'Sleep quality, late bedtimes and shift work' };
const HEART = { to: paths.mechanism('19-resting-heart-rate-and-hrv'), label: 'Resting heart rate and heart-rate variability' };

type GoalSource = 'plan' | 'default' | 'ring' | 'setting';

/** Last night, or a past night: the stages, the break, the goal and what the sleep index weighs. The stage table is its twin. */
export function nightInfo(o: { goalMin: number; goalSource: GoalSource; quiet: boolean; twin?: ReactNode; footer?: ReactNode }): InfoSpec {
  const fromPlan = o.goalSource === 'plan';
  return {
    title: "Last night's sleep",
    body: o.quiet
      ? `Time asleep from the ring, not time in bed. The stages are the ring's own: deep and REM are estimates, and a night with gaps shows a range. The sleep index weighs how long you slept, how unbroken it was and when it was against your usual. Your goal is ${fromPlan ? "your plan's sleep window" : 'the default until your plan sets one'}.`
      : `Time asleep from the ring, not time in bed. The stages are the ring's own: Deep and REM are estimates, and a night with gaps shows a range. The sleep index weighs duration 50 %, window continuity 25 % and midpoint against your usual 25 %. Your goal is ${minutesText(o.goalMin)}${fromPlan ? ', from the sleep window in your plan' : ' unless your plan sets one'}.`,
    source: { kind: 'ring', words: 'Stages and times as the ring recorded them. A night recorded in two parts is shown whole, the break between them counted as awake.' },
    range: o.quiet ? undefined : `Your goal: ${minutesText(o.goalMin)} (limits 7 to 12 h)`,
    terms: [
      { term: 'Deep and REM', text: C.restorative + ': the ring works them out from its sensors. A guide to how the night went, not a measurement.' },
      { term: 'Awake break', text: 'When the ring recorded the night in two parts, the time between them counts as awake after you fell asleep.' },
      { term: 'Incomplete night', text: 'When the ring left minutes unrecorded, the hours asleep show as a range, from the minutes it named to all it might have.' },
    ],
    evidence: DEFICIT,
    twin: o.quiet ? undefined : o.twin,
    footer: o.footer,
  };
}

/** Timing: when the night began and ended against the person's usual window, settle time, continuity. */
export function timingInfo(o: { usualText: string | null; usualNights: number | null; quiet: boolean; twin?: ReactNode; footer?: ReactNode }): InfoSpec {
  return {
    title: 'Sleep timing',
    body: o.quiet
      ? "When the ring saw you fall asleep and wake, against your usual window from your last nights. Settle time runs from the ring's first recorded minute to sleep: it is not how long you took to fall asleep, which needs your lights-out time. Window continuity is the share of the window spent asleep. Near usual means within a few minutes."
      : "When the ring saw you fall asleep and wake, against your usual window from your last nights. Settle time runs from the ring's first recorded minute to sleep: it is not how long you took to fall asleep, which needs your lights-out time. Window continuity is the share of the window spent asleep. Near usual means within 5 minutes.",
    source: { kind: 'ring', words: 'Times as the ring saw them. Your own lights-out and out-of-bed times, once you add them, give the time to fall asleep and sleep efficiency.' },
    range: o.quiet || !o.usualText ? undefined : `Your usual window: ${o.usualText}${o.usualNights ? ` over ${o.usualNights} night${o.usualNights === 1 ? '' : 's'}` : ''}`,
    terms: [
      { term: C.settle, text: C.settleInfo },
      { term: C.continuity, text: `${C.continuityInfo} ${C.continuityRange}.` },
      { term: 'Sleep midpoint', text: 'The halfway point between falling asleep and waking.' },
      { term: 'Your own times', text: C.entryNote },
    ],
    evidence: TIMING,
    twin: o.quiet ? undefined : o.twin,
    footer: o.footer,
  };
}

/** Overnight: HRV, skin temperature and blood oxygen while asleep, against the person's usual nights. */
export function overnightInfo(o: { quiet: boolean; footer?: ReactNode }): InfoSpec {
  return {
    title: 'Overnight signals',
    body: o.quiet
      ? "Your HRV, skin temperature and blood oxygen while you slept, from the ring, against your own usual nights; they need a week of nights to form. Near usual means a small step from your usual. Blood oxygen is the night's average, with the lowest reading marked."
      : "Your HRV, skin temperature and blood oxygen while you slept, from the ring, against your own usual nights; they need 7 nights to form. Near usual means within 3 ms or 10 % of your HRV and within 0.5 degrees for temperature. Blood oxygen is the night's average, with the lowest reading marked.",
    source: { kind: 'ring', words: 'The night as the ring recorded it, against your own usual nights from the weeks before.' },
    range: o.quiet ? undefined : 'Near usual: HRV within 3 ms or 10 % of your usual; skin temperature within 0.5 °C (0.9 °F) of it.',
    terms: [
      { term: C.hrv, text: 'The variation between heartbeats while you slept, in milliseconds. Higher than your usual is not always better; a drop from it is the sign to watch.' },
      { term: C.tempVsUsual, text: "Your skin temperature overnight minus your usual night's median, in the unit you chose. It is a difference, not a temperature." },
      { term: C.spo2, text: "The share of oxygen in your blood the ring's light saw, as the night's average, with the lowest reading marked." },
    ],
    evidence: HEART,
    footer: o.footer,
  };
}

/** Sleep heart rate: the night's trace, the sleeping low and what the line marks. The readings are its twin. */
export function sleepHrInfo(o: { readings: number | null; usualText: string | null; quiet: boolean; twin?: ReactNode; footer?: ReactNode }): InfoSpec {
  return {
    title: 'Heart rate while you slept',
    body: o.quiet
      ? 'Heart rate from the ring through the night. Sleeping low HR is the low end of your night, not a waking resting heart rate; the trace marks the lowest short stretch, so it can sit a little under it. With too few readings the night is too sparse to draw.'
      : 'Heart rate from the ring through the night. Sleeping low HR is the 10th percentile of your night, not a waking resting heart rate; the trace marks the lowest five-minute stretch, so it can sit a little under it. With fewer than eight five-minute readings the night is too sparse to draw.',
    source: { kind: 'ring', words: o.quiet || o.readings === null ? 'Five-minute readings from the ring through the night.' : `${o.readings} reading${o.readings === 1 ? '' : 's'} from the ring through the night.` },
    range: o.quiet || !o.usualText ? undefined : `Near usual: ${o.usualText} bpm, one spread either side of your usual sleeping low`,
    terms: [
      { term: C.lowHr, text: o.quiet ? 'The low end of your heart rate while asleep. It is not a waking resting heart rate. The trace marks the lowest short stretch, so it can sit a little under this.' : C.lowHrInfo },
      { term: 'Awake', text: 'The hatched stretches are when the ring marked you awake; the heart rate there is not asleep heart rate.' },
    ],
    evidence: HEART,
    twin: o.quiet ? undefined : o.twin,
    footer: o.footer,
  };
}

/** The history of nights (the day tab's four weeks, a period's nights): one bar a night against the goal. */
export function historyInfo(o: { goalMin: number; quiet: boolean; line?: boolean; title?: string; twin?: ReactNode; footer?: ReactNode }): InfoSpec {
  return {
    title: o.title ?? 'Sleep, last four weeks',
    body: o.line
      ? `The line is the ${o.quiet ? 'weekly' : '7-day'} average of the time you slept, from the ring (the lower bound on an incomplete night); the hairline is your goal. A night with no recording leaves a gap.`
      : 'One bar per night: time asleep from the ring (the lower bound on an incomplete night). The dashed line is your goal; the solid line is the average of the nights shown. A night with no recording has no bar.',
    source: { kind: 'ring', words: 'The main night of each day, as the ring recorded it.' },
    range: o.quiet ? undefined : `Your goal: ${minutesText(o.goalMin)}`,
    evidence: DEFICIT,
    twin: o.quiet ? undefined : o.twin,
    footer: o.footer,
  };
}
