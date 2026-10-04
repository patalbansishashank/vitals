import { describe, expect, it } from 'vitest';
import { getScoreDef, latestVersions, SCORE_CATALOGUE, scoreOrder } from '../catalogue';

const NEEDS_MECHANISM = (t: string) => t !== 'display_only' && t !== 'trainer_briefing';

describe('SCORE_CATALOGUE', () => {
  it('is non-empty and contains the R9 v1 entries owned here', () => {
    const ids = new Set(SCORE_CATALOGUE.map((d) => d.scoreId));
    for (const id of ['load.trimp', 'load.srpe', 'load.ewma', 'fitness.vo2max']) expect(ids.has(id)).toBe(true);
  });
  it('fn = id@version and id@version is unique', () => {
    const keys = SCORE_CATALOGUE.map((d) => `${d.scoreId}@${d.version}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of SCORE_CATALOGUE) expect(d.formula.fn).toBe(`${d.scoreId}@${d.version}`);
  });
  it('plan effects other than display/briefing need a mechanism (SUITE_SPEC §4.4)', () => {
    for (const d of SCORE_CATALOGUE) {
      if (d.planEffects.some((p) => NEEDS_MECHANISM(p.target))) expect(d.evidence.mechanism.status, d.scoreId).not.toBe('infoOnly');
    }
  });
  it('vendor streams are never inputs or opt-in streams', () => {
    for (const d of SCORE_CATALOGUE) {
      for (const i of d.inputs) expect(String(i.stream), d.scoreId).not.toMatch(/^vendor/);
      for (const s of d.optInStreams) expect(String(s), d.scoreId).not.toMatch(/^vendor/);
    }
  });
  it('label and kind are consistent', () => {
    // 'index' may be a measured regularity index (sleep.sri) or a composite convenience index.
    const map: Record<string, string[]> = { derived_measurement: ['measurement', 'estimate'], estimate: ['estimate', 'measurement'], index: ['measurement', 'convenience_index'], flag: ['flag'] };
    for (const d of SCORE_CATALOGUE) expect(map[d.kind], d.scoreId).toContain(d.label);
    for (const d of SCORE_CATALOGUE.filter((x) => x.label === 'convenience_index')) expect(d.kind, d.scoreId).toBe('index');
  });
  it('composite indices never drive the plan directly', () => {
    for (const d of SCORE_CATALOGUE.filter((x) => x.label === 'convenience_index')) {
      expect(d.planEffects.every((p) => p.target === 'display_only' || p.target === 'trainer_briefing'), d.scoreId).toBe(true);
    }
  });
  it('every def has sourced params, a semver version, a release date and a compute function', () => {
    for (const d of SCORE_CATALOGUE) {
      expect(d.version, d.scoreId).toMatch(/^\d+\.\d+\.\d+$/);
      expect(d.released, d.scoreId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof d.compute).toBe('function');
      for (const p of d.params) expect(p.sourceRef.length, `${d.scoreId}.${p.name}`).toBeGreaterThan(0);
    }
  });
  it('dependsOn refers to catalogue ids and the order is topological', () => {
    const ids = new Set(SCORE_CATALOGUE.map((d) => d.scoreId));
    for (const d of SCORE_CATALOGUE) for (const dep of d.dependsOn ?? []) expect(ids.has(dep), `${d.scoreId} → ${dep}`).toBe(true);
    const seen = new Set<string>();
    for (const d of scoreOrder()) {
      for (const dep of d.dependsOn ?? []) expect(seen.has(dep), `${d.scoreId} after ${dep}`).toBe(true);
      seen.add(d.scoreId);
    }
  });
  it('lookups', () => {
    expect(getScoreDef('load.trimp')!.scoreId).toBe('load.trimp');
    expect(getScoreDef('load.trimp', '9.9.9')).toBeUndefined();
    expect(latestVersions().length).toBe(new Set(SCORE_CATALOGUE.map((d) => d.scoreId)).size);
  });
  it('the ACWR has no plan effect and EWMA volume cap is marked PROPOSED', () => {
    const e = getScoreDef('load.ewma')!;
    expect(e.planEffects.find((p) => p.target === 'training_volume')!.rule).toMatch(/PROPOSED/);
  });
});
