import { open, controls, BASE, text } from './lib.mjs';
// usage: node explore.mjs [m] 'step1' 'step2' ... ; step = "click:Name" | "goto:/path" | "fill:Label=val" | "wait:ms" | "eval:js"
const args = process.argv.slice(2); const mobile = args[0] === 'm'; if (mobile) args.shift();
const { browser, page, errors } = await open(mobile);
import { firstRun } from './lib.mjs'; if (process.env.FR) await firstRun(page); else { await page.goto(BASE + '/welcome'); await page.waitForTimeout(2000); }
for (const s of args) {
  const [k, ...r] = s.split(':'); const v = r.join(':');
  if (k === 'click') await page.getByRole('button', { name: v, exact: false }).first().click();
  else if (k === 'clickt') await page.getByText(v, { exact: false }).first().click();
  else if (k === 'link') await page.getByRole('link', { name: v }).first().click();
  else if (k === 'goto') await page.goto(BASE + v);
  else if (k === 'fill') { const [l, val] = v.split('='); await page.getByLabel(l).first().fill(val); }
  else if (k === 'check') await page.getByLabel(v).first().check();
  else if (k === 'screen') { await page.getByRole('radio', { name: '18–64' }).click(); const nos = page.getByRole('radio', { name: 'no', exact: true }); for (let i = 0; i < await nos.count(); i++) await nos.nth(i).click(); }
  else if (k === 'wait') await page.waitForTimeout(+v);
  await page.waitForTimeout(800);
}
console.log('URL', page.url()); console.log((await text(page)).slice(0, +process.env.N || 2500)); console.log('---'); console.log((await controls(page)).join('\n'));
console.log(errors); await browser.close();
