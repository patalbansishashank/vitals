/**
 * Over-the-air updates (vitals-research/ota/CONTRACT.md "Server", docs/SERVER.md "Updates"): the release store, the
 * publish steps the `vitals-server release` commands run, and the HTTP routes the apps poll.
 *
 * - Store: `<dataDir>/releases/<app>/<channel>/` holds `index.json` (newest first) and the files it names. The last
 *   3 APKs and the last 3 web bundles are kept; older files are deleted after the index no longer names them.
 * - Publish copies the file next to the index under a temporary name, re-reads the copy and checks its sha256 against
 *   the source (and against `--sha256` when given), then renames it into place. The index is written the same way.
 * - Routes: `GET /v1/apps/<app>/latest` and `GET|HEAD /v1/apps/<app>/files/<channel>/<file>` take a Vitals device
 *   token (app `vitals` only) or a Gauge `lumen` token (app `gauge` only); agent tokens get 403. `GET /install` and
 *   `GET /install/<app>.apk` take no token: they answer only while `releases.publicInstall` is on (default) and only to
 *   requests from the tailnet or from the server itself.
 * - Nothing here logs file contents, a signature or a token.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, open, readFile, readdir, rename, rm, stat, type FileHandle } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { inflateRawSync } from 'node:zlib';
import { readJsonFile, writeJsonSecret } from '../config.ts';
import { HttpError, sendJson } from '../security.ts';

export const RELEASE_APPS = ['vitals', 'gauge'] as const;
export type ReleaseApp = (typeof RELEASE_APPS)[number];
export const RELEASE_CHANNELS = ['stable'] as const;
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];
/** Releases kept per kind (APK, web bundle) and channel. */
export const RELEASES_KEPT = 3;
export const RELEASE_INDEX_SCHEMA = 'vitals.releases/1';

export interface ApkRelease {
  versionName: string;
  versionCode: number;
  sha256: string;
  size: number;
  file: string;
  publishedAt: string;
  notes?: string;
}

export interface WebRelease {
  version: string;
  minNativeVersionCode: number;
  builtAt: string;
  sha256: string;
  size: number;
  file: string;
  /** The detached ed25519 signature (64 bytes) as base64; the file as given is kept next to the bundle (`<file>.sig`). */
  sig: string;
  publishedAt: string;
}

export interface ReleaseIndex {
  schema: typeof RELEASE_INDEX_SCHEMA;
  /** Newest first (highest versionCode first). */
  apk: ApkRelease[];
  /** Newest first: by bundle.json `builtAt`, then publish order. */
  web: WebRelease[];
}

export interface LatestAnswer {
  apk: { versionName: string; versionCode: number; sha256: string; size: number; url: string; notes?: string } | null;
  web: { version: string; sha256: string; size: number; url: string; sig: string } | null;
}

/** A publish or query the operator or a client must fix; the message is shown as written. */
export class ReleaseError extends Error {}

export const isReleaseApp = (s: unknown): s is ReleaseApp => typeof s === 'string' && (RELEASE_APPS as readonly string[]).includes(s);
export const isReleaseChannel = (s: unknown): s is ReleaseChannel => typeof s === 'string' && (RELEASE_CHANNELS as readonly string[]).includes(s);

export const releaseDir = (dataDir: string, app: ReleaseApp, channel: ReleaseChannel = 'stable') => join(dataDir, 'releases', app, channel);
const indexFile = (dir: string) => join(dir, 'index.json');
const emptyIndex = (): ReleaseIndex => ({ schema: RELEASE_INDEX_SCHEMA, apk: [], web: [] });

export async function readReleaseIndex(dataDir: string, app: ReleaseApp, channel: ReleaseChannel = 'stable'): Promise<ReleaseIndex> {
  const i = await readJsonFile<ReleaseIndex>(indexFile(releaseDir(dataDir, app, channel)));
  if (!i || i.schema !== RELEASE_INDEX_SCHEMA) return emptyIndex();
  return { schema: RELEASE_INDEX_SCHEMA, apk: Array.isArray(i.apk) ? i.apk : [], web: Array.isArray(i.web) ? i.web : [] };
}

/** The path a client fetches a stored file at (relative to the server's address, so both of its addresses work). */
export const fileUrl = (app: ReleaseApp, channel: ReleaseChannel, file: string) => `/v1/apps/${app}/files/${channel}/${file}`;

