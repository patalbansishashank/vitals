// J1 helpers: launch a COPY of L-DESKTOP's packaged Linux app (under .e6-tmp/j1) with a throwaway HOME.
// Nothing here reads or prints secrets; outputs go to qa/results/L-QA/private/j1 (git-ignored).
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '..', '..', '..', '..');
export const tmp = path.join(repo, '.e6-tmp', 'j1');
export const priv = path.join(repo, 'qa', 'results', 'L-QA', 'private', 'j1');
export const desktopWt = path.resolve(repo, '..', 'L-DESKTOP');
export const APP = process.env.J1_APP || path.join(tmp, 'linux-unpacked', 'vitals');

const req = createRequire(path.join(desktopWt, 'apps', 'desktop', 'package.json'));
export const { _electron } = req('playwright-core');

export function stamp() {
  return new Date().toISOString();
}

export async function launch(tag, extraArgs = []) {
  mkdirSync(priv, { recursive: true });
  const home = mkdtempSync(path.join(tmp, `home-${tag}-`));
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local', 'share'), TMPDIR: path.join(repo, '.e6-tmp') };
  for (const k of ['VITALS_SMOKE', 'ELECTRON_RUN_AS_NODE', 'DISPLAY']) delete env[k];
  env.WAYLAND_DISPLAY ||= 'wayland-1';
  env.XDG_RUNTIME_DIR ||= `/run/user/${process.getuid?.() ?? 1000}`;
  const app = await _electron.launch({
    executablePath: APP,
    args: ['--ozone-platform=wayland', `--user-data-dir=${path.join(home, 'udd')}`, ...extraArgs],
    env,
    timeout: 60_000,
  });
  const page = await app.firstWindow({ timeout: 60_000 });
  const consoleLines = [];
  page.on('console', (m) => consoleLines.push(`${stamp()} ${m.type()} ${m.text().slice(0, 400)}`));
  page.on('pageerror', (e) => consoleLines.push(`${stamp()} pageerror ${String(e.message).slice(0, 400)}`));
  await page.waitForFunction(() => (document.querySelector('#root')?.childElementCount ?? 0) > 0, null, { timeout: 60_000 });
  return { app, page, home, consoleLines };
}

export async function close(app) {
  await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 10_000))]);
  try {
    app.process().kill('SIGKILL');
  } catch {
    // gone
  }
}

/** Client-side navigation inside app://vitals (the shell locks real navigations). */
export async function go(page, route) {
  await page.evaluate((r) => {
    history.pushState({}, '', r);
    dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.waitForTimeout(1500);
}

export async function shot(page, name) {
  const file = path.join(priv, name);
  await page.screenshot({ path: file, fullPage: true, timeout: 20_000 }).catch((e) => console.log(`screenshot ${name} failed: ${e.message.split('\n')[0]}`));
  return path.basename(file);
}

/** Visible text of the main area, trimmed (for the private log). */
export async function text(page) {
  return page.evaluate(() => (document.querySelector('main') ?? document.body).innerText.replace(/\n{2,}/g, '\n').slice(0, 4000));
}

/** Any field that asks for a password, passcode or key (hard rule: none for a ring). */
export async function secretFields(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('input, textarea')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map((el) => ({ type: el.getAttribute('type') || el.tagName.toLowerCase(), name: el.getAttribute('name') || '', label: (el.labels?.[0]?.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').slice(0, 80) }))
      .filter((f) => f.type === 'password' || /pass|key|code|pin/i.test(`${f.name} ${f.label}`)),
  );
}
