/**
 * Settings › Steps (energy SPEC D1, D3; r068 S20): which device's steps count when the ring and the phone both count
 * (the D1 source preference and the sole-gait rule) and how the day's total is made (D3). They used to sit at the foot
 * of Heart rate; steps are their own measure, so they are their own section beside it. Every control applies at once;
 * "Saved" flashes in the header when the change went through, and a refused change shows its reason with "Try again".
 */
import { useState } from 'react';
import { InlineWarning, Key, KeyBank, Switch } from '@/components';
import { SettingRow, SettingsGroup, SettingsItem, useSavedFlash } from '../SettingRow';
import { SettingsSection } from '../sections';
import { HEART_COPY as C } from './copy';
import { applyHeartSettings, useHeartSettings, type HeartSettings } from './v3Adapter';
import './heart.css';

type Patch = Parameters<typeof applyHeartSettings>[0];

/** The index row's value: which device counts first ("Ring first"). */
export function stepsSummary(s: Pick<HeartSettings, 'stepsPreference'>): string {
  return (s.stepsPreference[0] ?? 'ring') === 'ring' ? C.stepsFirst.ring : C.stepsFirst.phone;
}

export function StepsSection() {
  const [saved, flash] = useSavedFlash();
  const s = useHeartSettings();
  const [failure, setFailure] = useState<{ message: string; patch: Patch } | null>(null);
  const save = (patch: Patch) => {
    void applyHeartSettings(patch).then((r) => {
      if (r.ok) {
        setFailure(null);
        flash();
      } else setFailure({ message: r.message, patch });
    });
  };
  return (
    <SettingsSection id="steps" title={C.groups.steps} saved={saved}>
      {failure ? (
        <SettingsItem className="settings-heart__failed">
          <InlineWarning
            severity="caution"
            alert
            action={
              <span className="settings-keys">
                <Key size="sm" variant="action" onClick={() => save(failure.patch)}>
                  {C.retry}
                </Key>
                <Key size="sm" variant="text" onClick={() => setFailure(null)}>
                  {C.dismiss}
                </Key>
              </span>
            }
          >
            {C.failed(failure.message)}
          </InlineWarning>
        </SettingsItem>
      ) : null}
      {/* one group: the page title already names it (r068: no label that repeats a row) */}
      <SettingsGroup info={{ title: 'Steps from two devices', body: C.stepsInfo }}>
        <SettingRow label={C.stepsSource} wide>
          {({ labelId, helpId }) => (
            <KeyBank<HeartSettings['stepsPreference'][number]>
              labelledBy={labelId}
              describedBy={helpId}
              value={s.stepsPreference[0] ?? 'ring'}
              options={[
                { value: 'ring', label: C.stepsSources.ring },
                { value: 'phone', label: C.stepsSources.phone },
              ]}
              onChange={(v) => save({ stepsPreference: v === 'ring' ? ['ring', 'phone'] : ['phone', 'ring'] })}
            />
          )}
        </SettingRow>
        <SettingRow label={C.soleGait} help={C.soleGaitHelp}>
          {({ labelId, helpId }) => <Switch checked={s.soleSustainedGait} labelledBy={labelId} describedBy={helpId} onChange={(v) => save({ soleSustainedGait: v })} />}
        </SettingRow>
        <SettingRow label={C.headline} help={C.headlineHelp} wide>
          {({ labelId, helpId }) => (
            <KeyBank<HeartSettings['stepsHeadline']>
              labelledBy={labelId}
              describedBy={helpId}
              value={s.stepsHeadline}
              options={[
                { value: 'atLeast', label: C.headlines.atLeast },
                { value: 'located', label: C.headlines.located },
              ]}
              onChange={(v) => save({ stepsHeadline: v })}
            />
          )}
        </SettingRow>
      </SettingsGroup>
    </SettingsSection>
  );
}
