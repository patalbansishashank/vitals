/** Food reference contract (D6-01, D6-05): one validator, carbohydrate basis normalised once, the frozen FDC selection. */
import { describe, expect, it } from 'vitest';
import { availableCarbOf, createValidatedFoodTable, fortificationCompatible, fortificationOfText, logBand, mealTotals, netCarbOfFood, netCarbPer100g, stateOfText, validateFoodRecord, FOOD_BAND_SEMANTICS } from '@/catalogues/foods';
import { matchFood } from '@/commands/food/parse';
import { buildUserFood, userFoodsFromDocs, type ParsedUserItems } from '@/catalogues/user';
import type { FoodRecord } from '@/catalogues/types';
import { createFoodTable } from '@/catalogues';
import { contentHash } from '@/lib/bodyContracts';
import { FDC_NUTRIENT_IDS, FOOD_REFERENCE, FOOD_REFERENCE_MANIFEST, FOOD_REFERENCE_RETIRED, FOOD_REFERENCE_VERSION } from '@/content/catalogues/foods.reference';
import { FOOD_FIXTURE } from '@/content/catalogues/foods.fixture';

const rec = (over: Omit<Partial<FoodRecord>, 'per100g'> & { per100g?: Partial<FoodRecord['per100g']> } = {}): FoodRecord => ({
  id: 'x',
  name: 'Test food',
  aliases: [],
  group: 'other',
  tags: [],
  source: 'user',
  verified: false,
  state: 'as-eaten',
  portions: [],
  sources: [],
  ...over,
  per100g: { energyKcal: 100, proteinG: 5, fatG: 2, carbG: 30, ...over.per100g },
});

describe('carbohydrate basis (D6-01): subtract fibre once, only when the total includes it', () => {
  it('inclusive 30 g C / 10 g fibre and available 20 g C / 10 g fibre both give 20 g available', () => {
    const inclusive = availableCarbOf(rec({ carbBasis: 'totalByDifference', per100g: { carbG: 30, fibreG: 10 } }));
    const available = availableCarbOf(rec({ carbBasis: 'available', per100g: { carbG: 20, fibreG: 10 } }));
    expect(inclusive.availableG).toBe(20);
    expect(available.availableG).toBe(20);
    // planning arithmetic never subtracts fibre from an available total again
    expect(netCarbOfFood(rec({ carbBasis: 'available', per100g: { carbG: 20, fibreG: 10 } }))).toBe(20);
    expect(netCarbPer100g({ energyKcal: 100, proteinG: 0, fatG: 0, carbG: 20, fibreG: 10 }, 'available')).toBe(20);
  });

  it('pure fibre is representable under both bases (no available carbohydrate)', () => {
    expect(availableCarbOf(rec({ carbBasis: 'totalByDifference', per100g: { energyKcal: 200, proteinG: 0, fatG: 0, carbG: 90, fibreG: 90 } })).availableG).toBe(0);
    expect(availableCarbOf(rec({ carbBasis: 'available', per100g: { energyKcal: 200, proteinG: 0, fatG: 0, carbG: 0, fibreG: 90 } })).availableG).toBe(0);
    expect(validateFoodRecord(rec({ carbBasis: 'available', per100g: { energyKcal: 200, proteinG: 0, fatG: 0, carbG: 0, fibreG: 90 } }))).toEqual([]);
  });

  it('missing fibre differs from a measured zero; an unknown basis stays unresolved', () => {
    const missing = availableCarbOf(rec({ carbBasis: 'totalByDifference', per100g: { carbG: 30 } }));
    const zero = availableCarbOf(rec({ carbBasis: 'totalByDifference', per100g: { carbG: 30, fibreG: 0 } }));
    expect(missing).toMatchObject({ availableG: null, status: 'unresolved', reason: 'fibreNeeded', reportedG: 30 });
    expect(zero).toMatchObject({ availableG: 30, status: 'resolved' });
    expect(availableCarbOf(rec({ carbBasis: 'unknown', per100g: { carbG: 30, fibreG: 5 } }))).toMatchObject({ availableG: null, reason: 'basisUnknown' });
    // planning keeps the reported total as a conservative upper bound, never a fabricated subtraction
    expect(netCarbOfFood(rec({ carbBasis: 'unknown', per100g: { carbG: 30, fibreG: 5 } }))).toBe(30);
  });

  it('a legacy record (no basis) keeps its arithmetic, labelled legacy-assumed', () => {
    const r = availableCarbOf(rec({ per100g: { carbG: 30, fibreG: 4 } }));
    expect(r).toMatchObject({ availableG: 26, basis: 'legacyTotalByDifference', legacyAssumed: true });
    const t = createFoodTable([rec({ id: 'a', per100g: { carbG: 30, fibreG: 4 } })], 'v');
    expect(mealTotals([{ foodId: 'a', grams: 100 }], t).netCarbG).toBe(26);
  });
});

