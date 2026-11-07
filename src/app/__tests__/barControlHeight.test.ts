import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const shell = read('src/styles/shell.css');

describe('one control height in the header row and the action bar row', () => {
  it('defines --lm-bar-control-h as 36 px, 44 px under a coarse pointer, in both token files', () => {
    for (const f of ['design/tokens.css', 'src/styles/tokens.css']) {
      const css = read(f);
      expect(css).toMatch(/--lm-bar-control-h:\s*36px/);
      expect(css).toMatch(/@media \(pointer: coarse\)\s*\{\s*:root\s*\{\s*--lm-bar-control-h:\s*44px/);
    }
  });

  it('sizes every kind of control a screen puts in its header row or action row from the token, with no fixed pixel heights', () => {
    const start = shell.indexOf('one control height in the bars');
    expect(start).toBeGreaterThan(0);
    const block = shell.slice(start);
    expect(block).toContain(':is(.lm-ctx__row, .lm-actionbar)');
    // the header's tabs row keeps the segmented control's own SPEC §5 height (40 px, 48 px under a coarse pointer)
    expect(block).not.toContain(':is(.lm-ctx, .lm-actionbar)');
    expect(block).not.toMatch(/\.lm-ctx__tabs[^{]*\.lm-bank/);
    for (const sel of ['.lm-key:not', '.lm-key[data-icon-only', '.lm-bank', '.lm-stepper', '.lm-stepper__btn', '.lm-numfield', '.lm-input', '.lm-select', '.lm-switch', '.lm-chip', '.lm-runkey__cap'])
      expect(block).toContain(sel);
    expect(block).not.toMatch(/(?<![-\w])height:\s*\d+px/);
    expect(block).not.toMatch(/min-height:\s*\d+px/);
  });

  it('the bar’s own keys (Back, ⋯) are 48 px targets from one token; the status icons keep their own 48 px', () => {
    expect(shell).toMatch(/--lm-header-key:\s*48px/);
    const own = shell.match(/\.lm-ctx \.lm-key:is\(\.lm-ctx__back, \.lm-ctx__more\)\s*\{[^}]*\}/)?.[0] ?? '';
    expect(own).toMatch(/height:\s*var\(--lm-header-key\)/);
    expect(own).toMatch(/width:\s*var\(--lm-header-key\)/);
    // the bar-height rule for bare triggers leaves the status icon alone
    expect(shell).toMatch(/:not\([^)]*\.lm-status-icon/);
  });
});
