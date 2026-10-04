/* ==========================================================================
   <DayView> — 24 h day view (CHART_SPEC §7.2): a printed clock dial (24 hour
   ticks, hairline bezel, thin bands for the eating window / fast / sleep,
   training arcs, meal macro-pies, yellow now-hand following the crosshair)
   beside a linear strip 00:00–24:00 (+ 6 h of the next day faded) with lanes
   for glucose, insulin, ketones, glycogen (muscle solid, liver dashed), MPS and
   autophagy over eating / sleep / training bands and meal micro-stacks.
   ========================================================================== */
import { type CSSProperties, memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatEnergy, IconKey, Swatch, type EnergyUnitChoice } from '@/components';
import { KCAL_PER_GRAM, MACRO_ORDER } from '../catalogue';
import type { ChartController } from '../core/controller';
import { dayLaneModel, type DayContext, type DayLine } from '../core/compareModels';
import { useChartController, useElementWidth } from '../core/hooks';
import type { DataArea } from '../core/interaction';
import { stackLayout, type StackLayout } from '../core/layout';
import { PlotCanvas, type PlotApi } from '../core/PlotCanvas';
import { formatClock, formatDay, formatNumber, THIN, unitSuffix } from '../lib/format';
import { trackAt, valueAt } from '../lib/series';
import { interpolateAt } from '../lib/time';
import type { ChartData, ChartSeries, Meal } from '../types';
import { Crosshair, useBodyInteractions } from './StackChrome';
import { TimeAxis, type RowGeometry } from './TimeRows';
import { setData } from '../core/dom';

export interface DayViewProps {
  data: ChartData;
  day: number;
  onDayChange?: (day: number) => void;
  /** Lane metrics (hourly ones). Default: glucose, insulin, ketones, glycogen (+liver), MPS, autophagy. */
  metricIds?: string[];
  controller?: ChartController;
  laneHeight?: number;
  /** Unit of meal energy in the meal ribbon, dial and their labels (Settings › energy; default kcal). */
  energyUnit?: EnergyUnitChoice;
}

/**
 * Default lanes, each with its accepted ids: the chart fixtures use snake_case ids, the engine catalogue camelCase
 * (`bhb`, `muscleGlycogen`, `autophagyIdx`). Matching only the fixture ids left the Simulator's day view with just
 * glucose and MPS — no ketones or glycogen around a fast.
 */
const DEFAULT_IDS: ReadonlyArray<readonly string[]> = [
  ['glucose'],
  ['insulin'],
  ['bhb', 'ketones'],
  ['muscleGlycogen', 'muscle_glycogen'],
  ['mps'],
  ['autophagyIdx', 'autophagy'],
];
const COMPANION: Record<string, string> = {
  muscle_glycogen: 'liver_glycogen',
  glycogen: 'liver_glycogen',
  muscleGlycogen: 'liverGlycogen',
  glycogenTotal: 'liverGlycogen',
};

const mealKcal = (m: Meal) => MACRO_ORDER.reduce((a, k) => a + m.grams[k] * KCAL_PER_GRAM[k], 0);

/**
 * The fast a day "belongs to": on an eating day, the gap its first meal breaks
 * (last meal before → first meal of the day); on a day without meals, the gap
 * that contains it. Hours are NaN when no earlier meal exists.
 */
export function fastOfDay(meals: readonly Meal[], day: number): { hours: number; start: number; end: number } {
  const ts = meals.map((m) => ({ s: m.day + m.startHour / 24, e: m.day + (m.startHour + m.durationMin / 60) / 24 })).sort((a, b) => a.s - b.s);
  const first = ts.findIndex((m) => m.s >= day && m.s < day + 1);
  if (first >= 0) {
    const prev = ts[first - 1];
    const cur = ts[first]!;
    return prev ? { hours: (cur.s - prev.e) * 24, start: prev.e, end: cur.s } : { hours: NaN, start: day, end: cur.s };
  }
  for (let i = 0; i + 1 < ts.length; i++) {
    const a = ts[i]!.e;
    const b = ts[i + 1]!.s;
    if (a <= day + 1 && b >= day) return { hours: (b - a) * 24, start: a, end: b };
  }
  return { hours: NaN, start: day, end: day + 1 };
}

