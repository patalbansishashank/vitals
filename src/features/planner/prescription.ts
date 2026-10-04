/**
 * Day-by-day prescription of a plan (planner-results.md §6 "Days tab"): the plan's engine `Schedule` compiled with the
 * real compiler (so meals, windows, sessions, fasts and refeeds are exactly what the engine simulated), with the day's
 * energy and macro totals taken from the simulation's realised-input series when present (days whose energy is
 * relative to the block start are only resolved during the run). Also the CSV / plain-text exports.
 */
import { compileSchedule, resolveProfile } from '@/engine';
import type { CardioModality, DayInput, PersonProfile, Schedule, SimulationResult } from '@/engine';
import type { PlanOption, PlannerRequest } from '@/engine/planner/domain/types';
import { formatNumber, toEnergyUnit } from '@/components';
import type { EnergyUnit } from '@/state/settingsStore';
import { fmtClock, fmtDateWd, fmtKcal } from './format';
import { addDaysISO } from './request';

export interface MealRx {
  clockH: number;
  kcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fibreG: number;
}

export interface SessionRx {
  kind: 'resistance' | 'cardio';
  startH: number;
  durationMin: number;
  /** "full body · 14 hard sets" / "cycle · moderate". */
  label: string;
}

export interface FastRx {
  /** 'all-day' water-only day; 'start' / 'end' / 'through' for spans crossing days. */
  part: 'all-day' | 'start' | 'end' | 'through';
  /** Whole fast length, h, and clock hours on this day. */
  totalH: number;
  fromH: number;
  toH: number;
}

export interface DayRx {
  day: number;
  dateISO: string;
  /** 0 = Monday. */
  weekday: number;
  /** 0-based week of the plan. */
  week: number;
  /** Day-type key (letters by first appearance of each distinct day configuration). */
  typeKey: string;
  typeLabel: string;
  phase: string | null;
  zero: boolean;
  fast: FastRx | null;
  refeed: boolean;
  energyKcal: number;
  /** % of the day's maintenance reference (maintenance at this plan's activity, ruling R-MAINT) when known. */
  energyPct: number | null;
  /** True planned balance, kcal/d (< 0 deficit), when known. */
  balanceKcal: number | null;
  /** The maintenance reference, kcal/d, when known. */
  maintKcal: number | null;
  proteinG: number;
  carbG: number;
  fatG: number;
  fibreG: number;
  meals: MealRx[];
  windowStartH: number | null;
  windowEndH: number | null;
  sessions: SessionRx[];
  steps: number;
  sleepBedH: number;
  sleepWakeH: number;
  sleepHours: number;
  extras: string[];
}

export interface DayTypeRx {
  key: string;
  label: string;
  count: number;
  /** A representative day (first occurrence). */
  sample: DayRx;
}

export interface Prescription {
  startDate: string;
  days: DayRx[];
  weeks: number;
  types: DayTypeRx[];
  notes: string[];
}

const MODALITY: Record<number, CardioModality> = { 1: 'walk', 2: 'run', 3: 'cycle', 4: 'swim', 5: 'row', 6: 'hiit', 7: 'other' };

function intensityWord(frac: number): string {
  if (!Number.isFinite(frac)) return 'moderate';
  if (frac < 0.45) return 'easy';
  if (frac < 0.62) return 'moderate';
  if (frac < 0.78) return 'brisk';
  return 'hard';
}

/** Readable day-type name from the planner's template label ("Moderate continuous deficit · day · resistance training"). */
export function dayTypeName(label: string): string {
  const parts = label.split(' · ').map((s) => s.trim());
  if (parts.length < 2) return label;
  const kind = parts[1] === 'day' ? '' : parts[1]!;
  const rest = parts.slice(2).join(' + ');
  return [kind || 'eating day', rest].filter(Boolean).join(' · ');
}

