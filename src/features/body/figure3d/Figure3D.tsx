// <Figure3D params frame visceral/>: the MakeHuman-based 3D figure (R2 decision c, body-figure-v2.md §5).
//
// The SVG <BodyAvatar> is always mounted: it draws the ruler, view labels, callouts and handles, and the body itself
// while the WebGL chunk (renderer, fitter, asset) loads - and for good when WebGL2 is missing, the asset fails, the
// context is lost or the device is too slow. Once the canvas has drawn, it sits under the SVG in the same stage layout
// and the SVG body cross-fades out (200 ms, none with reduced motion), staying behind as invisible hit areas for drags.

import { Suspense, lazy, useCallback, useState, type CSSProperties, type ReactNode } from 'react';
import type { AvatarParams } from '@/engine/body';
import { useReducedMotion } from '@/components';
import {
  BodyAvatar,
  DEFAULT_CAPTION,
  describeAvatar,
  resolveFrame,
  type AvatarInteraction,
  type AvatarSize,
  type AvatarUnderlay,
  type MeasureId,
} from '@/features/body/avatar';
import { VisceralView } from './visceral';
import { isSlowDevice } from './device';
import type { MeshExtent } from './Figure3DCanvas';
import type { FitResult } from './fit';
import type { FigureView } from './renderer';
import './figure3d.css';

const Figure3DCanvas = lazy(() => import('./Figure3DCanvas'));

export interface Figure3DProps {
  /** Engine output: `stateToAvatarParams(state, { baseline, frame })`. */
  params: AvatarParams;
  /** Drawing-only frame 0..1 (0 = hips-led, 1 = shoulders-led). Default: `params.figure.frame`. Never changes estimates. */
  frame?: number;
  /** Show the visceral view (waist slice + cutaway) beside the figure (dev page; screens switch views instead). */
  visceral?: boolean;
  /** Start state: drawn as a flat ghost behind the figure (and in the visceral slice). */
  compareTo?: AvatarParams;
  views?: readonly FigureView[];
  /** `two-layer`: opaque lean core under a translucent fat envelope. `envelope`: one clay body. Default `envelope`. */
  layers?: 'envelope' | 'two-layer';
  /** Accessible name. Default: the generated description (shape words only, layers and ghost included). */
  label?: string;
  caption?: ReactNode | false;
  /** Force the SVG figure (print, tests, small sizes, Settings "simple", data saver). */
  forceSvg?: boolean;
  /** Stage size, as `BodyAvatar` (`fill` = the parent's box). Default: a 4:5 box. */
  size?: AvatarSize;
  units?: 'metric' | 'imperial';
  heightText?: string;
  showMeasures?: Partial<Record<MeasureId, string>>;
  /** Direct-manipulation handles (SVG overlay over the canvas). */
  interactive?: AvatarInteraction;
  ruler?: boolean;
  /** Tween discrete jumps. Off where the parent animates continuously (crosshair, Play). Default true. */
  tween?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Dev instrumentation. */
  onFit?: (fit: FitResult) => void;
  onFallback?: (reason: string) => void;
}

export function webgl2Available(): boolean {
  return typeof window !== 'undefined' && typeof window.WebGL2RenderingContext !== 'undefined';
}

export function Figure3D({
  params,
  frame,
  visceral = false,
  compareTo,
  views = ['front', 'side'],
  layers = 'envelope',
  label,
  caption = DEFAULT_CAPTION,
  forceSvg = false,
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
}: Figure3DProps) {
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [extent, setExtent] = useState<MeshExtent | null>(null);
  const f = resolveFrame(params, frame);
  const useSvg = forceSvg || failed !== null || !webgl2Available() || isSlowDevice();
  const name =
    label ??
    describeAvatar(params, {
      frame: f,
      heightText,
      measures: showMeasures,
      layers,
      compareTo,
    });
  const view = views.length === 2 ? 'both' : (views[0] ?? 'front');
  const shown3d = !useSvg && ready;

  const onFail = useCallback(
    (reason: string) => {
      setFailed(reason);
      setReady(false);
      onFallback?.(reason);
    },
    [onFallback],
  );
  const onReady = useCallback(() => setReady(true), []);

  const underlay = useSvg
    ? undefined
    : (u: AvatarUnderlay) => (
        <div className="lm-fig3d__layer" data-ready={ready || undefined} aria-hidden="true">
          <Suspense fallback={null}>
            <Figure3DCanvas
              params={params}
              frame={f}
              compareTo={compareTo}
              views={views}
              layers={layers}
              reducedMotion={reduced}
              tween={tween}
              layout={{
                layout: {
                  width: u.layout.width,
                  height: u.layout.height,
                  k: u.layout.k,
                  floorY: u.layout.floorY,
                  x: {
                    ...(u.layout.frontX !== null ? { front: u.layout.frontX } : {}),
                    ...(u.layout.sideX !== null ? { side: u.layout.sideX } : {}),
                  },
                },
                sideCentreCm: u.sideCentreCm,
              }}
              onFit={onFit}
              onFail={onFail}
              onReady={onReady}
              onExtent={setExtent}
            />
          </Suspense>
        </div>
      );

  return (
    <div
      className={['lm-fig3d', className].filter(Boolean).join(' ')}
      style={style}
      data-renderer={useSvg ? 'svg' : ready ? 'webgl' : 'loading'}
      data-size={size === 'fill' ? 'fill' : undefined}
    >
      <div className="lm-fig3d__row">
        <div className="lm-fig3d__stage">
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
            interactive={interactive}
            ruler={ruler}
            tween={tween}
            caption={caption}
            label={name}
            body={shown3d ? 'hidden' : 'svg'}
            underlay={underlay}
            minExtentCm={shown3d && extent ? extent : undefined}
          />
        </div>
        {visceral ? <VisceralView params={params} compareTo={compareTo} className="lm-fig3d__visceral" /> : null}
      </div>
    </div>
  );
}
