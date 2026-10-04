// replay base steps, then auto-answer remaining intake questions, logging each
import { open, dump, BASE, shot } from './lib.mjs';
import { run } from './steps.mjs';
import fs from 'node:fs';
const steps = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const mode = process.argv[3] || 'default'; // default | later
const mobile = process.argv[4] === 'mobile';
const { browser, page, errors } = await open({ mobile });
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await run(page, steps);
const prefs = JSON.parse(process.env.PREFS || '{}'); // legend substring -> button name
for (let i = 0; i < 90; i++) {
  const url = page.url();
  if (!/onboarding/.test(url)) { console.log('LEFT onboarding ->', url); break; }
  const st = await page.evaluate(() => {
    const fs = [...document.querySelectorAll('main fieldset')].filter(f => f.getBoundingClientRect().height > 0);
    const f = fs[fs.length - 1];
    const lg = f?.querySelector('legend')?.innerText.replace(/\s+/g, ' ').trim();
    const btns = f ? [...f.querySelectorAll('button,input,[role=checkbox]')].map(b => (b.getAttribute('aria-label') || b.innerText || b.type).replace(/\s+/g, ' ').trim() + (b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-checked') === 'true' || b.checked ? '*' : '')) : [];
    const h2 = [...document.querySelectorAll('main h2')].map(h => h.innerText).join('|');
    return { lg, btns, h2 };
  });
  console.log(`Q${i} [${new URL(url).pathname}] ${st.lg} :: ${st.btns.join(' / ')}`);
  let pick = null;
  for (const [k, v] of Object.entries(prefs)) if (st.lg && st.lg.includes(k)) pick = v;
  const main = page.locator('main');
  try {
    if (pick) { for (const p of [].concat(pick)) { await main.getByRole('button', { name: p, exact: false }).or(main.getByRole('checkbox', { name: p, exact: false })).first().click(); await page.waitForTimeout(250); } }
    else if (mode === 'later' && st.btns.includes('ask me later')) { await main.getByRole('button', { name: 'ask me later' }).last().click(); }
    else if (st.btns.some(b => b.includes('(default)'))) { await main.getByRole('button', { name: /\(default\)/ }).last().click(); }
    else if (st.lg) { const opts = st.btns.filter(b => !/ask me later|why we ask|^Done|Decrease|Increase|Remove|Add one/.test(b)); await main.getByRole('button', { name: opts[0], exact: true }).last().click(); }
    await page.waitForTimeout(400);
    const done = main.getByRole('button', { name: /^Done/ });
    if (await done.count() && await done.last().isVisible() && await done.last().isEnabled()) { await done.last().click(); }
    // chapter end buttons
    for (const n of ['Looks right — continue', 'Continue', 'Next chapter']) { const b = main.getByRole('button', { name: n, exact: false }); if (!st.lg && await b.count()) { await b.first().click(); break; } }
  } catch (e) { console.log('ERR', e.message.split('\n')[0]); }
  await page.waitForTimeout(700);
  if (!st.lg) { console.log('NO LEGEND; h2=', st.h2); await dump(page, 'noLegend'); if (process.env.STOPNL) break; }
}
await shot(page, 'x-auto-end');
console.log(await page.evaluate(() => document.querySelector('main')?.innerText.slice(0, 2500)));
console.log('ERRORS', errors);
await browser.close();
