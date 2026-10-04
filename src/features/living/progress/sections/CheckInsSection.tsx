/**
 * Progress › Check-ins (living-mode.md §8.2 item 7, §4.5): weekly reports, newest first — the verdict (or, when there
 * were too few weigh-ins, the text that replaces it: never a made-up verdict), the trend, adherence, what changed
 * (versions adopted that day) and the next check-in date.
 */
import { useMemo } from 'react';
import { Faceplate, Rule, StatusMark } from '@/components';
import type { LocalDate } from '@/living';
import type { ActivePlan } from '../../activePlan';
import { useLiving } from '../../data/source';
import { fmtDateRange, fmtDay, quietWord } from '../../format';
import { PROGRESS_COPY as C } from '../copy';
import { checkInDates, firstCheckIn } from '../model';

const MARK = { ahead: 'ok', onTrack: 'ok', behind: 'info' } as const;

export function CheckInsSection({ plan, today, quiet }: { plan: ActivePlan; today: LocalDate; quiet: boolean }) {
  const dates = useMemo(() => checkInDates(plan, today), [plan, today]);
  const reports = useLiving((s) => dates.map((date) => ({ date, model: s.checkIn(date) })), [dates]);
  const versions = useLiving((s) => s.versions(), []);

  return (
    <Faceplate id="checkins" title={C.faces.checkins} className="lv-prog-face">
      {reports.length === 0 ? <p className="lv-prog-state">{C.firstCheckIn(fmtDay(firstCheckIn(plan)))}</p> : null}
      {reports.map(({ date, model }, i) => {
        const changed = versions.filter((v) => v.date === date && v.status !== 'proposed' && v.status !== 'rejected');
        return (
          <div key={date}>
            {i > 0 ? <Rule /> : null}
            <article className="lv-prog-checkin" aria-labelledby={`checkin-${date}`}>
              <h3 id={`checkin-${date}`} className="lv-prog-checkin__title">
                {C.checkInTitle(fmtDay(date))}
              </h3>
              {model?.verdict ? (
                <>
                  <p className="lv-prog-goal__state">
                    <StatusMark severity={MARK[model.verdict.state]} size={16} />
                    <span>{C.drift[model.verdict.state]}</span>
                  </p>
                  {model.verdict.goalDate ? (
                    <p className="lv-prog-goal__date">
                      {C.goalDate(fmtDateRange(model.verdict.goalDate[0], model.verdict.goalDate[1]))}
                      {model.verdict.shiftText ? `, ${model.verdict.shiftText}` : ''}
                    </p>
                  ) : null}
                  {model.verdict.cause ? <p className="lv-prog-goal__cause">{model.verdict.cause}</p> : null}
                </>
              ) : model?.missingText ? (
                <p className="lv-prog-goal__cause">{model.missingText}</p>
              ) : null}
              {model ? (
                <ul className="lv-prog-list">
                  <li>{model.trendText}</li>
                  <li>{C.checkInAdherence(quiet ? quietWord(model.adherence.a7) : model.adherence.a7 === null ? quietWord(null) : String(Math.round(model.adherence.a7)))}</li>
                  {changed.map((v) => (
                    <li key={v.version}>{C.whatChanged(v.version, v.summary)}</li>
                  ))}
                  {i === 0 ? <li>{C.nextCheckIn(fmtDay(model.nextDate))}</li> : null}
                </ul>
              ) : null}
            </article>
          </div>
        );
      })}
    </Faceplate>
  );
}
