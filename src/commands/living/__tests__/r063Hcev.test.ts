/**
 * r063 package HCEV through the import (audit gpt-6.1-sol #16, gpt-6-astra F19): the server timeline's Health Connect
 * speed and power (`hc`, `evidence`) reach `activity.fromGauge` per minute with their quality, and the detected
 * activity's estimate uses accepted speed and never unverified power.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDocumentStore } from '@/state/runtime';
import { dispatch, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { useProfileStore } from '@/state/profileStore';
import { bodyOf } from '@/store';
import { addDays, localToInstant, type LogEntry } from '@/living';
import type { ActivityCandidateDoc, ReviewSheetModel } from '@/living/activityCandidates';
import { activityInput, type ActivityImportInput } from '@/state/gaugeImport';
import type { GaugeApi } from '@/net/gauge';
import { readCandidates } from '../activity';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const TODAY = '2026-10-21';
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

// a treadmill run (Health Connect RUNNING_TREADMILL from another app) 18:00-18:30 yesterday, in a 2-hour minute grid
const first = ms(Y, 17);
const N = 120;
const hcRun = { id: 'hc-tm', revision: 'h1', start: ms(Y, 18), end: ms(Y, 18.5), exerciseType: 57, originPackage: 'com.example.treadmill' };
const day = (extra: Partial<ActivityImportInput['minutes'][number]> = {}): ActivityImportInput['minutes'][number] => ({
  first,
  steps: Array.from({ length: N }, (_, k) => (k >= 60 && k < 90 ? 160 : 0)),
  hrBpm: Array.from({ length: N }, (_, k) => (k >= 60 && k < 90 ? 150 : 70)),
  hrSupportedS: Array.from({ length: N }, () => 60),
  ...extra,
});
const inRun = <T,>(v: T, otherwise: T) => Array.from({ length: N }, (_, k) => (k >= 60 && k < 90 ? v : otherwise));

async function importOnce(minutes: ActivityImportInput['minutes'][number]): Promise<ActivityCandidateDoc> {
  out(await dispatch('activity.fromGauge', { gaugeSessions: [], hcSessions: [hcRun], minutes: [minutes] }, SYS));
  await settleCommits();
  const docs = [...(await readCandidates()).byKey.values()] as ActivityCandidateDoc[];
  expect(docs).toHaveLength(1);
  return docs[0]!;
}

describe('activity.fromGauge takes Health Connect speed and power per minute', () => {
  it('a treadmill run with accepted Health Connect speed is estimated by speed, and the candidate keeps the speed for an edit', async () => {
    const c = await importOnce(day({ speedMps: inRun<number | null>(2.5, null), speedAccepted: inRun(true, false) }));
    expect(c.suggested.exerciseId).toBe('treadmill_run');
    expect(c.estimate!.booked).toMatchObject({ estimator: 'speedGrade', domainFlags: expect.arrayContaining(['hcSpeed']) });
    expect(c.estimate!.booked.grossKcal).toBeCloseTo((33.5 * 70 * 30 * 5) / 1000, 6);
    expect(c.estimate!.evidence?.speed).toMatchObject({ used: true, kmh: 9 });
    expect(c.evidence?.speedMps?.filter((v) => v !== null)).toHaveLength(30);
  });

  it('unverified power never changes the energy; without speed or power the estimate is the one before', async () => {
    const plain = await importOnce(day());
    // no sex on record here: Keytel has no coefficient set, so the MET estimate is booked
    expect(plain.estimate!.booked.estimator).toBe('met');
    expect(plain.estimate).not.toHaveProperty('evidence');
    expect(plain.evidence).not.toHaveProperty('speedMps');
    freshState({ cleared: true });
    await getDocumentStore().ready;
    useProfileStore.getState().setAge(35);
    useProfileStore.getState().setHeight(175);
    useProfileStore.getState().setWeight(70);
    const powered = await importOnce(day({ powerW: inRun<number | null>(220, null), powerVerified: inRun(false, false) }));
    const { evidence, ...rest } = powered.estimate!;
    const { evidence: _none, ...before } = plain.estimate!;
    void _none;
    expect(rest.booked).toEqual(before.booked);
    expect(rest.cost.grossKcal).toBe(before.cost.grossKcal);
    expect(rest.heartPoints).toBe(before.heartPoints);
    expect(evidence?.power).toMatchObject({ verified: false, used: false, reason: 'powerNotVerified' });
  });

  it('the schema refuses a speed that is not a reading', async () => {
    const r = await dispatch('activity.fromGauge', { gaugeSessions: [], hcSessions: [hcRun], minutes: [day({ speedMps: inRun<number | null>(-1, null) })] }, SYS);
    expect(r.ok).toBe(false);
  });
});

describe('activityInput hands the timeline’s Health Connect speed and power to the import', () => {
  it('speed with its quality (a manual entry is not accepted), power never verified; a day without them adds nothing', async () => {
    const start = localToInstant(TODAY, 4, TZ);
    const tl = (date: string) =>
      date === TODAY
        ? {
            start, steps: { selected: [10, 20, 30] }, hr: { bpm: [null, null, null], supportedS: [null, null, null] }, sleep: { stage: [null, null, null] },
            hc: { speedMps: [2.5, 1.2, null], speedSource: ['hc:com.watch', 'hc:com.typed', null], powerW: [180, null, 400000], powerSource: ['hc:com.bike', null, 'hc:com.bike'] },
            evidence: { hr: [], speed: [{ source: 'hc:com.watch', minutes: 1, recordingMethod: 'activelyRecorded' }, { source: 'hc:com.typed', minutes: 1, recordingMethod: 'manualEntry' }], power: [{ source: 'hc:com.bike', minutes: 2, verified: false }] },
          }
        : date === Y
          ? { start: localToInstant(Y, 4, TZ), steps: { selected: [5] }, hr: { bpm: [null], supportedS: [null] }, sleep: { stage: [null] }, hc: null }
          : null;
    const api = { timeline: async (date: string) => tl(date) } as unknown as GaugeApi;
    const input = (await activityInput(api, Y, TODAY, TODAY))!;
    const today = input.minutes.find((m) => m.first === Date.parse(start))!;
    expect(today).toMatchObject({ speedMps: [2.5, 1.2, null], speedAccepted: [true, false, false], powerW: [180, null, null], powerVerified: [false, false, false] });
    const y = input.minutes.find((m) => m.first === Date.parse(localToInstant(Y, 4, TZ)))!;
    expect(Object.keys(y).sort()).toEqual(['asleep', 'first', 'hrBpm', 'hrSupportedS', 'steps']);
  });
});

describe('r063 FX4 (cross-verification M20): a motion-only correction revises an approved estimate', () => {
  // steps and HR unknown in the run: Health Connect speed is the window's only minute evidence
  const nulls = () => Array.from({ length: N }, () => null as number | null);
  const motionOnly = (mps: number | null) => day({ steps: nulls(), hrBpm: nulls(), hrSupportedS: nulls(), ...(mps === null ? {} : { speedMps: inRun<number | null>(mps, null), speedAccepted: inRun(true, false) }) });
  const review = async () => out<ReviewSheetModel>(await dispatch('activity.candidates', { from: Y, to: Y }));
  const bookedKcal = () =>
    getDocumentStore()
      .peekAll<LogEntry>('dailyLogs')
      .map((d) => bodyOf<LogEntry>(d))
      .filter((e): e is Extract<LogEntry, { kind: 'session' }> => e.kind === 'session')
      .map((e) => e.cost?.grossKcal);
  async function approve(): Promise<void> {
    const row = (await review()).rows[0]!;
    out(await dispatch('activity.approve', { id: row.id, revision: row.revision }));
    await settleCommits();
  }

  it('the probe: speed corrected from 2.5 to 3.5 m/s re-estimates (477.75 kcal); the person\'s approval stays as approved and never asks again (r070)', async () => {
    const c1 = await importOnce(motionOnly(2.5));
    expect(c1.estimate!.booked.estimator).toBe('speedGrade');
    expect(c1.estimate!.booked.grossKcal).toBeCloseTo(351.75, 6);
    expect(c1.evidenceRevision).not.toBeNull();
    await approve();
    expect(bookedKcal()).toEqual([351.75]);
    // the same evidence again changes nothing
    await importOnce(motionOnly(2.5));
    expect((await review()).rows).toEqual([]);
    // ACSM run at 210 m/min: VO2 = 3.5 + 0.2·210 = 45.5 → 45.5·70·30·5/1000 = 477.75 kcal
    const c2 = await importOnce(motionOnly(3.5));
    expect(c2.estimate!.booked.grossKcal).toBeCloseTo(477.75, 6);
    expect(c2.status).toBe('approved');
    expect(c2.decidedEstimate!.booked.grossKcal).toBeCloseTo(351.75, 6);
    expect((await review()).rows).toEqual([]);
    expect((await review()).decided.map((r) => r.updated)).toEqual([false]);
    // never a rewrite of the person's decision: the approved booking is what they approved
    expect(bookedKcal()).toEqual([351.75]);
  });

  it('(r070) the same correction over an automatic decision is booked again, silently (477.75 kcal)', async () => {
    await importOnce(motionOnly(2.5));
    out(await dispatch('activity.autoAccept', {}));
    await settleCommits();
    expect(bookedKcal()).toEqual([351.75]);
    await importOnce(motionOnly(3.5));
    out(await dispatch('activity.autoAccept', {}));
    await settleCommits();
    expect((await review()).rows).toEqual([]);
    expect(bookedKcal().at(-1)).toBeCloseTo(477.75, 6);
  });

  it('evidence that becomes available after a pass without any does not reopen the person\'s approval (r070)', async () => {
    const c1 = await importOnce(motionOnly(null));
    expect(c1.evidenceRevision ?? null).toBeNull();
    const before = c1.estimate!.booked.grossKcal;
    await approve();
    await importOnce(motionOnly(null));
    expect((await review()).rows).toEqual([]);
    const c2 = await importOnce(motionOnly(3.5));
    expect(c2.evidenceRevision).not.toBeNull();
    expect(c2.estimate!.booked).toMatchObject({ estimator: 'speedGrade', grossKcal: expect.closeTo(477.75, 6) });
    expect((await review()).rows).toEqual([]);
    expect(bookedKcal()).toEqual([before]);
  });
});
