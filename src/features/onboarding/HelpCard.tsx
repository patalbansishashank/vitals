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
        <div className="lm-help-card__regions">
          {HELP.regions.map((r) => (
            <section key={r.region} className="lm-help-region" aria-label={`${r.region}: ${r.service}`}>
              <p className="lm-help-region__head">
                <span className="lm-help-region__name">{r.region}</span>
                <span className="lm-help-region__service">{r.service}</span>
              </p>
              <ul className="lm-help-region__numbers">
                {r.numbers.map((n) => (
                  <li key={n.number}>
                    <a className="lm-help-num" href={`tel:${n.number.replace(/\s/g, '')}`}>
                      <span className="lm-help-num__label">{n.label}</span>
                      <span className="lm-help-num__number lm-num">{n.number}</span>
                    </a>
                  </li>
                ))}
              </ul>
              <p className="lm-help-region__hours">{r.hours}</p>
            </section>
          ))}
        </div>
      )}
      <p>{HELP.crisis}</p>
    </section>
  );
}
