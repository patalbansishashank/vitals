import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type { AvatarParams } from '@/engine/body';
import { cx, useReducedMotion } from '@/components';
import { describeAvatar } from './describe';
import {
  avatarGeometry,
  lerpGeometry,
  maxDisplacement,
  pathD,
  resolveFrame,
  type AvatarGeometry,
  type HandleRegion,
  type LandmarkId,
  type Pt,
} from './geometry';
import { MIN_TEXT_PX, stageLayout, textWidthPx, type AvatarView, type StageLayout } from './layout';
import { motionTokens } from './motion';
import './avatar.css';

export type { AvatarView } from './layout';
export type { HandleRegion } from './geometry';

/** `lg` desktop stage (figure ≈ 400 px) · `md` mobile (≈ 290 px) · `sm` mini figure (120 px) · `xs` plan-card silhouette · `fill` the parent's box · px. */
export type AvatarSize = 'lg' | 'md' | 'sm' | 'xs' | 'fill' | number;

export type MeasureId = LandmarkId;
export type DragRegion = HandleRegion | 'body';
export type DragChannel = 'fat' | 'muscle';

/**
 * One step of a direct-manipulation gesture. Apply `amount` on every event (it is the change since the previous
 * event); `phase: 'end'` marks the commit point. Units follow AVATAR_SPEC §8:
 * - handles, `fat`: distribution units, 1 per 60 px of OUTWARD drag (−1…+1 slider = 120 px);
 * - handles, `muscle` (Shift held on chest / hips / arms): muscle units, 1 per 120 px (0…1 slider);
 * - `body` (vertical drag on the figure): body-fat percentage points, 10 per 100 px of UPWARD drag.
 * Keyboard on a handle: ←/↓ −0.05, →/↑ +0.05, PgUp/PgDn ±0.25 (Shift = muscle channel), one event per key.
 */
export interface RegionDragDelta {
  channel: DragChannel;
  amount: number;
  /** Change since the gesture started. */
  total: number;
  /** Raw pointer travel since the previous event (outward for handles, upward for body), px. */
  px: number;
  phase: 'start' | 'move' | 'end';
  source: 'pointer' | 'keyboard';
}

export interface HandleValue {
  value: number;
  min: number;
  max: number;
  /** Spoken value, e.g. "41 percent of your fat". */
  text: string;
}

export interface AvatarInteraction {
  /** The parent owns the slider state: map the delta onto its sliders. */
  onRegionDrag: (region: DragRegion, delta: RegionDragDelta) => void;
  /** Current slider values behind each handle (ARIA slider semantics + keyboard). */
  values?: Partial<Record<HandleRegion, HandleValue>>;
  /** Floating caption while dragging: "belly & waist · 41 % of fat", "upper muscle · trained". */
  describe?: (region: DragRegion, channel: DragChannel) => string;
  /** Vertical drag on the figure changes total body fat (default true). */
  bodyDrag?: boolean;
  /** Handle visibility at rest: `always` (default; touch "adjust on figure") or `hover` (pointer stages). */
  handles?: 'always' | 'hover';
  /** Disabled regions; a string is the reason ("set by your waist measurement"). */
  disabled?: Partial<Record<DragRegion, boolean | string>>;
}

