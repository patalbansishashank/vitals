/**
 * Ordered module registry (docs/MODEL_SPEC.md §3). The array order IS the within-hour evaluation order.
 * Replacing a stub with its implementation only changes the import inside the module's own folder.
 */
import type { AnyEngineModule, ModuleHook, SignalHookDecl, StepClock } from '../types/module';
import type { DayInput, HourInput } from '../types/inputs';
import type { SignalBus } from '../types/signals';
import { SIGNAL_DEFS, type ModuleId, type SignalName } from '../types/signals';
import { moderatorsModule } from '../model/moderators';
import { activityModule } from '../model/activity';
import { intakeModule } from '../model/intake';
import { fastingModule } from '../model/fasting';
import { energyModule } from '../model/energy';
import { fuelModule } from '../model/fuel';
import { ketonesModule } from '../model/ketones';
import { compositionModule } from '../model/composition';
import { muscleModule } from '../model/muscle';
import { waterModule } from '../model/water';
import { cellularModule } from '../model/cellular';
import { hormonesModule } from '../model/hormones';
import { appetiteModule } from '../model/appetite';
import { cardiometabolicModule } from '../model/cardiometabolic';
import { wellbeingModule } from '../model/wellbeing';
import { safetyModule } from '../model/safety';

/**
 * MODEL_SPEC §3.1 hourly order. Daily hooks run in the same order. D1-01: energy stays before fuel/composition (moving it
 * would change other same-hour dependencies); its daily TEE accumulators are corrected at the daily close by energy itself
 * (endpoint correction of the DNL heat and deposition cost written later in the hour), not by reordering modules here.
 */
export const MODULES: readonly AnyEngineModule[] = [
  moderatorsModule,
  activityModule,
  intakeModule,
  fastingModule,
  energyModule,
  fuelModule,
  ketonesModule,
  compositionModule,
  muscleModule,
  waterModule,
  cellularModule,
  hormonesModule,
  appetiteModule,
  cardiometabolicModule,
  wellbeingModule,
  safetyModule,
] as unknown as readonly AnyEngineModule[];

// Bind once so each hot call site has a stable target and preserves the provider as its receiver.
// Keep the original hook identities for the guard: instrumentation/replacements must use generic dispatch.
const moderatorsStep = moderatorsModule.stepHour;
const callModeratorsStep = moderatorsStep.bind(moderatorsModule);
const activityStep = activityModule.stepHour;
const callActivityStep = activityStep.bind(activityModule);
const intakeStep = intakeModule.stepHour;
const callIntakeStep = intakeStep.bind(intakeModule);
const fastingStep = fastingModule.stepHour;
const callFastingStep = fastingStep.bind(fastingModule);
const energyStep = energyModule.stepHour;
const callEnergyStep = energyStep.bind(energyModule);
const fuelStep = fuelModule.stepHour;
const callFuelStep = fuelStep.bind(fuelModule);
const ketonesStep = ketonesModule.stepHour;
const callKetonesStep = ketonesStep.bind(ketonesModule);
const compositionStep = compositionModule.stepHour;
const callCompositionStep = compositionStep.bind(compositionModule);
const muscleStep = muscleModule.stepHour;
const callMuscleStep = muscleStep.bind(muscleModule);
const waterStep = waterModule.stepHour;
const callWaterStep = waterStep.bind(waterModule);
const cellularStep = cellularModule.stepHour;
const callCellularStep = cellularStep.bind(cellularModule);
const hormonesStep = hormonesModule.stepHour;
const callHormonesStep = hormonesStep.bind(hormonesModule);
const appetiteStep = appetiteModule.stepHour;
const callAppetiteStep = appetiteStep.bind(appetiteModule);
const cardiometabolicStep = cardiometabolicModule.stepHour;
const callCardiometabolicStep = cardiometabolicStep.bind(cardiometabolicModule);
const wellbeingStep = wellbeingModule.stepHour;
const callWellbeingStep = wellbeingStep.bind(wellbeingModule);
const safetyStep = safetyModule.stepHour;
const callSafetyStep = safetyStep.bind(safetyModule);

