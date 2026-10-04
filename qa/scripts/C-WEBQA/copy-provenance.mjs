import fs from 'node:fs';
import path from 'node:path';
import { launch, options, output, go, stubRelease } from './lib.mjs';
import { scanVisibleCopy } from './visible-copy.mjs';

const sweep = JSON.parse(fs.readFileSync(path.join(output, 'sweep-seeded.json'), 'utf8'));
const routes = [...new Set(sweep.filter((row) => row.copy?.forbiddenTextRules).map((row) => row.route))];
const state = JSON.parse(fs.readFileSync(path.join(output, 'seeded-signals-state.json'), 'utf8'));
const browser = await launch();
const results = [];
try {
  const context = await browser.newContext({ ...options(1440, 'light'), storageState: state });
  await stubRelease(context);
  const page = await context.newPage();
  for (const route of routes) {
    await go(page, route, 'light');
    const copy = await page.locator('main').first().innerText();
    // The canonical synthetic fixture names its device model with a letter and numeral.
    // Retain its provenance in the app; distinguish that input from internal app references in this audit only.
    const raw = scanVisibleCopy(copy, route);
    const withoutFixtureLabel = scanVisibleCopy(copy.replaceAll('Acme R1', 'the fixture ring'), route);
    results.push({ route, raw, withoutFixtureLabel });
    fs.writeFileSync(path.join(output, 'copy-provenance.json'), JSON.stringify(results, null, 2));
  }
  await context.close();
} finally { await browser.close(); }
const unexplained = results.filter((row) => row.withoutFixtureLabel.forbiddenTextRules || row.withoutFixtureLabel.forbiddenUrlRules);
console.log(JSON.stringify({ routes: results.length, unexplained: unexplained.length }));
if (unexplained.length) process.exitCode = 1;