// ---------------------------------------------------------------------------------------------------------------
// Versions
//
// Web bundle versions are names, not numbers: scripts/release/web-bundle.mjs makes `<yyyymmddHHMM UTC>-<git hash>`
// (an older or hand-made bundle may carry any safe name). Bundles are ordered by their bundle.json `builtAt`, then by
// publish order; never by semver. The Android app compares builtAt the same way (OtaLogic.acceptable).

const builtAtMs = (w: Pick<WebRelease, 'builtAt'>): number => {
  const t = Date.parse(w.builtAt);
  return Number.isFinite(t) ? t : -Infinity;
};

/** Web bundles newest first: by `builtAt`, ties (and an index written in publish order) keep publish order. */
export const sortWeb = (list: readonly WebRelease[]): WebRelease[] => [...list].sort((a, b) => builtAtMs(b) - builtAtMs(a));

const STAMPED = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})-[0-9a-f]{4,40}$/;

/**
 * When the device's installed web bundle was built, in ms, or null when the server cannot tell.
 * - A bundle this server published: its `builtAt`.
 * - A web-bundle.mjs name (`202610260809-10ecce3`, the APK's own bundle when its bundle.json was written before the
 *   APK build): the end of that UTC minute, so a bundle built in the same minute never counts as newer.
 * - `apk-<versionName>` (an APK without bundle.json, whose own bundle has no build time): the time this server published
 *   that APK, which is after it was built. The app itself compares with the APK's install time, later still, so the
 *   server never offers what the app refuses as older, apart from bundles built between publish and install.
 */
export function installedWebBuiltAt(index: ReleaseIndex, installed: string): number | null {
  const known = index.web.find((x) => x.version === installed);
  if (known) return builtAtMs(known);
  const m = STAMPED.exec(installed);
  if (m) {
    const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
    return Number.isFinite(t) ? t + 59_999 : null;
  }
  if (installed.startsWith('apk-')) {
    const name = installed.slice(4);
    const times = index.apk.filter((a) => a.versionName === name).map((a) => Date.parse(a.publishedAt)).filter(Number.isFinite);
    return times.length ? Math.min(...times) : null;
  }
  return null;
}

/**
 * What a device with APK `versionCode` and web bundle `web` should fetch (CONTRACT "Endpoints"):
 * - `apk`: the newest APK when its versionCode is above the installed one;
 * - `web` (Vitals only): the newest bundle (by `builtAt`) whose `minNativeVersionCode` ≤ the installed versionCode,
 *   when it was built after the installed bundle. An installed bundle of unknown age gets nothing: a phone is never
 *   handed a bundle that may be older than the one it runs.
 */
export function latestFor(index: ReleaseIndex, app: ReleaseApp, channel: ReleaseChannel, installed: { versionCode: number; web: string | null }): LatestAnswer {
  const a = index.apk[0];
  const apk = a && a.versionCode > installed.versionCode
    ? { versionName: a.versionName, versionCode: a.versionCode, sha256: a.sha256, size: a.size, url: fileUrl(app, channel, a.file), ...(a.notes ? { notes: a.notes } : {}) }
    : null;
  let web: LatestAnswer['web'] = null;
  const w = app === 'vitals' ? sortWeb(index.web).find((x) => x.minNativeVersionCode <= installed.versionCode) : undefined;
  if (w && newerWeb(index, w, installed.web)) web = { version: w.version, sha256: w.sha256, size: w.size, url: fileUrl(app, channel, w.file), sig: w.sig };
  return { apk, web };
}

function newerWeb(index: ReleaseIndex, candidate: WebRelease, installed: string | null): boolean {
  if (!installed) return true;
  if (candidate.version === installed) return false;
  const t = installedWebBuiltAt(index, installed);
  return t !== null && builtAtMs(candidate) > t;
}

// ---------------------------------------------------------------------------------------------------------------
// Zip and APK manifest

interface ZipEntry {
  method: number;
  flags: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

async function readAt(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  const b = Buffer.alloc(length);
  const { bytesRead } = await fh.read(b, 0, length, position);
  if (bytesRead !== length) throw new ReleaseError('The zip file is cut short.');
  return b;
}

async function zipDirectory(fh: FileHandle): Promise<Map<string, ZipEntry>> {
  const { size } = await fh.stat();
  const tailLen = Math.min(size, 65_557);
  if (tailLen < 22) throw new ReleaseError('That is not a zip file.');
  const tail = await readAt(fh, size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd === -1) throw new ReleaseError('That is not a zip file.');
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff || cdOffset + cdSize > size) throw new ReleaseError('This zip layout (zip64 or damaged) is not supported.');
  const cd = await readAt(fh, cdOffset, cdSize);
  const entries = new Map<string, ZipEntry>();
  for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50;) {
    const nameLen = cd.readUInt16LE(p + 28);
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, {
      flags: cd.readUInt16LE(p + 8), method: cd.readUInt16LE(p + 10), compressedSize: cd.readUInt32LE(p + 20), size: cd.readUInt32LE(p + 24), localOffset: cd.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + cd.readUInt16LE(p + 30) + cd.readUInt16LE(p + 32);
  }
  return entries;
}