/** Verify layout and hook identities once per run; registry edits/replacements retain the generic path. */
export function hasDefaultHourOrder(modules: readonly AnyEngineModule[]): boolean {
  return modules.length === 16
    && modules[0] === (moderatorsModule as unknown as AnyEngineModule) && moderatorsModule.stepHour === moderatorsStep
    && modules[1] === (activityModule as unknown as AnyEngineModule) && activityModule.stepHour === activityStep
    && modules[2] === (intakeModule as unknown as AnyEngineModule) && intakeModule.stepHour === intakeStep
    && modules[3] === (fastingModule as unknown as AnyEngineModule) && fastingModule.stepHour === fastingStep
    && modules[4] === (energyModule as unknown as AnyEngineModule) && energyModule.stepHour === energyStep
    && modules[5] === (fuelModule as unknown as AnyEngineModule) && fuelModule.stepHour === fuelStep
    && modules[6] === (ketonesModule as unknown as AnyEngineModule) && ketonesModule.stepHour === ketonesStep
    && modules[7] === (compositionModule as unknown as AnyEngineModule) && compositionModule.stepHour === compositionStep
    && modules[8] === (muscleModule as unknown as AnyEngineModule) && muscleModule.stepHour === muscleStep
    && modules[9] === (waterModule as unknown as AnyEngineModule) && waterModule.stepHour === waterStep
    && modules[10] === (cellularModule as unknown as AnyEngineModule) && cellularModule.stepHour === cellularStep
    && modules[11] === (hormonesModule as unknown as AnyEngineModule) && hormonesModule.stepHour === hormonesStep
    && modules[12] === (appetiteModule as unknown as AnyEngineModule) && appetiteModule.stepHour === appetiteStep
    && modules[13] === (cardiometabolicModule as unknown as AnyEngineModule) && cardiometabolicModule.stepHour === cardiometabolicStep
    && modules[14] === (wellbeingModule as unknown as AnyEngineModule) && wellbeingModule.stepHour === wellbeingStep
    && modules[15] === (safetyModule as unknown as AnyEngineModule) && safetyModule.stepHour === safetyStep;
}

/** Stable canonical dispatch. Call only after hasDefaultHourOrder; custom module lists use dispatch.ts. */
export function stepDefaultHour(s: object[], k: object[], bus: SignalBus, h: HourInput, d: DayInput, c: StepClock): void {
  callModeratorsStep(s[0] as Parameters<typeof moderatorsModule.stepHour>[0], k[0] as Parameters<typeof moderatorsModule.stepHour>[1], bus, h, d, c);
  callActivityStep(s[1] as Parameters<typeof activityModule.stepHour>[0], k[1] as Parameters<typeof activityModule.stepHour>[1], bus, h, d, c);
  callIntakeStep(s[2] as Parameters<typeof intakeModule.stepHour>[0], k[2] as Parameters<typeof intakeModule.stepHour>[1], bus, h, d, c);
  callFastingStep(s[3] as Parameters<typeof fastingModule.stepHour>[0], k[3] as Parameters<typeof fastingModule.stepHour>[1], bus, h, d, c);
  callEnergyStep(s[4] as Parameters<typeof energyModule.stepHour>[0], k[4] as Parameters<typeof energyModule.stepHour>[1], bus, h, d, c);
  callFuelStep(s[5] as Parameters<typeof fuelModule.stepHour>[0], k[5] as Parameters<typeof fuelModule.stepHour>[1], bus, h, d, c);
  callKetonesStep(s[6] as Parameters<typeof ketonesModule.stepHour>[0], k[6] as Parameters<typeof ketonesModule.stepHour>[1], bus, h, d, c);
  callCompositionStep(s[7] as Parameters<typeof compositionModule.stepHour>[0], k[7] as Parameters<typeof compositionModule.stepHour>[1], bus, h, d, c);
  callMuscleStep(s[8] as Parameters<typeof muscleModule.stepHour>[0], k[8] as Parameters<typeof muscleModule.stepHour>[1], bus, h, d, c);
  callWaterStep(s[9] as Parameters<typeof waterModule.stepHour>[0], k[9] as Parameters<typeof waterModule.stepHour>[1], bus, h, d, c);
  callCellularStep(s[10] as Parameters<typeof cellularModule.stepHour>[0], k[10] as Parameters<typeof cellularModule.stepHour>[1], bus, h, d, c);
  callHormonesStep(s[11] as Parameters<typeof hormonesModule.stepHour>[0], k[11] as Parameters<typeof hormonesModule.stepHour>[1], bus, h, d, c);
  callAppetiteStep(s[12] as Parameters<typeof appetiteModule.stepHour>[0], k[12] as Parameters<typeof appetiteModule.stepHour>[1], bus, h, d, c);
  callCardiometabolicStep(s[13] as Parameters<typeof cardiometabolicModule.stepHour>[0], k[13] as Parameters<typeof cardiometabolicModule.stepHour>[1], bus, h, d, c);
  callWellbeingStep(s[14] as Parameters<typeof wellbeingModule.stepHour>[0], k[14] as Parameters<typeof wellbeingModule.stepHour>[1], bus, h, d, c);
  callSafetyStep(s[15] as Parameters<typeof safetyModule.stepHour>[0], k[15] as Parameters<typeof safetyModule.stepHour>[1], bus, h, d, c);
}

