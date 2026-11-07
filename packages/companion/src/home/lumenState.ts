/**
 * Materialised visibility and currentness of `lumen.db` (schema version 4, r063 SRV; the 2026-10-28 incident).
 *
 * Until version 3 every read computed, per row, "is this event deleted?" (a correlated scan of `deletions`, with
 * category-prefix matching) and "is it the newest version?" (a window over the whole table). With 16k point deletions
 * and 179k events one read of one day took seconds to minutes on the main thread. Version 4 keeps the answers in
 * `event_state`, one row per non-deletion event, maintained in the same transaction as every write:
 *
 * - `hidden`: a row of `deletions` covers the event. A deletion covers the events of its installation that Gauge had
 *   received before it (`last_received_ms < at_ms`): its category (exact, a group such as `metrics` for `metrics/<kind>`,
 *   or `*`), its `kind` when given (the subject or `data.metric`), and its `[from, to]` on `observed_at`.
 * - `current`: the visible event is the newest version of its `(installation, category, subject, observed_at)`, by
 *   `(received_ms, ingested_ms, rowid)` (`inst_current`: source-aware, one installation never replaces another's), and,
 *   when the record belongs to a source several installations can read (r070, `scopeOf`: one ring's readings
 *   `ring:<device_key>`, Health Connect `hc`, the phone's step counter `phone`), the newest of the installations'
 *   current versions of that `(scope, category, subject, observed_at)`: the Vitals app now carries Gauge's engine, so a
 *   second installation on the same ring and phone uploads the same records, and they stay one record whichever
 *   installation sent them. A deletion still hides only its own installation's rows.
 * - `latest`: the category's own rule. `hc/record`: the latest revision (`last_modified`, then received, ingest order)
 *   among the visible versions of `(scope 'hc', subject)`, whichever installation sent them (r070), unless a visible `hc/deleted` tombstone at or after that
 *   revision exists, in which case the revision is `retracted` instead. `activity/session`: the newest version of
 *   `(installation, session)` among every version, shown only while visible (a deleted newest version hides the
 *   session rather than bringing an older one back).
 *
 * The semantics are exactly the version-3 views' (the lumen tests define them, and `lumenState.test.ts` checks the
 * materialised sets against the version-3 SQL on a fixture with versions, deletions, prefix deletions and tombstones).
 * Writes keep it current incrementally (an insert, a redelivery, a deletion each touch only their own groups); bulk
 * changes (`gauge dedupe`, its undo, a deletion that covers thousands of rows) and the migration rebuild it in one
 * set-based pass. `lumen_meta` holds the events rowid and the deletion count it covers: on open, a file another
 * writer changed is rebuilt.
 */
import type Database from 'better-sqlite3';

