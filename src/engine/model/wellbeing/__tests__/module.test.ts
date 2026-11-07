// @vitest-environment node
/**
 * 2026-10-18 review acceptance of the wellbeing module (D8-01, D8-04, D8-05, D8-09): recording-mask dependency closure
 * through the full engine, raw EA exposure versus the bounded internal drive, the BMD research scenario, task-scoped
 * endurance and the combination of model concern flags with observed wellbeing.
 */
import { describe, expect, it } from 'vitest';
import {
  BMD_RESEARCH_SCOPE,
  CONCERN_FLAG,
  EA_POLICY_REFERENCES,
  EA_STATUS,
  ENDURANCE_INDEX_SCOPE,
  combineWellbeingConcern,
  eaStatusToOutput,
  enduranceTaskSupport,
  rawEnergyAvailability,
  wellbeingModule,
  wellbeingOutputStatus,
  wellbeingParams,
  type WellbeingState,
} from '../index';
import { runEngine } from '../../../core/loop';
import { compileSchedule } from '../../../core/compileSchedule';
import { resolveProfile } from '../../../core/resolveProfile';
import { MODULE_ORDER } from '../../../core/moduleRegistry';
import { mulberry32 } from '../../../core/math';
import { GOAL_CAPABILITY, isProductionGoalEligible, type SeriesId } from '../../../types/metrics';
import type { PersonProfile } from '../../../types/profile';
import type { Schedule } from '../../../types/schedule';
import type { SafetyTrace, SimulationResult } from '../../../types/result';
import { MAN, WOMAN, makeHarness, MI } from './harness';

// ------------------------------------------------------------------------------------------------------------ D8-01

const POST: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'female', ageYears: 60, heightCm: 163, weightKg: 70 },
  menopause: 'post',
  startDate: '2026-10-05',
};

/** 180 days at 60 % of maintenance: the pattern calcium estimate falls well below the old 1 000 mg mCa threshold. */
function hypocaloric(days: number): Schedule {
  return {
    schemaVersion: 1,
    startDate: '2026-10-05',
    horizonDays: days,
    programs: [
      {
        id: 'cut',
        label: 'cut',
        energy: { kind: 'pctMaintenance', pct: 60 },
        macros: { protein: { unit: 'gPerKgBw', value: 1.2 }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } },
        exercise: [{ kind: 'resistance', startH: 17, volume: 'moderate' }],
      },
      { id: 'rest', label: 'rest', energy: { kind: 'pctMaintenance', pct: 60 }, macros: { protein: { unit: 'gPerKgBw', value: 1.2 }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } } },
    ],
    days: Array.from({ length: days }, (_, d) => ({ program: d % 3 === 0 ? 0 : 1 })),
  };
}

const profile = resolveProfile(POST);
const sched = compileSchedule(hypocaloric(180), profile);
const run = (series?: readonly SeriesId[], extra: Parameters<typeof runEngine>[2] = {}): SimulationResult =>
  runEngine(profile, sched, { record: 'daily', checks: true, ...(series ? { series } : {}), ...extra });

const traceEqual = (a: SafetyTrace, b: SafetyTrace): void => {
  for (const key of Object.keys(a) as (keyof SafetyTrace)[]) {
    const x = a[key];
    const y = b[key];
    if (x === undefined) continue;
    expect(y, `safety.${key}`).toBeDefined();
    expect(Array.from(y!), `safety.${key}`).toEqual(Array.from(x));
  }
};

/** Wellbeing state fields every consumer, snapshot or continuation needs (display-only layers excluded). */
const SHARED_STATE: (keyof WellbeingState)[] = [
  'eaS', 'ea7', 'eaC', 'eaRawDay', 'eaRawStatus', 'eaRawKnownDay', 'mEa', 'penBase', 'ketoInduction', 'phiMax', 'moodTier',
  'concernFlags', 'energyEma7', 'carbEma7', 'caKnownMeanMg', 'caCompleteDays', 'nutIdx', 'nutDays', 'eaRing', 'nutKnownRing', 'nutCovRing',
];
const wellbeingIdx = MODULE_ORDER.indexOf('wellbeing');

