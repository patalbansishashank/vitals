// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CRP_CMD_NOTIFY, CRP_STEPS_NOTIFY, CMD, GROUP, crpFrame } from '../commands';
import { decodeCrp, toCrpRingEvents } from '../decoder';
import { crp } from '../family';
import type { CrpState } from '../protocol';

const NOW = Date.parse('2026-07-24T12:00:00Z');
const ctx = { nowMs: NOW, tzOffsetS: 0, firmware: '' };

function assertPlausible(events: ReturnType<typeof toCrpRingEvents>): void {
  for (const e of events) {
    if (e.type === 'sample') {
      expect(e.t).toBeLessThanOrEqual(NOW);
      if (e.stream === 'hr') expect(e.value).toBeGreaterThanOrEqual(25);
      if (e.stream === 'hr') expect(e.value).toBeLessThanOrEqual(250);
      if (e.stream === 'spo2') expect(e.value).toBeGreaterThanOrEqual(70);
      if (e.stream === 'spo2') expect(e.value).toBeLessThanOrEqual(100);
    }
    if (e.type === 'dailyTotal') expect(e.steps).toBeGreaterThanOrEqual(0);
    if (e.type === 'sleepEpochs') {
      expect(e.stages.length).toBeLessThanOrEqual(1440);
      expect(e.start + e.stages.length * e.epochS * 1000).toBeLessThanOrEqual(NOW);
    }
  }
}

describe('CRP malformed history safety', () => {
  it('keeps Kotlin-shaped low oxygen for parity but never publishes it as a measurement', () => {
    const frame = crpFrame(GROUP.HISTORY, CMD.HISTORY_SPO2, [0, 0, 50, 98]);
    const decoded = decodeCrp(frame, CRP_CMD_NOTIFY, ctx);
    expect(decoded.filter((d) => d.kotlin === 'HistoryMeasurement').map((d) => ('value' in d ? d.value : null))).toEqual([50, 98]);
    expect(toCrpRingEvents(decoded, ctx).map((e) => (e.type === 'sample' ? e.value : null))).toEqual([98]);
  });

  it('rejects an out-of-range frame index before it can complete a history read', () => {
    const frame = crpFrame(GROUP.HISTORY, CMD.HISTORY_HR, [0, 255, 75]);
    expect(decodeCrp(frame, CRP_CMD_NOTIFY, ctx).map((d) => d.kotlin)).toEqual(['CommandAck']);
    const state = { ...crp.protocol.initialState(), nowMs: NOW, inflight: { kind: 'timing', op: 'history_hr', cmd: CMD.HISTORY_HR, stream: 'hr', day: 0, date: '2026-07-24', terminal: 1, frames: 0, silenceMs: 0 } } as CrpState;
    const result = crp.protocol.ingest(frame, state, CRP_CMD_NOTIFY);
    expect(result.done).not.toBe(true);
    expect(result.events.every((e) => e.type !== 'sample')).toBe(true);
  });

  it('does not publish current-day samples beyond the session clock', () => {
    const frame = crpFrame(GROUP.HISTORY, CMD.HISTORY_HR, [0, 1, 72, 72, 72]);
    expect(toCrpRingEvents(decodeCrp(frame, CRP_CMD_NOTIFY, ctx), ctx).map((e) => (e.type === 'sample' ? e.t : null))).toEqual([
      NOW,
    ]);
  });

  it('stamps live replies and step pushes at receive time without moving a midnight history page', () => {
    const started = Date.parse('2026-07-24T23:59:00Z');
    const later = Date.parse('2026-07-25T00:01:00Z');
    const state = { ...crp.protocol.initialState(), nowMs: started } as CrpState;
    const a = crp.protocol.ingest(crpFrame(GROUP.DEVICE, CMD.MEASURE_HR, [75]), state, CRP_CMD_NOTIFY, started);
    const b = crp.protocol.ingest(crpFrame(GROUP.DEVICE, CMD.MEASURE_HR, [76]), a.state, CRP_CMD_NOTIFY, later);
    expect(a.events[0]).toMatchObject({ type: 'sample', t: started, value: 75 });
    expect(b.events[0]).toMatchObject({ type: 'sample', t: later, value: 76 });
    const steps = crp.protocol.ingest(Uint8Array.of(1, 0, 0), b.state, CRP_STEPS_NOTIFY, later);
    expect(steps.events[0]).toMatchObject({ type: 'dailyTotal', steps: 1, localDay: Date.parse('2026-07-25T00:00:00Z') });
    const begun = crp.protocol.begin!({ op: 'history_hr', params: { date: '2026-07-24', nowMs: started, tzOffsetS: 0 } }, state);
    const page = crp.protocol.ingest(crpFrame(GROUP.HISTORY, CMD.HISTORY_HR, [0, 0, 75]), begun.state, CRP_CMD_NOTIFY, later);
    expect(page.events[0]).toMatchObject({ type: 'sample', t: Date.parse('2026-07-24T00:00:00Z'), value: 75 });
    expect((page.state as CrpState).nowMs).toBe(started);
  });

  it('random and truncated notifications never throw or publish impossible values', () => {
    let seed = 0x26a4c;
    const next = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 24);
    let state = { ...crp.protocol.initialState(), nowMs: NOW } as CrpState;
    for (let i = 0; i < 1000; i++) {
      const len = next() % 80;
      const bytes = Uint8Array.from({ length: len }, next);
      const channel = i % 7 === 0 ? CRP_STEPS_NOTIFY : CRP_CMD_NOTIFY;
      const result = crp.protocol.ingest(bytes, state, channel);
      state = result.state as CrpState;
      assertPlausible(result.events);
      const valid = crpFrame(GROUP.HISTORY, [CMD.HISTORY_HR, CMD.HISTORY_SPO2, CMD.HISTORY_SLEEP][i % 3]!, bytes);
      for (let cut = 0; cut < Math.min(7, valid.length); cut++) assertPlausible(toCrpRingEvents(decodeCrp(valid.subarray(0, cut), CRP_CMD_NOTIFY, ctx), ctx));
    }
  });
});
