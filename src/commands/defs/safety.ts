/**
 * `safety.*` (SUITE_SPEC §1.9, §1.4 "AI may tighten, never loosen"). Commands that relax a boundary (screening answers,
 * acknowledgements, fasting opt-ins, danger acknowledgements) are UI-only; `safety.reportIllness` only tightens.
 * `safety.status` reports the mode, restrictions and locks as labels — never raw answers.
 */
import * as safety from '@/state/internal/safety';
import { isAgent, registerGate } from '../gates';
import { defineCommand } from '../registry';
import { T } from '../schema';
import { ALL, CONSENT, UI_ONLY, UNDO } from './_shared';

const Instant = T.Instant();

// The gates the screens apply, evaluated headlessly (`safetyAccessNow` mirrors `useSafetyAccess`).
registerGate('screeningReady', (_input, actor, now) =>
  isAgent(actor) && !safety.safetyAccessNow(now).ready ? { message: 'The safety questions need answering in the app first.', allowedAlternatives: ['nav.open'] } : null,
);
registerGate('simulatorAccess', (_input, actor, now) =>
  isAgent(actor) && safety.safetyAccessNow(now).simulatorAccess === 'blocked' ? { message: 'The Simulator is not available until the safety questions are done.' } : null,
);
registerGate('plannerAccess', (_input, _actor, now) =>
  safety.safetyAccessNow(now).plannerAccess === 'blocked'
    ? { message: 'The Planner is not available with your safety answers.', allowedAlternatives: ['sim.whatIf', 'scenario.edit'] }
    : null,
);
const ui = { surfaces: UI_ONLY.surfaces, excludedReason: UI_ONLY.excludedReason(CONSENT) };

export const SafetyStatus = T.Object({
  gate: T.String({ description: 'ready | first-run | blocked | needs-review | needs-consent' }),
  ready: T.Boolean(),
  mode: T.String(),
  modeLabel: T.String(),
  restrictions: T.Array(T.String()),
  simulatorAccess: T.String(),
  plannerAccess: T.String(),
  locks: T.Array(T.String()),
  maxFastHours: T.Number(),
  fastingTier: T.Nullable(T.String()),
  shortWindowOn: T.Boolean(),
  recentIllness: T.Boolean(),
  pendingAcknowledgements: T.Array(T.String()),
});

function status(now: string) {
  const a = safety.safetyAccessNow(now);
  const v = safety.safetyValues();
  return {
    gate: a.gate.status,
    ready: a.ready,
    mode: String(a.outcome.mode),
    modeLabel: a.modeLabel,
    restrictions: a.outcome.restrictions.map(String),
    simulatorAccess: a.simulatorAccess,
    plannerAccess: a.plannerAccess,
    locks: a.plannerLocks.map((l) => String(l.id)),
    maxFastHours: a.outcome.fasting.maxFastHours,
    fastingTier: a.optedTier,
    shortWindowOn: a.shortWindowOn,
    recentIllness: v.recentIllnessAt !== null,
    pendingAcknowledgements: a.pendingAcknowledgements.map(String),
  };
}

export const safetyStatus = defineCommand({
  id: 'safety.status',
  version: 1,
  title: 'Read the safety status',
  description:
    'The safety mode from the screening (as a label), restrictions, Simulator and Planner access, Planner locks, the longest fast allowed in hours, the active fasting tier and any acknowledgements still needed. Never returns the answers themselves.',
  input: T.Object({}),
  output: SafetyStatus,
  perm: 'read',
  surfaces: ALL,
  excludedReason: { ui: 'screens evaluate the same rules with useSafetyAccess' },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: (ctx) => status(ctx.now),
});

export const safetyCommitScreening = defineCommand({
  id: 'safety.commitScreening',
  version: 1,
  title: 'Save the safety answers',
  description: 'Commit screening answers (sanitised: eating-questionnaire items are reduced to one risk flag before storage). Clears an import review.',
  input: T.Object({ answers: T.OpenObject({ description: 'ScreeningAnswers (sanitised by the executor)' }), at: Instant }),
  output: SafetyStatus,
  perm: 'write',
  impact: 'consequential',
  ...ui,
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs'],
  execute: (ctx, input) => {
    safety.commitAnswers(input.answers as never, input.at);
    return status(ctx.now);
  },
});

export const safetyClearAgeAnswer = defineCommand({
  id: 'safety.clearAgeAnswer',
  version: 1,
  title: 'Forget the age answer',
  description: '"I entered my age by mistake": forget the under-18 answer so the questions start again.',
  input: T.Object({}),
  output: SafetyStatus,
  perm: 'write',
  impact: 'consequential',
  ...ui,
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs'],
  execute: (ctx) => {
    safety.clearAgeAnswer();
    return status(ctx.now);
  },
});

