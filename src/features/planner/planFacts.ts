/**
 * Facts about a plan for the ladder cards and tabs: measurable naming (never a diet brand), phase tints, the practical
 * day-to-day facts and the daily series (with the plan's own robustness band) the curves tab draws.
 */
import { formatNumber } from '@/components';
import type { ChartSeries, DirectionOfGood, Phase, PhaseTone } from '@/features/charts';
import { SERIES, type SeriesDef } from '@/engine/types/metrics';
import { balanceOf } from '@/engine/planner/domain/explain';
import type { PhaseExplanation, PlanOption, PlannerRequest } from '@/engine/planner/domain/types';
import type { EnergyUnit, UnitSystem } from '@/state/settingsStore';
import { goalMetric } from './catalogue';
import { fmtKcalSigned, toDisplay } from './format';
import type { Prescription } from './prescription';

const DEF: ReadonlyMap<string, SeriesDef> = new Map((SERIES as readonly SeriesDef[]).map((d) => [d.id, d]));

/* ------------------------------------------------------------------------------------------------ naming */

/** Diet-brand words the UI never shows as a plan name (principle 1: composition, not labels). */
const BRAND = /\b(keto(genic)?|paleo|atkins|carnivore|whole30|mediterranean|dash|zone diet|south beach|vegan diet|dukan|omad|warrior|5:2|16:8)\b/i;

/** The engine's measurable name, or a composition-based one when the name is missing or brand-like. */
export function planName(option: Pick<PlanOption, 'name'>, rx: Prescription | null): string {
  const n = option.name?.trim();
  if (n && !BRAND.test(n)) return n;
  return rx ? fallbackName(rx) : 'This plan';
}

export function fallbackName(rx: Prescription): string {
  const eating = rx.days.filter((d) => !d.zero);
  const pct = eating.map((d) => d.energyPct ?? 100);
  const mean = pct.reduce((a, b) => a + b, 0) / Math.max(1, pct.length);
  const zeroDays = rx.days.filter((d) => d.zero).length;
  const fasts = new Set(rx.days.filter((d) => d.fast).map((d) => d.week)).size;
  let energy = mean < 97 ? 'Steady deficit' : mean > 103 ? 'Steady surplus' : 'Maintenance';
  const spread = Math.max(...pct) - Math.min(...pct);
  if (mean < 97 && spread > 12) energy = 'Stepped deficit';
  if (zeroDays > rx.days.length * 0.2) energy = 'Alternate zero-energy days';
  else if (fasts >= rx.weeks * 0.6) energy = `${energy}, weekly fasts`;
  const protein = eating.reduce((a, d) => a + d.proteinG, 0) / Math.max(1, eating.length);
  const carbs = eating.reduce((a, d) => a + d.carbG, 0) / Math.max(1, eating.length);
  const lifts = rx.days.filter((d) => d.sessions.some((s) => s.kind === 'resistance')).length / Math.max(1, rx.weeks);
  const lever = carbs < 60 ? `net carbs under ${Math.ceil(carbs / 10) * 10} g` : protein > 150 ? 'high protein' : lifts >= 2.5 ? `lifting ${Math.round(lifts)}×` : 'balanced macros';
  return `${energy}, ${lever}`;
}

/* ------------------------------------------------------------------------------------------------ phases */

export function toneForPct(pct: number, zeroShare: number): PhaseTone {
  if (zeroShare > 0.3) return 'fast';
  if (pct >= 97 && pct <= 103) return 'neutral';
  if (pct < 97) return pct >= 90 ? 'deficit-1' : pct >= 82 ? 'deficit-2' : pct >= 74 ? 'deficit-3' : 'deficit-4';
  return pct <= 108 ? 'surplus-1' : pct <= 114 ? 'surplus-2' : pct <= 120 ? 'surplus-3' : 'surplus-4';
}

