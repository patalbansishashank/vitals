import { describe, expect, it } from 'vitest';
import { createHlc, decode, encode, flatten, formatHlc, merge, sameState, stamp, valueOf, type FieldState } from './fieldMerge';

const put = (prev: FieldState | null, value: unknown, clock: string) => stamp(prev, flatten(value), false, clock);
const val = (s: FieldState) => valueOf(JSON.parse(encode(s)));
const perms = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
const foldAll = (xs: FieldState[]) => xs.reduce((a, b) => merge(a, b));

describe('V2 fieldMerge edge cases', () => {
  it('a removed-then-re-added field converges in every order', () => {
    const base = put(null, { a: 1, b: 2 }, formatHlc(100, 0, 'A'));
    const removedOnA = put(base, { a: 1 }, formatHlc(200, 0, 'A'));
    const readdedOnB = put(base, { a: 1, b: 3 }, formatHlc(300, 0, 'B'));
    const outs = perms([base, removedOnA, readdedOnB]).map((p) => foldAll(p));
    for (const o of outs) expect(sameState(o, outs[0]!)).toBe(true);
    expect(val(outs[0]!)).toEqual({ a: 1, b: 3 });
    // deletion after the re-add wins
    const removedLater = put(base, { a: 1 }, formatHlc(400, 0, 'A'));
    const outs2 = perms([base, readdedOnB, removedLater]).map((p) => foldAll(p));
    for (const o of outs2) expect(sameState(o, outs2[0]!)).toBe(true);
    expect(val(outs2[0]!)).toEqual({ a: 1 });
  });

  it('a clock from year 3000 (14 digits) does not beat later honest edits after it was observed', () => {
    const far = formatHlc(32503680000000, 0, 'X');
    const bad = put(null, { note: 'poison' }, far);
    const h = createHlc('B', () => 1_800_000_000_000);
    h.observe(far);
    const honest = put(bad, { note: 'honest' }, h.next());
    const m = merge(bad, honest);
    expect(val(m)).toEqual({ note: 'honest' });
    expect(sameState(m, merge(honest, bad))).toBe(true);
    // clocks stay sortable: always 13 digit ms
    expect(far.split('-')[0]!.length).toBe(13);
  });

  it('garbage clocks (NaN, null, numbers, wrong shape) lose to honest ones and never throw', () => {
    const honest = put(null, { a: 1 }, formatHlc(1_700_000_000_000, 0, 'A'));
    const json = '{"v":2,"fields":{"/a":2},"clocks":{"/a":"zzzz-NaN"},"deleted":false,"deletedClock":"NaN"}';
    const st = decode(json, { clock: formatHlc(1, 0, 'L'), deleted: false })!;
    expect(val(merge(honest, st))).toEqual({ a: 1 });
    const h = createHlc('B', () => 5);
    h.observe('zzzz-NaN');
    h.observe('99999999999999999-ffff-X');
    expect(h.next().split('-')[0]).toHaveLength(13);
    const nul = decode('{"v":2,"fields":{"/a":2},"clocks":{"/a":null},"deleted":false,"deletedClock":"x"}', { clock: 'c', deleted: false })!;
    expect(typeof nul.clocks['/a']).toBe('string');
  });

  it('prototype keys in payloads do not pollute and do not crash', () => {
    const json = '{"v":2,"fields":{"/__proto__":{"polluted":true},"/ok":1,"__proto__":"x"},"clocks":{"/__proto__":"0000000000001-0000-A","/ok":"0000000000001-0000-A"},"deleted":false,"deletedClock":"0000000000001-0000-A"}';
    const st = decode(json, { clock: 'c', deleted: false })!;
    const v = valueOf(JSON.parse(encode(merge(st, st)))) as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(v.ok).toBe(1);
    expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(v, '__proto__')).toBe(true);
    const flat = flatten(JSON.parse('{"__proto__":{"x":1},"a":1}'));
    expect(Object.keys(flat).sort()).toEqual(['/__proto__', '/a']);
  });

  it('a v1 (no envelope) row migrates: every field gets the row time and merges with a v2 edit', () => {
    const legacy = decode('{"a":1,"b":2}', { clock: formatHlc(1000, 0, 'L'), deleted: false })!;
    const edit = put(legacy, { a: 1, b: 5 }, formatHlc(2000, 0, 'A'));
    expect(val(merge(legacy, edit))).toEqual({ a: 1, b: 5 });
    const older = put(legacy, { a: 9, b: 2 }, formatHlc(500, 0, 'B'));
    expect(val(merge(legacy, older))).toEqual({ a: 1, b: 2 });
  });
});