export const safetyAcknowledge = defineCommand({
  id: 'safety.acknowledge',
  version: 1,
  title: 'Acknowledge safety copy',
  description: 'Record that the person acknowledged a versioned text (disclaimer, clinician-first).',
  input: T.Object({ id: T.Enum(['disclaimer', 'clinician-first']), version: T.Integer({ minimum: 0 }), at: Instant }),
  output: SafetyStatus,
  perm: 'write',
  impact: 'consequential',
  ...ui,
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs'],
  execute: (ctx, input) => {
    safety.acknowledge(input.id, input.version, input.at);
    return status(ctx.now);
  },
});

const FastingOptIn = T.Object({
  tier: T.Enum(['T2', 'T3', 'T4']),
  acknowledged: T.Array(T.String()),
  ackVersion: T.Integer({ minimum: 0 }),
  priorFastTolerated: T.Optional(T.Boolean()),
  refeedingPlanAccepted: T.Optional(T.Boolean()),
  at: Instant,
});

export const safetySetFastingOptIn = defineCommand({
  id: 'safety.setFastingOptIn',
  version: 1,
  title: 'Opt in to longer fasts',
  description: 'Opt in to fasts over 24 h at a tier, with that tier’s acknowledgements.',
  input: T.Object({ optIn: FastingOptIn }),
  output: SafetyStatus,
  perm: 'write',
  impact: 'consequential',
  ...ui,
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs'],
  execute: (ctx, input) => {
    safety.setFastingOptIn(input.optIn as never);
    return status(ctx.now);
  },
});

export const safetyClearFastingOptIn = defineCommand({
  id: 'safety.clearFastingOptIn',
  version: 1,
  title: 'Turn off longer fasts',
  description: 'Withdraw the opt-in to fasts over 24 h.',
  input: T.Object({}),
  output: SafetyStatus,
  perm: 'write',
  impact: 'consequential',
  ...ui,
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs'],
  execute: (ctx) => {
    safety.clearFastingOptIn();
    return status(ctx.now);
  },
});

export const safetySetShortWindow = defineCommand({
  id: 'safety.setShortWindow',
  version: 1,
  title: 'Short eating window',
  description: 'Opt in to (or out of, with null) 4–6 h eating windows.',
  input: T.Object({ value: T.Nullable(T.Object({ version: T.Integer({ minimum: 0 }), at: Instant })) }),
  output: SafetyStatus,
  perm: 'write',
  impact: 'consequential',
  ...ui,
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs'],
  execute: (ctx, input) => {
    safety.setShortWindow(input.value);
    return status(ctx.now);
  },
});

export const safetyAcknowledgeDanger = defineCommand({
  id: 'safety.acknowledgeDanger',
  version: 1,
  title: 'Acknowledge a danger warning',
  description: 'Acknowledge danger warnings of one scenario until its schedule changes.',
  input: T.Object({
    scenarioId: T.String({ minLength: 1 }),
    ack: T.Object({ scheduleHash: T.String(), rules: T.Array(T.String()), version: T.Integer({ minimum: 0 }), at: Instant }),
  }),
  output: SafetyStatus,
  perm: 'write',
  impact: 'consequential',
  ...ui,
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs'],
  execute: (ctx, input) => {
    safety.acknowledgeDanger(input.scenarioId, input.ack);
    return status(ctx.now);
  },
});

export const safetyReportIllness = defineCommand({
  id: 'safety.reportIllness',
  version: 1,
  title: 'Report a recent illness',
  description: 'Record an illness in the last four weeks: fasts over 24 h pause for four weeks from `at` (default now). Only tightens limits.',
  input: T.Object({ at: T.Optional(Instant) }),
  output: SafetyStatus,
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs'],
  execute: (ctx, input) => {
    safety.reportRecentIllness(input.at ?? ctx.now);
    return status(ctx.now);
  },
});

declare module '../types' {
  interface CommandMap {
    'safety.status': typeof safetyStatus;
    'safety.commitScreening': typeof safetyCommitScreening;
    'safety.clearAgeAnswer': typeof safetyClearAgeAnswer;
    'safety.acknowledge': typeof safetyAcknowledge;
    'safety.setFastingOptIn': typeof safetySetFastingOptIn;
    'safety.clearFastingOptIn': typeof safetyClearFastingOptIn;
    'safety.setShortWindow': typeof safetySetShortWindow;
    'safety.acknowledgeDanger': typeof safetyAcknowledgeDanger;
    'safety.reportIllness': typeof safetyReportIllness;
  }
}
