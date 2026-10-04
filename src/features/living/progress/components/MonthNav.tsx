import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconKey } from '@/components';
import { fmtMonth } from '../../format';
import { PROGRESS_COPY as C } from '../copy';
import { shiftMonth } from '../model';

/** ‹ month › within the plan's months ("YYYY-MM"). */
export function MonthNav({ month, first, last, onMonth }: { month: string; first: string; last: string; onMonth: (m: string) => void }) {
  return (
    <div className="lv-prog-month">
      <IconKey size="sm" icon={ChevronLeft} label={C.prevMonth} disabled={month <= first} onClick={() => onMonth(shiftMonth(month, -1))} />
      <span className="lv-prog-month__name" aria-live="polite">
        {fmtMonth(month)} {month.slice(0, 4)}
      </span>
      <IconKey size="sm" icon={ChevronRight} label={C.nextMonth} disabled={month >= last} onClick={() => onMonth(shiftMonth(month, 1))} />
    </div>
  );
}
