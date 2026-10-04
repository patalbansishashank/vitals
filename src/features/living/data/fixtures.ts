/**
 * Synthetic fixture data for Living mode (all numbers, names and dates are synthetic examples, not real data):
 * a "Spring cut · medium" plan two weeks in, its weekly prescription, a deterministic history of marks and weigh-ins,
 * and the training setup Train composes sessions for. Used by the in-memory stand-in (`./stub`), the tests, and the
 * demo plan. Deterministic: everything derives from the dates.
 */
import { composeSession, type ConcreteSession, type StimulusContext, type TrainingProfile } from '@/catalogues';
import { SEED_CATALOGUE } from '@/content/catalogues';
import { DEFAULT_ITEM_WEIGHTS, ITEM_WEIGHT_FLOOR, addDays, daysBetween, localToInstant, weekdayOf } from '@/living';
import type { LocalDate, PlanItemType, PrescribedDaySnapshot, PrescribedItem, PrescribedSession, Weekday } from '@/living';
import type { ActivePlan } from '../activePlan';

/** The fixture's "today" (synthetic). */
export const FIXTURE_TODAY: LocalDate = '2026-10-01';

/** "Spring cut · medium", day 15 of 84 on `today`. */
export function fixturePlan(today: LocalDate = FIXTURE_TODAY, opts: { status?: ActivePlan['status']; dayIndex?: number } = {}): ActivePlan {
  const start = addDays(today, -(opts.dayIndex ?? 14));
  return {
    id: 'plan-fixture-spring-cut',
    name: 'Spring cut',
    rung: 'medium',
    status: opts.status ?? 'active',
    startDate: start,
    plannedEndDate: addDays(start, 84),
    headVersion: 3,
    pauses: opts.status === 'paused' ? [{ from: addDays(today, -2), to: null }] : [],
    intentions: { weighInClockH: 7, trainingWeekdays: [0, 2, 4], missedSessionPlan: 'nextDay' },
    policy: { checkInWeekday: weekdayOf(today) as Weekday, autoApplyLoadLowering: true },
    createdAt: `${start}T08:00:00.000Z`,
  };
}

/** The training setup Train composes for (TODO(E7b): read the intake's equipment and places). */
export const STUB_TRAINING_PROFILE: TrainingProfile = {
  owned: ['mudgar_heavy', 'floor_mat', 'backpack', 'stairs'],
  access: [{ place: 'home', equipment: ['mudgar_heavy', 'floor_mat', 'backpack', 'stairs'], weekdays: [0, 1, 2, 3, 4, 5, 6] }],
  refused: [],
  liked: ['indian'],
  injuries: [],
  skill: 3,
  purchaseAllowance: { maxPriceTier: 2, maxItems: 2 },
  loadsKg: { mudgar_heavy: [10], backpack: [8] },
};

/** Body context for stimulus and energy (TODO(E5): the trend weight and the engine's VO2max state). */
export const STUB_STIMULUS_CONTEXT: StimulusContext = { bodyMassKg: 83.4, vo2max: 40, heightM: 1.76 };

/** Deterministic [0, 1) from a string (FNV-1a). */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 100000) / 100000;
}

const RT_DAYS: readonly number[] = [0, 2, 4];
const CARDIO_DAYS: readonly number[] = [1, 5];

function weights(types: readonly PlanItemType[]): number[] {
  const raw = types.map((t) => Math.max(ITEM_WEIGHT_FLOOR, DEFAULT_ITEM_WEIGHTS[t]));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / sum);
}

const composed = new Map<string, ConcreteSession>();
/**
 * The composed session of a fixture slot (cached; the catalogue composer is pure). `livingWeekday` is the living calendar's
 * (0 = Monday); the catalogue counts from Sunday, so it is converted here.
 */
