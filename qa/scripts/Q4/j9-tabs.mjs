// J9: the Coach from the Food and Train tabs (tab-local prompts) and quiet mode.
// Food › I ate something else › "Tell the Coach instead" should carry the meal (slot) and what was typed;
// Train › Swap › "Ask the Coach for options" sends "Options to swap <exercise> today?".
// Quiet mode: turned on in Settings › Appearance; the Coach page says so.
import fs from 'node:fs';
import { openProfile, go, read, sleep, results, providerLog, ROOT, coachLog } from './lib.mjs';

const LOG = `${ROOT}/.e6-tmp/q4-J9.jsonl`;
const userTexts = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).request.messages.at(-1)).filter((m) => m.role === 'user').map((m) => String(m.content)) : []);

export async function run({ vp = 'mobile' } = {}) {
  const { check, save } = results(`J9-tabs-${vp}`);
  fs.rmSync(LOG, { force: true });
  await providerLog(LOG);
  const { ctx, page, errors } = await openProfile(`j9-${vp}`, { from: 'seed-living', vp });
  try {
    await go(page, '/food');
    await page.getByRole('button', { name: 'I ate something else: lunch' }).click();
    await sleep(1200);
    await page.locator('input[type=search]').last().fill('poha and chai');
    await page.getByRole('button', { name: /Tell the Coach instead/ }).click();
    await sleep(6000);
    check('Food: "Tell the Coach instead" opens the Coach', /\/coach/.test(page.url()), page.url());
    // the typed text is prefilled in the composer (Q4-10); sending it carries the slot in the message's context
    const composer = await page.getByLabel('Message to the Coach').first().inputValue();
    if (/poha/i.test(composer)) {
      await page.getByRole('button', { name: 'Send', exact: true }).first().click();
      await sleep(6000);
    }
    const sent = userTexts().find((t) => /poha/i.test(t));
    check('Food: what was typed reaches the Coach (sent or in the composer)', !!sent || /poha/i.test(composer), `composer "${composer}"`);
    check('Food: the meal slot (lunch) travels with it', /lunch/i.test(sent ?? composer) || /lunch/i.test(await coachLog(page)), (sent ?? composer).slice(0, 120));
    await go(page, '/train');
    // the seeded plan has rest days: on one, move the page clock to the next training day (Q7; J9 failed on Sat 3 Oct)
    for (let k = 1; k <= 7 && !(await page.getByRole('button', { name: /^Swap / }).count()); k++) {
      await page.clock.setSystemTime(new Date(Date.now() + k * 86_400_000));
      await go(page, '/train');
      await sleep(1500);
    }
    const swap = page.getByRole('button', { name: /^Swap / }).first();
    const exercise = ((await swap.getAttribute('aria-label')) ?? (await swap.innerText())).replace(/^Swap /, '');
    await swap.click();
    await sleep(1200);
    await page.getByRole('button', { name: /Ask the Coach/ }).or(page.getByRole('link', { name: /Ask the Coach/ })).first().click();
    await sleep(8000);
    const t = userTexts().find((x) => /Options to swap/i.test(x));
    check('Train: "Ask the Coach for options" sends the swap question', !!t && t.toLowerCase().includes(exercise.toLowerCase()), t ?? 'not sent');
    check('Train: the Coach answers it (looks at today)', /options for today/i.test(await coachLog(page)));
    // quiet mode (Q4-17): Settings › Appearance › quiet mode, then the Coach says it is on
    await go(page, '/settings#appearance');
    await page.getByRole('switch', { name: 'quiet mode' }).first().click({ force: true }); // the switch's track covers the input
    await sleep(1500);
    const today = await read(page, 'today.get', {});
    await go(page, '/coach');
    await sleep(1500);
    const coachText = await page.locator('main').innerText();
    check('quiet mode can be turned on (to test the Coach in it)', today.quietMode === true && /Quiet mode is on/.test(coachText), `today.quietMode ${today.quietMode}`);
  } catch (e) { check('journey ran to the end', false, e.message.split('\n')[0]); }
  check('no console or page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await ctx.close();
  return save();
}
if (process.argv[1]?.endsWith('j9-tabs.mjs')) { const rows = await run({ vp: process.argv[2] || 'mobile' }); console.table(rows.map((r) => ({ name: r.name, ok: r.ok }))); }
