/**
 * Ring data on by default (plan 04 item 11, SUITE_SPEC §15.2): the master switch `bio.setRingSharing` ("Use my ring
 * data in my plan and Coach"), the one-time move of existing ring sources to the ring defaults
 * (`biometrics.ringDefaults`, system actor) and its notice on the Ring page (`bio.dismissRingDefaultsNotice`).
 *
 * The migration records that it ran in `bioSources/ringDefaults:me` (synced, so a second device does not redo it; not a
 * source: it has no label, so every source list skips it). That document also holds the notice state. The switch stores
 * the person's choice beside it in `bioSources/ringSharing:me` (synced, its own document so the migration's record never
 * overwrites it), and every new ring source starts from that choice. Loaded lazily by `./index.ts`.
 */
import {
  isRingSource, normalizePolicy, POLICY_STREAMS, RING_DEFAULTS_ID, RING_SHARING_ID, ringChoiceOf, ringDefaultPolicy, ringDefaultsNoticeOf, ringPoliciesAtDefault,
  ringSharing, ringSharingOffPolicy, ringStartPolicy, type RingChoice,
} from '@/biometrics/core/policy';
import { addDays } from '@/biometrics/core/scores/util';
import type { BioSourceDoc, PolicyStream, StreamPolicy } from '@/biometrics/core/types';
import type { BioDocIndex } from '@/biometrics/store/docIndex';
import { getDocumentStore } from '@/state/runtime';
import { fail } from '../registry';
import type { Actor, CommandContext } from '../types';
import { bioIndex, commandWriter, openBioStore } from './store';
import { scheduleRescore } from './runtime';

/** Ids of the migration's record and of the person's choice in `bioSources` (never source keys: those start with a
 * channel). */
export { RING_DEFAULTS_ID, RING_SHARING_ID };

/** The person's master-switch choice, as new ring sources start from it. */
export function storedRingChoice(ix: BioDocIndex): RingChoice {
  return ringChoiceOf(ix.sourceDocs.get(RING_SHARING_ID));
}

interface RingDefaultsBody {
  kind: 'ringDefaults';
  ranAt: string;
  /** How many ring sources moved to the ring defaults: never their keys (an old key may carry an advertised name, and the
   * fold may delete the source afterwards). */
  moved: number;
  /** How many ring sources the person had changed, left alone. */
  kept: number;
  /** 'show' until the person dismisses it; 'none' when nothing moved, or it moved with the master switch off. */
  notice: 'show' | 'dismissed' | 'none';
}

const markerOf = (ix: BioDocIndex): Partial<RingDefaultsBody> | undefined => ix.sourceDocs.get(RING_DEFAULTS_ID) as Partial<RingDefaultsBody> | undefined;

/** True while the Ring page should show the one-time notice. */
export function ringDefaultsNotice(ix: BioDocIndex): boolean {
  return ringDefaultsNoticeOf(markerOf(ix));
}

const same = (a: StreamPolicy, b: StreamPolicy) => JSON.stringify(normalizePolicy(a)) === JSON.stringify(normalizePolicy(b));
const isPolicyStream = (s: string) => (POLICY_STREAMS as readonly string[]).includes(s);

/** A ring source's policy list with every stream set by `want` (streams beyond the fixed list, e.g. `vendor:*`, too). */
function ringPolicies(src: Pick<BioSourceDoc, 'policies'>, want: (s: PolicyStream, cur: StreamPolicy | undefined) => StreamPolicy): StreamPolicy[] {
  const out = POLICY_STREAMS.map((s) => want(s, src.policies.find((p) => p.stream === s)));
  for (const p of src.policies) if (!isPolicyStream(p.stream)) out.push(want(p.stream, p));
  return out.sort((a, b) => a.stream.localeCompare(b.stream));
}

const samePolicies = (a: readonly StreamPolicy[], b: readonly StreamPolicy[]) =>
  a.length === b.length && a.every((p) => {
    const q = b.find((x) => x.stream === p.stream);
    return q !== undefined && same(p, q);
  });

/* =============================================================================== bio.setRingSharing */

