// The lazily loaded WebGL part of <Figure3D> (asset loader, fitter, renderer). Kept in its own chunk; the wrapper in
// Figure3D.tsx shows the SVG figure until this has drawn its first frame, and for good if WebGL2 or the asset fails,
// the context is lost or the device turns out too slow (body-figure-v2.md §5.3).

import {
  useEffect,
  useImperativeHandle,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type Ref,
} from 'react';
import type { AvatarParams } from '@/engine/body';
import { motionTokens } from '@/features/body/avatar/motion';
import { loadFigure } from './asset';
import { markSlowDevice } from './device';
import type { FitResult } from './fit';
import type { MorphState } from './model';
import { FigureRenderer, readColours, type FigureLayout, type FigureView } from './renderer';
import type { FigureColours, FigureFrame } from './renderer';
import { FigureScene, coreState, lerpState } from './scene';
import { loadAnatomy, type AnatomyAsset } from './anatomyAsset';
import { compositionFromParams } from './composition';
import { clampFatToAnatomy } from './fatClearance';
import { insetSubcutaneousShell, partitionSubcutaneousShell } from './subcutaneousShell';
import {
  DEFAULT_VIEW,
  KEY_PAN,
  KEY_TILT,
  KEY_TURN,
  ZOOM_STEP,
  canZoomIn,
  canZoomOut,
  isDefaultView,
  isFacingFront,
  lerpView,
  nearestTurn,
  panView,
  tiltView,
  zoomView,
  type ViewCamera,
} from './camera';
import { PointerGestures, type PointerMode } from './viewGesture';

/** What the wrapper's zoom and reset buttons call. */
export interface FigureViewControl {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
}

/** What the wrapper needs to know to dim a button that can do nothing. */
export interface FigureViewState {
  canZoomIn: boolean;
  canZoomOut: boolean;
  canReset: boolean;
}
import { AnatomyClient } from './anatomyClient';

/** Half extents (cm) the overlay's stage must fit for the 3D body: front about x = 0, side about the side plumb line. */
export interface MeshExtent {
  front: number;
  side: number;
  height: number;
}

export interface Figure3DCanvasProps {
  params: AvatarParams;
  frame: number;
  compareTo?: AvatarParams;
  views: readonly FigureView[];
  layers: 'envelope' | 'two-layer';
  anatomyLayers?: {
    skin: boolean;
    subcutaneousFat: boolean;
    muscles: boolean;
    skeleton: boolean;
  };
  /** Slow turn for the single-view figure. The wrapper may pause it. */
  autoRotate?: boolean;
  /** Decorative small figures must not create a nested keyboard target. */
  interactive?: boolean;
  /**
   * The full set of view controls, as in a 3D viewport: left-drag turns and tilts, middle or right drag (or shift +
   * left drag) pans, the wheel and a trackpad pinch zoom toward the pointer; on touch one finger turns, two pinch and
   * pan; the keys turn, tilt, zoom and (with shift) pan. Off for thumbnails, which keep the plain turn.
   */
  viewControls?: boolean;
  /** Handle for the wrapper's zoom in, zoom out and reset buttons. */
  controlRef?: Ref<FigureViewControl>;
  /** The person turned or tilted the figure by hand: the wrapper pauses the slow auto-turn. */
  onUserTurn?: () => void;
  /** Fires when zoom or reset become available or unavailable. */
  onViewState?: (state: FigureViewState) => void;
  reducedMotion: boolean;
  /** Tween discrete jumps (default true). Off where the parent animates continuously (results Play, crosshair). */
  tween?: boolean;
  /**
   * The SVG overlay's stage layout (CSS px of the canvas box): the canvas draws in register with its ruler, labels and
   * handles. `sideCentreCm` is the centre of the overlay's side drawing relative to its plumb line.
   */
  layout?: { layout: FigureLayout; sideCentreCm: number } | null;
  onFail: (reason: string) => void;
  /** First frame drawn: the wrapper cross-fades from the SVG body. */
  onReady?: () => void;
  /** The mesh's extents grew or shrank (rounded up to whole cm): the overlay widens its stage to fit. */
  onExtent?: (e: MeshExtent) => void;
  /** Dev instrumentation: latest fit timing/errors, batched while a control moves. */
  onFit?: (fit: FitResult) => void;
}

/** Stage headroom above the head, as a fraction of stature (even-split mode, no overlay). */
const HEADROOM = 0.04;
/** Slow device (body-figure-v2.md §5.3): the first 60 frames average more than 1/30 s of drawing work. */
const SLOW_FRAMES = 60;
const SLOW_MS = 1000 / 30;
/** Keep main-thread skin/fat rebuilds bounded while a range control moves. */
export const SHAPE_FRAME_MS = 1000 / 15;

