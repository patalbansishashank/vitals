/**
 * The desktop and Android downloads in Settings › Install;
 * owned by L-WEB. Desktop links use stable release names while metadata loads; Android waits for a signed package.
 * Release data also adds the version and sizes. It is not shown in the apps or the PWA.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Icon } from '@/components/icons/Icon';
import { InfoKey, InfoPanel } from '@/components';
import { APP_VERSION } from '@/app/version';
import { platformCaps, type OsName } from '@/platform';
import { DOWNLOADS } from './copy';
import {
  ASSET_LABEL,
  RELEASES_URL,
  cachedRelease,
  fallbackAssets,
  formatSize,
  loadRelease,
  mainKey,
  type ReleaseAsset,
  type ReleaseState,
  type AssetKey,
} from './release';
import './home.css';

const FOLD_KEY = 'vitals.downloads.v1';

function InstallHelp({ system }: { system: AssetKey }) {
  const [open, setOpen] = useState(false);
  return <><InfoKey label={DOWNLOADS.installHelp(ASSET_LABEL[system])} expanded={open} onClick={() => setOpen(true)} /><InfoPanel title={DOWNLOADS.installTitle(ASSET_LABEL[system])} body={DOWNLOADS.unsigned[system]} open={open} onClose={() => setOpen(false)} /></>;
}

function readFolded(): boolean {
  try {
    return window.localStorage.getItem(FOLD_KEY) === 'folded';
  } catch {
    return false;
  }
}

function writeFolded(folded: boolean): void {
  try {
    if (folded) window.localStorage.setItem(FOLD_KEY, 'folded');
    else window.localStorage.removeItem(FOLD_KEY);
  } catch {
    /* private mode: the fold lasts until the page closes */
  }
}

function useRelease(): ReleaseState | 'loading' {
  const [state, setState] = useState<ReleaseState | 'loading'>(() => cachedRelease() ?? 'loading');
  useEffect(() => {
    if (state !== 'loading') return;
    let live = true;
    void loadRelease().then((s) => {
      if (live) setState(s);
    });
    return () => {
      live = false;
    };
  }, [state]);
  return state;
}

export interface DownloadsBlockProps {
  /** Tests: where this device runs. Defaults to the real one. */
  caps?: ReturnType<typeof platformCaps>;
  /**
   * Inside a settings group that already names it (Settings › Install): no heading, no rule above, and no "Or keep using
   * the website" fold, since the person is in the website and looked for the apps on purpose.
   */
  embedded?: boolean;
}

/** False where the block shows nothing: inside the Android and desktop apps and the installed web app. */
export function downloadsShown(caps = platformCaps()): boolean {
  return !caps.installedApp && caps.platform !== 'pwa';
}

export function DownloadsBlock({ caps = platformCaps(), embedded = false }: DownloadsBlockProps = {}) {
  if (!downloadsShown(caps)) return null;
  return <Block os={caps.os} embedded={embedded} />;
}

