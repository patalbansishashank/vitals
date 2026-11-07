// @vitest-environment node
/**
 * Outcome-scoped claims of the library, checked against the engine code that is actually there (C6; D2-07, D3-04, D6-07,
 * D7-07, D7-08, D8-04, D8-05, D8-07, D8-09). The library is a consumer of these modules: each article restates what the
 * engine does, so these tests read the provider (output contracts, scope declarations, parameters, pure helpers) and fail
 * when an article drifts from it:
 *  - endocrine outputs are exploratory directions relative to the person's baseline, never predicted lab values or goals;
 *    the reproductive status is a concern status, never a per-cycle probability;
 *  - protein timing carries no penalty in the standard projection, and MPS is a simulated response index, never measured
 *    synthesis or grams of muscle;
 *  - the hourly carbohydrate curve is a gut-appearance approximation with design limits, not verified absorption maxima;
 *  - the lean-responder LDL term and the sustained ketosis liver-fat term are off by default without claiming zero
 *    response; ApoB change is an exploratory proxy; triglyceride lowering is not an event benefit;
 *  - raw energy availability is unclipped and its tiers are policy references; bone density has no personal forecast; the
 *    endurance index is task-scoped; wellbeing is observed concerns plus transparent flags; sodium does not mitigate
 *    induction symptoms by default;
 *  - cycle phase is a calendar estimate; menopause drift is inactive; stress is not modelled.
 * Article ids are links (saved Explain links, shared links): the last block keeps every edited id.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  conditionalFreeTestosterone,
  endocrineLabPrediction,
  HORMONES_OUTPUT_CONTRACT,
  reproductiveConcernStatus,
} from '@/engine/model/hormones';
import { carbShortfall, deficitPhi, t3fTarget } from '@/engine/model/hormones/equations';
import { INTAKE_KINETICS_SCOPE } from '@/engine/model/intake';
import { lutealStartDay } from '@/engine/model/moderators/equations';
import { combineWellbeingConcern, EA_POLICY_REFERENCES } from '@/engine/model/wellbeing/concerns';
import {
  BMD_RESEARCH_SCOPE,
  EA_EXPOSURE_DEFINITION,
  ENDURANCE_INDEX_SCOPE,
  enduranceTaskSupport,
  rawEnergyAvailability,
} from '@/engine/model/wellbeing/outputs';
import { GOAL_CAPABILITY, isProductionGoalEligible, type MetricId } from '@/engine/types/metrics';
import type { ParamDef } from '@/engine/types/params';
import { capabilityAllowsOptimization } from '@/lib/bodyContracts';
import { EVIDENCE_TOPICS } from '../index';
import { PARAM_INDEX } from '../params';
import type { EvidenceTopic, Mechanism } from '../schema';
import { hasWarrantContent } from '../warrants';

let topics: EvidenceTopic[] = [];
const byId = new Map<string, Mechanism>();

beforeAll(async () => {
  topics = await Promise.all(EVIDENCE_TOPICS.map(async (e) => (await e.load()).default));
  for (const t of topics) for (const m of t.mechanisms) byId.set(m.id, m);
}, 120_000);

const art = (id: string): Mechanism => {
  const m = byId.get(id);
  if (!m) throw new Error(`article ${id} missing`);
  return m;
};
const param = (id: string): ParamDef => {
  const p = PARAM_INDEX.get(id);
  if (!p) throw new Error(`parameter ${id} missing`);
  return p;
};
/** All prose of an article that the info sheet and the library page print. */
const text = (m: Mechanism): string =>
  [
    m.title,
    m.summary,
    m.howModelled,
    m.equation ?? '',
    m.timeCourse ?? '',
    m.caveats ?? '',
    m.gradeReason,
    ...m.keyNumbers.flatMap((k) => [k.label, k.value, k.note ?? '']),
  ].join('\n');
/** Display form of a signed number in the library (unicode minus). */
const signed = (x: number): string => (x < 0 ? `−${Math.abs(x)}` : String(x));
const notOptimisable = (id: MetricId): boolean => !capabilityAllowsOptimization(GOAL_CAPABILITY[id]);

/* --------------------------------------------------------------------------------------------- hormones (D2-07) */

