import { open, BASE, shot } from './lib.mjs';
import { run } from './steps.mjs';
import fs from 'node:fs';
const { browser, page, errors } = await open();
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await run(page, JSON.parse(fs.readFileSync('/media/DEV/tmp/base-shape.json', 'utf8')));
await page.getByRole('button', { name: 'Adjust the drawing', exact: true }).click(); await page.waitForTimeout(500);
const fr = page.getByRole('slider', { name: 'frame', exact: true });
for (const k of ['Home', 'ArrowRight', 'End', 'ArrowLeft']) { await fr.focus(); await page.keyboard.press(k); await page.waitForTimeout(400); console.log('frame', k, await fr.inputValue(), '|', await fr.getAttribute('aria-valuetext')); }
// keyboard-only through first activity questions
await page.getByRole('button', { name: 'Next: a normal day' }).click(); await page.waitForTimeout(1500);
const foc = async () => page.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return `${a.tagName} "${(a.getAttribute('aria-label') || a.innerText || '').slice(0, 50)}" outline=${cs.outlineStyle}/${cs.outlineWidth} shadow=${cs.boxShadow !== 'none'}`; });
console.log('start focus', await foc());
for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); const f = await foc(); if (/yes/.test(f)) { console.log('reached', f); break; } }
await page.keyboard.press('Enter'); await page.waitForTimeout(800); console.log('after Enter', await foc(), await page.locator('main fieldset legend').last().innerText());
for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); const f = await foc(); if (/desk/.test(f)) { console.log('reached', f); break; } }
await page.keyboard.press('ArrowDown'); console.log('after ArrowDown', await foc());
await page.keyboard.press('Space'); await page.waitForTimeout(800); console.log('after Space', await foc(), await page.locator('main fieldset legend').last().innerText());
await shot(page, 'x-kb');
console.log('ERRORS', errors); await browser.close();
