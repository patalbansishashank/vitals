import { Link } from 'react-router';
import { InlineWarning, KeyLink, Section, cx, energyInText } from '@/components';
import { useEnergyUnit } from '@/state/settingsStore';
import { paths } from '@/app/paths';
import { DISCLAIMER, LAST_REVIEWED, LIMITS_PAGE, STOP_AND_GET_HELP } from './copy';
import { HelpCard } from './HelpCard';
import './onboarding.css';

export interface DisclaimerLineProps {
  /**
   * `true` removes the top hairline and padding (inside a readout strip or card footer). Default: a quiet
   * line with a hairline, meant to sit directly under the chart/readouts of a results surface.
   */
  bare?: boolean;
  /** Hide the "Safety & limits" link (exports and printouts). */
  noLink?: boolean;
  className?: string;
}

/**
 * The persistent short disclaimer (design §6.6, dossier §4.6 "results header"). Place it NEXT TO THE NUMBERS
 * on every results surface — directly under the chart or readout strip of Simulator results and each Planner
 * plan — never only in a page footer (FTC: disclosures sit near the claim).
 */
export function DisclaimerLine({ bare = false, noLink = false, className }: DisclaimerLineProps) {
  return (
    <p className={cx('lm-disclaimer-line', className)} data-bare={bare || undefined}>
      {DISCLAIMER.resultsLine}
      {noLink ? null : (
        <>
          {' '}
          <Link className="lm-link" to={paths.safety}>
            {DISCLAIMER.resultsLink}
          </Link>
        </>
      )}
    </p>
  );
}

/** Planner prescription-card micro-copy (dossier §4.6). Put it on each plan card, under the projected numbers. */
export function PlannerDisclaimer({ className }: { className?: string }) {
  return (
    <p className={cx('lm-disclaimer-line', className)} data-bare="true">
      {DISCLAIMER.plannerCard}{' '}
      <Link className="lm-link" to={paths.safety}>
        {DISCLAIMER.resultsLink}
      </Link>
    </p>
  );
}

/** The short footer (dossier §4.6 "Footer (every page)"). */
export function DisclaimerFooter({ className }: { className?: string }) {
  return (
    <p className={cx('lm-disclaimer-footer', className)}>
      {DISCLAIMER.footer}{' '}
      <Link className="lm-link" to={paths.safety}>
        {DISCLAIMER.resultsLink}
      </Link>
    </p>
  );
}

/** Persistent line at the bottom of the Warnings panel for any caution/danger scenario (dossier §3). */
export function StopAndGetHelp({ className }: { className?: string }) {
  return (
    <InlineWarning severity="caution" className={className}>
      {STOP_AND_GET_HELP}
    </InlineWarning>
  );
}

export interface DisclaimerFullProps {
  /** Heading level for section labels (default h3); the help card sits one level below. */
  headingAs?: 'h3' | 'h4';
  /** Smaller prose (Settings › About, consent dialog). */
  size?: 'md' | 'sm';
  /** Include the help card (default true). */
  withHelp?: boolean;
  /** Include the link to the full page (inside dialogs and Settings). */
  withPageLink?: boolean;
}

/**
 * The full disclaimer ("Important information and limits", dossier §4.6) — used on /safety, in the
 * first-run "Full disclaimer" dialog and in Settings › About. No faceplates inside: hairline sections only.
 */
export function DisclaimerFull({ headingAs = 'h3', size = 'md', withHelp = true, withPageLink = false }: DisclaimerFullProps) {
  return (
    <div className="grid gap-5">
      {LIMITS_PAGE.sections.map((s) => (
        <Section key={s.id} label={s.title} labelAs={headingAs}>
          <div className="lm-prose mt-2" data-size={size}>
            {s.paragraphs.map((p) => (
              <p key={p.slice(0, 24)}>{p}</p>
            ))}
          </div>
        </Section>
      ))}
      <Section label={LIMITS_PAGE.limitsTitle} labelAs={headingAs}>
        <div className="lm-prose mt-2" data-size={size}>
          <p>{LIMITS_PAGE.limitsLead}</p>
        </div>
        <LimitsList className="mt-3" />
        <p className="mt-2 mb-0 text-xs text-ink-2">{LIMITS_PAGE.sexNote}</p>
      </Section>
      <Section label={LIMITS_PAGE.stopTitle} labelAs={headingAs}>
        <div className="mt-2 grid gap-3">
          <StopAndGetHelp />
          <div className="lm-prose" data-size={size}>
            <p>{LIMITS_PAGE.stopBody}</p>
          </div>
          {withHelp ? <HelpCard headingAs="h4" /> : null}
        </div>
      </Section>
      <Section label={LIMITS_PAGE.dataTitle} labelAs={headingAs}>
        <div className="lm-prose mt-2" data-size={size}>
          {LIMITS_PAGE.data.map((p) => (
            <p key={p.slice(0, 24)}>{p}</p>
          ))}
        </div>
      </Section>
      <Section label={LIMITS_PAGE.changesTitle} labelAs={headingAs}>
        <div className="lm-prose mt-2" data-size={size}>
          <p>
            {LIMITS_PAGE.changes} {LAST_REVIEWED}.{' '}
            <Link className="lm-link" to={paths.evidence}>
              {LIMITS_PAGE.evidenceLink}
            </Link>
          </p>
        </div>
      </Section>
      {withPageLink ? (
        <div>
          <KeyLink to={paths.safety} size="sm" variant="quiet">
            {LIMITS_PAGE.title}
          </KeyLink>
        </div>
      ) : null}
    </div>
  );
}

/** The Planner's safety limits as a definition list (dossier §2.2). */
export function LimitsList({ className }: { className?: string }) {
  const unit = useEnergyUnit();
  return (
    <dl className={cx('lm-limits', className)}>
      {LIMITS_PAGE.limits.map((l) => (
        <div key={l.key}>
          <dt>{l.key}</dt>
          <dd>{energyInText(l.value, unit)}</dd>
        </div>
      ))}
    </dl>
  );
}
