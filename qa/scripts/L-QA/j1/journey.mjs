// J1 UI journey on the packaged desktop app (a copy under .e6-tmp/j1): first run → /ring → /signals → Settings › Devices
// → "Connect" the J-Style ring → watch for a device list / chooser → (J1_EMULATE_PICK=1) pick the first listed ring through
// the shell bridge, the way a chooser would → watch the connect/sync job → /ring, /signals again.
// Run under the hardware locks (ring → phone → pc-ble) with the ring free. Writes only to private/j1 (git-ignored).
// Never logs device names or addresses (the ring's advertised name carries a retail brand), only counts.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch, close, go, shot, text, secretFields, priv, stamp } from './lib.mjs';
import { onboard } from './onboard.mjs';

const tag = process.env.J1_TAG || 'ui';
const lines = [];
const log = (s) => {
  const l = `${stamp()} ${s}`;
  lines.push(l);
  console.log(l);
};
const safeLabel = (s) => (/^Connect (J-Style [\w ]+|[A-Za-z0-9 ]{0,12}R0\d[\w /]*|Colmi[\w ]*)$/.test(s) ? s : `Connect <label withheld, ${s.length} chars>`);

async function devicesSectionText(page) {
  return page.evaluate(() => {
    const h = [...document.querySelectorAll('h1,h2,h3,[role=heading]')].find((e) => /^devices$/i.test(e.textContent.trim()));
    const sec = h?.closest('section') ?? h?.parentElement?.parentElement;
    return (sec?.innerText ?? '(no Devices section found)').replace(/\n{2,}/g, '\n').slice(0, 3000);
  });
}
async function visibleDialogs(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[role=dialog],[role=listbox],[role=alertdialog],dialog[open]')]
      .filter((e) => e.getBoundingClientRect().height > 0)
      .map((e) => e.innerText.replace(/\s+/g, ' ').slice(0, 200)),
  );
}
async function toasts(page) {
  return page.evaluate(() => [...document.querySelectorAll('[role=status],[role=alert],[aria-live]')].map((e) => e.innerText.trim()).filter(Boolean).slice(0, 10));
}

