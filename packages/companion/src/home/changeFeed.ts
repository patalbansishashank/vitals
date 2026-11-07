/**
 * The change feed of imported actuals (r063 CORE, audit S13/A6; docs/SERVER.md "Change feed"): `gauge_changes` /
 * `GET /v1/gauge/changes?since=<cursor>`. Vitals imports Gauge workouts, Health Connect exercise sessions and Health
 * Connect weights as activities and measurements; when one is revised or deleted upstream, the feed says so, so Vitals
 * withdraws (or re-asks about) what it imported from it instead of inferring a deletion from a record's absence.
 *
 * - The cursor is `c1.<events seq>.<deletions rowid>`: the highest `event_state` row and `deletions` row already
 *   reported. Events are append-only (their rowids never change); a Gauge deletion is a `deletions` row.
 * - A call without `since` reports nothing and answers the current cursor (`resync: true`): the client reads its window
 *   once, then follows the feed. A cursor ahead of the store (a restored file) also answers `resync: true`.
 * - Bounded: one page scans at most `FEED_SCAN_EVENTS` events and `FEED_SCAN_DELETIONS` deletions after the cursor (by
 *   primary key), reads at most `FEED_SCAN_HIDDEN` hidden records of the deletions (in keyset pages of
 *   `FEED_MAX_SUBJECTS`), and reports at most `limit` changes; `more` says another page follows.
 * - (0.6.3 FX1, sR02/aR04) A deletion that hides many imported records (a `*` reset, a bulk delete) is listed across pages,
 *   never dropped for a `resync`: the cursor can stop inside one deletion, `c1.<seq>.<deletion rowid>.<target>.<observed
 *   ms>.<seq>` (that deletion is read on from the hidden record after the given one; the deletions before it are done).
 * - (FX1) `subjectStates` answers the state now of the records a client names (a resync after `resync: true` pages its
 *   imported refs through it): present, deleted, or unknown (the server has nothing of it: never a deletion).
 * - Each change is the subject's state NOW (latest revision, or deleted), never the event that touched it, so a feed read
 *   late still answers the truth. `revised` can repeat a record that did not change in substance (a redelivery).
 */
import type { LumenStore } from './lumenStore.ts';

export const FEED_SCAN_EVENTS = 20_000;
export const FEED_SCAN_DELETIONS = 2_000;
export const FEED_LIMIT = 500;
export const FEED_MAX_LIMIT = 2_000;
export const FEED_MAX_SUBJECTS = 500;
/** (FX1) At most this many hidden records of deletions are read per page (the deletion's subject list, paged). */
export const FEED_SCAN_HIDDEN = 20_000;
/** (FX1) At most this many subjects per `subjectStates` call. */
export const STATE_MAX_REFS = 100;

export type ChangeKind = 'workout' | 'hcExercise' | 'hcWeight';

export interface FeedChange {
  kind: ChangeKind;
  /** The upstream id: the Gauge session id, or the Health Connect record id. */
  id: string;
  /** What Vitals keys its imports by: `gauge:<session id>` or `hc:<record id>`. */
  ref: string;
  change: 'revised' | 'deleted';
  startMs: number | null;
  endMs: number | null;
  /** The revision (`last_modified`, else when it was received) or the deletion's time. */
  atMs: number | null;
  installationId: string;
}

export interface FeedPage {
  cursor: string;
  more: boolean;
  resync: boolean;
  changes: FeedChange[];
}

const SESSION = 'activity/session';
const HC_RECORD = 'hc/record';
const HC_DELETED = 'hc/deleted';
const HC_KINDS: Readonly<Record<string, ChangeKind>> = { ExerciseSession: 'hcExercise', Weight: 'hcWeight' };
/** The deletion targets that can hide an imported actual (a category, its group, or everything). */
const DELETION_TARGETS: Readonly<Record<string, readonly string[]>> = {
  [SESSION]: [SESSION], activity: [SESSION], [HC_RECORD]: [HC_RECORD], hc: [HC_RECORD], '*': [SESSION, HC_RECORD],
};
const LO = -8_640_000_000_000_000;
const HI = 8_640_000_000_000_000;

