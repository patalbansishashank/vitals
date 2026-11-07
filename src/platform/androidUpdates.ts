/*
 * App updates from the home server, Android app only (vitals-research/ota/CONTRACT.md): the web side of the native
 * `VitalsUpdates` plugin (Kotlin, apps/android: OtaBoot, OtaDownloads). Nothing here on the web, the PWA or the desktop.
 *
 * - Check on launch/return/connection recovery and every minute in front. Failed checks retry promptly.
 * - A newer web bundle: the native side downloads it, checks sha256 and the ed25519 signature, and serves it from the
 *   next cold start, or by an explicit apply action on native705+. Trial confirmation/rollback stays native.
 * - A newer APK is announced immediately in the app shell, downloaded in the background, then offered for installation.
 *   One tap hands it to Android through an install session and the system's own confirmation shows.
 *   Available updates download automatically, including on metered connections; installation still requires a tap.
 *
 * The device token goes to the native download only for a file on the paired server's own origin, and is never stored
 * on the native side.
 */
import { getServerClient, SERVER_KEY, type ServerClient, type ServerPairing } from '@/net/server';
import { originOf } from '@/net/net';
import { capacitor } from './androidShell';

/* ---- shapes ---------------------------------------------------------------------------------------------------- */

export interface LatestApk {
  versionName: string;
  versionCode: number;
  sha256: string;
  size: number;
  url: string;
  notes?: string;
}

export interface LatestWeb {
  version: string;
  sha256: string;
  size: number;
  url: string;
  sig: string;
}

export interface Latest {
  apk: LatestApk | null;
  web: LatestWeb | null;
}

/** What the native side reports (`VitalsUpdates.status()`). */
export interface NativeUpdateStatus {
  versionName: string;
  versionCode: number;
  /** The bundle being served: a downloaded one's version, or the APK's own. */
  webVersion: string;
  webEmbedded: boolean;
  webPending: string | null;
  bad: string[];
  metered: boolean;
  /** A downloaded APK waiting for the owner's tap. */
  apk: { versionName: string; versionCode: number } | null;
  /** Older APKs can stage web bundles but cannot activate one without a cold process start. */
  canApplyWeb?: boolean;
}

export type DownloadResult = 'staged' | 'ready' | 'skipped' | 'metered' | 'busy' | 'failed';

interface ListenerHandle {
  remove(): Promise<void> | void;
}

export interface VitalsUpdatesPlugin {
  ready(): Promise<unknown>;
  status(): Promise<NativeUpdateStatus>;
  download(o: {
    kind: 'web' | 'apk';
    url: string;
    sha256: string;
    size: number;
    token: string;
    version?: string;
    sig?: string;
    versionCode?: number;
    versionName?: string;
    /** Legacy native permission flag for metered transfers, enabled by the automatic-update policy. */
    userAsked?: boolean;
    /** Optional on native709; newer bridges echo this only in cosmetic byte-progress events. */
    transferId?: string;
  }): Promise<{ result: DownloadResult; reason?: string }>;
  install(): Promise<{ result: 'started' | 'permission' | 'none' | 'failed' }>;
  applyWebNow?(): Promise<{ result: 'started' | 'none' | 'busy' | 'failed' }>;
  addListener(event: string, cb: (data: unknown) => void): Promise<ListenerHandle> | ListenerHandle;
}

/* ---- manifest and compatibility (pure) ------------------------------------------------------------------------- */

const SHA256 = /^[0-9a-f]{64}$/i;
/** Also a folder name on the phone (OtaLogic.isVersion). */
const WEB_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const posInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function parseApk(v: unknown): LatestApk | null {
  if (!isObj(v)) return null;
  const { versionName, versionCode, sha256, size, url, notes } = v;
  if (!nonEmpty(versionName) || !posInt(versionCode) || !nonEmpty(sha256) || !SHA256.test(sha256) || !posInt(size) || !nonEmpty(url)) return null;
  return { versionName, versionCode, sha256: sha256.toLowerCase(), size, url, ...(typeof notes === 'string' && notes ? { notes } : {}) };
}

function parseWeb(v: unknown): LatestWeb | null {
  if (!isObj(v)) return null;
  const { version, sha256, size, url, sig } = v;
  if (!nonEmpty(version) || !WEB_VERSION.test(version) || !nonEmpty(sha256) || !SHA256.test(sha256) || !posInt(size) || !nonEmpty(url) || !nonEmpty(sig)) return null;
  return { version, sha256: sha256.toLowerCase(), size, url, sig };
}

