/**
 * A hand-written Today contract (E5's `TodayView`, docs/SUITE_SPEC.md §3.9) for a lift day — synthetic numbers.
 * Built independently of the in-memory stand-in so the screen is tested against the contract itself.
 */
import type { TodayView } from '@/living';
import { fixturePlan, fixturePrescription } from '../../data/fixtures';

export const CONTRACT_DATE = '2026-09-30'; // a Wednesday: lift at 17:30

export function todayViewFixture(over: Partial<TodayView> = {}): TodayView {
  const plan = fixturePlan('2026-10-01');
  const rx = fixturePrescription(plan, CONTRACT_DATE, 'UTC');
  const slot = rx.sessions[0]!.slotKey;
  const lunch = rx.meals[0]!;
  return {
    date: CONTRACT_DATE,
    tz: 'UTC',
    rolloverH: 4,
    mode: 'living',
    minimalMode: false,
    quietMode: false,
    plan: { id: plan.id, name: 'Spring cut', rung: 'medium', day: 14, of: 84, status: 'active', version: 3 },
    prescription: rx,
    logged: {
      entries: [{ id: 'e1', kind: 'meal', clockH: 12.6, label: 'dal, rice, curd', energyKcal: { value: 640, sd: 100 }, source: 'ai', aiEstimated: true, confidence: 0.8 }],
      totals: { energyKcal: { value: 640, sd: 100 }, proteinG: { value: 33, sd: 6 }, carbG: { value: 80, sd: 15 }, fatG: { value: 20, sd: 6 }, fibreG: { value: 8, sd: 2 } },
      items: [
        { itemId: 'energy', status: 'unknown' },
        { itemId: 'protein', status: 'unknown' },
        { itemId: 'window', status: 'done', credit: 1 },
        { itemId: `rtSession:${slot}`, status: 'partial', credit: 0.6 },
        { itemId: 'steps', status: 'partial', credit: 0.68 },
        { itemId: 'sleep', status: 'unknown' },
        { itemId: 'supplement:creatine', status: 'unknown' },
      ],
      steps: 6120,
    },
    remaining: { energyKcal: rx.energyKcal - 640, proteinG: rx.macros.proteinG - 33, carbG: rx.macros.carbG - 80, fatG: rx.macros.fatG - 20 },
    checklist: [
      { id: 'weigh', at: 7, kind: 'weigh', label: 'Weigh in', done: true, command: { id: 'log.measurement', input: { date: CONTRACT_DATE, metric: 'weightKg' } } },
      { id: 'mark:all', kind: 'mark', label: 'Day as planned', done: false, command: { id: 'log.markDay', input: { date: CONTRACT_DATE, marks: { all: 'asPlanned' } } } },
      { id: `meal:${lunch.slot}`, at: lunch.clockH, kind: 'meal', label: 'lunch', done: true, command: { id: 'log.meal', input: {} } },
      { id: 'meal:snack', at: 16.5, kind: 'meal', label: 'snack', done: false, command: { id: 'log.meal', input: {} } },
      { id: `session:${slot}`, at: 17.5, kind: 'session', label: 'Strength session', done: true, command: { id: 'log.session', input: {} } },
      { id: 'meal:dinner', at: 19.5, kind: 'meal', label: 'dinner', done: false, command: { id: 'log.meal', input: {} } },
      { id: 'supplement:creatine', kind: 'supplement', label: 'creatine', done: false, command: { id: 'log.supplement', input: {} } },
      { id: 'steps', kind: 'steps', label: 'Steps', done: true, command: { id: 'log.steps', input: {} } },
      { id: 'sleep', kind: 'sleep', label: 'Last night’s sleep', done: false, command: { id: 'log.sleep', input: {} } },
    ],
    adherence: {
      today: {
        score: 62,
        coverage: 0.45,
        final: false,
        items: rx.items.map((it) => ({
          itemId: it.itemId,
          type: it.type,
          weight: it.weight,
          credit: it.itemId === 'window' ? 1 : it.type === 'rtSession' ? 0.6 : it.itemId === 'steps' ? 0.68 : null,
          why: it.itemId,
        })),
      },
      a7: 84,
      a28: 81,
      daysLogged7: 6,
      spark: [80, 84, 90],
    },
    drift: [{ metric: 'scaleWeight', state: 'onTrack', goalDate: { range: ['2026-12-21', '2026-12-30'], shiftDays: 9, shiftSd: 6 }, text: 'On track.' }],
    trendWeight: { kg: 83.1, sd: 0.3, todayExpected: { p10: 82.8, p50: 83.2, p90: 83.6 }, measured: 83.4 },
    checkIn: { due: false, lastAt: '2026-09-24' },
    biometrics: null,
    notices: [],
    coachPrompts: ['log dinner as planned', 'why is my weight up?'],
    ...over,
  };
}
