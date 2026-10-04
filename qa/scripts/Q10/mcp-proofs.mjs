import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
const ROOT = resolve(new URL('../../..', import.meta.url).pathname);
const TMP = join(ROOT, '.e6-tmp', 'q10-mcp');
const REL = resolve(process.env.SERVER_DIR || join(ROOT, '.e6-tmp/srv'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true, mode: 0o700 });
const port = await freePort();
const BASE = `http://127.0.0.1:${port}`;
cpSync(join(ROOT, 'qa/scripts/Q10/mcp-server.mjs'), join(REL, 'q10-mcp-server.mjs'));
const srv = spawn(process.execPath, ['q10-mcp-server.mjs'], { cwd: REL, stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, MCP_CFG: JSON.stringify({ port, dataDir: join(TMP, 'data'), origin: BASE, app: join(ROOT, 'dist') }) } });
const waiters = []; let ready; const readyP = new Promise((r) => (ready = r)); const slog = []; let buf = '';
srv.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.startsWith('READY ')) ready(l); else if (l.startsWith('CTRL ')) waiters.shift()?.(JSON.parse(l.slice(5))); else slog.push(l); } });
srv.stderr.on('data', (d) => slog.push(`stderr ${String(d).trim().slice(0, 300)}`));
const ctrl = (m) => new Promise((r) => { waiters.push(r); srv.stdin.write(`${JSON.stringify(m)}\n`); });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 300) }); };
let mcpClients = [];
async function cleanup() {
  for (const c of mcpClients) await c.close().catch(() => {});
  try { srv.stdin.write('{"op":"close"}\n'); await sleep(500); } catch { /* gone */ }
  srv.kill('SIGKILL');
  rmSync(join(REL, 'q10-mcp-server.mjs'), { force: true });
  rmSync(TMP, { recursive: true, force: true });
}
try {
  await Promise.race([readyP, sleep(60000).then(() => { throw new Error(`server did not start: ${slog.join(' | ')}`); })]);
  const sdk = join(REL, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client');
  const { Client } = await import(`${sdk}/index.js`);
  const { StreamableHTTPClientTransport } = await import(`${sdk}/streamableHttp.js`);
  const mk = async (token) => {
    const c = new Client({ name: 'q10', version: '1.0.0' });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : {} }));
    mcpClients.push(c); return c;
  };
  const people = {};
  for (const l of ['A', 'B']) people[l] = (await ctrl({ op: 'addPerson', label: `Q10 ${l}`, tz: 'Europe/Zurich', secretHex: randomBytes(32).toString('hex') })).id;
  check('two persons added', people.A && people.B, 'ids not printed');
  const pj = async (path, token, body, method = 'POST') => { const r = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { status: r.status, j }; };
  const device = async (p) => { const { code } = await ctrl({ op: 'code', person: p, label: 'q10' }); const r = await pj('/v1/pair/device', null, { code, label: 'q10' }); return r.j.token; };
  const devA = await device(people.A), devB = await device(people.B);
  const mint = async (dev, scope) => { const r = await pj('/v1/agents/tokens', dev, { client: 'other', scope, label: `q10-${scope}` }); return r.j; };
  const tkA = await mint(devA, 'edit'), tkARead = await mint(devA, 'read'), tkLog = await mint(devA, 'log');
  check('agent tokens issued through POST /v1/agents/tokens', tkA.token && tkA.mcpUrl, `scopes edit/read/log; mcpUrl ${String(tkA.mcpUrl).replace(/\d{4,5}/, 'PORT')}`);

  // tools/list
  const listAll = async (c) => { const all = []; let cursor; do { const r = await c.listTools(cursor ? { cursor } : {}); all.push(...r.tools); cursor = r.nextCursor; } while (cursor); return all; };
  const cE = await mk(tkA.token); const toolsE = await listAll(cE); const names = toolsE.map((t) => t.name);
  mkdirSync(join(ROOT, 'qa/results'), { recursive: true });
  writeFileSync(join(ROOT, 'qa/results/Q10-mcp-tools.json'), JSON.stringify({ scope: 'edit', count: names.length, tools: toolsE.map((t) => ({ name: t.name, description: t.description, annotations: t.annotations, inputSchema: t.inputSchema })) }, null, 1));
  check('tools/list returns the manifest tools', names.length > 20, `${names.length} tools (edit scope), saved to qa/results/Q10-mcp-tools.json`);
  const DESTRUCTIVE = ['plan_end', 'plan_replace', 'coach_delete', 'bio_delete_source', 'data_import', 'data_erase_all', 'sync_unpair'];
  const cR = await mk(tkARead.token), cL = await mk(tkLog.token);
  const nR = (await listAll(cR)).map((t) => t.name), nL = (await listAll(cL)).map((t) => t.name);
  check('destructive tools not listed (any scope)', ![...names, ...nR, ...nL].some((n) => DESTRUCTIVE.includes(n)), `edit ${names.length} / log ${nL.length} / read ${nR.length} tools`);
  const refused = [];
  for (const d of DESTRUCTIVE) { let out; try { const r = await cE.callTool({ name: d, arguments: {} }); out = r.isError ? 'refused' : 'RAN'; } catch { out = 'refused'; } refused.push(`${d}:${out}`); }
  check('destructive tool calls refused', refused.every((x) => x.endsWith('refused')), refused.join(' '));
  check('scopes narrow the list (read < log < edit)', nR.length < nL.length && nL.length < names.length, `${nR.length} < ${nL.length} < ${names.length}`);
  await runMore({ cE, cR, cL, names, nR, nL, tkA, tkLog, tkARead, devA, devB, people, pj, mk, ctrl, check, BASE });
} catch (e) { check('script error', false, e?.stack?.split('\n').slice(0, 3).join(' ') ?? e); }
finally {
  await cleanup();
  writeFileSync(join(ROOT, 'qa/results/Q10-mcp.json'), JSON.stringify(results, null, 1));
  const w = Math.max(...results.map((r) => r.name.length));
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(w)}  ${r.detail.slice(0, 110)}`);
  console.log(`${results.filter((r) => r.ok).length} pass, ${results.filter((r) => !r.ok).length} fail`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
async function runMore(x) {
  const { cE, cR, cL, tkA, tkLog, tkARead, devA, devB, people, pj, mk, ctrl, check, BASE } = x;
  const td = new Date().toLocaleDateString('en-CA');
  const env = (r) => { try { return JSON.parse(r.content[0].text); } catch { return { raw: r.content?.[0]?.text }; } };
  const disp = async (person, command, input, source) => (await ctrl({ op: 'dispatch', person, command, input, source })).res?.value;
  // a plan for A (scenario starter, applied as the person would in the app) and for B (so B has data of its own)
  for (const p of [people.A]) {
    await disp(p, 'scenario.ensureActive', {});
    const st = await disp(p, 'plan.start', { source: { scenarioId: 'starter' }, startDate: td });
    const ap = await disp(p, 'coach.applyPending', { pendingId: st.pending.pendingId }, 'ui');
    check('setup: person plan started (as the app would apply it)', ap?.ok, ap?.ok ? 'plan active' : JSON.stringify(ap).slice(0, 150));
  }
  // reads
  const pg = env(await cE.callTool({ name: 'plan_get', arguments: {} }));
  check('read: plan_get returns the running plan', pg.ok && pg.data?.plan?.status === 'active', `day ${pg.data?.plan?.day} of ${pg.data?.plan?.of}`);
  const tg = env(await cE.callTool({ name: 'today_get', arguments: { date: td } }));
  check('read: today_get works', tg.ok === true, tg.summary);
  const lg0 = env(await cE.callTool({ name: 'log_get', arguments: { from: td, to: td } }));
  check('read: log_get works', lg0.ok === true, tg.summary);
  // read scope: a log call is not available
  let rn; try { const r = await cR.callTool({ name: 'log_note', arguments: { text: 'x' } }); rn = r.isError ? 'refused' : 'RAN'; } catch { rn = 'refused'; }
  check('read-scope token cannot log', rn === 'refused', rn);
  // log class: direct apply, verified server-side
  const marker = `q10-note-${Date.now()}`;
  const nt = env(await cE.callTool({ name: 'log_note', arguments: { text: marker, date: td } }));
  check('log: log_note applied directly', nt.ok && nt.status === 'applied', nt.status);
  const logSrv = JSON.stringify(await disp(people.A, 'log.get', { from: td, to: td }));
  const logSrv2 = logSrv.includes(marker) ? logSrv : JSON.stringify(await disp(people.A, 'day.get', { date: td }));
  check('log: note is in the person document (server-side dispatch read)', logSrv.includes(marker) || logSrv2.includes(marker), logSrv.includes(marker) ? 'found via log.get' : logSrv2.includes(marker) ? 'found via day.get' : logSrv.slice(0, 120));
  const logB = JSON.stringify(await disp(people.B, 'log.get', { from: td, to: td }));
  check("isolation: person B's log has no trace of A's note", !logB.includes(marker), 'B read through server dispatch');
  const lgv = env(await cL.callTool({ name: 'log_steps', arguments: { steps: 4321, date: td } }));
  check('log: log-scope token can log steps', lgv.ok && lgv.status === 'applied', lgv.status);
  // edit class: staged
  const planOf = async () => env(await cE.callTool({ name: 'plan_get', arguments: {} })).data?.plan;
  const before = JSON.stringify(await planOf());
  const ed = env(await cE.callTool({ name: 'plan_pause', arguments: { from: td, until: new Date(Date.now() + 3 * 864e5).toLocaleDateString('en-CA'), reason: 'q10 busy days' } }));
  check('edit: plan_pause (busy stretch) comes back staged as a proposal', ed.status === 'pending_user' && ed.ok, `status ${ed.status}; ${(ed.summary || '').slice(0, 100)}`);
  const pendingId = ed.data?.pendingId ?? ed.data?.pending?.pendingId ?? ed.pendingId ?? ed.pending?.pendingId;
  check('edit: plan unchanged before the person applies it', before === JSON.stringify(await planOf()) && (await planOf()).pauses.length === 0, 'plan_get identical, no pause');
  const pend = JSON.stringify(await disp(people.A, 'coach.pending', {}, 'ui'));
  check('edit: proposal is waiting in coach.pending (server-side read)', pend.includes('plan.pause'), pend.slice(0, 100));
  const pid2 = pendingId ?? /"pendingId":"([^"]+)"/.exec(pend)?.[1];
  const agentApply = await disp(people.A, 'coach.applyPending', { pendingId: pid2 }, 'agent');
  check('edit: an agent-sourced apply is refused', agentApply?.ok === false, agentApply?.error?.code);
  const ap2 = await disp(people.A, 'coach.applyPending', { pendingId: pid2 }, 'ui');
  const after = await planOf();
  check('edit: applied by the person (ui), the plan then changes', ap2?.ok && after.pauses.length === 1, `pauses ${after.pauses.length}`);
  // plan_edit_day is a browser-only (Planner) command
  const ped = env(await cE.callTool({ name: 'plan_edit_day', arguments: { date: td, scope: 'day', patch: { energyKcal: 1500 } } }));
  const namesAfter = (await (async () => { const all = []; let c; do { const r = await cE.listTools(c ? { cursor: c } : {}); all.push(...r.tools); c = r.nextCursor; } while (c); return all.map((t) => t.name); })());
  check('edit: plan_edit_day (needs the Planner) is rejected cleanly, no change', ped.ok === false && !JSON.stringify(await planOf()).includes('1500'), `${ped.error?.code}: ${(ped.summary || '').slice(0, 80)}; still listed afterwards: ${namesAfter.includes('plan_edit_day')}`);
  // an edit tool is not on the log-scope list
  check('edit tools absent from the log-scope list', !x.nL.includes('plan_pause') && x.names.includes('plan_pause'), 'plan_pause only in edit scope');
  // auth
  const probe = async (token, extra = {}) => (await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).status;
  check('no token gets 401', (await probe(null)) === 401, `status ${await probe(null)}`);
  check('wrong token gets 401', (await probe('vit_agent_' + 'x'.repeat(40))) === 401, `status ${await probe('x'.repeat(50))}`);
  check('a device token on /mcp is refused', [401, 403].includes(await probe(devA)), `status ${await probe(devA)}`);
  const qs = await fetch(`${BASE}/mcp?token=${encodeURIComponent(tkA.token)}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  check('token in the query string is not accepted', qs.status === 401, `status ${qs.status}`);
  const prov = await fetch(`${BASE}/v1/ai/models`, { headers: { Authorization: `Bearer ${tkA.token}` } });
  check('agent token refused on a device/provider route', [401, 403, 404].includes(prov.status), `status ${prov.status}`);
  const lst = await pj('/v1/agents/tokens', tkA.token, null, 'GET');
  check('agent token cannot manage agent tokens', lst.status === 403 || lst.status === 401, `status ${lst.status}`);
  const dv = await pj('/v1/devices', tkA.token, null, 'GET');
  check('agent token cannot list devices', dv.status === 403 || dv.status === 401, `status ${dv.status}`);
  // a token for A cannot reach B: device of B lists only B's tokens; A's token id is not revocable by B
  const bl = await pj('/v1/agents/tokens', devB, null, 'GET');
  check("person B's token list does not show A's tokens", bl.status === 200 && !(bl.j.tokens ?? []).some((t) => t.id === tkA.id), `B sees ${(bl.j.tokens ?? []).length} tokens`);
  const bd = await fetch(`${BASE}/v1/agents/tokens/${tkA.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${devB}` } });
  check("person B cannot revoke A's agent token", bd.status === 404, `status ${bd.status}`);
  // B's own agent token sees B's data only
  const tkB = (await pj('/v1/agents/tokens', devB, { client: 'other', scope: 'log' })).j;
  const cB = await mk(tkB.token);
  const bnote = env(await cB.callTool({ name: 'log_get', arguments: { from: td, to: td } }));
  check("B's agent token reads B's log, not A's", bnote.ok && !JSON.stringify(bnote).includes(marker), 'no A note visible');
  const pgB = env(await cB.callTool({ name: 'plan_get', arguments: {} }));
  check("B's agent token sees no plan (A's plan is not reachable)", pgB.ok && pgB.data?.plan === null, 'plan null');
  // revoke
  const rv = await fetch(`${BASE}/v1/agents/tokens/${tkLog.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${devA}` } });
  check('revoke: DELETE /v1/agents/tokens/{id} gives 204', rv.status === 204, `status ${rv.status}`);
  const rs = await probe(tkLog.token);
  check('revoked token gets 401', rs === 401, `status ${rs}`);
  let still; try { const r = await cL.callTool({ name: 'log_note', arguments: { text: 'after revoke' } }); still = r.isError ? 'refused' : 'RAN'; } catch { still = 'refused'; }
  check('open session of a revoked token stops working', still === 'refused', still);
  const act = await pj('/v1/agents/activity', devA, null, 'GET');
  check('activity list shows calls without arguments', act.status === 200 && act.j.activity.length > 0 && !JSON.stringify(act.j).includes(marker), `${act.j.activity?.length} entries`);
  // real CLIs (optional)
  check('real agent CLI run: skipped', true, 'not run here (codex/opencode/claude would use their own accounts; covered by E26 live test)');
}
