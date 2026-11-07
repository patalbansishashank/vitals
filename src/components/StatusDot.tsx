import { cx } from './lib/cx';
import './mono.css'; // the word is mono meta (`lm-mono`)
import './status.css';

export type StatusDotTone = 'live' | 'ok' | 'caution' | 'danger' | 'neutral';

export interface StatusDotProps {
  tone: StatusDotTone;
  /** The word. A status is a mark plus a word, never a colour alone. */
  label: string;
  /** Breathes (opacity 1 to 0.35, 1.1 s) while a real process runs: a recording, a running fast, a ring sync. Still under reduced motion. */
  pulse?: boolean;
  /** Keep the word for assistive technology only (the dot stands alone beside a title that already says it). */
  hideLabel?: boolean;
  className?: string;
}

/**
 * A 6 px status dot and its word in mono meta (r071). It is the one dot-and-word mark meant to replace `.settings-status`, the dot-and-word chips and the
 * breathing dots. `live` is the gold "now"; ok, caution and danger are the severity marks of the tokens, which are
 * never green or red on purpose; `neutral` is stone.
 */
export function StatusDot({ tone, label, pulse = false, hideLabel = false, className }: StatusDotProps) {
  return (
    <span className={cx('lm-status', className)} data-tone={tone} data-pulse={pulse || undefined}>
      <i className="lm-status__dot" aria-hidden="true" />
      <span className={hideLabel ? 'lm-sr' : 'lm-status__label lm-mono'}>{label}</span>
    </span>
  );
}
