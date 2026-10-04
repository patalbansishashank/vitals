/**
 * Calls to the person's own server about the Lumen Health MQTT feed (SUITE_SPEC §14.5): status, broker logins and
 * "allow a new phone". Everything goes through `netFetch`; the device token travels in the Authorization header and
 * never in a URL. The server connection is whatever the pairing stored (`vitals.server.v1`, §14.2) unless a caller
 * installs one with `setServerConnection`.
 */
import { allowOrigin, isAllowed, netFetch } from './net';
import { SERVER_KEY } from './server';

export interface ServerConnection {
  baseUrl: string;
  token: string;
}
export interface MqttCredential {
  address: string;
  username: string;
  password: string;
  baseTopic: string;
}
export interface MqttStatus {
  enabled: boolean;
  address: string | null;
  credentials: Array<{ username: string; createdAt: string; connected: boolean; lastConnectAt: string | null }>;
  lastEventAt: string | null;
  eventsToday: Array<{ stream: string; count: number }>;
  /** Newest battery reading of the ring (servers before 0.4.1 leave it out). */
  battery?: { percent: number; at: string } | null;
  /** `byReason`: counts over the last 7 days (servers before 0.4.1 leave it out). */
  deadLetters: { today: number; last7d: number; lastReason: string | null; byReason?: Record<string, number> };
}

export class MqttRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`The server answered ${status}${code ? ` (${code})` : ''}.`);
    this.name = 'MqttRequestError';
  }
}

/** The pairing record written by `./server.ts` (same key, same `baseUrl` and `token` fields). */
export const SERVER_STORAGE_KEY = SERVER_KEY;
let override: ServerConnection | null | undefined;
const listeners = new Set<() => void>();

/** Wire the paired server in (or `null` for none). Pass `undefined` to go back to reading the stored pairing. */
export function setServerConnection(c: ServerConnection | null | undefined): void {
  override = c;
  listeners.forEach((l) => l());
}

export function subscribeServerConnection(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getServerConnection(): ServerConnection | null {
  if (override !== undefined) return override;
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(SERVER_STORAGE_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<ServerConnection>) : null;
    return v && typeof v.baseUrl === 'string' && typeof v.token === 'string' ? { baseUrl: v.baseUrl, token: v.token } : null;
  } catch {
    return null;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const conn = getServerConnection();
  if (!conn) throw new MqttRequestError(0, 'not_paired');
  if (!isAllowed(conn.baseUrl)) allowOrigin(conn.baseUrl, 'server'); // the pairing is the person's consent for this origin
  const res = await netFetch(new URL(path, conn.baseUrl).toString(), {
    method,
    headers: { Authorization: `Bearer ${conn.token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    // V2: a server that accepts and never answers would leave the card waiting for ever
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    let code: string | null = null;
    try {
      const j = (await res.json()) as { error?: unknown };
      code = typeof j.error === 'string' ? j.error : null;
    } catch {
      // no body
    }
    throw new MqttRequestError(res.status, code);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const user = (u: string) => encodeURIComponent(u);
export const getMqttStatus = () => call<MqttStatus>('GET', '/v1/mqtt/status');
export const createMqttCredential = () => call<MqttCredential>('POST', '/v1/mqtt/credentials', {});
export const revokeMqttCredential = (username: string) => call<void>('DELETE', `/v1/mqtt/credentials/${user(username)}`);
/** Clears the installation pin of one login ("Allow a new phone", §14.5). */
export const allowNewPhone = (username: string) => call<void>('POST', `/v1/mqtt/credentials/${user(username)}/allow-new-phone`, {});