export interface PhaseFact {
  name: string;
  startDay: number;
  endDay: number;
  weeks: number;
  tone: PhaseTone;
  /**
   * The planner's own energy % of the phase (the number its phase name and summary print, e.g. "Deficit 22 %" ↔
   * "energy 78 %"), or null when the engine states none (fast phases). The UI prints this, never a % of its own.
   */
  enginePct: number | null;
  /** The engine's % describes the phase's other days (low-energy / zero-energy day phases: "other days 80 %"). */
  enginePctOtherDays: boolean;
  /** Mean energy of the eating days from the day-by-day prescription, % of maintenance (phase tint fallback only). */
  energyPct: number;
  /** Mean true planned balance, kcal/d (< 0 deficit); NaN when unknown. */
  balanceKcal: number;
  /** Mean maintenance reference, kcal/d; NaN when unknown. */
  maintKcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  summary: string;
  why: string;
}

/**
 * The engine's energy % of a phase, read from its own text: the summary's "energy 78 %" (or "other days 80 %" for
 * low-/zero-energy-day phases), else the name's "Deficit 22 %" / "Surplus 5 %". Null when the engine states none.
 */
export function enginePhasePct(ph: Pick<PhaseExplanation, 'name' | 'summary'>): { pct: number; otherDays: boolean } | null {
  const m = /\b(energy|other days) (\d+(?:\.\d+)?)\s?%/.exec(ph.summary ?? '');
  if (m) return { pct: Number(m[2]), otherDays: m[1] === 'other days' };
  const n = /^(Deficit|Surplus) (\d+(?:\.\d+)?)\s?%/.exec(ph.name ?? '');
  if (n) return { pct: n[1] === 'Deficit' ? 100 - Number(n[2]) : 100 + Number(n[2]), otherDays: false };
  return null;
}

export function phaseFacts(option: Pick<PlanOption, 'phases'>, rx: Prescription): PhaseFact[] {
  const list = option.phases.length
    ? option.phases
    : [{ name: 'Whole plan', blockId: '', startDay: 0, endDay: rx.days.length, weeks: rx.days.length / 7, summary: '', why: '' }];
  return list.map((ph) => {
    const days = rx.days.filter((d) => d.day >= ph.startDay && d.day < ph.endDay);
    const eating = days.filter((d) => !d.zero);
    const avg = (f: (d: (typeof days)[number]) => number) => eating.reduce((a, d) => a + f(d), 0) / Math.max(1, eating.length);
    const energyPct = avg((d) => d.energyPct ?? 100);
    // balance over every day of the phase (a water-only day is part of the phase's deficit)
    const known = days.filter((d) => d.balanceKcal !== null);
    const balanceKcal = known.length ? known.reduce((a, d) => a + d.balanceKcal!, 0) / known.length : Number.NaN;
    const withRef = days.filter((d) => d.maintKcal !== null);
    const maintKcal = withRef.length ? withRef.reduce((a, d) => a + d.maintKcal!, 0) / withRef.length : Number.NaN;
    const eng = enginePhasePct(ph);
    // tinted by the engine's own % when it describes the whole phase, so a phase named "Maintenance" never reads as a deficit
    const tintPct = eng && !eng.otherDays ? eng.pct : energyPct;
    return {
      name: ph.name,
      startDay: ph.startDay,
      endDay: ph.endDay,
      weeks: ph.weeks,
      tone: toneForPct(tintPct, days.length ? (days.length - eating.length) / days.length : 0),
      enginePct: eng ? eng.pct : null,
      enginePctOtherDays: eng?.otherDays ?? false,
      energyPct,
      balanceKcal,
      maintKcal,
      proteinG: avg((d) => d.proteinG),
      carbG: avg((d) => d.carbG),
      fatG: avg((d) => d.fatG),
      summary: ph.summary,
      why: ph.why,
    };
  });
}

/** The phase name already states its balance ("Deficit 22 % · protein 2.1 g/kg"), so a balance label would repeat it. */
export function nameStatesBalance(name: string): boolean {
  return /\b(deficit|surplus|maintenance)\b/i.test(name);
}

