/**
 * Which marker levers a plan uses (pure): read from the schedule's programs and events, so the ladder can put a
 * "because …" chip on the rungs a marker note touches (SUITE_SPEC §13.5.7). Thresholds are the app's own lever
 * definitions: very-low-carb < 50 g net carbohydrate a day, low-carb < 130 g, a large deficit ≥ 25 % below
 * maintenance, a moderate one 10–25 %, high protein ≥ 1.6 g/kg.
 */
import type { DayTemplate, MacroAmount, Schedule } from '@/engine/types/schedule';
import type { LeverId, MarkerNote } from '../types';

export const VLC_G = 50;
export const LOWCARB_G = 130;
export const LARGE_DEFICIT_PCT = 25;
export const MODERATE_DEFICIT_PCT = 10;
export const HIGH_PROTEIN_G_PER_KG = 1.6;

/** Grams a day of a macro amount, when the amount says so without a body-mass lookup (else undefined). */
function grams(a: MacroAmount | undefined, kcal: number | undefined, kcalPerG: number, weightKg: number | undefined): number | undefined {
  if (!a) return undefined;
  if (a.unit === 'g') return a.value;
  if (a.unit === 'gPerKgBw' && weightKg) return a.value * weightKg;
  if (a.unit === 'pctEnergy' && kcal) return (a.value / 100) * kcal / kcalPerG;
  return undefined;
}

function templateLevers(t: Partial<DayTemplate>, out: Set<LeverId>, maintenanceKcal: number | undefined, weightKg: number | undefined): void {
  const e = t.energy;
  let kcal: number | undefined;
  if (e?.kind === 'pctMaintenance') {
    kcal = maintenanceKcal ? (e.pct / 100) * maintenanceKcal : undefined;
    const deficit = 100 - e.pct;
    if (deficit >= LARGE_DEFICIT_PCT) out.add('deficit_large');
    else if (deficit >= MODERATE_DEFICIT_PCT) out.add('deficit_moderate');
    if (e.pct > 100) out.add('surplus');
  } else if (e?.kind === 'kcal') {
    kcal = e.kcal;
    if (maintenanceKcal) {
      const deficit = 100 - (100 * e.kcal) / maintenanceKcal;
      if (deficit >= LARGE_DEFICIT_PCT) out.add('deficit_large');
      else if (deficit >= MODERATE_DEFICIT_PCT) out.add('deficit_moderate');
      if (deficit < 0) out.add('surplus');
    }
  }
  const m = t.macros;
  if (m && e?.kind !== 'zero') {
    let carbsG = grams(m.carbs, kcal, 4, weightKg);
    if (m.carbShareNonProtein !== undefined && kcal) carbsG = (m.carbShareNonProtein * kcal * 0.75) / 4; // protein ≈ ¼ of energy
    if (m.carbShareNonProtein !== undefined && m.carbShareNonProtein < 0.1) out.add('vlc');
    if (carbsG !== undefined) {
      if (carbsG < VLC_G) out.add('vlc');
      else if (carbsG < LOWCARB_G) out.add('lowcarb');
    }
    const p = m.protein;
    const perKg = p?.unit === 'gPerKgBw' || p?.unit === 'gPerKgFfm' ? p.value : weightKg ? (grams(p, kcal, 4, weightKg) ?? 0) / weightKg : undefined;
    if (perKg !== undefined && perKg >= HIGH_PROTEIN_G_PER_KG) out.add('highprotein');
  }
  const s = t.substances;
  if (s?.creatineG && s.creatineG > 0) out.add('creatine');
  if (s?.alcohol?.some((a) => a.drinks > 0)) out.add('alcohol');
  if (s?.caffeine?.some((c) => c.mg > 0)) out.add('caffeine');
}

export interface PlanLeverInput {
  schedule?: Schedule | null;
  /** Longest planned fast, h (the planner's fasting verdict). */
  longestFastH?: number;
  /** Mean daily eating window, h. */
  meanWindowH?: number;
  /** Maintenance, kcal/d (to classify absolute-kcal days). */
  maintenanceKcal?: number;
  weightKg?: number;
}

/** The levers a plan uses. */
export function planLevers(i: PlanLeverInput): Set<LeverId> {
  const out = new Set<LeverId>();
  const sch = i.schedule;
  if (sch) {
    const used = new Set(sch.days.map((d) => d.program));
    sch.programs.forEach((p, k) => used.has(k) && templateLevers(p, out, i.maintenanceKcal, i.weightKg));
    for (const d of sch.days) if (d.override) templateLevers(d.override, out, i.maintenanceKcal, i.weightKg);
  }
  let longest = i.longestFastH ?? 0;
  for (const ev of sch?.events ?? []) if (ev.kind === 'fast') longest = Math.max(longest, ev.durationH);
  if (longest > 48) out.add('fast48plus');
  else if (longest > 36) out.add('fast36_48');
  else if (longest >= 24) out.add('fast24');
  if (longest > 0 && longest < 24) out.add('fast16_8');
  if (i.meanWindowH !== undefined && i.meanWindowH > 0 && i.meanWindowH <= 8) out.add('fast16_8');
  return out;
}

/** Levers that imply each other for matching (a 48-h fast is also a fast of 24 h; very-low-carb is also low-carb). */
const IMPLIES: Partial<Record<LeverId, LeverId[]>> = {
  vlc: ['lowcarb'],
  fast48plus: ['fast36_48', 'fast24'],
  fast36_48: ['fast24'],
  deficit_large: ['deficit_moderate'],
};

/** The notes that touch a plan using `levers`. */
export function notesTouching(notes: readonly MarkerNote[], levers: ReadonlySet<LeverId>): MarkerNote[] {
  const all = new Set<LeverId>(levers);
  for (const l of levers) for (const x of IMPLIES[l] ?? []) all.add(x);
  return notes.filter((n) => n.levers.some((l) => all.has(l)));
}
