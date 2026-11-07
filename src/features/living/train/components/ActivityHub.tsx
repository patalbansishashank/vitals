/**
 * (0.6.3 S24/A7) Train's activity hub without a live plan: tracking never waits for a plan. Log an activity by hand,
 * record one through Gauge (on today, when a ring or this phone can record); what the ring and phone detected is counted
 * automatically (r070; the same activity sheet as Today). Plan matching and projections stay optional: a
 * quiet "Make a plan" key, nothing else asks for one. The recording banner itself is Today's (one banner slot).
 *
 * r068 L17: one row of keys, then the last seven days' activities as rows (tap one to open it), or one line when there
 * are none. No date strip: without a plan the days hold nothing to pick between.
 */
import { useState } from 'react';
import { Activity, ChevronRight, Circle } from 'lucide-react';
import { CardHead, CardFoot, GradientCard, HeroNumber, HighlightBars, MonoMeta, StatusDot, Icon, IconKey, Key, KeyLink, durationText } from '@/components';
import type { LocalDate } from '@/living';
import { addDays } from '@/living/dates';
import type { ReviewRow } from '@/living/activityCandidates';
import { useEnergyUnit } from '@/state/settingsStore';
import { useActivityData } from '../../activity/data';
import { ActivitySheet } from '../../activity/ActivitySheet';
import { RecordSheet } from '../../activity/RecordSheet';
import { useRecording } from '../../activity/RecordBanner';
import { recentTypesOfRows } from '../../activity/recordType';
import { reviewRowTimeText, rowFacts, rowName } from '../../activity/model';
import { fmtDay } from '../../format';
import { TRAIN_COPY, INFO } from '../copy';
import { infoSpec } from '../../components/info';
import '../train.css';

export interface ActivityHubProps {
  id?: string;
  date: LocalDate;
  today: LocalDate;
  quiet: boolean;
  /** Opens "Log an activity"; absent on a future day. */
  onLog?: () => void;
}

export function ActivityHub({ id, date, today, quiet, onLog }: ActivityHubProps) {
  const data = useActivityData();
  const review = data.useReview(addDays(date, -6), date);
  const rec = useRecording();
  const eu = useEnergyUnit();
  const [open, setOpen] = useState<'record' | null>(null);
  const [editing, setEditing] = useState<ReviewRow | null>(null);
  const canRecord = date === today && rec.available && !rec.rec;
  // the week's decided activities, newest first (a hand log the person removed is gone; a rejected recording is not shown)
  const recent = review.decided.filter((r) => r.status === 'approved' || r.status === 'edited').sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt));
  const dates = Array.from({ length: 7 }, (_, i) => addDays(date, i - 6));
  const minutes = dates.map((d) => recent.filter((r) => r.date === d).reduce((n, r) => n + r.minutes, 0));
  const total = minutes.reduce((n, m) => n + m, 0);
  return (
    // the page is titled Activities: the hub keeps the name for screen readers, and its card is the week's list
    <section className="lv-train-hub" id={id} aria-label={TRAIN_COPY.hub.title}>
      <div className="lv-train-hub__keys">
        {onLog ? (
          <Key variant="primary" arrow aria-haspopup="dialog" onClick={onLog}>
            {TRAIN_COPY.logActivity}
          </Key>
        ) : null}
        {canRecord ? (
          <IconKey icon={Circle} label="Record an activity" onClick={() => setOpen('record')} />
        ) : null}
        {canRecord ? <StatusDot tone="neutral" label="Ready to record" /> : null}
      </div>
      <GradientCard domain="steps" className="lv-train-hub__card" head={<CardHead icon={Activity} title={TRAIN_COPY.hub.recent} as="h2" info={infoSpec(INFO.hub)} />} foot={<CardFoot state={{ word: 'No plan running' }} link={{ to: '/plan', label: TRAIN_COPY.makePlan }} />}>
        <HeroNumber value={total} unit="min" size="num-l" label={quiet ? 'Activity this week' : `${total} active minutes in the last seven days`} quietWord={quiet ? 'This week' : undefined} />
        <MonoMeta>Last seven days</MonoMeta>
        <HighlightBars dates={dates} values={minutes} name="Active minutes" hue="steps" quiet={quiet} height={72} highlight={dates.indexOf(today)} />
        <KeyLink variant="text" to="/energy">Energy burned</KeyLink>
        {recent.length === 0 ? (
          <p className="lv-train-hub__none">{TRAIN_COPY.hub.none}</p>
        ) : (
          <ul className="lv-train-hub__list">
            {recent.map((r) => {
              const name = rowName(r);
              const when = `${fmtDay(r.date)} · ${reviewRowTimeText(r, quiet)}`;
              const facts = rowFacts(r, quiet, eu) || (quiet ? '' : durationText(r.minutes));
              return (
                <li key={r.id}>
                  <button type="button" className="lv-train-hub__row" aria-haspopup="dialog" onClick={() => setEditing(r)}>
                    <span className="lv-train-hub__what">
                      <span className="lv-train-hub__name">{name}</span>
                      <span className="lv-train-hub__facts lm-num">{[when, facts].filter(Boolean).join(' · ')}</span>
                    </span>
                    <Icon icon={ChevronRight} size={16} className="lv-train-hub__chev" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </GradientCard>
      <ActivitySheet
        row={editing}
        onClose={() => setEditing(null)}
        quiet={quiet}
        recent={[...new Set(review.decided.map((r) => r.exerciseId))]}
        planned={[]}
      />
      {open === 'record' ? <RecordSheet open onClose={() => setOpen(null)} recent={recentTypesOfRows(review.decided)} /> : null}
    </section>
  );
}
