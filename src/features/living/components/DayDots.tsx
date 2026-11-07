import { MonoMeta } from '@/components';
import { weekdaysText } from '../format';
import type { Weekday } from '@/living';
import './dayDots.css';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** The training week, Monday first. The letters and filled rings give every day a non-colour identity. */
export function DayDots({ days, label = 'Training days' }: { days: ReadonlyArray<Weekday>; label?: string }) {
  return (
    <div
      className="lv-daydots"
      role="img"
      aria-label={`${label}: ${days.length ? weekdaysText([...days]) : 'none'}`}
    >
      {DAYS.map((day, i) => (
        <MonoMeta
          key={day}
          className="lv-daydots__day"
          data-on={days.includes(i as Weekday) || undefined}
          aria-hidden="true"
        >
          <span>{day[0]}</span>
          <i />
        </MonoMeta>
      ))}
    </div>
  );
}
