import { createMemoryBlobBackend } from './memory';

describe('memory blob backend', () => {
  it('is create-only and stores copies', async () => {
    const b = createMemoryBlobBackend();
    const id = 'A'.repeat(22);
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await b.put(id, bytes)).toBe('created');
    bytes[0] = 9;
    expect(await b.put(id, new Uint8Array([7]))).toBe('exists');
    expect([...(await b.get(id))!]).toEqual([1, 2, 3]);
    expect(await b.has(id)).toBe(true);
    expect(await b.list()).toEqual([id]);
    await b.delete(id);
    expect(await b.get(id)).toBeNull();
    await expect(b.put('../x', bytes)).rejects.toThrow(/Invalid chunk id/);
  });
});
