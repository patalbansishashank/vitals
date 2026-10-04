// Q5: agent journeys against the production build (plan 02 items 3 and 12).
// One fresh browser context runs Vitals (production build via `vite preview`, CSP on), pairs with a freshly started
// local Companion and turns on "agents on this computer". A plan is started (staged by an agent, applied in
// Settings › Agents). Then each agent CLI reads today's plan, logs a note and declares a busy day (a plan edit that
// must come back staged). Every result is asserted through the app's read-only command-bus hook (window.__vitals,
// `?qa=1`) and in Settings › Agents › Proposals waiting. WebMCP runs in its own context (webmcp.mjs).
//
// usage: node qa/scripts/Q5/run.mjs [--only codex,opencode,claude,chatgpt,webmcp] [--no-build-check]
// needs: .e6-tmp/dist-Q5 (npx vite build --outDir .e6-tmp/dist-Q5); port 5193 and 4870 free.
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { BASE, PORT, COMPANION, OUT, SHOTS, TMP, WRAPPER, DESTRUCTIVE, ROOT, strip, today, sleep, waitHttp, startProc, runCmd, companionCall, companionStatus, mcpTools, table, save } from './lib.mjs';
import { agentRuns } from './agents.mjs';

const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg > 0 ? process.argv[onlyArg + 1].split(',') : ['codex', 'opencode', 'claude', 'chatgpt', 'webmcp'];
const RUN = Date.now().toString(36).slice(-5);
const DAY = today();
const rows = [];
const check = (name, ok, detail = '') => { rows.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + String(detail).slice(0, 300) : ''}`); };
const procs = [];
const cleanup = () => { for (const p of procs.reverse()) p.stop(); };
process.on('SIGINT', () => { cleanup(); process.exit(130); });

let browser;
try {
  /* 0. production build served with the production headers */
  if (!existsSync(`${ROOT}/.e6-tmp/dist-Q5/index.html`)) throw new Error('build first: npx vite build --outDir .e6-tmp/dist-Q5');
  procs.push(startProc('preview', 'npx', ['vite', 'preview', '--outDir', '.e6-tmp/dist-Q5', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1']));
  const home = await waitHttp(`${BASE}/`, 90000);
  const csp = home.headers.get('content-security-policy') || '';
  check('preview serves the production CSP', /default-src 'self'/.test(csp) && /connect-src[^;]*http:\/\/127\.0\.0\.1:\*/.test(csp), csp.slice(0, 160));

  /* 1. a freshly started Companion (proxy role) */
  const pre = await fetch(`${COMPANION}/health`).then(() => true, () => false);
  check('no Companion was running before the run (clean start)', !pre);
  procs.push(startProc('companion', WRAPPER, ['proxy']));
  const health = await (await waitHttp(`${COMPANION}/health`, 30000)).json();
  check('Companion proxy answers /health', health?.version && health.roles?.includes('proxy'), JSON.stringify(health));

  /* 2. a fresh browser context: first run, pair, agents on */
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('vitals.qa', '1'); } catch { /* none */ } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const httpErrors = [];
  page.on('response', (r) => { if (r.status() >= 400) httpErrors.push(`${r.status()} ${r.request().method()} ${r.url().replace(/\?.*/, '')}`); });
  process.env.BASE = BASE;
  const { firstRun } = await import('../set/lib.mjs');
  await firstRun(page);
  const hook = await page.evaluate(() => (window.__vitals ? { readOnly: window.__vitals.readOnly, n: window.__vitals.commands().length } : null));
  check('read-only command-bus hook present (?qa=1)', hook?.readOnly === true && hook.n > 10, JSON.stringify(hook));
  const read = (id, input = {}) => page.evaluate(([i, a]) => window.__vitals.read(i, a), [id, input]);

  const agents = () => page.locator('#agents');
  async function gotoAgents() {
    await page.goto(`${BASE}/settings?r=${Date.now().toString(36)}#agents`, { waitUntil: 'networkidle' });
    await agents().scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
  }
  await gotoAgents();
  const look = agents().getByRole('button', { name: /Look for the Companion|Check again/ });
  if (await look.count()) await look.first().click();
  await page.waitForTimeout(1500);
  const pr = await runCmd(WRAPPER, ['pair']);
  const code = /Pairing code: (\d{8})/.exec(pr.stdout)?.[1];
  check('vitals-companion pair prints a code', !!code, code ? '8 digits' : strip(pr.stdout + pr.stderr).slice(0, 200));
  await agents().getByLabel('pairing code').fill(code);
  await agents().getByRole('button', { name: 'Pair' }).click();
  await page.waitForTimeout(2000);
  const bridge = agents().getByRole('switch', { name: 'agents on this computer' });
  if ((await bridge.getAttribute('aria-checked')) !== 'true') await bridge.check({ force: true });
  let st;
  for (let i = 0; i < 30; i++) { st = await companionStatus().catch(() => null); if (st?.tab?.connected) break; await sleep(500); }
  check('tab paired and connected to the Companion', st?.tab?.connected === true, `toolCount=${st?.tab?.toolCount}`);

  /* 3. the MCP tool list an agent sees */
  const tools = await mcpTools();
  save('mcp-tools-list.json', tools.map((t) => ({ name: t.name, readOnlyHint: t.annotations?.readOnlyHint, destructiveHint: t.annotations?.destructiveHint })));
  const destr = tools.filter((t) => DESTRUCTIVE.includes(t.name) || t.annotations?.destructiveHint === true).map((t) => t.name);
  check('MCP tools/list has no destructive tool', tools.length > 50 && destr.length === 0, `${tools.length} tools; destructive: ${destr.join(',') || 'none'}`);

  /* 4. a running plan: an agent proposes plan_start (staged), the person applies it in Settings › Agents */
  const sc = await companionCall('scenario_ensure_active', {});
  const sid = sc?.envelope?.data?.scenarioId ?? sc?.envelope?.data?.id;
  save('setup-scenario.json', sc);
  save('setup-starter.json', await companionCall('scenario_apply_starter', { id: sid, starter: 'maintenance8' }));
  const ps = await companionCall('plan_start', { source: { scenarioId: sid }, startDate: DAY });
  save('setup-plan-start.json', ps);
  const psStatus = ps?.envelope?.status;
  check('plan_start by an agent is staged (pending_user)', psStatus === 'pending_user', JSON.stringify(ps).slice(0, 200));
  await gotoAgents();
  const list = agents().getByRole('list', { name: 'Proposals waiting' });
  check('Settings › Agents lists the staged plan start', await list.count() && (await list.innerText()).length > 0, (await list.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200));
  await list.getByRole('button', { name: 'Apply' }).first().click();
  await page.waitForTimeout(2500);
  const plan0 = await read('plan.get');
  check('applied in the app: plan.get shows a running plan', plan0?.ok && plan0.output?.plan?.status === 'active', JSON.stringify(plan0?.output?.plan ?? plan0).slice(0, 200));
  save('setup-plan-get.json', plan0);

  /* 5. agents */
  for (const a of agentRuns.filter((x) => ONLY.includes(x.id))) {
    console.log(`\n== ${a.id}`);
    const tag = `Q5 ${a.id} ${RUN}`;
    const r = await a.run({ tag, day: DAY, dir: `${TMP}/Q5-${a.id}` });
    save(`${a.id}-transcript.${a.ext}`, r.transcript);
    save(`${a.id}-final.txt`, r.final ?? '');
    writeFileSync(`${OUT}/${a.id}.cmd`, `$ ${r.cmdline}\n# exit ${r.code} in ${Math.round(r.ms / 1000)} s\n`);
    if (r.skipped) { check(`${a.id}: run`, false, r.skipped); continue; }
    check(`${a.id}: process exit 0`, r.code === 0, `exit ${r.code}, ${Math.round(r.ms / 1000)} s; ${strip(r.stderr || '').slice(-200)}`);
    const calls = r.calls ?? [];
    check(`${a.id}: read today's plan (today_get/plan_get)`, calls.some((c) => /today_get|plan_get/.test(c)), calls.join(', '));
    if (r.toolNames) {
      const bad = r.toolNames.filter((n) => DESTRUCTIVE.some((d) => n.endsWith(d)));
      check(`${a.id}: tool list as loaded has no destructive tool`, r.toolNames.length > 50 && bad.length === 0, `${r.toolNames.length} vitals tools; destructive: ${bad.join(',') || 'none'}`);
    }
    const log = await read('log.get', { from: DAY, to: DAY });
    check(`${a.id}: note appears in Vitals (log.get)`, log?.ok && JSON.stringify(log.output).includes(tag), '');
    const pend = await read('coach.pending');
    const mine = (pend?.output ?? []).filter((p) => JSON.stringify(p.input ?? {}).includes(tag));
    check(`${a.id}: plan edit staged as a proposal (coach.pending)`, mine.length > 0 && mine.every((p) => p.status === 'pending'), mine.map((p) => `${p.commandId}/${p.status}/${p.actor?.kind ?? ''}:${p.actor?.id ?? ''}`).join('; ') || JSON.stringify(pend).slice(0, 200));
    const pl = await read('plan.get');
    check(`${a.id}: staged edit did not change the plan`, pl?.ok && !JSON.stringify(pl.output).includes(tag));
    await gotoAgents();
    const lt = await agents().getByRole('list', { name: 'Proposals waiting' }).innerText().catch(() => '');
    const row = lt.split(/(?=Declare an event)/).find((x) => x.includes(tag)) ?? '';
    check(`${a.id}: proposal visible in Settings › Agents with what it changes`, mine.length > 0 && row.includes(tag) && /kind busy/.test(row), row.replace(/\s+/g, ' ').slice(0, 220));
    check(`${a.id}: agent says plan_end/plan_replace are not available`, /(not|n't|neither|no)\b[^.]{0,80}(available|exist|present|have)|neither/i.test(r.final ?? '') && !calls.some((c) => /plan_end|plan_replace/.test(c)), (r.final ?? '').replace(/\s+/g, ' ').slice(-200));
  }

  /* 6. the proposals and the logged notes at three sizes */
  const hadProposals = ((await read('coach.pending'))?.output ?? []).length > 0;
  await gotoAgents();
  for (const [w, h, n] of [[1440, 900, 'desktop'], [768, 1024, 'tablet'], [390, 844, 'mobile']]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(600);
    const l = agents().getByRole('list', { name: 'Proposals waiting' });
    const vis = await l.isVisible().catch(() => false);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`Settings › Agents at ${w}x${h}: no horizontal overflow${vis ? ', proposals list visible' : ''}`, ov <= 1 && (vis || !hadProposals), `horizontal overflow ${Math.max(ov, 0)}px; proposals list ${vis ? 'visible' : 'absent'}`);
    if (!vis) await agents().screenshot({ path: `${SHOTS}/Q5-agents-${n}.png` }).catch(() => undefined);
    if (vis) await l.screenshot({ path: `${SHOTS}/Q5-proposals-${n}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/today`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/Q5-today-after-agents.png` });
  const relevant = errors.filter((e) => !/Failed to load resource: the server responded with a status of 40[14]/.test(e));
  check('no uncaught page error or console error in the Vitals tab', relevant.length === 0, relevant.slice(0, 3).join(' / '));
  save('tab-console.json', { errors, httpErrors });
  const finalStatus = await companionStatus().catch(() => null);
  save('companion-status.json', { tab: finalStatus?.tab, mcpClients: finalStatus?.mcpClients, agents: finalStatus?.agents });
  await browser.close(); browser = null;

  /* 7. WebMCP in its own fresh context */
  if (ONLY.includes('webmcp')) {
    const w = await runCmd('node', ['qa/scripts/Q5/webmcp.mjs'], { env: { ...process.env, BASE }, timeoutMs: 420000 });
    save('webmcp-run.log', w.stdout + w.stderr);
    const fails = (w.stdout.match(/^FAIL .*/gm) || []);
    const passes = (w.stdout.match(/^PASS .*/gm) || []).length;
    check('WebMCP in Chromium 153 (webmcp.mjs)', w.code === 0 && fails.length === 0 && passes > 10, `${passes} pass, ${fails.length} fail ${fails.join(' / ').slice(0, 200)}`);
  }
} catch (e) {
  check('run completed without an exception', false, e.stack?.split('\n').slice(0, 3).join(' '));
} finally {
  if (browser) await browser.close().catch(() => undefined);
  cleanup();
}
const t = table(rows);
console.log('\n' + t);
writeFileSync(`${OUT}/run-table.md`, `# Q5 run ${new Date().toISOString()} (run tag ${RUN})\n\n${t}\n`);
process.exit(rows.every((r) => r.ok) ? 0 : 1);