/** The article that documents each relative endocrine output of the hormones module. */
const ENDOCRINE_ARTICLE: Readonly<Record<keyof typeof HORMONES_OUTPUT_CONTRACT.relativeOutputs, string>> = {
  leptin: '12-leptin-fat-and-energy-status',
  t3: '12-thyroid-t3',
  cortisol: '12-cortisol',
  testosterone: '12-testosterone-shbg',
  igf1: '08-igf1-relative-level',
};

describe('endocrine outputs: exploratory directions, never predicted lab values or goals', () => {
  it('agrees with the hormones output contract for every relative output', () => {
    for (const [metric, out] of Object.entries(HORMONES_OUTPUT_CONTRACT.relativeOutputs)) {
      const m = art(ENDOCRINE_ARTICLE[metric as keyof typeof ENDOCRINE_ARTICLE]);
      expect(out.status, metric).toBe('exploratory');
      expect(out.labPrediction, metric).toBe(false);
      expect(m.modelStatus, metric).toBe('exploratory');
      expect(`${m.summary} ${m.howModelled}`, metric).toMatch(/not a predicted lab value/);
      expect(notOptimisable(metric as MetricId), metric).toBe(true);
      expect(isProductionGoalEligible(metric), metric).toBe(false);
    }
  });

  it('describes the actual thyroid knee, both target branches and habitual normalization', () => {
    const m = art('12-thyroid-t3');
    const knee = param('hormones.t3CarbKneeG').value;
    expect(knee).toBe(50);
    expect(param('hormones.carbKneeCortG').value).toBe(130);
    expect(m.equation).toContain(`DC_T3 = clamp(1 − C / ${knee}, 0, 1)`);
    expect(m.equation).toContain('− 0.22 · DC_T3 for u ≤ 0');
    expect(m.equation).toContain('− 0.22 · DC_T3 for u > 0');
    expect(m.equation).toContain('(T3f / T3fRef) · (L_FM_lag / L0)^0.30');
    expect(m.equation).toContain('rT3_rel = rT3S / rT3Ref');
    for (const u of [0, 0.01]) {
      const actual = t3fTarget(u, deficitPhi(u, 0.3), carbShortfall(0, knee), 0.22, 0.22, 0.1, 0.3);
      expect(actual).toBeCloseTo(1 + 0.1 * Math.min(1, u / 0.3) - 0.22, 12);
    }
  });

  it('says the hormone outputs are not lab values or goals in the topic scope', () => {
    const t = topics.find((x) => x.slug === 'hormones-appetite')!;
    expect(t.scope).toMatch(/not predicted lab values, not diagnoses and never goals/);
    expect(t.scope).not.toMatch(/population-model projections/);
  });

  it('abstains from lab predictions and from free testosterone without measured inputs, as the article says', () => {
    for (const a of ['leptin', 't3', 'cortisol', 'testosterone', 'igf1'] as const)
      expect(endocrineLabPrediction(a, { value: 1, unit: 'x', measuredOn: '2026-10-01' }).status, a).toBe(
        'unavailable',
      );
    expect(conditionalFreeTestosterone({}).status).toBe('unavailable');
    expect(conditionalFreeTestosterone({ totalTNmolL: 17, shbgNmolL: 35 }).status).toBe('unavailable');
    const ft = conditionalFreeTestosterone({
      totalTNmolL: 17,
      shbgNmolL: 35,
      albumin: { gL: 43, source: 'documentedAssumption' },
    });
    expect(ft.status).toBe('estimated');
    expect(Number.isFinite(ft.value)).toBe(true);
    expect(HORMONES_OUTPUT_CONTRACT.freeTestosterone.absoluteRequires).toEqual([
      'measuredTotalT',
      'measuredShbg',
      'albumin',
    ]);
    const m = art('12-testosterone-shbg');
    expect(m.howModelled).toMatch(
      /needs your measured total testosterone and SHBG and a stated albumin value/,
    );
    expect(m.howModelled).toMatch(/never shown as your value/);
    expect(m.keyNumbers.find((k) => k.label === 'Free-testosterone defaults')?.note).toMatch(
      /never a personal value/,
    );
  });

  it('describes a reproductive concern status, never a per-cycle probability, with the module’s own window and point', () => {
    expect(HORMONES_OUTPUT_CONTRACT.menstrualRisk.probability).toBe(false);
    const base = { eligibility: 'eligible' as const, windowDays: 84, concernAtPct: 15 };
    // missing history is not reassurance; a reported change overrides any reassurance
    expect(reproductiveConcernStatus({ ...base, knownDays: 30, meanDeficitPct: 0 })).toBe(
      'insufficientHistory',
    );
    expect(
      reproductiveConcernStatus({ ...base, knownDays: 84, meanDeficitPct: 0, recentChange: 'missedPeriods' }),
    ).toBe('review');
    expect(
      reproductiveConcernStatus({ ...base, eligibility: 'notApplicable', knownDays: 84, meanDeficitPct: 50 }),
    ).toBe('notApplicable');
    const window = param('hormones.lpdWindowD').value;
    const mid = param('hormones.lpdMidPct').value;
    for (const id of ['12-reproductive-axis-energy-availability', '19-menstrual-regularity-and-libido']) {
      const m = art(id);
      expect(m.howModelled, id).toMatch(/concern status/);
      expect(m.howModelled, id).toMatch(/review when you report missed periods/);
      expect(m.howModelled, id).toMatch(/insufficient history/);
      expect(m.howModelled, id).toContain(`${window} days`);
      expect(m.howModelled, id).not.toMatch(/gives the chance|risk of at least one/);
      expect(m.modelStatus, id).toBe('exploratory');
    }
    expect(art('19-menstrual-regularity-and-libido').howModelled).toContain(`about ${mid} %`);
    expect(art('19-menstrual-regularity-and-libido').howModelled).toMatch(
      /not a personal per-cycle probability/,
    );
    expect(art('12-reproductive-axis-energy-availability').howModelled).toMatch(
      /gives no chance of a menstrual disturbance per cycle/,
    );
    expect(GOAL_CAPABILITY.menstrualRisk.availability).toBe('observedOnly');
  });

  it('states the IGF-1 protein response as a scenario range that includes no response', () => {
    const slope = param('hormones.igfProtSlope');
    expect(slope.low).toBe(0);
    const k = art('08-igf1-relative-level').keyNumbers.find((x) => x.label === 'Protein slope / tauP');
    expect(k?.value).toContain(`scenario range ${slope.low}–${slope.high}`);
    expect(k?.uncertaintyKind).toBe(slope.distribution?.uncertaintyKind);
    expect(HORMONES_OUTPUT_CONTRACT.relativeOutputs.igf1.goalBenefit).toBe(false);
    expect(art('12-growth-hormone-igf1').howModelled).toMatch(/growth hormone is not modelled/);
    expect(art('12-growth-hormone-igf1').howModelled).toMatch(/includes no response at all/);
  });

  it('computes no diet-strain score or libido flag that the articles describe', () => {
    const m = art('12-mood-libido-cold');
    expect(m.modelStatus).toBe('notModelled');
    expect(m.equation).toMatch(/^Proposed, not run/);
    expect(art('19-menstrual-regularity-and-libido').equation).toMatch(/Proposed, not run: amenorrhoea flag/);
  });
});

