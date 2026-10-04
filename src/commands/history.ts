/**
 * ChangeSets, gesture coalescing and undo (SUITE_SPEC §1.5).
 *
 * Every write command opens a ChangeSet; the document ops its executor produced (projection writes through the
 * bridge, `ctx.docs` writes) are merged per document (first "before", last "after") and committed in one document-store
 * transaction together with the ChangeSet's `changeLog` row. Dispatches with the same `coalesceKey` within 1.5 s join
 * the open ChangeSet until `history.seal`; a coalescing ChangeSet commits after 300 ms without new edits.
 *
 * Undo applies the inverse field by field, only where the field still holds the ChangeSet's "after" value, and reports
 * what it skipped.
 *
 * A ChangeSet whose documents cannot be written (quota, an IndexedDB error) is rolled back: the same inverse patches
 * put the projections (and their boot cache) back to the "before" values, ChangeSets still waiting to commit are
 * rebased onto them, and the ChangeSet leaves the history. A coalesced gesture is one ChangeSet, so it rolls back as one.
 * The bus reports it (`commitFailed` with `rolledBack: true`) so the screen can say so.
 */
import { deepEqual, fieldOf, fieldPatch, jsonClone, mintWriteToken, revokeWriteToken, type CollectionId, type Id, type JsonPatchOp, type Tx, type WriteToken } from '@/store';
import { docKey, knownReader, restoreProjections } from '@/state/bridge';
import { commitWithToken, getDocumentStore, storeReader, writeOps } from '@/state/runtime';
import type { DocOpRecord } from '@/state/scope';
import type { Actor, ChangeSetSummary, CommandId } from './types';

export const COALESCE_WINDOW_MS = 1500;
export const COALESCE_IDLE_COMMIT_MS = 300;
export const MAX_CHANGESETS = 300;
const RETENTION_MS = 30 * 24 * 3600 * 1000;

export interface StoredOp {
  col: CollectionId;
  id: string;
  op: 'put' | 'patch' | 'append' | 'remove';
  fields?: readonly string[];
  beforeRev: string | null;
  afterRev: string;
  /** after → before, top-level fields; null when the document was created. */
  inverse: JsonPatchOp[] | null;
  /** before → after, top-level fields; null when the document was removed. */
  forward: JsonPatchOp[] | null;
}

export interface ChangeSet {
  id: Id;
  commandId: CommandId;
  actor: Actor;
  at: string;
  label: string;
  coalesceKey?: string;
  undoneBy?: Id;
  undoes?: Id;
  /** Merged ops (pending until committed). */
  ops: DocOpRecord[];
  stored: StoredOp[];
  token: WriteToken | null;
  committed: boolean;
  sealed: boolean;
  lastAt: number;
  /** Extra writes in the same transaction (ledger rows). */
  extras: Array<(tx: Tx) => Promise<void>>;
  /** Idempotency-ledger keys answered by this ChangeSet (forgotten when it rolls back). */
  ledgerKeys?: string[];
  timer: ReturnType<typeof setTimeout> | null;
  waiters: Array<{ resolve: () => void; reject: (e: unknown) => void }>;
}

const log: ChangeSet[] = [];
/** Commits on their way to the store (settleCommits waits for them). */
const inflight = new Set<Promise<void>>();
/** What happened to a ChangeSet whose commit failed. */
export interface CommitFailure {
  /** True when the documents were not written and the projections went back to the "before" values. */
  rolledBack: boolean;
  /** Fields not rolled back because something changed them since (`col/id.field`), as in `history.undo`. */
  skipped: string[];
}
let failureHook: ((cs: ChangeSet, e: unknown, outcome: CommitFailure) => void) | null = null;

export function onCommitFailure(fn: (cs: ChangeSet, e: unknown, outcome: CommitFailure) => void): void {
  failureHook = fn;
}

export function changeSets(): readonly ChangeSet[] {
  return log;
}

export function getChangeSet(id: string): ChangeSet | undefined {
  return log.find((c) => c.id === id);
}

