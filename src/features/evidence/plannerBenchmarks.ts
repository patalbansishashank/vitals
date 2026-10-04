/**
 * The planner benchmark results (docs/validation/planner-benchmarks.json, written by the planner's benchmark harness),
 * bundled as data when the file exists at build time. Until the harness has run, nothing matches and the validation
 * page says the benchmarks are not published yet. A file whose shape does not match is not shown either.
 */
import { isPlannerBenchmarks, type PlannerBenchmarks } from '@/content/evidence/validation/plannerBenchmarks';

const loaders = import.meta.glob<unknown>('/docs/validation/planner-benchmarks.json', { import: 'default' });
const load = Object.values(loaders)[0];

/** The results, `null` when not published, or `'invalid'` when the file does not have the expected shape. */
export async function loadPlannerBenchmarks(): Promise<PlannerBenchmarks | null | 'invalid'> {
  if (!load) return null;
  const data = await load();
  return isPlannerBenchmarks(data) ? data : 'invalid';
}
