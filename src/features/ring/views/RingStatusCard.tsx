/** The ring itself: its status in the top bar, and the Ring card with "Check for updates". */
import { Bluetooth, BluetoothOff, Circle, RefreshCw, RotateCcw } from 'lucide-react';
import {
  CardFoot,
  CardHead,
  ChartTwin,
  GradientCard,
  HeroNumber,
  Key,
  MonoMeta,
  StatusCapsule,
  formatNumber,
  radialTwin,
} from '@/components';
import { useQuietMode } from '@/state/settingsStore';
import { detectPlatform } from '@/platform/detect';
import { RING_STATE_WORD, ringAuthenticationPending, ringCredentialIssue, type EngineState } from '@/platform/gaugeEngine';
import { RING_COPY as C } from '../copy';
import { ENGINE_COPY } from '../engine/copy';
import { updateWords, useRingCommand, useRingLink } from '../commands';
import { engineActive, useGaugeEngine } from '@/state/gaugeEngine';
import { useDevice } from '../data';
import { isStale } from '../model';
import { ringPaths } from '../paths';
import type { GaugeStateEntry } from '../types';
import { useNow } from '../useGauge';
import { Loading } from '../components/parts';
import './status.css';
import { quietAge } from '../quiet';

// ---------------------------------------------------------------------------------------------------------------
// The ring itself

const CONNECTION_WORD: Record<string, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  scanning: 'Searching',
  searching: 'Searching',
  disconnected: 'Disconnected',
  failed: 'Connection failed',
  error: 'Connection failed',
};

const str = (e: GaugeStateEntry | undefined, k: string) =>
  e && typeof e[k] === 'string' ? (e[k] as string) : null;
const numOf = (e: GaugeStateEntry | undefined, k: string) =>
  e && typeof e[k] === 'number' ? (e[k] as number) : null;

/** Native state is current on this Android phone; the server report remains the source on every other platform. */
export function ringConnectionDisplay(serverConnection: string | null, native: EngineState | null) {
  if (native) {
    const issue = ringCredentialIssue(native);
    const pending = ringAuthenticationPending(native);
    const connected = native.ring.state === 'connected';
    return {
      word: issue === 'missing' ? ENGINE_COPY.ringAccessPending : issue === 'rejected' ? ENGINE_COPY.ringAccessFailed : pending ? ENGINE_COPY.authenticating : RING_STATE_WORD[native.ring.state],
      connected,
      issue,
      pending,
    };
  }
  return { word: serverConnection ? (CONNECTION_WORD[serverConnection] ?? serverConnection) : C.noDevice, connected: serverConnection === 'connected', issue: null, pending: false };
}

/** The ring's last reported connection and battery, and whether the report is stale. */
export function useRingState() {
  const q = useDevice();
  const now = useNow();
  const dev = q.data?.devices[0] ?? null;
  const conn = str(dev?.state.connection, 'state');
  const battery = numOf(dev?.state.battery, 'percent');
  const batteryAt = str(dev?.state.battery, 'at');
  const stale = q.data ? isStale(q.data.freshness.lastUploadAt, now) : false;
  return { q, dev, conn, battery, batteryAt, stale, now };
}

/** Readings older than this carry their age next to the battery percent (0.6.4: a week-old 100 % passed as current). */
export const BATTERY_FRESH_MS = 2 * 60 * 60_000;

/** A battery reading's age when it is no longer fresh: "5 d ago" (quiet: "a while ago"), else null. Pure. */
export function batteryAge(at: string | null | undefined, now: number, quiet = false): string | null {
  const ms = at ? Date.parse(at) : Number.NaN;
  if (!Number.isFinite(ms) || now - ms < BATTERY_FRESH_MS) return null;
  const min = (now - ms) / 60_000;
  if (quiet) return quietAge(min);
  return min < 24 * 60 ? `${Math.floor(min / 60)} h ago` : `${Math.floor(min / (24 * 60))} d ago`;
}

/** (0.6.3 quiet mode) The battery as a word: "Low" at 20 % or under, else "Fine". */
export function batteryWord(percent: number): 'Low' | 'Fine' {
  return percent <= 20 ? 'Low' : 'Fine';
}

/** The Ring status in the top bar's status slot: "Ring connected, battery 64 %"; the gold dot when disconnected or stale. */
export function RingStatusCapsule() {
  const r = useRingState();
  const eng = useGaugeEngine();
  const quiet = useQuietMode().on;
  const native = detectPlatform() === 'android' && engineActive(eng) ? eng.state : null;
  if (!native && (r.q.status !== 'ready' || !r.dev)) return null;
  const connection = ringConnectionDisplay(r.conn, native);
  const reportedBattery = native ? (native.ring.battery ?? null) : r.battery;
  const battery =
    reportedBattery === null
      ? ''
      : quiet
        ? `, battery ${batteryWord(reportedBattery).toLowerCase()}`
        : `, battery ${formatNumber(reportedBattery, 0)} %`;
  const age = native || r.battery === null ? null : batteryAge(r.batteryAt, r.now, quiet);
  const label = connection.issue
    ? `${connection.connected ? 'Ring Bluetooth connected' : `Ring Bluetooth ${native!.ring.state}`}, ${connection.issue === 'missing' ? 'data unavailable' : 'could not read ring'}`
    : connection.pending ? 'Ring Bluetooth connected, authenticating before readings are available'
    : `Ring ${connection.word.toLowerCase()}${battery}${age ? ` (${age})` : ''}${r.stale ? ', data stale' : ''}`;
  return <StatusCapsule icon={connection.connected ? Bluetooth : BluetoothOff} label={label} attention={Boolean(connection.issue) || connection.pending || !connection.connected || r.stale} />;
}

