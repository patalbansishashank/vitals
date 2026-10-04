/* ==========================================================================
   <PlotCanvas> — thin React shell around PlotEngine (uPlot). Overlays (dots,
   labels) are children positioned over the canvas.
   ========================================================================== */
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { ChartController } from './controller';
import { type PlotApi, PlotEngine, type PlotModel, type PlotPadding } from './plotEngine';

export type { PlotApi, PlotData, PlotLine, PlotModel, PlotPadding } from './plotEngine';

export interface PlotCanvasProps {
  model: PlotModel;
  controller: ChartController;
  width: number;
  height: number;
  padding: PlotPadding;
  /** Virtualisation: inactive plots are not created/drawn until they come into view. */
  active?: boolean;
  /** Receives the engine API (CSS mapping for overlays) once mounted. */
  onApi?: (api: PlotApi | null) => void;
  className?: string;
  children?: ReactNode;
  /** Tween y-domain changes that are not caused by zooming (e.g. "from zero"). */
  animateDomain?: boolean;
}

export function PlotCanvas({
  model,
  controller,
  width,
  height,
  padding,
  active = true,
  onApi,
  className,
  children,
  animateDomain = true,
}: PlotCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<PlotEngine | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const e = new PlotEngine(host, controller);
    // publish the engine after mount (subscription-style: not a synchronous render update)
    const id = requestAnimationFrame(() => setEngine(e));
    return () => {
      cancelAnimationFrame(id);
      e.destroy();
    };
  }, [controller]);

  useEffect(() => {
    engine?.update({ model, width, height, padding, active, animateDomain });
  }, [engine, model, width, height, padding, active, animateDomain]);

  useEffect(() => {
    if (!engine || !onApi) return;
    onApi(engine.api);
    return () => onApi(null);
  }, [engine, onApi]);

  return (
    <div ref={hostRef} className={className ? `lmc-canvas ${className}` : 'lmc-canvas'} style={{ height }}>
      {children}
    </div>
  );
}
