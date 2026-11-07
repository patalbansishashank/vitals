/**
 * (0.6.3 S25/A14) The Ring's read of the canonical activity collection: the effective session entries and the activity
 * candidates from the document store (re-read when either changes), handed to `ringActivities`. Tests install their own
 * source with `setRingActivitySource`.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { bodyOf, withDocId } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { timeZone } from '@/commands/bus';
import type { LogEntry } from '@/living';
import type { CandidateRecord } from '@/living/activityCandidates';
import { projectEntries } from '@/living/logs';
import { ringActivities, type RingActivity, type SessionEntry } from './activities';
import { ringDemo } from './api';

export interface RingActivitySource {
  sessions(): readonly SessionEntry[];
  candidates(): readonly CandidateRecord[];
  tz(): string;
  subscribe(fn: () => void): () => void;
  /** Moves whenever the data changes (so a change before anyone subscribed is still seen). */
  version?(): number;
}

function storeSource(): RingActivitySource {
  let stamp = 0;
  let memo: { stamp: number; sessions: SessionEntry[]; candidates: CandidateRecord[] } | null = null;
  const read = () => {
    if (memo && memo.stamp === stamp) return memo;
    let sessions: SessionEntry[] = [];
    let candidates: CandidateRecord[] = [];
    try {
      const store = getDocumentStore();
      // (r063 FX3 aR01) log bodies are stored without `id`: restore it from the document, as `readDocs()` does, or every
      // log shares an undefined id and the projection collapses them into one
      const entries = store.peekAll<LogEntry>('dailyLogs').filter((d) => !(d as { _deleted?: boolean })._deleted).map((d) => withDocId<LogEntry>(d));
      sessions = projectEntries(entries).filter((e): e is SessionEntry => e.kind === 'session') as SessionEntry[];
      candidates = store.peekAll<CandidateRecord>('activityCandidates').map((d) => bodyOf<CandidateRecord>(d));
    } catch {
      // no document store here: nothing recorded
    }
    memo = { stamp, sessions, candidates };
    return memo;
  };
  const listeners = new Set<() => void>();
  let offs: Array<() => void> | null = null;
  const bump = () => {
    stamp++;
    for (const l of listeners) l();
  };
  return {
    sessions: () => read().sessions,
    candidates: () => read().candidates,
    tz: () => timeZone(),
    version: () => stamp,
    subscribe(fn) {
      listeners.add(fn);
      if (!offs) {
        try {
          const store = getDocumentStore();
          offs = [store.watch('dailyLogs', {}, bump), store.watch('activityCandidates', {}, bump)];
        } catch {
          offs = [];
        }
      }
      return () => {
        listeners.delete(fn);
        if (listeners.size === 0 && offs) {
          offs.forEach((off) => off());
          offs = null;
        }
      };
    },
  };
}

/**
 * The development demo (`__VITALS_GAUGE_DEMO__`, the screenshot harness): the demo client's Gauge workouts of the last
 * 30 days as canonical activities — each approved (an entry linked to its Gauge session), the newest left to review, one
 * rejected (never shown). Production builds never take this branch.
 */
function demoSource(): RingActivitySource {
  let sessions: SessionEntry[] = [];
  let candidates: CandidateRecord[] = [];
  const listeners = new Set<() => void>();
  let loaded = 0;
  const tz = timeZone();
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const from = iso(new Date(today.getTime() - 29 * 86_400_000));
  void import('./fixtures')
    .then((m) => m.demoGaugeApi().workouts(from, iso(today)))
    .then((w) => {
      const list = [...(w?.sessions ?? [])].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
      list.forEach((x, k) => {
        const status = k === list.length - 1 ? 'pending' : k === 0 ? 'rejected' : 'approved';
        const key = `demo-${x.id}`;
        const start = Date.parse(x.start);
        const end = Date.parse(x.end);
        const exerciseId = x.type === 'run' ? 'jog_outdoor' : x.type === 'cycle' ? 'cycle_outdoor' : 'walk';
        candidates.push({
          key, date: x.date, tz, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), window: { start, end }, refs: [`gauge:${x.id}`], sources: [], sourceRevision: 's', estimateRevision: null, revision: 'r',
          suggested: { exerciseId, confidence: 'high', needsReview: false, why: [] }, measures: { durationMin: x.durationS / 60, steps: x.steps, medianCadence: null, hrSupportedS: null, meanHr: x.avgHr },
          estimate: x.kcal !== null ? { booked: { grossKcal: x.kcal } } : null, corroboratedBy: [], mergeSuggestions: [], planMatch: null, status, decidedRevision: null,
          entryId: status === 'approved' ? `e-${key}` : null, decidedAt: null, decidedBy: null, decision: null, decidedEstimate: null, history: [], firstSeenAt: x.start, updatedAt: x.start, resolvedAt: null,
        } as unknown as CandidateRecord);
        if (status !== 'approved') return;
        const h = /T(\d{2}):(\d{2})/.exec(x.start);
        sessions.push({
          id: `e-${key}`, date: x.date, kind: 'session', status: 'done', startH: h ? Number(h[1]) + Number(h[2]) / 60 : 12, durationMin: x.durationS / 60,
          performed: [{ exerciseId }], stimulus: {}, catalogueVersion: 'demo', physicalBoutId: key,
          candidate: { key, decidedRevision: 'r', sourceRevision: 's', estimateRevision: null, estimatorVersion: 'demo' },
          ...(x.kcal !== null ? { cost: { grossKcal: x.kcal, ownRestKcal: x.kcal * 0.2, netAboveRestKcal: x.kcal * 0.8, displacedLifestyleKcal: null, incrementalKcal: null, method: 'hr', source: 'inferred' } } : {}),
        } as unknown as SessionEntry);
      });
      sessions = [...sessions];
      candidates = [...candidates];
      loaded++;
      for (const l of listeners) l();
    })
    .catch(() => undefined);
  return {
    sessions: () => sessions,
    candidates: () => candidates,
    tz: () => tz,
    version: () => loaded,
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}

let source: RingActivitySource | null = null;
let rev = 0;
const revListeners = new Set<() => void>();
const appSource = (): RingActivitySource => (source ??= ringDemo() ? demoSource() : storeSource());

/** Tests and the screenshot harness: read activities from here (null restores the store). */
export function setRingActivitySource(s: RingActivitySource | null): void {
  source = s;
  rev++;
  for (const l of revListeners) l();
}

let tick = 0;
const subscribe = (fn: () => void) => {
  revListeners.add(fn);
  const off = appSource().subscribe(() => {
    tick++;
    fn();
  });
  return () => {
    revListeners.delete(fn);
    off();
  };
};
const snapshot = () => `${rev}:${tick}:${appSource().version?.() ?? 0}`;

/** The approved and pending activities of [from, to], newest first. */
export function useRingActivities(from: string, to: string): { approved: RingActivity[]; pending: RingActivity[]; tz: string } {
  const v = useSyncExternalStore(subscribe, snapshot, snapshot);
  return useMemo(() => {
    void v;
    const s = appSource();
    const tz = s.tz();
    return { ...ringActivities({ sessions: s.sessions(), candidates: s.candidates(), from, to, tz }), tz };
  }, [v, from, to]);
}
