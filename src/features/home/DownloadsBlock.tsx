/**
 * The desktop and Android downloads on a first-time visitor's first screen (the welcome intro) and in Settings;
 * owned by L-WEB. Desktop links use stable release names while metadata loads; Android waits for a signed package.
 * Release data also adds the version and sizes. It is not shown in the apps or the PWA.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { RingMark } from '@/components/brand/RingMark';
import { Icon } from '@/components/icons/Icon';
import { platformCaps, type OsName } from '@/platform';
import { DOWNLOADS } from './copy';
import { ASSET_LABEL, RELEASES_URL, cachedRelease, fallbackAssets, formatSize, loadRelease, mainKey, type ReleaseAsset, type ReleaseState } from './release';
import './home.css';

const FOLD_KEY = 'vitals.downloads.v1';

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
}

export function DownloadsBlock({ caps = platformCaps() }: DownloadsBlockProps = {}) {
  if (caps.installedApp || caps.platform === 'pwa') return null;
  return <Block os={caps.os} />;
}

function Block({ os }: { os: OsName }) {
  const release = useRelease();
  const [folded, setFolded] = useState(readFolded);
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
          <RingMark />
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
    <section className="lm-dl" aria-label={DOWNLOADS.title} aria-busy={release === 'loading'}>
      <h2 ref={expandedHeading} tabIndex={-1} className="lm-dl__title">
        <RingMark />
        {DOWNLOADS.title}
      </h2>
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
                <a className="lm-key lm-dl__key" data-variant="solid" data-size="lg" data-has-icon="true" href={main.url}>
                  <Icon icon={Download} size={20} />
                  <span className="lm-key__label">{DOWNLOADS.onlySystem(ASSET_LABEL[main.key])}</span>
                </a>
                <p className="lm-dl__meta">{meta(version, main.size) || '\u00a0'}</p>
                <p className="lm-dl__note">{DOWNLOADS.unsigned[main.key]}</p>
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
              <p className="lm-dl__note">{os === 'ios' ? DOWNLOADS.iphone : os === 'android' ? (release === 'loading' ? DOWNLOADS.androidChecking : DOWNLOADS.androidUnavailable) : DOWNLOADS.chooseSystem}</p>
            )}
            <ul className="lm-dl__others" aria-label={DOWNLOADS.otherSystems}>
              {release === 'loading' && os !== 'android' ? (
                <li aria-hidden="true" className="lm-dl__pending-asset">
                  <span className="lm-dl__link">{ASSET_LABEL.android}</span>
                  <span className="lm-dl__size">{'\u00a0'}</span>
                </li>
              ) : null}
              {others.map((a) => (
                <li key={a.key}>
                  <a className="lm-dl__link" href={a.url}>
                    {ASSET_LABEL[a.key]}
                  </a>
                  <span className="lm-dl__size">{a.size ? formatSize(a.size) : ''}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <button type="button" className="lm-dl__keep" onClick={() => fold(true)}>
          {DOWNLOADS.keepWebsite}
        </button>
      </div>
    </section>
  );
}

function meta(version: string | undefined, size: number | undefined): string {
  const parts = [version ? DOWNLOADS.version(version) : '', size ? formatSize(size) : ''].filter(Boolean);
  return parts.join(' · ');
}
