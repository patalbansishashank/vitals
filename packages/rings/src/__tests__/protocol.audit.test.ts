// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { RING_FAMILIES } from '../index';
import type { RingEvent } from '../types';

const NOW = Date.UTC(2026, 9, 4, 12);

function assertEvent(event: RingEvent): void {
  if (event.type === 'sample' || event.type === 'vendor') {
    expect(Number.isFinite(event.value)).toBe(true);
    expect(Number.isFinite(event.t)).toBe(true);
    expect(event.t).toBeLessThanOrEqual(NOW);
    if (event.type === 'sample') {
      if (event.stream === 'hr') expect(event.value >= 25 && event.value <= 250).toBe(true);
      if (event.stream === 'spo2') expect(event.value >= 70 && event.value <= 100).toBe(true);
      if (event.stream === 'steps') expect(event.value).toBeGreaterThanOrEqual(0);
    }
  }
  if (event.type === 'sleepEpochs') {
    expect(event.epochS).toBeGreaterThan(0);
    expect(event.start + event.epochS * event.stages.length * 1000).toBeLessThanOrEqual(NOW);
  }
  if (event.type === 'activityBucket' || event.type === 'dailyTotal') {
    if (event.steps !== undefined) expect(event.steps).toBeGreaterThanOrEqual(0);
    if (event.distanceM !== undefined) expect(event.distanceM).toBeGreaterThanOrEqual(0);
    if (event.kcal !== undefined) expect(event.kcal).toBeGreaterThanOrEqual(0);
  }
  if (event.type === 'status' && event.key === 'battery' && typeof event.value === 'number') {
    expect(event.value).toBeGreaterThanOrEqual(0);
    expect(event.value).toBeLessThanOrEqual(100);
  }
}

describe('C-RINGX stateful protocol corruption checks', () => {
  for (const [familyIndex, family] of RING_FAMILIES.entries()) it(`${family.id} tolerates seeded random notification sequences and every prefix`, () => {
    let seed = 0x04c2301 + familyIndex;
    const next = (): number => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    const p = family.protocol;
    let state = p.initialState();
    const stamp = { nowMs: NOW, tzOffsetS: 0, tz: 'UTC' };
    if (p.begin) state = p.begin({ op: 'battery', params: stamp }, state).state;
    for (let i = 0; i < 750; i++) {
      const frame = Uint8Array.from({ length: next() % 193 }, () => next() >>> 24);
      const channel = family.gatt.notify[i % family.gatt.notify.length]?.characteristic;
      const result = p.ingest(frame, state, channel, NOW);
      state = result.state;
      result.events.forEach(assertEvent);
      // Start each prefix from the same state: each is a separately interrupted delivery.
      if (i % 75 === 0) for (let n = 0; n < frame.length; n++) p.ingest(frame.subarray(0, n), state, channel, NOW).events.forEach(assertEvent);
    }
  });
});
