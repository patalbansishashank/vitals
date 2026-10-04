// J4 layout spot-check: one request (af: all four levels on the quick search) at tablet 768x1024 and mobile 390x844 —
// cards or chips for every level, same-scale bars, no gap, no horizontal overflow (plan 02 item 10 "verify at 390/768/1440").
import { fresh, seed, closeAll, results, shot, sleep } from './lib.mjs';
import { REQUESTS, applyRequest, runTier, assertLadder } from './j4-lib.mjs';
const R = results('J4-layout');
const key = process.env.KEY || 'af';
for (const vp of (process.env.VPS || 'tablet,mobile').split(',')) {
  const { ctx, page, errors } = await fresh(vp);
  try {
    await seed(page);
    await applyRequest(page, REQUESTS.find((r) => r.k === key));
    const s = await runTier(page, 'S');
    const cell = await assertLadder(page, R.check, `${vp}/${key}/S`, s.summary, { tier: 'S', deep: false });
    console.log(vp, JSON.stringify(cell));
    // the mobile rail scrolls sideways inside the ladder only: every card is reachable
    const rail = await page.evaluate(() => { const g = document.querySelector('.lp-ladder'); return g ? { sw: g.scrollWidth, cw: g.clientWidth, ox: getComputedStyle(g).overflowX } : null; });
    R.check(`${vp}: rail scrolls only inside the ladder`, !!rail && (rail.sw <= rail.cw + 2 || /auto|scroll/.test(rail.ox)), JSON.stringify(rail));
    const btn = page.locator('article[data-rung] .lp-rowbtn').first();
    if (await btn.count()) {
      await btn.scrollIntoViewIfNeeded(); await btn.click(); await sleep(1000);
      R.check(`${vp}: Explain opens`, (await page.locator('dialog[open], [role=dialog]:visible, aside.lm-sidepanel:visible').count()) > 0);
      await page.keyboard.press('Escape'); await sleep(400);
    }
    await page.locator('.lp-ladder').first().scrollIntoViewIfNeeded().catch(() => {});
    await shot(page, 'J4', `${vp}-${key}-ladder`);
  } catch (err) { R.check(`${vp}: journey ran`, false, err.message.slice(0, 180)); }
  R.check(`${vp}: no console/page errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}
const rows = R.save(); await closeAll();
const fail = rows.filter((r) => !r.ok);
console.log(`J4 layout: ${rows.length - fail.length} pass / ${fail.length} fail`); for (const f of fail) console.log(`FAIL ${f.name} — ${f.detail}`);
process.exit(fail.length ? 1 : 0);
