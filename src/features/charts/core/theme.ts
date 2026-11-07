/* ==========================================================================
   ChartTheme — resolves --lm-* tokens ONCE (CHART_SPEC §8.3) and exposes
   plain colour strings to canvas code. One palette: Ember, dark only. Re-read
   on: data-motion / data-contrast / style changes on <html>, forced-colors,
   reduced motion, contrast changes, and web-font load. Never read CSS vars
   per frame.
   ========================================================================== */
import type { MacroKey, MetricCategory, PlanId } from '../types';

export interface ChartTheme {
  /** Always true: the app has one (dark) palette. */
  dark: boolean;
  forced: boolean;
  reducedMotion: boolean;
  face: string;
  well: string;
  raised: string;
  line: string;
  lineStrong: string;
  edge: string;
  ink: string;
  ink2: string;
  ink3: string;
  inkFaint: string;
  grid: string;
  axis: string;
  crosshair: string;
  phaseAlt: string;
  ring: string;
  signal: string;
  bandAlpha: number;
  areaAlpha: number;
  dimAlpha: number;
  /** r071 skin: the dotted gridlines (ink at `--lmc-grid-a`; GrayText under forced colours). */
  gridDot: string;
  /** r071 skin: a single series' area, vertical gradient: this alpha at the line, 0 at the baseline (`--lmc-area-top`). */
  areaTop: number;
  /**
   * r071 skin: an end dot's glow (a flat halo disc plus a soft shadow), in px and alpha. All of it is off when `glow` is
   * false: forced colours, high contrast and reduced motion draw the dot and its ring only.
   */
  dot: { haloAlpha: number; haloSpread: number; glowAlpha: number; glowBlur: number };
  glow: boolean;
  /** `prefers-contrast: more` or `html[data-contrast=more|high]`. */
  highContrast: boolean;
  cat: Record<MetricCategory, string>;
  macro: Record<MacroKey, string>;
  plan: Record<PlanId, string>;
  keto: [string, string, string];
  /** Energy balance below maintenance (r071 `--lm-balance-deficit-1..6`, tide, 10 % bands: 0–10 … 50–60 %). */
  deficit: [string, string, string, string, string, string];
  /** Energy balance above maintenance (`--lm-balance-surplus-1..4`, ember, 10 % bands: 0–10 … 30–40 %). */
  surplus: [string, string, string, string];
  energyFast: string;
  energyNeutral: string;
  severity: { info: string; caution: string; danger: string; ok: string };
  /** TDEE components bottom → top, lowest surface contrast first (validated ordinal ramp, see charts.css). */
  energyRamp: [string, string, string, string];
  decomposition: { fat: string; lean: string; glycogen: string; water: string };
  fontFamily: string;
  /** --lm-dur-slow in ms (0 under reduced motion). */
  durSlow: number;
}

/**
 * Ember defaults from src/styles/tokens.css and charts.css (dark only) — used when a token is missing (tests, early
 * boot). They hold the RESOLVED value of each token (an alias such as `--lm-cat-body: var(--lm-hue-body)` is its hex),
 * and `test/themeDefaults.test.ts` compares every entry with the stylesheets, so a token that moves fails there until
 * this table follows. r071: the data hues are the eight domain hues (`--lm-hue-<domain>` solid, ink, deep, dim) and the
 * five coinciding category slots (body, energy, performance, recovery, cardio) alias them.
 */