function sessionsOf(d: DayInput): SessionRx[] {
  const out: SessionRx[] = [];
  for (let i = 0; i < d.nSessions; i++) {
    const s = d.sessions[i]!;
    if (s.kind === 'resistance') {
      let sets = 0;
      for (let r = 0; r < s.setsByRegion.length; r++) sets += s.setsByRegion[r]!;
      out.push({ kind: 'resistance', startH: s.startH, durationMin: s.durationMin, label: `resistance · ${formatNumber(sets, 0)} hard sets` });
    } else {
      out.push({ kind: 'cardio', startH: s.startH, durationMin: s.durationMin, label: `${MODALITY[s.modality] ?? 'cardio'} · ${intensityWord(s.intensityFrac)}` });
    }
  }
  return out;
}

function echo(sim: SimulationResult | undefined, id: string, day: number): number | null {
  const arr = sim?.daily[id as keyof SimulationResult['daily']];
  const v = arr?.[day];
  return v !== undefined && Number.isFinite(v) ? v : null;
}

export function buildPrescription(schedule: Schedule, profile: PersonProfile, sim?: SimulationResult): Prescription {
  const rp = resolveProfile({ ...profile, startDate: schedule.startDate });
  const compiled = compileSchedule(schedule, rp);
  const nDays = compiled.nDays;

  // fast spans per day (absolute hours from day 0)
  const spans = compiled.fastSpans;
  const fastOn = (d: number): FastRx | null => {
    const a = d * 24;
    const b = a + 24;
    for (const s of spans) {
      if (s.endHour <= a || s.startHour >= b) continue;
      // meal-to-meal length when the compiler reports it (what the person experiences), else the zero-intake span
      const totalH = s.mealToMealH ?? s.endHour - s.startHour;
      if (totalH < 20) continue; // daily eating-window gaps are not "fasts" in this table
      const fromH = Math.max(0, s.startHour - a);
      const toH = Math.min(24, s.endHour - a);
      const part = fromH <= 0 && toH >= 24 ? (s.startHour < a && s.endHour > b ? 'through' : 'all-day') : fromH > 0 ? 'start' : 'end';
      return { part, totalH, fromH, toH };
    }
    return null;
  };
  // graded refeed after long fasts (17 HC-F3), as the compiler scheduled it
  const refeedDays = new Set<number>();
  for (const sp of spans) {
    if (sp.refeed !== 'auto' || !sp.refeedDays) continue;
    const endDay = Math.floor(sp.endHour / 24);
    for (let i = 0; i < sp.refeedDays; i++) refeedDays.add(endDay + i);
  }

  const typeKeys = new Map<string, string>();
  const days: DayRx[] = compiled.days.map((d) => {
    const tLabel = d.template.label || `program ${d.program + 1}`;
    let key = typeKeys.get(tLabel);
    if (!key) {
      key = String.fromCharCode(65 + (typeKeys.size % 26));
      typeKeys.set(tLabel, key);
    }
    const kcalEcho = echo(sim, 'inEnergy', d.day);
    const pEcho = echo(sim, 'inProtein', d.day);
    const cEcho = echo(sim, 'inCarbs', d.day);
    const fEcho = echo(sim, 'inFat', d.day);
    const fiEcho = echo(sim, 'inFibre', d.day);
    const kcal = kcalEcho ?? d.energyKcal;
    const scale = d.energyKcal > 0 && kcalEcho !== null ? kcalEcho / d.energyKcal : 1;
    const meals: MealRx[] = [];
    for (let i = 0; i < d.nMeals; i++) {
      const m = d.meals[i]!;
      meals.push({ clockH: m.clockH, kcal: m.kcal * scale, proteinG: m.proteinG * scale, carbG: m.carbG * scale, fatG: m.fatG * scale, fibreG: m.fibreG * scale });
    }
    const pctEcho = echo(sim, 'inEnergyPctMaint', d.day);
    const maintRef = echo(sim, 'inMaintRef', d.day) ?? (Number.isFinite(d.maintenanceKcal) && d.maintenanceKcal > 0 ? d.maintenanceKcal : null);
    const balance = echo(sim, 'inBalancePlanned', d.day) ?? (Number.isFinite(d.plannedBalanceKcal) ? d.plannedBalanceKcal! : maintRef !== null ? kcal - maintRef : null);
    const energyPct = pctEcho ?? (d.energyMode === 'pct' && Number.isFinite(d.energyPct) ? d.energyPct : d.maintenanceKcal > 0 ? (100 * kcal) / d.maintenanceKcal : null);
    const extras: string[] = [];
    if (d.creatineG > 0) extras.push(`creatine ${formatNumber(d.creatineG, 0)} g`);
    if (d.omega3G >= 1) extras.push(`omega-3 ${formatNumber(d.omega3G, 1)} g`);
    if (d.zeroIntake || (d.fastHours >= 20 && d.electrolytes)) {
      const t = d.template.hydration;
      extras.push(`water ${formatNumber(t?.fluidL ?? 2.5, 1)} L${t?.sodiumG ? ` · sodium ${formatNumber(t.sodiumG, 1)} g` : ''} · electrolytes`);
    }
    const block = schedule.blocks?.find((b) => d.day >= b.startDay && d.day < b.endDay);
    return {
      day: d.day,
      dateISO: d.dateISO || addDaysISO(schedule.startDate, d.day),
      weekday: d.weekday,
      week: Math.floor(d.day / 7),
      typeKey: key,
      typeLabel: dayTypeName(tLabel),
      phase: block ? block.name.replace(/\s*\(days [^)]*\)$/, '') : null,
      zero: d.zeroIntake || kcal <= 50,
      fast: fastOn(d.day),
      refeed: refeedDays.has(d.day) || /refeed/i.test(tLabel),
      energyKcal: kcal,
      energyPct: energyPct !== null && Number.isFinite(energyPct) ? energyPct : null,
      balanceKcal: balance,
      maintKcal: maintRef,
      proteinG: pEcho ?? d.proteinG,
      carbG: cEcho ?? d.carbG,
      fatG: fEcho ?? d.fatG,
      fibreG: fiEcho ?? d.fibreG,
      meals,
      windowStartH: d.nMeals > 0 ? d.meals[0]!.clockH : null,
      windowEndH: d.nMeals > 0 ? d.meals[d.nMeals - 1]!.clockH : null,
      sessions: sessionsOf(d),
      steps: echo(sim, 'inSteps', d.day) ?? d.steps,
      sleepBedH: d.sleepBedH,
      sleepWakeH: d.sleepWakeH,
      sleepHours: echo(sim, 'inSleep', d.day) ?? d.sleepHours,
      extras,
    };
  });

  const types: DayTypeRx[] = [];
  for (const [label, key] of typeKeys) {
    const sample = days.find((x) => x.typeKey === key)!;
    types.push({ key, label: dayTypeName(label), count: days.filter((x) => x.typeKey === key).length, sample });
  }
  return {
    startDate: schedule.startDate,
    days,
    weeks: Math.ceil(nDays / 7),
    types,
    notes: compiled.notes.filter((n) => n.code !== 'carbsDuringExerciseAdded').map((n) => `day ${n.day + 1}: ${n.message}`),
  };
}

