// Q9 journey 4: one source of truth, on profile "a" (paired with q9-a on oci-arm, after j1-live.mjs streamed last night).
// Today shows the device's night with its source and no sleep input; Correct → 6 h 00 min; the device value again; the
// Coach (stand-in) told "I slept six hours yesterday" stages a correction, Apply wins; a replay of the stream leaves the
// correction; "Use the device value again" restores; scores carry the correction id while it stands.
//
// The Coach's model: oci-arm has no stand-in upstream and a real key is not ours to use, so the page's requests to the
// server's OpenCode Zen route (`/v1/ai/opencode-zen/*`) are answered by a scripted stand-in inside the browser profile.
// Everything else (sync, the correction documents, the replay over MQTT) goes to oci-arm.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ORIGIN, ROOT, SERVER, checker, kept, lastNightStream, log, lumenClient, profile, publishAll, qaRead, serverCall, sleep, startPreview, waitQa } from './lib.mjs';

const c = checker();
const night = kept('night.json');
const L1 = kept('login-L1.json');
if (!night || !L1) throw new Error('run j1-live.mjs first');
const today = night.today;
const SHOTS = join(ROOT, 'qa/screenshots');
const results = { at: new Date().toISOString(), today };
const preview = await startPreview();
const PROFILE = process.env.Q9_PROFILE || 'a';
/** Q9_NO_SERVER=1: a local profile without a server (the Coach through the server and the MQTT replay are skipped). */
const NO_SERVER = process.env.Q9_NO_SERVER === '1';
results.profile = PROFILE;
const A = await profile(PROFILE);
const page = A.page;

const day = async () => {
  const r = await qaRead(page, 'bio.daily', { from: today, to: today });
  return r.ok ? r.output.days.find((d) => d.date === today) : null;
};
const corrections = async () => {
  const d = await qaRead(page, 'data.export', {});
  return d.ok ? (JSON.parse(d.output.text).collections.bioCorrections ?? []) : [];
};
const waitFor = async (f, ms = 30000) => {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) {
    v = await f();
    if (v) return v;
    await sleep(1000);
  }
  return v;
};
const h = (x) => (x == null ? 'none' : `${Math.floor(x)} h ${String(Math.round((x % 1) * 60)).padStart(2, '0')} min`);

async function startPlan() {
  await page.goto(`${ORIGIN}/today?qa=1`, { waitUntil: 'load' });
  await sleep(2500);
  if (!(await page.getByText('Start a plan to use Today.').count())) return 'already running';
  await page.goto(`${ORIGIN}/plan/goals?qa=1`, { waitUntil: 'load' });
  const find = page.getByRole('button', { name: /Find plans/ });
  await find.waitFor();
  if (await find.getAttribute('aria-disabled')) {
    await page.getByRole('button', { name: 'Fat mass ↓' }).click();
    await page.getByRole('button', { name: 'Strength index ↑' }).click();
  }
  await find.click();
  const start = page.getByRole('button', { name: /^(Start this plan|Replace active plan…)$/ });
  await start.first().waitFor({ timeout: 240000 });
  await start.first().click();
  await sleep(1500);
  await page.getByRole('radio', { name: /^today/ }).last().click();
  await sleep(400);
  await page.getByRole('button', { name: /^(Start plan|Replace active plan…)$/ }).last().click();
  await sleep(3000);
  return 'started';
}

