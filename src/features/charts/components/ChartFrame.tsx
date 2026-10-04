/* ==========================================================================
   <ChartFrame> — the results chart (COMPONENTS §7 ChartFrame, CHART_SPEC §4.1):
   sticky toolbar (view · zoom · pan · pinned · status · slots · table · export),
   the active view (lanes / overlay / focus) sharing one controller so the
   selection, zoom and crosshair persist across views, the table twin and the
   disclaimer line.
   ========================================================================== */
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight, Download, ImageDown, Pin, Table2, X } from 'lucide-react';
import { IconKey, KeyBank, ProgressRule, toast, useControllableState, type EnergyUnitChoice } from '@/components';
import type { ChartController } from '../core/controller';
import { useChartController, useStore } from '../core/hooks';
import { formatDay, formatClock } from '../lib/format';
import { isOverlayEligible } from '../lib/picker';
import { downloadChartPng } from '../lib/pngExport';
import { buildTable, tableToCSV } from '../lib/table';
import { getThemeSnapshot } from '../core/theme';
import { activePreset, isZoomed, presetLabel, ZOOM_PRESETS, type ZoomPreset } from '../lib/zoom';
import { DAY_VIEW_AT_OR_BELOW } from '../catalogue';
import type { ChartData, Resolution } from '../types';
import { DataTable, downloadText } from './DataTable';
import { DayView } from './DayView';
import { FocusView } from './FocusView';
import { LaneStack, type ChartStatus } from './LaneStack';
import { OverlayView } from './OverlayView';

export type ChartView = 'lanes' | 'overlay' | 'focus';

export interface ChartFrameProps {
  data: ChartData;
  /** Lane metric ids (controlled or default). */
  laneIds?: string[];
  defaultLaneIds?: string[];
  onLaneIdsChange?: (ids: string[]) => void;
  /** Overlay metric ids (≤ 6). Defaults to the first eligible lanes. */
  overlayIds?: string[];
  view?: ChartView;
  defaultView?: ChartView;
  onViewChange?: (v: ChartView) => void;
  focusId?: string | null;
  defaultFocusId?: string | null;
  onFocusChange?: (id: string | null) => void;
  status?: ChartStatus;
  /** Toolbar status text while running ("Running · 1.2 s"). */
  statusText?: string;
  /** Change to play the playhead sweep (new result). */
  sweepKey?: string | number;
  textures?: boolean;
  /** Toolbar slots: e.g. the cautions chip and the "Metrics n" key from the picker. */
  toolbarSlot?: ReactNode;
  onExplain?: (id: string) => void;
  controller?: ChartController;
  disclaimer?: ReactNode;
  /** Accessible name of the chart region. */
  title?: string;
  /** Heading of the exported PNG figure (defaults to "Vitals projection") and its second line (e.g. the dates). */
  exportTitle?: string;
  exportSubtitle?: string;
  /** Extra sentence printed before the disclaimer on the exported figure ("Simulation — not a recommendation."). */
  exportNote?: string;
  defaultTableOpen?: boolean;
  /** Focus view resolution: auto or hourly detail. */
  focusResolution?: Resolution | 'auto';
  /** Open the 24 h day view under the chart when zoomed to ≤ 2 days (default true). */
  dayView?: boolean;
  /**
   * Settings › energy unit for the intake / energy-balance lanes, meal readouts and the intake columns of the table
   * and CSV (default kcal). Metric series arrive already converted (`ChartSeries.unit`).
   */
  energyUnit?: EnergyUnitChoice;
  className?: string;
}

const DISCLAIMER = 'Projections for an average person with your inputs. Not medical advice. Individual results differ: see the range on each curve.';

function usePinned(ctl: ChartController): number | null {
  return useSyncExternalStore(
    ctl.cursor.subscribe,
    () => {
      const c = ctl.cursor.get();
      return c.pinned ? c.t : null;
    },
    () => null,
  );
}

