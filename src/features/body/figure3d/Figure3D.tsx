import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { Pause, Play, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import type { AvatarParams } from '@/engine/body';
import { Icon, useReducedMotion } from '@/components';
import {
  BodyAvatar,
  DEFAULT_CAPTION,
  describeAvatar,
  resolveFrame,
  type AvatarInteraction,
  type AvatarSize,
  type MeasureId,
} from '@/features/body/avatar';
import { VisceralView } from './visceral';
import { isSlowDevice } from './device';
import type { FitResult } from './fit';
import type { FigureView } from './renderer';
import type { FigureViewControl, FigureViewState } from './Figure3DCanvas';
import { VIEW_HINT, takeViewHint } from './viewHint';
import './figure3d.css';

const Figure3DCanvas = lazy(() => import('./Figure3DCanvas'));

/** Before the canvas reports otherwise: both zooms open, nothing to reset. */
const FRESH_VIEW: FigureViewState = { canZoomIn: true, canZoomOut: true, canReset: false };

export interface AnatomyLayers {
  skin: boolean;
  subcutaneousFat: boolean;
  muscles: boolean;
  skeleton: boolean;
}

const INITIAL_LAYERS: AnatomyLayers = {
  skin: true,
  subcutaneousFat: true,
  muscles: true,
  skeleton: true,
};

const LAYER_LABELS: { key: keyof AnatomyLayers; label: string }[] = [
  { key: 'skin', label: 'Skin' },
  { key: 'subcutaneousFat', label: 'Fat under skin' },
  { key: 'muscles', label: 'Muscles' },
  { key: 'skeleton', label: 'Bones' },
];

/** The one-time mouse hint: fades by itself (CSS) and is removed once it has. */
function ViewHint({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, 5200);
    return () => window.clearTimeout(t);
  }, [onDone]);
  return (
    <div className="lm-fig3d__hint" aria-hidden="true">
      {VIEW_HINT}
    </div>
  );
}

