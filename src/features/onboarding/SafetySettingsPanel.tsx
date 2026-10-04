import { useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { Icon, KeyLink, Popover } from '@/components';
import { paths } from '@/app/paths';
import { MODE_SHORT, modeSummary, SETTINGS_SAFETY } from './copy';
import { FastingTierControls } from './FastingTierControls';
import { HelpCard } from './HelpCard';
import { useSafetyAccess } from './useSafetyAccess';
import { useBodyContext } from '@/state/profileStore';
import './onboarding.css';

/**
 * Settings › Safety body (settings-data.md §6): the current mode in plain words, "Review my answers", the
 * fasting opt-in rows (formerly the interim `allowLongFasts` switch) and the help card.
 */
export function SafetySettingsPanel({ onSaved }: { onSaved?: () => void }) {
  // the body facts matter: without them fasts over 48 h stay out of plans, and the summary would say so
  const context = useBodyContext();
  const access = useSafetyAccess(context);
  const [supportOpen, setSupportOpen] = useState(false);
  const supportRef = useRef<HTMLButtonElement>(null);
  const answered = access.gate.status !== 'first-run';
  return (
    <div className="grid gap-0">
      <div className="grid gap-3 pb-3">
        {answered ? (
          <p className="m-0 text-sm leading-[1.5] text-ink">
            {SETTINGS_SAFETY.modeLine}: <strong className="font-semibold">{MODE_SHORT[access.outcome.modeName]}</strong>. {modeSummary(access.outcome.modeName, access.outcome.fasting)}
          </p>
        ) : (
          <p className="m-0 text-sm leading-[1.5] text-ink">{SETTINGS_SAFETY.notAnswered}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <KeyLink to={answered ? paths.welcome('screening', 'settings') : paths.welcome()} size="sm">
            {answered ? SETTINGS_SAFETY.review : SETTINGS_SAFETY.answer}
          </KeyLink>
          <KeyLink to={paths.safety} size="sm" variant="quiet">
            {SETTINGS_SAFETY.limitsLink}
          </KeyLink>
        </div>
      </div>
      <FastingTierControls context={context} onSaved={onSaved} />
      <div className="border-t border-line pt-3">
        <button
          ref={supportRef}
          type="button"
          className="lm-link inline-flex items-center gap-1 border-0 bg-transparent p-0 text-sm"
          aria-expanded={supportOpen}
          aria-haspopup="dialog"
          onClick={() => setSupportOpen((o) => !o)}
        >
          {SETTINGS_SAFETY.support}
          <Icon icon={ChevronRight} size={16} />
        </button>
        <Popover open={supportOpen} onOpenChange={setSupportOpen} anchorRef={supportRef} label={SETTINGS_SAFETY.support} padding="roomy" placement="top-start">
          <div className="max-w-[40ch]">
            <HelpCard headingAs="h3" />
            <p className="mb-0 mt-3 text-sm">
              <Link className="lm-link" to={paths.safety}>
                {SETTINGS_SAFETY.limitsLink}
              </Link>
            </p>
          </div>
        </Popover>
      </div>
    </div>
  );
}
