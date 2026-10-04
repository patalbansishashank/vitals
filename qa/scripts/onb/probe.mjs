import { open, BASE } from './lib.mjs';
import fs from 'node:fs';
// run walk steps then eval expression
const steps = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const expr = process.argv[3];
const { browser, page, errors } = await open({ mobile: process.argv[4] === 'mobile' });
globalThis.page = page;
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
const mod = await import('./steps.mjs');
await mod.run(page, steps);
console.log(await eval(expr));
console.log('ERRORS', errors);
await browser.close();
