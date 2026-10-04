// Q8 Coach helpers shared by j3-coach.mjs (stand-in through a local server) and j3-siwc.mjs (the owner's ChatGPT
// sign-in on oci-arm): intake seed, choosing a "via your server" preset, a plan through the Coach, and the five
// journeys of Q4 typed into the real Coach UI with the document changes asserted through the bus.
// Helpers adapted from qa/scripts/Q4/lib.mjs and seed.mjs.
import fs from 'node:fs';
import { go, read, sleep, mainText, shot } from './lib.mjs';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const btn = (page, text, scope = 'main') => page.locator(scope).locator('button,[role=radio],[role=checkbox],[role=tab],[role=switch],a').filter({ hasText: new RegExp('^\\s*' + esc(text) + '\\s*$', 'i') });
export const coachLog = (page) => page.evaluate(() => (document.querySelector('[role=log]')?.innerText || '').replace(/\n{2,}/g, '\n'));
export const cards = (page) => page.evaluate(() => [...document.querySelectorAll('[data-class][data-state]')].map((c) => ({ cls: c.getAttribute('data-class'), state: c.getAttribute('data-state'), text: c.innerText.replace(/\s+/g, ' ').slice(0, 900) })));
export async function say(page, text, { timeout = 300000 } = {}) {
  const box = page.getByLabel('Message to the Coach').first();
  await box.fill(text);
  const n0 = (await coachLog(page)).length;
  await page.getByRole('button', { name: 'Send', exact: true }).first().click();
  const stop = page.getByRole('button', { name: 'Stop the Coach' });
  const t0 = Date.now();
  let last = -1, stable = 0;
  while (Date.now() - t0 < timeout) {
    await sleep(500);
    const busy = await stop.count();
    const len = (await coachLog(page)).length;
    if (!busy && len > n0 + text.length) { stable = len === last ? stable + 1 : 0; if (stable >= 3) break; }
    last = len;
  }
  await sleep(500);
}
export const lastTurnText = async (page) => { const t = await coachLog(page); const parts = t.split(/\ncoach\n/); return parts[parts.length - 1] || ''; };
export async function applyAndWait(page, name, maxMs = 120000) {
  const before = JSON.stringify((await cards(page)).map((c) => c.state));
  await page.getByRole('button', { name: new RegExp('^' + esc(name), 'i') }).first().click();
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { await sleep(1000); if (JSON.stringify((await cards(page)).map((c) => c.state)) !== before) break; }
  await sleep(1000);
}
export async function cardButton(page, name) { await page.getByRole('button', { name: new RegExp('^' + esc(name), 'i') }).last().click(); await sleep(2500); }
export function nextDow(fromIso, dow) { for (let k = 1; k <= 7; k++) { const d = new Date(fromIso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); if (d.getUTCDay() === dow) return d.toISOString().slice(0, 10); } }
export async function weekSessions(p, from) {
  const out = [];
  for (let k = 0; k < 7; k++) {
    const d = new Date(from + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k);
    const t = await read(p, 'today.get', { date: d.toISOString().slice(0, 10) });
    out.push(`${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]}:${(t.prescription?.sessions ?? []).map((s) => s.kind).join('+') || '-'}`);
  }
  return out.join(' ');
}

/** First run through the real intake: screening (18–64, no to the rest), consent, body (male 35 y, 175 cm, 92 kg). */
export async function seedProfile(p) {
  const page = p.page;
  try {
    await go(p, '/welcome');
    await btn(page, 'Get started').first().click(); await sleep(1000);
    await btn(page, '18–64').click();
    for (let r = 0; r < 5; r++) { const l = btn(page, 'no'); const n = await l.count(); let c = 0; for (let i = 0; i < n; i++) if ((await l.nth(i).getAttribute('aria-checked')) !== 'true') { await l.nth(i).click(); c++; await sleep(150); } if (!c) break; }
    await btn(page, 'Continue').first().click(); await sleep(1500);
    await page.locator('main input[type=checkbox]').first().check(); await btn(page, 'Continue').first().click(); await sleep(2000);
    await btn(page, 'male').click();
    const t = page.locator('main input[type=text]');
    for (const [i, v] of [[0, '35'], [1, '175'], [2, '92']]) { await t.nth(i).click(); await page.keyboard.press('Control+a'); await page.keyboard.type(v, { delay: 30 }); await page.keyboard.press('Tab'); await sleep(200); }
    await btn(page, 'Next: shape').first().click(); await sleep(1500);
    await btn(page, 'Skip for now').first().click(); await sleep(1500);
    const prof = await read(p, 'profile.get', {}).catch(() => null);
    return Boolean(prof);
  } catch (e) { console.log('seed', e.message.split('\n')[0]); return false; }
}

