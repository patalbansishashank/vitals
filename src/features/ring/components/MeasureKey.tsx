/** "Measure now": a spot heart-rate reading, through the engine on this phone or Gauge through the server. */
import { useEffect } from 'react';
import { HeartPulse, RotateCcw } from 'lucide-react';
import { Key } from '@/components';
import { RING_COPY as C } from '../copy';
import { measureWords, useRingCommand, useRingLink } from '../commands';
import { refreshGauge } from '../useGauge';
import { engineActive, useGaugeEngine } from '@/state/gaugeEngine';
import { useEngineMeasure } from '../engine/useEngineMeasure';
import { useQuietMode } from '@/state/settingsStore';

/**
 * "Measure now": asks Gauge for a spot heart rate (about 32 s on the ring). Shows "Measuring" until the ack, then the
 * reading or why there is none. Hidden when Gauge's build cannot run it.
 */
export function MeasureKey({ compact = false }: { compact?: boolean }) {
  const link = useRingLink();
  const cmd = useRingCommand('hr.measure');
  const quiet = useQuietMode().on;
  const can = link.capabilities.length === 0 || link.capabilities.includes('hr.measure');
  // (r070) with the engine on this phone the measurement starts over Bluetooth, not through the server
  const local = engineActive(useGaugeEngine());
  const em = useEngineMeasure();
  const words = local ? em.words : measureWords(cmd.last, quiet);
  // (r068 final M3/B2) Gauge uploads the reading before it acks: re-read the page so Latest and the bands move with it
  const doneId = cmd.last?.state === 'done' ? cmd.last.id : null;
  useEffect(() => {
    if (doneId) refreshGauge();
  }, [doneId]);
  if (!local && (!link.paired || !can)) return null;
  const pending = local ? em.pending : cmd.pending;
  return (
    <div className="rg-measure" data-compact={compact || undefined}>
      <Key variant="action" size="sm" icon={HeartPulse} loading={pending} onClick={() => (local ? em.measure('hr') : void cmd.send({}))} disabled={pending || (local && !em.canMeasure)} disabledReason={local && !em.canMeasure ? 'The ring is not connected' : undefined}>
        {C.measure}
      </Key>
      <span className="rg-measure__words" role="status" aria-live="polite">
        {words ?? ''}
      </span>
      {!local && cmd.last?.lost && !cmd.pending ? (
        <Key variant="text" size="sm" icon={RotateCcw} onClick={() => void cmd.retry()}>
          {C.retry}
        </Key>
      ) : null}
    </div>
  );
}