export const MODULE_ORDER: readonly ModuleId[] = MODULES.map((m) => m.id);

export interface WiringIssue {
  module: ModuleId;
  signal: string;
  problem: string;
}

/**
 * Structural checks (run in tests): each signal written only by its declared writer, every declared write exists,
 * every read exists. Returns the resolved timing of each read ('same-hour' when the writer runs earlier in the hour,
 * 'previous-hour' otherwise; daily signals are previous-day unless written in startDay by an earlier module).
 */
/**
 * Contract check (MODEL_SPEC §4). `issues` are hard violations (writing a signal owned by another module or not
 * declared, reading an undeclared signal, reading a signal whose SIGNAL_DEFS readers omit the reader). `pending` lists
 * contract entries a module has not adopted yet (owner does not declare a write, listed reader does not declare the
 * read) — allowed while modules are implemented in parallel; unwritten signals keep their init value.
 */
export function checkWiring(modules: readonly AnyEngineModule[] = MODULES): {
  issues: WiringIssue[];
  pending: WiringIssue[];
  timing: { reader: ModuleId; signal: SignalName; writer: ModuleId; timing: 'same-hour' | 'previous-hour' }[];
} {
  const issues: WiringIssue[] = [];
  const pending: WiringIssue[] = [];
  const timing: { reader: ModuleId; signal: SignalName; writer: ModuleId; timing: 'same-hour' | 'previous-hour' }[] = [];
  const order = new Map(modules.map((m, i) => [m.id, i]));
  const defs = new Map<string, (typeof SIGNAL_DEFS)[number]>(SIGNAL_DEFS.map((d) => [d.name, d]));
  for (const m of modules) {
    for (const w of m.writes) {
      const d = defs.get(w);
      if (!d) issues.push({ module: m.id, signal: w, problem: 'writes an undeclared signal' });
      else if (d.writer !== m.id) issues.push({ module: m.id, signal: w, problem: `signal is owned by ${d.writer}` });
    }
    for (const r of m.reads) {
      const d = defs.get(r);
      if (!d) {
        issues.push({ module: m.id, signal: r, problem: 'reads an undeclared signal' });
        continue;
      }
      const wi = order.get(d.writer) ?? -1;
      const ri = order.get(m.id) ?? -1;
      timing.push({ reader: m.id, signal: r as SignalName, writer: d.writer, timing: wi < ri ? 'same-hour' : 'previous-hour' });
    }
  }
  for (const d of SIGNAL_DEFS) {
    const w = modules.find((m) => m.id === d.writer);
    if (w && !w.writes.includes(d.name as SignalName)) pending.push({ module: d.writer, signal: d.name, problem: 'owner does not declare the write' });
    // the readers column of MODEL_SPEC §4 must match the modules' declared reads exactly
    for (const r of d.readers as readonly ModuleId[]) {
      const m = modules.find((x) => x.id === r);
      if (m && !m.reads.includes(d.name as SignalName)) pending.push({ module: r, signal: d.name, problem: 'listed as reader in SIGNAL_DEFS but does not declare the read' });
    }
  }
  for (const m of modules) {
    for (const r of m.reads) {
      const d = defs.get(r);
      if (d && !(d.readers as readonly ModuleId[]).includes(m.id)) issues.push({ module: m.id, signal: r, problem: 'reads a signal whose SIGNAL_DEFS readers omit it' });
    }
  }
  issues.push(...checkSignalHooks(modules));
  return { issues, pending, timing };
}

/**
 * Position of a hook inside one day's pass (D8-07): startDay, then the hours (stepHour, recordHour), then endOfDay and
 * recordDay. `init`/`endBurnIn` run outside the day passes (they set initial values), so they never satisfy a same-pass read.
 */
const HOOK_RANK: Readonly<Record<ModuleHook, number>> = { init: -1, endBurnIn: -1, startDay: 1, stepHour: 2, recordHour: 3, endOfDay: 4, recordDay: 5 };