const CURSOR = /^c1\.(\d{1,16})\.(\d{1,16})(?:\.(\d)\.(-?\d{1,16})\.(\d{1,16}))?$/;

/**
 * A feed cursor: the events up to `seq` and the deletions up to `del` are reported; with `within` (FX1) the deletion `del`
 * itself is only partly listed: its target `t` up to the hidden record (`obs`, `rs`), the targets before `t` in full.
 */
export interface FeedCursor {
  seq: number;
  del: number;
  within?: { t: number; obs: number; rs: number };
}

export function parseCursor(v: unknown): FeedCursor | null | 'invalid' {
  if (v === undefined || v === null || v === '') return null;
  const m = typeof v === 'string' ? CURSOR.exec(v) : null;
  if (!m) return 'invalid';
  return m[3] === undefined ? { seq: Number(m[1]), del: Number(m[2]) } : { seq: Number(m[1]), del: Number(m[2]), within: { t: Number(m[3]), obs: Number(m[4]), rs: Number(m[5]) } };
}

const cursorOf = (seq: number, del: number, within?: FeedCursor['within']) => (within ? `c1.${seq}.${del}.${within.t}.${within.obs}.${within.rs}` : `c1.${seq}.${del}`);

function head(store: LumenStore): { seq: number; del: number } {
  return {
    seq: store.get<{ n: number | null }>('SELECT MAX(seq) AS n FROM event_state')?.n ?? 0,
    del: store.get<{ n: number | null }>('SELECT MAX(rowid) AS n FROM deletions')?.n ?? 0,
  };
}

/** The imported kind of a category and subject, or null when it is not an imported actual. */
function kindOf(category: string, subject: string): { kind: ChangeKind; id: string; category: string } | null {
  if (category === SESSION) return { kind: 'workout', id: subject, category };
  if (category === HC_RECORD || category === HC_DELETED) {
    const i = subject.indexOf(':');
    const k = i > 0 ? HC_KINDS[subject.slice(0, i)] : undefined;
    return k ? { kind: k, id: subject.slice(i + 1), category: HC_RECORD } : null;
  }
  return null;
}

/**
 * One page of the feed after `since` (null: none yet, answer the head). A page stops early once `limit` records were
 * touched (the cursor then stops at the last row read, `more: true`), so a busy feed is read in several pages. A deletion
 * hiding many records is listed across pages (FX1: the cursor can stop inside it), never answered with `resync`.
 */
