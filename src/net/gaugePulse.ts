/**
 * (r069 sync) The Gauge pulse client: `GET /v1/gauge/pulse?since=&wait=` (packages/companion `gaugePulse.ts`). The
 * server holds the request while `since` is current and answers when Gauge uploads (or detection writes), so Vitals
 * reads again within a second of new data landing instead of at its next 5-minute import.
 *
 * An older server has no such route (404): `not_supported`, and the caller stops asking for a while.
 */
import { ServerError, getServerClient, type ServerClient } from './server';

export interface GaugePulse {
  /** What to send back as `since`. */
  token: string;
  /** The server run: another one means every counter started again. */
  boot: string;
  /** Every upload Gauge made that the server took. */
  uploads: number;
  /** Uploads with new readings, and detection runs that wrote. */
  data: number;
  /** When Gauge's last upload reached the server (ISO) in this server run. */
  lastUploadAt: string | null;
  dataAt: string | null;
}

export type GaugePulseAnswer = { ok: true; pulse: GaugePulse } | { ok: false; problem: 'not_paired' | 'unauthorized' | 'not_supported' | 'offline' | 'server_error' };

/** The server holds at most this long. */
export const PULSE_WAIT_S = 25;
const SLACK_MS = 15_000;

type Server = Pick<ServerClient, 'chatModelOptions' | 'isPaired'>;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

/** The answer's pulse, or null when it is not one. */
export function pulseOf(body: unknown): GaugePulse | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const token = str(b.token);
  const boot = str(b.boot);
  const uploads = count(b.uploads);
  const data = count(b.data);
  if (!token || !boot || uploads === null || data === null) return null;
  return { token, boot, uploads, data, lastUploadAt: str(b.lastUploadAt), dataAt: str(b.dataAt) };
}

/** Did `next` bring data `prev` had not seen? A new server run counts as yes (its counters started again). */
export function pulseMovedData(prev: GaugePulse | null, next: GaugePulse): boolean {
  if (!prev) return false;
  return prev.boot !== next.boot || next.data !== prev.data;
}

export function createGaugePulseApi(opts: { server?: Server | (() => Server) } = {}) {
  const serverOf = (): Server => (typeof opts.server === 'function' ? opts.server() : (opts.server ?? getServerClient()));
  return {
    /** One read; with `since`, held up to `wait` s while nothing moved. */
    async pulse(since: string | null, o: { wait?: number; signal?: AbortSignal } = {}): Promise<GaugePulseAnswer> {
      const server = serverOf();
      if (!server.isPaired()) return { ok: false, problem: 'not_paired' };
      let base: string;
      let doFetch: typeof fetch;
      try {
        const w = server.chatModelOptions();
        base = w.serverUrl.replace(/\/+$/, '');
        doFetch = w.deps.fetch;
      } catch (e) {
        return { ok: false, problem: e instanceof ServerError && e.code === 'not_paired' ? 'not_paired' : 'offline' };
      }
      const wait = since ? Math.min(PULSE_WAIT_S, Math.max(0, o.wait ?? PULSE_WAIT_S)) : 0;
      const qs = new URLSearchParams();
      if (since) {
        qs.set('since', since);
        qs.set('wait', String(wait));
      }
      const ctl = new AbortController();
      const onAbort = () => ctl.abort();
      if (o.signal?.aborted) ctl.abort();
      else o.signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => ctl.abort(), wait * 1000 + SLACK_MS);
      let res: Response;
      try {
        res = await doFetch(`${base}/v1/gauge/pulse${since ? `?${qs.toString()}` : ''}`, { method: 'GET', headers: { accept: 'application/json' }, signal: ctl.signal, cache: 'no-store' });
      } catch (e) {
        if (o.signal?.aborted) throw e;
        if (e instanceof ServerError && e.code === 'not_paired') return { ok: false, problem: 'not_paired' };
        return { ok: false, problem: 'offline' };
      } finally {
        clearTimeout(timer);
        o.signal?.removeEventListener('abort', onAbort);
      }
      if (res.status === 401 || res.status === 403) return { ok: false, problem: 'unauthorized' };
      if (res.status === 404) return { ok: false, problem: 'not_supported' };
      if (!res.ok) return { ok: false, problem: 'server_error' };
      let pulse: GaugePulse | null;
      try {
        pulse = pulseOf((await res.json()) as unknown);
      } catch {
        pulse = null;
      }
      return pulse ? { ok: true, pulse } : { ok: false, problem: 'server_error' };
    },
  };
}

export type GaugePulseApi = ReturnType<typeof createGaugePulseApi>;

/** The app's pulse client, over the app's server client (read on every call). */
export const gaugePulseApi: GaugePulseApi = createGaugePulseApi({ server: () => getServerClient() });
