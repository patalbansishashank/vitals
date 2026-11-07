/* ==========================================================================
   Lanes: one metric per lane in its own units (CHART_SPEC §4), plus the
   intake lane (§4.4) and the energy-vs-maintenance lane. The gutter value,
   % change and crosshair dot update imperatively on cursor moves.
   ========================================================================== */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { GripVertical, MoreHorizontal } from 'lucide-react';
import { usePulse } from '@/app/motion';
import { energyPerDayUnit, formatEnergy, GradeBadge, Icon, Menu, Swatch, type EnergyUnitChoice, type MenuItem } from '@/components';
import { laneKindOf, MACRO_LABEL, MACRO_LETTER } from '../catalogue';
import type { ChartController, ViewState } from '../core/controller';
import { type AxisRegister, useAxisModel, useInView } from '../core/hooks';
import { stackKeys, energyModel, inputsModel, INPUTS_TICK_ROW, type InputsMode } from '../core/inputModels';
import type { StackLayout } from '../core/layout';
import { type LaneMode, lineLaneModel, stackedAreaModel } from '../core/models';
import { PlotCanvas, type PlotApi, type PlotModel } from '../core/PlotCanvas';
import { formatNumber, formatSigned, percentChange, THIN, unitSuffix } from '../lib/format';
import { energyBalance, intakeKcal } from '../lib/intake';
import { baselineOf, isWideRange, trackAt, valueAt } from '../lib/series';
import { laneSummary } from '../lib/summary';
import { interpolateAt } from '../lib/time';
import type { ChartEvent, ChartSeries, IntakeContext, Phase } from '../types';
import { setData } from '../core/dom';

/** "−17.8 %" for ratio metrics, "−12 pts" for indices, absolute change when the start is ~0. */
export function changeText(s: ChartSeries, v: number): string {
  if (s.display?.wordOnly) return '';
  const b = baselineOf(s);
  if (!Number.isFinite(v) || !Number.isFinite(b)) return '';
  // a series that starts at zero ("% vs start", adaptation, hours in ketosis) already reads as the change: repeating
  // it ("−58.0 % vs start −58.0 % vs start") only overflows the gutter
  if (b === 0) return '';
  if (s.unit === 'index' || s.unit === '%') return `${formatSigned(v - b, s.format.decimals)}${THIN}pts`;
  const pc = percentChange(b, v);
  if (!Number.isFinite(pc) || s.overlay === 'none') {
    const u = unitSuffix(s.unit);
    return `${formatSigned(v - b, s.format.decimals)}${u ? THIN + u : ''}`;
  }
  return `${formatSigned(pc, 1)}${THIN}%`;
}

/** Write text only when it changed (avoids needless layout invalidation on crosshair moves). */
function setText(el: HTMLElement | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

function cursorOrEnd(controller: ChartController): { t: number; live: boolean; view: ViewState } {
  const c = controller.cursor.get();
  const v = controller.view.get();
  if (c.t != null && c.t >= v.x0 && c.t <= v.x1) return { t: c.t, live: true, view: v };
  return { t: Math.max(0, Math.min(controller.days, v.x1) - 1e-6), live: false, view: v };
}

function useCursorEffect(controller: ChartController, update: () => void) {
  useEffect(() => {
    let queued = false;
    const later = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        update();
      });
    };
    update();
    const a = controller.cursor.subscribe(update);
    const b = controller.view.subscribe(later);
    return () => {
      a();
      b();
    };
  }, [controller, update]);
}

/**
 * The focused lane's end dot pulses (AUDIT §1.4): a ring leaves the dot and fades, twice, then this unmounts. The canvas
 * draws the dot itself; this is the ring, placed on the model's end point after every draw of the plot (so it follows
 * a zoom, a pan and the y-scale tween), animated on the compositor by `.lmc-pulse`. Not mounted at all under reduced
 * motion, forced colours or more contrast (`usePulse` is false), and the stylesheet hides it there too.
 */
function EndPulse({ api, model, controller, hue }: { api: PlotApi | null; model: PlotModel; controller: ChartController; hue: string }) {
  const pulsing = usePulse();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !api) return;
    const place = () => {
      const end = model.endPoint?.(controller.view.get());
      const [lo, hi] = api.domain();
      if (!end || end.v < lo || end.v > hi) {
        setData(el, 'on', 'false');
        return;
      }
      el.style.transform = `translate(${api.cssX(end.t).toFixed(1)}px, ${api.cssY(end.v).toFixed(1)}px)`;
      setData(el, 'on', 'true');
    };
    place();
    return api.onDraw(place);
  }, [api, model, controller, pulsing]);
  if (!pulsing) return null;
  return (
    <div ref={ref} className="lmc-pulse" data-on="false" style={{ '--lmc-dot': hue } as CSSProperties} aria-hidden="true">
      <i />
    </div>
  );
}