export interface BodyAvatarProps {
  /** Engine output: `stateToAvatarParams(state, { baseline })`. */
  params: AvatarParams;
  /** Ghost: the start state's envelope outline (before/after, results). */
  compareTo?: AvatarParams;
  view?: AvatarView;
  /** Waist/hip/chest callouts, values already formatted in the user's units ("86.6 cm", "34 in"). */
  showMeasures?: Partial<Record<MeasureId, string>>;
  size?: AvatarSize;
  /** Accessible name. Default: a generated description (AVATAR_SPEC §7.8). */
  label?: string;
  /** Direct-manipulation handles; omit for a display-only figure. */
  interactive?: AvatarInteraction;
  /** Drawing-only frame 0..1 (0 = hips-led, 1 = shoulders-led). Default: `params.figure.frame`, else from sex. */
  frame?: number;
  showVisceral?: boolean;
  /** `silhouette`: envelope outline only (plan cards). */
  appearance?: 'layers' | 'silhouette';
  /** Height ruler (default: on for stages ≥ 200 px). */
  ruler?: boolean;
  /** Ruler scale and default height label units. */
  units?: 'metric' | 'imperial';
  /** Height label at the ruler tick, in the user's units. Default "178 cm" / "5 ft 10 in". */
  heightText?: string;
  /** The illustrative-figure caption (AVATAR_SPEC §7.7). `false` only where the host shows it elsewhere. */
  caption?: ReactNode | false;
  /** Tween discrete jumps (presets, resets) with the needle ease. Default true; always off with reduced motion. */
  tween?: boolean;
  /**
   * `hidden`: another renderer draws the body underneath (the 3D canvas, `underlay`). The SVG keeps the ruler, view
   * labels, callouts, handles and the body paths as invisible hit areas, and fades its own body out (the cross-fade
   * takes `--lm-dur-base`, which reduced motion collapses). Default `svg`.
   */
  body?: 'svg' | 'hidden';
  /** Drawn first inside the stage, under the SVG overlay, with the stage layout in px (the 3D canvas). */
  underlay?: (u: AvatarUnderlay) => ReactNode;
  /** Extra extents (cm) the stage must fit besides the SVG geometry, e.g. the 3D mesh's half widths and height. */
  minExtentCm?: { front?: number; side?: number; height?: number };
  className?: string;
  style?: CSSProperties;
}

/** What an underlay needs to draw in register with the overlay: the stage layout and the drawing's view centres. */
export interface AvatarUnderlay {
  layout: StageLayout;
  view: AvatarView;
  /** Horizontal centre of the drawn side view relative to its plumb line (cm): (min + max) / 2 of the side extent. */
  sideCentreCm: number;
}

const SIZE_PX = { lg: 460, md: 330, sm: 132, xs: 64 } as const;
const HANDLE_ORDER: readonly HandleRegion[] = ['chest', 'waist', 'hips', 'arms'];
const HANDLE_NAME: Record<HandleRegion, string> = {
  chest: 'chest',
  waist: 'belly and waist',
  hips: 'hips and thighs',
  arms: 'arms',
};
const MUSCLE_CHANNEL: Record<HandleRegion, boolean> = { chest: true, waist: false, hips: true, arms: true };
const JUMP_CM = 0.8;
export const DEFAULT_CAPTION = 'Illustrative figure. Shows proportions from your inputs, not your exact shape.';

/* ------------------------------------------------------------------------------------------------ hooks */

