/** Living-mode routes (design/INFORMATION_ARCHITECTURE.md §2.1; docs/SUITE_SPEC.md §6.2). Link with these helpers. */
export const livingPaths = {
  today: (date?: string) => (date ? `/today/${date}` : '/today'),
  food: (date?: string, hash?: 'meals' | 'groceries' | 'supplements') => `${date ? `/food/${date}` : '/food'}${hash ? `#${hash}` : ''}`,
  train: (date?: string, hash?: 'session' | 'equipment' | 'buy') => `${date ? `/train/${date}` : '/train'}${hash ? `#${hash}` : ''}`,
  coach: (conversationId?: string) => (conversationId ? `/coach/${encodeURIComponent(conversationId)}` : '/coach'),
  progress: (metric?: string, hash?: 'trend' | 'goals' | 'adherence' | 'body' | 'signals' | 'log' | 'checkins' | 'plan') =>
    `${metric ? `/progress/${encodeURIComponent(metric)}` : '/progress'}${hash ? `#${hash}` : ''}`,
  planActive: '/plan/active',
  planVersion: (n: number) => `/plan/active/versions/${n}`,
  /** "Re-plan from scratch": the planning screens with the active plan's goals prefilled. */
  replanFromScratch: '/plan/goals?from=active',
} as const;

/** Top-level Living routes (for the shell: remembered routes, return key, mode-aware nav). */
export const LIVING_ROUTE_PREFIXES = ['/today', '/food', '/train', '/coach', '/progress', '/plan/active'] as const;

export function isLivingPath(pathname: string): boolean {
  return LIVING_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
