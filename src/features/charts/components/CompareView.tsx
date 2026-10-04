/* ==========================================================================
   <CompareView> — plan comparison small multiples (CHART_SPEC §7.1): one per
   ranked goal metric (goal order), 2 columns ≥ 768 px / 1 column below, 160 px
   tall, shared horizon, independent y. Plans A/B/C in plan colours with
   half-alpha likely ranges, the target as a 1 px ink line with an engraved
   label, a shared start dot, direct end labels ("A −10.4"), legend chips,
   and one crosshair synced across every multiple.
   ========================================================================== */
import { type CSSProperties, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PLAN_ORDER } from '../catalogue';
import type { ChartController } from '../core/controller';
import { compareModel, type ComparePlan } from '../core/compareModels';
import { useChartController, useElementWidth } from '../core/hooks';
import type { DataArea } from '../core/interaction';
import { PlotCanvas, type PlotApi } from '../core/PlotCanvas';
import { formatNumber, formatSigned, THIN, unitSuffix } from '../lib/format';
import { relaxLabels } from '../lib/labels';
import { baselineOf, valueAt } from '../lib/series';
import { comparisonSummary } from '../lib/summary';
import { visibleIndexRange } from '../lib/time';
import type { ComparisonData, Goal, PlanId } from '../types';
import { LegendChip } from './LegendChip';
import { Crosshair, useBodyInteractions } from './StackChrome';
import { TimeAxis, type RowGeometry } from './TimeRows';
import { setData } from '../core/dom';

export interface CompareViewProps {
  data: ComparisonData;
  /** The selected plan draws at 2.5 px (planner-results §4). */
  selected?: PlanId;
  controller?: ChartController;
  /** Multiple height in px (default 160). */
  height?: number;
  className?: string;
}

interface Multiple {
  key: string;
  metricId: string;
  goal?: Goal;
}

const LABEL_COL = 72;

export const CompareView = memo(function CompareView(p: CompareViewProps) {
  const { data } = p;
  const controller = useChartController(data.time.days, { controller: p.controller });
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(rootRef);
  const cols = (width || 960) >= 768 ? 2 : 1;
  const [isolate, setIsolate] = useState<PlanId | null>(null);
  const multiples: Multiple[] = useMemo(
    () => [
      ...[...data.goals].sort((a, b) => a.rank - b.rank).map((g) => ({ key: `g${g.rank}`, metricId: g.metricId, goal: g })),
      ...(data.contextMetricIds ?? []).map((id) => ({ key: `c-${id}`, metricId: id })),
    ],
    [data.goals, data.contextMetricIds],
  );
  const plans = useMemo(() => PLAN_ORDER.map((id) => data.plans.find((pl) => pl.id === id)).filter((x): x is NonNullable<typeof x> => !!x), [data.plans]);
  const cellW = Math.floor((width || 960) / cols);
  return (
    <div ref={rootRef} className={p.className ? `lmc-stack lmc-nogutter ${p.className}` : 'lmc-stack lmc-nogutter'} data-size={cols === 1 ? 's' : 'l'} style={{ '--lmc-gutter': '0px' } as CSSProperties}>
      <div className="lmc-legend" role="group" aria-label="Plans (click to isolate)">
        {plans.map((pl) => (
          <LegendChip
            key={pl.id}
            label={`${pl.id} · ${pl.name}`}
            color={`var(--lm-plan-${pl.id.toLowerCase()})`}
            isolated={isolate === pl.id}
            onIsolate={() => setIsolate((c) => (c === pl.id ? null : pl.id))}
          />
        ))}
      </div>
      <div className="lmc-compare" style={{ '--lmc-cols': cols } as CSSProperties}>
        {multiples.map((m) => (
          <CompareMultiple
            key={m.key}
            m={m}
            data={data}
            plans={plans}
            controller={controller}
            width={cellW - (cols === 2 ? 1 : 0)}
            height={p.height ?? 160}
            selected={p.selected}
            isolate={isolate}
          />
        ))}
      </div>
    </div>
  );
});

interface MultipleProps {
  m: Multiple;
  data: ComparisonData;
  plans: ComparisonData['plans'];
  controller: ChartController;
  width: number;
  height: number;
  selected?: PlanId;
  isolate: PlanId | null;
}

