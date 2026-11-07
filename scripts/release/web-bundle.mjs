// The over-the-air web bundle for the Android app (vitals-research/ota/CONTRACT.md "Web bundle format"): a zip of the
// built dist/ plus bundle.json, and a detached ed25519 signature over the zip's sha256 (lowercase hex string).
//
// Usage: node scripts/release/web-bundle.mjs [--use-dist] [--out <dir>] [--key <private key PEM>] [--min-native-version-code <positive integer>]
//   --use-dist   zip the existing dist/ instead of running `pnpm run build` first
//   --out        output folder (default apps/android/release/web, git-ignored)
//   --key        signing key (default ~/.config/vitals-release/web-bundle-ed25519.key, or $VITALS_WEB_BUNDLE_KEY)
//   --min-native-version-code  oldest compatible Android versionCode (default: this package's versionCode)
//   --help       show this usage without building or signing
//
// It also writes dist/bundle.json, so an APK built from this dist afterwards (cap sync, no new web build) knows its own
// bundle's version and build time: a phone never swaps the APK's bundle for an older download.
// Prints the zip, the .sig and the server's publish command.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
/** Left out of the bundle, as the APK leaves it out (apps/android build.gradle aaptOptions). */
const SKIP = new Set(['sw.js']);
const USAGE = `Usage: node scripts/release/web-bundle.mjs [--use-dist] [--out <dir>] [--key <private key PEM>] [--min-native-version-code <positive integer>]
  --use-dist   zip the existing dist/ instead of building it
  --out        output folder (default apps/android/release/web)
  --key        signing key (default ~/.config/vitals-release/web-bundle-ed25519.key or $VITALS_WEB_BUNDLE_KEY)
  --min-native-version-code  oldest compatible Android versionCode (1..current package versionCode; default: current)
  --help       show this usage without building or signing`;

/** versionCode = major*10000 + minor*100 + patch, as apps/android/android/app/build.gradle computes it. */
export function versionCodeOf(version) {
  const [major, minor, patch] = String(version).split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10));
  if (![major, minor, patch].every(Number.isInteger)) throw new Error(`not a version: ${version}`);
  return major * 10000 + minor * 100 + patch;
}

/** The optional OTA compatibility floor; never allow a future or non-integer Android versionCode. */
export function minNativeVersionCodeOf(value, current) {
  if (!Number.isSafeInteger(current) || current < 1) throw new Error('current package versionCode must be positive');
  if (value === undefined) return current;
  if (!/^[1-9]\d*$/.test(value)) throw new Error('--min-native-version-code must be a positive integer');
  const floor = Number(value);
  if (!Number.isSafeInteger(floor) || floor > current) throw new Error(`--min-native-version-code must be between 1 and ${current}`);
  return floor;
}

/** `<yyyymmddHHMM UTC>-<git short hash>`: sorts by build time, names the commit, and is a safe folder name. */
export function bundleVersion(date, hash) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}`;
  if (!/^[0-9a-f]{4,40}$/.test(hash)) throw new Error(`not a git hash: ${hash}`);
  return `${stamp}-${hash}`;
}

/** A zip (deflate, UTF-8 names, fixed timestamps so the same files give the same bytes). `files`: [{ name, data }]. */
export function makeZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  const DOS_TIME = 0;
  const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
  for (const { name, data } of [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(stored ? 0 : 8, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  if (files.length > 0xffff || offset > 0xffffffff) throw new Error('bundle too large for a plain zip');
  return Buffer.concat([...locals, cdBuf, end]);
}

export const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex');

/** The detached signature: ed25519 over the sha256 hex string, base64 (what the server returns as `sig`). */
export function signSha(shaHex, privateKeyPem) {
  return sign(null, Buffer.from(shaHex.toLowerCase(), 'ascii'), createPrivateKey(privateKeyPem)).toString('base64');
}

export function verifySha(shaHex, sigBase64, publicKey) {
  return verify(null, Buffer.from(shaHex.toLowerCase(), 'ascii'), publicKey, Buffer.from(sigBase64, 'base64'));
}

/** Every file under `dir` as zip entries (forward-slash names), minus SKIP at the top level. */
export function collect(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const rel = relative(dir, full).split(sep).join('/');
        if (!SKIP.has(rel)) out.push({ name: rel, data: readFileSync(full) });
      }
    }
  };
  walk(dir);
  return out;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function main() {
  if (process.argv.includes('--help')) {
    console.log(USAGE);
    return;
  }
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const currentVersionCode = versionCodeOf(pkg.version);
  const minArg = process.argv.includes('--min-native-version-code') ? (arg('--min-native-version-code') ?? '') : undefined;
  const minNativeVersionCode = minNativeVersionCodeOf(minArg, currentVersionCode);
  const dist = join(ROOT, 'dist');
  if (!process.argv.includes('--use-dist')) execFileSync('pnpm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/index.html is missing: build first or drop --use-dist');

  const keyPath = arg('--key') ?? process.env.VITALS_WEB_BUNDLE_KEY ?? join(homedir(), '.config/vitals-release/web-bundle-ed25519.key');
  const keyPem = readFileSync(keyPath, 'utf8');
  const hash = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: ROOT, encoding: 'utf8' }).trim() !== '';
  if (dirty) console.warn('web-bundle: the working tree has uncommitted changes; the version names HEAD.');

  const now = new Date();
  const bundle = { version: bundleVersion(now, hash), minNativeVersionCode, builtAt: now.toISOString() };
  writeFileSync(join(dist, 'bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`);

  const zip = makeZip(collect(dist));
  const sha = sha256Hex(zip);
  const sig = signSha(sha, keyPem);
  if (!verifySha(sha, sig, createPublicKey(createPrivateKey(keyPem)))) throw new Error('signature does not verify');
  const pubPath = keyPath.replace(/\.key$/, '.pub');
  if (pubPath !== keyPath && existsSync(pubPath) && !verifySha(sha, sig, createPublicKey(readFileSync(pubPath, 'utf8')))) {
    throw new Error(`${pubPath} does not match the signing key`);
  }

  const outDir = resolve(arg('--out') ?? join(ROOT, 'apps/android/release/web'));
  mkdirSync(outDir, { recursive: true });
  const zipPath = join(outDir, `vitals-web-${bundle.version}.zip`);
  writeFileSync(zipPath, zip);
  writeFileSync(`${zipPath}.sig`, `${sig}\n`);
  console.log(JSON.stringify({ zip: zipPath, sig: `${zipPath}.sig`, ...bundle, sha256: sha, size: zip.length }, null, 2));
  console.log(`\npublish: vitals-server release publish vitals --web <zip> --version ${bundle.version} --sig <zip>.sig`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
