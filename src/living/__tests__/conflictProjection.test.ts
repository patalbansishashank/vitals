import { describe, expect, it } from 'vitest';
import { effectiveEntries, mealTotals, projectEntries, summarise } from '../logs';
import type { LogEntry } from '../types';

const date = '2026-10-05';
const source = { by: 'user' as const, method: 'typed' as const };
const est = (value: number) => ({ value, sd: 0 });
function meal(id: string, kcal: number, at: string, supersedes?: string, day = date): LogEntry {
  return {
    id, date: day, tz: 'UTC', at, source, kind: 'meal', clockH: 12,
    components: [{ name: id, grams: est(100), nutrients: { energyKcal: est(kcal), proteinG: est(10), carbG: est(10), fatG: est(10), fibreG: est(1) }, nutrientSource: 'user' }],
    totals: { energyKcal: est(kcal), proteinG: est(10), carbG: est(10), fatG: est(10), fibreG: est(1) },
    ...(supersedes ? { supersedes } : {}),
  };
}
const retract = (id: string, target: string, keep?: string): LogEntry => ({ id, date, tz: 'UTC', source, kind: 'retract', target, ...(keep ? { keep } : {}) });
const device = { by: 'device' as const, method: 'biometrics' as const, deviceKey: `${date}:steps` };
const steps = (id: string, n: number, at: string, by: 'user' | 'device', supersedes?: string): LogEntry => ({
  id, date, tz: 'UTC', at, source: by === 'device' ? device : source, kind: 'steps', steps: n, ...(supersedes ? { supersedes } : {}),
});

