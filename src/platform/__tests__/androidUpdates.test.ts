import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SERVER_KEY, type ServerClient } from '@/net/server';
import {
  checkForUpdates,
  checkUpdatesNow,
  installUpdate,
  downloadOfferedUpdate,
  getUpdatesView,
  latestUrl,
  parseLatest,
  planUpdates,
  resetAndroidUpdatesForTests,
  sameOriginUrl,
  startUpdateChecks,
  statusLine,
  updateState,
  CHECK_EVERY_MS,
  RETRY_FIRST_MS,
  REQUEST_TIMEOUT_MS,
  type DownloadResult,
  type NativeUpdateStatus,
  type VitalsUpdatesPlugin,
} from '../androidUpdates';
import { androidUpdateBannerState } from '@/app/shell/AndroidUpdateBanner';
import { whenRendered } from '../androidBoot';

const BASE = 'https://home.example.ts.net:8444';
const SHA = 'a'.repeat(64);
const status = (over: Partial<NativeUpdateStatus> = {}): NativeUpdateStatus => ({
  versionName: '0.6.1',
  versionCode: 601,
  webVersion: '202610260905-a1b2c3d',
  webEmbedded: true,
  webPending: null,
  bad: [],
  metered: false,
  apk: null,
  ...over,
});
const web = (over: Record<string, unknown> = {}) => ({ version: '202610270905-b2c3d4e', sha256: SHA, size: 1000, url: '/v1/apps/vitals/files/web.zip', sig: 'c2ln', ...over });
const apk = (over: Record<string, unknown> = {}) => ({ versionName: '0.6.2', versionCode: 602, sha256: SHA.toUpperCase(), size: 20_000_000, url: `${BASE}/v1/apps/vitals/files/vitals.apk`, ...over });

describe('parseLatest', () => {
  it('reads both entries and lower-cases the hashes', () => {
    const l = parseLatest({ apk: apk({ notes: 'Fixes' }), web: web() });
    expect(l?.apk).toMatchObject({ versionCode: 602, sha256: SHA, notes: 'Fixes' });
    expect(l?.web?.version).toBe('202610270905-b2c3d4e');
  });

  it('treats nulls and malformed entries as nothing new, and a non-answer as null', () => {
    expect(parseLatest({ apk: null, web: null })).toEqual({ apk: null, web: null });
    expect(parseLatest({ apk: apk({ versionCode: 0 }), web: web({ sha256: 'xyz' }) })).toEqual({ apk: null, web: null });
    expect(parseLatest({ apk: null, web: web({ version: '../escape' }) })?.web).toBeNull();
    expect(parseLatest({ apk: null, web: web({ sig: '' }) })?.web).toBeNull();
    expect(parseLatest({ apk: apk({ size: -1 }), web: null })?.apk).toBeNull();
    expect(parseLatest({ error: 'not_found' })).toBeNull();
    expect(parseLatest(null)).toBeNull();
  });
});

