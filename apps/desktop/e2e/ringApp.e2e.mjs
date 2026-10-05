// The real ring through the packaged desktop app's own screens and the ring service: first run, Settings › Devices ›
// "Add a ring", one tap on the J-Style 2301 in the list (listed as "Ring": the desktop sees only the advertised name, so
// the family is found over GATT after the tap), the service connects (the built-in passcode, no prompt) and
// reads the history; the ring card then shows "Last read", the tray keeps the app awake while connected, and the
// readings are in the app (bio.sources, bio.series through the read-only QA hook). Then Disconnect and Connect again
// without a list. Counts and times only. Run under the hardware locks (ring, then phone, then pc-ble), ring free:
//   .jobs/hw-run.sh ring .jobs/hw-run.sh phone .jobs/hw-run.sh pc-ble node apps/desktop/e2e/ringApp.e2e.mjs
// Env: VITALS_E2E_APP (default release/linux-unpacked/vitals), VITALS_E2E_VERBOSE=1 prints the page console.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const root = path.resolve(appDir, '..', '..');
const APP = process.env.VITALS_E2E_APP || path.join(appDir, 'release', 'linux-unpacked', 'vitals');
const VERBOSE = process.env.VITALS_E2E_VERBOSE === '1';

mkdirSync(path.join(root, '.e6-tmp'), { recursive: true });
const home = mkdtempSync(path.join(root, '.e6-tmp', 'ring-app-e2e-'));
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local', 'share') };
for (const k of ['VITALS_SMOKE', 'ELECTRON_RUN_AS_NODE', 'DISPLAY']) delete env[k];
env.WAYLAND_DISPLAY ||= 'wayland-1';
env.XDG_RUNTIME_DIR ||= `/run/user/${process.getuid?.() ?? 1000}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const secs = (from) => `${((Date.now() - from) / 1000).toFixed(1)} s`;
let failures = 0;
async function step(name, fn) {
  const started = Date.now();
  try {
    const note = await fn();
    console.log(`PASS ${name}${note ? ` — ${note}` : ''} (${secs(started)})`);
    return true;
  } catch (e) {
    failures++;
    console.log(`FAIL ${name} — ${e instanceof Error ? e.message.split('\n')[0] : String(e)} (${secs(started)})`);
    return false;
  }
}
const today = new Date();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const weekAgo = new Date(today.getTime() - 14 * 86_400_000);

const app = await _electron.launch({ executablePath: APP, args: ['--ozone-platform=wayland'], env, timeout: 60_000 });
const mainLog = [];
app.process().stderr?.on('data', (d) => mainLog.push(...String(d).split('\n').filter((l) => /vitals:|bluetooth|ble/i.test(l)).map((l) => l.slice(0, 300))));
const page = await app.firstWindow({ timeout: 60_000 });
const consoleLog = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') consoleLog.push(`${m.type()}: ${m.text()}`.slice(0, 300));
  if (VERBOSE) console.error(`page:${m.type()}: ${m.text()}`);
});
const stateLines = () => page.locator('[aria-label="rings"] li [role=status]').allInnerTexts();
try {
  await page.waitForFunction(() => (document.querySelector('#root')?.childElementCount ?? 0) > 0, null, { timeout: 60_000 });
  await step('first run: the welcome questions and disclaimer lead into the app', async () => {
    await completeWelcome(page);
    return new URL(page.url()).pathname;
  });

  // the QA hook (read-only bus) comes with ?qa=1 on a fresh load
  await page.evaluate(() => void (window.location.href = 'app://vitals/settings/devices?qa=1'));
  await page.waitForLoadState('load');
  await page.waitForFunction(() => !!window.__vitals, null, { timeout: 30_000 });

  let pairedAt = 0;
  const card = () => page.locator('[aria-label="rings"] li:has(h3)').first();
  // a first Bluetooth connect can fail on Linux (BlueZ "le-connection-abort-by-local"); a person taps "Look again" and
  // the ring once more, so the check allows three taps and reports how many it took
  const added = await step('Add a ring: the list shows the J-Style ring and one tap connects it', async () => {
    const notes = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const start = page.getByRole('button', { name: attempt === 1 ? 'Add a ring' : 'Look again' });
      await start.click({ timeout: 30_000 });
      const list = page.locator('[aria-label="rings nearby"] button');
      // the desktop list looks for up to 3 minutes; this PC may hear the ring only a few times a minute
      const listed = Date.now();
      await list.first().waitFor({ timeout: 185_000 });
      const names = (await list.allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim());
      // a name-only row is "Ring" (no family guessed from a name); a J-Style label would come from a name filter
      const pick = list.filter({ hasText: /^(J-Style|Ring$)/i }).first();
      if (!(await pick.count())) throw new Error(`no J-Style or "Ring" row in the list (${names.length} rows: ${names.join(' | ')})`);
      notes.push(`listed after ${secs(listed)}`);
      const label = await pick.innerText();
      await pick.click();
      pairedAt = Date.now();
      // the tap either makes a ring card or brings the list back with "Look again" (the toast says it did not work)
      const outcome = await Promise.race([
        card().waitFor({ timeout: 120_000 }).then(() => 'card'),
        page.getByRole('button', { name: 'Look again' }).waitFor({ timeout: 120_000 }).then(() => 'again'),
      ]).catch(() => 'timeout');
      notes.push(`tap ${attempt}: ${outcome} after ${secs(pairedAt)}`);
      if (outcome === 'card') return `${names.length} ring(s) listed; tapped ${label.replace(/\s+/g, ' ')}; ${notes.join(', ')}`;
      if (outcome === 'timeout') break;
    }
    throw new Error(notes.join(', ') + (consoleLog.length ? `; ${consoleLog.at(-1)}` : ''));
  });

  if (added)
    await step('the service reads the history: the card says "Last read" with a battery level', async () => {
      const deadline = Date.now() + 240_000;
      let last = '';
      while (Date.now() < deadline) {
        last = (await page.locator('[aria-label="rings"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
        if (/Last read/.test(last) && !/Reading your ring/.test(last)) return `${secs(pairedAt)} after the tap: ${last.replace(/Heart rate now \d+ bpm/, 'live heart rate shown').slice(0, 200)}`;
        if (/didn’t work|That didn't work/.test(last)) throw new Error(last.slice(0, 200));
        await sleep(1000);
      }
      throw new Error(`still not read after 240 s: ${last.slice(0, 200)}`);
    });

  if (added)
    await step('the readings are in the app (bio.sources, bio.series heart rate)', async () => {
      const r = await page.evaluate(
        async ([from, to]) => {
          const src = await window.__vitals.read('bio.sources', {});
          const list = src.ok && src.output ? src.output.sources : [];
          const out = { sources: list.length, ring: list.filter((s) => /ring/i.test(JSON.stringify(s))).length, sharing: src.output?.ringSharing, series: {} };
          for (const metric of ['hr', 'hrv', 'spo2', 'skin_temp']) {
            const s = await window.__vitals.read('bio.series', { metric, from, to, resolution: 'raw' });
            out.series[metric] = s.ok && s.output ? `${s.output.points.length}${s.output.truncated ? '+' : ''}` : (s.error?.code ?? 'no output');
          }
          return out;
        },
        [iso(weekAgo), iso(today)],
      );
      if (!r.ring) throw new Error(`no ring source: ${JSON.stringify(r)}`);
      if (!(parseInt(r.series.hr, 10) > 0)) throw new Error(`no heart-rate readings: ${JSON.stringify(r.series)}`);
      return `${r.ring} ring source(s), ring sharing ${r.sharing}; raw samples over 14 days: ${Object.entries(r.series).map(([k, v]) => `${k} ${v}`).join(', ')}`;
    });

  if (added)
    await step('Disconnect, then Connect again without a list', async () => {
      await page.locator('[aria-label="rings"] li').first().getByRole('button', { name: 'Disconnect' }).click({ timeout: 30_000 });
      await page.locator('[aria-label="rings"] li').first().getByRole('button', { name: 'Connect', exact: true }).waitFor({ timeout: 30_000 });
      const started = Date.now();
      await page.locator('[aria-label="rings"] li').first().getByRole('button', { name: 'Connect', exact: true }).click();
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        const s = (await stateLines()).join(' | ');
        if (/^Connected|Reading your ring/.test(s) || /Last read/.test(s) && /Disconnect/.test(await page.locator('[aria-label="rings"] li').first().innerText())) return `connected again in ${secs(started)} (${s.slice(0, 80)})`;
        await sleep(500);
      }
      throw new Error(`not connected after 120 s: ${(await stateLines()).join(' | ').slice(0, 160)}`);
    });
} catch (e) {
  failures++;
  console.log(`FAIL ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
} finally {
  // leave the ring free for the next central
  await page
    .locator('[aria-label="rings"] li')
    .first()
    .getByRole('button', { name: 'Disconnect' })
    .click({ timeout: 3_000 })
    .catch(() => undefined);
  await sleep(1500);
  await Promise.race([app.close().catch(() => undefined), sleep(10_000)]);
  try {
    app.process().kill('SIGKILL');
  } catch {
    // already gone
  }
  rmSync(home, { recursive: true, force: true });
}
if (failures && mainLog.length) console.log(`main process (last 10):\n  ${mainLog.slice(-10).join('\n  ')}`);
if (failures && consoleLog.length) console.log(`page errors and warnings (last 15):\n  ${consoleLog.slice(-15).join('\n  ')}`);
console.log(failures ? `${failures} step(s) failed (${secs(t0)})` : `all steps passed (${secs(t0)})`);
process.exit(failures ? 1 : 0);

