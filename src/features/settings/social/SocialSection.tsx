/**
 * (social-time) Settings › Social time: whether social time is counted, the apps it counts, and the daily target band.
 * These live on the phone (Android's Usage access), so the controls act through the ring-engine plugin and are read-only
 * where there is no phone (web, desktop, or an older native app). No helper subtext on the rows; the (i) panel explains.
 */
import { Stepper, Switch } from '@/components';
import { useGaugeEngine } from '@/state/gaugeEngine';
import { RING_COPY as C } from '@/features/ring/copy';
import { socialInfo } from '@/features/ring/social/info';
import { canSetSocialSettings, setSocialSettings, socialOf } from '@/features/ring/social/socialEngine';
import { SOCIAL_APPS, type SocialAppKey } from '@/net/gaugeSocial';
import { SettingRow, SettingsGroup, SettingsItem, useSavedFlash } from '../SettingRow';
import { SettingsSection } from '../sections';

export function SocialSection() {
  const [saved, flash] = useSavedFlash();
  const eng = useGaugeEngine();
  const social = socialOf(eng);
  const canEdit = eng.available && social !== null && canSetSocialSettings();

  const save = (patch: Parameters<typeof setSocialSettings>[0]) => {
    void setSocialSettings(patch).then(flash);
  };
  const toggleApp = (key: SocialAppKey, on: boolean) => {
    const base = social?.enabledApps ?? SOCIAL_APPS.map((a) => a.key);
    const next = on ? [...new Set([...base, key])] : base.filter((k) => k !== key);
    save({ enabledApps: next });
  };

  const min = social?.targetMinMinutes ?? 30;
  const max = social?.targetMaxMinutes ?? 45;

  return (
    <SettingsSection id="social" title={C.social.title} saved={saved}>
      <SettingsGroup info={socialInfo({ min, max })}>
        {!social ? (
          <SettingsItem>
            <p className="settings-note">{C.social.needsPhone}</p>
          </SettingsItem>
        ) : null}
        {SOCIAL_APPS.map((app) => {
          const on = social ? social.enabledApps.includes(app.key) : true;
          return (
            <SettingRow key={app.key} label={app.label}>
              {({ labelId }) => (
                <Switch checked={on} labelledBy={labelId} disabled={!canEdit} onChange={(v) => toggleApp(app.key, v)} />
              )}
            </SettingRow>
          );
        })}
        <SettingRow label={C.social.targetFrom}>
          {() => (
            <Stepper value={min} onChange={(v) => save({ targetMinMinutes: Math.min(v, max - 1) })} min={5} max={max - 1} step={5} unit="min" unitText="minutes" name="target from" disabled={!canEdit} />
          )}
        </SettingRow>
        <SettingRow label={C.social.targetTo}>
          {() => (
            <Stepper value={max} onChange={(v) => save({ targetMaxMinutes: Math.max(v, min + 1) })} min={min + 1} max={180} step={5} unit="min" unitText="minutes" name="target to" disabled={!canEdit} />
          )}
        </SettingRow>
      </SettingsGroup>
    </SettingsSection>
  );
}
