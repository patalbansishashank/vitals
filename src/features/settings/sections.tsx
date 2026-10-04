import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { Engraved, Faceplate, FaceplateHeader, Icon, KeyBank, KeyValueList, Switch, type KeyBankOption } from '@/components';
import { useQuietMode, useSettingsStore, type SettingsValues } from '@/state/settingsStore';
import { APP_VERSION, MODEL_VERSION } from '@/app/version';
import { paths } from '@/app/paths';
import { EVIDENCE_TOPICS } from '@/content/evidence';
import { DisclaimerFull } from '@/features/onboarding/Disclaimer';
import { SafetySettingsPanel } from '@/features/onboarding/SafetySettingsPanel';
import { hasValidationReport } from '@/features/evidence/validationReport';
import { SavedLabel, SettingRow, useSavedFlash } from './SettingRow';
import { DISCLAIMER, DISCLAIMER_TEXT, LICENCES, PRIVACY_TEXT, PRIVACY_TEXT_SYNCED } from './copy';
import { useSyncView } from '@/state/sync';
import '@/commands'; // the registry: registers the commands sent here
import { sendCommand } from '@/features/lib/sendCommand';

export type SectionId = 'units' | 'appearance' | 'kitchen' | 'supplements' | 'data' | 'server' | 'devices' | 'sync' | 'coach' | 'agents' | 'install' | 'safety' | 'about';

export const SECTIONS: ReadonlyArray<{ id: SectionId; label: string; title: string }> = [
  { id: 'units', label: 'units', title: 'Units' },
  { id: 'appearance', label: 'appearance', title: 'Appearance' },
  { id: 'kitchen', label: 'kitchen', title: 'Kitchen' },
  { id: 'supplements', label: 'supplements', title: 'Supplements' },
  { id: 'data', label: 'your data', title: 'Your data' },
  { id: 'server', label: 'server', title: 'Server' },
  { id: 'sync', label: 'sync', title: 'Sync' },
  { id: 'devices', label: 'devices', title: 'Devices and streams' },
  { id: 'coach', label: 'ai provider', title: 'AI provider' },
  { id: 'agents', label: 'agents', title: 'Agents' },
  { id: 'install', label: 'install', title: 'Install' },
  { id: 'safety', label: 'safety', title: 'Safety' },
  { id: 'about', label: 'about', title: 'About' },
];

export function SettingsSection({ id, title, saved = false, children }: { id: SectionId; title: string; saved?: boolean; children: ReactNode }) {
  const titleId = `settings-${id}-title`;
  return (
    <Faceplate as="section" id={id} aria-labelledby={titleId} className="settings-section">
      <FaceplateHeader title={title} titleId={titleId} actions={<SavedLabel on={saved} />} />
      <div>{children}</div>
    </Faceplate>
  );
}

/** A KeyBank row bound to one settings field. */
function BankRow<K extends keyof SettingsValues>({
  field,
  label,
  help,
  options,
  onSaved,
}: {
  field: K;
  label: string;
  help?: ReactNode;
  options: ReadonlyArray<KeyBankOption<Extract<SettingsValues[K], string>>>;
  onSaved: () => void;
}) {
  const value = useSettingsStore((s) => s[field]) as unknown as Extract<SettingsValues[K], string>;
  const set = (patch: Partial<SettingsValues>) => sendCommand('settings.update', { patch }).then((r) => r.ok);
  return (
    <SettingRow label={label} help={help}>
      {({ labelId, helpId }) => (
        <KeyBank
          labelledBy={labelId}
          describedBy={helpId}
          value={value}
          options={options}
          onChange={(v) => {
            // "saved" only when the change went through; a refusal shows its reason instead
            void set({ [field]: v } as Partial<SettingsValues>).then((ok) => ok && onSaved());
          }}
        />
      )}
    </SettingRow>
  );
}

function SwitchRow({ field, label, help, value: shown, onSaved }: { field: 'chartPatterns' | 'showFigure' | 'quietMode'; label: string; help?: ReactNode; value?: boolean; onSaved: () => void }) {
  const stored = useSettingsStore((s) => s[field]);
  const value = shown ?? stored;
  const set = (patch: Partial<SettingsValues>) => sendCommand('settings.update', { patch }).then((r) => r.ok);
  return (
    <SettingRow label={label} help={help}>
      {({ labelId, helpId }) => (
        <Switch
          checked={value}
          labelledBy={labelId}
          describedBy={helpId}
          onChange={(v) => {
            void set({ [field]: v }).then((ok) => ok && onSaved());
          }}
        />
      )}
    </SettingRow>
  );
}

/** Quiet mode shows the value in effect: on by default in gentle mode (safety mode R1, SUITE_SPEC §3.7). */
function QuietModeRow({ onSaved }: { onSaved: () => void }) {
  const quiet = useQuietMode();
  const help = 'Words instead of numbers for scores, energy left and trend weight. The Coach talks about portions, not calories. Applies on your other devices too.';
  return (
    <SwitchRow
      field="quietMode"
      label="quiet mode"
      value={quiet.on}
      help={quiet.byDefault ? `${help} On because your safety answers put you in gentle mode; you can turn it off.` : help}
      onSaved={onSaved}
    />
  );
}

