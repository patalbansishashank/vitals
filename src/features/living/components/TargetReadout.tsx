/**
 * Targets as a mono readout (r071 AUDIT §1.2 Shared 5): the day rail on Today and Food, the row sheets, the Targets card.
 */
import { MonoMeta, cx } from '@/components';

/** A number run: digits with group spaces, decimals, clock colons and range dashes ("1 332", "09:00–20:00", "7.5"). */
const NUMBER = /(\d(?:[\d.,:–]|[\u0020\u00a0\u202f\u2060]+(?=\d))*)/;

/**
 * A target as mono meta: "1 332 kcal · 78 g protein" → "1 332 KCAL  78 G PROTEIN", the figure in ink and the unit and
 * words muted, the parts set apart by space (not dots: the line is a readout, not a list). One change here restyles every
 * row that shows a target. Text with no figure ("strength session") is a plain mono line. Uppercase is CSS: the DOM and
 * assistive technology keep the sentence-case words.
 */
export function TargetReadout({ text, className }: { text: string; className?: string }) {
  const parts = text.split(' · ').filter(Boolean);
  return (
    <MonoMeta className={cx('lv-rd', className)} data-text={text} size="sm">
      {parts.map((part, i) => (
        <span key={i} className="lv-rd__part">
          {part.split(NUMBER).map((t, j) => (t === '' ? null : j % 2 === 1 ? <span key={j} className="lv-rd__n">{t}</span> : <span key={j} className="lv-rd__u">{t}</span>))}
        </span>
      ))}
    </MonoMeta>
  );
}
