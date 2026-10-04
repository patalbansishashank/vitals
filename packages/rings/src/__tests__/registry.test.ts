// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { RING_FAMILIES, familyById, matchFamily, rerouteAfterDiscovery } from '../index';
import { fromHex, normalizeUuid } from '../types';

describe('family registry', () => {
  it('lists each family once, J-Style first, the generic name last', () => {
    const ids = RING_FAMILIES.map((f) => f.id);
    expect(ids[0]).toBe('jstyle2301');
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.indexOf('jring')).toBe(ids.length - 1);
    for (const f of RING_FAMILIES) expect(familyById(f.id)).toBe(f);
  });

  it('matches advertisements in registry order', () => {
    expect(matchFamily({ serviceUuids: [], manufacturerData: [fromHex('34 12 44 23 01')] })?.id).toBe('jstyle2301');
    expect(matchFamily({ name: 'SMART_RING', serviceUuids: [], manufacturerData: [] })?.id).toBe('jring');
    expect(matchFamily({ name: 'R02_1A2B', serviceUuids: [], manufacturerData: [] })?.id).toBe('colmi');
    expect(matchFamily({ name: 'Something else', serviceUuids: [], manufacturerData: [] })).toBeUndefined();
  });

  it('reroutes after service discovery like Lumen', () => {
    const jring = familyById('jring')!;
    const colmi = familyById('colmi')!;
    expect(rerouteAfterDiscovery(jring, [normalizeUuid('6e40fff0-b5a3-f393-e0a9-e50e24dcca9e')]).id).toBe('colmi');
    expect(rerouteAfterDiscovery(jring, ['000056ff-0000-1000-8000-00805f9b34fb']).id).toBe('jring');
    // CRP (fdda) goes to the CRP family once it is registered; until then the scanned family stays.
    const r = rerouteAfterDiscovery(jring, [normalizeUuid(0xfdda)]);
    expect(familyById('crp') ? r.id : r.id).toBe(familyById('crp') ? 'crp' : 'jring');
    expect(rerouteAfterDiscovery(colmi, [normalizeUuid(0xfdda), normalizeUuid('6e40fff0-b5a3-f393-e0a9-e50e24dcca9e')]).id).toBe('colmi');
  });
});
