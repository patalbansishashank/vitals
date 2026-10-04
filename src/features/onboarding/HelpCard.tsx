import { useId } from 'react';
import { cx } from '@/components';
import { HELP } from './copy';
import './onboarding.css';

export interface HelpCardProps {
  /** Heading level of "Support, any time." (default h3). */
  headingAs?: 'h2' | 'h3' | 'h4';
  /** Hide the region-specific numbers (hard stop, popovers). */
  compact?: boolean;
  className?: string;
}

/**
 * The help card (dossier DS-8, design §6.5): region-neutral first, the global helpline directory, then the
 * region numbers the dossier verified. Plain content — wrap it in a Faceplate or Popover where it sits.
 */
export function HelpCard({ headingAs = 'h3', compact = false, className }: HelpCardProps) {
  const H = headingAs;
  const titleId = useId();
  return (
    <section className={cx('lm-help-card', className)} aria-labelledby={titleId}>
      <H className="lm-help-card__title" id={titleId}>
        {HELP.title}
      </H>
      <p className="lm-help-card__body">{HELP.body}</p>
      <p>
        {HELP.directoryLead}{' '}
        <a className="lm-link" href={HELP.directory.href} target="_blank" rel="noopener noreferrer">
          {HELP.directory.label}
          <span className="lm-sr"> (opens in a new tab)</span>
        </a>
      </p>
      {compact ? null : (
        <dl className="lm-help-card__regions">
          {HELP.regions.map((r) => (
            <div key={r.region}>
              <dt>{r.region}</dt>
              <dd>
                <b>{r.service}</b> · {r.detail}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p>{HELP.crisis}</p>
    </section>
  );
}