const t0 = Date.now();
const { app, page, consoleLines } = await launch(tag);
const result = { tag };
try {
  result.bridge = await page.evaluate(() => ({ bluetoothBridge: typeof window.vitalsDesktop?.bluetooth, webBluetooth: typeof navigator.bluetooth }));
  log(`bridge ${JSON.stringify(result.bridge)}`);
  result.onboard = await onboard(page, log);
  log(`onboard ${JSON.stringify(result.onboard)}`);

  for (const [route, name] of [['/ring', 'ring-before'], ['/signals', 'signals-before']]) {
    await go(page, route);
    result[name] = { url: new URL(page.url()).pathname, text: (await text(page)).slice(0, 600), secretFields: await secretFields(page), shot: await shot(page, `j1-${tag}-${name}.png`) };
    log(`${route}: ${JSON.stringify(result[name])}`);
  }

  await go(page, '/settings/devices');
  const devHeading = page.getByRole('heading', { name: /^devices$/i }).first();
  await devHeading.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  result.devicesBefore = await devicesSectionText(page);
  result.devicesSecretFields = await secretFields(page);
  log(`devices section:\n${result.devicesBefore}`);
  await page.screenshot({ path: path.join(priv, `j1-${tag}-devices-before.png`) }).catch(() => {});

  const connects = page.getByRole('button', { name: /^Connect /i });
  const labels = (await connects.allInnerTexts()).map((s) => s.trim());
  result.connectButtons = labels.map(safeLabel);
  log(`connect buttons ${JSON.stringify(result.connectButtons)}`);
  const idx = labels.findIndex((l) => /2301|j-?style/i.test(l));
  if (idx < 0) throw new Error('no Connect button for the J-Style ring');
  if (process.env.J1_DRY === '1') throw new Error('dry run: stopped before Connect (no Bluetooth used)');

  // observe the shell's device list (the app's own page does not subscribe in this build; we only count)
  await page.evaluate(() => {
    window.__j1 = { lists: 0, maxLen: 0, firstAt: 0, last: [] };
    window.vitalsDesktop?.bluetooth?.onDevices?.((list) => {
      const j = window.__j1;
      j.lists++;
      j.maxLen = Math.max(j.maxLen, list.length);
      if (!j.firstAt) j.firstAt = Date.now();
      j.last = list.map((d) => d.id);
    });
  });
  const tClick = Date.now();
  await connects.nth(idx).click();
  log('clicked Connect (J-Style ring)');
  const watchMs = Number(process.env.J1_WATCH_MS || 45_000);
  let firstListMs = null;
  while (Date.now() - tClick < watchMs) {
    await page.waitForTimeout(3000);
    const j = await page.evaluate(() => ({ lists: window.__j1.lists, maxLen: window.__j1.maxLen, firstAt: window.__j1.firstAt }));
    if (j.firstAt && firstListMs == null) firstListMs = j.firstAt - tClick;
    const dialogs = await visibleDialogs(page);
    log(`t+${Math.round((Date.now() - tClick) / 1000)}s device lists=${j.lists} maxLen=${j.maxLen} dialogs=${JSON.stringify(dialogs)} live=${JSON.stringify(await toasts(page))}`);
  }
  result.afterClick = {
    watchedS: Math.round(watchMs / 1000),
    firstDeviceListMs: firstListMs,
    ...(await page.evaluate(() => ({ lists: window.__j1.lists, maxLen: window.__j1.maxLen }))),
    dialogs: await visibleDialogs(page),
    live: await toasts(page),
    secretFields: await secretFields(page),
  };
  await page.screenshot({ path: path.join(priv, `j1-${tag}-after-connect-click.png`) }).catch(() => {});
  log(`after click ${JSON.stringify(result.afterClick)}`);

  if (process.env.J1_EMULATE_PICK === '1') {
    const id = await page.evaluate(() => window.__j1.last[0] ?? null);
    if (!id) {
      result.pick = 'no device listed to pick';
    } else {
      // what a chooser would do when the person taps the ring in the list (no name, no key typed)
      await page.evaluate((x) => window.vitalsDesktop.bluetooth.choose(x), id);
      const tPick = Date.now();
      log('picked the first listed ring through the shell bridge (emulated chooser)');
      const syncMs = Number(process.env.J1_SYNC_MS || 240_000);
      let lastDev = '';
      while (Date.now() - tPick < syncMs) {
        await page.waitForTimeout(5000);
        const dev = await devicesSectionText(page);
        const live = await toasts(page);
        if (dev !== lastDev) log(`t+${Math.round((Date.now() - tPick) / 1000)}s devices:\n${dev}`);
        lastDev = dev;
        log(`t+${Math.round((Date.now() - tPick) / 1000)}s live=${JSON.stringify(live)} secretFields=${JSON.stringify(await secretFields(page))}`);
        if (/imported|records|didn.t work|failed|error/i.test(live.join(' ')) && Date.now() - tPick > 20_000) break;
      }
      result.pick = { ms: Date.now() - tPick, devices: await devicesSectionText(page), live: await toasts(page) };
      await page.screenshot({ path: path.join(priv, `j1-${tag}-devices-after-sync.png`) }).catch(() => {});
    }
    log(`pick ${JSON.stringify(result.pick)}`);
    for (const [route, name] of [['/ring', 'ring-after'], ['/signals', 'signals-after'], ['/body', 'body-after']]) {
      await go(page, route);
      result[name] = { url: new URL(page.url()).pathname, text: (await text(page)).slice(0, 800), shot: await shot(page, `j1-${tag}-${name}.png`) };
      log(`${route}: ${JSON.stringify(result[name])}`);
    }
  }
} catch (e) {
  result.error = e.message.split('\n')[0];
  log(`FAIL ${result.error}`);
} finally {
  await close(app);
  result.totalS = Math.round((Date.now() - t0) / 1000);
  result.consoleErrors = consoleLines.filter((l) => / (error|pageerror|warning) /.test(l));
  writeFileSync(path.join(priv, `j1-${tag}.json`), JSON.stringify(result, null, 2));
  writeFileSync(path.join(priv, `j1-${tag}.log`), `${lines.join('\n')}\n--- console\n${consoleLines.join('\n')}\n`);
  log(`done in ${result.totalS}s (app closed)`);
}