export function UnitsSection() {
  const [saved, flash] = useSavedFlash();
  return (
    <SettingsSection id="units" title="Units" saved={saved}>
      <div className="settings-unit-rows">
        <BankRow field="units" label="body" onSaved={flash} options={[{ value: 'metric', label: 'metric' }, { value: 'imperial', label: 'imperial' }]} />
        <BankRow field="energyUnit" label="energy" onSaved={flash} options={[{ value: 'kcal', label: 'kcal' }, { value: 'kJ', label: 'kJ' }]} />
        <BankRow field="glucoseUnit" label="glucose and lipids" onSaved={flash} options={[{ value: 'mmol', label: 'mmol/L' }, { value: 'mgdl', label: 'mg/dL' }]} />
        <BankRow field="dateStyle" label="dates" onSaved={flash} options={[{ value: 'day-month', label: '5 Oct' }, { value: 'month-day', label: 'Oct 5' }]} />
        <BankRow field="weekStart" label="week starts" onSaved={flash} options={[{ value: 'monday', label: 'Monday' }, { value: 'sunday', label: 'Sunday' }]} />
      </div>
      <p className="mt-3 text-xs leading-[1.45] text-ink-2">Changes apply everywhere at once. Vitals stores measurements in metric and converts for display.</p>
    </SettingsSection>
  );
}

export function AppearanceSection() {
  const [saved, flash] = useSavedFlash();
  return (
    <SettingsSection id="appearance" title="Appearance" saved={saved}>
      <div className="settings-appearance-rows">
        <BankRow
          field="theme"
          label="theme"
          help="System follows your device."
          onSaved={flash}
          options={[
            { value: 'system', label: 'system' },
            { value: 'light', label: 'light' },
            { value: 'dark', label: 'dark' },
          ]}
        />
        <SwitchRow field="chartPatterns" label="patterns in charts" help="Adds hatching to bands and bars so they read without colour. On automatically in high-contrast mode." onSaved={flash} />
        <BankRow
          field="reduceMotion"
          label="reduce motion"
          help="System follows your device's setting."
          onSaved={flash}
          options={[
            { value: 'system', label: 'system' },
            { value: 'on', label: 'on' },
            { value: 'off', label: 'off' },
          ]}
        />
        <SwitchRow field="showFigure" label="show figure" help="Hide the body figure everywhere and use numbers only." onSaved={flash} />
        <QuietModeRow onSaved={flash} />
      </div>
    </SettingsSection>
  );
}

// Devices and streams: ./devices/DevicesSection.tsx (bio.* commands).

/** Safety answers and opt-ins now live in the safety store (src/state/safetyStore.ts). */
export function SafetySection() {
  const [saved, flash] = useSavedFlash();
  return (
    <SettingsSection id="safety" title="Safety" saved={saved}>
      <SafetySettingsPanel onSaved={flash} />
    </SettingsSection>
  );
}

export function AboutSection() {
  const synced = useSyncView().paired;
  return (
    <SettingsSection id="about" title="About">
      <KeyValueList
        items={[
          { key: 'version', value: `Vitals ${APP_VERSION}` },
          { key: 'model', value: `${MODEL_VERSION} · ${EVIDENCE_TOPICS.length} evidence topics` },
          {
            key: 'evidence method',
            value: (
              <Link className="lm-link" to="/evidence">
                Evidence library
              </Link>
            ),
          },
          // The row appears once docs/VALIDATION_REPORT.md exists at build time (bundled by validationReport.ts).
          // TODO(validation report): until the model validation report is written the row stays hidden.
          ...(hasValidationReport
            ? [
                {
                  key: 'validation',
                  value: (
                    <Link className="lm-link" to={paths.validationReport}>
                      Validation report
                    </Link>
                  ),
                },
              ]
            : []),
        ]}
      />
      <div className="mt-4 grid gap-2 border-t border-line pt-4">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink">
            <Icon icon={ChevronRight} size={16} className="transition-transform duration-fast group-open:rotate-90" />
            Disclaimer
          </summary>
          <p className="mb-0 mt-2 max-w-[68ch] text-sm leading-[1.55] text-ink">{DISCLAIMER_TEXT}</p>
          <div className="mt-4">
            <DisclaimerFull headingAs="h3" size="sm" withHelp={false} withPageLink />
          </div>
        </details>
        <p className="m-0 text-xs text-ink-2">
          {DISCLAIMER.settingsSummary}{' '}
          <Link className="lm-link" to={paths.safety}>
            {DISCLAIMER.resultsLink}
          </Link>
        </p>
      </div>
      <div className="mt-4 grid gap-1 border-t border-line pt-4">
        <Engraved as="p" className="m-0">
          licences
        </Engraved>
        <p className="m-0 text-sm leading-[1.5] text-ink-2">{LICENCES.map((l) => `${l.name} — ${l.licence}`).join(' · ')}</p>
      </div>
      <div className="mt-4 grid gap-1 border-t border-line pt-4">
        <Engraved as="p" className="m-0">
          privacy
        </Engraved>
        <p className="m-0 text-sm leading-[1.5] text-ink-2">{synced ? PRIVACY_TEXT_SYNCED : PRIVACY_TEXT}</p>
      </div>
    </SettingsSection>
  );
}
