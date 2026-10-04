import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { listAllowed, resetNetAllowlist } from '@/net/net';
import { platformCaps, type PlatformCaps } from '@/platform';
import { DownloadsBlock } from '../DownloadsBlock';
import { ASSET_NAMES, PUBLIC_REPO, formatSize, loadRelease, mainKey, parseRelease } from '../release';

const MB = 1024 * 1024;
const SIZES: Record<string, number> = {
  'Vitals-android.apk': 31 * MB,
  'Vitals-linux-x86_64.AppImage': 118 * MB,
  'Vitals-linux-amd64.deb': 84 * MB,
  'Vitals-windows-x64-setup.exe': 92 * MB,
  'Vitals-macos-universal.dmg': 131 * MB,
};
const BASE = `https://github.com/${PUBLIC_REPO}/releases/download/v0.5.0/`;
const RELEASE = {
  tag_name: 'v0.5.0',
  assets: [...Object.entries(SIZES).map(([name, size]) => ({ name, size, browser_download_url: BASE + name })), { name: 'SHA256SUMS.txt', size: 400, browser_download_url: BASE + 'SHA256SUMS.txt' }, { name: 'latest.yml', size: 300, browser_download_url: BASE + 'latest.yml' }],
};

const caps = (os: PlatformCaps['os'], platform: PlatformCaps['platform'] = 'web'): PlatformCaps => ({
  ...platformCaps(),
  platform,
  os,
  installedApp: platform === 'android' || platform === 'electron',
});

const reply = (status: number, body?: unknown) => () => Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status }));

