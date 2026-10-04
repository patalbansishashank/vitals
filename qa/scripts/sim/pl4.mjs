import { open } from './lib.mjs';
import { planSetup } from './plib.mjs';
const { browser, page, errors } = await open(false);
await planSetup(page, { goals: [/^Autophagy signal.*add as a goal/], longest: '24 h' });
await page.getByRole('radio', { name: '16 h', exact: true }).click(); await page.waitForTimeout(1500);
console.log('16h:', (await page.locator('main').innerText()).match(/Before you run[\s\S]{0,900}?(?=Practical limits)/)?.[0]?.replace(/\n+/g, ' / '));
console.log(errors); await browser.close();
