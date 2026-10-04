/** A store that never opens must not leave readers (the Signals page) waiting for the first build for ever. */
import { describe, expect, it } from 'vitest';
import { BioDocIndex } from '../docIndex';

describe('BioDocIndex.isSettled', () => {
  it('is false while the store opens, then true after the first build', async () => {
    let open!: () => void;
    const ready = new Promise<void>((r) => (open = r));
    const idx = new BioDocIndex({ ready, peekAll: () => [], subscribe: () => () => undefined });
    expect(idx.isSettled).toBe(false);
    open();
    await ready;
    expect(idx.isLoaded).toBe(true);
    expect(idx.isSettled).toBe(true);
  });

  it('is true (and empty, not loaded) when the store fails to open, with a revision bump', async () => {
    const ready = Promise.reject(new Error('backend did not open'));
    const idx = new BioDocIndex({ ready, peekAll: () => [], subscribe: () => () => undefined });
    let bumped = 0;
    idx.subscribe(() => bumped++);
    await ready.catch(() => undefined);
    await Promise.resolve();
    expect(idx.isLoaded).toBe(false);
    expect(idx.isSettled).toBe(true);
    expect(bumped).toBe(1);
  });
});
