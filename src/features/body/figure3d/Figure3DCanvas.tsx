// The lazily loaded WebGL part of <Figure3D> (asset loader, fitter, renderer). Kept in its own chunk; the wrapper in
// Figure3D.tsx shows the SVG figure until this has drawn its first frame, and for good if WebGL2 or the asset fails,
// the context is lost or the device turns out too slow (body-figure-v2.md §5.3).

import { useEffect, useRef } from 'react';
import type { AvatarParams } from '@/engine/body';
import { motionTokens } from '@/features/body/avatar/motion';
import { loadFigure } from './asset';
import { markSlowDevice } from './device';
import type { FitResult } from './fit';
import type { MorphState } from './model';
import { FigureRenderer, readColours, type FigureLayout, type FigureView } from './renderer';
import { FigureScene, coreState, lerpState } from './scene';

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
  /** Dev instrumentation: fit timing and girth errors of every fit. */
  onFit?: (fit: FitResult) => void;
}

/** Stage headroom above the head, as a fraction of stature (even-split mode, no overlay). */
const HEADROOM = 0.04;
/** Slow device (body-figure-v2.md §5.3): the first 60 frames average more than 1/30 s of drawing work. */
const SLOW_FRAMES = 60;
const SLOW_MS = 1000 / 30;

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
}

type Latest = Pick<Figure3DCanvasProps, 'params' | 'frame' | 'compareTo' | 'reducedMotion' | 'tween' | 'onFit'>;

/** Fits the latest params (warm-started from the previous fit) and tweens the shown morph state to the result. */
function runFit(s: SceneState, L: Latest, canvas: Element | null): void {
  const { scene } = s;
  if (!scene) return;
  const fit = scene.fit(L.params, L.frame, s.fit ?? undefined);
  L.onFit?.(fit);
  // the start body is fitted once per (start, frame), not on every crosshair step
  if (!L.compareTo) s.ghost = null;
  else if (!s.ghost || s.ghost.key !== L.compareTo || s.ghost.frame !== L.frame) {
    const g = scene.fit(L.compareTo, L.frame);
    s.ghost = { key: L.compareTo, frame: L.frame, state: g.state, heightCm: L.compareTo.heightCm };
  }
  const from = s.shown;
  s.fit = fit;
  cancelAnimationFrame(s.anim);
  if (!from || L.reducedMotion || L.tween === false) {
    s.shown = fit.state;
    s.draw();
    return;
  }
  const { durationMs, ease } = tween(canvas);
  const t0 = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / durationMs);
    s.shown = lerpState(from, fit.state, ease(t));
    s.draw();
    if (t < 1) s.anim = requestAnimationFrame(step);
  };
  s.anim = requestAnimationFrame(step);
}

let scenePromise: Promise<FigureScene> | null = null;
export function loadScene(): Promise<FigureScene> {
  scenePromise ??= loadFigure().then((a) => new FigureScene(a));
  scenePromise.catch(() => (scenePromise = null));
  return scenePromise;
}

const layoutKey = (l: Figure3DCanvasProps['layout']) =>
  l ? `${l.layout.width}|${l.layout.height}|${l.layout.k}|${l.layout.floorY}|${l.layout.x.front}|${l.layout.x.side}|${l.sideCentreCm}` : '';

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
    const draw = () => {
      const { scene, renderer, shown } = s;
      if (!scene || !renderer || !shown) return;
      if (renderer.lost) {
        latest.current.onFail('WebGL context lost');
        return;
      }
      const t0 = performance.now();
      const L = latest.current;
      // instrumentation for e2e checks (draw count, shown weight macro)
      canvas.dataset.draws = String(Number(canvas.dataset.draws ?? 0) + 1);
      canvas.dataset.weight = shown.weight.toFixed(3);
      const body = scene.place(shown, L.params.heightCm, s.bufs[0]);
      s.bufs[0] = body.positions;
      let core: Float32Array | null = null;
      if (L.layers === 'two-layer') {
        core = scene.place(coreState(shown), L.params.heightCm, s.bufs[1]).positions;
        s.bufs[1] = core;
      }
      let ghost: Float32Array | null = null;
      let ghostHalf = { front: 0, side: 0, height: 0 };
      if (s.ghost) {
        const g = scene.place(s.ghost.state, s.ghost.heightCm, s.bufs[2]);
        s.bufs[2] = g.positions;
        ghost = g.positions;
        ghostHalf = { front: Math.abs(g.centre.front) + g.half.front, side: g.half.side, height: g.heightCm };
      }
      const over = L.layout;
      const pixel: FigureLayout | null = over
        ? {
            ...over.layout,
            x: {
              ...(over.layout.x.front !== undefined ? { front: over.layout.x.front } : {}),
              ...(over.layout.x.side !== undefined ? { side: over.layout.x.side + over.sideCentreCm * over.layout.k } : {}),
            },
          }
        : null;
      renderer.draw({
        positions: body.positions,
        core,
        ghost,
        views: L.views,
        stageCm: L.params.heightCm * (1 + HEADROOM),
        // overlay mode: x = 0 is the overlay's centre line; the side view centres on the mesh's own depth extent
        centre: { front: pixel ? 0 : body.centre.front, side: body.centre.side },
        layout: pixel,
        colours: readColours(canvas),
      });
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
    loadScene()
      .then((scene) => {
        if (cancelled) return;
        s.scene = scene;
        s.renderer = new FigureRenderer(canvas, scene.model.indices, scene.model.vertexCount);
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
        runFit(s, latest.current, canvas);
        resize();
      })
      .catch((e: unknown) => {
        if (!cancelled) latest.current.onFail(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
      ro?.disconnect();
      cancelAnimationFrame(s.anim);
      s.renderer?.dispose();
      s.renderer = null;
    };
  }, []);

  useEffect(() => {
    runFit(st.current, latest.current, canvasRef.current);
  }, [params, frame, compareTo]);

  const lk = layoutKey(layout);
  useEffect(() => {
    st.current.draw();
  }, [views, layers, lk]);

  return <canvas ref={canvasRef} className="lm-fig3d__canvas" aria-hidden="true" />;
}

/** Discrete jumps use the needle duration with the in-out ease (no overshoot: weights beyond the fit would extrapolate). */
function tween(el: Element | null): { durationMs: number; ease: (t: number) => number } {
  const m = motionTokens(el);
  return { durationMs: m.needleMs, ease: m.morphEase };
}