/** One entry of a zip file (stored or deflated), at most `maxBytes` once inflated; null when the zip has no such entry. */
export async function readZipEntry(file: string, name: string, maxBytes = 1024 * 1024): Promise<Buffer | null> {
  const fh = await open(file, 'r');
  try {
    const e = (await zipDirectory(fh)).get(name);
    if (!e) return null;
    if (e.flags & 1) throw new ReleaseError(`${name} in the zip is encrypted.`);
    if (e.size > maxBytes || e.compressedSize > maxBytes * 2) throw new ReleaseError(`${name} in the zip is too large.`);
    const local = await readAt(fh, e.localOffset, 30);
    if (local.readUInt32LE(0) !== 0x04034b50) throw new ReleaseError('The zip file is damaged.');
    const data = await readAt(fh, e.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28), e.compressedSize);
    if (e.method === 0) return data;
    if (e.method === 8) {
      try {
        return inflateRawSync(data, { maxOutputLength: maxBytes });
      } catch {
        throw new ReleaseError(`${name} in the zip cannot be read.`);
      }
    }
    throw new ReleaseError(`${name} in the zip uses an unsupported compression.`);
  } finally {
    await fh.close();
  }
}

const ATTR_VERSION_CODE = 0x0101021b;
const ATTR_VERSION_NAME = 0x0101021c;

/** `versionCode` and `versionName` of the `<manifest>` element of a binary AndroidManifest.xml (Android's AXML). */
export function parseManifestVersion(buf: Buffer): { versionCode?: number; versionName?: string } {
  const out: { versionCode?: number; versionName?: string } = {};
  try {
    if (buf.readUInt16LE(0) !== 0x0003) return out;
    let strings: string[] = [];
    let resIds: number[] = [];
    for (let o = buf.readUInt16LE(2); o + 8 <= buf.length;) {
      const type = buf.readUInt16LE(o);
      const hsize = buf.readUInt16LE(o + 2);
      const csize = buf.readUInt32LE(o + 4);
      if (csize < 8 || o + csize > buf.length) break;
      if (type === 0x0001) strings = stringPool(buf, o, hsize);
      else if (type === 0x0180) resIds = Array.from({ length: (csize - hsize) >> 2 }, (_, i) => buf.readUInt32LE(o + hsize + i * 4));
      else if (type === 0x0102 && strings[buf.readUInt32LE(o + 20)] === 'manifest') {
        const attrStart = buf.readUInt16LE(o + 24);
        const attrSize = buf.readUInt16LE(o + 26);
        const attrCount = buf.readUInt16LE(o + 28);
        for (let i = 0; i < attrCount; i++) {
          const a = o + hsize + attrStart + i * attrSize;
          const name = buf.readUInt32LE(a + 4);
          const raw = buf.readUInt32LE(a + 8);
          const dataType = buf.readUInt8(a + 15);
          const data = buf.readUInt32LE(a + 16);
          const asString = raw !== 0xffffffff ? strings[raw] : dataType === 0x03 ? strings[data] : undefined;
          if (strings[name] === 'versionCode' || resIds[name] === ATTR_VERSION_CODE) {
            const n = dataType === 0x10 || dataType === 0x11 ? data : Number(asString);
            if (Number.isInteger(n) && n > 0) out.versionCode = n;
          } else if (strings[name] === 'versionName' || resIds[name] === ATTR_VERSION_NAME) {
            if (asString) out.versionName = asString;
          }
        }
        return out;
      }
      o += csize;
    }
  } catch {
    // a damaged manifest reads as no versions
  }
  return out;
}

function stringPool(buf: Buffer, o: number, hsize: number): string[] {
  const count = buf.readUInt32LE(o + 8);
  const utf8 = (buf.readUInt32LE(o + 16) & 0x100) !== 0;
  const start = o + buf.readUInt32LE(o + 20);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let p = start + buf.readUInt32LE(o + hsize + i * 4);
    if (utf8) {
      p += buf[p]! & 0x80 ? 2 : 1;
      const b = buf[p]!;
      const n = b & 0x80 ? ((b & 0x7f) << 8) | buf[p + 1]! : b;
      p += b & 0x80 ? 2 : 1;
      out.push(buf.toString('utf8', p, p + n));
    } else {
      let n = buf.readUInt16LE(p);
      p += 2;
      if (n & 0x8000) {
        n = ((n & 0x7fff) << 16) | buf.readUInt16LE(p);
        p += 2;
      }
      out.push(buf.toString('utf16le', p, p + n * 2));
    }
  }
  return out;
}

