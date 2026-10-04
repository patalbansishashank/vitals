/** `history.*` (SUITE_SPEC §1.5): list, undo (field by field) and seal (end of a gesture). */
import { bodyOf, deepEqual, jsonClone, type CollectionId } from '@/store';
import { effectiveEntries } from '@/living';
import { bindingsFor, docKey, getBindings, knownReader, ownsDoc } from '@/state/bridge';
import { getDocumentStore, storeReader } from '@/state/runtime';
import * as sched from '@/state/internal/schedule';
import { changeSets, getChangeSet, markUndone, planUndo, seal, summary } from '../history';
import { defineCommand, fail } from '../registry';
import { T } from '../schema';
import { ALL, UNDO } from './_shared';

/* ---------------------------------------------------------------- history */

const ChangeSetView = T.Object({
  id: T.String(),
  commandId: T.String(),
  label: T.String(),
  at: T.String(),
  actor: T.OpenObject(),
  docs: T.Array(T.Object({ col: T.String(), id: T.String(), op: T.String() })),
  coalesceKey: T.Optional(T.String()),
  undoneBy: T.Optional(T.String()),
  undoes: T.Optional(T.String()),
});

export const historyList = defineCommand({
  id: 'history.list',
  version: 1,
  title: 'Recent changes',
  description: 'Recent changes (newest first): what changed, when, by whom (the person, the Coach, an agent) and whether it was undone. Optionally only those touching one scenario.',
  input: T.Object({ limit: T.Optional(T.Integer({ minimum: 1, maximum: 100 })), scenarioId: T.Optional(T.String()) }),
  output: T.Array(ChangeSetView),
  perm: 'read',
  surfaces: ALL,
  excludedReason: { ui: 'no history screen yet (the Coach change review, E9, lists changes)' },
  undo: UNDO.none,
  idempotency: 'natural',
  sideEffects: [],
  execute: (_ctx, input) =>
    changeSets()
      .map(summary)
      .filter((s) => !input.scenarioId || s.docs.some((d) => d.col === 'scenarios' && d.id === input.scenarioId))
      .reverse()
      .slice(0, input.limit ?? 20) as never,
});

/**
 * The full current body of a document: the projections' view of the fields they hold, the store for the rest. A shared
 * document (`uiPrefs/me`) also carries fields no projection holds (`ai`, `agents`, written through `ctx.docs`); the
 * projection view alone would hide them and undo would skip them.
 */
function currentBody(col: CollectionId, id: string): Record<string, unknown> | null {
  const key = docKey(col, id);
  const stored = storeReader().get(col, id);
  let out: Record<string, unknown> | null = stored ? { ...stored } : null;
  for (const b of getBindings()) {
    const k = b.known.get(key);
    if (!k) continue;
    // a projection that holds the whole document: its view is the document
    if (!k.fields) return knownReader(new Map(), storeReader()).get(col, id);
    out = { ...(out ?? {}) };
    for (const f of k.fields) delete out[f];
    Object.assign(out, jsonClone(k.body));
  }
  return out;
}

/** Fields of a document some projection holds (null: a projection holds it whole). */
function heldFields(col: CollectionId, id: string): Set<string> | null {
  const key = docKey(col, id);
  const held = new Set<string>();
  for (const b of bindingsFor(col, id)) {
    if (ownsDoc(b, col, id)) return null;
    const k = b.known.get(key);
    if (k && !k.fields) return null;
    for (const f of k?.fields ?? []) held.add(f);
    for (const s of b.shares ?? []) if (s.col === col && s.id === id) for (const f of s.fields) held.add(f);
  }
  return held;
}

