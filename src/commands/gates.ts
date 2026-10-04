/**
 * Preconditions and safety gates (SUITE_SPEC §1.1 item 5, §1.3). Gates are the same functions the UI applies:
 * `screeningReady` is the onboarding gate (`gateStatus`), `plannerAccess` the Planner screen's block, both computed by
 * the headless `safetyAccessNow()` that mirrors `useSafetyAccess`. The person's own screens sit behind the onboarding
 * route gate, so `screeningReady` and `simulatorAccess` are evaluated for agents (ai, webmcp, mcp) — a command must
 * never reach what the UI would not show.
 */
import { getDocumentStore } from '@/state/runtime';
import type { Actor, CommandDef, PreconditionId, SafetyGateId } from './types';

type Precondition = (input: unknown, actor: Actor) => string | null;
type Gate = (input: unknown, actor: Actor, now: string) => { message: string; allowedAlternatives?: string[] } | null;

function activePlanId(): string | null {
  const ap = getDocumentStore().peek<{ planId?: string | null }>('activePlan', 'me');
  return ap?.planId ?? null;
}

const field = (input: unknown, k: string): unknown => (input && typeof input === 'object' ? (input as Record<string, unknown>)[k] : undefined);

const PRECONDITIONS: Partial<Record<PreconditionId, Precondition>> = {
  noWeightEditDuringPlan: (input) =>
    activePlanId() && field(input, 'weightKg') !== undefined && field(input, 'asStartingPoint') !== true
      ? 'A plan is running: record new weights as measurements, or confirm this one as a new starting point.'
      : null,
  noActivePlan: () => (activePlanId() ? 'A plan is already running.' : null),
  activePlan: () => (activePlanId() ? null : 'No plan is running.'),
  storageAvailable: () => null,
};
const GATES: Partial<Record<SafetyGateId, Gate>> = {
  // AI may tighten, never loosen: nothing relaxing is AI-callable in v0.2 (those commands are UI-only).
  tightenOnly: () => null,
};

/** Domains register the checks that need their state (`scenarioExists` by scenarios, safety gates by safety). */
export function registerPrecondition(id: PreconditionId, fn: Precondition): void {
  PRECONDITIONS[id] = fn;
}
export function registerGate(id: SafetyGateId, fn: Gate): void {
  GATES[id] = fn;
}

/** Agents (the person's own screens sit behind the onboarding route gate). */
export const isAgent = (a: Actor): boolean => a.kind === 'ai' || a.kind === 'webmcp' || a.kind === 'mcp' || a.kind === 'companion';

export function checkPreconditions(def: CommandDef, input: unknown, actor: Actor): { id: PreconditionId; message: string } | null {
  for (const id of def.preconditions ?? []) {
    const fn = PRECONDITIONS[id];
    // fail closed: a declared check without an implementation never lets the command through
    const message = fn ? fn(input, actor) : `The check "${id}" is not available.`;
    if (message) return { id, message };
  }
  return null;
}

export function checkGates(def: CommandDef, input: unknown, actor: Actor, now: string): ({ id: SafetyGateId } & { message: string; allowedAlternatives?: string[] }) | null {
  for (const id of def.safety ?? []) {
    const fn = GATES[id];
    const r = fn ? fn(input, actor, now) : { message: 'The safety check for this is not available.' };
    if (r) return { id, ...r };
  }
  return null;
}