export function fixtureSession(kind: 'resistance' | 'cardio', livingWeekday: number): ConcreteSession {
  const key = `${kind}:${livingWeekday}`;
  const weekday = (livingWeekday + 1) % 7;
  let s = composed.get(key);
  if (!s) {
    s =
      kind === 'resistance'
        ? composeSession(
            { kind: 'resistance', weekday: weekday as Weekday, startH: 17.5, maxMin: 45, setsByRegion: { chest: 3, upperBack: 3, quads: 3, glutes: 2, shoulders: 2, core: 2 } },
            { profile: STUB_TRAINING_PROFILE, catalogue: SEED_CATALOGUE, ctx: STUB_STIMULUS_CONTEXT },
          )
        : composeSession(
            { kind: 'cardio', weekday: weekday as Weekday, startH: 7.5, modality: 'walk', minutes: 35, pctVo2max: 0.5 },
            { profile: STUB_TRAINING_PROFILE, catalogue: SEED_CATALOGUE, ctx: STUB_STIMULUS_CONTEXT },
          );
    composed.set(key, s);
  }
  return s;
}

/** The fixture prescription of a date (a 16:8 window, three meals, lifts Mon/Wed/Fri, walks Tue/Sat). */
export function fixturePrescription(plan: Pick<ActivePlan, 'id' | 'startDate' | 'headVersion'>, date: LocalDate, tz = 'UTC'): PrescribedDaySnapshot {
  const w = weekdayOf(date);
  const d = daysBetween(plan.startDate, date);
  const rt = RT_DAYS.includes(w);
  const cardio = CARDIO_DAYS.includes(w);
  const energyKcal = rt ? 2050 : 1850;
  const proteinG = 150;
  const fatG = 70;
  const fibreG = 30;
  const carbG = Math.round((energyKcal - proteinG * 4 - fatG * 9 - fibreG * 2) / 4);
  const share = [0.37, 0.19, 0.44];
  const clock = [12.5, 16.5, 19.5];
  const slots = ['lunch', 'snack', 'dinner'];
  const meals = slots.map((slot, k) => ({
    slot,
    clockH: clock[k]!,
    energyKcal: Math.round(energyKcal * share[k]!),
    proteinG: Math.round(proteinG * share[k]!),
    carbG: Math.round(carbG * share[k]!),
    fatG: Math.round(fatG * share[k]!),
  }));
  const sessions: PrescribedSession[] = [];
  if (rt || cardio) {
    const concrete = fixtureSession(rt ? 'resistance' : 'cardio', w);
    const startH = rt ? 17.5 : 7.5;
    sessions.push({
      slotKey: `${d}:0`,
      startH,
      kind: rt ? 'resistance' : 'cardio',
      durationMin: rt ? 45 : 35,
      concrete,
      stimulus: concrete.delivered,
      engine: rt
        ? [{ kind: 'resistance', startH, durationMin: 45, setsByRegion: { chest: 3, upperBack: 3, quads: 3, glutes: 2, shoulders: 2, core: 2 } }]
        : [{ kind: 'cardio', modality: 'walk', startH, durationMin: 35, pctVo2max: 0.5 }],
    });
  }
  const raw: Array<{ itemId: string; type: PlanItemType; target: Record<string, number> }> = [
    { itemId: 'energy', type: 'energy', target: { energyKcal, maintenanceKcal: 2450 } },
    { itemId: 'protein', type: 'protein', target: { proteinG } },
    { itemId: 'window', type: 'window', target: { startH: 12, endH: 20 } },
  ];
  for (const s of sessions) raw.push({ itemId: `${s.kind === 'resistance' ? 'rtSession' : 'cardioSession'}:${s.slotKey}`, type: s.kind === 'resistance' ? 'rtSession' : 'cardioSession', target: { durationMin: s.durationMin } });
  raw.push({ itemId: 'steps', type: 'steps', target: { steps: 9000 } }, { itemId: 'sleep', type: 'sleep', target: { hours: 7.5 } }, { itemId: 'supplement:creatine', type: 'supplement', target: { dose: 5 } });
  const ws = weights(raw.map((r) => r.type));
  const items: PrescribedItem[] = raw.map((r, k) => ({ ...r, weight: ws[k]! }));
  void tz;
  return {
    planId: plan.id,
    version: plan.headVersion,
    planDay: d,
    dayType: rt ? 'training day' : cardio ? 'walking day' : 'rest day',
    energyKcal,
    macros: { proteinG, carbG, fatG, fibreG },
    window: { startH: 12, endH: 20 },
    meals,
    sessions,
    steps: 9000,
    sleep: { bedH: 23, wakeH: 6.5 },
    supplements: [{ supplementId: 'creatine', dose: 5, unit: 'g' }],
    items,
    template: {
      id: rt ? 'train' : 'rest',
      label: rt ? 'training day' : 'rest day',
      energy: { kind: 'kcal', kcal: energyKcal },
      macros: { protein: { unit: 'g', value: proteinG }, carbs: { unit: 'remainder' }, fat: { unit: 'g', value: fatG }, fibre: { unit: 'g', value: fibreG } },
      meals: { window: { startH: 12, lengthH: 8 }, meals: meals.map((m) => ({ clockH: m.clockH, share: m.energyKcal / energyKcal })) },
      exercise: sessions.flatMap((s) => s.engine),
      steps: 9000,
      sleep: { bedH: 23, wakeH: 6.5 },
      substances: { creatineG: 5 },
    },
    maintenanceKcal: 2450,
  };
}

