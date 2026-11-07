/** Test helpers: canonical activities (session entries and candidates) for the Ring's activity source. */
import type { CandidateRecord } from '@/living/activityCandidates';
import type { SessionEntry } from '../activities';
import type { RingActivitySource } from '../useActivities';

export function sessionEntry(o: { id: string; date: string; startH?: number; durationMin?: number; key?: string; grossKcal?: number; aboveRestKcal?: number; exerciseId?: string; zones?: unknown; rpe?: number; manual?: boolean }): SessionEntry {
  return {
    id: o.id,
    date: o.date,
    kind: 'session',
    status: 'done',
    ...(o.startH !== undefined ? { startH: o.startH } : {}),
    ...(o.durationMin !== undefined ? { durationMin: o.durationMin } : {}),
    performed: [{ exerciseId: o.exerciseId ?? 'running_general', ...(o.rpe !== undefined ? { rpe: o.rpe, rpeScale: 'cr10' } : {}) }],
    stimulus: {},
    catalogueVersion: 't',
    ...(o.grossKcal !== undefined ? { cost: { grossKcal: o.grossKcal, ownRestKcal: 0, netAboveRestKcal: o.aboveRestKcal ?? o.grossKcal * 0.8, displacedLifestyleKcal: null, incrementalKcal: null, method: 'hr', source: 'inferred' } } : {}),
    ...(o.key ? { physicalBoutId: o.key, candidate: { key: o.key, decidedRevision: 'r', sourceRevision: 's', estimateRevision: null, estimatorVersion: 'v', ...(o.manual ? { manual: true as const } : {}) } } : {}),
    ...(o.zones ? { zones: o.zones } : {}),
  } as unknown as SessionEntry;
}

export function candidate(o: { key: string; status: 'pending' | 'approved' | 'edited' | 'rejected' | 'superseded'; refs: string[]; date: string; start: number; end: number; entryId?: string; decision?: { start: number; end: number; exerciseId?: string }; pauses?: Array<{ start: number; end: number }>; compact?: boolean; exerciseId?: string; grossKcal?: number }): CandidateRecord {
  if (o.compact) return { key: o.key, compact: true, refs: o.refs, status: o.status, decidedRevision: 'r', entryId: o.entryId ?? null, resolvedAt: null };
  const iso = (t: number) => new Date(t).toISOString();
  return {
    key: o.key,
    date: o.date,
    tz: 'UTC',
    startAt: iso(o.start),
    endAt: iso(o.end),
    window: { start: o.start, end: o.end },
    refs: o.refs,
    sources: [],
    sourceRevision: 's',
    estimateRevision: null,
    revision: 'r',
    suggested: { exerciseId: o.exerciseId ?? 'walking_general', confidence: 'medium', needsReview: true, why: [] },
    measures: { durationMin: (o.end - o.start) / 60_000, steps: null, medianCadence: null, hrSupportedS: null, meanHr: null },
    estimate: o.grossKcal !== undefined ? { booked: { grossKcal: o.grossKcal } } : null,
    corroboratedBy: [],
    mergeSuggestions: [],
    planMatch: null,
    status: o.status,
    decidedRevision: null,
    entryId: o.entryId ?? null,
    decidedAt: null,
    decidedBy: null,
    decision: o.decision ? { exerciseId: o.decision.exerciseId ?? o.exerciseId ?? 'walking_general', startAt: iso(o.decision.start), endAt: iso(o.decision.end) } : null,
    decidedEstimate: null,
    history: [],
    firstSeenAt: iso(o.start),
    updatedAt: iso(o.start),
    resolvedAt: null,
    ...(o.pauses ? { pauses: o.pauses } : {}),
  } as unknown as CandidateRecord;
}

export function activitySource(o: { sessions?: SessionEntry[]; candidates?: CandidateRecord[]; tz?: string }): RingActivitySource {
  return { sessions: () => o.sessions ?? [], candidates: () => o.candidates ?? [], tz: () => o.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone, subscribe: () => () => undefined };
}
