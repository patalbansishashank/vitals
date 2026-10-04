/**
 * Results state machine (simulator-results.md §8): what the chart area shows for a scenario's run.
 *
 *   never-run      no result and nothing running → perforated stage + Run key
 *   first-run      running with no previous result → stage with the progress rule and "Running … channels"
 *   running        running over a previous result → previous render at 40 % + progress rule
 *   refining       nominal shown, ensemble draws streaming in → full opacity, "range · 12/32 draws"
 *   stale          result shown but inputs changed since → curves at 40 % + "Run again" notice
 *   error          the run failed → danger notice; the previous render (if any) stays dimmed
 *   done           result current
 */
import type { ChartStatus } from '@/features/charts';

export type ResultsPhase = 'never-run' | 'first-run' | 'running' | 'refining' | 'stale' | 'error' | 'done';

export interface RunLike {
  status: 'idle' | 'running' | 'done' | 'cancelled' | 'error';
  phase?: 'nominal' | 'ensemble' | null;
  hasResult: boolean;
  stale: boolean;
  error?: string | null;
}

export interface ResultsState {
  phase: ResultsPhase;
  /** Status handed to the chart frame (drives the 40 % hold and the progress rule). */
  chart: ChartStatus;
  /** A chart can be drawn (a result exists). */
  hasChart: boolean;
}

export function resultsState(r: RunLike): ResultsState {
  if (r.status === 'error') return { phase: 'error', chart: r.hasResult ? 'stale' : 'idle', hasChart: r.hasResult };
  if (r.status === 'running') {
    if (!r.hasResult) return { phase: 'first-run', chart: 'running', hasChart: false };
    if (r.phase === 'ensemble' && !r.stale) return { phase: 'refining', chart: 'idle', hasChart: true };
    return { phase: 'running', chart: 'running', hasChart: true };
  }
  if (!r.hasResult) return { phase: 'never-run', chart: 'idle', hasChart: false };
  if (r.stale) return { phase: 'stale', chart: 'stale', hasChart: true };
  return { phase: 'done', chart: 'idle', hasChart: true };
}

/** Toolbar text while running: "Running · 1.2 s" (+ ensemble progress). */
export function runningText(phase: ResultsPhase, elapsedMs: number | null, drawsDone?: number, drawsTotal?: number): string | undefined {
  const secs = elapsedMs != null ? ` · ${(elapsedMs / 1000).toFixed(1)} s` : '';
  if (phase === 'running' || phase === 'first-run') return `Running${secs}`;
  if (phase === 'refining' && drawsTotal) return `Refining ranges · ${drawsDone ?? 0}/${drawsTotal}`;
  return undefined;
}
