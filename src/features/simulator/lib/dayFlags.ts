/**
 * Synchronous safety flags for the raster (simulator-schedule.md §6 "Validation & safety"). A subset of dossier 17 §3
 * that needs only the compiled inputs and the baseline profile — energy floor, deficit cap, protein, fat, carbs,
 * fast tiers, refeed, hard training while fasting, alcohol, caffeine, sodium, short windows — plus the app rule
 * "macros exceed energy" (error, blocks Run). The engine evaluates the full rule set on the simulated trajectory;
 * its warnings arrive with the results. Messages are the engine's own templates (≤ 200 characters).
 */
import { RULES } from '@/engine/model/safety/rules';
import { dayMaintenance } from './energy';
import type { CompiledSchedule, FastEvent, ResolvedProfile } from '@/engine';
import { formatNumber } from '@/components';
import type { FastSpan } from './fasts';

export type IssueSeverity = 'error' | 'danger' | 'caution' | 'info';

export interface DayIssue {
  id: string;
  severity: IssueSeverity;
  message: string;
}

export interface ScheduleCheck {
  byDay: DayIssue[][];
  /** Worst severity per day that earns a corner flag (info never flags a cell). */
  flag: Array<Exclude<IssueSeverity, 'info'> | null>;
  /** Days whose macros exceed their energy (blocks Run). */
  errorDays: number[];
  counts: { error: number; danger: number; caution: number };
}

const TEMPLATE = new Map<string, string>(RULES.map((r) => [r.id, r.template]));
const RANK: Record<IssueSeverity, number> = { info: 0, caution: 1, danger: 2, error: 3 };

function fill(id: string, values: Record<string, string>, fallback: string): string {
  const t = TEMPLATE.get(id) ?? fallback;
  return t.replace(/\{([^}]+)\}/g, (_, k: string) => values[k] ?? `{${k}}`);
}

const int = (v: number): string => formatNumber(Math.round(v), 0);
const one = (v: number): string => formatNumber(v, 1);

/** Planned-energy target of a compiled day (what the template asked for, before the compiler reconciled it). */
function targetKcal(d: CompiledSchedule['days'][number]): number {
  const e = d.template.energy;
  if (e.kind === 'zero') return 0;
  if (e.kind === 'kcal') return e.kcal;
  return (e.pct / 100) * d.maintenanceKcal;
}

