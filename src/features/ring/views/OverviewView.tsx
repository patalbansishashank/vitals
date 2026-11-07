/**
 * Ring › Overview: the six cards (r071). One column on a phone in the order score, sleep, signals, activity, short videos,
 * ring; the two slim cards 2-up from 40rem of page width; from 56rem row-aligned pairs (Day score | Signals, Sleep | Activity,
 * Short videos | Ring) so the columns never end ragged: the DOM keeps the phone order and CSS grid areas place it.
 */
import { useRingDay } from '../day';
import { ActivityCard } from './ActivityCard';
import { DayScoreCard } from './DayScoreCard';
import { RingStatusCard } from './RingStatusCard';
import { ShortVideoCard } from './ShortVideoCard';
import { SignalsCard } from './SignalsCard';
import { SleepCard } from './SleepCard';
import './overview.css';

export function OverviewView({ date }: { date: string }) {
  const day = useRingDay(date);
  return (
    <div className="rgo-page">
      <div className="rgo-overview">
        <div className="rgo-cell" data-area="score">
          <DayScoreCard date={date} day={day} />
        </div>
        <div className="rgo-cell" data-area="sleep">
          <SleepCard date={date} day={day} />
        </div>
        <div className="rgo-cell" data-area="signals">
          <SignalsCard date={date} day={day} />
        </div>
        <div className="rgo-cell" data-area="activity">
          <ActivityCard date={date} day={day} />
        </div>
        <div className="rgo-cell" data-area="videos">
          <ShortVideoCard date={date} />
        </div>
        <div className="rgo-cell" data-area="device">
          <RingStatusCard />
        </div>
      </div>
    </div>
  );
}