/* ---------------------------------------------------------------------------------------------------- text */

export function fastText(f: FastRx): string {
  const total = `${formatNumber(f.totalH, 0)} h fast`;
  if (f.part === 'all-day' || f.part === 'through') return `${total} · no food today`;
  if (f.part === 'start') return `${total} starts ${fmtClock(f.fromH)}`;
  return `${total} ends ${fmtClock(f.toH)}`;
}

export function windowText(d: DayRx): string {
  if (d.windowStartH === null || d.windowEndH === null) return '—';
  return `${fmtClock(d.windowStartH)}–${fmtClock(d.windowEndH)}`;
}

export function sessionText(s: SessionRx): string {
  return `${s.label} · ${fmtClock(s.startH)} · ${formatNumber(s.durationMin, 0)} min`;
}

const csvCell = (v: string | number): string => {
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(Math.round(v * 10) / 10) : '') : v;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per day (UTF-8 CSV, comma-separated, plain ASCII minus signs for spreadsheets); energy in the Settings unit. */
export function prescriptionCsv(rx: Prescription, planName: string, energy: EnergyUnit = 'kcal'): string {
  const head = ['date', 'weekday', 'week', 'day type', 'phase', `energy ${energy}`, 'energy % of maintenance', 'protein g', 'net carbs g', 'fat g', 'fibre g', 'meals', 'first meal', 'last meal', 'fast', 'refeed', 'training', 'steps', 'sleep h', 'extras', 'plan'];
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const rows = rx.days.map((d) =>
    [
      d.dateISO,
      WD[d.weekday] ?? '',
      d.week + 1,
      `${d.typeKey} ${d.typeLabel}`,
      d.phase ?? '',
      toEnergyUnit(d.energyKcal, energy),
      d.energyPct ?? '',
      d.proteinG,
      d.carbG,
      d.fatG,
      d.fibreG,
      d.meals.length,
      d.windowStartH === null ? '' : fmtClock(d.windowStartH),
      d.windowEndH === null ? '' : fmtClock(d.windowEndH),
      d.fast ? fastText(d.fast) : '',
      d.refeed ? 'yes' : '',
      d.sessions.map(sessionText).join('; '),
      d.steps,
      d.sleepHours,
      d.extras.join('; '),
      planName,
    ]
      .map((v) => csvCell(v as string | number))
      .join(','),
  );
  return [head.join(','), ...rows].join('\n').replace(/\u2212/g, '-').replace(/[\u2009\u202f\u00a0]/g, ' ');
}

