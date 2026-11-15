/**
 * What a page of ring readings puts in its header (Ring's tabs and pushed pages, Activity › Movement): how fresh the
 * readings are, and "Refresh ring data" in the ⋯.
 */
import { useEffect, useState } from 'react';
import type { MenuEntry } from '@/app/shell';
import { useActivityData } from '@/features/living/activity/data';
import { engine, engineActive, isBusy, useGaugeEngine } from '@/state/gaugeEngine';
import { useQuietMode } from '@/state/settingsStore';
import { syncWords, useRingCommand, useRingLink } from './commands';
import { RING_COPY as C } from './copy';
import { useAvailability } from './data';
import { ENGINE_COPY as EC } from './engine/copy';
import { lastSentOf, useGaugeLive, waitingOf } from './localFill';
import { sentText } from './model';
import { quietSynced } from './quiet';
import { refreshGauge, useGaugeProblem, useNow } from './useGauge';

/**
 * (r068 B2) "Refresh ring data": the phone's Gauge syncs the ring and uploads (`ring.sync` through the server), then
 * every question on screen is asked again; the screen re-reads at once too, so what the server already has shows
 * meanwhile. While the request travels, and when it fails, the bar's subtitle says where it is ("Sent to your phone…",
 * "Syncing the ring…", or why not). A Gauge too old for `ring.sync` gets the re-read only, and says so.
 */
export function useRingRefresh(): { menu: MenuEntry[]; words: string | null } {
  const link = useRingLink();
  const sync = useRingCommand('ring.sync');
  const eng = useGaugeEngine();
  const [asked, setAsked] = useState<'sync' | 'old' | null>(null);
  // capabilities are [] until Gauge reports them: try, and an old Gauge answers `unknown_type`
  const canSync = link.paired && (link.capabilities.length === 0 || link.capabilities.includes('ring.sync'));
  const local = engineActive(eng);
  const refresh = () => {
    refreshGauge();
    // (r070) the engine on this phone syncs the ring itself: no round trip through the server
    if (local) {
      void engine.syncNow().then(() => refreshGauge());
      return;
    }
    if (!canSync) {
      setAsked(link.paired ? 'old' : null);
      return;
    }
    setAsked('sync');
    void sync.send({});
  };
  const menu: MenuEntry[] = [
    { id: 'ring-refresh', label: sync.pending || isBusy(eng, 'sync') ? 'Refreshing…' : 'Refresh ring data', onSelect: refresh, disabled: sync.pending || isBusy(eng, 'sync') },
  ];
  let words: string | null = null;
  if (local) words = isBusy(eng, 'sync') ? EC.syncing : eng.error?.action === 'sync' ? eng.error.message : null;
  else if (sync.pending) words = syncWords(sync.last);
  else if (asked === 'old') words = 'Update the ring app on the phone to refresh from the ring';
  // a finished sync shows in "Synced just now"; a failure, a partial sync or an upload still on its way keeps its words
  else if (asked === 'sync' && sync.last && (sync.last.state !== 'done' || sync.last.result?.uploaded === false || sync.last.result?.complete === false)) words = syncWords(sync.last);
  // (r068 final B2) when the phone answers done, its upload has landed: ask every question on screen again
  const doneId = sync.last?.state === 'done' ? sync.last.id : null;
  useEffect(() => {
    if (doneId) refreshGauge();
  }, [doneId]);
  return { menu, words };
}

/**
 * "Gauge sent 17:16" (r069 sync: the newest of the server's provenance, the live pulse and Gauge's own record on this
 * phone, with the readings still waiting there), ticking once a minute. (0.6.3 A30) Offline it says the readings are the
 * ones this device kept; refused (the pairing ended) shows the empty state instead.
 */
export function useRingSynced(): string | undefined {
  const a = useAvailability();
  const now = useNow();
  const quiet = useQuietMode().on;
  const problem = useGaugeProblem();
  const live = useGaugeLive();
  if (!a.data) return undefined;
  const sent = lastSentOf(a.data.freshness.lastUploadAt, live);
  const waiting = waitingOf(live, now);
  const synced = quiet ? quietSynced(sent, now) + (waiting > 0 ? ` · ${C.waitingQuiet}` : '') : sentText(sent, now, waiting);
  if (problem === 'offline') return `${synced} · ${C.offlineKept}`;
  if ('cached' in a && a.cached === true) return `Saved readings${'refreshing' in a && a.refreshing === true ? ' · checking for updates' : ''} · ${synced}`;
  return synced;
}

/**
 * (0.6.3 S23) Today's engine run, as Today makes it: it publishes the plan's active energy (the Ring's active-energy goal)
 * and the day's energy (the monitor's energy entries). Not in quiet mode (no energy figures there).
 */
export function TodayEnergyFeed({ today }: { today: string }) {
  useActivityData().useToday(today, true);
  return null;
}
