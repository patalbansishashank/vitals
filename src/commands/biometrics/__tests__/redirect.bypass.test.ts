/** V2 review: paths that could write a hand entry for a device-owned stream without the redirect rule. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stageFile, clearStaged } from '@/biometrics/app/handoff';
import { bioActivity } from '@/biometrics/app/activity';
import { createMemoryBlobStore, setBlobStore } from '@/state/blobStore';
import { getDocumentStore } from '@/state/runtime';
import { sharedBioIndex } from '@/biometrics/store/docIndex';
import { dispatch, jobs, settleCommits, type CommandResult } from '../..';
import { resetBioRuntime } from '../../bio/runtime';
import { AI, MCP, freshState } from '../../__tests__/harness';
import CSV from '@/biometrics/importers/__fixtures__/canonical.csv?raw';

const DAY = '2026-03-10';
async function importCsv() {
  const fileRef = stageFile(new Blob([CSV], { type: 'text/csv' }), 'vitals.csv');
  const r = await dispatch('bio.import', { fileRef });
  if (!r.ok || !('job' in r)) throw new Error('import');
  await jobs.wait(r.job.jobId);
  await settleCommits();
}
const stepEntries = () => getDocumentStore().peekAll<{ kind?: string; steps?: number; date?: string }>('dailyLogs').filter((d) => d.kind === 'steps');
const isRefusal = (r: CommandResult) => !r.ok && r.error.detail?.reason === 'device_owned';

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

describe('owned-stream redirect cannot be bypassed', () => {
  it('log.bulk steps entries for an owned stream are refused for every actor', async () => {
    await importCsv();
    const input = { days: [{ date: DAY, entries: [{ kind: 'steps', steps: 9999 }] }] };
    expect(isRefusal(await dispatch('log.bulk', input))).toBe(true);
    expect(isRefusal(await dispatch('log.bulk', input, { actor: MCP, idempotencyKey: 'b1' }))).toBe(true);
    expect(stepEntries()).toEqual([]);
    // notes and empty days still go through
    const ok = await dispatch('log.bulk', { days: [{ date: DAY, entries: [{ kind: 'note', text: 'x' }] }] });
    expect(ok.ok).toBe(true);
  });

  it('log.edit of an earlier steps entry is redirected (agent) or refused (UI) once a device owns steps', async () => {
    const made = await dispatch('log.steps', { date: DAY, steps: 100 });
    const entryId = (made as { output: { entryId: string } }).output.entryId;
    await importCsv();
    const ui = await dispatch('log.edit', { entryId, patch: { steps: 5 } });
    expect(isRefusal(ui)).toBe(true);
    const ai = await dispatch('log.edit', { entryId, patch: { steps: 5 } }, { actor: AI, idempotencyKey: 'e1' });
    expect(ai.ok && 'pending' in ai && ai.redirected).toBe('biometrics.correct');
    // a note-only edit is untouched
    expect((await dispatch('log.edit', { entryId, patch: { text: 'hi' } })).ok).toBe(true);
  });

  it('an actor kind sent inside the input is ignored (the actor comes from the dispatcher only)', async () => {
    await importCsv();
    const r = await dispatch('log.steps', { date: DAY, steps: 5, actor: { kind: 'user', id: 'local-user' } } as never, { actor: MCP, idempotencyKey: 'x1' });
    expect(r.ok).toBe(false); // unknown input keys are refused by the schema; nothing is written
    expect(stepEntries()).toEqual([]);
  });

  it('a person-applied direct proposal (user acting for an agent) is refused, never written', async () => {
    await importCsv();
    const r = await dispatch('log.steps', { date: DAY, steps: 5 }, { actor: { kind: 'user', id: 'local-user', onBehalfOf: MCP } });
    expect(isRefusal(r)).toBe(true);
    expect(stepEntries()).toEqual([]);
  });

  it('while the biometrics index is still loading an agent entry waits for it instead of writing through', async () => {
    await importCsv();
    const ix = sharedBioIndex(getDocumentStore());
    let loaded = false;
    Object.defineProperty(ix, 'isLoaded', { get: () => loaded, configurable: true });
    Object.defineProperty(ix, 'ready', { get: () => { loaded = true; return Promise.resolve(); }, configurable: true });
    const r = await dispatch('log.steps', { date: DAY, steps: 5 }, { actor: MCP, idempotencyKey: 'cold' });
    expect(r.ok && 'pending' in r && r.redirected).toBe('biometrics.correct');
    expect(stepEntries()).toEqual([]);
  });

  it('log.measurement in pounds becomes a correction in kilograms', async () => {
    await importCsv();
    const r = await dispatch('log.measurement', { date: DAY, metric: 'weightKg', value: 180, unit: 'lb' }, { actor: AI, idempotencyKey: 'lb1' });
    if (!r.ok || !('pending' in r)) throw new Error(JSON.stringify(r));
    const staged = getDocumentStore().peek<{ input: { value: { value: number } } }>('pendingChanges', r.pending.pendingId);
    expect(staged?.input.value.value).toBeCloseTo(81.65, 1);
  });
});
