/**
 * The intake's devices matrix (`StreamPolicy` per intake stream id) → biometrics policy streams (`bio.setPolicy`).
 * Several intake streams share one policy stream (weight and body fat are `body`; `hrv` also sets `ibi`), and
 * `daily_summary` is the OR of everything the person brought in. Each target is normalised with E10's rule set.
 */
import { normalizePolicy } from '@/biometrics/core/policy';
import type { PolicyStream, StreamPolicy as BioPolicy } from '@/biometrics/core/types';
import type { CoachVisibility, StreamId, StreamPolicy } from './types';

export const POLICY_TARGETS: Readonly<Record<StreamId, readonly PolicyStream[]>> = {
  sleep_sessions: ['sleep_sessions'],
  heart_rate: ['hr'],
  hrv: ['hrv', 'ibi'],
  spo2: ['spo2'],
  skin_temp: ['skin_temp'],
  steps: ['steps'],
  workouts: ['workouts'],
  weight: ['body'],
  body_fat: ['body'],
  vendor_scores: ['vendor_scores'],
};

const COACH_RANK: Record<CoachVisibility, number> = { hidden: 0, daily: 1, 'daily+series': 2 };
const off = (stream: PolicyStream): BioPolicy => ({ stream, imported: false, coach: 'hidden', engine: false, scores: false });
const or = (a: BioPolicy, b: Pick<StreamPolicy, 'imported' | 'coach' | 'engine' | 'scores'>): BioPolicy => ({
  stream: a.stream,
  imported: a.imported || b.imported,
  coach: COACH_RANK[b.coach] > COACH_RANK[a.coach] ? b.coach : a.coach,
  engine: a.engine || b.engine,
  scores: a.scores || b.scores,
});

/** Policy per bio stream the matrix implies (only streams the matrix names; `daily_summary` = OR of the imported ones). */
export function biometricPolicies(streams: readonly StreamPolicy[] | undefined): Map<PolicyStream, BioPolicy> {
  const out = new Map<PolicyStream, BioPolicy>();
  let daily = off('daily_summary');
  for (const p of streams ?? []) {
    for (const t of POLICY_TARGETS[p.stream] ?? []) out.set(t, or(out.get(t) ?? off(t), p));
    if (p.imported && p.stream !== 'vendor_scores') daily = or(daily, p);
  }
  if (streams?.length) out.set('daily_summary', daily);
  for (const [k, v] of out) out.set(k, normalizePolicy(v));
  return out;
}

export interface PolicyCall {
  stream: PolicyStream;
  policy: { imported: boolean; coach: CoachVisibility; engine: boolean; scores: boolean };
}

/** The `bio.setPolicy` calls that move the stored matrix (`prev`) to the saved one (`next`): changed targets only. */
export function policyCalls(prev: readonly StreamPolicy[] | undefined, next: readonly StreamPolicy[] | undefined): PolicyCall[] {
  const a = biometricPolicies(prev);
  const calls: PolicyCall[] = [];
  for (const [stream, p] of biometricPolicies(next)) {
    const before = a.get(stream) ?? off(stream);
    if (before.imported === p.imported && before.coach === p.coach && before.engine === p.engine && before.scores === p.scores) continue;
    calls.push({ stream, policy: { imported: p.imported, coach: p.coach, engine: p.engine, scores: p.scores } });
  }
  return calls;
}
