/**
 * The command API (SUITE_SPEC §1). Every mutation of user data goes through `dispatch`; tools for the Coach, WebMCP and
 * MCP are generated from this registry. Importing this module registers every definition.
 *
 *   import { dispatch, dispatchSync, mintConfirmation } from '@/commands';
 *   await dispatch('scenario.edit', { id, ops: [{ op: 'paint', days: [3, 4], program: 1 }] });
 */
import './defs/core';
import './defs/jobs';
import './defs/history';
import './defs/profile';
import './defs/intake';
import './defs/safety';
import './defs/goals';
import './planner/goalsSuggest'; // E19: goals.suggest
import './defs/planner';
import './defs/scenario';
import './defs/sim';
import './defs/living';
import './living'; // E5's executors for the living-plan stubs
import './living/adapt'; // E5b: re-plan, declared events, shifts, day edits, swaps
import './livingWiring';
import './defs/bio';
import './defs/catalogue';
import './defs/coach';
import './defs/evidence';
import './defs/settings';
import './defs/sync';
import './defs/data';
// I1: executors for stubs other packages declared (each calls `implement()` from ./implement.ts)
import './sync';
import './bio';
// E28 (SUITE_SPEC §14.6): corrections, the owned-stream redirect, the one-time priority migration
import './biometrics';
import './catalogue';
import './ai';
// E9b: food, meal/session/bulk logging, coach persistence, intake questions, sim.explain
import './food';
import './coach';
// E18: supplements taking vs on hand, dose rows
import './supplements';
// E17 (batch 02): kitchen and pantry documents (SUITE_SPEC §13.3)
import './kitchen';
import './food/pantry';
// E20: blood markers (definitions and executors)
import './markers';

export { commandBus, dispatch, dispatchSync, getPorts, installPorts, jobs, manifest, on, outputOf, resetBusState, setOutputValidation } from './bus';
export { allCommands, commandRegistry, CommandFailure, defineCommand, fail, getCommand, notImplemented } from './registry';
export { implement, implementedBy, type Executor } from './implement';
export { mintConfirmation, consumeConfirmation, inputDigest, CONFIRMATION_TTL_MS } from './confirm';
export { changeSets, getChangeSet, seal, settleCommits, resetHistory, summary as changeSetSummary, loadChangeLog, pruneLocalLogs } from './history';
export { buildManifest, exclusions, manifestJson, manifestSummary, toolName, toolOf, toolsetHash } from './manifest';
export { currentPlannerJob } from './defs/planner';
export { currentDay, installLivingPorts, loadSessionCatalogue, readLivingDocs, runAssimilation, runRollover, startLivingAutomation, type LivingPorts } from './livingWiring';
export * from './types';
export { aiPorts, installAiPorts, type AiPorts, type GoalSuggester, type PhotoComponentGuess, type PhotoRecognition, type PhotoRecognizer } from './aiPorts';
