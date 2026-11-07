import { useEnergyUnit } from '@/state/settingsStore';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ShieldCheck } from 'lucide-react';
import { KeyLink, Popover, StatusCapsule } from '@/components';
import { paths } from '@/app/paths';
import { DISCLAIMER, modeSummary, SUMMARY } from './copy';
import { lockLines } from './SafetySummary';
import { useSafetyAccess, type SafetyBodyContext } from './useSafetyAccess';
import './onboarding.css';

/**
 * App-wide safety mode status icon (design §6.6, SPEC §9): a shield in the header's status slot when the mode is not
 * Standard, the mode's name as its name and tooltip. Press → a popover that says what the mode changes, with "Review my
 * answers"; from the ⋯ (when the bar has more than two status icons) it opens Safety & limits. Nothing in Standard.
 *
 *   <TopBar title="Simulate" status={<SafetyModeChip />} />
 */
export function SafetyModeChip({ context }: { context?: SafetyBodyContext }) {
  const access = useSafetyAccess(context);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const unit = useEnergyUnit();
  const { outcome } = access;
  if (!access.ready || outcome.modeName === 'standard') return null;
  const lines = lockLines(outcome.plannerLocks, unit).slice(0, 6);
  return (
    <>
      <StatusCapsule
        ref={ref}
        icon={ShieldCheck}
        label={`Safety mode: ${access.modeLabel}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onMenuSelect={() => navigate(paths.safety)}
      />
      <Popover open={open} onOpenChange={setOpen} anchorRef={ref} label={access.modeLabel} padding="roomy" placement="bottom-end">
        <div className="grid max-w-[36ch] gap-3">
          <p className="m-0 text-sm font-medium text-ink">{access.modeLabel}</p>
          <p className="m-0 text-sm leading-[1.5] text-ink-2">{modeSummary(outcome.modeName, outcome.fasting)}</p>
          {lines.length ? (
            <ul className="lm-safety-list" aria-label={SUMMARY.chipPopoverTitle}>
              {lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <KeyLink to={paths.welcome('screening', 'settings')} size="sm" variant="action">
              {SUMMARY.review}
            </KeyLink>
            <KeyLink to={paths.safety} size="sm" variant="text">
              {DISCLAIMER.resultsLink}
            </KeyLink>
          </div>
        </div>
      </Popover>
    </>
  );
}
