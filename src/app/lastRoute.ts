/**
 * Remembers the last planning destination, for "Planning tools" (it reopens Body, Simulate or the Planner where the
 * person left off) and the Welcome screen's return. It never decides the start screen: "/" is Today in every mode
 * (0.6.3). Settings and Safety & limits are not remembered, and a stored one from an older build reads as none, so
 * neither can become where the app opens.
 */
import { registerStore } from '@/state/persistence';

export const LAST_ROUTE_KEY = 'vitals.ui.lastRoute';
// '/welcome' is never remembered (it renders outside the shell); '/settings' and '/safety' no longer are (0.6.3).
const TOP_LEVEL = ['/body', '/simulate', '/plan', '/evidence', '/ring'];

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
