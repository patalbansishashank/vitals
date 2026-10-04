/**
 * Retry policy (R8 §1.7): exponential backoff with full jitter, `delay = random(0,1) · min(cap, base · 2^n)`,
 * base 1 s, cap 30 s, at most 4 tries in total. A readable `retry-after` wins over the computed delay (still capped).
 * Only the request phase is retried: once a stream has started, a retry would duplicate output, so mid-stream errors
 * surface to the caller.
 */
import { ProviderError } from './errors';

export interface RetryPolicy {
  tries: number;
  baseMs: number;
  capMs: number;
}

export const RETRY_POLICY: RetryPolicy = { tries: 4, baseMs: 1000, capMs: 30_000 };

export interface RetryDeps {
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  /** Observes each scheduled retry (attempt index from 1, delay, error). */
  onRetry?: (attempt: number, delayMs: number, error: ProviderError) => void;
}

/** Delay before retry number `attempt` (0-based count of failures so far). */
export function backoffDelay(attempt: number, policy: RetryPolicy, random: () => number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return Math.min(policy.capMs, retryAfterMs);
  return Math.floor(random() * Math.min(policy.capMs, policy.baseMs * 2 ** attempt));
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ProviderError({ kind: 'aborted', message: 'Stopped', retryable: false }));
    const t = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(t);
      reject(new ProviderError({ kind: 'aborted', message: 'Stopped', retryable: false }));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Runs `fn` until it succeeds, throws a non-retryable error, or the tries run out. Non-ProviderErrors pass through. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  deps: RetryDeps = {},
  signal?: AbortSignal,
  policy: RetryPolicy = RETRY_POLICY,
): Promise<T> {
  const sleep = deps.sleep ?? abortableSleep;
  const random = deps.random ?? Math.random;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (!(err instanceof ProviderError) || !err.retryable || attempt + 1 >= policy.tries || signal?.aborted) throw err;
      const delay = backoffDelay(attempt, policy, random, err.retryAfterMs);
      deps.onRetry?.(attempt + 1, delay, err);
      await sleep(delay, signal);
    }
  }
}