export function changesSince(store: LumenStore, since: FeedCursor | null, limit = FEED_LIMIT): FeedPage {
  const h = head(store);
  if (!since || since.seq > h.seq || since.del > h.del) return { cursor: cursorOf(h.seq, h.del), more: false, resync: true, changes: [] };
  const touched = new Map<string, { installationId: string; category: string; subject: string; kind: ChangeKind; id: string }>();
  const touch = (installationId: string, category: string, subject: string) => {
    const k = kindOf(category, subject);
    if (!k) return;
    // a tombstone (hc/deleted) and its record (hc/record) share the subject `<type>:<id>`
    // (r070) a Health Connect record is one record whichever installation sent it
    const key = `${k.category === HC_RECORD ? '' : installationId}\u0000${k.category}\u0000${subject}`;
    if (!touched.has(key)) touched.set(key, { installationId, category: k.category, subject, kind: k.kind, id: k.id });
  };

  // events after the cursor (by primary key, bounded); a cursor inside a deletion has read every event up to `seq`
  let seqTo = since.seq;
  let full = false;
  if (!since.within) {
    const events = store.all<{ seq: number; installation_id: string; category: string; subject: string }>(
      'SELECT seq, installation_id, category, subject FROM event_state WHERE seq > ? ORDER BY seq LIMIT ?', since.seq, FEED_SCAN_EVENTS);
    seqTo = events.length === FEED_SCAN_EVENTS ? events.at(-1)!.seq : h.seq;
    for (const e of events) {
      touch(e.installation_id, e.category, e.subject);
      if (touched.size >= limit) {
        seqTo = e.seq;
        full = true;
        break;
      }
    }
  }

  // deletions after the cursor (only once the events are read up to the head): the imported records each one hid, in
  // keyset pages over (observed_ms, seq), so a reset of thousands of records is listed across feed pages
  let delTo = since.del;
  let within: FeedCursor['within'];
  if (!full && (since.within || seqTo === h.seq)) {
    const dels = store.all<{ rid: number; installation_id: string; category: string; from_ms: number | null; to_ms: number | null }>(
      `SELECT rowid AS rid, installation_id, category, from_ms, to_ms FROM deletions WHERE rowid ${since.within ? '>=' : '>'} ? ORDER BY rowid LIMIT ?`, since.del, FEED_SCAN_DELETIONS);
    let scanned = 0;
    let stopped = false;
    for (const d of dels) {
      const targets = DELETION_TARGETS[d.category] ?? [];
      const resume = since.within && d.rid === since.del ? since.within : undefined;
      for (let t = resume ? resume.t : 0; t < targets.length && !stopped; t++) {
        let after = resume && t === resume.t ? { obs: resume.obs, rs: resume.rs } : { obs: LO, rs: 0 };
        for (;;) {
          const rows = store.all<{ seq: number; obs: number; subject: string }>(
            `SELECT seq, observed_ms AS obs, subject FROM event_state INDEXED BY event_state_category
              WHERE category = ? AND observed_ms >= ? AND observed_ms <= ? AND hidden = 1 AND installation_id = ?
                AND (observed_ms > ? OR seq > ?)
              ORDER BY observed_ms, seq LIMIT ?`,
            // the range starts at the resume point (a seek, never a re-scan of the rows already listed)
            targets[t]!, Math.max(d.from_ms ?? LO, after.obs), d.to_ms ?? HI, d.installation_id, after.obs, after.rs, FEED_MAX_SUBJECTS);
          scanned += rows.length;
          let used = 0;
          for (const x of rows) {
            touch(d.installation_id, targets[t]!, x.subject);
            after = { obs: x.obs, rs: x.seq };
            used++;
            if (touched.size >= limit) break;
          }
          const targetDone = used === rows.length && rows.length < FEED_MAX_SUBJECTS;
          if (touched.size >= limit || scanned >= FEED_SCAN_HIDDEN) {
            // the page is full: stop inside this deletion (at the next target when this one is read to its end)
            if (!targetDone) within = { t, obs: after.obs, rs: after.rs };
            else if (t + 1 < targets.length) within = { t: t + 1, obs: LO, rs: 0 };
            stopped = true;
            break;
          }
          if (targetDone) break;
        }
      }
      if (stopped) {
        // inside this deletion (`within`), or right after it
        delTo = d.rid;
        break;
      }
      delTo = d.rid;
    }
    if (!stopped) delTo = dels.length === FEED_SCAN_DELETIONS ? dels.at(-1)!.rid : h.del;
  }
  const more = seqTo < h.seq || delTo < h.del || within !== undefined;
  const changes: FeedChange[] = [];
  for (const t of touched.values()) {
    const c = state(store, t);
    if (c) changes.push(c);
  }
  changes.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0) || (a.installationId < b.installationId ? -1 : 1));
  return { cursor: cursorOf(seqTo, delTo, within), more, resync: false, changes };
}

/** (FX1) One subject a client names: its kind and upstream id. */
export interface SubjectRef {
  kind: ChangeKind;
  id: string;
}

/** (FX1) The state now of a named subject: present (its latest revision), deleted upstream, or unknown to the server. */
export interface SubjectState extends SubjectRef {
  ref: string;
  state: 'present' | 'deleted' | 'unknown';
  atMs: number | null;
}

/**
 * (FX1, sR02/aR04) The state now of up to `STATE_MAX_REFS` subjects, across the person's installations: present when any
 * installation holds a visible revision, deleted when one held it and it is retracted or hidden, unknown when none ever
 * held it (a restored or reset store: the client never infers a deletion from that). Indexed lookups only
 * (`event_state_group`), a few per subject and installation.
 */
