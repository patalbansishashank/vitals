// @vitest-environment node
/**
 * Guard for the built-in V0789 passcode (passcode.ts): it is a protocol constant that must never surface. It may appear
 * only in passcode.ts, as bytes; every other tracked file is scanned for it in plain text and in the hex forms a log,
 * capture or fixture would use. Failures name files only, never the value.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { OP, authenticationRequest, redactOutbound, validateCredential } from '../commands';
import { builtInPasscode } from '../passcode';

const REPO = join(__dirname, '../../../../../..');
const HOME = 'src/biometrics/core/ble/jstyle2301/passcode.ts';
const BINARY = /\.(png|jpe?g|webp|gif|avif|ico|woff2?|ttf|otf|wasm|zip|gz|br|pdf|mp4|webm|db|sqlite)$/i;

function forms(v: string): string[] {
  const hex = [...v].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'));
  return [v, hex.join(''), hex.join('').toUpperCase(), hex.join(' '), hex.join(' ').toUpperCase(), hex.map((h) => `0x${h}`).join(', ')];
}

describe('built-in V0789 passcode', () => {
  it('is a valid credential and its auth frame is redacted for diagnostics', () => {
    const v = builtInPasscode();
    expect(validateCredential(v)).toBe(true);
    const frame = authenticationRequest(v);
    expect(frame[0]).toBe(OP.AUTHENTICATE);
    const red = redactOutbound(frame);
    expect(red[0]).toBe(OP.AUTHENTICATE);
    expect([...red.subarray(1, 1 + v.length)].some((b, i) => b === v.charCodeAt(i))).toBe(false);
  });

  it('appears in no tracked file except passcode.ts', () => {
    const needles = forms(builtInPasscode());
    const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20 })
      .split('\0')
      .filter((f) => f && f !== HOME && !BINARY.test(f));
    const hits: string[] = [];
    for (const f of files) {
      const p = join(REPO, f);
      let text: string;
      try {
        if (statSync(p).size > 8 << 20) continue;
        text = readFileSync(p, 'latin1');
      } catch {
        continue; // deleted in the working tree
      }
      if (needles.some((n) => text.includes(n))) hits.push(f);
    }
    expect(hits, 'the V0789 passcode may appear only in passcode.ts').toEqual([]);
  }, 60_000);
});
