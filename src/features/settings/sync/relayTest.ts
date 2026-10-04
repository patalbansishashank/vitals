import { allowOrigin, isAllowed, netFetch } from '@/net/net';
import { relayHttpBase } from '@/sync/pairing';
import { SYNC_COPY } from './copy';

export type RelayTestResult = { ok: true; message: string; version?: string | null; ms?: number } | { ok: false; message: string };

/**
 * "Test before create" (design/screens/settings-sync-ai.md §4.2, §12): asks the address for `GET /health` and checks
 * that it is a Vitals sync relay, so nobody writes down 24 words for a server that isn't there.
 */
export async function testRelay(relayUrl: string, timeoutMs = 8000): Promise<RelayTestResult> {
  let base: string;
  let revoke: (() => void) | null = null;
  try {
    base = relayHttpBase(relayUrl);
    const had = isAllowed(base);
    const r = allowOrigin(base, 'sync');
    if (!had) revoke = r;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = performance.now();
  try {
    const res = await netFetch(`${base}/health`, { cache: 'no-store', credentials: 'omit', signal: ctrl.signal });
    const body = (res.ok ? await res.json().catch(() => null) : null) as { version?: unknown; roles?: unknown } | null;
    if (!body || !Array.isArray(body.roles) || !body.roles.includes('relay')) {
      revoke?.();
      return { ok: false, message: SYNC_COPY.testNotRelay };
    }
    const version = typeof body.version === 'string' ? body.version : null;
    const ms = Math.round(performance.now() - started);
    return { ok: true, message: SYNC_COPY.testOk(version, ms), version, ms };
  } catch {
    revoke?.();
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    return { ok: false, message: offline ? SYNC_COPY.testOffline : SYNC_COPY.testNoAnswer };
  } finally {
    clearTimeout(timer);
  }
}
