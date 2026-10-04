/**
 * The connection card (design/screens/ring-pages.md §5.2): one faceplate per ring. Header row = ring mark, driver
 * label, and on the right the state word with its indicator light; body = the state's line, warnings, the readouts
 * (battery, last read, on) and the key row. Every `RingLinkState` plus the derived stale, sync-failed and low-battery
 * cases; the words are in ./copy (final in the design).
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Faceplate, IconKey, InlineWarning, Key, KeyLink, KeyValueList, ProgressRule, useReducedMotion } from '@/components';
import { Icon } from '@/components/icons/Icon';
import { CautionMark } from '@/components/icons/glyphs';
import { paths } from '@/app/paths';
import { connectRing, isStale, ringAvailability, useRingEnv, type RingAvailability, type RingLinkState, type RingStatus } from './data';
import { BatteryScale } from './BatteryScale';
import { RING_PAGE_COPY } from './copy';
import { RingGlyph, RingLightMark, type RingLight } from './RingKey';
import { dayText, lastReadText, sinceText, useNow } from './relativeTime';

const C = RING_PAGE_COPY.card;
/** Where "Get the app" goes: Settings › Install (the downloads block). */
export const GET_APP_HREF = '/settings#install';
/** After this long searching, the card says how to wake the ring. */
export const SEARCH_HINT_MS = 15_000;
const CROSSFADE_MS = 150;

/** The ring id's last four characters, upper case ("4F2A"), from a `…#<ringId>` ring key. */
export function ringIdTail(ringKey: string): string | null {
  const id = ringKey.split('#')[1];
  return id && id.length >= 4 ? id.slice(-4).toUpperCase() : null;
}

/** The state the card shows: a platform that can't reach rings wins over whatever the ring last said. */
export function cardState(ring: RingStatus | null, availability: RingAvailability): RingLinkState {
  if (availability === 'unsupported' || !ring) return 'unsupported';
  return ring.state;
}

function stateWord(state: RingLinkState, ring: RingStatus | null): string {
  switch (state) {
    case 'syncing':
      return C.state.syncing(ring?.syncProgress);
    case 'elsewhere':
      return ring?.heldBy ? C.state.elsewhere(ring.heldBy.deviceLabel) : C.state.idle;
    default:
      return C.state[state];
  }
}

function stateLight(state: RingLinkState): RingLight {
  switch (state) {
    case 'unsupported':
      return 'none';
    case 'bluetooth_off':
    case 'permission_needed':
    case 'error':
      return 'attention';
    case 'idle':
    case 'searching':
    case 'connecting':
      return 'off';
    case 'connected':
      return 'connected';
    case 'syncing':
      return 'reading';
    case 'elsewhere':
      return 'elsewhere';
  }
}

/** True once `active` has stayed true for `ms`. */
function useAfter(active: boolean, ms: number): boolean {
  const [done, setDone] = useState(false);
  if (!active && done) setDone(false);
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => setDone(true), ms);
    return () => clearTimeout(id);
  }, [active, ms]);
  return active && done;
}

/** The state word; a change crossfades over 150 ms (cut under reduced motion). */
function StateWord({ word, light, stale }: { word: string; light: RingLight; stale: boolean }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(word);
  const [prev, setPrev] = useState<string | null>(null);
  if (shown !== word) {
    setPrev(reduced ? null : shown);
    setShown(word);
  }
  useEffect(() => {
    if (prev === null) return;
    const id = setTimeout(() => setPrev(null), CROSSFADE_MS);
    return () => clearTimeout(id);
  }, [prev]);
  return (
    <span className="rg-card__state">
      <RingLightMark light={light} />
      {stale ? <Icon icon={CautionMark} size={16} className="rg-caution" label={C.staleMark} /> : null}
      <span className="rg-card__word" aria-live="polite">
        <span key={word} className="rg-card__word-now" data-fade={prev !== null || undefined}>
          {word}
        </span>
        {prev !== null ? (
          <span className="rg-card__word-prev" aria-hidden="true">
            {prev}
          </span>
        ) : null}
      </span>
    </span>
  );
}

