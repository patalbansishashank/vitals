import { describe, expect, it } from 'vitest';
import { createHlc, decode, encode, flatten, formatHlc, legacyClock, materialize, merge, sameState, stamp, valueOf, type FieldState } from './fieldMerge';

const clockAt = (ms: number, device: string, counter = 0) => formatHlc(ms, counter, device);
const valueOfState = (s: FieldState) => valueOf(JSON.parse(encode(s)));
const put = (prev: FieldState | null, value: unknown, clock: string, deep?: ReadonlySet<string>) => stamp(prev, flatten(value, deep), false, clock);

describe('per-field clocks', () => {
  it('a local write stamps only the fields it changes', () => {
    const a = put(null, { name: 'Sam', weightKg: 80, labs: { ldl: 3 } }, clockAt(1, 'A'));
    const b = put(a, { name: 'Sam', weightKg: 79, labs: { ldl: 3 } }, clockAt(2, 'A'));
    expect(b.clocks).toEqual({ '/name': clockAt(1, 'A'), '/weightKg': clockAt(2, 'A'), '/labs': clockAt(1, 'A') });
    // key order alone is not a change
    const c = put(b, { labs: { ldl: 3 }, weightKg: 79, name: 'Sam' }, clockAt(3, 'A'));
    expect(c.clocks).toEqual(b.clocks);
    // a removed field keeps a clock (tombstone)
    const d = put(c, { name: 'Sam', weightKg: 79 }, clockAt(4, 'A'));
    expect(d.clocks['/labs']).toBe(clockAt(4, 'A'));
    expect(valueOfState(d)).toEqual({ name: 'Sam', weightKg: 79 });
  });

  it('different fields edited on two devices both survive, in either order', () => {
    const base = put(null, { name: 'Sam', weightKg: 80, labs: { ldl: 3 } }, clockAt(1, 'A'));
    const onA = put(base, { name: 'Sam', weightKg: 78, labs: { ldl: 3 } }, clockAt(10, 'A'));
    const onB = put(base, { name: 'Sam', weightKg: 80, labs: { ldl: 2.4 } }, clockAt(5, 'B'));
    const ab = merge(onA, onB);
    const ba = merge(onB, onA);
    expect(sameState(ab, ba)).toBe(true);
    expect(valueOfState(ab)).toEqual({ name: 'Sam', weightKg: 78, labs: { ldl: 2.4 } });
  });

  it('the same field on two devices: the newer clock wins; equal times break the tie by device id', () => {
    const base = put(null, { units: 'metric' }, clockAt(1, 'A'));
    const onA = put(base, { units: 'imperial' }, clockAt(10, 'A'));
    const onB = put(base, { units: 'us' }, clockAt(11, 'B'));
    expect(valueOfState(merge(onA, onB))).toEqual({ units: 'us' });
    const tieA = put(base, { units: 'imperial' }, clockAt(20, 'A'));
    const tieB = put(base, { units: 'us' }, clockAt(20, 'B'));
    expect(valueOfState(merge(tieA, tieB))).toEqual({ units: 'us' });
    expect(valueOfState(merge(tieB, tieA))).toEqual({ units: 'us' });
  });

  it('a removal wins or loses by its clock like any edit', () => {
    const base = put(null, { a: 1, b: 2 }, clockAt(1, 'A'));
    const removed = put(base, { a: 1 }, clockAt(5, 'A'));
    const edited = put(base, { a: 1, b: 3 }, clockAt(6, 'B'));
    expect(valueOfState(merge(removed, edited))).toEqual({ a: 1, b: 3 });
    const removedLater = put(base, { a: 1 }, clockAt(7, 'A'));
    expect(valueOfState(merge(edited, removedLater))).toEqual({ a: 1 });
  });

  it('a delete and an edit resolve by the newer clock', () => {
    const base = put(null, { a: 1 }, clockAt(1, 'A'));
    const deleted = stamp(base, base.texts, true, clockAt(5, 'A'));
    const edited = put(base, { a: 2 }, clockAt(4, 'B'));
    const m = merge(deleted, edited);
    expect(m.deleted).toBe(true);
    expect(valueOfState(m)).toEqual({ a: 2 }); // the body still carries the edit, so a restore keeps it
    const restored = put(m, { a: 2 }, clockAt(9, 'B'));
    expect(restored.deleted).toBe(false);
    expect(merge(restored, deleted).deleted).toBe(false);
  });

  it('nested objects merge as one field unless the collection declares deeper paths', () => {
    const deep = new Set(['/state']);
    const base = put(null, { state: { units: 'metric', week: 'mon' }, version: 3 }, clockAt(1, 'A'), deep);
    expect(Object.keys(base.texts).sort()).toEqual(['/state/units', '/state/week', '/version']);
    const onA = put(base, { state: { units: 'imperial', week: 'mon' }, version: 3 }, clockAt(5, 'A'), deep);
    const onB = put(base, { state: { units: 'metric', week: 'sun' }, version: 3 }, clockAt(6, 'B'), deep);
    expect(valueOfState(merge(onA, onB))).toEqual({ state: { units: 'imperial', week: 'sun' }, version: 3 });
    // without the declaration the newer whole `state` wins
    const flatA = put(put(null, { state: { units: 'metric', week: 'mon' } }, clockAt(1, 'A')), { state: { units: 'imperial', week: 'mon' } }, clockAt(5, 'A'));
    const flatB = put(put(null, { state: { units: 'metric', week: 'mon' } }, clockAt(1, 'A')), { state: { units: 'metric', week: 'sun' } }, clockAt(6, 'B'));
    expect(valueOfState(merge(flatA, flatB))).toEqual({ state: { units: 'metric', week: 'sun' } });
  });

  it('arrays and non-object documents are replaced as a whole', () => {
    const a = put(null, { items: [1, 2] }, clockAt(1, 'A'));
    expect(valueOfState(merge(put(a, { items: [1, 2, 3] }, clockAt(2, 'A')), put(a, { items: [0] }, clockAt(3, 'B'))))).toEqual({ items: [0] });
    const s = put(null, [1, 2], clockAt(1, 'A'));
    expect(valueOfState(s)).toEqual([1, 2]);
    expect(valueOfState(put(s, { now: 'object' }, clockAt(2, 'A')))).toEqual({ now: 'object' });
    expect(materialize({ '/a~1b': 1, '/c~0': 2 }, {})).toEqual({ 'a/b': 1, 'c~': 2 });
  });

  it('a document from before per-field clocks merges with a new edit', () => {
    const legacyJson = JSON.stringify({ name: 'Sam', weightKg: 80, labs: { ldl: 3 } });
    const legacy = { clock: legacyClock('2026-09-01T10:00:00.000Z', 'OLD'), deleted: false };
    const onA = decode(legacyJson, legacy)!;
    expect(onA.clocks['/name']).toBe(legacy.clock);
    expect(valueOf(JSON.parse(legacyJson))).toEqual({ name: 'Sam', weightKg: 80, labs: { ldl: 3 } });
    const editA = put(onA, { name: 'Sam', weightKg: 77, labs: { ldl: 3 } }, clockAt(Date.parse('2026-10-01'), 'A'));
    const editB = put(decode(legacyJson, legacy)!, { name: 'Sam', weightKg: 80, labs: { ldl: 2 } }, clockAt(Date.parse('2026-10-02'), 'B'));
    expect(valueOfState(merge(editA, editB))).toEqual({ name: 'Sam', weightKg: 77, labs: { ldl: 2 } });
    // the unchanged v1 document merged with a v2 edit is the v2 edit
    expect(sameState(merge(onA, editA), editA)).toBe(true);
  });

  it('encode/decode round-trips and keeps the key order', () => {
    const s = put(null, { z: 1, a: { b: [1, 'x'] }, m: null }, clockAt(1, 'A'));
    const back = decode(encode(s), { clock: 'x', deleted: false })!;
    expect(sameState(back, s)).toBe(true);
    expect(encode(back)).toBe(encode(s));
    expect(Object.keys(valueOfState(back) as object)).toEqual(['z', 'a', 'm']);
  });

  it('the device clock moves past every clock it has seen', () => {
    let now = 1000;
    const h = createHlc('B', () => now);
    expect(h.next()).toBe(clockAt(1000, 'B'));
    expect(h.next()).toBe(clockAt(1000, 'B', 1));
    h.observe(clockAt(5000, 'A', 3));
    expect(h.next()).toBe(clockAt(5000, 'B', 4));
    now = 6000;
    expect(h.next()).toBe(clockAt(6000, 'B'));
  });
});

