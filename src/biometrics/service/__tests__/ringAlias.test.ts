/**
 * L-REV2 R3-10, R3-11: the alias agents get for a ring key (nothing in it comes from the ring's id: a number per family
 * and model in the order the sources were created) and the label a ring source shows from the family table. Synthetic
 * ids only.
 */
import { describe, expect, it } from 'vitest';
import { aliasRingKeys, ringAliases, ringSourceLabel } from '../identity';

const SERIAL = 'ble:jstyle2301/2301/serial:TEST0001';
const MAC = 'ble:jstyle2301/2301/mac:aa:bb:cc:00:11:22';
const ADV = 'ble:jstyle2301/2301/adv:AbCdEf0123456789==';
const LEGACY = 'ble:jstyle2301|j-style:2301#c3d94f2a';

describe('ringAliases', () => {
  it('numbers the rings of one family and model by creation time, then key, whatever order they come in', () => {
    const docs = [
      { sourceKey: ADV, createdAt: '2026-09-02T10:00:00.000Z' },
      { sourceKey: SERIAL, createdAt: '2026-09-01T10:00:00.000Z' },
      { sourceKey: MAC },
      { sourceKey: 'ble:colmi/R02/mac:aa:bb:cc:00:11:33', createdAt: '2026-09-03T10:00:00.000Z' },
    ];
    for (const list of [docs, [...docs].reverse()]) {
      const alias = ringAliases(list);
      expect([SERIAL, ADV, MAC, 'ble:colmi/R02/mac:aa:bb:cc:00:11:33'].map(alias)).toEqual([
        'ble:jstyle2301/2301/ring1', 'ble:jstyle2301/2301/ring2', 'ble:jstyle2301/2301/ring3', 'ble:colmi/R02/ring1',
      ]);
    }
  });

  it('a key from before v0.5.0 is numbered per driver; a ring key without a document gets no number', () => {
    const alias = ringAliases([{ sourceKey: LEGACY }, { sourceKey: SERIAL }]);
    expect(alias(LEGACY)).toBe('ble:jstyle2301|ring1');
    expect(alias('ble:jstyle2301/2301/serial:OTHER0002')).toBe('ble:jstyle2301/2301/ring');
    expect(alias('ble:jstyle2301|j-style:2301#0000')).toBe('ble:jstyle2301|ring');
  });

  it('leaves an alias, a key with no id and every other source as they are', () => {
    const alias = ringAliases([{ sourceKey: SERIAL }]);
    for (const k of ['ble:jstyle2301/2301/ring1', 'ble:jstyle2301|ring2', 'ble:jstyle2301/2301/ring', 'ble:jstyle2301', 'manual', 'file:apple_health|app:health', 'file:lumen_cloudevents|:j-style_2301']) expect(alias(k)).toBe(k);
  });

  it('aliasRingKeys reaches every ring key in a value, inside text and object keys too', () => {
    const docs = [{ sourceKey: MAC, createdAt: '2026-09-01T10:00:00.000Z' }, { sourceKey: SERIAL, createdAt: '2026-09-02T10:00:00.000Z' }];
    const v = { sourceKey: MAC, docs: [{ id: `lease:${SERIAL}` }], byKey: { [LEGACY]: 1 }, n: 3, none: null };
    expect(aliasRingKeys(v, docs)).toEqual({ sourceKey: 'ble:jstyle2301/2301/ring1', docs: [{ id: 'lease:ble:jstyle2301/2301/ring2' }], byKey: { 'ble:jstyle2301|ring': 1 }, n: 3, none: null });
    const plain = { a: [1, 'x'] };
    expect(aliasRingKeys(plain, docs)).toBe(plain);
  });

  it('a stored key is replaced whole, a space in its id or a full stop after it included', () => {
    const spaced = 'ble:jstyle2301/2301/serial:AB 12';
    const docs = [{ sourceKey: spaced, createdAt: '2026-09-01T10:00:00.000Z' }, { sourceKey: MAC, createdAt: '2026-09-02T10:00:00.000Z' }];
    expect(aliasRingKeys({ text: `Synced ${spaced} today; then ${MAC}.` }, docs)).toEqual({ text: 'Synced ble:jstyle2301/2301/ring1 today; then ble:jstyle2301/2301/ring2.' });
    // a key the store does not hold keeps what follows it
    expect(aliasRingKeys(['gone: ble:jstyle2301/2301/serial:OTHER0002.', 'ble:jstyle2301|j-style:2301#0000, then'], docs)).toEqual(['gone: ble:jstyle2301/2301/ring.', 'ble:jstyle2301|ring, then']);
  });

  it('dates and typed arrays in a value with a ring key pass through as they are', () => {
    const at = new Date('2026-10-01T06:00:00.000Z');
    const xs = new Float32Array([1, 2]);
    const r = aliasRingKeys({ sourceKey: MAC, at, xs, nested: [{ at }] }, [{ sourceKey: MAC }]);
    expect(r.sourceKey).toBe('ble:jstyle2301/2301/ring1');
    expect(r.at).toBe(at);
    expect(r.xs).toBe(xs);
    expect(r.nested[0]!.at).toBe(at);
  });
});

describe('ringSourceLabel', () => {
  it('names a ring source from the table, whatever it stored', () => {
    expect(ringSourceLabel({ sourceKey: SERIAL })).toBe('J-Style 2301');
    expect(ringSourceLabel({ sourceKey: 'ble:colmi/R02/mac:aa:bb:cc:00:11:22', ble: { driver: 'colmi-r02' } }, 'ADV-NAME 77')).toBe('Colmi R02 ring');
    expect(ringSourceLabel({ sourceKey: 'ble:jstyle2301|j-style:2301' }, 'ADV-NAME 77')).toBe('J-Style 2301');
    expect(ringSourceLabel({ sourceKey: 'file:lumen_cloudevents|:j-style_2301' })).toBe('J-Style 2301');
  });

  it('a driver the table does not know keeps a given label, else its id; other sources have none', () => {
    expect(ringSourceLabel({ sourceKey: 'ble:other|x:y', ble: { driver: 'other' } }, 'Other ring')).toBe('Other ring');
    expect(ringSourceLabel({ sourceKey: 'ble:other|x:y', ble: { driver: 'other' } })).toBe('other');
    expect(ringSourceLabel({ sourceKey: 'file:apple_health|app:health' }, 'Health')).toBeUndefined();
    expect(ringSourceLabel({ sourceKey: 'manual' })).toBeUndefined();
  });
});
