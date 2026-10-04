// J2 Body: 3D figure (WebGL context on the canvas), fallback without WebGL, visceral view, Maintenance panel inline
// questions (no sheet), no "Correct it" / "add measurement" control at three viewports.
import { fresh, seed, read, go, closeAll, results, scanForbidden, mainText, shot } from './lib.mjs';
const R = results('J2');
const { check } = R;
const GLSPY = () => {
  window.__gl = [];
  const g = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, ...a) { const r = g.call(this, t, ...a); window.__gl.push({ t, ok: !!r, cls: this.className }); return r; };
};
const NOGL = () => {
  window.__gl = [];
  const g = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, ...a) { if (/webgl/.test(t)) { window.__gl.push({ t, ok: false }); return null; } return g.call(this, t, ...a); };
};
const allErrors = [];

// ---- 1. WebGL path (desktop)
{
  const { ctx, page, errors } = await fresh('desktop');
  await seed(page);
  await ctx.addInitScript(GLSPY);
  await go(page, '/body');
  await page.waitForTimeout(4000);
  const gl = await page.evaluate(() => window.__gl);
  check('a WebGL context is created on the figure canvas', gl.some((c) => /webgl/.test(c.t) && c.ok && /fig3d/.test(c.cls)), JSON.stringify(gl));
  const canv = await page.evaluate(() => [...document.querySelectorAll('canvas')].map((c) => c.getBoundingClientRect().width));
  check('the figure canvas is visible', canv.some((w) => w > 100), canv.join());
  await shot(page, 'J2', 'body-gl');
  // visceral view
  await page.getByRole('radio', { name: 'visceral', exact: true }).first().click();
  await page.waitForTimeout(1500);
  const vis = await page.evaluate(() => ({ labels: [...document.querySelectorAll('[role=img]')].map((e) => e.getAttribute('aria-label') || '').filter((x) => /visceral|slice/i.test(x)), txt: document.querySelector('main').innerText.match(/visceral fat[\s\S]{0,300}/i)?.[0] ?? '' }));
  check('visceral view shows a visceral description', vis.labels.length > 0 || /visceral/i.test(vis.txt), JSON.stringify(vis).slice(0, 150));
  await shot(page, 'J2', 'visceral');
  await page.getByRole('radio', { name: 'figure', exact: true }).first().click();
  await page.waitForTimeout(800);
  check('toggle back to figure ok', (await page.getByRole('radio', { name: 'figure', exact: true }).first().getAttribute('aria-checked')) === 'true');

  // ---- Maintenance panel: inline questions
  const sec = page.locator('section:has(h2:text-is("Maintenance"))').first();
  const url0 = page.url();
  check('Maintenance panel has an inline "Answer it" button', await sec.getByRole('button', { name: 'Answer it' }).count() === 1);
  const dialogs0 = await page.locator('[role=dialog]:visible').count();
  await sec.getByRole('button', { name: 'Answer it' }).click();
  await page.waitForTimeout(700);
  check('the question appears inside the panel (no dialog/sheet)', (await sec.innerText()).includes('Measured before?') && await page.locator('[role=dialog]:visible').count() === dialogs0);
  check('route unchanged by opening the question', page.url() === url0, page.url());
  await sec.getByRole('button', { name: /yes, my resting energy/ }).click();
  await page.waitForTimeout(800);
  let it = JSON.stringify(await read(page, 'intake.get'));
  check('answer "yes, resting energy" lands in intake.get', /measured[A-Za-z.]*"?:"?[^,]*resting|"measured[^"]*":"?yes/i.test(it) || /resting energy|"rmr"/i.test(it), it.match(/.{60}measured.{80}/i)?.[0] ?? 'no match');
  check('follow-up question (figure) shows inline', /What was your measured figure/.test(await sec.innerText()));
  await sec.locator('input[type=text]').first().fill('1950');
  await sec.getByText('breath test with a mask or hood', { exact: true }).click();
  await sec.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(1500);
  it = JSON.stringify(await read(page, 'intake.get'));
  const prof = JSON.stringify(await read(page, 'profile.get'));
  check('measured figure 1950 lands in intake.get/profile.get', /1950/.test(it) || /1950/.test(prof), (it.match(/.{40}1950.{40}/) ?? [])[0] ?? '');
  const ev = await page.evaluate(() => window.__vitals.events().filter((e) => e.type === 'committed').map((e) => e.commandId));
  check('the answers went through the command bus', ev.some((c) => /^intake\./.test(c) || /profile\./.test(c)), [...new Set(ev)].join(','));
  const txt = await mainText(page);
  check('no forbidden text on Body', scanForbidden(txt).length === 0, scanForbidden(txt).join(' ; '));
  await shot(page, 'J2', 'maintenance-answered');
  check('no uncaught errors (WebGL path)', errors.length === 0, errors.join(' || '));
  allErrors.push(...errors);
  await ctx.close();
}

