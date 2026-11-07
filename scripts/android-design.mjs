#!/usr/bin/env node
/**
 * The design of the Android home-screen widgets, generated (r071 W2).
 *
 * One direction: `design/tokens.css` (the master) and `design/widgets.json` (the registry) become the Android resources
 * and constants the widgets use, so a widget's colours, glow and corner can never drift from the web card they mirror:
 *
 *   apps/android/design/res/values/vitals_tokens.xml            colours and the card corner
 *   apps/android/design/res/values-v31/vitals_tokens.xml        the corner on Android 12+: the launcher's own radius
 *   apps/android/design/res/drawable/vw_card_<hue>_<class>.xml  the card: face, one eased glow in the hue, a hairline
 *   apps/android/design/res/drawable/vw_key_*.xml, vw_icon_*.xml  the keys, and the card icons (the web's Lucide nodes)
 *   apps/android/design/kotlin/.../design/{Tokens,WidgetRegistry,WidgetTargets,CardArt}.kt
 *
 * The neutrals (face, ink, hairline, gold) always come from tokens.css. The palette (eight domain hues with their solid,
 * ink, deep and dim steps, the glow of each card, the sleep stages, the unlit mark, the card corner) comes from
 * tokens.css once the foundation has declared it (`--lm-hue-energy` is there); until then from the values of
 * RESEARCH.md §5 below, so the widgets can be built and drawn beside the foundation. Each generated file says which.
 * `src/styles/__tests__/androidDesign.test.ts` fails when a file is not what this script writes now: run
 * `pnpm android:design`, commit the result.
 *
 *   node scripts/android-design.mjs           write
 *   node scripts/android-design.mjs --check   exit 1 when a generated file is out of date
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'apps/android/design';
const PKG = 'desi.creative.vitals.widgets.design';

/** Domains in the wheel's order (RESEARCH §3.2) and the hues a widget may wear. */
export const DOMAINS = ['heart', 'energy', 'food', 'steps', 'recovery', 'body', 'sleep', 'videos'];

/** The widget size classes (WidgetSize.kt) and the aspect ratio the card glow is cut for. */
export const SIZE_CLASSES = { square: 1, wide: 2, strip: 4 };

/** RESEARCH.md §5, until the foundation's tokens.css carries them. */
export const PLACEHOLDERS = {
  hues: {
    heart: { solid: '#FF9EA7', ink: '#F7CFD2', deep: '#B61441', dim: '#523939' },
    energy: { solid: '#E26B1B', ink: '#FBD5C2', deep: '#CB5A00', dim: '#4B2D17' },
    food: { solid: '#92D36C', ink: '#D0E6C5', deep: '#4A871B', dim: '#38462B' },
    steps: { solid: '#19AA8E', ink: '#C4E7DC', deep: '#0D7A66', dim: '#1B3C33' },
    recovery: { solid: '#6BCDE9', ink: '#CCE7EF', deep: '#1C7489', dim: '#2E4449' },
    body: { solid: '#5695E0', ink: '#C9DDF5', deep: '#0062BB', dim: '#293746' },
    sleep: { solid: '#BEB1FF', ink: '#DAD6F7', deep: '#5737A7', dim: '#423D4E' },
    videos: { solid: '#D066B1', ink: '#F3CEE5', deep: '#99167B', dim: '#462B3B' },
  },
  goldDeep: '#8D6D1F',
  glow: {
    energy: { pos: '50% 112%', size: '80% 62%', a: '0.78' },
    heart: { pos: '100% 100%', size: '115% 100%', a: '0.60' },
    steps: { pos: '0% 0%', size: '105% 80%', a: '0.55' },
    sleep: { pos: '100% 0%', size: '78% 105%', a: '0.62' },
    body: { pos: '50% 120%', size: '105% 70%', a: '0.60' },
    recovery: { pos: '100% 0%', size: '95% 85%', a: '0.58' },
    food: { pos: '100% 0%', size: '82% 105%', a: '0.58' },
    videos: { pos: '100% 100%', size: '100% 100%', a: '0.60' },
    gold: { pos: '0% 50%', size: '60% 150%', a: '0.34' },
  },
  stages: { deep: '#6060C3', light: '#8895E2', rem: '#ECADF6', awake: '#F4E3BF', unspecified: '#737BD3' },
  unlit: 'rgb(245 241 233 / 0.17)',
  glass: 'rgb(245 241 233 / 0.07)',
  glassEdge: 'rgb(245 241 233 / 0.14)',
  cardRadius: '20px',
};

