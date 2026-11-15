import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip } from './web-bundle.mjs';

const SCRIPT = fileURLToPath(new URL('./ota-publish.sh', import.meta.url));

// A stand-in for `vitals-server release list|publish vitals`: keeps the feed in feed.json, reads an APK's versionCode
// from a `versionCode=<n>` marker and a bundle's floor from its bundle.json, and prints what the real CLI prints.
const FAKE_CLI = `#!/usr/bin/env node
const { readFileSync, writeFileSync, appendFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const feedPath = process.env.FAKE_FEED;
const feed = JSON.parse(readFileSync(feedPath, 'utf8'));
const [cmd, sub, app, ...rest] = process.argv.slice(2);
const opt = (n) => { const i = rest.indexOf(n); return i < 0 ? undefined : rest[i + 1]; };
appendFileSync(feedPath + '.log', [cmd, sub, app, ...rest].join(' ') + '\\n');
if (cmd !== 'release' || app !== 'vitals') process.exit(2);
if (sub === 'list') {
  console.log('vitals (stable): ' + feed.apk.length + ' APKs, ' + feed.web.length + ' web bundles');
  for (const a of feed.apk) console.log('  apk  0.0.' + a + ' (versionCode ' + a + ')  1.0 MB  sha256 x  published t  /f');
  for (const w of feed.web) console.log('  web  ' + w.version + ' (needs versionCode ' + w.min + '+, built t)  1.0 MB  sha256 x  published t  /f');
} else if (opt('--apk')) {
  const code = Number(/versionCode=(\\d+)/.exec(readFileSync(opt('--apk'), 'latin1'))[1]);
  feed.apk.unshift(code);
  console.log('Published vitals APK (versionCode ' + code + ').');
} else {
  readFileSync(opt('--sig'));
  const b = JSON.parse(execFileSync('unzip', ['-p', opt('--web'), 'bundle.json'], { encoding: 'utf8' }));
  feed.web.unshift({ version: b.version, min: b.minNativeVersionCode });
  console.log('Published vitals web bundle ' + b.version + '.');
}
writeFileSync(feedPath, JSON.stringify(feed));
`;

// A binary AndroidManifest.xml (AXML) whose <manifest> carries versionCode, laid out as the server's reader expects
// (packages/companion/src/home/releases.test.ts builds the same).
function axml(versionCode) {
  const strings = ['versionCode', 'versionName', 'manifest', `0.0.${versionCode}`];
  const encoded = strings.map((s) => {
    const b = Buffer.alloc(4 + s.length * 2);
    b.writeUInt16LE(s.length, 0);
    b.write(s, 2, 'utf16le');
    return b;
  });
  const offsets = [];
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
  const el = Buffer.alloc(76);
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

// `zip` with `text` as its comment, which zip readers skip.
function withComment(zip, text) {
  const comment = Buffer.from(text);
  const out = Buffer.concat([zip, comment]);
  out.writeUInt16LE(comment.length, zip.length - 2);
  return out;
}

function setup(feed) {
  const dir = mkdtempSync(join(tmpdir(), 'ota-publish-'));
  const cli = join(dir, 'fake-vitals-server');
  writeFileSync(cli, FAKE_CLI);
  chmodSync(cli, 0o755);
  writeFileSync(join(dir, 'feed.json'), JSON.stringify(feed));
  // `readable`: an APK-shaped zip whose manifest the script can read; otherwise a file with no manifest at all. Both
  // carry the marker the fake CLI reads and, when signed, the signing block's magic.
  const apk = (code, { signed = true, readable = false } = {}) => {
    const p = join(dir, `vitals-${code}${signed ? '' : '-unsigned'}.apk`);
    const marker = `versionCode=${code} ${signed ? 'APK Sig Block 42' : ''}`;
    const zip = () => makeZip([{ name: 'AndroidManifest.xml', data: axml(code) }, { name: 'classes.dex', data: Buffer.from('dex') }]);
    writeFileSync(p, readable ? withComment(zip(), marker) : `PK fake apk ${marker}`);
    return p;
  };
  const web = (version, min, { sig = true } = {}) => {
    const p = join(dir, `vitals-web-${version}.zip`);
    const bundle = { version, minNativeVersionCode: min, builtAt: '2026-11-15T10:00:00.000Z' };
    writeFileSync(p, makeZip([{ name: 'index.html', data: Buffer.from('<!doctype html>') }, { name: 'bundle.json', data: Buffer.from(JSON.stringify(bundle)) }]));
    if (sig) writeFileSync(`${p}.sig`, 'c2ln\n');
    return p;
  };
  const env = { PATH: process.env.PATH, HOME: dir, OTA_TARGET: 'local', OTA_CLI: cli, FAKE_FEED: join(dir, 'feed.json') };
  const run = (...args) => spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env });
  // ssh and scp stand-ins: the "host" is this folder (its home), so staged copies land in it.
  const runSsh = (...args) => {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'ssh'), `#!/usr/bin/env bash\nshift\ncd "${dir}" && bash -c "$*"\n`);
    writeFileSync(join(bin, 'scp'), `#!/usr/bin/env bash\n[ "$1" = -q ] && shift\ncp "$1" "${dir}/\${2#*:}"\n`);
    chmodSync(join(bin, 'ssh'), 0o755);
    chmodSync(join(bin, 'scp'), 0o755);
    const sshEnv = { ...env, PATH: `${bin}:${process.env.PATH}`, OTA_TARGET: 'ssh:home-server', OTA_REMOTE_CLI: cli };
    return spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env: sshEnv });
  };
  const published = () => {
    const log = join(dir, 'feed.json.log');
    return existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l.startsWith('release publish')) : [];
  };
  const done = () => rmSync(dir, { recursive: true, force: true });
  return { dir, apk, web, run, runSsh, published, done };
}

