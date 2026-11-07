/**
 * r071: the night the server sends as one session when the ring recorded it in two parts (2026-10-30: 22:11 to 06:30, up
 * from 02:04 to 03:13). The Sleep card and the hypnogram show the whole night: both parts and the break, the asleep time the
 * sum of the parts, the break counted as time awake (the figures are the server's; this checks how they are shown).
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { hypnoRuns } from '@/components';
import { nightView } from '@/features/living/sleep/model';
import { Hypnogram, sessionStageSpans } from '../components/RingCharts';
import { mainSession } from '../model';
import type { GaugeSleepMetrics, GaugeSleepSession } from '../types';

const T0 = Date.parse('2026-10-29T16:41:00Z'); // 22:11 in Kolkata
const STAGE: Record<string, string> = { W: 'awake', L: 'light', D: 'deep', R: 'rem', '.': 'no_data' };
const iso = (m: number) => {
  const local = new Date(T0 + m * 60_000 + 330 * 60_000).toISOString().slice(0, 19);
  return `${local}+05:30`;
};

/** The night's blocks as `gauge_sleep` sends them: part one to 02:04, 69 min no data, part two from 03:13 to 06:30. */
const RUNS =
  'W16 L34 D8 L1 D9 L1 D11 L2 R1 L1 R1 L1 R1 L1 R11 L4 R5 L1 R1 L1 R2 L14 D1 L1 D20 L16 R13 L1 R4 L1 R12 L1 .10 W1 L14 W1 L10 ' +
  '.69 ' +
  'W1 L22 D23 L11 R6 L1 R3 L1 R5 L1 R2 L1 R6 L1 R3 L2 .6 W1 L18 D20 L2 D5 L30 R11 L1 R4 L1 R5 L1 R1 W1 L1';
const blocks: GaugeSleepSession['blocks'] = (() => {
  const out: GaugeSleepSession['blocks'] = [];
  let m = 0;
  for (const r of RUNS.split(' ')) {
    const n = Number(r.slice(1));
    out.push({ start: iso(m), end: iso(m + n), stage: STAGE[r[0]!]!, minutes: n });
    m += n;
  }
  return out;
})();

const metrics = {
  version: 'sleep-metrics/1', K: 393, A: 21, U: 0, G: 85, tstLowerMin: 393, tstUpperMin: 393, incomplete: false, namedCoveragePct: 96.7, windowContinuityPct: 84.2,
  wasoMin: 74, wakeUps: 1, awakeningRuns: 5, leadingWakeMin: 16, onset: '2026-10-29T22:27:00+05:30', finalWake: '2026-10-30T06:30:00+05:30',
  stageMinutes: { deep: 97, light: 199, rem: 97, asleepUnspecified: 0, awake: 74, unknown: 0, gap: 16 }, trace5min: [],
} as unknown as GaugeSleepMetrics;

const night = {
  wakingDate: '2026-10-30', start: iso(0), end: iso(499), inBedMinutes: 499, recordedWindowMinutes: 499, asleepMinutes: 393, minutes: { deep: 97, light: 199, rem: 97, awake: 21, unknown: 0 },
  noDataMinutes: 85, efficiencyPercent: 82, kind: 'primary', blocks, metrics, awakeBreaks: [{ start: iso(233), end: iso(302), minutes: 69 }],
} as unknown as GaugeSleepSession;

describe('r071: a night in two parts on the Sleep card', () => {
  it('the day\'s main session is the whole night, 6 h 33 asleep, complete, with the break counted as time awake', () => {
    expect(mainSession([night], '2026-10-30')).toBe(night);
    const v = nightView({ session: night, baselines: null, plan: null });
    expect(v.windowStart).toBe(Date.parse(iso(0)));
    expect(v.windowEnd).toBe(Date.parse(iso(499)));
    expect(v.tstText).toBe('6 h 33');
    expect(v.incomplete).toBe(false);
    // the stage rows come from the metrics: the 74 min awake after sleep onset (the break and the ring's own) are the Awake row
    const awake = v.stages.find((r) => r.id === 'awake')!;
    expect(awake.valueText).toBe('1 h 14');
    expect(v.stages.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1, 5);
  });

  it('the hypnogram draws both parts and the break as one gap between them (the short holes are bridged)', () => {
    const segments = sessionStageSpans(night.blocks);
    const runs = hypnoRuns({ from: Date.parse(night.start), to: Date.parse(night.end), segments }, 320);
    const gaps = runs.filter((s) => s.state === null);
    expect(gaps).toHaveLength(1);
    expect([gaps[0]!.from, gaps[0]!.to]).toEqual([Date.parse(iso(233)), Date.parse(iso(302))]);
    // stages are drawn on both sides of it, from the first minute to the last
    expect(runs[0]!.from).toBe(Date.parse(night.start));
    expect(runs.at(-1)!.to).toBe(Date.parse(night.end));
    expect(runs.filter((s) => s.state !== null && s.to <= gaps[0]!.from).length).toBeGreaterThan(5);
    expect(runs.filter((s) => s.state !== null && s.from >= gaps[0]!.to).length).toBeGreaterThan(5);
    const { container } = render(<Hypnogram session={night} />);
    expect(container.querySelectorAll('[data-mark="gap"]')).toHaveLength(1);
    expect(screen.getAllByText('No stage').length).toBeGreaterThan(0);
  });

  it('the spoken night reads the raw spans: the 85 min the ring named no stage for, the break among them', () => {
    const { container } = render(<Hypnogram session={night} />);
    const label = container.querySelector('[role="img"]')!.getAttribute('aria-label')!;
    expect(label).toMatch(/no stage 1 h 25/);
  });
});
