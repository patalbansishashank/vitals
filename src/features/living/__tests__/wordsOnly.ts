/**
 * Quiet mode is words only, assistive technology included (0.6.3): no digit in an element's text, or in its accessible
 * names, descriptions and values. Shared by the quiet-mode suites of Today, the activity sheets and Train.
 */
import { expect } from 'vitest';

const ATTRS = ['aria-label', 'aria-valuetext', 'aria-valuenow', 'aria-valuemax', 'aria-description', 'title', 'alt'] as const;

/**
 * Fails with the offending text when `el` (or a descendant's aria/title/alt) carries a digit. The person's own entries are
 * exempt: a number field (`role="spinbutton"`) holds what they typed, and its value is spoken as typed. `allow` names
 * exact strings that are not health figures (a calendar date in a page title, as on every date strip) and are removed
 * before the check.
 */
export function expectWordsOnly(el: Element, what = el.querySelector('h2,h3')?.textContent ?? el.tagName, allow: readonly string[] = []): void {
  const strip = (t: string) => allow.reduce((s, a) => s.split(a).join(''), t);
  expect(strip(el.textContent ?? ''), `${what}: ${el.textContent}`).not.toMatch(/\d/);
  for (const node of [el, ...el.querySelectorAll('*')])
    for (const attr of ATTRS) {
      if (node.getAttribute('role') === 'spinbutton' && attr !== 'aria-label') continue;
      const v = node.getAttribute(attr);
      if (v) expect(strip(v), `${what} [${attr}]`).not.toMatch(/\d/);
    }
}
