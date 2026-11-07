/**
 * Q6 visual pass (PLAN 02 item 12): layout fixes measured in the browser by qa/scripts/Q6 (shoot.mjs, checks.mjs,
 * ladder.mjs) at 390 / 768 / 1440 px in both themes. jsdom computes no layout, so this keeps the declarations that
 * fixed each finding from regressing; the browser scripts remain the measurement.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatNumber, GROUP_SPACE, parseNumber } from '@/components/lib/format';
import { energyInText } from '@/components/lib/energy';
import { BAR } from '@/features/intake/copy';

const read = (p: string) => readFileSync(resolve(__dirname, '../../..', p), 'utf8');

function rule(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\n)\\s*${esc} \\{([^}]*)\\}`));
  if (!m) throw new Error(`${selector} not found`);
  return m[1]!;
}

describe('Q6 layout fixes', () => {
  it('key-value lists reserve a readable label word and let values use their natural width', () => {
    expect(rule(read('src/styles/components.css'), '.lm-kv')).toMatch(/grid-template-columns: minmax\(min-content, 1fr\) minmax\(0, max-content\);/);
  });

  it('ladder cards label their phase strip (no blank tinted bar); narrow segments still hide the label', () => {
    const css = read('src/features/planner/planner.css');
    expect(css).not.toMatch(/\.lp-phases\[data-size='card'\] \.lp-phases__label \{\s*display: none;/);
    expect(css).toMatch(/@container \(max-width: 72px\) \{\s*\.lp-phases__label \{\s*display: none;/);
  });

  it('ladder graph labels drop below their dot when a neighbour is close', () => {
    expect(read('src/features/planner/components/LadderScale.tsx')).toMatch(/data-crowd=\{search \? undefined : crowd\(p\)\}/);
    const css = read('src/features/planner/ladder.css');
    expect(rule(css, ".lp-scale__mark[data-crowd='close'] .lp-scale__label")).toMatch(/translate: 0 18px;/); // r068 plan: clear of the dot and its neighbour's label
    expect(css).toMatch(/@container lp-scale \(max-width: 640px\)/);
  });

  it('markers receipt rows are a grid (question over answer, Change on the right)', () => {
    const css = read('src/features/intake/chapters/markers.css');
    expect(rule(css, '.lm-mk-receipt__row')).toMatch(/grid-template-columns: minmax\(0, 1fr\) auto;/);
    expect(rule(css, '.lm-mk-receipt__row .lm-ik-receipt__change')).toMatch(/grid-row: 1 \/ span 2;/);
  });

  it('the chapter scale draws segments only, across the whole progress row (no per-segment labels to cut)', () => {
    // Ember: the chapter name is the header title, so the scale carries no labels that could be cut at 390 px
    const css = read('src/features/intake/intake.css');
    expect(css).not.toMatch(/\.lm-ik-progress__label/);
    expect(rule(css, '.lm-ik-progress')).toMatch(/width: 100%;[\s\S]*min-width: 0;/);
  });

  it('a complete chapter never reads "question 3 of 2"', () => {
    // nothing on screen counts questions any more; the spoken value clamps the position (a complete chapter's is total + 1)
    expect(BAR.progressFull('Food', 3, 2, 1, 4)).toBe('Food, question 2 of 2; 1 of 4 chapters done');
  });

  it('the adherence dial caption wraps inside the ring', () => {
    expect(rule(read('src/features/charts/living/living-charts.css'), '.lmc-dial__sub')).toMatch(/max-width: calc\(var\(--lmc-dial-px, 120px\) \* 0\.7\);/);
  });

  it('plan versions use the shared rail inside the card inset, with wrapping titles and readable line height', () => {
    expect(read('src/features/living/plan/PlanDetailsPage.tsx')).toMatch(/<Rail label=\{C.versions\} className="lv-plan-versions">/);
    expect(rule(read('src/components/card.css'), '.lm-gcard')).toMatch(/padding: var\(--lm-card-pad\);/);
    const css = read('src/components/rail.css');
    expect(rule(css, '.lm-rail__row')).toMatch(/grid-template-columns: var\(--rail-t\) var\(--rail-node\) minmax\(0, 1fr\) auto;/);
    const title = rule(css, '.lm-rail__title');
    expect(title).toMatch(/overflow-wrap: anywhere;/);
    expect(title).toMatch(/line-height: 1\.375rem;/);
  });

  it('settings deep links open the section page (no scrolling to a target inside one long page)', () => {
    const page = read('src/features/settings/SettingsPage.tsx');
    // /settings/:section, the older ?section= and #hash links, and a pairing link all resolve to one section page
    expect(page).toMatch(/sectionFromId\(section\) \?\? sectionFromId\(query\) \?\? \(pairingLink \? 'sync' : sectionFromId\(hash\.slice\(1\)\)\)/);
    expect(page).not.toMatch(/new ResizeObserver/);
  });

  it('the catalogue picker never makes a page wider than the phone (Settings › Kitchen at 390 px)', () => {
    const css = read('src/features/components/picker.css');
    expect(rule(css, '.lm-pk__body')).toMatch(/grid-template-columns: minmax\(0, 1fr\);/);
    expect(rule(css, '.lm-pk__region-keys .lm-key')).toMatch(/white-space: normal;/);
  });

  it('settings is an index of rows to pushed pages (no chip rail to keep in view)', () => {
    expect(read('src/features/settings/SettingsIndex.tsx')).toMatch(/<SettingsLinkRow key=\{id\} to=\{`\/settings\/\$\{id\}`\}/);
    expect(read('src/features/settings/SettingsPage.tsx')).not.toMatch(/rail\.scrollTo/);
  });

  it('comma-grouped numbers parse while legacy no-break-space entries remain accepted', () => {
    expect(GROUP_SPACE).toBe('\u00a0');
    const s = formatNumber(2890, 0);
    expect(s).toBe('2,890');
    expect(parseNumber(s)).toBe(2890);
    expect(parseNumber(`2${GROUP_SPACE}890`)).toBe(2890);
    expect(energyInText(`about ${formatNumber(2000, 0)} kcal a day`, 'kJ')).toBe(`about ${formatNumber(8370, 0)} kJ a day`);
  });
});

/**
 * The shell's frame (SPEC §8.2–§8.3): the top bar on every page and the desktop sidebar. jsdom lays nothing out, so this
 * keeps the declarations that set the geometry; src/app/__tests__ cover the behaviour (sidebar.test.tsx, shell.test.tsx)
 * and the bar's give-way order (actionBarSticky.test.ts).
 */
