import { useEffect, useRef, useState } from 'react';
import type { MeasureKind } from '@/platform/gaugeEngine';
import { engine, useGaugeEngine, isBusy } from '@/state/gaugeEngine';
import { refreshGauge } from '../useGauge';
import { ENGINE_COPY as C } from './copy';

/** A spot measurement takes about 30 s on the ring; the readings are asked for again once it is over. */
export const MEASURE_MS = 35_000;

/**
 * (r070) "Measure now" on this phone: the engine starts the measurement over Bluetooth (no server round trip). Says what
 * is happening in words; when the time is up the screens ask for the new reading.
 */
export function useEngineMeasure(): {
  measure: (kind: MeasureKind) => void;
  pending: boolean;
  words: string | null;
  canMeasure: boolean;
} {
  const eng = useGaugeEngine();
  const [phase, setPhase] = useState<'idle' | 'running' | 'started' | 'refused'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const measure = (kind: MeasureKind) => {
    setPhase('running');
    void engine.measure(kind).then((r) => {
      if (!r?.started) return setPhase(r ? 'refused' : 'idle');
      setPhase('started');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setPhase('idle');
        refreshGauge();
      }, MEASURE_MS);
    });
  };
  const pending = phase === 'running' || phase === 'started' || isBusy(eng, 'measure');
  const words =
    phase === 'running' || phase === 'started'
      ? C.measuring
      : phase === 'refused'
        ? C.measureNotStarted
        : eng.error?.action === 'measure'
          ? eng.error.message
          : null;
  return { measure, pending, words, canMeasure: eng.state?.ring.state === 'connected' };
}