/**
 * A phase's balance in words next to its name ("deficit 22 %"), from the engine's own % and the engine's own wording
 * (`balanceOf`, which also writes the phase names), so a label can never print a different % than the name. Null when
 * the name already states it, when the engine's % covers only the other days, or when the engine gives no %.
 */
export function phaseBalance(f: Pick<PhaseFact, 'name' | 'enginePct' | 'enginePctOtherDays'>): string | null {
  if (f.enginePct === null || f.enginePctOtherDays || nameStatesBalance(f.name)) return null;
  return balanceOf(f.enginePct).label;
}

/** The phase's mean planned balance a day from the day-by-day prescription ("−480 kcal"), in the Settings unit. */
export function phaseKcal(f: Pick<PhaseFact, 'balanceKcal'>, energy: EnergyUnit = 'kcal'): string | null {
  return Number.isFinite(f.balanceKcal) ? fmtKcalSigned(f.balanceKcal, energy) : null;
}

export function chartPhases(facts: readonly PhaseFact[]): Phase[] {
  return facts.map((f, i) => ({ startDay: f.startDay, endDay: f.endDay, label: f.name, letter: String(i + 1), tone: f.tone, balance: phaseBalance(f) ?? undefined }));
}

/* ------------------------------------------------------------------------------------------ practical */

export interface PracticalFacts {
  liftsPerWeek: number;
  cardioPerWeek: number;
  stepsLo: number;
  stepsHi: number;
  windowH: number | null;
  fastsPerWeek: number;
  longestFastH: number;
  zeroDays: number;
  dayTypes: number;
}

export function practicalFacts(rx: Prescription): PracticalFacts {
  const weeks = Math.max(1, rx.days.length / 7);
  const lifts = rx.days.filter((d) => d.sessions.some((s) => s.kind === 'resistance')).length / weeks;
  const cardio = rx.days.filter((d) => d.sessions.some((s) => s.kind === 'cardio')).length / weeks;
  const steps = rx.days.map((d) => d.steps).filter((s) => s > 0);
  const windows = rx.days.filter((d) => d.windowStartH !== null && d.windowEndH !== null && !d.fast).map((d) => d.windowEndH! - d.windowStartH!);
  windows.sort((a, b) => a - b);
  const fastStarts = rx.days.filter((d) => d.fast && (d.fast.part === 'start' || (d.fast.part === 'all-day' && d.day === 0)));
  const longest = rx.days.reduce((a, d) => Math.max(a, d.fast?.totalH ?? 0), 0);
  return {
    liftsPerWeek: lifts,
    cardioPerWeek: cardio,
    stepsLo: steps.length ? Math.min(...steps) : 0,
    stepsHi: steps.length ? Math.max(...steps) : 0,
    windowH: windows.length ? windows[Math.floor(windows.length / 2)]! : null,
    fastsPerWeek: fastStarts.length / weeks,
    longestFastH: longest,
    zeroDays: rx.days.filter((d) => d.zero).length,
    dayTypes: rx.types.length,
  };
}

/* ----------------------------------------------------------------------------------------- comparison */

const DIRECTION: Record<string, DirectionOfGood> = { up: 'higher', down: 'lower', target: 'in-range', context: 'neutral' };

function fallbackBand(def: SeriesDef | undefined, values: Float32Array, base: number): { lo: Float32Array; hi: Float32Array } | undefined {
  const m = (def?.band === 'draws' ? def.bandFallback : def?.band)?.match(/^(fixChange|fixValue):(\d+(?:\.\d+)?)$/);
  if (!m) return undefined;
  const k = Number(m[2]) / 100;
  const lo = new Float32Array(values.length);
  const hi = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    const half = m[1] === 'fixChange' ? Math.abs(v - base) * k : Math.abs(v) * k;
    lo[i] = v - half;
    hi[i] = v + half;
  }
  return { lo, hi };
}

