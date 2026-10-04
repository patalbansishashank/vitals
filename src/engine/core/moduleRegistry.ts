/**
 * Ordered module registry (docs/MODEL_SPEC.md §3). The array order IS the within-hour evaluation order.
 * Replacing a stub with its implementation only changes the import inside the module's own folder.
 */
import type { AnyEngineModule } from '../types/module';
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

/** MODEL_SPEC §3.1 hourly order. Daily hooks run in the same order. */
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
  return { issues, pending, timing };
}
