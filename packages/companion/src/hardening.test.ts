// @vitest-environment node
// Review V1g: Sign in with ChatGPT races and listen-failure cleanup.
import { existsSync, readdirSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { ensureConfigDir, writeJsonSecret } from './config.ts';
import { unitFile } from './install.ts';
import { createRedactingLogger } from './security.ts';
import { startCompanion } from './server.ts';
import { createSiwc } from './siwc.ts';
import { sleep, startFakeServer, tempDir, type FakeServer } from './testHelpers.ts';

let tmp: ReturnType<typeof tempDir>;
let auth: FakeServer;

beforeAll(async () => {
  tmp = tempDir();
  auth = await startFakeServer();
});
afterAll(async () => {
  await auth.close();
  tmp.cleanup();
});

const endpoints = () => ({ authorize: `${auth.url}/authorize`, token: `${auth.url}/token`, revoke: `${auth.url}/revoke` });
const expiring = async (configDir: string) => {
  await ensureConfigDir(configDir);
  await writeJsonSecret(join(configDir, 'siwc.json'), { accessToken: 'at-OLD-0001', refreshToken: 'rt-OLD-0001', expiresAt: Date.now() + 10_000, clientId: 'oaiapp_test' });
};

describe('Sign in with ChatGPT token refresh', () => {
  it('a refresh in flight during sign-out does not bring the tokens back', async () => {
    const configDir = join(tmp.dir, 'logout-race');
    await expiring(configDir);
    auth.handler = async (req, res) => {
      if (req.url === '/token') {
        await sleep(150);
        return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ access_token: 'at-NEW-0002', refresh_token: 'rt-NEW-0002', expires_in: 3600 }));
      }
      res.writeHead(200).end();
    };
    const siwc = createSiwc({ configDir, log: createRedactingLogger(), endpoints: endpoints(), openBrowser: () => undefined });
    const token = siwc.accessToken();
    token.catch(() => undefined);
    await sleep(30);
    await siwc.logout();
    await expect(token).rejects.toMatchObject({ code: 'refresh_failed' });
    expect(existsSync(join(configDir, 'siwc.json'))).toBe(false);
    expect((await siwc.status()).signedIn).toBe(false);
  });

  it('a network failure during refresh is a refresh_failed SiwcError, not a raw fetch error', async () => {
    const configDir = join(tmp.dir, 'network');
    await expiring(configDir);
    const siwc = createSiwc({
      configDir,
      log: createRedactingLogger(),
      endpoints: endpoints(),
      openBrowser: () => undefined,
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });
    await expect(siwc.accessToken()).rejects.toMatchObject({ name: 'SiwcError', code: 'refresh_failed' });
    expect(existsSync(join(configDir, 'siwc.json'))).toBe(true);
  });
});

describe('Sign in with ChatGPT login', () => {
  it('concurrent login() calls share one pending sign-in and one loopback listener', async () => {
    const configDir = join(tmp.dir, 'double-login');
    const opened: string[] = [];
    const siwc = createSiwc({ configDir, log: createRedactingLogger(), endpoints: endpoints(), openBrowser: (u) => opened.push(u) });
    const [a, b] = await Promise.all([siwc.login(), siwc.login()]);
    expect(b.redirectUri).toBe(a.redirectUri);
    expect(opened).toHaveLength(1);
    siwc.close();
    await expect(a.done).rejects.toMatchObject({ code: 'login_failed' });
    await expect(fetch(a.redirectUri)).rejects.toThrow();
  });
});

describe('startCompanion when the port is taken', () => {
  it.runIf(process.platform === 'linux')('closes the relay database before rejecting with EADDRINUSE', async () => {
    const dataDir = join(tmp.dir, 'busy-data');
    const busy = await startFakeServer();
    const openRelayFiles = () =>
      readdirSync('/proc/self/fd').filter((fd) => {
        try {
          return readlinkSync(`/proc/self/fd/${fd}`).startsWith(dataDir);
        } catch {
          return false;
        }
      }).length;
    try {
      await expect(
        startCompanion({ port: busy.port, allowedOrigins: [], dataDir, agent: true, configDir: join(tmp.dir, 'busy-config') }),
      ).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(openRelayFiles()).toBe(0);
    } finally {
      await busy.close();
    }
  });
});

describe('systemd unit template', () => {
  it('keeps % and $ in paths literal (systemd specifiers and variables)', () => {
    const unit = unitFile({ role: 'proxy', nodePath: '/usr/bin/node', root: '/srv/50%off/companion', port: 4870, dataDir: '/d/$HOME', configDir: '/c/%h' });
    expect(unit).toContain('WorkingDirectory=/srv/50%%off/companion\n');
    expect(unit).toContain('ExecStart=/usr/bin/node /srv/50%%off/companion/bin/vitals-companion.mjs proxy --host 127.0.0.1 --port 4870 --data /d/$$HOME --config-dir /c/%%h\n');
    expect(unit).toContain('ReadWritePaths=/d/$HOME /c/%%h\n');
  });
});
