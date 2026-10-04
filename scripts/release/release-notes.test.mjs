import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FOOTER, releaseNotes, renderNotes } from './release-notes.mjs';

const SCRIPT = fileURLToPath(new URL('./release-notes.mjs', import.meta.url));
const REAL_CHANGELOG = fileURLToPath(new URL('../../CHANGELOG.md', import.meta.url));

const SAMPLE = `# Changelog

## Unreleased

### Added
- Pending thing.

## [0.4.10] - 2026-10-09

### Fixed
- Ten.

## [0.4.0] - 2026-10-03

### Added
- Four.

### Changed
- Four changed.

## [0.3.0] - 2026-09-01

### Added
- Three.
`;

describe('releaseNotes', () => {
  test('picks only the section of an exact version', () => {
    const { body, fromUnreleased } = releaseNotes(SAMPLE, '0.4.0');
    assert.equal(fromUnreleased, false);
    assert.equal(body, '### Added\n- Four.\n\n### Changed\n- Four changed.');
    assert.ok(!body.includes('Ten.') && !body.includes('Three.') && !body.includes('Pending'));
  });

  test('0.4.1 is not matched by 0.4.10 and 0.4 not by 0.4.0', () => {
    assert.equal(releaseNotes(SAMPLE, '0.4.10').body, '### Fixed\n- Ten.');
    assert.equal(releaseNotes(SAMPLE, '0.4.1').fromUnreleased, true);
    assert.equal(releaseNotes(SAMPLE, '0.4').fromUnreleased, true);
  });

  test('stops at the next ## heading and keeps ### headings', () => {
    const { body } = releaseNotes(SAMPLE, '0.3.0');
    assert.equal(body, '### Added\n- Three.');
  });

  test('falls back to Unreleased', () => {
    const { body, fromUnreleased } = releaseNotes(SAMPLE, '9.9.9');
    assert.equal(fromUnreleased, true);
    assert.equal(body, '### Added\n- Pending thing.');
  });

  test('throws when there is no section at all', () => {
    assert.throws(() => releaseNotes('# Changelog\n\n## [0.1.0] - 2026-01-01\n- x\n', '0.2.0'), /no "## \[0\.2\.0\]" section/);
  });

  test('throws on an empty section', () => {
    assert.throws(() => releaseNotes('## [1.0.0] - 2026-01-01\n\n\n## [0.9.0]\n- x\n', '1.0.0'), /empty/);
    assert.throws(() => releaseNotes('## Unreleased\n\n## [0.9.0]\n- x\n', '1.0.0'), /empty/);
  });

  test('handles CRLF line endings', () => {
    assert.equal(releaseNotes(SAMPLE.replace(/\n/g, '\r\n'), '0.3.0').body, '### Added\n- Three.');
  });
});

describe('renderNotes', () => {
  test('appends the downloads footer after the body', () => {
    const { markdown } = renderNotes(SAMPLE, '0.4.0');
    assert.ok(markdown.startsWith('### Added\n- Four.'));
    assert.ok(markdown.endsWith(FOOTER));
    for (const name of [
      'Vitals-android.apk',
      'Vitals-linux-x86_64.AppImage',
      'Vitals-linux-amd64.deb',
      'Vitals-windows-x64-setup.exe',
      'Vitals-macos-universal.dmg',
      'SHA256SUMS.txt',
      'sha256sum -c SHA256SUMS.txt --ignore-missing',
    ]) {
      assert.ok(markdown.includes(name), name);
    }
  });

  test('works on the real CHANGELOG.md for 0.4.0', () => {
    const { markdown, fromUnreleased } = renderNotes(readFileSync(REAL_CHANGELOG, 'utf8'), '0.4.0');
    assert.equal(fromUnreleased, false);
    assert.ok(markdown.includes('**Vitals Server.**'));
    assert.ok(!markdown.includes('## [0.4.0]'));
    assert.ok(!markdown.includes('Ring key'), 'must not include the Unreleased section');
  });
});

describe('CLI', () => {
  const root = join(process.env.TMPDIR ?? tmpdir(), 'release-notes-test');
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, 'cli-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  const run = (version, text) => {
    const file = join(dir, 'CHANGELOG.md');
    writeFileSync(file, text);
    return spawnSync(process.execPath, [SCRIPT, version, file], { encoding: 'utf8' });
  };

  test('prints the notes on stdout, nothing on stderr', () => {
    const r = run('0.4.0', SAMPLE);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assert.equal(r.stdout, `### Added\n- Four.\n\n### Changed\n- Four changed.\n\n${FOOTER}`);
  });

  test('warns on stderr when it falls back to Unreleased', () => {
    const r = run('1.2.3', SAMPLE);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /^::warning::.*1\.2\.3/);
    assert.ok(r.stdout.startsWith('### Added\n- Pending thing.'));
  });

  test('exits 1 with a message when nothing matches', () => {
    const r = run('1.2.3', '# Changelog\n');
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /no "## \[1\.2\.3\]" section/);
  });

  test('exits 1 without a version', () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Usage/);
  });
});
