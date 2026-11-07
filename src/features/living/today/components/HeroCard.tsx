import { useState, type ReactNode } from 'react';
import { CalendarDays, Check, MoonStar } from 'lucide-react';
import {
  CardFoot,
  CardHead,
  GradientCard,
  HeroNumber,
  Icon,
  Key,
  MonoMeta,
  StateStrip,
  toast,
  type StateSegment,
} from '@/components';
import { addDays } from '@/living/dates';
import { useLiving } from '../../data/source';
import { useLivingActions } from '../../data/actions';
import { useMealAnswer } from '../../components/MealSheet';
import { useLivingClock } from '../../clock';
import { fmtClock } from '../../format';
import { saveSleepTimes } from '../../sleep/entry';
import { DAY_STRIP_STATES } from '../../activity/model';
import { nextUp, todayRows } from '../model';
import type { TodayCardCtx } from '../cards/types';
import { PrescriptionRows, quietRowLabel, quietRowTarget } from './PrescriptionRows';

export interface HeroCardProps {
  ctx: TodayCardCtx;
  strip: { from: number; to: number; now: number | null; segments: StateSegment[] } | null;
  rail: Omit<Parameters<typeof PrescriptionRows>[0], 'rows' | 'date' | 'quiet' | 'readOnly'>;
  markKey?: ReactNode;
  howHard?: ReactNode;
  onResume(): void;
}