/** Whether a write at (writer index, hook) happens before a read at (reader index, hook) within the same pass. */
function writesBefore(wi: number, wh: ModuleHook, ri: number, rh: ModuleHook): boolean {
  const a = HOOK_RANK[wh];
  const b = HOOK_RANK[rh];
  if (a < 0 || b < 0) return false;
  return a < b || (a === b && wi < ri);
}

/**
 * Hook-aware signal declarations (D8-07, C7). For every module that declares `signalHooks`: each declared write must be the
 * signal's SIGNAL_DEFS writer and in the module's `writes`; each declared read must be in its `reads` and state its lag
 * (reads in init/endBurnIn take initial values outside the day passes and need none);
 * every declared write/read signal of the module needs at least one hook declaration (undeclared = failure). When the
 * writer declares its hooks too, the read lag must match the actual order: lag 0 needs a write earlier in the same pass
 * (an earlier hook, or the same hook in an earlier module), lag 1 needs no such write (the value read is the previous
 * step's/day's). Hourly module order alone cannot describe both, e.g. same-endOfDay daily EEE (lag 0) and a next-day
 * strength multiplier read by an earlier module (lag 1). Modules without declarations are not checked here (adoption is
 * reported through the ordinary `pending` contract list).
 */
export function checkSignalHooks(modules: readonly AnyEngineModule[] = MODULES): WiringIssue[] {
  const issues: WiringIssue[] = [];
  const defs = new Map<string, (typeof SIGNAL_DEFS)[number]>(SIGNAL_DEFS.map((d) => [d.name, d]));
  const order = new Map(modules.map((m, i) => [m.id, i]));
  const hooksOf = new Map<ModuleId, readonly SignalHookDecl[]>();
  for (const m of modules) if (m.signalHooks && m.signalHooks.length > 0) hooksOf.set(m.id, m.signalHooks);
  for (const [id, decls] of hooksOf) {
    const m = modules[order.get(id)!]!;
    for (const h of decls) {
      const d = defs.get(h.signal);
      if (!d) {
        issues.push({ module: id, signal: h.signal, problem: `hook declaration names an undeclared signal (${h.hook})` });
        continue;
      }
      if (h.access === 'write') {
        if (d.writer !== id) issues.push({ module: id, signal: h.signal, problem: `declares a write in ${h.hook} but the signal is owned by ${d.writer}` });
        else if (!m.writes.includes(h.signal)) issues.push({ module: id, signal: h.signal, problem: `declares a write in ${h.hook} that is missing from writes` });
        if (h.lag !== undefined) issues.push({ module: id, signal: h.signal, problem: 'a write declaration carries a lag (lags describe reads only)' });
      } else {
        if (!m.reads.includes(h.signal)) issues.push({ module: id, signal: h.signal, problem: `declares a read in ${h.hook} that is missing from reads` });
        // init/endBurnIn read initial values outside the day passes: no lag to declare there
        if (h.lag === undefined && HOOK_RANK[h.hook] >= 0) issues.push({ module: id, signal: h.signal, problem: `read in ${h.hook} without a declared lag` });
      }
    }
    for (const w of m.writes) if (!decls.some((h) => h.access === 'write' && h.signal === w)) issues.push({ module: id, signal: w, problem: 'write without a hook declaration' });
    for (const r of m.reads) if (!decls.some((h) => h.access === 'read' && h.signal === r)) issues.push({ module: id, signal: r, problem: 'read without a hook declaration' });
  }
  // lag consistency against the writer's declared hooks
  for (const [id, decls] of hooksOf) {
    const ri = order.get(id)!;
    for (const h of decls) {
      if (h.access !== 'read' || h.lag === undefined || HOOK_RANK[h.hook] < 0) continue;
      const d = defs.get(h.signal);
      if (!d) continue;
      const wDecls = hooksOf.get(d.writer);
      if (!wDecls) continue;
      const wi = order.get(d.writer);
      if (wi === undefined) continue;
      const writes = wDecls.filter((w) => w.access === 'write' && w.signal === h.signal);
      if (writes.length === 0) continue;
      const before = writes.some((w) => writesBefore(wi, w.hook, ri, h.hook));
      if (h.lag === 0 && !before) issues.push({ module: id, signal: h.signal, problem: `read in ${h.hook} declares lag 0 but ${d.writer} writes it later in the pass` });
      if (h.lag === 1 && before) issues.push({ module: id, signal: h.signal, problem: `read in ${h.hook} declares lag 1 but ${d.writer} writes it earlier in the same pass` });
    }
  }
  return issues;
}
