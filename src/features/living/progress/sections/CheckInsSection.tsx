/**
 * Progress › Check-ins (living-mode.md §8.2 item 7, §4.5): one line per weekly check-in, newest first — the date, the
 * trend's change that week (or "too few weigh-ins" when the check-in had too few to read one: never a made-up number)
 * and the verdict word when there was one (ahead · on track · behind · unclear), and the complete food days of the week
 * when the source counts them. The next check-in date is the card's fact. Quiet mode: a direction word in place of the
 * change.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { CardFoot, ChartTwin, Icon, Key, MonoMeta, ResponsivePanel, StatusMark } from '@/components';
import { Check, ChevronRight } from 'lucide-react';
import { TrendLane } from '@/features/charts/living/TrendLane';
import { topicHref } from '@/features/evidence/links';
import { ProgressCard } from '../components/ProgressCard';
import { useReveal } from '@/components/lib/reveal';
import './goalCheckins.css';
import type { LocalDate } from '@/living';
import type { ActivePlan } from '../../activePlan';
import { useLiving } from '../../data/source';
import { fmtDay } from '../../format';
import { PROGRESS_COPY as C } from '../copy';
import { checkInDates, firstCheckIn } from '../model';

/** The week's signed change as the source printed it ("trend −0.5 kg this week" → "−0.5 kg"); null when there was none. */
export function weekChange(trendText: string): { text: string; value: number } | null {
  const m = /([−+-])(\d+(?:\.\d+)?) (kg|lb)\b/.exec(trendText);
  if (!m) return null;
  const value = Number(m[2]) * (m[1] === '+' ? 1 : -1);
  return { text: `${m[1] === '-' ? '−' : m[1]}${m[2]} ${m[3]}`, value };
}

export function CheckInsSection({ plan, today, quiet }: { plan: ActivePlan; today: LocalDate; quiet: boolean }) {
  const dates = useMemo(() => checkInDates(plan, today), [plan, today]);
  const reports = useLiving((s) => dates.map((date) => ({ date, model: s.checkIn(date) })), [dates]);
  const next = reports[0]?.model?.nextDate ?? null;
  const caption = next ? C.nextCheckIn(fmtDay(next)) : C.firstCheckIn(fmtDay(firstCheckIn(plan)));

  const [barRef, pending] = useReveal<HTMLOListElement>();
  const [all, setAll] = useState(false);
  const [selected, setSelected] = useState<LocalDate | null>(null);
  const shown = all ? reports : reports.slice(0, 4);
  const changes = reports.map(({ model }) => model ? weekChange(model.trendText) : null);
  const extent = Math.max(0.1, ...changes.map((c) => c === null ? 0 : Math.abs(c.value)));
  const amount = (change: ReturnType<typeof weekChange>) => !change ? C.fewWeighIns : quiet ? C.directions[Math.abs(change.value) < 0.2 ? 'steady' : change.value < 0 ? 'down' : 'up'] : change.text;
  const verdict = (model: (typeof reports)[number]['model']) => model?.verdict ? model.verdict.certainty === 'unclear' ? 'unclear' : C.drift[model.verdict.state] : null;
  const report = reports.find((r) => r.date === selected)?.model;

  return (
    <ProgressCard id="checkins" title={C.faces.checkins} icon={Check} domain="plan" className="lv-prog-face"
      info={{
        title: 'Weekly check-ins',
        body: "Once a week Vitals compares your weight trend with the plan and may suggest a change. Each line shows that week's change in the trend and whether you're ahead, on track or behind. ‘Too few weigh-ins’ means the week didn't have enough to read a change.",
        source: { kind: 'estimate', words: 'The trend from your logged weigh-ins.' },
        range: 'Changes come from the trend estimate; a missing week stays unknown.',
        evidence: { to: topicHref('tracking-replanning'), label: 'Tracking and replanning' },
        twin: quiet ? undefined : <ChartTwin data={{ title: 'Weekly check-ins table', caption: 'Change in the weight trend and verdict by weekly check-in.', head: ['Date', 'Trend change', 'Verdict'], rows: reports.map(({ date, model }) => [fmtDay(date), amount(model ? weekChange(model.trendText) : null), verdict(model) ?? 'Unknown']), fileName: 'weekly-checkins.csv' }} />,
      }}
      foot={<CardFoot state={{ word: caption }} right={quiet ? undefined : `${reports.length} weeks`} />}
    >
      {shown.length === 0 ? <p className="lv-prog-state">{C.noCheckIns}</p> : <ol className="lv-weekly" ref={barRef} data-reveal={pending ? 'pending' : undefined}>
        {shown.map(({ date, model }, i) => {
          const change = model ? weekChange(model.trendText) : null;
          const word = verdict(model);
          const food = (model as { completeFoodDays?: { complete: number; days: number } } | null)?.completeFoodDays;
          return <li key={date}>
            <button className="lv-weekly__row" type="button" aria-haspopup="dialog" aria-label={`Check-in ${fmtDay(date)}`} onClick={() => setSelected(date)}>
              <MonoMeta>{fmtDay(date)}</MonoMeta>
              <span className="lv-weekly__bar" aria-hidden="true" data-direction={change && change.value > 0 ? 'up' : 'down'} data-current={i === 0 || undefined} style={{ '--change': `${quiet ? change ? 70 : 0 : change ? Math.abs(change.value) / extent * 100 : 0}%` } as CSSProperties}><i /></span>
              <span><MonoMeta>{amount(change)}</MonoMeta>{!quiet && food ? <MonoMeta>Complete food days {food.complete}/{food.days}</MonoMeta> : null}</span>
              {word ? <span className="lv-weekly__verdict"><StatusMark severity={model?.verdict?.state === 'behind' || word === 'unclear' ? 'info' : 'ok'} size={16} /><MonoMeta>{word}</MonoMeta></span> : null}
              <Icon icon={ChevronRight} size={16} />
            </button>
          </li>;
        })}
      </ol>}
      {!all && reports.length > 4 ? <Key size="sm" variant="text" onClick={() => setAll(true)}>See all</Key> : null}
      {selected ? <ResponsivePanel open title={`Check-in ${fmtDay(selected)}`} onClose={() => setSelected(null)}>
        {report ? <div className="lv-weekly__report">
          <MonoMeta>{amount(weekChange(report.trendText))}</MonoMeta>
          {verdict(report) ? <p><StatusMark severity={report.verdict?.state === 'behind' || verdict(report) === 'unclear' ? 'info' : 'ok'} size={16} /> {verdict(report)}</p> : null}
          {report.missingText ? <p>{quiet ? C.fewWeighIns : report.missingText}</p> : null}
          {report.trend ? <TrendLane data={report.trend} size="checkin" quiet={quiet} /> : null}
          <h3>That week</h3>
          <dl>{report.adherence.blocks.map((b) => <div key={b.type}><dt>{b.label}</dt><dd>{quiet ? b.mean === null ? 'Unknown' : b.mean >= 85 ? 'As planned' : b.mean >= 50 ? 'Partly' : 'Some recorded' : b.mean === null ? 'Unknown' : `${Math.round(b.mean)} %`}</dd></div>)}</dl>
        </div> : <p>{C.fewWeighIns}</p>}
      </ResponsivePanel> : null}
    </ProgressCard>
  );
}
