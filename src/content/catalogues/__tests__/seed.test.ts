/**
 * Seed data validation: schema, references, counts, sources on every entry, Indian traditional training present,
 * no internal research pointers in user-facing text, and every exercise resolvable to finite engine terms.
 */
import { describe, expect, it } from 'vitest';
import {
  createFoodTable,
  exerciseLabels,
  isIncludable,
  mealTotals,
  netCarbPer100g,
  resolveDose,
  validateCatalogue,
} from '@/catalogues';
import {
  CATALOGUE_SOURCES,
  FOOD_FIXTURE,
  FOOD_FIXTURE_SOURCES,
  NO_EXPECTED_BENEFIT,
  SEED_CATALOGUE,
  SEED_EQUIPMENT,
  SEED_EXERCISES,
  SEED_MAPPINGS,
  SEED_SUPPLEMENTS,
  SUPPLEMENT_ADVISORIES,
} from '@/content/catalogues';
import { report, scan, strings } from '@/content/evidence/__tests__/leakScan';
import { CTX } from '@/catalogues/__tests__/helpers';

describe('seed catalogue', () => {
  it('validates with no errors', () => {
    const issues = validateCatalogue(SEED_CATALOGUE);
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors, JSON.stringify(errors.slice(0, 10), null, 1)).toEqual([]);
  });

  it('meets the package counts (≥ 120 exercises, ≥ 40 equipment, ≥ 15 supplements)', () => {
    expect(SEED_EXERCISES.length).toBeGreaterThanOrEqual(120);
    expect(SEED_EQUIPMENT.length).toBeGreaterThanOrEqual(40);
    expect(SEED_SUPPLEMENTS.length).toBeGreaterThanOrEqual(15);
    expect(NO_EXPECTED_BENEFIT.length).toBeGreaterThan(0);
  });

  it('every entry has at least one source and every source resolves', () => {
    const missing: string[] = [];
    const check = (kind: string, id: string, keys: readonly string[]): void => {
      if (keys.length === 0) missing.push(`${kind} ${id}: no sources`);
      for (const k of keys) if (!CATALOGUE_SOURCES[k]) missing.push(`${kind} ${id}: unknown source ${k}`);
    };
    for (const e of SEED_EXERCISES) check('exercise', e.id, e.sources);
    for (const q of SEED_EQUIPMENT) check('equipment', q.id, q.sources);
    for (const s of SEED_SUPPLEMENTS) check('supplement', s.id, s.sources);
    for (const n of NO_EXPECTED_BENEFIT) check('no-benefit', n.id, n.sources);
    for (const a of SUPPLEMENT_ADVISORIES) check('advisory', a.id, a.sources);
    expect(missing).toEqual([]);
  });

  it('public sources carry a web URL and an access date; internal pointers are flagged', () => {
    for (const s of Object.values(CATALOGUE_SOURCES)) {
      expect(s.cite.length).toBeGreaterThan(5);
      expect(s.accessed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (s.url !== null && !s.internal) expect(s.url).toMatch(/^https?:\/\//);
      if (s.url === null && s.key !== 'MECH') expect(s.internal).toBe(true);
    }
  });

  it('covers Indian traditional training (mudgar/mugdar, gada, sumtola, dand, baithak, mallakhamb, rope)', () => {
    const found = (q: string): string | undefined => SEED_CATALOGUE.searchExercises(q, 1)[0]?.id;
    expect(found('mugdar')).toBe('mudgar_two_hand');
    expect(found('gada swing')).toBe('gada_swing');
    expect(found('sumtola squat')).toBe('sumtola_squat');
    expect(found('dand')).toBe('dand');
    expect(found('bethak')).toBe('baithak');
    expect(found('mallakhamb pole')).toBe('mallakhamb_pole');
    expect(found('rope climb')).toBe('rope_climb');
    for (const id of ['mudgar_heavy', 'mudgar_pair', 'indian_clubs', 'gada', 'steel_mace', 'sumtola', 'nal', 'gar_nal', 'mallakhamb_pole', 'rope_mallakhamb', 'climbing_rope', 'akhara']) {
      expect(SEED_CATALOGUE.equipmentItem(id), id).toBeDefined();
    }
    expect(SEED_EXERCISES.filter((e) => e.tradition === 'indian').length).toBeGreaterThanOrEqual(15);
  });

  it('every exercise is included by mechanism (R5): at least one outcome reaches an engine state', () => {
    for (const e of SEED_EXERCISES) expect(isIncludable(Object.values(exerciseLabels(e))), e.id).toBe(true);
  });

  it('every mapped exercise has a mapping record with a widened transfer prior', () => {
    const mapped = SEED_EXERCISES.filter((e) => e.status === 'mapped');
    expect(mapped.length).toBeGreaterThan(20);
    const ids = new Set(SEED_MAPPINGS.map((m) => m.itemId));
    for (const e of mapped) expect(ids.has(e.id), e.id).toBe(true);
    for (const m of SEED_MAPPINGS) expect(m.tau.sigmaLog).toBeGreaterThan(0.1);
  });

  it('ballistic items (mudgar, gada, kettlebell swings) carry the ballistic set-factor prior', () => {
    for (const e of SEED_EXERCISES.filter((x) => x.loadType === 'ballistic')) expect(e.loadFactor, e.id).toEqual({ min: 0.25, mode: 0.5, max: 0.75 });
  });

  it('user-facing text has no internal references', () => {
    const rows: Array<[string, string]> = [];
    strings(SEED_EXERCISES, 'exercises', rows, new Set(['sources', 'id', 'equipmentAnyOf']));
    strings(SEED_EQUIPMENT, 'equipment', rows, new Set(['sources', 'id']));
    strings(SEED_SUPPLEMENTS, 'supplements', rows, new Set(['sources', 'id', 'maintainerNotes', 'engine']));
    strings(NO_EXPECTED_BENEFIT, 'noBenefit', rows, new Set(['sources', 'id']));
    strings(SUPPLEMENT_ADVISORIES, 'advisories', rows, new Set(['sources', 'id']));
    strings(Object.values(CATALOGUE_SOURCES).filter((s) => !s.internal), 'sources', rows, new Set(['key']));
    const hits = scan(rows);
    expect(hits, report(hits)).toEqual([]);
    // Status words read "unverified" on screen, never the research notes' capitals (I1: 21 strings were lower-cased).
    const capitals = rows.filter(([, text]) => /\b(UNVERIFIED|PROPOSED)\b/.test(text)).map(([path, text]) => `${path}  ${text.slice(0, 80)}`);
    expect(capitals, report(capitals)).toEqual([]);
  });

  it('every exercise resolves at its default dose to finite, non-negative engine terms', () => {
    for (const e of SEED_EXERCISES) {
      const d = resolveDose(e, { exerciseId: e.id }, CTX);
      expect(Number.isFinite(d.minutes) && d.minutes > 0, `${e.id} minutes ${d.minutes}`).toBe(true);
      expect(d.energy.netKcal, e.id).toBeGreaterThanOrEqual(0);
      expect(d.energy.netLow).toBeLessThanOrEqual(d.energy.netKcal + 1e-9);
      expect(d.energy.netHigh).toBeGreaterThanOrEqual(d.energy.netKcal - 1e-9);
      for (const [r, v] of Object.entries(d.effectiveSetsByRegion)) {
        expect(Number.isFinite(v) && v >= 0, `${e.id}.${r}`).toBe(true);
        expect(v).toBeLessThanOrEqual((d.setsByRegion as Record<string, number>)[r]! + 1e-9);
      }
      if (e.hybridCardioShare > 0) expect(d.cardio, e.id).not.toBeNull();
    }
  });

  it('supplements: normalised doses, graded outcomes, engine levers for creatine, omega-3, fibre and caffeine', () => {
    for (const s of SEED_SUPPLEMENTS) {
      expect(s.outcomes.length, s.id).toBeGreaterThan(0);
      if (s.dose.amount !== null && s.dose.range) {
        expect(s.dose.amount).toBeGreaterThanOrEqual(s.dose.range[0]);
        expect(s.dose.amount).toBeLessThanOrEqual(s.dose.range[1]);
      }
      for (const c of s.contraindications) expect(c.flag).toMatch(/^[a-z0-9_/-]+$/i);
    }
    const lever = (id: string): string | undefined => SEED_CATALOGUE.supplement(id)?.engine.leverId;
    expect(lever('creatine_monohydrate')).toBe('L7');
    expect(lever('omega3_epa_dha')).toBe('L8');
    expect(lever('psyllium')).toBe('L9');
    expect(lever('caffeine')).toBe('L6');
    expect(SEED_CATALOGUE.supplement('ashwagandha')?.engine.route).toBe('infoOnly');
    expect(SEED_CATALOGUE.supplement('caffeine')?.dose).toMatchObject({ amount: 3, perKg: true, upperLimit: { amount: 400, unit: 'mg', per: 'day' } });
  });
});

describe('food table contract (test fixture)', () => {
  const table = createFoodTable(FOOD_FIXTURE, 'fixture');

  it('looks foods up by id and by Indian names', () => {
    expect(table.get('yogurt_whole')?.name).toMatch(/Yogurt/);
    expect(table.search('dahi')[0]?.id).toBe('yogurt_whole');
    expect(table.search('palak')[0]?.id).toBe('spinach_raw');
    expect(() => createFoodTable([...FOOD_FIXTURE, FOOD_FIXTURE[0]!], 'dup')).toThrow(/duplicate/);
  });

  it('every food has sources and plausible Atwater energy (within 15 %)', () => {
    for (const f of FOOD_FIXTURE) {
      expect(f.sources.length).toBeGreaterThan(0);
      for (const k of f.sources) expect(FOOD_FIXTURE_SOURCES[k as keyof typeof FOOD_FIXTURE_SOURCES], k).toBeDefined();
      const n = f.per100g;
      const atwater = 4 * n.proteinG + 4 * netCarbPer100g(n) + 2 * (n.fibreG ?? 0) + 9 * n.fatG;
      expect(Math.abs(atwater - n.energyKcal) / n.energyKcal, f.id).toBeLessThan(0.15);
    }
  });

  it('computes meal totals from grams (net carbohydrate excludes fibre)', () => {
    const t = mealTotals([{ foodId: 'lentils_cooked', grams: 150 }, { foodId: 'rice_white_cooked', grams: 120 }], table);
    expect(t.energyKcal).toBeCloseTo(1.5 * 116 + 1.2 * 130, 6);
    expect(t.netCarbG).toBeCloseTo(1.5 * (20.1 - 7.9) + 1.2 * (28.2 - 0.4), 6);
    expect(() => mealTotals([{ foodId: 'nope', grams: 1 }], table)).toThrow();
  });
});