export interface ConnectionCardProps {
  /** The ring; null only on a platform that can't reach rings and knows none (the card explains the apps). */
  ring: RingStatus | null;
  /** Add "· ending 4F2A" to the label (several rings share the driver label). */
  showTail?: boolean;
  /** Cards after the first can collapse to their header row. */
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  /** "Forget…" on an error: take the person to this ring's settings. */
  onForget?: () => void;
}

export function ConnectionCard({ ring, showTail = false, collapsible = false, defaultCollapsed = false, onForget }: ConnectionCardProps) {
  const { service, platform } = useRingEnv();
  const now = useNow();
  const labelId = useId();
  const bodyId = useId();
  const [collapsed, setCollapsed] = useState(collapsible && defaultCollapsed);
  const [waitingFor, setWaitingFor] = useState<string | null>(null);

  const state = cardState(ring, ringAvailability(service, platform));
  const stale = ring !== null && state !== 'unsupported' && isStale(ring, now);
  const syncFailed = state === 'connected' && Boolean(ring?.syncError);
  const longSearch = useAfter(state === 'searching', SEARCH_HINT_MS);
  // "waiting for <device> to let go…" lasts while the takeover is under way.
  if (waitingFor !== null && state !== 'connecting' && state !== 'elsewhere') setWaitingFor(null);

  const android = platform.ble === 'capacitor';
  const key = ring?.ringKey ?? '';
  const tail = showTail && ring ? ringIdTail(ring.ringKey) : null;
  const label = ring ? (tail ? C.labelWithTail(ring.label, tail) : ring.label) : C.noRingLabel;
  const run = (p: Promise<unknown> | undefined) => {
    void p?.catch(() => {
      /* the service reports failures through the ring's state */
    });
  };
  const connect = () => run(connectRing(service, key));

  /* ---- the state's line(s) ---- */
  let line: string | null;
  switch (state) {
    case 'unsupported':
      line = C.body.unsupported;
      break;
    case 'bluetooth_off':
      line = android ? C.body.bluetoothOff : C.body.bluetoothOffComputer;
      break;
    case 'permission_needed':
      line = android ? C.body.permissionAndroid : C.body.permissionWeb;
      break;
    case 'searching':
      line = longSearch ? C.body.searchingLong : null;
      break;
    case 'connecting':
      line = waitingFor ? C.body.waitingFor(waitingFor) : null;
      break;
    case 'elsewhere':
      line = ring?.heldBy ? C.body.elsewhere(ring.heldBy.deviceLabel, sinceText(ring.heldBy.since, now)) : null;
      break;
    case 'error':
      line = ring?.error?.message || C.body.errorFallback;
      break;
    default:
      line = null;
  }

  /* ---- readouts ---- */
  const linked = state === 'connected' || state === 'syncing';
  const items: Array<{ key: string; value: ReactNode; id: string }> = [];
  if (ring) {
    items.push({ id: 'battery', key: C.rows.battery, value: <BatteryScale value={ring.battery} charging={ring.charging} lastKnown={!linked && ring.battery !== undefined} /> });
    items.push({ id: 'last', key: C.rows.lastRead, value: ring.lastSyncAt ? lastReadText(ring.lastSyncAt, now, ring.lastSyncBy) : C.lastReadNever });
    if (linked) items.push({ id: 'on', key: C.rows.on, value: platform.here });
    else if (state === 'elsewhere' && ring.heldBy) items.push({ id: 'on', key: C.rows.on, value: ring.heldBy.deviceLabel });
  }

  /* ---- keys ---- */
  const K = C.keys;
  let keys: ReactNode = null;
  switch (state) {
    case 'unsupported':
      keys = (
        <>
          <KeyLink to={GET_APP_HREF} variant="solid">
            {K.getApp}
          </KeyLink>
          <KeyLink to={paths.settings('devices')}>{K.importFile}</KeyLink>
        </>
      );
      break;
    case 'bluetooth_off':
      keys = android && service.requestBluetooth ? <Key onClick={() => run(service.requestBluetooth?.())}>{K.turnOnBluetooth}</Key> : null;
      break;
    case 'permission_needed':
      keys = ring?.permissionDenied ? (
        service.openAppSettings ? (
          <Key onClick={() => run(service.openAppSettings?.())}>{K.openAppSettings}</Key>
        ) : null
      ) : service.requestPermission ? (
        <Key variant="solid" onClick={() => run(service.requestPermission?.())}>
          {K.allow}
        </Key>
      ) : null;
      break;
    case 'idle':
      keys = (
        <Key variant="solid" onClick={connect}>
          {K.connect}
        </Key>
      );
      break;
    case 'searching':
    case 'connecting':
      // per-ring stop only: never the real service's service-wide stop()
      keys = service.stopConnecting ? <Key onClick={() => run(service.stopConnecting?.(key))}>{K.stop}</Key> : null;
      break;
    case 'connected':
      keys = (
        <>
          {syncFailed ? (
            <Key onClick={() => run(service.syncNow(key))}>{K.tryAgain}</Key>
          ) : (
            <Key onClick={() => run(service.syncNow(key))}>{K.syncNow}</Key>
          )}
          <Key onClick={() => run(service.disconnect(key))}>{K.disconnect}</Key>
        </>
      );
      break;
    case 'syncing':
      keys = (
        <Key disabled className="rg-statuskey">
          {K.reading}
        </Key>
      );
      break;
    case 'elsewhere':
      keys = (
        <Key
          variant="solid"
          onClick={() => {
            setWaitingFor(ring?.heldBy?.deviceLabel ?? null);
            run(service.connectHere(key));
          }}
        >
          {K.connectHere}
        </Key>
      );
      break;
    case 'error':
      keys = (
        <>
          <Key onClick={connect}>{K.tryAgain}</Key>
          {onForget ? (
            <button type="button" className="lm-link lm-hit rg-linkbtn" onClick={onForget}>
              {K.forget}
            </button>
          ) : null}
        </>
      );
      break;
  }

  const progress =
    state === 'syncing' ? (
      <ProgressRule value={ring?.syncProgress} label={C.progress.reading} reducedText={null} />
    ) : state === 'connecting' ? (
      <ProgressRule label={C.progress.connecting} reducedText={null} />
    ) : null;

  // a card that moves to the front (it was read most recently) is no longer collapsible: it shows its body
  const folded = collapsible && collapsed;
  const open = !folded;
  return (
    <Faceplate className="rg-card" aria-labelledby={labelId} data-state={state} data-stale={stale || undefined} data-collapsed={folded || undefined}>
      {progress}
      <div className="rg-card__head" data-open={open || undefined}>
        <Icon icon={RingGlyph} size={24} className="rg-card__glyph" />
        <h2 className="rg-card__label" id={labelId}>
          {label}
        </h2>
        <StateWord word={stateWord(state, ring)} light={stateLight(state)} stale={stale} />
        {collapsible ? (
          <IconKey
            size="sm"
            icon={collapsed ? ChevronDown : ChevronUp}
            label={collapsed ? K.expand(label) : K.collapse(label)}
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setCollapsed((c) => !c)}
          />
        ) : null}
      </div>
      {open ? (
        <div className="rg-card__body" id={bodyId}>
          {line ? <p className="rg-card__line">{line}</p> : null}
          {stale && ring?.lastSyncAt ? <InlineWarning severity="caution">{C.body.stale(dayText(ring.lastSyncAt, now))}</InlineWarning> : null}
          {syncFailed && ring?.syncError ? <InlineWarning severity="caution">{C.body.syncFailed(ring.syncError)}</InlineWarning> : null}
          {items.length ? <KeyValueList className="rg-card__kv" items={items} /> : null}
          {keys ? <div className="rg-card__keys">{keys}</div> : null}
        </div>
      ) : null}
    </Faceplate>
  );
}
