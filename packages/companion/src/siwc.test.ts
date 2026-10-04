// @vitest-environment node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRedactingLogger } from './security.ts';
import { startCompanion } from './server.ts';
import { createServer } from 'node:http';
import { createSiwc, pkceChallenge, SIWC_DYNAMIC_CLIENT_ID, SiwcError, sshForwardHint } from './siwc.ts';
import { rawCall, startFakeServer, tempDir, type FakeServer } from './testHelpers.ts';

const ACCESS = 'at-LOGIN-secret-0001';
const REFRESH = 'rt-LOGIN-secret-0001';
const APP = 'https://vitals.creative.desi';

let tmp: ReturnType<typeof tempDir>;
let auth: FakeServer;
const logs: string[] = [];

const idToken = (nonce: string) => `h.${Buffer.from(JSON.stringify({ nonce, sub: 'u1' })).toString('base64url')}.s`;

beforeAll(async () => {
  tmp = tempDir();
  auth = await startFakeServer();
});
afterAll(async () => {
  await auth.close();
  tmp.cleanup();
});

/** Fake OpenAI: the token endpoint echoes the nonce from the last authorize URL into the ID token. */
function setup(name: string, opts: { callback?: (params: URLSearchParams) => string } = {}) {
  const configDir = join(tmp.dir, name);
  let lastNonce = '';
  const opened: string[] = [];
  auth.requests.length = 0;
  auth.handler = (req, res) => {
    if (req.url === '/token') return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600, id_token: idToken(lastNonce) }));
    if (req.url === '/revoke') return void res.writeHead(200).end();
    res.writeHead(404).end();
  };
  const siwc = createSiwc({
    configDir,
    log: createRedactingLogger((l) => logs.push(l)),
    endpoints: { authorize: `${auth.url}/authorize`, token: `${auth.url}/token`, revoke: `${auth.url}/revoke` },
    openBrowser: (url) => {
      opened.push(url);
      const p = new URL(url).searchParams;
      lastNonce = p.get('nonce')!;
      // The "browser": OpenAI redirects to the loopback callback.
      const target = opts.callback ? opts.callback(p) : `${p.get('redirect_uri')}?code=authcode-1&state=${p.get('state')}&client_id=oaiapp_issued123`;
      void fetch(target).catch(() => undefined);
    },
  });
  return { siwc, configDir, opened };
}

