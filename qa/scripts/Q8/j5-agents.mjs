// J5: agents via the server. Profile A sets up sync, a q8 person joins it, A pairs; Settings › Agents makes agent keys
// (shown once, read from the screen into memory). The raw MCP SDK client (as E26's tests) and Codex (if installed; one
// short `codex exec` with the server given by -c overrides, nothing written to ~/.codex) connect to <server>/mcp, list
// the tools and call today_get and log_steps; the log entry appears in the browser by sync; destructive tools are absent
// and refused by name; an edit returns a proposal that reaches the browser; a revoked key gets 401.
//   node qa/scripts/Q8/j5-agents.mjs            (Q8_CODEX=0 skips Codex)
import { execFile, spawn as spawnChild } from 'node:child_process';
const require_child = () => ({ spawn: spawnChild });
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { results, ROOT, SERVER, openProfile, go, read, pairByCode, addPerson, pairCode, setUpSync, serverCall, sleep, closeBrowser, log, shot, scrub } from './lib.mjs';

const req = createRequire(join(ROOT, 'packages/companion/package.json'));
const { Client } = await import(pathToFileURL(req.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
const { StreamableHTTPClientTransport } = await import(pathToFileURL(req.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')).href);

async function connect(token, name = 'q8-sdk') {
  const c = new Client({ name, version: '1.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${SERVER}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return c;
}
const envelope = (r) => { try { return JSON.parse(r.content?.[0]?.text ?? '{}'); } catch { return { raw: r.content?.[0]?.text }; } };

async function makeKey(p, client, name, scope) {
  await go(p, '/settings?section=agents');
  await p.page.getByRole('button', { name: 'Make an agent key' }).first().click();
  const sel = p.page.getByLabel('agent', { exact: true });
  if ((await sel.evaluate((e) => e.tagName)) === 'SELECT') await sel.selectOption(client);
  else { await sel.click(); await p.page.getByRole('option', { name: client === 'claude' ? 'Claude Code' : client === 'codex' ? 'Codex' : 'Another agent' }).click(); }
  await p.page.getByLabel('name', { exact: true }).fill(name);
  await p.page.locator(`input[type=radio][name="agent-scope"][value="${scope}"]`).check({ force: true });
  await p.page.getByRole('button', { name: 'Make key', exact: true }).click();
  const code = p.page.locator('code[aria-label="key"]');
  await code.waitFor({ timeout: 30000 });
  const token = (await code.innerText()).trim();
  const region = (await p.page.getByRole('region', { name: /Your agent key/ }).innerText()).replace(/\s+/g, ' ');
  return { token, region };
}
async function closeShownOnce(p) {
  const done = p.page.getByRole('region', { name: /Your agent key/ }).getByRole('button', { name: 'Done' });
  if (await done.count()) await done.click();
}

function codexRun(token, prompt) {
  return new Promise((resolve) => {
    const { spawn } = require_child();
    const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only',
      '-c', `mcp_servers.vitals_q8.url="${SERVER}/mcp"`, '-c', 'mcp_servers.vitals_q8.bearer_token_env_var="VITALS_TOKEN"',
      '-c', 'mcp_servers.vitals_q8.default_tools_approval_mode="approve"', prompt];
    // stdin closed: codex exec otherwise waits for more input
    const ch = spawn('codex', args, { cwd: `${ROOT}/.e6-tmp`, env: { ...process.env, VITALS_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    ch.stdout.on('data', (d) => (out += d));
    ch.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => ch.kill('SIGTERM'), 300000);
    ch.on('close', (code) => { clearTimeout(timer); resolve({ code, out: scrub(out, [token]) }); });
  });
}

export async function run() {
  const { check, save } = results('J5-agents');
  const A = await openProfile('j5-a');
  let id = null;
  const secrets = [];
  try {
    const phrase = await setUpSync(A);
    secrets.push(phrase);
    id = await addPerson('q8-j5', phrase);
    check('A paired by code', await pairByCode(A, await pairCode(id, 'Q8 J5 A'), undefined, 'Q8 J5 A'));
    const today = (await read(A, 'today.get', {}).catch(() => null))?.date ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    // keys made in Settings › Agents
    const claude = await makeKey(A, 'claude', 'Q8 Claude Code', 'log');
    secrets.push(claude.token);
    check('Settings › Agents: a log key is shown once', claude.token.length >= 32, `${claude.token.length} chars`);
    check('the Claude Code recipe uses the server’s MCP address and VITALS_TOKEN, never the key itself', /claude mcp add --transport http/.test(claude.region) && claude.region.includes(`${SERVER}/mcp`) && /VITALS_TOKEN/.test(claude.region) && claude.region.split(claude.token).length === 2, scrub(claude.region, secrets).slice(0, 300));
    await shot(A, 'J5-agent-key-1440');
    await closeShownOnce(A);
    const edit = await makeKey(A, 'codex', 'Q8 Codex', 'edit');
    secrets.push(edit.token);
    await closeShownOnce(A);
    const list = await serverCall(A, 'GET', '/v1/agents/tokens');
    check('server lists both agent keys (no key values)', list.status === 200 && list.body.tokens?.filter((t) => /^Q8 /.test(t.label)).length === 2 && !JSON.stringify(list.body).includes(claude.token), JSON.stringify(list.body.tokens?.map((t) => [t.label, t.scope, t.client])));

    // the raw MCP SDK client, log scope (what `claude mcp add` connects with)
    const c = await connect(claude.token, 'claude-code-q8');
    const listed = (await c.listTools()).tools;
    const tools = listed.map((t) => t.name);
    check(`log key lists tools (${tools.length}) incl. today_get and log_steps`, tools.includes('today_get') && tools.includes('log_steps'), tools.slice(0, 12).join(','));
    // delete/remove tools that are restorable (food_delete_recipe, pantry_remove…) are write tools with undo, not destructive
    const destructive = listed.filter((t) => t.annotations?.destructiveHint === true).map((t) => t.name);
    check('no destructive tool listed (destructiveHint, data_erase_all, plan_end)', destructive.length === 0 && !tools.includes('data_erase_all') && !tools.includes('plan_end'), destructive.join(','));
    check('log key lists no edit tools (profile_patch absent)', !tools.includes('profile_patch'));
    const t = envelope(await c.callTool({ name: 'today_get', arguments: {} }));
    check('today_get runs on the server (date in the person’s time zone)', t.ok === true && JSON.stringify(t).includes(today), JSON.stringify(t).slice(0, 160));
    const steps = 4000 + Math.floor(Math.random() * 999);
    const l = envelope(await c.callTool({ name: 'log_steps', arguments: { date: today, steps } }));
    check('log_steps applied directly with a change id (undo possible)', l.ok === true && l.status === 'applied' && Boolean(l.changeId), JSON.stringify(l).slice(0, 200));
    const d = envelope(await c.callTool({ name: 'data_erase_all', arguments: {} }).catch((e) => ({ content: [{ text: JSON.stringify({ ok: false, error: { message: e.message } }) }] })));
    check('a destructive tool called by name is refused', d.ok === false, JSON.stringify(d).slice(0, 160));
    await c.close();
    let inBrowser = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) { if (JSON.stringify(await read(A, 'log.get', { from: today, to: today })).includes(String(steps))) { inBrowser = true; break; } await sleep(500); }
    check(`the agent’s log entry appears in the browser by sync (${((Date.now() - t0) / 1000).toFixed(1)} s)`, inBrowser);

    // edit scope: a proposal, not a change
    const e = await connect(edit.token, 'codex-q8-sdk');
    const etools = (await e.listTools()).tools.map((x) => x.name);
    check('edit key lists edit tools (profile_patch) and still no destructive one', etools.includes('profile_patch') && !etools.includes('data_erase_all') && !etools.includes('plan_end'), `${etools.length} tools`);
    const before = JSON.stringify(await read(A, 'profile.get', {}).catch(() => ({})));
    const pr = envelope(await e.callTool({ name: 'profile_patch', arguments: { figure: { frame: 0.9 } } }));
    check('an edit returns a proposal (pending_user), not a change', pr.status === 'pending_user' && Boolean(pr.changeId), JSON.stringify(pr).slice(0, 200));
    await e.close();
    let pend = false;
    const t1 = Date.now();
    while (Date.now() - t1 < 30000) { if (JSON.stringify(await read(A, 'coach.pending', {})).includes(pr.changeId ?? '__none')) { pend = true; break; } await sleep(500); }
    check('the proposal reaches the browser (coach.pending) by sync', pend);
    check('the profile is unchanged until the person applies it', JSON.stringify(await read(A, 'profile.get', {}).catch(() => ({}))) === before);

    // Codex (if installed): one short prompt, tools approved for this server only
    if (process.env.Q8_CODEX !== '0') {
      const which = await new Promise((r) => execFile('which', ['codex'], (err) => r(!err)));
      if (which) {
        const r = await codexRun(edit.token, 'Use the vitals_q8 MCP server: call its today_get tool and print only the date it returns.');
        const act = await serverCall(A, 'GET', '/v1/agents/activity');
        const editId = list.body.tokens?.find((x) => x.label === 'Q8 Codex')?.id;
        const ran = (act.body.calls ?? act.body.activity ?? act.body ?? []).filter?.((x) => x.tool === 'today_get' && x.tokenId === editId) ?? [];
        check('Codex: today_get ran on the server with the agent key (server activity log)', ran.length > 0, `exit ${r.code}; ${r.out.split('\n').filter((x) => /\d{4}-\d{2}-\d{2}|error|vitals/i.test(x)).slice(-4).join(' / ').slice(0, 300)}`);
        check('Codex printed today’s date', r.out.includes(today), r.out.slice(-200));
      } else check('Codex not installed (skipped)', true);
    }
    const act = await serverCall(A, 'GET', '/v1/agents/activity');
    check('activity log holds calls without arguments', act.status === 200 && !JSON.stringify(act.body).includes(String(steps)), JSON.stringify(act.body).slice(0, 200));

    // revoke the log key in Settings › Agents → 401
    await go(A, '/settings?section=agents');
    // the Server page lists agent keys among the devices too; the Agents card is the one under test
    const agentsCard = A.page.locator('section#agents, [data-section="agents"], main').first();
    const rv = agentsCard.getByRole('button', { name: 'Revoke Q8 Claude Code' }).last();
    await rv.waitFor({ timeout: 60000 });
    await rv.scrollIntoViewIfNeeded();
    await rv.click();
    const dlg = A.page.getByRole('alertdialog');
    if (!(await dlg.waitFor({ timeout: 15000 }).then(() => true, () => false))) {
      await rv.click({ force: true }); // a re-render swallowed the first click
      await dlg.waitFor({ timeout: 15000 });
    }
    await shot(A, 'J5-revoke-dialog-1440');
    const dlgText = await dlg.innerText().catch(() => '(no dialog)');
    log(`revoke dialog: ${dlgText.replace(/\s+/g, ' ').slice(0, 200)}; buttons: ${(await dlg.getByRole('button').allInnerTexts().catch(() => [])).join(' | ')}`);
    await dlg.getByRole('button', { name: /^(Revoke|Revoke key)$/ }).click({ timeout: 15000 });
    await sleep(2000);
    const r401 = await fetch(`${SERVER}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${claude.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }) });
    const b401 = await r401.json().catch(() => ({}));
    check('a revoked agent key gets 401 revoked', r401.status === 401 && JSON.stringify(b401).includes('revoked'), `${r401.status} ${JSON.stringify(b401).slice(0, 120)}`);
  } catch (e) { check('journey ran to the end', false, scrub(e.message.split('\n')[0], secrets)); }
  check('no page errors', A.errors.filter((x) => x.startsWith('pageerror')).length === 0, A.errors.join(' | ').slice(0, 300));
  await A.ctx.close();
  return { rows: save({ person: 'q8-j5' }), id };
}
if (process.argv[1]?.endsWith('j5-agents.mjs')) { const { rows } = await run(); await closeBrowser(); log(`${rows.filter((r) => r.ok).length}/${rows.length} passed`); }
