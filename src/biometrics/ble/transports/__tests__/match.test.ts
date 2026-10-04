import { describe, expect, it } from 'vitest';
import { fullUuid, matchesFilters, type Advertisement } from '../match';

const BASE = '-0000-1000-8000-00805f9b34fb';

describe('fullUuid', () => {
  it('expands a 16-bit number', () => {
    expect(fullUuid(0xfff0)).toBe(`0000fff0${BASE}`);
    expect(fullUuid(0x180f)).toBe(`0000180f${BASE}`);
  });
  it('expands a 4-hex string, in either case', () => {
    expect(fullUuid('fff0')).toBe(`0000fff0${BASE}`);
    expect(fullUuid('FFF0')).toBe(`0000fff0${BASE}`);
  });
  it('expands an 8-hex (32-bit) string', () => {
    expect(fullUuid('0000fff0')).toBe(`0000fff0${BASE}`);
    expect(fullUuid('12345678')).toBe(`12345678${BASE}`);
  });
  it('lower-cases a full uuid and leaves it otherwise alone', () => {
    expect(fullUuid('0000FFF0-0000-1000-8000-00805F9B34FB')).toBe(`0000fff0${BASE}`);
  });
  it('makes the three forms of one id equal', () => {
    expect(new Set([fullUuid(0xfff0), fullUuid('fff0'), fullUuid('0000fff0'), fullUuid(`0000FFF0${BASE.toUpperCase()}`)]).size).toBe(1);
  });
});

