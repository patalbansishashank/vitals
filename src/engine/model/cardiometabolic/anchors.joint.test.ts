// @vitest-environment node
/**
 * Phase 0C joint check of D7-02 through the real consumers: a confirmed marker document → `withMarkerLabs` (baselines and
 * their provenance) → the engine run (cardiometabolic anchors, read by the core loop) → snapshot resume. Accepted
 * measured values outside the calibration domain stay exact at t = 0, the series carry status `outOfDomain` (never a
 * clamped replacement, never a NaN sentinel), the anchors agree with the baselines' provenance, and a resumed run keeps
 * the same observation and status semantics.
 */
import { describe, expect, it } from 'vitest';
import { compileSchedule } from '@/engine/core/compileSchedule';
import { runEngine } from '@/engine/core/loop';
import { resolveProfile } from '@/engine/core/resolveProfile';
import { MAN, repeatSchedule } from '@/engine/core/__tests__/fixtures';
import type { LabBaselines } from '@/engine/types/profile';
import { withMarkerLabs } from '@/markers/baselines';
import { readingFromInput } from '@/markers/doc';
import type { MarkersDoc } from '@/markers/types';

const TODAY = '2026-10-02';
const DATE = '2026-09-14';
const AT = `${DATE}T09:00:00Z`;
const PATTERN = [0, 1, 0, 1, 0, 1, 1];

const doc: MarkersDoc = {
  _schema: 1,
  readings: [
    readingFromInput({ id: 'ldl', value: 310, unit: 'mg/dL', date: DATE, sampleId: 'd1' }, 'manual', AT),
    readingFromInput({ id: 'tg', value: 1200, unit: 'mg/dL', date: DATE, sampleId: 'd1' }, 'manual', AT),
    readingFromInput({ id: 'fpg', value: 300, unit: 'mg/dL', date: DATE, sampleId: 'd1' }, 'manual', AT),
    readingFromInput({ id: 'hba1c', value: 14, unit: '%', date: DATE, sampleId: 'd1' }, 'manual', AT),
    readingFromInput({ id: 'hdl', value: 50, unit: 'mg/dL', date: DATE, sampleId: 'd1' }, 'manual', AT),
  ],
  displayOnly: [],
  context: {},
  chapter: 'manual',
};

const SERIES: ReadonlyArray<readonly [string, keyof LabBaselines]> = [
  ['ldl', 'ldlMmolL'],
  ['triglycerides', 'tgMmolL'],
  ['fastingGlucose', 'fastingGlucoseMmolL'],
  ['hdl', 'hdlMmolL'],
];

describe('measured markers → baselines → engine anchors → resume (0C joint, D7-02)', () => {
  const profile = withMarkerLabs(MAN, doc, TODAY);
  const rp = resolveProfile(profile);
  const schedule = compileSchedule(repeatSchedule(14, PATTERN), rp);
  const opts = { record: 'daily' as const, series: ['ldl', 'triglycerides', 'fastingGlucose', 'hdl', 'apoB', 'fatMass'] as const };

  it('keeps the accepted values exactly at t = 0 and flags the projections the anchors and provenance call out of domain', () => {
    const r = runEngine(rp, schedule, { ...opts, series: [...opts.series] });
    const anchors = r.meta.observedAnchors ?? [];
    for (const [series, field] of SERIES) {
      const v = profile.labs![field]!;
      expect(r.initial[series as 'ldl'], series).toBe(v);
      const a = anchors.find((x) => x.series === series);
      expect(a?.value, series).toBe(v);
      const flagged = profile.labMeta?.[field]?.outOfDomain === true;
      expect(a?.outOfDomain, series).toBe(flagged);
      expect(r.meta.outputStatus?.[series as 'ldl']?.status === 'outOfDomain', series).toBe(flagged);
      expect(Array.from(r.daily[series as 'ldl']!).every(Number.isFinite), series).toBe(true);
    }
    expect(SERIES.filter(([, f]) => profile.labMeta?.[f]?.outOfDomain).map(([s]) => s)).toEqual(['ldl', 'triglycerides', 'fastingGlucose']);
    // the dependent ApoB projection is not an asserted response either; fat mass is untouched
    expect(r.meta.outputStatus?.apoB?.status).toBeDefined();
    expect(r.meta.outputStatus?.fatMass).toBeUndefined();
  });

  it('a resumed run (day-stamped snapshot) keeps the same anchors and statuses as the uninterrupted run', () => {
    const full = runEngine(rp, schedule, { ...opts, series: [...opts.series], captureSnapshotAt: [7] });
    const cont = runEngine(rp, schedule, { ...opts, series: [...opts.series], initialSnapshot: full.snapshots![7]! });
    expect(cont.meta.observedAnchors).toEqual(full.meta.observedAnchors);
    expect(cont.meta.outputStatus).toEqual(full.meta.outputStatus);
    expect(cont.initial.ldl).toBe(profile.labs!.ldlMmolL);
  });
});
