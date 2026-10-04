/**
 * The Coach's tools (SUITE_SPEC §1.8, §5.2, §5.7; docs/COMMANDS.md): generated from the command registry's `ai`
 * manifest, classed by permission and impact, plus the paged `get_*` data tools and the `app_load_tools` meta-tool.
 *
 *   read                      → runs
 *   log   (write, low impact) → applied at once, Undo card
 *   edit  (consequential, or a low-impact command that returns a proposal) → proposal card (staged by the bus as a
 *         `pendingChanges` document; low-impact proposals are dry-run here) unless "small edits without asking" is on
 *         and the impact is low
 *   destructive               → never executed by the model: a card the person confirms with the typed confirmation
 *   blocked                   → safety-loosening commands and anything not on the `ai` surface
 *
 * Tier H: no UI imports; the bus is injected (`CoachBus`).
 */
import type { CommandDef, CommandResult, DispatchOptions, ToolDescriptor, BusEvent } from '@/commands/types';
import type { JsonSchema, ToolSpec } from '../providers/types';
import { ToolRegistry, toolNameOf } from '../tools/registry';
import type { AiCommandDef, ConfirmClass } from '../tools/types';

/** The slice of the command bus the Coach uses (`@/commands` in the app; the same in tests). */
export interface CoachBus {
  dispatch(id: string, input: unknown, opts?: DispatchOptions): Promise<CommandResult>;
  /** The `ai` surface manifest (generated from the registry). */
  manifest(): ToolDescriptor[];
  getCommand(id: string): CommandDef | undefined;
  /** Every registered command id (to recognise commands the model names that are not on the `ai` surface). */
  commandIds(): string[];
  on(listener: (e: BusEvent) => void): () => void;
}

export type ToolClass = ConfirmClass;
export type Tier = 'full' | 'basic';

/** Spec core group (SUITE_SPEC §1.8) plus the Coach's own needs (swap, notes, retract, proposals, safety status). */
export const CORE_TOOLS: readonly string[] = [
  'app.status', 'nav.open', 'history.undo', 'job.status', 'profile.get', 'profile.patch', 'intake.answer', 'intake.nextQuestions',
  'today.get', 'log.get', 'log.meal', 'log.mealFromPhoto', 'log.session', 'log.fast', 'log.measurement', 'log.markDay',
  'log.bulk', 'log.note', 'log.retract', 'log.steps', 'log.sleep', 'log.supplement', 'log.subjective', 'plan.get',
  'plan.declareEvent', 'plan.shift', 'plan.replan', 'plan.drift', 'plan.swapExercise', 'plan.editDay', 'plan.end',
  'sim.whatIf', 'sim.series', 'sim.explain', 'bio.daily', 'catalogue.searchExercises', 'catalogue.searchFoods',
  'food.planDay', 'evidence.search', 'coach.pending', 'coach.discardPending', 'safety.status',
  // E20: blood test results (a report the person attaches is read with markers.import)
  'markers.get', 'markers.import',
];

/** Low-impact writes whose result is a proposal (they take the edit path). */
const PROPOSES = /\b(returns? (a |the )?(re-plan )?proposal|proposes?)\b/i;

/** Safety-relevant setting keys (SUITE_SPEC §5.7: the AI may tighten, never loosen). */
const SAFETY_SETTING = /safety|fast|quiet|age|screen|stream|policy|sync|agent|key|ack|illness|consent|minimal/i;

export function classOf(def: Pick<CommandDef, 'perm' | 'impact' | 'description'>): ToolClass {
  if (def.perm === 'read') return 'read';
  if (def.perm === 'destructive') return 'destructive';
  if (def.impact === 'consequential') return 'edit';
  return PROPOSES.test(def.description) ? 'edit' : 'log';
}

/**
 * The model can never loosen safety (SUITE_SPEC §5.7): `safety.*` writes other than reporting an illness (which only
 * tightens), safety-relevant settings, and resuming a plan the safety rules paused. Returns the rule in plain words.
 */
