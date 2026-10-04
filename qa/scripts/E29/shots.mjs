// E29 screenshots: import the synthetic Lumen archive, then the ring views at 390/768/1440 in light and dark.
import { chromium } from 'playwright-core';
process.env.BASE ||= 'http://127.0.0.1:5277';
const { firstRun } = await import('../set/lib.mjs');
const BASE = process.env.BASE || 'http://127.0.0.1:5277';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const out = [];
for (const [w, scheme] of (process.env.ONLY ? [[1440, 'light']] : [[390, 'light'], [768, 'dark'], [1440, 'light'], [1440, 'dark']])) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme, timezoneId: 'Europe/Berlin' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await firstRun(page);
  await page.goto(BASE + '/progress', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  console.log('after first run', page.url(), (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 160));
  await page.goto(BASE + '/settings#devices', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.locator('section#devices input[type=file]').first().setInputFiles('src/biometrics/importers/__fixtures__/lumen-archive.json');
  let toast = '';
  for (let i = 0; i < 30 && !toast; i++) {
    await page.waitForTimeout(500);
    toast = (await page.evaluate(() => [...document.querySelectorAll('.lm-toast, [role=status]')].map((e) => e.innerText).filter((t) => /import|record|day|could|recogn/i.test(t)).join(' | '))) || '';
  }
  console.log(w, scheme, 'import:', toast.replace(/\s+/g, ' ').slice(0, 200));
  if (w === 1440 && scheme === 'light') {
    const card = page.locator('section#devices');
    console.log('devices text:', (await card.innerText()).replace(/\s+/g, ' ').slice(0, 400));
  }
  const tag = `${w}-${scheme}`;
  const views = [
    ['/progress#activity', '#activity', 'steps'],
    ['/progress#activity', '#activity-workouts', 'workouts'],
    ['/progress/sleep.tst', '.lv-ring-night', 'night'],
    ['/progress/hr.rhr_night', '.lv-ring-day', 'hr'],
    ['/progress/spo2.night', '.lv-ring-day', 'vitals'],
  ];
  for (const [path, sel, name] of views) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    let el = page.locator(sel).first();
    for (let k = 0; k < 3 && !(await el.count()); k++) { await page.waitForTimeout(3000); await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1500); el = page.locator(sel).first(); }
    if (!(await el.count())) { console.log(tag, name, 'MISSING', sel, (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 300)); continue; }
    await el.evaluate((n) => { n.scrollIntoView({ block: 'start' }); window.scrollBy(0, -80); });
    const target = name === 'night' || name === 'hr' || name === 'vitals' ? el.locator('xpath=ancestor::*[contains(@class,"lm-face") or self::section][1]') : el;
    const t = (await target.count()) ? target.first() : el;
    const file = `qa/screenshots/E29-${name}-${tag}.png`;
    await t.screenshot({ path: file });
    out.push(file);
    console.log(tag, name, (await t.innerText()).replace(/\s+/g, ' ').slice(0, 220));
  }
  if (errors.length) console.log('ERRORS', errors);
  await ctx.close();
}
await browser.close();
console.log(out.join('\n'));
