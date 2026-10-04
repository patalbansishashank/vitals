/* ==========================================================================
   Time rows shared by every stacked view:
   - PhaseRuler: schedule blocks (truthful labels); when zoomed it becomes the
     overview mini-map with a draggable window frame; drag = brush to zoom
   - EventRibbon: ketosis state band (keto ramp) + event glyphs, inline labels ≤ 4 wk
   - TimeAxis: sticky bottom axis, weeks / days / hours
   ========================================================================== */
import { memo, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { EVENT_PRIORITY } from '../catalogue';
import type { ChartController } from '../core/controller';
import { useStore } from '../core/hooks';
import { attachRuler, type DataArea } from '../core/interaction';
import { formatClock, formatDay } from '../lib/format';
import { fitPhaseLabel, placeEventLabels } from '../lib/labels';
import { isZoomed } from '../lib/zoom';
import { timeTicks } from '../lib/ticks';
import type { ChartEvent, Phase, StateTrack, TimeBase } from '../types';

export interface RowGeometry {
  /** Plot cell width (CSS px). */
  cellW: number;
  /** Data area inside the cell. */
  area: DataArea;
  compact: boolean;
}

const px = (t: number, x0: number, x1: number, a: DataArea) => a.left + ((t - x0) / (x1 - x0 || 1)) * a.width;

/** Canvas-based text measurement for SVG labels (falls back to an estimate). */
let measureCtx: CanvasRenderingContext2D | null | undefined;
export function measureText(text: string, font = '500 11.5px Archivo, Helvetica, Arial, sans-serif'): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement('canvas').getContext('2d');
    } catch {
      measureCtx = null;
    }
  }
  if (!measureCtx || typeof measureCtx.measureText !== 'function') return text.length * 6.2;
  measureCtx.font = font;
  const w = measureCtx.measureText(text).width;
  return w > 0 ? w : text.length * 6.2;
}

function Gutter({ children }: { children?: ReactNode }) {
  return <div className="lmc-gut lmc-gut--minor">{children}</div>;
}

/* ---------------------------------------------------------------- ruler */

export interface PhaseRulerProps {
  controller: ChartController;
  time: TimeBase;
  phases?: readonly Phase[];
  geom: RowGeometry;
}

export const PhaseRuler = memo(function PhaseRuler({ controller, time, phases, geom }: PhaseRulerProps) {
  const view = useStore(controller.view);
  const zoom = useStore(controller.zoom);
  const zoomed = isZoomed(zoom);
  const cellRef = useRef<HTMLDivElement>(null);
  const [brush, setBrush] = useState<[number, number] | null>(null);
  const geomRef = useRef(geom);
  const zoomedRef = useRef(zoomed);
  useEffect(() => {
    geomRef.current = geom;
    zoomedRef.current = zoomed;
  });
  useEffect(() => {
    const el = cellRef.current;
    if (!el) return;
    return attachRuler(el, {
      controller,
      area: () => geomRef.current.area,
      isMinimap: () => zoomedRef.current,
      onBrush: (a, b) => setBrush(b == null ? null : [a, b]),
    });
  }, [controller]);

  const H = 28;
  const { area, cellW } = geom;
  const r0 = zoomed ? 0 : view.x0;
  const r1 = zoomed ? time.days : view.x1;
  const X = (t: number) => px(t, r0, r1, area);
  const ph = phases ?? [];
  return (
    <div className="lmc-row lmc-ruler" data-zoomed={zoomed}>
      <Gutter>{zoomed ? 'overview · drag to pan' : 'schedule blocks'}</Gutter>
      <div className="lmc-cell" ref={cellRef} data-no-crosshair="" title={zoomed ? undefined : 'Drag to zoom to a range · double-click a week'}>
        <svg className="lmc-svg" width={cellW} height={H} aria-hidden="true">
          {ph.map((p, k) => {
            const a = Math.max(p.startDay, r0);
            const b = Math.min(p.endDay, r1);
            if (a >= b) return null;
            const l = X(a);
            const r = X(b);
            const fit = fitPhaseLabel(p, r - l, (s) => measureText(s));
            return (
              <g key={`${p.startDay}-${k}`}>
                {k % 2 === 1 ? <rect className="lmc-phase-alt" x={l} y={0} width={r - l} height={H} /> : null}
                {p.startDay > r0 && k > 0 ? <line className="lmc-phase-b" x1={Math.round(l) + 0.5} x2={Math.round(l) + 0.5} y1={0} y2={H} /> : null}
                {fit.text ? (
                  <text className="lmc-ph" x={l + 6} y={18}>
                    {fit.text}
                  </text>
                ) : null}
                <title>{`${p.label}${p.balance && p.balance !== p.label ? ` · ${p.balance}` : ''} · ${formatDay(time, p.startDay, 'short')} to ${formatDay(time, p.endDay - 1, 'short')}`}</title>
                <rect x={l} y={0} width={Math.max(0, r - l)} height={H} fill="transparent" />
              </g>
            );
          })}
          {zoomed ? (
            <g>
              <rect className="lmc-win-shade" x={area.left} y={0} width={Math.max(0, X(view.x0) - area.left)} height={H} />
              <rect className="lmc-win-shade" x={X(view.x1)} y={0} width={Math.max(0, area.left + area.width - X(view.x1))} height={H} />
              <rect className="lmc-win" x={Math.round(X(view.x0)) + 0.5} y={1.5} width={Math.max(3, X(view.x1) - X(view.x0) - 1)} height={H - 3} rx={2} />
            </g>
          ) : null}
        </svg>
        {brush ? (
          <div className="lmc-brush" style={{ left: Math.min(X(brush[0]), X(brush[1])), width: Math.abs(X(brush[1]) - X(brush[0])) }} />
        ) : null}
      </div>
    </div>
  );
});

