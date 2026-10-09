/**
 * Settings › Devices › rings (SUITE_SPEC §15.2, plan 04 item 1): one card per known ring from the ring service (state in
 * plain words, battery, last read, live heart rate while connected, Connect / Sync now / Connect here instead /
 * Disconnect / Forget), its ring settings under it (firmware, battery over time and what the driver can do; moved here
 * from the old Ring page, owner 9 Oct) and "Add a ring": the scan list, tap to connect. Rings are named by their
 * driver label only, and nothing asks for a password or code (decision 13); the only prompt a person may see is the
 * system's own pairing dialog.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { paths } from '@/app/paths';
import { Dialog, Engraved, Key, toast } from '@/components';
import { getRingService, type RingCandidate, type RingService, type RingStatus } from '@/biometrics/service';
import { platform } from '@/platform';
import { relativeTime } from '../server/copy';
import { RING } from './copy';
import { whenText } from './RingBatteryLine';
import { RingSettingsFor } from '@/features/ring/RingSettings';

type Availability = ReturnType<RingService['availability']>;

/** The service's rings and availability, kept current through `subscribe`. */
function useRings(svc: RingService): { rings: RingStatus[]; availability: Availability } {
  const [state, setState] = useState(() => ({ rings: svc.rings(), availability: svc.availability() }));
  useEffect(() => svc.subscribe((rings) => setState({ rings, availability: svc.availability() })), [svc]);
  return state;
}

/** The app on Android or the desktop is not a browser, so it does not say "browser". */
function unsupportedLine(): string {
  const p = platform();
  return p === 'android' || p === 'electron' ? RING.unsupportedApp : RING.unsupported;
}

/** The ring's state in plain words. */
export function stateLine(r: RingStatus): string {
  switch (r.state) {
    case 'unsupported':
      return unsupportedLine();
    case 'bluetooth_off':
      return RING.bluetoothOff;
    case 'permission_needed':
      return RING.permission;
    case 'syncing':
      return RING.reading(r.syncProgress === undefined ? null : Math.round(r.syncProgress * 100));
    case 'elsewhere':
      return r.heldBy ? RING.elsewhere(r.heldBy.deviceLabel, whenText(r.heldBy.since)) : RING.state.idle;
    case 'error':
      return r.error?.message ?? RING.failed;
    default:
      return RING.state[r.state];
  }
}

/** Runs a service action; its failure shows as a toast (the card's state line carries the service's own words). */
async function act(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    toast(RING.failed);
  }
}