export interface LaneActions {
  onExplain?: (id: string) => void;
  onFocus?: (id: string) => void;
  onMove?: (id: string, dir: -1 | 1) => void;
  onToggleZero?: (id: string) => void;
  onHide?: (id: string) => void;
  onGripDown?: (id: string, e: ReactPointerEvent<HTMLButtonElement>) => void;
}

export interface LaneRowProps extends LaneActions {
  series: ChartSeries;
  mode: LaneMode;
  layout: StackLayout;
  controller: ChartController;
  phases?: readonly Phase[];
  events?: readonly ChartEvent[];
  textures?: boolean;
  fromZero?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  dragging?: boolean;
  /** Visibility registry for the readout (only lanes in view are listed when there are many). */
  onVisible?: (id: string, visible: boolean) => void;
  /** The stack's shared tick column: the lane's model joins the widest-label measurement. */
  onAxisModel?: AxisRegister;
}

export const LaneRow = memo(function LaneRow(p: LaneRowProps) {
  const { series: s, mode, layout, controller } = p;
  const rowRef = useRef<HTMLDivElement>(null);
  const valRef = useRef<HTMLElement>(null);
  const deltaRef = useRef<HTMLSpanElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<PlotApi | null>(null);
  const inView = useInView(rowRef);
  // the readout lists lanes actually on screen (the ±1 screen margin is for mounting canvases)
  const onScreen = useInView(rowRef, '0px');
  const kind = laneKindOf(s);
  const onVisible = p.onVisible;
  useEffect(() => {
    onVisible?.(s.id, onScreen);
    return () => onVisible?.(s.id, false);
  }, [onVisible, s.id, onScreen]);

  const model = useMemo(
    () =>
      kind === 'stacked-area'
        ? stackedAreaModel(s, { mode: s.display?.wordOnly ? 'strip' : mode, tickColCss: layout.tickBase, phases: p.phases, events: p.events, textures: p.textures, labels: mode === 'focus' })
        : lineLaneModel(s, {
            mode: s.display?.wordOnly ? 'strip' : mode,
            tickColCss: layout.tickBase,
            fromZero: p.fromZero,
            phases: p.phases,
            events: p.events,
            textures: p.textures,
            thresholdLabels: mode !== 'strip',
          }),
    [kind, s, mode, layout.tickBase, p.fromZero, p.phases, p.events, p.textures],
  );
  useAxisModel(p.onAxisModel, `lane:${s.id}`, model);
  const height = mode === 'focus' ? layout.focusH : mode === 'strip' ? layout.stripH : layout.laneH;
  const padV = mode === 'strip' ? 3 : 8;
  const padding = useMemo(() => ({ top: padV, bottom: padV, left: layout.tickCol, right: layout.rightPad }), [padV, layout.tickCol, layout.rightPad]);
  // only the focused lane needs the engine in state (its pulse follows the end point); the others keep a ref
  const focused = mode === 'focus' && !s.display?.wordOnly;
  const [pulseApi, setPulseApi] = useState<PlotApi | null>(null);
  const onApi = useCallback(
    (api: PlotApi | null) => {
      apiRef.current = api;
      if (focused) setPulseApi(api);
    },
    [focused],
  );

  const update = useCallback(() => {
    const { t, live, view } = cursorOrEnd(controller);
    const cv = valueAt(s, t, live ? view.res : 'daily');
    setText(valRef.current, s.display?.wordOnly ?? `${formatNumber(cv.v, s.format.decimals)}${s.display?.qualifier ? ` · ${s.display.qualifier}` : ''}`);
    setText(deltaRef.current, changeText(s, cv.v));
    const dot = dotRef.current;
    const api = apiRef.current;
    if (!dot) return;
    if (!live || !api) {
      setData(dot, 'on', 'false');
      return;
    }
    const tr = trackAt(s, view.res);
    const y = interpolateAt(tr.values, tr.res, t);
    const [a, b] = api.domain();
    if (!Number.isFinite(y) || y < a || y > b) {
      setData(dot, 'on', 'false');
      return;
    }
    dot.style.transform = `translate(${api.cssX(t).toFixed(1)}px, ${api.cssY(y).toFixed(1)}px)`;
    setData(dot, 'on', 'true');
  }, [controller, s]);
  useCursorEffect(controller, update);

  const items: MenuItem[] = [
    ...(p.onFocus ? [{ id: 'focus', label: mode === 'focus' ? 'Exit focus' : 'Focus', onSelect: () => p.onFocus?.(s.id), hint: 'F' }] : []),
    ...(p.onExplain ? [{ id: 'explain', label: 'Explain', onSelect: () => p.onExplain?.(s.id) }] : []),
    ...(p.onMove
      ? [
          { id: 'up', label: 'Move up', onSelect: () => p.onMove?.(s.id, -1), disabled: !p.canMoveUp, separatorBefore: true },
          { id: 'down', label: 'Move down', onSelect: () => p.onMove?.(s.id, 1), disabled: !p.canMoveDown },
        ]
      : []),
    ...(p.onToggleZero && kind === 'line' ? [{ id: 'zero', label: p.fromZero ? 'Hug the data' : 'From zero', onSelect: () => p.onToggleZero?.(s.id) }] : []),
    ...(p.onHide ? [{ id: 'hide', label: 'Hide', onSelect: () => p.onHide?.(s.id), separatorBefore: true }] : []),
  ];

  const gripKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowUp' && p.canMoveUp) {
      e.preventDefault();
      p.onMove?.(s.id, -1);
    } else if (e.key === 'ArrowDown' && p.canMoveDown) {
      e.preventDefault();
      p.onMove?.(s.id, 1);
    }
  };

  const unit = s.display?.wordOnly ? '' : unitSuffix(s.unit);
  const wide = isWideRange(s);
  const notes = [s.grade === 'D' ? 'exploratory' : '', wide ? 'wide range' : ''].filter(Boolean).join(' · ');
  const summary = useMemo(() => laneSummary(s), [s]);
  return (
    <div ref={rowRef} className="lmc-row lmc-lane" data-lane={s.id} data-mode={mode} data-notes={notes && mode !== 'strip' ? 'true' : undefined} data-dragging={p.dragging || undefined}>
      <div className="lmc-gut" data-no-crosshair="">
        <button type="button" className="lmc-gut__name" onClick={() => p.onExplain?.(s.id)} aria-label={`Explain ${s.label}${notes ? ` (${notes})` : ''}`} title={notes ? `${s.label} · ${notes}` : s.label}>
          <Swatch category={s.category} shape={kind === 'stacked-area' ? 'square' : 'line'} />
          <span className="lmc-t">{s.label}</span>
        </button>
        {mode !== 'strip' ? (
          <span className="lmc-gut__meta">
            <GradeBadge grade={s.grade} size="sm" />
            <span className="lmc-note">{s.display?.wordOnly ? '' : s.unit}</span>
          </span>
        ) : null}
        {notes && mode !== 'strip' ? <span className="lmc-gut__note">{notes}</span> : null}
        <span className="lmc-gut__val">
          <b>
            <span ref={valRef} />
            {unit ? <span className="lmc-unit">{unit}</span> : null}
          </b>
          {layout.size !== 's' ? <span className="lmc-delta" ref={deltaRef} /> : null}
        </span>
        {mode !== 'strip' && (p.onMove || p.onHide || p.onFocus) ? (
          <div className="lmc-gut__tools">
            {p.onGripDown && layout.size !== 's' ? (
              <button
                type="button"
                className="lmc-tool"
                data-grip=""
                aria-label={`Reorder ${s.label} (arrow keys)`}
                onPointerDown={(e) => p.onGripDown?.(s.id, e)}
                onKeyDown={gripKey}
              >
                <Icon icon={GripVertical} size={14} />
              </button>
            ) : null}
            <Menu
              label={`${s.label} lane`}
              items={items}
              trigger={(tp) => (
                <button type="button" className="lmc-tool" {...tp} aria-label={`${s.label} lane options`}>
                  <Icon icon={MoreHorizontal} size={16} />
                </button>
              )}
            />
          </div>
        ) : null}
      </div>
      <div className="lmc-cell" role="img" aria-label={summary}>
        <PlotCanvas model={model} controller={controller} width={layout.cellW} height={height} padding={padding} active={inView} onApi={onApi}>
          <div ref={dotRef} className="lmc-dot" data-on="false" style={{ '--lmc-dot': `var(--lm-cat-${s.category})` } as CSSProperties} />
          {focused ? <EndPulse api={pulseApi} model={model} controller={controller} hue={kind === 'stacked-area' ? 'var(--lm-ink)' : `var(--lm-cat-${s.category})`} /> : null}
        </PlotCanvas>
      </div>
      {/* C6/D6-07: no mechanism line under a focused lane; the mechanism, warrant and limits open in Explain */}
    </div>
  );
});