const CompareMultiple = memo(function CompareMultiple({ m, data, plans, controller, width, height, selected, isolate }: MultipleProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<PlotApi | null>(null);
  const readRef = useRef<HTMLSpanElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const dotRefs = useRef(new Map<PlanId, HTMLDivElement>());
  const tickCol = width < 500 ? 26 : 32;
  const cps: ComparePlan[] = useMemo(
    () => plans.map((pl) => ({ id: pl.id, series: pl.series.find((s) => s.id === m.metricId)! })).filter((x) => !!x.series),
    [plans, m.metricId],
  );
  const s0 = cps[0]?.series;
  const model = useMemo(
    () => (cps.length ? compareModel(cps, { tickColCss: tickCol, selected, target: m.goal?.target, isolate }) : null),
    [cps, tickCol, selected, m.goal?.target, isolate],
  );
  const padding = useMemo(() => ({ top: 10, bottom: 8, left: tickCol, right: 8 + LABEL_COL }), [tickCol]);
  const plotW = width - tickCol - 8 - LABEL_COL;
  const area: DataArea = useMemo(() => ({ left: tickCol, width: plotW }), [tickCol, plotW]);
  const geom: RowGeometry = useMemo(() => ({ cellW: width, area, compact: width < 500 }), [width, area]);
  useBodyInteractions(bodyRef, controller, area, []);
  const [apiReady, setApiReady] = useState(0);
  const onApi = useCallback((api: PlotApi | null) => {
    apiRef.current = api;
    if (api) setApiReady((n) => n + 1);
  }, []);

  // end labels + synced readout + dots
  useEffect(() => {
    if (!s0) return;
    const d = s0.format.decimals;
    const unit = unitSuffix(s0.unit);
    const labels = () => {
      const api = apiRef.current;
      const box = labelsRef.current;
      if (!api || !box) return;
      const v = controller.view.get();
      const [, i1] = visibleIndexRange(v.x0, v.x1, 'daily', s0.daily.values.length, 0);
      const items = cps.map((c) => ({ id: c.id, y: api.cssY(c.series.daily.values[i1]!) }));
      const b = api.box();
      const placed = relaxLabels(items, 15, b.top + 4, b.top + b.height - 4);
      for (const c of cps) {
        const el = box.querySelector<HTMLElement>(`[data-plan="${c.id}"]`);
        if (!el) continue;
        el.style.transform = `translateY(${((placed.get(c.id) ?? 0) - 7).toFixed(1)}px)`;
        const val = el.querySelector('span');
        if (val) val.textContent = formatSigned(c.series.daily.values[i1]! - baselineOf(c.series), d);
      }
    };
    const cursor = () => {
      const api = apiRef.current;
      const c = controller.cursor.get();
      const v = controller.view.get();
      const on = !!api && c.t != null && c.t >= v.x0 && c.t <= v.x1;
      const parts: string[] = [];
      for (const cp of cps) {
        const el = dotRefs.current.get(cp.id);
        const t = on ? c.t! : v.x1 - 1e-6;
        const cv = valueAt(cp.series, t, 'daily');
        parts.push(`${cp.id} ${formatNumber(cv.v, d)}`);
        if (!el) continue;
        if (!on) {
          setData(el, 'on', 'false');
          continue;
        }
        el.style.transform = `translate(${api!.cssX(Math.floor(c.t!) + 0.5).toFixed(1)}px, ${api!.cssY(cv.v).toFixed(1)}px)`;
        setData(el, 'on', 'true');
      }
      if (readRef.current) readRef.current.textContent = `${parts.join(' · ')}${unit ? THIN + unit : ''}`;
    };
    const id = requestAnimationFrame(() => {
      labels();
      cursor();
    });
    const a = controller.view.subscribe(() =>
      queueMicrotask(() => {
        labels();
        cursor();
      }),
    );
    const b = controller.cursor.subscribe(cursor);
    return () => {
      cancelAnimationFrame(id);
      a();
      b();
    };
  }, [controller, cps, s0, model, apiReady]);

  if (!s0 || !model) return null;
  const summary = m.goal ? comparisonSummary(m.goal, plans) : `${s0.label}: ${cps.map((c) => `plan ${c.id} ends at ${formatNumber(c.series.daily.values[c.series.daily.values.length - 1]!, s0.format.decimals)}`).join(', ')}.`;
  return (
    <div className="lmc-multiple">
      <h3>
        {m.goal ? <span className="lmc-rank">{m.goal.rank} ·</span> : null}
        <span>{s0.label}</span>
        <span className="lmc-goal">{m.goal ? `· ${m.goal.text}` : `· ${s0.unit === 'index' ? 'index' : s0.unit}`}</span>
        <span className="lmc-toolbar__grow" />
        <span className="lmc-caption" ref={readRef} style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }} aria-hidden="true" />
      </h3>
      <div ref={bodyRef} className="lmc-body" tabIndex={0} role="group" aria-roledescription="chart" aria-label={summary}>
        <div className="lmc-plotwrap" role="img" aria-label={summary}>
          <PlotCanvas model={model} controller={controller} width={width} height={height} padding={padding} onApi={onApi}>
            {cps.map((c) => (
              <div
                key={c.id}
                ref={(el) => {
                  if (el) dotRefs.current.set(c.id, el);
                  else dotRefs.current.delete(c.id);
                }}
                className="lmc-dot"
                data-on="false"
                style={{ background: `var(--lm-plan-${c.id.toLowerCase()})` }}
              />
            ))}
            <div ref={labelsRef} className="lmc-plan-labels" style={{ width: LABEL_COL }} aria-hidden="true">
              {cps.map((c) => (
                <div key={c.id} className="lmc-plan-label" data-plan={c.id} style={{ opacity: isolate && isolate !== c.id ? 0.45 : 1 }}>
                  <i className="lmc-plan-key" style={{ background: `var(--lm-plan-${c.id.toLowerCase()})` }}>
                    {c.id}
                  </i>{' '}
                  <span />
                </div>
              ))}
            </div>
          </PlotCanvas>
        </div>
        <TimeAxis controller={controller} time={data.time} geom={geom} sticky={false} />
        <Crosshair controller={controller} area={area} />
      </div>
    </div>
  );
});