function RingCard({ r, svc, onForget }: { r: RingStatus; svc: RingService; onForget: (r: RingStatus) => void }) {
  const live = r.state === 'connected' || r.state === 'syncing';
  // live heart rate only while this card is on screen and the ring is connected here
  useEffect(() => (live ? svc.watchLiveHeartRate(r.ringKey) : undefined), [svc, r.ringKey, live]);
  const canConnect = r.state === 'idle' || r.state === 'error' || r.state === 'permission_needed';
  const busy = r.state === 'searching' || r.state === 'connecting';
  return (
    <li className="border-t border-line pt-3 first:border-t-0 first:pt-0">
      <h3 className="m-0 text-sm font-semibold text-ink">
        {r.label}
      </h3>
      <p className="m-0 mt-1 text-sm text-ink" role="status" aria-live="polite">
        {stateLine(r)}
      </p>
      <p className="m-0 mt-1 text-xs text-ink-2">
        {[
          r.battery === undefined ? null : RING.battery(Math.round(r.battery), Boolean(r.charging)),
          r.lastSyncAt ? RING.lastRead(relativeTime(r.lastSyncAt), r.lastSyncBy ?? null) : RING.neverRead,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {live && r.liveHr ? <p className="m-0 mt-1 text-xs text-ink-2">{RING.liveHr(Math.round(r.liveHr.bpm))}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {canConnect ? (
          <Key size="sm" onClick={() => void act(() => svc.connectHere(r.ringKey))}>
            {RING.connect}
          </Key>
        ) : null}
        {r.state === 'elsewhere' ? (
          <Key size="sm" onClick={() => void act(() => svc.connectHere(r.ringKey))}>
            {RING.connectHere}
          </Key>
        ) : null}
        {live ? (
          <Key size="sm" loading={r.state === 'syncing'} onClick={() => void act(() => svc.syncNow(r.ringKey))}>
            {RING.syncNow}
          </Key>
        ) : null}
        {live || busy ? (
          <Key size="sm" variant="quiet" onClick={() => void act(() => svc.disconnect(r.ringKey))}>
            {RING.disconnect}
          </Key>
        ) : null}
        <Key size="sm" variant="quiet" onClick={() => onForget(r)}>
          {RING.forget}
        </Key>
        <Link className="lm-link inline-flex min-h-11 items-center text-sm" to={paths.signals()}>
          {RING.seeData}
        </Link>
      </div>
      <div className="mt-3">
        <RingSettingsFor ringKey={r.ringKey} />
      </div>
    </li>
  );
}

function ForgetDialog({ ring, svc, onClose }: { ring: RingStatus | null; svc: RingService; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={ring !== null}
      onClose={onClose}
      role="alertdialog"
      title={ring ? RING.forgetTitle(ring.label) : ''}
      footer={
        <>
          <Key onClick={onClose}>{RING.cancel}</Key>
          <Key
            variant="danger"
            loading={busy}
            onClick={async () => {
              if (!ring) return;
              setBusy(true);
              await act(() => svc.forget(ring.ringKey));
              setBusy(false);
              onClose();
            }}
          >
            {RING.forgetKey}
          </Key>
        </>
      }
    >
      <p className="m-0">{RING.forgetBody}</p>
    </Dialog>
  );
}

type Scan =
  | { phase: 'off' }
  /** `still`: has been looking for a while (`STILL_LOOKING_MS`). */
  | { phase: 'looking' | 'done' | 'pairing'; found: RingCandidate[]; still?: boolean }
  /** The device can't tell which of the person's rings of this model it is: ask. */
  | { phase: 'which'; found: RingCandidate[]; candidate: RingCandidate };

/** After this long the list says it is still looking (the desktop app may hear a ring only a few times a minute). */
export const STILL_LOOKING_MS = 15_000;

/**
 * "Add a ring": the scan list fed by `scan()`, rows added as rings are heard; tap a ring to connect it and read its
 * history. The scan ends when the platform stops it (the desktop app looks for 3 minutes), on Stop looking, or on a tap.
 */
function AddRing({ svc, rings }: { svc: RingService; rings: readonly RingStatus[] }) {
  const [scan, setScan] = useState<Scan>({ phase: 'off' });
  const abort = useRef<AbortController | null>(null);
  const stillTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focusNext = useRef<'scan' | 'which' | 'pair' | 'retry' | 'add' | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const scanStatus = useRef<HTMLParagraphElement>(null);
  const firstCandidate = useRef<HTMLButtonElement>(null);
  const firstMatch = useRef<HTMLButtonElement>(null);
  const pairingStatus = useRef<HTMLParagraphElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  useEffect(
    () => () => {
      abort.current?.abort();
      clearTimeout(stillTimer.current);
    },
    [],
  );
  useLayoutEffect(() => {
    const next = focusNext.current;
    if (next === 'add' && scan.phase === 'off') addButton.current?.focus();
    else if (next === 'which' && scan.phase === 'which') firstMatch.current?.focus();
    else if (next === 'pair' && scan.phase === 'pairing') pairingStatus.current?.focus();
    else if (next === 'retry' && scan.phase === 'done') retryButton.current?.focus();
    else if (next === 'scan' && (scan.phase === 'looking' || scan.phase === 'done')) {
      (scan.found.length ? firstCandidate : scanStatus).current?.focus();
    } else return;
    focusNext.current = null;
  }, [scan]);
  const shell = platform();
  const osPrompt = shell === 'android' ? RING.osPrompt('phone') : shell === 'electron' ? RING.osPrompt('computer') : null;

  // called straight from the click: on the web, scan() opens the browser's chooser and needs the gesture
  const look = async () => {
    focusNext.current = 'scan';
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    const found = new Map<string, RingCandidate>();
    setScan({ phase: 'looking', found: [] });
    clearTimeout(stillTimer.current);
    stillTimer.current = setTimeout(() => setScan((cur) => (cur.phase === 'looking' && abort.current === ac ? { ...cur, still: true } : cur)), STILL_LOOKING_MS);
    // once a ring is tapped the list stays as it is ('which', 'pairing') while the scan runs on underneath
    const listing = (next: Scan) => setScan((cur) => (cur.phase === 'looking' ? next : cur));
    try {
      for await (const c of svc.scan(ac.signal)) {
        if (ac.signal.aborted) break;
        found.set(c.candidateId, c);
        setScan((cur) => (cur.phase === 'looking' ? { ...cur, found: [...found.values()] } : cur));
      }
    } catch {
      // the chooser was closed or the scan failed: the list says what was found
    }
    if (abort.current === ac && !ac.signal.aborted) listing({ phase: 'done', found: [...found.values()] });
  };
  const stop = () => {
    abort.current?.abort();
    clearTimeout(stillTimer.current);
    focusNext.current = 'add';
    setScan({ phase: 'off' });
  };
  const pair = async (c: RingCandidate, found: RingCandidate[], ringKey?: string) => {
    // the scan stays open until the pick is made: on the desktop and Android the tap is answered through the open
    // list (the transport's chooser); ending the scan first answers "nothing chosen" and the pair fails
    const scanning = abort.current;
    abort.current = null;
    focusNext.current = 'pair';
    setScan({ phase: 'pairing', found });
    try {
      await (ringKey ? svc.pair(c.candidateId, ringKey) : svc.pair(c.candidateId));
      focusNext.current = 'add';
      setScan({ phase: 'off' });
    } catch {
      toast(RING.failed);
      focusNext.current = 'retry';
      setScan({ phase: 'done', found });
    } finally {
      scanning?.abort();
    }
  };

  if (scan.phase === 'off') {
    return (
      <div className="mt-3">
        <Key ref={addButton} size="sm" onClick={() => void look()}>
          {RING.add}
        </Key>
      </div>
    );
  }
  if (scan.phase === 'which') {
    const c = scan.candidate;
    return (
      <div className="mt-3 grid gap-2" role="group" aria-label={RING.which}>
        <p className="m-0 text-sm text-ink">{RING.which}</p>
        {(c.matches ?? []).map((m, index) => (
          <Key ref={index === 0 ? firstMatch : undefined} key={m.ringKey} size="sm" block onClick={() => void pair(c, scan.found, m.ringKey)}>
            {RING.match(c.label, m.lastSyncBy ?? null, m.lastSyncAt ? relativeTime(m.lastSyncAt) : null)}
          </Key>
        ))}
        <Key size="sm" block variant="quiet" onClick={() => void pair(c, scan.found)}>
          {RING.newRing}
        </Key>
      </div>
    );
  }
  if (scan.phase === 'pairing') {
    const reading = rings.some((r) => r.state === 'syncing');
    return (
      <p ref={pairingStatus} tabIndex={-1} className="m-0 mt-3 text-sm text-ink" role="status" aria-live="polite">
        {reading ? RING.pairingHistory : RING.pairing}
      </p>
    );
  }
  return (
    <div className="mt-3 grid gap-2">
      {osPrompt ? <p className="m-0 text-xs text-ink-2">{osPrompt}</p> : null}
      <p ref={scanStatus} tabIndex={-1} className="m-0 text-xs text-ink-2" role="status" aria-live="polite">
        {scan.phase === 'looking' ? (scan.still ? RING.stillLooking : RING.looking) : scan.found.length === 0 ? RING.noneFound : RING.nearby(scan.found.length)}
      </p>
      {scan.found.length ? (
        <ul className="m-0 grid list-none gap-2 p-0" aria-label={RING.candidates}>
          {scan.found.map((c, index) => {
            const hint = c.known ? RING.yours : RING.signal(c.rssi);
            return (
              <li key={c.candidateId}>
                <Key
                  ref={index === 0 ? firstCandidate : undefined}
                  size="sm"
                  block
                  disabledReason={c.known ? RING.yours : undefined}
                  onClick={() => {
                    if ((c.matches?.length ?? 0) > 1) {
                      // the list stays open underneath until the answer is passed on (see `pair`)
                      focusNext.current = 'which';
                      setScan({ phase: 'which', found: scan.found, candidate: c });
                    } else void pair(c, scan.found);
                  }}
                >
                  {c.label}
                  {hint ? <span className="font-normal text-ink-2"> · {hint}</span> : null}
                </Key>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {scan.phase === 'done' ? (
          <Key ref={retryButton} size="sm" onClick={() => void look()}>
            {RING.lookAgain}
          </Key>
        ) : null}
        <Key size="sm" variant="quiet" onClick={stop}>
          {RING.stop}
        </Key>
      </div>
    </div>
  );
}

export function RingsBlock() {
  const svc = getRingService();
  const { rings, availability } = useRings(svc);
  const [forgetting, setForgetting] = useState<RingStatus | null>(null);
  return (
    <div className="mt-4 border-t border-line pt-4" role="group" aria-label={RING.title}>
      <Engraved as="p" className="m-0">
        {RING.title}
      </Engraved>
      {availability === 'unsupported' ? (
        <p className="m-0 mt-1 text-sm text-ink-2">{unsupportedLine()}</p>
      ) : (
        <>
          {availability === 'bluetooth_off' || availability === 'permission_needed' ? (
            <p className="m-0 mt-1 text-sm text-ink-2">{availability === 'bluetooth_off' ? RING.bluetoothOff : RING.permission}</p>
          ) : null}
          {rings.length ? (
            <ul className="m-0 mt-2 grid list-none gap-3 p-0">
              {rings.map((r) => (
                <RingCard key={r.ringKey} r={r} svc={svc} onForget={setForgetting} />
              ))}
            </ul>
          ) : null}
          <AddRing svc={svc} rings={rings} />
          <ForgetDialog ring={forgetting} svc={svc} onClose={() => setForgetting(null)} />
        </>
      )}
    </div>
  );
}
