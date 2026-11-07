// @vitest-environment node
// Over-the-air updates (vitals-research/ota/CONTRACT.md "Server"): publishing, the newer/older/compatible answer of
// `/v1/apps/<app>/latest`, token scoping, range downloads and the token-free `/install` page.
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { crc32, deflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  installedWebBuiltAt, isTailnetAddr, latestFor, normaliseSignature, parseManifestVersion, parseRange, publishApk, publishWeb, readReleaseIndex, releaseDir, ReleaseError,
  type ReleaseIndex,
} from './releases.ts';
import { serverMain } from './serverCli.ts';
import { defaultServerConfig, writeServerConfig } from './serverConfig.ts';
import { startTestHome } from './testHome.ts';

const TMP = process.env.TMPDIR ?? '/tmp';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** A zip of `entries` (deflated when asked), enough for the server's reader. */
function zip(entries: Record<string, Buffer | string>, deflate = true): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const packed = deflate ? deflateRawSync(data) : data;
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(deflate ? 8 : 0, 8);
    lh.writeUInt32LE(crc32(data), 14);
    lh.writeUInt32LE(packed.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(deflate ? 8 : 0, 10);
    ch.writeUInt32LE(crc32(data), 16);
    ch.writeUInt32LE(packed.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(n.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, packed);
    central.push(ch, n);
    offset += 30 + n.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** A binary AndroidManifest.xml (AXML, UTF-16 strings) whose `<manifest>` has versionCode and versionName. */
function axml(versionCode: number, versionName: string, named = true): Buffer {
  const strings = [named ? 'versionCode' : '', named ? 'versionName' : '', 'manifest', versionName];
  const encoded = strings.map((s) => {
    const b = Buffer.alloc(4 + s.length * 2);
    b.writeUInt16LE(s.length, 0);
    b.write(s, 2, 'utf16le');
    return b;
  });
  const offsets: number[] = [];
  let at = 0;
  for (const e of encoded) {
    offsets.push(at);
    at += e.length;
  }
  let data = Buffer.concat(encoded);
  if (data.length % 4) data = Buffer.concat([data, Buffer.alloc(4 - (data.length % 4))]);
  const head = Buffer.alloc(28 + strings.length * 4);
  head.writeUInt16LE(0x0001, 0);
  head.writeUInt16LE(28, 2);
  head.writeUInt32LE(head.length + data.length, 4);
  head.writeUInt32LE(strings.length, 8);
  head.writeUInt32LE(head.length, 20);
  offsets.forEach((o, i) => head.writeUInt32LE(o, 28 + i * 4));
  const pool = Buffer.concat([head, data]);
  const resMap = Buffer.alloc(16);
  resMap.writeUInt16LE(0x0180, 0);
  resMap.writeUInt16LE(8, 2);
  resMap.writeUInt32LE(16, 4);
  resMap.writeUInt32LE(0x0101021b, 8);
  resMap.writeUInt32LE(0x0101021c, 12);
  const el = Buffer.alloc(36 + 40);
  el.writeUInt16LE(0x0102, 0);
  el.writeUInt16LE(16, 2);
  el.writeUInt32LE(el.length, 4);
  el.writeUInt32LE(1, 8);
  el.writeUInt32LE(0xffffffff, 12);
  el.writeUInt32LE(0xffffffff, 16);
  el.writeUInt32LE(2, 20);
  el.writeUInt16LE(20, 24);
  el.writeUInt16LE(20, 26);
  el.writeUInt16LE(2, 28);
  // versionCode: int; versionName: string 3
  el.writeUInt32LE(0xffffffff, 36);
  el.writeUInt32LE(0, 40);
  el.writeUInt32LE(0xffffffff, 44);
  el.writeUInt16LE(8, 48);
  el.writeUInt8(0x10, 51);
  el.writeUInt32LE(versionCode, 52);
  el.writeUInt32LE(0xffffffff, 56);
  el.writeUInt32LE(1, 60);
  el.writeUInt32LE(3, 64);
  el.writeUInt16LE(8, 68);
  el.writeUInt8(0x03, 71);
  el.writeUInt32LE(3, 72);
  const body = Buffer.concat([pool, resMap, el]);
  const fileHead = Buffer.alloc(8);
  fileHead.writeUInt16LE(0x0003, 0);
  fileHead.writeUInt16LE(8, 2);
  fileHead.writeUInt32LE(8 + body.length, 4);
  return Buffer.concat([fileHead, body]);
}

let dir: string;
let n = 0;
beforeEach(() => {
  dir = mkdtempSync(join(TMP, 'ota-'));
});
const file = (name: string, content: Buffer) => {
  const p = join(dir, `${n++}-${name}`);
  writeFileSync(p, content);
  return p;
};
/** An APK-shaped zip; with `code` its manifest carries that version. */
const apk = (tag: string, code?: number, name?: string) =>
  file('app.apk', zip({ ...(code !== undefined ? { 'AndroidManifest.xml': axml(code, name ?? `1.${code}.0`) } : {}), 'classes.dex': `dex ${tag} ${'x'.repeat(3000)}` }));
const SIG = Buffer.alloc(64, 7);
const sigFile = () => file('bundle.sig', Buffer.from(SIG.toString('base64')));
const bundle = (version: string, minNativeVersionCode: number, builtAt = '2026-10-26T10:00:00Z') =>
  file('bundle.zip', zip({ 'bundle.json': JSON.stringify({ version, minNativeVersionCode, builtAt }), 'index.html': `<html>${version}</html>` }));
const data = () => join(dir, 'data');

describe('versions and formats', () => {
  it('dates an installed web bundle from the index, its web-bundle.mjs name or the published APK, never from semver', () => {
    const index: ReleaseIndex = {
      schema: 'vitals.releases/1',
      apk: [{ versionName: '0.6.1', versionCode: 601, sha256: 'a'.repeat(64), size: 1, file: 'a.apk', publishedAt: '2026-10-26T12:00:00.000Z' }],
      web: [{ version: '0.9.0', minNativeVersionCode: 1, builtAt: '2026-10-20T08:00:00.000Z', sha256: 'b'.repeat(64), size: 1, file: 'w.zip', sig: 's', publishedAt: '' }],
    };
    expect(installedWebBuiltAt(index, '0.9.0')).toBe(Date.parse('2026-10-20T08:00:00.000Z'));
    // the end of the stamped UTC minute: a bundle built in the same minute is not newer
    expect(installedWebBuiltAt(index, '202610260809-10ecce3')).toBe(Date.parse('2026-10-26T08:09:59.999Z'));
    expect(installedWebBuiltAt(index, 'apk-0.6.1')).toBe(Date.parse('2026-10-26T12:00:00.000Z'));
    expect(installedWebBuiltAt(index, 'apk-0.5.0')).toBeNull();
    expect(installedWebBuiltAt(index, '1.0.0')).toBeNull();
    expect(installedWebBuiltAt(index, '3f9e2c1')).toBeNull();
  });

  it('reads versionCode and versionName from a binary manifest, by name or by resource id', () => {
    expect(parseManifestVersion(axml(42, '0.6.1'))).toEqual({ versionCode: 42, versionName: '0.6.1' });
    expect(parseManifestVersion(axml(7, '2.0', false))).toEqual({ versionCode: 7, versionName: '2.0' });
    expect(parseManifestVersion(Buffer.from('not axml at all'))).toEqual({});
  });

  it('takes a signature as raw bytes, hex or base64 and refuses anything else', () => {
    const b64 = SIG.toString('base64');
    expect(normaliseSignature(SIG)).toBe(b64);
    expect(normaliseSignature(Buffer.from(`${SIG.toString('hex')}\n`))).toBe(b64);
    expect(normaliseSignature(Buffer.from(b64))).toBe(b64);
    expect(() => normaliseSignature(Buffer.from('short'))).toThrow(ReleaseError);
  });

  it('parses one byte range and tells unsatisfiable ones apart', () => {
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-1,5-6', 100)).toBeNull();
    expect(parseRange('bytes=9-2', 100)).toBeNull();
    expect(parseRange(undefined, 100)).toBeNull();
  });

  it('knows Tailscale addresses', () => {
    expect(isTailnetAddr('100.64.0.2')).toBe(true);
    expect(isTailnetAddr('::ffff:100.64.0.1')).toBe(true);
    expect(isTailnetAddr('fd7a:115c:a1e0::1')).toBe(true);
    expect(isTailnetAddr('100.128.0.1')).toBe(false);
    expect(isTailnetAddr('203.0.113.9')).toBe(false);
  });
});

describe('publish', () => {
  it('stores an APK atomically with its sha256 and keeps the last 3', async () => {
    const first = apk('a', 10);
    const r = await publishApk(data(), 'vitals', first, { now: () => Date.parse('2026-10-26T00:00:00Z') });
    expect(r.unchanged).toBe(false);
    expect(r.release).toMatchObject({ versionCode: 10, versionName: '1.10.0', sha256: sha(readFileSync(first)), size: statSync(first).size, publishedAt: '2026-10-26T00:00:00.000Z' });
    const d = releaseDir(data(), 'vitals');
    expect(readFileSync(join(d, r.release.file)).equals(readFileSync(first))).toBe(true);
    expect(statSync(join(d, r.release.file)).mode & 0o777).toBe(0o600);
    expect(statSync(join(d, 'index.json')).mode & 0o777).toBe(0o600);
    expect(statSync(d).mode & 0o777).toBe(0o700);

    // the same file again changes nothing; the same versionCode with another file and a lower one are refused
    expect((await publishApk(data(), 'vitals', first)).unchanged).toBe(true);
    await expect(publishApk(data(), 'vitals', apk('b', 10))).rejects.toThrow(/already published/);
    await expect(publishApk(data(), 'vitals', apk('c', 9))).rejects.toThrow(/lower than the newest/);

    for (const code of [11, 12, 13]) await publishApk(data(), 'vitals', apk(`v${code}`, code));
    const index = await readReleaseIndex(data(), 'vitals');
    expect(index.apk.map((a) => a.versionCode)).toEqual([13, 12, 11]);
    expect(readdirSync(d).sort()).toEqual(['index.json', ...index.apk.map((a) => a.file)].sort());
  });

  it('takes the version from the flags when the APK has no readable manifest, and checks them against it otherwise', async () => {
    await expect(publishApk(data(), 'gauge', apk('x'))).rejects.toThrow(/--version-name and --version-code/);
    const r = await publishApk(data(), 'gauge', apk('x'), { versionName: '0.3.0-debug', versionCode: 3, notes: 'Ring sync fixes' });
    expect(r.release).toMatchObject({ versionName: '0.3.0-debug', versionCode: 3, notes: 'Ring sync fixes' });
    await expect(publishApk(data(), 'gauge', apk('y', 5), { versionCode: 6 })).rejects.toThrow(/says versionCode 5/);
  });

  it('refuses a file whose sha256 is not the expected one and leaves nothing behind', async () => {
    const f = apk('z', 20);
    await expect(publishApk(data(), 'vitals', f, { sha256: '0'.repeat(64) })).rejects.toThrow(/not the expected/);
    expect((await readReleaseIndex(data(), 'vitals')).apk).toEqual([]);
    const ok = await publishApk(data(), 'vitals', f, { sha256: sha(readFileSync(f)).toUpperCase() });
    expect(ok.release.versionCode).toBe(20);
  });

  it('stores a web bundle with the metadata of its bundle.json and the signature', async () => {
    const z = bundle('0.7.0', 12);
    const r = await publishWeb(data(), 'vitals', z, { sig: sigFile(), version: '0.7.0' });
    expect(r.release).toMatchObject({ version: '0.7.0', minNativeVersionCode: 12, builtAt: '2026-10-26T10:00:00Z', sha256: sha(readFileSync(z)), sig: SIG.toString('base64') });
    const d = releaseDir(data(), 'vitals');
    expect(readdirSync(d)).toContain(`${r.release.file}.sig`);
    await expect(publishWeb(data(), 'vitals', bundle('0.7.1', 12), { sig: sigFile(), version: '0.7.2' })).rejects.toThrow(/says version 0.7.1/);
    await expect(publishWeb(data(), 'gauge', bundle('0.8.0', 1), { sig: sigFile() })).rejects.toThrow(/Vitals only/);
    await expect(publishWeb(data(), 'vitals', file('x.zip', zip({ 'index.html': 'x' })), { sig: sigFile() })).rejects.toThrow(/no bundle.json/);
    await expect(publishWeb(data(), 'vitals', bundle('0.8.0', 1), { sig: file('bad.sig', Buffer.from('nope')) })).rejects.toThrow(/signature/);
    // ordered by builtAt (then publish order), never by the version text: no semver contest between 0.10.0 and 0.9.0
    expect((await publishWeb(data(), 'vitals', bundle('0.10.0', 1, '2026-10-26T11:00:00Z'), { sig: sigFile() })).release.version).toBe('0.10.0');
    // built earlier but published later: stored, and sorted below the newer builds
    await publishWeb(data(), 'vitals', bundle('202610260930-aaaaaaa', 1, '2026-10-26T09:30:00Z'), { sig: sigFile() });
    let index = await readReleaseIndex(data(), 'vitals');
    expect(index.web.map((w) => w.version)).toEqual(['0.10.0', '0.7.0', '202610260930-aaaaaaa']);
    // the three newest builds are kept
    await publishWeb(data(), 'vitals', bundle('0.9.0', 1, '2026-10-26T12:00:00Z'), { sig: sigFile() });
    index = await readReleaseIndex(data(), 'vitals');
    expect(index.web.map((w) => w.version)).toEqual(['0.9.0', '0.10.0', '0.7.0']);
    expect(readdirSync(d).filter((f) => f.startsWith('web-')).length).toBe(6);
    // built before all three kept builds: refused, nothing stored
    await expect(publishWeb(data(), 'vitals', bundle('0.12.0', 1, '2026-10-26T09:59:00Z'), { sig: sigFile() })).rejects.toThrow(/built before the 3 kept/);
    expect(readdirSync(d).filter((f) => f.startsWith('web-')).length).toBe(6);
  });
});

describe('latest', () => {
  // as scripts/release/web-bundle.mjs names them; publish order (index order) differs from build order on purpose
  const NEW = '202610261000-bbbbbbb';
  const MID = '202610260900-ccccccc';
  const index: ReleaseIndex = {
    schema: 'vitals.releases/1',
    apk: [{ versionName: '0.7.0', versionCode: 14, sha256: 'a'.repeat(64), size: 10, file: 'vitals-14-aaaaaaaaaaaa.apk', publishedAt: '2026-10-26T08:00:00.000Z', notes: 'New' }],
    web: [
      { version: MID, minNativeVersionCode: 12, builtAt: '2026-10-26T09:00:00.000Z', sha256: 'c'.repeat(64), size: 5, file: 'web-mid.zip', sig: 'sig1', publishedAt: '2026-10-26T11:00:00.000Z' },
      { version: NEW, minNativeVersionCode: 14, builtAt: '2026-10-26T10:00:00.000Z', sha256: 'b'.repeat(64), size: 5, file: 'web-new.zip', sig: 'sig2', publishedAt: '2026-10-26T10:30:00.000Z' },
    ],
  };
  const web = (versionCode: number, installed: string | null) => latestFor(index, 'vitals', 'stable', { versionCode, web: installed }).web?.version ?? null;

  it('offers the APK only when it is newer than the installed versionCode', () => {
    expect(latestFor(index, 'vitals', 'stable', { versionCode: 13, web: null }).apk).toEqual({ versionName: '0.7.0', versionCode: 14, sha256: 'a'.repeat(64), size: 10, url: '/v1/apps/vitals/files/stable/vitals-14-aaaaaaaaaaaa.apk', notes: 'New' });
    expect(latestFor(index, 'vitals', 'stable', { versionCode: 14, web: null }).apk).toBeNull();
    expect(latestFor(index, 'vitals', 'stable', { versionCode: 15, web: null }).apk).toBeNull();
  });

  it('offers the newest compatible web bundle by builtAt when it was built after the installed one', () => {
    expect(latestFor(index, 'vitals', 'stable', { versionCode: 14, web: MID }).web).toEqual({ version: NEW, sha256: 'b'.repeat(64), size: 5, url: '/v1/apps/vitals/files/stable/web-new.zip', sig: 'sig2' });
    // the later publish (MID) is the older build: never offered over NEW
    expect(web(14, NEW)).toBeNull();
    expect(web(14, null)).toBe(NEW);
    // an app at 13 cannot run NEW (needs 14), so it gets MID; nothing compatible at all below 12
    expect(web(13, '202610250000-ddddddd')).toBe(MID);
    expect(web(11, '202610250000-ddddddd')).toBeNull();
    // the APK's own bundle, named by web-bundle.mjs but never published: compared by its stamp
    expect(web(14, '202610260930-eeeeeee')).toBe(NEW);
    expect(web(14, '202610261030-eeeeeee')).toBeNull();
    // same minute as NEW's build: cannot tell which is newer, so not offered
    expect(web(14, '202610261000-fffffff')).toBeNull();
    // an APK without bundle.json: bundles built after this server published that APK (08:00) count as newer
    expect(web(14, 'apk-0.7.0')).toBe(NEW);
    expect(latestFor({ ...index, apk: [{ ...index.apk[0]!, publishedAt: '2026-10-26T10:15:00.000Z' }] }, 'vitals', 'stable', { versionCode: 14, web: 'apk-0.7.0' }).web).toBeNull();
    // an APK or a bundle of unknown age (never published, no stamp, a semver): nothing, never a possible downgrade
    expect(web(14, 'apk-0.6.9')).toBeNull();
    expect(web(14, '0.8.0')).toBeNull();
    expect(web(14, '3f9e2c1')).toBeNull();
    // web bundles are Vitals only
    expect(latestFor(index, 'gauge', 'stable', { versionCode: 1, web: null }).web).toBeNull();
  });
});

describe('routes', () => {
  let h: Awaited<ReturnType<typeof startTestHome>>;
  afterEach(async () => {
    await h?.c.close();
  });

  const raw = (path: string, o: { token?: string; headers?: Record<string, string>; method?: string } = {}) =>
    new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }>((resolve, reject) => {
      const u = new URL(`${h.c.url}${path}`);
      const req = request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: o.method ?? 'GET', headers: { ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...o.headers } }, (res) => {
        const parts: Buffer[] = [];
        res.on('data', (c: Buffer) => parts.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts) }));
      });
      req.on('error', reject);
      req.end();
    });
  const json = (r: { body: Buffer }) => JSON.parse(r.body.toString('utf8')) as Record<string, unknown>;

  async function setup(releases?: { publicInstall?: boolean }, log?: (line: string) => void) {
    h = await startTestHome({ dataDir: join(dir, 'data'), ...(releases ? { releases } : {}), ...(log ? { log } : {}) });
    const p = await h.home.persons.add({ label: 'Owner', timeZone: 'UTC', secret: new Uint8Array(32), relayUrl: null });
    const device = (await h.home.devices.mint(p.id, { kind: 'device', label: 'Phone' })).token;
    const lumen = (await h.home.devices.mint(p.id, { kind: 'lumen', label: 'Gauge' })).token;
    const agent = (await h.home.devices.mint(p.id, { kind: 'agent', label: 'Codex', scope: 'log', client: 'codex' })).token;
    const vApk = apk('vitals', 14, '0.7.0');
    await publishApk(data(), 'vitals', vApk);
    const vWeb = bundle('202610261000-0a0b0c0', 14);
    await publishWeb(data(), 'vitals', vWeb, { sig: sigFile() });
    return { device, lumen, agent, vApk };
  }

  it('answers latest for the token\'s own app only and refuses agent tokens', async () => {
    const t = await setup();
    const r = await raw('/v1/apps/vitals/latest?channel=stable&versionCode=13&web=202610250000-1234567', { token: t.device });
    expect(r.status).toBe(200);
    const body = json(r) as { apk: { versionCode: number; url: string }; web: { version: string; sig: string } };
    expect(body.apk.versionCode).toBe(14);
    expect(body.web).toBeNull(); // the bundle needs versionCode 14
    const up = json(await raw('/v1/apps/vitals/latest?versionCode=14&web=202610250000-1234567', { token: t.device })) as typeof body;
    expect(up.apk).toBeNull();
    expect(up.web).toMatchObject({ version: '202610261000-0a0b0c0', sig: SIG.toString('base64') });
    // URLs are relative to whichever address the device paired with (the public origin is another host and port)
    expect(body.apk.url).toMatch(/^\/v1\/apps\/vitals\/files\/stable\/vitals-14-[0-9a-f]{12}\.apk$/);
    expect((up.web as unknown as { url: string }).url).toMatch(/^\/v1\/apps\/vitals\/files\/stable\/web-202610261000-0a0b0c0-[0-9a-f]{12}\.zip$/);
    expect(JSON.stringify([body, up])).not.toMatch(/:\/\/|ts\.net|8443/);

    // Gauge sees gauge only (no APK there yet), never vitals; a Vitals device never sees gauge
    expect(json(await raw('/v1/apps/gauge/latest?versionCode=1', { token: t.lumen }))).toEqual({ apk: null, web: null });
    expect((await raw('/v1/apps/vitals/latest?versionCode=1', { token: t.lumen })).status).toBe(403);
    expect((await raw('/v1/apps/gauge/latest?versionCode=1', { token: t.device })).status).toBe(403);
    // agents get nothing; no token or a token in the query is 401
    expect(json(await raw('/v1/apps/vitals/latest?versionCode=1', { token: t.agent }))).toMatchObject({ error: 'wrong_kind' });
    expect((await raw('/v1/apps/vitals/latest?versionCode=1')).status).toBe(401);
    expect((await raw(`/v1/apps/vitals/latest?versionCode=1&token=${t.device}`)).status).toBe(401);
    // a Gauge token still reaches nothing else outside /v1/lumen, /v1/coach and these routes
    expect((await raw('/v1/devices', { token: t.lumen })).status).toBe(403);
    expect((await raw('/v1/pair/status', { token: t.lumen })).status).toBe(403);
    // bad queries
    expect((await raw('/v1/apps/vitals/latest', { token: t.device })).status).toBe(400);
    expect((await raw('/v1/apps/vitals/latest?versionCode=1&channel=beta', { token: t.device })).status).toBe(400);
    expect((await raw('/v1/apps/other/latest?versionCode=1', { token: t.device })).status).toBe(404);
  });

  it('logs only changed authenticated Vitals version pairs, with untrusted web text sanitized', async () => {
    const lines: string[] = [];
    const t = await setup(undefined, (line) => lines.push(line));
    const receipt = () => lines.filter((line) => line.startsWith('release receipt:'));
    const latest = (web: string, code = 13) => raw(`/v1/apps/vitals/latest?versionCode=${code}&web=${encodeURIComponent(web)}`, { token: t.device });
    expect((await latest('202610250000-1234567')).status).toBe(200);
    expect((await latest('202610250000-1234567')).status).toBe(200);
    expect(receipt()).toHaveLength(1);
    expect(receipt()[0]).toMatch(/native 13 web 202610250000-1234567$/);
    expect((await latest('202610250000-1234567', 14)).status).toBe(200);
    expect(receipt()).toHaveLength(2);
    const unsafe = 'secret\nBearer untrusted';
    expect((await latest(unsafe, 14)).status).toBe(200);
    expect((await latest('another/unsafe', 14)).status).toBe(200);
    expect((await latest('secret', 14)).status).toBe(200);
    expect(receipt()).toHaveLength(3); // all unrecognized web strings share the one safe marker
    expect(receipt()[2]).toMatch(/native 14 web unrecognized$/);
    expect(receipt().join('\n')).not.toContain('secret');
    expect(receipt().join('\n')).not.toContain('Bearer');
    expect(receipt().join('\n')).not.toContain(t.device);
    expect((await raw('/v1/apps/vitals/latest?versionCode=14', { token: t.lumen })).status).toBe(403);
    expect(receipt()).toHaveLength(3);
  });

  it('streams files with Content-Length and single byte ranges', async () => {
    const t = await setup();
    const { apk: a } = json(await raw('/v1/apps/vitals/latest?versionCode=1', { token: t.device })) as { apk: { url: string; sha256: string; size: number } };
    const bytes = readFileSync(t.vApk);
    const full = await raw(a.url, { token: t.device });
    expect(full.status).toBe(200);
    expect(full.headers['content-length']).toBe(String(bytes.length));
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(full.headers['content-type']).toBe('application/vnd.android.package-archive');
    expect(sha(full.body)).toBe(a.sha256);

    const part = await raw(a.url, { token: t.device, headers: { range: 'bytes=10-19' } });
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 10-19/${bytes.length}`);
    expect(part.headers['content-length']).toBe('10');
    expect(part.body.equals(bytes.subarray(10, 20))).toBe(true);

    const resume = await raw(a.url, { token: t.device, headers: { range: `bytes=${bytes.length - 100}-` } });
    expect(resume.status).toBe(206);
    expect(resume.body.equals(bytes.subarray(bytes.length - 100))).toBe(true);
    const suffix = await raw(a.url, { token: t.device, headers: { range: 'bytes=-5' } });
    expect(suffix.body.equals(bytes.subarray(bytes.length - 5))).toBe(true);

    const bad = await raw(a.url, { token: t.device, headers: { range: `bytes=${bytes.length}-` } });
    expect(bad.status).toBe(416);
    expect(bad.headers['content-range']).toBe(`bytes */${bytes.length}`);
    // a stale If-Range gets the whole file
    expect((await raw(a.url, { token: t.device, headers: { range: 'bytes=0-9', 'if-range': '"other"' } })).status).toBe(200);
    expect((await raw(a.url, { token: t.device, headers: { range: 'bytes=0-9', 'if-range': `"${a.sha256}"` } })).status).toBe(206);

    const head = await raw(a.url, { token: t.device, method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers['content-length']).toBe(String(bytes.length));
    expect(head.body.length).toBe(0);

    // the same token rules; only files the index names
    expect((await raw(a.url)).status).toBe(401);
    expect((await raw(a.url, { token: t.lumen })).status).toBe(403);
    expect((await raw(a.url, { token: t.agent })).status).toBe(403);
    expect((await raw('/v1/apps/vitals/files/stable/index.json', { token: t.device })).status).toBe(404);
    expect((await raw('/v1/apps/vitals/files/stable/..%2Findex.json', { token: t.device })).status).toBe(404);
  });

  it('serves the install page and the latest APKs without a token, to tailnet and local requests only', async () => {
    const t = await setup();
    const page = await raw('/install');
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toMatch(/^text\/html/);
    expect(page.headers['content-security-policy']).toMatch(/default-src 'none'/);
    const html = page.body.toString('utf8');
    expect(html).toContain('href="/install/vitals.apk"');
    expect(html).toMatch(/Ring app <span>\(not published yet\)/);
    expect(html).not.toMatch(/0\.7\.0|Owner/);

    const dl = await raw('/install/vitals.apk');
    expect(dl.status).toBe(200);
    expect(dl.body.equals(readFileSync(t.vApk))).toBe(true);
    expect(dl.headers['content-disposition']).toBe('attachment; filename="vitals-0.7.0.apk"');
    expect((await raw('/install/vitals.apk', { headers: { range: 'bytes=0-3' } })).status).toBe(206);
    expect((await raw('/install/gauge.apk')).status).toBe(404);
    expect((await raw('/install/other.apk')).status).toBe(404);

    // through tailscale serve or Caddy: the forwarded client address decides
    expect((await raw('/install', { headers: { 'x-forwarded-for': '100.64.0.2' } })).status).toBe(200);
    expect((await raw('/install', { headers: { 'x-forwarded-for': '203.0.113.9' } })).status).toBe(404);
    expect((await raw('/install/vitals.apk', { headers: { 'x-forwarded-for': '100.64.0.1, 203.0.113.9' } })).status).toBe(404);
    expect((await raw('/install', { headers: { 'x-forwarded-for': '100.64.0.2', 'tailscale-funnel-request': '?1' } })).status).toBe(404);
  });

  it('keeps /install off when releases.publicInstall is false', async () => {
    const t = await setup({ publicInstall: false });
    expect((await raw('/install')).status).toBe(404);
    expect((await raw('/install/vitals.apk')).status).toBe(404);
    // the token routes do not depend on it
    expect((await raw('/v1/apps/vitals/latest?versionCode=1', { token: t.device })).status).toBe(200);
  });
});

describe('vitals-server release', () => {
  const env0 = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, XDG_DATA_HOME: process.env.XDG_DATA_HOME };
  beforeEach(async () => {
    process.env.XDG_CONFIG_HOME = join(dir, 'config');
    process.env.XDG_DATA_HOME = join(dir, 'unused');
    await writeServerConfig(join(dir, 'config', 'vitals-server'), { ...defaultServerConfig(), dataDir: data() });
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(env0)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
  const cli = async (args: string[]) => {
    const lines: string[] = [];
    const code = await serverMain(args, (l) => lines.push(l), Readable.from([]) as unknown as NodeJS.ReadStream);
    return { code, out: lines.join('\n') };
  };

  it('publishes an APK and a web bundle and lists them', async () => {
    const a = apk('cli', 3);
    const pubA = await cli(['release', 'publish', 'gauge', '--apk', a, '--version-name', '1.3.0', '--version-code', '3']);
    expect(pubA).toMatchObject({ code: 0 });
    expect(pubA.out).toContain(`sha256 ${sha(readFileSync(a))}`);
    const pubW = await cli(['release', 'publish', 'vitals', '--web', bundle('0.7.0', 12), '--version', '0.7.0', '--sig', sigFile()]);
    expect(pubW).toMatchObject({ code: 0 });
    expect(pubW.out).toMatch(/web bundle 0\.7\.0 \(needs versionCode 12\+\)/);
    expect(pubW.out).not.toContain(SIG.toString('base64'));
    expect((await cli(['release', 'list', 'gauge'])).out).toMatch(/apk {2}1\.3\.0 \(versionCode 3\)/);
    expect((await cli(['release', 'list', 'vitals'])).out).toMatch(/web {2}0\.7\.0/);

    expect((await cli(['release', 'publish', 'vitals', '--web', bundle('0.7.1', 12)])).code).toBe(2);
    expect((await cli(['release', 'publish', 'vitals', '--web', bundle('0.7.1', 12), '--version', '0.9.9', '--sig', sigFile()]))).toMatchObject({ code: 1 });
    expect((await cli(['release', 'publish', 'other', '--apk', a])).code).toBe(2);
    expect((await cli(['--help'])).out).toMatch(/release publish <vitals\|gauge> --apk/);
  });
});