/**
 * The option's own robustness band for a series (daily P10/P90 over the ensemble; index 0 = t = 0, so day d reads
 * index d + 1), in display units, widened where needed so the nominal line stays inside. Undefined when the ensemble
 * did not band this series.
 */
export function ensembleBand(option: Pick<PlanOption, 'bands'>, id: string, values: Float32Array, factor: number): { lo: Float32Array; hi: Float32Array } | undefined {
  const b = option.bands?.series[id as keyof NonNullable<PlanOption['bands']>['series']];
  if (!b) return undefined;
  const n = values.length;
  const off = b.p10.length === n + 1 ? 1 : b.p10.length === n ? 0 : -1;
  if (off < 0 || b.p90.length !== b.p10.length) return undefined;
  const lo = new Float32Array(n);
  const hi = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = values[i]!;
    const a = b.p10[i + off]! * factor;
    const c = b.p90[i + off]! * factor;
    lo[i] = Number.isFinite(a) ? Math.min(a, c, v) : v;
    hi[i] = Number.isFinite(c) ? Math.max(a, c, v) : v;
  }
  return { lo, hi };
}

/** A plan's daily series in display units, with its own robustness band (or the catalogue's fixed range as a fallback). */
export function seriesFor(option: Pick<PlanOption, 'simulation' | 'bands'>, id: string, units: UnitSystem, energy: EnergyUnit = 'kcal'): ChartSeries | null {
  const raw = option.simulation.daily[id as keyof PlanOption['simulation']['daily']];
  if (!raw || raw.length === 0) return null;
  const def = DEF.get(id);
  const m = goalMetric(id);
  const conv = toDisplay(id, 1, units, energy);
  const factor = conv.value; // 1 unit in display units (kg → lb etc.)
  const values = factor === 1 ? raw : Float32Array.from(raw, (v) => v * factor);
  const base0 = option.simulation.initial[id as keyof PlanOption['simulation']['initial']];
  const base = base0 !== undefined && Number.isFinite(base0) ? base0 * factor : (values[0] ?? NaN);
  return {
    id,
    label: def?.label ?? id,
    unit: conv.unit || (def?.unit ?? ''),
    category: (def?.category ?? 'body') as ChartSeries['category'],
    direction: DIRECTION[def?.direction ?? 'context'] ?? 'neutral',
    grade: (def?.grade ?? 'C') as ChartSeries['grade'],
    format: { decimals: conv.decimals },
    kind: def?.presentation === 'index' ? 'index' : 'line',
    baseline: base,
    // the plan's own ensemble band when the robustness check ran; the catalogue's fixed range only as a fallback
    daily: { values, band: ensembleBand(option, id, values, factor) ?? fallbackBand(def, values, base) },
    ...(m?.caveat ? { mechanism: m.caveat } : {}),
  };
}

/** Goal text for a multiple title ("lose 10 kg", "raise"). */
export function goalText(g: PlannerRequest['goals'][number], units: UnitSystem): string {
  const m = goalMetric(g.metric);
  if (g.direction === 'maximise' && g.target === 0 && g.targetKind === 'change') return 'keep';
  if (g.direction === 'maximise' && g.target === undefined) return m?.modes[0]?.label === 'raise' || !m ? 'raise' : m.modes[0]!.label;
  if (g.direction === 'minimise') return 'lower';
  if (g.target === undefined) return g.direction === 'maximise' ? 'raise' : 'target';
  const shown = toDisplay(g.metric, Math.abs(g.target), units);
  const amount = `${formatNumber(shown.value, shown.decimals)}\u2009${shown.unit === '%' ? '% pts' : shown.unit}`;
  if (g.targetKind === 'change') return g.target === 0 ? 'keep' : `${g.target < 0 ? 'lose' : 'gain'} ${amount}`;
  return `reach ${amount}`;
}
