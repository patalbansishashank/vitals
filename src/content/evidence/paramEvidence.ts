/**
 * The evidence labels of a model parameter, for its card in the Evidence library: the two labels of the evidence policy
 * (mechanism known, and by which pathway; empirical certainty A–D) and the uncertainty inflation the certainty applies
 * to the parameter's band (`inflateBand` in the catalogue layer: the band is widened to the grade's floor, never
 * narrowed, and its centre never moves).
 *
 * The mechanism label exists only when a library mechanism documents the parameter (`relatedParamIds`); the certainty
 * label is the parameter's own grade.
 */
import { bandFloor, inflateBand } from '@/catalogues/evidence';
import type { EvidenceLabel } from '@/catalogues/types';
import type { ParamDef } from '@/engine/types/params';
import type { Mechanism } from './schema';

export interface ParamInflation {
  /** Factor applied to the band's half-widths (≥ 1); `null` for a fixed value, which gets a band at the floor instead. */
  k: number | null;
  low: number;
  high: number;
  /** The grade's floor on the band, as a share of the value (P10–P90 ≈ ±1.28 × floor). */
  floor: number;
}

export interface ParamEvidence {
  mechanism?: EvidenceLabel['mechanism'];
  certainty: ParamDef['grade'];
  inflation: ParamInflation;
}

export function paramEvidence(def: ParamDef, documentedBy: readonly Mechanism[] = []): ParamEvidence {
  const r = inflateBand(def.value, def.low, def.high, def.grade);
  return {
    ...(documentedBy.length
      ? { mechanism: { known: true, pathway: documentedBy.map((m) => m.title).join('; '), route: 'modelled' as const } }
      : {}),
    certainty: def.grade,
    inflation: { k: Number.isFinite(r.k) ? r.k : null, low: r.low, high: r.high, floor: bandFloor(def.grade) },
  };
}