/** The `latest` answer, or null when it is not one. A malformed entry counts as "nothing new". */
export function parseLatest(body: unknown): Latest | null {
  if (!isObj(body) || !('apk' in body) || !('web' in body)) return null;
  return { apk: parseApk(body.apk), web: parseWeb(body.web) };
}

/** `GET /v1/apps/vitals/latest` for this install. */
export function latestUrl(baseUrl: string, status: Pick<NativeUpdateStatus, 'versionCode' | 'webVersion'>): string {
  const q = new URLSearchParams({ channel: 'stable', versionCode: String(status.versionCode), web: status.webVersion });
  return `${baseUrl.replace(/\/+$/, '')}/v1/apps/vitals/latest?${q.toString()}`;
}

/** A file URL from the server, made absolute; null unless it is on the paired server's own origin (the token goes there). */
export function sameOriginUrl(url: string, baseUrl: string): string | null {
  try {
    const abs = new URL(url, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
    const origin = originOf(abs);
    return origin && origin === originOf(baseUrl) && abs.startsWith('https://') ? abs : null;
  } catch {
    return null;
  }
}

/**
 * What to fetch from a `latest` answer. The server already filters by versionCode, installed web version and
 * compatibility; this checks again, so a confused or stale answer cannot loop: never a bad version, never the one served
 * or waiting, never an APK that is not newer or is already downloaded.
 */
export function planUpdates(latest: Latest, status: NativeUpdateStatus, baseUrl: string): { web: LatestWeb | null; apk: LatestApk | null } {
  let web: LatestWeb | null = null;
  const w = latest.web;
  if (w && !status.bad.includes(w.version) && w.version !== status.webVersion && w.version !== status.webPending) {
    const url = sameOriginUrl(w.url, baseUrl);
    if (url) web = { ...w, url };
  }
  let apk: LatestApk | null = null;
  const a = latest.apk;
  if (a && a.versionCode > status.versionCode && a.versionCode !== status.apk?.versionCode) {
    const url = sameOriginUrl(a.url, baseUrl);
    if (url) apk = { ...a, url };
  }
  return { web, apk };
}

export type UpdateState = 'ready' | 'available' | 'staged' | 'current' | 'unknown';

/** The one status line in Settings › About: app version, web bundle version, and the update state. */
export function statusLine(status: NativeUpdateStatus | null, state: UpdateState): string {
  if (!status) return '';
  const web = status.webEmbedded ? `web ${status.webVersion} (built in)` : `web ${status.webVersion}`;
  const tail = state === 'ready' || state === 'staged' ? 'Update ready' : state === 'available' ? 'Update available' : state === 'current' ? 'Up to date' : null;
  return [`Vitals ${status.versionName}`, web, tail].filter(Boolean).join(' · ');
}

/* ---- the plugin ------------------------------------------------------------------------------------------------ */

let cached: { cap: object; plugin: VitalsUpdatesPlugin } | null = null;

/** The `VitalsUpdates` plugin, or null outside the Android app. Never return it from an async function: it is a Proxy. */
export function vitalsUpdates(): VitalsUpdatesPlugin | null {
  const cap = capacitor();
  if (!cap || cap.getPlatform?.() !== 'android') return null;
  if (cached?.cap === cap) return cached.plugin;
  const plugin = (cap.registerPlugin?.('VitalsUpdates') ?? cap.Plugins?.VitalsUpdates) as VitalsUpdatesPlugin | undefined;
  if (!plugin) return null;
  cached = { cap, plugin };
  return plugin;
}

/* ---- shared update state --------------------------------------------------------------------------------------- */

export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'installing' | 'applying' | 'error';
export type UpdateError = 'check' | 'download' | 'install' | 'apply' | 'permission';
export interface DownloadProgress { received: number; total: number; phase: 'downloading' | 'verifying' }
export interface UpdatesView {
  status: NativeUpdateStatus | null;
  /** Published APK, announced before its download starts and retained if that download fails. */
  available: LatestApk | null;
  checked: boolean;
  phase: UpdatePhase;
  error: UpdateError | null;
  downloadKind: 'web' | 'apk' | null;
  lastCheckedAt: number | null;
  checkSource?: 'automatic' | 'manual';
  progress?: DownloadProgress | null;
}
const emptyView = (): UpdatesView => ({ status: null, available: null, checked: false, phase: 'idle', error: null, downloadKind: null, lastCheckedAt: null, checkSource: 'automatic', progress: null });
let view = emptyView();
let offerPairing: string | null = null;
let generation = 0;
let operation: Promise<boolean> | null = null;
let requestNow: (() => Promise<void>) | null = null;
const listeners = new Set<() => void>();
const set = (patch: Partial<UpdatesView>) => {
  if (Object.entries(patch).every(([key, value]) => view[key as keyof UpdatesView] === value)) return;
  view = { ...view, ...patch };
  listeners.forEach((listener) => listener());
};
const pairingIdentity = (p: ServerPairing | null): string | null => p ? JSON.stringify([p.baseUrl, p.deviceId, p.pairedAt]) : null;
function clearOffer(): void { offerPairing = null; if (view.available) set({ available: null }); }
export const getUpdatesView = (): UpdatesView => view;
export function subscribeUpdates(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export function updateState(v: Pick<UpdatesView, 'status' | 'available' | 'checked'> & Partial<Pick<UpdatesView, 'phase'>>): UpdateState {
  if (v.status?.apk && (!v.available || v.status.apk.versionCode >= v.available.versionCode)) return 'ready';
  if (v.available) return 'available';
  if (v.status?.webPending) return 'staged';
  return v.checked && v.phase !== 'error' ? 'current' : 'unknown';
}

/* ---- discovery and downloads ----------------------------------------------------------------------------------- */
export const CHECK_EVERY_MS = 60_000;
export const FOREGROUND_COOLDOWN_MS = 15_000;
export const RETRY_FIRST_MS = 5_000;
export const REQUEST_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

/** Waits are bounded even if a bridge/fetch implementation does not honour abort. */
function bounded<T>(promise: Promise<T>, signal?: AbortSignal, ms = REQUEST_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(new Error('update cancelled')); };
    const timer = setTimeout(() => { finish(); reject(new Error('update timeout')); }, ms);
    promise.then((value) => { finish(); resolve(value); }, (error: unknown) => { finish(); reject(error); });
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
  });
}
function pairedToken(baseUrl: string): string | null {
  try {
    const raw = localStorage.getItem(SERVER_KEY);
    const p: unknown = raw ? JSON.parse(raw) : null;
    return isObj(p) && p.baseUrl === baseUrl && nonEmpty(p.token) ? p.token : null;
  } catch { return null; }
}
async function refresh(plugin: VitalsUpdatesPlugin, valid: () => boolean = () => true, signal?: AbortSignal): Promise<NativeUpdateStatus | null> {
  try {
    const status = await bounded(plugin.status(), signal);
    if (!valid()) return null;
    const patch: Partial<UpdatesView> = { status };
    if (view.available && (status.versionCode >= view.available.versionCode || (status.apk?.versionCode ?? 0) >= view.available.versionCode)) {
      offerPairing = null;
      patch.available = null;
    }
    set(patch);
    return status;
  } catch { return null; }
}
export interface CheckDeps {
  plugin: VitalsUpdatesPlugin;
  client: ServerClient;
  token?: (baseUrl: string) => string | null;
  signal?: AbortSignal;
  now?: () => number;
  source?: 'automatic' | 'manual';
}
function exclusive(work: () => Promise<boolean>): Promise<boolean> {
  if (operation) return operation;
  const task = Promise.resolve().then(work);
  const tracked = task.finally(() => { if (operation === tracked) operation = null; });
  operation = tracked;
  return tracked;
}
/** Announce first, then download. Returns whether discovery and any required transfer succeeded. */
export function checkForUpdates(deps: CheckDeps): Promise<boolean> {
  if (operation && deps.source === 'manual') set({ checkSource: 'manual' });
  return exclusive(async () => {
    const identity = pairingIdentity(deps.client.pairing());
    try { return await performCheck(deps); }
    finally {
      if (offerPairing === identity && pairingIdentity(deps.client.pairing()) !== identity) clearOffer();
    }
  });
}
async function performCheck({ plugin, client, token: tokenFor = pairedToken, signal, now = Date.now, source = 'automatic' }: CheckDeps): Promise<boolean> {
  const epoch = generation;
  const pairing = client.pairing();
  const identity = pairingIdentity(pairing);
  const token = pairing ? tokenFor(pairing.baseUrl) : null;
  const retainDownloadFailure = source === 'automatic' && view.error === 'download';
  const valid = () => epoch === generation && !signal?.aborted && pairingIdentity(client.pairing()) === identity && (!pairing || tokenFor(pairing.baseUrl) === token);
  const fail = (error: UpdateError) => {
    if (valid()) set({ checked: error === 'check' ? false : view.checked, phase: 'error',
      error: error === 'check' && retainDownloadFailure && view.checkSource !== 'manual' ? 'download' : error,
      downloadKind: null, progress: null });
    return false;
  };
  if (!valid()) return false;
  if (!pairing || !identity || !token) { await refresh(plugin, valid, signal); return false; }
  // Background discovery must not erase an unrecovered failure of a real, previously found web/APK transfer.
  set(retainDownloadFailure ? { checkSource: source, progress: null } : { phase: 'checking', error: null, checkSource: source, progress: null });
  const status = await refresh(plugin, valid, signal);
  if (!status) return fail('check');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let latest: Latest | null;
  try {
    const fetch = client.chatModelOptions().deps.fetch;
    const response = await bounded(fetch(latestUrl(pairing.baseUrl, status), { headers: { accept: 'application/json' }, cache: 'no-store', signal: controller.signal }), signal);
    if (!valid()) return false;
    if (!response.ok) return fail('check');
    const body: unknown = await bounded(response.json(), signal);
    latest = parseLatest(body);
    if (!latest || !isObj(body) || (body.apk !== null && !latest.apk) || (body.web !== null && !latest.web)) return fail('check');
  } catch { return fail('check'); }
  finally { controller.abort(); signal?.removeEventListener('abort', abort); }
  if (!valid()) return false;
  const plan = planUpdates(latest, status, pairing.baseUrl);
  if ((latest.apk && latest.apk.versionCode > status.versionCode && latest.apk.versionCode !== status.apk?.versionCode && !sameOriginUrl(latest.apk.url, pairing.baseUrl)) ||
    (latest.web && !status.bad.includes(latest.web.version) && latest.web.version !== status.webVersion && latest.web.version !== status.webPending && !sameOriginUrl(latest.web.url, pairing.baseUrl))) return fail('check');
  offerPairing = plan.apk ? identity : null;
  set({ checked: true, lastCheckedAt: now(), available: plan.apk, phase: plan.apk || plan.web ? 'downloading' : 'idle', error: null, downloadKind: plan.apk ? 'apk' : plan.web ? 'web' : null, progress: null });
  let failed = false;
  // A ready APK takes precedence over a slower web transfer in the existing banner slot.
  if (plan.apk && valid()) {
    const a = plan.apk;
    failed = !await downloadTransfer(plugin, { kind: 'apk', url: a.url, sha256: a.sha256, size: a.size,
      versionCode: a.versionCode, versionName: a.versionName, token, userAsked: true }, valid, signal);
  }
  if (plan.web && valid()) {
    const w = plan.web;
    const ok = await downloadTransfer(plugin, { kind: 'web', url: w.url, sha256: w.sha256, size: w.size,
      sig: w.sig, version: w.version, token }, valid, signal);
    failed ||= !ok;
  }
  if (!valid()) return false;
  if (failed) return fail('download');
  set({ phase: 'idle', error: null, downloadKind: null, progress: null });
  return true;
}
/** Progress is optional/cosmetic. Native verified status, never a progress event, establishes readiness. */
async function downloadTransfer(plugin: VitalsUpdatesPlugin, request: Parameters<VitalsUpdatesPlugin['download']>[0], valid: () => boolean, signal?: AbortSignal): Promise<boolean> {
  const transferId = crypto.randomUUID();
  let handle: ListenerHandle | null = null;
  const remove = (listener: ListenerHandle) => {
    try { void Promise.resolve(listener.remove()).catch(() => undefined); } catch { /* cosmetic bridge cleanup */ }
  };
  let disposed = false;
  let received = -1, percent = -1, verifying = false;
  set({ phase: 'downloading', error: null, downloadKind: request.kind, progress: null });
  try {
    void Promise.resolve(plugin.addListener('updateProgress', (data) => {
      if (disposed || !valid() || !isObj(data) || data.transferId !== transferId || data.kind !== request.kind) return;
      if (!Number.isSafeInteger(data.received) || !Number.isSafeInteger(data.total) || data.total !== request.size) return;
      const bytes = data.received as number;
      if (bytes < received || bytes < 0 || bytes > request.size || (data.phase !== 'downloading' && data.phase !== 'verifying')) return;
      if (verifying && data.phase !== 'verifying') return;
      if (data.phase === 'verifying' && bytes !== request.size) return;
      const nextPercent = Math.floor(bytes / request.size * 100);
      const changed = nextPercent !== percent || verifying !== (data.phase === 'verifying');
      received = bytes; percent = nextPercent; verifying = data.phase === 'verifying';
      if (changed) set({ progress: { received: bytes, total: request.size, phase: data.phase } });
    })).then((listener) => { if (disposed) remove(listener); else handle = listener; }).catch(() => undefined);
  } catch { /* Older bridges can transfer safely without byte progress. */ }
  try {
    const result = await bounded(plugin.download({ ...request, transferId }), signal, DOWNLOAD_TIMEOUT_MS);
    if (!valid()) return false;
    const status = await refresh(plugin, valid, signal);
    if (!valid()) return false;
    if (result.result === 'metered') return true; // legacy native refusal remains an explicit Download action
    if (result.result === 'failed' || result.result === 'busy' || !status) return false;
    return request.kind === 'apk'
      ? status.versionCode >= request.versionCode! || status.apk?.versionCode === request.versionCode
      : status.webPending === request.version || status.webVersion === request.version || (result.result === 'skipped' && status.bad.includes(request.version!));
  } catch { return false; }
  finally { disposed = true; if (handle) remove(handle); }
}

