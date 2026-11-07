/**
 * The (i) texts of the Ring overview's cards and of Today's ring cards (r071, AUDIT cards 2, 3, 30, 31, 33): what used to be
 * subtext, plain and second person, with where it comes from and the range it is read against. In quiet mode a text carries
 * no digit and the tables of numbers (a range, a Table twin) are left out.
 */
import type { ReactNode } from 'react';
import { ChartTwin, MonoMeta, type InfoSpec, type TwinData } from '@/components';
import { paths } from '@/app/paths';
import { METRICS, minutesText, type RingMetric, type UnitPrefs } from '../model';
import { bandRows } from '../signalWords';
import '../views/overview.css';

const SLEEP_EVIDENCE = { to: paths.mechanism('16-sleep-deficit-dynamics'), label: 'Sleep debt: how Vitals counts short sleep and how fast it builds and clears' };
const HEART_EVIDENCE = { to: paths.mechanism('19-resting-heart-rate-and-hrv'), label: 'Resting heart rate and heart-rate variability' };

/** Last night's sleep (the Overview card, Today's card): time asleep, the stages, the goal. */
export function sleepInfo(o: { goalMin: number; goalSource: 'plan' | 'default' | 'ring' | 'setting'; quiet: boolean; twin?: TwinData | null; footer?: ReactNode }): InfoSpec {
  const fromPlan = o.goalSource === 'plan';
  const goal = o.quiet
    ? fromPlan
      ? 'Your goal comes from the sleep window in your plan.'
      : 'Your goal is the default until your plan sets a sleep window.'
    : `Your goal is ${minutesText(o.goalMin)}${fromPlan ? ', from the sleep window in your plan' : ', the default until your plan sets a sleep window'}.`;
  return {
    title: "Last night's sleep",
    body: `Time asleep from the ring, not time in bed. The stages are the ring's own: ${o.quiet ? 'deep and REM are' : 'Deep and REM are'} estimates, and a night with gaps shows a range. ${goal} Open the card for the night's timing, heart rate and the last four weeks.`,
    source: { kind: 'ring', words: 'Stages and times as the ring recorded them; awake time is left out of the hours asleep.' },
    range: o.quiet ? undefined : `Your goal: ${minutesText(o.goalMin)} (limits 7 to 12 h)`,
    terms: [{ term: 'Deep and REM', text: 'Estimated by the ring from its sensors. A guide to how the night went, not a measurement.' }],
    evidence: SLEEP_EVIDENCE,
    twin: o.twin && !o.quiet ? <ChartTwin data={o.twin} /> : undefined,
    footer: o.footer,
  };
}

/** The band words of the fixed-band signals as one small table: word, range (the ring's words never change meaning). */
function BandTables({ prefs }: { prefs: UnitPrefs }) {
  const kinds: RingMetric[] = ['hr', 'spo2', 'stress'];
  return (
    <div className="rgo-bandtable">
      {kinds.map((k) => (
        <section key={k} aria-label={METRICS[k].label}>
          <MonoMeta tone="ink">{METRICS[k].label}</MonoMeta>
          <dl>
            {bandRows(k, prefs).map((r) => (
              <div key={r.word}>
                <dt>{r.word}</dt>
                <dd>{r.range}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** Signals (the Overview card) and the Ring glance on Today: what the words mean and how fresh a reading is. */
export function signalsInfo(o: { quiet: boolean; prefs: UnitPrefs; title?: string; footer?: ReactNode }): InfoSpec {
  return {
    title: o.title ?? 'What the words mean',
    body: o.quiet
      ? 'Readings come from the ring; the age beside each says how fresh it is, and a reading turns stale after a while, sooner when the ring samples often. Heart rate, blood oxygen and stress use fixed bands. HRV and skin temperature are compared with your own usual night once a week of nights is in.'
      : 'Readings come from the ring; the age beside each says how fresh it is, and a reading turns stale after 30 minutes to 6 hours, depending on how often the ring samples. Heart rate, blood oxygen and stress use the fixed bands below. HRV and skin temperature are compared with your own usual night once 7 nights are in.',
    source: { kind: 'ring', words: 'Readings and the nights behind your usual come from the ring through your phone.' },
    range: o.quiet ? undefined : <BandTables prefs={o.prefs} />,
    evidence: HEART_EVIDENCE,
    footer: o.footer,
  };
}

/** The slim note where Today's ring cards would be: why there are none, and what to do. No digits, so quiet needs no variant. */
export function noteInfo(sentence: string, footer?: ReactNode): InfoSpec {
  return {
    title: 'No ring data',
    body: [
      { body: sentence },
      { body: "Your ring's readings reach Vitals through your server, so this device has to reach it. Ring cards fill in a few minutes after your phone syncs. If this device is not connected to a server yet, connect it in Settings › Sync." },
    ],
    source: { kind: 'ring', words: 'Nothing has arrived yet.' },
    footer,
  };
}
