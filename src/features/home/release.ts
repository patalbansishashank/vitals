/*
 * The latest public release: which file is which, how big it is, and where to get it. The file names are L-REL's
 * (.github/workflows/release.yml); they carry no version, so `releases/latest/download/<name>` always works.
 */
import { allowOrigin, isAllowed, netFetch } from '@/net/net';
import type { OsName } from '@/platform';

export const PUBLIC_REPO = 'patalbansishashank/vitals';
export const RELEASES_URL = `https://github.com/${PUBLIC_REPO}/releases`;
const API_URL = `https://api.github.com/repos/${PUBLIC_REPO}/releases/latest`;
const LATEST_DOWNLOAD = `${RELEASES_URL}/latest/download/`;

export type AssetKey = 'android' | 'linux-appimage' | 'linux-deb' | 'windows' | 'macos';

/** Only an installable, signed Android package may be offered. */
export const ASSET_NAMES: Record<AssetKey, readonly string[]> = {
  android: ['Vitals-android.apk'],
  'linux-appimage': ['Vitals-linux-x86_64.AppImage'],
  'linux-deb': ['Vitals-linux-amd64.deb'],
  windows: ['Vitals-windows-x64-setup.exe'],
  macos: ['Vitals-macos-universal.dmg'],
};

export const ASSET_LABEL: Record<AssetKey, string> = {
  android: 'Android',
  'linux-appimage': 'Linux (AppImage)',
  'linux-deb': 'Linux (Debian, Ubuntu)',
  windows: 'Windows',
  macos: 'Mac',
};

/** Display order of the "other systems" list. */
export const ASSET_ORDER: readonly AssetKey[] = ['android', 'windows', 'macos', 'linux-appimage', 'linux-deb'];

export interface ReleaseAsset {
  key: AssetKey;
  name: string;
  url: string;
  /** Bytes; absent when the release data could not be read. */
  size?: number;
}

export type ReleaseState =
  /** The release data was read. */
  | { kind: 'release'; version: string; assets: ReleaseAsset[] }
  /** The release data could not be read (offline, rate limit): the stable links, no sizes. */
  | { kind: 'links'; assets: ReleaseAsset[] }
  /** The repository has no release yet. */
  | { kind: 'none' };

export function fallbackAssets(): ReleaseAsset[] {
  // A failed release read cannot establish whether Android signing succeeded.
  return ASSET_ORDER.filter((key) => key !== 'android').map((key) => ({ key, name: ASSET_NAMES[key][0]!, url: LATEST_DOWNLOAD + ASSET_NAMES[key][0]! }));
}

interface ApiAsset {
  name?: unknown;
  size?: unknown;
}

/** Keeps the files the page offers, in display order; a file the release lacks is left out. */
export function parseRelease(body: unknown): ReleaseState | null {
  if (typeof body !== 'object' || body === null) return null;
  const tag = (body as { tag_name?: unknown }).tag_name;
  const list = (body as { assets?: unknown }).assets;
  if (typeof tag !== 'string' || !Array.isArray(list)) return null;
  const byName = new Map<string, ApiAsset>();
  for (const a of list as ApiAsset[]) if (a && typeof a.name === 'string') byName.set(a.name, a);
  const assets: ReleaseAsset[] = [];
  for (const key of ASSET_ORDER) {
    for (const name of ASSET_NAMES[key]) {
      const a = byName.get(name);
      if (!a) continue;
      // Release metadata supplies availability and size only. Keep download links on our own repository.
      assets.push({ key, name, url: LATEST_DOWNLOAD + name, size: typeof a.size === 'number' && a.size > 0 ? a.size : undefined });
      break;
    }
  }
  return { kind: 'release', version: tag.replace(/^v/, ''), assets };
}

// v1 cached API supplied download URLs, so do not reuse it after narrowing links.
const CACHE_KEY = 'vitals.release.v2';
const CACHE_MS = 60 * 60 * 1000;

function readCache(now: number): ReleaseState | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as { at?: number; state?: ReleaseState };
    if (typeof c.at !== 'number' || now - c.at >= CACHE_MS || !c.state) return null;
    if (c.state.kind === 'none') return c.state;
    if (c.state.kind === 'links') return { kind: 'links', assets: fallbackAssets() };
    if (c.state.kind !== 'release' || !Array.isArray(c.state.assets) || typeof c.state.version !== 'string') return null;
    const assets = c.state.assets.filter((asset) =>
      asset && ASSET_NAMES[asset.key]?.includes(asset.name) && typeof asset.url === 'string' && asset.url.startsWith('https://'),
    ).map((asset) => ({ ...asset, url: LATEST_DOWNLOAD + asset.name }));
    return assets.length ? { kind: 'release', version: c.state.version, assets } : { kind: 'none' };
  } catch {
    return null;
  }
}

function writeCache(now: number, state: ReleaseState): void {
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: now, state }));
  } catch {
    /* private mode: no cache */
  }
}

/** The cached state, if there is a fresh one (so the first paint can skip the wait). */
export function cachedRelease(now = Date.now()): ReleaseState | null {
  return typeof window === 'undefined' ? null : readCache(now);
}

/**
 * The network allowlist (src/net/net.ts) is the person's to manage, so the grant for the release host lasts only for
 * this one read and is not kept in the list, unless the person added the host themselves.
 */
const guardedFetch: typeof fetch = async (input, init) => {
  if (isAllowed(API_URL)) return netFetch(input, init);
  const revoke = allowOrigin(API_URL, 'other');
  try {
    return await netFetch(input, init);
  } finally {
    revoke();
  }
};

/** Reads the latest release; never throws. A failed read is not cached, so the next visit tries again. */
export async function loadRelease(fetchImpl: typeof fetch = guardedFetch, now = Date.now()): Promise<ReleaseState> {
  const hit = cachedRelease(now);
  if (hit) return hit;
  // one read at a time (StrictMode runs an effect twice)
  if (fetchImpl === guardedFetch && inflight) return inflight;
  const read = readRelease(fetchImpl, now);
  if (fetchImpl === guardedFetch) {
    inflight = read;
    void read.finally(() => (inflight = null));
  }
  return read;
}

let inflight: Promise<ReleaseState> | null = null;

async function readRelease(fetchImpl: typeof fetch, now: number): Promise<ReleaseState> {
  try {
    const res = await fetchImpl(API_URL, { headers: { Accept: 'application/vnd.github+json' } });
    if (res.status === 404) {
      const none: ReleaseState = { kind: 'none' };
      writeCache(now, none);
      return none;
    }
    if (!res.ok) return { kind: 'links', assets: fallbackAssets() };
    const state = parseRelease(await res.json());
    if (!state) return { kind: 'links', assets: fallbackAssets() };
    if (state.kind === 'release' && state.assets.length === 0) return { kind: 'none' };
    writeCache(now, state);
    return state;
  } catch {
    return { kind: 'links', assets: fallbackAssets() };
  }
}

/** The main key for this system, and the second choice shown beside it; none where there is no app (iPhone, Chromebook). */
export function mainKey(os: OsName): AssetKey | null {
  switch (os) {
    case 'android':
      return 'android';
    case 'windows':
      return 'windows';
    case 'macos':
      return 'macos';
    case 'linux':
      return 'linux-appimage';
    default:
      return null;
  }
}

export function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
}
