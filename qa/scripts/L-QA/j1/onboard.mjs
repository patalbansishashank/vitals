// Gets a fresh profile past the first-run questions by skipping each one (no health data entered).
// Exported for journey.mjs; run alone it explores and logs each step to private/j1/onboard.log.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch, close, shot, priv } from './lib.mjs';

const ADVANCE = [/^skip/i, /^next/i, /^continue/i, /^get started/i, /^done/i, /^finish/i, /^start/i, /^not now/i, /^later/i, /^use these/i, /^see (my|the) /i, /^go to/i, /^i agree/i, /^agree/i, /^accept/i, /^confirm/i, /^i understand/i, /^ok$/i, /^save/i];

export async function onboard(page, log = () => {}, shots = false) {
  await page.waitForTimeout(1500);
  for (let i = 0; i < 40; i++) {
    const url = new URL(page.url()).pathname;
    if (!/welcome|onboarding/.test(url)) return { ok: true, steps: i, url };
    const buttons = await page.evaluate(() =>
      [...document.querySelectorAll('button, a[href]')]
        .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !b.disabled && b.getAttribute('aria-disabled') !== 'true'; })
        .map((b) => b.innerText.trim().split('\n')[0])
        .filter(Boolean),
    );
    log(`step ${i} ${url} buttons=${JSON.stringify(buttons.slice(0, 30))}`);
    if (shots) await shot(page, `onboard-${String(i).padStart(2, '0')}.png`);
    // safety screening: adult age band, "no" to every screening question, tick consent boxes (no health data)
    if (buttons.includes('18–64')) await page.locator('button').filter({ hasText: /^\s*18–64\s*$/ }).first().click().catch((e) => log(`  age: ${e.message.split('\n')[0]}`));
    const noBtn = page.locator('button').filter({ hasText: /^\s*no\s*$/ });
    let noCount = 0;
    for (let round = 0; round < 8; round++) {
      const n = await noBtn.count();
      if (!n) break;
      noCount += n;
      for (let k = 0; k < n; k++) {
        const b = noBtn.nth(k);
        if ((await b.getAttribute('aria-pressed').catch(() => null)) === 'true' || (await b.getAttribute('aria-checked').catch(() => null)) === 'true') continue;
        await b.click({ timeout: 3000 }).catch((e) => log(`  no ${k}: ${e.message.split('\n')[0]}`));
        await page.waitForTimeout(150);
      }
      const left = await page.evaluate(() => /question(s)? left/.test(document.body.innerText));
      if (!left) break;
    }
    const boxes = page.locator('input[type=checkbox]:not(:checked)');
    const nBoxes = await boxes.count();
    for (let k = nBoxes; k > 0; k--) await boxes.first().check({ force: true }).catch((e) => log(`  box: ${e.message.split('\n')[0]}`));
    if (nBoxes) log(`  ticked ${nBoxes} box(es): ${JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('input[type=checkbox]')].map((b) => (b.labels?.[0]?.innerText ?? '').slice(0, 40))))}`);
    if (noCount || nBoxes || buttons.includes('18–64')) {
      await page.waitForTimeout(500);
      buttons.splice(0, buttons.length, ...(await page.evaluate(() => [...document.querySelectorAll('button, a[href]')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !b.disabled && b.getAttribute('aria-disabled') !== 'true'; }).map((b) => b.innerText.trim().split('\n')[0]).filter(Boolean))));
      log(`  after answers buttons=${JSON.stringify(buttons.filter((b) => !/^(no|yes|prefer not to say)$/.test(b)).slice(0, 30))}`);
    }
    let label = null;
    for (const re of ADVANCE) {
      label = buttons.find((b) => re.test(b));
      if (label) break;
    }
    if (!label) return { ok: false, steps: i, url, reason: 'no advance button' };
    log(`  click "${label}"`);
    await page.getByRole('button', { name: label, exact: true }).or(page.getByRole('link', { name: label, exact: true })).first().click({ timeout: 10_000 });
    await page.waitForTimeout(1200);
  }
  return { ok: false, url: page.url(), reason: 'too many steps' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const lines = [];
  const log = (s) => {
    lines.push(s);
    console.log(s);
  };
  const { app, page } = await launch('onboard');
  try {
    log(JSON.stringify(await onboard(page, log, true)));
  } catch (e) {
    log(`FAIL ${e.message.split('\n')[0]}`);
  } finally {
    await close(app);
    writeFileSync(path.join(priv, 'onboard.log'), `${lines.join('\n')}\n`);
  }
}
