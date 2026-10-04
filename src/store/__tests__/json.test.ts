import { describe, expect, it } from 'vitest';
import { applyFieldPatch, applyMergePatch, deepEqual, diffMergePatch, fieldPatch } from '../json';
import { createHlc, newDeviceId, ulid } from '../ids';
import { COLLECTIONS, exportedCollections, validateDoc } from '../collections';
import { COLLECTION_IDS } from '../types';

describe('JSON helpers', () => {
  it('diff then apply of a merge patch reproduces the target (RFC 7396)', () => {
    const a = { x: 1, nested: { y: 2, z: 3 }, list: [1, 2], gone: true };
    const b = { x: 1, nested: { y: 5 }, list: [3], added: 'new' };
    const p = diffMergePatch(a, b);
    expect(p).toEqual({ nested: { y: 5, z: null }, list: [3], added: 'new', gone: null });
    expect(applyMergePatch(a, p)).toEqual(b);
    expect(diffMergePatch(a, structuredClone(a))).toBeUndefined();
  });

  it('field patches invert each other (ChangeSet undo)', () => {
    const before = { a: 1, b: { c: 2 }, d: 'x' };
    const after = { a: 2, b: { c: 2 }, e: true };
    expect(applyFieldPatch(before, fieldPatch(before, after))).toEqual(after);
    expect(applyFieldPatch(after, fieldPatch(after, before))).toEqual(before);
  });

  it('compares deeply, treating undefined fields as absent', () => {
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual([1, { a: [2] }], [1, { a: [2] }])).toBe(true);
    expect(deepEqual([1], [1, 2])).toBe(false);
  });
});

describe('identifiers', () => {
  it('mints sortable ULIDs, device ids and HLC revisions', () => {
    const a = ulid(1000);
    const b = ulid(1000);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(b > a).toBe(true);
    expect(newDeviceId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
    const hlc = createHlc('DEV');
    const r1 = hlc(5);
    const r2 = hlc(5);
    const r3 = hlc(4);
    expect(r2 > r1).toBe(true);
    expect(r3 > r2).toBe(true);
  });
});

describe('collections', () => {
  it('defines every collection of the spec with a policy', () => {
    expect(Object.keys(COLLECTIONS).sort()).toEqual([...COLLECTION_IDS].sort());
    for (const c of Object.values(COLLECTIONS)) expect(['lwwField', 'append', 'immutable', 'blob', 'derived', 'local']).toContain(c.strategy);
  });

  it('exports synced collections plus device settings and UI prefs, never secrets or logs', () => {
    const cols = exportedCollections();
    expect(cols).toEqual(expect.arrayContaining(['profile', 'safety', 'goals', 'scenarios', 'settings', 'deviceSettings', 'uiPrefs', 'intake']));
    for (const no of ['secrets', 'providerKeys', 'pendingChanges', 'changeLog', 'commandLedger', 'derived', 'syncState']) expect(cols).not.toContain(no);
  });

  it('validates keys and bodies', () => {
    expect(validateDoc('dayStatus', 'day:2026-10-01', { date: '2026-10-01' })).toEqual([]);
    expect(validateDoc('dayStatus', 'today', { date: '2026-10-01' })[0]?.path).toBe('/_id');
    expect(validateDoc('goals', 'me', { goals: [], horizonDays: 112, constraints: {}, strictness: 'loose' }).length).toBeGreaterThan(0);
  });

  it('ignores a __proto__ key in a merge patch (no prototype swap, nothing read through it)', () => {
    const out = applyMergePatch<Record<string, unknown>>({ a: 1 }, JSON.parse('{"__proto__": {"polluted": true}, "b": 2}'));
    expect(out).toEqual({ a: 1, b: 2 });
    expect((out as { polluted?: boolean }).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });
});

