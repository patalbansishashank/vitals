/**
 * Client for the person's Vitals server (SUITE_SPEC §14.2–§14.4): pairing once per device, status, devices, providers
 * that run through the server, and agent access. Every request goes through `netFetch` (the single network entry) after
 * the paired origin is granted with purpose `server`.
 *
 * Secrets: the device token from `POST /v1/pair/device` is the only secret here. It lives in `localStorage` under
 * `vitals.server.v1` (device-local: listed in the persistence layer's internal keys, so never exported, imported or
 * synced), is sent only as `Authorization: Bearer …` to the paired server's own origin, never in a URL or body, never
 * logged, and is dropped by "Forget this server" and by any `401`.
 *
 * Only `https://` server addresses are accepted (R18 §3: the site's CSP blocks plain http to tailnet addresses, and the
 * browser treats the server as "local network" whatever its name).
 */
import { allowOrigin, NetBlockedError, netFetch, originOf } from './net';

export const SERVER_KEY = 'vitals.server.v1';
/** Device-local marker of why the last pairing ended (no secret): drives the "removed" state and "Connect again". */
export const SERVER_LAST_KEY = 'vitals-server.last';
/** Oldest server this page works with. */
export const MIN_SERVER_VERSION = '0.4.0';
/** QR / link payload prefix (§14.2). */
export const SERVER_QR_PREFIX = 'vitals-server:1';

export type ServerErrorCode =
  | 'invalid_address'
  | 'http_address'
  | 'not_paired'
  | 'bad_request'
  | 'origin_not_allowed'
  | 'invalid_code'
  | 'expired'
  | 'locked'
  | 'rate_limited'
  | 'unauthorized'
  | 'revoked'
  | 'wrong_kind'
  | 'not_found'
  | 'not_signed_in'
  | 'no_key'
  | 'usage_limit'
  | 'upstream_error'
  | 'upstream_timeout'
  | 'key_refused'
  | 'server_busy'
  | 'daily_cap'
  | 'too_large'
  | 'server_unreachable'
  | 'local_network_denied'
  | 'not_vitals'
  | 'server_error';

/** What the person reads for each error (§14.3 table verbatim, §14.7 and design/screens/server.md §5 for the rest). */
export const SERVER_MESSAGES: Readonly<Record<ServerErrorCode, string>> = {
  invalid_address: "That doesn't look like a web address.",
  http_address: 'Use the https:// address of your server.',
  not_paired: 'This device is not connected to your server yet. Connect it in Settings › Server.',
  bad_request: 'Your server could not read that request. Check the code and try again.',
  origin_not_allowed: "This server doesn't accept this website yet. Ask whoever runs it to add it.",
  invalid_code: "That code doesn't match. Check it and try again.",
  expired: 'That code has expired. Codes last 10 minutes. Make a new one on your server or a paired device.',
  locked: 'Too many tries. Make a new code on your server.',
  rate_limited: 'Too many requests in a short time. Wait a minute and try again.',
  unauthorized: 'This device is no longer connected to your server. Connect it again in Settings › Server.',
  revoked: 'This device was removed from your server. Connect it again in Settings › Server.',
  wrong_kind: 'Your server did not allow that from this device.',
  not_found: 'Your server does not know that item any more.',
  not_signed_in: "ChatGPT isn't signed in on your server yet. Whoever runs your server can do that once.",
  no_key: 'Add a key for this service in Settings › Coach first.',
  usage_limit: "Your ChatGPT plan's limit is reached for now. Try again later or pick another service.",
  upstream_error: 'The AI service answered with an error. Try again in a moment.',
  upstream_timeout: 'The AI service did not answer in time. Try again.',
  key_refused: 'The service refused the key kept on your server. Replace it above.',
  server_busy: 'The server is busy with other people right now. Try again in a minute.',
  daily_cap: "Today's limit for AI requests on your server is reached. It starts again tomorrow.",
  too_large: 'That message is too large to send. Try a shorter one or a smaller picture.',
  server_unreachable: "Your Vitals server can't be reached. Check that it is running and that this device is on your private network.",
  local_network_denied: 'This browser blocked the connection to your server. Allow "local network" access for this site in the browser\'s site settings.',
  not_vitals: "That address isn't a Vitals server.",
  server_error: "Your server answered with an error. Try again in a minute. If it keeps happening, check the server's log.",
};

