import { createOpfsBlobBackend, openOpfsBlobBackend } from './opfs';

const notFound = () => Object.assign(new Error('not found'), { name: 'NotFoundError' });

/** Minimal in-memory FileSystemDirectoryHandle (jsdom has no OPFS). Writes land only on close(), like the real API. */
class FakeDir {
  dirs = new Map<string, FakeDir>();
  files = new Map<string, Uint8Array>();
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDir> {
    let d = this.dirs.get(name);
    if (!d) {
      if (!options?.create) throw notFound();
      d = new FakeDir();
      this.dirs.set(name, d);
    }
    return d;
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!options?.create) throw notFound();
      this.files.set(name, new Uint8Array(0));
    }
    return {
      getFile: async () => ({ arrayBuffer: async () => this.files.get(name)!.slice().buffer }),
      createWritable: async () => {
        let pending = new Uint8Array(0);
        return {
          write: async (data: Uint8Array) => {
            pending = data.slice();
          },
          close: async () => {
            this.files.set(name, pending);
          },
        };
      },
    };
  }
  async removeEntry(name: string) {
    if (!this.files.delete(name) && !this.dirs.delete(name)) throw notFound();
  }
  async *keys() {
    yield* this.dirs.keys();
    yield* this.files.keys();
  }
}

describe('OPFS blob backend', () => {
  it('stores create-only under a two-character shard', async () => {
    const root = new FakeDir();
    const b = createOpfsBlobBackend(root as unknown as FileSystemDirectoryHandle);
    const id = 'abCDEFGHIJKLMNOPQRSTUV';
    expect(await b.has(id)).toBe(false);
    expect(await b.get(id)).toBeNull();
    expect(await b.put(id, new Uint8Array([1, 2]))).toBe('created');
    expect(await b.put(id, new Uint8Array([3]))).toBe('exists');
    expect(root.dirs.get('vitals-blobs')!.dirs.get('ab')!.files.get(id)).toEqual(new Uint8Array([1, 2]));
    expect([...(await b.get(id))!]).toEqual([1, 2]);
    expect(await b.has(id)).toBe(true);
    expect(await b.list()).toEqual([id]);
    await b.delete(id);
    await b.delete(id);
    expect(await b.has(id)).toBe(false);
    await expect(b.put('../../etc/passwd', new Uint8Array([1]))).rejects.toThrow(/Invalid chunk id/);
  });

  it('explains when OPFS is unavailable', async () => {
    const storage = globalThis.navigator?.storage;
    if (storage && typeof storage.getDirectory === 'function') return;
    await expect(openOpfsBlobBackend()).rejects.toThrow(/Origin Private File System/);
  });
});