/** Settings › Coach: picks a "via your server" preset and a model, tests the connection, saves. */
export async function chooseServerPreset(p, preset, model) {
  const page = p.page;
  await go(p, '/settings/ai');
  await page.locator(`input[type=radio][value="${preset}"]`).evaluate((e) => e.click());
  await sleep(1500);
  const load = page.getByRole('button', { name: 'Load the model list' });
  if (await load.count()) { await load.first().click(); await sleep(4000); }
  const sel = page.getByLabel(/^model$/i).first();
  if ((await sel.count()) && (await sel.evaluate((e) => e.tagName)) === 'SELECT') {
    const opts = await sel.locator('option').evaluateAll((os) => os.map((o) => o.value));
    if (model && opts.includes(model)) await sel.selectOption(model); else if (opts.length) await sel.selectOption(opts.filter(Boolean)[0]);
  }
  const mid = page.getByLabel('model id', { exact: true });
  if (model && (await mid.count()) && (await mid.isVisible())) await mid.fill(model);
  await page.getByRole('button', { name: 'Test connection' }).first().click();
  await sleep(8000);
  await page.getByRole('button', { name: 'Save provider' }).click();
  await sleep(2000);
  // the saved provider config is not a settings field: Settings › Coach shows it as the current provider
  const txt = await mainText(p);
  return !/Save a key first|Pair this device with your server first/.test(txt) && (await page.locator(`input[type=radio][value="${preset}"]`).isChecked());
}

async function waitPlanner(p, maxMs = 900000) {
  const t0 = Date.now();
  let r;
  while (Date.now() - t0 < maxMs) { r = await read(p, 'planner.result'); if (r.status !== 'running' && r.status !== 'stopping') return r; await sleep(5000); }
  return r;
}
/** "make me a plan for …" → goals and a planner search → "start the one you recommend" → Apply on the card. */
export async function makePlan(p) {
  try {
    await go(p, '/coach');
    await say(p.page, 'make me a plan for losing 6 kg of fat in 3 months');
    const r = await waitPlanner(p);
    if (r?.status !== 'done') return { ok: false, detail: `planner ${r?.status} ${r?.message ?? ''}` };
    await say(p.page, 'start the one you recommend');
    // a real model may ask which one or take a while: answer once, then wait up to 3 minutes for the start proposal
    const applyKey = p.page.getByRole('button', { name: /^Apply proposal: start a plan/i });
    if (!(await applyKey.first().waitFor({ timeout: 60000 }).then(() => true, () => false))) {
      await say(p.page, 'the recommended one, start it today');
      await applyKey.first().waitFor({ timeout: 180000 });
    }
    await cardButton(p.page, 'Apply proposal: start a plan');
    const plan = (await read(p, 'plan.get')).plan;
    return { ok: Boolean(plan) && plan.status !== 'ended', detail: `${plan?.rung} ${plan?.status}` };
  } catch (e) { return { ok: false, detail: e.message.split('\n')[0] }; }
}

/** Tool calls the provider asked for since line `from` of its log (stand-in only). */
const toolCallsSince = (file, from) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').slice(from).map((l) => JSON.parse(l)).flatMap((x) => (x.reply?.tools ?? []).map((t) => t.name)) : []);
const lines = (file) => (file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).length : 0);
/** Bus events of commands committed by the Coach since the hook was installed. */
const aiCommits = async (p) => (await p.page.evaluate(() => JSON.parse(JSON.stringify(window.__vitals.events())))).filter((e) => e.type === 'committed' && e.actor?.kind === 'ai').map((e) => e.commandId);

/**
 * The five journeys. Each: a reply (text in the Coach log), a tool call (stand-in log or the bus), the document change
 * through the bus, Undo. `providerLog` is the stand-in's log (null with a real provider: tool calls are then read from
 * the bus events and the pending list).
 */