export const THEME_DEFAULTS: Readonly<Record<string, string>> = {
  '--lm-face': '#1B1916',
  '--lm-well': '#11100F',
  '--lm-raised': '#22201C',
  '--lm-line': 'rgb(198 171 124 / 0.20)',
  '--lm-line-strong': 'rgb(198 171 124 / 0.40)',
  '--lm-edge': 'rgb(198 171 124 / 0.20)',
  '--lm-ink': '#F5F1E9',
  '--lm-ink-2': '#C3BCB0',
  '--lm-ink-3': '#AAA296',
  '--lm-ink-faint': 'rgb(170 162 150 / 0.40)',
  '--lm-chart-grid': '#2C2820',
  '--lm-chart-axis': '#4A4134',
  '--lm-chart-crosshair': '#C3BCB0',
  '--lm-chart-phase-alt': 'rgb(245 241 233 / 0.03)',
  '--lm-chart-ring': '#1B1916',
  '--lm-signal': '#E3BF78',
  '--lm-chart-band-alpha': '0.20',
  '--lm-chart-area-alpha': '0.14',
  '--lm-chart-dim-alpha': '0.32',
  '--lm-cat-body': '#5695E0',
  '--lm-cat-fuel': '#8F6835',
  '--lm-cat-energy': '#E26B1B',
  '--lm-cat-cellular': '#7E7159',
  '--lm-cat-performance': '#19AA8E',
  '--lm-cat-recovery': '#6BCDE9',
  '--lm-cat-cardio': '#FF9EA7',
  '--lm-cat-hormones': '#966755',
  // the eight domain hues: solid (marks), ink (soft text tint), deep (the glow core), dim (the unlit remainder)
  '--lm-hue-heart': '#FF9EA7',
  '--lm-hue-heart-ink': '#F7CFD2',
  '--lm-hue-heart-deep': '#B61441',
  '--lm-hue-heart-dim': '#523939',
  '--lm-hue-energy': '#E26B1B',
  '--lm-hue-energy-ink': '#FBD5C2',
  '--lm-hue-energy-deep': '#CB5A00',
  '--lm-hue-energy-dim': '#4B2D17',
  '--lm-hue-food': '#92D36C',
  '--lm-hue-food-ink': '#D0E6C5',
  '--lm-hue-food-deep': '#4A871B',
  '--lm-hue-food-dim': '#38462B',
  '--lm-hue-steps': '#19AA8E',
  '--lm-hue-steps-ink': '#C4E7DC',
  '--lm-hue-steps-deep': '#0D7A66',
  '--lm-hue-steps-dim': '#1B3C33',
  '--lm-hue-recovery': '#6BCDE9',
  '--lm-hue-recovery-ink': '#CCE7EF',
  '--lm-hue-recovery-deep': '#1C7489',
  '--lm-hue-recovery-dim': '#2E4449',
  '--lm-hue-body': '#5695E0',
  '--lm-hue-body-ink': '#C9DDF5',
  '--lm-hue-body-deep': '#0062BB',
  '--lm-hue-body-dim': '#293746',
  '--lm-hue-sleep': '#BEB1FF',
  '--lm-hue-sleep-ink': '#DAD6F7',
  '--lm-hue-sleep-deep': '#5737A7',
  '--lm-hue-sleep-dim': '#423D4E',
  '--lm-hue-videos': '#D066B1',
  '--lm-hue-videos-ink': '#F3CEE5',
  '--lm-hue-videos-deep': '#99167B',
  '--lm-hue-videos-dim': '#462B3B',
  '--lm-macro-protein': '#6CB35D',
  '--lm-macro-carbs': '#EACE8C',
  '--lm-macro-fibre': '#677D51',
  '--lm-macro-fat': '#F3A07D',
  '--lm-macro-alcohol': '#A57DA1',
  '--lm-plan-a': '#E3BF78',
  '--lm-plan-b': '#7D9A66',
  '--lm-plan-c': '#9C604D',
  '--lm-keto-1': '#9C5B3F',
  '--lm-keto-2': '#FE9140',
  '--lm-keto-3': '#FFCE88',
  // the r071 energy balance (tide below maintenance, ember above), its maintenance tint and the water-only fast
  '--lm-balance-deficit-1': '#1E2B3B',
  '--lm-balance-deficit-2': '#1C324D',
  '--lm-balance-deficit-3': '#1A395D',
  '--lm-balance-deficit-4': '#183F6D',
  '--lm-balance-deficit-5': '#16467C',
  '--lm-balance-deficit-6': '#154D8A',
  '--lm-balance-surplus-1': '#37261D',
  '--lm-balance-surplus-2': '#45291A',
  '--lm-balance-surplus-3': '#542C16',
  '--lm-balance-surplus-4': '#612F11',
  '--lm-balance-fast': '#F5F1E9',
  '--lm-balance-neutral': '#22201C',
  '--lm-info-mark': '#C7C3BC',
  '--lm-caution-mark': '#E3BF78',
  '--lm-danger-mark': '#E5A39B',
  '--lm-ok-mark': '#C9C5AF',
  // the TDEE stack: the r071 intensity set (resting, light, active, exercise), lowest contrast at the bottom
  '--lmc-energy-ramp-1': '#9C5B3F',
  '--lmc-energy-ramp-2': '#CE7443',
  '--lmc-energy-ramp-3': '#FE9140',
  '--lmc-energy-ramp-4': '#FFCE88',
  '--lmc-decomp-fat': '#F3A07D',
  '--lmc-decomp-lean': '#6CB35D',
  '--lmc-decomp-glycogen': '#8F6835',
  '--lmc-decomp-water': '#5695E0',
  // the r071 chart skin (charts.css): dotted grid, area gradient, end-dot glow
  '--lmc-grid-a': '0.10',
  '--lmc-area-top': '0.26',
  '--lmc-dot-halo-a': '0.18',
  '--lmc-dot-halo': '6px',
  '--lmc-dot-glow-a': '0.45',
  '--lmc-dot-glow': '12px',
  '--lm-font-sans': '"Geist", "Geist Fallback", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  '--lm-dur-slow': '320ms',
};