const KNOWN_CODES = new Set(Object.keys(SERVER_MESSAGES));
export const isServerErrorCode = (c: unknown): c is ServerErrorCode => typeof c === 'string' && KNOWN_CODES.has(c);

export class ServerError extends Error {
  readonly code: ServerErrorCode;
  readonly status?: number;
  readonly attemptsLeft?: number;
  constructor(code: ServerErrorCode, opts: { status?: number; attemptsLeft?: number; message?: string } = {}) {
    super(opts.message ?? SERVER_MESSAGES[code]);
    this.name = 'ServerError';
    this.code = code;
    if (opts.status !== undefined) this.status = opts.status;
    if (opts.attemptsLeft !== undefined) this.attemptsLeft = opts.attemptsLeft;
  }
}

/* ---- shapes (§14.2–§14.4) -------------------------------------------------------------------------------------- */

export interface ServerPerson {
  id: string;
  label: string;
}

/** What the UI may know about the pairing (no token). */
export interface ServerPairing {
  baseUrl: string;
  deviceId: string;
  person: ServerPerson;
  pairedAt: string;
}

interface StoredServer extends ServerPairing {
  token: string;
}

export interface ServerInfo {
  version: string;
  role: string;
  mqtt?: unknown;
}

export interface ServerStatus {
  deviceId: string;
  label: string;
  kind: string;
  scope: string;
  person: ServerPerson;
  createdAt: string;
  lastSeenAt: string;
  server: ServerInfo;
}

export interface ServerDevice {
  id: string;
  kind: string;
  label: string;
  scope: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export interface PairCode {
  code: string;
  expiresAt: string;
  qr: string;
}

export type ServerPresetId = 'siwc' | 'nim' | 'opencode-zen';
export interface ServerAiPreset {
  id: ServerPresetId;
  label: string;
  ready: boolean;
  account?: string;
}
export interface SiwcStatus {
  signedIn: boolean;
  plan?: string;
  expiresAt?: string;
}
export interface ServerUsage {
  today: { requests: number; inputTokens: number; outputTokens: number };
  cap?: { requestsPerDay: number };
}

export type AgentScope = 'read' | 'log' | 'edit';
export type AgentClient = 'codex' | 'opencode' | 'claude' | 'chatgpt-desktop' | 'other';
export interface AgentRecipe {
  client: string;
  title: string;
  steps: string[];
  config?: { file: string; snippet: string };
}
export interface AgentTokenCreated {
  token: string;
  id: string;
  mcpUrl: string;
  recipes: AgentRecipe[];
}
export interface AgentTokenInfo {
  id: string;
  client: string;
  label: string;
  scope: AgentScope;
  createdAt: string;
  lastUsedAt: string | null;
}
export interface AgentActivityRow {
  at: string;
  tokenId: string;
  tool: string;
  outcome: 'ok' | 'staged' | 'rejected' | 'error';
}

/** Why the last pairing ended, kept so the page can say so and offer "Connect again" with the address filled. */
export interface ServerEnded {
  baseUrl: string;
  reason: 'revoked' | 'unauthorized' | 'forgotten';
  at: string;
}

/* ---- pure helpers ---------------------------------------------------------------------------------------------- */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * A user-entered server address → `https://host[:port][/path]` without a trailing slash. A bare host gets `https://`.
 * `http://` is refused with its own message; anything unparsable is `invalid_address`.
 */
export function normalizeServerUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new ServerError('invalid_address');
  if (/^http:\/\//i.test(raw)) throw new ServerError('http_address');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new ServerError('invalid_address');
  }
  if (u.protocol !== 'https:') throw new ServerError(u.protocol === 'http:' ? 'http_address' : 'invalid_address');
  if (!u.hostname || /\s/.test(raw) || u.username || u.password) throw new ServerError('invalid_address');
  return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, '');
}

