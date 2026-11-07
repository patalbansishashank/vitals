import { describe, expect, it } from 'vitest';
import {
  CONTRACT_FINGERPRINT,
  CONTRACT_VERSIONS,
  CURRENT_TISSUE_FAT_ENDPOINT,
  contentHash,
  endpointAvailability,
  goalEndpointSemanticsOf,
  hasCurrentTissueFatEndpoint,
  isDerivedCurrent,
  resolveCapabilityObjective,
  stampDerived,
  validateConstraintDef,
  intersectConstraints,
  type ConstraintDef,
  type ExerciseExposureCoverage,
  type GoalEndpointSemantics,
} from '../bodyContracts';
import { ENGINE_VERSION } from '@/engine/core/defaults';
import { EA_EXERCISE_SCOPE, EA_EXPOSURE_COVERAGE } from '@/engine/types/result';
import { GOAL_CAPABILITY } from '@/engine/types/metrics';
import type { RankedGoal, TargetReach } from '@/engine/planner/domain/types';

const DIRECTIONS = ['minimise', 'maximise', 'target'] as const;

describe('A2-001: endpoint availability counts every attempted member independently from compatibility numbers', () => {
  it.each([
    { mask: [], status: 'unavailable', available: 0 },
    { mask: [false, false], status: 'unavailable', available: 0 },
    { mask: [true, false], status: 'partial', available: 1 },
    { mask: [true, true], status: 'complete', available: 2 },
  ])('$mask yields $status without survivor renormalization', ({ mask, status, available }) => {
    expect(endpointAvailability(mask, ['missingOutput', 'missingOutput'])).toEqual({
      version: 1, policy: 'allRequiredMembers', status, attempted: mask.length,
      available, excluded: mask.length - available, memberAvailable: mask, reasons: ['missingOutput'],
    });
  });

  it('owns an immutable copy of caller arrays and preserves full member position on serialization', () => {
    const mask = [true, false, true];
    const reasons = ['baselineUnavailable'];
    const coverage = endpointAvailability(mask, reasons);
    mask[1] = true;
    reasons[0] = 'changed';
    expect(JSON.parse(JSON.stringify(coverage))).toMatchObject({ memberAvailable: [true, false, true], available: 2, excluded: 1, reasons: ['baselineUnavailable'] });
  });
});

describe('A2-002: capability objective normalization', () => {
  it('unknown metric capabilities produce a structured rejection', () => {
    expect(resolveCapabilityObjective(undefined, { direction: 'minimise' })).toEqual({ supported: false, direction: 'minimise', objective: null, reasonCode: 'unsupportedObjective' });
  });
  it.each(Object.entries(GOAL_CAPABILITY))('%s resolves its declared request directions and rejects disallowed unbounded shapes', (_metric, cap) => {
    for (const direction of DIRECTIONS) {
      const result = resolveCapabilityObjective(cap, { direction });
      const needsTarget = direction === 'target' || cap.satiation === 'required';
      expect(result.supported).toBe(!needsTarget && cap.objectives.includes(direction));
      if (!result.supported) expect(result.reasonCode).toBe(needsTarget ? 'needsTargetBand' : 'unsupportedObjective');
      if (cap.objectives.includes(direction)) {
        const bounded = resolveCapabilityObjective(cap, { direction, target: 2 });
        expect(bounded.supported).toBe(true);
        expect(bounded.objective).toBe(cap.objectives.includes('target') ? 'target' : direction);
      }
    }
  });

  it.each(['bhb', 'glycogenTotal'] as const)('%s requires an explicit finite dimensional aspiration', (metric) => {
    const cap = GOAL_CAPABILITY[metric];
    for (const target of [undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveCapabilityObjective(cap, { direction: 'maximise', target })).toMatchObject({ supported: false, objective: null, reasonCode: 'needsTargetBand' });
    }
    expect(resolveCapabilityObjective(cap, { direction: 'maximise', target: 2 })).toEqual({ supported: true, direction: 'target', objective: 'target', reasonCode: 'ok' });
  });
});

describe('A2-024: persisted body-fat endpoint identity', () => {
  it('an unstamped saved goal remains legacy unknown without changing its numeric intent', () => {
    const goal: RankedGoal = { metric: 'bodyFatPct', direction: 'target', target: -4, targetKind: 'change', capabilityVersion: CONTRACT_VERSIONS.goalCapability };
    const before = JSON.stringify(goal);
    expect(goalEndpointSemanticsOf(goal.metric, goal.endpointSemantics)).toEqual({ version: 1, operator: 'legacyUnknown', timeBasis: 'unknown' });
    expect(hasCurrentTissueFatEndpoint(goal.endpointSemantics)).toBe(false);
    expect(JSON.stringify(goal)).toBe(before);
    expect(goalEndpointSemanticsOf('fatMass')).toBeUndefined();
  });

  it('keeps trustworthy original operator provenance through repeated read/serialize cycles', () => {
    const original: GoalEndpointSemantics = { version: 1, operator: 'scaleBodyFatWake', timeBasis: 'wake', provenance: 'original forecast operator' };
    const once = goalEndpointSemanticsOf('bodyFatPct', original);
    const twice = goalEndpointSemanticsOf('bodyFatPct', JSON.parse(JSON.stringify(once)) as GoalEndpointSemantics);
    expect(once).toBe(original);
    expect(twice).toEqual(original);
    expect(hasCurrentTissueFatEndpoint(twice)).toBe(false);
  });

  it('only explicit tissue operator and end-of-day sampling confirm new tissue intent; identities hash differently', () => {
    expect(hasCurrentTissueFatEndpoint(CURRENT_TISSUE_FAT_ENDPOINT)).toBe(true);
    expect(hasCurrentTissueFatEndpoint({ ...CURRENT_TISSUE_FAT_ENDPOINT, timeBasis: 'wake' })).toBe(false);
    expect(hasCurrentTissueFatEndpoint({ ...CURRENT_TISSUE_FAT_ENDPOINT, operator: 'legacyUnknown' })).toBe(false);
    const goal = { metric: 'bodyFatPct', direction: 'target', target: 20 };
    expect(contentHash(goal)).not.toBe(contentHash({ ...goal, endpointSemantics: CURRENT_TISSUE_FAT_ENDPOINT }));
  });
});

