import { afterEach, describe, expect, it } from 'vitest';
import { setPlatformForTests } from '../detect';
import { shell, webShell } from '../shell';

afterEach(() => setPlatformForTests(undefined));

describe('shell()', () => {
  it('is the Android bridge in the Android app and the web bridge elsewhere (§15.8)', () => {
    setPlatformForTests('android');
    expect(shell()).not.toBe(webShell);
    expect(typeof shell().keepAlive).toBe('function');
    for (const p of ['web', 'pwa'] as const) {
      setPlatformForTests(p);
      expect(shell()).toBe(webShell);
    }
  });
});
