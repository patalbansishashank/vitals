/**
 * The pairing flow (design/screens/ring-pages.md §5.5), inline in the Ring page: one faceplate "Connect your ring"
 * with three steps and no step indicator.
 *   1. before scanning: what to do with the ring, then **Look for rings**;
 *   2. the scan list (`scan()`), which never reorders under the finger, stops after 30 s; on the web the browser's own
 *      chooser replaces the list and the ring it gives back is paired at once;
 *   3. connecting (`pair()`): connect → (Android: the system pairing prompt announced first) → setting up → reading
 *      what the ring has stored → "Connected." and back to the page with a toast; or "Couldn't connect" with
 *      Try again · Choose another ring.
 * Never a password, key, code or "advanced" field; never an advertised name (decision 13).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Faceplate, InlineWarning, Key, ProgressRule, toast } from '@/components';
import { ringAvailability, useRingEnv, useRings, type RingCandidate, type RingStatus } from './data';
import { RING_PAGE_COPY, nearWhat } from './copy';
import { ScanList, sortCandidates } from './ScanList';

const P = RING_PAGE_COPY.pairing;
const C = RING_PAGE_COPY.card;

/** Looking stops after this long. */
export const SCAN_MS = 30_000;
/** The list is re-sorted only once it has had no new row for this long. */
export const SETTLE_MS = 2_000;
/** "Connected." stays this long before the page returns to normal. */
export const DONE_HOLD_MS = 1_500;

type Phase =
  | { step: 'intro' }
  | { step: 'scan'; looking: boolean; timedOut: boolean }
  | { step: 'connect'; candidate: RingCandidate; before: readonly string[]; status: 'working' | 'done' | 'failed' };

type Stage = { stage: 'connect' } | { stage: 'setup' } | { stage: 'reading'; progress?: number };

/** Where a pair has got to, read from the ring list the service publishes while `pair()` runs. */
export function pairStage(rings: readonly RingStatus[], before: readonly string[], known: boolean): Stage {
  const had = new Set(before);
  const ring = rings.find((r) => !had.has(r.ringKey)) ?? (known ? rings.find((r) => r.state === 'connecting' || r.state === 'syncing') : undefined);
  if (ring?.state === 'syncing') return { stage: 'reading', progress: ring.syncProgress };
  if (ring?.state === 'connected') return { stage: 'setup' };
  return { stage: 'connect' };
}

export interface PairingFlowProps {
  /** A pair has started: the page keeps the flow where it is until `onDone`. */
  onStart?: () => void;
  /** Connected and "Connected." has shown: back to the normal page (the toast is already up). */
  onDone: () => void;
  /** Close the flow (only when there is a page to go back to, i.e. adding another ring). */
  onCancel?: () => void;
}

