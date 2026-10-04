// @vitest-environment node
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { BackendChange } from '../../../../src/store/backend.ts';
import { openLocalDb } from './localDb.ts';

const root = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'localdb-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const device = 'SERVERHME0000001';

describe('openLocalDb', () => {
  it('stamps, lists, soft-deletes, keeps history and emits local changes like the memory backend', async () => {
    const b = openLocalDb(join(root, 'a.db'), { device });
    const seen: BackendChange[] = [];
    b.subscribe((c) => seen.push(c));
    const d1 = await b.put('jobs', 'j1', { n: 1, gone: undefined });
    expect(d1).toMatchObject({ _id: 'j1', _col: 'jobs', _schema: 1, _device: device, value: { n: 1 } });
    expect('gone' in (d1.value as object)).toBe(false);
    const d2 = await b.put('jobs', 'j1', { n: 2 }, { schema: 3 });
    expect(d2._created).toBe(d1._created);
    expect(d2._rev > d1._rev).toBe(true);
    await b.put('jobs', 'j2', { n: 9 });
    await b.delete('jobs', 'j2');
    await b.delete('jobs', 'missing');
    expect((await b.list('jobs')).map((d) => d._id)).toEqual(['j1']);
    expect((await b.list('jobs', { includeDeleted: true })).find((d) => d._id === 'j2')).toMatchObject({ _deleted: true, value: { n: 9 } });
    expect((await b.history!('jobs', 'j1', 5)).map((d) => d.value)).toEqual([{ n: 1 }]);
    const batch = await b.batch!([{ kind: 'put', col: 'aiUsage', id: 'u1', value: { t: 1 }, schema: 1 }, { kind: 'delete', col: 'jobs', id: 'j1' }]);
    expect(batch.map((d) => [d._col, d._id, Boolean(d._deleted)])).toEqual([['aiUsage', 'u1', false], ['jobs', 'j1', true]]);
    expect(seen.map((c) => `${c.col}/${c.id}:${c.origin}`)).toEqual(['jobs/j1:local', 'jobs/j1:local', 'jobs/j2:local', 'jobs/j2:local', 'aiUsage/u1:local', 'jobs/j1:local']);
    for (let i = 0; i < 30; i++) await b.put('jobs', 'h', { i });
    expect(await b.history!('jobs', 'h', 100)).toHaveLength(20);
    expect((await b.history!('jobs', 'h', 1))[0]!.value).toEqual({ i: 28 });
    await b.erase!();
    expect(b.size()).toBe(0);
    await b.close();
  });

  it('keeps ledger and undo rows across a reopen, in a 0600 file', async () => {
    const file = join(root, 'local.db');
    const a = openLocalDb(file, { device });
    await a.put('commandLedger', 'log.steps|k1', { commandId: 'log.steps', at: '2026-10-01T00:00:00.000Z', result: { ok: true } });
    await a.put('changeLog', 'cs1', { commandId: 'log.steps', label: 'Log steps', ops: [] });
    await a.close();
    const b = openLocalDb(file, { device });
    expect((await b.get('commandLedger', 'log.steps|k1'))?.value).toMatchObject({ result: { ok: true } });
    expect((await b.list('changeLog')).map((d) => d._id)).toEqual(['cs1']);
    await b.close();
    expect((statSync(file).mode & 0o777).toString(8)).toBe('600');
  });
});
