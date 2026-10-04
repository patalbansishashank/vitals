// @vitest-environment node
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createFileBlobBackend, openFileChunkStore } from './blobFiles.ts';

const root = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'blobfiles-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const ID = 'AbCdEfGhIjKlMnOpQrStUv';

describe('file blob store', () => {
  it('is create-only, shards by the first two characters and lists chunk ids', async () => {
    const dir = join(root, 'b1');
    const b = createFileBlobBackend(dir);
    expect(await b.put(ID, new Uint8Array([1, 2, 3]))).toBe('created');
    expect(await b.put(ID, new Uint8Array([9]))).toBe('exists');
    expect(await b.get(ID)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await b.has(ID)).toBe(true);
    expect(await b.get('ZZZZZZZZZZZZZZZZZZZZZZ')).toBeNull();
    expect(await b.list()).toEqual([ID]);
    expect(readdirSync(join(dir, 'Ab'))).toEqual([ID]);
    expect((statSync(join(dir, 'Ab')).mode & 0o777).toString(8)).toBe('700');
    expect((statSync(join(dir, 'Ab', ID)).mode & 0o777).toString(8)).toBe('600');
    await expect(b.put('../escape', new Uint8Array([1]))).rejects.toThrow();
    await b.delete(ID);
    expect(await b.has(ID)).toBe(false);
  });

  it('keeps chunks and their index across a reopen', async () => {
    const dir = join(root, 'blobs');
    const a = openFileChunkStore(dir);
    const { chunkId } = await a.store.put(new Uint8Array([4, 5, 6]), { purpose: 'bio', aadId: 'hr:2026-10-01', localDate: '2026-10-01' });
    a.close();
    const b = openFileChunkStore(dir);
    expect(await b.store.hasLocal(chunkId)).toBe(true);
    expect(await b.store.get(chunkId)).toEqual(new Uint8Array([4, 5, 6]));
    b.close();
    expect((statSync(join(dir, 'index.db')).mode & 0o777).toString(8)).toBe('600');
  });
});