// ------------------------------------------------------------------------------------------------ tokens.css

/** The first declaration of every custom property (the :root block comes first; media overrides come after it). */
export function parseTokens(css) {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const map = new Map();
  for (const m of code.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) if (!map.has(m[1])) map.set(m[1], m[2].trim());
  return map;
}

/** A token's value with every `var(--x)` followed. */
export function resolveToken(map, name, trail = []) {
  if (trail.includes(name)) throw new Error(`token cycle: ${[...trail, name].join(' -> ')}`);
  const raw = map.get(name);
  if (raw === undefined) throw new Error(`${name} is not declared in design/tokens.css`);
  return raw.replace(/var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)/g, (_, ref) => resolveToken(map, ref, [...trail, name]));
}

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(r g b / a)` or `rgba(r, g, b, a)` as 0..255 channels and an alpha 0..1. */
export function parseColor(s) {
  if (s.trim().toLowerCase() === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const v = s.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16), a: 1 };
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[/,]\s*([\d.]+%?))?\s*\)$/i.exec(v);
  if (m) {
    let a = 1;
    if (m[4] !== undefined) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  throw new Error(`not a colour this generator reads: ${s}`);
}

const hex2 = (n) => Math.round(n).toString(16).toUpperCase().padStart(2, '0');
/** Android colour resource text: `#RRGGBB`, or `#AARRGGBB` when translucent. */
export const androidColor = (c, alpha = c.a) => (alpha >= 1 ? `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}` : `#${hex2(alpha * 255)}${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`);
/** Kotlin Int literal of the same colour (always with its alpha byte). */
export const kotlinColor = (c, alpha = c.a) => `0x${hex2(alpha * 255)}${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}.toInt()`;

/** "50% 112%" as fractions. */
export function parsePair(s) {
  const m = /^\s*(-?[\d.]+)%\s+(-?[\d.]+)%\s*$/.exec(s);
  if (!m) throw new Error(`not a pair of percentages: ${s}`);
  return [parseFloat(m[1]) / 100, parseFloat(m[2]) / 100];
}

/** The design as the widgets need it, from tokens.css (and RESEARCH §5 until it has the palette). */
export function readDesign(tokensCss) {
  const map = parseTokens(tokensCss);
  const col = (name) => parseColor(resolveToken(map, name));
  const fromTokens = map.has('--lm-hue-energy');
  const P = PLACEHOLDERS;
  const token = (name, fallback) => (fromTokens ? resolveToken(map, name) : fallback);
  const hues = {};
  for (const d of DOMAINS) {
    const h = P.hues[d];
    hues[d] = {
      solid: parseColor(token(`--lm-hue-${d}`, h.solid)),
      ink: parseColor(token(`--lm-hue-${d}-ink`, h.ink)),
      deep: parseColor(token(`--lm-hue-${d}-deep`, h.deep)),
      dim: parseColor(token(`--lm-hue-${d}-dim`, h.dim)),
    };
  }
  // gold is the brand and the action: its solid is the primary key, its glow the Next-up and Today strips' (deep at 34 %)
  hues.gold = { solid: col('--lm-signal'), ink: col('--lm-ink-2'), deep: parseColor(token('--lm-hue-gold-deep', P.goldDeep)), dim: col('--lm-raised') };
  const glow = {};
  for (const d of [...DOMAINS, 'gold']) {
    const g = P.glow[d];
    glow[d] = { pos: parsePair(token(`--lm-glow-${d}-pos`, g.pos)), size: parsePair(token(`--lm-glow-${d}-size`, g.size)), a: parseFloat(token(`--lm-glow-${d}-a`, g.a)) };
  }
  const k = fromTokens && map.has('--lm-glow-k') ? parseFloat(resolveToken(map, '--lm-glow-k')) : 1;
  const stages = Object.fromEntries(Object.entries(P.stages).map(([n, v]) => [n, parseColor(token(`--lm-stage-${n}`, v))]));
  return {
    source: fromTokens ? 'design/tokens.css' : 'the values of RESEARCH.md section 5 (design/tokens.css has no domain hue tokens yet)',
    neutrals: {
      face: col('--lm-face'),
      edge: col('--lm-edge'),
      ink: col('--lm-ink'),
      ink2: col('--lm-ink-2'),
      ink3: col('--lm-ink-3'),
      signal: col('--lm-signal'),
      signalPress: col('--lm-signal-press'),
      signalInk: col('--lm-signal-ink'),
      unlit: parseColor(token('--lm-unlit', P.unlit)),
      glass: parseColor(token('--lm-info-key-bg', P.glass)),
      glassEdge: parseColor(token('--lm-info-key-edge', P.glassEdge)),
    },
    hues,
    glow,
    glowK: k,
    stages,
    radiusDp: parseFloat(token('--lm-card-radius', P.cardRadius)),
  };
}