export interface TextExportInput {
  /** "Hard plan" (the rung's name; never a letter). */
  planTitle: string;
  /** The measurable subtitle ("Deficit 22 % · 4 sessions"). */
  planName: string;
  scorecard: string[];
  phases: string[];
  safety: string[];
  disclaimer: string;
  /** Settings energy unit for the day lines (default kcal). */
  energy?: EnergyUnit;
}

/** Printable plain-text summary: header, goals, phases, then every week day by day. */
export function prescriptionText(rx: Prescription, i: TextExportInput): string {
  const lines: string[] = [];
  lines.push(`Vitals · ${i.planTitle}${i.planName ? `: ${i.planName}` : ''}`);
  lines.push(`${rx.days.length} days from ${fmtDateWd(rx.startDate)}`);
  lines.push('');
  lines.push('Goals, in your order');
  i.scorecard.forEach((s) => lines.push(`  ${s}`));
  if (i.phases.length) {
    lines.push('');
    lines.push('Phases');
    i.phases.forEach((s) => lines.push(`  ${s}`));
  }
  for (let w = 0; w < rx.weeks; w++) {
    lines.push('');
    lines.push(`Week ${w + 1}`);
    for (const d of rx.days.filter((x) => x.week === w)) {
      const food = d.zero ? 'no food (water, electrolytes)' : `${fmtKcal(d.energyKcal, i.energy)} · P ${formatNumber(d.proteinG, 0)} g · C ${formatNumber(d.carbG, 0)} g · F ${formatNumber(d.fatG, 0)} g · fibre ${formatNumber(d.fibreG, 0)} g`;
      const parts = [
        `${fmtDateWd(d.dateISO)} [${d.typeKey}]`,
        food,
        d.meals.length ? `${d.meals.length} meal${d.meals.length === 1 ? '' : 's'} ${windowText(d)}` : '',
        d.fast ? fastText(d.fast) : '',
        d.refeed ? 'graded refeed' : '',
        d.sessions.map(sessionText).join(', '),
        `${formatNumber(d.steps, 0)} steps`,
        `sleep ${formatNumber(d.sleepHours, 1)} h`,
        d.extras.join(', '),
      ].filter(Boolean);
      lines.push(`  ${parts.join(' · ')}`);
    }
  }
  if (i.safety.length) {
    lines.push('');
    lines.push('Safety');
    i.safety.forEach((s) => lines.push(`  ${s}`));
  }
  lines.push('');
  lines.push(i.disclaimer);
  return lines.join('\n').replace(/\u2212/g, '-').replace(/[\u2009\u202f\u00a0]/g, ' ');
}

/** Client-side download (no server). */
export function downloadFile(name: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Prescription for a plan within a request (memoise per plan). */
export function prescriptionFor(option: Pick<PlanOption, 'schedule' | 'simulation'>, request: Pick<PlannerRequest, 'profile'>): Prescription {
  return buildPrescription(option.schedule, request.profile, option.simulation);
}
