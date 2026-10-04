import { Engraved, Faceplate, FaceplateHeader, Key, KeyLink } from '@/components';
import { MIN_SERVER_VERSION } from '@/net/server';
import { platformCaps } from '@/platform';
import { DownloadsBlock } from '@/features/home/DownloadsBlock';
import { ServerPill } from '@/features/settings/server/ServerSection';
import { useServerConnection, useServerPairing } from '@/features/settings/server/hooks';
import { SERVER_COPY } from '@/features/settings/server/copy';
import { useSyncView } from '@/state/sync';
import { SettingRow } from '@/features/settings/SettingRow';
import { INSTALL_STEPS, PWA_COPY } from './copy';
import { requestInstall, useInstallState, type InstallState } from './install';
import { applyUpdate } from './controller';
import { ReloadKey } from './updateNotice';
import { useSwState, type OfflineState } from './swStatus';

const TITLE_ID = 'settings-install-title';

/** One line under the install row: what to do now, given where the install state machine stands. */
function installLine(s: InstallState): string | null {
  switch (s.phase) {
    case 'installed':
      return s.standalone ? null : PWA_COPY.installedJustNow; // inside the installed app the status says it all
    case 'declined':
      return `${PWA_COPY.declined} ${INSTALL_STEPS[s.platform]}`;
    case 'manual':
      return INSTALL_STEPS[s.platform];
    case 'promptable':
    case 'prompting':
      return null;
  }
}

function OfflineStatus({ offline }: { offline: OfflineState }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink" aria-live="polite">
      <span className="lm-key__dot" data-on={offline === 'ready'} aria-hidden="true" />
      {PWA_COPY.offlineStatus[offline]}
    </span>
  );
}

/**
 * Settings › Install Vitals: the one-tap install where the browser offers it, plain steps where it does not,
 * and whether the app will open with no network. Reads the stores that src/app/pwa fills at startup.
 */
export function InstallSection() {
  const install = useInstallState();
  const sw = useSwState();
  const synced = useSyncView().paired;
  // the Android and desktop apps are installed by definition: no web-install steps, and no service-worker status
  const app = platformCaps().installedApp;
  const line = app ? null : installLine(install);
  const canInstall = install.phase === 'promptable' || install.phase === 'prompting';
  return (
    <Faceplate as="section" id="install" aria-labelledby={TITLE_ID} className="scroll-mt-2">
      <FaceplateHeader title={PWA_COPY.sectionTitle} titleId={TITLE_ID} />
      <div>
        <Engraved as="p" className="m-0 mb-1">
          {PWA_COPY.thisDeviceHeading}
        </Engraved>
        <SettingRow label={PWA_COPY.installLabel} help={canInstall ? (synced ? PWA_COPY.installHelpSynced : PWA_COPY.installHelp) : undefined}>
          {() =>
            canInstall ? (
              <Key size="sm" loading={install.phase === 'prompting'} onClick={() => void requestInstall()}>
                {PWA_COPY.installKey}
              </Key>
            ) : (
              <span className="text-sm text-ink">{app || install.phase === 'installed' ? PWA_COPY.installStatus.installed : PWA_COPY.installStatus.notInstalled}</span>
            )
          }
        </SettingRow>
        {line ? <p className="mb-2.5 mt-1 max-w-[68ch] text-sm leading-[1.5] text-ink-2">{line}</p> : null}
        {app ? null : (
          <SettingRow label={PWA_COPY.offlineLabel} help={synced ? PWA_COPY.offlineHelpSynced : PWA_COPY.offlineHelp}>
            {() => <OfflineStatus offline={sw.offline} />}
          </SettingRow>
        )}
        {sw.needRefresh ? (
          <SettingRow label={PWA_COPY.updateLabel} help={PWA_COPY.updateHelp}>
            {() => <ReloadKey onReload={() => void applyUpdate()} />}
          </SettingRow>
        ) : null}
        <DownloadsBlock />
        <YourServer />
      </div>
    </Faceplate>
  );
}

/** "Your server": one status line and one key, never install steps (design settings-sync-ai.md §13.5). */
function YourServer() {
  const pairing = useServerPairing();
  const { connection } = useServerConnection();
  const version = connection.state === 'reachable' || connection.state === 'version' ? connection.status.server.version : '';
  return (
    <div className="mt-3 grid gap-2 border-t border-line pt-4">
      <Engraved as="p" className="m-0">
        {PWA_COPY.serverHeading}
      </Engraved>
      {pairing ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
            <ServerPill connection={connection} />
            <span className="break-words [overflow-wrap:anywhere]">{PWA_COPY.serverPaired(pairing.person.label || new URL(pairing.baseUrl).host, version)}</span>
          </div>
          {connection.state === 'version' ? <p className="m-0 text-sm text-ink-2">{PWA_COPY.serverOld(version, MIN_SERVER_VERSION)}</p> : null}
          <div>
            <KeyLink size="sm" to="/settings/server">
              {PWA_COPY.serverSettings}
            </KeyLink>
          </div>
        </>
      ) : (
        <>
          <p className="m-0 max-w-[68ch] text-sm leading-[1.5] text-ink-2">{PWA_COPY.serverWhat}</p>
          <div className="flex flex-wrap items-center gap-3">
            <KeyLink size="sm" to="/settings/server">
              {PWA_COPY.serverPair}
            </KeyLink>
            <a className="lm-link text-sm" href={SERVER_COPY.noServerUrl} target="_blank" rel="noreferrer noopener">
              {PWA_COPY.serverHowTo} ›
            </a>
          </div>
        </>
      )}
    </div>
  );
}