export function summary(cs: ChangeSet): ChangeSetSummary {
  const docs = cs.committed
    ? cs.stored.map((o) => ({ col: o.col, id: o.id, op: o.op }))
    : cs.ops.map((o) => ({ col: o.col, id: o.id, op: (o.after === null ? 'remove' : (o.kind ?? (o.fields ? 'patch' : 'put'))) as StoredOp['op'] }));
  return {
    id: cs.id,
    commandId: cs.commandId,
    label: cs.label,
    at: cs.at,
    actor: cs.actor,
    docs,
    ...(cs.coalesceKey ? { coalesceKey: cs.coalesceKey } : {}),
    ...(cs.undoneBy ? { undoneBy: cs.undoneBy } : {}),
    ...(cs.undoes ? { undoes: cs.undoes } : {}),
  };
}

/** The open ChangeSet a dispatch joins (same key, same actor, unsealed, within the window), or null. */
export function coalescible(key: string | undefined, actor: Actor, commandId: CommandId, now: number): ChangeSet | null {
  if (!key) return null;
  const last = log[log.length - 1];
  if (!last || last.sealed || last.coalesceKey !== key || last.commandId !== commandId) return null;
  if (last.actor.kind !== actor.kind || last.actor.id !== actor.id) return null;
  if (now - last.lastAt > COALESCE_WINDOW_MS) return null;
  return last;
}

export function openChangeSet(init: { id: Id; commandId: CommandId; actor: Actor; label: string; coalesceKey?: string; at: string; now: number }): ChangeSet {
  const cs: ChangeSet = {
    id: init.id,
    commandId: init.commandId,
    actor: init.actor,
    at: init.at,
    label: init.label,
    ...(init.coalesceKey ? { coalesceKey: init.coalesceKey } : {}),
    ops: [],
    stored: [],
    token: mintWriteToken('command', { changeSetId: init.id, label: init.commandId }),
    committed: false,
    sealed: !init.coalesceKey,
    lastAt: init.now,
    extras: [],
    timer: null,
    waiters: [],
  };
  log.push(cs);
  return cs;
}

/** `body` without `fields`, plus `from`'s values of `fields` (absent and null mean "no value" in a shared document). */
function overlay(body: Record<string, unknown> | null, from: Record<string, unknown> | null, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(body ?? {}) };
  for (const f of fields) {
    delete out[f];
    const v = from?.[f];
    if (v !== undefined && v !== null) out[f] = jsonClone(v);
  }
  return out;
}

/**
 * A projection's write of its fields of a shared document (`fields`) and a whole-document write of the same document
 * (`ctx.docs`, e.g. `uiPrefs/me.ai`) in one ChangeSet: the projection owns its fields, the whole write the rest, and the
 * merged op is a whole-document write. Without this the merged op would keep one side's view only.
 */
function mergeMixed(prev: DocOpRecord, op: DocOpRecord): DocOpRecord {
  const [fieldsOp, whole] = prev.fields ? [prev, op] : [op, prev];
  const owned = fieldsOp.fields!;
  // first "before": the whole write's "before" holds the other fields (nothing is committed yet)
  const before = prev.fields ? (prev.before === null && op.before === null ? null : overlay(op.before, prev.before, owned)) : prev.before;
  const after = whole === op && op.after === null ? null : overlay(whole.after, fieldsOp.after, owned);
  const { fields: _f, ...rest } = prev;
  void _f;
  return { ...rest, before: before ? jsonClone(before) : null, after, kind: prev.kind === 'append' ? 'append' : 'put' };
}

/** Merge new ops into the ChangeSet: per document, keep the first "before" and the latest "after". */
export function addOps(cs: ChangeSet, ops: readonly DocOpRecord[]): void {
  for (const op of ops) {
    const k = docKey(op.col, op.id);
    const i = cs.ops.findIndex((o) => docKey(o.col, o.id) === k);
    if (i < 0) {
      cs.ops.push(jsonClone(op));
      continue;
    }
    const prev = cs.ops[i]!;
    if (Boolean(prev.fields) !== Boolean(op.fields)) {
      cs.ops[i] = mergeMixed(prev, op);
      continue;
    }
    const fields = prev.fields && op.fields ? Array.from(new Set([...prev.fields, ...op.fields])) : undefined;
    cs.ops[i] = { ...prev, after: jsonClone(op.after), ...(fields ? { fields } : {}), kind: prev.kind === 'append' ? 'append' : op.kind };
  }
}