export function checkSchedule(
  c: CompiledSchedule,
  profile: ResolvedProfile,
  spans: readonly FastSpan[],
  events: readonly FastEvent[] = [],
  deficitCapPct = 25,
): ScheduleCheck {
  const n = c.nDays;
  const byDay: DayIssue[][] = Array.from({ length: n }, () => []);
  const add = (d: number, issue: DayIssue) => {
    if (d < 0 || d >= n) return;
    if (byDay[d]!.some((x) => x.id === issue.id)) return;
    byDay[d]!.push(issue);
  };
  const tdee = profile.tdee0Kcal;
  const floor = profile.sex === 'female' ? 1200 : 1500;
  const rw = Math.min(profile.weightKg, 27.5 * profile.heightM * profile.heightM);

  // days inside a real fast (≥ 20 h), and the longest span per day
  const fastH = new Float64Array(n);
  for (const s of spans) {
    if (s.hours < 20) continue;
    for (let d = Math.max(0, s.firstDay); d <= Math.min(n - 1, s.lastDay); d++)
      fastH[d] = Math.max(fastH[d]!, s.hours);
  }

  // trailing 7-day means, padded with the habitual (maintenance) day before day 0 like the engine's burn-in
  const trailing = (get: (i: number) => number, pad: number, d: number): number => {
    let sum = 0;
    for (let k = d - 6; k <= d; k++) sum += k < 0 ? pad : get(k);
    return sum / 7;
  };
  const ei = (i: number) => c.days[i]!.energyKcal;
  let lowRun = 0;
  const errorDays: number[] = [];

  for (let d = 0; d < n; d++) {
    const day = c.days[d]!;
    const eating = !day.zeroIntake && day.energyKcal > 0;
    const inFast = fastH[d]! >= 20;

    // app rule: macros exceed energy by > 5 %
    const target = targetKcal(day);
    if (eating && target > 0 && day.energyKcal > target * 1.05) {
      errorDays.push(d);
      add(d, {
        id: 'APP-MACROS',
        severity: 'error',
        message: `Protein, carbs and fat already use ${int(day.energyKcal)} kcal — more than the ${int(target)} set. Lower one, or raise energy.`,
      });
    }

    const ei7 = trailing(ei, tdee, d);
    if (ei7 < 800 && !inFast) lowRun++;
    else lowRun = 0;
    if (!inFast) {
      if (ei7 < 800 && lowRun >= 3)
        add(d, {
          id: 'W-E02',
          severity: 'danger',
          message: fill('W-E02', {}, 'Under 800 kcal/day is a very-low-energy diet.'),
        });
      else if (ei7 >= 800 && ei7 < floor)
        add(d, {
          id: 'W-E01',
          severity: 'caution',
          message: fill(
            'W-E01',
            { EI: int(ei7), floor: int(floor) },
            'Average intake is below the usual minimum.',
          ),
        });
    }
    // the deficit is measured against maintenance at the activity this schedule plans (R-MAINT), not the usual week
    const ref7 = trailing((i) => dayMaintenance(c.days[i]!, tdee), tdee, d);
    const deficit7 = ref7 > 0 ? 100 * (1 - ei7 / ref7) : 0;
    if (deficit7 > 40)
      add(d, {
        id: 'W-E04',
        severity: 'danger',
        message: fill('W-E04', {}, 'A deficit over 40 % of maintenance.'),
      });
    else if (deficit7 > deficitCapPct)
      add(d, {
        id: 'W-E03',
        severity: 'caution',
        message: fill('W-E03', { d: int(deficit7), cap: int(deficitCapPct) }, 'Large deficit.'),
      });

    if (eating) {
      const p7 = trailing((i) => c.days[i]!.proteinG, profile.habitualProteinG, d) / rw;
      if (p7 < 0.8)
        add(d, {
          id: 'W-M01',
          severity: 'caution',
          message: fill('W-M01', { p: one(p7) }, 'Protein below 0.8 g/kg.'),
        });
      else if (p7 < 1.2 && ei7 < tdee)
        add(d, {
          id: 'W-M02',
          severity: 'info',
          message: fill('W-M02', { p: one(p7) }, 'Protein is low for a deficit.'),
        });
      const f7 = trailing((i) => c.days[i]!.fatG, profile.habitualFatG, d);
      const fatPct = ei7 > 0 ? (900 * f7) / ei7 : 0;
      if (ei7 >= 800 && (fatPct < 15 || f7 < 30))
        add(d, { id: 'W-M06', severity: 'caution', message: fill('W-M06', { f: int(f7) }, 'Fat is low.') });
      if (day.carbG < 50)
        add(d, {
          id: 'W-M08',
          severity: 'info',
          message: fill('W-M08', {}, 'Below ~50 g net carbs the model enters ketosis.'),
        });
      if (day.nMeals === 1 || (day.nMeals > 1 && day.windowLengthH < 4))
        add(d, {
          id: 'W-F14',
          severity: 'caution',
          message: fill('W-F14', {}, 'A daily eating window under 4 hours.'),
        });
    }

    // sodium while fasting or very low carb
    if ((inFast || (eating && day.carbG < 50)) && day.sodiumMg < 1500)
      add(d, {
        id: 'W-M12',
        severity: 'caution',
        message: fill('W-M12', {}, 'Sodium is low while fasting.'),
      });
    if (Number.isFinite(day.fluidL) && (day.fluidL < 1.5 || day.fluidL > 4))
      add(d, {
        id: day.fluidL < 1.5 ? 'W-M14' : 'W-M15',
        severity: 'caution',
        message: fill(day.fluidL < 1.5 ? 'W-M14' : 'W-M15', {}, 'Check fluid intake.'),
      });

    // alcohol (UK unit = 8 g ethanol)
    const alc7 =
      trailing(
        (i) => c.days[i]!.template.substances?.alcohol?.reduce((a, x) => a + x.drinks * 14, 0) ?? 0,
        0,
        d,
      ) * 7;
    if (alc7 / 8 > 14)
      add(d, {
        id: 'W-M18',
        severity: 'caution',
        message: fill('W-M18', {}, 'More than 14 units of alcohol a week.'),
      });
    const drinks = day.template.substances?.alcohol ?? [];
    if (drinks.length > 0 && (inFast || (day.energyKcal > 0 && day.energyKcal < 800) || day.zeroIntake))
      add(d, { id: 'W-M19', severity: 'danger', message: fill('W-M19', {}, 'Alcohol on a fasting day.') });
    if (drinks.some((x) => x.drinks > 2))
      add(d, { id: 'W-M20', severity: 'caution', message: fill('W-M20', {}, 'More than 2 drinks at once.') });

    // caffeine
    const doses = day.template.substances?.caffeine;
    const cafTotal = doses ? doses.reduce((a, x) => a + x.mg, 0) : day.caffeineMg;
    if (cafTotal > 400 || (doses?.some((x) => x.mg > 200) ?? false))
      add(d, {
        id: 'W-M21',
        severity: 'caution',
        message: fill('W-M21', {}, 'Caffeine above 400 mg a day or 200 mg at once.'),
      });

    // hard training during a fast ≥ 24 h
    if (fastH[d]! >= 24) {
      for (let i = 0; i < day.nSessions; i++) {
        const s = day.sessions[i]!;
        const hard = s.toFailure || (Number.isFinite(s.intensityFrac) && s.intensityFrac >= 0.85);
        if (hard)
          add(d, {
            id: 'W-F09',
            severity: 'caution',
            message: fill('W-F09', {}, 'Hard exercise while fasting.'),
          });
      }
    }
  }

  // fast tiers, electrolytes, refeed
  for (const s of spans) {
    if (s.hours < 20) continue;
    const h = s.hours;
    const id = h > 168 ? 'W-F05' : h > 72 ? 'W-F04' : h > 48 ? 'W-F03' : h > 24 ? 'W-F02' : 'W-F01';
    const sev: IssueSeverity = h > 72 ? 'danger' : h > 24 ? 'caution' : 'info';
    const noElectrolytes = h >= 48 && !s.electrolytes;
    const ev = s.eventIndex >= 0 ? events[s.eventIndex] : undefined;
    const refeedAuto = ev?.refeed === 'auto';
    for (let d = Math.max(0, s.firstDay); d <= Math.min(n - 1, s.lastDay); d++) {
      add(d, { id, severity: sev, message: fill(id, {}, 'Long fast.') });
      if (noElectrolytes)
        add(d, {
          id: 'W-F06',
          severity: 'caution',
          message: fill('W-F06', {}, 'No salt or fluid plan for this fast.'),
        });
    }
    if (h >= 72 && !refeedAuto)
      add(Math.min(n - 1, s.lastDay), {
        id: 'W-F08',
        severity: 'danger',
        message: fill('W-F08', {}, 'Restart food gradually after a long fast.'),
      });
  }

  const flag: ScheduleCheck['flag'] = byDay.map((issues) => {
    let worst: IssueSeverity | null = null;
    for (const x of issues)
      if (x.severity !== 'info' && (worst === null || RANK[x.severity] > RANK[worst])) worst = x.severity;
    return worst as Exclude<IssueSeverity, 'info'> | null;
  });
  const counts = { error: 0, danger: 0, caution: 0 };
  for (const f of flag) if (f) counts[f]++;
  for (const list of byDay) list.sort((a, b) => RANK[b.severity] - RANK[a.severity]);
  return { byDay, flag, errorDays, counts };
}
