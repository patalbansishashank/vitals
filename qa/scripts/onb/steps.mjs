import { dump, BASE, shot } from './lib.mjs';
export async function run(page, steps) {
for (const s of steps) {
  try {
    if (s.click) { const o = { name: s.click, exact: s.exact !== false }; const loc = s.role ? page.getByRole(s.role, o) : page.getByRole('button', o).or(page.getByRole('radio', o)).or(page.getByRole('checkbox', o)).or(page.getByRole('link', o)).or(page.getByRole('switch', o)); await loc.nth(s.nth || 0).click(); }
    if (s.text) await page.getByText(s.text, { exact: !!s.exactText }).first().click();
    if (s.css) await page.locator(s.css).nth(s.nth || 0).click();
    if (s.fill) { const o={ name: s.fill, exact: !!s.exact }; await page.getByRole('textbox', o).or(page.getByRole('spinbutton', o)).first().fill(String(s.value)); }
    if (s.check) await page.getByRole('checkbox', { name: s.check, exact: !!s.exact }).first().check();
    if (s.allNo) { for (let i = 0; i < 40; i++) { const g = page.locator('[role=radiogroup]:not(:has([aria-checked=true]))').first(); if (!(await g.count())) break; const r = g.getByRole('radio', { name: /^(no|18–64)$/ }); if (await r.count()) await r.first().click(); else await g.getByRole('radio').first().click(); await page.waitForTimeout(150); } }
    if (s.type) { const o={ name: s.type, exact: !!s.exact }; const el = page.getByRole('textbox', o).or(page.getByRole('spinbutton', o)).first(); await el.click(); await page.keyboard.press('Control+a'); await page.keyboard.type(String(s.value), { delay: 30 }); await page.keyboard.press('Tab'); }
    if (s.key) await page.keyboard.press(s.key);
    if (s.goto) await page.goto(BASE + s.goto, { waitUntil: 'networkidle' });
    await page.waitForTimeout(s.wait ?? 500);
    if (s.dump) await dump(page, JSON.stringify(s));
    if (s.textDump) console.log('TEXT>>', (await page.evaluate(() => document.querySelector('main')?.innerText || document.body.innerText)).slice(0, s.textDump));
    if (s.shot) await shot(page, s.shot);
  } catch (e) { console.log('STEP FAIL', JSON.stringify(s), e.message.split('\n')[0]); await dump(page, 'at-fail'); break; }
}
}
