/** D3-01 catalogue set groups: homogeneous groups, raw vs tagged region weights, provenance, time line, stimulus fields. */
import { describe, expect, it } from 'vitest';
import { aggregateStimulus, catalogueParam, resolveDose, toEngineDose, type ExerciseRecord } from '@/catalogues';
import { sessionSetGroups } from '@/catalogues/stimulus';
import { CONTRACTION_TYPE_FACTOR } from '@/engine/model/muscle/equations';
import { SEED_CATALOGUE as C } from '@/content/catalogues';
import { CTX } from './helpers';

const ex = (id: string): ExerciseRecord => {
  const e = C.exercise(id);
  if (!e) throw new Error(id);
  return e;
};

describe('homogeneous set groups (D3-01)', () => {
  it('consecutive identical sets form one group; a changed RIR starts a new one; physical sets are kept whole', () => {
    const d = resolveDose(ex('db_bench_press'), { exerciseId: 'db_bench_press', sets: [{ reps: 10, rir: 2 }, { reps: 10, rir: 2 }, { reps: 8, rir: 0 }, { reps: 10, rir: 2 }] }, CTX);
    expect(d.groups.map((g) => [g.sets, g.reps, g.rir])).toEqual([[2, 10, 2], [1, 8, 0], [1, 10, 2]]);
    expect(d.groups.reduce((a, g) => a + g.sets, 0)).toBe(d.sets);
    for (const g of d.groups) {
      expect(g.contraction).toBe('dynamic');
      expect(g.typeFactorIncluded).toBe(false);
      expect(g.regionWeights).toEqual(ex('db_bench_press').regions);
      expect(g.exerciseId).toBe('db_bench_press');
    }
  });

  it('holds are isometric; the default hold factor stays in the engine, a hold to failure is folded into the weights and tagged', () => {
    const d = resolveDose(ex('plank'), { exerciseId: 'plank', sets: [{ holdSec: 45 }, { holdSec: 60, nearFailure: true }] }, CTX);
    expect(d.groups).toHaveLength(2);
    const [half, full] = d.groups;
    expect(half).toMatchObject({ contraction: 'isometric', typeFactorIncluded: false, holdSec: 45, regionWeights: { core: 1 } });
    expect(half!.rir).toBeUndefined();
    expect(full).toMatchObject({ contraction: 'isometric', typeFactorIncluded: true, holdSec: 60, regionWeights: { core: 1 } });
    expect(CONTRACTION_TYPE_FACTOR.isometric).toBe(catalogueParam('isometricNonFailureFactor'));
  });

  it('ballistic bouts carry the ballistic contraction; an item-specific factor is tagged as included', () => {
    const kb = ex('kb_swing');
    const d = resolveDose(kb, { exerciseId: 'kb_swing', setCount: 4, reps: 15, rpe: 8 }, CTX);
    expect(d.groups).toHaveLength(1);
    const g = d.groups[0]!;
    const factor = kb.loadFactor?.mode ?? catalogueParam('ballisticSetFactor');
    expect(g.contraction).toBe('ballistic');
    expect(g.typeFactorIncluded).toBe(factor !== CONTRACTION_TYPE_FACTOR.ballistic);
    for (const [r, w] of Object.entries(kb.regions)) expect((g.regionWeights as Record<string, number>)[r]).toBeCloseTo(g.typeFactorIncluded ? w * factor : w, 12);
    // non-qualifying bouts are not hard sets: no group
    expect(resolveDose(kb, { exerciseId: 'kb_swing', rpe: 5 }, CTX).groups).toEqual([]);
  });

  it('field provenance: reported, inferred (Epley load, RPE effort, minutes-derived count) and default stay distinct', () => {
    const logged = resolveDose(ex('db_bench_press'), { exerciseId: 'db_bench_press', setCount: 3, pct1RM: 75, rir: 2, restSec: 90 }, CTX).groups[0]!;
    expect(logged.provenance).toEqual({ sets: 'reported', regions: 'inferred', load: 'reported', rir: 'reported', rest: 'reported' });
    // D3-09: an RPE is effort (reps in reserve) only on the resistance RIR-RPE scale
    const inferred = resolveDose(ex('db_bench_press'), { exerciseId: 'db_bench_press', minutes: 12, reps: 10, rpe: 8, rpeScale: 'rirRpe' }, CTX).groups[0]!;
    expect(inferred.provenance).toMatchObject({ sets: 'inferred', load: 'inferred', rir: 'inferred', rest: 'default' });
    // an RPE without a scale (legacy) or on CR-10 says nothing about reps in reserve: the RIR stays a default
    for (const rpeScale of [undefined, 'cr10'] as const) {
      const g = resolveDose(ex('db_bench_press'), { exerciseId: 'db_bench_press', minutes: 12, reps: 10, rpe: 8, ...(rpeScale ? { rpeScale } : {}) }, CTX).groups[0]!;
      expect(g.provenance?.rir).toBe('default');
    }
    const planned = resolveDose(ex('db_bench_press'), { exerciseId: 'db_bench_press' }, CTX).groups[0]!;
    expect(planned.provenance).toMatchObject({ sets: 'default', load: 'default', rir: 'default', rest: 'default' });
    // a log that says its numbers are prescription defaults is never promoted to reported
    const ticked = resolveDose(ex('db_bench_press'), { exerciseId: 'db_bench_press', setCount: 3, pct1RM: 75, rir: 2, provenance: { sets: 'default', load: 'default', rir: 'default' } }, CTX).groups[0]!;
    expect(ticked.provenance).toMatchObject({ sets: 'default', load: 'default', rir: 'default' });
  });

  it('a session puts every group on one resistance time line; energy-only items take no resistance time', () => {
    const doses = [
      resolveDose(ex('db_bench_press'), { exerciseId: 'db_bench_press', setCount: 3 }, CTX),
      resolveDose(ex('hamstring_stretch'), { exerciseId: 'hamstring_stretch' }, CTX),
      resolveDose(ex('goblet_squat'), { exerciseId: 'goblet_squat', setCount: 3 }, CTX),
    ];
    const groups = sessionSetGroups(doses);
    expect(groups.map((g) => g.exerciseId)).toEqual(['db_bench_press', 'goblet_squat']);
    expect(groups[1]!.startOffsetMin).toBeCloseTo(doses[0]!.resistanceMinutes, 9);
    const eng = toEngineDose(doses, 18);
    expect(eng.resistance!.groups).toEqual(groups);
    expect(eng.resistance!.durationMin).toBeCloseTo(doses[0]!.resistanceMinutes + doses[2]!.resistanceMinutes, 9);
  });

  it('the stimulus vector carries the groups, physical sets and the type-factor tag of its effective sets', () => {
    const doses = [
      resolveDose(ex('db_bench_press'), { exerciseId: 'db_bench_press', setCount: 3 }, CTX),
      resolveDose(ex('plank'), { exerciseId: 'plank', sets: [{ holdSec: 45 }, { holdSec: 45 }] }, CTX),
    ];
    const v = aggregateStimulus(doses);
    expect(v.typeFactorIncluded).toBe(true);
    expect(v.physicalSets).toBe(5);
    expect(v.setGroups).toEqual(sessionSetGroups(doses));
  });

  it('every part of a bout carries its identity; a part after midnight keeps its clock past 24:00 (never wrapped)', () => {
    const doses = [
      resolveDose(ex('goblet_squat'), { exerciseId: 'goblet_squat', setCount: 3 }, CTX),
      resolveDose(ex('kb_swing'), { exerciseId: 'kb_swing', setCount: 4, reps: 15, rpe: 8, restSec: 60 }, CTX),
    ];
    const eng = toEngineDose(doses, 23.9, { sessionId: 'log-9' });
    const parts = [eng.resistance!, ...eng.cardio];
    expect(eng.cardio.length).toBeGreaterThan(0);
    expect(parts.map((p) => p.sessionId)).toEqual(parts.map((_, k) => `log-9#${k}`));
    let t = 23.9 + eng.resistance!.durationMin! / 60;
    for (const c of eng.cardio) {
      expect(c.startH).toBeCloseTo(t, 12);
      t += c.durationMin / 60;
    }
    expect(eng.cardio[0]!.startH).toBeGreaterThan(24);
    // a one-part bout takes the bare id; without an id nothing is invented
    expect(toEngineDose([doses[0]!], 7, { sessionId: 'log-10' }).resistance!.sessionId).toBe('log-10');
    expect(toEngineDose(doses, 7).resistance!.sessionId).toBeUndefined();
  });
});
