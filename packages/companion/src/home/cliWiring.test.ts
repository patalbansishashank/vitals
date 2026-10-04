// @vitest-environment node
// Q8: the provider-key, ChatGPT and agent-token commands of docs/SERVER.md run through `vitals-server` (they were only
// wired into `vitals-companion`), and a token revoked or minted by the CLI is seen by a running server at once.
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createDeviceStore } from './devices.ts';
import { createPersonRegistry } from './persons.ts';
import { serverMain } from './serverCli.ts';
import { writeServerConfig, defaultServerConfig } from './serverConfig.ts';

const TMP = process.env.TMPDIR ?? '/tmp';
let dir: string;
const env0 = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, XDG_DATA_HOME: process.env.XDG_DATA_HOME };
beforeEach(async () => {
  dir = mkdtempSync(join(TMP, 'q8-cli-'));
  process.env.XDG_CONFIG_HOME = join(dir, 'config');
  process.env.XDG_DATA_HOME = join(dir, 'unused-data-home');
  await writeServerConfig(join(dir, 'config', 'vitals-server'), { ...defaultServerConfig(), dataDir: join(dir, 'data') });
});
afterEach(() => {
  for (const [k, v] of Object.entries(env0)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});

async function cli(args: string[], input?: string) {
  const lines: string[] = [];
  const stdin = Readable.from(input === undefined ? [] : [Buffer.from(`${input}\n`)]) as unknown as NodeJS.ReadStream;
  const code = await serverMain(args, (l) => lines.push(l), stdin);
  return { code, out: lines.join('\n') };
}

it('keys and agent-token commands run through vitals-server on the configured data folder', async () => {
  const add = await cli(['persons', 'add', 'Q8 test', '--tz', 'Asia/Kolkata']);
  const id = add.out.match(/^([0-9a-f]{16})/)?.[1];
  expect(id).toBeTruthy();
  const set = await cli(['keys', 'set', id!, 'nim'], 'nvapi-test-key-0001');
  expect(set.code).toBe(0);
  const providers = readFileSync(join(dir, 'data', 'persons', id!, 'credentials', 'providers.json'), 'utf8');
  expect(JSON.parse(providers).nim).toBe('nvapi-test-key-0001');
  const list = await cli(['keys', 'list', id!]);
  expect(list.code).toBe(0);
  expect(list.out).toMatch(/nim/);
  expect(list.out).not.toMatch(/nvapi-test-key-0001/);
  const tok = await cli(['agent-token', 'create', id!, '--client', 'codex', '--scope', 'log']);
  expect(tok.code).toBe(0);
  expect((await cli(['siwc', 'status', id!])).out).toMatch(/not signed in/i);
  expect((await cli(['--help'])).out).toMatch(/keys set <person>/);
});

it('a token revoked or minted by another process is seen by the running store at once', async () => {
  const persons = createPersonRegistry(join(dir, 'data'));
  const p = await persons.add({ label: 'Q8', timeZone: 'UTC', secret: new Uint8Array(32), relayUrl: null });
  const server = createDeviceStore({ dataDir: join(dir, 'data'), persons });
  const { token, deviceId } = await server.mint(p.id, { kind: 'device', label: 'Browser' });
  expect((await server.resolve(token)).ok).toBe(true);
  // the CLI is another process with its own store over the same files
  const cliStore = createDeviceStore({ dataDir: join(dir, 'data'), persons: createPersonRegistry(join(dir, 'data')) });
  expect(await cliStore.revoke(p.id, deviceId)).toBe(true);
  expect(await server.resolve(token)).toEqual({ ok: false, error: 'revoked' });
  const agent = await cliStore.mint(p.id, { kind: 'agent', label: 'Codex', scope: 'log', client: 'codex' });
  const r = await server.resolve(agent.token);
  expect(r.ok && r.principal.kind).toBe('agent');
});
