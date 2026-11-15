/**
 * Activity › Movement (`/activity`): the steps of a day against its goal, the steps history and the activities that
 * count, from the ring and the phone. One day (`?date=`), or a week, month, year or custom range (`?period=…`) in the
 * shared date control, which the address keeps across the Activity tabs. `/activity/:date` opens that day (the path
 * form Train uses), and the old `/ring/activity` address lands here with its query. The readings are the person's
 * server's, so the header says how fresh they are and its ⋯ refreshes them, as on Ring; without a server or ring data
 * the same one empty state says what to do. Works with or without a plan.
 */
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { TopBar } from '@/app/shell';
import { Page } from '@/components';
import type { LocalDate } from '@/living';
import { isLocalDate } from '@/living/dates';
import { TodayEnergyFeed, useRingRefresh, useRingSynced } from '@/features/ring/bar';
import { RingGate } from '@/features/ring/components/parts';
import { useRingDays } from '@/features/ring/marks';
import { ActivityPeriodView } from '@/features/ring/views/ActivityPeriodView';
import { ActivityView } from '@/features/ring/views/ActivityView';
import { RingStatusCapsule } from '@/features/ring/views/RingStatusCard';
import { useQuietMode } from '@/state/settingsStore';
import { DateControl } from '../components/DateControl';
import { livingPaths, MOVEMENT_PATH } from '../paths';
import { ALL_PERIODS, periodFromSearch, periodSearch, type Period } from '../period';
import { ACTIVITY_COPY, ActivityTabs, activityDocumentTitle, useMovementToday } from './ActivityTabs';
import '../living.css';
import '@/features/ring/ring.css';

export default function MovementPage() {
  const { date: param } = useParams();
  const [search] = useSearchParams();
  // the ring's readings are filed by calendar day, so this page's today is the calendar's (as on Ring)
  const today = useMovementToday();
  if (param !== undefined) return <Navigate to={livingPaths.movement(isLocalDate(param) && param < today ? param : undefined)} replace />;
  return <MovementScreen period={periodFromSearch(search, today, ALL_PERIODS, today)} today={today} />;
}

function MovementScreen({ period, today }: { period: Period; today: LocalDate }) {
  const navigate = useNavigate();
  const refresh = useRingRefresh();
  const lastSynced = useRingSynced();
  const quiet = useQuietMode().on;
  // a range of one day is a day: the same cards as the Day view
  const date = period.from === period.to && (period.kind === 'day' || period.kind === 'range') ? period.from : null;
  return (
    <>
      <TopBar
        title={ACTIVITY_COPY.title}
        documentTitle={activityDocumentTitle('movement')}
        subtitle={(refresh.words ?? lastSynced) || undefined}
        tabs={<ActivityTabs period={period} today={today} />}
        menu={refresh.menu}
        status={<RingStatusCapsule />}
      />
      <Page stack className="rg-page">
        {/* today's energy run gives the Movement card its active-energy goal; quiet mode shows no energy figures */}
        {quiet ? null : <TodayEnergyFeed today={today} />}
        <RingGate>
          <DateControl
            value={period}
            onChange={(p) => navigate(`${MOVEMENT_PATH}${periodSearch(p, today)}`, { replace: true })}
            today={today}
            max={today}
            periods={ALL_PERIODS}
            useMarks={useRingDays}
          />
          {date ? <ActivityView date={date} today={today} /> : <ActivityPeriodView period={period} today={today} />}
        </RingGate>
      </Page>
    </>
  );
}