/** The APK's own versionCode and versionName, or null when its manifest cannot be read. */
export async function readApkVersion(file: string): Promise<{ versionCode?: number; versionName?: string } | null> {
  const m = await readZipEntry(file, 'AndroidManifest.xml', 4 * 1024 * 1024).catch(() => null);
  return m ? parseManifestVersion(m) : null;
}

/** A detached ed25519 signature file (64 raw bytes, hex or base64 text) as base64 of the 64 bytes. */
export function normaliseSignature(raw: Buffer): string {
  if (raw.length === 64) return raw.toString('base64');
  const text = raw.toString('utf8').trim();
  let bytes: Buffer | null = null;
  if (/^[0-9a-f]{128}$/i.test(text)) bytes = Buffer.from(text, 'hex');
  else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(text)) bytes = Buffer.from(text, 'base64');
  if (!bytes || bytes.length !== 64) throw new ReleaseError('The signature file must hold one ed25519 signature: 64 bytes, as raw bytes, hex or base64.');
  return bytes.toString('base64');
}

// ---------------------------------------------------------------------------------------------------------------
// Publish

const SHA_RE = /^[0-9a-f]{64}$/;
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;
const VERSION_NAME_RE = /^[\x21-\x7e][\x20-\x7e]{0,63}$/;

async function sha256File(path: string): Promise<{ sha256: string; size: number }> {
  const h = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
    h.update(chunk);
    size += chunk.length;
  }
  return { sha256: h.digest('hex'), size };
}

async function withPublishLock<T>(dir: string, f: () => Promise<T>): Promise<T> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (const d of [join(dir, '..', '..'), join(dir, '..'), dir]) await chmod(d, 0o700).catch(() => undefined);
  const lock = join(dir, 'publish.lock');
  let fh: FileHandle | null = null;
  for (let tries = 0; !fh; tries++) {
    try {
      fh = await open(lock, 'wx', 0o600);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || tries > 0) throw new ReleaseError('Another publish is running for this app and channel. Try again when it is done.');
      // a lock left behind by a publish that died more than 10 minutes ago
      const s = await stat(lock).catch(() => null);
      if (s && Date.now() - s.mtimeMs < 10 * 60_000) throw new ReleaseError('Another publish is running for this app and channel. Try again when it is done.');
      await rm(lock, { force: true });
    }
  }
  try {
    return await f();
  } finally {
    await fh.close();
    await rm(lock, { force: true });
  }
}

/**
 * Copies `src` into `dir` as `name`: writes a temporary copy (0600, fsynced), hashes the copy and renames it into
 * place only when it matches the source's sha256 and size (already checked against `--sha256` when given).
 */
