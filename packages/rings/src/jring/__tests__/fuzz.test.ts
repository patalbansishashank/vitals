// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { toJringRingEvents } from '../decoder';
import { createJringProtocol, type JringState } from '../protocol';

const nowMs = Date.UTC(2026, 9, 4, 12);

describe('Jring malformed packets and local days', () => {
  it('timestamps repeated live replies at their receipt time', () => {
    const protocol = createJringProtocol();
    const st = { ...protocol.initialState(), nowMs } as JringState;
    const bytes = Uint8Array.from([0x24, 72, ...new Array<number>(18).fill(0)]);
    const first = protocol.ingest(bytes, st, undefined, nowMs);
    const second = protocol.ingest(bytes, first.state, undefined, nowMs + 60_000);
    expect(first.events.find((e) => e.type === 'sample')).toMatchObject({ t: nowMs });
    expect(second.events.find((e) => e.type === 'sample')).toMatchObject({ t: nowMs + 60_000 });
  });

  it('places a historical local day at its own DST midnight', () => {
    // Noon on the spring transition day uses the new offset; its midnight still used the old one.
    const localNoonS = Date.UTC(2024, 2, 10, 12) / 1000;
    const events = toJringRingEvents(
      { kind: 'ActivityUpdate', tMs: 0, rawS: localNoonS, steps: 1, distanceMeters: 0, calories: 0 },
      { nowMs: Date.UTC(2024, 2, 10, 16), clockOffsetS: -14_400, tz: 'America/New_York', firmware: '' },
    );
    expect(events).toMatchObject([{ localDay: Date.UTC(2024, 2, 10, 5) }]);
  });

  it('does not count the already removed timezone offset as future clock drift', () => {
    const events = toJringRingEvents(
      { kind: 'HeartRateSample', tMs: nowMs + 7_200_000, bpm: 72, sleepStatus: 0, isError: false, source: 'live' },
      { nowMs, clockOffsetS: 19_800, strictNow: true, firmware: '' },
    );
    expect(events).toEqual([]);
  });

  it('seeded random and truncated notifications cannot escape the decoder or create impossible history', () => {
    let seed = 0x510e527f;
    const next = (): number => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
    const protocol = createJringProtocol();
    let st = { ...protocol.initialState(), nowMs, clockOffsetS: 19_800 } as JringState;
    const ids = [0x03, 0x0b, 0x10, 0x11, 0x14, 0x16, 0x24, 0x3f];
    for (let i = 0; i < 5_000; i++) {
      const length = next() % 22;
      const bytes = Uint8Array.from({ length }, () => next() & 255);
      if (length === 20) bytes[0] = ids[next() % ids.length]!;
      const result = protocol.ingest(bytes, st, undefined, nowMs);
      st = result.state as JringState;
      for (const event of result.events) {
        if (event.type === 'activityBucket') {
          expect(event.steps).toBeGreaterThanOrEqual(0);
          expect(event.steps).toBeLessThanOrEqual(5_000);
          expect(event.start).toBeLessThanOrEqual(nowMs);
        }
        if (event.type === 'sample') {
          if (event.stream === 'hr') expect(event.value).toBeGreaterThanOrEqual(30);
          if (event.stream === 'hr') expect(event.value).toBeLessThanOrEqual(220);
          if (event.stream === 'spo2') expect(event.value).toBeGreaterThanOrEqual(70);
          if (event.stream === 'spo2') expect(event.value).toBeLessThanOrEqual(100);
        }
        if (event.type === 'sleepEpochs') expect(event.stages.length).toBe(15);
      }
    }
  });
});