interface SceneState {
  scene: FigureScene | null;
  renderer: FigureRenderer | null;
  fit: FitResult | null;
  shown: MorphState | null;
  ghost: { key: AvatarParams; frame: number; state: MorphState; heightCm: number } | null;
  anim: number;
  draw: () => void;
  bufs: [Float32Array | undefined, Float32Array | undefined, Float32Array | undefined];
  cost: { frames: number; ms: number };
  extentKey: string;
  ready: boolean;
  shapeDirty: boolean;
  geometryRevision: number;
  frameCache: FigureFrame | null;
  anatomy: AnatomyAsset | null;
  anatomyClient: AnatomyClient | null;
  placementPending: boolean;
  displayedWeight: number;
  displayedVersion: number;
  shapeVersion: number;
  completed: { version: number; frame: FigureFrame } | null;
  shapeTimer: ReturnType<typeof setTimeout> | null;
  lastShapeAt: number;
  shapeInteraction: boolean;
  fitTimer: ReturnType<typeof setTimeout> | null;
  pendingFit: { latest: Latest; canvas: Element | null } | null;
  lastFitAt: number;
  fitInput: Latest | null;
  fitObserverTimer: ReturnType<typeof setTimeout> | null;
  colours: FigureColours | null;
  angle: number;
  spinAnim: number;
  lastTick: number;
  resumeAt: number;
  dragging: boolean;
  pointerX: number;
  visible: boolean;
  spinControl: () => void;
  /** The person's tilt, zoom and pan. */
  view: ViewCamera;
  /** Where a running button tween is heading (so quick repeat presses add up). */
  viewTarget: ViewCamera | null;
  camAnim: number;
  gestures: PointerGestures;
  viewKey: string;
  /** performance.now() of the last page scroll, and of the last wheel tick that zoomed the figure. */
  pageScrollAt: number;
  zoomWheelAt: number;
  /** Eases the camera to a target: `yaw` too when given, snapping to 0 at the end when `front`. */
  moveView: (to: { view: ViewCamera; yaw?: number; front?: boolean }) => void;
}

type Latest = Pick<
  Figure3DCanvasProps,
  'params' | 'frame' | 'compareTo' | 'reducedMotion' | 'tween' | 'onFit'
>;

/** A canonical fit makes the settled geometry independent of the drag history. */
export function fitForDisplay(scene: FigureScene, params: AvatarParams, frame: number): FitResult {
  return scene.fit(params, frame);
}

/** Fits the latest params and tweens discrete jumps outside a slider gesture. */
function runFit(s: SceneState, L: Latest, canvas: Element | null): void {
  const { scene } = s;
  if (!scene) return;
  s.lastFitAt = performance.now();
  const fit = s.shapeInteraction
    ? scene.fit(L.params, L.frame, s.fit ?? undefined)
    : fitForDisplay(scene, L.params, L.frame);
  if (canvas instanceof HTMLElement) canvas.dataset.fitMs = Number(fit.ms ?? 0).toFixed(2);
  if (s.fitObserverTimer) clearTimeout(s.fitObserverTimer);
  s.fitObserverTimer = null;
  if (s.shapeInteraction)
    s.fitObserverTimer = setTimeout(() => {
      s.fitObserverTimer = null;
      L.onFit?.(fit);
    }, 200);
  else L.onFit?.(fit);
  // the start body is fitted once per (start, frame), not on every crosshair step
  if (!L.compareTo) s.ghost = null;
  else if (!s.ghost || s.ghost.key !== L.compareTo || s.ghost.frame !== L.frame) {
    const g = scene.fit(L.compareTo, L.frame);
    s.ghost = { key: L.compareTo, frame: L.frame, state: g.state, heightCm: L.compareTo.heightCm };
  }
  const from = s.shown;
  s.fit = fit;
  s.fitInput = L;
  cancelAnimationFrame(s.anim);
  const same =
    from &&
    from.frame === fit.state.frame &&
    from.muscle === fit.state.muscle &&
    from.weight === fit.state.weight &&
    Object.keys(fit.state.locals).every((id) => from.locals[id] === fit.state.locals[id]);
  if (!from || same || s.shapeInteraction || L.reducedMotion || L.tween === false) {
    s.shown = fit.state;
    s.shapeDirty = true;
    s.draw();
    return;
  }
  const { durationMs, ease } = tween(canvas);
  const t0 = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / durationMs);
    s.shown = lerpState(from, fit.state, ease(t));
    s.shapeDirty = true;
    s.draw();
    if (t < 1) s.anim = requestAnimationFrame(step);
  };
  s.anim = requestAnimationFrame(step);
}