function storedOps(cs: ChangeSet): StoredOp[] {
  const store = getDocumentStore();
  const out: StoredOp[] = [];
  for (const o of cs.ops) {
    if (o.before && o.after && deepEqual(o.before, o.after)) continue;
    const before = o.before ?? {};
    const after = o.after ?? {};
    const restrict = (ops: JsonPatchOp[]) => (o.fields ? ops.filter((p) => o.fields!.includes(fieldOf(p.path))) : ops);
    out.push({
      col: o.col,
      id: o.id,
      op: o.after === null ? 'remove' : o.kind === 'append' ? 'append' : o.fields ? 'patch' : 'put',
      ...(o.fields ? { fields: o.fields } : {}),
      beforeRev: null,
      afterRev: store.peek(o.col, o.id)?._rev ?? '',
      inverse: o.before === null ? null : restrict(fieldPatch(after, before)),
      forward: o.after === null ? null : restrict(fieldPatch(before, after)),
    });
  }
  return out;
}

function changeLogDoc(cs: ChangeSet): Record<string, unknown> & { _id: string } {
  return {
    _id: cs.id,
    commandId: cs.commandId,
    actor: cs.actor,
    at: cs.at,
    label: cs.label,
    ...(cs.coalesceKey ? { coalesceKey: cs.coalesceKey } : {}),
    ...(cs.undoneBy ? { undoneBy: cs.undoneBy } : {}),
    ...(cs.undoes ? { undoes: cs.undoes } : {}),
    ops: cs.stored,
  };
}

function commitNow(cs: ChangeSet): Promise<void> {
  if (cs.committed) return Promise.resolve();
  // Review V1c-13: an earlier ChangeSet still open on one of the same documents (a gesture still coalescing, written
  // at seal or after the idle window) commits first. Otherwise it would land later and put its older "after" over this
  // write. Store transactions run in call order, so starting it first is enough.
  const docs = new Set(cs.ops.map((o) => docKey(o.col, o.id)));
  for (const c of log) {
    if (c === cs) break;
    if (!c.committed && c.ops.some((o) => docs.has(docKey(o.col, o.id)))) {
      c.sealed = true;
      void commitNow(c).catch(() => undefined);
    }
  }
  const p = writeChangeSet(cs);
  inflight.add(p);
  void p.finally(() => inflight.delete(p));
  return p;
}

async function writeChangeSet(cs: ChangeSet): Promise<void> {
  if (cs.timer) clearTimeout(cs.timer);
  cs.timer = null;
  cs.committed = true;
  cs.sealed = true;
  const ops = cs.ops.filter((o) => !(o.before && o.after && deepEqual(o.before, o.after)));
  // what undo needs is known now; revisions are filled in after the write
  cs.stored = storedOps({ ...cs, ops });
  const waiters = cs.waiters.splice(0);
  const token = cs.token!;
  let docsWritten = false;
  try {
    // prune the in-memory log and the persisted rows beyond the cap / retention (only once the write lands)
    const cutoff = Date.now() - RETENTION_MS;
    const evicted: ChangeSet[] = [];
    for (let i = 0; i < log.length; i++) {
      const e = log[i]!;
      if (e === cs) continue;
      if (log.length - evicted.length > MAX_CHANGESETS || Date.parse(e.at) < cutoff) evicted.push(e);
      else break;
    }
    await commitWithToken(token, ops, async (tx) => {
      for (const extra of cs.extras) await extra(tx);
      for (const e of evicted) if (e.committed && e.stored.length) await tx.remove('changeLog', e.id);
    });
    docsWritten = true;
    for (const e of evicted) {
      const i = log.indexOf(e);
      if (i >= 0) log.splice(i, 1);
    }
    const store = getDocumentStore();
    for (const o of cs.stored) o.afterRev = store.peek(o.col, o.id)?._rev ?? o.afterRev;
    if (cs.stored.length > 0) {
      await commitWithToken(token, [], async (tx) => {
        await tx.put('changeLog', changeLogDoc(cs));
      });
    }
    waiters.forEach((w) => w.resolve());
  } catch (e) {
    if (docsWritten) {
      // the documents are saved; only the history row is missing (undo still works in this session)
      failureHook?.(cs, e, { rolledBack: false, skipped: [] });
      waiters.forEach((w) => w.resolve());
    } else {
      const skipped = rollBack(cs, ops);
      failureHook?.(cs, e, { rolledBack: true, skipped });
      waiters.forEach((w) => w.reject(e));
    }
  } finally {
    revokeWriteToken(token);
    cs.token = null;
    cs.ops = [];
  }
}