/* ------------------------------------------------------------ intake lane */

export interface InputsRowProps {
  intake: IntakeContext;
  layout: StackLayout;
  controller: ChartController;
  phases?: readonly Phase[];
  events?: readonly ChartEvent[];
  textures?: boolean;
  mode: InputsMode;
  detail: boolean;
  /** Display energy unit (Settings › energy; default kcal). Grams and % modes are unaffected. */
  energyUnit?: EnergyUnitChoice;
  onModeChange?: (m: InputsMode) => void;
  onDetailChange?: (d: boolean) => void;
  /** The stack's shared tick column (see LaneRowProps). */
  onAxisModel?: AxisRegister;
}

export const InputsRow = memo(function InputsRow(p: InputsRowProps) {
  const { intake, layout, controller } = p;
  const eu = p.energyUnit ?? 'kcal';
  const rowRef = useRef<HTMLDivElement>(null);
  const valRef = useRef<HTMLSpanElement>(null);
  const deltaRef = useRef<HTMLSpanElement>(null);
  const inView = useInView(rowRef);
  const model = useMemo(
    () => inputsModel(intake, { mode: p.mode, detail: p.detail, energyUnit: eu, tickColCss: layout.tickBase, phases: p.phases, events: p.events, textures: p.textures }),
    [intake, p.mode, p.detail, eu, layout.tickBase, p.phases, p.events, p.textures],
  );
  useAxisModel(p.onAxisModel, 'row:intake', model);
  const padding = useMemo(() => ({ top: 8, bottom: INPUTS_TICK_ROW, left: layout.tickCol, right: layout.rightPad }), [layout.tickCol, layout.rightPad]);
  const update = useCallback(() => {
    const { t } = cursorOrEnd(controller);
    const d = Math.min(intake.maintenance.length - 1, Math.floor(t));
    const kc = intakeKcal(intake);
    const tot = p.detail ? kc.totalWithFibre[d]! : kc.total[d]!;
    const mt = intake.maintenance[d]!;
    setText(valRef.current, formatEnergy(tot, eu, { withUnit: false }));
    setText(deltaRef.current, mt > 0 ? `${formatNumber((tot / mt) * 100, 0)}${THIN}% of maint.` : '');
  }, [controller, intake, p.detail, eu]);
  useCursorEffect(controller, update);
  const keys = stackKeys(p.detail);
  const items: MenuItem[] = [
    { id: 'kcal', label: p.mode === 'kcal' ? `${eu} ✓` : eu, onSelect: () => p.onModeChange?.('kcal') },
    { id: 'grams', label: p.mode === 'grams' ? 'grams ✓' : 'grams', onSelect: () => p.onModeChange?.('grams') },
    { id: 'pct', label: p.mode === 'pct' ? '% energy ✓' : '% energy', onSelect: () => p.onModeChange?.('pct') },
    { id: 'detail', label: p.detail ? 'Hide fibre and alcohol' : 'Show fibre and alcohol', onSelect: () => p.onDetailChange?.(!p.detail), separatorBefore: true },
  ];
  const unitText = p.mode === 'kcal' ? energyPerDayUnit(eu) : p.mode === 'grams' ? 'g/d' : '% energy';
  return (
    <div ref={rowRef} className="lmc-row lmc-lane" data-lane="intake" data-mode="lane">
      <div className="lmc-gut" data-no-crosshair="">
        <span className="lmc-gut__name" style={{ cursor: 'default' }}>
          <span className="lmc-t">Intake</span>
        </span>
        <span className="lmc-gut__meta" aria-label={`${unitText}; ${keys.map((k) => MACRO_LABEL[k]).join(', ')}`}>
          <span>{unitText}</span>
          {keys
            .filter((k) => p.mode !== 'grams' || k !== 'alcohol' || p.detail)
            .map((k) => (
              <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} title={MACRO_LABEL[k]}>
                <Swatch color={`var(--lm-macro-${k === 'netCarbs' ? 'carbs' : k})`} shape="square" />
                {MACRO_LETTER[k]}
              </span>
            ))}
        </span>
        <span className="lmc-gut__val">
          <b>
            <span ref={valRef} />
            <span className="lmc-unit">{eu}</span>
          </b>
          {layout.size !== 's' ? <span className="lmc-delta" ref={deltaRef} /> : null}
        </span>
        {p.onModeChange ? (
          <div className="lmc-gut__tools">
            <Menu
              label="Intake lane"
              items={items}
              trigger={(tp) => (
                <button type="button" className="lmc-tool" {...tp} aria-label="Intake lane options">
                  <Icon icon={MoreHorizontal} size={16} />
                </button>
              )}
            />
          </div>
        ) : null}
      </div>
      <div
        className="lmc-cell"
        role="img"
        aria-label={`Intake per day in ${unitText}, stacked by macronutrient, with projected maintenance as a step line. Training days are marked under the bars. Press T for the data table.`}
      >
        <PlotCanvas model={model} controller={controller} width={layout.cellW} height={layout.inputsH + 6} padding={padding} active={inView} />
      </div>
    </div>
  );
});