/* ---------------------------------------------------------------- events */

export interface EventRibbonProps {
  controller: ChartController;
  time: TimeBase;
  events?: readonly ChartEvent[];
  state?: StateTrack;
  geom: RowGeometry;
  /** Inline labels at spans ≤ this many days (CHART_SPEC §4.5). */
  labelSpan?: number;
}

export const eventTime = (e: ChartEvent): number => e.day + (e.hour != null ? e.hour / 24 : 0.5);

const modeCache = new WeakMap<StateTrack, Uint8Array>();
/** Per-day level held for the most hours (a day-level band must not read "always on" from one hour). */
export function dailyMode(state: StateTrack): Uint8Array {
  if (!state.hourly) return state.daily;
  const hit = modeCache.get(state);
  if (hit) return hit;
  const days = state.daily.length;
  const out = new Uint8Array(days);
  const counts = new Uint16Array(Math.max(1, state.levels.length));
  for (let d = 0; d < days; d++) {
    counts.fill(0);
    for (let h = 0; h < 24; h++) counts[state.hourly[d * 24 + h] ?? 0]!++;
    let best = 0;
    for (let k = 1; k < counts.length; k++) if (counts[k]! > counts[best]!) best = k;
    out[d] = best;
  }
  modeCache.set(state, out);
  return out;
}

function Glyph({ e, x, y }: { e: ChartEvent; x: number; y: number }) {
  const tf = `translate(${x.toFixed(1)} ${y})`;
  let shape: ReactNode;
  switch (e.type) {
    case 'safety':
      shape =
        e.severity === 'danger' ? (
          <path d="M-2.3,-5.5 L2.3,-5.5 L5.5,-2.3 L5.5,2.3 L2.3,5.5 L-2.3,5.5 L-5.5,2.3 L-5.5,-2.3 Z" fill="var(--lm-danger-mark)" />
        ) : (
          <path d="M0,-5.6 L5.8,4.6 L-5.8,4.6 Z" fill="var(--lm-caution-mark)" />
        );
      break;
    case 'ketosis-entered':
      shape = <path d="M0,-5.5 C2.5,-2 4,0 4,1.8 A4,4 0 0 1 -4,1.8 C-4,0 -2.5,-2 0,-5.5 Z" fill="var(--lm-keto-3)" />;
      break;
    case 'ketosis-exited':
      shape = <path d="M0,-4.8 C2.2,-1.8 3.4,0 3.4,1.7 A3.4,3.4 0 0 1 -3.4,1.7 C-3.4,0 -2.2,-1.8 0,-4.8 Z" fill="var(--lm-face)" stroke="var(--lm-keto-3)" strokeWidth={1.5} />;
      break;
    case 'glycogen-low':
      shape = <path d="M-4.5,-3.5 L4.5,-3.5 L0,4.5 Z" fill="var(--lm-face)" stroke="var(--lm-cat-fuel)" strokeWidth={1.5} strokeLinejoin="round" />;
      break;
    case 'fast-start':
      shape = (
        <g>
          <circle r={4.4} fill="var(--lm-face)" stroke="var(--lm-ink)" strokeWidth={1.5} />
          <path d="M0,-4.4 A4.4,4.4 0 0 1 0,4.4 Z" fill="var(--lm-ink)" />
        </g>
      );
      break;
    case 'fast-end':
    case 'refeed':
      shape = <circle r={4.2} fill="var(--lm-face)" stroke="var(--lm-ink)" strokeWidth={1.5} />;
      break;
    case 'diet-break':
      shape = <rect x={-3.8} y={-3.8} width={7.6} height={7.6} rx={1} fill="var(--lm-face)" stroke="var(--lm-ink)" strokeWidth={1.5} />;
      break;
    case 'deload':
      shape = <path d="M0,-5 L5,0 L0,5 L-5,0 Z" fill="var(--lm-face)" stroke="var(--lm-ink)" strokeWidth={1.5} />;
      break;
    default:
      shape = <circle r={3} fill="var(--lm-ink-2)" />;
  }
  return (
    <g className="lmc-ev-g" transform={tf}>
      <circle className="lmc-ev-ring" r={7.5} />
      {shape}
    </g>
  );
}

