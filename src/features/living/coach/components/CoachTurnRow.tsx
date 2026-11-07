/**
 * One turn of the conversation. Yours: a plain bubble at the right (card-soft, no gold). The Coach's: text on the page
 * at the left, then the "looked at" line and the cards the turn produced (each its own card, never inside another).
 * The speaker is named for screen readers only; the layout shows it.
 */
import { Suspense, lazy } from 'react';
import { InlineWarning, Key } from '@/components';
import { ChangeCard, type ChangeActionExtra, type ChangeCardView } from '../../components/ChangeCard';
import type { ChangeAction } from '../../model/changeCard';
import type { CoachTurn } from '../adapter';
import { COACH_COPY as T } from '../copy';

export interface CoachTurnRowProps {
  turn: CoachTurn;
  now: Date;
  /** Quiet mode without "show numbers": portions, no kcal. */
  quiet: boolean;
  /** Who photos are sent to ("Anthropic"). */
  provider: string;
  onCardAction: (card: ChangeCardView, action: ChangeAction, extra?: ChangeActionExtra) => void;
  /** Error turns: send the previous message again. */
  onRetry?: () => void;
}

const noop = () => undefined;

// E20: the review table of a blood test report card (lazy: it brings the marker units and the intake table)
const CoachMarkersReview = lazy(() => import('./CoachMarkersReview'));

export function CoachTurnRow({ turn, now, quiet, provider, onCardAction, onRetry }: CoachTurnRowProps) {
  const paragraphs = turn.text ? turn.text.split(/\n{2,}/) : [];
  const you = turn.role === 'you';
  const text = paragraphs.map((p, i) => (
    <p key={i} className="lv-coach-text">
      {p}
    </p>
  ));
  return (
    <div className="lv-coach-turn" data-role={turn.role} aria-busy={turn.streaming || undefined}>
      <span className="lm-sr">{you ? T.you : T.coach}</span>
      <div className="lv-coach-body">
        {turn.photo ? (
          <figure className="lv-coach-photo">
            {turn.photo.url ? (
              <img
                src={turn.photo.url}
                alt={turn.photo.alt}
                width={96}
                height={96}
                className="lv-coach-photo__img"
              />
            ) : (
              <span role="img" aria-label={turn.photo.alt} className="lv-coach-photo__img" />
            )}
            <figcaption className="lv-coach-note">{T.photoSent(provider)}</figcaption>
          </figure>
        ) : null}
        {you && text.length ? <div className="lv-coach-bubble">{text}</div> : null}
        {you ? null : text}
        {turn.streaming && turn.progress ? (
          <p className="lv-coach-note" data-state="progress">
            {turn.progress}
          </p>
        ) : turn.streaming && !turn.text ? (
          <p className="lv-coach-note">{T.writing}</p>
        ) : null}
        {turn.reads ? (
          <ChangeCard card={turn.reads} now={now} context="conversation" quiet={quiet} onAction={noop} />
        ) : null}
        {turn.cards.map((c) => (
          <div key={c.id} className="lv-coach-card" data-card-id={c.id}>
            {/* a card of its own on the page (the conversation is no card), so it takes the standalone material */}
            <ChangeCard
              card={c}
              now={now}
              context="standalone"
              headingLevel="h4"
              quiet={quiet}
              showSource={false}
              onAction={(a, x) => onCardAction(c, a, x)}
              {...(c.markers && c.state === 'pending'
                ? {
                    detail: (
                      <Suspense fallback={null}>
                        <CoachMarkersReview
                          review={c.markers}
                          onApply={(markers) => onCardAction(c, 'apply', { markers })}
                        />
                      </Suspense>
                    ),
                  }
                : {})}
            />
          </div>
        ))}
        {turn.stopped ? <p className="lv-coach-note">{T.stopped}</p> : null}
        {turn.error ? (
          <div className="lv-coach-error">
            <InlineWarning severity="caution">{turn.error.message}</InlineWarning>
            {onRetry ? (
              <Key size="sm" variant="action" onClick={onRetry}>
                {T.tryAgain}
              </Key>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