describe('compatibility', () => {
  it('builds the latest URL from the installed versions', () => {
    expect(latestUrl(`${BASE}/`, status())).toBe(`${BASE}/v1/apps/vitals/latest?channel=stable&versionCode=601&web=202610260905-a1b2c3d`);
    // an APK without bundle.json names its own bundle apk-<versionName> (the server dates it by that APK's publish)
    expect(latestUrl(BASE, status({ webVersion: 'apk-0.6.1' }))).toBe(`${BASE}/v1/apps/vitals/latest?channel=stable&versionCode=601&web=apk-0.6.1`);
  });

  it('resolves the server\'s origin-relative file URLs against the paired origin', () => {
    // the server answers `/v1/apps/...` (no host), so the same answer works on every address it is reached at
    expect(sameOriginUrl('/v1/apps/vitals/files/stable/web-1.zip', 'https://oci.example.ts.net:8443')).toBe('https://oci.example.ts.net:8443/v1/apps/vitals/files/stable/web-1.zip');
    expect(sameOriginUrl('/v1/apps/vitals/files/stable/web-1.zip', `${BASE}/some/path`)).toBe(`${BASE}/v1/apps/vitals/files/stable/web-1.zip`);
  });

  it('only sends the token to the paired origin over https', () => {
    expect(sameOriginUrl('/v1/apps/vitals/files/x', BASE)).toBe(`${BASE}/v1/apps/vitals/files/x`);
    expect(sameOriginUrl(`${BASE}/f`, BASE)).toBe(`${BASE}/f`);
    expect(sameOriginUrl('https://evil.example/f', BASE)).toBeNull();
    expect(sameOriginUrl('//evil.example/f', BASE)).toBeNull();
    expect(sameOriginUrl('http://home.example.ts.net:8444/f', BASE)).toBeNull();
  });

  it('plans a newer web bundle and a newer APK', () => {
    const l = parseLatest({ apk: apk(), web: web() })!;
    const p = planUpdates(l, status(), BASE);
    expect(p.web?.url).toBe(`${BASE}/v1/apps/vitals/files/web.zip`);
    expect(p.apk?.versionCode).toBe(602);
  });

  it('never re-fetches a bad, served or waiting bundle, an APK that is not newer or one already downloaded', () => {
    const l = parseLatest({ apk: apk(), web: web() })!;
    const v = l.web!.version;
    expect(planUpdates(l, status({ bad: [v] }), BASE).web).toBeNull();
    expect(planUpdates(l, status({ webVersion: v, webEmbedded: false }), BASE).web).toBeNull();
    expect(planUpdates(l, status({ webPending: v }), BASE).web).toBeNull();
    expect(planUpdates(l, status({ versionCode: 602 }), BASE).apk).toBeNull();
    expect(planUpdates(l, status({ apk: { versionName: '0.6.2', versionCode: 602 } }), BASE).apk).toBeNull();
    expect(planUpdates(parseLatest({ apk: apk({ url: 'https://elsewhere.example/a.apk' }), web: null })!, status(), BASE).apk).toBeNull();
  });
});

describe('status line', () => {
  it('names both versions and the state', () => {
    expect(statusLine(status(), 'current')).toBe('Vitals 0.6.1 · web 202610260905-a1b2c3d (built in) · Up to date');
    expect(statusLine(status({ webEmbedded: false }), 'ready')).toBe('Vitals 0.6.1 · web 202610260905-a1b2c3d · Update ready');
    expect(statusLine(status(), 'unknown')).toBe('Vitals 0.6.1 · web 202610260905-a1b2c3d (built in)');
    expect(statusLine(null, 'current')).toBe('');
  });

  it('is ready when an APK waits, available when one waits for a tap, current after a check', () => {
    expect(updateState({ status: status({ apk: { versionName: '0.6.2', versionCode: 602 } }), available: null, checked: true })).toBe('ready');
    expect(updateState({ status: status(), available: parseLatest({ apk: apk(), web: null })!.apk, checked: true })).toBe('available');
    expect(updateState({ status: status(), available: null, checked: true })).toBe('current');
    expect(updateState({ status: status(), available: null, checked: false })).toBe('unknown');
  });
});

function fakePlugin(initial: NativeUpdateStatus, results: Record<string, string> = {}) {
  let st = initial;
  const plugin = {
    ready: vi.fn(async () => undefined),
    status: vi.fn(async () => st),
    download: vi.fn(async (o: Parameters<VitalsUpdatesPlugin['download']>[0]) => {
      const result = results[o.kind] ?? (o.kind === 'web' ? 'staged' : 'ready');
      if (o.kind === 'web' && result === 'staged') st = { ...st, webPending: o.version ?? null };
      if (o.kind === 'apk' && result === 'ready') st = { ...st, apk: { versionName: o.versionName ?? '', versionCode: o.versionCode ?? 0 } };
      return { result: result as DownloadResult };
    }),
    install: vi.fn(async () => ({ result: 'started' as const })),
    addListener: vi.fn<VitalsUpdatesPlugin['addListener']>(async () => ({ remove: vi.fn() })),
  };
  return plugin satisfies VitalsUpdatesPlugin;
}

