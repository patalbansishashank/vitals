/**
 * Is the server coach ready (`GET /v1/coach/status`)? The CLI must be installed and signed in (`claude auth status`,
 * `codex login status`), checked at most every few minutes and again after a turn failed on sign-in. A usage limit seen
 * in the last minutes keeps the coach available with a "busy" note.
 */
import type { CoachBackend } from './backends.ts';
import type { CoachBackendName, CoachConfig } from './config.ts';
import { accessSync, constants } from 'node:fs';

export const STATUS_TTL_MS = 3 * 60_000;
export const BUSY_NOTE_MS = 5 * 60_000;

export const REASONS = {
  disabled: 'The coach is not set up on your server.',
  not_installed: "The server's AI is not installed.",
  not_signed_in: "The server's AI is not signed in.",
  no_loopback: 'The coach needs the server to listen on its own loopback address.',
  busy: "The server's AI is busy; replies may be slow.",
} as const;

export interface Readiness {
  available: boolean;
  backend: CoachBackendName;
  reason?: string;
}

const executable = (p: string | null) => {
  if (!p) return false;
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export function createReadiness(o: { cfg: CoachConfig; backends: Record<CoachBackendName, CoachBackend>; loopback: () => boolean; now: () => number }) {
  const { cfg, backends, now } = o;
  const cache = new Map<CoachBackendName, { at: number; value: Promise<Readiness> }>();
  let usageLimitAt = -Infinity;
  /** The primary failed on sign-in or its plan limit before any answer: new sessions use the fallback for a while. */
  let primaryDownAt = -Infinity;

  const check = async (name: CoachBackendName): Promise<Readiness> => {
    if (!cfg.enabled) return { available: false, backend: name, reason: REASONS.disabled };
    if (!o.loopback()) return { available: false, backend: name, reason: REASONS.no_loopback };
    const b = backends[name];
    if (!executable(b.binary)) return { available: false, backend: name, reason: REASONS.not_installed };
    if (!(await b.signedIn())) return { available: false, backend: name, reason: REASONS.not_signed_in };
    return { available: true, backend: name };
  };
  const of = (name: CoachBackendName): Promise<Readiness> => {
    const c = cache.get(name);
    if (c && now() - c.at < STATUS_TTL_MS) return c.value;
    const value = check(name);
    cache.set(name, { at: now(), value });
    value.catch(() => cache.delete(name));
    return value;
  };

  return {
    /** The backend new sessions get, and whether it can answer. */
    async current(): Promise<Readiness> {
      const primary = await of(cfg.backend);
      const fallback = cfg.fallback === 'codex' && cfg.backend !== 'codex' ? 'codex' : null;
      const primaryOk = primary.available && now() - primaryDownAt > BUSY_NOTE_MS;
      let r = primary;
      if (!primaryOk && fallback) {
        const f = await of(fallback);
        if (f.available) r = f;
      }
      if (r.available && now() - usageLimitAt < BUSY_NOTE_MS) return { ...r, reason: REASONS.busy };
      return r;
    },
    /** After a turn: a usage limit adds the busy note, a sign-in failure re-checks soon. */
    noteFailure(name: CoachBackendName, failure: 'usage_limit' | 'coach_unavailable', beforeAnyText: boolean) {
      if (failure === 'usage_limit') usageLimitAt = now();
      if (failure === 'coach_unavailable') cache.delete(name);
      if (beforeAnyText && name === cfg.backend) primaryDownAt = now();
    },
    invalidate: () => cache.clear(),
  };
}

export type CoachReadiness = ReturnType<typeof createReadiness>;
