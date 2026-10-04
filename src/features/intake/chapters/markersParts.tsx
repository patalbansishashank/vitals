/**
 * Small pieces shared by the markers chapter's screens: the question card shell (an inset region with the prompt as
 * legend, "why we ask", the default line and a footer: COMPONENTS §14.3, kept local so the v3 card can re-host the
 * bodies), the range status text and the date field.
 */
import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { StatusMark, cx } from '@/components';
import { CardFootSlot } from '../components/widgetTypes';
import { TURN } from '../copy';
import { M, type RangeStatus } from './markers';
import './markers.css';

export interface MarkersCardProps {
  /** Text above the prompt (statements, chapter intro). */
  lead?: ReactNode;
  prompt: string;
  why?: string;
  /** "if you skip: …" */
  skipText?: string;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  id?: string;
  /** Stable id for the legend (tests and aria-labelledby of inner groups). */
  legendId?: string;
}

/**
 * True inside the intake's v3 QuestionCard, which already shows the prompt, "why we ask", the default line and Back:
 * the card then renders only its lead, body and footer.
 */
export const MarkersEmbedded = createContext(false);

export function MarkersCard({ lead, prompt, why, skipText, footer, children, className, id, legendId }: MarkersCardProps) {
  const embedded = useContext(MarkersEmbedded);
  const auto = useId();
  const lid = legendId ?? `${auto}-legend`;
  const whyId = `${auto}-why`;
  const [open, setOpen] = useState(false);
  const leadId = `${auto}-lead`;
  const described = [lead ? leadId : null, open ? whyId : null].filter(Boolean).join(' ') || undefined;
  const slot = useContext(CardFootSlot);
  if (embedded)
    return (
      <div className={cx('lm-mk-card lm-mk-card--embedded', className)} id={id}>
        {lead ? <div className="lm-mk-card__lead">{lead}</div> : null}
        <div className="lm-mk-card__body">{children}</div>
        {/* the host card's footer takes the keys (MarkersFoot); only the notes stay here */}
        {footer ? slot ? footer : <div className="lm-mk-card__foot">{footer}</div> : null}
      </div>
    );
  return (
    <section className={cx('lm-mk-card', className)} id={id} aria-labelledby={lid}>
      {lead ? (
        <div className="lm-mk-card__lead" id={leadId}>
          {lead}
        </div>
      ) : null}
      <fieldset className="lm-mk-card__set" aria-describedby={described}>
        <legend id={lid} className="lm-mk-card__prompt" tabIndex={-1}>
          {prompt}
        </legend>
        {why ? (
          <div className="lm-mk-card__why">
            <button type="button" className="lm-ik-why" aria-expanded={open} aria-controls={whyId} onClick={() => setOpen((o) => !o)}>
              {TURN.why}
              <span aria-hidden="true" className={cx('lm-ik-why__chev', open && 'is-open')}>
                ▾
              </span>
            </button>
            <p id={whyId} className="lm-ik-why__text" hidden={!open}>
              {why}
            </p>
          </div>
        ) : null}
        <div className="lm-mk-card__body">{children}</div>
        {skipText ? <p className="lm-mk-card__default">{TURN.ifSkip(skipText)}</p> : null}
      </fieldset>
      {footer ? <div className="lm-mk-card__foot">{footer}</div> : null}
    </section>
  );
}

/**
 * A screen's footer: an error notice, the keys (left: Back and the like; right: the solid action) and the visible
 * reason a disabled action waits for. Inside the intake card (`CardFootSlot`) the keys go into the card's own footer
 * in Next's place, so the card has one footer and one reason (design intake-v3 §8.2, §8.3).
 */
export function MarkersFoot({ notice, left, right, reason }: { notice?: ReactNode; left?: ReactNode; right: ReactNode; reason?: string | null }) {
  const slot = useContext(CardFootSlot);
  const notes = (
    <>
      {notice}
      {reason ? <p className="lm-mk-reason">{reason}</p> : null}
    </>
  );
  if (slot)
    return (
      <>
        {notice || reason ? <div className="lm-mk-foot-notes">{notes}</div> : null}
        {createPortal(
          <>
            {left}
            {right}
          </>,
          slot,
        )}
      </>
    );
  return (
    <>
      {notice}
      <div className="lm-mk-footrow">
        {left}
        <span className="lm-mk-footrow__right">{right}</span>
      </div>
      {reason ? <p className="lm-mk-reason">{reason}</p> : null}
    </>
  );
}

/** "above range" with a caution mark; "in range" plain. Achromatic text: the mark carries the colour, never alone. */
export function RangeStatusText({ status, id }: { status: RangeStatus | null; id?: string }) {
  if (!status) return <span className="lm-mk-status" id={id} />;
  const out = status !== 'in';
  return (
    <span className="lm-mk-status" id={id} data-out={out || undefined}>
      {out ? <StatusMark severity="caution" size={16} /> : null}
      <span>{M.table.status[status]}</span>
    </span>
  );
}

/** A date field (native picker), YYYY-MM-DD, not after today. */
export function MarkerDateInput({ value, onChange, label, max, id }: { value: string; onChange: (v: string) => void; label: string; max: string; id?: string }) {
  return <input id={id} type="date" className="lm-input lm-mk-date" value={value} max={max} aria-label={label} onChange={(e) => e.target.value && onChange(e.target.value)} />;
}