/**
 * The documents of `cs` were not written: put the projections back to the ChangeSet's "before" values with its inverse
 * patches (field by field, as `history.undo` does: a field something else changed since stays), rebase the ChangeSets
 * still waiting to commit onto those values, and drop `cs` from the history. Documents no projection holds need nothing:
 * the failed transaction left them as they were. Returns the skipped fields.
 */
function rollBack(cs: ChangeSet, ops: readonly DocOpRecord[]): string[] {
  const i = log.indexOf(cs);
  if (i >= 0) log.splice(i, 1);
  const store = storeReader();
  const current = (col: CollectionId, id: string) => knownReader(new Map(), store).get(col, id);
  const plan = planUndo(cs, current);
  const restored = restoreProjections(plan.targets, store, 'rollback');
  // a later ChangeSet recorded its ops on top of the failed values: give it the restored ones instead
  for (const later of log) {
    if (later.committed) continue;
    for (const o of later.ops) {
      const failed = ops.find((x) => x.col === o.col && x.id === o.id);
      const body = restored.get(docKey(o.col, o.id));
      if (!failed?.after || body === undefined) continue;
      for (const f of Object.keys(failed.after)) {
        if (o.fields && !o.fields.includes(f)) continue;
        // only the fields the failed ChangeSet changed and the rollback restored
        const was = failed.after[f];
        if (deepEqual(failed.before?.[f], was) || plan.skipped.includes(`${o.col}/${o.id}.${f}`)) continue;
        for (const side of [o.before, o.after]) {
          if (!side || !deepEqual(side[f], was)) continue;
          if (body && f in body) side[f] = jsonClone(body[f]);
          else delete side[f];
        }
      }
    }
  }
  return plan.skipped;
}

/** Commit now, or after the idle window while the ChangeSet is still coalescing. Resolves when written. */
export function scheduleCommit(cs: ChangeSet): Promise<void> {
  const p = new Promise<void>((resolve, reject) => cs.waiters.push({ resolve, reject }));
  if (cs.committed) {
    cs.waiters.pop()?.resolve();
    return p;
  }
  if (cs.sealed) {
    // V2 (V1c-13): a gesture still waiting for its idle window is older than `cs` and can no longer coalesce (only the
    // last ChangeSet can); written after `cs`, its older snapshot of a shared document would overwrite this edit
    for (const e of log) {
      if (e === cs) break;
      if (!e.committed && !e.sealed && e.timer) {
        e.sealed = true;
        void commitNow(e);
      }
    }
    void commitNow(cs);
    return p;
  }
  if (cs.timer) clearTimeout(cs.timer);
  cs.timer = setTimeout(() => void commitNow(cs), COALESCE_IDLE_COMMIT_MS);
  return p;
}

/** `history.seal`: close coalescing (pointer-up, blur) and commit. Without a key, seals every open ChangeSet. */
export async function seal(coalesceKey?: string): Promise<number> {
  // ChangeSets without ops yet belong to a command still executing (its dispatcher commits it)
  const open = log.filter((c) => !c.committed && (c.ops.length > 0 || c.extras.length > 0) && (!coalesceKey || c.coalesceKey === coalesceKey));
  for (const c of open) c.sealed = true;
  await Promise.all(open.map((c) => commitNow(c)));
  return open.length;
}

