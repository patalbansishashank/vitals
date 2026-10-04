/**
 * `<MarkerBanner>` (SUITE_SPEC §13.5.7, plan-ladder v2): above the ladder cards, the active blood-marker notes with
 * their "because …" chip; the sentence leaves the reading to the chip (Q6-14). Clinician notes first, then cautions, then information. Nothing here removes anything from
 * the plan: caps and warnings are explained, the person keeps every choice.
 */
import { Link } from 'react-router';
import { StatusMark } from '@/components/Notice';
import { withoutBecause, type DateStyle } from '../because';
import type { MarkerNote } from '../types';
import { BecauseChip } from './BecauseChip';
import { markersChapterHref, markersTopicHref } from './links';
import './markers.css';

const RANK = { danger: 0, caution: 1, info: 2 } as const;
const SPOKEN = { danger: 'See a clinician', caution: 'Caution', info: 'Note' } as const;

export interface MarkerBannerProps {
  notes: readonly MarkerNote[];
  dateStyle?: DateStyle;
  today?: string;
  /** Notes listed before "Show all n" (default 4). */
  max?: number;
  className?: string;
}

export const MARKER_BANNER_COPY = {
  title: 'From your blood test',
  lead: 'These results shape the plans below. Nothing is banned outright: a limit only stops the plan from adding more.',
  why: 'How results change the plan',
  edit: 'Re-enter values',
  showAll: (n: number) => `Show all ${n}`,
} as const;

export function sortNotes(notes: readonly MarkerNote[]): MarkerNote[] {
  return [...notes].sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.because.label.localeCompare(b.because.label));
}

export function MarkerBanner({ notes, dateStyle = 'day-month', today, max = 4, className }: MarkerBannerProps) {
  if (notes.length === 0) return null;
  const sorted = sortNotes(notes);
  return (
    <section className={['lm-marker-banner', className].filter(Boolean).join(' ')} aria-label={MARKER_BANNER_COPY.title}>
      <header className="lm-marker-banner__head">
        <h3 className="lm-marker-banner__title">{MARKER_BANNER_COPY.title}</h3>
        <p className="lm-marker-banner__lead">{MARKER_BANNER_COPY.lead}</p>
      </header>
      <NoteList notes={sorted} max={max} dateStyle={dateStyle} today={today} />
      <p className="lm-marker-banner__links">
        <Link to={markersTopicHref()}>{MARKER_BANNER_COPY.why}</Link>
        <Link to={markersChapterHref()}>{MARKER_BANNER_COPY.edit}</Link>
      </p>
    </section>
  );
}

function NoteList({ notes, max, dateStyle, today }: { notes: MarkerNote[]; max: number; dateStyle: DateStyle; today: string | undefined }) {
  // a stateless "show all" via <details>: no hidden state to sync, keyboard-accessible by default
  const head = notes.slice(0, max);
  const rest = notes.slice(max);
  const item = (n: MarkerNote) => (
    <li key={`${n.rule}:${n.markerId}`} className="lm-marker-banner__item" data-severity={n.severity}>
      <StatusMark severity={n.severity} size={16} label={SPOKEN[n.severity]} />
      <span className="lm-marker-banner__text">
        {withoutBecause(n.text)} <BecauseChip note={n} dateStyle={dateStyle} {...(today ? { today } : {})} />
      </span>
    </li>
  );
  return (
    <>
      <ul className="lm-marker-banner__list">{head.map(item)}</ul>
      {rest.length > 0 ? (
        <details className="lm-marker-banner__more">
          <summary>{MARKER_BANNER_COPY.showAll(notes.length)}</summary>
          <ul className="lm-marker-banner__list">{rest.map(item)}</ul>
        </details>
      ) : null}
    </>
  );
}
