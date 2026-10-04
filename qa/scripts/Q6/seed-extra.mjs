// Layers on the Q6 "full" profile: pantry items (vegetables, dairy, a typed item) and supplements with dose rows
// (creatine taking 5 g, vitamin D3 taking, psyllium "have it"). Checks pantry.get and supplements.get.
import { openProfile, go, read, sleep, btn, dump } from './lib.mjs';
const { page, errors, close } = await openProfile('full', { keep: true });
const step = process.argv[2] || 'all';
if (step === 'all' || step === 'pantry') {
  await go(page, '/food/pantry', { wait: 2000 });
  for (const g of [/^vegetables/, /^dairy and cheese/]) {
    await page.getByRole('button', { name: g }).click(); await sleep(600);
    const chips = page.locator('main [role=checkbox][aria-checked=false]:visible, main button[aria-pressed=false]:visible').filter({ hasNotText: /^(Add|Paste)/ });
    for (let i = 0; i < 4; i++) { await chips.nth(i).click().catch(() => {}); await sleep(300); }
  }
  await page.getByPlaceholder(/leftover dal/).fill('leftover dal'); await btn(page, 'Add').click(); await sleep(1500);
  console.log('pantry items', (await read(page, 'pantry.get', {})).items.length);
}
if (step === 'all' || step === 'supps') {
  await go(page, '/settings/supplements', { wait: 2000 });
  const sec = page.locator('section:has(h2:text-is("Supplements"))');
  // idempotent: add only missing rows, then set dose and time on the rows by name
  const want = [['Creatine monohydrate', 'creatine_monohydrate', '5', 'morning'], ['Vitamin D3', 'vitamin_d3', '1000', 'morning'], ['Psyllium husk', 'psyllium', null, null]];
  const have = new Set((await read(page, 'supplements.get', {})).rows.map((r) => r.supplementId));
  for (const [n, id] of want) if (![...have].some((h) => h?.startsWith(id.split('_')[0]))) { await sec.getByRole('button', { name: n, exact: true }).click(); await sleep(900); }
  await sleep(800);
  for (const [n, , dose, time] of want) {
    const r = sec.locator('.lm-supprow').filter({ hasText: n }).first();
    if (!dose) { await r.getByRole('radio', { name: /have it/ }).or(r.getByRole('button', { name: /have it/ })).first().click().catch((e) => console.log(n, e.message.split('\n')[0])); await sleep(600); continue; }
    await r.locator('input').first().fill(dose); await page.keyboard.press('Tab'); await sleep(400);
    const t = r.getByRole('button', { name: new RegExp(`in the ${time}$`, 'i') }).or(r.getByRole('button', { name: time, exact: true })).first();
    if ((await t.getAttribute('aria-pressed')) !== 'true') await t.click();
    await sleep(600);
  }
  await sleep(1500);
  await dump(page, 'supps');
  console.log((await sec.innerText()).split('Your supplements')[1]?.slice(0, 800));
  console.log(JSON.stringify(await read(page, 'supplements.get', {})).slice(0, 900));
}
await sleep(4000); // let the debounced document write reach IndexedDB before closing
console.log('ERRORS', errors);
await close();
// verify in a fresh copy that the layers persisted
const v = await openProfile('verify', { from: 'full' });
await go(v.page, '/food', { wait: 2000 });
console.log('persisted: pantry', (await read(v.page, 'pantry.get', {})).items.length, 'supplement rows', (await read(v.page, 'supplements.get', {})).rows.length);
await v.close();
