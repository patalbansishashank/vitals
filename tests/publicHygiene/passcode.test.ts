// @vitest-environment node
/** Same path-only leak check as the Android JUnit guard, runnable before publishing without an Android SDK. */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { listPaths, publishExcluded, REPO } from './scan';

const CANONICAL = 'apps/android/android/gauge/src/main/java/com/pulseloop/ring/JStyle2301Passcode.kt';

function firmwareBytes(): Buffer {
  const source = readFileSync(join(REPO, CANONICAL), 'utf8');
  const match = source.match(/private\s+val\s+value\s*=\s*byteArrayOf\(([^)]+)\)/);
  if (!match) throw new Error('Cannot resolve the canonical firmware byte holder; publication must stop.');
  const tokens = match[1]!.split(',').map((t) => t.trim());
  if (tokens.length !== 8 || tokens.some((t) => !/^(?:\d+|0x[\da-f]+)$/i.test(t))) throw new Error('Unsupported canonical firmware byte representation.');
  const values = tokens.map(Number);
  if (values.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) throw new Error('Invalid canonical firmware bytes.');
  return Buffer.from(values);
}

function leakPaths(bytes: Buffer, paths: readonly string[], read: (path: string) => Buffer | null): string[] {
  const plain = bytes.toString('ascii');
  const compactHex = bytes.toString('hex');
  const spacedHex = bytes.toString('hex').match(/../g)!.join(' ');
  return paths.filter((path) => {
    if (path === CANONICAL) return false;
    const content = read(path);
    if (!content || content.subarray(0, 4096).includes(0)) return false;
    const text = content.toString('utf8');
    const lower = text.toLowerCase();
    return text.includes(plain) || lower.includes(compactHex) || lower.includes(spacedHex);
  });
}

describe('firmware material in the public snapshot', () => {
  it('detects text and both hex forms while reporting only paths and allowing the one canonical holder', () => {
    const bytes = Buffer.from(Array.from({ length: 8 }, (_, i) => i + 65));
    const inputs = [bytes.toString('ascii'), bytes.toString('hex'), bytes.toString('hex').match(/../g)!.join(' '), 'ordinary source'];
    const paths = inputs.map((_, i) => `file-${i}`);
    expect(leakPaths(bytes, paths, (p) => Buffer.from(inputs[paths.indexOf(p)]!))).toEqual(paths.slice(0, 3));
    expect(leakPaths(bytes, [CANONICAL], () => bytes)).toEqual([]);
  });

  it('keeps the firmware passcode only in its current canonical Android source', () => {
    const excluded = publishExcluded();
    const paths = listPaths().filter((p) => !excluded(p));
    const leaks = leakPaths(firmwareBytes(), paths, (p) => {
      try { return statSync(join(REPO, p)).isFile() ? readFileSync(join(REPO, p)) : null; }
      catch { return null; }
    });
    // Never include a matched value in a failure, snapshot, diagnostic or log.
    expect(leaks, 'Firmware material outside the canonical file (paths only)').toEqual([]);
  });
});
