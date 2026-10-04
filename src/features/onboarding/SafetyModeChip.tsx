import { useEnergyUnit } from '@/state/settingsStore';
import { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Icon, KeyLink, Popover, StatusMark } from '@/components';
import { paths } from '@/app/paths';
import { DISCLAIMER, modeSummary, SUMMARY } from './copy';
import { lockLines } from './SafetySummary';
import { useSafetyAccess, type SafetyBodyContext } from './useSafetyAccess';
import './onboarding.css';

/**
 * App-wide safety mode chip (design §6.6): shown in the context bar / top bar when the mode is not
 * Standard. Press → a popover that says what the mode changes, with "Review my answers".
 *
 *   <TopBar title="Planner" actions={<SafetyModeChip />} />
 */
export function SafetyModeChip({ context }: { context?: SafetyBodyContext }) {
  const access = useSafetyAccess(context);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const unit = useEnergyUnit();
  const { outcome } = access;
  if (!access.ready || outcome.modeName === 'standard') return null;
  const lines = lockLines(outcome.plannerLocks, unit).slice(0, 6);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="lm-chip"
        data-kind="status"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <StatusMark severity="info" size={16} />
        <span className="lm-chip__text">{access.modeLabel}</span>
        <Icon icon={ChevronDown} size={14} />
      </button>
      <Popover open={open} onOpenChange={setOpen} anchorRef={ref} label={access.modeLabel} padding="roomy" placement="bottom-end">
        <div className="grid max-w-[36ch] gap-3">
          <p className="m-0 text-sm font-semibold text-ink">{access.modeLabel}</p>
          <p className="m-0 text-sm leading-[1.5] text-ink-2">{modeSummary(outcome.modeName, outcome.fasting)}</p>
          {lines.length ? (
            <ul className="lm-safety-list" aria-label={SUMMARY.chipPopoverTitle}>
              {lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <KeyLink to={paths.welcome('screening', 'settings')} size="sm">
              {SUMMARY.review}
            </KeyLink>
            <KeyLink to={paths.safety} size="sm" variant="quiet">
              {DISCLAIMER.resultsLink}
            </KeyLink>
          </div>
        </div>
      </Popover>
    </>
  );
}
