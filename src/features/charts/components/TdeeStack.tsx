/* ==========================================================================
   <TdeeStack> — where the energy goes (CHART_SPEC §7.3): BMR, TEF, NEAT and
   exercise as stacked areas in 4 steps of the energy hue (validated ordinal
   ramp), 1 px surface separators, total as a line, "expected without
   adaptation" as a 1 px ink-3 line with the gap labelled "adaptation −182 kcal".
   Legend + direct labels on the right. The same model is the TDEE lane type.
   ========================================================================== */
import { type CSSProperties, memo, useMemo, useRef } from 'react';
import { KeyGlyph } from './LegendChip';
import type { ChartController } from '../core/controller';
import { useChartController, useElementWidth } from '../core/hooks';
import type { DataArea } from '../core/interaction';
import { stackedAreaModel } from '../core/models';
import { PlotCanvas } from '../core/PlotCanvas';
import { formatNumber, formatSigned } from '../lib/format';
import { energyUnitOf } from '../lib/intake';
import { unitWords } from '../lib/summary';
import type { ChartSeries, Phase, TimeBase } from '../types';
import { CrosshairReadout, type ReadoutRow } from './Readout';
import { Crosshair, useBodyInteractions } from './StackChrome';
import { TimeAxis, type RowGeometry } from './TimeRows';

export interface TdeeStackProps {
  /** A `stacked-area` series with `stack.components` (and optionally `stack.counterfactual`). */
  series: ChartSeries;
  time: TimeBase;
  phases?: readonly Phase[];
  controller?: ChartController;
  height?: number;
  textures?: boolean;
  /**
   * Draw the 7-day mean of every layer and line (r068 W2-9): training and fast days make the daily stack a saw-tooth
   * that hides the trend; the crosshair readout still gives each day's own values.
   */
  weeklyMean?: boolean;
}

/** Centred 7-day mean (shorter windows at the ends). */
function mean7(a: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - 3); j <= Math.min(a.length - 1, i + 3); j++) {
      const v = a[j]!;
      if (Number.isFinite(v)) {
        sum += v;
        n++;
      }
    }
    out[i] = n ? sum / n : NaN;
  }
  return out;
}

function weeklySeries(s: ChartSeries): ChartSeries {
  if (!s.stack) return { ...s, daily: { ...s.daily, values: mean7(s.daily.values) } };
  return {
    ...s,
    daily: { ...s.daily, values: mean7(s.daily.values) },
    stack: {
      ...s.stack,
      components: s.stack.components.map((c) => ({ ...c, daily: mean7(c.daily) })),
      ...(s.stack.counterfactual ? { counterfactual: { ...s.stack.counterfactual, daily: mean7(s.stack.counterfactual.daily) } } : {}),
    },
  };
}

const RAMP = ['var(--lmc-energy-ramp-1)', 'var(--lmc-energy-ramp-2)', 'var(--lmc-energy-ramp-3)', 'var(--lmc-energy-ramp-4)'];

export const TdeeStack = memo(function TdeeStack({ series, time, phases, controller: ext, height = 240, textures, weeklyMean = false }: TdeeStackProps) {
  const drawn = useMemo(() => (weeklyMean ? weeklySeries(series) : series), [series, weeklyMean]);
  const controller = useChartController(time.days, { controller: ext });
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(rootRef) || 960;
  const tickCol = width < 500 ? 36 : 44;
  const plotW = width - tickCol - 8;
  const area: DataArea = useMemo(() => ({ left: tickCol, width: plotW }), [tickCol, plotW]);
  const geom: RowGeometry = useMemo(() => ({ cellW: width, area, compact: width < 600 }), [width, area]);
  useBodyInteractions(bodyRef, controller, area, []);
  const model = useMemo(() => stackedAreaModel(drawn, { mode: 'focus', tickColCss: tickCol, phases, textures, labels: width >= 480 }), [drawn, tickCol, phases, textures, width]);
  const padding = useMemo(() => ({ top: 18, bottom: 6, left: tickCol, right: 8 }), [tickCol]);
  const comps = useMemo(() => series.stack?.components ?? [], [series]);
  const cf = series.stack?.counterfactual;
  // the stack arrives converted to the display unit ("kcal/d" or "kJ/d"); readouts print the bare energy unit
  const eu = energyUnitOf(series.unit);
  const rows: ReadoutRow[] = useMemo(() => {
    const at = (a: Float32Array, t: number) => a[Math.max(0, Math.min(a.length - 1, Math.floor(t)))]!;
    const out: ReadoutRow[] = [
      {
        id: 'total',
        short: 'total',
        color: 'var(--lm-ink)',
        value: (t) => ({ value: formatNumber(at(series.daily.values, t), 0), unit: eu, detail: 'total expenditure', spoken: '' }),
      },
    ];
    [...comps].reverse().forEach((c) => {
      const k = comps.indexOf(c);
      out.push({ id: c.id, short: c.label, color: RAMP[Math.min(3, k)]!, shape: 'square', value: (t) => ({ value: formatNumber(at(c.daily, t), 0), unit: eu, detail: c.label, spoken: '' }) });
    });
    if (cf)
      out.push({
        id: 'cf',
        short: 'no adaptation',
        color: 'var(--lm-ink-3)',
        value: (t) => ({
          value: formatNumber(at(cf.daily, t), 0),
          unit: eu,
          detail: `${cf.label} · adaptation ${formatSigned(at(series.daily.values, t) - at(cf.daily, t), 0)}`,
          spoken: '',
        }),
      });
    return out;
  }, [series, comps, cf, eu]);
  const last = series.daily.values.length - 1;
  const summary = `Energy expenditure, stacked: ${comps.map((c) => `${c.label} ${formatNumber(c.daily[last]!, 0)}`).join(', ')} ${unitWords(eu === 'kJ' ? 'kJ/d' : 'kcal/d')} at the end; total ${formatNumber(series.daily.values[last]!, 0)}${cf ? `, ${formatNumber(cf.daily[last]! - series.daily.values[last]!, 0)} below the expectation without adaptation` : ''}.`;
  return (
    <div ref={rootRef} className="lmc-stack lmc-nogutter" data-size={width < 768 ? 's' : 'l'} style={{ '--lmc-gutter': '0px' } as CSSProperties}>
      <div className="lmc-mini-legend" style={{ padding: '10px 12px 6px' }}>
        {comps.map((c, k) => (
          <span key={c.id}>
            <KeyGlyph kind="bar" color={RAMP[Math.min(3, k)]!} />
            {/* the legend names the layer in words; its abbreviation stays on the plot's own label (r068 W2-9) */}
            {weeklyMean ? c.label.replace(/\s*\([A-Z]+\)$/, '') : c.label}
          </span>
        ))}
        <span>
          <KeyGlyph color="var(--lm-ink)" />
          total
        </span>
        {cf ? (
          <span>
            <KeyGlyph color="var(--lm-ink-3)" />
            {cf.label}
          </span>
        ) : null}
      </div>
      <div ref={bodyRef} className="lmc-body" tabIndex={0} role="group" aria-roledescription="chart" aria-label={summary}>
        <div role="img" aria-label={summary}>
          <PlotCanvas model={model} controller={controller} width={width} height={height} padding={padding} />
        </div>
        <TimeAxis controller={controller} time={time} geom={geom} sticky={false} />
        <Crosshair controller={controller} area={area} />
        <CrosshairReadout controller={controller} time={time} phases={phases} rows={rows} mode="float" area={() => area} bodyWidth={width} />
      </div>
    </div>
  );
});