export async function refreshUpdates(): Promise<void> {
  const plugin = vitalsUpdates();
  if (plugin) await refresh(plugin);
}
/** User retry bypasses the automatic discovery cooldown. */
export async function checkUpdatesNow(): Promise<void> {
  if (requestNow) return requestNow();
  const plugin = vitalsUpdates();
  if (plugin) await checkForUpdates({ plugin, client: getServerClient(), source: 'manual' });
}
/** A user tap permits the metered transfer, but never sends a pairing's bearer to an old offer's origin. */
export async function downloadOfferedUpdate(client: ServerClient = getServerClient()): Promise<void> {
  if (operation) await operation.catch(() => false);
  const plugin = vitalsUpdates(), a = view.available, pairing = client.pairing(), identity = pairingIdentity(pairing);
  if (!plugin || !a || !pairing || !identity || identity !== offerPairing) { clearOffer(); return; }
  const url = sameOriginUrl(a.url, pairing.baseUrl), token = pairedToken(pairing.baseUrl), epoch = generation;
  if (!url || !token) { clearOffer(); return; }
  const valid = () => epoch === generation && pairingIdentity(client.pairing()) === identity && pairedToken(pairing.baseUrl) === token;
  await exclusive(async () => {
    if (!valid()) return false;
    const ok = await downloadTransfer(plugin, { kind: 'apk', url, sha256: a.sha256, size: a.size,
      versionCode: a.versionCode, versionName: a.versionName, token, userAsked: true }, valid);
    if (!valid()) return false;
    set({ phase: ok ? 'idle' : 'error', error: ok ? null : 'download', downloadKind: null, progress: null });
    return ok;
  });
}
export async function installUpdate(): Promise<void> {
  const plugin = vitalsUpdates();
  if (!plugin || updateState(view) !== 'ready' || view.phase === 'installing') return;
  set({ phase: 'installing', error: null });
  try {
    const result = await bounded(plugin.install());
    await refresh(plugin);
    set({ phase: result.result === 'failed' || result.result === 'permission' ? 'error' : 'idle', error: result.result === 'permission' ? 'permission' : result.result === 'failed' ? 'install' : null });
  } catch { set({ phase: 'error', error: 'install' }); }
}
export async function applyWebUpdate(): Promise<void> {
  const plugin = vitalsUpdates();
  if (!plugin || !view.status?.canApplyWeb || !view.status.webPending || view.phase === 'applying') return;
  set({ phase: 'applying', error: null });
  try {
    const result = await bounded(plugin.applyWebNow!());
    if (result.result !== 'started') { await refresh(plugin); set({ phase: result.result === 'none' ? 'idle' : 'error', error: result.result === 'none' ? null : 'apply' }); }
  } catch { set({ phase: 'error', error: 'apply' }); }
}
export function markWebReady(): void {
  try { void Promise.resolve(vitalsUpdates()?.ready()).catch(() => undefined); } catch { /* older APK */ }
}

