/** Mocked desktop bridge audit. Requires development BASE; never touches real tool configs. */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { firstRun } from '../set/lib.mjs';

const base = process.env.BASE;
if (!base) throw new Error('Set BASE to the development audit server');
const output = process.env.OUTPUT || 'qa/results/C-A11Y/connect-tools-final.json';
const widths = (process.env.WIDTHS || '390,1440').split(',').map(Number);
const { default: AxeBuilder } = await import(pathToFileURL(resolve('.e6-tmp/a11y-tools/node_modules/@axe-core/playwright/dist/index.mjs')).href);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
const rows = [];
const keyboard = [];
let pageErrors = 0;
let failure = null;
let axeVersion;
const save = () => {
  mkdirSync('qa/results/C-A11Y', { recursive: true });
  writeFileSync(output, JSON.stringify({
    method: 'Fresh dev browser contexts, synthetic firstRun, mocked desktop bridge, no server paired. Desktop widths use a fine pointer; phone widths use mobile/touch emulation. Tool rows and inert preview text exist only in browser memory; Add and Remove mutate that mock. Axe WCAG A/AA through 2.2; whole page including open dialogs audited.',
    axeVersion, rows, keyboard, pageErrors, failure,
    targetBoundsNote: 'smallPaintedTargets records painted button bounds only. Shared Key/Close controls extend their hit areas using CSS pseudo elements (44px on coarse pointers); these bounds are not a touch-target failure classification.',
    incompleteNote: 'Axe incomplete results require manual review; they are neither verified violations nor automatic passes. aria-required-children targets the separate empty proposals list; color-contrast requires review of reported nodes.',
    limits: 'No real desktop main process, AI tool configuration, credential store, server pairing, hardware or screen-reader speech tested.',
  }, null, 2) + '\n');
};
try {
  for (const width of widths) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, hasTouch: width === 390, isMobile: width === 390, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: 'reduce', serviceWorkers: 'block', bypassCSP: true });
    await context.addInitScript(() => {
      const tools = [
        { id: 'claude-code', label: 'Claude Code', found: true, added: false, canAdd: true, file: 'qa-synthetic/config.txt', preview: '[synthetic-tool]\nenabled = true' },
        { id: 'codex', label: 'Codex', found: true, added: false, canAdd: true, file: 'qa-synthetic/config.txt', preview: '[synthetic-tool]\nenabled = true' },
        { id: 'opencode', label: 'OpenCode', found: false, added: false, canAdd: false },
        { id: 'chatgpt-desktop', label: 'ChatGPT desktop', found: true, added: false, canAdd: false, note: 'Needs your Vitals server' },
      ];
      const update = (id, added) => {
        const row = tools.find((r) => r.id === id);
        row.added = added;
        return { ...row };
      };
      const off = () => () => undefined;
      window.vitalsDesktop = {
        version: 'qa-synthetic', os: 'linux',
        bluetooth: { onDevices: off, choose() {}, async activate() {} },
        tray: { setStatus() {} }, autostart: { async get() { return false; }, async set() {} },
        updates: { onState: off, async check() {}, restart() {} },
        keepAlive() {}, onShow: off, onSyncNow: off,
        secrets: { persistent: true, async set() {} },
        mcp: { async tools() { return tools.map((r) => ({ ...r })); }, async add(id) { return update(id, true); }, async remove(id) { return update(id, false); }, onCall: off, setManifest() {}, setServer() {} },
      };
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', () => pageErrors++);
    await firstRun(page);
    await page.goto(base + '/settings/agents', { waitUntil: 'networkidle' });
    const add = page.getByRole('button', { name: 'Add Vitals to Codex', exact: true });
    await add.waitFor();
    const audit = async (state) => {
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      axeVersion = result.testEngine.version;
      const compact = (v) => ({ id: v.id, impact: v.impact, nodeCount: v.nodes.length, nodes: v.nodes.slice(0, 5).map((n) => ({ target: n.target, summary: n.failureSummary })) });
      const ui = await page.evaluate(() => {
        const controls = [...document.querySelectorAll('#connect-tools button, [role="dialog"] button, [role="alertdialog"] button')].filter((el) => el.getBoundingClientRect().width > 0);
        return { overflow: document.documentElement.scrollWidth > innerWidth + 1, smallPaintedTargets: controls.map((el) => { const r = el.getBoundingClientRect(); return { name: el.getAttribute('aria-label') || el.textContent.trim(), width: Math.round(r.width), height: Math.round(r.height) }; }).filter((r) => r.width < 44 || r.height < 44) };
      });
      rows.push({ width, theme, state, pointer: width === 390 ? 'coarse' : 'fine', violations: result.violations.map(compact), incomplete: result.incomplete.map(compact), ...ui });
      save();
      console.log(JSON.stringify({ width, theme, state, violations: result.violations.map((v) => v.id), overflow: ui.overflow }));
    };
    const focusInBlock = () => page.evaluate(() => Boolean(document.activeElement?.closest('#connect-tools')));
    await audit('tool-list');
    await add.focus(); await add.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Add Vitals to Codex?' });
    await dialog.waitFor();
    await audit('add-consent');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).press('Enter');
    await dialog.waitFor({ state: 'hidden' });
    keyboard.push({ width, theme, check: 'Cancel restores Add trigger', passed: await add.evaluate((el) => el === document.activeElement) });
    await add.press('Enter');
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Add Vitals', exact: true }).press('Enter');
    const remove = page.getByRole('button', { name: 'Remove Vitals from Codex', exact: true });
    await remove.waitFor();
    await dialog.waitFor({ state: 'hidden' });
    keyboard.push({ width, theme, check: 'Completed Add keeps focus in ConnectTools', passed: await focusInBlock() });
    await audit('added');
    await remove.focus(); await remove.press('Enter');
    const confirm = page.getByRole('alertdialog', { name: 'Remove Vitals from Codex?' });
    await confirm.waitFor();
    await audit('remove-consent');
    await confirm.getByRole('button', { name: 'Remove', exact: true }).press('Enter');
    await add.waitFor();
    await confirm.waitFor({ state: 'hidden' });
    keyboard.push({ width, theme, check: 'Completed Remove keeps focus in ConnectTools', passed: await focusInBlock() });
    await audit('removed');
    await context.close();
  }
} catch {
  failure = 'Audit could not complete; completed states are retained';
} finally {
  await browser.close();
  save();
}
console.log(JSON.stringify({ states: rows.length, violations: rows.reduce((n, r) => n + r.violations.length, 0), failedKeyboardChecks: keyboard.filter((r) => !r.passed).length, pageErrors, failure }));
if (failure || rows.some((r) => r.violations.length) || keyboard.some((r) => !r.passed)) process.exitCode = 1;
