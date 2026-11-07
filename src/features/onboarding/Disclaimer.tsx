import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { InlineWarning, KeyLink, cx, energyInText } from '@/components';
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
  /** Heading level for the section titles (default h3); the help card sits one level below. */
  headingAs?: 'h2' | 'h3' | 'h4';
  /** Prose size: `sm` body 14/21 (default: /safety, the consent dialog) · `md` body-l 16/24. */
  size?: 'md' | 'sm';
  /** Include the help card (default true). */
  withHelp?: boolean;
  /** Two columns (a wide /safety): prose on the left, the limits and the help beside it. */
  split?: boolean;
  /** Include the link to the full page (inside dialogs). */
  withPageLink?: boolean;
}

const BELOW = { h2: 'h3', h3: 'h4', h4: 'h4' } as const;

/** One titled block of the disclaimer: a title-m heading (16/500) and its content; hairline sections, never cards. */
function DisclaimerSection({ id, title, headingAs: H, children }: { id: string; title: string; headingAs: 'h2' | 'h3' | 'h4'; children: ReactNode }) {
  const titleId = `lm-disclaimer-${id}`;
  return (
    <section className="lm-disclaimer__sec" aria-labelledby={titleId}>
      <H className="lm-disclaimer__title" id={titleId}>
        {title}
      </H>
      {children}
    </section>
  );
}

/**
 * The full disclaimer (dossier §4.6) — used on /safety and in the first-run "Full disclaimer" dialog. Sections with a
 * title-m heading over body-size prose, separated by hairlines; no cards inside.
 */
export function DisclaimerFull({ headingAs = 'h3', size = 'sm', withHelp = true, withPageLink = false, split = false }: DisclaimerFullProps) {
  const limits = (
    <DisclaimerSection id="limits" title={LIMITS_PAGE.limitsTitle} headingAs={headingAs}>
      <div className="lm-prose" data-size={size}>
        <p>{LIMITS_PAGE.limitsLead}</p>
      </div>
      <LimitsList />
      <p className="lm-disclaimer__note">{LIMITS_PAGE.sexNote}</p>
    </DisclaimerSection>
  );
  const stop = (
    <DisclaimerSection id="stop" title={LIMITS_PAGE.stopTitle} headingAs={headingAs}>
      <StopAndGetHelp />
      {withHelp ? <HelpCard headingAs={BELOW[headingAs]} /> : null}
    </DisclaimerSection>
  );
  const tail = (
    <>
      <DisclaimerSection id="data" title={LIMITS_PAGE.dataTitle} headingAs={headingAs}>
        <div className="lm-prose" data-size={size}>
          {LIMITS_PAGE.data.map((p) => (
            <p key={p.slice(0, 24)}>{p}</p>
          ))}
        </div>
      </DisclaimerSection>
      <DisclaimerSection id="changes" title={LIMITS_PAGE.changesTitle} headingAs={headingAs}>
        <div className="lm-prose" data-size={size}>
          <p>
            {LIMITS_PAGE.changes} {LAST_REVIEWED}.{' '}
            <Link className="lm-link" to={paths.evidence}>
              {LIMITS_PAGE.evidenceLink}
            </Link>
          </p>
        </div>
      </DisclaimerSection>
    </>
  );
  const intro = LIMITS_PAGE.sections.map((s) => (
    <DisclaimerSection key={s.id} id={s.id} title={s.title} headingAs={headingAs}>
      <div className="lm-prose" data-size={size}>
        {s.paragraphs.map((p) => (
          <p key={p.slice(0, 24)}>{p}</p>
        ))}
      </div>
    </DisclaimerSection>
  ));
  // a wide page: the prose in one column, the limits beside it, the help across both (r068 SA-1, final H3)
  if (split)
    return (
      <div className="lm-disclaimer" data-split="true">
        <div className="lm-disclaimer__main">
          {intro}
          {tail}
        </div>
        {/* (r068 final H3) the limits hold still beside the prose; the help spans both columns under them, its
            helplines side by side, so neither column ends 500 px before the other */}
        <div className="lm-disclaimer__side">
          <div className="lm-material lm-disclaimer__card">{limits}</div>
        </div>
        <div className="lm-material lm-disclaimer__card lm-disclaimer__wide">{stop}</div>
      </div>
    );
  return (
    <div className="lm-disclaimer">
      {LIMITS_PAGE.sections.map((s) => (
        <DisclaimerSection key={s.id} id={s.id} title={s.title} headingAs={headingAs}>
          <div className="lm-prose" data-size={size}>
            {s.paragraphs.map((p) => (
              <p key={p.slice(0, 24)}>{p}</p>
            ))}
          </div>
        </DisclaimerSection>
      ))}
      <DisclaimerSection id="limits" title={LIMITS_PAGE.limitsTitle} headingAs={headingAs}>
        <div className="lm-prose" data-size={size}>
          <p>{LIMITS_PAGE.limitsLead}</p>
        </div>
        <LimitsList />
        <p className="lm-disclaimer__note">{LIMITS_PAGE.sexNote}</p>
      </DisclaimerSection>
      <DisclaimerSection id="stop" title={LIMITS_PAGE.stopTitle} headingAs={headingAs}>
        <StopAndGetHelp />
        {withHelp ? <HelpCard headingAs={BELOW[headingAs]} /> : null}
      </DisclaimerSection>
      <DisclaimerSection id="data" title={LIMITS_PAGE.dataTitle} headingAs={headingAs}>
        <div className="lm-prose" data-size={size}>
          {LIMITS_PAGE.data.map((p) => (
            <p key={p.slice(0, 24)}>{p}</p>
          ))}
        </div>
      </DisclaimerSection>
      <DisclaimerSection id="changes" title={LIMITS_PAGE.changesTitle} headingAs={headingAs}>
        <div className="lm-prose" data-size={size}>
          <p>
            {LIMITS_PAGE.changes} {LAST_REVIEWED}.{' '}
            <Link className="lm-link" to={paths.evidence}>
              {LIMITS_PAGE.evidenceLink}
            </Link>
          </p>
        </div>
      </DisclaimerSection>
      {withPageLink ? (
        <div>
          <KeyLink to={paths.safety} size="sm" variant="text">
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