function Block({ os, embedded }: { os: OsName; embedded: boolean }) {
  const release = useRelease();
  const [storedFold, setFolded] = useState(readFolded);
  const folded = !embedded && storedFold;
  const foldButton = useRef<HTMLButtonElement>(null);
  const expandedHeading = useRef<HTMLHeadingElement>(null);
  const focusAfterFold = useRef(false);

  const fold = (next: boolean) => {
    focusAfterFold.current = true;
    writeFolded(next);
    setFolded(next);
  };

  useLayoutEffect(() => {
    if (!focusAfterFold.current) return;
    (folded ? foldButton : expandedHeading).current?.focus();
    focusAfterFold.current = false;
  }, [folded]);

  if (folded) {
    return (
      <div className="lm-dl" data-folded="true">
        <button ref={foldButton} type="button" className="lm-dl__fold" onClick={() => fold(false)}>
          {DOWNLOADS.title}
        </button>
      </div>
    );
  }

  const state = release === 'loading' ? undefined : release;
  const none = state?.kind === 'none';
  // until the data arrives the stable links stand in, so the block keeps its shape
  const assets: ReleaseAsset[] = state?.kind === 'none' ? [] : state ? state.assets : fallbackAssets();
  const version = state?.kind === 'release' ? state.version : undefined;
  const key = mainKey(os);
  const main = assets.find((a) => a.key === key);
  const others = assets.filter((a) => a !== main);

  return (
    <section className="lm-dl" data-embedded={embedded || undefined} aria-label={DOWNLOADS.title} aria-busy={release === 'loading'}>
      {embedded ? null : (
        <h2 ref={expandedHeading} tabIndex={-1} className="lm-dl__title">
          {DOWNLOADS.title}
        </h2>
      )}
      <div className="lm-dl__body">
        {none ? (
          <p className="lm-dl__note">
            {DOWNLOADS.unavailable}{' '}
            <a href={RELEASES_URL} className="lm-dl__link">
              {DOWNLOADS.allReleases}
            </a>
          </p>
        ) : (
          <>
            {main ? (
              <div className="lm-dl__main">
                <div className="lm-dl__download">
                <a
                  className="lm-key lm-dl__key"
                  data-variant="solid"
                  data-size="lg"
                  data-has-icon="true"
                  href={main.url}
                >
                  <Icon icon={Download} size={20} />
                  <span className="lm-key__label">{DOWNLOADS.onlySystem(ASSET_LABEL[main.key])}</span>
                </a>
                <InstallHelp system={main.key} />
                </div>
                <p className="lm-dl__meta">{meta(version, main.size, embedded) || '\u00a0'}</p>
              </div>
            ) : os === 'android' && release === 'loading' ? (
              <div className="lm-dl__main lm-dl__pending-main">
                <span aria-hidden="true" className="lm-key lm-dl__key" data-variant="solid" data-size="lg" data-has-icon="true">
                  <Icon icon={Download} size={20} />
                  <span className="lm-key__label">{DOWNLOADS.onlySystem(ASSET_LABEL.android)}</span>
                </span>
                <p aria-hidden="true" className="lm-dl__meta">{'\u00a0'}</p>
                <p aria-hidden="true" className="lm-dl__note">{DOWNLOADS.unsigned.android}</p>
                <p className="lm-dl__note lm-dl__checking">{DOWNLOADS.androidChecking}</p>
              </div>
            ) : (
              <p className="lm-dl__note">
                {os === 'ios'
                  ? DOWNLOADS.iphone
                  : os === 'android'
                    ? release === 'loading'
                      ? DOWNLOADS.androidChecking
                      : DOWNLOADS.androidUnavailable
                    : DOWNLOADS.chooseSystem}
              </p>
            )}
            <ul className="lm-dl__others" aria-label={DOWNLOADS.otherSystems}>
              {release === 'loading' && os !== 'android' ? (
                <li aria-hidden="true" className="lm-dl__pending-asset">
                  <span className="lm-dl__link">{ASSET_LABEL.android}</span>
                  <span className="lm-dl__size">{'\u00a0'}</span>
                </li>
              ) : null}
              {others.map((a) =>
                embedded ? (
                  // Settings › Install (r068 S25): one row per system, its name and size, and a real Download key
                  <li key={a.key} className="lm-dl__row">
                    <span className="lm-dl__row-name">{ASSET_LABEL[a.key]}</span>
                    <InstallHelp system={a.key} />
                    <span className="lm-dl__size">{a.size ? formatSize(a.size) : ''}</span>
                    <a className="lm-key" data-variant="outlined" data-size="sm" data-has-icon="true" href={a.url} aria-label={DOWNLOADS.onlySystem(ASSET_LABEL[a.key])}>
                      <Icon icon={Download} size={16} />
                      <span className="lm-key__label">{DOWNLOADS.download}</span>
                    </a>
                  </li>
                ) : (
                  <li key={a.key}>
                    <div className="lm-dl__download">
                    <a className="lm-dl__link" href={a.url}>
                      {ASSET_LABEL[a.key]}
                    </a>
                    <InstallHelp system={a.key} />
                    </div>
                    <span className="lm-dl__size">{a.size ? formatSize(a.size) : ''}</span>
                  </li>
                ),
              )}
            </ul>
          </>
        )}
        {embedded ? null : (
          <button type="button" className="lm-dl__keep" onClick={() => fold(true)}>
            {DOWNLOADS.keepWebsite}
          </button>
        )}
      </div>
    </section>
  );
}

/** "Version 0.5.3 · 127 MB"; in Settings, where the app's own version is shown too, it says it is the download's. */
function meta(version: string | undefined, size: number | undefined, embedded = false): string {
  const parts = [
    version ? (embedded ? DOWNLOADS.downloadVersion(version) : DOWNLOADS.version(version)) : '',
    embedded && version && version !== APP_VERSION ? DOWNLOADS.runningVersion(APP_VERSION) : '',
    size ? formatSize(size) : '',
  ].filter(Boolean);
  return parts.join(' · ');
}
