/**
 * `/sleep[/:date]` (SPEC A.3.4 item 3, §V4.5): the night's sleep. (r068 S07) There is one sleep page, Ring › Sleep, with
 * its day strip; this address opens it on the same night or period (a link from Today or an older bookmark keeps
 * working). The night is the path's `:date`, or the query the period control writes (`?date=`, `?period=month&date=`).
 */
import { Navigate, useParams, useSearchParams } from 'react-router';
import { isLocalDate } from '@/living/dates';
import type { LocalDate } from '@/living';
import { dayPeriod, periodFromSearch, periodSearch } from '@/features/living/period';
import { calendarDate } from '@/features/ring/model';
import { ringPaths } from '@/features/ring/paths';
import { useNow } from '@/features/ring/useGauge';

export default function SleepPage() {
  const { date: param } = useParams();
  const [search] = useSearchParams();
  const today = calendarDate(useNow()) as LocalDate;
  const period = param !== undefined && isLocalDate(param) && param < today ? dayPeriod(param) : periodFromSearch(search, today);
  return <Navigate to={`${ringPaths.tab('sleep')}${periodSearch(period, today)}`} replace />;
}
