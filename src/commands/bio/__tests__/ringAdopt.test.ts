/**
 * Ring data on by default (plan 04 item 11): a ring source created by a ring read keeps the ring defaults even when the
 * person's intake matrix (`policy:me`) says "coach hidden" for the stream; other new sources still adopt that matrix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { batch, daily, hrSeries, prov } from '@/biometrics/core/__tests__/factory';
import { suggestedOnPolicy } from '@/biometrics/core/policy';
import type { BioProvenance } from '@/biometrics/core/types';
import { createMemoryBlobStore, setBlobStore } from '@/state/blobStore';
import { settleCommits } from '../..';
import { freshState } from '../../__tests__/harness';
import { ingestRingBatch } from '../exec';
import { deriveWriter, openBioStore } from '../store';
import { resetBioRuntime } from '../runtime';

const RING = 'ble:jstyle2301/2301/mac:aa:bb:cc:dd:ee:11';
const ringProv = (): BioProvenance => prov({ channel: RING as BioProvenance['channel'], device: { type: 'ring', manufacturer: 'J-Style', model: '2301', tier: 'C' } });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-04T12:00:00.000Z'));
  freshState({ cleared: true });
  setBlobStore(createMemoryBlobStore());
  resetBioRuntime();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a new ring source and the person matrix', () => {
  it('keeps the ring defaults when the person matrix hides the stream from the Coach', async () => {
    const store = await openBioStore({ writer: deriveWriter() });
    // the old intake default: imported, scores on, Coach hidden
    await store.putPersonPolicies([suggestedOnPolicy('hr'), suggestedOnPolicy('sleep_sessions'), suggestedOnPolicy('daily_summary')], new Date().toISOString());
    await store.flush();
    const date = '2026-10-03';
    await ingestRingBatch(batch([daily(`night-${date}`, date, { steps: 9000, resting_hr_bpm: 55 }, ringProv()), hrSeries(`hr-${date}`, `${date}T01:00:00.000Z`, [60, 61, 62], 60, ringProv())]), {
      ringKey: RING,
      signal: new AbortController().signal,
      progress: () => {},
    });
    await settleCommits();
    const src = await (await openBioStore({ writer: deriveWriter() })).getSource(RING);
    expect(src).toBeTruthy();
    for (const stream of ['hr', 'sleep_sessions', 'daily_summary'] as const) {
      const p = src!.policies.find((x) => x.stream === stream);
      expect(p, stream).toMatchObject({ imported: true, coach: 'daily+series', scores: true });
    }
  });
});