/** Wait for every pending commit (tests, export, before erase). */
export async function settleCommits(): Promise<void> {
  await seal();
  while (inflight.size) await Promise.all(Array.from(inflight));
}

/** How long a read waits at most for a gesture that keeps coalescing (a long slider drag); then it reads the store. */
export const READ_WAIT_MAX_MS = COALESCE_WINDOW_MS + COALESCE_IDLE_COMMIT_MS;

/**
 * Writes a read must wait for (Q3-J5-10): the `committed` event fires when a write ran, before its documents land
 * (an IndexedDB transaction, or the 300 ms idle window of a coalescing gesture), and reads look at the stored
 * documents. Resolves once the commits on their way and the gestures still coalescing are written — without sealing
 * them (a gesture stays one undo step) and capped at {@link READ_WAIT_MAX_MS}. `null` when nothing is pending, so a
 * read with nothing to wait for does not wait at all. A failed commit counts as settled (it rolled back).
 * ChangeSets with no ops yet belong to a command still executing; they are not waited for (that command may be the one
 * dispatching this read).
 */
export function pendingWrites(): Promise<void> | null {
  const waits: Promise<unknown>[] = Array.from(inflight, (p) => p.catch(() => undefined));
  for (const cs of log) {
    if (cs.committed || (cs.ops.length === 0 && cs.extras.length === 0)) continue;
    waits.push(new Promise<void>((resolve) => cs.waiters.push({ resolve, reject: () => resolve() })));
  }
  if (!waits.length) return null;
  let cap: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.all(waits).then(() => undefined),
    new Promise<void>((resolve) => (cap = setTimeout(resolve, READ_WAIT_MAX_MS))),
  ]).finally(() => clearTimeout(cap));
}

/** Drop an empty ChangeSet (a command that changed nothing). */
export function discardIfEmpty(cs: ChangeSet): boolean {
  if (cs.ops.length > 0 || cs.extras.length > 0 || cs.committed) return false;
  const i = log.indexOf(cs);
  if (i >= 0) log.splice(i, 1);
  if (cs.token) revokeWriteToken(cs.token);
  cs.token = null;
  cs.committed = true;
  cs.waiters.splice(0).forEach((w) => w.resolve());
  return true;
}

/** Forget an uncommitted ChangeSet (dry runs, failed executors). */
export function abandon(cs: ChangeSet): void {
  const i = log.indexOf(cs);
  if (i >= 0) log.splice(i, 1);
  if (cs.timer) clearTimeout(cs.timer);
  if (cs.token) revokeWriteToken(cs.token);
  cs.token = null;
  cs.committed = true;
  cs.waiters.splice(0).forEach((w) => w.resolve());
}

/** Load persisted ChangeSets (after a reload) so `history.list` / `history.undo` keep working. */
export function loadChangeLog(): void {
  const docs = getDocumentStore().peekAll<Record<string, unknown>>('changeLog');
  const known = new Set(log.map((c) => c.id));
  const loaded: ChangeSet[] = [];
  for (const d of docs) {
    if (known.has(d._id)) continue;
    loaded.push({
      id: d._id,
      commandId: d.commandId as CommandId,
      actor: d.actor as Actor,
      at: String(d.at),
      label: String(d.label ?? d.commandId),
      ...(typeof d.coalesceKey === 'string' ? { coalesceKey: d.coalesceKey } : {}),
      ...(typeof d.undoneBy === 'string' ? { undoneBy: d.undoneBy } : {}),
      ...(typeof d.undoes === 'string' ? { undoes: d.undoes } : {}),
      ops: [],
      stored: (d.ops as StoredOp[]) ?? [],
      token: null,
      committed: true,
      sealed: true,
      lastAt: Date.parse(String(d.at)) || 0,
      extras: [],
      timer: null,
      waiters: [],
    });
  }
  log.unshift(...loaded.sort((a, b) => (a.id < b.id ? -1 : 1)));
}

