/**
 * The week (living-mode.md Train states, "Week view"): seven rows — day · session · minutes · status glyph; tap a row to
 * open that day. Status is a shape plus a word (done ● · partly ◐ · skipped ⊘ · not logged dashed ○ · planned ·).
 * Beside the day on desktop (`WeekView`, a card); on phones the list opens as a sheet
 * from the header ⋯ (`WeekList` inside it).
 */
import type { LocalDate } from '@/living';
import { CalendarDays } from 'lucide-react';
import { CardHead, GradientCard, HeroNumber, MonoMeta, HighlightBars, barsTwin, ChartTwin } from '@/components';
import { infoSpec } from '../../components/info';
import { TRAIN_COPY, INFO } from '../copy';
import type { WeekRow, WeekStatus } from '../session';

export function StatusGlyph({ status }: { status: WeekStatus }) {
  return (
    <span className="lv-train-status" data-status={status}>
      <span className="lv-train-status__mark" aria-hidden="true" />
      {/* a planned day needs no word (it is ahead); the glyph keeps its name for screen readers */}
      <span className={status === 'planned' ? 'lm-sr' : 'lv-train-status__word'}>{TRAIN_COPY.week.status[status]}</span>
    </span>
  );
}

export interface WeekListProps {
  /** "This week" / "Week of 5 Oct": the list's accessible name. */
  title: string;
  rows: readonly WeekRow[];
  selected: LocalDate;
  today: LocalDate;
  onPick: (date: LocalDate) => void;
}

export function WeekList({ title, rows, selected, today, onPick }: WeekListProps) {
  return (
    <ol className="lv-train-week" aria-label={title}>
      {rows.map((r) => (
        <li key={r.date}>
          <button
            type="button"
            className="lv-train-weekrow"
            data-today={r.date === today || undefined}
            aria-current={r.date === selected ? 'date' : undefined}
            onClick={() => onPick(r.date)}
          >
            <span className="lv-train-weekrow__day lm-num">{r.day}</span>
            <span className="lv-train-weekrow__what">
              {capFirst(r.outside ? TRAIN_COPY.week.outside : r.rest ? TRAIN_COPY.week.rest : r.sessions.map((s) => `${s.noun} · ${s.minutes} min`).join(' + '))}
            </span>
            <span className="lv-train-weekrow__status">
              {r.sessions.map((s) => (
                <StatusGlyph key={s.slotKey} status={s.status} />
              ))}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export interface WeekViewProps extends WeekListProps {
  id?: string;
  slim?: boolean;
  quiet?: boolean;
  onOpen?: () => void;
}

const capFirst = (s: string): string => (s ? `${s[0]!.toUpperCase()}${s.slice(1)}` : s);

/** (r069 U2) The selected day's week; another week opens from the date control's calendar (no ‹ › of its own). */
export function WeekView({ id, slim = false, quiet = false, onOpen, ...list }: WeekViewProps) {
  const sessions = list.rows.flatMap((r) => r.sessions);
  const done = sessions.filter((s) => s.status === 'done').length;
  const bars = { dates: list.rows.map((r) => r.date), values: list.rows.map((r) => r.sessions.reduce((n, s) => n + s.minutes, 0)), highlight: list.rows.findIndex((r) => r.date === list.today), name: 'Planned training minutes', hue: 'steps' as const, height: slim ? 36 : 56, quiet };
  return (
    <GradientCard domain="steps" glow="br" size={slim ? 'slim' : 'card'} id={id} className="lv-train-weekface"
      head={<CardHead icon={CalendarDays} title={list.title} as="h2" info={infoSpec(INFO.week, { twin: quiet ? undefined : <ChartTwin data={barsTwin(bars)} /> })} />}
      onOpen={slim ? onOpen : undefined} openLabel={list.title}>
      <div className="lv-train-weekface__summary"><HeroNumber value={done} unit={`/ ${sessions.length}`} size={slim ? 'time' : 'num'} label={quiet ? 'Sessions this week' : `${done} of ${sessions.length} sessions done`} quietWord={quiet ? done === sessions.length && done > 0 ? 'Done' : 'This week' : undefined} /><MonoMeta>Sessions done</MonoMeta></div>
      <HighlightBars {...bars} />
      {!slim ? <WeekList {...list} /> : null}
    </GradientCard>
  );
}
