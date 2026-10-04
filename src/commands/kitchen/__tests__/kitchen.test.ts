/** `kitchen.*` and `pantry.*` through the bus: views, lists, Coach adds, convergence, migration, undo, no expiry. */
import { beforeEach, describe, expect, it } from 'vitest';
import { dispatch, settleCommits, type Actor, type CommandResult } from '@/commands';
import { AI, freshState } from '@/commands/__tests__/harness';
import { seedIntake } from '@/commands/food/__tests__/seed';
import { getDocumentStore } from '@/state/runtime';
import { bodyOf } from '@/store';

type KitchenOut = { equipment: Array<{ id: string; label: string; note?: string; use: string; source: string; custom: boolean }>; cuisines: Array<{ id: string; rank: number; label: string }>; staples: Array<{ id: string; source: string }>; regions: string[]; fromIntake: boolean };
type PantryOut = { items: Array<{ id: string; label: string; qtyApprox?: string; source: string; addedAt: string; lastConfirmedAt?: string; custom: boolean; perishable: boolean; food: { status: string; foodId?: string } }>; askStillHave: string[]; fromIntake: boolean };

function out<T>(r: CommandResult): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  if (!('output' in r)) throw new Error(`no output: ${JSON.stringify(r)}`);
  return r.output as T;
}
const ai = (n: number): { actor: Actor; idempotencyKey: string } => ({ actor: { ...AI, toolCallId: `call-${n}` }, idempotencyKey: `${AI.conversationId}:call-${n}` });

beforeEach(() => {
  freshState({ cleared: true });
});

describe('kitchen.*', () => {
  it('starts empty, sets whole lists, keeps notes and ranks', async () => {
    expect(out<KitchenOut>(await dispatch('kitchen.get', {}))).toMatchObject({ equipment: [], cuisines: [], staples: [], fromIntake: false });
    const v = out<KitchenOut>(
      await dispatch('kitchen.set', { equipment: [{ id: 'eq.otg', note: 'small, 28 L' }, { id: 'eq.soda_maker', use: 'ownNotUsed' }], cuisines: [{ id: 'cu.kerala' }, { id: 'cu.punjabi' }], staples: [{ id: 'st.atta' }], regions: ['IN-south-kerala', 'nowhere'] }),
    );
    expect(v.equipment).toEqual([
      expect.objectContaining({ id: 'eq.otg', label: 'OTG oven', note: 'small, 28 L', use: 'use', source: 'picker', custom: false }),
      expect.objectContaining({ id: 'eq.soda_maker', use: 'ownNotUsed' }),
    ]);
    expect(v.cuisines.map((c) => [c.id, c.rank])).toEqual([['cu.kerala', 1], ['cu.punjabi', 2]]);
    expect(v.regions).toEqual(['IN-south-kerala']);
    await settleCommits();
    expect((bodyOf(getDocumentStore().peek('kitchen', 'me')!) as { equipment: unknown[] }).equipment).toHaveLength(2);
  });

  it('the Coach adds equipment by name: matched to the catalogue or kept in its words, source coach', async () => {
    const v = out<KitchenOut>(await dispatch('kitchen.add', { items: [{ label: 'soda maker' }, { label: 'egg boiler', note: '6 eggs' }, { label: 'a few things here and there' }] }, ai(1)));
    expect(v.equipment.map((e) => [e.id, e.source])).toEqual([
      ['eq.soda_maker', 'coach'],
      ['eq.egg_boiler', 'coach'],
      ['custom:a-few-things-here-and-there', 'coach'],
    ]);
    expect(v.equipment[2]).toMatchObject({ label: 'a few things here and there', custom: true });
    expect(v.equipment[1]!.note).toBe('6 eggs');
  });

  it('is applied at once (not staged) for the Coach, and undoable', async () => {
    const r = await dispatch('kitchen.add', { items: [{ label: 'air fryer' }] }, ai(2));
    expect(r.ok && 'output' in r).toBe(true);
    await settleCommits();
    const cs = r.ok && 'changeSet' in r ? r.changeSet : null;
    expect(cs).not.toBeNull();
    out(await dispatch('history.undo', { changeSetId: cs!.id }));
    await settleCommits();
    expect(out<KitchenOut>(await dispatch('kitchen.get', {})).equipment).toEqual([]);
  });

  it('reads the v0.2 intake answers until the first write, then writes the migrated lists', async () => {
    await seedIntake({ diet: { cuisines: ['kerala', 'british'], staples: { grain: ['rice'], fat: ['coconut'] } }, pantry: ['eggs', 'dal'] });
    const before = out<KitchenOut>(await dispatch('kitchen.get', {}));
    expect(before).toMatchObject({ fromIntake: true });
    expect(before.cuisines.map((c) => c.id)).toEqual(['cu.kerala', 'cu.british']);
    expect(before.staples.map((s) => s.id)).toEqual(['st.rice_white_generic', 'st.coconut_oil']);
    const pantry = out<PantryOut>(await dispatch('pantry.get', {}));
    expect(pantry.items.map((p) => p.id)).toEqual(['pa.eggs', 'st.toor_dal']);
    expect(pantry.fromIntake).toBe(true);
    expect(getDocumentStore().peek('kitchen', 'me')).toBeNull(); // reads write nothing
    const after = out<KitchenOut>(await dispatch('kitchen.add', { items: [{ label: 'rice cooker' }] }));
    expect(after.cuisines.map((c) => c.id)).toEqual(['cu.kerala', 'cu.british']);
    expect(after.equipment.map((e) => e.id)).toEqual(['eq.rice_cooker']);
    expect(after.fromIntake).toBe(false);
  });
});