function fakeClient(body: unknown, opts: { paired?: boolean; status?: number } = {}) {
  const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status: opts.status ?? 200 }));
  const client = {
    pairing: () => (opts.paired === false ? null : { baseUrl: BASE, deviceId: 'd1', person: { id: 'p', label: 'P' }, pairedAt: '' }),
    isPaired: () => opts.paired !== false,
    subscribe: () => () => {},
    chatModelOptions: () => ({ serverUrl: BASE, deps: { fetch: fetch as unknown as typeof globalThis.fetch } }),
  } as unknown as ServerClient;
  return { client, fetch };
}

function changingClient(fetch: typeof globalThis.fetch) {
  let pairing: ReturnType<ServerClient['pairing']> = { baseUrl: BASE, deviceId: 'd1', person: { id: 'p', label: 'P' }, pairedAt: 'A' };
  const listeners = new Set<() => void>();
  const client = {
    pairing: () => pairing,
    isPaired: () => pairing !== null,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => void listeners.delete(fn); },
    chatModelOptions: () => ({ serverUrl: pairing?.baseUrl ?? BASE, deps: { fetch } }),
  } as unknown as ServerClient;
  return {
    client,
    change(next: typeof pairing) { pairing = next; listeners.forEach((fn) => fn()); },
  };
}