async function storeVerified(src: string, dir: string, name: string, source: { sha256: string; size: number }): Promise<void> {
  const tmp = join(dir, `.${name}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await pipeline(createReadStream(src), createWriteStream(tmp, { flags: 'wx', mode: 0o600 }));
    const fh = await open(tmp, 'r+');
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
    const copy = await sha256File(tmp);
    if (copy.sha256 !== source.sha256 || copy.size !== source.size) throw new ReleaseError('The copy on the server does not match the file (sha256 differs). Nothing was published.');
    await rename(tmp, join(dir, name));
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}

async function writeIndexAndPrune(dir: string, next: ReleaseIndex): Promise<void> {
  next.apk = next.apk.slice(0, RELEASES_KEPT);
  next.web = next.web.slice(0, RELEASES_KEPT);
  await writeJsonSecret(indexFile(dir), next);
  const keep = new Set(['index.json', 'publish.lock', ...next.apk.map((a) => a.file), ...next.web.flatMap((w) => [w.file, `${w.file}.sig`])]);
  for (const f of await readdir(dir)) if (!keep.has(f) && !f.startsWith('.')) await rm(join(dir, f), { force: true });
}

async function sourceDigest(src: string, expected: string | undefined): Promise<{ sha256: string; size: number }> {
  if (expected !== undefined && !SHA_RE.test(expected.toLowerCase())) throw new ReleaseError('--sha256 must be 64 hex characters.');
  const s = await stat(src).catch(() => null);
  if (!s?.isFile()) throw new ReleaseError(`No such file: ${src}`);
  const d = await sha256File(src);
  if (expected !== undefined && d.sha256 !== expected.toLowerCase()) throw new ReleaseError(`The file's sha256 is ${d.sha256}, not the expected ${expected.toLowerCase()}. Nothing was published.`);
  return d;
}

export interface PublishResult<T> {
  release: T;
  /** The same file was already published: nothing changed. */
  unchanged: boolean;
}

export async function publishApk(
  dataDir: string,
  app: ReleaseApp,
  src: string,
  o: { versionName?: string; versionCode?: number; sha256?: string; notes?: string; channel?: ReleaseChannel; now?: () => number } = {},
): Promise<PublishResult<ApkRelease>> {
  const channel = o.channel ?? 'stable';
  if (o.versionCode !== undefined && !(Number.isInteger(o.versionCode) && o.versionCode > 0 && o.versionCode <= 2_100_000_000)) throw new ReleaseError('--version-code must be a whole number from 1 to 2100000000.');
  if (o.versionName !== undefined && !VERSION_NAME_RE.test(o.versionName)) throw new ReleaseError('--version-name must be 1 to 64 printable characters.');
  if (o.notes !== undefined && o.notes.length > 2000) throw new ReleaseError('--notes may be at most 2000 characters.');
  const digest = await sourceDigest(src, o.sha256);
  const own = await readApkVersion(src);
  if (o.versionCode !== undefined && own?.versionCode !== undefined && own.versionCode !== o.versionCode) throw new ReleaseError(`The APK says versionCode ${own.versionCode}, not ${o.versionCode}. Nothing was published.`);
  if (o.versionName !== undefined && own?.versionName !== undefined && own.versionName !== o.versionName) throw new ReleaseError(`The APK says versionName ${own.versionName}, not ${o.versionName}. Nothing was published.`);
  const versionCode = o.versionCode ?? own?.versionCode;
  const versionName = o.versionName ?? own?.versionName;
  if (versionCode === undefined || versionName === undefined || !VERSION_NAME_RE.test(versionName)) {
    throw new ReleaseError('Could not read the version from the APK. Pass --version-name and --version-code.');
  }
  const dir = releaseDir(dataDir, app, channel);
  return withPublishLock(dir, async () => {
    const index = await readReleaseIndex(dataDir, app, channel);
    const same = index.apk.find((a) => a.sha256 === digest.sha256);
    if (same) return { release: same, unchanged: true };
    const newest = index.apk[0];
    if (index.apk.some((a) => a.versionCode === versionCode)) throw new ReleaseError(`versionCode ${versionCode} is already published with a different file. Build with a higher versionCode.`);
    if (newest && versionCode < newest.versionCode) throw new ReleaseError(`versionCode ${versionCode} is lower than the newest published (${newest.versionCode}); Android cannot install it as an update.`);
    const file = `${app}-${versionCode}-${digest.sha256.slice(0, 12)}.apk`;
    await storeVerified(src, dir, file, digest);
    const release: ApkRelease = {
      versionName, versionCode, sha256: digest.sha256, size: digest.size, file, publishedAt: new Date((o.now ?? Date.now)()).toISOString(), ...(o.notes ? { notes: o.notes } : {}),
    };
    await writeIndexAndPrune(dir, { ...index, apk: [release, ...index.apk] });
    return { release, unchanged: false };
  });
}

export async function publishWeb(
  dataDir: string,
  app: ReleaseApp,
  src: string,
  o: { sig: string; version?: string; sha256?: string; channel?: ReleaseChannel; now?: () => number },
): Promise<PublishResult<WebRelease>> {
  if (app !== 'vitals') throw new ReleaseError('Web bundles are for Vitals only.');
  const channel = o.channel ?? 'stable';
  const digest = await sourceDigest(src, o.sha256);
  const sigRaw = await readFile(o.sig).catch(() => null);
  if (!sigRaw) throw new ReleaseError(`No such file: ${o.sig}`);
  if (sigRaw.length > 1024) throw new ReleaseError('The signature file must hold one ed25519 signature: 64 bytes, as raw bytes, hex or base64.');
  const sig = normaliseSignature(sigRaw);
  const raw = await readZipEntry(src, 'bundle.json', 64 * 1024);
  if (!raw) throw new ReleaseError('The zip has no bundle.json at its top level.');
  let meta: { version?: unknown; minNativeVersionCode?: unknown; builtAt?: unknown };
  try {
    meta = JSON.parse(raw.toString('utf8')) as typeof meta;
  } catch {
    throw new ReleaseError('bundle.json in the zip is not valid JSON.');
  }
  const { version, minNativeVersionCode, builtAt } = meta ?? {};
  if (typeof version !== 'string' || !VERSION_RE.test(version)) throw new ReleaseError('bundle.json needs "version": a semver or git hash (letters, digits, . + _ -, at most 64).');
  if (typeof minNativeVersionCode !== 'number' || !Number.isInteger(minNativeVersionCode) || minNativeVersionCode < 0) throw new ReleaseError('bundle.json needs "minNativeVersionCode": a whole number, 0 or more.');
  if (typeof builtAt !== 'string' || !Number.isFinite(Date.parse(builtAt))) throw new ReleaseError('bundle.json needs "builtAt": an ISO date and time.');
  if (o.version !== undefined && o.version !== version) throw new ReleaseError(`bundle.json says version ${version}, not ${o.version}. Nothing was published.`);
  const dir = releaseDir(dataDir, app, channel);
  return withPublishLock(dir, async () => {
    const index = await readReleaseIndex(dataDir, app, channel);
    const same = index.web.find((w) => w.sha256 === digest.sha256);
    if (same) return { release: same, unchanged: true };
    if (index.web.some((w) => w.version === version)) throw new ReleaseError(`Web bundle ${version} is already published with a different file. Give the new build its own version.`);
    const kept = sortWeb(index.web);
    if (kept.length >= RELEASES_KEPT && Date.parse(builtAt) <= builtAtMs(kept[RELEASES_KEPT - 1]!)) {
      throw new ReleaseError(`Web bundle ${version} was built before the ${RELEASES_KEPT} kept bundles. Nothing was published.`);
    }
    const file = `web-${version.replace(/[^0-9A-Za-z.-]/g, '_')}-${digest.sha256.slice(0, 12)}.zip`;
    await storeVerified(src, dir, file, digest);
    await writeFileAtomic(dir, `${file}.sig`, sigRaw);
    const release: WebRelease = { version, minNativeVersionCode, builtAt, sha256: digest.sha256, size: digest.size, file, sig, publishedAt: new Date((o.now ?? Date.now)()).toISOString() };
    await writeIndexAndPrune(dir, { ...index, web: sortWeb([release, ...index.web]) });
    return { release, unchanged: false };
  });
}

/** Atomic 0600 write of raw bytes (the signature file as given): a hidden temporary file, fsynced, then renamed. */
async function writeFileAtomic(dir: string, name: string, data: Buffer): Promise<void> {
  const tmp = join(dir, `.${name}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    const fh = await open(tmp, 'wx', 0o600);
    try {
      await fh.writeFile(data);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, join(dir, name));
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// HTTP

const TAILNET_V6 = /^fd7a:115c:a1e0:/i;
const stripMapped = (a: string) => a.trim().replace(/^::ffff:/i, '').replace(/^\[|\]$/g, '');
const isLoopbackAddr = (a: string) => /^127(?:\.\d{1,3}){3}$/.test(a) || a === '::1';
/** Tailscale's addresses: 100.64.0.0/10 and fd7a:115c:a1e0::/48. */
export function isTailnetAddr(addr: string): boolean {
  const a = stripMapped(addr);
  if (isIP(a) === 4) {
    const [x, y] = a.split('.').map(Number);
    return x === 100 && y! >= 64 && y! <= 127;
  }
  return isIP(a) === 6 && TAILNET_V6.test(a);
}

/**
 * Whether a request comes from the tailnet or from the server itself. The server listens on loopback behind
 * `tailscale serve` and Caddy (bound to the tailnet address): both connect from loopback and append the client's
 * address to `X-Forwarded-For`, so the last entry is the client. Tailscale Funnel marks its public requests with
 * `Tailscale-Funnel-Request`. A loopback request without a forwarded address was made on the server.
 */
export function isTailnetRequest(req: IncomingMessage): boolean {
  const peer = stripMapped(req.socket.remoteAddress ?? '');
  if (isTailnetAddr(peer)) return true;
  if (!isLoopbackAddr(peer)) return false;
  if (req.headers['tailscale-funnel-request'] !== undefined) return false;
  const f = req.headers['x-forwarded-for'];
  const forwarded = Array.isArray(f) ? f.join(',') : f;
  if (forwarded === undefined) return true;
  const last = stripMapped(forwarded.split(',').at(-1) ?? '');
  return isTailnetAddr(last) || isLoopbackAddr(last);
}

type Range = { start: number; end: number } | 'unsatisfiable' | null;

/** One `bytes=` range (RFC 9110); several ranges or a malformed header read as none (the whole file). */
export function parseRange(header: string | undefined, size: number): Range {
  if (!header) return null;
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size) return 'unsatisfiable';
  if (m[2] !== '' && Number(m[2]) < start) return null;
  return { start, end };
}

const CONTENT_TYPES: Record<string, string> = { '.apk': 'application/vnd.android.package-archive', '.zip': 'application/zip' };

/** Streams a stored file with `Content-Length`, `Accept-Ranges` and single-range support (`If-Range` by ETag). */
export async function sendReleaseFile(req: IncomingMessage, res: ServerResponse, path: string, o: { sha256: string; downloadName: string }): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method', 'Use GET or HEAD', { Allow: 'GET, HEAD' });
  const s = await stat(path).catch(() => null);
  if (!s?.isFile()) throw new HttpError(404, 'not_found', 'Not found');
  const size = s.size;
  const etag = `"${o.sha256}"`;
  const ifRange = req.headers['if-range'];
  const range = ifRange !== undefined && ifRange !== etag ? null : parseRange(req.headers.range, size);
  const headers: Record<string, string> = {
    'Content-Type': CONTENT_TYPES[path.slice(path.lastIndexOf('.'))] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Cache-Control': 'private, no-cache',
    'Content-Disposition': `attachment; filename="${o.downloadName.replace(/[^0-9A-Za-z._-]/g, '_')}"`,
    'X-Content-Type-Options': 'nosniff',
  };
  if (range === 'unsatisfiable') {
    res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': '0' }).end();
    return;
  }
  const start = range ? range.start : 0;
  const end = range ? range.end : size - 1;
  res.writeHead(range ? 206 : 200, { ...headers, 'Content-Length': String(Math.max(0, end - start + 1)), ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
  if (req.method === 'HEAD' || size === 0) {
    res.end();
    return;
  }
  const stream = createReadStream(path, { start, end });
  res.on('close', () => stream.destroy());
  try {
    await pipeline(stream, res);
  } catch {
    // the client went away mid-download; nothing to log (never the contents)
    res.destroy();
  }
}

export interface ReleaseCaller {
  kind: 'device' | 'agent' | 'lumen';
  /** Authenticated device id (never its bearer); present on the home role's caller. */
  deviceId?: string;
}

export interface ReleaseRoutesOptions {
  dataDir: string;
  /** `server.json` `releases.publicInstall` (default true): the token-free `/install` page and APK links. */
  publicInstall?: boolean;
  /** The home role's token check for these routes (device and lumen tokens; agent tokens 403 there). */
  resolve: (req: IncomingMessage) => Promise<ReleaseCaller>;
  /** The per-address limit for requests without a token. */
  limitAnon?: (req: IncomingMessage) => void;
  /** Metadata-only receipt when an authenticated Vitals device reports a different installed version pair. */
  log?: (line: string) => void;
}

export const APP_FOR_KIND: Record<'device' | 'lumen', ReleaseApp> = { device: 'vitals', lumen: 'gauge' };
const APP_LABELS: Record<ReleaseApp, string> = { vitals: 'Vitals', gauge: 'Ring app' };
const ALLOW_HEADERS = 'authorization, content-type, range, if-range';
const FILE_RE = /^[0-9A-Za-z][0-9A-Za-z._-]{0,120}$/;
const EMBEDDED_WEB_RE = /^apk-\d+\.\d+\.\d+$/;
const RECEIPTS_KEPT = 1024;

export function createReleaseRoutes(o: ReleaseRoutesOptions) {
  const publicInstall = o.publicInstall ?? true;
  const receipts = new Map<string, string>();
  const notFound = () => new HttpError(404, 'not_found', 'Not found');
  const query = (q: string) => new URLSearchParams(q.startsWith('?') ? q.slice(1) : q);
  const receipt = (caller: ReleaseCaller, code: number, web: string | null, index: ReleaseIndex) => {
    if (caller.kind !== 'device' || !caller.deviceId || !/^[0-9a-f-]{36}$/i.test(caller.deviceId) || !o.log) return;
    const safeWeb = web === null ? 'none' : index.web.some((item) => item.version === web) || STAMPED.test(web) || EMBEDDED_WEB_RE.test(web) ? web : 'unrecognized';
    const reported = `${code}|${safeWeb}`;
    if (receipts.get(caller.deviceId) === reported) return;
    receipts.delete(caller.deviceId);
    receipts.set(caller.deviceId, reported);
    if (receipts.size > RECEIPTS_KEPT) receipts.delete(receipts.keys().next().value!);
    o.log(`release receipt: device ${caller.deviceId} native ${code} web ${safeWeb}`);
  };

  async function apps(req: IncomingMessage, res: ServerResponse, path: string, q: string): Promise<void> {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, HEAD', 'Access-Control-Allow-Headers': ALLOW_HEADERS, 'Access-Control-Max-Age': '7200', 'Access-Control-Allow-Private-Network': 'true' });
      res.end();
      return;
    }
    const caller = await o.resolve(req);
    if (caller.kind === 'agent') throw new HttpError(403, 'wrong_kind', 'This token cannot use this route');
    const m = /^\/v1\/apps\/([a-z]{1,16})\/(latest|files\/([a-z]{1,16})\/([^/]+))$/.exec(path);
    if (!m || !isReleaseApp(m[1])) throw notFound();
    const app = m[1];
    if (APP_FOR_KIND[caller.kind] !== app) throw new HttpError(403, 'wrong_app', `This token cannot see ${APP_LABELS[app]} updates`);
    if (m[2] === 'latest') {
      if (req.method !== 'GET') throw new HttpError(405, 'method', 'Use GET', { Allow: 'GET' });
      const p = query(q);
      const channel = p.get('channel') ?? 'stable';
      if (!isReleaseChannel(channel)) throw new HttpError(400, 'bad_request', `Unknown channel; use ${RELEASE_CHANNELS.join(' or ')}`);
      const code = p.get('versionCode') ?? '';
      if (!/^\d{1,10}$/.test(code)) throw new HttpError(400, 'bad_request', 'Send versionCode: the installed versionCode');
      const web = p.get('web') || null;
      if (web !== null && web.length > 64) throw new HttpError(400, 'bad_request', 'web is at most 64 characters');
      const index = await readReleaseIndex(o.dataDir, app, channel);
      const installed = { versionCode: Number(code), web };
      const answer = latestFor(index, app, channel, installed);
      if (app === 'vitals') receipt(caller, installed.versionCode, web, index);
      return sendJson(res, 200, answer);
    }
    const channel = m[3];
    const file = m[4]!;
    if (!isReleaseChannel(channel) || !FILE_RE.test(file)) throw notFound();
    const index = await readReleaseIndex(o.dataDir, app, channel);
    const hit = index.apk.find((a) => a.file === file) ?? index.web.find((w) => w.file === file);
    if (!hit) throw notFound();
    return sendReleaseFile(req, res, join(releaseDir(o.dataDir, app, channel), file), { sha256: hit.sha256, downloadName: file });
  }

  async function install(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    if (!publicInstall || !isTailnetRequest(req)) throw notFound();
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method', 'Use GET', { Allow: 'GET, HEAD' });
    o.limitAnon?.(req);
    const security = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };
    if (path === '/install' || path === '/install/') {
      const have = await Promise.all(RELEASE_APPS.map(async (app) => ((await readReleaseIndex(o.dataDir, app)).apk.length > 0 ? app : null)));
      const items = RELEASE_APPS.map((app, i) => (have[i] ? `<li><a href="/install/${app}.apk" download>${APP_LABELS[app]}</a></li>` : `<li>${APP_LABELS[app]} <span>(not published yet)</span></li>`)).join('\n');
      const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Install</title>
<style>body{font:18px/1.5 system-ui,sans-serif;margin:2rem 1rem;max-width:30rem}li{margin:.75rem 0}a{font-weight:600}span{color:#777}</style></head>
<body><h1>Install</h1><p>Download an app, open the file and tap Install. Updates then come from inside the app.</p>
<ul>
${items}
</ul></body></html>
`;
      const body = Buffer.from(html, 'utf8');
      res.writeHead(200, {
        ...security, 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': String(body.length), 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    const m = /^\/install\/([a-z]{1,16})\.apk$/.exec(path);
    if (!m || !isReleaseApp(m[1])) throw notFound();
    const app = m[1];
    const a = (await readReleaseIndex(o.dataDir, app)).apk[0];
    if (!a) throw notFound();
    for (const [k, v] of Object.entries(security)) res.setHeader(k, v);
    return sendReleaseFile(req, res, join(releaseDir(o.dataDir, app), a.file), { sha256: a.sha256, downloadName: `${app}-${a.versionName}.apk` });
  }

  return {
    owns: (path: string) => path.startsWith('/v1/apps/') || path === '/install' || path.startsWith('/install/'),
    handle: (req: IncomingMessage, res: ServerResponse, path: string, q: string): Promise<void> => (path.startsWith('/v1/apps/') ? apps(req, res, path, q) : install(req, res, path)),
  };
}