/** The ring as Gauge last reported it, and "Check for updates" for Gauge itself (installing needs a tap on the phone). */
export function RingStatusCard() {
  const quiet = useQuietMode().on;
  const r = useRingState();
  const link = useRingLink();
  const check = useRingCommand('update.check');
  const words = updateWords(check.last);
  const eng = useGaugeEngine();
  // (r070) once the engine runs the ring on this phone, Gauge has no updates to check: the key is the device page instead
  const local = detectPlatform() === 'android' && engineActive(eng);
  const native = local ? eng.state : null;
  const connection = ringConnectionDisplay(r.conn, native);
  const can =
    !local && link.paired && (link.capabilities.length === 0 || link.capabilities.includes('update.check'));
  const firmware = r.dev
    ? (str(r.dev.state.firmware, 'version') ?? str(r.dev.state.connection, 'firmware'))
    : null;
  const age = r.battery === null ? null : batteryAge(r.batteryAt, r.now, quiet);
  const displayBattery = native ? (native.ring.battery ?? null) : r.battery;
  const battery = displayBattery === null ? null : batteryWord(displayBattery);
  return (
    <GradientCard
      as="section"
      domain="neutral"
      href={eng.available ? ringPaths.device : undefined}
      openLabel={eng.available ? 'Open Ring device' : undefined}
      head={
        <CardHead
          as="h2"
          icon={Circle}
          title={C.status}
          info={{
            title: 'The ring and phone',
            body: local
              ? 'The current Bluetooth connection on this phone. A connected link can still be waiting for ring access before Vitals can read its data. Battery and firmware are shown when the ring reports them.'
              : 'What the ring last reported to the ring app on your phone: connection, battery, firmware and the phone it talks to. An older battery reading shows its age. Check for updates asks the ring app to look for a new version; installing still needs a tap on the phone.',
            source: local ? { kind: 'phone', words: 'Vitals on this phone.' } : { kind: 'ring', words: 'Last reported through the ring app on your phone.' },
            twin: !quiet ? (
              <ChartTwin
                data={radialTwin({ label: 'Ring battery', value: displayBattery, max: 100, unit: '%' })}
              />
            ) : undefined,
            range: quiet
              ? 'Low or Fine, based on the last reported battery.'
              : 'Battery 0–100 %. Low is 20 % or less. A reading older than two hours shows its age.',
            terms: [
              ...(firmware && !quiet ? [{ term: C.firmware, text: firmware }] : []),
              ...(r.dev?.deviceName && !quiet ? [{ term: C.phone, text: r.dev.deviceName }] : []),
              ...(!local && link.appVersion && !quiet ? [{ term: C.gaugeApp, text: link.appVersion }] : []),
            ],
          }}
        />
      }
      foot={
        <>
          <CardFoot
            state={
              native || (r.q.status === 'ready' && r.dev)
                ? { word: connection.word, icon: connection.connected ? Bluetooth : BluetoothOff }
                : undefined
            }
          >
            {can ? (
              <Key
                variant="text"
                size="sm"
                icon={RefreshCw}
                loading={check.pending}
                onClick={() => void check.send({})}
                disabled={check.pending}
                disabledReason={check.pending ? 'Checking' : undefined}
              >
                {C.checkUpdates}
              </Key>
            ) : null}
          </CardFoot>
          <p className="rg-status__words" role="status" aria-live="polite">
            {words ?? ''}
          </p>
          {check.last?.lost && !check.pending ? (
            <Key variant="text" size="sm" icon={RotateCcw} onClick={() => void check.retry()}>
              {C.retry}
            </Key>
          ) : null}
        </>
      }
    >
      {r.q.status === 'loading' && !native ? <Loading lines={2} /> : null}
      {r.q.status === 'ready' || native ? (
        r.dev || native ? (
          <>
            <HeroNumber value={displayBattery} unit="%" size="num"
              label={quiet ? (battery ?? 'Not reported') : displayBattery === null ? 'Battery not reported' : `${displayBattery} percent battery`}
              quietWord={quiet ? (battery ?? 'Not reported') : undefined} />
            {age && !native ? <MonoMeta>{age}</MonoMeta> : null}
            {connection.issue ? <MonoMeta>{connection.connected ? `Bluetooth connected · ${connection.issue === 'missing' ? 'ring data unavailable' : 'could not read ring'}` : 'Ring data unavailable'}</MonoMeta> : null}
            {connection.pending ? <MonoMeta>Bluetooth connected · authenticating before readings</MonoMeta> : null}
            {native?.ring.name && !quiet ? <MonoMeta><span>{native.ring.name}</span></MonoMeta> : null}
          </>
        ) : (
          <p className="rg-none">{C.noDevice}</p>
        )
      ) : null}
    </GradientCard>
  );
}
