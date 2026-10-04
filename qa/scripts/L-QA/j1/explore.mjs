// J1 exploration without Bluetooth: first run, routes, Settings › Devices; texts and screenshots to private/j1.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch, close, go, shot, text, secretFields, priv, stamp } from './lib.mjs';

const out = [];
const log = (s) => {
  out.push(s);
  console.log(s);
};
const { app, page, consoleLines } = await launch('explore');
try {
  log(`${stamp()} url ${page.url()}`);
  log(`bridge bluetooth=${await page.evaluate(() => typeof window.vitalsDesktop?.bluetooth)} webBluetooth=${await page.evaluate(() => typeof navigator.bluetooth)}`);
  await page.waitForTimeout(2000);
  log(`first-run url ${page.url()}`);
  log(`first-run shot ${await shot(page, 'explore-00-first-run.png')}`);
  log(`--- first-run text\n${await text(page)}`);
  for (const r of (process.env.J1_ROUTES || '/ring,/signals,/settings,/settings/devices').split(',')) {
    await go(page, r);
    log(`--- ${r} -> ${page.url()}`);
    log(`shot ${await shot(page, `explore-${r.replace(/\W+/g, '_')}.png`)}`);
    log(await text(page));
    log(`secret fields: ${JSON.stringify(await secretFields(page))}`);
    log(`buttons: ${JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('main button, main a')].map((b) => b.innerText.trim()).filter(Boolean).slice(0, 60)))}`);
  }
} catch (e) {
  log(`FAIL ${e.message.split('\n')[0]}`);
} finally {
  await close(app);
  writeFileSync(path.join(priv, 'explore.log'), `${out.join('\n')}\n--- console\n${consoleLines.join('\n')}\n`);
}
