import { describe, expect, it, vi } from 'vitest';
import { resolveProfile } from '@/engine/core/resolveProfile';
import { buildK } from '@/engine/model/cardiometabolic/constants';
import { MAN_PROFILE, makeCtx } from '@/engine/model/cardiometabolic/testkit';
import { compileSafetyCaps } from '@/engine/planner/domain/safety';
import { MAN_95, request } from '@/engine/planner/domain/__tests__/personas';
import type { Schedule } from '@/engine/types/schedule';
import { withMarkerLabs } from '../../baselines';
import type * as Rules from '../../rules';
import { dishComposition, dishLevers, dishNotes } from '../food';
import { notesTouching, planLevers } from '../planLevers';
import { reaskMessage, screeningAnsweredOn, withMarkerSafety } from '../request';
import { evaluationOf, LDL_NOTE, ldlDoc } from './fixtures';

describe('engine baseline: entered labs replace the population starting values', () => {
  it("the cardiometabolic module's starting LDL is the entered value", () => {
    const doc = ldlDoc([['2026-09-14', 192]]);
    const profile = withMarkerLabs(MAN_PROFILE, doc, '2026-10-02');
    expect(profile.labs?.ldlMmolL).toBeCloseTo(192 * 0.02586, 3);
    const ctx = { ...makeCtx(), profile: resolveProfile(profile) };
    const k = buildK(ctx);
    expect(k.ldl0).toBeCloseTo(192, 0);
    // without the document the population draw is used (and differs)
    expect(buildK(makeCtx()).ldl0).not.toBeCloseTo(192, 0);
  });

  it('Body page labs stay as the fallback for markers not entered', () => {
    const p = withMarkerLabs({ ...MAN_PROFILE, labs: { hdlMmolL: 1.1, ldlMmolL: 3 } }, ldlDoc([['2026-09-14', 192]]), '2026-10-02');
    expect(p.labs?.hdlMmolL).toBe(1.1);
    expect(p.labs?.ldlMmolL).toBeCloseTo(4.965, 2);
  });
});

describe('planner request', () => {
  const base = request(MAN_95, [{ metric: 'fatMass', direction: 'down' } as never]);

  it('unchanged without notes or locks (stable hashes)', () => {
    expect(withMarkerSafety(base, evaluationOf([]))).toBe(base);
  });

  it('merges lab locks (stricter wins), attaches warnings and caps prefer weights', () => {
    const req = { ...base, safety: { plannerLocks: [{ id: 'deficit-cap', value: 20 }] } };
    const ev = evaluationOf([LDL_NOTE], {
      safety: { plannerLocks: [{ id: 'deficit-cap', value: 15, reasons: [{ rule: 'W-L-HB-1' }] }, { id: 'creatine-cap', value: 0, reasons: [{ rule: 'W-L-EGFR-2' }] }], flags: ['kidney-disease'] },
      preferLevers: [{ lever: 'fibre', weight: 0.5, rule: 'W-L-LDL-3' }],
    });
    const out = withMarkerSafety(req, ev);
    expect(out.safety?.plannerLocks?.find((l) => l.id === 'deficit-cap')?.value).toBe(15);
    expect((out.safety as { flags?: readonly string[] } | undefined)?.flags).toContain('kidney-disease');
    expect(out.markerWarnings).toEqual([LDL_NOTE]);
    expect(out.preferLevers).toEqual([{ lever: 'fibre', weight: 0.02, rule: 'W-L-LDL-3' }]);
    const caps = compileSafetyCaps(resolveProfile(MAN_95), out.safety);
    expect(caps.creatineAllowed).toBe(false);
    expect(caps.deficitCapPct).toBeLessThanOrEqual(15);
  });

  it('re-ask helpers: one answer time for every blocking item; plain message', () => {
    expect(screeningAnsweredOn('2026-09-01T10:00:00.000Z')).toMatchObject({ diabetes: '2026-09-01', kidney: '2026-09-01', gout: '2026-09-01' });
    expect(screeningAnsweredOn(null)).toEqual({});
    expect(reaskMessage('diabetes', 'HbA1c')).toBe('Your HbA1c result raises a question about diabetes. Answer it again in your safety settings, then find plans.');
  });
});

