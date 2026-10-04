import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, options, output, widths, themes, go, stubRelease } from './lib.mjs';

const links = ['/progress/illness.nightsignal#versions', '/progress/fitness.vo2max#versions', '/progress/readiness.index#versions'];
const state = JSON.parse(fs.readFileSync(path.join(output, 'seeded-signals-state.json'), 'utf8'));
const browser = await launch();
const results = [];
try {
  for (const width of widths) for (const theme of themes) {
    const context = await browser.newContext({ ...options(width, theme), storageState: state });
    await stubRelease(context);
    const page = await context.newPage();
    for (const route of links) {
      const row = { route, width, theme };
      try {
        await go(page, route, theme);
        const section = page.locator('#versions');
        await section.waitFor({ state: 'visible' });
        assert.equal(await section.count(), 1);
        row.passed = true;
      } catch (error) { row.passed = false; row.error = error.message.split('\n')[0]; }
      results.push(row);
      fs.writeFileSync(path.join(output, 'anchor-targets.json'), JSON.stringify(results, null, 2));
    }
    await context.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ checked: results.length, passed: results.filter((r) => r.passed).length }));
if (results.some((r) => !r.passed)) process.exitCode = 1;