function mq(q: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(q).matches;
}

function parseMs(v: string): number {
  const s = v.trim();
  if (!s) return 320;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 320;
  return s.endsWith('ms') ? n : s.endsWith('s') ? n * 1000 : n;
}

/** Read the theme from computed tokens on `el` (defaults to <html>). */
export function readChartTheme(el?: Element | null): ChartTheme {
  let cs: CSSStyleDeclaration | null = null;
  try {
    const target = el ?? (typeof document !== 'undefined' ? document.documentElement : null);
    cs = target ? getComputedStyle(target) : null;
  } catch {
    cs = null;
  }
  const v = (name: string) => {
    const got = cs?.getPropertyValue(name).trim();
    return got || THEME_DEFAULTS[name] || '';
  };
  const num = (name: string) => {
    const n = parseFloat(v(name));
    return Number.isFinite(n) ? n : parseFloat(THEME_DEFAULTS[name] ?? '0');
  };
  const forced = mq('(forced-colors: active)');
  const durSlow = parseMs(v('--lm-dur-slow'));
  const reducedMotion = durSlow < 1 || (mq('(prefers-reduced-motion: reduce)') && !isMotionForced());
  const highContrast = isHighContrast();
  const theme: ChartTheme = {
    dark: true,
    forced,
    reducedMotion,
    face: v('--lm-face'),
    well: v('--lm-well'),
    raised: v('--lm-raised'),
    line: v('--lm-line'),
    lineStrong: v('--lm-line-strong'),
    edge: v('--lm-edge'),
    ink: v('--lm-ink'),
    ink2: v('--lm-ink-2'),
    ink3: v('--lm-ink-3'),
    inkFaint: v('--lm-ink-faint'),
    grid: v('--lm-chart-grid'),
    axis: v('--lm-chart-axis'),
    crosshair: v('--lm-chart-crosshair'),
    phaseAlt: v('--lm-chart-phase-alt'),
    ring: v('--lm-chart-ring'),
    signal: v('--lm-signal'),
    bandAlpha: num('--lm-chart-band-alpha'),
    areaAlpha: num('--lm-chart-area-alpha'),
    dimAlpha: num('--lm-chart-dim-alpha'),
    gridDot: withAlpha(v('--lm-ink'), num('--lmc-grid-a')),
    areaTop: num('--lmc-area-top'),
    dot: { haloAlpha: num('--lmc-dot-halo-a'), haloSpread: num('--lmc-dot-halo'), glowAlpha: num('--lmc-dot-glow-a'), glowBlur: num('--lmc-dot-glow') },
    glow: !forced && !reducedMotion && !highContrast,
    highContrast,
    cat: {
      body: v('--lm-cat-body'),
      fuel: v('--lm-cat-fuel'),
      energy: v('--lm-cat-energy'),
      cellular: v('--lm-cat-cellular'),
      performance: v('--lm-cat-performance'),
      recovery: v('--lm-cat-recovery'),
      cardio: v('--lm-cat-cardio'),
      hormones: v('--lm-cat-hormones'),
    },
    macro: {
      protein: v('--lm-macro-protein'),
      netCarbs: v('--lm-macro-carbs'),
      fibre: v('--lm-macro-fibre'),
      fat: v('--lm-macro-fat'),
      alcohol: v('--lm-macro-alcohol'),
    },
    plan: { A: v('--lm-plan-a'), B: v('--lm-plan-b'), C: v('--lm-plan-c') },
    keto: [v('--lm-keto-1'), v('--lm-keto-2'), v('--lm-keto-3')],
    deficit: [v('--lm-balance-deficit-1'), v('--lm-balance-deficit-2'), v('--lm-balance-deficit-3'), v('--lm-balance-deficit-4'), v('--lm-balance-deficit-5'), v('--lm-balance-deficit-6')],
    surplus: [v('--lm-balance-surplus-1'), v('--lm-balance-surplus-2'), v('--lm-balance-surplus-3'), v('--lm-balance-surplus-4')],
    energyFast: v('--lm-balance-fast'),
    energyNeutral: v('--lm-balance-neutral') || v('--lm-well'),
    severity: { info: v('--lm-info-mark'), caution: v('--lm-caution-mark'), danger: v('--lm-danger-mark'), ok: v('--lm-ok-mark') },
    energyRamp: [v('--lmc-energy-ramp-1'), v('--lmc-energy-ramp-2'), v('--lmc-energy-ramp-3'), v('--lmc-energy-ramp-4')],
    decomposition: {
      fat: v('--lmc-decomp-fat'),
      lean: v('--lmc-decomp-lean'),
      glycogen: v('--lmc-decomp-glycogen'),
      water: v('--lmc-decomp-water'),
    },
    fontFamily: v('--lm-font-sans'),
    durSlow: durSlow < 1 ? 0 : durSlow,
  };
  if (forced) applyForcedPalette(theme);
  return theme;
}

