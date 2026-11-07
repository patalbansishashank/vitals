/**
 * Skip link (`.lm-skip`): hidden above the viewport until focused. With the page drawn under the Android status bar,
 * --lm-safe-top is ~40 px, so a fixed translateY(-200%) left the link peeking out at the top-left. The parked offset
 * must include the safe-area inset; on focus it drops back to top: safe-top + 8px (jsdom computes no styles).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../shell.css'), 'utf8');

function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\n)\\s*${esc} \\{([^}]*)\\}`));
  if (!m) throw new Error(`${selector} not found`);
  return m[1]!;
}

describe('skip link', () => {
  it('sits at safe-top + 8px and is parked off-screen past the safe-area inset', () => {
    const r = rule('.lm-skip');
    expect(r).toMatch(/top: calc\(var\(--lm-safe-top\) \+ 8px\);/);
    expect(r).toMatch(/transform: translateY\(calc\(-100% - var\(--lm-safe-top\) - 12px\)\);/);
    expect(r).not.toMatch(/display: none|visibility: hidden/);
  });

  it('comes back on focus and focus-visible', () => {
    expect(rule('.lm-skip:focus,\n  .lm-skip:focus-visible')).toMatch(/transform: none;/);
  });
});