/* ----------------------------------------------- energy vs maintenance lane */

export interface EnergyRowProps {
  intake: IntakeContext;
  layout: StackLayout;
  controller: ChartController;
  phases?: readonly Phase[];
  events?: readonly ChartEvent[];
  textures?: boolean;
  /** Display energy unit (Settings › energy; default kcal). */
  energyUnit?: EnergyUnitChoice;
  /** The stack's shared tick column (see LaneRowProps). */
  onAxisModel?: AxisRegister;
}

export const EnergyRow = memo(function EnergyRow(p: EnergyRowProps) {
  const { intake, layout, controller } = p;
  const eu = p.energyUnit ?? 'kcal';
  const rowRef = useRef<HTMLDivElement>(null);
  const valRef = useRef<HTMLSpanElement>(null);
  const deltaRef = useRef<HTMLSpanElement>(null);
  const inView = useInView(rowRef);
  const model = useMemo(
    () => energyModel(intake, { energyUnit: eu, tickColCss: layout.tickBase, phases: p.phases, events: p.events, textures: p.textures }),
    [intake, eu, layout.tickBase, p.phases, p.events, p.textures],
  );
  useAxisModel(p.onAxisModel, 'row:energy', model);
  const padding = useMemo(() => ({ top: 6, bottom: 6, left: layout.tickCol, right: layout.rightPad }), [layout.tickCol, layout.rightPad]);
  const update = useCallback(() => {
    const { t } = cursorOrEnd(controller);
    const d = Math.min(intake.maintenance.length - 1, Math.floor(t));
    const bal = energyBalance(intake)[d]!;
    const tot = intakeKcal(intake).total[d]!;
    const mt = intake.maintenance[d]!;
    setText(valRef.current, formatEnergy(bal, eu, { withUnit: false, signed: true }));
    setText(deltaRef.current, mt > 0 ? `${formatNumber((tot / mt) * 100, 0)}${THIN}%` : '');
  }, [controller, intake, eu]);
  useCursorEffect(controller, update);
  return (
    <div ref={rowRef} className="lmc-row lmc-lane" data-lane="energy" data-mode="lane">
      <div className="lmc-gut" data-no-crosshair="">
        <span className="lmc-gut__name" style={{ cursor: 'default' }}>
          <span className="lmc-t">Energy balance</span>
        </span>
        <span className="lmc-gut__meta">
          <span className="lmc-note">{energyPerDayUnit(eu)} vs maintenance</span>
        </span>
        <span className="lmc-gut__val">
          <b>
            <span ref={valRef} />
            <span className="lmc-unit">{eu}</span>
          </b>
          {layout.size !== 's' ? <span className="lmc-delta" ref={deltaRef} /> : null}
        </span>
      </div>
      <div
        className="lmc-cell"
        role="img"
        aria-label="Energy balance per day: intake minus projected maintenance. Columns below zero are deficits, above zero surpluses; tint steps show the percent of maintenance. Press T for the data table."
      >
        <PlotCanvas model={model} controller={controller} width={layout.cellW} height={layout.laneH} padding={padding} active={inView} />
      </div>
    </div>
  );
});
