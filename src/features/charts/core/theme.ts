/* ==========================================================================
   ChartTheme — resolves --lm-* tokens ONCE per theme (CHART_SPEC §8.3) and
   exposes plain colour strings to canvas code. Re-read on: data-theme /
   data-motion / class changes on <html>, OS colour-scheme, forced-colors,
   contrast changes, and web-font load. Never read CSS vars per frame.
   ========================================================================== */
import type { MacroKey, MetricCategory, PlanId } from '../types';

export interface ChartTheme {
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
  cat: Record<MetricCategory, string>;
  macro: Record<MacroKey, string>;
  plan: Record<PlanId, string>;
  keto: [string, string, string];
  deficit: [string, string, string, string];
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

/** Light defaults from design/tokens.css — used when a token is missing (tests, early boot). */
const DEFAULTS: Record<string, string> = {
  '--lm-face': '#fbfcfd',
  '--lm-well': '#f1f2f4',
  '--lm-raised': '#ffffff',
  '--lm-line': '#d7d9dc',
  '--lm-line-strong': '#c1c4c8',
  '--lm-edge': '#83868b',
  '--lm-ink': '#191c20',
  '--lm-ink-2': '#4a4e53',
  '--lm-ink-3': '#5f6368',
  '--lm-ink-faint': '#a1a5aa',
  '--lm-chart-grid': '#e9ebee',
  '--lm-chart-axis': '#c1c4c8',
  '--lm-chart-crosshair': '#52565b',
  '--lm-chart-phase-alt': 'rgb(25 28 32 / 0.035)',
  '--lm-chart-ring': '#fbfcfd',
  '--lm-signal': '#f5d336',
  '--lm-chart-band-alpha': '0.14',
  '--lm-chart-area-alpha': '0.10',
  '--lm-chart-dim-alpha': '0.28',
  '--lm-cat-body': '#2a6cc9',
  '--lm-cat-fuel': '#d6682f',
  '--lm-cat-energy': '#129d97',
  '--lm-cat-cellular': '#694daf',
  '--lm-cat-performance': '#25873e',
  '--lm-cat-recovery': '#58b0db',
  '--lm-cat-cardio': '#dda734',
  '--lm-cat-hormones': '#ca588c',
  '--lm-macro-protein': '#3a55b1',
  '--lm-macro-carbs': '#dea63d',
  '--lm-macro-fibre': '#727018',
  '--lm-macro-fat': '#e07a98',
  '--lm-macro-alcohol': '#68448d',
  '--lm-plan-a': '#2a6cc9',
  '--lm-plan-b': '#d6682f',
  '--lm-plan-c': '#129d97',
  '--lm-keto-1': '#e69671',
  '--lm-keto-2': '#d26e3e',
  '--lm-keto-3': '#b44c0d',
  '--lm-energy-deficit-1': '#e4f2fe',
  '--lm-energy-deficit-2': '#cde7fe',
  '--lm-energy-deficit-3': '#b4dbfd',
  '--lm-energy-deficit-4': '#9cd1ff',
  '--lm-energy-surplus-1': '#ffeee3',
  '--lm-energy-surplus-2': '#ffdeca',
  '--lm-energy-surplus-3': '#ffcfb1',
  '--lm-energy-surplus-4': '#fdbd97',
  '--lm-energy-fast': '#191c20',
  '--lm-energy-neutral': '#f1f2f4',
  '--lm-info-mark': '#4984bf',
  '--lm-caution-mark': '#ee9e10',
  '--lm-danger-mark': '#d73431',
  '--lm-ok-mark': '#319751',
  '--lmc-energy-ramp-1': '#5dbcb6',
  '--lmc-energy-ramp-2': '#169d97',
  '--lmc-energy-ramp-3': '#00817b',
  '--lmc-energy-ramp-4': '#006460',
  '--lmc-decomp-fat': '#e07a98',
  '--lmc-decomp-lean': '#3a55b1',
  '--lmc-decomp-glycogen': '#dea63d',
  '--lmc-decomp-water': '#58b0db',
  '--lm-font-sans': '"Archivo", "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif',
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

/** Read the theme from computed tokens on `el` (defaults to <html>; respects [data-theme-scope]). */
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
    return got || DEFAULTS[name] || '';
  };
  const num = (name: string) => {
    const n = parseFloat(v(name));
    return Number.isFinite(n) ? n : parseFloat(DEFAULTS[name] ?? '0');
  };
  const forced = mq('(forced-colors: active)');
  const dark = (cs?.getPropertyValue('color-scheme').trim() ?? '') === 'dark' || isDarkDocument();
  const durSlow = parseMs(v('--lm-dur-slow'));
  const theme: ChartTheme = {
    dark,
    forced,
    reducedMotion: durSlow < 1 || mq('(prefers-reduced-motion: reduce)') && !isMotionForced(),
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
    deficit: [v('--lm-energy-deficit-1'), v('--lm-energy-deficit-2'), v('--lm-energy-deficit-3'), v('--lm-energy-deficit-4')],
    surplus: [v('--lm-energy-surplus-1'), v('--lm-energy-surplus-2'), v('--lm-energy-surplus-3'), v('--lm-energy-surplus-4')],
    energyFast: v('--lm-energy-fast'),
    energyNeutral: v('--lm-energy-neutral') || v('--lm-well'),
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

function isDarkDocument(): boolean {
  if (typeof document === 'undefined') return false;
  const t = document.documentElement.getAttribute('data-theme');
  if (t) return t === 'dark';
  return mq('(prefers-color-scheme: dark)');
}

function isMotionForced(): boolean {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-motion') === 'full';
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

function notify() {
  if (typeof requestAnimationFrame === 'undefined') {
    listeners.forEach((l) => l());
    return;
  }
  cancelAnimationFrame(raf);
  // wait one frame so the new CSS is applied before we read it
  raf = requestAnimationFrame(() => listeners.forEach((l) => l()));
}

function wire() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  try {
    new MutationObserver(notify).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-motion', 'data-contrast', 'style'],
    });
  } catch {
    /* no MutationObserver */
  }
  for (const q of ['(prefers-color-scheme: dark)', '(forced-colors: active)', '(prefers-reduced-motion: reduce)', '(prefers-contrast: more)']) {
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

/** Canvas font string: weight, width keyword, size, family. */
export function canvasFont(theme: ChartTheme, sizePx: number, opts: { weight?: number; stretch?: 'condensed' | 'normal' | 'wide' } = {}): string {
  const stretch = opts.stretch === 'condensed' ? 'semi-condensed ' : opts.stretch === 'wide' ? 'semi-expanded ' : '';
  return `${opts.weight ?? 400} ${stretch}${sizePx}px ${theme.fontFamily}`;
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
  return onThemeChange(() => {
    snapshot = readChartTheme();
    cb();
  });
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
  return L > 0.3 ? '#191c20' : '#ffffff';
}
