/**
 * The item-11 master switch's default implementation (SUITE_SPEC §15.2 "Item 11 defaults and the master switch";
 * design/screens/ring-pages.md §5.6), read from the biometrics store.
 *
 * A ring source is what `isRingSource` in `@/biometrics/core/policy` says, the same test the commands use: a channel
 * that starts with `ble:`, or the Lumen source (`file:lumen_cloudevents`). A ring imported through another app's file
 * (Apple Health, Health Connect, Gadgetbridge) is not one: those imports stay opt-in and the switch never changes them.
 * The switch reads **on** when every stream policy of every ring source feeds the scores, the plan (where the stream
 * may) and the Coach; **off** when none does; **some** for any other mix; null when there is no ring source (or the
 * store has not loaded).
 *
 * Changing it sends `bio.setRingSharing { on }`: on → the ring defaults on every ring source; off → scores and engine
 * off, Coach hidden, imported stays on so the Ring pages still show the data. The command also remembers the choice,
 * so a ring connected later starts the same way. The change can be undone through `history.undo` (the toast's Undo).
 * The one-time notice is the `biometrics.ringDefaults` migration's (`bio.dismissRingDefaultsNotice` hides it).
 */
import '@/commands'; // the registry: registers the commands sent here
import { failureMessage, GENERIC_FAILURE, sendCommand } from '@/features/lib/sendCommand';
import { getDocumentStore } from '@/state/runtime';
import { sharedBioIndex } from '@/biometrics/store/docIndex';
import { effectivePolicy } from '@/biometrics/core/effective';
import { isRingSource as isCoreRingSource, normalizePolicy, POLICY_STREAMS, RING_DEFAULTS_ID, ringDefaultsNoticeOf } from '@/biometrics/core/policy';
import type { DeviceType, PolicyStream, StreamPolicy } from '@/biometrics/core/types';
import type { CommandResult } from '@/commands/types';
import type { RingSharing, SharingState } from './data';

/** The Lumen source's channel (its CloudEvents dump, its archive and its MQTT feed share one source key). */
export const LUMEN_CHANNEL = 'file:lumen_cloudevents';

export interface RingSourceLike {
  sourceKey: string;
  policies: readonly StreamPolicy[];
  deviceType?: DeviceType;
}

/** Is this source a ring source (§15.2)? The core test: the channel decides, not the device type on the doc or the one
 * its records carry (`seenType`). */
export function isRingSource(s: { sourceKey: string; deviceType?: DeviceType }, seenType?: DeviceType): boolean {
  return isCoreRingSource(s, seenType);
}

const RING_ON = { imported: true, scores: true, engine: true, coach: 'daily+series' } as const;

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

/** A source's stream policies: its own entries, else (none stored yet) the effective policy of every stream (for a ring
 * source without entries: the person's choices, else the ring default). */
export function streamPoliciesOf(src: RingSourceLike, person: readonly StreamPolicy[]): StreamPolicy[] {
  if (src.policies.length) return src.policies.map((p) => normalizePolicy(p));
  return POLICY_STREAMS.map((s: PolicyStream) => effectivePolicy({ sourceKey: src.sourceKey, policies: [...src.policies] }, person, s));
}

/** on / off / some over every stream of every ring source; null without a ring source. */
export function ringSharingState(sources: readonly RingSourceLike[], person: readonly StreamPolicy[]): SharingState | null {
  if (!sources.length) return null;
  const all = sources.flatMap((s) => streamPoliciesOf(s, person));
  if (all.every(isShared)) return 'on';
  if (all.every(isWithheld)) return 'off';
  return 'some';
}

export interface RingSharingIndex {
  sources(): RingSourceLike[];
  readonly personPolicies: readonly StreamPolicy[];
  readonly deviceTypes: ReadonlyMap<string, DeviceType>;
  /** The `bioSources` documents that are not sources (the migration's record with its notice). */
  readonly sourceDocs?: ReadonlyMap<string, unknown>;
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
      if (!r.ok) throw new Error(failureMessage(r.error) ?? GENERIC_FAILURE);
      const id = changeSetOf(r);
      undoIds = id ? [id] : [];
    },
    async undo() {
      const ids = undoIds;
      undoIds = [];
      for (const id of [...ids].reverse()) await deps.send('history.undo', { changeSetId: id });
    },
    noticePending: () => ringDefaultsNoticeOf(deps.index().sourceDocs?.get(RING_DEFAULTS_ID)),
    dismissNotice() {
      void deps.send('bio.dismissRingDefaultsNotice', {}).catch(() => undefined);
    },
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
        case 'bio.setRingSharing':
          return sendCommand('bio.setRingSharing', input, { silent: true });
        case 'bio.dismissRingDefaultsNotice':
          return sendCommand('bio.dismissRingDefaultsNotice', input, { silent: true });
        case 'history.undo':
          return sendCommand('history.undo', input, { silent: true });
        default:
          return Promise.resolve({ ok: false, error: { code: 'not_found', message: `Unknown command "${id}".` } } as CommandResult);
      }
    },
  }));
}