describe('checkForUpdates', () => {
  beforeEach(() => resetAndroidUpdatesForTests());
  afterEach(() => resetAndroidUpdatesForTests());

  it('asks the paired server and hands new entries, with the token, to the native side', async () => {
    const plugin = fakePlugin(status());
    const { client, fetch } = fakeClient({ apk: apk(), web: web() });
    await checkForUpdates({ plugin, client, token: () => 'tok' });
    expect(String(fetch.mock.calls[0]?.[0])).toContain('/v1/apps/vitals/latest?channel=stable&versionCode=601');
    expect(plugin.download).toHaveBeenCalledWith(expect.objectContaining({ kind: 'web', token: 'tok', sig: 'c2ln', url: `${BASE}/v1/apps/vitals/files/web.zip` }));
    expect(plugin.download).toHaveBeenCalledWith(expect.objectContaining({ kind: 'apk', versionCode: 602, token: 'tok' }));
    expect(updateState(getUpdatesView())).toBe('ready');
  });

  it('keeps automatic no-update and failed checks quiet, while a manual failure has retry feedback', async () => {
    const plugin = fakePlugin(status());
    const { client, fetch } = fakeClient({ apk: null, web: null });
    await checkForUpdates({ plugin, client, token: () => 'tok' });
    expect(androidUpdateBannerState(getUpdatesView())).toBeNull();
    fetch.mockRejectedValue(new Error('offline'));
    await checkForUpdates({ plugin, client, token: () => 'tok' });
    expect(getUpdatesView()).toMatchObject({ error: 'check', checkSource: 'automatic' });
    expect(androidUpdateBannerState(getUpdatesView())).toBeNull();
    await checkForUpdates({ plugin, client, token: () => 'tok', source: 'manual' });
    expect(androidUpdateBannerState(getUpdatesView())).toMatchObject({ action: 'retry-check' });
  });

  it('automatically permits a metered APK transfer and shares concurrent discovery/download work', async () => {
    const plugin = fakePlugin(status({ metered: true }));
    const { client, fetch } = fakeClient({ apk: apk({ size: 40_000_000 }), web: null });
    const first = checkForUpdates({ plugin, client, token: () => 'tok' });
    const second = checkForUpdates({ plugin, client, token: () => 'tok' });
    expect(second).toBe(first);
    await first;
    expect(fetch).toHaveBeenCalledOnce();
    expect(plugin.download).toHaveBeenCalledOnce();
    expect(plugin.download).toHaveBeenCalledWith(expect.objectContaining({ userAsked: true, transferId: expect.any(String) }));
    expect(updateState(getUpdatesView())).toBe('ready');
  });

  it('accepts only matching monotonic byte progress and waits for verified native status before Install', async () => {
    const plugin = fakePlugin(status());
    let progress!: (event: unknown) => void;
    const remove = vi.fn();
    plugin.addListener.mockImplementation((_event, callback) => { progress = callback; return { remove }; });
    let finish!: (result: { result: 'ready' }) => void;
    plugin.download.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { client } = fakeClient({ apk: apk({ size: 1000 }), web: null });
    const checking = checkForUpdates({ plugin, client, token: () => 'tok' });
    await vi.waitFor(() => expect(plugin.download).toHaveBeenCalledOnce());
    const transferId = plugin.download.mock.calls[0]![0].transferId!;
    const event = { transferId, kind: 'apk', received: 490, total: 1000, phase: 'downloading' };
    progress({ ...event, transferId: 'old-transfer' });
    progress({ ...event, total: 2000 });
    expect(getUpdatesView().progress).toBeNull();
    progress(event);
    expect(getUpdatesView().progress?.received).toBe(490);
    const shown = getUpdatesView();
    progress({ ...event, received: 499 });
    progress({ ...event, received: 100 });
    expect(getUpdatesView()).toBe(shown); // unchanged whole percent and regressive events do not repaint
    progress({ ...event, received: 1000, phase: 'verifying' });
    expect(androidUpdateBannerState(getUpdatesView())).toMatchObject({ title: 'Preparing the update', progress: 100 });
    expect(androidUpdateBannerState(getUpdatesView())?.action).toBeUndefined();
    progress({ ...event, received: 1000 });
    expect(getUpdatesView().progress?.phase).toBe('verifying');
    plugin.status.mockResolvedValue(status({ apk: { versionName: '0.6.2', versionCode: 602 } }));
    finish({ result: 'ready' }); await checking;
    expect(androidUpdateBannerState(getUpdatesView())).toMatchObject({ action: 'install' });
    progress(event);
    expect(getUpdatesView().progress).toBeNull();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('retains a known web-transfer failure through an offline automatic poll, then clears it on successful discovery', async () => {
    const plugin = fakePlugin(status(), { web: 'failed' });
    const { client, fetch } = fakeClient({ apk: null, web: web() });
    await checkForUpdates({ plugin, client, token: () => 'tok' });
    expect(androidUpdateBannerState(getUpdatesView())?.title).toBe("Couldn't download the update.");
    fetch.mockRejectedValueOnce(new Error('offline'));
    await checkForUpdates({ plugin, client, token: () => 'tok' });
    expect(getUpdatesView()).toMatchObject({ error: 'download', checkSource: 'automatic' });
    expect(androidUpdateBannerState(getUpdatesView())?.title).toBe("Couldn't download the update.");
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ apk: null, web: null })));
    await checkForUpdates({ plugin, client, token: () => 'tok' });
    expect(getUpdatesView().error).toBeNull();
    expect(androidUpdateBannerState(getUpdatesView())).toBeNull();
  });

  it('does not treat a download callback alone as a staged/ready file', async () => {
    const plugin = fakePlugin(status());
    plugin.download.mockResolvedValue({ result: 'ready' }); // native status still has no verified file
    const { client } = fakeClient({ apk: apk(), web: null });
    expect(await checkForUpdates({ plugin, client, token: () => 'tok' })).toBe(false);
    expect(getUpdatesView()).toMatchObject({ phase: 'error', error: 'download' });
    expect(androidUpdateBannerState(getUpdatesView())?.action).toBe('download');
  });

  it('cosmetic listener removal cannot stall a completed transfer or the next check', async () => {
    const plugin = fakePlugin(status());
    plugin.addListener.mockResolvedValue({ remove: () => new Promise<void>(() => {}) });
    const { client, fetch } = fakeClient({ apk: apk(), web: null });
    expect(await checkForUpdates({ plugin, client, token: () => 'tok' })).toBe(true);
    await checkForUpdates({ plugin, client, token: () => 'tok' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(plugin.download).toHaveBeenCalledOnce();
  });

  it('contains rejected cleanup even when listener registration finishes after the transfer', async () => {
    const plugin = fakePlugin(status());
    let register!: (handle: { remove: () => Promise<void> }) => void;
    plugin.addListener.mockImplementationOnce(() => new Promise(resolve => { register = resolve; }));
    const { client } = fakeClient({ apk: apk(), web: null });
    expect(await checkForUpdates({ plugin, client, token: () => 'tok' })).toBe(true);
    const remove = vi.fn(async () => { throw new Error('bridge gone'); });
    register({ remove });
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect(updateState(getUpdatesView())).toBe('ready');
  });

  it('retains a legacy native transfer refusal as an explicit retryable offer', async () => {
    const plugin = fakePlugin(status(), { apk: 'metered' });
    const { client } = fakeClient({ apk: apk({ size: 40_000_000 }), web: null });
    await checkForUpdates({ plugin, client, token: () => 'tok' });
    expect(updateState(getUpdatesView())).toBe('available');
  });

  it('announces the offered APK before its download finishes, without opening Settings', async () => {
    const plugin = fakePlugin(status());
    let finish!: (value: { result: 'ready' }) => void;
    plugin.download.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { client } = fakeClient({ apk: apk(), web: null });
    const checking = checkForUpdates({ plugin, client, token: () => 'tok' });
    await vi.waitFor(() => expect(plugin.download).toHaveBeenCalledTimes(1));
    expect(getUpdatesView()).toMatchObject({ available: { versionCode: 602 }, phase: 'downloading', downloadKind: 'apk' });
    expect(updateState(getUpdatesView())).toBe('available');
    plugin.status.mockResolvedValue(status({ apk: { versionName: '0.6.2', versionCode: 602 } }));
    finish({ result: 'ready' });
    await checking;
    expect(updateState(getUpdatesView())).toBe('ready');
  });

  it('retains a failed download for retry and never offers an older cached installer as the new update', async () => {
    const plugin = fakePlugin(status({ apk: { versionName: '0.6.2', versionCode: 602 } }), { apk: 'failed' });
    (globalThis as { Capacitor?: unknown }).Capacitor = { getPlatform: () => 'android', registerPlugin: () => plugin };
    const { client } = fakeClient({ apk: apk({ versionName: '0.6.3', versionCode: 603 }), web: null });
    expect(await checkForUpdates({ plugin, client, token: () => 'tok' })).toBe(false);
    expect(getUpdatesView()).toMatchObject({ available: { versionCode: 603 }, phase: 'error', error: 'download' });
    expect(updateState(getUpdatesView())).toBe('available');
    await installUpdate();
    expect(plugin.install).not.toHaveBeenCalled();
    delete (globalThis as { Capacitor?: unknown }).Capacitor;
  });

  it('is up to date when the server has nothing newer', async () => {
    const plugin = fakePlugin(status());
    const { client } = fakeClient({ apk: null, web: null });
    await checkForUpdates({ plugin, client, token: () => 'tok' });
    expect(plugin.download).not.toHaveBeenCalled();
    expect(updateState(getUpdatesView())).toBe('current');
  });

  it('does nothing unpaired, and stays quiet on a server without releases', async () => {
    const plugin = fakePlugin(status());
    const unpaired = fakeClient({ apk: apk(), web: null }, { paired: false });
    await checkForUpdates({ plugin, client: unpaired.client, token: () => 'tok' });
    expect(unpaired.fetch).not.toHaveBeenCalled();
    const old = fakeClient({ error: 'not_found' }, { status: 404 });
    await checkForUpdates({ plugin, client: old.client, token: () => 'tok' });
    expect(plugin.download).not.toHaveBeenCalled();
    expect(updateState(getUpdatesView())).toBe('unknown');
  });

  it('downloads nothing without the token', async () => {
    const plugin = fakePlugin(status());
    const { client } = fakeClient({ apk: apk(), web: web() });
    await checkForUpdates({ plugin, client, token: () => null });
    expect(plugin.download).not.toHaveBeenCalled();
  });

  it('reports an unusable offered origin without leaking a bearer or claiming the app is current', async () => {
    const plugin = fakePlugin(status());
    const { client } = fakeClient({ apk: apk({ url: 'https://other.example/update.apk' }), web: null });
    expect(await checkForUpdates({ plugin, client, token: () => 'tok' })).toBe(false);
    expect(plugin.download).not.toHaveBeenCalled();
    expect(getUpdatesView()).toMatchObject({ checked: false, error: 'check' });
    expect(updateState(getUpdatesView())).toBe('unknown');
  });

  it('does not publish an old offer or download when the pairing changes during the latest request', async () => {
    let finish!: (r: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })) as unknown as typeof globalThis.fetch;
    const { client, change } = changingClient(fetch);
    const plugin = fakePlugin(status(), { apk: 'metered' });
    let token = 'A';
    const check = checkForUpdates({ plugin, client, token: () => token });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    change({ baseUrl: 'https://other.example', deviceId: 'd2', person: { id: 'p', label: 'P' }, pairedAt: 'B' });
    token = 'B';
    finish(new Response(JSON.stringify({ apk: apk({ size: 40_000_000 }), web: web() })));
    await check;
    expect(plugin.download).not.toHaveBeenCalled();
    expect(getUpdatesView().available).toBeNull();
  });

  it('does not continue downloads after unpairing during an APK download', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ apk: apk(), web: web() }))) as unknown as typeof globalThis.fetch;
    const { client, change } = changingClient(fetch);
    const plugin = fakePlugin(status());
    let finish!: (r: { result: 'staged' }) => void;
    plugin.download.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const check = checkForUpdates({ plugin, client, token: () => 'A' });
    await vi.waitFor(() => expect(plugin.download).toHaveBeenCalledTimes(1));
    expect(plugin.download.mock.calls[0]?.[0].kind).toBe('apk');
    change(null);
    finish({ result: 'staged' });
    await check;
    expect(plugin.download).toHaveBeenCalledTimes(1);
    expect(getUpdatesView().available).toBeNull();
  });
});