describe('pantry.*', () => {
  it('adds by name with Hindi names and quantities, resolves food links without nutrient numbers', async () => {
    const v = out<PantryOut>(await dispatch('pantry.add', { items: [{ label: 'pyaz', qtyApprox: '2 kg' }, { label: 'atta' }, { label: 'arbi' }, { label: 'dragonfruit jam' }] }));
    expect(v.items.map((i) => i.id)).toEqual(['pa.onion_red', 'st.atta', 'pa.colocasia', 'custom:dragonfruit-jam']);
    expect(v.items[0]).toMatchObject({ qtyApprox: '2 kg', perishable: true, food: { status: 'notBundled' } });
    expect(v.items[1]!.food).toMatchObject({ status: 'resolved', foodId: 'wheat_flour_wholegrain' });
    expect(v.items[2]!.food).toEqual({ status: 'pending' });
    expect(v.items[3]).toMatchObject({ custom: true, label: 'dragonfruit jam', food: { status: 'none' } });
    expect(JSON.stringify(v)).not.toMatch(/kcal|protein|energy/i);
  });

  it('paste-a-list: parseList writes nothing; pantry.add with source paste keeps unknown items as written', async () => {
    const parsed = out<{ items: Array<{ label: string; id: string | null; confidence: number; qty?: string }> }>(await dispatch('pantry.parseList', { text: '- 2 kg pyaz\n• bhindi, paneer 200g\nmystery sauce' }));
    expect(parsed.items.map((i) => i.id)).toEqual(['pa.onion_red', 'pa.okra', 'pa.paneer', null]);
    await settleCommits();
    expect(getDocumentStore().peek('pantry', 'me')).toBeNull();
    const v = out<PantryOut>(await dispatch('pantry.add', { items: parsed.items.map((i) => ({ label: i.label, ...(i.id ? { id: i.id } : {}), ...(i.qty ? { qtyApprox: i.qty } : {}) })), source: 'paste' }));
    expect(v.items.map((i) => [i.id, i.source])).toEqual([
      ['pa.onion_red', 'paste'],
      ['pa.okra', 'paste'],
      ['pa.paneer', 'paste'],
      ['custom:mystery-sauce', 'paste'],
    ]);
    expect(v.items[0]!.qtyApprox).toBe('2 kg');
  });

  it('convergence: the Coach\'s "I have X at home" and the picker produce one item list', async () => {
    out(await dispatch('pantry.add', { items: [{ id: 'pa.okra', label: 'Okra' }, { id: 'pa.paneer', label: 'Paneer' }], replace: true }));
    await settleCommits();
    const v = out<PantryOut>(await dispatch('pantry.add', { items: [{ label: 'bhindi' }, { label: 'paneer', qtyApprox: '200 g' }, { label: 'spinach' }] }, ai(3)));
    expect(v.items.map((i) => i.id)).toEqual(['pa.okra', 'pa.paneer', expect.stringMatching(/spinach/)]);
    expect(v.items.find((i) => i.id === 'pa.okra')).toMatchObject({ source: 'picker', lastConfirmedAt: expect.any(String) });
    expect(v.items.find((i) => i.id === 'pa.paneer')!.qtyApprox).toBe('200 g');
    expect(v.items[2]!.source).toBe('coach');
    await settleCommits();
    // the picker (replace) after the Coach keeps the Coach's item and its stamps when it stays
    const p = out<PantryOut>(await dispatch('pantry.add', { items: v.items.map((i) => ({ id: i.id, label: i.label })), replace: true }));
    expect(p.items).toEqual(v.items);
  });

  it('an AI actor cannot pretend to be the picker', async () => {
    const v = out<PantryOut>(await dispatch('pantry.add', { items: [{ label: 'curd' }], source: 'picker' }, ai(4)));
    expect(v.items[0]!.source).toBe('coach');
  });

  it('remove drops items; nothing expires: after 400 days items stay and perishables are only flagged to ask', async () => {
    out(await dispatch('pantry.add', { items: [{ label: 'okra' }, { label: 'atta' }, { label: 'paneer' }] }));
    await settleCommits();
    out(await dispatch('pantry.remove', { ids: ['pa.paneer'] }));
    await settleCommits();
    const later = new Date(Date.now() + 400 * 86_400_000);
    const { vi } = await import('vitest');
    vi.useFakeTimers({ now: later, toFake: ['Date'] });
    try {
      const v = out<PantryOut>(await dispatch('pantry.get', {}));
      expect(v.items.map((i) => i.id)).toEqual(['pa.okra', 'st.atta']);
      expect(v.askStillHave).toEqual(['pa.okra']); // perishable only; atta is not asked about
    } finally {
      vi.useRealTimers();
    }
  });
});