export const STATE_TABLE_V4 = `
  -- one row per non-deletion event, keyed by its events rowid (events are append-only and never deleted, so the rowids
  -- have no gaps and keep their numbers; \`stateStale\` also checks the newest one still names the same id)
  CREATE TABLE IF NOT EXISTS event_state (
    seq INTEGER PRIMARY KEY,
    installation_id TEXT NOT NULL,
    -- (r070) the source several installations share, '' for none (see \`scopeOf\`)
    scope TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    subject TEXT NOT NULL,
    observed_ms INTEGER NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    -- the newest visible version within its installation's group; \`current\` is this, and the newest across the installations of a shared scope
    inst_current INTEGER NOT NULL DEFAULT 0,
    current INTEGER NOT NULL DEFAULT 0,
    latest INTEGER NOT NULL DEFAULT 0,
    retracted INTEGER NOT NULL DEFAULT 0
  );
  -- deletions: a point or short one by its start, any other (open-ended, '*', longer than an hour) by category alone
  CREATE INDEX IF NOT EXISTS deletions_from ON deletions (installation_id, category, from_ms);
  CREATE INDEX IF NOT EXISTS deletions_wide ON deletions (installation_id, category) WHERE from_ms IS NULL OR to_ms IS NULL OR to_ms - from_ms > 3600000;
  -- the newest upload (status' lastEventAt) without a scan of events
  CREATE INDEX IF NOT EXISTS events_ingested ON events (ingested_ms);
`;
/** `event_state`'s secondary indexes: dropped while a rebuild loads the table and built once after it. */
const STATE_INDEXES = `
  -- a version group, an HC record's revisions, a session's versions
  CREATE INDEX IF NOT EXISTS event_state_group ON event_state (installation_id, category, subject, observed_ms);
  -- (r070) a shared source's version group across installations
  CREATE INDEX IF NOT EXISTS event_state_scope ON event_state (scope, category, subject, observed_ms) WHERE scope <> '';
  -- every row by category and time (deletions, availability: covering)
  CREATE INDEX IF NOT EXISTS event_state_category ON event_state (category, observed_ms, hidden);
  -- the current rows: by category, by kind (metric_series), by time alone (a day's metrics of every kind)
  CREATE INDEX IF NOT EXISTS event_state_current_category ON event_state (category, observed_ms) WHERE current = 1;
  CREATE INDEX IF NOT EXISTS event_state_current_subject ON event_state (subject, observed_ms) WHERE current = 1;
  CREATE INDEX IF NOT EXISTS event_state_current_observed ON event_state (observed_ms) WHERE current = 1;
  -- the few Health Connect records a tombstone retracted (gauge_hc's deleted list)
  CREATE INDEX IF NOT EXISTS event_state_retracted ON event_state (category, subject) WHERE retracted = 1;
`;
const STATE_INDEX_NAMES = ['event_state_group', 'event_state_scope', 'event_state_category', 'event_state_current_category', 'event_state_current_subject', 'event_state_current_observed', 'event_state_retracted'];

/** A deletion at most this long is found by its start (`deletions_from`); a longer one through `deletions_wide`. */
const NARROW_MS = 3_600_000;
/** `deletions_wide`'s predicate, verbatim (a partial index serves a query only when the query repeats it). */
const WIDE = 'from_ms IS NULL OR to_ms IS NULL OR to_ms - from_ms > 3600000';
/** A deletion that covers more rows than this rebuilds the state in one pass instead of row by row. */
export const BULK_ROWS = 2000;
const LO = -8_640_000_000_000_000;
const HI = 8_640_000_000_000_000;

export const HC_RECORD = 'hc/record';
export const HC_DELETED = 'hc/deleted';
export const SESSION = 'activity/session';

/** The ring's categories: a record carrying a `device_key` is the ring's, whichever installation read it from the ring. */
const isRingCategory = (c: string) => c.startsWith('metrics/') || c.startsWith('vendor/') || c === 'activity/buckets' || c === 'activity/daily' || c === 'sleep/timeline';

/**
 * (r070) The source several installations can read, which a record's `current` version is also kept per across them:
 * `ring:<device_key>` for the ring's readings (one ring = one source), `hc` for Health Connect records and tombstones
 * (a record id is the store's, not the installation's), `phone` for the phone's step-counter records (a boot and a counter
 * timestamp name the record), else `''`: nothing is shared (a ring row without a `device_key` stays its installation's).
 * Must match `SCOPE_SQL`.
 */
export function scopeOf(category: string, deviceKey: unknown): string {
  if (category === HC_RECORD || category === HC_DELETED) return 'hc';
  if (category === 'activity/phone_steps') return 'phone';
  if (isRingCategory(category) && typeof deviceKey === 'string' && deviceKey !== '') return `ring:${deviceKey}`;
  return '';
}