/** One slot for the day, including pauses and backfill. Recording belongs to the shell banner. */
export function HeroCard({ ctx, strip, rail, markKey, howHard, onResume }: HeroCardProps) {
  const { rows, nowH, quiet, date, state } = ctx;
  const actions = useLivingActions();
  const answerMeal = useMealAnswer(date);
  const clock = useLivingClock();
  const [openRowId, setOpenRow] = useState<string | null>(null);
  const next = nowH !== null && state === 'active' ? nextUp(rows, nowH) : null;
  const tomorrow = useLiving((s) => s.today(addDays(ctx.today, 1)), [ctx.today]);
  const tomorrowNext = tomorrow ? nextUp(todayRows(tomorrow), 0) : null;
  const answered = rows.filter((r) => r.status !== 'empty' || (r.glyph === 'weigh' && r.logged)).length;
  const safety = state === 'safetyPause';
  const past = state === 'past';
  const future = state === 'future';
  const paused = state === 'paused';
  const remaining = next?.at != null && nowH !== null ? Math.max(0, Math.round((next.at - nowH) * 60)) : null;
  const nextLabel = next ? quietRowLabel(next, quiet) : 'All done';
  const tick = async () => {
    if (!next) return;
    if (next.glyph === 'weigh' || (next.glyph === 'sleep' && !next.target)) return setOpenRow(next.id);
    const result =
      next.glyph === 'meal'
        ? await answerMeal({ slot: next.id.slice(5) }, 'asPlanned')
        : await actions.tick(date, next.item);
    toast(
      result.ok ? `${nextLabel}: as planned` : (result.message ?? 'Could not log this stop'),
      result.undo ? { action: { label: 'Undo', onClick: () => void result.undo?.() } } : {},
    );
  };
  const info = {
    title: 'Your day',
    body: 'The next unanswered stop in your plan. Tap its circle to mark it as planned, or its name to open the details. The strip shows your eating window, fast, training and sleep. Past days can still be logged; future days are a preview.',
    source: { kind: 'plan' as const },
    twin: strip ? (
      <table className="lv-hero-table">
        <caption>Planned day</caption>
        <thead>
          <tr>
            <th>Part</th>
            <th>From</th>
            <th>To</th>
          </tr>
        </thead>
        <tbody>
          {strip.segments.map((s, i) => (
            <tr key={i}>
              <td>{s.state === null ? 'Unplanned' : DAY_STRIP_STATES[s.state]}</td>
              <td>{fmtClock((s.from - strip.from) / 3600000)}</td>
              <td>{fmtClock((s.to - strip.from) / 3600000)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : undefined,
  };
  const title = safety
    ? 'Plan paused for safety'
    : paused
      ? 'Plan paused'
      : past || future
        ? 'Plan'
        : 'Today';
  const footWord = quiet
    ? answered === rows.length
      ? 'All done'
      : answered
        ? 'Some done'
        : 'Ready for your day'
    : `${answered} of ${rows.length} done`;
  return (
    <GradientCard
      as="section"
      size="hero"
      domain="plan"
      className="lv-day-hero"
      aria-label={past || future ? 'Plan' : title}
      head={<CardHead icon={CalendarDays} title={title} info={info} />}
      foot={
        <>
          <CardFoot
            state={{ word: safety ? 'Logging stays available' : footWord }}
            right={
              !safety && ctx.view?.prescription?.window
                ? `Eat ${fmtClock(ctx.view.prescription.window.startH)}–${fmtClock(ctx.view.prescription.window.endH)}`
                : undefined
            }
          >
            {markKey}
          </CardFoot>
          {howHard}
        </>
      }
    >
      <div className="lv-day-hero__layout">
        <div className="lv-day-hero__lead">
          {safety ? (
            <>
              <h2 className="lv-day-hero__word">Take care of yourself</h2>
              <p>
                You can still log meals, weight and how you feel. Review the reason for the pause and speak
                with your clinician before resuming.
              </p>
              <Key variant="text" onClick={onResume}>
                Resume…
              </Key>
            </>
          ) : paused ? (
            <>
              <HeroNumber size="num" value="Plan paused" label="Plan paused" />
              <MonoMeta>{ctx.plan?.pauses.find((p) => p.to === null)?.from}</MonoMeta>
              <Key variant="primary" onClick={onResume} arrow>
                Resume
              </Key>
            </>
          ) : past || future ? (
            <>
              <HeroNumber
                size="num"
                value={future ? 'Your day ahead' : 'Your day, logged'}
                label={future ? 'Your day ahead' : 'Your day, logged'}
              />
              <MonoMeta>{future ? 'Preview' : 'Backfill any stop'}</MonoMeta>
            </>
          ) : next ? (
            <>
              <MonoMeta>
                {remaining !== null && remaining > 0
                  ? `Next up · in ${Math.floor(remaining / 60) ? `${Math.floor(remaining / 60)} h ` : ''}${remaining % 60} min`
                  : 'Next up'}
              </MonoMeta>
              <div className="lv-day-hero__next">
                <button
                  type="button"
                  className="lv-day-hero__open"
                  onClick={() => setOpenRow(next.id)}
                  aria-label={`Details for next ${nextLabel}`}
                >
                  {next.glyph !== 'weigh' && next.at !== null ? (
                    <HeroNumber value={fmtClock(next.at)} size="time" label={fmtClock(next.at)} />
                  ) : null}
                  <span className="lv-day-hero__word">{nextLabel}</span>
                </button>
                <button
                  type="button"
                  className="lv-day-hero__tick"
                  onClick={() => void tick()}
                  aria-label={next.glyph === 'weigh' ? 'Log weight' : `Mark next ${nextLabel} as planned`}
                >
                  {next.glyph === 'weigh' ? 'Log' : <Icon icon={Check} size={24} />}
                </button>
              </div>
              <MonoMeta>{quiet ? quietRowTarget(next) : next.target}</MonoMeta>
            </>
          ) : (
            <>
              <HeroNumber size="num" value="All done" label="All done" />
              <MonoMeta>
                {tomorrowNext
                  ? `Tomorrow · ${tomorrowNext.at !== null ? fmtClock(tomorrowNext.at) : ''} ${quiet ? tomorrowNext.label.replace(/\s*·.*$/, '') : tomorrowNext.label}`
                  : 'Your day is logged'}
              </MonoMeta>
              {nowH !== null && nowH >= 20 ? (
                <Key
                  variant="primary"
                  icon={MoonStar}
                  onClick={() =>
                    void saveSleepTimes(addDays(ctx.today, 1), {
                      lightsOutAt: clock.now().toISOString(),
                    }).then((o) =>
                      toast(o.ok ? 'Going to sleep logged' : (o.message ?? 'Could not log bedtime')),
                    )
                  }
                >
                  Going to sleep
                </Key>
              ) : null}
            </>
          )}
          {strip && !safety ? (
            <StateStrip
              label="The planned day"
              from={strip.from}
              to={strip.to}
              now={strip.now}
              segments={strip.segments}
              stateLabels={[...DAY_STRIP_STATES]}
              stateHues={['food', 'energy', 'steps', 'sleep']}
              mode="category"
              ticks="day"
              labels
              twin={false}
              quiet={quiet}
            />
          ) : null}
        </div>
        <div className="lv-day-hero__rail">
          <PrescriptionRows
            {...rail}
            rows={rows}
            date={date}
            quiet={quiet || safety}
            readOnly={future}
            compact={!past && !future}
            openRowId={openRowId}
            onOpenRowHandled={() => setOpenRow(null)}
          />
        </div>
      </div>
    </GradientCard>
  );
}