export async function setRingSharing(ctx: CommandContext, input: { on: boolean }) {
  const ix = await bioIndex();
  const choice: RingChoice = input.on ? 'on' : 'off';
  // remembered for rings connected later, on every device; part of this change, so Undo restores the previous choice
  if (storedRingChoice(ix) !== choice) await ctx.docs.put('bioSources', { kind: 'ringSharing', choice, updatedAt: ctx.now, _id: RING_SHARING_ID });
  const store = await openBioStore({ writer: commandWriter(ctx.docs) });
  let rescore = false;
  for (const src of await store.sources()) {
    if (!isRingSource(src)) continue;
    const next = ringPolicies(src, (s, cur) => (input.on ? ringDefaultPolicy(s) : ringSharingOffPolicy(s, cur)));
    if (samePolicies(src.policies, next)) continue;
    rescore ||= next.some((p) => {
      const cur = src.policies.find((x) => x.stream === p.stream);
      return !cur || cur.scores !== p.scores || cur.imported !== p.imported;
    });
    await store.putSource({ ...src, policies: next });
  }
  await store.flush();
  if (rescore) scheduleRescore(addDays(ctx.today, -89));
  return { state: ringSharing(await store.sources()) };
}

/* =============================================================================== biometrics.ringDefaults (migration) */

const PERSON_POLICY_COMMANDS = new Set(['bio.setPolicy', 'bio.setRingSharing']);

/** Sources a policy change by the person wrote (this device's change log; undone changes do not count). */
export function changedByPerson(): Set<string> {
  const out = new Set<string>();
  for (const d of getDocumentStore().peekAll<{ commandId?: string; actor?: Actor; undoneBy?: string; ops?: Array<{ col: string; id: string }> }>('changeLog')) {
    if (!d.commandId || !PERSON_POLICY_COMMANDS.has(d.commandId) || d.actor?.kind !== 'user' || d.undoneBy) continue;
    for (const op of d.ops ?? []) if (op.col === 'bioSources') out.add(op.id);
  }
  return out;
}

/**
 * Once per person: every ring source whose policies the person never changed gets the ring defaults (or, when the
 * person has turned the master switch off, what the switch writes), and the Ring page shows a notice. A source counts
 * as changed when a `bio.setPolicy` or `bio.setRingSharing` by the person wrote it (the change log) or when one of its
 * entries is neither the old device-on suggestion nor the ring default. Nothing is recorded until a ring source was
 * moved or kept: a device whose ring source has not synced in yet (a new device whose first sync comes in batches, or
 * one holding only an earlier file import) would otherwise mark the migration done for every device.
 */
export async function ringDefaultsMigration(ctx: CommandContext) {
  if (ctx.actor.kind !== 'system') fail('precondition_failed', 'Vitals runs this itself.', { rule: 'system_actor' });
  const none = { ran: false, moved: [] as string[], kept: [] as string[] };
  const ix = await bioIndex();
  if (markerOf(ix)?.ranAt) return none;
  const choice = storedRingChoice(ix);
  const store = await openBioStore({ writer: commandWriter(ctx.docs) });
  const touched = changedByPerson();
  const moved: string[] = [];
  const kept: string[] = [];
  for (const src of await store.sources()) {
    if (!isRingSource(src)) continue;
    if (touched.has(src.sourceKey) || !ringPoliciesAtDefault(src.policies)) {
      kept.push(src.sourceKey);
      continue;
    }
    const next = ringPolicies(src, (s) => ringStartPolicy(s, choice));
    if (samePolicies(src.policies, next)) continue;
    await store.putSource({ ...src, policies: next });
    moved.push(src.sourceKey);
  }
  if (moved.length + kept.length === 0) return none;
  await store.flush();
  const notice = moved.length && choice === 'on' ? 'show' : 'none';
  const body: RingDefaultsBody = { kind: 'ringDefaults', ranAt: ctx.now, moved: moved.length, kept: kept.length, notice };
  await ctx.docs.put('bioSources', { ...body, _id: RING_DEFAULTS_ID });
  if (moved.length) scheduleRescore(addDays(ctx.today, -89));
  return { ran: true, moved, kept };
}

/* =============================================================================== bio.dismissRingDefaultsNotice */

export async function dismissRingDefaultsNotice(ctx: CommandContext) {
  const ix = await bioIndex();
  if (markerOf(ix)?.notice !== 'show') return { dismissed: false };
  await ctx.docs.patch('bioSources', RING_DEFAULTS_ID, { notice: 'dismissed' });
  return { dismissed: true };
}