/** Input never performs several fits inside one skin-preview interval. */
function requestFit(s: SceneState, L: Latest, canvas: Element | null): void {
  if (
    s.fitInput?.params === L.params &&
    s.fitInput.frame === L.frame &&
    s.fitInput.compareTo === L.compareTo
  ) {
    if (s.fitTimer) clearTimeout(s.fitTimer);
    s.fitTimer = null;
    s.pendingFit = null;
    return;
  }
  s.pendingFit = { latest: L, canvas };
  const apply = () => {
    s.fitTimer = null;
    const pending = s.pendingFit;
    s.pendingFit = null;
    if (pending) runFit(s, pending.latest, pending.canvas);
  };
  const wait = SHAPE_FRAME_MS - (performance.now() - s.lastFitAt);
  if (wait <= 0 || !s.fit) {
    if (s.fitTimer) clearTimeout(s.fitTimer);
    apply();
  } else s.fitTimer ??= setTimeout(apply, wait);
}

let scenePromise: Promise<FigureScene> | null = null;
export function loadScene(): Promise<FigureScene> {
  scenePromise ??= loadFigure().then((a) => new FigureScene(a));
  scenePromise.catch(() => (scenePromise = null));
  return scenePromise;
}

const layoutKey = (l: Figure3DCanvasProps['layout']) =>
  l
    ? `${l.layout.width}|${l.layout.height}|${l.layout.k}|${l.layout.floorY}|${l.layout.x.front}|${l.layout.x.side}|${l.sideCentreCm}`
    : '';

/** How long a zoom or reset button takes to settle. */
const VIEW_MS = 240;

/** A hand on the figure (or a key) takes over from any button tween. */
function stopViewTween(s: SceneState): void {
  cancelAnimationFrame(s.camAnim);
  s.camAnim = 0;
  s.viewTarget = null;
}

/** A point in client px as clip units of the canvas (0,0 = middle, up and right positive). */
function clipPoint(canvas: HTMLCanvasElement, x: number, y: number): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((x - r.left) / Math.max(1, r.width)) * 2 - 1,
    y: 1 - ((y - r.top) / Math.max(1, r.height)) * 2,
  };
}

function zoomStep(s: SceneState, factor: number): void {
  s.moveView({ view: zoomView(s.viewTarget ?? s.view, factor) });
}

const viewControlsOn = (L: Figure3DCanvasProps) =>
  L.viewControls === true && L.interactive !== false && L.views.length === 1;

