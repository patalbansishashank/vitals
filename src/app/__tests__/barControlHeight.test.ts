import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const shell = read('src/styles/shell.css');

describe('one control height in the top bars and the action bar', () => {
  it('defines --lm-bar-control-h as 36 px, 44 px under a coarse pointer, in both token files', () => {
    for (const f of ['design/tokens.css', 'src/styles/tokens.css']) {
      const css = read(f);
      expect(css).toMatch(/--lm-bar-control-h:\s*36px/);
      expect(css).toMatch(/@media \(pointer: coarse\)\s*\{\s*:root\s*\{\s*--lm-bar-control-h:\s*44px/);
    }
  });

  it('sizes every kind of bar control from the token, with no fixed pixel heights', () => {
    const start = shell.indexOf('one control height in the bars');
    expect(start).toBeGreaterThan(0);
    const block = shell.slice(start);
    for (const sel of ['.lm-key:not', '.lm-key[data-icon-only', '.lm-bank', '.lm-stepper', '.lm-stepper__btn', '.lm-numfield', '.lm-input', '.lm-select', '.lm-switch', '.lm-chip', '.lm-runkey__cap'])
      expect(block).toContain(sel);
    expect(block).not.toMatch(/(?<![-\w])height:\s*\d+px/);
    expect(block).not.toMatch(/min-height:\s*\d+px/);
  });

  it('the bars themselves follow the token', () => {
    expect(shell).toMatch(/--lm-deskbar-h:\s*calc\(var\(--lm-bar-control-h\)/);
    expect(shell).toMatch(/min-height:\s*calc\(var\(--lm-bar-control-h\) \+ 20px\)/);
  });
});
