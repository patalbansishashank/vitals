import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useState,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import type { AvatarParams } from '@/engine/body';
import { useReducedMotion } from '@/components';
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
import './figure3d.css';

const Figure3DCanvas = lazy(() => import('./Figure3DCanvas'));

export interface AnatomyLayers {
  skin: boolean;
  subcutaneousFat: boolean;
  visceralFat: boolean;
  muscles: boolean;
  skeleton: boolean;
}

const INITIAL_LAYERS: AnatomyLayers = {
  skin: true,
  subcutaneousFat: true,
  visceralFat: true,
  muscles: true,
  skeleton: true,
};

const LAYER_LABELS: { key: keyof AnatomyLayers; label: string }[] = [
  { key: 'skin', label: 'Skin' },
  { key: 'subcutaneousFat', label: 'Fat under skin' },
  { key: 'visceralFat', label: 'Fat around organs (estimate)' },
  { key: 'muscles', label: 'Muscles' },
  { key: 'skeleton', label: 'Bones' },
];

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
  const [failed, setFailed] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [anatomyLayers, setAnatomyLayers] = useState<AnatomyLayers>(INITIAL_LAYERS);
  const [rotating, setRotating] = useState(true);
  const f = resolveFrame(params, frame);
  const useSvg = forceSvg || failed !== null || !webgl2Available() || isSlowDevice();
  const name =
    label ?? describeAvatar(params, { frame: f, heightText, measures: showMeasures, layers, compareTo });
  const compact = size === 'xs' || (typeof size === 'number' && size < 100);
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
      data-size={typeof size === 'string' ? size : typeof size === 'number' ? 'custom' : 'default'}
    >
      <div className="lm-fig3d__row">
        <div
          className="lm-fig3d__stage"
          style={typeof size === 'number' ? { width: size, height: size * 1.25 } : undefined}
        >
          {(!ready || useSvg) && (
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
              interactive={useSvg && !decorative ? interactive : undefined}
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
                    reducedMotion={reduced}
                    tween={tween}
                    layout={null}
                    onFit={onFit}
                    onFail={onFail}
                    onReady={() => {
                      setReady(true);
                      onReady?.();
                    }}
                  />
                </Suspense>
              </CanvasErrorBoundary>
            </div>
          )}
        </div>
        {visceral ? (
          <VisceralView params={params} compareTo={compareTo} className="lm-fig3d__visceral" />
        ) : null}
      </div>
      {!useSvg && controls && !compact && (
        <div className="lm-fig3d__tools">
          <details className="lm-fig3d__details">
            <summary>Layers</summary>
            <div className="lm-fig3d__layers" role="group" aria-label="Body layers">
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
            <p className="lm-fig3d__explain">
              Muscles and bones show reference anatomy. Fat around organs is an estimate, not a measurement.
            </p>
          </details>
          <button
            type="button"
            className="lm-fig3d__motion"
            disabled={reduced}
            aria-pressed={!reduced && rotating}
            onClick={() => setRotating((on) => !on)}
          >
            {reduced ? 'Motion off' : rotating ? 'Pause turning' : 'Resume turning'}
          </button>
        </div>
      )}
      {caption !== false && !compact && (
        <figcaption className="lm-fig3d__caption">
          {caption} Muscles and bones show reference anatomy. Fat around organs is estimated, not measured.
        </figcaption>
      )}
      {!useSvg && controls && !compact && (
        <div className="lm-fig3d__credit">
          <a href={`${import.meta.env.BASE_URL}figure/NOTICE.html`} target="_blank" rel="noopener noreferrer">
            3D model credits
          </a>
        </div>
      )}
    </figure>
  );
}
