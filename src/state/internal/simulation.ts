/**
 * Simulation run orchestration (importable only from `src/commands/**` and the simulation projection).
 *
 * `run(sid, profile, schedule)` compiles and runs the engine in the simulator worker: the nominal run first (recorded
 * in full, shown immediately), then the uncertainty ensemble — `drawsTotal` Latin-hypercube parameter draws from a
 * fixed seed — streamed in chunks so P10/P50/P90 bands tighten progressively. Same inputs → same bands. Only one run
 * is in flight at a time (starting another cancels it); `cancel` stops it immediately.
 *
 * The synchronous start (run state + the persisted last-run inputs) must run in a write scope: the `sim.run`
 * command's (derive) or a derive scope opened by the projection's actions.
 */
import type { PersonProfile, Schedule } from '@/engine';
import { inputsHash } from '@/features/simulator/lib/hash';
import { defaultDrawCount, getSimulationClient, type DrawSeries } from '@/workers/simulationClient';
import { useSimulationStore } from '../simulationStore';
import { DRAW_CHUNK, ENSEMBLE_SEED, computeBands, runProfile, type RunOptions, type ScenarioRun } from './simulationModel';

let runCounter = 0;
/** The one run in flight (the simulator worker is shared across scenarios). */
let active: { sid: string; runId: number } | null = null;

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function patch(sid: string, runId: number, p: Partial<ScenarioRun>): boolean {
  const cur = useSimulationStore.getState().runs[sid];
  if (!cur || cur.runId !== runId) return false;
  useSimulationStore.setState((st) => ({ runs: { ...st.runs, [sid]: { ...cur, ...p } } }));
  return true;
}
const current = (sid: string, runId: number) => active?.sid === sid && active.runId === runId;

export function run(sid: string, profile: PersonProfile, schedule: Schedule, opts: RunOptions = {}): Promise<void> {
  const client = getSimulationClient();
  if (active) {
    const prev = active;
    active = null;
    client.cancel();
    const pr = useSimulationStore.getState().runs[prev.sid];
    if (pr && pr.runId === prev.runId && pr.status === 'running') patch(prev.sid, prev.runId, { status: 'cancelled', phase: null });
  }
  const p = runProfile(profile, schedule);
  const hash = inputsHash(p, schedule);
  const drawsTotal = Math.max(0, Math.floor(opts.draws ?? defaultDrawCount()));
  const seed = opts.seed ?? ENSEMBLE_SEED;
  const runId = ++runCounter;
  active = { sid, runId };
  const prev = useSimulationStore.getState().runs[sid];
  useSimulationStore.setState((st) => ({
    runs: {
      ...st.runs,
      [sid]: {
        runId,
        hash,
        resultHash: prev?.result ? prev.resultHash : null,
        status: 'running',
        phase: 'nominal',
        progress: 0,
        result: prev?.result ?? null,
        bands: prev?.bands ?? null,
        error: null,
        startedAt: Date.now(),
        finishedAt: null,
      },
    },
    lastRuns: { ...st.lastRuns, [sid]: { hash, at: new Date().toISOString(), profile: p, schedule } },
  }));
  return (async () => {
    try {
      const nominal = await client.runNominal(p, schedule, { record: 'full' });
      if (!current(sid, runId)) return;
      patch(sid, runId, {
        result: nominal,
        resultHash: hash,
        bands: null,
        phase: drawsTotal > 0 ? 'ensemble' : null,
        progress: 1 / (drawsTotal + 1),
      });
      const draws: DrawSeries[] = [];
      for (let start = 0; start < drawsTotal; start += DRAW_CHUNK) {
        const chunk = await client.runDraws(p, schedule, { seed, total: drawsTotal, start, count: Math.min(DRAW_CHUNK, drawsTotal - start) });
        if (!current(sid, runId)) return;
        draws.push(...chunk);
        patch(sid, runId, { bands: computeBands(nominal.daily, draws, drawsTotal), progress: (1 + draws.length) / (drawsTotal + 1) });
      }
      active = null;
      patch(sid, runId, { status: 'done', phase: null, progress: 1, finishedAt: Date.now() });
    } catch (e) {
      if (!current(sid, runId)) return;
      active = null;
      patch(sid, runId, { status: 'error', phase: null, error: message(e), finishedAt: Date.now() });
    }
  })();
}

export function cancel(sid: string): boolean {
  if (!active || active.sid !== sid) return false;
  const { runId } = active;
  active = null;
  getSimulationClient().cancel();
  patch(sid, runId, { status: 'cancelled', phase: null, finishedAt: Date.now() });
  return true;
}

export function restore(sid: string): void {
  const st = useSimulationStore.getState();
  const last = st.lastRuns[sid];
  if (st.runs[sid] || !last) return;
  void run(sid, last.profile, last.schedule);
}

export function forget(sid: string): void {
  cancel(sid);
  useSimulationStore.setState((st) => {
    const runs = { ...st.runs };
    const lastRuns = { ...st.lastRuns };
    delete runs[sid];
    delete lastRuns[sid];
    return { runs, lastRuns };
  });
}

/** Test helper. */
export function reset(): void {
  active = null;
  useSimulationStore.setState({ runs: {}, lastRuns: {} });
}

export function runOf(sid: string): ScenarioRun | undefined {
  return useSimulationStore.getState().runs[sid];
}

export function isActive(sid: string): boolean {
  return active?.sid === sid;
}

export function lastRunOf(sid: string) {
  return useSimulationStore.getState().lastRuns[sid];
}

/** Record the job driving a run (ephemeral run state). */
export function setRunJob(sid: string, jobId: string): void {
  const cur = useSimulationStore.getState().runs[sid];
  if (cur) useSimulationStore.setState((st) => ({ runs: { ...st.runs, [sid]: { ...cur, jobId } } }));
}

/** One nominal run outside the Simulator's run state (what-if comparisons; nothing is stored). */
export function simulateOnce(profile: PersonProfile, schedule: Schedule) {
  return getSimulationClient().runNominal(runProfile(profile, schedule), schedule, { record: 'full' });
}
