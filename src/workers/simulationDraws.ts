/**
 * Simulator ensemble chunks (MODEL_SPEC §8.1, D8-02), the pure part of the engine worker's `simulateDraws`: draws
 * [start, start + count) of a `total`-draw seeded Latin hypercube, each returned as its member envelope (`core/bands.ts`):
 * band inputs (raw daily values, and for change-from-baseline series the member's change from its OWN t = 0 value — the main
 * thread re-bases it on the nominal t = 0 value) together with the member's output status and onset, run validity and
 * early abort (A1-049), so the streamed reducer counts valid, conditional and excluded members per day exactly as
 * `simulateEnsemble` does. The nominal run is never a member. Same seed and total → the chunks are slices of the one
 * hypercube, so streaming in any chunk size gives the same members as `simulateEnsemble` (A1-065: with the same caller-fixed
 * structural values and `structuralModes` in every member).
 */
import { buildModelParams, compileSchedule, MODULES, resolveProfile, runEngine } from '@/engine';
import type { PersonProfile, RunOptions, Schedule } from '@/engine';
import { isMemberEnvelope, memberEnvelope, type BandMember } from '@/engine/core/bands';
import { ensembleMemberVectors } from '@/engine/core/loop';

/** Simulator ensemble chunk: draws [start, start + count) of a `total`-draw Latin hypercube from `seed`. */
export interface DrawChunkSpec {
  seed: number;
  total: number;
  start: number;
  count: number;
  options?: RunOptions;
}

/**
 * One ensemble member as it crosses the worker (A1-049): the envelope this chunker produces; the legacy values-only form is
 * still accepted by the reducer (validity = finiteness only).
 */
export type DrawSeries = BandMember;

export function simulateDrawChunk(profile: PersonProfile, schedule: Schedule, spec: DrawChunkSpec): DrawSeries[] {
  const rp = resolveProfile(profile);
  const cs = compileSchedule(schedule, rp);
  const vectors = ensembleMemberVectors(buildModelParams(MODULES).defs, { count: spec.total, seed: spec.seed }, spec.options?.paramOverrides);
  const out: DrawSeries[] = [];
  for (let k = Math.max(0, spec.start); k < Math.min(spec.total, spec.start + spec.count); k++) {
    const r = runEngine(rp, cs, { ...spec.options, record: 'daily', paramOverrides: vectors[k], collectEvents: false });
    out.push(memberEnvelope(r));
  }
  return out;
}

/** The transferable buffers of a chunk's members (their daily band inputs), for a zero-copy worker reply. */
export function drawBuffers(draws: readonly DrawSeries[]): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const d of draws) {
    const series: Record<string, Float32Array | undefined> = isMemberEnvelope(d) ? d.daily : d;
    for (const a of Object.values(series)) if (a && ArrayBuffer.isView(a)) buffers.add(a.buffer as ArrayBuffer);
  }
  return [...buffers];
}