/** Drop local rows past their retention: ChangeSets after 30 days, idempotency ledger rows after 24 h. */
export async function pruneLocalLogs(now: number = Date.now()): Promise<number> {
  const store = getDocumentStore();
  await store.ready;
  const ops: DocOpRecord[] = [];
  const old = (col: 'changeLog' | 'commandLedger', ttl: number) => {
    for (const d of store.peekAll<{ at?: string }>(col)) {
      const at = Date.parse(String(d.at ?? ''));
      if (Number.isFinite(at) && at < now - ttl) ops.push({ col, id: d._id, before: { at: d.at }, after: null });
    }
  };
  old('changeLog', RETENTION_MS);
  old('commandLedger', 24 * 3600 * 1000);
  await writeOps('derive', ops, 'retention');
  return ops.length;
}

/** Mark a ChangeSet undone (persisted with the undoing command's transaction). */
export function markUndone(cs: ChangeSet, by: Id, extras: ChangeSet['extras']): void {
  cs.undoneBy = by;
  if (cs.committed) {
    extras.push(async (tx) => {
      if (cs.stored.length) await tx.put('changeLog', changeLogDoc(cs));
    });
  }
}

/* ---------------------------------------------------------------- undo planning */

export interface UndoPlan {
  /** Target body per document (null = remove; for shared docs only the listed fields). */
  targets: Array<{ col: CollectionId; id: string; body: Record<string, unknown> | null; fields?: readonly string[] }>;
  skipped: string[];
}

const valueAt = (ops: readonly JsonPatchOp[] | null, field: string): { present: boolean; value?: unknown } => {
  const op = ops?.find((o) => fieldOf(o.path) === field);
  if (!op) return { present: false };
  return op.op === 'remove' ? { present: false } : { present: true, value: op.value };
};

/** Plan the undo of `cs` against the current documents. */
export function planUndo(cs: ChangeSet, current: (col: CollectionId, id: string) => Record<string, unknown> | null): UndoPlan {
  const stored = cs.committed ? cs.stored : storedOps(cs);
  const targets: UndoPlan['targets'] = [];
  const skipped: string[] = [];
  for (const op of stored) {
    const cur = current(op.col, op.id);
    const label = `${op.col}/${op.id}`;
    if (op.inverse === null) {
      // created by the ChangeSet: remove it if it still looks the way the ChangeSet left it
      const fields = (op.forward ?? []).map((p) => fieldOf(p.path));
      const untouched = cur !== null && fields.every((f) => deepEqual(cur[f], valueAt(op.forward, f).value));
      if (!cur) continue;
      if (!untouched) {
        skipped.push(label);
        continue;
      }
      targets.push({ col: op.col, id: op.id, body: op.fields ? null : null, ...(op.fields ? { fields: op.fields } : {}) });
      continue;
    }
    if (op.forward === null) {
      // removed by the ChangeSet: restore it unless something recreated it
      if (cur && !op.fields) {
        skipped.push(label);
        continue;
      }
      const restored: Record<string, unknown> = { ...(cur ?? {}) };
      for (const p of op.inverse) if (p.op !== 'remove') restored[fieldOf(p.path)] = jsonClone(p.value);
      targets.push({ col: op.col, id: op.id, body: restored, ...(op.fields ? { fields: op.fields } : {}) });
      continue;
    }
    const next: Record<string, unknown> = { ...(cur ?? {}) };
    let changed = false;
    for (const p of op.forward) {
      const f = fieldOf(p.path);
      const after = valueAt(op.forward, f);
      const nowV = cur?.[f];
      const stillAfter = after.present ? deepEqual(nowV, after.value) : nowV === undefined;
      if (!stillAfter) {
        skipped.push(`${label}.${f}`);
        continue;
      }
      const before = valueAt(op.inverse, f);
      if (before.present) next[f] = jsonClone(before.value);
      else delete next[f];
      changed = true;
    }
    if (changed) targets.push({ col: op.col, id: op.id, body: next, ...(op.fields ? { fields: op.fields } : {}) });
  }
  return { targets, skipped };
}

/** Tests: forget the in-memory log. */
export function resetHistory(): void {
  for (const c of log) {
    if (c.timer) clearTimeout(c.timer);
    // a commit already on its way keeps its token until it lands
    if (c.token && !c.committed) revokeWriteToken(c.token);
    c.committed = true;
  }
  log.length = 0;
}