describe('one validator for every entry path (D6-05)', () => {
  it('rejects NaN, Infinity, negative and non-numeric optional nutrients before arithmetic', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, '5' as unknown as number]) expect(validateFoodRecord(rec({ per100g: { sodiumMg: bad } })).length).toBeGreaterThan(0);
    expect(validateFoodRecord(rec({ per100g: { energyKcal: Number.POSITIVE_INFINITY } })).length).toBeGreaterThan(0);
    expect(validateFoodRecord(rec({ carbBasis: 'european' as never })).length).toBeGreaterThan(0);
  });

  it('fibre ≤ carbohydrate only for fibre-inclusive totals; independent assays need not sum exactly', () => {
    expect(validateFoodRecord(rec({ carbBasis: 'totalByDifference', per100g: { carbG: 10, fibreG: 20 } }))).toContain('fibre is part of carbohydrate (carbohydrate by difference) and cannot exceed it');
    expect(validateFoodRecord(rec({ carbBasis: 'available', per100g: { carbG: 10, fibreG: 20 } }))).toEqual([]);
    // sugars + fibre slightly above the by-difference total (separate assays) is accepted
    expect(validateFoodRecord(rec({ carbBasis: 'totalByDifference', per100g: { carbG: 22.5, fibreG: 0, sugarsG: 23.3 } }))).toEqual([]);
  });

  it('a validated table quarantines malformed and duplicate records instead of normalising them', () => {
    const v = createValidatedFoodTable([rec({ id: 'ok' }), rec({ id: 'bad', per100g: { proteinG: -3 } }), rec({ id: 'ok' }), { id: 'junk' }], 'v');
    expect(v.table.all().map((f) => f.id)).toEqual(['ok']);
    expect(v.quarantined.map((q) => q.id)).toEqual(['bad', 'ok', 'junk']);
  });

  it('D6-01: a later custom record that supersedes an earlier one replaces it explicitly (same or new id), in any read order', () => {
    const docs = [
      { _id: '01A', name: 'Legacy oats', per100g: { energyKcal: 380, proteinG: 13, fatG: 7, carbG: 60, fibreG: 10 } },
      { _id: '01B', kind: 'food', key: 'oats', item: rec({ id: '01A', name: 'Legacy oats', carbBasis: 'totalByDifference', supersedes: '01A', per100g: { energyKcal: 380, proteinG: 13, fatG: 7, carbG: 60, fibreG: 10 } }) },
      { _id: '01C', kind: 'food', key: 'x', item: rec({ id: 'user-x', name: 'X' }) },
      { _id: '01D', kind: 'food', key: 'x2', item: rec({ id: 'user-x2', name: 'X corrected', supersedes: 'user-x' }) },
    ];
    const { foods, skipped } = userFoodsFromDocs(docs);
    expect(foods.map((f) => [f.id, f.carbBasis ?? null])).toEqual([['01A', 'totalByDifference'], ['user-x2', null]]);
    expect(skipped).toEqual([{ docId: '01A', reason: 'superseded' }, { docId: '01C', reason: 'superseded' }]);
    expect(userFoodsFromDocs([...docs].reverse())).toEqual({ foods, skipped });
    // without the explicit link the first record of an id still wins (sync merge)
    const plain = userFoodsFromDocs([docs[0]!, { ...docs[1]!, item: { ...(docs[1]!.item as object), supersedes: undefined } }]);
    expect(plain.foods[0]!.carbBasis).toBeUndefined();
    expect(plain.skipped).toEqual([{ docId: '01B', reason: 'id taken' }]);
  });

  it('cached/synced custom foods go through the same validator (item documents and legacy bodies)', () => {
    const docs = [
      { _id: '01A', kind: 'food', key: 'a', item: rec({ id: 'user-a', name: 'A' }) },
      { _id: '01B', kind: 'food', key: 'b', item: rec({ id: 'user-b', name: 'B', per100g: { proteinG: Number.POSITIVE_INFINITY } }) },
      { _id: '01C', name: 'Legacy oats', per100g: { energyKcal: 380, proteinG: 13, fatG: 7, carbG: 60, fibreG: 10 } },
      { _id: '01D', kind: 'food', key: 'd', item: rec({ id: 'user-d', name: 'D', carbBasis: 'available', per100g: { carbG: 5, fibreG: 12 } }) },
    ];
    const { foods, skipped } = userFoodsFromDocs(docs);
    expect(foods.map((f) => f.id)).toEqual(['user-a', '01C', 'user-d']);
    expect(skipped.map((s) => s.docId)).toEqual(['01B']);
    // idempotent across reload/sync order: the same documents read the same, whatever order they arrive in, and the
    // stored documents are never rewritten (the legacy body keeps no basis: it reads as the legacy contract)
    const before = JSON.stringify(docs);
    expect(userFoodsFromDocs([...docs].reverse())).toEqual({ foods, skipped });
    expect(JSON.stringify(docs)).toBe(before);
    const legacy = foods.find((f) => f.id === '01C')!;
    expect(legacy.carbBasis).toBeUndefined();
    expect(availableCarbOf(legacy)).toMatchObject({ availableG: 50, legacyAssumed: true });
    // an available-basis record is never fibre-subtracted, also after a second read
    expect(availableCarbOf(userFoodsFromDocs(docs).foods.find((f) => f.id === 'user-d')!).availableG).toBe(5);
  });

  it('addFood stores the declared carbohydrate basis; an undeclared new label is unknown, never guessed', () => {
    const user: ParsedUserItems = { catalogue: { exercises: [], equipment: [], foods: [], mappings: [] }, ownedEquipment: [], byKey: new Map(), ids: new Set(), skipped: [] };
    const undeclared = buildUserFood({ name: 'Bar one', per100g: { energyKcal: 400, proteinG: 20, fatG: 15, carbG: 45, fibreG: 10 } }, { user, foods: [] });
    expect(undeclared.kind === 'new' && undeclared.item.carbBasis).toBe('unknown');
    const eu = buildUserFood({ name: 'Bar two', carbBasis: 'available', per100g: { energyKcal: 400, proteinG: 20, fatG: 15, carbG: 30, fibreG: 35 } }, { user, foods: [] });
    expect(eu.kind).toBe('new'); // fibre above an available total is valid
    const us = buildUserFood({ name: 'Bar three', carbBasis: 'totalByDifference', per100g: { energyKcal: 400, proteinG: 20, fatG: 15, carbG: 30, fibreG: 35 } }, { user, foods: [] });
    expect(us.kind).toBe('invalid');
    // a polyol-rich label keeps its energy (no universal net-carb subtraction; polyols stay identified)
    const polyol = buildUserFood({ name: 'Sugar-free sweets', carbBasis: 'totalByDifference', polyolsG: { maltitol: 60 }, per100g: { energyKcal: 240, proteinG: 0, fatG: 0, carbG: 95, fibreG: 0 } }, { user, foods: [] });
    expect(polyol.kind === 'new' && polyol.item.per100g.energyKcal).toBe(240);
    expect(polyol.kind === 'new' && polyol.item.polyolsG).toEqual({ maltitol: 60 });
  });
});

