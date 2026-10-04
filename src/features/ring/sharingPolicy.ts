/**
 * The item-11 master switch's default implementation (SUITE_SPEC §15.2 "Item 11 defaults and the master switch";
 * design/screens/ring-pages.md §5.6), read from the biometrics store.
 *
 * A ring source is a `bioSources` source whose device type is a ring, whose channel starts with `ble:`, or the Lumen
 * source (`file:lumen_cloudevents`). The switch reads **on** when every stream policy of every ring source feeds the
 * scores, the plan (where the stream may) and the Coach; **off** when none does; **some** for any other mix; null when
 * there is no ring source (or the store has not loaded).
 *
 * Changing it sends `bio.setRingSharing { on }` (L-RINGSVC). Until that command exists the switch falls back to
 * `bio.setPolicy` per ring source and stream, as §15.2 describes: on → the ring defaults (imported, scores, engine where
 * eligible, Coach daily+series); off → scores and engine off, Coach hidden; imported stays on so the Ring pages still
 * show the data. Each change can be undone through `history.undo` (the toast's Undo).
 */
import '@/commands'; // the registry: registers the commands sent here
import { failureMessage, GENERIC_FAILURE, sendCommand } from '@/features/lib/sendCommand';
import { getDocumentStore } from '@/state/runtime';
import { sharedBioIndex } from '@/biometrics/store/docIndex';
import { effectivePolicy } from '@/biometrics/core/effective';
import { channelOfSourceKey, normalizePolicy, POLICY_STREAMS } from '@/biometrics/core/policy';
import type { DeviceType, PolicyStream, StreamPolicy } from '@/biometrics/core/types';
import type { CommandError, CommandResult } from '@/commands/types';
import type { RingSharing, SharingState } from './data';

/** The Lumen source's channel (its CloudEvents dump, its archive and its MQTT feed share one source key). */
export const LUMEN_CHANNEL = 'file:lumen_cloudevents';

export interface RingSourceLike {
  sourceKey: string;
  policies: readonly StreamPolicy[];
  deviceType?: DeviceType;
}

/** Is this source a ring source (§15.2)? `seenType` is the device type its records carry, when the doc has none. */
export function isRingSource(s: { sourceKey: string; deviceType?: DeviceType }, seenType?: DeviceType): boolean {
  const channel = channelOfSourceKey(s.sourceKey);
  return s.deviceType === 'ring' || seenType === 'ring' || channel.startsWith('ble:') || channel === LUMEN_CHANNEL;
}

const RING_ON = { imported: true, scores: true, engine: true, coach: 'daily+series' } as const;
const RING_OFF = { scores: false, engine: false, coach: 'hidden' } as const;

/** The stream feeds everything the ring defaults allow it to (vendor streams never feed scores or the plan). */
export function isShared(p: StreamPolicy): boolean {
  const n = normalizePolicy(p);
  const want = normalizePolicy({ stream: p.stream, ...RING_ON });
  return n.imported && n.scores === want.scores && n.engine === want.engine && n.coach !== 'hidden';
}

/** The stream feeds nothing: no scores, no plan, hidden from the Coach. */
export function isWithheld(p: StreamPolicy): boolean {
  const n = normalizePolicy(p);
  return !n.scores && !n.engine && n.coach === 'hidden';
}

/** A source's stream policies: its own entries, else (none stored yet) the effective policy of every stream. */
export function streamPoliciesOf(src: RingSourceLike, person: readonly StreamPolicy[]): StreamPolicy[] {
  if (src.policies.length) return src.policies.map((p) => normalizePolicy(p));
  return POLICY_STREAMS.map((s: PolicyStream) => effectivePolicy({ policies: [...src.policies] }, person, s));
}

/** on / off / some over every stream of every ring source; null without a ring source. */
export function ringSharingState(sources: readonly RingSourceLike[], person: readonly StreamPolicy[]): SharingState | null {
  if (!sources.length) return null;
  const all = sources.flatMap((s) => streamPoliciesOf(s, person));
  if (all.every(isShared)) return 'on';
  if (all.every(isWithheld)) return 'off';
  return 'some';
}

