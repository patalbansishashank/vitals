// @vitest-environment node
import { ENGINE_VERSION } from '@/engine/core/defaults';
import { CONTRACT_FINGERPRINT } from '@/lib/bodyContracts';
import { engineSemanticsKey, inputsHash, stableStringify } from './hash';

describe('simulator input hash (C7)', () => {
  it('is independent of property order and covers the engine version and contract fingerprint', () => {
    expect(inputsHash({ a: 1, b: { c: 2, d: undefined } }, [1, 2])).toBe(inputsHash({ b: { c: 2 }, a: 1 }, [1, 2]));
    expect(inputsHash({ a: 1 }, [1])).not.toBe(inputsHash({ a: 2 }, [1]));
    expect(engineSemanticsKey()).toBe(`${ENGINE_VERSION}|${CONTRACT_FINGERPRINT}`);
    expect(stableStringify({ b: 1, a: [true, null] })).toBe('{"a":[true,null],"b":1}');
  });
});