export function safetyLoosening(id: string, input: unknown, perm?: CommandDef['perm']): string | null {
  if (id.startsWith('safety.') && perm !== 'read' && id !== 'safety.reportIllness') return 'Your safety answers, acknowledgements and fasting opt-ins are only changed by you, in the app.';
  if (id === 'settings.update') {
    const patch = input && typeof input === 'object' ? (input as { patch?: unknown }).patch : undefined;
    const keys = patch && typeof patch === 'object' ? Object.keys(patch) : [];
    const bad = keys.find((k) => SAFETY_SETTING.test(k));
    if (bad) return 'Safety-related settings are only changed by you, in Settings.';
  }
  if (id.startsWith('agents.') || id === 'ai.configure' || id.startsWith('sync.') && perm !== 'read') return 'Only you can change that, in Settings.';
  return null;
}

/* ------------------------------------------------------------------------------------------------ get_* tools */

const PAGE = { cursor: { type: 'string', description: 'Opaque cursor from the previous page ("more").' }, limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Items per page (default 30).' } };
const DATE: JsonSchema = { type: 'string', description: 'YYYY-MM-DD' };

export interface PagedTool {
  id: `get.${string}`;
  title: string;
  description: string;
  input: JsonSchema;
  /** The read command it maps onto and how the input is passed. */
  command: string;
  toCommandInput: (args: Record<string, unknown>) => unknown;
}

export const PAGED_TOOLS: readonly PagedTool[] = [
  {
    id: 'get.log', title: 'Read the log', command: 'log.get',
    description: 'Logged entries between two dates (inclusive), optionally by kind (meal, session, measurement, fast, steps, sleep, note…). Paged: pass `cursor` from "more" for the next page.',
    input: { type: 'object', properties: { from: DATE, to: DATE, kinds: { type: 'array', items: { type: 'string' } }, ...PAGE }, required: ['from', 'to'], additionalProperties: false },
    toCommandInput: (a) => ({ from: a.from, to: a.to, ...(a.kinds ? { kinds: a.kinds } : {}) }),
  },
  {
    id: 'get.day', title: 'Read a day', command: 'day.get',
    description: 'One day’s record: prescription snapshot, entries, marks and score. Omit `date` for today.',
    input: { type: 'object', properties: { date: DATE, ...PAGE }, additionalProperties: false },
    toCommandInput: (a) => (a.date ? { date: a.date } : {}),
  },
  {
    id: 'get.today', title: 'Read today', command: 'today.get',
    description: 'Today’s prescription, what was logged, what remains, adherence, drift and notices.',
    input: { type: 'object', properties: { date: DATE, ...PAGE }, additionalProperties: false },
    toCommandInput: (a) => (a.date ? { date: a.date } : {}),
  },
  {
    id: 'get.plan', title: 'Read the plan', command: 'plan.get',
    description: 'The running plan: name, rung, day N of M, status, head version and what today prescribes.',
    input: { type: 'object', properties: { ...PAGE }, additionalProperties: false },
    toCommandInput: () => ({}),
  },
  {
    id: 'get.scores', title: 'Read adherence scores', command: 'plan.adherence',
    description: 'Daily adherence scores (0–100, with coverage) between two dates and the 7- and 28-day trend. Paged.',
    input: { type: 'object', properties: { from: DATE, to: DATE, ...PAGE }, additionalProperties: false },
    toCommandInput: (a) => ({ ...(a.from ? { from: a.from } : {}), ...(a.to ? { to: a.to } : {}) }),
  },
  {
    id: 'get.goals', title: 'Read the goals', command: 'goals.get',
    description: 'The person’s ranked goals with targets and limits.',
    input: { type: 'object', properties: { ...PAGE }, additionalProperties: false },
    toCommandInput: () => ({}),
  },
  {
    id: 'get.notes', title: 'Search earlier conversations', command: 'coach.searchNotes',
    description: 'Search notes and day summaries of earlier Coach conversations (decisions, preferences, open questions). Paged.',
    input: { type: 'object', properties: { q: { type: 'string', minLength: 1, maxLength: 200 }, ...PAGE }, required: ['q'], additionalProperties: false },
    toCommandInput: (a) => ({ q: a.q }),
  },
];

export const LOAD_TOOLS_ID = 'app.loadTools';

/* ------------------------------------------------------------------------------------------------ toolset */

export interface ResolvedTool {
  name: string;
  kind: 'command' | 'paged' | 'loadTools';
  /** Command id (for `paged`, the command it maps onto). */
  id: string;
  cls: ToolClass;
  title: string;
  def?: CommandDef;
  descriptor?: ToolDescriptor;
  paged?: PagedTool;
}

export interface ToolsetOptions {
  tier: Tier;
  /** Safety mode without planning: no plan-changing tools (living-mode.md §7.5). */
  noPlanning?: boolean;
  /** Domains loaded with `app_load_tools` for this segment. */
  loadedGroups?: readonly string[];
}

/** Builds the tool list for one turn and resolves the model's tool names (including names it was not sent). */
export class CoachToolset {
  private readonly byName = new Map<string, ResolvedTool>();
  private readonly registry: ToolRegistry;
  private readonly descriptors: ToolDescriptor[];

  constructor(private readonly bus: CoachBus) {
    this.descriptors = bus.manifest().filter((d) => !d.notImplemented);
    const defs: AiCommandDef[] = [];
    for (const d of this.descriptors) {
      const def = bus.getCommand(d.commandId);
      if (!def) continue;
      const cls = classOf(def);
      defs.push({ id: d.commandId as AiCommandDef['id'], namespace: d.group, title: d.title, description: d.description.slice(0, 600), input: d.inputSchema as JsonSchema, confirm: cls, ...(def.aiLimit ? { aiLimit: def.aiLimit } : {}) });
      this.byName.set(d.name, { name: d.name, kind: 'command', id: d.commandId, cls, title: d.title, def, descriptor: d });
    }
    for (const p of PAGED_TOOLS) {
      if (!this.descriptors.some((d) => d.commandId === p.command)) continue;
      defs.push({ id: p.id as AiCommandDef['id'], namespace: 'get', title: p.title, description: p.description, input: p.input, confirm: 'read' });
      this.byName.set(toolNameOf(p.id), { name: toolNameOf(p.id), kind: 'paged', id: p.command, cls: 'read', title: p.title, paged: p });
    }
    const groups = [...new Set(this.descriptors.map((d) => d.group))].sort();
    defs.push({
      id: LOAD_TOOLS_ID as AiCommandDef['id'],
      namespace: 'app',
      title: 'Load more tools',
      description: `Add the tools of one or more domains for the rest of this conversation segment. Domains: ${groups.join(', ')}.`,
      input: { type: 'object', properties: { groups: { type: 'array', items: { type: 'string', enum: groups }, minItems: 1 } }, required: ['groups'], additionalProperties: false },
      confirm: 'read',
    });
    this.byName.set(toolNameOf(LOAD_TOOLS_ID), { name: toolNameOf(LOAD_TOOLS_ID), kind: 'loadTools', id: LOAD_TOOLS_ID, cls: 'read', title: 'Load more tools' });
    this.registry = new ToolRegistry(defs);
  }

  /** Resolve a tool name the model used; `excluded` when it names a command that exists but is not on the `ai` surface. */
  resolve(name: string): ResolvedTool | { excluded: CommandDef } | null {
    const hit = this.byName.get(name);
    if (hit) return hit;
    // a name the model invented from a command it is not given (coach_delete, safety_set_fasting_opt_in…)
    for (const id of this.bus.commandIds()) {
      if (toolNameOf(id) === name) {
        const def = this.bus.getCommand(id);
        if (def) return { excluded: def };
      }
    }
    return null;
  }

  /** Whether a class may run for this tier / safety mode. */
  allows(tool: ResolvedTool, opts: ToolsetOptions): boolean {
    if (opts.tier === 'basic' && (tool.cls === 'edit' || tool.cls === 'destructive')) return false;
    if (opts.noPlanning && tool.cls !== 'read' && (tool.id.startsWith('plan.') || tool.id.startsWith('planner.') || tool.id.startsWith('scenario.') || tool.id.startsWith('goals.'))) return false;
    return true;
  }

  /** The tool specs for one request. */
  specs(opts: ToolsetOptions): ToolSpec[] {
    const groups = new Set(opts.loadedGroups ?? []);
    const core = new Set(CORE_TOOLS);
    const out: ToolSpec[] = [];
    for (const spec of this.registry.toolSpecs({ tier: 'full' })) {
      const tool = this.byName.get(spec.name);
      if (!tool) continue;
      if (!this.allows(tool, opts)) continue;
      const inScope = tool.kind !== 'command' || core.has(tool.id) || groups.has(tool.id.slice(0, tool.id.indexOf('.')));
      if (!inScope) continue;
      out.push(spec);
    }
    return out;
  }

  /** Every tool name the toolset knows (tests). */
  names(): string[] {
    return [...this.byName.keys()];
  }
}