class CanvasErrorBoundary extends Component<
  { onError: (reason: string) => void; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError(`3D figure: ${error.message}`);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

export interface Figure3DProps {
  params: AvatarParams;
  frame?: number;
  visceral?: boolean;
  compareTo?: AvatarParams;
  /** Retained for the development page. Production presents one freely rotating person. */
  views?: readonly FigureView[];
  /** Retained for fallback appearance and older callers. */
  layers?: 'envelope' | 'two-layer';
  label?: string;
  caption?: ReactNode | false;
  forceSvg?: boolean;
  /** Hide controls for decorative or nested thumbnail uses. */
  controls?: boolean;
  /** Remove the canvas from keyboard and pointer interaction. */
  decorative?: boolean;
  size?: AvatarSize;
  units?: 'metric' | 'imperial';
  heightText?: string;
  showMeasures?: Partial<Record<MeasureId, string>>;
  /** Direct adjustment remains available on the vector fallback. */
  interactive?: AvatarInteraction;
  ruler?: boolean;
  tween?: boolean;
  className?: string;
  style?: CSSProperties;
  onFit?: (fit: FitResult) => void;
  onFallback?: (reason: string) => void;
  onReady?: () => void;
}

export function webgl2Available(): boolean {
  return typeof window !== 'undefined' && typeof window.WebGL2RenderingContext !== 'undefined';
}

export function Figure3D({
  params,
  frame,
  visceral = false,
  compareTo,
  views = ['front'],
  layers = 'two-layer',
  label,
  caption = DEFAULT_CAPTION,
  forceSvg = false,
  controls = true,
  decorative = false,
  size,
  units = 'metric',
  heightText,
  showMeasures,
  interactive,
  ruler,
  tween = true,
  className,
  style,
  onFit,
  onFallback,
  onReady,
}: Figure3DProps) {
  const reduced = useReducedMotion();
  const layersId = useId();
  const [failed, setFailed] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [anatomyLayers, setAnatomyLayers] = useState<AnatomyLayers>(INITIAL_LAYERS);
  const [rotating, setRotating] = useState(true);
  const [viewState, setViewState] = useState<FigureViewState>(FRESH_VIEW);
  const viewControl = useRef<FigureViewControl>(null);
  const [hint, setHint] = useState(false);
  const endHint = useCallback(() => setHint(false), []);
  const f = resolveFrame(params, frame);
  const useSvg = forceSvg || failed !== null || !webgl2Available() || isSlowDevice();
  const name =
    label ?? describeAvatar(params, { frame: f, heightText, measures: showMeasures, layers, compareTo });
  const compact = size === 'xs' || (typeof size === 'number' && size < 100);
  // thumbnails and plan-card figures keep the plain turn: no zoom, tilt or pan, and no room for the buttons
  const small = compact || size === 'sm' || (typeof size === 'number' && size < 160);
  const viewTools = controls && !decorative && !small;
  const view = views.length === 2 ? 'both' : (views[0] ?? 'front');

  const onFail = useCallback(
    (reason: string) => {
      setFailed(reason);
      setReady(false);
      onFallback?.(reason);
    },
    [onFallback],
  );

  const toggleLayer = (key: keyof AnatomyLayers) => {
    setAnatomyLayers((old) => ({ ...old, [key]: !old[key] }));
  };

  return (
    <figure
      className={['lm-fig3d', className].filter(Boolean).join(' ')}
      style={style}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      data-renderer={useSvg ? 'svg' : ready ? 'webgl' : 'loading'}
      aria-busy={(!useSvg && !ready) || undefined}
      data-size={typeof size === 'string' ? size : typeof size === 'number' ? 'custom' : 'default'}
    >
      <div className="lm-fig3d__row">
        <div
          className="lm-fig3d__stage"
          style={typeof size === 'number' ? { width: size, height: size * 1.25 } : undefined}
        >
          {/* The vector figure is only for when 3D cannot be had (no WebGL2, a failed load or context, a slow device,
              or asked for). While the 3D code, the binaries and the context load, the stage shows a quiet placeholder
              in the same box, and the 3D layer fades in over it on its first drawn frame: no flash of the 2D body. */}
          {!useSvg && !ready && <div className="lm-fig3d__loading" aria-hidden="true" />}
          {useSvg && (
            <BodyAvatar
              params={params}
              frame={f}
              compareTo={compareTo}
              view={view}
              size="fill"
              appearance={layers === 'two-layer' ? 'layers' : 'silhouette'}
              units={units}
              heightText={heightText}
              showMeasures={showMeasures}
              interactive={decorative ? undefined : interactive}
              ruler={ruler}
              tween={tween}
              caption={false}
              label={name}
            />
          )}
          {!useSvg && (
            <div className="lm-fig3d__layer" data-ready={ready || undefined}>
              <CanvasErrorBoundary onError={onFail}>
                <Suspense fallback={null}>
                  <Figure3DCanvas
                    params={params}
                    frame={f}
                    compareTo={compareTo}
                    views={views}
                    layers={layers}
                    anatomyLayers={anatomyLayers}
                    autoRotate={controls && !compact && rotating && !reduced}
                    interactive={!decorative && ready}
                    viewControls={viewTools}
                    controlRef={viewControl}
                    onUserTurn={() => setRotating(false)}
                    onViewState={setViewState}
                    reducedMotion={reduced}
                    tween={tween}
                    layout={null}
                    onFit={onFit}
                    onFail={onFail}
                    onReady={() => {
                      setReady(true);
                      // the first time a desktop pointer meets the figure: one line about the mouse
                      if (viewTools && takeViewHint()) setHint(true);
                      onReady?.();
                    }}
                  />
                </Suspense>
              </CanvasErrorBoundary>
            </div>
          )}
          {!useSvg && controls && !compact && (viewTools || !reduced) && (
            <div className="lm-fig3d__viewbar" role="group" aria-label="View controls">
              {viewTools && (
                <>
                  <button
                    type="button"
                    className="lm-fig3d__vbtn"
                    aria-label="Zoom in"
                    aria-disabled={!ready || !viewState.canZoomIn || undefined}
                    onClick={() => viewState.canZoomIn && viewControl.current?.zoomIn()}
                  >
                    <Icon icon={ZoomIn} size={16} />
                  </button>
                  <button
                    type="button"
                    className="lm-fig3d__vbtn"
                    aria-label="Zoom out"
                    aria-disabled={!ready || !viewState.canZoomOut || undefined}
                    onClick={() => viewState.canZoomOut && viewControl.current?.zoomOut()}
                  >
                    <Icon icon={ZoomOut} size={16} />
                  </button>
                  <button
                    type="button"
                    className="lm-fig3d__vbtn"
                    aria-label="Reset view"
                    aria-disabled={!ready || !viewState.canReset || undefined}
                    onClick={() => viewState.canReset && viewControl.current?.reset()}
                  >
                    <Icon icon={RotateCcw} size={16} />
                  </button>
                </>
              )}
              {!reduced && (
                <button
                  type="button"
                  className="lm-fig3d__vbtn lm-fig3d__motion"
                  aria-label={rotating ? 'Pause turning' : 'Resume turning'}
                  aria-pressed={rotating}
                  onClick={() => setRotating((on) => !on)}
                >
                  <Icon icon={rotating ? Pause : Play} size={16} />
                </button>
              )}
            </div>
          )}
          {hint && <ViewHint onDone={endHint} />}
        </div>
        {visceral ? (
          <VisceralView params={params} compareTo={compareTo} className="lm-fig3d__visceral" />
        ) : null}
      </div>
      {!useSvg && controls && !compact && (
        <div className="lm-fig3d__tools">
          <div className="lm-fig3d__panel">
            <h3 id={layersId} className="lm-fig3d__heading">
              Layers
            </h3>
            <div className="lm-fig3d__layers" role="group" aria-labelledby={layersId}>
              {LAYER_LABELS.map(({ key, label: layerLabel }) => (
                <button
                  key={key}
                  type="button"
                  className="lm-fig3d__chip"
                  aria-pressed={anatomyLayers[key]}
                  onClick={() => toggleLayer(key)}
                >
                  <span className={`lm-fig3d__swatch lm-fig3d__swatch--${key}`} aria-hidden="true" />
                  {layerLabel}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {caption !== false && !compact && (
        <figcaption className="lm-fig3d__caption">
          {caption} Muscles and bones show reference anatomy.
        </figcaption>
      )}
    </figure>
  );
}