describe('append-only conflict projection', () => {
  const a = meal('a', 100, '2026-10-05T10:00:00Z');
  const b = meal('b', 200, '2026-10-05T11:00:00Z', 'a');
  const c = meal('c', 300, '2026-10-05T12:00:00Z', 'a');

  it('retains both stored siblings, but shows one flagged entry and counts it once', () => {
    const rows = [a, b, c, meal('independent', 50, '2026-10-05T13:00:00Z')];
    expect(effectiveEntries(rows).map((e) => e.id)).toEqual(['b', 'c', 'independent']);
    const projected = projectEntries(rows);
    const fork = projected.find((e) => e.id === 'c');
    expect(fork?.conflict).toEqual({ parentId: 'a', versions: [c, b] });
    expect(summarise(fork!).conflict?.versions.map((v) => [v.id, v.label, v.energyKcal?.value])).toEqual([
      ['c', 'c', 300], ['b', 'b', 200],
    ]);
    expect(mealTotals(projected).energyKcal.value).toBe(350);
    expect(mealTotals(rows).energyKcal.value).toBe(350);
    expect(projectEntries([...rows].reverse()).map((e) => [e.id, e.conflict?.versions.map((v) => v.id)])).toEqual(
      projected.map((e) => [e.id, e.conflict?.versions.map((v) => v.id)]),
    );
  });

  it('breaks identical edit timestamps by id regardless of arrival order', () => {
    const tied = { ...c, at: b.at };
    expect(projectEntries([a, b, tied])[0]?.id).toBe('c');
    expect(projectEntries([tied, b, a])).toEqual(projectEntries([a, b, tied]));
  });

  it('handles a third fork and descendants while preserving the common parent', () => {
    const d = meal('d', 400, '2026-10-05T14:00:00Z', 'b');
    const e = meal('e', 500, '2026-10-05T15:00:00Z', 'a');
    expect(projectEntries([a, b, c, d, e])[0]?.conflict).toEqual({ parentId: 'a', versions: [e, d, c] });
    expect(mealTotals(projectEntries([a, b, c, d, e])).energyKcal.value).toBe(500);
  });

  it('keeps a normal three and four edit chain to one entry', () => {
    const cChain = meal('c-chain', 300, '2026-10-05T12:00:00Z', 'b');
    const d = meal('d', 400, '2026-10-05T14:00:00Z', 'c-chain');
    expect(effectiveEntries([a, b, cChain, d]).map((e) => e.id)).toEqual(['d']);
    expect(projectEntries([a, b, cChain, d])).toEqual([d]);
  });

  it('resolves by retracting one leaf and restores a conflict with an undo copy', () => {
    const r = retract('r', 'c');
    expect(projectEntries([a, b, c, r]).map((e) => e.id)).toEqual(['b']);
    const undo = meal('undo', 300, '2026-10-05T16:00:00Z', 'r');
    expect(effectiveEntries([a, b, c, r, undo]).map((e) => e.id)).toEqual(['b', 'undo']);
    expect(projectEntries([a, b, c, r, undo])[0]?.conflict?.versions.map((e) => e.id)).toEqual(['undo', 'b']);
    expect(mealTotals(projectEntries([a, b, c, r, undo])).energyKcal.value).toBe(300);
  });

  it('restores a single retracted root as one new copy', () => {
    const r = retract('r', 'a');
    const undo = meal('undo', 100, '2026-10-05T16:00:00Z', 'r');
    expect(effectiveEntries([a, r, undo]).map((e) => e.id)).toEqual(['undo']);
    expect(projectEntries([a, r, undo])).toEqual([undo]);
  });

  it('groups forks before dates are filtered, including an edit moved to another day', () => {
    const moved = meal('moved', 400, '2026-10-06T09:00:00Z', 'a', '2026-10-06');
    const projected = projectEntries([a, b, moved]);
    expect(projected).toHaveLength(1);
    expect(projected[0]?.date).toBe('2026-10-06');
    expect(projected[0]?.conflict?.versions.map((e) => e.id)).toEqual(['moved', 'b']);
  });

  // L-REV2 R3-01: a corrected value beats a device value, also inside a fork
  it('counts the person’s edit, not a newer device update of the same entry', () => {
    const ring = steps('ring', 5000, '2026-10-05T08:00:00Z', 'device');
    const mine = steps('mine', 7000, '2026-10-05T09:00:00Z', 'user', 'ring');
    const later = steps('later', 5200, '2026-10-05T10:00:00Z', 'device', 'ring');
    const projected = projectEntries([ring, mine, later]);
    expect(projected).toHaveLength(1);
    expect(projected[0]?.id).toBe('mine');
    expect(projected[0]?.conflict?.versions.map((e) => e.id)).toEqual(['mine', 'later']);
  });

  // L-REV2 R3-02: two devices that keep opposite versions at the same time
  it('shows the conflict again when two choices cross, instead of the value before both edits', () => {
    const keepB = retract('r1', 'c', 'b');
    const keepC = retract('r2', 'b', 'c');
    const projected = projectEntries([a, b, c, keepB, keepC]);
    expect(projected.map((e) => e.id)).toEqual(['c']);
    expect(projected[0]?.conflict?.versions.map((e) => e.id)).toEqual(['c', 'b']);
    expect(effectiveEntries([a, b, c, keepB, keepC], true).map((e) => e.id)).toEqual(['b', 'c']);
    // one choice alone still resolves; a later choice that does not cross stays in force
    expect(projectEntries([a, b, c, keepB]).map((e) => e.id)).toEqual(['b']);
    const d = meal('d', 400, '2026-10-05T14:00:00Z', 'a');
    expect(projectEntries([a, b, c, d, keepB, retract('r3', 'b', 'd')]).map((e) => e.id)).toEqual(['d']);
  });

  // L-REV2 verifier C-01: after a crossing the person's next choice must settle the conflict
  it('a choice made after a crossing names the crossed choices and settles the conflict', () => {
    const keepB = retract('r1', 'c', 'b');
    const keepC = retract('r2', 'b', 'c');
    const again = { ...retract('r3', 'c', 'b'), overrides: ['r1', 'r2'] };
    const projected = projectEntries([a, b, c, keepB, keepC, again]);
    expect(projected.map((e) => e.id)).toEqual(['b']);
    expect(projected[0]?.conflict).toBeUndefined();
    expect(effectiveEntries([a, b, c, keepB, keepC, again], true).map((e) => e.id)).toEqual(['b', 'r3']);
    // two such later choices that cross again show the conflict again
    const other = { ...retract('r4', 'b', 'c'), overrides: ['r1', 'r2'] };
    expect(projectEntries([a, b, c, keepB, keepC, again, other]).map((e) => e.id)).toEqual(['c']);
    expect(projectEntries([a, b, c, keepB, keepC, again, other])[0]?.conflict?.versions.map((e) => e.id)).toEqual(['c', 'b']);
  });
});