describe('D8-01 recording-mask dependency closure (full engine)', () => {
  const all = run();

  it('postmenopausal hypocaloric 180 d: hip BMD alone equals hip BMD + micronutrient score and the full run; safety identical', () => {
    const bone = run(['hipBmdChange']);
    const boneMicro = run(['hipBmdChange', 'micronutrientScore']);
    expect(Array.from(bone.daily.hipBmdChange!)).toEqual(Array.from(boneMicro.daily.hipBmdChange!));
    expect(Array.from(bone.daily.hipBmdChange!)).toEqual(Array.from(all.daily.hipBmdChange!));
    expect(all.daily.hipBmdChange![179]!).toBeLessThan(0); // the research scenario does move under sustained tissue loss
    traceEqual(all.safety, bone.safety);
    traceEqual(all.safety, boneMicro.safety);
  });

  it('singleton, pair and random output subsets keep every shared series and the safety trace identical', () => {
    const rnd = mulberry32(11);
    const pool: SeriesId[] = ['moodTier', 'energyAvailability', 'hipBmdChange', 'ketoInduction', 'micronutrientScore', 'enduranceCapacity', 'fatMass', 'scaleWeight', 'strength'];
    const masks: SeriesId[][] = [['fatMass'], ['energyAvailability'], ['fatMass', 'moodTier'], ['micronutrientScore', 'strength']];
    for (let i = 0; i < 3; i++) masks.push(pool.filter(() => rnd() < 0.5).concat(['fatMass']));
    for (const mask of masks) {
      const r = run(mask);
      for (const id of mask) expect(Array.from(r.daily[id]!), `${mask.join('+')} → ${id}`).toEqual(Array.from(all.daily[id]!));
      traceEqual(all.safety, r.safety);
    }
  });

  it('capture/continue under the same mask equals the uninterrupted run; captures under different masks share the physical state; a cross-mask restore is still rejected', () => {
    const mask: SeriesId[] = ['hipBmdChange', 'fatMass'];
    const a = run(mask, { captureSnapshotAt: [60] });
    const cont = run(mask, { initialSnapshot: a.snapshots![60]! });
    for (const id of mask) expect(Array.from(cont.daily[id]!.subarray(60))).toEqual(Array.from(a.daily[id]!.subarray(60)));
    traceEqual(a.safety, cont.safety);
    const full = run(undefined, { captureSnapshotAt: [60] });
    const sa = a.snapshots![60]!;
    const sf = full.snapshots![60]!;
    expect(Array.from(sa.bus)).toEqual(Array.from(sf.bus)); // every signal physics and safety read
    const wa = sa.states[wellbeingIdx] as WellbeingState;
    const wf = sf.states[wellbeingIdx] as WellbeingState;
    for (const f of SHARED_STATE) expect(wa[f], `wellbeing.${String(f)}`).toEqual(wf[f]);
    expect(() => run(['fatMass'], { initialSnapshot: sa })).toThrow(/does not match/);
  });
});

// ------------------------------------------------------------------------------------------------------------ D8-04

