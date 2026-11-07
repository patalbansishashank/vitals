import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleVersion, makeZip, minNativeVersionCodeOf, sha256Hex, signSha, verifySha, versionCodeOf } from './web-bundle.mjs';

test('versionCode matches build.gradle', () => {
  assert.equal(versionCodeOf('0.6.1'), 601);
  assert.equal(versionCodeOf('1.2.3-rc.1'), 10203);
  assert.throws(() => versionCodeOf('x'));
});

test('native compatibility floor defaults to the package and accepts an older compatible version', () => {
  assert.equal(minNativeVersionCodeOf(undefined, 703), 703);
  assert.equal(minNativeVersionCodeOf('702', 703), 702);
  assert.equal(minNativeVersionCodeOf('1', 703), 1);
  assert.equal(minNativeVersionCodeOf('703', 703), 703);
});

test('native compatibility floor rejects missing, invalid and future codes', () => {
  for (const value of ['', 'NaN', '0', '-1', '702.5', '704', '9007199254740993', ' 702', '702 '])
    assert.throws(() => minNativeVersionCodeOf(value, 703), /--min-native-version-code/);
  assert.throws(() => minNativeVersionCodeOf(undefined, 0), /current package versionCode/);
});

test('CLI help describes the floor and invalid values fail before build or signing', () => {
  const script = fileURLToPath(new URL('./web-bundle.mjs', import.meta.url));
  const help = execFileSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.match(help, /--min-native-version-code <positive integer>/);
  assert.match(help, /default: current/);
  const bad = spawnSync(process.execPath, [script, '--min-native-version-code', '0'], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /--min-native-version-code must be a positive integer/);
  assert.doesNotMatch(bad.stderr, /dist\/index\.html is missing|ENOENT.*web-bundle-ed25519/);
});

test('bundle version is the UTC build minute and the short hash, a safe folder name', () => {
  const v = bundleVersion(new Date('2026-10-26T09:05:00Z'), 'a1b2c3d');
  assert.equal(v, '202610260905-a1b2c3d');
  assert.match(v, /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/);
  assert.throws(() => bundleVersion(new Date(), '../x'));
});

test('signature is ed25519 over the sha256 hex string, base64', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const sha = sha256Hex(Buffer.from('zip bytes'));
  const sig = signSha(sha, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  assert.equal(Buffer.from(sig, 'base64').length, 64);
  assert.ok(verifySha(sha, sig, publicKey));
  assert.ok(verifySha(sha.toUpperCase(), sig, publicKey));
  assert.ok(!verifySha(sha256Hex(Buffer.from('other')), sig, publicKey));
});

test('the zip is deterministic and unzips to the same files', () => {
  const files = [
    { name: 'index.html', data: Buffer.from('<!doctype html><title>x</title>'.repeat(20)) },
    { name: 'assets/app-1.js', data: Buffer.from('console.log(1)') },
    { name: 'bundle.json', data: Buffer.from('{"version":"v"}') },
  ];
  const zip = makeZip(files);
  assert.deepEqual(zip, makeZip([...files].reverse()));
  const dir = mkdtempSync(join(tmpdir(), 'web-bundle-'));
  try {
    writeFileSync(join(dir, 'b.zip'), zip);
    execFileSync('unzip', ['-q', join(dir, 'b.zip'), '-d', join(dir, 'out')]);
    for (const f of files) assert.deepEqual(readFileSync(join(dir, 'out', f.name)), f.data);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