// ---- 2. No-WebGL fallback
{
  const { ctx, page, errors } = await fresh('desktop');
  await seed(page);
  await ctx.addInitScript(NOGL);
  await go(page, '/body');
  await page.waitForTimeout(4000);
  const gl = await page.evaluate(() => window.__gl);
  check('WebGL is refused for the fallback run', gl.length === 0 || gl.every((c) => !c.ok), JSON.stringify(gl));
  const fb = await page.evaluate(() => ({
    h1: document.querySelector('h1')?.innerText,
    fig3d: document.querySelectorAll('.lm-fig3d__canvas').length,
    svg: [...document.querySelectorAll('main svg')].filter((s) => s.getBoundingClientRect().width > 50).length,
    imgs: [...document.querySelectorAll('[role=img]')].filter((s) => s.getBoundingClientRect().width > 50).map((e) => (e.getAttribute('aria-label') || '').slice(0, 60)),
  }));
  check('Body still renders without WebGL', fb.h1 === 'Your body', JSON.stringify(fb));
  check('a 2D / static figure is shown instead of a blank', fb.svg > 0 || fb.imgs.length > 0, JSON.stringify(fb));
  await shot(page, 'J2', 'body-nogl');
  const t = await mainText(page);
  check('fallback does not show an error screen', !/something went wrong|error/i.test(t.slice(0, 400)));
  check('no uncaught errors (fallback)', errors.length === 0, errors.join(' || '));
  allErrors.push(...errors);
  await ctx.close();
}

// ---- 3. No "Correct it" / "add measurement" control at three viewports
for (const vp of ['desktop', 'tablet', 'mobile']) {
  const { ctx, page, errors } = await fresh(vp);
  await seed(page);
  await go(page, '/body');
  await page.waitForTimeout(2500);
  const bad = await page.evaluate(() => [...document.querySelectorAll('button,a,[role=button],[role=link],[role=tab],[role=menuitem]')]
    .map((e) => (e.getAttribute('aria-label') || e.innerText || '').trim()).filter((n) => /correct it|add measurement/i.test(n)));
  check(`${vp}: no "Correct it"/"add measurement" control on Body`, bad.length === 0, bad.join('|'));
  const txtAll = await page.evaluate(() => document.body.innerText);
  check(`${vp}: no such text on Body`, !/\bcorrect it\b(?! —)|add measurement/i.test(txtAll.replace(/correct it — usually/g, '')), (txtAll.match(/.{20}(correct it|add measurement).{20}/i) ?? [])[0]);
  check(`${vp}: no dialog/sheet open on Body`, await page.locator('[role=dialog]:visible').count() === 0);
  check(`${vp}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  check(`${vp}: no forbidden text`, scanForbidden(await mainText(page)).length === 0);
  if (vp !== 'desktop') await shot(page, 'J2', `body-${vp}`);
  check(`${vp}: no uncaught errors`, errors.length === 0, errors.join(' || '));
  await ctx.close();
}
R.save();
await closeAll();
const bad = R.rows.filter((r) => !r.ok);
console.log(`J2: ${R.rows.length - bad.length}/${R.rows.length} passed`);
process.exit(bad.length ? 1 : 0);