/** Start weight and slopes of the fixture forecast (kg, kg/day). */
export const FIXTURE_WEIGHT = { start: 85.6, prescribedSlope: -0.085, realisticSlope: -0.075, goal: 79.5 } as const;

/** Synthetic weigh-in on plan day k (null on mornings without one); one flagged outlier three days back. */
export function fixtureWeighIn(startDate: LocalDate, k: number, today: LocalDate): { value: number; flagged: boolean } | null {
  const date = addDays(startDate, k);
  if (date >= today) return null;
  const r = hash01(`w:${date}`);
  if (r < 0.18) return null;
  const noise = (hash01(`n:${date}`) - 0.5) * 0.7;
  const flagged = daysBetween(date, today) === 3;
  return { value: Math.round((FIXTURE_WEIGHT.start + FIXTURE_WEIGHT.realisticSlope * 0.95 * k + noise + (flagged ? 1.6 : 0)) * 10) / 10, flagged };
}

/** Synthetic outcome of a past item: credit (null = not logged). */
export function fixtureItemCredit(date: LocalDate, itemId: string, type: PlanItemType): { status: 'done' | 'partial' | 'skipped'; credit: number } | null {
  if (hash01(`day:${date}`) < 0.1) return null; // an unlogged day: unknown, never failed
  const r = hash01(`${itemId}:${date}`);
  switch (type) {
    case 'rtSession':
    case 'cardioSession':
      return r < 0.18 ? { status: 'skipped', credit: 0 } : r < 0.3 ? { status: 'partial', credit: 0.6 } : { status: 'done', credit: 1 };
    case 'energy':
      return r < 0.25 ? { status: 'partial', credit: 0.7 } : { status: 'done', credit: 1 };
    case 'protein':
      return r < 0.3 ? { status: 'partial', credit: 0.85 } : { status: 'done', credit: 1 };
    case 'steps':
      return r < 0.4 ? { status: 'partial', credit: Math.round((0.6 + r) * 100) / 100 } : { status: 'done', credit: 1 };
    case 'sleep':
      return r < 0.35 ? { status: 'partial', credit: 0.82 } : { status: 'done', credit: 1 };
    case 'supplement':
      return r < 0.15 ? null : { status: 'done', credit: 1 };
    default:
      return { status: 'done', credit: 1 };
  }
}

/** Instant of a local clock hour on a date (fast timers). */
export function at(date: LocalDate, clockH: number, tz: string): string {
  return localToInstant(date, clockH, tz);
}