beforeEach(() => {
  resetNetAllowlist();
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('release data', () => {
  it('keeps the five app files in order and drops the rest', () => {
    const s = parseRelease(RELEASE);
    expect(s).toMatchObject({ kind: 'release', version: '0.5.0' });
    if (s?.kind !== 'release') throw new Error('no release');
    expect(s.assets.map((a) => a.name)).toEqual(['Vitals-android.apk', 'Vitals-windows-x64-setup.exe', 'Vitals-macos-universal.dmg', 'Vitals-linux-x86_64.AppImage', 'Vitals-linux-amd64.deb']);
    expect(s.assets[0]).toMatchObject({ size: 31 * MB, url: `https://github.com/${PUBLIC_REPO}/releases/latest/download/Vitals-android.apk` });
  });
  it('ignores download URLs supplied by release metadata', () => {
    const s = parseRelease({ tag_name: 'v0.5.0', assets: [{ name: 'Vitals-android.apk', size: 31 * MB, browser_download_url: 'https://downloads.example.invalid/Vitals-android.apk' }] });
    expect(s?.kind === 'release' && s.assets[0]?.url).toBe(`https://github.com/${PUBLIC_REPO}/releases/latest/download/Vitals-android.apk`);
  });
  it('discards the old cache format that kept supplied download URLs', async () => {
    sessionStorage.setItem('vitals.release.v1', JSON.stringify({ at: Date.now(), state: { kind: 'release', version: '0.5.0', assets: [{ key: 'android', name: 'Vitals-android.apk', url: 'https://downloads.example.invalid/app.apk' }] } }));
    const read = vi.fn(reply(200, RELEASE));
    const state = await loadRelease(read as unknown as typeof fetch);
    expect(read).toHaveBeenCalledTimes(1);
    expect(state.kind === 'release' && state.assets[0]?.url).toBe(`https://github.com/${PUBLIC_REPO}/releases/latest/download/Vitals-android.apk`);
  });
  it('never offers an unsigned APK as an installable download', () => {
    const only = { tag_name: 'v0.5.0', assets: [{ name: 'Vitals-android-unsigned.apk', size: 5, browser_download_url: BASE + 'Vitals-android-unsigned.apk' }] };
    const s = parseRelease(only);
    expect(s?.kind === 'release' && s.assets).toEqual([]);
  });
  it('picks the main key per system, none for iPhone and Chromebook', () => {
    expect(mainKey('android')).toBe('android');
    expect(mainKey('windows')).toBe('windows');
    expect(mainKey('macos')).toBe('macos');
    expect(mainKey('linux')).toBe('linux-appimage');
    expect(mainKey('ios')).toBeNull();
    expect(mainKey('chromeos')).toBeNull();
  });
  it('writes sizes in MB', () => {
    expect(formatSize(31 * MB)).toBe('31.0 MB');
    expect(formatSize(131 * MB)).toBe('131 MB');
  });
  it('caches a read for the session, and falls back to the stable links on any failure', async () => {
    const ok = vi.fn(reply(200, RELEASE));
    await loadRelease(ok as unknown as typeof fetch);
    await loadRelease(ok as unknown as typeof fetch);
    expect(ok).toHaveBeenCalledTimes(1);
    sessionStorage.clear();
    for (const f of [reply(403), reply(500), () => Promise.reject(new Error('offline')), reply(200, { nope: 1 })]) {
      const s = await loadRelease(f as unknown as typeof fetch);
      expect(s.kind).toBe('links');
      if (s.kind === 'links') {
        expect(s.assets.every((a) => a.url === `https://github.com/${PUBLIC_REPO}/releases/latest/download/${a.name}`)).toBe(true);
        expect(s.assets.some((a) => a.key === 'android')).toBe(false);
      }
    }
    expect(sessionStorage.length).toBe(0);
  });
  it('reaches the release host only for the read, and leaves the person\'s allowlist as it was', async () => {
    const f = vi.fn(reply(200, RELEASE));
    vi.stubGlobal('fetch', f);
    expect(listAllowed()).toEqual([]);
    expect((await loadRelease()).kind).toBe('release');
    expect(f).toHaveBeenCalledTimes(1);
    expect(listAllowed()).toEqual([]);
  });
  it('says so when there is no release yet', async () => {
    expect((await loadRelease(reply(404) as unknown as typeof fetch)).kind).toBe('none');
  });
  it('says so when a release contains only an unsigned Android package', async () => {
    const unsigned = { tag_name: 'v0.5.0', assets: [{ name: 'Vitals-android-unsigned.apk', size: 5, browser_download_url: BASE + 'Vitals-android-unsigned.apk' }] };
    expect((await loadRelease(reply(200, unsigned) as unknown as typeof fetch)).kind).toBe('none');
  });
  it('filters unsupported assets from the current cache before showing downloads', async () => {
    const at = Date.now();
    sessionStorage.setItem('vitals.release.v2', JSON.stringify({ at, state: {
      kind: 'release', version: '0.5.0', assets: [
        { key: 'android', name: 'Vitals-android-unsigned.apk', url: BASE + 'Vitals-android-unsigned.apk' },
        { key: 'windows', name: 'Vitals-windows-x64-setup.exe', url: BASE + 'Vitals-windows-x64-setup.exe' },
      ],
    } }));
    const fromCache = await loadRelease(vi.fn(reply(500)) as unknown as typeof fetch, at);
    expect(fromCache.kind === 'release' && fromCache.assets.map((a) => a.key)).toEqual(['windows']);
    sessionStorage.setItem('vitals.release.v2', JSON.stringify({ at, state: {
      kind: 'release', version: '0.5.0', assets: [{ key: 'android', name: 'Vitals-android-unsigned.apk', url: BASE + 'Vitals-android-unsigned.apk' }],
    } }));
    expect((await loadRelease(vi.fn(reply(500)) as unknown as typeof fetch, at)).kind).toBe('none');
  });
  it('pins supported cached assets to the same release links as fresh metadata', async () => {
    const at = Date.now();
    sessionStorage.setItem('vitals.release.v2', JSON.stringify({ at, state: {
      kind: 'release', version: '0.5.0', assets: [{ key: 'android', name: 'Vitals-android.apk', url: BASE + 'unexpected.apk' }],
    } }));
    const read = vi.fn(reply(500));
    const state = await loadRelease(read as unknown as typeof fetch, at);
    expect(read).not.toHaveBeenCalled();
    expect(state.kind === 'release' && state.assets[0]?.url).toBe(`https://github.com/${PUBLIC_REPO}/releases/latest/download/Vitals-android.apk`);
  });
  it('every stable name is in the list L-REL publishes', () => {
    expect(Object.values(ASSET_NAMES).flat()).toContain('Vitals-linux-x86_64.AppImage');
  });
});

describe('DownloadsBlock', () => {
  it.each([
    ['android', 'Download for Android', 'Vitals-android.apk'],
    ['windows', 'Download for Windows', 'Vitals-windows-x64-setup.exe'],
    ['macos', 'Download for Mac', 'Vitals-macos-universal.dmg'],
    ['linux', 'Download for Linux (AppImage)', 'Vitals-linux-x86_64.AppImage'],
  ] as const)('puts the %s file on the main key, with version and size, and the others beneath', async (os, label, file) => {
    vi.stubGlobal('fetch', vi.fn(reply(200, RELEASE)));
    render(<DownloadsBlock caps={caps(os)} />);
    const key = await screen.findByRole('link', { name: label });
    expect(key).toHaveAttribute('href', `https://github.com/${PUBLIC_REPO}/releases/latest/download/${file}`);
    await screen.findByText(/Version 0\.5\.0 · \d+(\.\d)? MB/);
    const others = screen.getByRole('list', { name: 'Other systems' });
    expect(others.querySelectorAll('a')).toHaveLength(4);
    expect(others.textContent).toMatch(/MB/);
    expect(screen.getByRole('button', { name: 'Or keep using the website' })).toBeInTheDocument();
  });

  it('shows real links with no sizes while the data is on its way and when it fails', async () => {
    const f = vi.fn(reply(500));
    vi.stubGlobal('fetch', f);
    render(<DownloadsBlock caps={caps('windows')} />);
    const key = screen.getByRole('link', { name: 'Download for Windows' });
    expect(key.getAttribute('href')).toMatch(/\/releases\/latest\/download\/Vitals-windows-x64-setup\.exe$/);
    await waitFor(() => expect(f).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByText(/MB/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Download for Windows' })).toBeInTheDocument();
  });

  it('says there is no download yet when the repository has no release', async () => {
    vi.stubGlobal('fetch', vi.fn(reply(404)));
    render(<DownloadsBlock caps={caps('linux')} />);
    expect(await screen.findByText(/first download is not ready yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All releases' })).toHaveAttribute('href', `https://github.com/${PUBLIC_REPO}/releases`);
    expect(screen.queryByRole('link', { name: /Download for/ })).toBeNull();
  });

  it('on iPhone has no main key and points to the home screen', async () => {
    vi.stubGlobal('fetch', vi.fn(reply(200, RELEASE)));
    render(<DownloadsBlock caps={caps('ios')} />);
    expect(await screen.findByText(/add it to your home screen/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Download for/ })).toBeNull();
    expect(screen.getByRole('list', { name: 'Other systems' }).querySelectorAll('a')).toHaveLength(5);
  });

  it('gives Android a website option when the release has no signed package', async () => {
    const unsigned = { tag_name: 'v0.5.0', assets: [{ name: 'Vitals-android-unsigned.apk', size: 5, browser_download_url: BASE + 'Vitals-android-unsigned.apk' }, ...RELEASE.assets.filter((a) => a.name !== 'Vitals-android.apk')] };
    vi.stubGlobal('fetch', vi.fn(reply(200, unsigned)));
    render(<DownloadsBlock caps={caps('android')} />);
    expect(await screen.findByText(/Android app is not ready to install yet/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Download for Android' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Other systems' }).querySelectorAll('a')).toHaveLength(4);
  });

  it('warns once about the unsigned build of the main key', async () => {
    vi.stubGlobal('fetch', vi.fn(reply(200, RELEASE)));
    render(<DownloadsBlock caps={caps('windows')} />);
    expect(await screen.findByText(/unknown publisher/)).toBeInTheDocument();
  });

  it('is not shown in the apps or the PWA', () => {
    const f = vi.fn(reply(200, RELEASE));
    vi.stubGlobal('fetch', f);
    for (const p of ['android', 'electron', 'pwa'] as const) {
      const { container, unmount } = render(<DownloadsBlock caps={caps('linux', p)} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
    expect(f).not.toHaveBeenCalled();
  });

  it('folds to one line and remembers it', async () => {
    vi.stubGlobal('fetch', vi.fn(reply(200, RELEASE)));
    const user = userEvent.setup();
    const { unmount } = render(<DownloadsBlock caps={caps('linux')} />);
    await user.click(await screen.findByRole('button', { name: 'Or keep using the website' }));
    expect(screen.getByRole('button', { name: 'Get the app' })).toHaveFocus();
    expect(screen.queryByRole('link', { name: /Download for/ })).toBeNull();
    expect(localStorage.getItem('vitals.downloads.v1')).toBe('folded');
    unmount();
    render(<DownloadsBlock caps={caps('linux')} />);
    await user.click(screen.getByRole('button', { name: 'Get the app' }));
    expect(screen.getByRole('heading', { name: 'Get the app' })).toHaveFocus();
    const main = await screen.findByRole('link', { name: 'Download for Linux (AppImage)' });
    await user.tab();
    expect(main).toHaveFocus();
    expect(localStorage.getItem('vitals.downloads.v1')).toBeNull();
  });
});
