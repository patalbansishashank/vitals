// @vitest-environment node
/** `home` role (SUITE_SPEC §14.2, §14.9 "Token rules", "Two-person isolation"): pairing, tokens, routes, isolation. */
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { startTestHome } from './testHome.ts';

let stop: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const s of stop) await s();
  stop = [];
});
const boot = async (o: Parameters<typeof startTestHome>[0] = {}) => {
  const t = await startTestHome({ mqtt: false, ...o });
  stop.push(() => t.c.close());
  return t;
};
/** fetch() cannot set Host; this can. */
const rawGet = (url: string, path: string, headers: Record<string, string>) =>
  new Promise<number>((resolve, reject) => {
    const u = new URL(url);
    request({ host: u.hostname, port: u.port, path, headers }, (res) => (res.resume(), resolve(res.statusCode ?? 0))).on('error', reject).end();
  });

describe('pairing and device tokens', () => {
  it('pairs by code, reports status, lists and revokes devices', async () => {
    const t = await boot();
    const a = await t.person('Ana');
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const s = await t.api('/v1/pair/status', { token: a.token });
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ deviceId: a.deviceId, kind: 'device', scope: 'full', person: { id: a.id, label: 'Ana' }, server: { role: 'home', mqtt: 'off' } });
    expect(s.headers.get('access-control-allow-origin')).toBe('https://vitals.creative.desi');
    const code = await t.api('/v1/pair/code', { method: 'POST', token: a.token, body: { label: 'Laptop' } });
    expect(code.body.qr).toMatch(/^vitals-server:1\?u=https%3A%2F%2Fhost\.tail0\.ts\.net%3A8443&c=\d{8}&n=Laptop$/);
    const b = await t.api('/v1/pair/device', { method: 'POST', body: { code: code.body.code } });
    expect(b.status).toBe(200);
    const list = await t.api('/v1/devices', { token: a.token });
    expect((list.body.devices as unknown as Array<{ id: string; current: boolean; label: string }>).map((d) => [d.label, d.current])).toEqual([['Ana phone', true], ['Laptop', false]]);
    expect((await t.api(`/v1/devices/${b.body.deviceId}`, { method: 'DELETE', token: a.token })).status).toBe(204);
    const gone = await t.api('/v1/pair/status', { token: b.body.token as unknown as string });
    expect([gone.status, gone.body.error]).toEqual([401, 'revoked']);
    // a code is single use
    expect((await t.api('/v1/pair/device', { method: 'POST', body: { code: code.body.code } })).status).toBe(401);
  });

  it('locks codes after five wrong guesses, expires them, and keeps the old pairing route', async () => {
    const t = await boot();
    const p = await t.home.persons.add({ label: 'Bo', timeZone: 'UTC', secret: new Uint8Array(32), relayUrl: null });
    const { code } = await t.home.devices.issueCode(p.id);
    const old = await t.api('/v1/pair/local', { method: 'POST', body: { code } });
    expect(old.status).toBe(200);
    expect(old.body.person).toEqual({ id: p.id, label: 'Bo' });
    await t.home.devices.issueCode(p.id);
    const wrong = [];
    for (let i = 0; i < 5; i++) wrong.push((await t.api('/v1/pair/device', { method: 'POST', body: { code: '00000000' } })).body);
    expect(wrong.map((w) => w.error)).toEqual(['invalid_code', 'invalid_code', 'invalid_code', 'invalid_code', 'locked']);
    expect(wrong[0]!.attemptsLeft).toBe(4);
  });

  it('refuses foreign origins, unknown hosts, query tokens and admin-only fields from devices', async () => {
    const t = await boot();
    const a = await t.person('Ana');
    expect((await t.api('/v1/pair/status', { token: a.token, origin: 'https://evil.example' })).status).toBe(403);
    expect((await t.api('/v1/pair/status', { token: a.token, origin: null })).status).toBe(200);
    expect(await rawGet(t.c.url, '/v1/pair/status', { host: 'evil.example', authorization: `Bearer ${a.token}` })).toBe(403);
    expect(await rawGet(t.c.url, '/v1/pair/status', { host: 'box.tail0.ts.net', authorization: `Bearer ${a.token}` })).toBe(200);
    expect((await t.api(`/v1/pair/status?token=${a.token}`)).status).toBe(401);
    expect((await t.api(`/v1/pair/status?token=${a.token}`, { token: a.token })).status).toBe(401);
    const pre = await fetch(`${t.c.url}/v1/devices`, { method: 'OPTIONS', headers: { origin: 'https://vitals.creative.desi', 'access-control-request-method': 'GET' } });
    expect([pre.status, pre.headers.get('access-control-max-age'), pre.headers.get('access-control-allow-private-network'), pre.headers.get('access-control-allow-credentials')]).toEqual([204, '7200', 'true', null]);
    expect(pre.headers.get('access-control-allow-headers')).toBe('authorization, content-type, mcp-session-id');
    const h = await t.api('/health', { origin: null });
    expect(h.body).toMatchObject({ role: 'home', persons: 1, mqtt: 'off' });
    expect(JSON.stringify(h.body)).not.toContain('Ana');
  });

  it('admin token issues codes for a named person; devices cannot', async () => {
    const t = await boot();
    const a = await t.person('Ana');
    const admin = await t.home.devices.mintAdminToken();
    const r = await t.api('/v1/pair/code', { method: 'POST', token: admin, origin: null, body: { person: a.id } });
    expect(r.status).toBe(200);
    expect((await t.api('/v1/pair/code', { method: 'POST', token: admin, body: { person: a.id } })).status).toBe(401);
  });
});

