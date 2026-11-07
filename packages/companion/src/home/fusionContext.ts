/**
 * The person's step-fusion context, kept on the server (r063 CORE, audit S6/A2; docs/SERVER.md "Fusion context").
 *
 * Fusion's rules (a) to (e) read the person's approved activities by step behaviour, their step corrections and their
 * D1 settings. Until 0.6.3 only `POST /v1/gauge/steps/fuse` received them, so the timeline, the activity and day
 * summaries, the Ring, the detectors and Heart Points fused the same evidence without them and could disagree with the
 * imported total. Now Vitals posts the context once (`POST /v1/gauge/fusion-context`) and every fused read of the
 * person (`gauge_steps` without its own context, `gauge_timeline`, `gauge_activity`, `gauge_daily_summary`, the same tools
 * on `/mcp`) resolves it here: one contextual fusion result for every consumer.
 *
 * - One JSON file per person (`persons/<id>/fusion-context.json`, 0600), read once and kept in memory; written (to a
 *   temporary file, then renamed) only when the content changed.
 * - A post replaces the activities and corrections that START inside its `window` and keeps the rest, so a device that
 *   re-sends only the last few days never drops older context. The preference, the gait switch and the day rollover
 *   (`rolloverH`, r063 FX2: fused reads break merged intervals at it) are replaced when given.
 * - `revision`: a hash of the whole stored content (the same content on two devices has the same revision). Each read
 *   names only the part it used (`contextKey`, in its `inputsHash` and so in its ETag).
 * - Bounded: items ending more than 400 days ago are dropped, and at most `CONTEXT_STORE_MAX` of each list are kept (the
 *   newest). It holds windows and kinds, never health values.
 */
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ActivityKind, FusionContext, StepLineage } from './stepFusion.ts';

export const CONTEXT_STORE_MAX = 5000;
export const CONTEXT_KEEP_MS = 400 * 24 * 3_600_000;

export interface StoredFusionContext {
  revision: string;
  updatedAt: string;
  activities: Array<{ startMs: number; endMs: number; kind: ActivityKind }>;
  corrections: Array<{ startMs: number; endMs: number; use: StepLineage }>;
  /** The lineage order (complete, as `stepsContextOf` normalises it); absent = the default. */
  preference?: string[];
  soleSustainedGait?: boolean;
  /** (r063 FX2 sR08/aR03) The person's day rollover (local hour): fused reads also break merged intervals there. */
  rolloverH?: number;
}

export interface FusionContextUpdate {
  windowStartMs: number;
  windowEndMs: number;
  activities?: StoredFusionContext['activities'];
  corrections?: StoredFusionContext['corrections'];
  preference?: string[];
  soleSustainedGait?: boolean;
  rolloverH?: number;
}

export interface FusionContextStore {
  get(personId: string): StoredFusionContext | null;
  put(personId: string, u: FusionContextUpdate, now: number): { revision: string; changed: boolean; context: StoredFusionContext };
}

export type FusionContextPart = Omit<FusionContext, 'zeroWindows' | 'breaks'> & { contextKey?: string };

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byWindow = <T extends { startMs: number; endMs: number }>(x: T, y: T, tie: (x: T, y: T) => number) => x.startMs - y.startMs || x.endMs - y.endMs || tie(x, y);
const sortActivities = (xs: StoredFusionContext['activities']) => [...xs].sort((x, y) => byWindow(x, y, (p, q) => cmp(p.kind, q.kind)));
const sortCorrections = (xs: StoredFusionContext['corrections']) => [...xs].sort((x, y) => byWindow(x, y, (p, q) => cmp(p.use, q.use)));

/** The key of a fusion context (what it changes in a result): the same for equal content, absent for none. */
export function contextKeyOf(ctx: Omit<FusionContext, 'zeroWindows' | 'breaks'>): string | undefined {
  const key = {
    ...(ctx.activities?.length ? { a: ctx.activities } : {}), ...(ctx.corrections?.length ? { c: ctx.corrections } : {}),
    ...(ctx.preference ? { p: ctx.preference } : {}), ...(ctx.soleSustainedGait === false ? { g: false } : {}),
    ...(typeof ctx.rolloverH === 'number' && ctx.rolloverH > 0 ? { r: ctx.rolloverH } : {}),
  };
  return Object.keys(key).length ? createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0, 32) : undefined;
}