describe('the frozen FDC reference (D6-05)', () => {
  it('ships exact, auditable source rows: ids, release, units, per-nutrient derivation, content hash', () => {
    expect(contentHash(FOOD_REFERENCE)).toBe(FOOD_REFERENCE_MANIFEST.contentHash);
    expect(FOOD_REFERENCE_MANIFEST.version).toBe(FOOD_REFERENCE_VERSION);
    for (const f of FOOD_REFERENCE) {
      expect(validateFoodRecord(f), f.id).toEqual([]);
      expect(f.provenance?.sourceId, f.id).toMatch(/^fdc:\d+$/);
      expect(f.provenance?.datasetVersion).toBe(FOOD_REFERENCE_VERSION);
      expect(f.carbBasis).toBe('totalByDifference');
      const m = FOOD_REFERENCE_MANIFEST.records[f.id as keyof typeof FOOD_REFERENCE_MANIFEST.records];
      expect(m.fdcId, f.id).toBe(Number(f.provenance!.sourceId.slice(4)));
      for (const k of Object.keys(f.per100g)) expect(FDC_NUTRIENT_IDS[k as keyof typeof FDC_NUTRIENT_IDS], k).toBeDefined();
    }
    // exact import: the SR Legacy egg row as published (not the rounded fixture)
    const egg = FOOD_REFERENCE.find((f) => f.id === 'egg_whole_raw')!;
    expect(egg.per100g).toMatchObject({ energyKcal: 143, proteinG: 12.56, fatG: 9.51, carbG: 0.72, sodiumMg: 142, calciumMg: 56 });
    expect(egg.provenance?.nutrientProvenance?.proteinG).toBe('assay');
  });

  it('keeps raw, cooked and fortified variants distinct; the unverified paneer estimate is not shipped', () => {
    const byId = new Map(FOOD_REFERENCE.map((f) => [f.id, f]));
    expect(byId.get('rice_white_raw')!.state).toBe('raw');
    expect(byId.get('rice_white_cooked')!.state).toBe('cooked');
    expect(byId.get('rice_white_raw')!.provenance!.sourceId).not.toBe(byId.get('rice_white_cooked')!.provenance!.sourceId);
    expect(byId.get('chickpeas_raw')!.per100g.energyKcal).not.toBe(byId.get('chickpeas_cooked')!.per100g.energyKcal);
    expect(byId.get('milk_whole')!.fortified).toBe(true);
    expect(byId.has('paneer')).toBe(false);
    expect(FOOD_REFERENCE_RETIRED.paneer).toBe('ifctPending');
    // the test fixture is still the fixture (tests may use it); production reads the reference
    expect(FOOD_FIXTURE.every((f) => !f.provenance)).toBe(true);
  });

  it('almond forms carry their own measured ME (an alternative to the label energy), other nuts none', () => {
    const me = (id: string) => FOOD_REFERENCE.find((f) => f.id === id)!.measuredME;
    expect(me('almonds_raw')).toMatchObject({ kcalPer100g: 442, form: 'wholeNatural', represents: 'sourceME' });
    expect(me('almonds_dry_roasted')!.kcalPer100g).toBe(486);
    expect(me('almond_butter')!.kcalPer100g).toBe(653);
    expect(FOOD_REFERENCE.filter((f) => f.measuredME).every((f) => f.measuredME!.species === 'Prunus dulcis')).toBe(true);
  });

  it('preparation words are read before aliases', () => {
    expect(stateOfText('boiled chickpeas')).toBe('cooked');
    expect(stateOfText('dry roasted almonds')).toBe('cooked');
    expect(stateOfText('raw rice')).toBe('raw');
    expect(stateOfText('uncooked rice')).toBe('raw');
    expect(stateOfText('dal')).toBeUndefined();
  });

  it('fortification is matched before aliases: an enriched request never silently takes the unfortified row', () => {
    expect(fortificationOfText('enriched white rice')).toBe(true);
    expect(fortificationOfText('non-fortified atta')).toBe(false);
    expect(fortificationOfText('rice')).toBeUndefined();
    expect(fortificationCompatible({ fortified: true }, false)).toBe(false);
    expect(fortificationCompatible({}, false)).toBe(true);
    const t = createFoodTable([
      rec({ id: 'flour_plain', name: 'Wheat flour, white', aliases: ['maida', 'flour'], fortified: false }),
      rec({ id: 'flour_enriched', name: 'Wheat flour, white, enriched', aliases: ['maida', 'flour'], fortified: true }),
    ], 't');
    expect(matchFood('enriched flour', t)!.food.id).toBe('flour_enriched');
    expect(matchFood('unenriched flour', t)!.food.id).toBe('flour_plain');
    // only the other variant exists: a transparent, weaker match (never full confidence)
    const only = createFoodTable([rec({ id: 'flour_enriched', name: 'Wheat flour, white, enriched', aliases: ['flour'], fortified: true })], 't');
    expect(matchFood('unfortified flour', only)!.score).toBeLessThanOrEqual(0.6);
  });
});

describe('display bands (D6-06)', () => {
  it('logBand endpoints are an uncalibrated heuristic band, not percentiles', () => {
    const b = logBand(500, 'household');
    expect(b.semantics).toBe(FOOD_BAND_SEMANTICS);
    expect(FOOD_BAND_SEMANTICS).toMatchObject({ uncertaintyKind: 'heuristic', calibrated: false, coverage: 'unvalidated' });
    expect(b.low).toBe(b.p10);
    expect(b.high).toBe(b.p90);
  });
});