export async function coachJourneys(p, { providerLog = null, tag = '' } = {}) {
  const rows = [];
  const check = (name, ok, detail = '') => rows.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 300) });
  const page = p.page;
  const reply = async (name) => { const t = (await lastTurnText(page)).trim(); check(`${name}: the Coach replied`, t.length > 3, t.slice(0, 120)); return t; };
  const calls = (from) => (providerLog ? toolCallsSince(providerLog, from) : null);
  try {
    await go(p, '/coach');
    const today = (await read(p, 'today.get', {})).date;
    let n0 = lines(providerLog);
    let undo = page.getByRole('button', { name: 'Undo', exact: true });
    try {
    // 1. training days
    const mon = nextDow(today, 1);
    const before = await weekSessions(p, mon);
    n0 = lines(providerLog);
    await say(page, 'change my training days to Tue/Thu');
    await reply('training days');
    const pend = (await read(p, 'coach.pending')).filter((x) => x.status === 'pending');
    // the stand-in is scripted to call plan_shift; a real model may choose plan.replan or plan.editDay for the same ask
    const planTools = new Set(['plan.shift', 'plan.replan', 'plan.editDay', 'plan.declareEvent']);
    check(providerLog ? 'training days: tool call plan_shift → proposals staged, nothing applied' : 'training days: a plan-changing tool call → proposals staged, nothing applied', pend.some((x) => (providerLog ? x.commandId === 'plan.shift' : planTools.has(x.commandId))) && (await weekSessions(p, mon)) === before && (!providerLog || calls(n0).includes('plan_shift')), pend.map((x) => x.commandId).join(','));
    if (providerLog) await applyAndWait(page, 'Apply proposal: shift plan days');
    else if (await page.getByRole('button', { name: /^Apply proposal/ }).count()) await applyAndWait(page, 'Apply proposal');
    await go(p, '/today');
    const adopt = page.getByRole('button', { name: /^Apply proposal/ }).first();
    if (await adopt.count()) await adopt.click();
    undo = page.getByRole('button', { name: 'Undo', exact: true });
    await undo.first().waitFor({ timeout: 30000 }).catch(() => {});
    await sleep(1500);
    const after = await weekSessions(p, mon);
    check(providerLog ? 'training days: adopted → Monday no training, Tuesday training' : 'training days: adopted → the week changed (training on Tue, none on Mon)', (providerLog ? /Mon:- Tue:\w/.test(after) : /Tue:\w/.test(after) && /Mon:-/.test(after)) && after !== before, `${before} → ${after}`);
    if (await undo.count()) await undo.first().click();
    await sleep(4000);
    check('training days: Undo restores the days', (await weekSessions(p, mon)) === before, await weekSessions(p, mon));
    await shot(p, `J3-training-days${tag}`);
    } catch (e) { check(`training days: step ran to the end`, false, e.message.split('\n')[0]); await go(p, '/coach').catch(() => {}); }

    try {
    // 2. meal
    await go(p, '/coach');
    n0 = lines(providerLog);
    await say(page, 'I ate dal, rice and two eggs');
    await reply('meal');
    const log1 = await read(p, 'log.get', { from: today, to: today });
    const meal = log1.find((e) => /dal/i.test(JSON.stringify(e)) && (e.kind === 'meal' || e.components));
    check('meal: tool call log_meal → a meal with dal, rice and eggs in the log', Boolean(meal) && /rice/i.test(JSON.stringify(meal)) && /egg/i.test(JSON.stringify(meal)) && (!providerLog || calls(n0).includes('log_meal')), JSON.stringify(meal ?? log1).slice(0, 200));
    const t1 = await read(p, 'today.get', {});
    check('meal: energy estimated with a band', t1.logged.totals.energyKcal.value > 300 && t1.logged.totals.energyKcal.sd > 0, JSON.stringify(t1.logged.totals.energyKcal));
    } catch (e) { check(`meal: step ran to the end`, false, e.message.split('\n')[0]); await go(p, '/coach').catch(() => {}); }

    try {
    // 3. treadmill
    n0 = lines(providerLog);
    await say(page, 'I did 30 min on the treadmill');
    let tr = await reply('treadmill');
    // a real model may ask what kind of treadmill work it was: answer once (the stand-in never asks)
    if (!providerLog && /\?\s*$/.test(tr.trim()) && !(await read(p, 'log.get', { from: today, to: today })).some((e) => /treadmill/.test(JSON.stringify(e)))) {
      await say(page, 'running, steady pace, 30 minutes');
      tr = await reply('treadmill (after the question)');
    }
    const log2 = await read(p, 'log.get', { from: today, to: today });
    const sess = log2.find((e) => /treadmill/.test(JSON.stringify(e)));
    check('treadmill: tool call log_session → 30 min session in the log', Boolean(sess) && /30/.test(JSON.stringify(sess)) && (!providerLog || calls(n0).includes('log_session')), JSON.stringify(sess ?? null).slice(0, 200));
    check('meal and session committed by the Coach (actor ai)', (await aiCommits(p)).filter((x) => x === 'log.meal' || x === 'log.session').length >= 2, (await aiCommits(p)).join(','));
    await cardButton(page, 'Undo');
    const log3 = await read(p, 'log.get', { from: today, to: today });
    const live = (l) => l.filter((e) => !e.retracted && e.kind !== 'retract').length;
    check('Undo on the latest card retracts that entry', live(log3) < live(log2), `${live(log2)} → ${live(log3)}`);
    await shot(p, `J3-logging${tag}`);
    } catch (e) { check(`treadmill: step ran to the end`, false, e.message.split('\n')[0]); await go(p, '/coach').catch(() => {}); }

    try {
    // 4. travel
    const d1 = new Date(today + 'T12:00:00Z'); d1.setUTCDate(d1.getUTCDate() + 1);
    const from = d1.toISOString().slice(0, 10);
    const tb = await weekSessions(p, from);
    n0 = lines(providerLog);
    await say(page, "I'm travelling for three days");
    let tv = await reply('travel');
    const pendingTravel = async () => (await read(p, 'coach.pending')).filter((x) => x.status === 'pending').find((x) => x.commandId === 'plan.declareEvent');
    if (!providerLog && !(await pendingTravel()) && /\?\s*$/.test(tv.trim())) {
      const d3 = new Date(d1); d3.setUTCDate(d3.getUTCDate() + 2);
      await say(page, `from ${from} to ${d3.toISOString().slice(0, 10)}, no training those days`);
      tv = await reply('travel (after the question)');
    }
    const ev = await pendingTravel();
    check('travel: tool call plan_declare_event → travel staged as a proposal', ev?.input?.kind === 'travel' && (!providerLog || calls(n0).includes('plan_declare_event')), JSON.stringify(ev ?? null).slice(0, 160));
    await applyAndWait(page, 'Apply proposal: declare an event');
    await go(p, '/today');
    const ad = page.getByRole('button', { name: /^Apply proposal/ }).first();
    if (await ad.count()) await ad.click();
    await undo.first().waitFor({ timeout: 30000 }).catch(() => {});
    const ta = await weekSessions(p, from);
    check('travel: the three days prescribe no training', ta.split(' ').slice(0, 3).every((x) => x.endsWith(':-')), `${tb} → ${ta}`);
    if (await undo.count()) await undo.first().click();
    await sleep(4000);
    check('travel: Undo restores the days', (await weekSessions(p, from)) === tb, await weekSessions(p, from));
    } catch (e) { check(`travel: step ran to the end`, false, e.message.split('\n')[0]); await go(p, '/coach').catch(() => {}); }

    try {
    // 5. goals
    await go(p, '/coach');
    n0 = lines(providerLog);
    const goals0 = JSON.stringify(await read(p, 'goals.get'));
    await say(page, 'suggest goals from my answers');
    const txt = await reply('goals');
    check('goals: tool call goals_suggest; the reply is plain text', (!providerLog || calls(n0).includes('goals_suggest')) && !/[{}]/.test(txt), txt.slice(0, 160));
    check('goals: a suggestion writes nothing', JSON.stringify(await read(p, 'goals.get')) === goals0);
    await shot(p, `J3-goals${tag}`);
    } catch (e) { check(`goals: step ran to the end`, false, e.message.split('\n')[0]); await go(p, '/coach').catch(() => {}); }

  } catch (e) { check('Coach journeys ran to the end', false, e.message.split('\n')[0]); }
  const main = await mainText(p).catch(() => '');
  check('no internal names on the Coach screen', !/MODEL_SPEC|SUITE_SPEC|§|R-\d|dossier/.test(main));
  return rows;
}
