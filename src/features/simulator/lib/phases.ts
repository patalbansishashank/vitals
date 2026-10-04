/**
 * Phase column (simulator-schedule.md §6): explicit `schedule.blocks` when the user named them, otherwise blocks
 * auto-derived from runs of calendar weeks that repeat the same pattern. Names are honest: auto names describe the
 * energy regime ("deficit", "maintenance", "surplus", "fasting block"), never a clipped user label.
 */
import type { CompiledSchedule, Schedule } from '@/engine';
import { type CalendarGrid, dayAt, rowDays } from './calendar';
import { dayMaintenance } from './energy';

export interface Phase {
  /** First and last calendar row the phase occupies in the raster. */
  row0: number;
  row1: number;
  startDay: number;
  /** Exclusive. */
  endDay: number;
  name: string;
  /** Mean energy of the phase, % of its maintenance reference at the planned activity (R-MAINT). */
  pct: number;
  /** Mean true planned balance, kcal/d (< 0 deficit). */
  balanceKcal: number;
  explicit: boolean;
  /** Index into schedule.blocks when explicit. */
  blockIndex: number;
}

/** Row pattern by weekday column: program (+ override / planned-fast marks) or null for a blank slot. */
function rowPattern(s: Schedule, c: CompiledSchedule, g: CalendarGrid, row: number): Array<string | null> {
  const out: Array<string | null> = [];
  for (let col = 0; col < 7; col++) {
    const d = dayAt(g, row, col);
    out.push(
      d < 0
        ? null
        : `${s.days[d]?.program ?? 0}${s.days[d]?.override ? '*' : ''}${(c.days[d]?.fastHours ?? 0) > 0 ? `f${c.days[d]!.fastHours}` : ''}`,
    );
  }
  return out;
}

/** Rows match when every weekday present in both carries the same program (partial first/last rows join). */
function sameWeek(a: Array<string | null>, b: Array<string | null>): boolean {
  for (let i = 0; i < 7; i++) if (a[i] !== null && b[i] !== null && a[i] !== b[i]) return false;
  return true;
}

/** Mean energy of days [a, b) as % of their maintenance references (habitual `tdee` where the compiler gives none). */
function meanPct(c: CompiledSchedule, tdee: number, a: number, b: number): number {
  let sum = 0;
  let ref = 0;
  for (let d = a; d < b; d++) {
    const day = c.days[d];
    if (!day) continue;
    sum += day.energyKcal;
    ref += dayMaintenance(day, tdee);
  }
  return ref > 0 ? (100 * sum) / ref : 0;
}

/** Mean true planned balance of days [a, b), kcal/d. */
function meanBalance(c: CompiledSchedule, tdee: number, a: number, b: number): number {
  let sum = 0;
  let n = 0;
  for (let d = a; d < b; d++) {
    const day = c.days[d];
    if (!day) continue;
    sum += Number.isFinite(day.plannedBalanceKcal) ? day.plannedBalanceKcal! : day.energyKcal - dayMaintenance(day, tdee);
    n++;
  }
  return n > 0 ? sum / n : 0;
}

function autoName(c: CompiledSchedule, a: number, b: number, pct: number): string {
  for (let d = a; d < b; d++) if ((c.days[d]?.fastHours ?? 0) >= 20) return 'fasting block';
  if (pct < 97) return 'deficit';
  if (pct <= 103) return 'maintenance';
  return 'surplus';
}

export function derivePhases(s: Schedule, c: CompiledSchedule, g: CalendarGrid, tdee: number): Phase[] {
  const rowOfDay = (d: number) => Math.floor((d + g.offset) / 7);
  if (s.blocks && s.blocks.length > 0) {
    return [...s.blocks]
      .map((b, i) => ({ b, i }))
      .sort((x, y) => x.b.startDay - y.b.startDay)
      .map(({ b, i }) => {
        const end = Math.min(b.endDay, s.horizonDays);
        const pct = meanPct(c, tdee, b.startDay, end);
        return {
          balanceKcal: meanBalance(c, tdee, b.startDay, end),
          row0: rowOfDay(b.startDay),
          row1: rowOfDay(Math.max(b.startDay, end - 1)),
          startDay: b.startDay,
          endDay: end,
          name: b.name,
          pct,
          explicit: true,
          blockIndex: i,
        };
      });
  }
  const phases: Phase[] = [];
  let r = 0;
  while (r < g.rows) {
    const pat = rowPattern(s, c, g, r);
    let r1 = r;
    while (r1 + 1 < g.rows && sameWeek(pat, rowPattern(s, c, g, r1 + 1))) r1++;
    const days0 = rowDays(g, r);
    const days1 = rowDays(g, r1);
    const a = days0[0] ?? 0;
    const b = (days1[days1.length - 1] ?? a) + 1;
    const pct = meanPct(c, tdee, a, b);
    phases.push({
      balanceKcal: meanBalance(c, tdee, a, b),
      row0: r,
      row1: r1,
      startDay: a,
      endDay: b,
      name: autoName(c, a, b, pct),
      pct,
      explicit: false,
      blockIndex: -1,
    });
    r = r1 + 1;
  }
  return phases;
}

/** "wk 1–4" (1-based rows). */
export function phaseWeeks(p: Phase): string {
  return p.row0 === p.row1 ? `wk ${p.row0 + 1}` : `wk ${p.row0 + 1}–${p.row1 + 1}`;
}
