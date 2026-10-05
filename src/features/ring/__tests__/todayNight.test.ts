// @vitest-environment node
/**
 * The Ring page's sleep row and the Sleep tab for a night the ring hands over in pieces (the ring parity night's shape
 * on synthetic times): the row shows the whole night, not its longest piece, and the second sleep of the morning is
 * listed on the Sleep tab as another sleep.
 */
import { describe, expect, it } from 'vitest';
import { jstyle2301 } from '../../../../packages/rings/src/jstyle2301/family';
import { ringRecords, type RingRecordContext } from '../../../../packages/rings/src/records';
import { ringIdentity, type RingEvent } from '../../../../packages/rings/src/types';
import { resolveDays } from '@/biometrics/core/resolve';
import { sourceKeyOf } from '@/biometrics/core/source';
import { sleepDay } from '@/features/signals/charts/sleepModels';
import { todayRows } from '../todayModel';

const at = (s: string): number => Date.parse(`2026-03-${s}:00Z`);
const READ_AT = '2026-03-10T10:00:00.000Z';
const ctx: RingRecordContext = {
  identity: ringIdentity({ family: 'jstyle2301', model: '2301', serial: 'SYNTHETIC043' }), family: jstyle2301, firmware: 'V0525',
  tz: 'UTC', tzOffsetS: 0, receivedS: Date.parse(READ_AT) / 1000, ingestedAt: READ_AT, producer: { name: 'test', version: '1' },
};
/** `awake` minutes awake, then light. */
const packet = (start: number, minutes: number, awake = 0): RingEvent => ({
  type: 'sleepEpochs', start, epochS: 60, stages: Array.from({ length: minutes }, (_, i) => (i < awake ? 'awake' : 'light')), rawCodes: [], firmware: 'V0525', complete: false,
});
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s/g, ' ');

describe('a night read in pieces', () => {
  const events = [
    packet(at('09T23:00'), 120, 15), packet(at('10T01:00'), 90), // touching, to 02:30
    packet(at('10T02:37'), 30, 5), // after a 7-minute gap, to 03:07
    packet(at('10T05:00'), 60, 10), packet(at('10T06:01'), 40), // two hours later, a 1-minute gap
  ];
  const days = resolveDays(
    ringRecords(events, ctx).records.filter((r) => r.kind === 'sleep').map((record) => ({ sourceKey: sourceKeyOf(record.provenance), record })),
    [], { from: '2026-03-09', to: '2026-03-10' },
  );

  it('the Ring page row shows the whole night: bed to the end of the last piece, all of its sleep', () => {
    const row = todayRows({
      today: '2026-03-10', now: at('10T12:00'), days, baselines: [], person: { goals: {}, vendorScores: false, tempUnit: 'C' },
      measures: ['sleep'], live: null, lastHr: null, stepsNewestAt: null, reading: false,
    }).find((r) => r.id === 'sleep')!;
    // before: the longest piece, "3 h 15 min asleep", "in bed 23:00 – 02:30"
    expect(norm(row.readout)).toBe('3 h 40 min asleep');
    expect(norm(row.secondary)).toBe('in bed 23:00 – 03:07');
  });

  it('the Sleep tab: the night, and the second sleep listed as another sleep', () => {
    const d = sleepDay(days.find((x) => x.localDate === '2026-03-10')!);
    expect(d.night).toMatchObject({ asleepMin: 105 + 90 + 25, bed: at('09T23:00'), wake: at('10T03:07') });
    expect(d.others).toEqual([{ date: '2026-03-10', start: at('10T05:00'), end: at('10T06:41'), offsetS: 0, minutes: 50 + 40, kind: 'another' }]);
  });
});