// ------------------------------------------------------------------------------------------------ generated files

const HEADER = (d) => `GENERATED by scripts/android-design.mjs from design/tokens.css and design/widgets.json. Do not edit: run \`pnpm android:design\`.
     Palette: ${d.source}.`;
const xmlHead = (d) => `<?xml version="1.0" encoding="utf-8"?>\n<!-- ${HEADER(d)} -->\n`;
const num = (x) => String(Math.round(x * 1000) / 1000);

export function colorsXml(d) {
  const n = d.neutrals;
  const rows = [
    ['vw_face', n.face, 'the card'],
    ['vw_edge', n.edge, 'the card hairline'],
    ['vw_ink', n.ink, 'titles, hero numerals, lit marks'],
    ['vw_ink_2', n.ink2, 'secondary'],
    ['vw_ink_3', n.ink3, 'tertiary'],
    ['vw_signal', n.signal, 'gold: the action, never data'],
    ['vw_signal_press', n.signalPress, 'gold, pressed'],
    ['vw_signal_ink', n.signalInk, 'text on gold'],
    ['vw_unlit', n.unlit, 'the unlit remainder of a ring, a track or a bar'],
    ['vw_glass', n.glass, 'the glass key'],
    ['vw_glass_edge', n.glassEdge, 'the glass key hairline'],
  ];
  for (const [name, c] of Object.entries(d.stages)) rows.push([`vw_stage_${name}`, c, 'sleep stage']);
  for (const [h, c] of Object.entries(d.hues)) {
    rows.push([`vw_${h}`, c.solid, `${h}: marks`], [`vw_${h}_ink`, c.ink, `${h}: soft tint for secondary text`], [`vw_${h}_deep`, c.deep, `${h}: the glow core`], [`vw_${h}_dim`, c.dim, `${h}: the unlit remainder`]);
  }
  const body = rows.map(([name, c, why]) => `    <color name="${name}">${androidColor(c)}</color><!-- ${why} -->`).join('\n');
  return `${xmlHead(d)}<resources>\n${body}\n    <!-- The card corner: the foundation's, below Android 12; the launcher's own from 12 (values-v31). -->\n    <dimen name="vw_radius">${num(d.radiusDp)}dp</dimen>\n</resources>\n`;
}

export function radiusV31Xml(d) {
  return `${xmlHead(d)}<resources>\n    <!-- Android 12+: the launcher crops the widget to its own corner, so the card follows it (owner, r071 Q11). -->\n    <dimen name="vw_radius">@android:dimen/system_app_widget_background_radius</dimen>\n</resources>\n`;
}

/**
 * The card of a hue for a size class: the face, one glow in the hue's deep colour, a hairline, the corner. The web's glow is
 * an eased five-stop ellipse (RESEARCH §3.3); a shape gradient is a circle with three stops, so its radius is cut from the
 * ellipse for the class's aspect and its middle stop is where the eased curve is at half of it.
 */
export function cardDrawable(d, hue, cls) {
  const aspect = SIZE_CLASSES[cls];
  const g = d.glow[hue];
  const deep = d.hues[hue].deep;
  // the ellipse's radii in units of the card's shorter side (its height: every class is at least as wide as tall); the
  // glow reaches transparent at 86 % of them. A circle takes the geometric mean.
  const radius = Math.min(2, 0.86 * Math.sqrt(g.size[0] * aspect * g.size[1]));
  const a = g.a * d.glowK;
  const stop = (f) => androidColor(deep, Math.min(1, a * f));
  return `${xmlHead(d)}<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item>
        <shape android:shape="rectangle" android:dither="true">
            <solid android:color="@color/vw_face" />
            <corners android:radius="@dimen/vw_radius" />
        </shape>
    </item>
    <item>
        <shape android:shape="rectangle" android:dither="true">
            <gradient android:type="radial" android:centerX="${num(g.pos[0])}" android:centerY="${num(g.pos[1])}" android:gradientRadius="${Math.round(radius * 100)}%"
                android:startColor="${stop(1)}" android:centerColor="${stop(0.48)}" android:endColor="${stop(0)}" />
            <corners android:radius="@dimen/vw_radius" />
        </shape>
    </item>
    <item>
        <shape android:shape="rectangle">
            <stroke android:width="1dp" android:color="@color/vw_edge" />
            <corners android:radius="@dimen/vw_radius" />
        </shape>
    </item>
</layer-list>
`;
}

