/** `app.status` and `nav.open` (SUITE_SPEC §1.9). */
import { getDocumentStore } from '@/state/runtime';
import { changeSets } from '../history';
import { defineCommand } from '../registry';
import { T } from '../schema';
import { ALL, UNDO } from './_shared';
/* ---------------------------------------------------------------- app */

export const appStatus = defineCommand({
  id: 'app.status',
  version: 1,
  title: 'App status',
  description: 'Mode (planning, until a plan starts), today’s date, the active scenario, whether a plan is running, sync state, storage engine and counts of scenarios, goals and recent changes.',
  input: T.Object({}),
  output: T.Object({
    mode: T.Enum(['planning', 'living']),
    today: T.String(),
    activeScenario: T.Nullable(T.Object({ id: T.String(), name: T.String() })),
    activePlan: T.Nullable(T.String()),
    sync: T.String(),
    storage: T.String(),
    counts: T.Object({ scenarios: T.Integer(), goals: T.Integer(), changeSets: T.Integer() }),
  }),
  perm: 'read',
  surfaces: ALL,
  excludedReason: { ui: 'the screens read the projection hooks directly' },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: async (ctx) => {
    // read lazily: loading this command must not load every store
    const [sched, planner] = await Promise.all([import('@/state/internal/schedule'), import('@/state/internal/planner')]);
    const active = sched.activeId();
    const sc = active ? sched.scenarioById(active) : undefined;
    const plan = getDocumentStore().peek<{ planId?: string | null }>('activePlan', 'me')?.planId ?? null;
    return {
      mode: plan ? ('living' as const) : ('planning' as const),
      today: ctx.today,
      activeScenario: sc ? { id: sc.id, name: sc.name } : null,
      activePlan: plan,
      sync: 'off',
      storage: getDocumentStore().engine,
      counts: { scenarios: sched.scenarios().length, goals: planner.goalSet().goals.length, changeSets: changeSets().length },
    };
  },
});

/* ---------------------------------------------------------------- nav */

export const ROUTES = {
  body: () => '/body',
  simulate: () => '/simulate',
  schedule: (p: Record<string, string>) => `/simulate/${encodeURIComponent(p.scenarioId ?? '')}/schedule`,
  results: (p: Record<string, string>) => `/simulate/${encodeURIComponent(p.scenarioId ?? '')}/results`,
  plan: () => '/plan',
  planGoals: () => '/plan/goals',
  planResults: () => '/plan/results',
  evidence: () => '/evidence',
  evidenceTopic: (p: Record<string, string>) => `/evidence/topics/${encodeURIComponent(p.slug ?? '')}`,
  settings: (p: Record<string, string>) => `/settings${p.section ? `#${p.section}` : ''}`,
  safety: () => '/safety',
  // intake (SUITE_SPEC §6.2 `/onboarding/:section`): activity · training · diet · kitchen · supplements · devices · summary
  onboarding: (p: Record<string, string>) => `/onboarding/${encodeURIComponent(p.section ?? 'activity')}${p.from ? `?from=${encodeURIComponent(p.from)}` : ''}`,
  // Living mode (SUITE_SPEC §6.2; E13 src/features/living/paths.ts)
  today: (p: Record<string, string>) => (p.date ? `/today/${encodeURIComponent(p.date)}` : '/today'),
  food: (p: Record<string, string>) => (p.date ? `/food/${encodeURIComponent(p.date)}` : '/food'),
  train: (p: Record<string, string>) => (p.date ? `/train/${encodeURIComponent(p.date)}` : '/train'),
  coach: (p: Record<string, string>) => (p.conversationId ? `/coach/${encodeURIComponent(p.conversationId)}` : '/coach'),
  progress: (p: Record<string, string>) => (p.metric ? `/progress/${encodeURIComponent(p.metric)}` : '/progress'),
  planActive: (p: Record<string, string>) => (p.version ? `/plan/active/versions/${encodeURIComponent(p.version)}` : '/plan/active'),
} as const;
export type RouteId = keyof typeof ROUTES;

export const navOpen = defineCommand({
  id: 'nav.open',
  version: 1,
  title: 'Open a screen',
  description:
    'Open a screen of the app: body, simulate, schedule or results (params.scenarioId), plan, planGoals, planResults, evidence, evidenceTopic (params.slug), settings (params.section), safety, onboarding (params.section: activity, training, diet, kitchen, supplements, devices or summary), today, food or train (params.date), coach (params.conversationId), progress (params.metric), planActive (params.version).',
  input: T.Object({ route: T.Enum(Object.keys(ROUTES) as RouteId[]), params: T.Optional(T.Record(T.String())) }),
  output: T.Object({ opened: T.Boolean(), path: T.String() }),
  perm: 'read',
  surfaces: ['ui', 'ai', 'webmcp'],
  excludedReason: { ui: 'screens navigate with the router', mcp: 'an MCP client has no app screen to open' },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: ['ui'],
  execute: (ctx, input) => {
    const path = ROUTES[input.route](input.params ?? {});
    const opened = ctx.ports.navigate ? ctx.ports.navigate(path, input.params) : false;
    return { opened, path };
  },
});

declare module '../types' {
  interface CommandMap {
    'app.status': typeof appStatus;
    'nav.open': typeof navOpen;
  }
}