const revisionOf = (c: Omit<StoredFusionContext, 'revision' | 'updatedAt'>) =>
  `fc:${createHash('sha256').update(JSON.stringify([c.activities, c.corrections, c.preference ?? null, c.soleSustainedGait ?? null, ...(c.rolloverH !== undefined ? [c.rolloverH] : [])])).digest('hex').slice(0, 24)}`;

/**
 * The part of the stored context a read of `[loMs, hiMs)` uses: the activities and corrections overlapping it, the
 * preference and the gait switch, with its `contextKey`. Empty (`{}`) without a stored context.
 */
export function contextFor(stored: StoredFusionContext | null, loMs: number, hiMs: number): FusionContextPart {
  if (!stored) return {};
  const overlaps = (x: { startMs: number; endMs: number }) => x.startMs < hiMs && x.endMs > loMs;
  const out: FusionContextPart = {};
  const activities = stored.activities.filter(overlaps);
  const corrections = stored.corrections.filter(overlaps);
  if (activities.length) out.activities = activities;
  if (corrections.length) out.corrections = corrections;
  if (stored.preference) out.preference = [...stored.preference];
  if (stored.soleSustainedGait === false) out.soleSustainedGait = false;
  if (typeof stored.rolloverH === 'number' && stored.rolloverH > 0) out.rolloverH = stored.rolloverH;
  const key = contextKeyOf(out);
  return key ? { ...out, contextKey: key } : out;
}

function valid(v: unknown): v is StoredFusionContext {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  const win = (x: unknown) => typeof x === 'object' && x !== null && Number.isFinite((x as { startMs: unknown }).startMs) && Number.isFinite((x as { endMs: unknown }).endMs);
  return typeof o.revision === 'string' && Array.isArray(o.activities) && o.activities.every(win) && Array.isArray(o.corrections) && o.corrections.every(win);
}

export function createFusionContextStore(fileOf: (personId: string) => string): FusionContextStore {
  const mem = new Map<string, StoredFusionContext | null>();
  const load = (personId: string): StoredFusionContext | null => {
    if (mem.has(personId)) return mem.get(personId)!;
    let v: StoredFusionContext | null = null;
    try {
      const f = fileOf(personId);
      if (existsSync(f)) {
        const parsed: unknown = JSON.parse(readFileSync(f, 'utf8'));
        v = valid(parsed) ? parsed : null;
      }
    } catch {
      v = null;
    }
    mem.set(personId, v);
    return v;
  };
  return {
    get: load,
    put(personId, u, now) {
      const cur = load(personId);
      const inWindow = (x: { startMs: number }) => x.startMs >= u.windowStartMs && x.startMs < u.windowEndMs;
      const fresh = (x: { endMs: number }) => x.endMs > now - CONTEXT_KEEP_MS;
      const keepNewest = <T extends { startMs: number }>(xs: T[]) => (xs.length > CONTEXT_STORE_MAX ? xs.slice(xs.length - CONTEXT_STORE_MAX) : xs);
      const activities = keepNewest(sortActivities([...(cur?.activities ?? []).filter((x) => !inWindow(x)), ...(u.activities ?? []).filter(inWindow)].filter(fresh)));
      const corrections = keepNewest(sortCorrections([...(cur?.corrections ?? []).filter((x) => !inWindow(x)), ...(u.corrections ?? []).filter(inWindow)].filter(fresh)));
      const preference = u.preference ?? cur?.preference;
      const soleSustainedGait = u.soleSustainedGait ?? cur?.soleSustainedGait;
      const rolloverH = u.rolloverH ?? cur?.rolloverH;
      const body = { activities, corrections, ...(preference ? { preference } : {}), ...(soleSustainedGait !== undefined ? { soleSustainedGait } : {}), ...(rolloverH !== undefined ? { rolloverH } : {}) };
      const revision = revisionOf(body);
      if (cur && cur.revision === revision) return { revision, changed: false, context: cur };
      const next: StoredFusionContext = { revision, updatedAt: new Date(now).toISOString(), ...body };
      const f = fileOf(personId);
      mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
      const tmp = `${f}.tmp-${process.pid}`;
      writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, f);
      mem.set(personId, next);
      return { revision, changed: true, context: next };
    },
  };
}
