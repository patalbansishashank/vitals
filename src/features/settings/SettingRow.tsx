import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface SettingRowProps {
  /** Engraved lowercase label on the left. */
  label: ReactNode;
  help?: ReactNode;
  /** Render prop receives the ids to wire aria-labelledby / aria-describedby. */
  children: (ids: { labelId: string; helpId: string | undefined }) => ReactNode;
}

/** A 52 px settings row: label (+ help) left, control right; rows are divided by hairlines. */
export function SettingRow({ label, help, children }: SettingRowProps) {
  const id = useId();
  const labelId = `${id}-l`;
  const helpId = help ? `${id}-h` : undefined;
  return (
    <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line py-2.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="grid min-w-0 flex-[1_1_7.5rem] gap-0.5">
        <span id={labelId} className="lm-eng" style={{ fontSize: 'var(--lm-text-sm)', lineHeight: 'var(--lm-text-sm--lh)' }}>
          {label}
        </span>
        {help ? (
          <span id={helpId} className="text-xs leading-[1.45] text-ink-2">
            {help}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">{children({ labelId, helpId })}</div>
    </div>
  );
}

/** "saved" engraved flash in a section header for 1 s after any change (settings-data.md §7). */
export function useSavedFlash(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const flash = () => {
    setOn(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOn(false), 1000);
  };
  return [on, flash];
}

export function SavedLabel({ on }: { on: boolean }) {
  return (
    <span className="lm-eng transition-opacity duration-fast" style={{ opacity: on ? 1 : 0 }} aria-live="polite">
      {on ? 'saved' : ''}
    </span>
  );
}
