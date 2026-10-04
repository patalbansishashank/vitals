// usage: node walk.mjs steps.json [mobile]
import { open, dump, BASE, shot } from './lib.mjs';
import fs from 'node:fs';
const steps = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const mobile = process.argv[3] === 'mobile';
const { browser, page, errors } = await open({ mobile });
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
const { run } = await import('./steps.mjs');
await run(page, steps);
console.log('ERRORS', errors);
await browser.close();
