/**
 * The r071 primitives' painted shape, pinned as text (jsdom computes no styles): the gold pill key and its states, the
 * neutral secondary tile, mono-caps key banks, pill chips, the card-material notice, the springs of the sheet and the
 * side panel and what they do under reduced motion, the 44 px touch targets, and the shared `.lm-live` mark.
 * The glow recipe and the tokens are pinned in tokens.test.ts; the dock and the bar in q6Layout.test.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, '../../..', p), 'utf8');
const css = read('src/styles/components.css');
const tokens = read('src/styles/tokens.css');

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string, source = css): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = source.match(new RegExp(`(?:^|\\n)\\s*${esc} \\{([^}]*)\\}`));
  if (!m) throw new Error(`${selector} not found`);
  return m[1]!;
}
const PRIMARY = ":is([data-variant='solid'], [data-variant='signal'], [data-variant='primary'])";

describe('Key: the primary is a gold pill, the secondary stays a neutral tile', () => {
  it('primary: gold fill, a pill at every size, 15/600 label, near-black ink', () => {
    const r = rule(`.lm-key:${PRIMARY.slice(1)}`);
    expect(r).toMatch(/background: var\(--lm-signal\);/);
    // a full pill at 32 / 40 / 48 px, and a 24 px corner (not a stadium) when a block key's label wraps
    expect(r).toMatch(/border-radius: var\(--lm-key-radius\);/);
    expect(tokens).toMatch(/--lm-key-radius:\s*24px;/);
    expect(r).toMatch(/color: var\(--lm-signal-ink\);/);
    expect(r).toMatch(/font-size: 0\.9375rem;/);
    expect(r).toMatch(/font-weight: 600;/);
    // a trailing arrow takes less room on its side; the compact size keeps the 12 px label
    expect(rule(`.lm-key:${PRIMARY.slice(1)}[data-trailing='true']`)).toMatch(/padding-inline: 22px 18px;/);
    expect(rule(`.lm-key:${PRIMARY.slice(1)}[data-size='sm']`)).toMatch(/font-size: var\(--lm-text-label-s\);/);
  });

  it('primary states: the brighter gold on hover, .98 and dimmer on press, a raised pill with a pale-stone label when disabled', () => {
    expect(rule(`.lm-key:${PRIMARY.slice(1)}:hover:not(:disabled, [aria-disabled='true'])`)).toMatch(/background: var\(--lm-signal-hover\);/);
    const press = rule(`.lm-key:${PRIMARY.slice(1)}:active:not([aria-disabled='true']):not(:disabled)`);
    expect(press).toMatch(/transform: scale\(0\.98\);/);
    expect(press).toMatch(/filter: brightness\(0\.94\);/);
    const off = css.match(/\.lm-key\.lm-key:is\(\[data-variant='solid'\][^{]*\):is\(:disabled[^{]*\{([^}]*)\}/)?.[1] ?? '';
    expect(off).toMatch(/background: var\(--lm-raised\);/);
    expect(off).toMatch(/color: var\(--lm-ink-3\);/);
    expect(off).toMatch(/opacity: 1;/);
    // focus is the global 2 px gold ring at 2 px: no key draws its own
    expect(css).not.toMatch(/\.lm-key[^{]*:focus-visible \{[^}]*outline: none/);
  });

  it('the secondary (default, outlined) is the r068 neutral tile: 6 % ink fill, 1 px strong hairline, ivory label, a rounded rectangle', () => {
    const r = rule('.lm-key');
    expect(r).toMatch(/border: 1px solid var\(--lm-line-strong\);/);
    expect(r).toMatch(/background: color-mix\(in oklab, transparent, var\(--lm-ink\) 6%\);/);
    expect(r).toMatch(/color: var\(--lm-ink\);/);
    expect(r).toMatch(/border-radius: var\(--lm-control-radius\);/);
    expect(rule(".lm-key[data-size='lg']")).toMatch(/height: 48px;/);
    expect(rule('.lm-key')).toMatch(/height: 40px;/);
    expect(rule(".lm-key[data-size='sm']")).toMatch(/height: 32px;/);
  });

  it('the Run key is the same pill', () => {
    expect(rule('.lm-runkey__cap')).toMatch(/border-radius: var\(--lm-radius-full\);/);
    expect(rule('.lm-runkey:hover .lm-runkey__cap')).toMatch(/background: var\(--lm-signal-hover\);/);
  });
});

describe('KeyBank: mono caps, the geometry unchanged, 44 px under a coarse pointer', () => {
  it('labels are Geist Mono 500 caps at +0.08em (11 px, 12 px from 1024: the meta role); selection stays the gold tile', () => {
    const key = rule('.lm-bank__key');
    expect(key).toMatch(/font-family: var\(--lm-text-meta--font\);/);
    expect(key).toMatch(/font-size: var\(--lm-text-meta\);/);
    expect(key).toMatch(/letter-spacing: var\(--lm-text-meta--ls\);/);
    expect(key).toMatch(/font-weight: var\(--lm-text-meta--wt\);/);
    expect(key).toMatch(/text-transform: uppercase;/);
    const on = css.match(/\.lm-bank__key\[data-selected='true'\],\s*\.lm-bank__key\[aria-current\]:not\(\[aria-current='false'\]\) \{([^}]*)\}/)?.[1] ?? '';
    expect(on).toMatch(/background: var\(--lm-select-on\);/);
    expect(on).toMatch(/border-color: var\(--lm-select-on-edge\);/);
    expect(on).toMatch(/color: var\(--lm-ink\);/);
    // the same track as r068: well, 12 px, 3 px inset
    expect(tokens).toMatch(/--lm-select-radius:\s*12px;/);
    expect(tokens).toMatch(/--lm-select-inset:\s*3px;/);
    expect(tokens).toMatch(/--lm-select-track:\s*var\(--lm-well\);/);
  });

  it('every segment is 44 px under a coarse pointer, small banks included (it was 36 and 28 on touch)', () => {
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.lm-bank > \.lm-bank__key \{\s*min-height: 44px;/);
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.lm-bank\[data-block='true'\]:not\(\[data-orientation='vertical'\]\) > \.lm-bank__key \{\s*min-height: 44px;/);
    expect(css).not.toMatch(/\.lm-bank\[data-size='sm'\] > \.lm-bank__key \{\s*min-height: 36px;/);
  });
});

describe('Chip: pills, and the domain dot', () => {
  it('a tag is a 22 px pill; a chip that acts is a 28 px pill with the hairline; the domain dot reads --lm-chip-hue', () => {
    expect(rule('.lm-chip')).toMatch(/border-radius: var\(--lm-radius-full\);/);
    expect(rule('.lm-chip')).toMatch(/height: 22px;/);
    const acts = css.match(/button\.lm-chip,\s*a\.lm-chip,\s*\.lm-chip\[data-kind='filter'\] \{([^}]*)\}/)?.[1] ?? '';
    expect(acts).toMatch(/border-radius: var\(--lm-radius-full\);/);
    expect(acts).toMatch(/height: 28px;/);
    expect(acts).toMatch(/border: 1px solid var\(--lm-line\);/);
    expect(rule(".lm-chip[data-kind='domain'] .lm-chip__dot")).toMatch(/background: var\(--lm-chip-hue, var\(--lm-ink-3\)\);/);
    // pressed filter: the gold wash, as before (gold = what you chose)
    expect(css).toMatch(/\.lm-chip\[data-kind='filter'\]\[aria-pressed='true'\],[^{]*\{\s*background: var\(--lm-gold-wash\);/);
  });
});

describe('overlays: a spring on the way in, an ease-in on the way out, a cross-fade under reduced motion', () => {
  it('the sheet opens on the spring (behind @supports linear()), leaves in 220 ms ease-in, and paints a colour block past the screen edge for the overshoot', () => {
    const sheet = rule('.lm-sheet');
    expect(sheet).toMatch(/transform var\(--lm-dur-spring\) var\(--lm-ease-sheet\)/); // the fallback for engines without linear()
    expect(sheet).toMatch(/box-shadow: 0 var\(--lm-sheet-bleed, 32px\) 0 0 var\(--lm-chassis-2\);/); // 0 blur, 0 spread: not a shadow
    const spring = css.match(/@supports \(transition-timing-function: linear\(0, 1\)\) \{\s*\.lm-sheet \{([^}]*)\}/)?.[1] ?? '';
    expect(spring).toMatch(/transform var\(--lm-dur-spring\) var\(--lm-ease-spring\)/);
    const out = rule(".lm-sheet[data-state='closed']");
    expect(out).toMatch(/translateY\(105%\)/);
    expect(out).toMatch(/transform var\(--lm-dur-exit\) var\(--lm-ease-in\)/);
    expect(sheet).not.toMatch(/box-shadow: [^;]*\b[1-9]\d*px [1-9]\d*px/); // never a blurred shadow
  });

  it('the side panel does the same from the right; the scrim fades in 200 ms', () => {
    const panel = rule(".lm-sidepanel[data-mode='overlay']");
    expect(panel).toMatch(/box-shadow: 24px 0 0 0 var\(--lm-chassis-2\);/);
    expect(css).toMatch(/@supports \(transition-timing-function: linear\(0, 1\)\) \{\s*\.lm-sidepanel\[data-mode='overlay'\] \{\s*transition: transform var\(--lm-dur-spring\) var\(--lm-ease-spring\);/);
    const out = rule(".lm-sidepanel[data-mode='overlay'][data-state='closed']");
    expect(out).toMatch(/translateX\(105%\)/);
    expect(out).toMatch(/transition: transform var\(--lm-dur-exit\) var\(--lm-ease-in\);/);
    expect(rule('.lm-scrim')).toMatch(/transition: opacity var\(--lm-dur-base\) var\(--lm-ease-out\);/);
    expect(tokens).toMatch(/--lm-dur-base:\s*200ms;/);
  });

  it('under reduced motion (the OS setting and Settings › Motion) a sheet, the panel and a dialog cross-fade in 100 ms and never move', () => {
    const os = css.match(/@media \(prefers-reduced-motion: reduce\) \{\s*:root:not\(\[data-motion='full'\]\) :is\(\.lm-sheet[^{]*\{([^}]*)\}/)?.[1] ?? '';
    expect(os).toMatch(/transition: opacity 100ms linear !important;/);
    const forced = css.match(/\n {2}:root\[data-motion='reduce'\] :is\(\.lm-sheet[^{]*\) \{([^}]*)\}/)?.[1] ?? '';
    expect(forced).toMatch(/transition: opacity 100ms linear !important;/);
    for (const closed of [
      /:root:not\(\[data-motion='full'\]\) :is\(\.lm-sheet[^{]*\)\[data-state='closed'\] \{\s*transform: none;\s*opacity: 0;/,
      /:root\[data-motion='reduce'\] :is\(\.lm-sheet[^{]*\)\[data-state='closed'\] \{\s*transform: none;\s*opacity: 0;/,
    ]) expect(css).toMatch(closed);
    // the opening cross-fade: the starting style is transparent with no travel
    expect(css).toMatch(/@starting-style \{\s*:root\[data-motion='reduce'\] :is\(\.lm-sheet[^{]*\)\[data-state='open'\] \{\s*transform: none;\s*opacity: 0;/);
    // the exit waits for the fade, not for the slide
    expect(read('src/components/lib/overlay.ts')).toMatch(/export const REDUCED_EXIT_MS = 100;/);
    for (const f of ['Sheet', 'Dialog', 'SidePanel']) expect(read(`src/components/${f}.tsx`), f).toMatch(/REDUCED_EXIT_MS/);
  });
});

describe('touch targets: 44 px under a coarse pointer (audit B P2-1)', () => {
  it('fields, selects, steppers, switch rows, check rows and the slider band', () => {
    const touch = css.match(/TOUCH TARGETS[\s\S]*?@media \(pointer: coarse\) \{([\s\S]*?)\n {2}\}\n/)?.[1] ?? '';
    expect(touch).toMatch(/\.lm-input,\s*\.lm-select,\s*\.lm-select\[data-size='sm'\],\s*\.lm-numfield,\s*\.lm-stepper \{\s*height: 44px;/);
    expect(touch).toMatch(/\.lm-stepper__btn \{\s*width: 44px;/);
    expect(touch).toMatch(/\.lm-switch \{\s*min-height: 44px;/);
    expect(touch).toMatch(/\.lm-check \{\s*min-height: 44px;/);
    expect(touch).toMatch(/\.lm-scale__well::before \{[^}]*inset: -8px 0;/); // 28 + 16 = 44
    expect(touch).toMatch(/\.lm-scale\[data-size='sm'\] \.lm-scale__well::before \{\s*inset: -11px 0;/); // 22 + 22 = 44
    expect(28 + 2 * 8).toBe(44);
    expect(22 + 2 * 11).toBe(44);
  });
});

describe('typography classes', () => {
  it('the page title is the page role (24/28) and the section heading stays 20/26; the mono role and proportional numerals have classes', () => {
    expect(rule('.lm-title')).toMatch(/font-size: var\(--lm-text-page\);/);
    expect(rule('.lm-title-l')).toMatch(/font-size: var\(--lm-text-title-l\);/);
    const meta = css.match(/\.lm-meta,\s*:where\(\.text-meta\) \{([^}]*)\}/)?.[1] ?? '';
    expect(meta).toMatch(/text-transform: uppercase;/);
    expect(meta).toMatch(/font-family: var\(--lm-text-meta--font\);/);
    expect(css).toMatch(/\.text-hero, \.text-num-l, \.text-num, \.text-time/);
  });
});

describe('the live mark: two pulses, then still', () => {
  it('a 10 px ivory dot with two rings; the rings animate only under data-pulse, for --lm-pulse-cycles (2) cycles of 2.4 s: 4.8 s, under WCAG 2.2.2', () => {
    const dot = rule('.lm-live');
    expect(dot).toMatch(/width: 10px;/);
    expect(dot).toMatch(/background: var\(--lm-ink\);/);
    expect(css).toMatch(/\.lm-live\[data-pulse\]::before \{\s*animation: lm-pulse-a 2400ms ease-out var\(--lm-pulse-cycles\);/);
    expect(css).toMatch(/\.lm-live\[data-pulse\]::after \{\s*animation: lm-pulse-b 2200ms ease-out 200ms var\(--lm-pulse-cycles\);/);
    // nothing loops: no infinite animation on the mark, and no animation without the attribute
    expect(rule('.lm-live::before')).not.toMatch(/animation/);
    expect(css.match(/\.lm-live[^{]*\{[^}]*infinite/)).toBeNull();
    expect(css).toMatch(/@keyframes lm-pulse-a/);
    expect(css).toMatch(/@keyframes lm-pulse-b/);
    expect(2.4 * 2).toBeLessThan(5);
    expect(tokens).toMatch(/--lm-pulse-cycles:\s*2;/);
  });
});