function isMotionForced(): boolean {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-motion') === 'full';
}

/** The person (or the system) asked for more contrast: no glow, no halo, system-weight marks. */
function isHighContrast(): boolean {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-contrast');
    if (attr === 'more' || attr === 'high') return true;
  }
  return mq('(prefers-contrast: more)');
}

/** Forced colours (CHART_SPEC §9): system colours for marks; bands switch to hatch in draw code. */
function applyForcedPalette(t: ChartTheme): void {
  const text = 'CanvasText';
  const link = 'LinkText';
  t.face = 'Canvas';
  t.ring = 'Canvas';
  t.ink = text;
  t.ink2 = text;
  t.ink3 = text;
  t.grid = 'GrayText';
  t.gridDot = 'GrayText';
  t.axis = 'GrayText';
  t.crosshair = 'Highlight';
  t.phaseAlt = 'transparent';
  (Object.keys(t.cat) as MetricCategory[]).forEach((k, i) => (t.cat[k] = i % 2 ? link : text));
  (Object.keys(t.macro) as MacroKey[]).forEach((k, i) => (t.macro[k] = i % 2 ? link : text));
  t.plan = { A: text, B: link, C: 'VisitedText' };
}

/* ------------------------------------------------------------- subscription */

type Listener = () => void;
const listeners = new Set<Listener>();
let wired = false;
let raf = 0;

