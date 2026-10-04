/**
 * SUITE_SPEC §14.9 contracts owned by E28: correction / replay, owned-stream redirect, no priority. Runs the real bus
 * over a fresh memory store with the canonical CSV fixture as the device (it brings steps, sleep, weight and HR).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stageFile, clearStaged } from '@/biometrics/app/handoff';
import { bioActivity } from '@/biometrics/app/activity';
import { createMemoryBlobStore, setBlobStore } from '@/state/blobStore';
import { getDocumentStore } from '@/state/runtime';
import { sharedBioIndex } from '@/biometrics/store/docIndex';
import { dispatch, getCommand, jobs, manifest, settleCommits, SYSTEM_ACTOR, type CommandResult } from '../..';
import { deriveWriter, openBioStore } from '../../bio/store';
import { resetBioRuntime } from '../../bio/runtime';
import { AI, MCP, freshState } from '../../__tests__/harness';
import CSV from '@/biometrics/importers/__fixtures__/canonical.csv?raw';

const DAY = '2026-03-10';
const DEVICE_SLEEP_S = 26400;

function out<T>(r: CommandResult): T {
  if (!r.ok || !('output' in r)) throw new Error(`command failed: ${JSON.stringify(r)}`);
  return r.output as T;
}
async function job<T>(r: CommandResult): Promise<T> {
  if (!r.ok || !('job' in r)) throw new Error(`expected a job: ${JSON.stringify(r)}`);
  const st = await jobs.wait(r.job.jobId);
  if (st.state !== 'done') throw new Error(`job ${st.state}: ${JSON.stringify(st.error)}`);
  return jobs.result(r.job.jobId) as T;
}
async function importCsv() {
  const fileRef = stageFile(new Blob([CSV], { type: 'text/csv' }), 'vitals.csv');
  const rep = await job<{ sources: string[] }>(await dispatch('bio.import', { fileRef }));
  await settleCommits();
  return rep;
}
type Daily = { days: Array<{ date: string; values: Record<string, { value: number; basis?: string }>; sleep?: { asleepH: number; basis?: string } }> };
async function sleepOn(d = DAY) {
  await settleCommits();
  return out<Daily>(await dispatch('bio.daily', { from: d, to: d })).days[0]?.sleep;
}
const SIX_H = { target: { kind: 'sleep', localDate: DAY }, value: { asleepS: 6 * 3600 }, note: 'the ring was off' } as const;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-12T12:00:00.000Z'));
  freshState({ cleared: true });
  setBlobStore(createMemoryBlobStore());
  resetBioRuntime();
  clearStaged();
  bioActivity.reset();
});
afterEach(() => vi.useRealTimers());

describe('correction / replay (§14.9)', () => {
  it('correction > device; replay and newer device versions never replace it; clear and undo bring the device back', async () => {
    await importCsv();
    expect((await sleepOn())?.asleepH).toBeCloseTo(DEVICE_SLEEP_S / 3600, 2);

    const r = await dispatch('biometrics.correct', SIX_H);
    const o = out<{ correctionId: string; key: string; replaced: { sourceKey: string; recordId: string } | null }>(r);
    expect(o.key).toBe(`sleep:${DAY}`);
    expect(o.replaced?.recordId).toBeTruthy();
    expect(await sleepOn()).toMatchObject({ asleepH: 6, basis: 'correction' });

    // the same file again (a re-import, or the same events replayed) adds nothing over the correction
    await importCsv();
    expect((await sleepOn())?.asleepH).toBe(6);

    // a newer device version of that night is stored, and still loses
    const ix = sharedBioIndex(getDocumentStore());
    const night = ix.latestRecords(DAY, DAY).find((e) => e.record.kind === 'sleep')!;
    const store = await openBioStore({ writer: deriveWriter() });
    await store.putRecord({ ...night.record, version: night.record.version + 1, asleep_s: 4 * 3600 } as typeof night.record, night.sourceKey);
    await store.flush();
    await settleCommits();
    expect(ix.latestVersion(night.record.record_id)).toBe(night.record.version + 1);
    expect((await sleepOn())?.asleepH).toBe(6);

    // "Use the device value again" → the newest device value
    expect((await dispatch('biometrics.clearCorrection', { key: o.key })).ok).toBe(true);
    expect(await sleepOn()).toMatchObject({ asleepH: 4, basis: 'device' });

    // correct again, then undo the correction → the device value
    const again = await dispatch('biometrics.correct', SIX_H);
    expect((await sleepOn())?.asleepH).toBe(6);
    const cs = again.ok && 'changeSet' in again ? again.changeSet : null;
    expect((await dispatch('history.undo', { changeSetId: cs!.id })).ok).toBe(true);
    expect((await sleepOn())?.asleepH).toBe(4);
  });

  it('scores of a corrected day are recomputed with the correction id in their sources', async () => {
    await importCsv();
    const o = out<{ correctionId: string }>(await dispatch('biometrics.correct', SIX_H));
    await settleCommits();
    await job(await dispatch('bio.rescore', { from: DAY }));
    await settleCommits();
    const day = [...sharedBioIndex(getDocumentStore()).scores()].filter((s) => s.scope.localDate === DAY);
    expect(day.length).toBeGreaterThan(0);
    for (const s of day) expect(s.sourceIds).toContain(o.correctionId);
  });

  it('refuses implausible values and future dates', async () => {
    const future = await dispatch('biometrics.correct', { target: { kind: 'sleep', localDate: '2026-03-20' }, value: { asleepS: 3600 } });
    expect(!future.ok && future.error.code).toBe('invalid_input');
    const steps = await dispatch('biometrics.correct', { target: { kind: 'daily', localDate: DAY, metric: 'steps' }, value: { fields: { resting_hr_bpm: 50 } } });
    expect(!steps.ok && steps.error.code).toBe('invalid_input');
    const weight = await dispatch('biometrics.correct', { target: { kind: 'spot', localDate: DAY, metric: 'weight_kg' }, value: { value: 4000 } });
    expect(!weight.ok && weight.error.code).toBe('invalid_input');
  });
});

describe('owned-stream redirect (§14.9)', () => {
  const sleepInput = { bedAt: '2026-03-09T23:00:00.000Z', wakeAt: '2026-03-10T05:00:00.000Z' };

  it('with sleep owned, a Coach or MCP log.sleep becomes a staged correction and no log entry', async () => {
    await importCsv();
    for (const actor of [AI, MCP]) {
      const r = await dispatch('log.sleep', sleepInput, { actor, idempotencyKey: `${actor.kind}:1` });
      expect(r.ok && 'pending' in r).toBe(true);
      if (!r.ok || !('pending' in r)) continue;
      expect(r.redirected).toBe('biometrics.correct');
      expect(r.pending.commandId).toBe('biometrics.correct');
    }
    const log = out<unknown[]>(await dispatch('log.get', { from: '2026-03-09', to: DAY }));
    expect(log.filter((e) => (e as { kind?: string }).kind === 'sleep')).toEqual([]);
    expect((await sleepOn())?.asleepH).toBeCloseTo(DEVICE_SLEEP_S / 3600, 2);
  });

  it('the person applies the staged correction from the proposal card', async () => {
    await importCsv();
    const r = await dispatch('bio.manual', { date: DAY, metric: 'sleep_h', value: 6 }, { actor: AI, idempotencyKey: 'ai:2' });
    if (!r.ok || !('pending' in r)) throw new Error('expected a proposal');
    expect((await dispatch('coach.applyPending', { pendingId: r.pending.pendingId })).ok).toBe(true);
    expect(await sleepOn()).toMatchObject({ asleepH: 6, basis: 'correction' });
  });

  it('a direct UI dispatch on an owned stream is refused with device_owned', async () => {
    await importCsv();
    const r = await dispatch('log.sleep', sleepInput);
    expect(!r.ok && r.error.code).toBe('precondition_failed');
    expect(!r.ok && r.error.detail?.reason).toBe('device_owned');
    const steps = await dispatch('log.steps', { date: DAY, steps: 5 });
    expect(!steps.ok && steps.error.detail?.reason).toBe('device_owned');
  });

  it('with sleep not owned, log.sleep works as before', async () => {
    const r = await dispatch('log.sleep', sleepInput);
    expect(r.ok && 'output' in r).toBe(true);
    const ai = await dispatch('log.sleep', sleepInput, { actor: AI, idempotencyKey: 'ai:3' });
    expect(ai.ok && !('pending' in ai)).toBe(true);
  });
});

describe('no priority (§14.9)', () => {
  it('bio.setSourcePriority is not in the registry nor any tool list', () => {
    expect(getCommand('bio.setSourcePriority')).toBeUndefined();
    for (const s of ['ui', 'ai', 'webmcp', 'mcp'] as const) expect(manifest(s).map((t) => t.name)).not.toContain('bio_set_source_priority');
    expect(manifest('ai').map((t) => t.name)).toContain('biometrics_correct');
    expect(manifest('ai').map((t) => t.name)).not.toContain('biometrics_drop_priorities');
  });

  it('dropPriorities: removes stored priorities, moves a differing entry by hand into a correction; idempotent', async () => {
    // an entry by hand before any device, then the device arrives and owns steps
    await dispatch('bio.manual', { date: DAY, metric: 'steps', value: 1000 });
    await importCsv();
    const sk = sharedBioIndex(getDocumentStore()).sources().find((s) => s.sourceKey !== 'manual')!.sourceKey;
    const token = (await import('@/store')).mintWriteToken('derive', { label: 'test' });
    await getDocumentStore().transact(token, async (tx) => {
      await tx.patch('bioSources', sk, { priority: 3, priorityByMetric: { steps: 0 } });
    });
    await settleCommits();
    expect(out<Daily>(await dispatch('bio.daily', { from: DAY, to: DAY })).days[0]!.values['steps']).toMatchObject({ value: 8421, basis: 'device' });

    const ui = await dispatch('biometrics.dropPriorities', {});
    expect(ui.ok).toBe(false);
    const first = out<{ sourcesCleared: number; corrections: number; duplicatesDropped: number }>(await dispatch('biometrics.dropPriorities', {}, { actor: SYSTEM_ACTOR }));
    expect(first, JSON.stringify(first)).toMatchObject({ sourcesCleared: 1, corrections: 1, duplicatesDropped: 0 });
    await settleCommits();
    const ix = sharedBioIndex(getDocumentStore());
    expect(ix.source(sk)?.priority).toBeUndefined();
    expect(ix.latestRecords(DAY, DAY).some((e) => e.sourceKey === 'manual')).toBe(false);
    expect(out<Daily>(await dispatch('bio.daily', { from: DAY, to: DAY })).days[0]!.values['steps']).toMatchObject({ value: 1000, basis: 'correction' });

    const second = out<{ sourcesCleared: number; corrections: number; duplicatesDropped: number }>(await dispatch('biometrics.dropPriorities', {}, { actor: SYSTEM_ACTOR }));
    expect(second).toMatchObject({ sourcesCleared: 0, corrections: 0, duplicatesDropped: 0 });
  });
});
