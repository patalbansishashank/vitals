/**
 * Today from your ring (design/screens/ring-pages.md §5.4): a channel list, one 56 px row per signal the ring
 * measures, label left (engraved), readout right, a 16 px chevron; the whole row opens its Body signals tab at
 * period=day. Shown whenever a ring source exists, connected or not (data may arrive from another device through
 * sync). The rows and their words come from `todayRows` (./todayModel.ts); this file only gathers the inputs.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { Engraved, Faceplate, Icon, KeyLink } from '@/components';
import { useLivingClock, useToday } from '@/features/living/clock';
import { addDays } from '@/living/dates';
import { GoalMeter } from '@/features/signals/charts/GoalMeter';
import { useBaselines, useDays, useSeries, useSignalsPerson } from '@/features/signals/data';
import { signalsHref } from '@/features/signals/models';
import { useLiveHeartRate, type RingStatus } from './data';
import { RING_SECTIONS_COPY } from './copySections';
import { todayRows } from './todayModel';
import './ring-sections.css';

const C = RING_SECTIONS_COPY.today;

function subscribeVisibility(fn: () => void): () => void {
  document.addEventListener('visibilitychange', fn);
  return () => document.removeEventListener('visibilitychange', fn);
}

/** The page is on screen (live heart rate is read only then, SUITE_SPEC §15.2). */
function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== 'hidden',
    () => true,
  );
}

/** A live reading older than this is not "now" (the stream stopped, e.g. the ring came off): the last reading shows instead. */
export const LIVE_MAX_AGE_MS = 60_000;

const localMidnight = (d: string) => new Date(`${d}T00:00:00`).getTime();

export function TodayReadings({ ring }: { ring: RingStatus | null }) {
  const clock = useLivingClock();
  const today = useToday();
  const days = useDays(addDays(today, -2), today);
  const baselines = useBaselines();
  const person = useSignalsPerson();
  const dayStart = useMemo(() => localMidnight(today), [today]);
  const dayEnd = useMemo(() => localMidnight(addDays(today, 1)), [today]);
  const dates = useMemo(() => [today], [today]);
  const hr = useSeries('hr', dayStart, dayEnd, dates);
  const steps = useSeries('steps', dayStart, dayEnd, dates);
  const visible = usePageVisible();
  const linked = ring?.state === 'connected' || ring?.state === 'syncing';
  const streaming = useLiveHeartRate(ring, linked && visible, () => clock.now().getTime());

  const now = clock.now().getTime();
  const live = streaming && now - streaming.at <= LIVE_MAX_AGE_MS ? streaming : null;
  const lastHrPoint = hr.status === 'ready' ? hr.points.filter((p) => p.t <= now).at(-1) : undefined;
  const lastStep = steps.status === 'ready' ? steps.points.filter((p) => p.t <= now).at(-1) : undefined;
  // before the first read of the day with the ring connected, a missing row says "reading…"
  const reading = !!ring && (ring.state === 'syncing' || (ring.state === 'connected' && (!ring.lastSyncAt || Date.parse(ring.lastSyncAt) < dayStart)));

  const rows = todayRows({
    today,
    now,
    days,
    baselines,
    person,
    measures: ring?.caps?.measures,
    live,
    lastHr: lastHrPoint ? { bpm: lastHrPoint.v, at: lastHrPoint.t } : null,
    stepsNewestAt: lastStep ? lastStep.t : null,
    reading,
  });

  // no ring and nothing read from anywhere (a browser that can't reach rings): nothing to say "from your ring"
  if (!ring && rows.every((r) => r.missing !== null)) return null;

  return (
    <Faceplate
      title={C.title}
      className="rs-today"
      actions={
        <KeyLink to={signalsHref()} variant="quiet" size="sm">
          {C.allSignals}
        </KeyLink>
      }
    >
      <ul className="rs-channels">
        {rows.map((r) => (
          <li key={r.id}>
            <Link to={r.href} className="rs-row" data-row={r.id} data-meters={r.meters ? 'true' : undefined}>
              <Engraved className="rs-row__label">{r.label}</Engraved>
              {r.meters ? (
                <span className="rs-row__meters">
                  {r.meters.map((m) => (
                    <GoalMeter key={m.key} mini label={m.label} value={m.value} unit={m.unit} {...(m.goal !== undefined ? { goal: m.goal } : {})} />
                  ))}
                </span>
              ) : (
                <span className={r.missing ? 'rs-row__readout' : 'rs-row__readout lm-num'} data-missing={r.missing ? 'true' : undefined}>
                  {r.missing ?? r.readout}
                </span>
              )}
              {r.secondary ? <span className="rs-row__sub">{r.secondary}</span> : null}
              <Icon icon={ChevronRight} size={16} className="rs-row__chev" />
            </Link>
          </li>
        ))}
      </ul>
    </Faceplate>
  );
}
