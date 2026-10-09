/**
 * The ring on the Body signals page (owner, 9 Oct: one ring page, Body signals is it). The first thing on the page:
 * the connection card per ring (state, battery, last read, Connect / Connect here instead / Disconnect), Check now
 * while a ring is connected, and a "Ring settings" link to Settings › Devices, where sharing, ring options, Forget and
 * Add a ring live. No ring on a platform that can reach one: the pairing flow takes the card's place. While the first
 * Bluetooth check runs (no ring yet): nothing, so a browser that can reach rings never first says it can't.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { paths } from '@/app/paths';
import { pageRingAvailability, useRingEnv, useRings, worstRingState, type RingStatus } from './data';
import { ConnectionCard } from './ConnectionCard';
import { PairingFlow } from './PairingFlow';
import { CheckNow } from './CheckNow';
import { RING_PAGE_COPY } from './copy';
import { useNow } from './relativeTime';
import './ring-page.css';

/** Rings by last read, newest first; a ring never read goes last. */
export function byLastRead(rings: readonly RingStatus[]): RingStatus[] {
  const t = (r: RingStatus) => (r.lastSyncAt ? Date.parse(r.lastSyncAt) : -Infinity);
  return [...rings].sort((a, b) => t(b) - t(a));
}

/** Check now needs at least one spot measurement: a driver that lists none (D5) hides it; no list means heart rate only. */
export function canCheck(ring: RingStatus): boolean {
  return !ring.caps?.checks || ring.caps.checks.length > 0;
}

export function RingDevices() {
  const { service, platform } = useRingEnv();
  const rings = useRings();
  const now = useNow();
  const navigate = useNavigate();
  // the first pairing keeps its place until it is done, even once the ring shows up in the list
  const [pairing, setPairing] = useState(false);
  const moveFocus = useRef(false);
  const ordered = useMemo(() => byLastRead(rings), [rings]);
  const availability = pageRingAvailability(service, platform);
  const canReach = availability !== 'unsupported';

  useLayoutEffect(() => {
    if (pairing || !moveFocus.current) return;
    moveFocus.current = false;
    const heading = document.querySelector<HTMLElement>('.rg-devices .rg-card__label');
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }, [pairing, ordered]);

  if (availability === 'checking' && !pairing && ordered.length === 0) return null;

  if (canReach && (pairing || ordered.length === 0)) {
    return (
      <section className="rg-devices" aria-label={RING_PAGE_COPY.devicesLabel}>
        <PairingFlow
          onStart={() => setPairing(true)}
          onDone={() => {
            moveFocus.current = true;
            setPairing(false);
          }}
        />
      </section>
    );
  }

  const live = canReach ? ordered.find((r) => r.state === 'connected' || r.state === 'syncing') : undefined;
  const sameLabel = ordered.length > 1 && new Set(ordered.map((r) => r.label)).size < ordered.length;
  const toSettings = () => void navigate(paths.settings('devices'));

  return (
    <section className="rg-devices" aria-label={RING_PAGE_COPY.devicesLabel}>
      <div className="rg-devices__cards">
        {ordered.length === 0 ? (
          <ConnectionCard ring={null} />
        ) : (
          ordered.map((r, i) => (
            <ConnectionCard
              key={r.ringKey}
              ring={r}
              showTail={sameLabel}
              collapsible={i > 0}
              defaultCollapsed={i > 0 && worstRingState([r], now) !== 'attention'}
              onForget={canReach ? toSettings : undefined}
            />
          ))
        )}
        {live && canCheck(live) ? <CheckNow key={live.ringKey} ring={live} /> : null}
      </div>
      {ordered.length > 0 ? (
        <p className="rg-devices__more">
          <Link className="lm-link lm-hit" to={paths.settings('devices')}>
            {RING_PAGE_COPY.ringSettings}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