describe('planner.find re-ask precondition', () => {
  it('fails with precondition markerReask while a re-ask is pending, passes once answered', async () => {
    let blocking: Array<{ rule: string; markerId: string; about: string }> = [{ rule: 'W-L-HBA1C-2', markerId: 'hba1c', about: 'diabetes' }];
    vi.doMock('@/markers/ui/useMarkers', () => ({ readMarkersDoc: () => ldlDoc() }));
    vi.doMock('@/markers/rules', async (orig) => ({ ...(await orig<typeof Rules>()), blockingReasks: () => blocking }));
    vi.resetModules();
    const { plannerFind } = await import('@/commands/defs/planner');
    const { checkPreconditions } = await import('@/commands/gates');
    const actor = { kind: 'user' } as never;
    const hit = checkPreconditions(plannerFind as never, { tier: 'S' }, actor);
    expect(hit?.id).toBe('markerReask');
    expect(hit?.message).toMatch(/question about diabetes/);
    blocking = [];
    expect(checkPreconditions(plannerFind as never, { tier: 'S' }, actor)).toBeNull();
    vi.doUnmock('@/markers/ui/useMarkers');
    vi.doUnmock('@/markers/rules');
  });
});

describe('rung levers', () => {
  const sched = (over: Partial<Schedule> = {}): Schedule =>
    ({
      schemaVersion: 1,
      startDate: '2026-10-05',
      horizonDays: 2,
      programs: [{ id: 'a', label: 'A', energy: { kind: 'pctMaintenance', pct: 70 }, macros: { protein: { unit: 'gPerKgBw', value: 2 }, carbs: { unit: 'g', value: 30 }, fat: { unit: 'remainder' } } }],
      days: [{ program: 0 }, { program: 0 }],
      ...over,
    }) as Schedule;

  it('reads very-low-carb, large deficit, high protein and fasts from the schedule', () => {
    const l = planLevers({ schedule: sched({ events: [{ kind: 'fast', startDay: 0, startH: 19, durationH: 40 }] }) });
    for (const x of ['vlc', 'deficit_large', 'highprotein', 'fast36_48']) expect(l.has(x as never), x).toBe(true);
    expect(l.has('lowcarb')).toBe(false);
  });

  it('a note on low-carb touches a very-low-carb rung; a note on fasting does not touch a plan without fasts', () => {
    const l = planLevers({ schedule: sched() });
    expect(notesTouching([{ ...LDL_NOTE, levers: ['lowcarb'] }], l)).toHaveLength(1);
    expect(notesTouching([{ ...LDL_NOTE, levers: ['fast24'] }], l)).toHaveLength(0);
  });
});

describe('Food: dishes that hit a capped lever', () => {
  const table = {} as never;
  const foods: Record<string, { satFatG: number; cholesterolMg: number; alcoholG?: number }> = {
    ghee: { satFatG: 62, cholesterolMg: 256 },
    egg: { satFatG: 3.1, cholesterolMg: 372 },
    rice: { satFatG: 0.1, cholesterolMg: 0 },
  };
  const match = (name: string) => (foods[name] ? { food: { per100g: foods[name] } as never } : null);
  const dish = (ingredients: Array<{ name: string; grams: number }>) => ({ servings: 1, perServing: { energyKcal: { value: 500 } }, ingredients });

  it('saturated fat over the cap and cholesterol over a yolk hit; plain rice does not', () => {
    const ev = evaluationOf([LDL_NOTE], { safety: { plannerLocks: [{ id: 'satfat-cap', value: 7, reasons: [] }], flags: [] } });
    const heavy = dishLevers(dishComposition(dish([{ name: 'ghee', grams: 15 }, { name: 'egg', grams: 100 }]), table, match), 500, ev);
    expect([...heavy].sort()).toEqual(['dietcholesterol', 'satfat']);
    const plain = dishLevers(dishComposition(dish([{ name: 'rice', grams: 150 }, { name: 'unknown', grams: 50 }]), table, match), 500, ev);
    expect(plain.size).toBe(0);
    expect(dishNotes([LDL_NOTE], heavy)).toEqual([LDL_NOTE]);
    expect(dishNotes([{ ...LDL_NOTE, levers: ['vlc'] }], heavy)).toEqual([]);
  });
});
