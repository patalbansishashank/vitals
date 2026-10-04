import { SEED_CATALOGUE } from '@/content/catalogues';
import type { TodayView } from '@/living';
import { STUB_STIMULUS_CONTEXT, STUB_TRAINING_PROFILE, fixturePlan, fixturePrescription } from '../../data/fixtures';
import {
  EMPTY_DRAFT,
  catalogueWeekday,
  equipmentShort,
  needsText,
  parseDone,
  parseSwapParam,
  prescriptionOf,
  resolveTyped,
  rxWords,
  sessionLogPlan,
  sessionModels,
  shortName,
  swapParam,
  weekRows,
  type TrainSetup,
} from '../session';

const setup: TrainSetup = { profile: STUB_TRAINING_PROFILE, ctx: STUB_STIMULUS_CONTEXT, catalogue: SEED_CATALOGUE };
const WED = '2026-09-30';

describe('train view models', () => {
  it('names exercises and equipment in short, honest forms', () => {
    expect(shortName('Dand (Hindu push-up)')).toBe('dand');
    expect(shortName('Mudgar swing, single heavy club two-handed')).toBe('mudgar swing');
    expect(shortName('TRX row')).toBe('TRX row');
    expect(equipmentShort({ name: 'Mudgar, single heavy (two-hand)' })).toBe('mudgar');
    expect(equipmentShort({ name: 'Yoga / exercise mat' })).toBe('exercise mat');
    expect(equipmentShort({ name: 'Backpack loaded with books/water' })).toBe('backpack');
    expect(needsText(['kettlebell'], SEED_CATALOGUE)).toBe('needs a kettlebell (you don’t have one)');
  });

  it('parses what was typed', () => {
    expect(parseDone('wooden wheel rollouts 3 × 10')).toEqual({ name: 'wooden wheel rollouts', sets: 3, reps: 10 });
    expect(parseDone('stairs 20 min')).toEqual({ name: 'stairs', minutes: 20 });
    expect(parseSwapParam(swapParam('13:0', 2))).toEqual({ slotKey: '13:0', index: 2 });
    expect(parseSwapParam('nope')).toBeNull();
  });

  it('maps living weekdays (Monday first) to the catalogue’s (Sunday first)', () => {
    expect(catalogueWeekday('2026-09-28')).toBe(1); // Monday
    expect(catalogueWeekday('2026-10-04')).toBe(0); // Sunday
  });

  it('composes a session from the engine prescription when the plan carries none', () => {
    const rx = fixturePrescription(fixturePlan('2026-10-01'), WED);
    const bare = { ...rx, sessions: rx.sessions.map((s) => ({ ...s, concrete: null })) };
    const p = prescriptionOf(bare.sessions[0]!, WED);
    expect(p).toMatchObject({ kind: 'resistance', maxMin: 45, weekday: 3, setsByRegion: { chest: 3, quads: 3 } });
    const [m] = sessionModels(bare, WED, setup);
    expect(m?.composedHere).toBe(true);
    expect(m?.session.items.length).toBeGreaterThan(0);
    expect(m?.noun).toBe('lift');
  });

  it('lists a composed-here session in the week with the minutes the session shows (LIV-11)', () => {
    const rx = fixturePrescription(fixturePlan('2026-10-01'), WED);
    const bare = { ...rx, sessions: rx.sessions.map((s) => ({ ...s, concrete: null })) };
    const view = { prescription: bare, logged: { items: [] } } as unknown as TodayView;
    const [m] = sessionModels(bare, WED, setup);
    const [row] = weekRows([WED], [view], '2026-10-01', setup);
    expect(row!.sessions[0]).toMatchObject({ noun: 'lift', minutes: m!.minutes });
    // without the setup it falls back to the plan slot's minutes
    expect(weekRows([WED], [view], '2026-10-01')[0]!.sessions[0]!.minutes).toBe(bare.sessions[0]!.durationMin);
  });

  it('writes prescriptions in plain words', () => {
    const rx = fixturePrescription(fixturePlan('2026-10-01'), WED);
    const [m] = sessionModels(rx, WED, setup);
    const dand = m!.session.items[0]!;
    expect(rxWords(dand, SEED_CATALOGUE.exercise(dand.exerciseId), { energy: true })).toBe('4 × 20 · rest 120 s · leave 2 reps in the tank');
  });

  it('counts untouched exercises as planned and credits by equivalence', () => {
    const rx = fixturePrescription(fixturePlan('2026-10-01'), WED);
    const [m] = sessionModels(rx, WED, setup);
    const all = sessionLogPlan(m!, EMPTY_DRAFT, setup);
    expect(all.status).toBe('done');
    expect(all.result.credit).toBe(1);
    expect(all.done).toBe(all.total);
    const skipped = sessionLogPlan(m!, { ...EMPTY_DRAFT, skips: { 0: true } }, setup);
    expect(skipped.done).toBe(all.total - 1);
    expect(skipped.result.credit).toBeLessThan(1);
    const chips = sessionLogPlan(m!, { ...EMPTY_DRAFT, logs: { 0: { kind: 'chips', done: [true, true, false, false] } } }, setup);
    expect(chips.performed[0]).toMatchObject({ exerciseId: 'dand', setCount: 2 });
  });

  it('resolves free text into a new record, never rejecting it', () => {
    const r = resolveTyped('wooden wheel rollouts 3 × 10', SEED_CATALOGUE);
    expect(r.isNew).toBe(true);
    expect(r.record.id).toBe('user-wooden-wheel-rollouts');
    expect(r.record.name).toBe('wooden wheel rollouts');
    const known = resolveTyped('dand', SEED_CATALOGUE);
    expect(known.isNew).toBe(false);
    expect(known.record.id).toBe('dand');
  });
});
