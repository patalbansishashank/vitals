// usage: node qa/scripts/liv/walk.mjs steps.json [mobile] [profile]
import { open, dump, BASE, shot, text } from './lib.mjs';
import fs from 'node:fs';
const steps = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const mobile = process.argv[3] === 'mobile';
const profile = process.argv[4] || null;
const { browser, page, errors } = await open({ mobile, profile });
if (process.env.CLOCK) await page.clock.install({ time: new Date(process.env.CLOCK) });
for (const s of steps) {
  try {
    if (s.goto) await page.goto(BASE + s.goto, { waitUntil: 'networkidle' });
    if (s.click) { const loc = s.role ? page.getByRole(s.role, { name: s.click, exact: s.exact !== false }) : page.locator('button,[role=button],[role=radio],[role=tab],a,[role=menuitem],[role=checkbox],[role=switch]').filter({ hasText: s.exact === false ? s.click : new RegExp('^\\s*' + s.click.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i') }); await loc.nth(s.nth || 0).click(); }
    if (s.clickAll) { const loc = page.locator('button,[role=radio]').filter({ hasText: new RegExp('^\\s*' + s.clickAll + '\\s*$') }); const n = await loc.count(); for (let i = 0; i < n; i++) { await loc.nth(i).click(); await page.waitForTimeout(150); } }
    if (s.text) await page.getByText(s.text, { exact: !!s.exactText }).nth(s.nth || 0).click();
    if (s.css) await page.locator(s.css).nth(s.nth || 0).click();
    if (s.fill) await page.getByLabel(s.fill, { exact: !!s.exact }).nth(s.nth || 0).fill(String(s.value));
    if (s.fillCss) await page.locator(s.fillCss).nth(s.nth || 0).fill(String(s.value));
    if (s.check) await page.getByRole(s.role || 'checkbox', { name: s.check, exact: !!s.exact }).first().check();
    if (s.typeCss) { const l = page.locator(s.typeCss).nth(s.nth || 0); await l.click(); await page.keyboard.press("Control+a"); await page.keyboard.type(String(s.value), { delay: 40 }); await page.keyboard.press(s.after || "Enter"); }
    if (s.key) await page.keyboard.press(s.key);
    if (s.upload) await page.locator('input[type=file]').nth(s.nth || 0).setInputFiles(s.upload);
    if (s.eval) console.log('EVAL>>', JSON.stringify(await page.evaluate(s.eval)).slice(0, 3000));
    if (s.waitText) await page.getByText(s.waitText, { exact: false }).first().waitFor({ timeout: s.timeout || 60000 });
    await page.waitForTimeout(s.wait ?? 600);
    if (s.dump) await dump(page, JSON.stringify(s).slice(0, 120));
    if (s.textDump) console.log('TEXT>>', await text(page, s.textDump));
    if (s.shot) await shot(page, s.shot, !!s.full);
  } catch (e) { console.log('STEP FAIL', JSON.stringify(s), e.message.split('\n')[0]); await dump(page, 'at-fail'); if (!s.soft) break; }
}
console.log('ERRORS', errors);
await browser.close();