describe('offered APK pairing', () => {
  beforeEach(() => resetAndroidUpdatesForTests());
  afterEach(() => {
    localStorage.removeItem(SERVER_KEY);
    delete (globalThis as { Capacitor?: unknown }).Capacitor;
    resetAndroidUpdatesForTests();
  });

  it('downloads a metered offer on the same pairing and origin after the tap', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ apk: apk({ size: 40_000_000 }), web: null }))) as unknown as typeof globalThis.fetch;
    const { client } = changingClient(fetch);
    const plugin = fakePlugin(status(), { apk: 'metered' });
    (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', registerPlugin: () => plugin };
    localStorage.setItem(SERVER_KEY, JSON.stringify({ baseUrl: BASE, token: 'A' }));
    await checkForUpdates({ plugin, client, token: () => 'A' });
    expect(getUpdatesView().available).not.toBeNull();
    plugin.download.mockClear();
    await downloadOfferedUpdate(client);
    expect(plugin.download).toHaveBeenCalledWith(expect.objectContaining({ kind: 'apk', url: `${BASE}/v1/apps/vitals/files/vitals.apk`, token: 'A', userAsked: true }));
  });

  it('clears an old offer after re-pairing, even when the server origin is unchanged', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ apk: apk({ size: 40_000_000 }), web: null }))) as unknown as typeof globalThis.fetch;
    const { client, change } = changingClient(fetch);
    const plugin = fakePlugin(status(), { apk: 'metered' });
    (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', registerPlugin: () => plugin };
    localStorage.setItem(SERVER_KEY, JSON.stringify({ baseUrl: BASE, token: 'A' }));
    await checkForUpdates({ plugin, client, token: () => 'A' });
    expect(getUpdatesView().available).not.toBeNull();
    change({ baseUrl: BASE, deviceId: 'd2', person: { id: 'p', label: 'P' }, pairedAt: 'B' });
    localStorage.setItem(SERVER_KEY, JSON.stringify({ baseUrl: BASE, token: 'B' }));
    plugin.download.mockClear();
    await downloadOfferedUpdate(client);
    expect(plugin.download).not.toHaveBeenCalled();
    expect(getUpdatesView().available).toBeNull();
  });

  it('never sends the new server token to an offer from the old server', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ apk: apk({ size: 40_000_000 }), web: null }))) as unknown as typeof globalThis.fetch;
    const { client, change } = changingClient(fetch);
    const plugin = fakePlugin(status(), { apk: 'metered' });
    (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', registerPlugin: () => plugin };
    localStorage.setItem(SERVER_KEY, JSON.stringify({ baseUrl: BASE, token: 'A' }));
    await checkForUpdates({ plugin, client, token: () => 'A' });
    change({ baseUrl: 'https://other.example', deviceId: 'd2', person: { id: 'p', label: 'P' }, pairedAt: 'B' });
    localStorage.setItem(SERVER_KEY, JSON.stringify({ baseUrl: 'https://other.example', token: 'B' }));
    plugin.download.mockClear();
    await downloadOfferedUpdate(client);
    expect(plugin.download).not.toHaveBeenCalled();
    expect(getUpdatesView().available).toBeNull();
  });
});