describe('A2-013/A2-022: additive horizon and independent exercise coverage', () => {
  it('coverage of the actual route is distinct from a direction-only target outcome', () => {
    const stopped: Pick<TargetReach, 'requestedHorizonDays' | 'coveredDays' | 'completeHorizon' | 'outcome'> = { requestedHorizonDays: 112, coveredDays: 49, completeHorizon: false, outcome: 'foundUnderModel' };
    expect(stopped.completeHorizon).toBe(false);
    expect(stopped.coveredDays).toBeLessThan(stopped.requestedHorizonDays!);
  });

  it('complete sessions and actual-day zero are separate facts; absence has no complete code', () => {
    const sessions: ExerciseExposureCoverage = { version: 1, coverage: 'complete', scope: 'coveredSessions' };
    const zero: ExerciseExposureCoverage = { version: 1, coverage: 'confirmedZero', scope: 'actualDay', source: 'explicitAttestation' };
    expect(sessions.scope).not.toBe(zero.scope);
    expect(EA_EXPOSURE_COVERAGE.unknown).toBe(0);
    expect(EA_EXERCISE_SCOPE.unknown).toBe(0);
    expect(EA_EXPOSURE_COVERAGE.confirmedZero).not.toBe(EA_EXPOSURE_COVERAGE.complete);
    expect(EA_EXERCISE_SCOPE.coveredSessions).not.toBe(EA_EXERCISE_SCOPE.actualDay);
  });
});

describe('A2-001/A2-002/A2-010/A2-019/A2-022/A2-024: derived identities advance without rewriting history', () => {
  it('invalidates the former engine and contract identity while retaining frozen historical bytes', () => {
    const historical = { origin: 'original', forecast: { value: 20, operator: 'scaleBodyFatWake' }, engineVersion: '1.4.0-reaudit' };
    const frozen = JSON.stringify(historical);
    expect(ENGINE_VERSION).not.toBe(historical.engineVersion);
    expect(CONTRACT_VERSIONS).toMatchObject({ goalCapability: 2, goalEndpoint: 1, goalAggregation: 1, clinicalGuidance: 1, behaviorExecution: 1, energyAvailability: 2 });
    expect(CONTRACT_FINGERPRINT).toBe(contentHash(CONTRACT_VERSIONS));
    expect(isDerivedCurrent(stampDerived({ engineVersion: historical.engineVersion }), { engineVersion: ENGINE_VERSION })).toBe(false);
    expect(isDerivedCurrent({ contracts: 'previous-contracts' })).toBe(false);
    expect(JSON.stringify(historical)).toBe(frozen);
  });
});


describe('A2-010: malformed original clinical bounds are rejected without inventing authority', () => {
  const valid: ConstraintDef = { id: 'renal-protein-cap', quantity: 'proteinPerDay', comparator: 'cap', unit: 'g/d', value: 95, basis: 'notApplicable', scope: 'total', window: { kind: 'day' }, applicability: 'applicable', mandatory: true, source: { kind: 'clinician', ref: 'original-document' }, policyVersion: 1 };
  it('retains a valid historical policy version and the exact governing quantity', () => {
    expect(validateConstraintDef(valid)).toBeNull();
    expect(intersectConstraints([valid]).merged[0]).toMatchObject({ value: 95, unit: 'g/d', policyVersion: 1, source: valid.source });
  });
  it.each([
    ['window', undefined, 'unknownWindow'],
    ['window', { kind: 'unknown' }, 'unknownWindow'],
    ['basis', 'mystery', 'unknownBasis'],
    ['scope', 'mystery', 'unknownScope'],
    ['applicability', 'mystery', 'unknownApplicability'],
    ['mandatory', undefined, 'missingMandatory'],
    ['source', undefined, 'unknownSource'],
    ['policyVersion', undefined, 'invalidPolicyVersion'],
    ['policyVersion', 1.5, 'invalidPolicyVersion'],
  ])('preserves %s=%j as a rejected original with reason %s', (key, value, reason) => {
    const original = { ...valid, [key]: value } as ConstraintDef;
    expect(validateConstraintDef(original)).toBe(reason);
    const result = intersectConstraints([original]);
    expect(result.merged).toEqual([]);
    expect(result.rejected).toEqual([{ def: original, reason }]);
    expect(result.rejected[0]!.def).toBe(original);
  });
});
