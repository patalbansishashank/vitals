/**
 * Step corrections from the steps-by-source panel (energy SPEC §2.3 4(a)): "count the steps of this span from the ring /
 * the phone". Stored as `log.stepsCorrection` entries (synced like every log, removed with `log.retract`); the Gauge
 * import sends the in-force ones to the server's step fusion, so a save asks for an import right away.
 */
import { dispatch, type CommandResult } from '@/commands';
import { appDay } from '@/living/appDay';
import { addDays } from '@/living/dates';
import type { LogEntry } from '@/living/types';

export type CorrectionUse = 'ring' | 'phone';

export interface StepsCorrectionRow {
  id: string;
  startMs: number;
  endMs: number;
  use: string;
}

export type CorrectionOutcome = { ok: true } | { ok: false; message: string };

const outcome = (r: CommandResult): CorrectionOutcome => (r.ok ? { ok: true } : { ok: false, message: r.error.message });

/** Ask for an import now, so the fused count follows the correction (best effort; the 5-minute import catches up). */
function reimport(): void {
  void import('@/state/gaugeImport')
    .then(({ runGaugeImport }) => runGaugeImport())
    .catch(() => undefined);
}

/** The in-force corrections that overlap [startMs, endMs), oldest first. */
export async function listStepsCorrections(startMs: number, endMs: number): Promise<StepsCorrectionRow[]> {
  const from = addDays(appDay(startMs), -2);
  const to = addDays(appDay(endMs), 1);
  const r = await dispatch('log.get', { from, to, kinds: ['stepsCorrection'] });
  if (!r.ok || !('output' in r) || !Array.isArray(r.output)) return [];
  return (r.output as LogEntry[]).flatMap((e) => {
    if (e.kind !== 'stepsCorrection') return [];
    const s = Date.parse(e.start);
    const t = Date.parse(e.end);
    return Number.isFinite(s) && t > s && t > startMs && s < endMs ? [{ id: e.id, startMs: s, endMs: t, use: e.use }] : [];
  });
}

export async function saveStepsCorrection(startMs: number, endMs: number, use: CorrectionUse): Promise<CorrectionOutcome> {
  const r = outcome(await dispatch('log.stepsCorrection', { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), use }));
  if (r.ok) reimport();
  return r;
}

export async function removeStepsCorrection(entryId: string): Promise<CorrectionOutcome> {
  const r = outcome(await dispatch('log.retract', { entryId }));
  if (r.ok) reimport();
  return r;
}