describe('Sign in with ChatGPT login', () => {
  it('runs PKCE S256 with state and nonce on a 127.0.0.1 callback and stores tokens 0600', async () => {
    const { siwc, configDir } = setup('ok');
    const login = await siwc.login();
    const p = new URL(login.authorizeUrl).searchParams;
    expect(login.authorizeUrl.startsWith(`${auth.url}/authorize?`)).toBe(true);
    expect(login.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(Object.fromEntries(p)).toMatchObject({
      response_type: 'code',
      client_id: SIWC_DYNAMIC_CLIENT_ID,
      redirect_uri: login.redirectUri,
      scope: 'openid offline_access resource.invoke chatgpt.tokens.use.direct',
      resource: 'https://api.openai.com/v1',
      code_challenge_method: 'S256',
      agent_name_hint: 'Vitals Companion',
    });
    expect(p.get('ext_agent_host_id')).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    expect(p.get('state')!.length).toBeGreaterThanOrEqual(32);
    expect(p.get('nonce')!.length).toBeGreaterThanOrEqual(32);
    await login.done;

    const tokenReq = Object.fromEntries(new URLSearchParams(auth.requests.find((r) => r.url === '/token')!.body));
    expect(tokenReq).toMatchObject({ grant_type: 'authorization_code', code: 'authcode-1', redirect_uri: login.redirectUri, client_id: 'oaiapp_issued123' });
    expect(pkceChallenge(tokenReq.code_verifier!)).toBe(p.get('code_challenge'));
    expect(tokenReq.client_secret).toBeUndefined();

    const file = join(configDir, 'siwc.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ accessToken: ACCESS, refreshToken: REFRESH, clientId: 'oaiapp_issued123' });
    const install = JSON.parse(readFileSync(join(configDir, 'install.json'), 'utf8')) as { siwcClientId: string; installId: string };
    expect(install.siwcClientId).toBe('oaiapp_issued123');
    expect(p.get('ext_agent_host_id')).toBe(`urn:uuid:${install.installId}`);

    const status = await siwc.status();
    expect(status.signedIn).toBe(true);
    expect(JSON.stringify(status)).not.toContain(ACCESS);

    // Next login reuses the issued client id, without the registration hints.
    const again = await siwc.login();
    const p2 = new URL(again.authorizeUrl).searchParams;
    expect(p2.get('client_id')).toBe('oaiapp_issued123');
    expect(p2.get('agent_name_hint')).toBeNull();
    await again.done;

    await siwc.logout();
    expect(existsSync(file)).toBe(false);
    const revoke = Object.fromEntries(new URLSearchParams(auth.requests.find((r) => r.url === '/revoke')!.body));
    expect(revoke).toMatchObject({ token: REFRESH, token_type_hint: 'refresh_token' });
    expect((await siwc.status()).signedIn).toBe(false);
    await expect(siwc.accessToken()).rejects.toBeInstanceOf(SiwcError);
    expect(logs.join('\n')).not.toMatch(/at-LOGIN|rt-LOGIN|authcode-1/);
  });

  it('rejects a state mismatch and stores nothing', async () => {
    const { siwc, configDir } = setup('state', { callback: (p) => `${p.get('redirect_uri')}?code=authcode-2&state=forged-state-value` });
    const login = await siwc.login();
    await expect(login.done).rejects.toMatchObject({ code: 'state_mismatch' });
    expect(existsSync(join(configDir, 'siwc.json'))).toBe(false);
    expect(auth.requests.some((r) => r.url === '/token')).toBe(false);
  });

  it('times out and closes the loopback listener', async () => {
    const configDir = join(tmp.dir, 'timeout');
    const siwc = createSiwc({ configDir, log: createRedactingLogger(), loginTimeoutMs: 50, openBrowser: () => undefined });
    const login = await siwc.login();
    await expect(login.done).rejects.toMatchObject({ code: 'timeout' });
    await expect(fetch(login.redirectUri)).rejects.toThrow();
  });

  it('a fixed callback port (server sign-in through ssh -L) binds 127.0.0.1:<port> only', async () => {
    const free = await new Promise<number>((r) => {
      const s = createServer().listen(0, '127.0.0.1', () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => r(p));
      });
    });
    const siwc = createSiwc({ configDir: join(tmp.dir, 'port'), log: createRedactingLogger(), loginTimeoutMs: 200, openBrowser: () => undefined });
    const login = await siwc.login({ callbackPort: free });
    expect(login.redirectUri).toBe(`http://127.0.0.1:${free}/callback`);
    expect(new URL(login.authorizeUrl).searchParams.get('redirect_uri')).toBe(login.redirectUri);
    expect(sshForwardHint(free, 'vitals-server')).toBe(`ssh -N -L ${free}:127.0.0.1:${free} vitals-server`);
    expect((await fetch(`http://127.0.0.1:${free}/nope`)).status).toBe(404);
    await expect(login.done).rejects.toMatchObject({ code: 'timeout' });
  });

  it('HTTP routes need the paired bearer and never return tokens; the sign-in URL goes to the terminal', async () => {
    const printed: string[] = [];
    const configDir = join(tmp.dir, 'http');
    const opened: string[] = [];
    const companion = await startCompanion({
      port: 0,
      allowedOrigins: [],
      relay: false,
      agent: true,
      configDir,
      siwcEndpoints: { authorize: `${auth.url}/authorize`, token: `${auth.url}/token`, revoke: `${auth.url}/revoke` },
      openBrowser: (u) => opened.push(u),
      print: (l) => printed.push(l),
    });
    try {
      expect((await rawCall(companion.port, 'POST', '/v1/ai/siwc/login', { Origin: APP })).status).toBe(401);
      const pair = await rawCall(companion.port, 'POST', '/v1/pair/local', { Origin: APP, 'Content-Type': 'application/json' }, JSON.stringify({ code: companion.pairingCode!.code }));
      const h = { Origin: APP, Authorization: `Bearer ${pair.json().token as string}` };
      const started = await rawCall(companion.port, 'POST', '/v1/ai/siwc/login', h);
      expect(started.status).toBe(202);
      expect(started.json()).toEqual({ started: true });
      expect(opened).toHaveLength(1);
      expect(printed.join('\n')).toContain(opened[0]);
      expect((await rawCall(companion.port, 'GET', '/v1/ai/siwc/status', h)).json()).toEqual({ signedIn: false, expiresAt: null });
      expect((await rawCall(companion.port, 'POST', '/v1/ai/siwc/logout', h)).json()).toEqual({ signedIn: false });
    } finally {
      await companion.close();
    }
  });
});