/** Strips spaces and dashes: 8 digits, else null (§14.2 codes are 8 digits). */
export function normalizeServerCode(input: string): string | null {
  const digits = input.replace(/[\s–—-]/g, '');
  return /^\d{8}$/.test(digits) ? digits : null;
}

export interface ParsedPairingLink {
  baseUrl: string;
  code: string;
  label?: string;
}

/**
 * Reads the QR string `vitals-server:1?u=<url>&c=<code>[&n=<label>]`, or the link that carries it in its fragment
 * (`https://vitals.creative.desi/settings?section=server#vitals-server:1?…`). Null when the text is neither.
 */
export function parsePairingLink(text: string): ParsedPairingLink | null {
  let t = text.trim();
  const hash = t.indexOf('#');
  if (!t.startsWith(SERVER_QR_PREFIX) && hash >= 0) t = t.slice(hash + 1);
  try {
    t = t.startsWith(SERVER_QR_PREFIX) ? t : decodeURIComponent(t);
  } catch {
    return null;
  }
  if (!t.startsWith(`${SERVER_QR_PREFIX}?`)) return null;
  const params = new URLSearchParams(t.slice(SERVER_QR_PREFIX.length + 1));
  const code = normalizeServerCode(params.get('c') ?? '');
  let baseUrl: string;
  try {
    baseUrl = normalizeServerUrl(params.get('u') ?? '');
  } catch {
    return null;
  }
  if (!code) return null;
  const label = params.get('n')?.trim();
  return { baseUrl, code, ...(label ? { label: label.slice(0, 40) } : {}) };
}

/** The QR string for a code (the server sends its own in `qr`; this is the fallback). */
export function pairingQr(baseUrl: string, code: string, label?: string): string {
  const p = new URLSearchParams({ u: baseUrl, c: code });
  if (label) p.set('n', label);
  return `${SERVER_QR_PREFIX}?${p.toString()}`;
}

/** The link that opens Settings › Server on this site with the code filled (the fragment never reaches the host). */
export function pairingLinkFor(qr: string, siteOrigin = 'https://vitals.creative.desi'): string {
  return `${siteOrigin.replace(/\/+$/, '')}/settings?section=server#${qr}`;
}

/** -1 / 0 / 1 for dotted versions ("0.4.0" vs "0.3.2"); non-numeric parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.+-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.+-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** "Browser on <platform>" (§14.2 default label), from the user agent; ≤ 40 characters. */
export function defaultDeviceLabel(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const platform = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return (platform ? `${browser} on ${platform}` : browser).slice(0, 40);
}

/* ---- client ---------------------------------------------------------------------------------------------------- */

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface ServerClientOptions {
  storage?: KeyValueStore | null;
  /** Defaults to `netFetch` (allowlisted). Tests pass a fake server. */
  fetchImpl?: typeof fetch;
  /** Best-effort check whether the browser denied "local network" access (tests inject it). */
  localNetworkDenied?: () => Promise<boolean>;
  now?: () => Date;
}

export interface ServerChatOptions {
  serverUrl: string;
  deps: { fetch: typeof fetch };
}

export interface ServerClient {
  pairing(): ServerPairing | null;
  isPaired(): boolean;
  /** Why the last pairing ended (revoked / unauthorized / forgotten), if it did. */
  ended(): ServerEnded | null;
  clearEnded(): void;
  pair(args: { baseUrl: string; code: string; label?: string; signal?: AbortSignal }): Promise<ServerPairing & { server: ServerInfo }>;
  forget(): void;
  status(signal?: AbortSignal): Promise<ServerStatus>;
  devices(): Promise<ServerDevice[]>;
  revokeDevice(id: string): Promise<void>;
  issueCode(label?: string): Promise<PairCode>;
  aiStatus(): Promise<ServerAiPreset[]>;
  setKey(preset: 'nim' | 'opencode-zen', key: string): Promise<void>;
  removeKey(preset: 'nim' | 'opencode-zen'): Promise<void>;
  siwcStatus(): Promise<SiwcStatus>;
  siwcLogout(): Promise<void>;
  usage(): Promise<ServerUsage>;
  agentTokens(): Promise<AgentTokenInfo[]>;
  createAgentToken(args: { client: AgentClient; label?: string; scope: AgentScope }): Promise<AgentTokenCreated>;
  revokeAgentToken(id: string): Promise<void>;
  agentActivity(): Promise<AgentActivityRow[]>;
  /** For `createChatModel` with presets that run through the server: the address and the bearer-adding fetch. */
  chatModelOptions(): ServerChatOptions;
  /** Pairing changes (pair, forget, a 401). */
  subscribe(listener: () => void): () => void;
}