// ---- the stand-in model behind the server's OpenCode Zen route ----------------------------------------------------------
const seen = [];
async function standIn(route) {
  const req = route.request();
  const url = req.url();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': ORIGIN, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST' } });
  const cors = { 'access-control-allow-origin': ORIGIN };
  if (url.endsWith('/models') || url.endsWith('/probe')) {
    const models = { object: 'list', data: [{ id: 'fake-model', object: 'model' }] };
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(url.endsWith('/probe') ? { ready: true, models: models.data } : models) });
  }
  const j = JSON.parse(req.postData() || '{}');
  const tools = (j.tools || []).map((t) => t.function?.name).filter(Boolean);
  const msgs = j.messages || [];
  const last = msgs[msgs.length - 1] || {};
  const text = typeof last.content === 'string' ? last.content : JSON.stringify(last.content ?? '');
  seen.push({ url: url.replace(SERVER, ''), tools: tools.length, last: last.role });
  const sleepTool = tools.find((n) => n === 'log_sleep' || n.endsWith('log_sleep'));
  let call = null;
  let reply = 'Noted.';
  if (last.role === 'tool') reply = 'I put that in as a correction to last night. Apply it if it looks right.';
  else if (/slept six hours/i.test(text) && sleepTool) {
    // last night: woke at the device's wake time; six hours before it
    const wake = night.wake;
    call = { name: sleepTool, args: { bedAt: new Date(Date.parse(wake) - 6 * 3600000).toISOString(), wakeAt: wake } };
  }
  const id = `chatcmpl-${seen.length}`;
  const ch = (delta, fr = null) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: j.model, choices: [{ index: 0, delta, finish_reason: fr }] })}\n\n`;
  let body = ch({ role: 'assistant', content: '' });
  if (!j.stream) {
    const message = call ? { role: 'assistant', content: null, tool_calls: [{ id: `call_${id}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { role: 'assistant', content: reply };
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ id, object: 'chat.completion', model: j.model, choices: [{ index: 0, message, finish_reason: call ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) });
  }
  if (call) body += ch({ tool_calls: [{ index: 0, id: `call_${id}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] }) + ch({}, 'tool_calls');
  else body += reply.match(/.{1,12}/g).map((w) => ch({ content: w })).join('') + ch({}, 'stop');
  body += 'data: [DONE]\n\n';
  return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body });
}

try {
  c.journey('J4 one source of truth');
  results.plan = await startPlan();
  await waitQa(page);
  log(`plan: ${results.plan}`);
  // stream switches: sleep and steps feed my scores and my plan
  await page.goto(`${ORIGIN}/settings?section=devices&qa=1`, { waitUntil: 'load' });
  await sleep(2000);
  for (const name of ['my scores: sleep', 'my plan: sleep', 'my scores: steps', 'my plan: steps', 'my scores: heart rate']) {
    const sw = page.getByRole('switch', { name }).or(page.getByRole('checkbox', { name })).first();
    if (await sw.count()) {
      if ((await sw.getAttribute('aria-checked')) !== 'true' && !(await sw.isChecked().catch(() => false))) await sw.click({ timeout: 3000 }).catch(() => log(`switch "${name}" not clickable`));
    } else log(`no switch "${name}"`);
  }
  await sleep(2000);

  // ---- Today: the device's night, its source, no sleep input
  const d0 = await waitFor(async () => (await day())?.sleep);
  results.deviceSleep = d0;
  await page.goto(`${ORIGIN}/today?qa=1`, { waitUntil: 'load' });
  await sleep(3000);
  const correctKey = page.getByRole('button', { name: 'Correct sleep' });
  const hasCorrect = await correctKey.first().waitFor({ timeout: 20000 }).then(() => true, () => false);
  const sleepRow = hasCorrect ? correctKey.first().locator('xpath=ancestor::*[self::li or self::div][1]') : page.locator('main');
  const rowText = ((await sleepRow.innerText().catch(() => '')) || '').replace(/\s*\n\s*/g, ' | ');
  const todayText = (await page.locator('main').innerText()).replace(/\s*\n\s*/g, ' | ');
  results.todayText = todayText.slice(0, 1500);
  c.check('bio.daily: last night from the device (7 h 00 min, basis device)', d0 && Math.abs(d0.asleepH - 7) < 0.02 && d0.basis === 'device', JSON.stringify(d0 ?? {}).slice(0, 200));
  c.check('Today shows the device sleep with its source label and a Correct key', hasCorrect && /7 h( 00 min)?/.test(rowText) && /J-Style 2301|Lumen/.test(rowText), rowText.slice(0, 200));
  const sleepInputs = await page.locator('main input[name*=sleep i], main input[aria-label*="sleep" i], main input[aria-label*="hours slept" i]').count();
  c.check('Today has no manual sleep input', sleepInputs === 0, `${sleepInputs} inputs`);
  await page.screenshot({ path: join(SHOTS, 'Q9-today-device-sleep-1440.png') });

  // ---- Correct → 6 h 00 min
  await correctKey.first().click();
  const sheet = page.locator('.lv-correct').first(); // the responsive panel (a side sheet at 1440 px)
  await sheet.waitFor();
  await sheet.getByLabel('hours asleep').fill('6');
  await sheet.getByLabel('minutes').fill('0');
  const line = (await sheet.locator('.lv-correct__line').first().innerText()).trim();
  c.check('correction sheet shows "Device: 7 h 00 min → Yours: 6 h 00 min"', /Device: 7 h 00 min → Yours: 6 h 00 min/.test(line), line);
  await page.screenshot({ path: join(SHOTS, 'Q9-correct-sheet-1440.png') });
  await sheet.getByRole('button', { name: 'Confirm' }).click();
  const d1 = await waitFor(async () => { const x = (await day())?.sleep; return x?.basis === 'correction' ? x : null; }, 15000);
  c.check('resolved day: 6 h 00 min, basis correction', d1 && Math.abs(d1.asleepH - 6) < 0.02, JSON.stringify(d1 ?? {}).slice(0, 200));
  await sleep(1500);
  const marker = await page.getByText(/^corrected ·/).first().isVisible().catch(() => false);
  c.check('Today shows the "corrected" marker with "Use the device value again"', marker && (await page.getByRole('button', { name: /^Use the device value again for sleep/ }).count()) > 0);
  await page.screenshot({ path: join(SHOTS, 'Q9-today-corrected-1440.png') });
  // scores while the correction stands
  // the rescore after a correction is debounced (1.5 s) and runs in the background: wait for a score that cites it
  const sc = await waitFor(async () => {
    const r = await qaRead(page, 'bio.scores', { from: today, to: today });
    const list = r.ok ? r.output.results ?? [] : [];
    return list.some((s) => s.corrected === true) ? list : null;
  }, 30000) ?? (await qaRead(page, 'bio.scores', { from: today, to: today })).output?.results ?? [];
  const cs = await corrections();
  const corrId = cs.at(-1)?.id ?? cs.at(-1)?.correctionId ?? cs.at(-1)?._id;
  results.scores1 = (sc ?? []).map((s) => ({ id: s.scoreId ?? s.id, sourceIds: s.sourceIds })).slice(0, 10);
  results.correction1 = cs.map((x) => ({ id: x.id ?? x._id, createdAt: x.createdAt, target: x.target }));
  const withCorr = (sc ?? []).filter((s) => s.corrected === true);
  c.check('scores recompute with the correction (sourceIds include the correction id)', withCorr.length > 0, `${(sc ?? []).length} scores today; with a corr: id ${withCorr.length}; correction ${corrId}`);

  // ---- the device value again
  await page.getByRole('button', { name: /^Use the device value again for sleep/ }).first().click();
  const d2 = await waitFor(async () => { const x = (await day())?.sleep; return x?.basis === 'device' ? x : null; }, 15000);
  c.check('"Use the device value again" restores 7 h 00 min, basis device', d2 && Math.abs(d2.asleepH - 7) < 0.02, JSON.stringify(d2 ?? {}).slice(0, 160));

  if (NO_SERVER) throw Object.assign(new Error('local'), { done: true });
  // ---- the Coach: "I slept six hours yesterday" → proposal → Apply
  await page.route(`${SERVER}/v1/ai/opencode-zen/**`, standIn);
  const key = await serverCall(page, 'PUT', '/v1/ai/keys/opencode-zen', { key: 'sk-q9-stand-in-not-a-real-key-0001' });
  log(`stand-in key on q9-a: ${key.status}`);
  await page.goto(`${ORIGIN}/settings/ai?qa=1`, { waitUntil: 'load' });
  const radio = page.locator('input[type=radio][value="opencode-zen"]');
  await radio.waitFor({ state: 'attached' });
  await radio.evaluate((e) => e.click());
  await sleep(1200);
  const model = page.getByLabel(/^model$/i).first();
  if ((await model.count()) && (await model.evaluate((e) => e.tagName)) === 'SELECT') {
    const opts = await model.locator('option').allTextContents();
    await model.selectOption(opts.some((o) => o.includes('fake-model')) ? { label: 'fake-model' } : { index: opts.length - 1 });
  }
  const other = page.getByLabel(/model id/i).first();
  if (await other.count()) await other.fill('fake-model');
  await page.getByRole('button', { name: 'Save provider' }).click();
  await sleep(1500);
  await page.goto(`${ORIGIN}/coach?qa=1`, { waitUntil: 'load' });
  const box = page.locator('textarea.lv-composer__field, input.lv-composer__field').first();
  await box.waitFor({ timeout: 20000 });
  await box.fill('I slept six hours yesterday');
  await box.press('Enter');
  const apply = page.getByRole('button', { name: /^Apply/ }).first();
  const proposal = await apply.waitFor({ timeout: 45000 }).then(() => true, () => false);
  const card = page.getByRole('button', { name: /^Apply/ }).first().locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " lv-card ")][1]');
  const cardText = ((await card.count()) ? await card.innerText() : await page.locator('main').innerText()).replace(/\s*\n\s*/g, ' | ').slice(-600);
  results.coach = { requests: seen, card: cardText.slice(0, 400) };
  c.check('Coach request went to the server route (stand-in answered) with tools offered', seen.some((s) => s.tools > 0), JSON.stringify(seen.slice(0, 3)));
  c.check('Coach staged a correction proposal (card with Apply)', proposal && /6 h 00 min/.test(cardText), cardText.slice(0, 300));
  await page.screenshot({ path: join(SHOTS, 'Q9-coach-proposal-1440.png') });
  if (proposal) await apply.click();
  const d3 = await waitFor(async () => { const x = (await day())?.sleep; return x?.basis === 'correction' ? x : null; }, 20000);
  c.check('applying the Coach proposal wins: 6 h 00 min, basis correction', d3 && Math.abs(d3.asleepH - 6) < 0.02, JSON.stringify(d3 ?? {}).slice(0, 160));

  // ---- replay the stream (and a newer device version of the night) over MQTT → the correction stays
  const cl = await lumenClient(L1.address, L1.username, L1.password, 'q9-phone-1');
  const again = lastNightStream('install123', today).messages;
  await publishAll(cl, again);
  await cl.endAsync(true);
  await sleep(8000);
  const d4 = await day();
  c.check('after replaying the stream the correction stays (6 h 00 min, basis correction)', d4?.sleep && Math.abs(d4.sleep.asleepH - 6) < 0.02 && d4.sleep.basis === 'correction', JSON.stringify(d4?.sleep ?? {}).slice(0, 160));

  // ---- Use the device value again (Today) → restores; scores recompute without the correction
  await page.goto(`${ORIGIN}/today?qa=1`, { waitUntil: 'load' });
  const undo = page.getByRole('button', { name: /^Use the device value again for sleep/ }).first();
  await undo.waitFor({ timeout: 20000 });
  await undo.click();
  const d5 = await waitFor(async () => { const x = (await day())?.sleep; return x?.basis === 'device' ? x : null; }, 15000);
  c.check('"Use the device value again" after the Coach correction restores 7 h 00 min', d5 && Math.abs(d5.asleepH - 7) < 0.02, JSON.stringify(d5 ?? {}).slice(0, 160));
  const sc2 = await waitFor(async () => {
    const r = await qaRead(page, 'bio.scores', { from: today, to: today });
    const list = r.ok ? r.output.results ?? [] : [];
    return list.length && !list.some((s) => s.corrected === true) ? list : null;
  }, 20000);
  results.scores2 = (sc2 ?? []).map((s) => ({ id: s.scoreId ?? s.id, sourceIds: s.sourceIds })).slice(0, 10);
  c.check('scores recompute after the correction is removed (no score marked corrected)', Boolean(sc2), `${(sc2 ?? []).length} scores`);
  results.corrections = (await corrections()).map((x) => ({ id: x.id ?? x._id, createdAt: x.createdAt, deleted: x._deleted ?? x.deleted }));
  log(`device night ${h(d0?.asleepH)}, corrected ${h(d1?.asleepH)}, coach ${h(d3?.asleepH)}, after replay ${h(d4?.sleep?.asleepH)}, restored ${h(d5?.asleepH)}`);
} catch (e) {
  if (!e.done) c.check('no exception', false, e.stack?.split('\n').slice(0, 3).join(' / '));
} finally {
  results.checks = c.checks;
  results.browserErrors = A.errors.slice(0, 10);
  writeFileSync(join(ROOT, `qa/results/Q9-j4-truth${NO_SERVER ? '-local' : ''}.json`), JSON.stringify(results, null, 2));
  log(`browser errors: ${A.errors.slice(0, 5).join(' || ')}`);
  await A.ctx.close();
  preview?.kill();
  log(JSON.stringify(c.summary()));
}
