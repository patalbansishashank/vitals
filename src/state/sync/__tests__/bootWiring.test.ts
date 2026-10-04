// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// v0.3.0–v0.3.2 shipped without this call (it was dropped while moving the QA hook): a paired device stopped syncing
// after every page load until "Sync now" was pressed. Found by the I3 end-to-end smoke.
it('the app entry resumes sync on every start', () => {
  const main = readFileSync(new URL('../../../main.tsx', import.meta.url), 'utf8');
  expect(main).toMatch(/import\('@\/state\/sync'\)\.then\(\(m\) => m\.initSync\(\)\)/);
});
