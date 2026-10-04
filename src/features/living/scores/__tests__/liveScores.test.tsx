import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createDocumentStore, createMemoryBackend } from '@/store';
import { deriveWriter } from '@/commands/bio/store';
import { DocBioStore } from '@/biometrics/store/docStore';
import { sharedBioIndex } from '@/biometrics/store/docIndex';
import { InMemoryBlobStore } from '@/biometrics/store/memory';
import { bioActivity } from '@/biometrics/app/activity';
import type { ScoreResult } from '@/biometrics/core/types';
import { leak } from '@/content/evidence/__tests__/leakScan';
import { latestVersions } from '@/biometrics/core/scores/catalogue';
import { daily } from '@/biometrics/core/__tests__/factory';
import { createLiveScoresSource, userText } from '../liveScores';
import { ScoresChip } from '../ScoresChip';

const TODAY = '2026-03-11';
const NOW_ISO = '2026-03-11T08:00:00.000Z';

function setup() {
  const docs = createDocumentStore({ backend: createMemoryBackend({ device: 'TESTDEVICE000001' }), device: 'TESTDEVICE000001' });
  const bio = new DocBioStore({ index: sharedBioIndex(docs), blobs: new InMemoryBlobStore(), writer: deriveWriter(docs, 'test') });
  const src = createLiveScoresSource({ store: () => docs, today: () => TODAY });
  return { docs, bio, src };
}

const result = (scoreId: string, localDate: string, over: Partial<ScoreResult> = {}): ScoreResult => ({
  scoreId, version: '1.0.0', scope: { kind: 'night', localDate }, status: 'ok', value: null, confidence: 'medium', contributors: [], inputsHash: 'h', sourceIds: [], computedAt: `${localDate}T08:00:00.000Z`, build: 't', ...over,
});

afterEach(() => bioActivity.reset());

describe('live ScoresSource', () => {
  it('is honestly empty without score results', async () => {
    const { docs, src } = setup();
    await docs.ready;
    expect(src.tiles('lastNight')).toEqual([]);
    expect(src.tiles('today')).toEqual([]);
    expect(src.more()).toEqual([]);
    expect(src.detail('sleep.tst')).toBeNull();
  });

  it('shows stored results as tiles, newest version per day, and updates when results change', async () => {
    const { docs, bio, src } = setup();
    await docs.ready;
    const seen: number[] = [];
    const off = src.subscribe(() => seen.push(src.revision()));
    await bio.putScore(result('sleep.tst', '2026-03-10', { value: 6.5 }));
    await bio.putScore(result('sleep.tst', TODAY, { value: 7.2, band: { lo: 6.2, hi: 8.2, level: 0.8 } }));
    await bio.putScore(result('hrv.status', TODAY, { state: 'within' }));
    await bio.putScore(result('fitness.vo2max', TODAY, { status: 'withheld', reason: 'needs 14 nights of resting heart rate' }));
    await bio.flush();
    expect(seen.length).toBeGreaterThan(0);

    const tiles = src.tiles('lastNight');
    expect(tiles.map((t) => t.scoreId)).toEqual(['sleep.tst', 'hrv.status', 'fitness.vo2max']);
    expect(tiles[0]).toMatchObject({ title: 'sleep', value: 7.2, band: { lo: 6.2, hi: 8.2 }, status: 'ok', version: 'v1.0' });
    expect(tiles[1]).toMatchObject({ title: 'hrv status', state: 'within your normal' });
    expect(tiles[2]).toMatchObject({ status: 'withheld', value: null });

    // Today: sleep, HRV and resting heart rate only (plus an active flag)
    expect(src.tiles('today').map((t) => t.scoreId)).toEqual(['sleep.tst', 'hrv.status']);
    // 7 days: the mean of reported values
    expect(src.tiles('7d')[0]!.value).toBeCloseTo((6.5 + 7.2) / 2, 5);

    const d = src.detail('fitness.vo2max');
    expect(d?.readings[0]).toContain('needs 14 nights');
    expect(d?.confidence).toBeNull();
    off();
  });

  it('shows the latest results with their date and age when the window has none (Q1B-B-04)', async () => {
    const { docs, bio, src } = setup();
    await docs.ready;
    await bio.putScore(result('sleep.tst', '2026-03-07', { value: 6.9 }));
    await bio.putScore(result('hr.rhr_night', '2026-03-08', { value: 54 }));
    await bio.flush();
    for (const scope of ['lastNight', '7d'] as const) expect(src.tiles(scope).map((t) => t.scoreId)).toEqual(['sleep.tst', 'hr.rhr_night']);
    const [sleep, rhr] = src.tiles('lastNight');
    expect(sleep).toMatchObject({ value: 6.9, line: 'last data 7 Mar · 4 days old' });
    expect(rhr).toMatchObject({ value: 54, line: 'last data 8 Mar · 3 days old' });
    // the 7-day scope still averages what falls inside it
    expect(src.tiles('7d')[0]!.line).toMatch(/7-day average/);
    // Today is about last night only
    expect(src.tiles('today')).toEqual([]);
  });

  it('imported vendor scores show beside our tiles as the vendor opinion, only with the vendor stream on (Q1B-B-01)', async () => {
    const { docs, bio, src } = setup();
    await docs.ready;
    await bio.putRecord(daily('d1', TODAY, { steps: 9000, vendor: { readiness: 62, sleep: 82, stress: { value: 44, scale: '0-100' } } }), 'ring');
    await bio.putScore(result('sleep.tst', TODAY, { value: 7.2 }));
    await bio.putScore(result('hrv.status', TODAY, { state: 'within' }));
    await bio.flush();
    // off by default
    expect(src.tiles('lastNight').some((t) => t.vendor)).toBe(false);

    await bio.putPersonPolicies([{ stream: 'vendor_scores', imported: true, coach: 'hidden', engine: false, scores: false }], NOW_ISO);
    await bio.flush();
    await act(async () => undefined);
    const [sleep, hrv] = src.tiles('lastNight');
    // readiness has no tile of ours here, so it goes beside the first tile
    expect(sleep!.vendor).toEqual({ name: 'Your device', says: 'sleep 82 of 100 · readiness 62 of 100' });
    expect(hrv!.vendor).toEqual({ name: 'Your device', says: 'stress 44 of 100' });
  });

  it('flags show the word, never the level code; definitions load lazily', async () => {
    const { docs, bio, src } = setup();
    await docs.ready;
    await bio.putScore(result('illness.nightsignal', TODAY, { state: 'amber', detail: { nights: 2 } }));
    await bio.flush();
    src.tiles('today');
    await src.defsReady();
    const t = src.tiles('today').find((x) => x.scoreId === 'illness.nightsignal');
    expect(t?.flag).toEqual({ level: 'amber', word: 'signs of strain', nights: 2 });
    expect(t?.kind).toBe('flag');
    const detail = src.detail('illness.nightsignal');
    expect(detail?.formula.length).toBeGreaterThan(0);
    expect(detail?.versions[0]?.current).toBe(true);
  });
});