export default function Figure3DCanvas(props: Figure3DCanvasProps) {
  const { params, frame, compareTo, views, layers, layout } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const st = useRef<SceneState>({
    scene: null,
    renderer: null,
    fit: null,
    shown: null,
    ghost: null,
    anim: 0,
    draw: () => {},
    bufs: [undefined, undefined, undefined],
    cost: { frames: 0, ms: 0 },
    extentKey: '',
    ready: false,
    shapeDirty: true,
    geometryRevision: 0,
    frameCache: null,
    anatomy: null,
    anatomyClient: null,
    placementPending: false,
    displayedWeight: 0.5,
    displayedVersion: 0,
    shapeVersion: 0,
    completed: null,
    shapeTimer: null,
    lastShapeAt: -Infinity,
    shapeInteraction: false,
    fitTimer: null,
    pendingFit: null,
    lastFitAt: -Infinity,
    fitInput: null,
    fitObserverTimer: null,
    colours: null,
    angle: 0,
    spinAnim: 0,
    lastTick: 0,
    resumeAt: 0,
    dragging: false,
    pointerX: 0,
    visible: true,
    spinControl: () => {},
    view: DEFAULT_VIEW,
    viewTarget: null,
    camAnim: 0,
    gestures: new PointerGestures(),
    viewKey: '',
    pageScrollAt: -1e9,
    zoomWheelAt: -1e9,
    moveView: () => {},
  });
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  // mount: load the scene, create the renderer, keep the canvas sized to its box
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = st.current;
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    let io: IntersectionObserver | null = null;
    let themeObserver: MutationObserver | null = null;
    let shapePointerHeld = false;
    let shapeIdleTimer: ReturnType<typeof setTimeout> | null = null;
    const rangeTarget = (target: EventTarget | null) =>
      target instanceof Element && !!target.closest('input[type="range"], [role="slider"]');
    const revealCompleted = () => {
      s.shapeInteraction = false;
      if (s.fitTimer) clearTimeout(s.fitTimer);
      s.fitTimer = null;
      s.pendingFit = null;
      // Preview solves may be warm-started; release always uses the same cold
      // solve as a direct set, with no history-dependent final geometry.
      runFit(s, { ...latest.current, tween: false }, canvas);
    };
    const hideAnatomy = () => {
      s.shapeInteraction = true;
      const f = s.frameCache;
      if (
        f?.anatomy &&
        (f.anatomy.layers.skin || f.anatomy.layers.subcutaneousFat) &&
        (f.anatomy.layers.muscles || f.anatomy.layers.skeleton)
      ) {
        s.frameCache = {
          ...f,
          anatomy: { ...f.anatomy, layers: { ...f.anatomy.layers, muscles: false, skeleton: false } },
        };
        s.draw();
      }
    };
    const shapeDown = (event: Event) => {
      if (!rangeTarget(event.target)) return;
      shapePointerHeld = true;
      if (shapeIdleTimer) clearTimeout(shapeIdleTimer);
      hideAnatomy();
    };
    const shapeInput = (event: Event) => {
      if (!rangeTarget(event.target)) return;
      hideAnatomy();
      if (shapeIdleTimer) clearTimeout(shapeIdleTimer);
      if (!shapePointerHeld) shapeIdleTimer = setTimeout(revealCompleted, 200);
    };
    const shapeUp = () => {
      if (!shapePointerHeld) return;
      shapePointerHeld = false;
      if (shapeIdleTimer) clearTimeout(shapeIdleTimer);
      revealCompleted();
    };
    window.addEventListener('pointerdown', shapeDown, true);
    window.addEventListener('input', shapeInput, true);
    window.addEventListener('pointerup', shapeUp, true);
    window.addEventListener('pointercancel', shapeUp, true);
    const spin = (now: number) => {
      s.spinAnim = 0;
      const L = latest.current;
      if (
        !s.visible ||
        document.hidden ||
        document.activeElement === canvas ||
        L.reducedMotion ||
        L.autoRotate === false ||
        L.views.length !== 1 ||
        !s.renderer
      )
        return;
      const dt = s.lastTick ? Math.max(0, now - s.lastTick) : 0;
      s.lastTick = now;
      if (!s.dragging && document.activeElement !== canvas && now >= s.resumeAt) {
        s.angle = (s.angle + dt * ((Math.PI * 2) / 75_000)) % (Math.PI * 2);
        s.draw();
      }
      s.spinAnim = requestAnimationFrame(spin);
    };
    const scheduleSpin = () => {
      if (s.spinAnim) cancelAnimationFrame(s.spinAnim);
      s.spinAnim = 0;
      s.lastTick = 0;
      const L = latest.current;
      if (
        s.visible &&
        !document.hidden &&
        document.activeElement !== canvas &&
        !L.reducedMotion &&
        L.autoRotate !== false &&
        L.views.length === 1 &&
        s.renderer
      ) {
        s.spinAnim = requestAnimationFrame(spin);
      }
    };
    const visibility = () => scheduleSpin();
    const blur = () => {
      s.gestures.clear();
      s.dragging = false;
      shapePointerHeld = false;
      if (shapeIdleTimer) clearTimeout(shapeIdleTimer);
      if (s.shapeInteraction) revealCompleted();
      s.resumeAt = performance.now() + 2000;
    };
    s.spinControl = scheduleSpin;
    s.moveView = (to) => {
      cancelAnimationFrame(s.camAnim);
      s.camAnim = 0;
      s.viewTarget = to.view;
      const settle = () => {
        s.view = to.view;
        s.viewTarget = null;
        s.camAnim = 0;
        if (to.front) s.angle = 0;
        else if (to.yaw !== undefined) s.angle = to.yaw;
        s.draw();
      };
      if (latest.current.reducedMotion) {
        settle();
        return;
      }
      const from = { yaw: s.angle, view: s.view };
      const t0 = performance.now();
      // the slow auto-turn waits while the figure is eased round to the front
      if (to.yaw !== undefined) s.resumeAt = Math.max(s.resumeAt, t0 + VIEW_MS + 50);
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / VIEW_MS);
        const e = 1 - (1 - t) ** 3;
        if (t >= 1) {
          settle();
          return;
        }
        s.view = lerpView(from.view, to.view, e);
        if (to.yaw !== undefined) s.angle = from.yaw + (to.yaw - from.yaw) * e;
        s.draw();
        s.camAnim = requestAnimationFrame(step);
      };
      s.camAnim = requestAnimationFrame(step);
    };
    // Wheel and trackpad pinch (which arrives as ctrl + wheel) zoom toward the pointer, only while the pointer is over
    // the figure. A page scroll already under way carries on past it, so scrolling by never turns into a zoom.
    const onPageScroll = () => {
      s.pageScrollAt = performance.now();
    };
    window.addEventListener('scroll', onPageScroll, { passive: true, capture: true });
    const onWheel = (e: WheelEvent) => {
      const L = latest.current;
      if (!viewControlsOn(L) || !s.renderer) return;
      const now = performance.now();
      const pinch = e.ctrlKey || e.metaKey;
      if (!pinch && now - s.pageScrollAt < 200 && now - s.zoomWheelAt > 400) return;
      e.preventDefault();
      s.zoomWheelAt = now;
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY;
      const exponent = Math.max(-0.22, Math.min(0.22, -px * (e.ctrlKey ? 0.01 : 0.002)));
      const at = clipPoint(canvas, e.clientX, e.clientY);
      stopViewTween(s);
      s.view = zoomView(s.view, Math.exp(exponent), at.x, at.y);
      s.draw();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    const onContextLost = () => latest.current.onFail('WebGL context lost');
    canvas.addEventListener('webglcontextlost', onContextLost);
    const draw = () => {
      const { scene, renderer, shown } = s;
      if (!scene || !renderer || !shown) return;
      if (renderer.lost) {
        latest.current.onFail('WebGL context lost');
        return;
      }
      const t0 = performance.now();
      const L = latest.current;
      if (s.shapeDirty && s.frameCache && t0 - s.lastShapeAt < SHAPE_FRAME_MS) {
        s.shapeTimer ??= setTimeout(
          () => {
            s.shapeTimer = null;
            draw();
          },
          SHAPE_FRAME_MS - (t0 - s.lastShapeAt),
        );
        return;
      }
      if (s.shapeDirty || (!s.frameCache && !s.placementPending)) {
        if (s.shapeTimer) clearTimeout(s.shapeTimer);
        s.shapeTimer = null;
        s.lastShapeAt = t0;
        const version = ++s.shapeVersion;
        const composition = L.anatomyLayers ? compositionFromParams(L.params, L.frame) : null;
        const needsAnatomy = !!(L.anatomyLayers?.muscles || L.anatomyLayers?.skeleton);
        if (needsAnatomy && s.anatomy && !s.anatomyClient) {
          s.anatomyClient = new AnatomyClient(s.anatomy, scene.model.vertexCount * 3, (reason) => {
            if (!cancelled) latest.current.onFail(reason);
          });
        }
        // Pending frames own their skin/core buffers. Keep the currently drawn
        // frame intact until the worker returns the matching anatomy geometry.
        const asyncPlacement = needsAnatomy && !!composition && !!s.anatomyClient;
        const body = scene.place(shown, L.params.heightCm, asyncPlacement ? undefined : s.bufs[0]);
        s.bufs[0] = body.positions;
        let core: Float32Array | null = null;
        // Muscles and bones are placed under the fat's inner boundary, so it is built whenever they show.
        if (L.layers === 'two-layer' || L.anatomyLayers?.subcutaneousFat || needsAnatomy) {
          core = scene.place(
            coreState(shown),
            L.params.heightCm,
            asyncPlacement ? undefined : s.bufs[1],
            body.armSpacing,
          ).positions;
          s.bufs[1] = core;
          if (composition) {
            partitionSubcutaneousShell({
              outer: body.positions,
              inner: core,
              heightCm: L.params.heightCm,
              waistHalfWidthCm: L.params.visceral.waist.halfWidthCm,
              waistHalfDepthCm: L.params.visceral.waist.halfDepthCm,
              waistCentreZCm: body.centre.side,
              visceralKg: composition.visceral.massKg,
              trunkSatKg: composition.subcutaneous.trunk.massKg,
              trunkShares: composition.subcutaneous.trunkShares,
            });
          }
          // The inner fat boundary is an inset of this skin, so it stays whole and inside it.
          insetSubcutaneousShell(
            body.positions,
            core,
            scene.model.indices,
            L.params.heightCm,
            scene.model.asset.thickness,
            Number(scene.model.manifest.stats.referenceHeightCm) || 166,
            scene.model.base,
            scene.model.manifest.shell?.pinned,
          );
        }
        let ghost: Float32Array | null = null;
        let ghostHalf = { front: 0, side: 0, height: 0 };
        if (s.ghost) {
          const g = scene.place(s.ghost.state, s.ghost.heightCm, asyncPlacement ? undefined : s.bufs[2]);
          s.bufs[2] = g.positions;
          ghost = g.positions;
          ghostHalf = {
            front: Math.abs(g.centre.front) + g.half.front,
            side: g.half.side,
            height: g.heightCm,
          };
        }
        const over = L.layout;
        const pixel: FigureLayout | null = over
          ? {
              ...over.layout,
              x: {
                ...(over.layout.x.front !== undefined ? { front: over.layout.x.front } : {}),
                ...(over.layout.x.side !== undefined
                  ? { side: over.layout.x.side + over.sideCentreCm * over.layout.k }
                  : {}),
              },
            }
          : null;
        s.geometryRevision++;
        const nextFrame: FigureFrame = {
          positions: body.positions,
          core,
          ghost,
          views: L.views,
          stageCm: L.params.heightCm * (1 + HEADROOM),
          centre: { front: pixel ? 0 : body.centre.front, side: body.centre.side },
          layout: pixel,
          colours: (s.colours ??= readColours(canvas)),
          geometryRevision: s.geometryRevision,
          ...(composition && L.anatomyLayers
            ? { anatomy: { positions: undefined, composition, layers: L.anatomyLayers } }
            : {}),
        };
        const nextWeight = shown.weight;
        const presentationKey = `${L.views.join('|')}|${layoutKey(L.layout)}|${L.layers}`;
        // The current skin/fat never waits for the worker. Stale internal layers
        // remain hidden rather than intersecting a newer envelope.
        const hasEnvelope =
          !L.anatomyLayers ||
          L.anatomyLayers.skin ||
          L.anatomyLayers.subcutaneousFat ||
          L.layers === 'two-layer';
        if (hasEnvelope || !needsAnatomy) {
          s.frameCache = {
            ...nextFrame,
            anatomy: nextFrame.anatomy
              ? {
                  ...nextFrame.anatomy,
                  layers: { ...nextFrame.anatomy.layers, muscles: false, skeleton: false },
                }
              : undefined,
          };
          s.displayedWeight = nextWeight;
          s.displayedVersion = version;
        }
        if (asyncPlacement && composition && s.anatomyClient) {
          s.placementPending = true;
          canvas.dataset.anatomyPending = 'true';
          const submitStart = performance.now();
          s.anatomyClient.place(
            {
              skin: body.positions,
              inner: core,
              heightCm: L.params.heightCm,
              frame: shown.frame,
              composition,
            },
            (reply) => {
              if (cancelled) return;
              nextFrame.anatomy!.positions = reply.positions;
              nextFrame.colours = s.colours ?? nextFrame.colours;
              s.completed = { version, frame: nextFrame };
              canvas.dataset.anatomyCompleted = String(version);
              canvas.dataset.anatomyWorkerMs = (reply.processingMs ?? 0).toFixed(2);
              const currentLayers = latest.current.anatomyLayers;
              if (
                currentLayers &&
                !currentLayers.skin &&
                !currentLayers.subcutaneousFat &&
                latest.current.layers !== 'two-layer' &&
                presentationKey ===
                  `${latest.current.views.join('|')}|${layoutKey(latest.current.layout)}|${latest.current.layers}`
              ) {
                // With no envelope on screen, every completed atlas can be shown
                // directly at worker cadence, including during continuous input.
                nextFrame.anatomy!.layers = { ...currentLayers };
                s.frameCache = nextFrame;
                s.displayedWeight = nextWeight;
                s.displayedVersion = version;
                draw();
              }
              // Every completion is retained, even when a newer shape is queued.
              // Its atlas can only become visible with its matching skin/fat.
              if (version !== s.shapeVersion) return;
              const commitStart = performance.now();
              if (core && reply.room)
                clampFatToAnatomy(body.positions, core, scene.model.indices, reply.room, L.params.heightCm);
              nextFrame.geometryRevision = ++s.geometryRevision;
              if (!s.shapeInteraction && !s.shapeDirty) s.frameCache = nextFrame;
              s.placementPending = false;
              canvas.dataset.anatomyPending = 'false';
              draw();
              canvas.dataset.anatomyCommitMs = (performance.now() - commitStart).toFixed(2);
            },
          );
          canvas.dataset.anatomySubmitMs = (performance.now() - submitStart).toFixed(2);
        } else {
          s.anatomyClient?.cancel();
          s.placementPending = false;
          s.completed = null;
          canvas.dataset.anatomyPending = 'false';
          s.frameCache = nextFrame;
          s.displayedWeight = nextWeight;
          s.displayedVersion = version;
        }
        if (over && L.onExtent) {
          const e: MeshExtent = {
            front: Math.ceil(Math.max(Math.abs(body.centre.front) + body.half.front, ghostHalf.front)),
            side: Math.ceil(Math.abs(over.sideCentreCm) + Math.max(body.half.side, ghostHalf.side)),
            height: Math.ceil(Math.max(body.heightCm, ghostHalf.height)),
          };
          const key = `${e.front}|${e.side}|${e.height}`;
          if (key !== s.extentKey) {
            s.extentKey = key;
            L.onExtent(e);
          }
        }
        s.shapeDirty = false;
      }
      const f = s.frameCache;
      if (!f) return;
      // Instrument only displayed frames; asynchronous skin/anatomy commits are atomic.
      canvas.dataset.draws = String(Number(canvas.dataset.draws ?? 0) + 1);
      canvas.dataset.weight = s.displayedWeight.toFixed(3);
      canvas.dataset.angleRad = s.angle.toFixed(5);
      canvas.dataset.zoom = s.view.zoom.toFixed(3);
      canvas.dataset.pitchRad = s.view.pitch.toFixed(4);
      canvas.dataset.pan = `${s.view.panX.toFixed(3)},${s.view.panY.toFixed(3)}`;
      canvas.dataset.shapeRevision = String(s.displayedVersion);
      canvas.dataset.anatomyVisible = String(
        !!f.anatomy?.positions && (f.anatomy.layers.muscles || f.anatomy.layers.skeleton),
      );
      f.angleRad = s.angle;
      f.camera = s.view;
      renderer.draw(f);
      canvas.dataset.drawMs = (performance.now() - t0).toFixed(2);
      if (L.onViewState) {
        const next: FigureViewState = {
          canZoomIn: canZoomIn(s.view),
          canZoomOut: canZoomOut(s.view),
          canReset: !isDefaultView(s.view) || !isFacingFront(s.angle),
        };
        const key = `${+next.canZoomIn}${+next.canZoomOut}${+next.canReset}`;
        if (key !== s.viewKey) {
          s.viewKey = key;
          L.onViewState(next);
        }
      }
      if (!s.ready) {
        s.ready = true;
        L.onReady?.();
      }
      // slow device: average drawing work over the first frames
      if (s.cost.frames < SLOW_FRAMES) {
        s.cost.frames += 1;
        s.cost.ms += performance.now() - t0;
        if (s.cost.frames === SLOW_FRAMES && s.cost.ms / SLOW_FRAMES > SLOW_MS) {
          markSlowDevice();
          L.onFail('slow device');
        }
      }
    };
    s.draw = draw;
    Promise.all([loadScene(), latest.current.anatomyLayers ? loadAnatomy() : Promise.resolve(null)])
      .then(([scene, anatomy]) => {
        if (cancelled) return;
        s.scene = scene;
        s.anatomy = anatomy;
        s.renderer = new FigureRenderer(canvas, scene.model.indices, scene.model.vertexCount);
        if (anatomy) s.renderer.setAnatomy(anatomy);
        const resize = () => {
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
          const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }
          draw();
        };
        ro = new ResizeObserver(resize);
        ro.observe(canvas);
        if (typeof IntersectionObserver !== 'undefined') {
          io = new IntersectionObserver(([entry]) => {
            s.visible = !!entry?.isIntersecting;
            scheduleSpin();
          });
          io.observe(canvas);
        }
        document.addEventListener('visibilitychange', visibility);
        window.addEventListener('blur', blur);
        themeObserver = new MutationObserver(() => {
          s.colours = readColours(canvas);
          if (s.frameCache) s.frameCache.colours = s.colours;
          if (s.completed) s.completed.frame.colours = s.colours;
          s.draw();
        });
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['class', 'data-theme', 'style'],
        });
        runFit(s, latest.current, canvas);
        resize();
        scheduleSpin();
      })
      .catch((e: unknown) => {
        if (!cancelled) latest.current.onFail(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
      ro?.disconnect();
      io?.disconnect();
      themeObserver?.disconnect();
      if (s.shapeTimer) clearTimeout(s.shapeTimer);
      if (s.fitTimer) clearTimeout(s.fitTimer);
      if (s.fitObserverTimer) clearTimeout(s.fitObserverTimer);
      s.fitObserverTimer = null;
      s.fitTimer = null;
      s.pendingFit = null;
      if (shapeIdleTimer) clearTimeout(shapeIdleTimer);
      s.shapeTimer = null;
      s.completed = null;
      window.removeEventListener('pointerdown', shapeDown, true);
      window.removeEventListener('input', shapeInput, true);
      window.removeEventListener('pointerup', shapeUp, true);
      window.removeEventListener('pointercancel', shapeUp, true);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', blur);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('scroll', onPageScroll, { capture: true });
      cancelAnimationFrame(s.anim);
      cancelAnimationFrame(s.spinAnim);
      stopViewTween(s);
      s.anim = 0;
      s.spinAnim = 0;
      s.gestures.clear();
      s.view = DEFAULT_VIEW;
      s.viewKey = '';
      s.moveView = () => {};
      s.renderer?.dispose();
      s.anatomyClient?.dispose();
      s.anatomyClient = null;
      s.renderer = null;
      s.scene = null;
      s.anatomy = null;
      s.placementPending = false;
      s.frameCache = null;
      s.bufs = [undefined, undefined, undefined];
      s.shown = null;
      s.fit = null;
      s.fitInput = null;
      s.colours = null;
      s.ghost = null;
      s.ready = false;
      s.shapeDirty = true;
      s.cost = { frames: 0, ms: 0 };
      s.spinControl = () => {};
    };
  }, []);

  useEffect(() => {
    requestFit(st.current, latest.current, canvasRef.current);
  }, [params, frame, compareTo]);

  const lk = layoutKey(layout);
  const viewsKey = views.join('|');
  const anatomyKey = props.anatomyLayers ? Object.values(props.anatomyLayers).map(Number).join('|') : '';
  useEffect(() => {
    st.current.shapeDirty = true;
    st.current.draw();
  }, [viewsKey, layers, lk, anatomyKey]);

  useEffect(() => st.current.spinControl(), [props.autoRotate, props.reducedMotion, views]);

  useImperativeHandle(
    props.controlRef,
    () => ({
      zoomIn: () => zoomStep(st.current, ZOOM_STEP),
      zoomOut: () => zoomStep(st.current, 1 / ZOOM_STEP),
      reset: () => {
        const s = st.current;
        s.moveView({ view: DEFAULT_VIEW, yaw: nearestTurn(s.angle), front: true });
      },
    }),
    [],
  );

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const L = latest.current;
    if (L.interactive === false) return;
    // a mouse: left turns; middle, right and shift + left pan (with the full view controls). Touch: one finger turns.
    let mode: PointerMode = 'orbit';
    if (e.pointerType === 'mouse') {
      if (viewControlsOn(L) && (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey)))
        mode = 'pan';
      else if (e.button !== 0) return;
    }
    if (e.button === 1) e.preventDefault(); // no middle-click auto-scroll
    const s = st.current;
    stopViewTween(s);
    s.gestures.down(e.pointerId, e.clientX, e.clientY, mode);
    s.dragging = true;
    e.currentTarget.dataset.drag = mode;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // the pointer is already gone; the drag just ends
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const L = latest.current;
    if (L.interactive === false) return;
    const s = st.current;
    const step = s.gestures.move(e.pointerId, e.clientX, e.clientY);
    if (!step) return;
    const full = viewControlsOn(L);
    const canvas = e.currentTarget;
    if (step.kind === 'orbit') {
      // left and right turn about the vertical axis; up and down tilt a little (full view controls only)
      s.angle += step.dx * 0.012;
      if (full) s.view = tiltView(s.view, step.dy * 0.006);
      if (step.dx !== 0 || (full && step.dy !== 0)) L.onUserTurn?.();
    } else if (!full) {
      return;
    } else if (step.kind === 'pan') {
      const r = canvas.getBoundingClientRect();
      s.view = panView(s.view, (step.dx * 2) / Math.max(1, r.width), (-step.dy * 2) / Math.max(1, r.height));
    } else {
      // pinch zooms about where the fingers were, then the pair's own movement drags the picture
      const r = canvas.getBoundingClientRect();
      const was = clipPoint(canvas, step.midX - step.dMidX, step.midY - step.dMidY);
      s.view = panView(
        zoomView(s.view, step.scale, was.x, was.y),
        (step.dMidX * 2) / Math.max(1, r.width),
        (-step.dMidY * 2) / Math.max(1, r.height),
      );
    }
    s.draw();
  };
  const endDrag = (e: PointerEvent<HTMLCanvasElement>) => {
    const s = st.current;
    s.gestures.up(e.pointerId);
    s.dragging = s.gestures.count > 0;
    if (!s.dragging) {
      s.resumeAt = performance.now() + 2000;
      delete e.currentTarget.dataset.drag;
    }
  };
  const onBlur = () => {
    st.current.resumeAt = performance.now() + 2000;
    st.current.spinControl();
  };
  const onFocus = () => st.current.spinControl();
  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const L = latest.current;
    if (L.interactive === false || e.ctrlKey || e.metaKey || e.altKey) return;
    const s = st.current;
    const full = viewControlsOn(L);
    if (full && e.shiftKey && e.key.startsWith('Arrow')) {
      // shift + arrow moves the picture, for people who cannot drag
      e.preventDefault();
      stopViewTween(s);
      const dx = e.key === 'ArrowLeft' ? -KEY_PAN : e.key === 'ArrowRight' ? KEY_PAN : 0;
      const dy = e.key === 'ArrowUp' ? KEY_PAN : e.key === 'ArrowDown' ? -KEY_PAN : 0;
      s.view = panView(s.view, dx, dy);
      s.draw();
      return;
    }
    const turn = (dYaw: number, dPitch = 0) => {
      e.preventDefault();
      stopViewTween(s);
      s.angle += dYaw;
      if (dPitch) s.view = tiltView(s.view, dPitch);
      s.resumeAt = performance.now() + 2000;
      L.onUserTurn?.();
      s.draw();
    };
    if (e.key === 'ArrowLeft') return turn(-KEY_TURN);
    if (e.key === 'ArrowRight') return turn(KEY_TURN);
    if (!full) return;
    if (e.key === 'ArrowUp') return turn(0, -KEY_TILT);
    if (e.key === 'ArrowDown') return turn(0, KEY_TILT);
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      zoomStep(s, ZOOM_STEP);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      zoomStep(s, 1 / ZOOM_STEP);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className="lm-fig3d__canvas"
      role={props.interactive === false ? undefined : 'img'}
      aria-hidden={props.interactive === false ? true : undefined}
      aria-label={
        props.interactive === false
          ? undefined
          : props.viewControls
            ? '3D body figure. Drag or use the arrow keys to turn it, plus and minus to zoom, shift and arrow keys to move it.'
            : '3D body figure. Drag or use arrow keys to rotate.'
      }
      tabIndex={props.interactive === false ? -1 : 0}
      onPointerDown={onPointerDown}
      onMouseDown={(e) => {
        if (e.button === 1 && props.viewControls) e.preventDefault();
      }}
      onContextMenu={(e) => {
        // right-drag pans: no browser menu over the figure (anywhere else it stays)
        if (viewControlsOn(latest.current)) e.preventDefault();
      }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    />
  );
}

/** Discrete jumps use the needle duration with the in-out ease (no overshoot: weights beyond the fit would extrapolate). */
function tween(el: Element | null): { durationMs: number; ease: (t: number) => number } {
  const m = motionTokens(el);
  return { durationMs: m.needleMs, ease: m.morphEase };
}
