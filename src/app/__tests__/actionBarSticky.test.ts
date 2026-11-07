import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/styles/shell.css'), 'utf8');
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** The bodies of every `@media (<query>) {…}` block. */
function mediaBlocks(query: string): string[] {
  const out: string[] = [];
  const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const m of css.matchAll(new RegExp(`@media \\(${esc}\\) \\{`, 'g'))) {
    let depth = 1;
    let i = m.index! + m[0].length;
    const start = i;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    out.push(css.slice(start, i));
  }
  return out;
}

const rules = (selector: RegExp) => [...css.matchAll(new RegExp(`${selector.source}\\s*\\{[^}]*\\}`, 'g'))].map((m) => m[0]);

describe('no bar above the tab bar, no bar at the foot (SPEC §4)', () => {
  it('the context bar is never pinned to the foot: no data-bottom placement is left', () => {
    expect(css).not.toMatch(/data-bottom/);
  });

  it('the header slot sticks to the top of the content column at every width', () => {
    const slot = rules(/\n\s*\.lm-ctx-slot/)[0] ?? '';
    expect(slot).toMatch(/position:\s*sticky;/);
    expect(slot).toMatch(/top:\s*0;/);
  });

  it('the action bar row is in the flow (never fixed), and sticky only when docked on a phone screen without the tab bar', () => {
    for (const r of rules(/\.lm-actionbar(?:-slot)?(?![-\w])[^{,]*/)) expect(r).not.toMatch(/position:\s*fixed/);
    const phone = mediaBlocks('max-width: 63.99rem').join('\n');
    expect(phone).toMatch(/\.lm-actionbar-slot\[data-docked\]\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0;/);
    // outside that phone block, the slot is never sticky
    const outside = css.replace(/@media \(max-width: 63\.99rem\) \{[\s\S]*?\n {2}\}/g, '');
    expect(outside).not.toMatch(/\.lm-actionbar-slot[^{]*\{[^}]*position:\s*sticky/);
  });

  it('no shell ancestor of the docked toolbar clips or transforms (sticky would stop working)', () => {
    for (const rule of [...rules(/\.lm-app/), ...rules(/\.lm-main/)]) expect(rule).not.toMatch(/overflow|transform|contain:/);
  });

  it('content keeps clear of the dock: --lm-dock-h is the dock’s height with the safe area, 0 without a dock', () => {
    expect(css).toMatch(/--lm-dock-h:\s*calc\(var\(--lm-pill-h\) \+ 8px \+ var\(--lm-safe-bottom\)\)/);
    expect(css).toMatch(/:root:has\(\.lm-app\[data-chromeless='true'\]\)[^{]*\{\s*--lm-dock-h:\s*0px;/);
    expect(rules(/\n\s*\.lm-main/)[0]).toMatch(/padding-bottom:\s*calc\(var\(--lm-dock-h\) \+ 24px\)/);
  });
});

describe('the docked toolbar (focused flows on phones): the keys sit on a solid control pill', () => {
  const phone = mediaBlocks('max-width: 63.99rem').join('\n');
  const pill = phone.match(/\.lm-actionbar-slot\[data-docked\] > \.lm-actionbar \{[^}]*\}/)?.[0] ?? '';

  it('the nav pill’s material and shape: the dock pill token (card at 94 %), hairline, 64 px, round ends — so nothing reads through the keys', () => {
    expect(pill).toMatch(/background:\s*var\(--lm-nav-pill-bg\);/);
    expect(read('src/styles/tokens.css')).toMatch(/--lm-nav-pill-bg:\s*rgb\(27 25 22 \/ 0\.94\);/);
    expect(pill).toMatch(/border:\s*0\.5px solid var\(--lm-line\);/);
    expect(pill).toMatch(/border-radius:\s*36px;/);
    expect(pill).toMatch(/min-height:\s*var\(--lm-pill-h\);/);
  });

  it('the slot is a frosted dock with the dock’s insets; the page keeps 24 px clear above it and scrolling keeps clear of it', () => {
    const slot = phone.match(/\.lm-actionbar-slot\[data-docked\] \{[^}]*\}/)?.[0] ?? '';
    expect(slot).toMatch(/padding:\s*4px calc\(10px \+ var\(--lm-safe-right\)\) calc\(4px \+ var\(--lm-safe-bottom\)\)/);
    expect(slot).toMatch(/background:\s*transparent;/);
    // the dock's layered frost (<Frost side="bottom" />, rendered in the slot only when docked) under the whole toolbar,
    // its fade band reaching 24 px above it without taking room; elsewhere the slot shows none
    expect(readFileSync(resolve(process.cwd(), 'src/app/shell/AppShell.tsx'), 'utf8')).toMatch(/className="lm-actionbar-slot"[^>]*data-docked=\{chromeless \|\| undefined\}>\s*\{chromeless \? <Frost side="bottom" \/> : null\}/);
    expect(css).toMatch(/\n\s*\.lm-actionbar-slot > \.lm-frost \{\s*display:\s*none;/);
    expect(phone).toMatch(/\.lm-actionbar-slot\[data-docked\] > \.lm-frost \{\s*display:\s*block;\s*top:\s*calc\(-1 \* var\(--lm-frost-band\)\);/);
    expect(phone).toMatch(/> :nth-last-child\(2\) \{\s*margin-bottom:\s*24px;/);
    expect(phone).toMatch(/html:has\(\.lm-actionbar-slot\[data-docked\] > \.lm-actionbar\) \{\s*scroll-padding-bottom:\s*calc\(var\(--lm-foot-h, 64px\) \+ 24px\);/);
  });
});

describe('the bar’s row gives way in order: status icons past two (into the ⋯), then the fact line, then the title, never the keys', () => {
  /** The declarations of the first rule whose selector is exactly `selector` (outside or inside media blocks). */
  const decl = (selector: string) => {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`\\n\\s*${esc} \\{([^}]*)\\}`))?.[1] ?? '';
  };

  it('one line that never wraps: the heading takes its whole width first, the trail grows into the rest', () => {
    const row = decl('.lm-ctx__row');
    expect(row).toMatch(/display:\s*flex;/);
    expect(row).toMatch(/flex-wrap:\s*nowrap;/);
    const heading = decl('.lm-ctx__heading');
    expect(heading).toMatch(/flex:\s*0 1 auto;/);
    expect(heading).toMatch(/min-width:\s*min\(4rem, 30%\);/);
    // basis 0, growing: the trail only gets what the heading leaves, and never shrinks below its own minimum
    const trail = decl('.lm-ctx__trail');
    expect(trail).toMatch(/flex:\s*1 1 0;/);
    expect(trail).not.toMatch(/min-width:\s*0/);
    expect(trail).not.toMatch(/margin-inline-start:\s*auto/);
  });

  it('the status icons never shrink (the ones past two move into the ⋯); neither do the keys', () => {
    expect(css).toMatch(/\.lm-ctx__caps,\s*\.lm-ctx__status \{[^}]*flex:\s*none;/);
    expect(css).not.toMatch(/container:\s*lm-caps/);
    expect(css).not.toMatch(/--lm-caps-floor/);
    // beside the ⋯ the 48 px targets touch: one rhythm for the bar's icons
    expect(decl('.lm-ctx__caps:has(+ .lm-ctx__more)')).toMatch(/margin-inline-end:\s*-8px;/);
    expect(css).toMatch(/\.lm-ctx__actions,\s*\.lm-ctx__primary \{[^}]*flex:\s*none;/);
    // with no icon showing, the group leaves the row unseen but is never display: none, so sync's polite status line
    // inside it is still announced
    const empty = decl('.lm-ctx__caps:not(:has(.lm-status-icon:not([hidden]), .lm-ctx__status > :not(.lm-status-icon)))');
    expect(empty).toMatch(/position:\s*absolute;/);
    // pinned inside the bar with no margin, so it never widens the page (it would sit past the ⋯'s inset otherwise)
    expect(empty).toMatch(/inset:\s*0 auto auto 0;/);
    expect(empty).toMatch(/margin:\s*0;/);
    expect(empty).toMatch(/clip-path:\s*inset\(50%\);/);
    expect(empty).not.toMatch(/display:\s*none/);
    expect(css).toMatch(/\.lm-ctx__row > \.lm-ctx__back,\s*\.lm-ctx__trail > \.lm-ctx__more \{\s*flex:\s*none;/);
  });

  it('a phone tab page’s fact line is a full-width row drawn ABOVE the title row (r071, SPEC Q4), pulled down toward the title, ending on the gutter', () => {
    const sub = decl('.lm-ctx > .lm-ctx__sub');
    expect(sub).toMatch(/order:\s*-1;/);
    expect(sub).toMatch(/margin:\s*0 8px -8px 0;/);
    // the DOM keeps the h1 first (the heading leads the reading order); only the drawing order puts the date over it
    expect(readFileSync(resolve(process.cwd(), 'src/app/shell/TopBar.tsx'), 'utf8')).toMatch(/\{factRow \? sub : null\}/);
  });

  it('the title and the fact line are one line each and truncate; on desktop the fact line gives way before the title', () => {
    const title = decl('.lm-ctx .lm-title');
    expect(title).toMatch(/white-space:\s*nowrap;/);
    expect(title).toMatch(/text-overflow:\s*ellipsis;/);
    const sub = decl('.lm-ctx__sub');
    expect(sub).toMatch(/white-space:\s*nowrap;/);
    expect(sub).toMatch(/text-overflow:\s*ellipsis;/);
    const desk = mediaBlocks('min-width: 64rem').join('\n');
    // inside the heading (pushed pages, desktop) the fact line is drawn first, so it stacks above the title
    expect(css).toMatch(/\.lm-ctx__heading > :is\(\.lm-ctx__sub, \.lm-ctx__params\) \{\s*order:\s*-1;/);
    expect(desk).toMatch(/\.lm-ctx__heading > :is\(\.lm-ctx__sub, \.lm-ctx__params\) \{\s*max-width:\s*100%;/);
    expect(desk).toMatch(/\.lm-ctx \.lm-title \{\s*flex:\s*0 1 auto;/);
  });

  it('a phone pushed page keeps Back · title (left, after Back, r068 L19) · trail, the title taking the room between', () => {
    const phone = mediaBlocks('max-width: 63.99rem').join('\n');
    expect(phone).toMatch(/\.lm-ctx\[data-phone='pushed'\] > \.lm-ctx__row \{[^}]*grid-template-columns:\s*max-content minmax\(0, 1fr\) max-content;/);
    expect(phone).toMatch(/\.lm-ctx\[data-phone='pushed'\] \.lm-ctx__heading \{[^}]*text-align:\s*start;/);
    expect(phone).toMatch(/\.lm-ctx\[data-phone='pushed'\] \.lm-ctx__trail \{[^}]*min-width:\s*var\(--lm-header-key\);/);
  });
});