function defaultStorage(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Chrome's Local Network Access permission (R18 §1); unknown names or browsers answer false. */
async function browserDeniedLocalNetwork(): Promise<boolean> {
  const perms = (globalThis as { navigator?: { permissions?: { query(d: { name: string }): Promise<{ state: string }> } } }).navigator?.permissions;
  if (!perms) return false;
  for (const name of ['local-network-access', 'local-network']) {
    try {
      if ((await perms.query({ name })).state === 'denied') return true;
    } catch {
      // not a permission this browser knows
    }
  }
  return false;
}

/** A request that never answers must not hang the page: abort after this long (the caller's own signal still works). */
export const REQUEST_TIMEOUT_MS = 20_000;

function timeoutSignal(outer?: AbortSignal): { signal: AbortSignal; timedOut: () => boolean; done: () => void } {
  const ctl = new AbortController();
  let out = false;
  const t = setTimeout(() => {
    out = true;
    ctl.abort();
  }, REQUEST_TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  if (outer?.aborted) ctl.abort();
  else outer?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: ctl.signal,
    timedOut: () => out,
    done: () => {
      clearTimeout(t);
      outer?.removeEventListener('abort', onAbort);
    },
  };
}

export function createServerClient(options: ServerClientOptions = {}): ServerClient {
  const store = options.storage === undefined ? defaultStorage() : options.storage;
  const doFetch: typeof fetch = options.fetchImpl ?? ((input, init) => netFetch(input, init));
  const lnaDenied = options.localNetworkDenied ?? browserDeniedLocalNetwork;
  const now = options.now ?? (() => new Date());
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  const read = (key: string): string | null => {
    try {
      return store?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const write = (key: string, value: string | null) => {
    try {
      if (value === null) store?.removeItem(key);
      else store?.setItem(key, value);
    } catch {
      // private mode: this session keeps working, nothing is remembered
    }
  };

  const load = (): StoredServer | null => {
    try {
      const raw = read(SERVER_KEY);
      const p = raw ? (JSON.parse(raw) as unknown) : null;
      if (isObj(p) && str(p.token) && str(p.baseUrl) && str(p.deviceId) && isObj(p.person) && str(p.person.id)) {
        return { baseUrl: str(p.baseUrl), token: str(p.token), deviceId: str(p.deviceId), person: { id: str(p.person.id), label: str(p.person.label) }, pairedAt: str(p.pairedAt) };
      }
    } catch {
      // corrupt entry: unpaired
    }
    return null;
  };

  /** `token` set: a late 401 from an old pairing must not end a newer one made since. */
  const end = (reason: ServerEnded['reason'], token?: string) => {
    const p = load();
    if (token !== undefined && p?.token !== token) return;
    write(SERVER_KEY, null);
    if (p) write(SERVER_LAST_KEY, JSON.stringify({ baseUrl: p.baseUrl, reason, at: now().toISOString() } satisfies ServerEnded));
    emit();
  };

  const grant = (baseUrl: string) => {
    try {
      allowOrigin(baseUrl, 'server');
    } catch (e) {
      if (e instanceof NetBlockedError) throw new ServerError('http_address');
      throw e;
    }
  };

  async function networkError(e: unknown): Promise<never> {
    if (e instanceof ServerError) throw e;
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    if (e instanceof NetBlockedError) throw new ServerError('http_address');
    throw new ServerError((await lnaDenied().catch(() => false)) ? 'local_network_denied' : 'server_unreachable');
  }

  async function errorOf(res: Response, authed: boolean, token?: string): Promise<ServerError> {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // no JSON body
    }
    const err = isObj(body) && isObj(body.error) ? body.error : isObj(body) ? body : {};
    // the AI routes answer `{ error: { code, message } }`, the pairing and device routes `{ error: code, message }`
    const raw = str(err.code) || (isObj(body) ? str(body.error) : '');
    const attemptsLeft = typeof err.attemptsLeft === 'number' ? err.attemptsLeft : isObj(body) && typeof body.attemptsLeft === 'number' ? body.attemptsLeft : undefined;
    let code: ServerErrorCode;
    if (isServerErrorCode(raw)) code = raw;
    else if (res.status === 401) code = 'unauthorized';
    else if (res.status === 403) code = raw === 'origin_not_allowed' ? 'origin_not_allowed' : 'wrong_kind';
    else if (res.status === 404) code = 'not_found';
    else if (res.status === 410) code = 'expired';
    else if (res.status === 423) code = 'locked';
    else if (res.status === 429) code = 'rate_limited';
    else if (res.status === 400) code = 'bad_request';
    else code = 'server_error';
    if (authed && res.status === 401) end(code === 'revoked' ? 'revoked' : 'unauthorized', token);
    return new ServerError(code, { status: res.status, ...(attemptsLeft !== undefined ? { attemptsLeft } : {}) });
  }

  async function request<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
    const p = load();
    if (!p) throw new ServerError('not_paired');
    const to = timeoutSignal(init.signal);
    try {
      let res: Response;
      try {
        grant(p.baseUrl);
        res = await doFetch(`${p.baseUrl}${path}`, {
          method: init.method ?? 'GET',
          headers: { accept: 'application/json', authorization: `Bearer ${p.token}`, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
          ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
          signal: to.signal,
          cache: 'no-store',
          credentials: 'omit',
        });
      } catch (e) {
        if (to.timedOut()) throw new ServerError('server_unreachable');
        return await networkError(e);
      }
      if (!res.ok) throw await errorOf(res, true, p.token);
      if (res.status === 204) return undefined as T;
      try {
        return (await res.json()) as T;
      } catch {
        throw new ServerError('server_error', { status: res.status });
      }
    } finally {
      to.done();
    }
  }

  /** fetch for the AI layer: the device token, only ever to the paired origin; a 401 ends the pairing. */
  const serverFetch: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const p = load();
    if (!p) throw new ServerError('not_paired');
    const origin = originOf(url);
    if (!origin || origin !== originOf(p.baseUrl)) throw new NetBlockedError(origin ?? url, 'The pairing is only sent to your own server.');
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((v, k) => headers.set(k, v));
    // provider credentials never travel from the page on this path; the server adds them
    headers.delete('x-api-key');
    headers.delete('api-key');
    headers.set('authorization', `Bearer ${p.token}`);
    let res: Response;
    try {
      res = await doFetch(input, { ...init, headers, credentials: 'omit' });
    } catch (e) {
      return networkError(e);
    }
    if (res.status === 401) {
      const copy = res.clone();
      let code = '';
      try {
        const b = (await copy.json()) as unknown;
        code = isObj(b) && isObj(b.error) ? str(b.error.code) : isObj(b) ? str(b.error) : '';
      } catch {
        // no body
      }
      end(code === 'revoked' ? 'revoked' : 'unauthorized', p.token);
    }
    return res;
  };

  const list = <T>(v: unknown, key: string): T[] => (isObj(v) && Array.isArray(v[key]) ? (v[key] as T[]) : []);

  return {
    pairing() {
      const p = load();
      return p ? { baseUrl: p.baseUrl, deviceId: p.deviceId, person: p.person, pairedAt: p.pairedAt } : null;
    },
    isPaired: () => load() !== null,
    ended() {
      try {
        const raw = read(SERVER_LAST_KEY);
        const e = raw ? (JSON.parse(raw) as unknown) : null;
        if (isObj(e) && str(e.baseUrl) && (e.reason === 'revoked' || e.reason === 'unauthorized' || e.reason === 'forgotten')) {
          return { baseUrl: str(e.baseUrl), reason: e.reason, at: str(e.at) };
        }
      } catch {
        // ignore
      }
      return null;
    },
    clearEnded() {
      write(SERVER_LAST_KEY, null);
      emit();
    },

    async pair({ baseUrl, code, label, signal }) {
      const base = normalizeServerUrl(baseUrl);
      const digits = normalizeServerCode(code);
      if (!digits) throw new ServerError('invalid_code');
      const name = (label?.trim() || defaultDeviceLabel()).slice(0, 40);
      const to = timeoutSignal(signal);
      let res: Response;
      try {
        grant(base);
        res = await doFetch(`${base}/v1/pair/device`, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ code: digits, label: name }),
          signal: to.signal,
          cache: 'no-store',
          credentials: 'omit',
        });
      } catch (e) {
        to.done();
        if (to.timedOut()) throw new ServerError('server_unreachable');
        return networkError(e);
      }
      to.done();
      // a 404 or an HTML page means something else answers at that address
      if (res.status === 404 || res.status === 405) throw new ServerError('not_vitals', { status: res.status });
      if (!res.ok) throw await errorOf(res, false);
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new ServerError('not_vitals', { status: res.status });
      }
      if (!isObj(body) || !str(body.token) || !str(body.deviceId) || !isObj(body.person) || !str(body.person.id)) throw new ServerError('not_vitals');
      const server = isObj(body.server) ? { version: str(body.server.version), role: str(body.server.role) } : { version: '', role: '' };
      const stored: StoredServer = {
        baseUrl: base,
        token: str(body.token),
        deviceId: str(body.deviceId),
        person: { id: str(body.person.id), label: str(body.person.label) },
        pairedAt: now().toISOString(),
      };
      write(SERVER_KEY, JSON.stringify(stored));
      write(SERVER_LAST_KEY, null);
      emit();
      return { baseUrl: stored.baseUrl, deviceId: stored.deviceId, person: stored.person, pairedAt: stored.pairedAt, server };
    },

    forget() {
      end('forgotten');
    },

    async status(signal) {
      const s = await request<unknown>('/v1/pair/status', signal ? { signal } : {});
      if (!isObj(s) || !isObj(s.server)) throw new ServerError('server_error');
      const person = isObj(s.person) ? { id: str(s.person.id), label: str(s.person.label) } : (load()?.person ?? { id: '', label: '' });
      return {
        deviceId: str(s.deviceId),
        label: str(s.label),
        kind: str(s.kind),
        scope: str(s.scope),
        person,
        createdAt: str(s.createdAt),
        lastSeenAt: str(s.lastSeenAt),
        server: { version: str(s.server.version), role: str(s.server.role), ...(s.server.mqtt !== undefined ? { mqtt: s.server.mqtt } : {}) },
      };
    },
    async devices() {
      return list<Record<string, unknown>>(await request<unknown>('/v1/devices'), 'devices').map((d) => ({
        id: str(d.id),
        kind: str(d.kind),
        label: str(d.label),
        scope: str(d.scope),
        createdAt: str(d.createdAt),
        lastSeenAt: str(d.lastSeenAt),
        current: d.current === true,
      }));
    },
    async revokeDevice(id) {
      await request<void>(`/v1/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    async issueCode(label) {
      const r = await request<unknown>('/v1/pair/code', { method: 'POST', body: label ? { label } : {} });
      if (!isObj(r) || !normalizeServerCode(str(r.code))) throw new ServerError('server_error');
      const p = load();
      return { code: str(r.code), expiresAt: str(r.expiresAt), qr: str(r.qr) || pairingQr(p?.baseUrl ?? '', str(r.code), label) };
    },
    async aiStatus() {
      return list<Record<string, unknown>>(await request<unknown>('/v1/ai/status'), 'presets').flatMap((p): ServerAiPreset[] =>
        p.id === 'siwc' || p.id === 'nim' || p.id === 'opencode-zen' ? [{ id: p.id, label: str(p.label), ready: p.ready === true, ...(str(p.account) ? { account: str(p.account) } : {}) }] : [],
      );
    },
    async setKey(preset, key) {
      await request<void>(`/v1/ai/keys/${preset}`, { method: 'PUT', body: { key } });
    },
    async removeKey(preset) {
      await request<void>(`/v1/ai/keys/${preset}`, { method: 'DELETE' });
    },
    async siwcStatus() {
      const r = await request<unknown>('/v1/ai/siwc/status');
      if (!isObj(r)) throw new ServerError('server_error');
      return { signedIn: r.signedIn === true, ...(str(r.plan) ? { plan: str(r.plan) } : {}), ...(str(r.expiresAt) ? { expiresAt: str(r.expiresAt) } : {}) };
    },
    async siwcLogout() {
      await request<void>('/v1/ai/siwc/logout', { method: 'POST' });
    },
    async usage() {
      const r = await request<unknown>('/v1/ai/usage');
      const t = isObj(r) && isObj(r.today) ? r.today : {};
      const n = (v: unknown) => (typeof v === 'number' ? v : 0);
      const cap = isObj(r) && isObj(r.cap) && typeof r.cap.requestsPerDay === 'number' ? { requestsPerDay: r.cap.requestsPerDay } : undefined;
      return { today: { requests: n(t.requests), inputTokens: n(t.inputTokens), outputTokens: n(t.outputTokens) }, ...(cap ? { cap } : {}) };
    },
    async agentTokens() {
      return list<Record<string, unknown>>(await request<unknown>('/v1/agents/tokens'), 'tokens').map((t) => ({
        id: str(t.id),
        client: str(t.client),
        label: str(t.label),
        scope: (t.scope === 'read' || t.scope === 'edit' ? t.scope : 'log') as AgentScope,
        createdAt: str(t.createdAt),
        lastUsedAt: str(t.lastUsedAt) || null,
      }));
    },
    async createAgentToken(args) {
      const r = await request<unknown>('/v1/agents/tokens', { method: 'POST', body: { client: args.client, scope: args.scope, ...(args.label ? { label: args.label.slice(0, 60) } : {}) } });
      if (!isObj(r) || !str(r.token) || !str(r.id)) throw new ServerError('server_error');
      const recipes = Array.isArray(r.recipes)
        ? r.recipes.flatMap((x): AgentRecipe[] =>
            isObj(x) && str(x.client)
              ? [
                  {
                    client: str(x.client),
                    title: str(x.title),
                    steps: Array.isArray(x.steps) ? x.steps.filter((s): s is string => typeof s === 'string') : [],
                    ...(isObj(x.config) && str(x.config.snippet) ? { config: { file: str(x.config.file), snippet: str(x.config.snippet) } } : {}),
                  },
                ]
              : [],
          )
        : [];
      return { token: str(r.token), id: str(r.id), mcpUrl: str(r.mcpUrl) || `${load()?.baseUrl ?? ''}/mcp`, recipes };
    },
    async revokeAgentToken(id) {
      await request<void>(`/v1/agents/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    async agentActivity() {
      const r = await request<unknown>('/v1/agents/activity');
      const rows = Array.isArray(r) ? r : list<unknown>(r, 'activity');
      return rows.flatMap((x): AgentActivityRow[] =>
        isObj(x) && str(x.at) && str(x.tool)
          ? [{ at: str(x.at), tokenId: str(x.tokenId), tool: str(x.tool), outcome: (['ok', 'staged', 'rejected', 'error'].includes(str(x.outcome)) ? x.outcome : 'error') as AgentActivityRow['outcome'] }]
          : [],
      );
    },

    chatModelOptions() {
      const p = load();
      if (!p) throw new ServerError('not_paired');
      // createChatModel skips its own grant when deps.fetch is given; grant the server origin here
      grant(p.baseUrl);
      return { serverUrl: p.baseUrl, deps: { fetch: serverFetch } };
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/* ---- status watcher with backoff ------------------------------------------------------------------------------ */

export type ServerConnection =
  | { state: 'unpaired' }
  | { state: 'checking'; lastContactAt: string | null }
  | { state: 'reachable'; status: ServerStatus; latencyMs: number; lastContactAt: string }
  | { state: 'version'; status: ServerStatus; lastContactAt: string }
  | { state: 'unreachable'; error: ServerError; lastContactAt: string | null }
  | { state: 'revoked' };

export interface WatchOptions {
  /** Poll interval while reachable (default 60 s). */
  intervalMs?: number;
  /** Backoff after a failure: base and cap (default 5 s … 5 min). */
  backoffMs?: { base: number; max: number };
  random?: () => number;
  clock?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export interface ServerWatcher {
  get(): ServerConnection;
  subscribe(listener: () => void): () => void;
  /** Check now (resets the backoff). */
  check(): Promise<void>;
  stop(): void;
}

/** Polls `/v1/pair/status` while paired: every minute when it answers, with exponential backoff when it doesn't. */
export function watchServer(client: ServerClient, opts: WatchOptions = {}): ServerWatcher {
  const interval = opts.intervalMs ?? 60_000;
  const backoff = opts.backoffMs ?? { base: 5_000, max: 300_000 };
  const random = opts.random ?? Math.random;
  const clock = opts.clock ?? (() => performance.now());
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const listeners = new Set<() => void>();
  let state: ServerConnection = client.isPaired() ? { state: 'checking', lastContactAt: null } : client.ended()?.reason === 'revoked' ? { state: 'revoked' } : { state: 'unpaired' };
  let lastContactAt: string | null = null;
  let failures = 0;
  let timer: unknown = null;
  let stopped = false;
  let running: Promise<void> | null = null;

  const set = (s: ServerConnection) => {
    state = s;
    listeners.forEach((l) => l());
  };
  const schedule = (ms: number) => {
    if (timer !== null) clearTimer(timer);
    timer = stopped ? null : setTimer(() => void tick(), ms);
  };

  async function run(): Promise<void> {
    if (!client.isPaired()) {
      set(client.ended()?.reason === 'revoked' ? { state: 'revoked' } : { state: 'unpaired' });
      return;
    }
    if (state.state !== 'reachable' && state.state !== 'version') set({ state: 'checking', lastContactAt });
    const started = clock();
    try {
      const status = await client.status();
      if (stopped) return;
      if (!client.isPaired()) {
        // forgotten or revoked while the request was in flight: a late answer must not show "reachable"
        set(client.ended()?.reason === 'revoked' ? { state: 'revoked' } : { state: 'unpaired' });
        return;
      }
      lastContactAt = new Date().toISOString();
      failures = 0;
      const old = status.server.version && compareVersions(status.server.version, MIN_SERVER_VERSION) < 0;
      set(old ? { state: 'version', status, lastContactAt } : { state: 'reachable', status, latencyMs: Math.max(0, Math.round(clock() - started)), lastContactAt });
      schedule(interval);
    } catch (e) {
      if (!client.isPaired()) {
        set(client.ended()?.reason === 'revoked' ? { state: 'revoked' } : { state: 'unpaired' });
        return;
      }
      const err = e instanceof ServerError ? e : new ServerError('server_unreachable');
      set({ state: 'unreachable', error: err, lastContactAt });
      const delay = Math.min(backoff.max, backoff.base * 2 ** failures) * (0.75 + 0.5 * random());
      failures += 1;
      schedule(delay);
    }
  }

  /** A scheduled poll keeps the backoff; "Check now" resets it. */
  function tick(): Promise<void> {
    running ??= run().finally(() => {
      running = null;
    });
    return running;
  }
  function check(): Promise<void> {
    failures = 0;
    return tick();
  }

  const offClient = client.subscribe(() => {
    if (!client.isPaired()) {
      if (timer !== null) clearTimer(timer);
      timer = null;
      set(client.ended()?.reason === 'revoked' ? { state: 'revoked' } : { state: 'unpaired' });
    } else if (state.state === 'unpaired' || state.state === 'revoked') {
      void check();
    }
  });

  return {
    get: () => state,
    subscribe(l) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    check,
    stop() {
      stopped = true;
      offClient();
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}

/* ---- app singletons -------------------------------------------------------------------------------------------- */

let appClient: ServerClient | null = null;

/** The app's server client (created on first use). */
export function getServerClient(): ServerClient {
  appClient ??= createServerClient();
  return appClient;
}

/** Test hook. */
export function setServerClientForTests(client: ServerClient | null): void {
  appClient = client;
}
