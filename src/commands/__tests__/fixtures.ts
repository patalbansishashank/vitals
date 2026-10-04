/**
 * One fixture input per command (`src/commands/__fixtures__/<id>.json`, SUITE_SPEC §1.10 item 5). Generated from the
 * input schema (smallest valid value) with hand-written inputs for the commands the app implements, then reviewed and
 * committed. Regenerate: `GEN_FIXTURES=1 pnpm vitest run src/commands/__tests__/fixtures.gen.test.ts`.
 */
import type { JsonSchema } from '../schema';

/** Smallest valid value of a schema (required fields only). */
export function sampleOf(s: JsonSchema): unknown {
  if (s.anyOf) return sampleOf(s.anyOf[0]!);
  if (s.const !== undefined) return s.const;
  if (s.enum) return s.enum[0];
  switch (s.type) {
    case 'string': {
      if (s.format === 'date') return '2026-10-05';
      if (s.format === 'date-time') return '2026-10-01T09:00:00.000Z';
      const base = 'example';
      return s.minLength && s.minLength > base.length ? base.padEnd(s.minLength, 'x') : base;
    }
    case 'number':
    case 'integer': {
      const lo = s.minimum ?? (s.exclusiveMinimum !== undefined ? s.exclusiveMinimum + 1 : 0);
      return s.maximum !== undefined && lo > s.maximum ? s.maximum : lo;
    }
    case 'boolean':
      return true;
    case 'null':
      return null;
    case 'array': {
      if (s.prefixItems) return s.prefixItems.map(sampleOf);
      const n = s.minItems ?? 0;
      return Array.from({ length: n }, () => (s.items && typeof s.items === 'object' ? sampleOf(s.items) : null));
    }
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const k of s.required ?? []) out[k] = sampleOf(s.properties![k]!);
      return out;
    }
    default:
      return {};
  }
}

const AT = '2026-10-01T09:00:00.000Z';

/** Inputs that exercise the implemented commands on the default seed state (scenario `starter`, empty profile). */
export const FIXTURE_INPUTS: Record<string, unknown> = {
  'profile.patch': { weightKg: 82.5, shape: { bodyFatPct: 24 }, habits: { typicalSteps: 9000 } },
  'profile.setSetupStep': { step: 'shape' },
  'safety.commitScreening': { answers: { ageBand: '18-64', pregnancy: 'no', eatingDisorder: 'no', scoffRisk: false }, at: AT },
  'safety.acknowledge': { id: 'disclaimer', version: 1, at: AT },
  'safety.setFastingOptIn': { optIn: { tier: 'T2', acknowledged: ['A'], ackVersion: 1, priorFastTolerated: true, at: AT } },
  'safety.setShortWindow': { value: { version: 1, at: AT } },
  'safety.acknowledgeDanger': { scenarioId: 'starter', ack: { scheduleHash: 'h', rules: ['W-D01'], version: 1, at: AT } },
  'safety.reportIllness': { at: AT },
  'goals.edit': { ops: [{ op: 'add', goal: { key: 'fixture-goal', metric: 'fatMass', mode: 'lose', amount: 3, strength: 'should', functional: null } }, { op: 'setHorizon', days: 84 }] },
  'scenario.create': { name: 'Fixture scenario', starter: 'blank' },
  'scenario.duplicate': { id: 'starter' },
  'scenario.rename': { id: 'starter', name: 'Renamed' },
  'scenario.setActive': { id: 'starter' },
  'scenario.delete': { id: 'starter' },
  'scenario.edit': { id: 'starter', ops: [{ op: 'paint', days: [3, 4], program: 0 }, { op: 'editDays', days: [5], patch: { steps: 11000 } }] },
  'scenario.undo': { id: 'starter' },
  'scenario.redo': { id: 'starter' },
  'scenario.get': { id: 'starter', days: [0, 6] },
  'scenario.applyStarter': { id: 'starter', starter: 'maintenance8' },
  'settings.update': { patch: { units: 'imperial', theme: 'dark' } },
  'intake.answer': { section: 'diet', answers: { animalFoods: 'some' } },
  'intake.skip': { section: 'devices' },
  'sim.run': { scenarioId: 'starter', draws: 0 },
  'sim.series': { source: { scenarioId: 'starter' }, series: ['scaleWeight'], resolution: 'week' },
  'sim.whatIf': { base: { scenarioId: 'starter' }, variants: [[{ op: 'setHorizon', days: 28 }]] },
  'sim.compare': { base: { scenarioId: 'starter' }, variants: [[{ op: 'setHorizon', days: 28 }]] },
  'planner.find': { tier: 'M' },
  'planner.openInSimulator': { kind: 'A' },
  'history.seal': { coalesceKey: 'stroke:1' },
  'evidence.search': { q: 'protein muscle' },
  'evidence.get': { slug: 'protein-muscle' },
  'nav.open': { route: 'schedule', params: { scenarioId: 'starter' } },
  'data.import': { file: { vitalsVersion: '1', stores: { 'vitals.settings': { version: 3, state: { units: 'imperial' } } } }, mode: 'merge' },
  'log.measurement': { metric: 'weightKg', value: 82.4, context: 'morningFasted', method: 'scale' },
  'log.markDay': { date: '2026-10-05', marks: { all: 'asPlanned' } },
  'plan.start': { source: { scenarioId: 'starter' }, startDate: '2026-10-05' },
};
