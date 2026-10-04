/**
 * Effort zones (design/screens/ring-pages.md §7.4.1), used by heart rate through the day and by workouts. Max heart
 * rate is the person's own if set, else 208 − 0.7 × age (Tanaka). No age and no max → no zones (the line is plain).
 * Zones by % of max: 1 easy 50–60, 2 steady 60–70, 3 moderate 70–80, 4 hard 80–90, 5 maximum ≥ 90; below 50 % is
 * the resting range (not a zone). Colours: `--lm-hr-zone-1..5` (ordinal ramp of the cardio hue, ./heart.css).
 */
export type Zone = 0 | 1 | 2 | 3 | 4 | 5;

export const ZONE_WORD: Record<Zone, string> = { 0: 'resting range', 1: 'easy', 2: 'steady', 3: 'moderate', 4: 'hard', 5: 'maximum' };

export interface ZoneModel {
  maxHr: number;
  /** Lower bound (bpm, rounded) of zones 1..5: index 0 = zone 1. */
  lower: [number, number, number, number, number];
}

const PCT = [0.5, 0.6, 0.7, 0.8, 0.9] as const;

export function zoneModel(p: { ageYears?: number; maxHr?: number }): ZoneModel | null {
  const max = p.maxHr ?? (p.ageYears !== undefined && p.ageYears > 0 ? 208 - 0.7 * p.ageYears : undefined);
  if (max === undefined || !(max > 0)) return null;
  return { maxHr: Math.round(max), lower: PCT.map((f) => Math.round(f * max)) as ZoneModel['lower'] };
}

export function zoneOf(bpm: number, z: ZoneModel): Zone {
  for (let i = 4; i >= 0; i--) if (bpm >= z.lower[i]!) return (i + 1) as Zone;
  return 0;
}

/** "zone 3 · moderate" / "resting range". */
export function zoneLabel(zone: Zone): string {
  return zone === 0 ? ZONE_WORD[0] : `zone ${zone} · ${ZONE_WORD[zone]}`;
}

/** CSS colour for a zone (resting range = ink-3). */
export function zoneColor(zone: Zone): string {
  return zone === 0 ? 'var(--lm-ink-3)' : `var(--lm-hr-zone-${zone})`;
}

/**
 * Minutes per zone from samples: each sample counts until the next one, capped at `maxGapMs` (a gap is not time in
 * any zone). Index 0 = resting range.
 */
export function timeInZones(points: ReadonlyArray<{ t: number; v: number }>, z: ZoneModel, maxGapMs: number): [number, number, number, number, number, number] {
  const out: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < points.length - 1; i++) {
    const dt = points[i + 1]!.t - points[i]!.t;
    if (dt <= 0 || dt > maxGapMs) continue;
    out[zoneOf(points[i]!.v, z)] += dt / 60_000;
  }
  return out.map((m) => Math.round(m)) as typeof out;
}