/** The command is not there (yet): unknown to the registry, or registered as a stub. */
function isMissingCommand(e: CommandError): boolean {
  return (e.code === 'not_found' && /^Unknown command/i.test(e.message)) || e.detail?.precondition === 'implemented';
}

export interface RingSharingIndex {
  sources(): RingSourceLike[];
  readonly personPolicies: readonly StreamPolicy[];
  readonly deviceTypes: ReadonlyMap<string, DeviceType>;
  subscribe(fn: () => void): () => void;
}

export interface RingSharingDeps {
  index(): RingSharingIndex;
  send(id: string, input: unknown): Promise<CommandResult>;
}

/** `RingSharing` plus Undo of the last change (the toast's action). */
export interface UndoableRingSharing extends RingSharing {
  undo(): Promise<void>;
}

const changeSetOf = (r: CommandResult): string | null => (r.ok && 'changeSet' in r && r.changeSet ? r.changeSet.id : null);

export function createRingSharing(deps: RingSharingDeps): UndoableRingSharing {
  let undoIds: string[] = [];
  const ringSources = () => {
    const ix = deps.index();
    return ix.sources().filter((s) => isRingSource(s, ix.deviceTypes.get(s.sourceKey)));
  };
  return {
    subscribe: (fn) => deps.index().subscribe(fn),
    state: () => ringSharingState(ringSources(), deps.index().personPolicies),
    async set(on) {
      const r = await deps.send('bio.setRingSharing', { on });
      if (r.ok) {
        const id = changeSetOf(r);
        undoIds = id ? [id] : [];
        return;
      }
      if (!isMissingCommand(r.error)) throw new Error(failureMessage(r.error) ?? GENERIC_FAILURE);
      // fallback until bio.setRingSharing lands: the same change, stream by stream, on every ring source
      const ids: string[] = [];
      const person = deps.index().personPolicies;
      try {
        for (const src of ringSources()) {
          for (const p of streamPoliciesOf(src, person)) {
            if (on ? isShared(p) : isWithheld(p)) continue;
            const res = await deps.send('bio.setPolicy', { stream: p.stream, sourceKey: src.sourceKey, policy: on ? RING_ON : RING_OFF });
            if (!res.ok) throw new Error(failureMessage(res.error) ?? GENERIC_FAILURE);
            const id = changeSetOf(res);
            if (id) ids.push(id);
          }
        }
      } finally {
        undoIds = ids;
      }
    },
    async undo() {
      const ids = undoIds;
      undoIds = [];
      for (const id of [...ids].reverse()) await deps.send('history.undo', { changeSetId: id });
    },
    // The ring service owns the one-time notice from the `biometrics.ringDefaults` migration (L-RINGSVC); until it
    // provides that flag there is nothing to show.
    noticePending: () => false,
    dismissNotice() {},
  };
}

let shared: UndoableRingSharing | null = null;

/** The app's master switch, over the person's stored sources. */
export function defaultRingSharing(): UndoableRingSharing {
  return (shared ??= createRingSharing({
    index: () => sharedBioIndex(getDocumentStore()),
    // literal ids only (the command census in src/commands/__tests__/parity.test.ts reads them)
    send: (id, input) => {
      switch (id) {
        case 'bio.setPolicy':
          return sendCommand('bio.setPolicy', input, { silent: true });
        case 'history.undo':
          return sendCommand('history.undo', input, { silent: true });
        default:
          // `bio.setRingSharing` (L-RINGSVC) is not registered yet: answer "unknown" so `set` takes the per-stream
          // fallback. When it lands add: case 'bio.setRingSharing': return sendCommand('bio.setRingSharing', input, …)
          return Promise.resolve({ ok: false, error: { code: 'not_found', message: `Unknown command "${id}".` } } as CommandResult);
      }
    },
  }));
}
