/**
 * Targets as an instrument readout (the day rail on Today and Food, the row sheets, the Targets card).
 */
import { cx } from '@/components';

/** A number run: digits with group spaces, decimals, clock colons and range dashes ("1 332", "09:00–20:00", "7.5"). */
const NUMBER = /(\d(?:[\d.,:–]|[ \u00a0\u202f\u2060]+(?=\d))*)/;

/**
 * A target as an instrument readout: "1 332 kcal · 78 g protein" → figures in tabular ink, units and words small in
 * ink-2, the parts set apart by space instead of dots. Text with no figure ("strength session") stays a plain line.
 */
export function TargetReadout({ text, className }: { text: string; className?: string }) {
  const parts = text.split(' · ').filter(Boolean);
  return (
    <span className={cx('lv-rd', className)} data-text={text}>
      {parts.map((part, i) => (
        <span key={i} className="lv-rd__part">
          {part.split(NUMBER).map((t, j) => (t === '' ? null : j % 2 === 1 ? <span key={j} className="lv-rd__n lm-num">{t}</span> : <span key={j} className="lv-rd__u">{t}</span>))}
        </span>
      ))}
    </span>
  );
}