export function keyDrawables(d) {
  const sel = (shape, on, off) => `${xmlHead(d)}<selector xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:state_pressed="true">${shape(on)}</item>
    <item>${shape(off)}</item>
</selector>
`;
  const pill = (fill) => `<shape android:shape="rectangle"><solid android:color="${fill}" /><corners android:radius="999dp" /></shape>`;
  const circle = (fill) => `<shape android:shape="oval"><solid android:color="${fill}" /></shape>`;
  const glass = (fill) => `<shape android:shape="rectangle"><solid android:color="${fill}" /><stroke android:width="1dp" android:color="@color/vw_glass_edge" /><corners android:radius="999dp" /></shape>`;
  return {
    'vw_key_gold.xml': sel(pill, '@color/vw_signal_press', '@color/vw_signal'),
    'vw_key_gold_round.xml': sel(circle, '@color/vw_signal_press', '@color/vw_signal'),
    'vw_key_glass.xml': sel(glass, '@color/vw_unlit', '@color/vw_glass'),
  };
}

// ------------------------------------------------------------------------------------------------ icons

/** The nodes of a Lucide icon as the web card draws them (lucide-react's own data). */
export function lucideNodes(root, name) {
  const file = join(root, 'node_modules/lucide-react/dist/esm/icons', `${name}.mjs`);
  if (!existsSync(file)) throw new Error(`no Lucide icon ${name} (${file})`);
  const src = readFileSync(file, 'utf8');
  const nodes = [];
  for (const m of src.matchAll(/\[\s*"(path|circle|line|polyline|polygon|rect|ellipse)"\s*,\s*\{([^}]*)\}\s*\]/g)) {
    const attrs = {};
    for (const a of m[2].matchAll(/(\w+)\s*:\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    nodes.push({ tag: m[1], attrs });
  }
  if (nodes.length === 0) throw new Error(`Lucide icon ${name}: no nodes read`);
  return nodes;
}

const f = (x) => num(parseFloat(x));
/** One Lucide node as VectorDrawable path data (SVG path syntax). */
export function pathOf({ tag, attrs: a }) {
  switch (tag) {
    case 'path':
      return a.d;
    case 'circle': {
      const [cx, cy, r] = [parseFloat(a.cx), parseFloat(a.cy), parseFloat(a.r)];
      return `M${num(cx - r)},${num(cy)}a${num(r)},${num(r)} 0 1,0 ${num(2 * r)},0a${num(r)},${num(r)} 0 1,0 ${num(-2 * r)},0`;
    }
    case 'ellipse': {
      const [cx, cy, rx, ry] = [parseFloat(a.cx), parseFloat(a.cy), parseFloat(a.rx), parseFloat(a.ry)];
      return `M${num(cx - rx)},${num(cy)}a${num(rx)},${num(ry)} 0 1,0 ${num(2 * rx)},0a${num(rx)},${num(ry)} 0 1,0 ${num(-2 * rx)},0`;
    }
    case 'line':
      return `M${f(a.x1)},${f(a.y1)}L${f(a.x2)},${f(a.y2)}`;
    case 'polyline':
    case 'polygon': {
      const pts = a.points.trim().split(/[\s,]+/).map(parseFloat);
      let d = '';
      for (let i = 0; i + 1 < pts.length; i += 2) d += `${i === 0 ? 'M' : 'L'}${num(pts[i])},${num(pts[i + 1])}`;
      return tag === 'polygon' ? `${d}Z` : d;
    }
    case 'rect': {
      const [x, y, w, h] = [parseFloat(a.x ?? '0'), parseFloat(a.y ?? '0'), parseFloat(a.width), parseFloat(a.height)];
      const r = Math.min(parseFloat(a.rx ?? a.ry ?? '0'), w / 2, h / 2);
      if (!(r > 0)) return `M${num(x)},${num(y)}h${num(w)}v${num(h)}h${num(-w)}Z`;
      return `M${num(x + r)},${num(y)}h${num(w - 2 * r)}a${num(r)},${num(r)} 0 0 1 ${num(r)},${num(r)}v${num(h - 2 * r)}a${num(r)},${num(r)} 0 0 1 ${num(-r)},${num(r)}h${num(-(w - 2 * r))}a${num(r)},${num(r)} 0 0 1 ${num(-r)},${num(-r)}v${num(-(h - 2 * r))}a${num(r)},${num(r)} 0 0 1 ${num(r)},${num(-r)}Z`;
    }
    default:
      throw new Error(`unsupported node ${tag}`);
  }
}

/** A 24 dp vector in white, the way the app's `Icon` draws it (1.5 stroke, round caps and joins): tinted at run time. */
export function iconXml(d, name, nodes) {
  const paths = nodes
    .map((n) => `    <path android:strokeColor="#FFFFFF" android:strokeWidth="1.5" android:strokeLineCap="round" android:strokeLineJoin="round"\n        android:pathData="${pathOf(n)}" />`)
    .join('\n');
  return `${xmlHead(d)}<!-- Lucide "${name}" (ISC), the same nodes the web card draws; tinted by the widget. -->\n<vector xmlns:android="http://schemas.android.com/apk/res/android"\n    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">\n${paths}\n</vector>\n`;
}

// ------------------------------------------------------------------------------------------------ Kotlin

const kt = (d) => `// ${HEADER(d).replace(/\n\s*/g, '\n// ')}\n`;

export function tokensKt(d) {
  const n = d.neutrals;
  const colours = [
    ['FACE', n.face],
    ['EDGE', n.edge],
    ['INK', n.ink],
    ['INK_2', n.ink2],
    ['INK_3', n.ink3],
    ['SIGNAL', n.signal],
    ['SIGNAL_INK', n.signalInk],
    ['UNLIT', n.unlit],
  ];
  const hues = Object.entries(d.hues).map(([h, c]) => `        "${h}" to HueColors(${kotlinColor(c.solid)}, ${kotlinColor(c.ink)}, ${kotlinColor(c.deep)}, ${kotlinColor(c.dim)}),`).join('\n');
  const stages = Object.entries(d.stages).map(([s, c]) => `    val STAGE_${s.toUpperCase()}: Int = ${kotlinColor(c)}`).join('\n');
  const glows = Object.entries(d.glow).map(([h, g]) => `        "${h}" to Glow(${num(g.pos[0])}f, ${num(g.pos[1])}f, ${num(g.size[0])}f, ${num(g.size[1])}f, ${num(g.a * d.glowK)}f),`).join('\n');
  return `${kt(d)}package ${PKG}

/** A domain's four steps (RESEARCH §3.2): marks, the soft tint of secondary text, the glow core, the unlit remainder. */
data class HueColors(val solid: Int, val ink: Int, val deep: Int, val dim: Int)

/** A card's glow: its centre and radii as fractions of the card, and its alpha at the core. */
data class Glow(val cx: Float, val cy: Float, val rx: Float, val ry: Float, val alpha: Float)

object Tokens {
${colours.map(([name, c]) => `    val ${name}: Int = ${kotlinColor(c)}`).join('\n')}
${stages}

    /** The card corner below Android 12, dp (from 12 the launcher's own radius applies). */
    const val CARD_RADIUS_DP: Float = ${num(d.radiusDp)}f

    val HUES: Map<String, HueColors> = linkedMapOf(
${hues}
    )

    val GLOWS: Map<String, Glow> = linkedMapOf(
${glows}
    )

    fun hue(name: String): HueColors = HUES[name] ?: error("no hue $name")
}
`;
}

export function registryKt(d, reg) {
  const cards = reg.widgets
    .map((w) => `        Card("${w.id}", "${w.provider}", "${w.label}", "${w.kind}", "${w.hue}", ${w.cells[0]}, ${w.cells[1]}, "${w.tap}", ${w.optIn === true}),`)
    .join('\n');
  return `${kt(d)}package ${PKG}

/** design/widgets.json: the widgets, by the id the web feed's \`status().byCard\` uses. */
object WidgetRegistry {
    data class Card(val id: String, val provider: String, val label: String, val kind: String, val hue: String, val cols: Int, val rows: Int, val tap: String, val optIn: Boolean)

    val cards: List<Card> = listOf(
${cards}
    )

    fun byId(id: String): Card? = cards.firstOrNull { it.id == id }
}
`;
}

export function targetsKt(d, reg) {
  const rows = Object.entries(reg.targets).map(([id, path]) => `        "${id}" to "${path}",`).join('\n');
  return `${kt(d)}package ${PKG}

/** design/widgets.json: the screens a widget tap may open, by target id (an intent names a target, never a path). */
object WidgetTargets {
    val PATHS: Map<String, String> = linkedMapOf(
${rows}
    )
}
`;
}

/** The card drawables and icons by name, so a missing resource is a build error and not a run-time surprise. */
export function cardArtKt(d, reg) {
  const hues = [...new Set(reg.widgets.map((w) => w.hue))];
  const cards = hues.flatMap((h) => Object.keys(SIZE_CLASSES).map((c) => `        "${h}/${c}" -> R.drawable.vw_card_${h}_${c}`)).join('\n');
  const icons = Object.keys(reg.icons).map((c) => `        "${c}" -> R.drawable.vw_icon_${c}`).join('\n');
  return `${kt(d)}package ${PKG}

import desi.creative.vitals.R

/** The generated card drawables (one per hue and size class) and card icons, by name. */
object CardArt {
    fun card(hue: String, sizeClass: String): Int = when ("$hue/$sizeClass") {
${cards}
        else -> error("no card drawable for $hue/$sizeClass")
    }

    /** The icon of a card id (0 when it has none). */
    fun icon(card: String): Int = when (card) {
${icons}
        else -> 0
    }
}
`;
}

// ------------------------------------------------------------------------------------------------ everything

/** Every generated file: path (from the repo root) to text. */
export function generate({ root = ROOT, tokensCss, registry } = {}) {
  const css = tokensCss ?? readFileSync(join(root, 'design/tokens.css'), 'utf8');
  const reg = registry ?? JSON.parse(readFileSync(join(root, 'design/widgets.json'), 'utf8'));
  const d = readDesign(css);
  const files = new Map();
  files.set(`${OUT}/res/values/vitals_tokens.xml`, colorsXml(d));
  files.set(`${OUT}/res/values-v31/vitals_tokens.xml`, radiusV31Xml(d));
  const hues = [...new Set(reg.widgets.map((w) => w.hue))];
  for (const hue of hues) {
    if (!d.glow[hue]) throw new Error(`widgets.json: no glow for hue ${hue}`);
    for (const cls of Object.keys(SIZE_CLASSES)) files.set(`${OUT}/res/drawable/vw_card_${hue}_${cls}.xml`, cardDrawable(d, hue, cls));
  }
  for (const [name, text] of Object.entries(keyDrawables(d))) files.set(`${OUT}/res/drawable/${name}`, text);
  for (const [card, icon] of Object.entries(reg.icons)) files.set(`${OUT}/res/drawable/vw_icon_${card}.xml`, iconXml(d, icon, lucideNodes(root, icon)));
  const ktDir = `${OUT}/kotlin/${PKG.replaceAll('.', '/')}`;
  files.set(`${ktDir}/Tokens.kt`, tokensKt(d));
  files.set(`${ktDir}/WidgetRegistry.kt`, registryKt(d, reg));
  files.set(`${ktDir}/WidgetTargets.kt`, targetsKt(d, reg));
  files.set(`${ktDir}/CardArt.kt`, cardArtKt(d, reg));
  return files;
}

/** The files whose text differs from what `generate` writes now (missing files included). */
export function stale({ root = ROOT, ...rest } = {}) {
  const out = [];
  for (const [path, text] of generate({ root, ...rest })) {
    const file = join(root, path);
    if (!existsSync(file) || readFileSync(file, 'utf8') !== text) out.push(path);
  }
  return out;
}

function main() {
  const check = process.argv.includes('--check');
  const files = generate();
  if (check) {
    const bad = stale();
    if (bad.length) {
      console.error(`out of date (run pnpm android:design):\n  ${bad.join('\n  ')}`);
      process.exit(1);
    }
    console.log(`android design: ${files.size} files up to date`);
    return;
  }
  for (const [path, text] of files) {
    const file = join(ROOT, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  console.log(`android design: wrote ${files.size} files under ${OUT}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
