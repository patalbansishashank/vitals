/**
 * Placeholder-physics module set for the core's own tests (loop, recorder, burn-in, conservation plumbing,
 * benchmark of the contract overhead). The real modules in `src/engine/model/**` are being implemented in parallel,
 * so the core tests must not depend on their physics. Each stub copies the real module's metadata (id, reads, writes,
 * records, params) so shapes and wiring match the contract; only intake, energy, composition and water carry the
 * minimal energy/mass placeholder of MODEL_SPEC §1 (all stored energy to fat, scale = tissue mass).
 */
import { defineModule } from '../moduleKit';
import { MODULES } from '../moduleRegistry';
import { MI } from '../../types/metrics';
import type { AnyEngineModule, ModuleContext } from '../../types/module';
import type { SignalBus } from '../../types/signals';

const RHO_F = 9441 + 179;

interface CompS {
  fm: number;
  fm0: number;
  ffm0: number;
}

/** Spy counters for the burn-in tests. */
export const stubSpy = { endBurnInCalls: 0, lastBurnInDays: -1, burnInExerciseDays: 0 };

/** Contract metadata only (never the real module's hooks). */
function meta(id: string) {
  const m = MODULES.find((x) => x.id === id);
  if (!m) throw new Error(`no module ${id}`);
  return { id: m.id, specSection: m.specSection, dossiers: m.dossiers, params: m.params, reads: m.reads, writes: m.writes, records: m.records };
}

function stub(id: string, extra: Record<string, unknown> = {}): AnyEngineModule {
  return defineModule<object>({
    ...meta(id),
    init: () => ({}),
    ...extra,
  }) as unknown as AnyEngineModule;
}

export function makeStubModules(): AnyEngineModule[] {
  const intake = stub('intake', {
    stepHour: (_s: object, _k: object, bus: SignalBus, hour: { kcal: number; exCarbG: number }) => {
      bus.eAbsKcalH = hour.kcal + 4 * hour.exCarbG;
    },
  });
  const energy = defineModule<{ tee: number }>({
    ...meta('energy'),
    init: (_k, ctx: ModuleContext) => ({ tee: ctx.profile.tdee0Kcal / 24 }),
    stepHour: (s, _k, bus) => {
      bus.teePreKcalH = s.tee;
    },
    recordHour: (s, _k, _bus, out) => {
      out[MI.tdee] = s.tee;
    },
  }) as unknown as AnyEngineModule;
  const activity = stub('activity', {
    startDay: (_s: object, _k: object, _bus: SignalBus, day: { nSessions: number }, clock: { day: number }) => {
      if (clock.day < 0 && day.nSessions > 0) stubSpy.burnInExerciseDays++;
    },
  });
  const composition = defineModule<CompS>({
    ...meta('composition'),
    init: (_k, ctx, bus) => {
      const s = { fm: ctx.profile.fm0Kg, fm0: ctx.profile.fm0Kg, ffm0: ctx.profile.ffm0Kg };
      bus.fatMassKg = s.fm;
      bus.leanTissueKg = s.ffm0;
      bus.ffmActKg = s.ffm0;
      bus.tissueMassKg = s.fm + s.ffm0;
      return s;
    },
    stepHour: (s, _k, bus) => {
      const S = bus.eAbsKcalH - bus.teePreKcalH - bus.dnlHeatKcalH - bus.ketoneLossKcalH - bus.glycogenChangeKcalH;
      s.fm += S / RHO_F;
      bus.tissueEnergyKcalH = S;
      bus.depositionCostKcalH = (179 * S) / RHO_F;
      bus.fatMassKg = s.fm;
      bus.leanTissueKg = s.ffm0;
      bus.ffmActKg = s.ffm0;
      bus.tissueMassKg = s.fm + s.ffm0;
    },
    endBurnIn: (s, _k, bus, ctx) => {
      // review B3: FM/LT/SM back to the profile values at the end of burn-in
      stubSpy.endBurnInCalls++;
      stubSpy.lastBurnInDays = ctx.burnInDays ?? 0;
      s.fm = s.fm0;
      bus.fatMassKg = s.fm;
      bus.tissueMassKg = s.fm + s.ffm0;
    },
    recordDay: (s, _k, _bus, out) => {
      out[MI.fatMass] = s.fm;
    },
  }) as unknown as AnyEngineModule;
  const water = stub('water', {
    stepHour: (_s: object, _k: object, bus: SignalBus) => {
      bus.labileWaterKg = 0;
      bus.scaleWeightKg = bus.tissueMassKg;
    },
    recordHour: (_s: object, _k: object, bus: SignalBus, out: Float64Array) => {
      out[MI.scaleWeight] = bus.scaleWeightKg;
    },
  });
  const special: Record<string, AnyEngineModule> = { intake, energy, activity, composition, water };
  return MODULES.map((m) => special[m.id] ?? stub(m.id));
}

export const STUB_MODULES: readonly AnyEngineModule[] = makeStubModules();