describe('startUpdateChecks', () => {
  afterEach(() => {
    localStorage.removeItem(SERVER_KEY);
    delete (globalThis as { Capacitor?: unknown }).Capacitor;
    resetAndroidUpdatesForTests();
    vi.useRealTimers();
  });

  it('checks at launch and every minute in front, then cleans up its timer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    localStorage.setItem(SERVER_KEY, JSON.stringify({ baseUrl: BASE, token: 'A' }));
    const plugin = fakePlugin(status());
    (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', registerPlugin: () => plugin };
    const { client, fetch } = fakeClient({ apk: null, web: null });
    const stop = startUpdateChecks({ client });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS - 1);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('checks promptly on foreground and online recovery, while pausing periodic work in background', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    localStorage.setItem(SERVER_KEY, JSON.stringify({ baseUrl: BASE, token: 'A' }));
    const plugin = fakePlugin(status());
    (globalThis as { Capacitor?: unknown }).Capacitor = { getPlatform: () => 'android', registerPlugin: () => plugin };
    const { client, fetch } = fakeClient({ apk: null, web: null });
    const stop = startUpdateChecks({ client });
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event('vitalsBackground'));
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 3);
    expect(fetch).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('vitalsForeground'));
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(3);
    stop();
    window.dispatchEvent(new Event('vitalsForeground'));
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('retries a failed check after seconds instead of consuming a day, and a manual retry bypasses cooldown', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    localStorage.setItem(SERVER_KEY, JSON.stringify({ baseUrl: BASE, token: 'A' }));
    const plugin = fakePlugin(status());
    (globalThis as { Capacitor?: unknown }).Capacitor = { getPlatform: () => 'android', registerPlugin: () => plugin };
    const { client, fetch } = fakeClient({ apk: null, web: null });
    fetch.mockRejectedValueOnce(new Error('offline'));
    const stop = startUpdateChecks({ client });
    await vi.advanceTimersByTimeAsync(0);
    expect(getUpdatesView()).toMatchObject({ checked: false, phase: 'error', error: 'check' });
    await vi.advanceTimersByTimeAsync(RETRY_FIRST_MS - 1);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getUpdatesView()).toMatchObject({ checked: true, phase: 'idle', error: null });
    await checkUpdatesNow();
    expect(fetch).toHaveBeenCalledTimes(3);
    stop();
  });

  it('bounds a hung metadata request, aborts its transport and recovers on the prompt retry', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    localStorage.setItem(SERVER_KEY, JSON.stringify({ baseUrl: BASE, token: 'A' }));
    const plugin = fakePlugin(status());
    (globalThis as { Capacitor?: unknown }).Capacitor = { getPlatform: () => 'android', registerPlugin: () => plugin };
    const { client, fetch } = fakeClient({ apk: null, web: null });
    fetch.mockImplementationOnce(() => new Promise<Response>(() => {}));
    const stop = startUpdateChecks({ client });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(getUpdatesView()).toMatchObject({ phase: 'error', error: 'check' });
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(RETRY_FIRST_MS);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getUpdatesView().phase).toBe('idle');
    stop();
  });

  it('stops timers and ignores a response that arrives after the scheduler is stopped', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    localStorage.setItem(SERVER_KEY, JSON.stringify({ baseUrl: BASE, token: 'A' }));
    const plugin = fakePlugin(status());
    (globalThis as { Capacitor?: unknown }).Capacitor = { getPlatform: () => 'android', registerPlugin: () => plugin };
    const { client, fetch } = fakeClient({ apk: null, web: null });
    let finish!: (response: Response) => void;
    fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const stop = startUpdateChecks({ client });
    await vi.advanceTimersByTimeAsync(0);
    const before = getUpdatesView();
    stop();
    finish(new Response(JSON.stringify({ apk: apk(), web: web() })));
    await vi.advanceTimersByTimeAsync(0);
    expect(getUpdatesView()).toBe(before);
    expect(plugin.download).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('checks a new pairing after an old in-flight check completes', async () => {
    let finish!: (r: Response) => void;
    const fetch = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }))
      .mockImplementation(async () => new Response(JSON.stringify({ apk: null, web: null }))) as unknown as typeof globalThis.fetch;
    const { client, change } = changingClient(fetch);
    const plugin = fakePlugin(status());
    (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', registerPlugin: () => plugin };
    localStorage.setItem(SERVER_KEY, JSON.stringify({ baseUrl: BASE, token: 'A' }));
    const stop = startUpdateChecks({ client });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    change({ baseUrl: 'https://other.example', deviceId: 'd2', person: { id: 'p', label: 'P' }, pairedAt: 'B' });
    localStorage.setItem(SERVER_KEY, JSON.stringify({ baseUrl: 'https://other.example', token: 'B' }));
    finish(new Response(JSON.stringify({ apk: apk({ size: 40_000_000 }), web: null })));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(String(vi.mocked(fetch).mock.calls[1]?.[0])).toContain('other.example');
    expect(getUpdatesView().available).toBeNull();
    stop();
  });

  it('does not classify forced foreground checks as manual and ignores late ready-status reads after stop', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    localStorage.setItem(SERVER_KEY, JSON.stringify({ baseUrl: BASE, token: 'A' }));
    const plugin = fakePlugin(status());
    let ready!: () => void;
    plugin.addListener.mockImplementation((event, callback) => { if (event === 'updateReady') ready = () => callback({}); return { remove: vi.fn() }; });
    (globalThis as { Capacitor?: unknown }).Capacitor = { getPlatform: () => 'android', registerPlugin: () => plugin };
    const { client, fetch } = fakeClient({ apk: null, web: null });
    fetch.mockRejectedValue(new Error('offline'));
    const stop = startUpdateChecks({ client });
    await vi.advanceTimersByTimeAsync(0);
    expect(androidUpdateBannerState(getUpdatesView())).toBeNull();
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(getUpdatesView().checkSource).toBe('automatic');
    expect(androidUpdateBannerState(getUpdatesView())).toBeNull();
    await checkUpdatesNow();
    expect(androidUpdateBannerState(getUpdatesView())?.action).toBe('retry-check');
    let finish!: (value: NativeUpdateStatus) => void;
    plugin.status.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    ready(); await vi.advanceTimersByTimeAsync(0);
    stop();
    const before = getUpdatesView();
    finish(status({ apk: { versionName: 'old', versionCode: 602 } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(getUpdatesView()).toBe(before);
  });

  it('does nothing outside the Android app', () => {
    const { client, fetch } = fakeClient({ apk: null, web: null });
    startUpdateChecks({ client })();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('whenRendered (the web bundle confirms it started)', () => {
  it('fires once the root has content, and never for an empty root', async () => {
    const root = document.createElement('div');
    const cb = vi.fn();
    const stop = whenRendered(cb, () => root);
    await new Promise((r) => requestAnimationFrame(r));
    expect(cb).not.toHaveBeenCalled();
    root.appendChild(document.createElement('main'));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    expect(cb).toHaveBeenCalledTimes(1);
    stop();
  });
});