export const historyUndo = defineCommand({
  id: 'history.undo',
  version: 1,
  title: 'Undo a change',
  description:
    'Undo one change by its id (from history.list): each field goes back to its earlier value if nobody changed it since; fields changed since are skipped and listed. Agents may undo only their own changes.',
  input: T.Object({ changeSetId: T.String({ minLength: 1 }) }),
  output: T.Object({ undone: T.Boolean(), skipped: T.Array(T.String()) }),
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  undo: UNDO.none,
  idempotency: 'natural',
  sideEffects: ['docs'],
  execute: (ctx, input) => {
    const cs = getChangeSet(input.changeSetId) ?? fail('not_found', 'That change is no longer in the history.');
    if (cs.undoneBy) fail('conflict', 'That change was already undone.');
    if (ctx.actor.kind !== 'user' && ctx.actor.kind !== 'system' && (cs.actor.kind !== ctx.actor.kind || cs.actor.id !== ctx.actor.id || (ctx.actor.conversationId !== undefined && cs.actor.conversationId !== ctx.actor.conversationId)))
      fail('surface_forbidden', 'Only changes made from here can be undone from here.');
    // the change (and anything still coalescing) reaches the store before its inverse does
    void seal();
    const plan = planUndo(cs, currentBody);
    const overrides = new Map<string, Record<string, unknown> | null>();
    const unbound: Array<{ col: CollectionId; id: string; body: Record<string, unknown> | null }> = [];
    const appendOnly: Array<{ col: 'dailyLogs' | 'measurements'; body: Record<string, unknown> & { _id: string } }> = [];
    for (const t of plan.targets) {
      if (t.col === 'dailyLogs' || t.col === 'measurements') {
        if (t.body !== null) fail('conflict', 'This log change cannot be undone by replacing a stored entry.');
        const all = getDocumentStore().peekAll<{ supersedes?: string; kind?: string; target?: string }>(t.col)
          .map((doc) => ({ ...bodyOf<{ supersedes?: string; kind?: string; target?: string }>(doc), id: doc._id }));
        if (!effectiveEntries(all, true).some((entry) => entry.id === t.id)) fail('conflict', 'That log entry changed since. Look at it again first.');
        const created = currentBody(t.col, t.id) ?? fail('not_found', 'The log entry to undo is missing.');
        const { id: _id, _id: _storeId, ...body } = created;
        void _id; void _storeId;
        if (body.kind === 'retract' && typeof body.target === 'string') {
          const restored = currentBody(t.col, body.target) ?? fail('not_found', 'The removed entry to restore is missing.');
          const { id: _restoreId, _id: _restoreStoreId, ...copy } = restored;
          void _restoreId; void _restoreStoreId;
          appendOnly.push({ col: t.col, body: { ...copy, at: ctx.now, supersedes: t.id, _id: ctx.newId() } });
        } else {
          appendOnly.push({ col: t.col, body: {
            date: body.date, at: ctx.now, source: body.source, kind: 'retract', target: t.id,
            ...(t.col === 'dailyLogs' ? { tz: body.tz } : { metric: body.metric, value: body.value }), _id: ctx.newId(),
          } });
        }
        continue;
      }
      let body = t.body;
      if (body === null && t.fields) {
        const cur = { ...(currentBody(t.col, t.id) ?? {}) };
        for (const f of t.fields) delete cur[f];
        body = cur;
      }
      overrides.set(docKey(t.col, t.id), body);
      if (bindingsFor(t.col, t.id).length === 0) {
        unbound.push({ col: t.col, id: t.id, body });
        continue;
      }
      // a shared document: the projections restore their fields below; the fields none holds are written here (the
      // ChangeSet merges both into one whole-document write, `addOps`)
      const held = heldFields(t.col, t.id);
      if (!held) continue;
      const cur = currentBody(t.col, t.id) ?? {};
      if (body === null) {
        // created by the change: its unshared fields go; the projections' fields stay theirs
        const kept = Object.fromEntries(Object.entries(cur).filter(([f]) => held.has(f)));
        if (Object.keys(kept).length === Object.keys(cur).length) continue;
        unbound.push({ col: t.col, id: t.id, body: Object.keys(kept).length ? kept : null });
        continue;
      }
      const unshared = new Set([...Object.keys(cur), ...Object.keys(body)].filter((f) => !held.has(f)));
      if ([...unshared].some((f) => !deepEqual(cur[f], body[f]))) unbound.push({ col: t.col, id: t.id, body });
    }
    const read = knownReader(overrides, storeReader());
    const touched = new Set(plan.targets.flatMap((t) => bindingsFor(t.col, t.id)));
    for (const b of touched) {
      const next = b.fromDocs(read);
      if (next && !deepEqual(next, b.snapshot())) b.apply(next, 'current');
    }
    const pending = [
      ...unbound.map((u) => (u.body === null ? ctx.docs.remove(u.col, u.id) : ctx.docs.put(u.col, { ...u.body, _id: u.id }))),
      ...appendOnly.map((u) => ctx.docs.append(u.col, u.body)),
    ];
    const mine = ctx.changeSetId ? getChangeSet(ctx.changeSetId) : undefined;
    if (mine) {
      mine.undoes = cs.id;
      markUndone(cs, mine.id, mine.extras);
    }
    const out = { undone: plan.targets.length > 0, skipped: plan.skipped };
    return pending.length ? Promise.all(pending).then(() => out) : out;
  },
});

export const historySeal = defineCommand({
  id: 'history.seal',
  version: 1,
  title: 'Finish a gesture',
  description: 'Close a coalescing gesture (pointer-up, blur) so the next edit starts a new undo step. Without a key, closes every open gesture; with scenarioId, also the scenario’s schedule step.',
  input: T.Object({ coalesceKey: T.Optional(T.String({ maxLength: 120 })), scenarioId: T.Optional(T.String()) }),
  output: T.Object({ sealed: T.Integer() }),
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  undo: UNDO.none,
  idempotency: 'natural',
  sideEffects: ['docs'],
  execute: (_ctx, input) => {
    if (input.scenarioId) sched.seal(input.scenarioId);
    else if (!input.coalesceKey) sched.sealAll();
    const open = changeSets().filter((c) => !c.committed && (!input.coalesceKey || c.coalesceKey === input.coalesceKey)).length;
    void seal(input.coalesceKey);
    return { sealed: open };
  },
});

declare module '../types' {
  interface CommandMap {
    'history.list': typeof historyList;
    'history.undo': typeof historyUndo;
    'history.seal': typeof historySeal;
  }
}