/** Every file under a directory with its mtime. */
async function mtimes(dir: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) {
    const p = join(e.parentPath, e.name);
    out.set(p, (await stat(p)).mtimeMs);
  }
  return out;
}

describe('two persons on one server', () => {
  it('never shows one person anything of the other, under random routes and tokens', async () => {
    const t = await boot({ mqtt: true });
    const A = await t.person('Ana');
    const B = await t.person('Ben');
    const secretsOf = { [A.id]: new Set<string>([A.id, A.deviceId, 'Ana']), [B.id]: new Set<string>([B.id, B.deviceId, 'Ben']) };
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    const ops = [
      (tok: string) => t.api('/v1/pair/status', { token: tok }),
      (tok: string) => t.api('/v1/devices', { token: tok }),
      (tok: string) => t.api('/v1/mqtt/status', { token: tok }),
      (tok: string, other: string) => t.api(`/v1/mqtt/status?person=${other}`, { token: tok }),
      (tok: string, other: string) => t.api('/v1/pair/code', { method: 'POST', token: tok, body: { person: other } }),
      (tok: string, other: string) => t.api('/v1/mqtt/credentials', { method: 'POST', token: tok, body: { person: other } }),
      (tok: string, other: string) => t.api(`/v1/devices/${other === A.id ? A.deviceId : B.deviceId}`, { method: 'DELETE', token: tok }),
      // the AI and agent routes (§14.3, §14.4) mounted on the same resolver
      (tok: string) => t.api('/v1/ai/status', { token: tok }),
      (tok: string, other: string) => t.api(`/v1/ai/usage?person=${other}`, { token: tok }),
      (tok: string) => t.api('/v1/agents/tokens', { token: tok }),
      (tok: string) => t.api('/v1/agents/activity', { token: tok }),
    ];
    for (let i = 0; i < 60; i++) {
      const me = rnd(2) ? A : B;
      const other = me === A ? B : A;
      const op = rnd(ops.length);
      const r = await ops[op]!(me.token, other.id);
      const text = JSON.stringify(r.body ?? '');
      for (const s of secretsOf[other.id]!) expect(text, `op ${op}`).not.toContain(s);
      if (r.status === 200 && typeof r.body.username === 'string') {
        expect(r.body.username).toContain(me.id);
        secretsOf[me.id]!.add(r.body.username as unknown as string);
      }
      if (op === 4 && r.status === 200) secretsOf[me.id]!.add(r.body.code as unknown as string);
    }
    // deleting the other person's device id is "not found", never a revocation
    expect((await t.api('/v1/pair/status', { token: A.token })).status).toBe(200);
    expect((await t.api('/v1/pair/status', { token: B.token })).status).toBe(200);
    // filesystem audit: A's token on every route leaves B's directory untouched
    await t.home.devices.flush();
    const before = await mtimes(t.home.persons.paths(B.id).dir);
    for (const op of ops) await op(A.token, B.id);
    await t.home.devices.flush();
    expect(await mtimes(t.home.persons.paths(B.id).dir)).toEqual(before);
    expect(t.fake.opened.every((p) => p.dir.endsWith(p.personId))).toBe(true);
  });
});

describe('AI and agent routes on the home role', () => {
  it('keeps keys and agent tokens per person and resolves agent tokens to their person', async () => {
    const t = await boot({ mqtt: false });
    const A = await t.person('Ana');
    const B = await t.person('Ben');
    const put = await t.api('/v1/ai/keys/nim', { method: 'PUT', token: A.token, body: { key: 'nvapi-test-key-for-ana-0001' } });
    expect(put.status, JSON.stringify(put.body)).toBeLessThan(300);
    const f = await stat(join(t.home.persons.paths(A.id).credentials, 'providers.json'));
    expect(f.mode & 0o777).toBe(0o600);
    await expect(stat(join(t.home.persons.paths(B.id).credentials, 'providers.json'))).rejects.toThrow();
    const minted = await t.api('/v1/agents/tokens', { method: 'POST', token: A.token, body: { client: 'codex', scope: 'read' } });
    expect(minted.status).toBe(200);
    const agentToken = minted.body.token as unknown as string;
    const st = await t.api('/v1/pair/status', { token: agentToken, origin: null });
    expect(st.status).toBe(200);
    expect(JSON.stringify(st.body)).toContain(A.id);
    expect(((await t.api('/v1/agents/tokens', { token: B.token })).body.tokens as unknown as unknown[]).length).toBe(0);
    expect((await t.api(`/v1/agents/tokens/${minted.body.id as unknown as string}`, { method: 'DELETE', token: A.token })).status).toBeLessThan(300);
    const after = await t.api('/v1/pair/status', { token: agentToken, origin: null });
    expect(after.status).toBe(401);
    expect(after.body.error).toBe('revoked');
    // the preflight of the AI routes allows PUT (key entry from the website)
    const pre = await fetch(`${t.c.url}/v1/ai/keys/nim`, { method: 'OPTIONS', headers: { origin: 'https://vitals.creative.desi', 'access-control-request-method': 'PUT' } });
    expect(pre.headers.get('access-control-allow-methods') ?? '').toContain('PUT');
  });
});
