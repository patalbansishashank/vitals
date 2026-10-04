import { open, firstRun, BASE, text } from './lib.mjs';
import fs from 'node:fs';
const { browser, page, errors } = await open(process.argv[4] === 'm');
await firstRun(page);
await page.goto(BASE + process.argv[2]); await page.waitForTimeout(4000);
fs.writeFileSync(process.argv[3], await text(page));
console.log(errors); await browser.close();
