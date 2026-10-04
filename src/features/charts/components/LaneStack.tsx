/* ==========================================================================
   <LaneStack> — the channel stack (CHART_SPEC §4): one metric per lane in its
   own units on a shared time axis, one crosshair, readout, phase bands, event
   ribbon, intake + energy lanes, reorder/hide, focus mode, sticky axis.
   ========================================================================== */
import { type CSSProperties, memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { energyUnitSpoken, formatEnergy, Swatch, useMediaQuery, type EnergyUnitChoice } from '@/components';
import { CATEGORY_LABEL, groupByCategory, laneKindOf, MACRO_LETTER } from '../catalogue';
import type { ChartController } from '../core/controller';
import { useElementWidth } from '../core/hooks';
import type { DataArea } from '../core/interaction';
import type { InputsMode } from '../core/inputModels';
import { stackLayout, type StackLayout } from '../core/layout';
import { formatNumber, formatRange, formatSigned, THIN, unitSuffix } from '../lib/format';
import { energyBalance, intakeKcal } from '../lib/intake';
import { createStore } from '../lib/store';
import { unitWords } from '../lib/summary';
import { valueAt } from '../lib/series';
import type { ChartData, ChartSeries, Resolution } from '../types';
import { EnergyRow, InputsRow, LaneRow } from './LaneRow';
import { CrosshairReadout, LiveReadout, type ReadoutRow } from './Readout';
import { Crosshair, Sweep, useBodyInteractions } from './StackChrome';
import { EventRibbon, eventTime, PhaseRuler, TimeAxis, type RowGeometry } from './TimeRows';

export type ChartStatus = 'idle' | 'running' | 'stale';

export interface LaneStackProps {
  data: ChartData;
  controller: ChartController;
  /** Lanes to show; grouped by category in palette order, this order within a category. */
  laneIds: readonly string[];
  onLaneIdsChange?: (ids: string[]) => void;
  /** When set, the stack is in focus mode: this lane grows, the rest collapse to strips. */
  focusId?: string | null;
  onFocusChange?: (id: string | null) => void;
  showInputs?: boolean;
  showEnergy?: boolean;
  /**
   * Display unit of the intake and energy-balance lanes and their readouts (Settings › energy; default kcal). Metric
   * series carry their own, already converted, units.
   */
  energyUnit?: EnergyUnitChoice;
  textures?: boolean;
  status?: ChartStatus;
  onExplain?: (id: string) => void;
  onCommand?: (cmd: 'table' | 'focus' | 'escape') => boolean | void;
  /** `auto`: docked on narrow or coarse-pointer layouts, floating otherwise. */
  readout?: 'auto' | 'float' | 'dock';
  /** Changing this runs the playhead sweep (result arrived). */
  sweepKey?: string | number;
  ariaLabel?: string;
}

/** Shared by LaneStack / OverlayView: readout rows for intake + series. */
export function seriesReadoutRow(s: ChartSeries, opts: { indexed?: (t: number, res: Resolution) => number; suffix?: string } = {}): ReadoutRow {
  const d = s.format.decimals;
  const unit = unitSuffix(s.unit);
  return {
    id: s.id,
    short: s.shortLabel ?? s.label.split(' ')[0]!.toLowerCase(),
    color: `var(--lm-cat-${s.category})`,
    shape: laneKindOf(s) === 'stacked-area' ? 'square' : 'line',
    value: (t, res) => {
      const cv = valueAt(s, t, res);
      const range = Number.isFinite(cv.lo) && Number.isFinite(cv.hi) ? formatRange(cv.lo, cv.hi, d) : '';
      const extra = opts.indexed ? opts.indexed(t, res) : NaN;
      const lead = Number.isFinite(extra) ? formatSigned(extra, 1) + (opts.suffix ?? '') : formatNumber(cv.v, d);
      return {
        value: lead,
        unit: Number.isFinite(extra) ? '' : unit,
        detail: Number.isFinite(extra) ? `${s.label} · ${formatNumber(cv.v, d)}${unit ? THIN + unit : ''}` : `${s.label}${range ? ' · ' + range : ''}`,
        spoken: `${s.label} ${formatNumber(cv.v, d, { thousands: ',' })} ${unitWords(s.unit)}${range ? `, likely ${range.replace('–', ' to ')}` : ''}`,
      };
    },
  };
}

export function energyReadoutRow(data: ChartData, energyUnit: EnergyUnitChoice = 'kcal'): ReadoutRow | null {
  const intake = data.intake;
  if (!intake) return null;
  const bal = energyBalance(intake);
  return {
    id: 'energy',
    short: 'balance',
    color: 'var(--lm-energy-deficit-4)',
    shape: 'square',
    value: (t) => {
      const d = Math.min(intake.maintenance.length - 1, Math.floor(t));
      return {
        value: formatEnergy(bal[d]!, energyUnit, { withUnit: false, signed: true }),
        unit: energyUnit,
        detail: `vs maintenance ${formatEnergy(intake.maintenance[d]!, energyUnit, { withUnit: false })}`,
        spoken: '',
      };
    },
  };
}

export function intakeReadoutRow(data: ChartData, energyUnit: EnergyUnitChoice = 'kcal'): ReadoutRow | null {
  const intake = data.intake;
  if (!intake) return null;
  const kc = intakeKcal(intake);
  const bal = energyBalance(intake);
  return {
    id: 'intake',
    short: 'intake',
    color: 'var(--lm-ink)',
    shape: 'square',
    value: (t) => {
      const d = Math.min(intake.maintenance.length - 1, Math.floor(t));
      const tot = kc.total[d]!;
      const g = intake.grams;
      const detail =
        tot <= 0
          ? 'intake · water-only fast'
          : `intake · ${MACRO_LETTER.protein} ${formatNumber(g.protein[d]!, 0)} ${MACRO_LETTER.netCarbs} ${formatNumber(g.netCarbs[d]!, 0)} ${MACRO_LETTER.fat} ${formatNumber(g.fat[d]!, 0)} g`;
      return {
        value: formatEnergy(tot, energyUnit, { withUnit: false }),
        unit: energyUnit,
        detail,
        spoken: `Intake ${formatEnergy(tot, energyUnit, { withUnit: false, grouping: 'comma' })} ${energyUnitSpoken(energyUnit)}, ${formatEnergy(Math.abs(bal[d]!), energyUnit, { withUnit: false, grouping: 'comma' })} ${bal[d]! < 0 ? 'below' : 'above'} maintenance`,
      };
    },
  };
}

export const LaneStack = memo(function LaneStack(p: LaneStackProps) {
  const { data, controller } = p;
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(rootRef);
  const layout = stackLayout(width || 960);
  const coarse = useMediaQuery('(pointer: coarse)');
  const readoutMode = p.readout === 'float' || p.readout === 'dock' ? p.readout : layout.size === 's' || coarse ? 'dock' : 'float';

  const [fromZero, setFromZero] = useState<ReadonlySet<string>>(() => new Set());
  const [inputsMode, setInputsMode] = useState<InputsMode>('kcal');
  const [detail, setDetail] = useState(false);
  const [drag, setDrag] = useState<{ id: string; dropY: number | null } | null>(null);
  const [visible] = useState(() => createStore<ReadonlySet<string>>(new Set()));

  const byId = useMemo(() => new Map(data.series.map((s) => [s.id, s])), [data.series]);
  const lanes = useMemo(() => p.laneIds.map((id) => byId.get(id)).filter((s): s is ChartSeries => !!s), [p.laneIds, byId]);
  const groups = useMemo(() => groupByCategory(lanes), [lanes]);
  const safety = useMemo(() => (data.events ?? []).filter((e) => e.severity && e.severity !== 'info'), [data.events]);
  const eventTimes = useMemo(() => (data.events ?? []).map(eventTime).sort((a, b) => a - b), [data.events]);
  const focusId = p.focusId ?? null;

  const area: DataArea = useMemo(() => ({ left: layout.gutter + layout.tickCol, width: layout.plotW }), [layout.gutter, layout.tickCol, layout.plotW]);
  const geom: RowGeometry = useMemo(
    () => ({ cellW: layout.cellW, area: { left: layout.tickCol, width: layout.plotW }, compact: layout.size === 's' }),
    [layout.cellW, layout.tickCol, layout.plotW, layout.size],
  );
  const areaRef = useRef(area);
  useEffect(() => {
    areaRef.current = area;
  });
  useBodyInteractions(bodyRef, controller, area, eventTimes, p.onCommand);

  // focus: bring the focused lane into view
  useEffect(() => {
    if (!focusId) return;
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-lane="${CSS.escape(focusId)}"]`);
    el?.scrollIntoView?.({ block: 'nearest', behavior: controller.durationMs ? 'smooth' : 'auto' });
  }, [focusId, controller]);

  const onVisible = useCallback(
    (id: string, v: boolean) => {
      const cur = visible.get();
      if (cur.has(id) === v) return;
      const next = new Set(cur);
      if (v) next.add(id);
      else next.delete(id);
      visible.set(next);
    },
    [visible],
  );

  const onLaneIdsChange = p.onLaneIdsChange;
  const move = useCallback(
    (id: string, dir: -1 | 1) => {
      const s = byId.get(id);
      if (!s || !onLaneIdsChange) return;
      const same = p.laneIds.filter((x) => byId.get(x)?.category === s.category);
      const k = same.indexOf(id);
      const target = same[k + dir];
      if (!target) return;
      const next = [...p.laneIds];
      const a = next.indexOf(id);
      const b = next.indexOf(target);
      next[a] = target;
      next[b] = id;
      onLaneIdsChange(next);
    },
    [byId, onLaneIdsChange, p.laneIds],
  );
  const hide = useCallback((id: string) => onLaneIdsChange?.(p.laneIds.filter((x) => x !== id)), [onLaneIdsChange, p.laneIds]);
  const toggleZero = useCallback(
    (id: string) =>
      setFromZero((prev) => {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    [],
  );
  const onFocusChange = p.onFocusChange;
  const focus = useCallback((id: string) => onFocusChange?.(focusId === id ? null : id), [onFocusChange, focusId]);

  // drag to reorder within a category
  const gripDown = useCallback(
    (id: string, e: ReactPointerEvent<HTMLButtonElement>) => {
      const body = bodyRef.current;
      const s = byId.get(id);
      if (!body || !s || !onLaneIdsChange) return;
      e.preventDefault();
      const handle = e.currentTarget;
      handle.setPointerCapture?.(e.pointerId);
      const same = p.laneIds.filter((x) => byId.get(x)?.category === s.category);
      const bodyTop = body.getBoundingClientRect().top;
      const rects = same.map((x) => {
        const r = body.querySelector<HTMLElement>(`[data-lane="${CSS.escape(x)}"]`)?.getBoundingClientRect();
        return { id: x, top: (r?.top ?? 0) - bodyTop, bottom: (r?.bottom ?? 0) - bodyTop };
      });
      let target = same.indexOf(id);
      setDrag({ id, dropY: null });
      const onMove = (ev: PointerEvent) => {
        const y = ev.clientY - bodyTop;
        let k = rects.findIndex((r) => y < (r.top + r.bottom) / 2);
        if (k < 0) k = rects.length;
        target = k;
        const edge = k < rects.length ? rects[k]!.top : rects[rects.length - 1]!.bottom;
        setDrag({ id, dropY: edge - 1 });
      };
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        setDrag(null);
        const from = same.indexOf(id);
        const to = target > from ? target - 1 : target;
        if (to === from) return;
        const reordered = [...same];
        reordered.splice(from, 1);
        reordered.splice(to, 0, id);
        let k = 0;
        onLaneIdsChange(p.laneIds.map((x) => (byId.get(x)?.category === s.category ? reordered[k++]! : x)));
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    },
    [byId, onLaneIdsChange, p.laneIds],
  );

  const energyUnit = p.energyUnit ?? 'kcal';
  const rows = useMemo(() => {
    const out: ReadoutRow[] = [];
    const ir = p.showInputs !== false ? intakeReadoutRow(data, energyUnit) : null;
    if (ir) out.push(ir);
    const er = p.showEnergy !== false ? energyReadoutRow(data, energyUnit) : null;
    if (er) out.push(er);
    for (const s of lanes) out.push(seriesReadoutRow(s));
    return out;
  }, [data, lanes, p.showInputs, p.showEnergy, energyUnit]);

  const style = { '--lmc-gutter': `${layout.gutter}px`, '--lmc-tickcol': `${layout.tickCol}px` } as CSSProperties;
  const ketosis = data.states?.find((s) => s.id === 'ketosis') ?? data.states?.[0];
  return (
    <div ref={rootRef} className="lmc-stack" data-size={layout.size} style={style}>
      {readoutMode === 'dock' ? (
        <CrosshairReadout
          controller={controller}
          time={data.time}
          phases={data.phases}
          events={data.events}
          rows={rows}
          mode="dock"
          visible={visible}
          area={() => areaRef.current}
          bodyWidth={layout.width}
          hint="to read every channel on one day."
        />
      ) : null}
      <div
        ref={bodyRef}
        className="lmc-body"
        tabIndex={0}
        role="group"
        aria-roledescription="chart"
        aria-label={p.ariaLabel ?? `Projection channels, ${lanes.length} lanes over ${data.time.days} days`}
        aria-describedby={undefined}
        aria-keyshortcuts="ArrowLeft ArrowRight Home End PageUp PageDown T F Escape"
        data-running={p.status === 'running' || undefined}
        data-stale={p.status === 'stale' || undefined}
      >
        <PhaseRuler controller={controller} time={data.time} phases={data.phases} geom={geom} />
        <EventRibbon controller={controller} time={data.time} events={data.events} state={ketosis} geom={geom} />
        {p.showInputs !== false && data.intake ? (
          <InputsRow
            intake={data.intake}
            layout={layout}
            controller={controller}
            phases={data.phases}
            events={safety}
            textures={p.textures}
            mode={inputsMode}
            detail={detail}
            energyUnit={energyUnit}
            onModeChange={setInputsMode}
            onDetailChange={setDetail}
          />
        ) : null}
        {p.showEnergy !== false && data.intake && !focusId ? (
          <EnergyRow intake={data.intake} layout={layout} controller={controller} phases={data.phases} events={safety} textures={p.textures} energyUnit={energyUnit} />
        ) : null}
        {groups.map((g) => (
          <LaneGroup
            key={g.category}
            category={g.category}
            lanes={g.items}
            total={g.items.length}
            layout={layout}
            controller={controller}
            data={data}
            safety={safety}
            textures={p.textures}
            focusId={focusId}
            fromZero={fromZero}
            dragId={drag?.id ?? null}
            onExplain={p.onExplain}
            onFocus={p.onFocusChange ? focus : undefined}
            onMove={onLaneIdsChange ? move : undefined}
            onHide={onLaneIdsChange ? hide : undefined}
            onToggleZero={toggleZero}
            onGripDown={onLaneIdsChange ? gripDown : undefined}
            onVisible={onVisible}
          />
        ))}
        <TimeAxis controller={controller} time={data.time} geom={geom} />
        <Crosshair controller={controller} area={area} />
        <Sweep controller={controller} area={area} sweepKey={p.sweepKey} />
        {drag?.dropY != null ? <div className="lmc-drop" style={{ top: drag.dropY }} /> : null}
        {readoutMode === 'float' ? (
          <CrosshairReadout
            controller={controller}
            time={data.time}
            phases={data.phases}
            events={data.events}
            rows={rows}
            mode="float"
            visible={visible}
            area={() => areaRef.current}
            bodyWidth={layout.width}
          />
        ) : null}
      </div>
      <LiveReadout controller={controller} time={data.time} rows={rows} visible={visible} />
    </div>
  );
});

interface LaneGroupProps {
  category: ChartSeries['category'];
  lanes: ChartSeries[];
  total: number;
  layout: StackLayout;
  controller: ChartController;
  data: ChartData;
  safety: ChartData['events'];
  textures?: boolean;
  focusId: string | null;
  fromZero: ReadonlySet<string>;
  dragId: string | null;
  onExplain?: (id: string) => void;
  onFocus?: (id: string) => void;
  onMove?: (id: string, dir: -1 | 1) => void;
  onHide?: (id: string) => void;
  onToggleZero?: (id: string) => void;
  onGripDown?: (id: string, e: ReactPointerEvent<HTMLButtonElement>) => void;
  onVisible?: (id: string, v: boolean) => void;
}

const LaneGroup = memo(function LaneGroup(g: LaneGroupProps) {
  return (
    <>
      <div className="lmc-ghead" data-no-crosshair="">
        <Swatch category={g.category} shape="square" />
        {CATEGORY_LABEL[g.category]}
      </div>
      {g.lanes.map((s, k) => (
        <LaneRow
          key={s.id}
          series={s}
          mode={g.focusId ? (g.focusId === s.id ? 'focus' : 'strip') : 'lane'}
          layout={g.layout}
          controller={g.controller}
          phases={g.data.phases}
          events={g.safety}
          textures={g.textures}
          fromZero={g.fromZero.has(s.id)}
          canMoveUp={k > 0}
          canMoveDown={k < g.lanes.length - 1}
          dragging={g.dragId === s.id}
          onExplain={g.onExplain}
          onFocus={g.onFocus}
          onMove={g.onMove}
          onHide={g.onHide}
          onToggleZero={g.onToggleZero}
          onGripDown={g.onGripDown}
          onVisible={g.onVisible}
        />
      ))}
    </>
  );
});
