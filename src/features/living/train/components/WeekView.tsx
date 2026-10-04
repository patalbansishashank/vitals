/**
 * The week (living-mode.md Train states, "Week view"): seven rows — day · session · minutes · status glyph; tap a row to
 * open that day. Status is a shape plus a word (done ● · partly ◐ · skipped ⊘ · not logged dashed ○ · planned ·).
 */
import type { LocalDate } from '@/living';
import { Faceplate } from '@/components';
import { TRAIN_COPY } from '../copy';
import type { WeekRow, WeekStatus } from '../session';

export function StatusGlyph({ status }: { status: WeekStatus }) {
  return (
    <span className="lv-train-status" data-status={status}>
      <span className="lv-train-status__mark" aria-hidden="true" />
      <span className="lv-train-status__word">{TRAIN_COPY.week.status[status]}</span>
    </span>
  );
}

export interface WeekViewProps {
  /** "This week" / "Week of 5 Oct". */
  title: string;
  rows: readonly WeekRow[];
  selected: LocalDate;
  today: LocalDate;
  onPick: (date: LocalDate) => void;
  id?: string;
}

export function WeekView({ title, rows, selected, today, onPick, id }: WeekViewProps) {
  return (
    <Faceplate title={title} id={id} className="lv-train-weekface">
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
                {r.outside ? TRAIN_COPY.week.outside : r.rest ? TRAIN_COPY.week.rest : r.sessions.map((s) => `${s.noun} · ${s.minutes} min`).join(' + ')}
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
    </Faceplate>
  );
}
