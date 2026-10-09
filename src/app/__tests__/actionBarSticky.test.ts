import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/styles/shell.css'), 'utf8');

/** The body of the first `@media (max-width: 63.99rem)` block that holds `needle`. */
function phoneBlock(needle: string): string {
  const blocks = [...css.matchAll(/@media \(max-width: 63\.99rem\) \{/g)];
  for (const m of blocks) {
    let depth = 1;
    let i = m.index! + m[0].length;
    const start = i;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    const body = css.slice(start, i);
    if (body.includes(needle)) return body;
  }
  return '';
}

describe('the action bar on phones and tablets', () => {
  it('sticks to the bottom of the screen above the tab bar', () => {
    const body = phoneBlock('.lm-actionbar-slot');
    expect(body).toMatch(/\.lm-actionbar-slot\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*var\(--lm-foot-offset\)/);
  });

  it('no shell ancestor of the slot clips or transforms (sticky would stop working)', () => {
    const shell = css.match(/\.lm-app\s*\{[^}]*\}/g) ?? [];
    for (const rule of shell) expect(rule).not.toMatch(/overflow|transform|contain:/);
  });

  it('the screen title bar is fixed above the action bar, with the shell-measured heights (no overlap, any height)', () => {
    const body = phoneBlock('.lm-ctx[data-bottom]');
    expect(body).toMatch(/\.lm-ctx-slot:has\(> \.lm-ctx\[data-bottom\]\)\s*\{[^}]*position:\s*fixed;[^}]*bottom:\s*calc\(var\(--lm-foot-offset\) \+ var\(--lm-foot-h/);
    expect(body).toMatch(/\.lm-main:has\(\.lm-ctx\[data-bottom\]\)\s*\{[^}]*padding-bottom:\s*calc\(var\(--lm-ctx-h/);
  });
});
