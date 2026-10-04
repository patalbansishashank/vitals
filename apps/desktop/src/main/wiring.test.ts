// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// The app must run the hardened system calls the tests run (symlinked configs, Windows `.cmd` shims, PATH for
// `#!/usr/bin/env node` tools, the Store ChatGPT package), not the bare `nodeSys()` (review DESK-03).
it('main builds the AI-tools wiring with createNodeAiTools', () => {
  const main = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  expect(main).toMatch(/createNodeAiTools\(\{/);
  expect(main).not.toMatch(/createAiTools\(|nodeSys\(\)/);
});
