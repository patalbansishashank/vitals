/**
 * Settings › About on Android: one line with the app version, the web bundle version and the update state, and the
 * key that installs a downloaded update (src/platform/androidUpdates.ts). Elsewhere the plain version row.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { CardFoot, HeroNumber, Key, MonoMeta } from '@/components';
import { RingMark } from '@/components/brand/RingMark';
import { APP_VERSION } from '@/app/version';
import { androidUpdateBannerState, performAndroidUpdateAction, type UpdateAction } from '@/app/shell/AndroidUpdateBanner';
import { detectPlatform } from '@/platform/detect';
import {
  getUpdatesView,
  refreshUpdates,
  statusLine,
  subscribeUpdates,
  updateState,
  type UpdatesView,
} from '@/platform/androidUpdates';
import { SettingsCard } from './SettingRow';

const VitalsMark = () => <RingMark size={22} />;

export function useUpdatesView(): UpdatesView {
  return useSyncExternalStore(subscribeUpdates, getUpdatesView, getUpdatesView);
}

/** "Update ready" on Android when an update waits for the owner's tap (the index row's value and dot). */
export function useUpdateWaiting(): boolean {
  const v = useUpdatesView();
  return detectPlatform() === 'android' && updateState(v) === 'ready';
}

export function UpdatesRow() {
  const android = detectPlatform() === 'android';
  const v = useUpdatesView();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (android) void refreshUpdates();
  }, [android]);
  const state = updateState(v);
  const status = android ? v.status : null;
  const banner = android ? androidUpdateBannerState(v) : null;
  const word =
    (v.phase === 'checking' ? 'Checking for updates…' : banner?.title) ?? (state === 'ready'
      ? 'Update ready'
      : state === 'available'
        ? 'Update available'
        : state === 'current'
          ? 'Up to date'
          : android
            ? 'Not checked'
            : 'Web app');
  const run = (action: UpdateAction) => {
    setBusy(true);
    void performAndroidUpdateAction(action).catch(() => undefined).finally(() => setBusy(false));
  };
  return (
    <SettingsCard
      icon={VitalsMark}
      title="Vitals"
      className="settings-about"
      foot={
        <CardFoot
          state={{ word }}
          right={status?.webPending && status.canApplyWeb && !status.apk && !v.available ? 'Restart Vitals to finish updating' : undefined}
        />
      }
    >
      <HeroNumber
        value={status?.versionName ?? APP_VERSION}
        size="num-l"
        countUp={false}
        label={`Vitals ${status?.versionName ?? APP_VERSION}`}
      />
      <MonoMeta>{banner?.body ?? (banner ? banner.title : status ? statusLine(status, state) : `Web ${APP_VERSION}`)}</MonoMeta>
      {android && !banner?.action && v.phase !== 'downloading' && v.phase !== 'installing' && v.phase !== 'applying' ? <Key variant="text" loading={busy || v.phase === 'checking'} onClick={() => run('retry-check')}>Check for updates</Key> : null}
      {android && banner?.action ? (
        <Key variant="primary" arrow loading={busy || banner.busy} onClick={() => run(banner.action!)}>
          {banner.actionLabel}
        </Key>
      ) : null}
    </SettingsCard>
  );
}