describe('D8-04 raw EA exposure versus the bounded internal drive', () => {
  it('raw EA keeps severe deficits and very high values unclipped (kcal/kg FFM/d); the internal drive stays in [−5, 70]', () => {
    const h = makeHarness(MAN);
    const ffm = h.bus.ffmActKg;
    h.run({ ei: 0, carb: 0, fat: 0, fibre: 0, fast: true, eee: 900, exMin: 90 }, 1);
    expect(h.s.eaRawDay).toBeCloseTo(-900 / ffm, 9);
    expect(h.s.eaRawDay).toBeLessThan(-5);
    expect(h.s.eaRing[h.s.eaIdx]).toBe(-5);
    expect(h.record()[MI.energyAvailability]).toBeCloseTo(-900 / ffm, 4);
    const g = makeHarness(MAN);
    g.run({ ei: 7000 }, 1);
    expect(g.s.eaRawDay).toBeCloseTo(7000 / ffm, 9);
    expect(g.s.eaRing[g.s.eaIdx]).toBe(70);
    expect(rawEnergyAvailability(0, 900, ffm)).toBeCloseTo(-900 / ffm, 12);
  });

  it('unlogged intake never becomes an observed zero; confirmed zero with covered exercise is an estimate', () => {
    const h = makeHarness(WOMAN);
    h.day.coverage = { energy: 'unknown', exercise: 'complete' };
    h.run({ ei: 0, carb: 0, fat: 0, fibre: 0 }, 1);
    expect(h.s.eaRawStatus).toBe(EA_STATUS.unknown);
    expect(eaStatusToOutput(h.s.eaRawStatus)).toBe('unknown');
    expect(h.s.concernFlags & CONCERN_FLAG.exposureIncomplete).not.toBe(0);
    h.day.coverage = { energy: 'confirmedZero', exercise: 'confirmedZero' };
    h.run({ ei: 0, carb: 0, fat: 0, fibre: 0 }, 1);
    expect(h.s.eaRawStatus).toBe(EA_STATUS.logged);
    expect(eaStatusToOutput(h.s.eaRawStatus)).toBe('estimated'); // EEE and FFM_act are model quantities: never "observed"
    delete h.day.coverage;
    h.run({}, 1);
    expect(eaStatusToOutput(h.s.eaRawStatus)).toBe('scenario'); // a prescribed day is planned exposure
  });

  it('missing exercise coverage or partly logged intake gives incomplete exposure; the known intake is a lower bound', () => {
    const h = makeHarness(WOMAN);
    const ffm = h.bus.ffmActKg;
    h.day.coverage = { energy: 'complete', exercise: 'unknown' };
    h.run({}, 1);
    expect(h.s.eaRawStatus).toBe(EA_STATUS.partial);
    expect(h.s.eaRawKnownIsLowerBound).toBe(0); // missing exercise could lower EA: no bound is claimed
    h.day.coverage = { energy: 'partial', exercise: 'complete' };
    h.day.exposure = { energy: { knownSum: 800, unit: 'kcal', coverage: 'partial' } };
    h.run({ ei: 2000, eee: 100, exMin: 30 }, 1);
    expect(h.s.eaRawStatus).toBe(EA_STATUS.partial);
    expect(h.s.eaRawKnownIsLowerBound).toBe(1);
    expect(h.s.eaRawKnownDay).toBeCloseTo((800 - 100) / ffm, 9);
    expect(h.s.eaRawDay).toBeCloseTo((2000 - 100) / ffm, 9); // the scenario value the physiology uses
    expect(eaStatusToOutput(h.s.eaRawStatus)).toBe('partial');
  });

  it('an invalid FFM denominator is unavailable, never 1 kg; the internal drive holds its last sample and stays finite', () => {
    const h = makeHarness(MAN);
    const before = h.s.eaRing[h.s.eaIdx]!;
    h.bus.ffmActKg = 0;
    h.run({}, 1);
    expect(h.s.eaRawStatus).toBe(EA_STATUS.unavailable);
    expect(eaStatusToOutput(h.s.eaRawStatus)).toBe('unavailable');
    expect(h.s.eaRing[h.s.eaIdx]).toBe(before);
    expect(Number.isFinite(h.s.eaRawDay)).toBe(true);
    expect(rawEnergyAvailability(2000, 0, 0)).toBeNull();
    expect(rawEnergyAvailability(2000, 0, Number.NaN)).toBeNull();
    expect(wellbeingOutputStatus(h.s).energyAvailability!.status).toBe('unavailable');
  });

  it('net session EEE is the same day\'s session cost above rest; EPOC, steps and exercise EE are not subtracted again', () => {
    const a = makeHarness(MAN);
    const b = makeHarness(MAN);
    b.bus.exEEKcalH = 500; // incl. EPOC / post-RT REE
    b.bus.stepsExtraKcalH = 300;
    a.run({ eee: 250, exMin: 45 }, 1);
    b.run({ eee: 250, exMin: 45 }, 1);
    expect(b.s.eaRawDay).toBe(a.s.eaRawDay);
    expect(a.s.eaEeeKcal).toBe(250); // the day's own exSessionNetKcalD (same endOfDay pass)
    expect(a.s.eaRawDay).toBeCloseTo((a.base.ei - 250) / a.bus.ffmActKg, 9);
  });

  it('EI includes carbohydrate eaten during exercise and signed reconciliation corrections (no kcal lost or invented)', () => {
    const h = makeHarness(MAN);
    const base = h.base.ei;
    const { hour, clock } = h;
    clock.day = 0;
    for (let hr = 0; hr < 24; hr++) {
      hour.kcal = hr === 8 ? base : hr === 20 ? -200 : 0; // a reconciliation correction may be negative (D6-02)
      hour.carbG = 0;
      hour.fatG = 0;
      hour.fibreG = 0;
      hour.exCarbG = hr === 17 ? 30 : 0; // not part of the meal fields (M8)
      hour.exMin = 0;
      h.bus.fastActive = 0;
      clock.hourOfDay = hr;
      wellbeingModule.stepHour(h.s, h.k, h.bus, hour, h.day, clock);
    }
    expect(h.s.eiDayKcal).toBeCloseTo(base - 200 + 4 * 30, 9);
    hour.exCarbG = 0;
  });

  it('a habitually impaired baseline is flagged separately from the relative multiplier 1 (1 = habitual, not adequate)', () => {
    const lean = makeHarness(MAN, { noBurnIn: true });
    lean.base.ei = 20 * lean.bus.ffmActKg; // habitual EA ≈ 20
    lean.burnIn();
    expect(lean.s.eaHab).toBeLessThan(30);
    expect(lean.s.eaHabBelowPolicy).toBe(1);
    expect(lean.s.mEa).toBe(1);
    lean.run({}, 1);
    expect(lean.s.concernFlags & CONCERN_FLAG.impairedBaseline).not.toBe(0);
    const normal = makeHarness(MAN);
    expect(normal.s.eaHabBelowPolicy).toBe(0);
  });

  it('the no-penalty structural alternative removes the strength penalty but not the concern: no assured no-risk', () => {
    const noPen = makeHarness(MAN, { overrides: { 'wellbeing.strengthPenaltyStructure': 0 } });
    const legacy = makeHarness(MAN);
    for (const h of [noPen, legacy]) h.run({ ei: 12 * h.bus.ffmActKg }, 60);
    expect(noPen.s.mEa).toBe(1);
    expect(legacy.s.mEa).toBeLessThan(1);
    expect(noPen.s.concernFlags & CONCERN_FLAG.eaBelowT2).not.toBe(0);
    expect(combineWellbeingConcern({ modelTier: noPen.s.moodTier, modelFlags: noPen.s.concernFlags }).status).toBe('review');
  });

  it('observed symptoms create a concern while EA stays above 30; a reassuring model tier cannot erase it', () => {
    const h = makeHarness(WOMAN);
    h.run({}, 14);
    expect(h.s.eaC).toBeGreaterThan(30);
    expect(h.s.moodTier).toBe(0);
    const r = combineWellbeingConcern({
      modelTier: h.s.moodTier,
      modelFlags: h.s.concernFlags,
      observed: [
        { date: '2026-10-10', concerns: ['persistentFatigue'] },
        { date: '2026-10-12', concerns: ['persistentFatigue', 'menstrualChange'] },
      ],
    });
    expect(r.status).toBe('review');
    expect(r.persistentConcerns).toEqual(['persistentFatigue']);
    expect(r.observedConcerns).toEqual(['menstrualChange', 'persistentFatigue']);
  });

  it('any model concern flag gives Review even below the legacy amber points; incomplete exposure alone is a coverage note', () => {
    expect(combineWellbeingConcern({ modelTier: 0, modelFlags: CONCERN_FLAG.sleepDebt })).toMatchObject({ status: 'review', reasons: ['modelConcernFlag'] });
    expect(combineWellbeingConcern({ modelTier: 0, modelFlags: CONCERN_FLAG.exposureIncomplete })).toMatchObject({ status: 'noFlaggedConcern', modelFlags: ['exposureIncomplete'] });
    expect(combineWellbeingConcern({ modelTier: 2, modelFlags: CONCERN_FLAG.eaBelowT2 | CONCERN_FLAG.eaBelowT1 }).reasons).toEqual(['modelConcernTier']);
  });

  it('policy references carry no diagnostic or probability label; unlogged wellbeing is not measured', () => {
    expect(EA_POLICY_REFERENCES.diagnostic).toBe(false);
    expect(EA_POLICY_REFERENCES.kind).toBe('policyReference');
    const quiet = combineWellbeingConcern({ modelTier: 0, modelFlags: 0 });
    expect(quiet).toMatchObject({ status: 'noFlaggedConcern', observed: 'notLogged' });
    expect(JSON.stringify(quiet)).not.toMatch(/probab|healthy|safe|REDs/i);
    expect(JSON.stringify(wellbeingOutputStatus({ eaRawStatus: EA_STATUS.logged }))).not.toMatch(/probab/i);
  });
});

