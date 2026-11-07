import { useSafetyStore } from '@/state/safetyStore';
import { NutritionGuidanceForm } from './NutritionGuidanceForm';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { ChevronRight, LifeBuoy } from 'lucide-react';
import { Icon, Popover } from '@/components';
import { paths } from '@/app/paths';
import { SettingRow, SettingsGroup, SettingsItem } from '@/features/settings/SettingRow';
import { MODE_SHORT, modeSummary, SETTINGS_SAFETY } from './copy';
import { FastingTierControls } from './FastingTierControls';
import { HelpCard } from './HelpCard';
import { useSafetyAccess } from './useSafetyAccess';
import { useBodyContext } from '@/state/profileStore';
import './onboarding.css';

/**
 * Settings › Safety body (settings-data.md §6; r068 S24), in the settings grammar:
 * - Your answers: the mode as a row ("Mode · Standard", what it allows as its one fact line), then "Review my answers"
 *   and "Safety & limits" as two chevron rows of equal weight.
 * - The clinician's nutrition guidance when it applies, the fasting opt-ins (formerly the interim `allowLongFasts` switch).
 * - Support, any time: a row of its own that opens the help card.
 */
export function SafetySettingsPanel({ onSaved }: { onSaved?: () => void }) {
  // the body facts matter: without them fasts over 48 h stay out of plans, and the summary would say so
  const hasCondition = useSafetyStore((s) => s.answers?.conditions === 'yes');
  const context = useBodyContext();
  const access = useSafetyAccess(context);
  const [supportOpen, setSupportOpen] = useState(false);
  const supportRef = useRef<HTMLButtonElement>(null);
  const answered = access.gate.status !== 'first-run';
  return (
    <>
      <SettingsGroup label="Your answers">
        {answered ? (
          <SettingRow label={SETTINGS_SAFETY.modeLine} help={modeSummary(access.outcome.modeName, access.outcome.fasting)}>
            {() => <span className="settings-value">{MODE_SHORT[access.outcome.modeName]}</span>}
          </SettingRow>
        ) : (
          <SettingsItem>
            <p className="settings-text">{SETTINGS_SAFETY.notAnswered}</p>
          </SettingsItem>
        )}
        <Link className="settings-row" to={answered ? paths.welcome('screening', 'settings') : paths.welcome()}>
          <span className="settings-row__title">{answered ? SETTINGS_SAFETY.review : SETTINGS_SAFETY.answer}</span>
          <Icon icon={ChevronRight} size={18} className="settings-row__chev" />
        </Link>
        <Link className="settings-row" to={paths.safety}>
          <span className="settings-row__title">{SETTINGS_SAFETY.limitsLink}</span>
          <Icon icon={ChevronRight} size={18} className="settings-row__chev" />
        </Link>
      </SettingsGroup>
      {(hasCondition || access.outcome.renal.context !== 'none' || access.outcome.renal.envelopes.length > 0) && <NutritionGuidanceForm scope={access.outcome.renal} onSaved={onSaved} />}
      <SettingsGroup label="Fasting">
        <SettingsItem>
          <FastingTierControls context={context} onSaved={onSaved} />
        </SettingsItem>
      </SettingsGroup>
      <SettingsGroup label={SETTINGS_SAFETY.supportGroup} icons>
        <button
          ref={supportRef}
          type="button"
          className="settings-row settings-row--button"
          aria-expanded={supportOpen}
          aria-haspopup="dialog"
          onClick={() => setSupportOpen((o) => !o)}
        >
          <Icon icon={LifeBuoy} size={22} className="settings-row__icon" />
          <span className="settings-row__title">{SETTINGS_SAFETY.support}</span>
          <Icon icon={ChevronRight} size={18} className="settings-row__chev" />
        </button>
        <Popover open={supportOpen} onOpenChange={setSupportOpen} anchorRef={supportRef} label={SETTINGS_SAFETY.support} padding="roomy" placement="top-start">
          <div className="max-w-[40ch]">
            <HelpCard headingAs="h3" />
          </div>
        </Popover>
      </SettingsGroup>
    </>
  );
}
