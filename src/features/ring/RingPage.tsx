/**
 * The Ring page (`/ring`, design/screens/ring-pages.md §5): the ring itself. Order (§5.1): connection card(s) →
 * Check now (a ring is connected or reading) → today from your ring → sharing → ring settings. No ring on a platform
 * that can reach one: the pairing flow is the whole page (with Bluetooth off or no permission, its first step says how
 * to fix that). A platform that can't reach rings: the card explains the apps, today's rows still show what other
 * devices read.
 *
 * Layout (§4.1): one column (16 px gutters) on phones, one centred 640 px column on tablets, and from 1280 px two
 * columns inside the page width: left 7/12 = cards, Check now, today rows; right 5/12 = sharing, ring settings. The
 * first pairing flow spans both columns.
 */
import { useId, useMemo, useState } from 'react';
import { Page, useReducedMotion } from '@/components';
import { TopBar } from '@/app/shell';
import { DevFixtureGate } from '@/features/signals/DevFixtureGate';
import { ringAvailability, useRingEnv, useRings, worstRingState, type RingStatus } from './data';
import { ConnectionCard } from './ConnectionCard';
import { PairingFlow } from './PairingFlow';
import { CheckNow } from './CheckNow';
import { TodayReadings } from './TodayReadings';
import { Sharing } from './Sharing';
import { RingSettings } from './RingSettings';
import { RING_PAGE_COPY } from './copy';
import { useNow } from './relativeTime';
import './ring-page.css';

export default function RingPage() {
  return (
    <>
      <TopBar title={RING_PAGE_COPY.pageTitle} />
      <Page>
        <DevFixtureGate>
          <RingPageBody />
        </DevFixtureGate>
      </Page>
    </>
  );
}

/** Rings by last read, newest first; a ring never read goes last. */
export function byLastRead(rings: readonly RingStatus[]): RingStatus[] {
  const t = (r: RingStatus) => (r.lastSyncAt ? Date.parse(r.lastSyncAt) : -Infinity);
  return [...rings].sort((a, b) => t(b) - t(a));
}

/** Check now needs at least one spot measurement: a driver that lists none (D5) hides it; no list means heart rate only. */
export function canCheck(ring: RingStatus): boolean {
  return !ring.caps?.checks || ring.caps.checks.length > 0;
}

/** The page under the top bar (exported for tests; the route renders `RingPage`). */
export function RingPageBody() {
  const { service, platform } = useRingEnv();
  const rings = useRings();
  const now = useNow();
  const reduced = useReducedMotion();
  const ids = useId();
  // 'first': the first pairing is under way (the flow keeps its place until it is done); 'add': "Add another ring".
  const [pairMode, setPairMode] = useState<'first' | 'add' | null>(null);
  const ordered = useMemo(() => byLastRead(rings), [rings]);
  // 'unsupported': rings can't be reached from here at all; Bluetooth off / no permission still pair (step 1 says how).
  const canReach = ringAvailability(service, platform) !== 'unsupported';

  if (canReach && (pairMode === 'first' || (pairMode === null && ordered.length === 0))) {
    return (
      <div className="rg-page" data-layout="pairing">
        <div className="rg-span">
          <PairingFlow onStart={() => setPairMode('first')} onDone={() => setPairMode(null)} />
        </div>
      </div>
    );
  }

  const settingsId = (i: number) => `${ids}-settings-${i}`;
  const toSettings = (i: number) => () => {
    const el = document.getElementById(settingsId(i));
    el?.scrollIntoView?.({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
  };
  const live = canReach ? ordered.find((r) => r.state === 'connected' || r.state === 'syncing') : undefined;
  const sameLabel = ordered.length > 1 && new Set(ordered.map((r) => r.label)).size < ordered.length;
  const addRing = () => setPairMode('add');

  return (
    <div className="rg-page" data-layout="split">
      <div className="rg-main">
        {pairMode === 'add' ? (
          <PairingFlow onDone={() => setPairMode(null)} onCancel={() => setPairMode(null)} />
        ) : ordered.length === 0 ? (
          <ConnectionCard ring={null} />
        ) : (
          ordered.map((r, i) => (
            <ConnectionCard
              key={r.ringKey}
              ring={r}
              showTail={sameLabel}
              collapsible={i > 0}
              defaultCollapsed={i > 0 && worstRingState([r], now) !== 'attention'}
              onForget={canReach ? toSettings(i) : undefined}
            />
          ))
        )}
        {live && canCheck(live) ? <CheckNow key={live.ringKey} ring={live} /> : null}
        <TodayReadings ring={live ?? ordered[0] ?? null} />
      </div>
      {ordered.length > 0 ? (
        <div className="rg-side">
          <Sharing />
          {canReach
            ? ordered.map((r, i) => (
                <div key={r.ringKey} id={settingsId(i)} className="rg-settings">
                  <RingSettings ring={r} onAddRing={addRing} />
                </div>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}
