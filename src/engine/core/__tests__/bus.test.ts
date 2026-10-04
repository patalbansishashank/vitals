// @vitest-environment node
import { createSignalBus, resetSignalBus, SIGNAL_DEFS } from '../../types/signals';

/** V8 intrinsics are available only after enabling natives syntax (before compiling the probe functions). */
function probe(): { fast: (o: object) => boolean; sameMap: (a: object, b: object) => boolean } | null {
  try {
    const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
    const v8 = proc?.getBuiltinModule?.('node:v8') as { setFlagsFromString(flag: string): void } | undefined;
    if (!v8) return null;
    v8.setFlagsFromString('--allow-natives-syntax');
    const fast = new Function('o', 'return %HasFastProperties(o)') as (o: object) => boolean;
    const sameMap = new Function('a', 'b', 'return %HaveSameMap(a, b)') as (a: object, b: object) => boolean;
    return { fast, sameMap };
  } catch {
    return null;
  }
}

describe('signal bus (MODEL_SPEC §4, CONTRACT_REQUESTS performance)', () => {
  it('holds every signal at its initial value, in contract order', () => {
    const bus = createSignalBus() as unknown as Record<string, number>;
    expect(Object.keys(bus)).toEqual(SIGNAL_DEFS.map((d) => d.name));
    for (const d of SIGNAL_DEFS) expect(bus[d.name]).toBe(d.init);
    bus[SIGNAL_DEFS[0]!.name] = 123;
    resetSignalBus(bus as never);
    expect(bus[SIGNAL_DEFS[0]!.name]).toBe(SIGNAL_DEFS[0]!.init);
  });

  it('has fast properties and one hidden class across runs (V8)', () => {
    const p = probe();
    if (!p) return; // not V8 / intrinsics unavailable
    const a = createSignalBus();
    const b = createSignalBus();
    (a as unknown as Record<string, number>).fatMassKg = 12.345; // double write keeps the object fast
    expect(p.fast(a)).toBe(true);
    expect(p.fast(b)).toBe(true);
    expect(p.sameMap(createSignalBus(), createSignalBus())).toBe(true);
  });
});