describe('score detail text (internal-refs guard, Q1B-B-03)', () => {
  it('strips research-note citations and model node names from definition text', () => {
    expect(userText('Autonomic balance; fitness lowers RHR (dossier 19 RHR_fit); infection raises it')).toBe('Autonomic balance; fitness lowers RHR; infection raises it');
    expect(userText('Replaces assumed sleep hours in dossier 16 d_t.')).toBe('');
    expect(userText('Weekly volume rises slowly. Timing advice (dossier 07/16).')).toBe('Weekly volume rises slowly. Timing advice.');
  });

  it('every score detail is free of maintainer references', async () => {
    const { docs, bio, src } = setup();
    await docs.ready;
    const defs = latestVersions();
    for (const d of defs) await bio.putScore(result(d.scoreId, TODAY, { version: d.version, value: 1 }));
    await bio.flush();
    src.tiles('lastNight');
    await src.defsReady();
    const hits: string[] = [];
    for (const d of defs) {
      const m = src.detail(d.scoreId);
      expect(m, d.scoreId).not.toBeNull();
      for (const t of [m!.heading, m!.formula, m!.evidence.text, m!.planEffects, ...m!.inputs, ...m!.readings]) {
        const l = leak(t) ?? (/\b[A-Za-z]+_[A-Za-z]+\b/.test(t) ? `node name: ${t}` : null);
        if (l) hits.push(`${d.scoreId}: ${l}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('ScoresChip', () => {
  it('shows "updating scores…" only while a rescore runs', () => {
    render(<ScoresChip />);
    expect(screen.queryByText(/updating scores/)).toBeNull();
    act(() => bioActivity.set({ rescoring: { jobId: 'j', progress: 0, from: '2026-01-01', to: TODAY, versions: ['v1.3'] } }));
    expect(screen.getByText('updating scores to v1.3…')).toBeTruthy();
    act(() => bioActivity.set({ rescoring: { jobId: 'j', progress: 0.5, from: null, to: null, versions: [] } }));
    expect(screen.getByText('updating scores…')).toBeTruthy();
    act(() => bioActivity.set({ rescoring: null }));
    expect(screen.queryByText(/updating scores/)).toBeNull();
  });
});
