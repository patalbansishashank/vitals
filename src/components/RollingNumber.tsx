import { useState } from 'react';
import { cx } from './lib/cx';

/* ---------------------------------------------------------------------------
   RollingNumber — fixed-place readout: changed digits drop 6 px and fade in
   --------------------------------------------------------------------------- */

export function RollingNumber({ text, className }: { text: string; className?: string }) {
  const [state, setState] = useState({ prev: text, current: text, gen: 0 });
  if (state.current !== text) {
    // derive "previous" during render (React-sanctioned pattern, no effects)
    setState({ prev: state.current, current: text, gen: state.gen + 1 });
  }
  const prev = state.prev;
  const chars = Array.from(text);
  const prevChars = Array.from(prev);
  const offset = prevChars.length - chars.length; // align from the right (units digit stays put)
  return (
    <span className={cx('lm-roll', className)} aria-hidden="true">
      {chars.map((ch, i) => {
        const before = prevChars[i + offset];
        const rolled = state.gen > 0 && before !== ch && /\d/.test(ch);
        return (
          <span key={`${chars.length - i}-${ch}-${rolled ? state.gen : 0}`} className="lm-roll__d" data-rolled={rolled || undefined}>
            {ch}
          </span>
        );
      })}
    </span>
  );
}
