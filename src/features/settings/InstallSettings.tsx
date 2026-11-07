/**
 * Settings › Install (web only; the index hides it inside the Android and desktop apps): one install row (the one-tap
 * key where the browser offers it, else one line of steps), the reload when a new version is ready, and the desktop and
 * Android downloads. Reads the stores that src/app/pwa fills at startup.
 */
import { Key } from '@/components';
import { applyUpdate } from '@/app/pwa/controller';
import { INSTALL_STEPS } from '@/app/pwa/copy';
import { requestInstall, useInstallState, type InstallState } from '@/app/pwa/install';
import { useSwState } from '@/app/pwa/swStatus';
import { ReloadKey } from '@/app/pwa/updateNotice';
import { DownloadsBlock, downloadsShown } from '@/features/home/DownloadsBlock';
import { SettingsSection } from './sections';
import { SettingRow, SettingsGroup, SettingsItem } from './SettingRow';

export const INSTALL_COPY = {
  title: 'Install',
  installLabel: 'Install app',
  installKey: 'Install',
  installed: 'Installed',
  installedJustNow: 'Open Vitals from your apps or home screen.',
  /** The Chromium steps, short: other browsers keep their own (src/app/pwa/copy.ts). */
  chromium: "Use your browser's Install or Add to Home screen.",
  updateLabel: 'New version ready',
  apps: 'Desktop and Android apps',
  /** The first group's label when the apps' group follows it (r068 V12). */
  browser: 'This browser',
} as const;
const C = INSTALL_COPY;

function steps(s: InstallState): string | undefined {
  if (s.phase === 'installed') return s.standalone ? undefined : C.installedJustNow;
  if (s.phase === 'promptable' || s.phase === 'prompting') return undefined;
  return s.platform === 'chromium' ? C.chromium : INSTALL_STEPS[s.platform];
}

export function InstallSettings() {
  const install = useInstallState();
  const sw = useSwState();
  const canInstall = install.phase === 'promptable' || install.phase === 'prompting';
  const apps = downloadsShown();
  return (
    <SettingsSection id="install" title={C.title}>
      <SettingsGroup
        label={apps ? C.browser : undefined}
        info={{
          title: 'Install the app',
          body: "Install puts Vitals on your home screen or desktop. In a browser, use its Install or Add to Home screen. Your system may show an installation warning; each download's info button gives the steps for that system.",
        }}
      >
        <SettingRow label={C.installLabel} help={steps(install)}>
          {() =>
            canInstall ? (
              <Key
                size="sm"
                variant="action"
                loading={install.phase === 'prompting'}
                onClick={() => void requestInstall()}
              >
                {C.installKey}
              </Key>
            ) : install.phase === 'installed' ? (
              <span className="settings-value">{C.installed}</span>
            ) : null
          }
        </SettingRow>
        {sw.needRefresh ? (
          <SettingRow label={C.updateLabel}>
            {() => <ReloadKey onReload={() => void applyUpdate()} />}
          </SettingRow>
        ) : null}
      </SettingsGroup>
      {apps ? (
        <SettingsGroup label={C.apps}>
          <SettingsItem>
            <DownloadsBlock embedded />
          </SettingsItem>
        </SettingsGroup>
      ) : null}
    </SettingsSection>
  );
}
