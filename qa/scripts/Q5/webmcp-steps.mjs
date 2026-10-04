// The invocation steps of webmcp-cdp.mjs (kept separate so discovery can run alone).
const DESTRUCTIVE_IDS = ['plan.end', 'plan.replace', 'coach.delete', 'bio.deleteSource', 'data.import', 'data.eraseAll', 'sync.unpair'];
export async function steps({ invoke, tools, page, check, log, cdp, removed, gotoAgents, webmcpSwitch }) {
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  log('destructive manifest ids (perm destructive) checked absent:', DESTRUCTIVE_IDS.join(','));
  const named = [...tools.keys()].filter((n) => /delete|reset/.test(n));
  log('note: tools whose name says delete/reset but whose manifest perm is write (restorable/undoable):', named.join(','));
  const pt = await page.evaluate(() => Promise.resolve(document.modelContext.getTools()).then((ts) => ts.filter((t) => t.name === 'plan_declare_event').map((t) => ({ name: t.name, keys: Object.keys(t), schemaType: typeof t.inputSchema, schema: String(t.inputSchema).slice(0, 200) }))));
  log('page getTools plan_declare_event', pt);

  // 1. today (read)
  const t1 = await invoke('today_get', {});
  check('today_get Completed with ok envelope', t1?.ev?.status === 'Completed' && t1.env?.ok === true, `status=${t1?.env?.status} summary=${t1?.env?.summary}`);

  // 2. log a weigh-in (low-impact write → applied)
  const VALUE = 93.7;
  const t2 = await invoke('log_measurement', { date: today, metric: 'weightKg', value: VALUE, unit: 'kg', context: 'morningFasted', method: 'scale' });
  check('log_measurement Completed, ok, applied', t2?.ev?.status === 'Completed' && t2.env?.ok === true && t2.env?.status === 'applied', `status=${t2?.env?.status} summary=${t2?.env?.summary}`);

  // 3. read the weigh-in back through the read tools (log_get covers dailyLogs entries only, not measurements)
  const readers = [];
  for (const [name, input] of [['log_get', { from: today, to: today }], ['today_get', {}], ['bio_manual', {}], ['profile_get', {}], ['bio_series', { metric: 'weightKg', from: today, to: today }]]) {
    if (!tools.has(name)) continue;
    const r = await invoke(name, input);
    if (JSON.stringify(r?.env ?? {}).includes(String(VALUE))) readers.push(name);
  }
  log('read tools whose envelope contains the weigh-in 93.7:', readers.length ? readers.join(',') : 'none');

  // 3b. a log entry that log_get covers: a note
  const NOTE = 'Q5 webmcp note ' + Date.now().toString(36);
  const t4 = await invoke('log_note', { date: today, text: NOTE });
  check('log_note Completed, ok, applied', t4?.ev?.status === 'Completed' && t4.env?.ok === true && t4.env?.status === 'applied', `summary=${t4?.env?.summary}`);
  const t5 = await invoke('log_get', { from: today, to: today });
  check('log_get returns the logged note', t5?.env?.ok === true && JSON.stringify(t5.env).includes(NOTE));
  const bus = (id, input = {}) => page.evaluate(([i, a]) => window.__vitals.read(i, a), [id, input]);
  const lb = await bus('log.get', { from: today, to: today });
  check('command bus (window.__vitals log.get) has the note', lb?.ok === true && JSON.stringify(lb.output).includes(NOTE));

  // 4. consequential writes with no plan running: staged (or refused by a precondition)
  let staged = null;
  for (const [name, input] of [['plan_edit_day', { date: today, patch: { note: 'Q5 webmcp' }, scope: 'day' }], ['profile_reset_shape', {}]]) {
    const r = await invoke(name, input);
    log(`  ${name} envelope status=${r?.env?.status} ok=${r?.env?.ok} code=${r?.env?.error?.code ?? ''}`);
    if (!staged && r?.env?.status === 'pending_user') staged = { name, env: r.env };
  }
  check('consequential write (no plan) staged as pending_user', !!staged, staged ? `${staged.name}: ${staged.env.summary}` : 'none');
  const startStaged = await (async () => {
    const sc = await invoke('scenario_ensure_active', {});
    const sid = sc?.env?.data?.id ?? sc?.env?.data?.scenario?.id ?? sc?.env?.data?.scenarioId;
    log('  scenario id', sid);
    await invoke('scenario_apply_starter', { id: sid, starter: 'maintenance8' });
    return { sid, r: await invoke('plan_start', { source: { scenarioId: sid }, startDate: today }) };
  })();
  check('plan_start (default policy) staged as pending_user', startStaged.r?.env?.status === 'pending_user', startStaged.r?.env?.summary);

  // 5. Settings › Agents: let "agents in this browser" apply plan changes directly (UI), start the plan, then switch it back
  async function reloadTools(fn) {
    tools.clear();
    await fn();
    for (let i = 0; i < 40 && tools.size < 100; i++) await page.waitForTimeout(250);
    log('  tools after reload', tools.size);
  }
  const directSwitch = () => page.locator('#agents').getByRole('switch').nth(1);
  async function setDirect(on) {
    await reloadTools(() => gotoAgents(page));
    const d = directSwitch();
    if ((await d.getAttribute('aria-checked')) !== String(on)) { await d.focus(); await page.keyboard.press('Space'); await page.waitForTimeout(1200); }
    log(`  direct-apply switch now ${await d.getAttribute('aria-checked')}`);
    return (await d.getAttribute('aria-checked')) === String(on);
  }
  check('direct apply turned on in Settings (UI)', await setDirect(true));
  const started = await invoke('plan_start', { source: { scenarioId: startStaged.sid }, startDate: today });
  check('plan_start with direct apply allowed: applied', started?.env?.status === 'applied', started?.env?.summary);
  check('direct apply turned off again (UI)', await setDirect(false));

  // 6. a consequential plan edit with a running plan: staged
  const de = await invoke('plan_declare_event', { kind: 'busy', from: today, to: today, note: 'Q5 webmcp' });
  check('plan_declare_event (plan running) staged as pending_user', de?.env?.status === 'pending_user', de?.env?.summary ?? de?.env?.error?.message);
  const ed = await invoke('plan_edit_day', { date: today, patch: { note: 'Q5 webmcp' }, scope: 'day' });
  log(`  plan_edit_day with plan: status=${ed?.env?.status} ${ed?.env?.summary}`);
  const pg = await invoke('plan_get', {});
  log('  plan_get ok', pg?.env?.ok, 'declared event applied?', JSON.stringify(pg?.env ?? {}).includes('Q5 webmcp'));
  check('staged plan edit did not change the plan', !JSON.stringify(pg?.env ?? {}).includes('Q5 webmcp'));
  const pend = await bus('coach.pending');
  const mine = (pend?.output ?? []).filter((p) => p.commandId === 'plan.declareEvent' && JSON.stringify(p.input).includes('Q5 webmcp'));
  check('command bus (coach.pending) lists the staged plan_declare_event', mine.length > 0, mine.map((p) => `${p.status} by ${JSON.stringify(p.actor)}`).join('; '));
  await gotoAgents(page);
  const lt = await page.locator('#agents').getByRole('list', { name: 'Proposals waiting' }).innerText().catch(() => '');
  check('Settings › Agents › Proposals waiting shows it', lt.length > 0, lt.replace(/\s+/g, ' ').slice(0, 200));

  // 7. the logged entries in the app UI
  let seenAt = null;
  for (const path of ['/today', '/progress']) {
    await page.goto(new URL(path, page.url()).href, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    if (path === '/progress') {
      const tb = page.locator('main').getByRole('radio', { name: 'table' }).or(page.locator('main').getByRole('button', { name: 'table' })).first();
      if (await tb.count()) { await tb.click({ force: true }).catch(() => undefined); await page.waitForTimeout(800); }
    }
    const bodyTxt = await page.locator('main').innerText().catch(() => '');
    const hit = bodyTxt.split('\n').filter((l) => /93[.,]7|Q5 webmcp note|\(1 so far\)/.test(l)).join(' / ') || null;
    log(`UI ${path} -> ${new URL(page.url()).pathname}: ${hit ? 'shows ' + JSON.stringify(hit.slice(0, 300)) : 'neither the weigh-in nor the note; text: ' + bodyTxt.slice(0, 400).replace(/\n/g, ' | ')}`);
    if (hit && /93[.,]7|1 so far/.test(hit) && !seenAt) { seenAt = path; await page.getByText(/93[.,]7|1 so far/).first().scrollIntoViewIfNeeded().catch(() => undefined); await page.screenshot({ path: 'qa/screenshots/Q5-webmcp-after-log.png' }); }
  }
  check('logged entry visible in app UI', !!seenAt, seenAt ?? '');

  // 8. switch off → tools removed
  tools.clear();
  await gotoAgents(page);
  for (let i = 0; i < 20 && tools.size === 0; i++) await page.waitForTimeout(250);
  log('tools re-registered after reload:', tools.size);
  const sw = webmcpSwitch(page);
  log('switch before off', await sw.getAttribute('aria-checked'));
  const removedBefore = removed.length;
  await sw.focus(); await page.keyboard.press('Space');
  await page.waitForTimeout(2000);
  log('switch after off', await sw.getAttribute('aria-checked'));
  const left = await page.evaluate(() => Promise.resolve(document.modelContext.getTools()).then((t) => t.length));
  log('page getTools after off', left, 'toolsRemoved entries', removed.length - removedBefore);
  check('switch off removes every tool (getTools empty)', left === 0);
  check('toolsRemoved event fired', removed.length > removedBefore, `${removed.length - removedBefore} entries`);
}
