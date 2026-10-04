// J7: server hygiene against oci-arm, from Node (no browser): every route without a token → 401 in plain words; a
// token in the query string → 401; a foreign Origin → 403; a revoke from the CLI takes effect; the person's data
// directory has 0700 directories and 0600 files (read-only `ls -laR` over ssh).
//   node qa/scripts/Q8/j7-hygiene.mjs
import { results, SERVER, SITE, addPerson, pairCode, devicesRevoke, lsPerson, sleep, log } from './lib.mjs';

const ROUTES = [
  ['GET', '/v1/pair/status'], ['GET', '/v1/devices'], ['DELETE', '/v1/devices/x'], ['POST', '/v1/pair/code'],
  ['GET', '/v1/mqtt/status'], ['POST', '/v1/mqtt/credentials'],
  ['GET', '/v1/ai/status'], ['PUT', '/v1/ai/keys/nim'], ['DELETE', '/v1/ai/keys/nim'], ['GET', '/v1/ai/siwc/status'], ['POST', '/v1/ai/siwc/logout'],
  ['GET', '/v1/ai/nim/models'], ['GET', '/v1/ai/nim/probe'], ['POST', '/v1/ai/nim/chat/completions'], ['GET', '/v1/ai/usage'],
  ['GET', '/v1/agents/tokens'], ['POST', '/v1/agents/tokens'], ['GET', '/v1/agents/activity'], ['POST', '/mcp'], ['GET', '/mcp'],
];
const UNAUTH = new Set([
  'This device is no longer connected to your server. Connect it again in Settings › Server.',
]);
async function call(method, route, { token, origin, body, query = '' } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;
  if (body !== undefined || ['POST', 'PUT'].includes(method)) headers['content-type'] = 'application/json';
  if (route === '/mcp') headers.accept = 'application/json, text/event-stream';
  const r = await fetch(`${SERVER}${route}${query}`, { method, headers, body: ['POST', 'PUT'].includes(method) ? JSON.stringify(body ?? {}) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* text */ }
  return { status: r.status, json, text, acao: r.headers.get('access-control-allow-origin') };
}
const codeOf = (j) => (typeof j?.error === 'string' ? j.error : j?.error?.code);
const msgOf = (j) => (typeof j?.error === 'object' ? j.error.message : j?.message);

export async function run({ person = null } = {}) {
  const { check, save } = results('J7-hygiene');
  const id = person ?? (await addPerson('q8-j7'));
  let token = null;
  try {
    const h = await fetch(`${SERVER}/health`).then((r) => r.json());
    check('/health answers without a token (version and role only)', h.role === 'home' && !JSON.stringify(h).match(/q8-|token|key/i), JSON.stringify(h));
    // a device token for this person, paired from Node (no Origin header)
    const code = await pairCode(id, 'Q8 J7 node');
    const p = await fetch(`${SERVER}/v1/pair/device`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, label: 'Q8 J7 node' }) });
    const pj = await p.json();
    token = pj.token;
    check('paired from Node by code (no Origin)', p.status === 200 && typeof token === 'string', `${p.status}`);
    const again = await fetch(`${SERVER}/v1/pair/device`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, label: 'again' }) });
    check('a used code is refused (single use)', again.status >= 400 && again.status < 500, String(again.status));

    const noTok = [];
    for (const [m, r] of ROUTES) {
      const a = await call(m, r);
      noTok.push({ route: `${m} ${r}`, status: a.status, code: codeOf(a.json), message: msgOf(a.json) ?? null });
    }
    const bad = noTok.filter((x) => x.status !== 401 || x.code !== 'unauthorized');
    check(`every route without a token → 401 unauthorized (${noTok.length} routes)`, bad.length === 0, JSON.stringify(bad));
    const distinct = [...new Set(noTok.map((x) => x.message))];
    const words = distinct.filter((m) => !m || /proxy|preset|token|MCP|Companion|\/v1\/|§/i.test(m));
    check(`401 messages are plain words (${distinct.length} distinct: ${distinct.join(' / ')})`, words.length === 0, JSON.stringify(words));
    check('AI and agent routes use the §14.3 sentence for 401', noTok.filter((x) => /\/v1\/(ai|agents)|\/mcp/.test(x.route)).every((x) => UNAUTH.has(x.message)), JSON.stringify(noTok.filter((x) => /\/v1\/(ai|agents)|\/mcp/.test(x.route) && !UNAUTH.has(x.message))));
    const withMsg = noTok.filter((x) => x.message).length;
    log(`401 answers with a message: ${withMsg}/${noTok.length} (pairing/device/MQTT routes answer the code only)`);
    const garbage = await call('GET', '/v1/ai/status', { token: 'not-a-real-token-0000000000000000000000' });
    check('an unknown token → 401 unauthorized', garbage.status === 401 && codeOf(garbage.json) === 'unauthorized', garbage.text.slice(0, 120));

    const ok = await call('GET', '/v1/pair/status', { token });
    check('control: the token in the header → 200', ok.status === 200, String(ok.status));
    const okAi = await call('GET', '/v1/ai/status', { token });
    check('control: /v1/ai/status with the token → 200', okAi.status === 200, String(okAi.status));
    for (const q of ['?token=', '?access_token=', '?bearer=']) {
      for (const [m, r] of [['GET', '/v1/pair/status'], ['GET', '/v1/ai/status'], ['GET', '/v1/agents/tokens']]) {
        const a = await call(m, r, { query: `${q}${encodeURIComponent(token)}` });
        check(`token in the query (${q.slice(1, -1)}) on ${r} → 401`, a.status === 401, `${a.status} ${a.text.slice(0, 80)}`);
      }
    }
    for (const [m, r] of [['GET', '/v1/pair/status'], ['GET', '/v1/devices'], ['GET', '/v1/ai/status'], ['GET', '/v1/agents/tokens'], ['POST', '/mcp']]) {
      const a = await call(m, r, { token, origin: 'https://evil.example' });
      check(`foreign Origin on ${m} ${r} → 403`, a.status === 403 && !a.acao, `${a.status} acao=${a.acao}`);
    }
    const pre = await fetch(`${SERVER}/v1/ai/status`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
    check('preflight from a foreign Origin is refused (no allow-origin)', pre.status === 403 || !pre.headers.get('access-control-allow-origin'), `${pre.status} ${pre.headers.get('access-control-allow-origin')}`);
    const pre2 = await fetch(`${SERVER}/v1/ai/status`, { method: 'OPTIONS', headers: { origin: SITE, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization, content-type' } });
    check('preflight from the site is allowed with PUT', pre2.status < 300 && pre2.headers.get('access-control-allow-origin') === SITE && /PUT/.test(pre2.headers.get('access-control-allow-methods') ?? ''), `${pre2.status} ${pre2.headers.get('access-control-allow-methods')}`);
    const allowed = await call('GET', '/v1/pair/status', { token, origin: SITE });
    check('the site’s Origin with the token → 200', allowed.status === 200 && allowed.acao === SITE, `${allowed.status} ${allowed.acao}`);
    const nullOrigin = await call('GET', '/v1/pair/status', { token, origin: 'null' });
    check('Origin "null" → 403', nullOrigin.status === 403, String(nullOrigin.status));

    // data directory modes (read-only)
    const ls = await lsPerson(id);
    const lines = ls.split('\n').filter((l) => /^[d-][rwx-]{9}/.test(l) && !/ \.\.?$/.test(l));
    const dirs = lines.filter((l) => l.startsWith('d'));
    const files = lines.filter((l) => l.startsWith('-'));
    const badDirs = dirs.filter((l) => !l.startsWith('drwx------'));
    const badFiles = files.filter((l) => !l.startsWith('-rw-------'));
    check(`person directory: ${dirs.length} directories all 0700`, dirs.length > 0 && badDirs.length === 0, badDirs.join(' / '));
    check(`person directory: ${files.length} files all 0600`, files.length > 0 && badFiles.length === 0, badFiles.join(' / '));
    const self = ls.split('\n').find((l) => / \.$/.test(l));
    check('the person directory itself is 0700', /^drwx------/.test(self ?? ''), self);

    // revoke from the CLI while the server runs
    const dev = (await (await fetch(`${SERVER}/v1/pair/status`, { headers: { authorization: `Bearer ${token}` } })).json());
    const deviceId = dev.device?.id ?? dev.deviceId ?? dev.device?.deviceId;
    const out = await devicesRevoke(id, deviceId);
    check('CLI devices revoke answers Revoked.', out === 'Revoked.', out);
    const t0 = Date.now();
    let st = 0;
    while (Date.now() - t0 < 150000) {
      st = (await call('GET', '/v1/pair/status', { token })).status;
      if (st === 401) break;
      await sleep(5000);
    }
    const secs = Math.round((Date.now() - t0) / 1000);
    check('a CLI revoke takes effect at once on the running server (≤ 5 s)', st === 401 && secs <= 5, `401 after ${secs} s (status ${st})`);
    const after = await call('GET', '/v1/ai/status', { token });
    check('the revoked token gets 401 revoked in plain words', after.status === 401 && codeOf(after.json) === 'revoked' && msgOf(after.json) === 'This device was removed from your server. Connect it again in Settings › Server.', after.text.slice(0, 160));
  } catch (e) { check('journey ran to the end', false, e.message.split('\n')[0]); }
  return { rows: save({ person: 'q8-j7' }), id };
}
if (process.argv[1]?.endsWith('j7-hygiene.mjs')) { const { rows } = await run(); log(`${rows.filter((r) => r.ok).length}/${rows.length} passed`); }