/* ---- foreground scheduler -------------------------------------------------------------------------------------- */
export function startUpdateChecks(opts: { client?: ServerClient; now?: () => number } = {}): () => void {
  const plugin = vitalsUpdates();
  if (!plugin) return () => {};
  const client = opts.client ?? getServerClient(), now = opts.now ?? Date.now;
  let stopped = false, running = false, queued = false, failures = 0, nativeVisible = true;
  let lastAttempt = -Infinity, nextDue = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let flight: Promise<void> = Promise.resolve();
  const visible = () => nativeVisible && document.visibilityState !== 'hidden';
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (stopped || !visible() || !client.isPaired()) return;
    timer = setTimeout(() => { void run(); }, Math.max(1000, nextDue - now()));
  };
  const run = (force = false, source: 'automatic' | 'manual' = 'automatic'): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running) {
      if (source === 'manual') set({ checkSource: 'manual' });
      else if (force) queued = true;
      return flight;
    }
    if (!client.isPaired()) { void refresh(plugin, () => !stopped); return Promise.resolve(); }
    if (!force && (!visible() || now() < nextDue)) { schedule(); return Promise.resolve(); }
    running = true;
    lastAttempt = now();
    controller = new AbortController();
    flight = checkForUpdates({ plugin, client, signal: controller.signal, now, source }).then((ok) => {
      if (stopped) return;
      failures = ok ? 0 : failures + 1;
      nextDue = now() + (ok ? CHECK_EVERY_MS : Math.min(CHECK_EVERY_MS, RETRY_FIRST_MS * 2 ** Math.min(4, failures - 1)));
    }).catch(() => { if (!stopped) nextDue = now() + RETRY_FIRST_MS; }).finally(() => {
      running = false;
      controller = null;
      if (stopped) return;
      if (queued) { queued = false; void run(true); } else schedule();
    });
    return flight;
  };
  const manual = () => run(true, 'manual');
  requestNow = manual;
  const resume = () => {
    nativeVisible = true;
    if (now() - lastAttempt >= FOREGROUND_COOLDOWN_MS || now() < lastAttempt) void run(true); else schedule();
  };
  const onVisible = () => { if (document.visibilityState === 'visible') resume(); else { if (timer) clearTimeout(timer); timer = null; } };
  const background = () => { nativeVisible = false; if (timer) clearTimeout(timer); timer = null; };
  const online = () => { if (visible()) void run(true); else nextDue = -Infinity; };
  let lastPairing = pairingIdentity(client.pairing());
  const unsub = client.subscribe(() => {
    const identity = pairingIdentity(client.pairing());
    if (identity === lastPairing) return;
    lastPairing = identity;
    controller?.abort();
    clearOffer();
    set({ checked: false, phase: 'idle', error: null, downloadKind: null, lastCheckedAt: null, progress: null, checkSource: 'automatic' });
    nextDue = -Infinity;
    if (client.isPaired()) void run(true);
  });
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', online);
  window.addEventListener('focus', resume);
  window.addEventListener('pageshow', resume);
  window.addEventListener('vitalsForeground', resume);
  window.addEventListener('vitalsBackground', background);
  let handle: ListenerHandle | null = null;
  try {
    void Promise.resolve(plugin.addListener('updateReady', () => {
      const epoch = generation, identity = pairingIdentity(client.pairing());
      if (!stopped) void refresh(plugin, () => !stopped && epoch === generation && pairingIdentity(client.pairing()) === identity);
    }))
      .then((h) => { if (stopped) void h.remove(); else handle = h; }).catch(() => undefined);
  } catch { /* legacy bridge without event support */ }
  void run(true);
  return () => {
    stopped = true;
    controller?.abort();
    if (timer) clearTimeout(timer);
    unsub();
    if (requestNow === manual) requestNow = null;
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', online);
    window.removeEventListener('focus', resume);
    window.removeEventListener('pageshow', resume);
    window.removeEventListener('vitalsForeground', resume);
    window.removeEventListener('vitalsBackground', background);
    void handle?.remove();
  };
}
export function resetAndroidUpdatesForTests(): void {
  generation++;
  cached = null;
  offerPairing = null;
  operation = null;
  requestNow = null;
  view = emptyView();
  listeners.clear();
}
