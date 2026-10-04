import { useEffect, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cx } from './lib/cx';
import { useLatest } from './lib/hooks';
import { formatNumber } from './lib/format';
import { Tooltip } from './Tooltip';

export type RunKeyState = 'idle' | 'stale' | 'running';

export interface RunKeyProps extends Omit<ComponentPropsWithoutRef<'button'>, 'children' | 'onClick'> {
  /** Runs the simulation (or the optimiser). */
  onRun: () => void;
  /** `idle` · `stale` (inputs changed: ink dot at one o'clock) · `running` (pressed, arc spins, label = elapsed). */
  state?: RunKeyState;
  /** Seconds elapsed while running; replaces the label ("1.2 s"). */
  elapsed?: number;
  /** Word engraved on the cap. Lowercase "run" by default. */
  label?: string;
  /** Small caption to the LEFT of the key, e.g. "84 days". Never repeat "Run" here (REVIEW_FINDINGS #1). */
  caption?: ReactNode;
  /** `md` 44 px (desktop context bar) · `lg` 56 px (mobile action bar). */
  size?: 'md' | 'lg';
  /** When set the key is disabled but focusable and explains why ("Paint at least one week first"). */
  disabledReason?: string;
  /** Bind ⌘/Ctrl + Enter to onRun while mounted. */
  shortcut?: boolean;
}

/**
 * The yellow key — the ET66 "=" key. The only round primary and the only yellow
 * control in the product. One per view.
 */
export function RunKey({
  onRun,
  state = 'idle',
  elapsed,
  label = 'run',
  caption,
  size = 'md',
  disabledReason,
  shortcut = false,
  className,
  ...rest
}: RunKeyProps) {
  const disabled = Boolean(disabledReason);
  const running = state === 'running';
  const run = useLatest(() => {
    if (!disabled && !running) onRun();
  });

  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        run.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcut, run]);

  const shown = running && elapsed !== undefined ? `${formatNumber(elapsed, 1)} s` : label;
  const accessible = running
    ? `Running${elapsed !== undefined ? `, ${formatNumber(elapsed, 1)} seconds` : ''}`
    : state === 'stale'
      ? `${capitalise(label)} — inputs changed since the last run`
      : capitalise(label);

  const button = (
    <button
      type="button"
      className={cx('lm-runkey', className)}
      data-size={size}
      data-state={disabled ? 'idle' : state}
      data-disabled={disabled || undefined}
      aria-label={accessible}
      aria-disabled={disabled || running || undefined}
      aria-busy={running || undefined}
      aria-keyshortcuts={shortcut ? 'Control+Enter Meta+Enter' : undefined}
      onClick={() => run.current()}
      {...rest}
    >
      {caption !== undefined ? (
        <span className="lm-runkey__caption" aria-hidden="true">
          {caption}
        </span>
      ) : null}
      <span className="lm-runkey__cap" aria-hidden="true">
        {shown}
        <svg className="lm-runkey__ring" viewBox="0 0 54 54">
          <circle cx="27" cy="27" r="26" strokeDasharray="40 200" />
        </svg>
      </span>
    </button>
  );
  return disabledReason ? <Tooltip content={disabledReason}>{button}</Tooltip> : button;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