export const DayView = memo(function DayView(p: DayViewProps) {
  const { data, day } = p;
  const days = data.time.days;
  const x0 = Math.min(day, Math.max(0, days - 1.25));
  const controller = useChartController(days, { controller: p.controller, window: [x0, x0 + 1.25], resolution: 'hourly', minSpan: 0.25 });
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(rootRef);
  const wide = (width || 960) >= 760;
  const stripW = wide ? (width || 960) - 264 : width || 960;
  const layout = stackLayout(stripW);

  useEffect(() => {
    controller.dispatch({ type: 'set', x0, x1: x0 + 1.25 }, { animate: false });
  }, [controller, x0]);

  const byId = useMemo(() => new Map(data.series.map((s) => [s.id, s])), [data.series]);
  const lanes = useMemo(
    () =>
      (p.metricIds ?? DEFAULT_IDS.map((ids) => ids.find((id) => byId.get(id)?.hourly) ?? ids[0]!))
        .map((id) => byId.get(id))
        .filter((s): s is ChartSeries => !!s && !!s.hourly)
        .map((s) => {
          const comp = COMPANION[s.id] ? byId.get(COMPANION[s.id]!) : undefined;
          return { s, lines: [{ series: s }, ...(comp?.hourly ? [{ series: comp, dash: [7, 4] as const }] : [])] as DayLine[] };
        }),
    [p.metricIds, byId],
  );
  const ctx: DayContext = useMemo(
    () => ({ day, eating: data.intake?.eatingWindows, sleep: data.intake?.sleep, sessions: data.intake?.exercise }),
    [day, data.intake],
  );
  const area: DataArea = useMemo(() => ({ left: layout.gutter + layout.tickCol, width: layout.plotW }), [layout.gutter, layout.tickCol, layout.plotW]);
  const geom: RowGeometry = useMemo(() => ({ cellW: layout.cellW, area: { left: layout.tickCol, width: layout.plotW }, compact: layout.size === 's' }), [layout]);
  const bodyRef = useRef<HTMLDivElement>(null);
  useBodyInteractions(bodyRef, controller, area, []);

  const meals = useMemo(() => (data.intake?.meals ?? []).filter((m) => m.day >= day - 1 && m.day <= day + 1), [data.intake, day]);
  const style = { '--lmc-gutter': `${layout.gutter}px`, '--lmc-tickcol': `${layout.tickCol}px` } as CSSProperties;
  const title = `${formatDay(data.time, day, 'long')} · day ${day + 1}`;
  return (
    <div ref={rootRef} className="lmc-day" data-wide={wide}>
      <div className="lmc-day__dial">
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
          {p.onDayChange ? <IconKey size="sm" icon={ChevronLeft} label="Previous day" disabled={day <= 0} onClick={() => p.onDayChange?.(day - 1)} /> : null}
          <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', minWidth: 150, textAlign: 'center' }}>{title}</span>
          {p.onDayChange ? <IconKey size="sm" icon={ChevronRight} label="Next day" disabled={day >= days - 1} onClick={() => p.onDayChange?.(day + 1)} /> : null}
        </div>
        <ClockDial data={data} day={day} controller={controller} size={wide ? 228 : 216} energyUnit={p.energyUnit} />
      </div>
      <div className="lmc-stack" data-size={layout.size} style={style}>
        <div ref={bodyRef} className="lmc-body" tabIndex={0} role="group" aria-roledescription="chart" aria-label={`Day view, ${title}, hourly`}>
          <MealRibbon controller={controller} meals={meals} geom={geom} energyUnit={p.energyUnit ?? 'kcal'} />
          {lanes.map((l) => (
            <DayLane key={l.s.id} lines={l.lines} ctx={ctx} layout={layout} controller={controller} height={p.laneHeight ?? (layout.size === 's' ? 52 : 58)} fadeFrom={day + 1} />
          ))}
          <TimeAxis controller={controller} time={data.time} geom={geom} sticky={false} />
          <Crosshair controller={controller} area={area} />
        </div>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------ lanes */

const DayLane = memo(function DayLane({
  lines,
  ctx,
  layout,
  controller,
  height,
  fadeFrom,
}: {
  lines: DayLine[];
  ctx: DayContext;
  layout: StackLayout;
  controller: ChartController;
  height: number;
  fadeFrom: number;
}) {
  const s = lines[0]!.series;
  const valRef = useRef<HTMLSpanElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<PlotApi | null>(null);
  const model = useMemo(() => dayLaneModel(lines, { tickColCss: layout.tickCol, ctx, fadeFrom }), [lines, layout.tickCol, ctx, fadeFrom]);
  const padding = useMemo(() => ({ top: 6, bottom: 6, left: layout.tickCol, right: layout.rightPad }), [layout.tickCol, layout.rightPad]);
  const onApi = useCallback((a: PlotApi | null) => {
    apiRef.current = a;
  }, []);
  useEffect(() => {
    const upd = () => {
      const c = controller.cursor.get();
      const v = controller.view.get();
      const live = c.t != null && c.t >= v.x0 && c.t <= v.x1;
      const t = live ? c.t! : Math.min(v.x1, ctx.day + 1) - 1e-6;
      const cv = valueAt(s, t, 'hourly');
      if (valRef.current) valRef.current.textContent = formatNumber(cv.v, s.format.decimals);
      const dot = dotRef.current;
      const api = apiRef.current;
      if (!dot) return;
      if (!live || !api) {
        setData(dot, 'on', 'false');
        return;
      }
      const tr = trackAt(s, 'hourly');
      const y = interpolateAt(tr.values, 'hourly', t);
      dot.style.transform = `translate(${api.cssX(t).toFixed(1)}px, ${api.cssY(y).toFixed(1)}px)`;
      setData(dot, 'on', 'true');
    };
    upd();
    const a = controller.cursor.subscribe(upd);
    const b = controller.view.subscribe(() => queueMicrotask(upd));
    return () => {
      a();
      b();
    };
  }, [controller, s, ctx.day]);
  const unit = unitSuffix(s.unit);
  const name = lines.length > 1 ? `${s.label.replace(/ \(.*\)/, '')}` : s.label;
  return (
    <div className="lmc-row lmc-lane" data-mode="lane" data-lane={s.id}>
      <div className="lmc-gut" data-no-crosshair="">
        <span className="lmc-gut__name" style={{ cursor: 'default' }}>
          <Swatch category={s.category} />
          <span className="lmc-t">{name}</span>
        </span>
        {lines.length > 1 && layout.size !== 's' ? (
          <span className="lmc-gut__meta">
            <Swatch category={s.category} /> muscle
            <Swatch category={s.category} shape="dash" /> liver
          </span>
        ) : null}
        <span className="lmc-gut__val">
          <b>
            <span ref={valRef} />
            {unit ? <span className="lmc-unit">{unit}</span> : null}
          </b>
        </span>
      </div>
      <div className="lmc-cell" role="img" aria-label={`${s.label} over the day, hourly${lines.length > 1 ? `; dashed line: ${lines[1]!.series.label}` : ''}.`}>
        <PlotCanvas model={model} controller={controller} width={layout.cellW} height={height} padding={padding} onApi={onApi}>
          <div ref={dotRef} className="lmc-dot" data-on="false" style={{ background: `var(--lm-cat-${s.category})` }} />
        </PlotCanvas>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------ meal ribbon */

function MealRibbon({ controller, meals, geom, energyUnit }: { controller: ChartController; meals: Meal[]; geom: RowGeometry; energyUnit: EnergyUnitChoice }) {
  const ref = useRef<SVGGElement>(null);
  const H = 30;
  const maxK = Math.max(400, ...meals.map(mealKcal));
  // positions follow the (fixed) day window; re-render on view change is cheap and rare
  const v = controller.view.get();
  const X = (t: number) => geom.area.left + ((t - v.x0) / (v.x1 - v.x0 || 1)) * geom.area.width;
  return (
    <div className="lmc-row lmc-events">
      <div className="lmc-gut lmc-gut--minor">meals</div>
      <div className="lmc-cell">
        <svg className="lmc-svg" width={geom.cellW} height={H} role="img" aria-label={`${meals.length} meals: ${meals.map((m) => `${formatClock(m.startHour)} ${formatEnergy(mealKcal(m), energyUnit)}`).join(', ')}`}>
          <g ref={ref}>
            {meals.map((m, k) => {
              const t = m.day + m.startHour / 24;
              if (t < v.x0 || t > v.x1) return null;
              const x = X(t);
              let y = H - 5;
              const total = mealKcal(m);
              const h = Math.max(6, (total / maxK) * (H - 10));
              return (
                <g key={k}>
                  {MACRO_ORDER.filter((mk) => m.grams[mk] > 0).map((mk) => {
                    const seg = (m.grams[mk] * KCAL_PER_GRAM[mk] * h) / total;
                    y -= seg;
                    return <rect key={mk} x={x - 3} y={y} width={6} height={Math.max(0.5, seg - 1)} fill={`var(--lm-macro-${mk === 'netCarbs' ? 'carbs' : mk})`} />;
                  })}
                  <text className="lmc-ev-t" x={x + 7} y={H - 6}>
                    {formatClock(m.startHour)}
                    {THIN}· {formatEnergy(total, energyUnit, { withUnit: false })}
                  </text>
                  <title>{`meal ${formatClock(m.startHour)}: ${formatEnergy(total, energyUnit)}`}</title>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- clock dial */

const polar = (cx: number, cy: number, r: number, hour: number) => {
  const a = ((hour / 24) * 360 - 90) * (Math.PI / 180);
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
};

function arcPath(cx: number, cy: number, r: number, h0: number, h1: number): string {
  let span = h1 - h0;
  if (span <= 0) span += 24;
  if (span >= 23.99) {
    const [ax, ay] = polar(cx, cy, r, h0);
    const [bx, by] = polar(cx, cy, r, h0 + 12);
    return `M${ax},${ay} A${r},${r} 0 1 1 ${bx},${by} A${r},${r} 0 1 1 ${ax},${ay}`;
  }
  const [ax, ay] = polar(cx, cy, r, h0);
  const [bx, by] = polar(cx, cy, r, h0 + span);
  return `M${ax.toFixed(2)},${ay.toFixed(2)} A${r},${r} 0 ${span > 12 ? 1 : 0} 1 ${bx.toFixed(2)},${by.toFixed(2)}`;
}

export interface ClockDialProps {
  data: ChartData;
  day: number;
  controller?: ChartController;
  size?: number;
  /** Unit of meal energy in the dial's summary (Settings › energy; default kcal). */
  energyUnit?: EnergyUnitChoice;
}

/**
 * Printed 24 h dial (REVIEW_FINDINGS 3): 24 hour ticks, hairline bezel, thin bands —
 * never a thick donut. Text renders at its real size (no viewBox scaling).
 */
export const ClockDial = memo(function ClockDial({ data, day, controller, size = 228, energyUnit = 'kcal' }: ClockDialProps) {
  const handRef = useRef<SVGGElement>(null);
  const c = size / 2;
  const R = c - 12; // bezel
  const intake = data.intake;
  const meals = (intake?.meals ?? []).filter((m) => m.day === day);
  const win = intake?.eatingWindows?.find((w) => w.day === day);
  const sleeps = (intake?.sleep ?? []).filter((w) => w.day === day || w.day === day - 1);
  const sessions = (intake?.exercise ?? []).filter((s) => s.day === day);
  const fast = fastOfDay(intake?.meals ?? [], day);
  const windowH = win ? win.endHour - win.startHour : 0;
  const maxK = Math.max(1, ...meals.map(mealKcal));

  useEffect(() => {
    if (!controller) return;
    const upd = () => {
      const g = handRef.current;
      if (!g) return;
      const cur = controller.cursor.get();
      const t = cur.t != null && Math.floor(cur.t) === day ? cur.t : null;
      g.style.opacity = t == null ? '0' : '1';
      if (t != null) g.setAttribute('transform', `rotate(${((t - day) * 360).toFixed(2)} ${c} ${c})`);
    };
    upd();
    return controller.cursor.subscribe(upd);
  }, [controller, day, c]);

  const main = Number.isFinite(fast.hours) ? `fast ${formatNumber(fast.hours, 0)}${THIN}h` : 'eating day';
  const sub = meals.length
    ? `${24 - Math.round(windowH)}:${Math.round(windowH)} · ${formatClock(win?.startHour ?? 0)}–${formatClock(win?.endHour ?? 0)}`
    : `ends ${formatDay(data.time, Math.floor(fast.end), 'long').split(' ')[0]} ${formatClock((fast.end % 1) * 24)}`;
  const summary = [
    win ? `Eat ${formatClock(win.startHour)} to ${formatClock(win.endHour)}` : 'No meals (water-only fast)',
    meals.length ? `${meals.length} meals: ${meals.map((m) => `${formatClock(m.startHour)} (${formatEnergy(mealKcal(m), energyUnit)})`).join(', ')}` : '',
    sessions.map((s) => `${s.label ?? s.type} ${formatClock(s.startHour)} to ${formatClock(s.startHour + s.durationMin / 60)}`).join('. '),
    Number.isFinite(fast.hours) ? `${meals.length ? 'Overnight fast' : 'Fast'} ${formatNumber(fast.hours, 0)} hours` : '',
  ]
    .filter(Boolean)
    .join('. ');

  const ticks = Array.from({ length: 24 }, (_, h) => h);
  return (
    <figure style={{ margin: 0, display: 'grid', justifyItems: 'center' }}>
      <svg className="lmc-dial" width={size} height={size} role="img" aria-label={summary}>
        {/* bezel + printed ticks */}
        <circle cx={c} cy={c} r={R} fill="var(--lm-face)" stroke="var(--lm-line-strong)" strokeWidth={1} />
        {ticks.map((h) => {
          const major = h % 6 === 0;
          const mid = h % 3 === 0;
          const [ax, ay] = polar(c, c, R, h);
          const [bx, by] = polar(c, c, R - (major ? 9 : mid ? 7 : 4), h);
          return <line key={h} x1={ax} y1={ay} x2={bx} y2={by} stroke={major ? 'var(--lm-ink-2)' : 'var(--lm-ink-3)'} strokeWidth={1} />;
        })}
        {ticks
          .filter((h) => h % 3 === 0)
          .map((h) => {
            const [x, y] = polar(c, c, R - 20, h);
            return (
              <text key={h} className="lmc-dial-num" data-major={h % 6 === 0} x={x} y={y} textAnchor="middle" dominantBaseline="central">
                {String(h).padStart(2, '0')}
              </text>
            );
          })}
        {/* sleep: thin recovery arc */}
        {sleeps.map((w, k) => {
          const s0 = w.day === day ? w.startHour : w.startHour - 24;
          const e0 = w.day === day ? Math.min(24, w.endHour) : w.endHour - 24;
          if (e0 <= 0 || s0 >= 24) return null;
          return <path key={k} d={arcPath(c, c, R - 40, Math.max(0, s0), Math.min(24, e0))} fill="none" stroke="var(--lm-cat-recovery)" strokeOpacity={0.6} strokeWidth={3} strokeLinecap="round" />;
        })}
        {/* fast (hairline) and eating window (thin band) on one track */}
        {win ? (
          <>
            <path d={arcPath(c, c, R - 32, win.endHour, win.startHour)} fill="none" stroke="var(--lm-ink-3)" strokeWidth={1} />
            <path d={arcPath(c, c, R - 32, win.startHour, win.endHour)} fill="none" stroke="var(--lm-ink)" strokeOpacity={0.55} strokeWidth={4} strokeLinecap="round" />
          </>
        ) : (
          <circle cx={c} cy={c} r={R - 32} fill="none" stroke="var(--lm-ink-3)" strokeWidth={1} />
        )}
        {/* training: 3 px arcs just outside the bezel */}
        {sessions.map((s, k) => (
          <path
            key={k}
            d={arcPath(c, c, R + 5, s.startHour, s.startHour + Math.max(0.25, s.durationMin / 60))}
            fill="none"
            stroke="var(--lm-cat-performance)"
            strokeWidth={3}
            strokeLinecap="round"
            strokeOpacity={s.type === 'walk' ? 0.55 : 1}
          />
        ))}
        {/* meals: macro pies on the window track, size ∝ kcal */}
        {meals.map((m, k) => {
          const [x, y] = polar(c, c, R - 32, m.startHour);
          const r = 4 + 3.5 * (mealKcal(m) / maxK);
          const tot = mealKcal(m);
          let a0 = -Math.PI / 2;
          return (
            <g key={k}>
              <circle cx={x} cy={y} r={r + 1.5} fill="var(--lm-face)" />
              {MACRO_ORDER.filter((mk) => m.grams[mk] > 0).map((mk) => {
                const frac = (m.grams[mk] * KCAL_PER_GRAM[mk]) / tot;
                const a1 = a0 + frac * Math.PI * 2;
                const d =
                  frac > 0.999
                    ? `M${x + r},${y} A${r},${r} 0 1 1 ${x - r},${y} A${r},${r} 0 1 1 ${x + r},${y}`
                    : `M${x},${y} L${x + r * Math.cos(a0)},${y + r * Math.sin(a0)} A${r},${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${x + r * Math.cos(a1)},${y + r * Math.sin(a1)} Z`;
                a0 = a1;
                return <path key={mk} d={d} fill={`var(--lm-macro-${mk === 'netCarbs' ? 'carbs' : mk})`} />;
              })}
            </g>
          );
        })}
        {/* now-hand follows the crosshair (under the readout text) */}
        <g ref={handRef} style={{ opacity: 0 }}>
          <line x1={c} y1={c + 10} x2={c} y2={c - R + 6} stroke="var(--lm-signal)" strokeWidth={1.5} strokeLinecap="round" />
          <circle cx={c} cy={c} r={3} fill="var(--lm-signal)" stroke="var(--lm-signal-edge)" strokeWidth={1} />
        </g>
        {/* centre readout clears the 18 / 06 numerals */}
        <text className="lmc-dial-read" x={c} y={c - 6} textAnchor="middle" paintOrder="stroke" stroke="var(--lm-face)" strokeWidth={4} strokeLinejoin="round">
          {main}
        </text>
        <text className="lmc-dial-sub" x={c} y={c + 13} textAnchor="middle" paintOrder="stroke" stroke="var(--lm-face)" strokeWidth={4} strokeLinejoin="round">
          {sub}
        </text>
      </svg>
      <figcaption className="lmc-day__summary">{summary}.</figcaption>
    </figure>
  );
});
