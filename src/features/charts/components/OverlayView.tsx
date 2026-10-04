/* ==========================================================================
   <OverlayView> (CHART_SPEC §2.1, §5.3): ≤ 6 metrics indexed to their start
   on ONE axis ("change from start, % or index points"), 7-day centred mean
   when the window spans > 21 days, composite identity (hue + dash + marker),
   legend chips (isolate / hide), direct end labels with leader lines.
   ========================================================================== */
import { type CSSProperties, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMediaQuery } from '@/components';
import { encodingsFor, OVERLAY_MAX, overlayTransformOf } from '../catalogue';
import type { ChartController, ViewState } from '../core/controller';
import { useElementWidth, useStore } from '../core/hooks';
import type { DataArea } from '../core/interaction';
import { stackLayout } from '../core/layout';
import { overlayGrid, overlayModel, type OverlayResolved } from '../core/models';
import { PlotCanvas, type PlotApi } from '../core/PlotCanvas';
import { formatSigned, THIN } from '../lib/format';
import { relaxLabels } from '../lib/labels';
import { isOverlayEligible } from '../lib/picker';
import { createStore } from '../lib/store';
import { indexAt, visibleIndexRange } from '../lib/time';
import { overlaySmoothing, overlayTrack } from '../lib/transforms';
import type { ChartData, ChartSeries, Resolution } from '../types';
import { seriesReadoutRow, type ChartStatus } from './LaneStack';
import { LegendChip } from './LegendChip';
import { CrosshairReadout, LiveReadout } from './Readout';
import { Crosshair, Sweep, useBodyInteractions } from './StackChrome';
import { EventRibbon, eventTime, PhaseRuler, TimeAxis, type RowGeometry } from './TimeRows';
import { setData } from '../core/dom';

export interface OverlayViewProps {
  data: ChartData;
  controller: ChartController;
  /** Up to 6 metric ids; ineligible ones (ketones, states) are listed as excluded. */
  metricIds: readonly string[];
  status?: ChartStatus;
  sweepKey?: string | number;
  onCommand?: (cmd: 'table' | 'focus' | 'escape') => boolean | void;
  readout?: 'auto' | 'float' | 'dock';
}