/* ------------------------------------------------------------------------------- protein timing and MPS (D3-04) */

describe('protein timing and synthesis', () => {
  it('applies no meal-distribution penalty in the standard projection; the legacy curve is a research sensitivity', () => {
    const mode = param('muscle.eDistMode');
    expect(mode.value).toBe(0);
    expect(mode.low === mode.high || mode.draw === 'fixed').toBe(true);
    const m = art('03-protein-distribution-timing');
    expect(m.equation).toMatch(/^Standard projection: E_dist = 1/);
    expect(m.equation).toMatch(/Research sensitivity only:/);
    expect(m.equation).toMatch(/Proposed, not run: ΔL_fastExtra/);
    expect(m.howModelled).toMatch(/changes nothing in the standard projection/);
    expect(m.howModelled).toMatch(/not proof that timing has no effect/);
    expect(m.howModelled).toMatch(/no lost-muscle estimate/);
    expect(m.howModelled).not.toMatch(/Long daily fasts add/);
    expect(m.warrants?.some((w) => w.type === 'tacitKnowledge')).toBe(true);
    expect(m.warrants?.some((w) => w.type === 'functionallyTrue')).toBe(true);
  });

  it('keeps MPS a simulated response index, never measured synthesis or grams of muscle', () => {
    expect(GOAL_CAPABILITY.mps.availability).toBe('unavailable');
    expect(GOAL_CAPABILITY.mps.reasonCode).toBe('simulatedResponseIndex');
    for (const id of [
      '03-mps-suppression-energy-deficit',
      '03-per-meal-mps-dose-response',
      '03-hourly-muscle-protein-balance',
      '03-resistance-exercise-turnover',
    ])
      expect(art(id).modelStatus, id).toBe('exploratory');
    expect(art('03-per-meal-mps-dose-response').howModelled).toMatch(
      /not a measured synthesis rate, and never converted into grams of muscle/,
    );
    expect(art('03-per-meal-mps-dose-response').howModelled).toMatch(/no universal 2–3 g leucine switch/);
    const hourly = art('03-hourly-muscle-protein-balance');
    expect(hourly.howModelled).toMatch(/never integrated into muscle mass/);
    expect(`${hourly.summary} ${hourly.howModelled}`).not.toMatch(/re-?normalised|re-scaled/);
  });

  it('invents no leucine amount for a food of unknown protein source', () => {
    expect(art('03-protein-quality-diaas').howModelled).toMatch(/no leucine amount is invented for it/);
  });
});

