/**
 * `/sleep[/:date]` (SPEC A.3.4 item 3, §V4.5): the night's sleep. (r068 S07) There is one sleep page, Ring › Sleep, with
 * its day strip; this address opens it on the same night (a link from Today or an older bookmark keeps working).
 */
import { Navigate, useParams } from 'react-router';
import { isLocalDate } from '@/living/dates';
import { calendarDate } from '@/features/ring/model';
import { ringPaths } from '@/features/ring/paths';
import { useNow } from '@/features/ring/useGauge';

export default function SleepPage() {
  const { date: param } = useParams();
  const today = calendarDate(useNow());
  const date = param !== undefined && isLocalDate(param) && param < today ? param : undefined;
  return <Navigate to={ringPaths.tab('sleep', date)} replace />;
}
