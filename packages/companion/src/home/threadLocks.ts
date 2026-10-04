/**
 * A Web Locks `LockManager` that lives in one thread (one Evolu platform instance), for the server's person workers.
 *
 * Why: Node's `navigator.locks` is shared by every thread of the process. On Node 24.21 a pending request in one thread
 * wakes the other threads in a loop: two idle person workers each spent about half their time awake, and with three
 * workers on oci-arm's two cores every worker stopped answering while the process grew by about 45 MB a second outside
 * any JavaScript heap (the 2026-10-03 incidents, docs/wp/E34.md). Evolu's locks only order the store's own parts, which
 * all run in the person's thread, so nothing needs to cross threads.
 *
 * What Evolu uses (its leader locks): `request(name, { mode: 'exclusive', signal }, callback)` and `query()`. Shared
 * mode and `ifAvailable` follow the Web Locks rules too; `steal` is not supported (nothing uses it).
 */

type Mode = 'exclusive' | 'shared';
interface Options {
  mode?: Mode;
  signal?: AbortSignal;
  ifAvailable?: boolean;
}
type Callback = (lock: { name: string; mode: Mode } | null) => unknown;
interface Waiter {
  mode: Mode;
  run: () => void;
}
interface LockInfo {
  name: string;
  mode: Mode;
  clientId: string;
}

const abortError = (signal: AbortSignal) => (signal.reason instanceof Error ? signal.reason : new DOMException('The lock request was aborted.', 'AbortError'));

export function createThreadLockManager() {
  const held = new Map<string, { mode: Mode; count: number }>();
  const queues = new Map<string, Waiter[]>();

  const grantable = (name: string, mode: Mode) => {
    const h = held.get(name);
    return !h || (h.mode === 'shared' && mode === 'shared' && !(queues.get(name)?.length));
  };
  const release = (name: string) => {
    const h = held.get(name);
    if (!h) return;
    if (--h.count === 0) held.delete(name);
    pump(name);
  };
  const pump = (name: string) => {
    const q = queues.get(name);
    while (q?.length) {
      const h = held.get(name);
      const next = q[0]!;
      if (h && !(h.mode === 'shared' && next.mode === 'shared')) break;
      q.shift();
      next.run();
    }
    if (q && !q.length) queues.delete(name);
  };
  const take = (name: string, mode: Mode) => {
    const h = held.get(name);
    if (h) h.count++;
    else held.set(name, { mode, count: 1 });
  };

  function request(name: string, optionsOrCallback: Options | Callback, maybeCallback?: Callback): Promise<unknown> {
    const [options, callback] = typeof optionsOrCallback === 'function' ? [{} as Options, optionsOrCallback] : [optionsOrCallback ?? {}, maybeCallback!];
    const mode: Mode = options.mode ?? 'exclusive';
    const { signal } = options;
    if (signal?.aborted) return Promise.reject(abortError(signal));
    const granted = () => {
      take(name, mode);
      let out: Promise<unknown>;
      try {
        out = Promise.resolve(callback({ name, mode }));
      } catch (e) {
        out = Promise.reject(e);
      }
      return out.finally(() => release(name));
    };
    if ((options as { steal?: boolean }).steal) return Promise.reject(new DOMException('steal is not supported here.', 'NotSupportedError'));
    if (grantable(name, mode)) return granted();
    if (options.ifAvailable) return Promise.resolve().then(() => callback(null));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        mode,
        run: () => {
          signal?.removeEventListener('abort', onAbort);
          granted().then(resolve, reject);
        },
      };
      const onAbort = () => {
        const q = queues.get(name);
        const i = q?.indexOf(waiter) ?? -1;
        if (i < 0) return;
        q!.splice(i, 1);
        if (!q!.length) queues.delete(name);
        reject(abortError(signal!));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      const q = queues.get(name);
      if (q) q.push(waiter);
      else queues.set(name, [waiter]);
    });
  }

  return {
    request,
    query: async (): Promise<{ held: LockInfo[]; pending: LockInfo[] }> => ({
      held: [...held].map(([name, h]) => ({ name, mode: h.mode, clientId: 'thread' })),
      pending: [...queues].flatMap(([name, q]) => q.map((w) => ({ name, mode: w.mode, clientId: 'thread' }))),
    }),
  };
}
