/**
 * Route paths (INFORMATION_ARCHITECTURE §2). Navigate with these helpers so
 * links stay valid if a path changes.
 */
export const paths = {
  root: '/',
  body: '/body',
  /** Redirect entry: the Simulator sends this to its active scenario. */
  simulate: '/simulate',
  schedule: (sid: string, day?: string) => `/simulate/${encodeURIComponent(sid)}/schedule${day ? `?day=${day}` : ''}`,
  results: (sid: string) => `/simulate/${encodeURIComponent(sid)}/results`,
  /** Redirect entry: the Planner sends this to goals or results. */
  plan: '/plan',
  planGoals: '/plan/goals',
  planRun: '/plan/run',
  planResults: '/plan/results',
  /** Ring: everything Gauge measures (`src/features/ring/paths.ts` has the tab and pushed-page helpers). */
  ring: '/ring',
  evidence: '/evidence',
  mechanism: (id: string) => `/evidence/${encodeURIComponent(id)}`,
  /** The model validation report (bundled copy of docs/VALIDATION_REPORT.md). */
  validationReport: '/evidence/validation',
  /** A research dossier's page: scope, its mechanisms, common claims, open questions, sources. */
  evidenceTopic: (slug: string) => `/evidence/topics/${encodeURIComponent(slug)}`,
  /** Settings, or one section's own page (`/settings/data`; the older `/settings#data` still opens it). */
  settings: (section?: 'units' | 'appearance' | 'heart' | 'steps' | 'kitchen' | 'supplements' | 'data' | 'sync' | 'coach' | 'agents' | 'install' | 'safety' | 'about') =>
    `/settings${section ? `/${section}` : ''}`,
  /** First run: welcome + safety questions + consent (outside the app shell). `review` explains why answers are shown again. */
  welcome: (step?: 'intro' | 'screening' | 'consent' | 'stop', review?: string) =>
    `/welcome${step ? `?step=${step}${review ? `&review=${encodeURIComponent(review)}` : ''}` : ''}`,
  /** Full disclaimer, safety limits and support ("Safety & limits"). */
  safety: '/safety',
  devComponents: '/dev/components',
  devCharts: '/dev/charts',
  devSafety: '/dev/safety',
  devAvatar: '/dev/avatar',
  /** 3D figure + visceral view spike (R2). */
  devFigure: '/dev/figure',
  /** Throws on render: checks the route error boundary. */
  devError: '/dev/error',
} as const;