test('refuses a web bundle that needs a newer APK than the feed has, and publishes nothing', () => {
  const t = setup({ apk: [802], web: [] });
  try {
    const r = t.run('--web', t.web('202611151000-abc1234', 807));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /needs versionCode 807\+, but the newest APK in the feed is 802/);
    assert.match(r.stderr, /--min-native-version-code 802/);
    assert.deepEqual(t.published(), []);
  } finally {
    t.done();
  }
});

test('an empty feed refuses any web bundle on its own', () => {
  const t = setup({ apk: [], web: [] });
  try {
    const r = t.run('--web', t.web('202611151000-abc1234', 1));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /the feed has no APK yet/);
  } finally {
    t.done();
  }
});

test('publishes the APK first when both go out in one run, then prints what the feed offers', () => {
  const t = setup({ apk: [802], web: [] });
  try {
    const r = t.run('--apk', t.apk(807), '--web', t.web('202611151000-abc1234', 807), '--notes', 'Faster ring data');
    assert.equal(r.status, 0, r.stderr);
    const pub = t.published();
    assert.equal(pub.length, 2);
    assert.match(pub[0], /--apk .*vitals-807\.apk --notes Faster ring data$/);
    assert.match(pub[1], /--web .*vitals-web-202611151000-abc1234\.zip --sig .*\.zip\.sig --version 202611151000-abc1234$/);
    const tail = r.stdout.slice(r.stdout.indexOf('[ota] 5.'));
    assert.match(tail, /apk {2}0\.0\.807 \(versionCode 807\)/);
    assert.match(tail, /a phone on APK 807 takes web bundle 202611151000-abc1234\n$/);
  } finally {
    t.done();
  }
});

test('a bundle with an older floor goes out on its own to the APK already in the feed', () => {
  const t = setup({ apk: [802], web: [] });
  try {
    const r = t.run('--web', t.web('202611151000-abc1234', 802));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(t.published().length, 1);
    assert.match(r.stdout, /a phone on APK 802 takes web bundle 202611151000-abc1234\n$/);
  } finally {
    t.done();
  }
});

