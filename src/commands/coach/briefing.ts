/**
 * `briefing.get` (plan 04 item 12): the Coach's briefing for an agent that reaches Vitals only through tools (MCP,
 * WebMCP). It calls the Coach's own builder (`gatherBriefingData` + `buildBriefing`, `@/ai/coach/briefing`), so the two
 * cannot drift: the same reads, done as the `ai` actor, so the person's "Change what it can see" switches hide the same
 * things from both. Proposals waiting for the person are only counted (agents cannot read `coach.pending`). The Coach
 * itself is handed the briefing every turn and does not get this tool.
 */
import { buildBriefing, gatherBriefingData } from '@/ai/coach/briefing';
import type { CoachBus } from '@/ai/coach/tools';
import { estimateTextTokens } from '@/ai/providers/usage';
import { BRIEFING_MAX_TOKENS, TOOL_RESULT_MAX_TOKENS } from '@/ai/tools/budget';
import { addDays } from '@/living/dates';
import { allCommands, defineCommand, getCommand } from '../registry';
import { T } from '../schema';
import { UNDO } from '../defs/_shared';

const BriefingView = T.Object({
  text: T.String({ description: 'The briefing, plain text (the same text the Coach receives).' }),
  sections: T.Array(T.String(), { description: 'Ids of the sections kept, in order.' }),
  dropped: T.Array(T.String(), { description: 'Ids of the sections left out to keep it short.' }),
  truncated: T.Array(T.String(), { description: 'Ids of the sections cut short.' }),
  tokens: T.Integer({ minimum: 0 }),
  quiet: T.Boolean({ description: 'Quiet mode is on: no calorie talk, no weight-loss suggestions, no numeric scores.' }),
  noPlanning: T.Boolean({ description: 'The safety mode does not allow changing the plan.' }),
  today: T.Date(),
  generatedAt: T.String(),
});

export const briefingGet = defineCommand({
  id: 'briefing.get',
  version: 1,
  title: 'Read the person’s briefing',
  description:
    'Call this first. The person’s briefing as plain text: today’s date and time zone, safety mode, today’s plan and what is logged, profile, goals, supplements, blood tests, kitchen and pantry, the last 7 days and questions still open. The same briefing the Coach in the app works from; things the person hid from the Coach are left out.',
  input: T.Object({}),
  output: BriefingView,
  perm: 'read',
  surfaces: ['ui', 'webmcp', 'mcp'],
  excludedReason: {
    ui: 'the Coach panel shows "What the Coach knows" from the same reads',
    ai: 'the Coach already receives this briefing every turn',
  },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: async (ctx) => {
    const { dispatch, manifest, on } = await import('../bus');
    const bus: CoachBus = {
      dispatch: (id, input, opts) => dispatch(id, input, opts),
      manifest: () => manifest('ai'),
      getCommand: (id) => getCommand(id),
      commandIds: () => allCommands().map((d) => d.id),
      on: (l) => on(l),
    };
    const data = await gatherBriefingData(bus, new Date(ctx.now), ctx.today, addDays, ctx.tz);
    const view = (max: number) => {
      const b = buildBriefing(data, { provider: null, max, pendingCountOnly: true });
      return {
        text: b.text,
        sections: b.sections.map((s) => s.id),
        dropped: b.dropped,
        truncated: b.truncated,
        tokens: Math.max(0, Math.round(b.tokens)),
        quiet: b.quiet,
        noPlanning: b.noPlanning,
        today: ctx.today,
        generatedAt: ctx.now,
      };
    };
    // the Coach's size first; only a briefing whose JSON (escaped quotes and newlines) would not fit one tool result is
    // fitted shorter by the same builder, so an agent never gets it cut in the middle
    const out = view(BRIEFING_MAX_TOKENS);
    const size = estimateTextTokens(JSON.stringify(out));
    return size <= TOOL_RESULT_MAX_TOKENS - 200 ? out : view(Math.floor((BRIEFING_MAX_TOKENS * (TOOL_RESULT_MAX_TOKENS - 200)) / size));
  },
});

declare module '../types' {
  interface CommandMap {
    'briefing.get': typeof briefingGet;
  }
}
