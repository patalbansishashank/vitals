import { open, BASE, shot } from './lib.mjs';
import { run } from './steps.mjs';
import fs from 'node:fs';
const steps = JSON.parse(fs.readFileSync('/media/DEV/tmp/base-shape.json', 'utf8'));
const nogl = process.argv[2] === 'nogl'; const mobile = process.argv[3] === 'mobile';
const { browser, page, errors } = await open({ mobile, args: nogl ? ['--disable-webgl', '--disable-3d-apis'] : [] });
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await run(page, steps);
await page.waitForTimeout(4000);
const tag = (nogl ? 'nogl' : 'gl') + (mobile ? '-m' : '');
const r = await page.evaluate(() => {
  const vis = e => e.getBoundingClientRect().width > 0;
  const canv = [...document.querySelectorAll('canvas')].filter(vis).length;
  const svgImg = [...document.querySelectorAll('svg[role=img]')].filter(vis).map(s => (s.getAttribute('aria-label') || '').slice(0, 160));
  const nameless = [...document.querySelectorAll('input,select,textarea,button')].filter(vis).filter(e => { const id = e.id; const lbl = id && document.querySelector(`label[for="${id}"]`); return !(e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || lbl || e.closest('label') || (e.tagName === 'BUTTON' && e.innerText.trim())); }).map(e => e.outerHTML.slice(0, 120));
  const lm = { main: document.querySelectorAll('main').length, nav: document.querySelectorAll('nav').length, h1: [...document.querySelectorAll('h1')].map(h => h.innerText) };
  return { canv, svgImg, nameless, lm };
});
console.log(tag, JSON.stringify(r, null, 1));
await shot(page, `x-body-${tag}`);
// Frame slider
const adj = page.getByRole('button', { name: 'Adjust the drawing', exact: true }).first(); if (await adj.count()) { await adj.click(); await page.waitForTimeout(800); }
const fr = await page.evaluate(() => {
  const s = [...document.querySelectorAll('input[type=range]')].find(i => /^frame$/i.test((i.getAttribute('aria-label') || i.labels?.[0]?.innerText || (i.getAttribute('aria-labelledby') ? document.getElementById(i.getAttribute('aria-labelledby'))?.innerText : '') || '').trim()));
  if (!s) return { missing: true };
  let box = s; for (let k = 0; k < 4; k++) box = box.parentElement;
  return { vt: s.getAttribute('aria-valuetext'), label: s.getAttribute('aria-label') || s.labels?.[0]?.innerText, near: box.innerText.replace(/\s+/g, ' ').slice(0, 400) };
});
console.log('FRAME', JSON.stringify(fr));
const words = /\b(female|male|woman|man|men|women|feminine|masculine|girl|boy|neutral)\b/i;
const vts = [];
const sl = page.locator('input[type=range]').filter({ has: page.locator('xpath=.') });
const frameEl = page.getByRole('slider', { name: 'frame', exact: true }).first();
if (await frameEl.count()) { await frameEl.focus(); await page.keyboard.press('Home'); vts.push(await frameEl.getAttribute('aria-valuetext')); for (let k = 0; k < 20; k++) { await page.keyboard.press('ArrowRight'); vts.push(await frameEl.getAttribute('aria-valuetext')); } }
console.log('VTs', [...new Set(vts)].join(' | '), 'SEXWORD?', vts.some(v => words.test(v || '')), fr.near && words.test(fr.near));
await shot(page, `x-frame-${tag}`);
// visceral
await page.getByRole('radio', { name: 'visceral', exact: true }).first().click(); await page.waitForTimeout(1500);
const v = await page.evaluate(() => { const f = [...document.querySelectorAll('[role=img]')].map(e => e.getAttribute('aria-label')).filter(x => /slice|visceral/i.test(x || '')); const fig = document.querySelector('main').innerText.match(/visceral fat[\s\S]{0,700}/i)?.[0]; return { f, fig }; });
console.log('VISCERAL', JSON.stringify(v, null, 1));
await shot(page, `x-visc-${tag}`);
console.log('ERRORS', errors);
await browser.close();