/* ------------------------------------------------------------------------------ carbohydrate appearance (D6-07) */

describe('carbohydrate appearance: an approximation with design limits', () => {
  it('quotes the appearance caps of the intake module as design limits, not verified maxima', () => {
    const glc = param('intake.raGlcMaxGH');
    const mix = param('intake.raGlcFruMaxGH');
    const m = art('04-carbohydrate-disposal-hourly');
    expect(m.equation).toContain(`Ra_glc ≤ ${glc.value} g/h`);
    expect(m.equation).toContain(`Ra_glc + Ra_fru ≤ ${mix.value} g/h`);
    expect(m.equation).toMatch(/design limits \(not verified maxima\)/);
    expect(m.howModelled).toMatch(/design limits/);
    expect(m.howModelled).toMatch(/not verified absorption maxima/);
    expect(m.relatedParamIds).toEqual(expect.arrayContaining([glc.id, mix.id]));
    for (const p of [glc, mix]) expect(p.distribution?.nominal, p.id).toBe('designPoint');
    expect(INTAKE_KINETICS_SCOPE.caps).toEqual({
      glucoseGH: 'designLimit',
      glucoseFructoseGH: 'designLimit',
    });
    const k = m.keyNumbers.find((x) => x.label.startsWith('Carbohydrate burned'));
    expect(k?.note).toMatch(/oxidation rates/);
    expect(m.keyNumbers.some((x) => x.label === 'Maximum absorption')).toBe(false);
  });

  it('keeps gut appearance, appearance after the liver and oxidation apart, as the scope declaration does', () => {
    const notThe = INTAKE_KINETICS_SCOPE.observables.raGlcGH.notThe;
    expect(notThe).toEqual(
      expect.arrayContaining(['intestinalUptake', 'systemicAppearanceAfterFirstPass', 'oxidation']),
    );
    const h = art('04-carbohydrate-disposal-hourly').howModelled;
    expect(h).toMatch(/not measured intestinal uptake/);
    expect(h).toMatch(/not the glucose that reaches the circulation after the liver's first pass/);
    expect(h).toMatch(/not oxidation/);
  });

  it('marks fibre timing unsupported while keeping its daily energy', () => {
    expect(INTAKE_KINETICS_SCOPE.observables.fibreEnergy).toMatchObject({
      hourly: 'unsupported',
      daily: 'kept',
    });
    for (const id of ['04-carbohydrate-disposal-hourly', '04-fructose-sucrose-fibre'])
      expect(art(id).howModelled, id).toMatch(/hourly timing is not modelled/);
  });

  it('names every context that puts the hourly curves out of domain', () => {
    const words: Readonly<Record<(typeof INTAKE_KINETICS_SCOPE.outOfDomain)[number], string>> = {
      gastroparesis: 'gastroparesis',
      bariatricSurgery: 'bariatric surgery',
      glp1Medication: 'GLP-1 medication',
      inflammatoryBowelDisease: 'inflammatory bowel disease',
    };
    const h = art('04-carbohydrate-disposal-hourly').howModelled;
    for (const c of INTAKE_KINETICS_SCOPE.outOfDomain) expect(h, c).toContain(words[c]);
    expect(h).toMatch(/daily energy stays usable/);
  });
});

/* -------------------------------------------------------------------------------- lipids and liver (D7-07/D7-08) */

describe('lipids and liver fat', () => {
  it('keeps the lean-responder LDL term off by default without claiming zero response', () => {
    expect(param('cardiometabolic.lem.enabled').value).toBe(0);
    const m = art('06-lean-mass-hyper-responder');
    expect(m.modelStatus).toBe('exploratory');
    expect(m.equation).toMatch(/^Opt-in scenario, off by default/);
    expect(m.howModelled).toMatch(/Off in the standard projection/);
    expect(m.howModelled).toMatch(/Off does not mean no response/);
    expect(m.howModelled).toMatch(/LDL and ApoB results are marked limited/);
    expect(m.howModelled).toMatch(/No probability of being a responder/);
    expect(text(m)).not.toMatch(/P\(m > 2\)/);
    expect(art('06-low-carb-ldl-average').howModelled).toMatch(/adds no separate term/);
    expect(GOAL_CAPABILITY.ldl.availability).not.toBe('supported');
  });

  it('treats ApoB change as an exploratory proxy and non-HDL as an identity only within a matched panel', () => {
    expect(GOAL_CAPABILITY.apoB.availability).toBe('unavailable');
    const m = art('06-apob-from-non-hdl');
    expect(m.modelStatus).toBe('exploratory');
    expect(m.summary).toMatch(/A measured ApoB is kept exactly/);
    expect(m.howModelled).toMatch(/not a calibrated personal response/);
    expect(m.howModelled).toMatch(/a model convention, not an identity/);
    expect(m.equation).toContain(`LDL + TG/${param('cardiometabolic.lipid.vldlDivisor').value}`);
    expect(m.equation).toMatch(/nonHDL = TC − HDL \(one matched measured panel\)/);
    expect(m.warrants?.some((w) => w.type === 'analyticallyTrue')).toBe(true);
  });

  it('does not describe generated baselines as conditioned on measured labs', () => {
    const m = art('06-marker-dynamics');
    expect(m.howModelled).toMatch(/does not adjust the markers you have not measured/);
    expect(m.summary).toMatch(/A lab result you enter anchors its own marker exactly/);
    expect(m.summary).not.toMatch(/does not know your lab results/);
  });

  it('scopes omega-3 grades to triglycerides and blood pressure, not heart events', () => {
    for (const id of ['06-omega-3-triglycerides', '26-omega-3']) {
      const m = art(id);
      expect(m.outcomeScope, id).toMatch(/not (cardiovascular|heart) events/);
      expect(
        m.warrants?.some(
          (w) => w.confidence === 'low' && /heart events|cardiovascular events/.test(w.scope ?? ''),
        ),
        id,
      ).toBe(true);
      expect(m.gradeReason, id).toMatch(/only/);
      expect(m.caveats, id).toMatch(/do not by themselves show fewer heart events/);
    }
  });

  it('has no sustained ketosis liver-fat bonus in the standard projection, and no fibrosis claim', () => {
    expect(param('cardiometabolic.liver.ketoScenario').value).toBe(0);
    const m = art('06-liver-fat-restriction');
    expect(m.equation).toMatch(/f_cr = 1 in the standard projection/);
    expect(m.howModelled).toMatch(/no lasting extra fall for ketosis/);
    expect(m.howModelled).toMatch(/marked uncertain rather than set to a proven zero/);
    expect(m.howModelled).toMatch(/never means fibrosis has resolved and never clears a clinical flag/);
    expect(m.howModelled).toMatch(/never shown as a measurement/);
    expect(m.keyNumbers.find((k) => k.label === 'Calibration')?.value).toMatch(/sensitivity scenario only/);
    const all = topics.flatMap((t) => t.mechanisms.map((x) => text(x))).join('\n');
    expect(all).not.toMatch(/ketosis adds a further factor/);
  });
});

/* --------------------------------------------------------- energy availability, bone, endurance, wellbeing (D8-*) */

describe('energy availability: raw exposure and policy references', () => {
  it('describes the raw daily EA the module records: unclipped, unavailable without a valid denominator', () => {
    expect(EA_EXPOSURE_DEFINITION.clip).toMatch(/^none/);
    expect(rawEnergyAvailability(1500, 0, 0)).toBeNull();
    expect(rawEnergyAvailability(0, 2000, 50)).toBe(-40); // far below the internal clip, preserved
    const m = art('19-energy-availability-tiers');
    expect(m.equation).toMatch(/unclipped/);
    expect(m.howModelled).toMatch(/kept unclipped/);
    expect(m.howModelled).toMatch(/never zero intake/);
    expect(m.howModelled).toMatch(/not a DXA measurement/);
    const lo = param('wellbeing.eaFloor').value;
    const hi = param('wellbeing.eaCeil').value;
    expect(m.equation).toContain(`[${signed(lo)}, ${hi}]`);
    expect(m.howModelled).toContain(`clipped to ${signed(lo)} to ${hi}`);
  });

  it('gives the tier values as policy references, not diagnostic thresholds', () => {
    expect(EA_POLICY_REFERENCES.diagnostic).toBe(false);
    const { t0, t1, t2 } = EA_POLICY_REFERENCES.values;
    for (const [id, v] of [
      ['wellbeing.eaTierT0', t0],
      ['wellbeing.eaTierT1', t1],
      ['wellbeing.eaTierT2', t2],
    ] as const)
      expect(param(id).value, id).toBe(v);
    const m = art('19-energy-availability-tiers');
    expect(m.howModelled).toContain(`The values ${t0}, ${t1} and ${t2}`);
    expect(m.howModelled).toMatch(/policy and historical reference points, not diagnostic thresholds/);
    expect(m.howModelled).toMatch(/no tier clears you as healthy/);
    expect(text(m)).not.toMatch(/probability of (low energy availability|REDs)/i);
    expect(GOAL_CAPABILITY.energyAvailability.availability).toBe('unavailable');
  });

  it('keeps the strength penalty an exploratory structure with a no-penalty alternative', () => {
    expect(param('wellbeing.strengthPenaltyStructure').note).toMatch(/no-penalty alternative/);
    const m = art('19-strength-and-power-in-a-deficit');
    expect(m.modelStatus).toBe('exploratory');
    expect(m.howModelled).toMatch(/compared with a no-penalty alternative/);
    expect(m.howModelled).toMatch(/your habitual level, not an adequate one/);
  });
});

describe('bone density: no personal forecast', () => {
  it('agrees with the research-scope declaration and the capability registry', () => {
    expect(BMD_RESEARCH_SCOPE.personalForecast).toBe(false);
    expect(BMD_RESEARCH_SCOPE.predictionsEnabled).toBe(false);
    expect(GOAL_CAPABILITY.hipBmdChange.availability).toBe('observedOnly');
    expect(isProductionGoalEligible('hipBmdChange')).toBe(false);
    const m = art('19-bone-turnover-and-density-in-weight-loss');
    expect(m.modelStatus).toBe('exploratory');
    expect(m.howModelled).toMatch(/^Vitals makes no personal bone-density forecast/);
    expect(m.howModelled).toMatch(/not water, glycogen or gut content/);
    expect(m.howModelled).toMatch(/credits no protection from logged resistance-training sets/);
    expect(m.howModelled).toMatch(/applies no calcium multiplier/);
    expect(m.howModelled).toMatch(/does not recover by itself/);
  });

  it('lists the disabled terms as not applied, matching the inactive parameters', () => {
    for (const id of ['wellbeing.bmdRhoRt', 'wellbeing.bmdMCaLow', 'wellbeing.bmdTauRecovery'])
      expect(param(id).note, id).toMatch(/INACTIVE/);
    expect(art('19-bone-turnover-and-density-in-weight-loss').equation).toMatch(
      /Not applied: mRT = 1 − ρ_RT .*mCa = 1\.5 .*the 240-day recovery/,
    );
    const myth = topics
      .flatMap((t) => t.myths)
      .find((x) => x.id === '19-myth-resistance-training-protects-bone');
    expect(myth?.explanation).toMatch(/credits no bone protection from logged sets/);
    expect(myth?.explanation).not.toMatch(/protective range/);
  });
});

describe('endurance index: task-scoped research only', () => {
  it('names the one task the index speaks to and never converts it into race time', () => {
    expect(ENDURANCE_INDEX_SCOPE.raceTimeConvertible).toBe(false);
    expect(enduranceTaskSupport({ outcome: 'raceTime' }).status).toBe('unavailable');
    expect(
      enduranceTaskSupport({ outcome: 'timeToExhaustion', modality: 'cycle', intensityFracVo2max: 0.4 })
        .status,
    ).toBe('unavailable');
    expect(GOAL_CAPABILITY.enduranceCapacity.availability).toBe('unavailable');
    expect(isProductionGoalEligible('enduranceCapacity')).toBe(false);
    const { reference, studiedLow, studiedHigh } = ENDURANCE_INDEX_SCOPE.intensityFracVo2max;
    const pct = (x: number): number => Math.round(x * 100);
    const m = art('19-endurance-glycogen-economy-and-body-mass');
    expect(m.modelStatus).toBe('exploratory');
    expect(m.howModelled).toContain(`about ${pct(reference)} % of maximal oxygen uptake`);
    expect(m.howModelled).toContain(`studied at ${pct(studiedLow)}–${pct(studiedHigh)} %`);
    expect(m.howModelled).toMatch(/never converted into a race time/);
    expect(m.howModelled).toMatch(/unavailable, not zero/);
    expect(m.howModelled).toMatch(/no general endurance score/);
    expect(m.equation).toContain(
      `TTE_75(G) = ${param('wellbeing.tteIntercept').value} + ${param('wellbeing.tteSlope').value} × G`,
    );
  });
});

describe('wellbeing: observed concerns plus transparent flags', () => {
  it('lets a reported concern override a reassuring model tier, and does not read unlogged days as fine', () => {
    expect(
      combineWellbeingConcern({
        modelTier: 0,
        observed: [{ date: '2026-10-01', concerns: ['persistentFatigue'] }],
      }).status,
    ).toBe('review');
    expect(combineWellbeingConcern({ modelTier: 0 }).observed).toBe('notLogged');
    expect(GOAL_CAPABILITY.moodTier.availability).toBe('observedOnly');
    const m = art('19-mood-energy-and-keto-induction-symptoms');
    expect(m.title).toMatch(/^Wellbeing concerns/);
    expect(m.howModelled).toMatch(
      /any named concern, or an adverse rating on two or more days, sets the status to review whatever the model tier/,
    );
    expect(m.howModelled).toMatch(/unlogged days are not treated as fine/);
    expect(m.howModelled).toMatch(/no mood prediction/);
    expect(m.equation).toMatch(/a guard, not a mood score/);
  });

  it('applies no sodium mitigation of induction symptoms by default', () => {
    const na = param('wellbeing.ketoNaMitigation');
    expect(na.value).toBe(0);
    const m = art('13-induction-symptoms');
    expect(m.howModelled).toMatch(/Sodium does not change it by default/);
    expect(m.howModelled).toMatch(/never a salt recommendation or a promise of relief/);
    expect(m.equation).toMatch(/s_Na = 0 by default/);
    expect(text(m)).not.toMatch(/reduced by 30 %/);
  });
});

/* ------------------------------------------------------------------------- cycle, menopause, stress (D8-07) */

describe('cycle phase, menopause and stress', () => {
  it('describes the cycle phase as a calendar estimate with phase-average effects when the cycle is unknown', () => {
    const len = param('moderators.cycleLengthDefaultD').value;
    const m = art('16-menstrual-cycle-and-contraception');
    expect(m.equation).toContain(`about days ${lutealStartDay(len)}–${len} for L = ${len}`);
    expect(m.howModelled).toMatch(/calendar estimate, never a measured ovulation/);
    expect(m.howModelled).toMatch(/no phase is asserted/);
    expect(m.howModelled).toMatch(/not fertility or contraception advice/);
    expect(m.equation).toMatch(/cycle water = 0 by default/);
    expect(m.equation).not.toMatch(/lutealFlag/);
    expect(m.howModelled).toContain('observed LH signal; it does not confirm that ovulation occurred');
    expect(m.howModelled).toContain('separately user-reported clinician-confirmed event');
    expect(m.equation).toContain('LH-informed assumed date');
    expect(m.timeCourse).toContain('All phases remain estimated');
  });

  it('keeps the menopause drift inactive, as the parameters say, and never as added kilograms', () => {
    for (const id of ['moderators.menopauseFatDriftKgYr', 'moderators.menopauseLeanDriftKgYr'])
      expect(param(id).note, id).toMatch(/INACTIVE/);
    const m = art('16-menopause');
    expect(m.equation).toMatch(/^Inactive, not applied/);
    expect(m.howModelled).toMatch(/never added to body composition as extra kilograms/);
    expect(m.warrants?.some((w) => w.type === 'firstPrinciples')).toBe(true);
  });

  it('marks stress as not modelled', () => {
    const m = art('16-psychological-stress');
    expect(m.modelStatus).toBe('notModelled');
    expect(m.howModelled).toMatch(/changes no output/);
  });
});

/* ------------------------------------------------------------------------------- registry and metadata (C6/C7) */

/**
 * Capability reason codes of metrics that are research displays or observed outcomes, never modelled production objectives
 * (a measured-lab-only marker such as HDL still has a modelled response, so it is not listed).
 */
const DISPLAY_OR_OBSERVED = new Set([
  'noHealthObjective',
  'exploratoryMechanism',
  'responseModelUnvalidated',
  'simulatedResponseIndex',
  'proxyResponseUnvalidated',
  'genericIndexNotTask',
  'measuredDxaOnly',
  'observedWellbeingOnly',
  'loggedCycleConcernsOnly',
]);

/** Articles that chart a display index next to observed human outcomes, so no single status word fits. */
const MIXED_ARTICLES = new Set(['08-autophagy-vs-muscle-gain']);

/** Every article this revision rewrote or gave outcome-scoped metadata. */
const EDITED_ARTICLES = [
  '03-mps-suppression-energy-deficit',
  '03-per-meal-mps-dose-response',
  '03-hourly-muscle-protein-balance',
  '03-resistance-exercise-turnover',
  '03-protein-distribution-timing',
  '03-protein-quality-diaas',
  '04-carbohydrate-disposal-hourly',
  '06-apob-from-non-hdl',
  '06-low-carb-ldl-average',
  '06-lean-mass-hyper-responder',
  '06-omega-3-triglycerides',
  '06-liver-fat-restriction',
  '08-igf1-relative-level',
  '12-leptin-fat-and-energy-status',
  '12-thyroid-t3',
  '12-cortisol',
  '12-testosterone-shbg',
  '12-reproductive-axis-energy-availability',
  '12-growth-hormone-igf1',
  '12-mood-libido-cold',
  '13-induction-symptoms',
  '16-menstrual-cycle-and-contraception',
  '16-psychological-stress',
  '16-menopause',
  '19-energy-availability-tiers',
  '19-bone-turnover-and-density-in-weight-loss',
  '19-strength-and-power-in-a-deficit',
  '19-endurance-glycogen-economy-and-body-mass',
  '19-mood-energy-and-keto-induction-symptoms',
  '19-menstrual-regularity-and-libido',
  '26-omega-3',
];

describe('registry agreement and outcome-scoped metadata', () => {
  it('gives a status word to every article whose charted metrics are all research displays or observations', () => {
    const missing: string[] = [];
    for (const t of topics)
      for (const m of t.mechanisms) {
        const ids = m.relatedMetricIds.filter((id): id is MetricId => id in GOAL_CAPABILITY);
        if (ids.length === 0 || ids.length !== m.relatedMetricIds.length) continue;
        if (!ids.every((id) => DISPLAY_OR_OBSERVED.has(GOAL_CAPABILITY[id].reasonCode))) continue;
        // a mixed article (muscle gain alongside a chosen eating pattern) also covers observed outcomes: no single word
        if (MIXED_ARTICLES.has(m.id)) continue;
        if (m.modelStatus !== 'exploratory' && m.modelStatus !== 'notModelled')
          missing.push(`${m.id} (${ids.join(', ')})`);
      }
    expect(missing).toEqual([]);
  });

  it('carries warrants with a scope, an outcome scope and sheet content on every edited article', () => {
    for (const id of EDITED_ARTICLES) {
      const m = art(id);
      expect(hasWarrantContent(m), id).toBe(true);
      expect(m.warrants?.length ?? 0, id).toBeGreaterThan(0);
      for (const w of m.warrants ?? []) expect((w.scope ?? '').trim().length, id).toBeGreaterThan(0);
      expect((m.outcomeScope ?? '').trim().length, id).toBeGreaterThan(0);
    }
  });

  it('keeps every edited article id (ids are links: saved Explain links and shared links must still open)', () => {
    expect(EDITED_ARTICLES.filter((id) => !byId.has(id))).toEqual([]);
  });
});
