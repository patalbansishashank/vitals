/**
 * `<BecauseChip>` (design/COMPONENTS.md §14.6): "because your LDL was 192 mg/dL on 14 Sep 2026" on a ladder rung, a
 * Food recipe card's fit line, the marker banner or a Coach message. Achromatic: a 12 px lab-tube outline and the
 * words; the marker state is in the words, never a colour. Short form under 280 px ("because LDL 192 · 14 Sep");
 * `form="container"` leaves the choice to CSS: inside a `lm-because-host` container narrower than 480 px (the intake
 * receipt on a phone) the short form shows, so the words never end in "…".
 * Click → Popover: the rule in words, its evidence grade, "retest due …", and the links Why / Edit value.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router';
import { TestTube } from 'lucide-react';
import { GradeBadge } from '@/components/GradeBadge';
import { Icon } from '@/components/icons/Icon';
import { Popover } from '@/components/Popover';
import { becauseText, formatMarkerDate, monthsBetween, type DateStyle } from '../because';
import type { MarkerNote } from '../types';
import { markersChapterHref, markersTopicHref } from './links';
import './markers.css';

/** Below this width the chip uses its short form. */
export const SHORT_BELOW_PX = 280;

export interface BecauseChipProps {
  note: MarkerNote;
  /**
   * 'auto' (default) picks the short form when the parent is narrower than 280 px; 'container' renders both and lets
   * the nearest `lm-because-host` container query pick (markers.css).
   */
  form?: 'full' | 'short' | 'auto' | 'container';
  /** Person's date style (Settings › date style). */
  dateStyle?: DateStyle;
  /** The person's day: older than 12 months adds "· old result". */
  today?: string;
  className?: string;
}

function useNarrow(ref: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!enabled || !parent || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const w = parent.getBoundingClientRect().width;
      setNarrow(w > 0 && w < SHORT_BELOW_PX);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [ref, enabled]);
  return enabled && narrow;
}

export function BecauseChip({ note, form = 'auto', dateStyle = 'day-month', today, className }: BecauseChipProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const narrow = useNarrow(anchorRef, form === 'auto');
  const short = form === 'short' || narrow;
  const full = becauseText(note, { style: dateStyle, ...(today ? { today } : {}) });
  const shortText = becauseText(note, { style: dateStyle, short: true, ...(today ? { today } : {}) });
  const old = !!today && monthsBetween(note.because.date, today) >= 12;
  const words = (text: string) => {
    const [main, suffix] = old ? [text.replace(/ · old result$/, ''), ' · old result'] : [text, ''];
    return (
      <>
        {main}
        {suffix ? <span className="lm-because__old">{suffix}</span> : null}
      </>
    );
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={['lm-chip', 'lm-because', className].filter(Boolean).join(' ')}
        data-form={form === 'container' ? 'container' : short ? 'short' : 'full'}
        aria-label={full}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={short || form === 'container' ? full : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon icon={TestTube} size={12} />
        {form === 'container' ? (
          <>
            <span className="lm-chip__text lm-because__full">{words(full)}</span>
            <span className="lm-chip__text lm-because__short">{words(shortText)}</span>
          </>
        ) : (
          <span className="lm-chip__text">{words(short ? shortText : full)}</span>
        )}
      </button>
      <BecausePopover note={note} open={open} onOpenChange={setOpen} anchorRef={anchorRef} dateStyle={dateStyle} sentence={full} />
    </>
  );
}

interface PopoverBodyProps {
  note: MarkerNote;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  anchorRef: RefObject<HTMLButtonElement | null>;
  dateStyle: DateStyle;
  sentence: string;
}

function BecausePopover({ note, open, onOpenChange, anchorRef, dateStyle, sentence }: PopoverBodyProps) {
  // focus returns to the chip when the popover closes by a link or outside press as well as Escape
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open && document.activeElement === document.body) anchorRef.current?.focus();
    wasOpen.current = open;
  }, [open, anchorRef]);
  return (
    <Popover open={open} onOpenChange={onOpenChange} anchorRef={anchorRef} label={sentence} padding="roomy" className="lm-because-pop">
      <p className="lm-because-pop__rule">{note.text}</p>
      <p className="lm-because-pop__meta">
        <GradeBadge grade={note.grade} size="sm" />
        {note.retestDue ? <span>retest due {formatMarkerDate(note.retestDue, dateStyle)}</span> : null}
      </p>
      <p className="lm-because-pop__links">
        <Link to={markersTopicHref(note.markerId)} onClick={() => onOpenChange(false)}>
          Why
        </Link>
        <Link to={markersChapterHref(note.markerId)} onClick={() => onOpenChange(false)}>
          Edit value
        </Link>
      </p>
    </Popover>
  );
}

export interface BecauseChipsProps extends Omit<BecauseChipProps, 'note'> {
  notes: readonly MarkerNote[];
  /** Chips shown before "+n more" (default 2). */
  max?: number;
}

/** Up to two chips per row, then "+1 more" (COMPONENTS §14.6 placement rule). One chip per marker reading. */
export function BecauseChips({ notes, max = 2, ...rest }: BecauseChipsProps) {
  const [all, setAll] = useState(false);
  const uniq = dedupeByReading(notes);
  if (uniq.length === 0) return null;
  const shown = all ? uniq : uniq.slice(0, max);
  const more = uniq.length - shown.length;
  return (
    <span className="lm-because-row">
      {shown.map((n) => (
        <BecauseChip key={`${n.rule}:${n.because.markerId}`} note={n} {...rest} />
      ))}
      {more > 0 ? (
        <button type="button" className="lm-chip lm-because-more" onClick={() => setAll(true)}>
          +{more} more
        </button>
      ) : null}
    </span>
  );
}

/** Notes citing the same reading show one chip (the most severe first). */
export function dedupeByReading(notes: readonly MarkerNote[]): MarkerNote[] {
  const rank = { danger: 0, caution: 1, info: 2 } as const;
  const sorted = [...notes].sort((a, b) => rank[a.severity] - rank[b.severity]);
  const seen = new Set<string>();
  const out: MarkerNote[] = [];
  for (const n of sorted) {
    const k = `${n.because.markerId}@${n.because.date}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}
