import { describe, expect, it } from 'vitest';
import { createFoodTable } from '@/catalogues/foods';
import { FOOD_FIXTURE } from '@/content/catalogues/foods.fixture';
import { KITCHEN_SEED } from '@/content/catalogues/kitchen';
import {
  addEquipment,
  addPantry,
  buildKitchenIndex,
  chooseRegions,
  cleanLine,
  createKitchenCatalogue,
  EMPTY_KITCHEN,
  EMPTY_PANTRY,
  foodKey,
  kitchenBriefingBlock,
  migrateFromIntake,
  parseKitchenList,
  recipeConstraints,
  regionDefaults,
  removePantry,
  resolveFood,
  searchKitchen,
  setKitchenLists,
  splitList,
  staleItems,
  toKitchenDoc,
  toPantryDoc,
  type KitchenKind,
  type SeedPantry,
} from '..';

const cat = createKitchenCatalogue(KITCHEN_SEED);
const index = buildKitchenIndex(cat);
const top = (q: string, kinds?: readonly KitchenKind[]) => searchKitchen(index, q, { ...(kinds ? { kinds } : {}), limit: 3 })[0]?.item.id;

describe('catalogue', () => {
  it('groups every item exactly once, in seed order', () => {
    for (const kind of ['equipment', 'cuisines', 'staples', 'pantry'] as const) {
      const ids = cat.groups(kind).flatMap((g) => g.items.map((i) => i.id));
      expect(ids.length).toBe(cat.list(kind).length);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(cat.groups('equipment').map((g) => g.id)).toEqual(['cooking', 'prep', 'storage', 'serving']);
    expect(cat.groups('cuisines')[0]!.label).toBe('Indian, by region');
    expect(cat.groups('cuisines')[1]!.items.map((i) => i.id)).toContain('cu.parsi');
  });
});

describe('region defaults', () => {
  const regions = cat.regions().map((r) => r.id);

  it.each(regions)('%s: pre-ticked ⊆ common, all ids exist, no perishable pantry item ticked', (rid) => {
    for (const kind of ['equipment', 'cuisines', 'staples', 'pantry'] as const) {
      const d = regionDefaults(cat, [rid], kind);
      for (const id of d.preTick) {
        expect(cat.kindOf(id)).toBe(kind);
        expect(d.common).toContain(id);
      }
      if (kind === 'pantry') for (const id of d.preTick) expect((cat.get(id) as SeedPantry).perishable).toBe(false);
    }
    expect(regionDefaults(cat, [rid], 'equipment').preTick.length).toBeGreaterThanOrEqual(10);
    expect(regionDefaults(cat, [rid], 'staples').preTick.length).toBeGreaterThanOrEqual(10);
  });

  it('a Kerala kitchen and a Punjabi kitchen start from different sets (R12 §4.2)', () => {
    const kerala = regionDefaults(cat, ['IN-south-kerala'], 'staples').preTick;
    const north = regionDefaults(cat, ['IN-north'], 'staples').preTick;
    expect(kerala).toContain('st.coconut_oil');
    expect(north).toContain('st.atta');
    expect(north).toContain('st.mustard_oil');
    expect(kerala).not.toContain('st.mustard_oil');
    const keralaEq = regionDefaults(cat, ['IN-south-kerala'], 'equipment').preTick;
    expect(keralaEq.some((id) => /appam|puttu/.test(id))).toBe(true);
  });

  it('two regions combine as the union, first region first', () => {
    const tn = regionDefaults(cat, ['IN-south-tn'], 'staples').preTick;
    const both = regionDefaults(cat, ['IN-south-tn', 'IN-north'], 'staples').preTick;
    expect(both.slice(0, tn.length)).toEqual(tn);
    expect(new Set(both).size).toBe(both.length);
    expect(both).toContain('st.atta');
  });

  it('chooses the region: chosen › first cuisine (parent chain) › western-generic outside India › none in India', () => {
    expect(chooseRegions(cat, { chosen: ['IN-goa'], cuisines: ['cu.punjabi'], india: true })).toEqual(['IN-goa']);
    expect(chooseRegions(cat, { cuisines: ['cu.chettinad'], india: true })).toEqual(['IN-south-tn']);
    expect(chooseRegions(cat, { cuisines: ['cu.italian'], india: false })[0]).toBe('mediterranean');
    expect(chooseRegions(cat, { india: false })).toEqual(['western-generic']);
    expect(chooseRegions(cat, { india: true })).toEqual([]);
    expect(chooseRegions(cat, { chosen: ['mars'], india: true })).toEqual([]);
  });
});

describe('search and alias matching', () => {
  it.each([
    ['bhindi', 'pa.okra'],
    ['pyaz', 'pa.onion_red'],
    ['arbi', 'pa.colocasia'],
    ['suran', 'pa.yam'],
    ['gehun ka atta', 'st.atta'],
    ['atta', 'st.atta'],
    ['chulha', 'eq.gas_stove_2'],
  ])('%s → %s', (q, id) => {
    expect(searchKitchen(index, q, { limit: 5 }).map((h) => h.item.id)).toContain(id);
  });

  it('exact and plural names score 1; prefixes rank above word matches', () => {
    const [hit] = searchKitchen(index, 'Red onions', { kinds: ['pantry'] });
    expect(hit!.item.id).toBe('pa.onion_red');
    expect(hit!.score).toBe(1);
    const egg = searchKitchen(index, 'egg boiler', { kinds: ['equipment'] })[0]!;
    expect(egg.item.id).toBe('eq.egg_boiler');
    expect(top('soda', ['equipment'])).toBe('eq.soda_maker');
  });

  it('filters by kind and returns nothing for an empty query', () => {
    expect(searchKitchen(index, 'okra', { kinds: ['equipment'] })).toEqual([]);
    expect(searchKitchen(index, '   ')).toEqual([]);
  });

  it('regional cuisine names match', () => {
    expect(top('Chettinad', ['cuisines'])).toBe('cu.chettinad');
    expect(top('batta', ['cuisines'])).toBe('cu.kashmiri_pandit');
  });
});

describe('paste-a-list parsing', () => {
  it('splits commas, newlines, semicolons and bullets', () => {
    expect(splitList('onion, tomato\n- paneer\n• curd; rice\t* ghee')).toEqual(['onion', 'tomato', '- paneer', 'curd', 'rice', '* ghee']);
  });

  it.each([
    ['2 kg onions', 'onions', '2 kg'],
    ['onions 2kg', 'onions', '2kg'],
    ['500g paneer', 'paneer', '500g'],
    ['1/2 kg tomatoes', 'tomatoes', '1/2 kg'],
    ['paneer (200 g)', 'paneer', '200 g'],
    ['3 x eggs', 'eggs', '3 x'],
    ['eggs x12', 'eggs', 'x12'],
    ['a dozen eggs', 'eggs', 'a dozen'],
    ['- 2 packets of maggi', 'maggi', '2 packets'],
    ['1. milk', 'milk', undefined],
    ['some coriander', 'coriander', undefined],
  ])('%s → "%s" (qty %s)', (line, label, qty) => {
    const c = cleanLine(line);
    expect(c.label).toBe(label);
    expect(c.qty).toBe(qty);
  });

  it('matches catalogue items, keeps unknown words as written, ignores quantities and de-duplicates', () => {
    const items = parseKitchenList(index, '2 kg pyaz\n- bhindi, paneer 200g\n• dragonfruit jam\npyaz', ['pantry', 'staples']);
    expect(items.map((i) => i.id)).toEqual(['pa.onion_red', 'pa.okra', 'pa.paneer', null]);
    expect(items[0]!.qty).toBe('2 kg');
    expect(items[3]).toMatchObject({ label: 'dragonfruit jam', id: null });
    expect(items[0]!.confidence).toBe(1);
  });

  it('skips lines with no letters', () => {
    expect(parseKitchenList(index, '---\n123\n\n', ['pantry'])).toEqual([]);
  });
});

describe('documents', () => {
  const T0 = '2026-10-02T08:00:00.000Z';
  it('sanitises stored bodies (bad ids, duplicates, unknown sources)', () => {
    const k = toKitchenDoc({ equipment: [{ id: 'eq.otg', note: 'small, 28 L', use: 'ownNotUsed', source: 'coach', addedAt: T0 }, { id: 'eq.otg' }, { id: 'DROP TABLE' }], cuisines: [{ id: 'cu.goan', rank: 2 }, { id: 'cu.punjabi', rank: 1 }], staples: [{ id: 'st.atta', source: 'x' }] });
    expect(k.equipment).toEqual([{ id: 'eq.otg', note: 'small, 28 L', use: 'ownNotUsed', addedAt: T0, source: 'coach' }]);
    expect(k.cuisines).toEqual([{ id: 'cu.punjabi', rank: 1 }, { id: 'cu.goan', rank: 2 }]);
    expect(k.staples).toEqual([{ id: 'st.atta', source: 'picker' }]);
    expect(toPantryDoc(null)).toEqual({ _schema: 1, items: [] });
  });

  it('set keeps stamps of kept items; add confirms existing items instead of duplicating', () => {
    const a = setKitchenLists(EMPTY_KITCHEN, { equipment: [{ id: 'eq.otg' }, { id: 'eq.tawa' }] }, T0);
    const b = setKitchenLists(a, { equipment: [{ id: 'eq.tawa' }, { id: 'eq.soda_maker' }] }, '2026-10-03T00:00:00.000Z');
    expect(b.equipment.find((e) => e.id === 'eq.tawa')!.addedAt).toBe(T0);
    expect(b.equipment.map((e) => e.id)).toEqual(['eq.tawa', 'eq.soda_maker']);
    const c = addEquipment(b, [{ id: 'eq.tawa', note: 'cast iron' }, { id: 'custom:waffle-maker', label: 'waffle maker', source: 'coach' }], T0);
    expect(c.equipment).toHaveLength(3);
    expect(c.equipment[0]!.note).toBe('cast iron');

    const p1 = addPantry(EMPTY_PANTRY, [{ id: 'pa.okra', source: 'picker' }], T0);
    const p2 = addPantry(p1, [{ id: 'pa.okra', source: 'coach', qtyApprox: '500 g' }], '2026-10-05T00:00:00.000Z');
    expect(p2.items).toEqual([{ id: 'pa.okra', source: 'picker', addedAt: T0, lastConfirmedAt: '2026-10-05T00:00:00.000Z', qtyApprox: '500 g' }]);
    expect(removePantry(p2, ['pa.okra']).items).toEqual([]);
  });

  it('never expires anything: after 400 simulated days every item is still there; only "still have it?" is offered', () => {
    let doc = addPantry(EMPTY_PANTRY, [{ id: 'pa.okra' }, { id: 'pa.paneer' }, { id: 'st.atta' }], T0);
    const start = Date.parse(T0);
    for (let day = 1; day <= 400; day++) {
      const now = new Date(start + day * 86_400_000).toISOString();
      if (day % 30 === 0) doc = addPantry(doc, [{ id: 'st.atta' }], now); // confirmed now and then
      doc = toPantryDoc(JSON.parse(JSON.stringify(doc))); // stored and read back
      expect(doc.items.map((p) => p.id)).toEqual(['pa.okra', 'pa.paneer', 'st.atta']);
    }
    const end = new Date(start + 400 * 86_400_000).toISOString();
    expect(staleItems(doc, end).map((p) => p.id)).toEqual(['pa.okra', 'pa.paneer']);
    expect(staleItems(doc, end, { only: (id) => (cat.get(id) as SeedPantry | undefined)?.perishable === true }).map((p) => p.id)).toEqual(['pa.okra', 'pa.paneer']);
  });

  it('migrates the v0.2 intake answers (R12 §3 mapping)', () => {
    const m = migrateFromIntake(
      {
        diet: { cuisines: ['kerala', 'other', 'british'], staples: { grain: ['rice', 'wheat_roti'], fat: ['coconut', 'ghee'] } },
        kitchen: { equipment: ['pressure_cooker', 'otg_oven', 'fridge', 'nonsense'], pantry: [{ foodId: 'eggs', have: true, confirmedAt: T0 }, { foodId: 'dal', have: true, confirmedAt: T0 }, { foodId: 'milk', have: false, confirmedAt: T0 }] },
      },
      '2026-10-02T09:00:00.000Z',
    );
    expect(m.kitchen!.equipment.map((e) => e.id)).toEqual(['eq.pressure_cooker_medium', 'eq.otg', 'eq.fridge_single']);
    expect(m.kitchen!.cuisines).toEqual([{ id: 'cu.kerala', rank: 1 }, { id: 'cu.british', rank: 2 }]);
    expect(m.kitchen!.staples.map((s) => s.id)).toEqual(['st.rice_white_generic', 'st.atta', 'st.coconut_oil', 'st.ghee']);
    expect(m.pantry!.items.map((p) => [p.id, p.addedAt])).toEqual([['pa.eggs', T0], ['st.toor_dal', T0]]);
    for (const id of [...m.kitchen!.equipment.map((e) => e.id), ...m.kitchen!.cuisines.map((c) => c.id), ...m.kitchen!.staples.map((s) => s.id), ...m.pantry!.items.map((p) => p.id)]) expect(cat.get(id)).toBeDefined();
    expect(migrateFromIntake({}, T0)).toEqual({ kitchen: null, pantry: null });
  });
});

describe('food reference resolution', () => {
  const table = createFoodTable(FOOD_FIXTURE, 'fixture');
  it('resolves fixture-linked items, flags IFCT-pending ones, never invents a record', () => {
    const atta = resolveFood(cat, 'st.atta', table);
    expect(atta.status).toBe('resolved');
    expect(atta.status === 'resolved' && atta.foodId).toBe('wheat_flour_wholegrain');
    expect(resolveFood(cat, 'pa.colocasia', table)).toEqual({ status: 'pending', reason: 'ifct' });
    expect(resolveFood(cat, 'pa.onion_red', table)).toEqual({ status: 'notBundled', usdaFdcId: 170000 });
    expect(resolveFood(cat, 'pa.halloumi', table)).toEqual({ status: 'none' });
    expect(resolveFood(cat, 'eq.otg', table)).toEqual({ status: 'none' });
    expect(resolveFood(cat, 'custom:dragonfruit-jam', table)).toEqual({ status: 'none' });
  });

  it('resolves through the bundle map (fdcId → food id) and marks IFCT proxies estimated', () => {
    const t = createFoodTable([...FOOD_FIXTURE, { ...FOOD_FIXTURE[10]!, id: 'taro_raw', name: 'Taro, raw', verified: true }], 'x');
    const r = resolveFood(cat, 'pa.colocasia', t, new Map([[169308, 'taro_raw']]));
    expect(r).toMatchObject({ status: 'resolved', foodId: 'taro_raw', estimated: true });
  });

  it('every staple and pantry food link is well formed; staple/pantry twins share a key', () => {
    let resolved = 0;
    for (const it of [...KITCHEN_SEED.staples, ...KITCHEN_SEED.pantry]) {
      const r = resolveFood(cat, it.id, table);
      if (r.status === 'resolved') resolved++;
      if (it.foodRef?.ifctPending && !it.foodRef.fixtureId) expect(r.status).toBe('pending');
    }
    expect(resolved).toBe(KITCHEN_SEED.staples.concat(KITCHEN_SEED.pantry as never).filter((x) => x.foodRef?.fixtureId).length);
    expect(foodKey(cat, 'st.paneer')).toBe(foodKey(cat, 'pa.paneer'));
  });
});

describe('coach block and recipe constraints', () => {
  const T0 = '2026-10-02T08:00:00.000Z';
  const kitchen = setKitchenLists(EMPTY_KITCHEN, { equipment: [{ id: 'eq.egg_boiler' }, { id: 'eq.soda_maker', use: 'ownNotUsed' }, { id: 'eq.otg', note: 'small, 28 L' }, { id: 'custom:waffle-maker', label: 'waffle maker' }], cuisines: [{ id: 'cu.punjabi' }, { id: 'cu.kerala' }, { id: 'cu.italian' }, { id: 'cu.thai' }], staples: [{ id: 'st.atta' }, { id: 'st.paneer' }] }, T0);
  const pantry = addPantry(EMPTY_PANTRY, [{ id: 'pa.okra' }, { id: 'pa.paneer', qtyApprox: '200 g' }, { id: 'custom:dragonfruit-jam', label: 'dragonfruit jam' }], T0);

  it('constraints carry equipment, notes, cuisines, staples and pantry labels', () => {
    const c = recipeConstraints(cat, kitchen, pantry, { timeBudgetMin: 20, skill: 3 });
    expect(c.equipment).toEqual(expect.arrayContaining(['Electric egg boiler', 'waffle maker']));
    expect(Object.values(c.equipmentNotes)).toEqual(expect.arrayContaining(['small, 28 L', 'owned, not used now']));
    expect(c.cuisines[0]).toBe('Punjabi');
    expect(c.pantry).toEqual(expect.arrayContaining(['dragonfruit jam']));
    expect(c.pantry.some((p) => p.includes('200 g'))).toBe(true);
    expect(c).toMatchObject({ preferPantry: true, timeBudgetMin: 20, skill: 3 });
  });

  it('briefing block: ids with notes, top 3 cuisines, ≤ 60 pantry labels, ≤ 250 tokens', () => {
    const b = kitchenBriefingBlock(cat, kitchen, pantry)!;
    expect(b).toContain('OTG oven (eq.otg; small, 28 L)');
    expect(b).toContain('(eq.soda_maker; not used)');
    expect(b).toContain('waffle maker (own item)');
    expect(b).toContain('Punjabi, Kerala');
    expect(b).not.toContain('Thai');
    expect(b).toContain('Okra');
    const big = addPantry(EMPTY_PANTRY, KITCHEN_SEED.pantry.slice(0, 300).map((p) => ({ id: p.id })), T0);
    const long = kitchenBriefingBlock(cat, setKitchenLists(kitchen, { equipment: KITCHEN_SEED.equipment.map((e) => ({ id: e.id })) }, T0), big)!;
    expect(long.length).toBeLessThanOrEqual(1000);
    expect(kitchenBriefingBlock(cat, EMPTY_KITCHEN, EMPTY_PANTRY)).toBeNull();
  });
});