export function PairingFlow({ onStart, onDone, onCancel }: PairingFlowProps) {
  const { service, platform } = useRingEnv();
  const rings = useRings();
  const [phase, setPhase] = useState<Phase>({ step: 'intro' });
  const [rows, setRows] = useState<RingCandidate[]>([]);
  const scanRef = useRef<AbortController | null>(null);
  const seen = useRef(new Set<string>());
  const timers = useRef<{ stop?: ReturnType<typeof setTimeout>; settle?: ReturnType<typeof setTimeout> }>({});
  const alive = useRef(true);
  /** A pair is in flight: a second tap on the same row (or Try again) must not start another one. */
  const pairing = useRef(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });
  useEffect(() => {
    alive.current = true;
    const t = timers.current;
    return () => {
      alive.current = false;
      scanRef.current?.abort();
      scanRef.current = null;
      clearTimeout(t.stop);
      clearTimeout(t.settle);
    };
  }, []);

  const near = nearWhat(platform.here);
  const availability = ringAvailability(service, platform);
  const android = platform.ble === 'capacitor';
  const chooser = platform.ble === 'web-bluetooth';

  function clearScan() {
    scanRef.current?.abort();
    scanRef.current = null;
    clearTimeout(timers.current.stop);
    clearTimeout(timers.current.settle);
  }

  function addRow(c: RingCandidate) {
    const isNew = !seen.current.has(c.candidateId);
    seen.current.add(c.candidateId);
    setRows((prev) => (isNew ? [...prev, c] : prev.map((r) => (r.candidateId === c.candidateId ? c : r))));
    if (isNew) {
      // New rows append; the order is recomputed only when the list has been still for 2 s.
      clearTimeout(timers.current.settle);
      timers.current.settle = setTimeout(() => setRows(sortCandidates), SETTLE_MS);
    }
  }

  function stopLooking(ctrl: AbortController, timedOut: boolean) {
    if (scanRef.current !== ctrl) return;
    ctrl.abort();
    scanRef.current = null;
    clearTimeout(timers.current.stop);
    setPhase((p) => (p.step === 'scan' ? { step: 'scan', looking: false, timedOut } : p));
  }

  async function look() {
    clearScan();
    const ctrl = new AbortController();
    scanRef.current = ctrl;
    if (chooser) {
      // Web Bluetooth: the browser's chooser is the list; the ring it hands back is the person's choice.
      try {
        for await (const c of service.scan(ctrl.signal)) {
          if (ctrl.signal.aborted || !alive.current) return;
          scanRef.current = null;
          ctrl.abort();
          void pairWith(c);
          return;
        }
      } catch {
        /* the chooser was closed */
      }
      if (scanRef.current === ctrl) scanRef.current = null;
      return;
    }
    seen.current = new Set();
    setRows([]);
    setPhase({ step: 'scan', looking: true, timedOut: false });
    timers.current.stop = setTimeout(() => stopLooking(ctrl, true), SCAN_MS);
    try {
      for await (const c of service.scan(ctrl.signal)) {
        if (ctrl.signal.aborted || !alive.current) return;
        addRow(c);
      }
      // The service has listed what it found; looking still ends at the 30 s mark.
    } catch {
      if (alive.current) stopLooking(ctrl, true);
    }
  }

  async function pairWith(c: RingCandidate) {
    if (pairing.current) return;
    pairing.current = true;
    clearScan();
    const before = service.rings().map((r) => r.ringKey);
    setPhase({ step: 'connect', candidate: c, before, status: 'working' });
    onStart?.();
    try {
      await service.pair(c.candidateId);
    } catch {
      pairing.current = false;
      if (alive.current) setPhase({ step: 'connect', candidate: c, before, status: 'failed' });
      return;
    }
    pairing.current = false;
    if (!alive.current) {
      // The person left the page; the read went on in the ring service.
      toast(P.toast);
      return;
    }
    setPhase({ step: 'connect', candidate: c, before, status: 'done' });
    setTimeout(() => {
      toast(P.toast);
      onDoneRef.current();
    }, DONE_HOLD_MS);
  }

  const working = phase.step === 'connect' && phase.status !== 'failed';
  const cancel =
    onCancel && !working ? (
      <Key
        size="sm"
        variant="quiet"
        onClick={() => {
          clearScan();
          onCancel();
        }}
      >
        {P.cancel}
      </Key>
    ) : undefined;

  let body;
  let progress = null;
  if (phase.step === 'intro') {
    // Bluetooth off or no permission yet: that state's line and key take the place of "Look for rings".
    const run = (p: Promise<unknown> | undefined) => void p?.catch(() => {});
    let blocker: string | null = null;
    let keys: ReactNode = (
      <Key variant="solid" onClick={() => void look()}>
        {P.lookForRings}
      </Key>
    );
    if (availability === 'bluetooth_off') {
      blocker = android ? C.body.bluetoothOff : C.body.bluetoothOffComputer;
      keys = android && service.requestBluetooth ? (
        <Key variant="solid" onClick={() => run(service.requestBluetooth?.())}>
          {C.keys.turnOnBluetooth}
        </Key>
      ) : null;
    } else if (availability === 'permission_needed') {
      blocker = android ? C.body.permissionAndroid : C.body.permissionWeb;
      keys = service.requestPermission ? (
        <Key variant="solid" onClick={() => run(service.requestPermission?.())}>
          {C.keys.allow}
        </Key>
      ) : service.openAppSettings ? (
        <Key onClick={() => run(service.openAppSettings?.())}>{C.keys.openAppSettings}</Key>
      ) : null;
    }
    body = (
      <div className="rg-pair__step">
        <p className="rg-pair__line">{P.intro(near)}</p>
        {platform.ble === 'web-bluetooth' || platform.ble === 'electron' ? <p className="rg-pair__line">{P.chooserLine}</p> : null}
        {blocker ? <InlineWarning severity="caution">{blocker}</InlineWarning> : null}
        {keys ? <div className="rg-pair__keys">{keys}</div> : null}
      </div>
    );
  } else if (phase.step === 'scan') {
    body = (
      <div className="rg-pair__step">
        <div className="rg-pair__scanhead">
          <span className="rg-pair__status" role="status">
            {phase.looking ? P.looking : P.stopped}
          </span>
          {phase.looking ? (
            <Key size="sm" onClick={() => scanRef.current && stopLooking(scanRef.current, false)}>
              {P.stop}
            </Key>
          ) : (
            <Key size="sm" onClick={() => void look()}>
              {P.lookAgain}
            </Key>
          )}
        </div>
        <ScanList rows={rows} onPick={(c) => void pairWith(c)} />
        {phase.looking ? (
          <p className="rg-pair__hint">{P.notSeeing}</p>
        ) : phase.timedOut && rows.length === 0 ? (
          <p className="rg-pair__line">{P.noneFound(near)}</p>
        ) : null}
      </div>
    );
  } else {
    const { candidate } = phase;
    let lines: string[];
    let keys = null;
    if (phase.status === 'done') {
      lines = [P.done];
    } else if (phase.status === 'failed') {
      lines = [P.failed];
      keys = (
        <div className="rg-pair__keys">
          <Key variant="solid" onClick={() => void pairWith(candidate)}>
            {P.tryAgain}
          </Key>
          <Key onClick={() => void look()}>{P.chooseAnother}</Key>
        </div>
      );
    } else {
      const st = pairStage(rings, phase.before, candidate.known);
      if (st.stage === 'reading') {
        lines = [P.reading(st.progress)];
        progress = <ProgressRule value={st.progress} label={P.progress.reading} reducedText={null} />;
      } else {
        lines = [st.stage === 'connect' ? P.connecting(candidate.label) : P.settingUp];
        // The system's own pairing prompt is announced before it can appear (Android).
        if (android) lines.push(P.osPrompt);
        progress = <ProgressRule label={P.progress.connecting} reducedText={null} />;
      }
    }
    body = (
      <div className="rg-pair__step">
        <div role="status" className="rg-pair__lines">
          {lines.map((l) => (
            <p key={l} className="rg-pair__line">
              {l}
            </p>
          ))}
        </div>
        {keys}
      </div>
    );
  }

  return (
    <Faceplate className="rg-pair" title={P.title} actions={cancel} data-step={phase.step}>
      {progress}
      {body}
    </Faceplate>
  );
}
