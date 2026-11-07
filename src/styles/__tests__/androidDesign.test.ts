/**
 * The Android widgets' design is generated from the web's (r071 W2): `scripts/android-design.mjs` turns design/tokens.css and
 * design/widgets.json into the resources and constants the widgets draw with, so their colours, glow and corner cannot
 * drift from the cards they mirror. The generated files are committed; this fails when one is not what the script writes
 * now (run `pnpm android:design`) and checks that every token the script needs is declared, that a palette taken from
 * tokens.css is the one generated, and that the registry, the keys and the fonts are whole.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOMAINS, PLACEHOLDERS, SIZE_CLASSES, androidColor, generate, parseColor, parseTokens, readDesign, resolveToken, stale, type Registry } from '../../../scripts/android-design.mjs';

const root = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const tokensCss = read('design/tokens.css');
const registry = JSON.parse(read('design/widgets.json')) as Registry;
const tokens = parseTokens(tokensCss);
const palette = tokens.has('--lm-hue-energy');

describe('the generated Android design', () => {
  it('is what the generator writes now (run `pnpm android:design` when this fails)', () => {
    expect(stale({ root })).toEqual([]);
  });

  it('writes the files the widgets are built from: tokens, a card per hue and class, keys, icons, Kotlin', () => {
    const files = [...generate({ root }).keys()];
    expect(files).toContain('apps/android/design/res/values/vitals_tokens.xml');
    expect(files).toContain('apps/android/design/res/values-v31/vitals_tokens.xml');
    for (const hue of new Set(registry.widgets.map((w) => w.hue))) {
      for (const cls of Object.keys(SIZE_CLASSES)) expect(files, `${hue} ${cls}`).toContain(`apps/android/design/res/drawable/vw_card_${hue}_${cls}.xml`);
    }
    for (const k of ['vw_key_gold', 'vw_key_gold_round', 'vw_key_glass']) expect(files).toContain(`apps/android/design/res/drawable/${k}.xml`);
    for (const card of Object.keys(registry.icons)) expect(files).toContain(`apps/android/design/res/drawable/vw_icon_${card}.xml`);
    for (const k of ['Tokens', 'WidgetRegistry', 'WidgetTargets', 'CardArt']) expect(files).toContain(`apps/android/design/kotlin/desi/creative/vitals/widgets/design/${k}.kt`);
  });
});

describe('the tokens the generator needs', () => {
  it('the neutrals are declared in design/tokens.css and resolve to colours', () => {
    for (const name of ['--lm-face', '--lm-edge', '--lm-ink', '--lm-ink-2', '--lm-ink-3', '--lm-signal', '--lm-signal-press', '--lm-signal-ink', '--lm-raised']) {
      expect(() => parseColor(resolveToken(tokens, name)), name).not.toThrow();
    }
  });

  it('a palette taken from tokens.css is the one generated: four steps per hue, every glow, the stages, the corner', () => {
    const d = readDesign(tokensCss);
    if (!palette) {
      // the foundation's palette is not there yet: the generator draws the values of RESEARCH §5 and says so
      expect(d.source).toMatch(/RESEARCH/);
      return;
    }
    expect(d.source).toBe('design/tokens.css');
    for (const h of DOMAINS) {
      for (const [step, suffix] of [['solid', ''], ['ink', '-ink'], ['deep', '-deep'], ['dim', '-dim']] as const) {
        expect(androidColor(d.hues[h]![step]), `${h} ${step}`).toBe(androidColor(parseColor(resolveToken(tokens, `--lm-hue-${h}${suffix}`))));
      }
      expect(d.glow[h]!.a, `glow ${h}`).toBeCloseTo(parseFloat(resolveToken(tokens, `--lm-glow-${h}-a`)), 5);
    }
    expect(d.radiusDp).toBe(parseFloat(resolveToken(tokens, '--lm-card-radius')));
    for (const s of ['deep', 'light', 'rem', 'awake']) expect(androidColor(d.stages[s]!)).toBe(androidColor(parseColor(resolveToken(tokens, `--lm-stage-${s}`))));
  });

  it('the stand-in values are RESEARCH §5: eight hues of four hex steps, a glow for each and for gold, alpha inside 0..1', () => {
    expect(Object.keys(PLACEHOLDERS.hues)).toEqual(DOMAINS);
    for (const h of Object.values(PLACEHOLDERS.hues)) for (const v of Object.values(h)) expect(v).toMatch(/^#[0-9A-F]{6}$/);
    for (const g of [...DOMAINS, 'gold']) {
      const glow = PLACEHOLDERS.glow[g]!;
      expect(parseFloat(glow.a), g).toBeGreaterThan(0);
      expect(parseFloat(glow.a), g).toBeLessThanOrEqual(1);
      expect(glow.pos).toMatch(/^-?[\d.]+% -?[\d.]+%$/);
      expect(glow.size).toMatch(/^[\d.]+% [\d.]+%$/);
    }
    // a few values pinned from RESEARCH §3.2: the energy hue and the sleep glow
    expect(PLACEHOLDERS.hues.energy).toEqual({ solid: '#E26B1B', ink: '#FBD5C2', deep: '#CB5A00', dim: '#4B2D17' });
    expect(PLACEHOLDERS.glow.sleep).toEqual({ pos: '100% 0%', size: '78% 105%', a: '0.62' });
  });

  it('colour conversion: hex and rgb() with alpha read to Android resource text, alpha first', () => {
    expect(androidColor(parseColor('transparent'))).toBe('#00000000');
    expect(androidColor(parseColor('#1B1916'))).toBe('#1B1916');
    expect(androidColor(parseColor('rgb(198 171 124 / 0.20)'))).toBe('#33C6AB7C');
    expect(androidColor(parseColor('rgba(245, 241, 233, 0.17)'))).toBe('#2BF5F1E9');
    expect(() => parseColor('color-mix(in oklab, red, blue)')).toThrow();
  });
});

describe('the cards, the corner and the registry', () => {
  const files = generate({ root });
  const text = (p: string) => files.get(`apps/android/design/${p}`)!;

  it('every card is the face, one glow in the hue (a radial gradient from the hue’s deep colour) and a hairline', () => {
    for (const hue of new Set(registry.widgets.map((w) => w.hue))) {
      for (const cls of Object.keys(SIZE_CLASSES)) {
        const xml = text(`res/drawable/vw_card_${hue}_${cls}.xml`);
        expect(xml.match(/<gradient /g), `${hue} ${cls}`).toHaveLength(1);
        expect(xml).toContain('android:type="radial"');
        expect(xml).toContain('@color/vw_face');
        expect(xml).toContain('@color/vw_edge');
        expect(xml).toContain('@dimen/vw_radius');
        const d = readDesign(tokensCss);
        const deep = androidColor(d.hues[hue]!.deep).slice(1);
        expect(xml, `${hue} glow wears its deep colour`).toMatch(new RegExp(`android:startColor="#[0-9A-F]{2}${deep}"`));
        expect(xml).toMatch(new RegExp(`android:endColor="#00${deep}"`));
      }
    }
  });

  it('the corner is the foundation’s below Android 12 and the launcher’s own from 12 (Q11)', () => {
    expect(text('res/values/vitals_tokens.xml')).toMatch(/<dimen name="vw_radius">[\d.]+dp<\/dimen>/);
    expect(text('res/values-v31/vitals_tokens.xml')).toContain('@android:dimen/system_app_widget_background_radius');
  });

  it('the registry is whole: unique ids and providers, a known hue and a known tap target for each', () => {
    const ids = registry.widgets.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(registry.widgets.map((w) => w.provider)).size).toBe(ids.length);
    for (const w of registry.widgets) {
      expect([...DOMAINS, 'gold'], `${w.id} hue`).toContain(w.hue);
      expect(Object.keys(registry.targets), `${w.id} tap`).toContain(w.tap);
      expect(w.cells[0]).toBeGreaterThanOrEqual(1);
      expect(w.cells[1]).toBeGreaterThanOrEqual(1);
    }
    // the four providers that exist keep their class names: renaming one deletes placed widgets
    for (const p of ['TodayWidgetProvider', 'RingWidgetProvider', 'ActionsWidgetProvider', 'LogWidgetProvider']) expect(registry.widgets.map((w) => w.provider)).toContain(p);
    // the web feed's placement keys are registry ids
    for (const id of ['today', 'ring', 'energy', 'sleep', 'steps', 'weight']) expect(ids).toContain(id);
  });

  it('every icon is the web card’s own Lucide nodes: stroked paths in white, 24 dp', () => {
    for (const card of Object.keys(registry.icons)) {
      const xml = text(`res/drawable/vw_icon_${card}.xml`);
      expect(xml).toContain('android:viewportWidth="24"');
      expect(xml.match(/android:pathData="[^"]+"/g)?.length, card).toBeGreaterThan(0);
      expect(xml).toContain('android:strokeWidth="1.5"');
    }
  });
});

describe('the fonts', () => {
  it('ship as four static instances of the web’s Geist and Geist Mono, with their licences beside them', () => {
    for (const f of ['geist_light', 'geist_regular', 'geist_semibold', 'geist_mono_medium']) {
      const p = resolve(root, `apps/android/design/res/font/${f}.ttf`);
      expect(existsSync(p), f).toBe(true);
      expect(statSync(p).size, f).toBeGreaterThan(10_000);
      expect(statSync(p).size, f).toBeLessThan(120_000);
    }
    for (const l of ['OFL-Geist.txt', 'OFL-GeistMono.txt']) expect(read(`apps/android/design/fonts/${l}`)).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });
});