// ------------------------------------------------------------------------------------------------------------ D8-05

describe('D8-05 BMD research scenario: no personal forecast, persistent tissue loss only', () => {
  it('isolated reversible water/glycogen loss cannot predict persistent BMD loss', () => {
    const h = makeHarness(WOMAN);
    const w0 = h.bus.labileWaterKg;
    for (let d = 0; d < 150; d++) {
      h.bus.labileWaterKg = w0 - 2.5; // scale −2.5 kg, tissue unchanged
      h.run({}, 1);
    }
    expect(h.s.wlPct).toBe(0);
    expect(h.s.bmdHipPct).toBe(0);
  });

  it('one trivial set twice weekly earns no protection credit (no any-set protection)', () => {
    const lose = (rt: boolean): number => {
      const h = makeHarness(POST);
      const fm0 = h.bus.fatMassKg;
      for (let d = 0; d < 240; d++) {
        h.bus.fatMassKg = fm0 - 7 * Math.min(1, (d + 1) / 200);
        h.run(rt && d % 7 < 2 ? { rtSets: 1, exMin: 5 } : {}, 1);
      }
      return h.s.bmdHipPct;
    };
    expect(lose(true)).toBe(lose(false));
  });

  it('no automatic BMD recovery on weight regain (no validated recovery law)', () => {
    const h = makeHarness(WOMAN);
    const fm0 = h.bus.fatMassKg;
    for (let d = 0; d < 300; d++) {
      h.bus.fatMassKg = fm0 - 6 * Math.min(1, (d + 1) / 150);
      h.run({}, 1);
    }
    const before = h.s.bmdHipPct;
    expect(before).toBeLessThan(-1);
    let prev = before;
    for (let d = 0; d < 300; d++) {
      h.bus.fatMassKg = fm0 - 6 * Math.max(0, 1 - (d + 1) / 150);
      h.run({}, 1);
      expect(h.s.bmdHipPct).toBeLessThanOrEqual(prev); // never moves back toward 0 (a lagging approach may still deepen)
      prev = h.s.bmdHipPct;
    }
    expect(h.s.wlPct).toBe(0); // fully regained
    expect(h.s.bmdHipPct).toBeLessThanOrEqual(before);
  });

  it('the calcium multiplier is disabled: pattern calcium below or above 1 000 mg gives the same scenario', () => {
    const bmd = (quality: number): number => {
      const h = makeHarness(POST);
      const fm0 = h.bus.fatMassKg;
      for (let d = 0; d < 200; d++) {
        h.bus.fatMassKg = fm0 - 5 * Math.min(1, (d + 1) / 150);
        h.run({ quality, ei: quality === 3 ? 2600 : 1200 }, 1);
      }
      return h.s.bmdHipPct;
    };
    expect(bmd(3)).toBeCloseTo(bmd(1), 12);
  });

  it('no default personal BMD percentage or zero-change assurance is exported; measured DXA is the observable', () => {
    expect(GOAL_CAPABILITY.hipBmdChange.availability).toBe('observedOnly');
    expect(isProductionGoalEligible('hipBmdChange')).toBe(false);
    expect(wellbeingOutputStatus({ eaRawStatus: EA_STATUS.planned }).hipBmdChange).toMatchObject({ status: 'exploratory', reasonCode: 'researchScenarioNoPersonalForecast' });
    expect(BMD_RESEARCH_SCOPE.personalForecast).toBe(false);
    expect(BMD_RESEARCH_SCOPE.observation).toMatch(/g\/cm²/);
    // independent site/population holdouts gate any research prediction; the V5/V6 trials are development studies
    expect(BMD_RESEARCH_SCOPE.predictionsEnabled).toBe(false);
    expect(BMD_RESEARCH_SCOPE.validation).toMatch(/holdouts required/);
    expect(wellbeingOutputStatus({ eaRawStatus: EA_STATUS.planned }).hipBmdChange!.uncertaintyKind).toBe('scenario'); // no calibrated band
  });
});