export function subjectStates(store: LumenStore, refs: readonly SubjectRef[], installations: readonly string[]): SubjectState[] {
  const out: SubjectState[] = [];
  for (const r of refs.slice(0, STATE_MAX_REFS)) {
    const category = r.kind === 'workout' ? SESSION : HC_RECORD;
    const subject = r.kind === 'workout' ? r.id : `${r.kind === 'hcExercise' ? 'ExerciseSession' : 'Weight'}:${r.id}`;
    const ref = r.kind === 'workout' ? `gauge:${r.id}` : `hc:${r.id}`;
    let deleted: FeedChange | null = null;
    let present: FeedChange | null = null;
    for (const installationId of installations) {
      const c = state(store, { installationId, category, subject, kind: r.kind, id: r.id });
      if (c?.change === 'revised') {
        present = c;
        break;
      }
      if (c?.change === 'deleted') deleted ??= c;
    }
    out.push({ kind: r.kind, id: r.id, ref, state: present ? 'present' : deleted ? 'deleted' : 'unknown', atMs: present ? present.atMs : deleted ? deleted.atMs : null });
  }
  return out;
}

const STATE_REF = /^(workout|hcExercise|hcWeight):([^,]{1,200})$/;

/** (FX1) `refs` of `gauge_changes_state`: `<kind>:<id>` items, comma-separated; null when malformed or too many. */
export function parseSubjectRefs(v: unknown): SubjectRef[] | null {
  if (typeof v !== 'string' || !v) return null;
  const items = v.split(',');
  if (items.length > STATE_MAX_REFS) return null;
  const out: SubjectRef[] = [];
  for (const x of items) {
    const m = STATE_REF.exec(x);
    if (!m) return null;
    out.push({ kind: m[1] as ChangeKind, id: m[2]! });
  }
  return out;
}

/** The subject's state now: its latest visible revision, or deleted (retracted by a tombstone or hidden by a deletion). */
function state(store: LumenStore, t: { installationId: string; category: string; subject: string; kind: ChangeKind; id: string }): FeedChange | null {
  const base = { kind: t.kind, id: t.id, ref: t.kind === 'workout' ? `gauge:${t.id}` : `hc:${t.id}`, installationId: t.installationId };
  // (r070) a Health Connect record's revisions are kept across installations (`lumenState.ts`); a session's per installation
  const hc = t.category === HC_RECORD || t.category === HC_DELETED;
  const owner = hc ? "st.scope = 'hc'" : 'st.installation_id = ?';
  const own = hc ? [] : [t.installationId];
  const latest = store.get<{ start_ms: number | null; end_ms: number | null; rev_ms: number | null; received_ms: number }>(
    `SELECT s.start_ms, s.end_ms, s.rev_ms, e.received_ms FROM event_state st
      JOIN events e ON e.rowid = st.seq LEFT JOIN event_spans s ON s.id = e.id
      WHERE ${owner} AND st.category = ? AND st.subject = ? AND st.latest = 1 ORDER BY st.seq DESC LIMIT 1`,
    ...own, t.category, t.subject);
  if (latest) return { ...base, change: 'revised', startMs: latest.start_ms, endMs: latest.end_ms, atMs: latest.rev_ms ?? latest.received_ms };
  const any = store.get<{ start_ms: number | null; end_ms: number | null; retracted: number }>(
    `SELECT s.start_ms, s.end_ms, st.retracted FROM event_state st
      JOIN events e ON e.rowid = st.seq LEFT JOIN event_spans s ON s.id = e.id
      WHERE ${owner} AND st.category = ? AND st.subject = ? ORDER BY st.retracted DESC, st.seq DESC LIMIT 1`,
    ...own, t.category, t.subject);
  if (!any) return null;
  const deletedMs = t.category === HC_RECORD
    ? store.get<{ at: number | null }>(`SELECT MAX(observed_ms) AS at FROM event_state WHERE scope = 'hc' AND category = ? AND subject = ? AND hidden = 0`,
      HC_DELETED, t.subject)?.at ?? null
    : null;
  return { ...base, change: 'deleted', startMs: any.start_ms, endMs: any.end_ms, atMs: deletedMs };
}
