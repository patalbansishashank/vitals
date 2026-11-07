/**
 * 0.6.7 AD-VITALS (contract §3): the home server's `detect/2` episodes become activities to review through
 * `activity.fromGauge`.
 *  - every label maps to its catalogue type (a `possible_*` one to none: approval needs the person's choice), with its level,
 *    reasons and type choices;
 *  - an overlapping recording absorbs the episode (the ≥ 50 % host rule; one arriving later supersedes the pending one);
 *  - a withdrawn episode supersedes its pending candidate; a rejected one stays rejected across revisions;
 *  - with `detect/2` on the server the local detect/1 cadence/HR detectors are off;
 *  - an episode never changes the booked energy until approved (D8: no auto-booking).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { getDocumentStore } from '@/state/runtime';
import { useProfileStore } from '@/state/profileStore';
import { addDays, effectiveEntries, localToInstant } from '@/living';
import { needsTypeChoice, reviewSheetModel, type ActivityCandidateDoc } from '@/living/activityCandidates';
import { detectionChoices } from '@/living/detectionLabels';
import { readCandidates, serverDetects } from '../activity';
import { readDocs } from '../index';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const TODAY = '2026-10-28';
const Y = addDays(TODAY, -1);
const SYS = { actor: { kind: 'system' as const, id: 'gauge-import' } };
const ms = (date: string, h: number) => Date.parse(localToInstant(date, h, TZ));
const out = <T,>(r: CommandResult): T => {
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as T;
};

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(ms(TODAY, 12)));
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(async () => {
  freshState({ cleared: true });
  await getDocumentStore().ready;
  const p = useProfileStore.getState();
  p.setAge(35);
  p.setHeight(175);
  p.setWeight(70);
});

type Ep = { id: string; revision: number; detector: string; start: number; end: number; state?: 'open' | 'final' | 'withdrawn'; label: string; alternatives?: string[]; existence: number; typeScore: number; level: 'low' | 'medium' | 'high'; reasons?: string[]; evidenceHash?: string };
const ep = (o: Partial<Ep> & { id: string }): Ep => ({ revision: 1, detector: 'detect/2', start: ms(Y, 10), end: ms(Y, 10.4), state: 'final', label: 'walk_possibly_treadmill', existence: 0.7, typeScore: 0.45, level: 'medium', reasons: ['phoneSteadyCadence', 'ringFewSteps'], ...o });

async function run(input: Record<string, unknown>) {
  const o = out<{ created: string[]; updated: string[]; superseded: string[]; blocked: string[] }>(await dispatch('activity.fromGauge', { gaugeSessions: [], hcSessions: [], serverDetector: 'detect/2', ...input }, SYS));
  await settleCommits();
  return o;
}
async function docs(): Promise<ActivityCandidateDoc[]> {
  return [...(await readCandidates()).byKey.values()].filter((r): r is ActivityCandidateDoc => r.compact !== true);
}
async function sessionsBooked(): Promise<number> {
  return effectiveEntries((await readDocs(TODAY)).entries).filter((e) => e.kind === 'session').length;
}

describe('episode → candidate, per label', () => {
  const cases: Array<[string, string | null]> = [
    ['walk', 'walk'],
    ['walk_possibly_treadmill', 'treadmill_walk'],
    ['treadmill_walk', 'treadmill_walk'],
    ['run', 'jog_outdoor'],
    ['treadmill_run', 'treadmill_run'],
    ['cycling', 'cycle_outdoor'],
    ['possible_cycling', null],
    ['possible_workout', null],
    ['possible_strength', null],
    ['something_new', null],
  ];
  for (const [label, type] of cases) {
    it(`${label} → ${type ?? 'no preselected type'}`, async () => {
      await run({ detections: [ep({ id: `E-${label}`, label, alternatives: label === 'possible_strength' ? ['possible_workout'] : [] })] });
      const [c] = await docs();
      expect(c).toBeDefined();
      expect(c!.status).toBe('pending');
      expect(c!.refs).toEqual([`detect:bout:E-${label}`]);
      expect(c!.sources).toEqual([expect.objectContaining({ source: 'automaticDetector', ref: `detect:bout:E-${label}`, confidence: 'medium' })]);
      expect(c!.detection).toMatchObject({ episodeId: `E-${label}`, label, level: 'medium', needsType: type === null, reasons: ['phoneSteadyCadence', 'ringFewSteps'] });
      expect(c!.detection!.choices).toEqual(detectionChoices(label, label === 'possible_strength' ? ['possible_workout'] : []));
      if (type) {
        expect(c!.suggested.exerciseId).toBe(type);
        expect(c!.detection!.choices[0]).toBe(type);
        expect(needsTypeChoice(c!)).toBe(false);
      } else {
        // no preselection: no estimate either (never shown or booked as generic moderate cardio)
        expect(needsTypeChoice(c!)).toBe(true);
        expect(c!.estimate).toBeNull();
        expect(c!.detection!.choices).toEqual(expect.arrayContaining(['air_bike', 'stationary_bike', 'strength_general', 'mudgar_two_hand']));
      }
    });
  }

  it('an open episode is not an activity to review yet', async () => {
    const o = await run({ detections: [ep({ id: 'OPEN', state: 'open' })] });
    expect(o.created).toEqual([]);
    expect(await docs()).toEqual([]);
  });

  it('a possible workout needs a type: Approve and Approve all refuse, an edit with a type approves it', async () => {
    await run({ detections: [ep({ id: 'PW', label: 'possible_workout' })] });
    const [c] = await docs();
    const model = reviewSheetModel(await docs(), {});
    expect(model.rows[0]!.detection).toMatchObject({ needsType: true });
    expect(model.approveAll.items).toEqual([]);
    const a = await dispatch('activity.approve', { id: c!.key, revision: c!.revision });
    expect(a.ok).toBe(false);
    expect(!a.ok && a.error.message).toMatch(/Choose what this activity was/);
    expect((await dispatch('activity.approveAll', { items: [{ id: c!.key, revision: c!.revision }] })).ok).toBe(false);
    expect((await dispatch('activity.edit', { id: c!.key, revision: c!.revision, startAt: new Date(ms(Y, 10.05)).toISOString() })).ok).toBe(false);
    expect(await sessionsBooked()).toBe(0);
    out(await dispatch('activity.edit', { id: c!.key, revision: c!.revision, exerciseId: 'air_bike' }));
    await settleCommits();
    const [after] = await docs();
    expect(after).toMatchObject({ status: 'edited', decision: expect.objectContaining({ exerciseId: 'air_bike' }) });
    expect(await sessionsBooked()).toBe(1);
  });
});

describe('absorption, withdrawal, rejection', () => {
  const walk = { id: 'w1', revision: 'g1', start: ms(Y, 10), end: ms(Y, 10.4), type: 'walk' };

  it('a recording in the same pass absorbs an overlapping episode (one activity, the episode as corroboration)', async () => {
    await run({ gaugeSessions: [walk], detections: [ep({ id: 'A1', start: ms(Y, 10.02), end: ms(Y, 10.38) })] });
    const all = await docs();
    expect(all).toHaveLength(1);
    expect(all[0]!.refs).toEqual(['detect:bout:A1', 'gauge:w1']);
    expect(all[0]!.corroboratedBy).toEqual(['detect:bout:A1']);
    expect(all[0]!.detection).toBeUndefined();
  });

  it('a recording arriving after the episode supersedes its pending candidate', async () => {
    await run({ detections: [ep({ id: 'A2' })] });
    const [first] = await docs();
    expect(first!.status).toBe('pending');
    const o = await run({ gaugeSessions: [walk], detections: [ep({ id: 'A2' })] });
    expect(o.superseded).toEqual([first!.key]);
    const all = await docs();
    expect(all.find((c) => c.key === first!.key)).toMatchObject({ status: 'superseded' });
    expect(all.filter((c) => c.status === 'pending')).toHaveLength(1);
    expect(all.find((c) => c.status === 'pending')!.refs).toContain('gauge:w1');
  });

  it('a long episode around a short recording is not attached whole to it: both are held for the person', async () => {
    const short = { ...walk, id: 'w2', start: ms(Y, 10), end: ms(Y, 10.2) };
    await run({ gaugeSessions: [short], detections: [ep({ id: 'LONG', start: ms(Y, 9.5), end: ms(Y, 11) })] });
    const all = await docs();
    expect(all).toHaveLength(2);
    const m = reviewSheetModel(all, {});
    expect(m.approveAll.held?.map((h) => h.id).sort()).toEqual(all.map((c) => c.key).sort());
  });

  it('a recording the server linked to the episode hosts it', async () => {
    const other = { ...walk, id: 'w3', start: ms(Y, 9.9), end: ms(Y, 10.3) };
    await run({ gaugeSessions: [other], detections: [ep({ id: 'L1', recordingRefs: ['gauge:w3'] } as Partial<Ep> & { id: string })] });
    const all = await docs();
    expect(all).toHaveLength(1);
    expect(all[0]!.corroboratedBy).toEqual(['detect:bout:L1']);
  });

  it('a withdrawn episode supersedes its pending candidate (withdrawn list, or state)', async () => {
    await run({ detections: [ep({ id: 'W1' }), ep({ id: 'W2', start: ms(Y, 15), end: ms(Y, 15.5) })] });
    expect((await docs()).filter((c) => c.status === 'pending')).toHaveLength(2);
    const o = await run({ withdrawnDetections: ['W1'], detections: [ep({ id: 'W2', start: ms(Y, 15), end: ms(Y, 15.5), state: 'withdrawn', revision: 2 })] });
    expect(o.superseded).toHaveLength(2);
    for (const c of await docs()) expect(c).toMatchObject({ status: 'superseded', withdrawn: { reason: 'detectorWithdrawn' } });
  });

  it('an approved episode stays approved when the server withdraws it (the person said it happened)', async () => {
    await run({ detections: [ep({ id: 'AP' })] });
    const [c] = await docs();
    out(await dispatch('activity.approve', { id: c!.key, revision: c!.revision }));
    await settleCommits();
    await run({ withdrawnDetections: ['AP'] });
    expect((await docs())[0]).toMatchObject({ status: 'approved' });
    expect(await sessionsBooked()).toBe(1);
  });

  it('a rejected episode stays rejected across revisions (a moved start, new evidence)', async () => {
    await run({ detections: [ep({ id: 'RJ' })] });
    const [c] = await docs();
    out(await dispatch('activity.reject', { id: c!.key }));
    await settleCommits();
    const o = await run({ detections: [ep({ id: 'RJ', revision: 3, start: ms(Y, 9.8), end: ms(Y, 10.6), evidenceHash: 'h3', label: 'treadmill_walk', level: 'high' })] });
    expect(o.blocked).toEqual([c!.key]);
    expect(o.created).toEqual([]);
    const all = await docs();
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe('rejected');
  });

  it('a new revision of a pending episode updates the same candidate (one key)', async () => {
    await run({ detections: [ep({ id: 'RV' })] });
    const [c] = await docs();
    const o = await run({ detections: [ep({ id: 'RV', revision: 2, end: ms(Y, 10.5), evidenceHash: 'h2' })] });
    expect(o.updated).toEqual([c!.key]);
    const all = await docs();
    expect(all).toHaveLength(1);
    expect(all[0]!.window.end).toBe(ms(Y, 10.5));
  });
});

describe('detect/1 is off when the server runs detect/2', () => {
  // 30 minutes of steady 100/min steps: the local cadence detector's walk
  const minutes = [{ first: ms(Y, 9), steps: Array.from({ length: 120 }, (_, k) => (k >= 60 && k < 90 ? 100 : 0)) }];

  it('serverDetects reads detect/N with N ≥ 2', () => {
    expect(serverDetects('detect/2')).toBe(true);
    expect(serverDetects('detect/3')).toBe(true);
    expect(serverDetects('detect/1')).toBe(false);
    expect(serverDetects(undefined)).toBe(false);
    expect(serverDetects('nonsense')).toBe(false);
  });

  it('without detect/2 the local cadence detector proposes the walk; with it, nothing local is proposed', async () => {
    await run({ minutes, serverDetector: undefined });
    expect((await docs()).map((c) => c.sources[0]!.source)).toEqual(['cadenceDetector']);
    freshState({ cleared: true });
    await getDocumentStore().ready;
    await run({ minutes, serverDetector: 'detect/2' });
    expect(await docs()).toEqual([]);
  });
});

describe('no auto-booking (D8)', () => {
  it('a final, high-level episode books nothing until the person approves it', async () => {
    await run({ detections: [ep({ id: 'NB', label: 'walk', level: 'high', existence: 0.9, typeScore: 0.8 })] });
    const [c] = await docs();
    expect(c!.status).toBe('pending');
    expect(c!.entryId).toBeNull();
    expect(await sessionsBooked()).toBe(0);
    // re-importing the same episode changes nothing
    const again = await run({ detections: [ep({ id: 'NB', label: 'walk', level: 'high', existence: 0.9, typeScore: 0.8 })] });
    expect(again.created).toEqual([]);
    expect(await sessionsBooked()).toBe(0);
    out(await dispatch('activity.approve', { id: c!.key, revision: c!.revision }));
    await settleCommits();
    expect(await sessionsBooked()).toBe(1);
  });
});
