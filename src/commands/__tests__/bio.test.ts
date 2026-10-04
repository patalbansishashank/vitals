/**
 * `bio.*` executors (I1-B over E10's src/biometrics): a canonical file import through the staged-file port, the reads
 * the screens and agents use (with the person's Coach sharing applied to agents), entries by hand, policy and priority
 * changes, deleting a source, and the background rescore the app dispatches as the SYSTEM actor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stageFile, clearStaged } from '@/biometrics/app/handoff';
import { bioActivity } from '@/biometrics/app/activity';
import { createMemoryBlobStore, setBlobStore } from '@/state/blobStore';
import { getDocumentStore } from '@/state/runtime';
import { dispatch, getCommand, jobs, mintConfirmation, on, settleCommits, type CommandResult } from '..';
import { flushRescore, resetBioRuntime, scheduleRescore } from '../bio/runtime';
import { createBioObservationAdapter } from '../bio/observations';
import { AI, freshState } from './harness';
import CSV from '@/biometrics/importers/__fixtures__/canonical.csv?raw';

const DAY = '2026-03-10';
const IDS = ['bio.daily', 'bio.series', 'bio.baselines', 'bio.sources', 'bio.scores', 'bio.manual', 'bio.import', 'bio.deviceConnect', 'bio.deviceSync', 'bio.setPolicy', 'bio.deleteSource', 'bio.rescore'];

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
  return job<{ importer: string; records: number; samples: number; sources: string[] }>(await dispatch('bio.import', { fileRef }));
}

type Daily = { days: Array<{ date: string; values: Record<string, { value: number; sourceKey: string }>; sleep?: { asleepH: number } }>; hidden: string[] };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-12T12:00:00.000Z'));
  freshState({ cleared: true });
  setBlobStore(createMemoryBlobStore());
  resetBioRuntime();
  clearStaged();
  bioActivity.reset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('bio commands are implemented', () => {
  it('replaces all 13 stubs', () => {
    for (const id of IDS) expect(getCommand(id)?.notImplemented, id).toBeUndefined();
  });
});

describe('import and reads', () => {
  it('imports a staged canonical file as a job, then reads it back by day, series and source', async () => {
    const rep = await importCsv();
    expect(rep.importer).toBe('canonical');
    expect(rep.records).toBeGreaterThanOrEqual(3);
    expect(rep.samples).toBe(3);
    expect(rep.sources.length).toBeGreaterThan(0);

    const daily = out<Daily>(await dispatch('bio.daily', { from: DAY, to: DAY }));
    expect(daily.days).toHaveLength(1);
    expect(daily.days[0]!.values['steps']?.value).toBe(8421);
    expect(daily.days[0]!.values['weight_kg']?.value).toBe(81.4);
    expect(daily.days[0]!.sleep?.asleepH).toBeCloseTo(26400 / 3600, 1);
    expect(daily.hidden).toEqual([]);

    const series = out<{ points: Array<{ value: number }>; resolution: string }>(await dispatch('bio.series', { metric: 'hr', from: DAY, to: DAY }));
    expect(series.resolution).toBe('raw');
    expect(series.points.map((p) => p.value)).toEqual([62, 64, 63]);

    const src = out<{ sources: Array<{ sourceKey: string; records: number; streams: string[] }> }>(await dispatch('bio.sources', {}));
    expect(src.sources.length).toBeGreaterThan(0);
    expect(src.sources.some((s) => s.streams.includes('hr'))).toBe(true);
  });

  it('a staged file is taken once; an unknown reference fails cleanly', async () => {
    const r = await dispatch('bio.import', { fileRef: 'file:nothing' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe('not_found');
  });

  it('rejects a range longer than 92 days and a non-stream series metric', async () => {
    const a = await dispatch('bio.daily', { from: '2025-01-01', to: DAY });
    expect(!a.ok && a.error.code).toBe('invalid_input');
    const b = await dispatch('bio.series', { metric: 'weight' });
    expect(!b.ok && b.error.code).toBe('invalid_input');
  });
});

describe('policy filtering for agents', () => {
  it('leaves out streams the person does not share with the Coach (only for agents)', async () => {
    await importCsv();
    // the Coach sees nothing until the person shares it: share weight, keep steps hidden
    expect((await dispatch('bio.setPolicy', { stream: 'weight', policy: { coach: 'daily' } })).ok).toBe(true);
    const set = await dispatch('bio.setPolicy', { stream: 'steps', policy: { coach: 'hidden' } });
    expect(set.ok).toBe(true);
    await settleCommits();

    const mine = out<Daily>(await dispatch('bio.daily', { from: DAY, to: DAY }));
    expect(mine.days[0]!.values['steps']?.value).toBe(8421);

    const agent = out<Daily>(await dispatch('bio.daily', { from: DAY, to: DAY }, { actor: AI }));
    expect(agent.days[0]!.values['steps']).toBeUndefined();
    expect(agent.hidden).toContain('steps');
    expect(agent.days[0]!.values['weight_kg']?.value).toBe(81.4);
  });

  it('series need daily+series sharing for agents', async () => {
    await importCsv();
    await dispatch('bio.setPolicy', { stream: 'hr', policy: { coach: 'daily' } });
    await settleCommits();
    const agent = out<{ points: unknown[]; hidden: boolean }>(await dispatch('bio.series', { metric: 'hr', from: DAY, to: DAY }, { actor: AI }));
    expect(agent.points).toEqual([]);
    expect(agent.hidden).toBe(true);
  });

  it('consent and device commands stay in the app', async () => {
    for (const [id, input] of [
      ['bio.setPolicy', { stream: 'steps', policy: { coach: 'daily' } }],
      ['bio.deleteSource', { sourceKey: 'x' }],
      ['bio.import', { fileRef: 'file:x' }],
      ['bio.rescore', {}],
    ] as const) {
      const r = await dispatch(id, input as never, { actor: AI, idempotencyKey: `${AI.conversationId}:${id}` });
      expect(!r.ok && r.error.code, id).toBe('surface_forbidden');
    }
  });
});

describe('changes', () => {
  it('bio.manual stores a value by hand in the command change (undoable) under the manual source', async () => {
    const r = await dispatch('bio.manual', { date: '2026-03-11', metric: 'weight', value: 80.2 });
    const { recordId } = out<{ recordId: string }>(r);
    expect(recordId).toBeTruthy();
    expect(r.ok && 'changeSet' in r && r.changeSet).toBeTruthy();
    await settleCommits();
    const daily = out<Daily>(await dispatch('bio.daily', { from: '2026-03-11', to: '2026-03-11' }));
    expect(daily.days[0]!.values['weight_kg']).toMatchObject({ value: 80.2, sourceKey: 'manual' });
    expect(getDocumentStore().peek('bioSources', 'manual')).toBeTruthy();

    const bad = await dispatch('bio.manual', { date: '2026-03-11', metric: 'mood', value: 3 });
    expect(!bad.ok && bad.error.code).toBe('invalid_input');
    const future = await dispatch('bio.manual', { date: '2026-04-01', metric: 'weight_kg', value: 80 });
    expect(!future.ok && future.error.code).toBe('invalid_input');
  });

  it('setPolicy changes the person-level policy and returns it', async () => {
    const list = out<Array<{ stream: string; coach: string; imported: boolean }>>(await dispatch('bio.setPolicy', { stream: 'hrv', policy: { imported: true, coach: 'daily+series' } }));
    expect(list.find((p) => p.stream === 'hrv')).toMatchObject({ imported: true, coach: 'daily+series' });
    await settleCommits();
    const src = out<{ policies: Array<{ stream: string; coach: string }> }>(await dispatch('bio.sources', {}));
    expect(src.policies.find((p) => p.stream === 'hrv')?.coach).toBe('daily+series');
    const bad = await dispatch('bio.setPolicy', { stream: 'nonsense', policy: {} });
    expect(!bad.ok && bad.error.code).toBe('invalid_input');
  });

  it('bio.setSourcePriority is gone; an entry by hand never beats a device', async () => {
    expect(getCommand('bio.setSourcePriority')).toBeUndefined();
    await importCsv();
    await dispatch('bio.manual', { date: DAY, metric: 'steps', value: 1000 });
    await settleCommits();
    const daily = out<Daily>(await dispatch('bio.daily', { from: DAY, to: DAY }));
    expect(daily.days[0]!.values['steps']?.sourceKey).not.toBe('manual');
    expect((daily.days[0]!.values['steps'] as { basis?: string } | undefined)?.basis).toBe('device');
  });

  it('deleteSource needs a confirmation, then removes the source and what it brought in', async () => {
    const rep = await importCsv();
    const sk = rep.sources[0]!;
    const refused = await dispatch('bio.deleteSource', { sourceKey: sk });
    expect(!refused.ok && refused.error.code).toBe('confirmation_required');
    const r = await dispatch('bio.deleteSource', { sourceKey: sk }, { confirmation: mintConfirmation('bio.deleteSource', { sourceKey: sk }) });
    expect(out<{ deleted: boolean }>(r).deleted).toBe(true);
    await settleCommits();
    const left = out<{ sources: Array<{ sourceKey: string }> }>(await dispatch('bio.sources', {}));
    expect(left.sources.map((s) => s.sourceKey)).not.toContain(sk);
    const daily = out<Daily>(await dispatch('bio.daily', { from: DAY, to: DAY }));
    expect(daily.days.flatMap((d) => Object.values(d.values)).filter((v) => v.sourceKey === sk)).toEqual([]);
  });

  it('device commands without a staged Bluetooth link fail with a precondition', async () => {
    const r = await dispatch('bio.deviceConnect', { driver: 'colmi' });
    expect(r.ok).toBe(false);
    expect(['precondition_failed', 'not_found']).toContain(!r.ok && r.error.code);
  });
});

describe('background rescoring', () => {
  it('a scheduled rescore is dispatched as bio.rescore by the SYSTEM actor and runs as a job', async () => {
    await importCsv();
    const seen: Array<{ id: string; actor?: string }> = [];
    const off = on((e) => {
      const ev = e as { type: string; commandId?: string; actor?: { kind: string } };
      if (ev.commandId === 'bio.rescore') seen.push({ id: ev.type, ...(ev.actor ? { actor: ev.actor.kind } : {}) });
    });
    const before = jobs.list().length;
    scheduleRescore(DAY);
    await flushRescore();
    off();
    const started = jobs.list().slice(before);
    expect(started.length).toBe(1);
    const st = await jobs.wait(started[0]!.jobId);
    expect(st.state).toBe('done');
    expect(jobs.result(started[0]!.jobId)).toMatchObject({ aborted: false });
    expect(bioActivity.get().rescoring).toBeNull();
    if (seen.some((s) => s.actor)) expect(seen.find((s) => s.actor)?.actor).toBe('system');
  });
});

describe('observation adapter (living plan)', () => {
  it('turns stored measurements into plan observations, only for streams the plan may use', async () => {
    const adapter = createBioObservationAdapter();
    expect(adapter.observations(DAY, DAY)).toEqual([]);
    await importCsv();
    // the import brings weight in, so a device owns it: the entry by hand is refused and a correction carries the value
    const refused = await dispatch('bio.manual', { date: '2026-03-11', metric: 'weight_kg', value: 80.2 });
    expect(!refused.ok && refused.error.detail?.reason).toBe('device_owned');
    expect((await dispatch('biometrics.correct', { target: { kind: 'spot', localDate: '2026-03-11', metric: 'weight_kg' }, value: { value: 80.2 } })).ok).toBe(true);
    await settleCommits();
    const obs = adapter.observations(DAY, '2026-03-11');
    const day10 = obs.find((o) => o.date === DAY);
    expect(day10?.steps?.value).toBe(8421);
    expect(day10?.sleep?.hours).toBeCloseTo(26400 / 3600, 2);
    expect(obs.find((o) => o.date === '2026-03-11')?.weights?.[0]?.kg).toBe(80.2);

    await dispatch('bio.setPolicy', { stream: 'steps', policy: { engine: false } });
    await settleCommits();
    expect(adapter.observations(DAY, DAY)[0]?.steps).toBeUndefined();
  });
});
