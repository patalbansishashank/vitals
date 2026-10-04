import { RING_FAMILIES } from '@vitals/rings';

describe('@vitals/rings', () => {
  it('resolves by its package name', () => {
    expect(Array.isArray(RING_FAMILIES)).toBe(true);
  });
});
