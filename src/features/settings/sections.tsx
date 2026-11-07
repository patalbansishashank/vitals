import type { ReactNode } from 'react';
import { KeyBank, Switch, type InfoSpec, type KeyBankOption } from '@/components';
import { ClipboardCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { paths } from '@/app/paths';
import { loadValidationReport } from '@/features/evidence/validationReport';
import { readHeadline } from '@/features/evidence/ValidationReportPage';
import { useQuietMode, useSettingsStore, type SettingsValues } from '@/state/settingsStore';
import { SafetySettingsPanel } from '@/features/onboarding/SafetySettingsPanel';
import {
  SavedLabel,
  SettingRow,
  SettingsDisclosure,
  SettingsGroup,
  SettingsLinkRow,
  useSavedFlash,
  useSavedSlot,
} from './SettingRow';
import { FIGURE_CREDIT, LICENCES } from './copy';
import { UpdatesRow } from './UpdatesRow';
import '@/commands'; // the registry: registers the commands sent here
import { sendCommand } from '@/features/lib/sendCommand';
import { platformCaps } from '@/platform';

export type SectionId =
  | 'units'
  | 'appearance'
  | 'safety'
  | 'heart'
  | 'steps'
  | 'kitchen'
  | 'supplements'
  | 'data'
  | 'sync'
  | 'coach'
  | 'agents'
  | 'widgets'
  | 'install'
  | 'about';

/** Settings › one section per page (`/settings/:section`), in the order of the index. */
export const SECTIONS: ReadonlyArray<{ id: SectionId; title: string }> = [
  { id: 'units', title: 'Units' },
  { id: 'appearance', title: 'Appearance' },
  { id: 'safety', title: 'Safety' },
  // energy SPEC §V4.7: zones, how maximum and resting heart rate are estimated, heart-rate calories
  { id: 'heart', title: 'Heart rate' },
  // energy SPEC D1/D3: which device's steps count and the day total (r068 S20: their own section, not under Heart rate)
  { id: 'steps', title: 'Steps' },
  { id: 'kitchen', title: 'Kitchen' },
  { id: 'supplements', title: 'Supplements' },
  { id: 'data', title: 'Your data' },
  { id: 'sync', title: 'Sync' },
  // one name everywhere (r068 S17): the section, its index row and the server's Coach are all "Coach"
  { id: 'coach', title: 'Coach' },
  { id: 'agents', title: 'Agents' },
  // (r071) the home-screen widgets: the Android app only (`sectionFromId` leaves it out elsewhere)
  { id: 'widgets', title: 'Widgets' },
  { id: 'install', title: 'Install' },
  { id: 'about', title: 'About' },
];

/** Older and alternative names that deep links still use: the server's pairing lives in Sync now. */
export const SECTION_ALIASES: Readonly<Record<string, SectionId>> = {
  ai: 'coach',
  server: 'sync',
  'connect-tools': 'agents',
};

/** Widgets exist in the Android app only: on the web, the PWA and the desktop app the section is not there, so its link opens the index. */
export function sectionAvailable(id: SectionId): boolean {
  return id !== 'widgets' || platformCaps().platform === 'android';
}

export function sectionFromId(raw: string | null | undefined): SectionId | null {
  if (!raw) return null;
  const id = Object.hasOwn(SECTION_ALIASES, raw) ? SECTION_ALIASES[raw]! : raw;
  return SECTIONS.some((s) => s.id === id) && sectionAvailable(id as SectionId) ? (id as SectionId) : null;
}

export function sectionTitle(id: SectionId): string {
  return SECTIONS.find((s) => s.id === id)?.title ?? 'Settings';
}

/**
 * One settings section: the page's groups. Its name is the page title (in the header), so the section carries it only as
 * its accessible name. The "Saved" flash goes to the header when the settings page hosts it.
 */
export function SettingsSection({
  id,
  title,
  saved = false,
  children,
}: {
  id: SectionId;
  title: string;
  saved?: boolean;
  children: ReactNode;
}) {
  const inHeader = useSavedSlot(saved);
  return (
    <section id={id} aria-label={title} className="settings-section">
      {inHeader ? null : (
        <div className="settings-section__saved">
          <SavedLabel on={saved} />
        </div>
      )}
      {children}
    </section>
  );
}

const save = (patch: Partial<SettingsValues>) => sendCommand('settings.update', { patch }).then((r) => r.ok);

/** A KeyBank row bound to one settings field. */
function BankRow<K extends keyof SettingsValues>({
  field,
  label,
  help,
  info,
  options,
  onSaved,
}: {
  field: K;
  label: string;
  help?: ReactNode;
  info?: InfoSpec;
  options: ReadonlyArray<KeyBankOption<Extract<SettingsValues[K], string>>>;
  onSaved: () => void;
}) {
  const value = useSettingsStore((s) => s[field]) as unknown as Extract<SettingsValues[K], string>;
  return (
    <SettingRow label={label} help={help} info={info} wide>
      {({ labelId, helpId }) => (
        <KeyBank
          labelledBy={labelId}
          describedBy={helpId}
          value={value}
          options={options}
          onChange={(v) => {
            // "Saved" only when the change went through; a refusal shows its reason instead
            void save({ [field]: v } as Partial<SettingsValues>).then((ok) => ok && onSaved());
          }}
        />
      )}
    </SettingRow>
  );
}

function SwitchRow({
  field,
  label,
  help,
  info,
  value: shown,
  onSaved,
}: {
  field: 'chartPatterns' | 'showFigure' | 'quietMode';
  label: string;
  help?: ReactNode;
  info?: InfoSpec;
  value?: boolean;
  onSaved: () => void;
}) {
  const stored = useSettingsStore((s) => s[field]);
  const value = shown ?? stored;
  return (
    <SettingRow label={label} help={help} info={info}>
      {({ labelId, helpId }) => (
        <Switch
          checked={value}
          labelledBy={labelId}
          describedBy={helpId}
          onChange={(v) => {
            void save({ [field]: v }).then((ok) => ok && onSaved());
          }}
        />
      )}
    </SettingRow>
  );
}

export const QUIET_HELP = 'Words instead of numbers';
export const QUIET_WHY = 'On because your safety answers put you in gentle mode; you can turn it off.';

/** Quiet mode shows the value in effect: on by default in gentle mode (safety mode R1, SUITE_SPEC §3.7). */
function QuietModeRow({ onSaved }: { onSaved: () => void }) {
  const quiet = useQuietMode();
  return (
    <SwitchRow
      field="quietMode"
      label="Quiet mode"
      value={quiet.on}
      help={quiet.byDefault ? `${QUIET_HELP}. ${QUIET_WHY}` : QUIET_HELP}
      info={{
        title: 'Quiet mode',
        body: 'Quiet mode shows words instead of personal readings: calories, steps and scores are hidden, and charts keep their shape without figures. Your safety answers can turn it on by default; you can turn it off here at any time. Values you type yourself still show. Planning tools and safety limits keep their numbers.',
      }}
      onSaved={onSaved}
    />
  );
}

export function UnitsSection() {
  const [saved, flash] = useSavedFlash();
  return (
    <SettingsSection id="units" title="Units" saved={saved}>
      <SettingsGroup>
        <BankRow
          field="units"
          label="Weight and height"
          onSaved={flash}
          options={[
            { value: 'metric', label: 'Metric' },
            { value: 'imperial', label: 'Imperial' },
          ]}
        />
        <BankRow
          field="energyUnit"
          label="Energy"
          onSaved={flash}
          options={[
            { value: 'kcal', label: 'kcal' },
            { value: 'kJ', label: 'kJ' },
          ]}
        />
        <BankRow
          field="glucoseUnit"
          label="Glucose and lipids"
          onSaved={flash}
          options={[
            { value: 'mmol', label: 'mmol/L' },
            { value: 'mgdl', label: 'mg/dL' },
          ]}
        />
        <BankRow
          field="dateStyle"
          label="Dates"
          onSaved={flash}
          options={[
            { value: 'day-month', label: '5 Oct' },
            { value: 'month-day', label: 'Oct 5' },
          ]}
        />
        <BankRow
          field="weekStart"
          label="Week starts"
          onSaved={flash}
          options={[
            { value: 'monday', label: 'Monday' },
            { value: 'sunday', label: 'Sunday' },
          ]}
        />
      </SettingsGroup>
    </SettingsSection>
  );
}

/** Display preferences. Vitals is dark only: there is no theme switch. */
export function AppearanceSection() {
  const [saved, flash] = useSavedFlash();
  return (
    <SettingsSection id="appearance" title="Appearance" saved={saved}>
      <SettingsGroup>
        <SwitchRow
          field="chartPatterns"
          label="Patterns in charts"
          help="Hatching for colour-blind reading"
          onSaved={flash}
        />
        <BankRow
          field="reduceMotion"
          label="Reduce motion"
          info={{
            title: 'Reduce motion',
            body: 'On, or System when your device asks for it: numbers appear at once, charts draw complete and panels open without sliding. Off keeps the animations even if your device asks to reduce them.',
          }}
          onSaved={flash}
          options={[
            { value: 'system', label: 'System' },
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]}
        />
        <SwitchRow field="showFigure" label="Body figure" onSaved={flash} />
        <QuietModeRow onSaved={flash} />
      </SettingsGroup>
    </SettingsSection>
  );
}

/** Safety answers and opt-ins live in the safety store (src/state/safetyStore.ts). */
export function SafetySection() {
  const [saved, flash] = useSavedFlash();
  return (
    <SettingsSection id="safety" title="Safety" saved={saved}>
      <SafetySettingsPanel onSaved={flash} />
    </SettingsSection>
  );
}

export function AboutSection() {
  const [validation, setValidation] = useState<ReturnType<typeof readHeadline>>(null);
  useEffect(() => {
    let alive = true;
    void loadValidationReport?.()
      .then((text) => {
        const h = readHeadline(text);
        if (alive && h) setValidation(h);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return (
    <SettingsSection id="about" title="About">
      <UpdatesRow />
      <SettingsGroup>
        <SettingsLinkRow
          to={paths.validationReport}
          icon={ClipboardCheck}
          title="Model evidence report"
          value="Open"
        />
        <SettingsDisclosure title="Licences">
          <ul className="settings-licences">
            {LICENCES.map((l) => (
              <li key={l.name}>
                <span className="settings-licences__name">{l.name}</span>
                <span className="settings-licences__licence">{l.licence}</span>
              </li>
            ))}
          </ul>
          <p className="settings-note">
            {FIGURE_CREDIT.text}{' '}
            <a
              className="lm-link"
              href={`${import.meta.env.BASE_URL}${FIGURE_CREDIT.file}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {FIGURE_CREDIT.link}
            </a>
          </p>
        </SettingsDisclosure>
      </SettingsGroup>
      <p className="settings-note">
        {validation ? (
          <>
            {validation.modelDate ? `Model snapshot: ${validation.modelDate}. ` : 'Dated model snapshot. '}
            {validation.met} of {validation.mustPass} model targets met; {validation.known} known misses.
            {' '}
          </>
        ) : null}
        Model comparisons, not software test status or prediction accuracy. Study limitations and missing
        independent evaluations are detailed in the report.
      </p>
    </SettingsSection>
  );
}