async function completeWelcome(p) {
  if (!p.url().includes('/welcome')) return;
  await p.getByRole('button', { name: 'Get started' }).first().click();
  await p.locator('[role=radio]').first().waitFor({ timeout: 20_000 });
  for (let round = 0; round < 4; round++) {
    const groups = await p.evaluate(() =>
      [...new Set([...document.querySelectorAll('[role=radio]')].map((r) => r.parentElement))].map((g, i) => {
        g.setAttribute('data-e2e-group', String(i));
        const opts = [...g.querySelectorAll('[role=radio]')];
        return { i, checked: opts.some((o) => o.getAttribute('aria-checked') === 'true'), names: opts.map((o) => o.textContent.trim()) };
      }),
    );
    const todo = groups.filter((g) => !g.checked);
    if (!todo.length) break;
    for (const g of todo) {
      const pick = g.names.find((x) => x === '18–64') ?? g.names.find((x) => x === 'no') ?? g.names.at(-1);
      await p.locator(`[data-e2e-group="${g.i}"] [role=radio]`).filter({ hasText: new RegExp(`^${pick}$`) }).first().click();
    }
  }
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.getByRole('checkbox').first().check({ timeout: 20_000 });
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.waitForURL((u) => !u.pathname.startsWith('/welcome'), { timeout: 20_000 });
}