export const OverlayView = memo(function OverlayView(p: OverlayViewProps) {
  const { data, controller } = p;
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const leadersRef = useRef<SVGSVGElement>(null);
  const apiRef = useRef<PlotApi | null>(null);
  const dotRefs = useRef(new Map<string, HTMLDivElement>());
  const width = useElementWidth(rootRef);
  const layout = stackLayout(width || 960);
  const coarse = useMediaQuery('(pointer: coarse)');
  const readoutMode = p.readout === 'float' || p.readout === 'dock' ? p.readout : layout.size === 's' || coarse ? 'dock' : 'float';
  const [isolate, setIsolate] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const view = useStore(controller.view);
  const smooth = overlaySmoothing(view.x1 - view.x0);

  const byId = useMemo(() => new Map(data.series.map((s) => [s.id, s])), [data.series]);
  const requested = useMemo(() => p.metricIds.map((id) => byId.get(id)).filter((s): s is ChartSeries => !!s), [p.metricIds, byId]);
  const series = useMemo(() => requested.filter(isOverlayEligible).slice(0, OVERLAY_MAX), [requested]);
  const excluded = useMemo(() => requested.filter((s) => !isOverlayEligible(s)), [requested]);
  const enc = useMemo(() => encodingsFor(series), [series]);
  const shown = useMemo(() => series.filter((s) => !hidden.has(s.id)), [series, hidden]);

  const plotW = layout.cellW - layout.tickCol - layout.rightPad - layout.labelCol;
  const geom: RowGeometry = useMemo(
    () => ({ cellW: layout.cellW, area: { left: layout.tickCol, width: plotW }, compact: layout.size === 's' }),
    [layout.cellW, layout.tickCol, plotW, layout.size],
  );
  const area: DataArea = useMemo(() => ({ left: layout.gutter + layout.tickCol, width: plotW }), [layout.gutter, layout.tickCol, plotW]);
  const eventTimes = useMemo(() => (data.events ?? []).map(eventTime).sort((a, b) => a - b), [data.events]);
  useBodyInteractions(bodyRef, controller, area, eventTimes, p.onCommand);

  // one x grid for every series, cached per (resolution, smoothing)
  const gridFor = useMemo(() => {
    const cache = new Map<string, OverlayResolved>();
    return (v: ViewState): OverlayResolved => {
      const sm = overlaySmoothing(v.x1 - v.x0);
      const key = `${v.res}|${sm}`;
      let g = cache.get(key);
      if (!g) {
        g = overlayGrid(series, v.res, sm, data.time.days, (s, res, smo) => overlayTrack(s, res, smo));
        cache.set(key, g);
      }
      return g;
    };
  }, [series, data.time.days]);

  const safety = useMemo(() => (data.events ?? []).filter((e) => e.severity && e.severity !== 'info'), [data.events]);
  const model = useMemo(
    () => overlayModel(series, gridFor, { tickColCss: layout.tickCol, phases: data.phases, events: safety, state: { isolate, hidden }, smooth }),
    [series, gridFor, layout.tickCol, data.phases, safety, isolate, hidden, smooth],
  );
  const H = layout.size === 's' ? 300 : 360;
  const padding = useMemo(() => ({ top: 12, bottom: 12, left: layout.tickCol, right: layout.rightPad + layout.labelCol }), [layout.tickCol, layout.rightPad, layout.labelCol]);
  const [apiReady, setApiReady] = useState(0);
  const onApi = useCallback((api: PlotApi | null) => {
    apiRef.current = api;
    if (api) setApiReady((n) => n + 1);
  }, []);

  // direct end labels + leader lines (imperative: follow zoom frames)
  useEffect(() => {
    const draw = () => {
      const api = apiRef.current;
      const box = labelsRef.current;
      const lead = leadersRef.current;
      if (!api || !box || !lead) return;
      const v = controller.view.get();
      const g = gridFor(v);
      const [, i1] = visibleIndexRange(v.x0, v.x1, v.res, g.x.length, 0);
      const ex = api.cssX(g.x[i1]!);
      const items = shown.map((s) => ({ id: s.id, y: api.cssY(g.values[series.indexOf(s)]![i1]!) }));
      const b = api.box();
      const placed = relaxLabels(items, 15, b.top + 6, b.top + b.height - 6);
      let d = '';
      for (const s of shown) {
        const el = box.querySelector<HTMLElement>(`[data-id="${CSS.escape(s.id)}"]`);
        if (!el) continue;
        const y0 = items.find((i) => i.id === s.id)!.y;
        const ly = placed.get(s.id) ?? y0;
        el.style.transform = `translateY(${(ly - 7).toFixed(1)}px)`;
        const val = g.values[series.indexOf(s)]![i1]!;
        const b0 = el.querySelector('b');
        if (b0) b0.firstChild!.textContent = Number.isFinite(val) ? `${formatSigned(val, 1)}${THIN}` : '—';
        if (Math.abs(ly - y0) > 1.5) d += `M${(ex + 6).toFixed(1)},${y0.toFixed(1)} L${(ex + 12).toFixed(1)},${ly.toFixed(1)} `;
      }
      lead.querySelector('path')?.setAttribute('d', d);
    };
    const id = requestAnimationFrame(draw);
    const u = controller.view.subscribe(() => queueMicrotask(draw));
    return () => {
      cancelAnimationFrame(id);
      u();
    };
  }, [controller, gridFor, shown, series, model, apiReady]);

  // crosshair dots
  useEffect(() => {
    const upd = () => {
      const api = apiRef.current;
      const c = controller.cursor.get();
      const v = controller.view.get();
      const on = api && c.t != null && c.t >= v.x0 && c.t <= v.x1;
      const g = gridFor(v);
      for (const s of series) {
        const el = dotRefs.current.get(s.id);
        if (!el) continue;
        if (!on || hidden.has(s.id)) {
          setData(el, 'on', 'false');
          continue;
        }
        const i = indexAt(c.t!, v.res, g.x.length);
        const val = g.values[series.indexOf(s)]![i]!;
        if (!Number.isFinite(val)) {
          setData(el, 'on', 'false');
          continue;
        }
        el.style.transform = `translate(${api!.cssX(g.x[i]!).toFixed(1)}px, ${api!.cssY(val).toFixed(1)}px)`;
        setData(el, 'on', 'true');
      }
    };
    upd();
    const a = controller.cursor.subscribe(upd);
    const b = controller.view.subscribe(() => queueMicrotask(upd));
    return () => {
      a();
      b();
    };
  }, [controller, gridFor, series, hidden, apiReady]);

  const rows = useMemo(
    () =>
      series.map((s) =>
        seriesReadoutRow(s, {
          indexed: (t: number, res: Resolution) => {
            const tr = overlayTrack(s, res, overlaySmoothing(controller.view.get().x1 - controller.view.get().x0));
            if (!tr) return NaN;
            return tr.values[indexAt(t, tr.res, tr.values.length)] ?? NaN;
          },
          suffix: overlayTransformOf(s) === 'pct' ? `${THIN}%` : `${THIN}pts`,
        }),
      ),
    [series, controller],
  );
  const [visible] = useState(() => createStore<ReadonlySet<string>>(new Set(series.map((s) => s.id))));

  const toggleHide = (id: string) =>
    setHidden((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const style = { '--lmc-gutter': `${layout.gutter}px`, '--lmc-tickcol': `${layout.tickCol}px` } as CSSProperties;
  const ketosis = data.states?.find((s) => s.id === 'ketosis') ?? data.states?.[0];
  const note = [
    smooth ? '7-day average.' : 'Daily values.',
    ...excluded.map((s) => s.overlayNote ?? `${s.label} stays in lanes.`),
  ].join(' ');
  return (
    <div ref={rootRef} className="lmc-stack" data-size={layout.size} style={style}>
      <div className="lmc-legend" role="group" aria-label="Overlay series (click to isolate, Alt-click to hide)">
        {series.map((s) => {
          const e = enc.get(s.id)!;
          return (
            <LegendChip
              key={s.id}
              label={s.label}
              color={`var(--lm-cat-${s.category})`}
              dash={e.dash}
              marker={e.marker}
              note={overlayTransformOf(s) === 'pct' ? '%' : 'pts'}
              isolated={isolate === s.id}
              hidden={hidden.has(s.id)}
              onIsolate={() => setIsolate((cur) => (cur === s.id ? null : s.id))}
              onHide={() => toggleHide(s.id)}
            />
          );
        })}
      </div>
      {readoutMode === 'dock' ? (
        <CrosshairReadout controller={controller} time={data.time} phases={data.phases} events={data.events} rows={rows} mode="dock" area={() => area} bodyWidth={layout.width} hint="to compare every line on one day." />
      ) : null}
      <div
        ref={bodyRef}
        className="lmc-body"
        tabIndex={0}
        role="group"
        aria-roledescription="chart"
        aria-label={`Overlay: change from start for ${series.length} metrics`}
        data-running={p.status === 'running' || undefined}
        data-stale={p.status === 'stale' || undefined}
      >
        <PhaseRuler controller={controller} time={data.time} phases={data.phases} geom={geom} />
        <EventRibbon controller={controller} time={data.time} events={data.events} state={ketosis} geom={geom} />
        <div className="lmc-row lmc-lane" data-mode="lane">
          <div className="lmc-gut lmc-overlay-gut" data-no-crosshair="">
            <span className="lmc-gut__name">
              <span className="lmc-t">Change from start</span>
            </span>
            <span className="lmc-gut__meta">% or index points</span>
            {layout.size !== 's' ? <p>{note}</p> : null}
          </div>
          <div
            className="lmc-cell"
            role="img"
            aria-label={`Change from start, percent for amounts and index points for 0–100 indices, ${smooth ? '7-day average' : 'daily'}. ${series
              .map((s) => {
                const g = gridFor(controller.view.get());
                const v = g.values[series.indexOf(s)]!;
                return `${s.label} ends at ${formatSigned(v[v.length - 1]!, 1).replace('−', 'minus ')} ${overlayTransformOf(s) === 'pct' ? 'percent' : 'points'}`;
              })
              .join('; ')}.`}
          >
            <PlotCanvas model={model} controller={controller} width={layout.cellW} height={H} padding={padding} onApi={onApi}>
              {series.map((s) => (
                <div
                  key={s.id}
                  ref={(el) => {
                    if (el) dotRefs.current.set(s.id, el);
                    else dotRefs.current.delete(s.id);
                  }}
                  className="lmc-dot"
                  data-on="false"
                  data-shape={enc.get(s.id)!.marker}
                  style={{ background: `var(--lm-cat-${s.category})` }}
                />
              ))}
              <svg ref={leadersRef} className="lmc-leaders" width={layout.cellW} height={H} aria-hidden="true">
                <path d="" />
              </svg>
              <div ref={labelsRef} className="lmc-endlabels" style={{ left: layout.cellW - layout.labelCol - layout.rightPad, width: layout.labelCol }} aria-hidden="true">
                {shown.map((s) => (
                  <div key={s.id} className="lmc-endlabel" data-id={s.id} style={{ opacity: isolate && isolate !== s.id ? 0.45 : 1 }}>
                    <b>
                      {'—'}
                      <small>{overlayTransformOf(s) === 'pct' ? '%' : 'pts'}</small>
                    </b>
                    <span>{layout.size === 's' ? (s.shortLabel ?? s.label.toLowerCase()) : s.label.toLowerCase()}</span>
                  </div>
                ))}
              </div>
            </PlotCanvas>
          </div>
          {layout.size === 's' ? <p className="lmc-mech">{note}</p> : null}
        </div>
        <TimeAxis controller={controller} time={data.time} geom={geom} />
        <Crosshair controller={controller} area={area} />
        <Sweep controller={controller} area={area} sweepKey={p.sweepKey} />
        {readoutMode === 'float' ? (
          <CrosshairReadout controller={controller} time={data.time} phases={data.phases} events={data.events} rows={rows} mode="float" area={() => area} bodyWidth={layout.width} />
        ) : null}
      </div>
      <LiveReadout controller={controller} time={data.time} rows={rows} visible={visible} />
    </div>
  );
});