// ------------------------------------------------------------------------------------------------------------ D8-09

describe('D8-09 task-scoped endurance and observed wellbeing', () => {
  it('the generic endurance index is not a selectable objective', () => {
    expect(GOAL_CAPABILITY.enduranceCapacity.availability).toBe('unavailable');
    expect(isProductionGoalEligible('enduranceCapacity')).toBe(false);
    expect(wellbeingOutputStatus({ eaRawStatus: EA_STATUS.planned }).enduranceCapacity!.status).toBe('exploratory');
  });

  it('low-intensity, short repeated or race tasks do not inherit the 75 % VO2max glycogen index (unavailable, not a zero penalty)', () => {
    expect(enduranceTaskSupport({ outcome: 'timeToExhaustion', intensityFracVo2max: 0.75, modality: 'cycle' }).status).toBe('exploratory');
    expect(enduranceTaskSupport({ outcome: 'timeToExhaustion', intensityFracVo2max: 0.5, modality: 'cycle' })).toEqual({ status: 'unavailable', reasonCode: 'outsideStudiedIntensity' });
    expect(enduranceTaskSupport({ outcome: 'repeatedSprint', intensityFracVo2max: 1.2 }).status).toBe('unavailable');
    expect(enduranceTaskSupport({ outcome: 'timeToExhaustion', modality: 'cycle' }).reasonCode).toBe('intensityUnknown');
    expect(enduranceTaskSupport({ outcome: 'timeToExhaustion', intensityFracVo2max: 0.75, modality: 'run' }).status).toBe('unavailable');
  });

  it('TTE percentages never become race-time percentages', () => {
    expect(ENDURANCE_INDEX_SCOPE.raceTimeConvertible).toBe(false);
    expect(ENDURANCE_INDEX_SCOPE.outcome).toBe('timeToExhaustionRelativeToOwnBaseline');
    expect(enduranceTaskSupport({ outcome: 'raceTime', intensityFracVo2max: 0.75, modality: 'cycle' })).toEqual({ status: 'unavailable', reasonCode: 'outcomeNotTimeToExhaustion' });
    expect(enduranceTaskSupport({ outcome: 'timeTrial', intensityFracVo2max: 0.8, modality: 'cycle' }).status).toBe('unavailable');
  });

  it('sufficient whole-muscle glycogen asserts no zero effect: the index keeps rising with stores, unsupported tasks stay unavailable', () => {
    const h = makeHarness(MAN);
    h.bus.muscleGlycogenG = 30 * 17.3 * 1.4;
    h.run({}, 1);
    expect(h.s.enduranceIdx).toBeGreaterThan(100); // no saturation / "no limitation" claim from the daily mean
    expect('value' in enduranceTaskSupport({ outcome: 'repeatedSprint' })).toBe(false);
  });

  it('untouched Caldwell-type LEA challenge (n = 12 trained women, 14 d, 20-min time trial −7.8 % without a glycogen change): reported, never fitted', () => {
    // the study is not a development source of any wellbeing parameter (it stays an untouched external check)
    expect(wellbeingParams.some((p) => /caldwell/i.test(`${p.source} ${p.note ?? ''}`))).toBe(false);
    // its endpoint is a time trial: the task-scoped TTE index makes no claim (unavailable, not a 0 % or −7.8 % penalty)
    expect(enduranceTaskSupport({ outcome: 'timeTrial', modality: 'cycle', intensityFracVo2max: 0.85 }).status).toBe('unavailable');
    // 14 d at EA ≈ 22 kcal/kg FFM/d with muscle glycogen unchanged (the trial's finding)
    const lea = makeHarness(WOMAN);
    const ctl = makeHarness(WOMAN);
    const ffm = lea.bus.ffmActKg;
    lea.run({ ei: 22 * ffm + 400, eee: 400, exMin: 60 }, 14);
    ctl.run({ ei: 45 * ffm + 400, eee: 400, exMin: 60 }, 14);
    // reported model response: the glycogen-driven index does not move (no universal LEA→performance coefficient exists
    // in the model), so the observed −7.8 % is a documented miss of this structure, not a gap to tune away
    expect(lea.s.enduranceIdx).toBeCloseTo(ctl.s.enduranceIdx, 9);
    // the exposure itself is still visible: the raw EA is reported and the 14-d drive raises a concern flag
    expect(lea.s.eaRawDay).toBeCloseTo(22, 6);
    expect(lea.s.concernFlags & CONCERN_FLAG.eaBelowT1).not.toBe(0);
    expect(combineWellbeingConcern({ modelTier: lea.s.moodTier, modelFlags: lea.s.concernFlags }).status).toBe('review');
    expect(ctl.s.concernFlags & CONCERN_FLAG.eaBelowT1).toBe(0);
  });

  it('repeated adverse observed ratings give a concern with a green model; a single unlogged day is not measured', () => {
    const r = combineWellbeingConcern({
      modelTier: 0,
      modelFlags: 0,
      observed: [
        { date: '2026-10-08', ratings: [{ scale: 'fatigue', value: 8, adverse: true }] },
        { date: '2026-10-09', ratings: [{ scale: 'fatigue', value: 3 }] },
        { date: '2026-10-11', ratings: [{ scale: 'fatigue', value: 9, adverse: true }, { scale: 'mood', value: 2, adverse: true }] },
      ],
    });
    expect(r.status).toBe('review');
    expect(r.repeatedAdverseRatings).toEqual(['fatigue']);
    const once = combineWellbeingConcern({ modelTier: 0, observed: [{ date: '2026-10-08', ratings: [{ scale: 'mood', value: 2, adverse: true }] }] });
    expect(once.status).toBe('noFlaggedConcern');
    expect(once.observed).toBe('logged');
  });
});