export const ChartFrame = memo(function ChartFrame(p: ChartFrameProps) {
  const { data } = p;
  const controller = useChartController(data.time.days, { controller: p.controller });
  const frameRef = useRef<HTMLElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const allIds = useMemo(() => data.series.map((s) => s.id), [data.series]);
  const [laneIds, setLaneIds] = useControllableState<string[]>(p.laneIds, p.defaultLaneIds ?? allIds, p.onLaneIdsChange);
  const [view, setView] = useControllableState<ChartView>(p.view, p.defaultView ?? 'lanes', p.onViewChange);
  const [focusId, setFocusId] = useControllableState<string | null>(p.focusId, p.defaultFocusId ?? null, p.onFocusChange);
  const [tableOpen, setTableOpen] = useState(p.defaultTableOpen ?? false);
  const [focusRes, setFocusRes] = useState<Resolution | 'auto'>(p.focusResolution ?? 'auto');
  const zoom = useStore(controller.zoom);
  const pinned = usePinned(controller);
  const lanes = laneIds ?? allIds;
  const overlayIds = useMemo(() => {
    if (p.overlayIds) return p.overlayIds;
    const byId = new Map(data.series.map((s) => [s.id, s]));
    return lanes.filter((id) => {
      const s = byId.get(id);
      return s && isOverlayEligible(s);
    }).slice(0, 5);
  }, [p.overlayIds, lanes, data.series]);
  const effFocus = focusId ?? lanes[0] ?? null;

  // sticky offsets: toolbar height as a CSS variable (no React state)
  useEffect(() => {
    const tb = toolbarRef.current;
    const fr = frameRef.current;
    if (!tb || !fr || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => fr.style.setProperty('--lmc-toolbar-h', `${tb.offsetHeight}px`));
    ro.observe(tb);
    return () => ro.disconnect();
  }, []);

  const onFocusChange = useCallback(
    (id: string | null) => {
      setFocusId(id);
      setView(id ? 'focus' : 'lanes');
    },
    [setFocusId, setView],
  );
  const onCommand = useCallback(
    (cmd: 'table' | 'focus' | 'escape') => {
      if (cmd === 'table') {
        setTableOpen((o) => !o);
        return true;
      }
      if (cmd === 'focus') {
        setView(view === 'focus' ? 'lanes' : 'focus');
        return true;
      }
      if (view === 'focus') {
        setView('lanes');
        return true;
      }
      if (tableOpen) {
        setTableOpen(false);
        return true;
      }
      return false;
    },
    [view, tableOpen, setView],
  );

  const tableSeries = useMemo(() => {
    const byId = new Map(data.series.map((s) => [s.id, s]));
    const ids = view === 'overlay' ? overlayIds : lanes;
    return ids.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
  }, [data.series, view, overlayIds, lanes]);

  const exportCsv = () => {
    const v = controller.view.get();
    downloadText(tableToCSV(buildTable(data.time, tableSeries, v.x0, v.x1, v.res, data.intake, { energyUnit: p.energyUnit })), 'vitals-projection.csv');
  };

  const exportPng = async () => {
    const v = controller.view.get();
    const disclaimer = `${p.exportNote ? `${p.exportNote} ` : ''}${typeof p.disclaimer === 'string' ? p.disclaimer : DISCLAIMER} Shaded bands: likely range (80 %).`;
    const ok = await downloadChartPng(
      {
        time: data.time,
        series: tableSeries,
        phases: data.phases,
        x0: v.x0,
        x1: v.x1,
        title: p.exportTitle ?? 'Vitals projection',
        subtitle: p.exportSubtitle,
        disclaimer,
        theme: getThemeSnapshot(),
      },
      `${(p.exportTitle ?? 'vitals-projection').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vitals-projection'}.png`,
    );
    if (!ok) toast('This browser could not create the image. Use the CSV export instead.');
  };

  const preset = activePreset(zoom);
  const presets = ZOOM_PRESETS.filter((z) => z === 'all' || z < data.time.days);
  const zoomed = isZoomed(zoom);
  const running = p.status === 'running';

  return (
    <section ref={frameRef} className={p.className ? `lmc-frame ${p.className}` : 'lmc-frame'} aria-label={p.title ?? 'Projection channels'}>
      {running ? (
        <div className="lmc-progress">
          <ProgressRule label={p.statusText ?? 'Running'} />
        </div>
      ) : null}
      <div ref={toolbarRef} className="lmc-toolbar">
        <KeyBank<ChartView>
          size="sm"
          label="Chart view"
          value={view}
          onChange={(v) => setView(v)}
          options={[
            { value: 'lanes', label: 'lanes' },
            { value: 'overlay', label: 'overlay' },
            { value: 'focus', label: 'focus' },
          ]}
        />
        <KeyBank<string>
          size="sm"
          label="Zoom"
          value={preset == null ? undefined : String(preset)}
          onChange={(v) => {
            const pz: ZoomPreset = v === 'all' ? 'all' : (Number(v) as ZoomPreset);
            const c = controller.cursor.get().t;
            controller.dispatch({ type: 'preset', preset: pz, centre: c ?? undefined });
          }}
          options={presets.map((z) => ({ value: String(z), label: presetLabel(z, data.time.days) }))}
        />
        <span className="lmc-toolbar__group lmc-hide-narrow">
          <IconKey size="sm" icon={ChevronLeft} label="Earlier" disabled={!zoomed || zoom.x0 <= 0} onClick={() => controller.dispatch({ type: 'panWindow', dir: -1 })} />
          <IconKey size="sm" icon={ChevronRight} label="Later" disabled={!zoomed || zoom.x1 >= data.time.days} onClick={() => controller.dispatch({ type: 'panWindow', dir: 1 })} />
        </span>
        {view === 'focus' ? (
          <KeyBank<string>
            size="sm"
            label="Focus resolution"
            value={focusRes}
            onChange={(v) => setFocusRes(v as Resolution | 'auto')}
            options={[
              { value: 'auto', label: 'auto' },
              { value: 'hourly', label: 'hourly' },
            ]}
          />
        ) : null}
        <span className="lmc-toolbar__grow" />
        {pinned != null ? (
          <span className="lmc-pinned">
            <Pin size={14} strokeWidth={1.5} aria-hidden="true" />
            pinned · {formatDay(data.time, Math.floor(pinned), 'long')}
            {zoom.x1 - zoom.x0 <= 7 ? ` ${formatClock((pinned % 1) * 24 - 0.5)}` : ''}
            <button type="button" aria-label="Unpin crosshair" onClick={() => controller.setCursor(null, 'program', { force: true })}>
              <X size={14} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </span>
        ) : null}
        {p.statusText ? <span className="lmc-toolbar__status">{p.statusText}</span> : null}
        {p.toolbarSlot}
        <IconKey size="sm" icon={Table2} label={tableOpen ? 'Hide table (T)' : 'Table view (T)'} pressed={tableOpen} onClick={() => setTableOpen((o) => !o)} />
        <span className="lmc-hide-narrow lmc-toolbar__group">
          <IconKey size="sm" icon={Download} label="Export CSV" onClick={exportCsv} />
          <IconKey size="sm" icon={ImageDown} label="Export image (PNG)" disabled={tableSeries.length === 0} onClick={() => void exportPng()} />
        </span>
      </div>
      {view === 'overlay' ? (
        <OverlayView data={data} controller={controller} metricIds={overlayIds} status={p.status} sweepKey={p.sweepKey} onCommand={onCommand} />
      ) : view === 'focus' && effFocus ? (
        <FocusView
          data={data}
          controller={controller}
          laneIds={lanes}
          onLaneIdsChange={setLaneIds}
          focusId={effFocus}
          onFocusChange={onFocusChange}
          resolution={focusRes}
          energyUnit={p.energyUnit}
          textures={p.textures}
          status={p.status}
          sweepKey={p.sweepKey}
          onExplain={p.onExplain}
          onCommand={onCommand}
        />
      ) : (
        <LaneStack
          data={data}
          controller={controller}
          laneIds={lanes}
          onLaneIdsChange={setLaneIds}
          onFocusChange={onFocusChange}
          energyUnit={p.energyUnit}
          textures={p.textures}
          status={p.status}
          sweepKey={p.sweepKey}
          onExplain={p.onExplain}
          onCommand={onCommand}
        />
      )}
      {p.dayView !== false && zoom.x1 - zoom.x0 <= DAY_VIEW_AT_OR_BELOW + 1e-6 && data.intake ? (
        <div className="lmc-dayslot">
          <DayView
            data={data}
            day={Math.min(data.time.days - 1, Math.floor((zoom.x0 + zoom.x1) / 2))}
            energyUnit={p.energyUnit}
            onDayChange={(d) => controller.dispatch({ type: 'preset', preset: 1, centre: d + 0.5 })}
          />
        </div>
      ) : null}
      {tableOpen ? <TableTwin data={data} controller={controller} series={tableSeries} energyUnit={p.energyUnit} onClose={() => setTableOpen(false)} /> : null}
      {p.disclaimer === null ? null : <p className="lmc-disclaimer">{p.disclaimer ?? DISCLAIMER}</p>}
    </section>
  );
});

function TableTwin({
  data,
  controller,
  series,
  energyUnit,
  onClose,
}: {
  data: ChartData;
  controller: ChartController;
  series: ChartData['series'];
  energyUnit?: EnergyUnitChoice;
  onClose: () => void;
}) {
  const v = useStore(controller.view);
  if (v.animating) return null;
  return <DataTable time={data.time} series={series} x0={v.x0} x1={v.x1} res={v.res} intake={data.intake} energyUnit={energyUnit} caption="Visible metrics and time range" onClose={onClose} />;
}
