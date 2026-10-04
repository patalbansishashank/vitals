// Q6 screen registry: every screen and every sheet/drawer, keyed by the seeded profile it needs.
// Ladder screens (planner results live in memory only) are in ladder.mjs. prep(page) runs after the route loads; `scope` limits measurement to an overlay.
import { btn, sleep, ROOT } from './lib.mjs';
const SRV = process.env.Q10_SRV || 'https://127.0.0.1:5284';
export const click = (name) => async (page) => { await btn(page, name).locator('visible=true').first().click(); await sleep(900); };
export const scrollTo = (sel) => async (page) => {
  await page.locator(sel).first().evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => window.scrollBy(0, -72)); await sleep(500);
};
export const heading = (text) => async (page) => {
  await page.getByRole('heading', { name: text, exact: true }).locator('visible=true').first().evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => window.scrollBy(0, -72)); await sleep(500);
};
const menu = (item, label = 'Today menu') => async (page) => {
  await btn(page, label).click(); await sleep(300);
  await page.getByRole('menuitem', { name: item }).click(); await sleep(900);
};
const runSim = async (page) => { const r = btn(page, 'Run'); if (await r.count()) { await r.last().click(); await page.getByRole('button', { name: 'Fat mass: explain' }).first().waitFor({ timeout: 90000 }); await sleep(1500); } };
export const OVERLAY = 'dialog[open], .lm-sidepanel[data-mode], [role=dialog], [role=alertdialog]';
export const SCREENS = [
  // first run (empty profile)
  { id: 'welcome', profile: 'fresh', route: '/welcome' },
  { id: 'welcome-screening', profile: 'fresh', route: '/welcome?step=screening' },
  { id: 'welcome-consent', profile: 'fresh', route: '/welcome?step=consent' },
  { id: 'evidence-empty-profile', profile: 'fresh', route: '/evidence' },
  // intake in progress
  { id: 'body-setup', profile: 'intake', route: '/body?setup=basics' },
  { id: 'intake-progress-activity', profile: 'intake', route: '/onboarding/activity' },
  { id: 'intake-progress-question', profile: 'intake', route: '/onboarding/activity', prep: scrollTo('fieldset') },
  { id: 'intake-progress-summary', profile: 'intake', route: '/onboarding/summary' },
  { id: 'goals-empty', profile: 'intake', route: '/plan/goals' },
  // intake complete (full profile)
  ...['activity', 'training', 'diet', 'kitchen', 'supplements', 'markers', 'devices'].map((s) => ({ id: `intake-${s}`, profile: 'full', route: `/onboarding/${s}` })),
  { id: 'intake-supplements-rows', profile: 'full', route: '/onboarding/supplements', prep: async (page) => { const c = btn(page, /^Change: .*supplement/i).first(); if (await c.count()) { await c.click(); await sleep(900); } await scrollTo('.lm-supprow, fieldset')(page); } },
  { id: 'intake-summary', profile: 'full', route: '/onboarding/summary' },
  { id: 'intake-summary-footer', profile: 'full', route: '/onboarding/summary', prep: scrollTo('.lm-face-foot, main button:text("Looks right")') },
  // planning
  { id: 'body', profile: 'full', route: '/body' },
  { id: 'body-visceral', profile: 'full', route: '/body#visceral' },
  { id: 'simulate-schedule', profile: 'full', route: '/simulate' },
  { id: 'simulate-results', profile: 'full', route: '/simulate/starter/results', prep: runSim },
  { id: 'simulate-results-lower', profile: 'full', route: '/simulate/starter/results', prep: async (page) => { await runSim(page); await page.evaluate(() => window.scrollTo(0, innerHeight * 0.85)); await sleep(500); } },
  { id: 'plan-goals', profile: 'full', route: '/plan/goals' },
  // living
  { id: 'today', profile: 'full', route: '/today' },
  { id: 'today-lower', profile: 'full', route: '/today', prep: heading('So far') },
  { id: 'food', profile: 'full', route: '/food' },
  { id: 'food-groceries', profile: 'full', route: '/food', prep: heading('Groceries') },
  { id: 'food-supplements', profile: 'full', route: '/food', prep: heading('Supplements') },
  { id: 'food-pantry-panel', profile: 'full', route: '/food', prep: scrollTo('.lv-food-pantryface') },
  { id: 'food-pantry-page', profile: 'full', route: '/food/pantry' },
  { id: 'train', profile: 'full', route: '/train' },
  { id: 'coach', profile: 'full', route: '/coach' },
  { id: 'progress', profile: 'full', route: '/progress' },
  { id: 'progress-lower', profile: 'full', route: '/progress', prep: async (page) => { await page.evaluate(() => window.scrollTo(0, innerHeight * 0.9)); await sleep(400); } },
  { id: 'plan-active', profile: 'full', route: '/plan/active' },
  // library and settings
  { id: 'evidence', profile: 'full', route: '/evidence' },
  { id: 'evidence-mechanism', profile: 'full', route: '/evidence', prep: async (page) => { await page.locator('main a[href^="/evidence/"]:not([href*="topics"]):not([href*="validation"])').first().click(); await sleep(1500); } },
  { id: 'evidence-topic', profile: 'full', route: '/evidence?group=dossier', prep: async (page) => { await page.locator('main a[href*="/evidence/topics/"]').first().click(); await sleep(1500); } },
  { id: 'evidence-validation', profile: 'full', route: '/evidence/validation' },
  { id: 'safety', profile: 'full', route: '/safety' },
  { id: 'not-found', profile: 'full', route: '/no-such-page' },
  ...['units', 'appearance', 'kitchen', 'supplements', 'data', 'sync', 'devices', 'ai', 'agents', 'install', 'safety', 'about'].map((s) => ({ id: `settings-${s}`, profile: 'full', route: `/settings/${s}` })),
  { id: 'settings-supplements-rows', profile: 'full', route: '/settings/supplements', prep: heading('Your supplements') },
  // v0.4 (Q10): Settings › Server before pairing: empty, the code form, a wrong code (the local QA server on :5284)
  { id: 'settings-server', profile: 'full', route: '/settings/server' },
  { id: 'settings-server-enter', profile: 'full', route: '/settings/server', prep: click('Enter code') },
  { id: 'settings-server-wrongcode', profile: 'full', route: '/settings/server', prep: async (page) => { await click('Enter code')(page); await page.getByLabel('server address').first().fill(SRV); await page.getByLabel(/^first 4/).fill('ABCD'); await page.getByLabel(/^last 4/).fill('EFGH'); await btn(page, /^Pair( this device)?$/).first().click(); await sleep(3500); } },
  // v0.4 (Q10): the "server" profile lives on the server's own origin (Q6_SERVER=1 BASE=https://127.0.0.1:5284,
  // seeded by qa/scripts/Q10/srv-visual.mjs): paired, ring over MQTT, archive import, a correction, a staged proposal
  ...[['settings-server', '/settings/server'], ['settings-ai', '/settings/ai'], ['settings-agents', '/settings/agents'], ['settings-devices', '/settings/devices'], ['settings-data', '/settings/data'],
    ['today', '/today'], ['progress', '/progress'], ['coach', '/coach']].map(([id, route]) => ({ id: `srv-${id}`, profile: 'server', route })),
  { id: 'srv-settings-server-devices', profile: 'server', route: '/settings/server', prep: heading(/^(Devices|Paired devices)/) },
  { id: 'srv-settings-server-newcode', profile: 'server', route: '/settings/server', prep: click('Add another device'), mask: '[aria-labelledby="server-new-code-title"] img, [aria-labelledby="server-new-code-title"] svg, [aria-labelledby="server-new-code-title"] .tabular-nums, [aria-labelledby="server-new-code-title"] code' },
  { id: 'srv-settings-server-revoke-agent', profile: 'server', route: '/settings/server', prep: async (page) => { const b = page.locator('section[aria-labelledby="settings-server-devices-title"]').getByRole('button', { name: 'Revoke QA Claude Code' }); await b.scrollIntoViewIfNeeded(); await b.click(); await page.getByRole('alertdialog').waitFor(); await sleep(800); }, scope: OVERLAY },
  { id: 'srv-settings-devices-mqtt', profile: 'server', route: '/settings/devices', prep: scrollTo('section:has-text("Lumen Health over MQTT"), [aria-label*="MQTT"]') },
  { id: 'srv-settings-ai-server', profile: 'server', route: '/settings/ai', prep: scrollTo('section:has-text("via your server")') },
  { id: 'srv-today-lower', profile: 'server', route: '/today', prep: scrollTo('[data-owned]') },
  { id: 'srv-today-correct-sheet', profile: 'server', route: '/today', prep: click(/^Correct /), scope: OVERLAY },
  { id: 'srv-progress-lower', profile: 'server', route: '/progress', prep: async (page) => { await page.evaluate(() => window.scrollTo(0, innerHeight * 0.9)); await sleep(400); } },
  { id: 'srv-progress-corrected', profile: 'server', route: '/progress', prep: scrollTo('[aria-label="Readings you corrected"]') },
  { id: 'srv-score-sleep', profile: 'server', route: '/progress', prep: async (page) => { await page.locator('main a[href^="/progress/"]').filter({ hasText: /sleep/i }).first().click(); await sleep(1500); } },
  { id: 'srv-score-first', profile: 'server', route: '/progress', prep: async (page) => { await page.locator('main a[href^="/progress/"]').first().click(); await sleep(1500); } },
  { id: 'srv-score-ring', profile: 'server', route: '/progress', prep: async (page) => { await page.locator('main a[href^="/progress/"]').first().click(); await sleep(1500); await scrollTo('.lv-ring, [class*="ring"]')(page); } },
  { id: 'srv-import-dialog', profile: 'server', route: '/settings/devices', prep: async (page) => { await page.locator('input[type=file]').first().setInputFiles(`${ROOT}/.e6-tmp/q10-lumen-archive.json`); await sleep(2500); }, scope: OVERLAY },
  // the same profile while the server cannot be reached / runs an old version / has revoked this device
  ...['down', 'old', 'rev'].flatMap((m) => [['settings-server', '/settings/server'], ['settings-devices', '/settings/devices'], ['settings-ai', '/settings/ai'], ['today', '/today']].map(([id, route]) => ({ id: `srv${m}-${id}`, profile: 'server', route }))),
  // sheets, drawers, dialogs, popovers
  { id: 'sheet-today-menu', profile: 'full', route: '/today', prep: async (page) => { await btn(page, 'Today menu').click(); await sleep(500); } },
  { id: 'sheet-busy', profile: 'full', route: '/today', prep: menu(/busy or away/), scope: OVERLAY },
  { id: 'sheet-checkin', profile: 'full', route: '/today', prep: menu(/Check in now/), scope: OVERLAY },
  { id: 'sheet-pause', profile: 'full', route: '/today', prep: menu(/Pause plan/), scope: OVERLAY },
  { id: 'sheet-row', profile: 'full', route: '/today', prep: click('More for breakfast'), scope: OVERLAY },
  { id: 'sheet-meal', profile: 'full', route: '/food', prep: click('I ate something else: dinner'), scope: OVERLAY },
  { id: 'sheet-otherfood', profile: 'full', route: '/food', prep: click('Log other food'), scope: OVERLAY },
  { id: 'sheet-recipe', profile: 'full', route: '/food', prep: click('Open breakfast details'), scope: OVERLAY },
  { id: 'sheet-nobenefit', profile: 'full', route: '/food', prep: click('Things that won’t help your goals'), scope: OVERLAY },
  { id: 'sheet-swap', profile: 'full', route: '/train', prep: click(/^Swap /), scope: OVERLAY },
  { id: 'sheet-session', profile: 'full', route: '/train', prep: click('I did something else'), scope: OVERLAY },
  { id: 'sheet-measure', profile: 'full', route: '/progress', prep: click('Add a measurement'), scope: OVERLAY },
  { id: 'sheet-erase', profile: 'full', route: '/settings/data', prep: click('Reset everything'), scope: OVERLAY },
  { id: 'sheet-habits', profile: 'full', route: '/body', prep: click(/^Edit$/), scope: OVERLAY },
  { id: 'sheet-labs', profile: 'full', route: '/body', prep: click('Add values'), scope: OVERLAY },
  { id: 'sheet-goal-picker', profile: 'full', route: '/plan/goals', prep: click('Add a goal'), scope: OVERLAY },
  { id: 'sheet-explain-sim', profile: 'full', route: '/simulate/starter/results', prep: async (page) => { await runSim(page); await click('Fat mass: explain')(page); }, scope: OVERLAY },
  { id: 'sheet-coach-brief', profile: 'full', route: '/coach', prep: async (page) => { const b = btn(page, /briefing|What the Coach knows/i).first(); if (await b.count()) { await b.click(); await sleep(900); } } },
];