/** Small seeded PRNG (mulberry32) so a failure is reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('property: random field edits converge regardless of delivery order', () => {
  it('every device ends with the same state', () => {
    const fieldsPool = ['a', 'b', 'c', 'd', 'e'];
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
      const devices = ['A', 'B', 'C'].slice(0, 2 + Math.floor(r() * 2));
      const legacy = decode(JSON.stringify({ a: 0, b: 0 }), { clock: clockAt(1, 'OLD'), deleted: false })!;
      let time = 100;
      const hlcs = new Map(devices.map((d) => [d, createHlc(d, () => time)]));
      const state = new Map<string, FieldState>(devices.map((d) => [d, legacy]));
      const sent: FieldState[] = [];
      for (let step = 0; step < 12; step++) {
        time += Math.floor(r() * 3); // clocks often collide
        const d = pick(devices);
        const h = hlcs.get(d)!;
        let cur = state.get(d)!;
        if (r() < 0.3 && sent.length) {
          const got = pick(sent); // partial delivery while others keep editing
          h.observe(Object.values(got.clocks).sort().at(-1));
          cur = merge(cur, got);
        }
        const value = valueOf(JSON.parse(encode(cur))) as Record<string, unknown>;
        const next = { ...value };
        const f = pick(fieldsPool);
        if (r() < 0.2) delete next[f];
        else next[f] = r() < 0.5 ? Math.floor(r() * 5) : { n: Math.floor(r() * 5) };
        for (const c of Object.values(cur.clocks)) h.observe(c);
        cur = r() < 0.08 ? stamp(cur, cur.texts, !cur.deleted, h.next()) : put(cur, next, h.next());
        state.set(d, cur);
        sent.push(cur);
      }
      // deliver every version to every device in its own random order
      const finals = devices.map((d) => {
        const order = [...sent].sort(() => r() - 0.5);
        return order.reduce((acc, s) => merge(acc, s), state.get(d)!);
      });
      for (const f of finals) expect(sameState(f, finals[0]!), `seed ${seed}`).toBe(true);
      for (const f of finals) expect(valueOfState(f), `seed ${seed}`).toEqual(valueOfState(finals[0]!));
      // and merging the finals again changes nothing (idempotent)
      expect(sameState(merge(finals[0]!, finals[1]!), finals[0]!)).toBe(true);
    }
  });
});
