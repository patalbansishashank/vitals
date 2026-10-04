/**
 * Start lines of the dedicated Easy search (PLANNER_V2_SPEC §12.2): from the person's habit (α = 0) to Hard's plan, and
 * to "the habit plus one of Hard's levers" (deficit depth, training, fasting, eating window), all in Hard's structure.
 * The optimiser bisects on α for the least intensity that keeps half of Hard's goal-1 progress.
 */
import type { EasyLine } from '../optim/easySearch';
import type { PlanningContext } from './context';
import { toUnit, type SkeletonStructure } from './skeleton';

/** Lever groups by gene path (one lever at a time). */
export const EASY_LEVERS: ReadonlyArray<{ id: string; test: (path: string) => boolean }> = [
  { id: 'deficit', test: (p) => /\.(energy|lowKcal)$/.test(p) || p === 'ov.pct' },
  { id: 'training', test: (p) => p.startsWith('rt.') || p.startsWith('cardio.') || p === 'steps' },
  { id: 'fasting', test: (p) => p.startsWith('ev.') },
  { id: 'window', test: (p) => p.startsWith('window.') || p === 'meals' },
];

/**
 * The habit genome of a structure, from Hard's genome: energy at maintenance (100 %, or the nearest allowed), protein at
 * the low end, steps, sets and the window at their habitual defaults, sessions at the habitual counts, the fewest
 * fasts. Genes that are not habits (supplement doses, phase lengths, the training clock) keep Hard's value.
 */
export function habitGenome(ctx: PlanningContext, st: SkeletonStructure, xHard: ArrayLike<number>): Float64Array {
  const h = Float64Array.from(xHard);
  const hab = ctx.rp.habits;
  st.genes.forEach((g, k) => {
    const p = g.path;
    if (/\.energy$/.test(p) || p === 'ov.pct') h[k] = toUnit(g, Math.min(g.max, Math.max(g.min, 100)));
    else if (/\.lowKcal$/.test(p)) h[k] = 1;
    else if (/\.protein$/.test(p)) h[k] = 0;
    else if (p === 'steps' || p === 'rt.sets' || p === 'window.startH' || p === 'window.lengthH' || p === 'meals' || p === 'cardio.minutes') h[k] = st.x0[k]!;
    else if (p === 'rt.sessions') h[k] = toUnit(g, Math.min(g.max, Math.max(g.min, Math.round(hab.sessionsPerWeek * (1 - hab.lifingCardioMix)))));
    else if (p === 'cardio.sessions') h[k] = toUnit(g, Math.min(g.max, Math.max(g.min, Math.round(hab.sessionsPerWeek * hab.lifingCardioMix))));
    else if (p === 'ev.count' || p === 'sleep.extraH') h[k] = 0;
  });
  return h;
}

/** The start lines for Hard's plan: habit → Hard, then habit → habit with one of Hard's levers (when it differs). */
export function easyStartLines(ctx: PlanningContext, structureIndex: number, st: SkeletonStructure, xHard: Float64Array): EasyLine[] {
  const h = habitGenome(ctx, st, xHard);
  const lines: EasyLine[] = [{ label: 'all levers', structure: structureIndex, from: h, to: Float64Array.from(xHard) }];
  for (const lever of EASY_LEVERS) {
    const to = Float64Array.from(h);
    let moved = false;
    st.genes.forEach((g, k) => {
      if (!lever.test(g.path)) return;
      to[k] = xHard[k]!;
      if (Math.abs(to[k]! - h[k]!) > 1e-9) moved = true;
    });
    if (moved) lines.push({ label: lever.id, structure: structureIndex, from: h, to });
  }
  return lines;
}