function useElementSize(ref: RefObject<HTMLElement | null>): { w: number; h: number } | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      setSize((prev) => (prev && Math.abs(prev.w - r.width) < 0.5 && Math.abs(prev.h - r.height) < 0.5 ? prev : { w: r.width, h: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

interface Tween {
  from: AvatarGeometry;
  to: AvatarGeometry;
  eased: number;
}

/**
 * Discrete jumps (preset, reset, keyboard step on a coarse control) settle with the needle ease; continuous input
 * (slider drags, handle drags, morph frames) is followed 1:1 (AVATAR_SPEC §5 "Updates").
 */
function useNeedleTween(target: AvatarGeometry, enabled: boolean): AvatarGeometry {
  const [prevTarget, setPrevTarget] = useState(target);
  const [tween, setTween] = useState<Tween | null>(null);
  if (prevTarget !== target) {
    setPrevTarget(target);
    const shown = tween ? lerpGeometry(tween.from, tween.to, tween.eased) : prevTarget;
    if (enabled && maxDisplacement(shown, target) >= JUMP_CM) setTween({ from: shown, to: target, eased: 0 });
    else if (tween) setTween(null);
  }
  const from = tween?.from ?? null;
  const to = tween?.to ?? null;
  useEffect(() => {
    if (!from || !to) return;
    const { needleMs, needleEase } = motionTokens();
    if (needleMs < 16) {
      const id = requestAnimationFrame(() => setTween(null));
      return () => cancelAnimationFrame(id);
    }
    const t0 = performance.now();
    let raf = requestAnimationFrame(function tick() {
      const p = Math.min(1, (performance.now() - t0) / needleMs);
      if (p >= 1) {
        setTween(null);
        return;
      }
      setTween((cur) => (cur && cur.to === to ? { ...cur, eased: needleEase(p) } : cur));
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [from, to]);
  return tween ? lerpGeometry(tween.from, tween.to, tween.eased) : target;
}

/* ------------------------------------------------------------------------------------------------ paths */

interface FigurePaths {
  frontEnv: string;
  frontCore: string;
  armsEnv: [string, string];
  armsCore: [string, string];
  frontHead: string;
  definition: { id: string; d: string; opacity: number }[];
  sideEnv: string;
  sideCore: string;
  sideHead: string;
  sideVisceral: string;
}

function figurePaths(g: AvatarGeometry): FigurePaths {
  return {
    frontEnv: pathD(g.front.body.envelope),
    frontCore: pathD(g.front.body.core),
    armsEnv: [pathD(g.front.arms.envelope[0]), pathD(g.front.arms.envelope[1])],
    armsCore: [pathD(g.front.arms.core[0]), pathD(g.front.arms.core[1])],
    frontHead: pathD(g.front.head),
    definition: g.front.definition
      .filter((s) => s.opacity > 0.02)
      .map((s) => ({ id: s.id, d: pathD(s.pts, false), opacity: Math.round(s.opacity * 100) / 100 })),
    sideEnv: pathD(g.side.body.envelope),
    sideCore: pathD(g.side.body.core),
    sideHead: pathD(g.side.head),
    sideVisceral: pathD(g.side.visceral),
  };
}

/* ------------------------------------------------------------------------------------------------ text layers */

function heightLabel(cm: number, units: 'metric' | 'imperial'): string {
  if (units === 'metric') return `${Math.round(cm)} cm`;
  const totalIn = Math.round(cm / 2.54);
  return `${Math.floor(totalIn / 12)} ft ${totalIn % 12} in`;
}

function Ruler({ L, heightCm, units, text }: { L: StageLayout; heightCm: number; units: 'metric' | 'imperial'; text: string }) {
  if (L.rulerX === null) return null;
  const x = Math.round(L.rulerX) + 0.5;
  const yOf = (cm: number) => L.floorY - cm * L.k;
  const maxCm = L.topCm - 4;
  const ticks: { cm: number; major: boolean; label?: string }[] = [];
  if (units === 'metric') {
    for (let c = 0; c <= maxCm; c += 10) ticks.push({ cm: c, major: c % 50 === 0, label: c % 50 === 0 && c > 0 ? String(c) : undefined });
  } else {
    for (let inch = 0; inch * 2.54 <= maxCm; inch += 6) {
      const ft = inch / 12;
      const major = inch % 12 === 0;
      ticks.push({ cm: inch * 2.54, major, label: major && ft > 0 && ft % 2 === 0 ? `${ft} ft` : undefined });
    }
  }
  const hy = yOf(heightCm);
  return (
    <g className="lm-avatar__ruler" aria-hidden="true">
      <line className="lm-avatar__ruler-line" x1={x} x2={x} y1={yOf(0)} y2={yOf(maxCm)} />
      {ticks.map((t) => {
        const y = Math.round(yOf(t.cm)) + 0.5;
        return <line key={t.cm} className="lm-avatar__tick" x1={x} x2={x + (t.major ? 7 : 4)} y1={y} y2={y} />;
      })}
      {ticks
        .filter((t) => t.label && Math.abs(yOf(t.cm) - hy) > MIN_TEXT_PX + 3)
        .map((t) => (
          <text key={`n${t.cm}`} className="lm-avatar__num" x={x + 10} y={yOf(t.cm)} dy="0.35em">
            {t.label}
          </text>
        ))}
      <line className="lm-avatar__height-tick" x1={x - 3} x2={x + 12} y1={Math.round(hy) + 0.5} y2={Math.round(hy) + 0.5} />
      <text className="lm-avatar__height" x={x + 15} y={hy} dy="0.35em">
        {text}
      </text>
    </g>
  );
}

interface Callout {
  id: MeasureId;
  y: number;
  x0: number;
  value: string;
}

function Measures({
  L,
  g,
  measures,
  view,
  stacked,
}: {
  L: StageLayout;
  g: AvatarGeometry;
  measures: Partial<Record<MeasureId, string>>;
  view: AvatarView;
  stacked: boolean;
}) {
  if (L.labelX === null) return null;
  const labelX = L.labelX;
  const items: Callout[] = (['chest', 'waist', 'hip'] as const)
    .filter((id) => measures[id])
    .map((id) => {
      const y = L.floorY - g.front.landmarks[id].y * L.k;
      const x0 =
        view !== 'front' && L.sideX !== null
          ? L.sideX + g.side.landmarks[id].front * L.k + 3
          : (L.frontX ?? 0) + g.front.landmarks[id].halfWidth * L.k + 3;
      return { id, y, x0, value: measures[id] ?? '' };
    })
    .sort((a, b) => a.y - b.y);
  // keep labels at least one line apart
  const ys = items.map((it) => it.y);
  const lineGap = stacked ? 2 * MIN_TEXT_PX + 8 : MIN_TEXT_PX + 5;
  for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i]!, ys[i - 1]! + lineGap);
  return (
    <g className="lm-avatar__measures" aria-hidden="true">
      {items.map((it, i) => {
        const ly = ys[i]!;
        const elbow = labelX - 10;
        return (
          <g key={it.id}>
            <circle className="lm-avatar__measure-dot" cx={it.x0} cy={it.y} r={1.75} />
            <polyline className="lm-avatar__leader" points={`${it.x0 + 2},${it.y} ${elbow},${it.y} ${labelX - 4},${ly}`} />
            {stacked ? (
              <text className="lm-avatar__measure" x={labelX} y={ly} dy="-0.25em">
                <tspan className="lm-avatar__measure-name">{it.id}</tspan>
                <tspan className="lm-avatar__measure-value" x={labelX} dy="1.2em">
                  {it.value}
                </tspan>
              </text>
            ) : (
              <text className="lm-avatar__measure" x={labelX} y={ly} dy="0.35em">
                <tspan className="lm-avatar__measure-name">{it.id}</tspan>
                <tspan className="lm-avatar__measure-value" dx="0.4em">
                  {it.value}
                </tspan>
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/**
 * The start state's silhouette as one outer contour: each part's outline is masked by the other parts' fills, so
 * the seams where arms, torso and head overlap (arm caps, neck top) do not show (AVATAR_SPEC §6).
 */
function GhostOutline({ id, body, head, arms }: { id: string; body: string; head: string; arms: string[] }) {
  const box = { x: -150, y: -20, width: 300, height: 280 };
  return (
    <g className="lm-avatar__ghost-group" aria-hidden="true">
      <defs>
        <mask id={`${id}b`} maskUnits="userSpaceOnUse" {...box}>
          <rect {...box} fill="white" />
          <path d={head} fill="black" />
        </mask>
        <mask id={`${id}a`} maskUnits="userSpaceOnUse" {...box}>
          <rect {...box} fill="white" />
          <path d={body} fill="black" />
          <path d={head} fill="black" />
        </mask>
        <mask id={`${id}h`} maskUnits="userSpaceOnUse" {...box}>
          <rect {...box} fill="white" />
          <path d={body} fill="black" />
        </mask>
      </defs>
      <path className="lm-avatar__ghost" d={body} mask={`url(#${id}b)`} />
      {arms.map((d, i) => (
        <path key={i} className="lm-avatar__ghost" d={d} mask={`url(#${id}a)`} />
      ))}
      <path className="lm-avatar__ghost" d={head} mask={`url(#${id}h)`} />
    </g>
  );
}

/* ------------------------------------------------------------------------------------------------ component */

interface DragState {
  region: DragRegion;
  channel: DragChannel;
  pointerId: number;
  last: number;
  totalPx: number;
  sign: number;
}

/**
 * The parametric two-layer body figure (AVATAR_SPEC): a solid lean core inside a frosted adipose envelope on the
 * perforated stage, front and/or side view, shared vertical scale, height ruler, optional girth callouts, ghost
 * outline and direct-manipulation handles. Pure view: the parent owns all state.
 */
export function BodyAvatar({
  params,
  compareTo,
  view = 'both',
  showMeasures,
  size = 'lg',
  label,
  interactive,
  frame,
  showVisceral = false,
  appearance = 'layers',
  ruler,
  units = 'metric',
  heightText,
  caption,
  tween = true,
  body = 'svg',
  underlay,
  minExtentCm,
  className,
  style,
}: BodyAvatarProps) {
  const reduced = useReducedMotion();
  const figFrame = resolveFrame(params, frame);
  const target = useMemo(() => avatarGeometry(params, { frame: figFrame }), [params, figFrame]);
  const geo = useNeedleTween(target, tween && !reduced);
  const ghost = useMemo(() => (compareTo ? avatarGeometry(compareTo, { frame: figFrame }) : null), [compareTo, figFrame]);
  const paths = useMemo(() => figurePaths(geo), [geo]);
  const ghostPaths = useMemo(
    () =>
      ghost
        ? {
            frontBody: pathD(ghost.front.body.envelope),
            frontArms: ghost.front.arms.envelope.map((p) => pathD(p)),
            frontHead: pathD(ghost.front.head),
            sideBody: pathD(ghost.side.body.envelope),
            sideHead: pathD(ghost.side.head),
          }
        : null,
    [ghost],
  );

  const stageRef = useRef<HTMLDivElement>(null);
  const measured = useElementSize(stageRef);
  const fixedH = typeof size === 'number' ? size : size === 'fill' ? null : SIZE_PX[size];
  const height = fixedH ?? measured?.h ?? SIZE_PX.lg;
  const aspect = view === 'both' ? 1.05 : view === 'front' ? 0.62 : 0.45;
  const width = measured?.w ?? Math.round(height * aspect);

  const small = height < 200;
  const tiny = height < 100;
  const showRuler = (ruler ?? !small) && !tiny;
  const measureIds = (['chest', 'waist', 'hip'] as const).filter((k) => !small && showMeasures?.[k]);
  // narrow stages stack the callout (name over value) to leave the width to the figure
  const stackMeasures = width < 560;
  const measurePx = measureIds.length
    ? Math.max(
        ...measureIds.map((k) =>
          stackMeasures ? Math.max(textWidthPx(k), textWidthPx(showMeasures?.[k] ?? '') * 1.08) : textWidthPx(`${k}  ${showMeasures?.[k] ?? ''}`),
        ),
      )
    : 0;
  const hText = heightText ?? heightLabel(params.heightCm, units);
  const extentFront = Math.max(
    Math.abs(geo.front.extent.minX),
    geo.front.extent.maxX,
    ghost ? Math.max(Math.abs(ghost.front.extent.minX), ghost.front.extent.maxX) : 0,
    minExtentCm?.front ?? 0,
  );
  const extentSide = Math.max(
    Math.abs(geo.side.extent.minX),
    geo.side.extent.maxX,
    ghost ? Math.max(Math.abs(ghost.side.extent.minX), ghost.side.extent.maxX) : 0,
    minExtentCm?.side ?? 0,
  );
  const L = stageLayout({
    width,
    height,
    view,
    frontHalfCm: extentFront,
    sideHalfCm: extentSide,
    maxHeightCm: Math.max(geo.front.extent.maxY, ghost?.front.extent.maxY ?? 0, minExtentCm?.height ?? 0),
    ruler: showRuler,
    measureLabelPx: measurePx,
    viewLabels: !small && view === 'both',
  });

  const autoLabel = describeAvatar(params, { frame: figFrame, heightText: hText, measures: showMeasures });
  const titleId = useId();
  const maskId = `lmav${titleId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const descId = `${titleId}-d`;
  const hintId = `${titleId}-h`;
  const silhouette = appearance === 'silhouette';

  /* ---- interaction ---- */
  const drag = useRef<DragState | null>(null);
  const [tip, setTip] = useState<{ region: DragRegion; channel: DragChannel; x: number; y: number } | null>(null);
  const [active, setActive] = useState<DragRegion | null>(null);
  const disabled = (r: DragRegion) => Boolean(interactive?.disabled?.[r]);
  const describe = (r: DragRegion, ch: DragChannel) =>
    interactive?.describe?.(r, ch) ?? (r === 'body' ? 'body fat' : ch === 'muscle' ? `${HANDLE_NAME[r]} muscle` : `${HANDLE_NAME[r]} fat`);
  // px per unit of `amount` (AVATAR_SPEC §8): distribution 60 px, muscle 120 px, body fat 10 px per point
  const unitPx = (r: DragRegion, ch: DragChannel) => (r === 'body' ? 10 : ch === 'muscle' ? 120 : 60);

  // the caption text is derived at render time, so it always shows the value after the latest update
  const tipAt = (e: ReactPointerEvent, region: DragRegion, channel: DragChannel) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTip({ region, channel, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const startDrag = (e: ReactPointerEvent<Element>, region: DragRegion, sign: number) => {
    if (!interactive || disabled(region) || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const channel: DragChannel = region !== 'body' && e.shiftKey && MUSCLE_CHANNEL[region] ? 'muscle' : 'fat';
    const axisPos = region === 'body' ? -e.clientY : e.clientX;
    drag.current = { region, channel, pointerId: e.pointerId, last: axisPos, totalPx: 0, sign };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported (tests) */
    }
    setActive(region);
    tipAt(e, region, channel);
    interactive.onRegionDrag(region, { channel, amount: 0, total: 0, px: 0, phase: 'start', source: 'pointer' });
  };

  const moveDrag = (e: ReactPointerEvent<Element>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId || !interactive) return;
    const axisPos = d.region === 'body' ? -e.clientY : e.clientX;
    const px = (axisPos - d.last) * d.sign;
    d.last = axisPos;
    if (px === 0) return;
    d.totalPx += px;
    const per = unitPx(d.region, d.channel);
    interactive.onRegionDrag(d.region, {
      channel: d.channel,
      amount: px / per,
      total: d.totalPx / per,
      px,
      phase: 'move',
      source: 'pointer',
    });
    tipAt(e, d.region, d.channel);
  };

  const endDrag = (e: ReactPointerEvent<Element>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setActive(null);
    setTip(null);
    const per = unitPx(d.region, d.channel);
    interactive?.onRegionDrag(d.region, { channel: d.channel, amount: 0, total: d.totalPx / per, px: 0, phase: 'end', source: 'pointer' });
  };

  const onHandleKey = (e: ReactKeyboardEvent<HTMLDivElement>, region: HandleRegion) => {
    if (!interactive || disabled(region)) return;
    const step = e.key === 'PageUp' ? 0.25 : e.key === 'PageDown' ? -0.25 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.05 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.05 : 0;
    if (step === 0) return;
    e.preventDefault();
    const channel: DragChannel = e.shiftKey && MUSCLE_CHANNEL[region] ? 'muscle' : 'fat';
    interactive.onRegionDrag(region, { channel, amount: step, total: step, px: 0, phase: 'end', source: 'keyboard' });
  };

  const bodyDrag = Boolean(interactive) && interactive?.bodyDrag !== false && !disabled('body');
  const figureDragProps = bodyDrag
    ? {
        onPointerDown: (e: ReactPointerEvent<SVGGElement>) => startDrag(e, 'body', 1),
        onPointerMove: moveDrag,
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
        'data-body-drag': true,
      }
    : {};

  const toPx = (p: Pt): { left: number; top: number } => ({ left: (L.frontX ?? 0) + p[0] * L.k, top: L.floorY - p[1] * L.k });
  const frontT = L.frontX !== null ? `translate(${L.frontX} ${L.floorY}) scale(${L.k} ${-L.k})` : undefined;
  const sideT = L.sideX !== null ? `translate(${L.sideX} ${L.floorY}) scale(${L.k} ${-L.k})` : undefined;
  const v = geo.front.visceral;

  const figureStyle: CSSProperties = {
    ...style,
    ...(fixedH !== null ? ({ '--avatar-stage-h': `${fixedH}px` } as CSSProperties) : null),
  };

  return (
    <figure
      className={cx('lm-avatar', className)}
      data-size={typeof size === 'number' ? 'px' : size}
      data-small={small || undefined}
      data-handles={interactive?.handles ?? 'always'}
      data-dragging={active ?? undefined}
      data-body={body}
      style={figureStyle}
    >
      <div ref={stageRef} className="lm-avatar__stage lm-stage">
        {underlay ? underlay({ layout: L, view, sideCentreCm: (geo.side.extent.minX + geo.side.extent.maxX) / 2 }) : null}
        <svg
          className="lm-avatar__svg"
          width="100%"
          height="100%"
          viewBox={`0 0 ${Math.round(L.width)} ${Math.round(L.height)}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-labelledby={titleId}
          aria-describedby={descId}
        >
          <title id={titleId}>{label ?? autoLabel}</title>
          <desc id={descId}>Inner shape: lean tissue. Outer layer: fat.{compareTo ? ' Outline: the start state.' : ''}</desc>
          {showRuler ? <Ruler L={L} heightCm={params.heightCm} units={units} text={hText} /> : null}
          {frontT ? (
            <g className="lm-avatar__fig" data-layer={silhouette ? 'silhouette' : 'layers'} transform={frontT} {...figureDragProps}>
              <path className="lm-avatar__env" d={paths.frontEnv} />
              <path className="lm-avatar__env" d={paths.armsEnv[0]} />
              <path className="lm-avatar__env" d={paths.armsEnv[1]} />
              {silhouette ? null : (
                <>
                  <path className="lm-avatar__core" d={paths.frontCore} />
                  <path className="lm-avatar__core" d={paths.armsCore[0]} />
                  <path className="lm-avatar__core" d={paths.armsCore[1]} />
                </>
              )}
              <path className="lm-avatar__head" d={paths.frontHead} />
              {silhouette
                ? null
                : paths.definition.map((s) => <path key={s.id} className="lm-avatar__def" d={s.d} style={{ opacity: s.opacity }} />)}
              {showVisceral && !silhouette ? <ellipse className="lm-avatar__visc" cx={v.cx} cy={v.cy} rx={v.rx} ry={v.ry} /> : null}
              {ghostPaths ? (
                <GhostOutline id={`${maskId}f`} body={ghostPaths.frontBody} head={ghostPaths.frontHead} arms={ghostPaths.frontArms} />
              ) : null}
            </g>
          ) : null}
          {sideT ? (
            <g className="lm-avatar__fig" data-layer={silhouette ? 'silhouette' : 'layers'} transform={sideT} {...figureDragProps}>
              <path className="lm-avatar__env" d={paths.sideEnv} />
              {silhouette ? null : <path className="lm-avatar__core" d={paths.sideCore} />}
              <path className="lm-avatar__head" d={paths.sideHead} />
              {showVisceral && !silhouette ? <path className="lm-avatar__visc" d={paths.sideVisceral} /> : null}
              {ghostPaths ? <GhostOutline id={`${maskId}s`} body={ghostPaths.sideBody} head={ghostPaths.sideHead} arms={[]} /> : null}
            </g>
          ) : null}
          {measureIds.length ? <Measures L={L} g={geo} measures={showMeasures ?? {}} view={view} stacked={stackMeasures} /> : null}
          {L.viewLabelY !== null ? (
            <g className="lm-avatar__views" aria-hidden="true">
              {L.frontX !== null ? (
                <text x={L.frontX} y={L.viewLabelY}>
                  front
                </text>
              ) : null}
              {L.sideX !== null ? (
                <text x={L.sideX} y={L.viewLabelY}>
                  side
                </text>
              ) : null}
            </g>
          ) : null}
        </svg>
        {interactive && L.frontX !== null && !small ? (
          <div className="lm-avatar__handles">
            <span id={hintId} className="lm-sr">
              Arrow keys change the fat in this region. Hold Shift with the arrows to change muscle instead.
            </span>
            {HANDLE_ORDER.map((region) => {
              const p = geo.front.handles[region];
              const pos = toPx(p);
              const val = interactive.values?.[region];
              const reason = interactive.disabled?.[region];
              const off = Boolean(reason);
              const sign = p[0] < 0 ? -1 : 1;
              return (
                <div
                  key={region}
                  className="lm-avatar__handle"
                  data-region={region}
                  data-side={sign < 0 ? 'left' : 'right'}
                  data-active={active === region || undefined}
                  style={{ left: pos.left, top: pos.top }}
                  role={val ? 'slider' : 'button'}
                  tabIndex={0}
                  aria-label={`${HANDLE_NAME[region]} fat, on the figure`}
                  aria-valuemin={val?.min}
                  aria-valuemax={val?.max}
                  aria-valuenow={val?.value}
                  aria-valuetext={val?.text}
                  aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown PageUp PageDown"
                  aria-disabled={off || undefined}
                  aria-describedby={MUSCLE_CHANNEL[region] ? hintId : undefined}
                  title={typeof reason === 'string' ? reason : undefined}
                  onPointerDown={(e) => startDrag(e, region, sign)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onKeyDown={(e) => onHandleKey(e, region)}
                >
                  <span className="lm-avatar__cap" aria-hidden="true" />
                </div>
              );
            })}
          </div>
        ) : null}
        {tip ? (
          <div className="lm-avatar__tip" style={{ left: tip.x, top: tip.y }} aria-hidden="true">
            {describe(tip.region, tip.channel)}
          </div>
        ) : null}
      </div>
      {caption !== false && !tiny ? <figcaption className="lm-avatar__caption">{caption ?? DEFAULT_CAPTION}</figcaption> : null}
    </figure>
  );
}