/** `scopeOf` over an `events` row aliased `a`. */
export const SCOPE_SQL = (a: string) => `CASE
    WHEN ${a}.category IN ('${HC_RECORD}', '${HC_DELETED}') THEN 'hc'
    WHEN ${a}.category = 'activity/phone_steps' THEN 'phone'
    WHEN (${a}.category >= 'metrics/' AND ${a}.category < 'metrics0' OR ${a}.category >= 'vendor/' AND ${a}.category < 'vendor0' OR ${a}.category IN ('activity/buckets', 'activity/daily', 'sleep/timeline'))
      AND COALESCE(json_extract(${a}.data, '$.device_key'), '') <> '' THEN 'ring:' || json_extract(${a}.data, '$.device_key')
    ELSE '' END`;

/** The groups a category belongs to (`metrics` for `metrics/hr`), each a deletion target besides the category and `*`. */
export function categoryGroups(category: string): string[] {
  const out: string[] = [];
  for (let i = category.indexOf('/'); i > 0; i = category.indexOf('/', i + 1)) out.push(category.slice(0, i));
  return out;
}

/**
 * Every event a deletion covers, as of now (hidden or not), driven from `deletions` through the events indexes.
 * `CROSS JOIN` keeps `deletions` the outer loop and `INDEXED BY` the category range: left to itself the planner scans `events`
 * (or an automatic installation index) and probes `deletions` per row,
 * the very cost this replaces.
 */
const COVERED = `
  SELECT e.rowid FROM deletions d CROSS JOIN events e INDEXED BY events_category_observed
    ON e.category = d.category AND e.observed_ms BETWEEN COALESCE(d.from_ms, ${LO}) AND COALESCE(d.to_ms, ${HI})
  WHERE e.installation_id = d.installation_id AND e.last_received_ms < d.at_ms
    AND (d.kind IS NULL OR d.kind = e.subject OR d.kind = json_extract(e.data, '$.metric'))
  UNION ALL
  SELECT e.rowid FROM deletions d CROSS JOIN events e INDEXED BY events_category_observed ON e.category >= d.category || '/' AND e.category < d.category || '0'
  WHERE d.category <> '*' AND e.installation_id = d.installation_id AND e.last_received_ms < d.at_ms
    AND (d.kind IS NULL OR d.kind = e.subject OR d.kind = json_extract(e.data, '$.metric'))
    AND (d.from_ms IS NULL OR e.observed_ms >= d.from_ms) AND (d.to_ms IS NULL OR e.observed_ms <= d.to_ms)
  UNION ALL
  SELECT e.rowid FROM deletions d CROSS JOIN events e ON e.installation_id = d.installation_id
  WHERE d.category = '*' AND e.category <> 'deletion' AND e.last_received_ms < d.at_ms
    AND (d.kind IS NULL OR d.kind = e.subject OR d.kind = json_extract(e.data, '$.metric'))
    AND (d.from_ms IS NULL OR e.observed_ms >= d.from_ms) AND (d.to_ms IS NULL OR e.observed_ms <= d.to_ms)
`;

const META_ROWID = 'state_rowid';
const META_LAST_ID = 'state_last_id';
const META_DELETIONS = 'state_deletions';

const newest = (db: Database.Database) => db.prepare('SELECT rowid AS r, id FROM events ORDER BY rowid DESC LIMIT 1').get() as { r: number; id: string } | undefined;

