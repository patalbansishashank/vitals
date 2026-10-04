/** Remembers the last top-level destination so "/" can return the user there (IA §2). */
import { registerStore } from '@/state/persistence';

export const LAST_ROUTE_KEY = 'vitals.ui.lastRoute';
// '/safety' (Safety & limits) is a destination too; '/welcome' is never remembered (it renders outside the shell).
const TOP_LEVEL = ['/body', '/simulate', '/plan', '/evidence', '/settings', '/safety'];

registerStore(LAST_ROUTE_KEY, 1, { label: 'last screen', describe: () => null, syncable: false });

export function rememberRoute(pathname: string): void {
  const top = TOP_LEVEL.find((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!top) return;
  try {
    localStorage.setItem(LAST_ROUTE_KEY, JSON.stringify({ state: top, version: 1 }));
  } catch {
    /* storage blocked */
  }
}

export function lastRoute(): string | null {
  try {
    const raw = localStorage.getItem(LAST_ROUTE_KEY);
    if (!raw) return null;
    const v = (JSON.parse(raw) as { state?: unknown }).state;
    return typeof v === 'string' && TOP_LEVEL.includes(v) ? v : null;
  } catch {
    return null;
  }
}