describe('matchesFilters', () => {
  const ring: Advertisement = {
    name: 'Ring 7307',
    services: [`0000fff0${BASE}`],
    manufacturerData: new Map([[0x1234, Uint8Array.of(0xaa, 0x23, 0x01)]]),
  };

  it('an empty filter list matches everything', () => {
    expect(matchesFilters({}, [])).toBe(true);
    expect(matchesFilters(ring, [])).toBe(true);
  });

  it('a filter object with no fields never matches', () => {
    expect(matchesFilters(ring, [{}])).toBe(false);
    expect(matchesFilters(ring, [{ services: [] }])).toBe(false);
    expect(matchesFilters(ring, [{ manufacturerData: [] }])).toBe(false);
    expect(matchesFilters({}, [{}])).toBe(false);
  });

  describe('services', () => {
    it('matches short and full ids against an advertised full id', () => {
      expect(matchesFilters(ring, [{ services: [0xfff0] }])).toBe(true);
      expect(matchesFilters(ring, [{ services: ['fff0'] }])).toBe(true);
      expect(matchesFilters(ring, [{ services: [`0000FFF0${BASE}`] }])).toBe(true);
    });
    it('matches a short advertised id against a full filter id', () => {
      expect(matchesFilters({ services: ['FFF0'] }, [{ services: [`0000fff0${BASE}`] }])).toBe(true);
    });
    it('needs every listed service', () => {
      expect(matchesFilters(ring, [{ services: [0xfff0, 0x180f] }])).toBe(false);
      expect(matchesFilters({ services: ['fff0', '180f'] }, [{ services: [0xfff0, 0x180f] }])).toBe(true);
    });
    it('does not match when nothing is advertised', () => {
      expect(matchesFilters({ name: 'Ring 7307' }, [{ services: [0xfff0] }])).toBe(false);
    });
  });

  describe('manufacturerData', () => {
    it('matches by company id alone', () => {
      expect(matchesFilters(ring, [{ manufacturerData: [{ companyIdentifier: 0x1234 }] }])).toBe(true);
      expect(matchesFilters(ring, [{ manufacturerData: [{ companyIdentifier: 0x4321 }] }])).toBe(false);
    });
    it('accepts a Record keyed by company id', () => {
      const rec: Advertisement = { manufacturerData: { [0x1234]: Uint8Array.of(0xaa, 0x23, 0x01) } };
      expect(matchesFilters(rec, [{ manufacturerData: [{ companyIdentifier: 0x1234 }] }])).toBe(true);
      expect(matchesFilters(rec, [{ manufacturerData: [{ companyIdentifier: 0x1235 }] }])).toBe(false);
    });
    it('checks the data prefix', () => {
      expect(matchesFilters(ring, [{ manufacturerData: [{ companyIdentifier: 0x1234, dataPrefix: Uint8Array.of(0xaa, 0x23) }] }])).toBe(true);
      expect(matchesFilters(ring, [{ manufacturerData: [{ companyIdentifier: 0x1234, dataPrefix: Uint8Array.of(0xaa, 0x24) }] }])).toBe(false);
    });
    it('fails when the prefix is longer than the data', () => {
      expect(matchesFilters(ring, [{ manufacturerData: [{ companyIdentifier: 0x1234, dataPrefix: Uint8Array.of(0xaa, 0x23, 0x01, 0x00) }] }])).toBe(false);
    });
    it('applies the mask to both sides', () => {
      const f = (mask: number[], prefix: number[]) => [{ manufacturerData: [{ companyIdentifier: 0x1234, dataPrefix: Uint8Array.from(prefix), mask: Uint8Array.from(mask) }] }];
      expect(matchesFilters(ring, f([0xf0], [0xa5]))).toBe(true); // 0xaa & 0xf0 = 0xa0 = 0xa5 & 0xf0
      expect(matchesFilters(ring, f([0xff], [0xa5]))).toBe(false);
      expect(matchesFilters(ring, f([0x00, 0xff], [0x00, 0x23]))).toBe(true);
      expect(matchesFilters(ring, f([0x00, 0xff], [0x00, 0x24]))).toBe(false);
    });
    it('a missing mask byte counts as 0xff', () => {
      expect(matchesFilters(ring, [{ manufacturerData: [{ companyIdentifier: 0x1234, dataPrefix: Uint8Array.of(0xaa, 0x23), mask: Uint8Array.of(0x00) }] }])).toBe(true);
      expect(matchesFilters(ring, [{ manufacturerData: [{ companyIdentifier: 0x1234, dataPrefix: Uint8Array.of(0xaa, 0x24), mask: Uint8Array.of(0x00) }] }])).toBe(false);
    });
    it('needs every listed company entry', () => {
      const both = [{ manufacturerData: [{ companyIdentifier: 0x1234 }, { companyIdentifier: 0x0001 }] }];
      expect(matchesFilters(ring, both)).toBe(false);
      const two: Advertisement = { manufacturerData: new Map([[0x1234, Uint8Array.of(1)], [0x0001, Uint8Array.of(2)]]) };
      expect(matchesFilters(two, both)).toBe(true);
    });
    it('does not match an advertisement without manufacturer data', () => {
      expect(matchesFilters({ name: 'Ring 7307' }, [{ manufacturerData: [{ companyIdentifier: 0x1234 }] }])).toBe(false);
    });
  });

  describe('names', () => {
    it('namePrefix matches the start of the name only', () => {
      expect(matchesFilters({ name: 'R02_341C' }, [{ namePrefix: 'R02_' }])).toBe(true);
      expect(matchesFilters({ name: 'R02_341C' }, [{ namePrefix: '341C' }])).toBe(false);
      expect(matchesFilters({ name: 'r02_341C' }, [{ namePrefix: 'R02_' }])).toBe(false);
    });
    it('namePrefix needs a name', () => {
      expect(matchesFilters({}, [{ namePrefix: 'R02_' }])).toBe(false);
    });
    it('name must match exactly', () => {
      expect(matchesFilters({ name: 'Ring 7307' }, [{ name: 'Ring 7307' }])).toBe(true);
      expect(matchesFilters({ name: 'Ring 7307 B' }, [{ name: 'Ring 7307' }])).toBe(false);
    });
  });

  describe('combining', () => {
    it('fields inside one filter are ANDed', () => {
      expect(matchesFilters(ring, [{ namePrefix: 'Ring', services: [0xfff0] }])).toBe(true);
      expect(matchesFilters(ring, [{ namePrefix: 'R02_', services: [0xfff0] }])).toBe(false);
      expect(matchesFilters(ring, [{ namePrefix: 'Ring', manufacturerData: [{ companyIdentifier: 0x9999 }] }])).toBe(false);
    });
    it('filters in the list are ORed', () => {
      const filters = [{ namePrefix: 'R02_' }, { manufacturerData: [{ companyIdentifier: 0x1234 }] }];
      expect(matchesFilters(ring, filters)).toBe(true); // second only
      expect(matchesFilters({ name: 'R02_341C' }, filters)).toBe(true); // first only
      expect(matchesFilters({ name: 'Other' }, filters)).toBe(false);
    });
    it('an empty filter in the list does not block a later match, nor match by itself', () => {
      expect(matchesFilters(ring, [{}, { namePrefix: 'Ring' }])).toBe(true);
      expect(matchesFilters({ name: 'Other' }, [{}, { namePrefix: 'Ring' }])).toBe(false);
    });
  });
});