function writeMarks(db: Database.Database): void {
  const last = newest(db);
  const dels = (db.prepare('SELECT COUNT(*) AS n FROM deletions').get() as { n: number }).n;
  const put = db.prepare('INSERT INTO lumen_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
  put.run(META_ROWID, last?.r ?? 0);
  put.run(META_LAST_ID, last?.id ?? '');
  put.run(META_DELETIONS, dels);
}

/**
 * Recomputes every row of `event_state` from `events`, `deletions` and `event_spans` in one set-based pass. Run inside
 * a transaction (the migration's, or the caller's). Deterministic and idempotent.
 */
export function rebuildState(db: Database.Database): void {
  db.exec(STATE_TABLE_V4);
  for (const i of STATE_INDEX_NAMES) db.exec(`DROP INDEX IF EXISTS ${i}`);
  db.exec(`
    DELETE FROM event_state;
    DROP TABLE IF EXISTS temp.state_covered;
    CREATE TEMP TABLE state_covered (seq INTEGER PRIMARY KEY);
    INSERT OR IGNORE INTO temp.state_covered (seq) ${COVERED};
    -- hidden, and current (rank 1 among the visible versions of the group: the visibility is part of the partition)
    INSERT INTO event_state (seq, installation_id, scope, category, subject, observed_ms, hidden, inst_current)
      SELECT x.rowid, x.installation_id, x.scope, x.category, x.subject, x.observed_ms, x.covered,
        x.covered = 0 AND ROW_NUMBER() OVER (
          PARTITION BY x.installation_id, x.category, x.subject, x.observed_ms, x.covered = 0 ORDER BY x.received_ms DESC, x.ingested_ms DESC, x.rowid DESC
        ) = 1
      FROM (
        SELECT e.rowid AS rowid, e.installation_id, ${SCOPE_SQL('e')} AS scope, e.category, e.subject, e.observed_ms, e.received_ms, e.ingested_ms, h.seq IS NOT NULL AS covered
        FROM events e LEFT JOIN temp.state_covered h ON h.seq = e.rowid WHERE e.category <> 'deletion'
      ) x
      ORDER BY x.rowid;
    DROP TABLE temp.state_covered;
    ${STATE_INDEXES}
    -- (r070) current: the installation's newest version, and for a shared source the newest across the installations'
    UPDATE event_state SET current = inst_current;
    UPDATE event_state SET current = 0 WHERE inst_current = 1 AND scope <> '' AND seq NOT IN (
      SELECT seq FROM (
        SELECT st.seq, ROW_NUMBER() OVER (PARTITION BY st.scope, st.category, st.subject, st.observed_ms ORDER BY e.received_ms DESC, e.ingested_ms DESC, e.rowid DESC) AS r
        FROM event_state st JOIN events e ON e.rowid = st.seq WHERE st.inst_current = 1 AND st.scope <> ''
      ) WHERE r = 1
    );
    UPDATE event_state SET latest = 1 - w.gone, retracted = w.gone FROM (
      SELECT h.seq, EXISTS (
        SELECT 1 FROM event_state t WHERE t.scope = 'hc' AND t.category = '${HC_DELETED}' AND t.subject = h.subject AND t.hidden = 0
          AND t.observed_ms >= COALESCE(h.rev_ms, 0)
      ) AS gone FROM (
        SELECT e.rowid AS seq, e.subject, s.rev_ms,
          ROW_NUMBER() OVER (PARTITION BY e.subject ORDER BY COALESCE(s.rev_ms, 0) DESC, e.received_ms DESC, e.ingested_ms DESC, e.rowid DESC) AS r
        FROM events e INDEXED BY events_category_observed JOIN event_state st ON st.seq = e.rowid JOIN event_spans s ON s.id = e.id
        WHERE e.category = '${HC_RECORD}' AND st.hidden = 0
      ) h WHERE h.r = 1
    ) AS w WHERE w.seq = event_state.seq;
    UPDATE event_state SET latest = 1 FROM (
      SELECT seq FROM (
        SELECT e.rowid AS seq, ROW_NUMBER() OVER (PARTITION BY e.installation_id, e.subject ORDER BY e.received_ms DESC, e.ingested_ms DESC, e.rowid DESC) AS r
        FROM events e WHERE e.category = '${SESSION}'
      ) WHERE r = 1
    ) AS w WHERE w.seq = event_state.seq AND event_state.hidden = 0;
  `);
  writeMarks(db);
}

/** True when another writer changed `events` or `deletions` since the state was last brought up to date. */
export function stateStale(db: Database.Database): boolean {
  const get = db.prepare('SELECT value FROM lumen_meta WHERE key = ?');
  const rowid = (get.get(META_ROWID) as { value: number } | undefined)?.value;
  const lastId = (get.get(META_LAST_ID) as { value: string } | undefined)?.value;
  const dels = (get.get(META_DELETIONS) as { value: number } | undefined)?.value;
  const last = newest(db);
  const nowDels = (db.prepare('SELECT COUNT(*) AS n FROM deletions').get() as { n: number }).n;
  return rowid !== (last?.r ?? 0) || lastId !== (last?.id ?? '') || dels !== nowDels;
}

interface Key { seq: number; installation_id: string; category: string; subject: string; observed_ms: number }
export interface DeletionRow { installation_id: string; category: string; kind: string | null; from_ms: number | null; to_ms: number | null; at_ms: number }

/** The incremental maintenance one store uses inside its write transactions. */
export function stateWriter(db: Database.Database) {
  const q = {
    insert: db.prepare('INSERT OR IGNORE INTO event_state (seq, installation_id, scope, category, subject, observed_ms, hidden) VALUES (@seq, @installation_id, @scope, @category, @subject, @observed_ms, @hidden)'),
    row: db.prepare<[string], Key & { hidden: number; last_received_ms: number; data: string }>(`SELECT st.seq, st.installation_id, st.category, st.subject, st.observed_ms, st.hidden, e.last_received_ms, e.data
      FROM events e JOIN event_state st ON st.seq = e.rowid WHERE e.id = ?`),
    setHidden: db.prepare('UPDATE event_state SET hidden = ? WHERE seq = ? AND hidden <> ?'),
    // is the event covered? a point/short deletion found by its start, any other by category (both partial on the shape)
    coveredNarrow: db.prepare(`SELECT 1 FROM deletions WHERE installation_id = @i AND category IN (@c, @g1, @g2, '*')
      AND from_ms BETWEEN @o - ${NARROW_MS} AND @o AND to_ms >= @o AND to_ms - from_ms <= ${NARROW_MS}
      AND at_ms > @lr AND (kind IS NULL OR kind = @s OR kind = json_extract(@data, '$.metric')) LIMIT 1`),
    coveredWide: db.prepare(`SELECT 1 FROM deletions WHERE installation_id = @i AND category IN (@c, @g1, @g2, '*') AND (${WIDE})
      AND (from_ms IS NULL OR from_ms <= @o) AND (to_ms IS NULL OR to_ms >= @o)
      AND at_ms > @lr AND (kind IS NULL OR kind = @s OR kind = json_extract(@data, '$.metric')) LIMIT 1`),
    // the visible events a new deletion covers
    coversExact: db.prepare<Record<string, unknown>, Key>(`SELECT st.seq, st.installation_id, st.category, st.subject, st.observed_ms FROM event_state st JOIN events e ON e.rowid = st.seq
      WHERE st.category = @c AND st.observed_ms BETWEEN @lo AND @hi AND st.hidden = 0 AND st.installation_id = @i AND e.last_received_ms < @at
        AND (@kind IS NULL OR st.subject = @kind OR json_extract(e.data, '$.metric') = @kind)`),
    coversGroup: db.prepare<Record<string, unknown>, Key>(`SELECT st.seq, st.installation_id, st.category, st.subject, st.observed_ms FROM event_state st JOIN events e ON e.rowid = st.seq
      WHERE st.category >= @c || '/' AND st.category < @c || '0' AND st.observed_ms BETWEEN @lo AND @hi AND st.hidden = 0 AND st.installation_id = @i AND e.last_received_ms < @at
        AND (@kind IS NULL OR st.subject = @kind OR json_extract(e.data, '$.metric') = @kind)`),
    coversAll: db.prepare<Record<string, unknown>, Key>(`SELECT st.seq, st.installation_id, st.category, st.subject, st.observed_ms FROM event_state st JOIN events e ON e.rowid = st.seq
      WHERE st.installation_id = @i AND st.observed_ms BETWEEN @lo AND @hi AND st.hidden = 0 AND e.last_received_ms < @at
        AND (@kind IS NULL OR st.subject = @kind OR json_extract(e.data, '$.metric') = @kind)`),
    // currentness of one version group
    winner: db.prepare<Record<string, unknown>, { seq: number }>(`SELECT st.seq FROM event_state st JOIN events e ON e.rowid = st.seq
      WHERE st.installation_id = @i AND st.category = @c AND st.subject = @s AND st.observed_ms = @o AND st.hidden = 0
      ORDER BY e.received_ms DESC, e.ingested_ms DESC, e.rowid DESC LIMIT 1`),
    setInstCurrent: db.prepare(`UPDATE event_state SET inst_current = (seq IS @w)
      WHERE installation_id = @i AND category = @c AND subject = @s AND observed_ms = @o AND inst_current <> (seq IS @w)`),
    // a row that shares no source is current when it is its installation's newest; the rest are decided per shared source
    setCurrentPlain: db.prepare(`UPDATE event_state SET current = inst_current
      WHERE installation_id = @i AND category = @c AND subject = @s AND observed_ms = @o AND scope = '' AND current <> inst_current`),
    scopesOf: db.prepare<Record<string, unknown>, { scope: string }>(`SELECT DISTINCT scope FROM event_state
      WHERE installation_id = @i AND category = @c AND subject = @s AND observed_ms = @o AND scope <> ''`),
    sharedWinner: db.prepare<Record<string, unknown>, { seq: number }>(`SELECT st.seq FROM event_state st JOIN events e ON e.rowid = st.seq
      WHERE st.scope = @sc AND st.category = @c AND st.subject = @s AND st.observed_ms = @o AND st.inst_current = 1
      ORDER BY e.received_ms DESC, e.ingested_ms DESC, e.rowid DESC LIMIT 1`),
    setShared: db.prepare(`UPDATE event_state SET current = (inst_current = 1 AND seq IS @w)
      WHERE scope = @sc AND category = @c AND subject = @s AND observed_ms = @o AND current <> (inst_current = 1 AND seq IS @w)`),
    hcWinner: db.prepare<Record<string, unknown>, { seq: number; rev_ms: number | null }>(`SELECT st.seq, s.rev_ms FROM event_state st JOIN events e ON e.rowid = st.seq JOIN event_spans s ON s.id = e.id
      WHERE st.scope = 'hc' AND st.category = '${HC_RECORD}' AND st.subject = @s AND st.hidden = 0
      ORDER BY COALESCE(s.rev_ms, 0) DESC, e.received_ms DESC, e.ingested_ms DESC, e.rowid DESC LIMIT 1`),
    hcGone: db.prepare<Record<string, unknown>, { x: number }>(`SELECT 1 AS x FROM event_state
      WHERE scope = 'hc' AND category = '${HC_DELETED}' AND subject = @s AND hidden = 0 AND observed_ms >= @rev LIMIT 1`),
    setHc: db.prepare(`UPDATE event_state SET latest = (seq IS @w AND NOT @gone), retracted = (seq IS @w AND @gone)
      WHERE scope = 'hc' AND category = '${HC_RECORD}' AND subject = @s AND (latest <> (seq IS @w AND NOT @gone) OR retracted <> (seq IS @w AND @gone))`),
    sessionWinner: db.prepare<Record<string, unknown>, { seq: number; hidden: number }>(`SELECT st.seq, st.hidden FROM event_state st JOIN events e ON e.rowid = st.seq
      WHERE st.installation_id = @i AND st.category = '${SESSION}' AND st.subject = @s
      ORDER BY e.received_ms DESC, e.ingested_ms DESC, e.rowid DESC LIMIT 1`),
    setSession: db.prepare(`UPDATE event_state SET latest = (seq IS @w AND @visible)
      WHERE installation_id = @i AND category = '${SESSION}' AND subject = @s AND latest <> (seq IS @w AND @visible)`),
  };

  const covered = (k: Key, lastReceivedMs: number, data: string): boolean => {
    const g = categoryGroups(k.category);
    const p = { i: k.installation_id, c: k.category, g1: g[0] ?? null, g2: g[1] ?? null, o: k.observed_ms, s: k.subject, lr: lastReceivedMs, data };
    if (g.length > 2) throw new Error(`category nested too deep: ${k.category}`);
    return q.coveredNarrow.get(p) !== undefined || q.coveredWide.get(p) !== undefined;
  };

  /** Brings the groups of these rows up to date (each group once). */
  const touch = (rows: Iterable<Key>): void => {
    const seen = new Set<string>();
    for (const k of rows) {
      const gk = JSON.stringify([k.installation_id, k.category, k.subject, k.observed_ms]);
      if (!seen.has(gk)) {
        seen.add(gk);
        const p = { i: k.installation_id, c: k.category, s: k.subject, o: k.observed_ms };
        q.setInstCurrent.run({ ...p, w: q.winner.get(p)?.seq ?? null });
        q.setCurrentPlain.run(p);
        // (r070) every shared source this group's rows belong to: its newest installation-current version across installations
        for (const { scope } of q.scopesOf.all(p)) {
          const sk = JSON.stringify(['scope', scope, k.category, k.subject, k.observed_ms]);
          if (seen.has(sk)) continue;
          seen.add(sk);
          const sp = { sc: scope, c: k.category, s: k.subject, o: k.observed_ms };
          q.setShared.run({ ...sp, w: q.sharedWinner.get(sp)?.seq ?? null });
        }
      }
      if (k.category === HC_RECORD || k.category === HC_DELETED) {
        const hk = JSON.stringify(['hc', k.subject]);
        if (seen.has(hk)) continue;
        seen.add(hk);
        const p = { s: k.subject };
        const w = q.hcWinner.get(p);
        const gone = w ? (q.hcGone.get({ ...p, rev: w.rev_ms ?? 0 }) ? 1 : 0) : 0;
        q.setHc.run({ ...p, w: w?.seq ?? null, gone });
      } else if (k.category === SESSION) {
        const sk = JSON.stringify(['session', k.installation_id, k.subject]);
        if (seen.has(sk)) continue;
        seen.add(sk);
        const p = { i: k.installation_id, s: k.subject };
        const w = q.sessionWinner.get(p);
        q.setSession.run({ ...p, w: w?.seq ?? null, visible: w && w.hidden === 0 ? 1 : 0 });
      }
    }
  };

  return {
    /** A newly stored event, `seq` its events rowid (call after its `event_spans` row: an HC revision ranks by `last_modified`). */
    added(k: Key, receivedMs: number, data: string, deviceKey?: unknown): void {
      if (k.category === 'deletion') return;
      const hidden = covered(k, receivedMs, data) ? 1 : 0;
      q.insert.run({ ...k, scope: scopeOf(k.category, deviceKey), hidden });
      touch([k]);
    },
    /** An event delivered again with a newer `received_at` (`last_received_ms` moved): a deletion may no longer cover it. */
    redelivered(id: string): void {
      const k = q.row.get(id);
      if (!k || k.hidden === 0) return;
      if (covered(k, k.last_received_ms, k.data)) return;
      q.setHidden.run(0, k.seq, 0);
      touch([k]);
    },
    /** A new row of `deletions`: hides the visible events it covers; past `BULK_ROWS` the state is rebuilt instead. */
    deletionAdded(d: DeletionRow): void {
      const p = { i: d.installation_id, c: d.category, kind: d.kind, lo: d.from_ms ?? LO, hi: d.to_ms ?? HI, at: d.at_ms };
      const rows = d.category === '*' ? q.coversAll.all(p) : [...q.coversExact.all(p), ...q.coversGroup.all(p)];
      if (rows.length > BULK_ROWS) {
        rebuildState(db);
        return;
      }
      for (const r of rows) q.setHidden.run(1, r.seq, 1);
      touch(rows);
    },
    /** After a batch: the state covers every event and deletion now stored. */
    mark(): void {
      writeMarks(db);
    },
    rebuild(): void {
      rebuildState(db);
    },
  };
}
