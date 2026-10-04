/**
 * Snapshot-level re-anchoring (CR-L2 on a captured state rather than inside a run): returns a NEW day-stamped snapshot
 * whose composition state and bus carry the anchor, plus the ledger entry. Used when a confirmed state must be adjusted
 * without a replay (e.g. the planner's particle states); the living plan itself replays with `RunOptions.anchors`, which
 * gives the same state (tested). Pure: the input snapshot is never mutated.
 */
import { SIGNAL_DEFS } from '../types/signals';
import type { AnchorApplied, AnchorSpec, EngineSnapshot } from '../types/result';
import { applyTissueAnchor, type AnchorBusView, type AnchorConstants } from './runHooks';

const BUS_FIELDS: ReadonlyArray<keyof AnchorBusView> = [
  'fatMassKg', 'leanTissueKg', 'ffmActKg', 'tissueMassKg', 'skeletalMuscleKg', 'vatKg', 'labileWaterKg', 'scaleWeightKg',
];
const BUS_INDEX: Record<string, number> = Object.fromEntries(SIGNAL_DEFS.map((d, i) => [d.name, i]));

export const DEFAULT_ANCHOR_CONSTANTS: AnchorConstants = { rhoF: 9441, rhoL: 1816, smLossShare: 0.5 };

export function reanchorSnapshot(
  snap: EngineSnapshot,
  spec: Omit<AnchorSpec, 'day'>,
  c: AnchorConstants = DEFAULT_ANCHOR_CONSTANTS,
): { snapshot: EngineSnapshot; applied: AnchorApplied } {
  const ci = snap.moduleIds.indexOf('composition');
  if (ci < 0) throw new Error('snapshot has no composition module');
  const states = snap.states.map((s, i) => (i === ci ? structuredClone(s) : s));
  const bus = new Float64Array(snap.bus);
  const view = {} as AnchorBusView;
  for (const f of BUS_FIELDS) view[f] = bus[BUS_INDEX[f]!]!;
  const applied = applyTissueAnchor(states[ci], view, { ...spec, day: snap.day ?? 0 }, c);
  for (const f of BUS_FIELDS) bus[BUS_INDEX[f]!] = view[f];
  return { snapshot: { ...snap, states, bus }, applied };
}
