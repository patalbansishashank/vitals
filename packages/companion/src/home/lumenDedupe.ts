/**
 * Which stored Gauge events are copies left by Gauge 2.7.3's ring-clock correction (`vitals-server gauge dedupe`,
 * docs/SERVER.md "Gauge"). Pure: rows in, removals out; the store turns them into soft deletions.
 *
 * 2.7.3 learned the ring's clock ran fast (383.118 s on the first ring) and shifted re-pulled history back by that
 * offset: each re-pulled record was stored again, next to the copy older versions had uploaded at the ring's raw stamp,
 * under a new id. It also shifted each later connection's records by that connection's sub-second read-back noise, a
 * new id every time. Gauge 2.7.4 (`ClockDuplicates.kt`) uploads exact deletions for its own measurements, but it keeps
 * no sleep packets, so the server finds these itself, with the same rule:
 *
 * - **Identity**: the payload (`data`) without its `observed_at` / `received_at`, within one installation, category
 *   and subject. Only identical payloads are ever copies.
 * - **Clock twin**: two copies `offset` apart (under a second either way). The one received later is the corrected
 *   copy 2.7.4 treats as canonical (`raw − offset`, what every later re-pull produces) and stays; the raw one goes.
 * - **Near copy**: copies under 1 s apart (two ring stamps are whole seconds apart). A copy on the canonical grid
 *   (whole seconds, or whole seconds minus the offset's fraction) stays; otherwise the one received last.
 * - The offset is not uploaded: it is the most common gap between identical sleep packets (`inferClockOffset`).
 */

export interface DedupeRow {
  id: string;
  installation_id: string;
  category: string;
  subject: string;
  observed_ms: number;
  received_ms: number;
  data: string;
}

export type DedupeReason = 'clock_twin' | 'near_copy';

export interface Removal {
  row: DedupeRow;
  reason: DedupeReason;
  keptId: string;
}

/** Under a second: closer than two whole-second ring stamps can be (Gauge's `SAME_RECORD_MS`). */
export const SAME_RECORD_MS = 999;
/** Clock twins needed before a gap counts as the ring's offset. */
export const MIN_TWINS = 3;
const MAX_OFFSET_MS = 24 * 3_600_000;

/** The payload without its times: what two copies of one record share. */
export function payloadKey(data: string): string | null {
  try {
    const d = JSON.parse(data) as unknown;
    if (typeof d !== 'object' || d === null || Array.isArray(d)) return null;
    const { observed_at: _o, received_at: _r, ...rest } = d as Record<string, unknown>;
    return JSON.stringify(rest);
  } catch {
    return null;
  }
}

/** Rows grouped by installation, category, subject and payload, each group sorted by `observed_ms`. */
function groups(rows: readonly DedupeRow[]): DedupeRow[][] {
  const by = new Map<string, DedupeRow[]>();
  for (const r of rows) {
    const p = payloadKey(r.data);
    if (p === null) continue;
    const k = `${r.installation_id}\u0000${r.category}\u0000${r.subject}\u0000${p}`;
    const g = by.get(k);
    if (g) g.push(r);
    else by.set(k, [r]);
  }
  return [...by.values()].filter((g) => g.length > 1).map((g) => g.sort((a, b) => a.observed_ms - b.observed_ms || a.received_ms - b.received_ms));
}

/**
 * The ring's clock offset (`raw − corrected`, ms): the most common gap from an earlier-received copy to a later-received
 * identical one, of at least a second and not whole seconds (where the raw and corrected grids would coincide), seen at
 * least [MIN_TWINS] times. Null when there is none. Feed it the sleep packets: they are long and unique.
 */
export function inferClockOffset(rows: readonly DedupeRow[]): { offsetMs: number; twins: number } | null {
  const tally = new Map<number, number>();
  for (const g of groups(rows)) {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length && g[j]!.observed_ms - g[i]!.observed_ms <= MAX_OFFSET_MS; j++) {
        const [a, b] = [g[i]!, g[j]!];
        if (a.received_ms === b.received_ms) continue;
        const [raw, corrected] = a.received_ms < b.received_ms ? [a, b] : [b, a];
        const d = raw.observed_ms - corrected.observed_ms;
        if (Math.abs(d) < 1000 || d % 1000 === 0) continue;
        tally.set(d, (tally.get(d) ?? 0) + 1);
      }
    }
  }
  let best: { offsetMs: number; twins: number } | null = null;
  for (const [d, n] of tally) if (n >= MIN_TWINS && (!best || n > best.twins)) best = { offsetMs: d, twins: n };
  return best;
}

const frac = (ms: number) => ((ms % 1000) + 1000) % 1000;
/** The first index of `g` (sorted by `observed_ms`) at or after `ms`. */
function lowerBound(g: readonly DedupeRow[], ms: number): number {
  let [lo, hi] = [0, g.length];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (g[mid]!.observed_ms < ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The copies to remove among `rows` (current versions only), with the copy each one duplicates. */
export function findDuplicates(rows: readonly DedupeRow[], offsetMs: number | null): Removal[] {
  const out: Removal[] = [];
  const fractions = new Set([0]);
  if (offsetMs !== null && offsetMs % 1000 !== 0) fractions.add(frac(-offsetMs));
  for (const g of groups(rows)) {
    const removed = new Set<DedupeRow>();
    // clock twins: the raw copy goes when its corrected copy (received later) is stored `offset` earlier
    if (offsetMs !== null && offsetMs !== 0) {
      for (const raw of g) {
        const target = raw.observed_ms - offsetMs;
        let best: DedupeRow | null = null;
        for (let k = lowerBound(g, target - SAME_RECORD_MS); k < g.length && g[k]!.observed_ms <= target + SAME_RECORD_MS; k++) {
          const c = g[k]!;
          const off = Math.abs(c.observed_ms - target);
          if (c === raw || removed.has(c) || off > SAME_RECORD_MS || c.received_ms <= raw.received_ms) continue;
          if (!best || off < Math.abs(best.observed_ms - target)) best = c;
        }
        if (best) {
          removed.add(raw);
          out.push({ row: raw, reason: 'clock_twin', keptId: best.id });
        }
      }
    }
    // near copies: under a second apart; the one on the canonical grid stays, else the one received last
    const left = g.filter((r) => !removed.has(r));
    let lo = 0;
    for (const [i, row] of left.entries()) {
      while (left[lo]!.observed_ms < row.observed_ms - SAME_RECORD_MS) lo++;
      if (fractions.has(frac(row.observed_ms))) continue;
      const siblings: DedupeRow[] = [];
      for (let j = lo; j < left.length && left[j]!.observed_ms <= row.observed_ms + SAME_RECORD_MS; j++) if (j !== i && !removed.has(left[j]!)) siblings.push(left[j]!);
      if (!siblings.length) continue;
      const keep =
        siblings.find((o) => fractions.has(frac(o.observed_ms))) ??
        [...siblings, row].reduce((a, b) => (b.received_ms > a.received_ms || (b.received_ms === a.received_ms && b.observed_ms > a.observed_ms) ? b : a));
      if (keep === row) continue;
      removed.add(row);
      out.push({ row, reason: 'near_copy', keptId: keep.id });
    }
  }
  return out.sort((a, b) => a.row.observed_ms - b.row.observed_ms);
}