function publishTheme(): void {
  // All React chrome and plot engines must see the same snapshot for this update.
  // Reading once per subscriber multiplied every token read by the number of charts.
  snapshot = null;
  listeners.forEach((l) => l());
}

function notify() {
  if (listeners.size === 0) {
    snapshot = null;
    return;
  }
  if (typeof requestAnimationFrame === 'undefined') {
    publishTheme();
    return;
  }
  cancelAnimationFrame(raf);
  // wait one frame so the new CSS is applied before we read it
  raf = requestAnimationFrame(publishTheme);
}

function wire() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  try {
    new MutationObserver(notify).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-motion', 'data-contrast', 'style'],
    });
  } catch {
    /* no MutationObserver */
  }
  for (const q of ['(forced-colors: active)', '(prefers-reduced-motion: reduce)', '(prefers-contrast: more)']) {
    try {
      window.matchMedia?.(q)?.addEventListener?.('change', notify);
    } catch {
      /* old engines */
    }
  }
  try {
    document.fonts?.addEventListener?.('loadingdone', notify);
    void document.fonts?.ready?.then(notify);
  } catch {
    /* no font loading API */
  }
}

/** Subscribe to theme changes (debounced to one animation frame). */
export function onThemeChange(fn: Listener): () => void {
  wire();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ------------------------------------------------------------------ colour */

/** Colour with alpha, for hex (#rgb / #rrggbb) or any CSS colour (falls back to globalAlpha use). */
export function withAlpha(color: string, alpha: number): string {
  const c = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) {
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  if (/^#[0-9a-f]{3}$/i.test(c)) {
    const r = parseInt(c[1]! + c[1], 16);
    const g = parseInt(c[2]! + c[2], 16);
    const b = parseInt(c[3]! + c[3], 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c);
  if (m) return `rgba(${m[1]},${m[2]},${m[3]},${alpha})`;
  return c; // system colours in forced-colors mode: alpha is not applicable
}

/**
 * Canvas font string: weight, size, family (Geist, the text face). `stretch` is accepted for older callers and ignored:
 * Geist has no width axis. Weights snap to the text set (400/500; canvas text is never light). Canvas text cannot switch on tabular figures; ticks are
 * placed one label at a time, so proportional digits never shift a column.
 */
export function canvasFont(theme: ChartTheme, sizePx: number, opts: { weight?: number; stretch?: 'condensed' | 'normal' | 'wide' } = {}): string {
  const w = opts.weight ?? 400;
  const weight = w >= 500 ? 500 : 400;
  return `${weight} ${sizePx}px ${theme.fontFamily}`;
}

/* ------------------------------------------------------ shared snapshot */

let snapshot: ChartTheme | null = null;
let serverSnapshot: ChartTheme | null = null;

/** Current theme (read once per theme change, shared by every chart). */
export function getThemeSnapshot(): ChartTheme {
  snapshot ??= readChartTheme();
  return snapshot;
}

export function getServerThemeSnapshot(): ChartTheme {
  serverSnapshot ??= readChartTheme(null);
  return serverSnapshot;
}

/** useSyncExternalStore subscription: refreshes the snapshot, then notifies. */
export function subscribeTheme(cb: () => void): () => void {
  return onThemeChange(cb);
}

/** Text colour that reads on a fill (for labels set inside stacked areas). */
export function inkOn(fill: string, theme: ChartTheme): string {
  const m = /^#([0-9a-f]{6})$/i.exec(fill.trim());
  if (!m) return theme.ink;
  const n = parseInt(m[1]!, 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.3 ? '#090909' : theme.ink;
}