export const EventRibbon = memo(function EventRibbon({ controller, time, events, state, geom, labelSpan = 28 }: EventRibbonProps) {
  const view = useStore(controller.view);
  const clipId = `lmc-ev-${useId().replace(/:/g, '')}`;
  const { area, cellW } = geom;
  const withLabels = view.x1 - view.x0 <= labelSpan;
  const H = withLabels ? 38 : 24;
  const X = (t: number) => px(t, view.x0, view.x1, area);
  const span = view.x1 - view.x0;

  const runs = useMemo(() => {
    if (!state) return [] as Array<{ a: number; b: number; level: number }>;
    const hourly = view.res !== 'daily' && state.hourly;
    const arr = hourly ? state.hourly! : dailyMode(state);
    const bucket = hourly ? 1 / 24 : 1;
    const i0 = Math.max(0, Math.floor(view.x0 / bucket) - 1);
    const i1 = Math.min(arr.length - 1, Math.ceil(view.x1 / bucket) + 1);
    const out: Array<{ a: number; b: number; level: number }> = [];
    for (let i = i0; i <= i1; i++) {
      const lv = arr[i]!;
      const last = out[out.length - 1];
      if (last && last.level === lv && Math.abs(last.b - i * bucket) < 1e-9) last.b = (i + 1) * bucket;
      else out.push({ a: i * bucket, b: (i + 1) * bucket, level: lv });
    }
    return out.filter((r) => r.level > 0);
  }, [state, view.res, view.x0, view.x1]);

  // glyph thinning: highest priority first, min 11 px apart
  const shown = useMemo(() => {
    // beyond 4 weeks the ketosis band already says when ketosis starts and ends
    const wide = view.x1 - view.x0 > labelSpan;
    const quiet = new Set(['ketosis-entered', 'ketosis-exited', 'glycogen-low', 'training', 'note', 'fast-end']);
    const vis = (events ?? []).filter((e) => {
      const t = eventTime(e);
      return t >= view.x0 && t <= view.x1 && !(wide && quiet.has(e.type));
    });
    const sorted = [...vis].sort((a, b) => EVENT_PRIORITY[b.type] - EVENT_PRIORITY[a.type]);
    const placed: Array<{ e: ChartEvent; x: number }> = [];
    for (const e of sorted) {
      const x = area.left + ((eventTime(e) - view.x0) / (view.x1 - view.x0 || 1)) * area.width;
      if (placed.some((p) => Math.abs(p.x - x) < 11)) continue;
      placed.push({ e, x });
    }
    return placed.sort((a, b) => a.x - b.x);
  }, [events, view.x0, view.x1, area.left, area.width, labelSpan]);

  // labels sit on their own line under the band: they only have to avoid each other
  const labels = useMemo(() => {
    if (span > labelSpan) return new Map<string, { left: number; text: string }>();
    const items = shown.map((s, k) => ({ id: String(k), x: s.x, text: s.e.label, priority: EVENT_PRIORITY[s.e.type] }));
    const placed = placeEventLabels(items, area.left + area.width, (t) => measureText(t, '400 semi-condensed 11px Archivo, Helvetica, Arial, sans-serif'), {
      glyphGap: -4,
      pad: 10,
      avoidGlyphs: false,
    });
    return new Map(placed.map((p) => [p.id, { left: p.left, text: p.text }]));
  }, [shown, span, labelSpan, area.left, area.width]);

  const keto = ['var(--lm-keto-1)', 'var(--lm-keto-2)', 'var(--lm-keto-3)'];
  return (
    <div className="lmc-row lmc-events">
      <Gutter>{state ? `${state.label.toLowerCase()} · events` : 'events'}</Gutter>
      <div className="lmc-cell">
        <svg className="lmc-svg" width={cellW} height={H} role="img" aria-label={`${shown.length} events in view${state ? `; ${state.label.toLowerCase()} shown as a band` : ''}`}>
          <defs>
            <clipPath id={clipId}>
              <rect x={area.left} y={0} width={area.width} height={H} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`}>
            {runs.map((r, k) => (
              <rect key={k} x={X(r.a)} y={8} width={Math.max(0.6, X(r.b) - X(r.a))} height={8} fill={keto[Math.min(2, r.level - 1)]}>
                <title>{`${state?.levels[r.level] ?? ''} ${state?.label.toLowerCase() ?? ''}`}</title>
              </rect>
            ))}
          </g>
          {shown.map((s, k) => {
            const lbl = labels.get(String(k));
            const t = eventTime(s.e);
            const when = `${formatDay(time, s.e.day, 'long')}${s.e.hour != null ? ' ' + formatClock(s.e.hour) : ''}`;
            return (
              <g key={`${s.e.type}-${t}`}>
                <Glyph e={s.e} x={s.x} y={12} />
                {lbl ? (
                  <>
                    <line x1={s.x} x2={s.x} y1={20} y2={24} stroke="var(--lm-line-strong)" />
                    <text className="lmc-ev-t" x={lbl.left} y={33}>
                      {lbl.text}
                    </text>
                  </>
                ) : null}
                <title>{`${s.e.label} · ${when}`}</title>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ axis */

export interface TimeAxisProps {
  controller: ChartController;
  time: TimeBase;
  geom: RowGeometry;
  sticky?: boolean;
}

export const TimeAxis = memo(function TimeAxis({ controller, time, geom, sticky = true }: TimeAxisProps) {
  const view = useStore(controller.view);
  const { area, cellW } = geom;
  const H = 26;
  const ticks = timeTicks(time, view.x0, view.x1, area.width, { compact: geom.compact });
  const right = area.left + area.width + 6;
  const items: Array<{ t: number; x: number; lx: number; label: string; anchor: 'start' | 'middle'; major: boolean; show: boolean }> = [];
  let lastRight = -Infinity;
  for (const tk of ticks) {
    const x = Math.round(px(tk.t, view.x0, view.x1, area)) + 0.5;
    if (x < area.left - 1 || x > area.left + area.width + 1) continue;
    const w = measureText(tk.label, '400 semi-condensed 11px Archivo, Helvetica, Arial, sans-serif');
    const lx = tk.anchor === 'start' ? x + 4 : x;
    const l = tk.anchor === 'start' ? lx : x - w / 2;
    const inside = tk.anchor === 'start' ? lx + w <= right : x - w / 2 >= area.left - 4 && x + w / 2 <= right;
    const show = inside && l >= lastRight + 8;
    if (show) lastRight = l + w;
    items.push({ t: tk.t, x, lx, label: tk.label, anchor: tk.anchor, major: tk.major, show });
  }
  return (
    <div className={sticky ? 'lmc-row lmc-axis' : 'lmc-row lmc-axis lmc-axis--static'} aria-hidden="true">
      <Gutter />
      <div className="lmc-cell">
        <svg className="lmc-svg" width={cellW} height={H}>
          {items.map((it) => (
            <g key={`${it.t}`}>
              <line className="lmc-tick" data-major={it.major} x1={it.x} x2={it.x} y1={0} y2={it.major ? 6 : 4} />
              {it.show ? (
                <text className="lmc-tick-t" x={it.lx} y={17} textAnchor={it.anchor}>
                  {it.label}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
});