test('refuses a too-old APK with its bundle before publishing either, when the APK says its versionCode', () => {
  const t = setup({ apk: [802], web: [] });
  try {
    const dry = t.run('--dry-run', '--apk', t.apk(805, { readable: true }), '--web', t.web('202611151000-abc1234', 807));
    assert.notEqual(dry.status, 0);
    assert.match(dry.stderr, /needs versionCode 807\+, but vitals-805\.apk is versionCode 805 and the feed's newest APK is 802/);
    const r = t.run('--apk', t.apk(805, { readable: true }), '--web', t.web('202611151000-abc1234', 807));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Nothing was published/);
    assert.deepEqual(t.published(), []);
    const ok = t.run('--dry-run', '--apk', t.apk(807, { readable: true }), '--web', t.web('202611151000-abc1234', 807));
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /APK vitals-807\.apk \(versionCode 807\)/);
    assert.match(ok.stdout, /3\. floor check passed/);
  } finally {
    t.done();
  }
});

test('checks the floor again after the APK when its manifest cannot be read: a too-old APK leaves the bundle unpublished', () => {
  const t = setup({ apk: [802], web: [] });
  try {
    const dry = t.run('--dry-run', '--apk', t.apk(805), '--web', t.web('202611151000-abc1234', 807));
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /3\. floor not checked yet/);
    assert.doesNotMatch(dry.stdout, /floor check passed/);
    const r = t.run('--apk', t.apk(805), '--web', t.web('202611151000-abc1234', 807));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /the APK is published, but web bundle 202611151000-abc1234 needs versionCode 807\+/);
    assert.equal(t.published().length, 1);
    assert.match(t.published()[0], /--apk /);
  } finally {
    t.done();
  }
});

test('refuses an unsigned APK, a bundle without its signature, and a dry run publishes nothing', () => {
  const t = setup({ apk: [802], web: [] });
  try {
    const unsigned = t.run('--apk', t.apk(807, { signed: false }));
    assert.notEqual(unsigned.status, 0);
    assert.match(unsigned.stderr, /is not signed/);
    const noSig = t.run('--web', t.web('202611151000-abc1234', 802, { sig: false }));
    assert.notEqual(noSig.status, 0);
    assert.match(noSig.stderr, /no signature at/);
    const dry = t.run('--dry-run', '--apk', t.apk(807), '--web', t.web('202611151001-abc1234', 807));
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /dry run: nothing copied or published/);
    assert.deepEqual(t.published(), []);
  } finally {
    t.done();
  }
});

test('over ssh it stages the files in a private folder, publishes those copies and removes them', () => {
  const t = setup({ apk: [802], web: [] });
  try {
    const r = t.runSsh('--apk', t.apk(807), '--web', t.web('202611151000-abc1234', 807), '--notes', "it's here");
    assert.equal(r.status, 0, r.stderr);
    const pub = t.published();
    assert.match(pub[0], /--apk vitals-server\/incoming\/vitals-807\.apk --notes it's here$/);
    assert.match(pub[1], /--web vitals-server\/incoming\/vitals-web-202611151000-abc1234\.zip --sig vitals-server\/incoming\/vitals-web-202611151000-abc1234\.zip\.sig/);
    assert.deepEqual(readdirSync(join(t.dir, 'vitals-server/incoming')), []);
    assert.match(r.stdout, /a phone on APK 807 takes web bundle 202611151000-abc1234\n$/);
  } finally {
    t.done();
  }
});

test('--list only prints the feed and the bundle a phone on the newest APK takes', () => {
  const t = setup({ apk: [802, 801], web: [{ version: '202611071000-new', min: 806 }, { version: '202611020954-old', min: 709 }] });
  try {
    const r = t.run('--list');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /apk {2}0\.0\.802 \(versionCode 802\)/);
    assert.match(r.stdout, /a phone on APK 802 takes web bundle 202611020954-old\n$/);
    assert.deepEqual(t.published(), []);
  } finally {
    t.done();
  }
});

test('names no host of its own: the target comes from the environment or the git-ignored QA config', () => {
  const text = readFileSync(SCRIPT, 'utf8');
  assert.match(text, /OTA_TARGET/);
  assert.match(text, /qa\/local\.config\.json/);
  assert.doesNotMatch(text, /\.ts\.net|creative\.desi|\b100\.\d+\.\d+\.\d+\b/);
});