describe('the top bar and the collapsible sidebar (SPEC §8)', () => {
  const css = read('src/styles/shell.css');
  /** The bodies of every `@media (<query>) {…}` block. */
  const media = (query: string) => {
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
    return out.join('\n');
  };
  const desk = media('min-width: 64rem');

  it('the bar is one 48 px key tall plus 4 px above and below (56 px, safe area added) and titles at the page role: 24/28 600 (SPEC Q2), not the 34 px display', () => {
    expect(css).toMatch(/--lm-header-key:\s*48px;/);
    expect(css).toMatch(/--lm-bar-pad-y:\s*4px;/);
    expect(rule(css, '.lm-ctx__row')).toMatch(/min-height:\s*var\(--lm-header-key\);/);
    expect(rule(css, '.lm-ctx-slot')).toMatch(/padding-top:\s*var\(--lm-safe-top\);/);
    const title = rule(css, '.lm-ctx .lm-title');
    expect(title).toMatch(/font-size:\s*var\(--lm-text-page\);/);
    expect(title).toMatch(/line-height:\s*var\(--lm-text-page--lh\);/);
    // r068 U10 (titles thicker) and r071: 600 through the role token
    expect(title).toMatch(/font-weight:\s*var\(--lm-text-page--wt\);/);
    expect(read('src/styles/tokens.css')).toMatch(/--lm-text-page:\s*1\.5rem;\s*--lm-text-page--lh:\s*1\.75rem;[^\n]*--lm-text-page--wt:\s*600;/);
    expect(css).not.toMatch(/font-size:\s*34px/);
    expect(css).not.toMatch(/--lm-text-display/);
    // 24 + 14 (mono meta) fits a phone tab page's fact row above the 48 px row; 28 + 16 fits the row on desktop
    expect(14 + 4 - 8 + 48 + 2 * 4).toBe(66);
    expect(16 + 28).toBeLessThanOrEqual(48);
  });

  it('frost on scroll: three tintless 4 / 9 / 14 px layers, each masked on its own, fading out a band below the bar; the hairline marks the desktop bar at rest only', () => {
    const tokens = read('src/styles/tokens.css');
    // the container fills its host and carries nothing that would cut the blur off from the page behind
    const host = rule(css, '.lm-frost');
    expect(host).toMatch(/position:\s*absolute;/);
    expect(host).toMatch(/inset:\s*0;/);
    expect(host).not.toMatch(/opacity|filter|mask|transform|background/);
    // each layer's box reaches past the visible edge (a backdrop blur only samples inside its box), carries the opacity
    // and its own mask, and is never a tint or a fill
    const layer = rule(css, '.lm-frost > i');
    expect(layer).toMatch(/--lm-frost-edge:\s*calc\(100% - var\(--lm-frost-reach\)\);/);
    expect(layer).toMatch(/inset:\s*0 0 calc\(-1 \* var\(--lm-frost-reach\)\);/);
    expect(layer).toMatch(/opacity:\s*var\(--lm-frost, 1\);/);
    expect(layer).toMatch(/backdrop-filter:\s*blur\(var\(--lm-frost-blur\)\);/);
    expect(layer).toMatch(/mask-image:\s*var\(--lm-frost-mask\);/);
    expect(layer).not.toMatch(/background/);
    expect(css).toMatch(/--lm-frost-reach:\s*32px;/);
    expect(css).toMatch(/--lm-frost-band:\s*24px;/);
    for (const [n, px] of [[1, 4], [2, 9], [3, 14]] as const) {
      expect(tokens).toMatch(new RegExp(`--lm-frost-${n}:\\s*${px}px;`));
      expect(rule(css, `.lm-frost > i:nth-child(${n})`)).toMatch(new RegExp(`--lm-frost-blur:\\s*var\\(--lm-frost-${n}\\);`));
    }
    // the top bar (Lumen's header): the frost reaches one band below the bar and thins in steps across its edge, the
    // 14 px layer gone at the bar's edge, the 9 px half a band past it, the 4 px at the band's end; no hard line
    expect(rule(css, ".lm-frost[data-side='top']")).toMatch(/inset:\s*0 0 calc\(-1 \* var\(--lm-frost-band\)\);/);
    expect(rule(css, ".lm-frost[data-side='top'] > i:nth-child(1)")).toMatch(/#000 calc\(var\(--lm-frost-edge\) - var\(--lm-frost-band\)\),\s*transparent var\(--lm-frost-edge\)/);
    expect(rule(css, ".lm-frost[data-side='top'] > i:nth-child(2)")).toMatch(/#000 calc\(var\(--lm-frost-edge\) - var\(--lm-frost-band\) \* 3 \/ 2\),\s*transparent calc\(var\(--lm-frost-edge\) - var\(--lm-frost-band\) \/ 2\)/);
    expect(rule(css, ".lm-frost[data-side='top'] > i:nth-child(3)")).toMatch(/#000 calc\(var\(--lm-frost-edge\) - var\(--lm-frost-band\) \* 2\),\s*transparent calc\(var\(--lm-frost-edge\) - var\(--lm-frost-band\)\)/);
    // bottom docks: the mirror image, the boxes reaching up past the open top edge
    expect(rule(css, ".lm-frost[data-side='bottom'] > i")).toMatch(/inset:\s*calc\(-1 \* var\(--lm-frost-reach\)\) 0 0;/);
    for (const n of [1, 2, 3]) expect(rule(css, `.lm-frost[data-side='bottom'] > i:nth-child(${n})`)).toMatch(/linear-gradient\(\s*to top,/);
    // the bar's frost starts at 0 and comes in with the scroll (AppShell writes --lm-frost), eased over --lm-dur-frost
    expect(rule(css, '.lm-ctx-slot')).toMatch(/--lm-frost:\s*0;/);
    expect(layer).toMatch(/transition:\s*opacity var\(--lm-dur-frost\)/);
    // no backdrop-filter: the 4 px layer takes a 92 % chassis fill under the same mask, and needs no sampling room
    expect(css).toMatch(/@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\) \{\s*\/\*[^*]*\*\/\s*\.lm-frost \{\s*--lm-frost-reach:\s*0px;\s*\}\s*\.lm-frost > i:nth-child\(1\) \{\s*background:\s*color-mix\(in srgb, var\(--lm-chassis\) 92%, transparent\);/);
    // the shell renders it: the bar's frost on top, the dock's (and a docked toolbar's) at the bottom
    expect(read('src/app/shell/AppShell.tsx')).toMatch(/<Frost side="top" \/>/);
    expect(read('src/app/shell/Chrome.tsx')).toMatch(/<Frost side="bottom" \/>/);
    const line = rule(css, '.lm-ctx-slot::after');
    expect(line).toMatch(/border-bottom:\s*var\(--lm-hairline\) solid var\(--lm-line\);/);
    // no line cuts the fade: none on phones; on desktop it marks the bar at rest and goes as the frost comes in
    expect(line).toMatch(/opacity:\s*0;/);
    expect(desk).toMatch(/\.lm-ctx-slot::after \{\s*opacity:\s*calc\(1 - var\(--lm-frost, 0\)\);/);
  });

  it('the fact line is mono caps over the title, one line, on desktop and on phones (r071, SPEC Q4: the references\' date above the title)', () => {
    expect(desk).toMatch(/\.lm-ctx__heading \{\s*display:\s*grid;\s*align-content:\s*center;\s*justify-items:\s*start;/);
    expect(rule(css, '.lm-ctx__heading')).toMatch(/display:\s*grid;/);
    const sub = rule(css, '.lm-ctx__sub');
    expect(sub).toMatch(/white-space:\s*nowrap;/);
    // the mono role: Geist Mono 500, uppercase, +0.08em, 11 px (12 px from 1024)
    expect(sub).toMatch(/font-family:\s*var\(--lm-text-meta--font\);/);
    expect(sub).toMatch(/font-size:\s*var\(--lm-text-meta\);/);
    expect(sub).toMatch(/letter-spacing:\s*var\(--lm-text-meta--ls\);/);
    expect(sub).toMatch(/text-transform:\s*uppercase;/);
    expect(sub).toMatch(/color:\s*var\(--lm-ink-2\);/);
    // drawn first (above the title), while the h1 stays first in the DOM
    expect(css).toMatch(/\.lm-ctx__heading > :is\(\.lm-ctx__sub, \.lm-ctx__params\) \{\s*order:\s*-1;/);
  });

  it('desktop pushed pages: sidebar key · Back · title in the app; outside the shell (the welcome flow) Back and a centred title', () => {
    // in the app the pushed bar is the ordinary bar (no centring rule keyed to data-desk='pushed' alone)
    expect(desk).not.toMatch(/\.lm-ctx\[data-desk='pushed'\] > \.lm-ctx__row \{/);
    expect(desk).toMatch(
      // r068 U13: the sidebar key left the bar, so "outside the shell" is now keyed to the shell's slot, not the key
      /\.lm-ctx\[data-desk='pushed'\]:not\(\.lm-ctx-slot \*\) > \.lm-ctx__row \{[^}]*grid-template-columns:\s*minmax\(max-content, 1fr\) minmax\(0, auto\) minmax\(max-content, 1fr\);/,
    );
    expect(desk).toMatch(/:not\(\.lm-ctx-slot \*\) > \.lm-ctx__row > \.lm-ctx__heading \{[^}]*grid-column:\s*2;[^}]*text-align:\s*center;/);
  });

  it('360 px: beside a primary key a phone bar keeps one status icon, so the title, the icon, the key and the ⋯ fit', () => {
    expect(css).not.toMatch(/--lm-caps-floor/);
    expect(read('src/app/shell/TopBar.tsx')).toMatch(/return primary && !md \? 1 : 2;/);
    // gutter 20 + inset 8 + title floor 64 + gaps 3 × 8 + one status icon 48 + ⋯ 48 leaves a primary key 148 px at 360 px
    expect(360 - (20 + 8 + 64 + 3 * 8 + 48 + 48)).toBeGreaterThanOrEqual(140);
  });

  it('the sidebar: none below 1024 px; full height, sticky, bg-2 grain material with a 0.5 px right hairline', () => {
    expect(rule(css, '.lm-sidebar')).toMatch(/display:\s*none;/);
    const side = desk.match(/\.lm-sidebar \{([^}]*)\}/)?.[1] ?? '';
    expect(side).toMatch(/position:\s*sticky;/);
    expect(side).toMatch(/height:\s*100dvh;/);
    expect(side).toMatch(/border-right:\s*var\(--lm-hairline\) solid var\(--lm-line\);/);
    expect(side).toMatch(/background:\s*var\(--lm-sidebar-bg\);/);
    expect(css).toMatch(/--lm-sidebar-bg:\s*var\(--lm-grain-sidebar\) 0 0 \/ var\(--lm-grain-size\) repeat,\s*var\(--lm-chassis-2\);/);
    expect(desk).toMatch(/\.lm-app \{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\);/);
  });

  it('expanded ~240 px, collapsed a 64 px rail; the width eases over the 200 ms token (≈ 0 under reduced motion)', () => {
    expect(css).toMatch(/--lm-sidebar-expanded:\s*240px;/);
    expect(css).toMatch(/--lm-sidebar-collapsed:\s*64px;/);
    expect(desk).toMatch(/\.lm-app\[data-sidebar='expanded'\],\s*:root:has\(\.lm-app\[data-sidebar='expanded'\]\) \{\s*--lm-sidebar-w:\s*var\(--lm-sidebar-expanded\);/);
    expect(desk).toMatch(/\.lm-app\[data-sidebar='collapsed'\],\s*:root:has\(\.lm-app\[data-sidebar='collapsed'\]\) \{\s*--lm-sidebar-w:\s*var\(--lm-sidebar-collapsed\);/);
    const side = desk.match(/\.lm-sidebar \{([^}]*)\}/)?.[1] ?? '';
    expect(side).toMatch(/width:\s*var\(--lm-sidebar-w\);/);
    expect(side).toMatch(/transition:\s*width var\(--lm-dur-base\) var\(--lm-ease-standard\);/);
    const tokens = read('src/styles/tokens.css');
    expect(tokens).toMatch(/--lm-dur-base:\s*200ms;/);
    expect(tokens).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{[^}]*--lm-dur-base:\s*0\.01ms;/);
    // icons keep one x in both states: 12 px inset + 10 px row padding centres a 20 px icon in the 64 px rail
    expect(12 + 10 + 20 / 2).toBe(64 / 2);
    expect(side).toMatch(/padding:\s*var\(--lm-safe-top\) 12px/);
    expect(rule(css, '.lm-side__row')).toMatch(/padding:\s*0 10px;/);
    expect(rule(css, '.lm-side__icon')).toMatch(/width:\s*20px;/);
  });

  it('rows: 40 px rows at the field radius; the current one takes an ivory tint (9 % ink), an ivory icon and a 600 label, never gold; collapsed, the words fade', () => {
    const row = rule(css, '.lm-side__row');
    expect(row).toMatch(/height:\s*40px;/);
    expect(row).toMatch(/border-radius:\s*var\(--lm-radius-field\);/);
    const current = rule(css, ".lm-side__row[aria-current='page']");
    expect(current).toMatch(/color:\s*var\(--lm-ink\);/);
    expect(current).toMatch(/background:\s*color-mix\(in oklab, var\(--lm-ink\) 9%, transparent\);/);
    expect(current).toMatch(/font-weight:\s*600;/);
    expect(current).not.toMatch(/gold|signal/);
    expect(rule(css, ".lm-side__row[aria-current='page'] .lm-side__icon")).toMatch(/color:\s*var\(--lm-ink\);/);
    expect(rule(css, '.lm-sidebar[data-collapsed] :is(.lm-side__label, .lm-side__name)')).toMatch(/opacity:\s*0;/);
  });

  it('the dock (r071): the current key is an ivory capsule on ONE thumb that glides by transform; the keys only turn dark; reduced motion jumps', () => {
    const thumb = rule(css, '.lm-tabbar__thumb');
    expect(thumb).toMatch(/background:\s*var\(--lm-nav-on-bg\);/);
    expect(thumb).toMatch(/width:\s*calc\(\(100% - 2 \* var\(--lm-tabbar-pad-x\)\) \/ var\(--lm-tabbar-n\)\);/);
    expect(thumb).toMatch(/transform:\s*translateX\(calc\(var\(--lm-tabbar-i\) \* 100%\)\);/);
    // 280 ms on the one damped overshoot, and only transform and opacity move (no layout property)
    expect(thumb).toMatch(/transform var\(--lm-dur-glide\) var\(--lm-ease-needle\)/);
    expect(thumb).not.toMatch(/transition:[^;]*\b(left|width|top|height)\b/);
    expect(read('src/styles/tokens.css')).toMatch(/--lm-dur-glide:\s*280ms;/);
    expect(read('src/styles/tokens.css')).toMatch(/--lm-dur-glide: 0\.01ms;/);
    // the key: dark icon and label on the capsule, label 600, a near-black badge dot with a capsule ring
    expect(rule(css, ".lm-navkey[aria-current='page']")).toMatch(/color:\s*var\(--lm-nav-on-fg\);/);
    expect(rule(css, ".lm-navkey[aria-current='page'] .lm-navkey__label")).toMatch(/font-weight:\s*600;/);
    expect(rule(css, ".lm-navkey[aria-current='page'] .lm-navkey__stale")).toMatch(/background:\s*var\(--lm-nav-on-fg\);\s*box-shadow:\s*0 0 0 2px var\(--lm-nav-on-bg\);/);
    expect(rule(css, '.lm-tabbar')).toMatch(/background:\s*var\(--lm-nav-pill-bg\);/);
    expect(rule(css, '.lm-tabbar')).toMatch(/height:\s*var\(--lm-nav-pill-h\);/);
    // no gold on the dock's current key: gold is what you can do or chose
    expect(css).not.toMatch(/\.lm-navkey\[aria-current='page'\] \.lm-navkey__icon \{[^}]*signal/);
    // forced colours: the capsule and the sidebar row keep a filled / outlined shape in the system's own highlight pair
    expect(css).toMatch(/@media \(forced-colors: active\) \{\s*\.lm-tabbar__thumb \{\s*forced-color-adjust: none;\s*background: Highlight;/);
    expect(css).toMatch(/\.lm-side__row\[aria-current='page'\] \{\s*outline: 2px solid Highlight;/);
    // the label is 12 px: dock labels were the 11 px text the audit counted (P2-8)
    expect(rule(css, '.lm-navkey__label')).toMatch(/font-size:\s*var\(--lm-text-label-s\);/);
  });
});
