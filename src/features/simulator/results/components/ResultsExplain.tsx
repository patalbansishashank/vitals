import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { CompiledSchedule, SimulationResult } from '@/engine';
import type { ChartController, ChartData, Resolution } from '@/features/charts';
import { ExplainDrawer } from '@/features/evidence';
import { explainDrivers, explainDriversTitle, explainReading, type ExplainCursor } from '../lib/explainContext';
import type { UnitPrefs } from '../lib/metrics';

export interface ResultsExplainProps {
  metricId: string | undefined;
  onClose: () => void;
  returnTo: { to: string; label: string };
  controller: ChartController;
  data: ChartData | null;
  result: SimulationResult | null;
  compiled: CompiledSchedule | null;
  prefs: UnitPrefs;
}

const noop = () => () => {};

/**
 * The results screen's Explain drawer: the mechanisms behind a channel plus its value at the crosshair and what drives
 * it there. Subscribes to the chart controller only while open, so moving the crosshair re-renders this drawer and
 * nothing else (the lanes stay imperative).
 */
export function ResultsExplain({ metricId, onClose, returnTo, controller, data, result, compiled, prefs }: ResultsExplainProps) {
  const open = Boolean(metricId);
  const subCursor = useCallback((fn: () => void) => controller.cursor.subscribe(() => fn()), [controller]);
  const subView = useCallback((fn: () => void) => controller.view.subscribe(() => fn()), [controller]);
  const t = useSyncExternalStore(open ? subCursor : noop, () => controller.cursor.get().t);
  const pinned = useSyncExternalStore(open ? subCursor : noop, () => controller.cursor.get().pinned);
  const res = useSyncExternalStore<Resolution>(open ? subView : noop, () => controller.view.get().res);

  const cursor: ExplainCursor = useMemo(() => ({ t, pinned, res }), [t, pinned, res]);
  const reading = useMemo(() => (open && data && metricId ? explainReading(data, metricId, cursor) : null), [open, data, metricId, cursor]);
  const drivers = useMemo(
    () => (open && data && result && metricId ? explainDrivers({ data, result, compiled, prefs }, metricId, cursor) : null),
    [open, data, result, compiled, prefs, metricId, cursor],
  );

  // the channel's unit as the chart shows it (user's units, change-from-baseline suffix), not the engine's
  const unit = useMemo(() => (metricId ? data?.series.find((s) => s.id === metricId)?.unit : undefined), [data, metricId]);

  return (
    <ExplainDrawer
      open={open}
      onClose={onClose}
      metricId={metricId}
      returnTo={returnTo}
      reading={reading}
      drivers={drivers}
      driversTitle={metricId ? explainDriversTitle(metricId) : undefined}
      unit={unit}
    />
  );
}
