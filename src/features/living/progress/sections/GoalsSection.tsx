/**
 * Progress › Goals (living-mode.md §8.2 item 2; IA §4.11): one drift card per ranked goal, one action each.
 * "See easier options" opens Today, where the proposal sits; "Re-plan the rest" starts the re-plan job, which leaves a
 * proposal on Today. The plan keeps its lead card while the trend forms.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { CardFoot, ChartTwin, DottedTrack, HeroNumber, Icon, Key, MonoMeta, ResponsivePanel, formatNumber, formatRange, formatSigned, toast } from '@/components';
import { Check, ChevronRight, CircleHelp, Target } from 'lucide-react';
import { topicHref } from '@/features/evidence/links';
import { daysBetween } from '@/living/dates';
import type { LocalDate } from '@/living';
import type { ActivePlan } from '../../activePlan';
import { useLivingActions } from '../../data/actions';
import { useLiving } from '../../data/source';
import type { MonitoredGoalRow } from '../../data/types';
import { fmtDateRange, fmtDay } from '../../format';
import { livingPaths } from '../../paths';
import { DriftCorrection, DriftGoalCard } from '../components/DriftGoalCard';
import { ProgressCard } from '../components/ProgressCard';
import { goalProgress, readTrend, signedInterval } from '../model';
import './goalCheckins.css';
import { PROGRESS_COPY as C } from '../copy';

export function GoalsSection({ plan, today, quiet: quietOverride }: { plan: ActivePlan; today: LocalDate; quiet?: boolean }) {
  const cards = useLiving((s) => s.driftCards(), []);
  const monitored = useLiving((s) => s.monitoredGoals(), []);
  const sourceQuiet = useLiving((s) => s.today(today)?.quietMode ?? false, [today]);
  const quiet = quietOverride ?? sourceQuiet;
  const trend = useLiving((s) => s.trend(plan.startDate, today), [plan.startDate, today]);
  const reading = readTrend(trend, today);
  const goal = trend?.goal?.value ?? null;
  const progress = goalProgress(reading, goal);
  const weightTrack = goal !== null || plan.doc?.request.goals.some((g) => g.metric === 'scaleWeight') === true;
  const awaitingGoals = !trend && !cards.length && !monitored.length;
  const forming = (weightTrack || awaitingGoals) && (reading.weighDays < 7 || (reading.gapDays !== null && reading.gapDays >= 14));
  const ready = !forming && progress !== null;
  const primary = cards[0];
  const unit = trend?.unit ?? 'kg';
  const fraction = ready ? progress.done / progress.total : 0;
  const changeRange = ready && reading.sd !== null && reading.sd > 0 ? signedInterval(progress.change, reading.sd).sort((a, b) => a - b) as [number, number] : null;
  const distanceRange = changeRange && progress ? changeRange.map((v) => Math.max(0, Math.min(progress.total, v * Math.sign(progress.target)))).sort((a, b) => a - b) as [number, number] : undefined;
  const dateRange = primary?.goalDate.range;
  const shift = primary?.goalDate.shiftDays;
  const totalDays = Math.max(1, daysBetween(plan.startDate, plan.plannedEndDate));
  const todayDay = Math.max(0, daysBetween(plan.startDate, today));
  const goalDays = dateRange ? dateRange.map((d) => Math.max(0, daysBetween(plan.startDate, d))) as [number, number] : undefined;
  const endDay = Math.max(totalDays, goalDays?.[1] ?? 0);
  const ghostDay = goalDays && shift !== null && shift !== undefined ? (goalDays[0] + goalDays[1]) / 2 - shift : undefined;
  const state = primary ? primary.certainty === 'unclear' ? 'unclear' : C.drift[primary.state] : forming ? 'Trend forming' : 'Observed';
  const actions = useLivingActions();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const onAction = async (action: 'easeOptions' | 'replan') => {
    if (action === 'easeOptions') {
      navigate(livingPaths.today());
      return;
    }
    setBusy(true);
    const r = await actions.replanRest();
    setBusy(false);
    if (!r.ok) {
      toast(r.message ?? C.failed);
      return;
    }
    toast(C.replanning(Math.max(0, daysBetween(today, plan.plannedEndDate))));
    navigate(livingPaths.today());
  };

  const amount = ready ? formatSigned(progress.change, 1) : null;
  const word = primary && primary.metric !== 'scaleWeight' && !ready ? state : forming ? 'Trend forming' : ready ? C.quietWay(fraction) : state;
  const shifted = shift !== null && shift !== undefined && Math.abs(shift) >= 3;
  return (
    <ProgressCard
      id="goals" title="Goal" icon={Target} domain="plan" size="hero" className="lv-prog-face lv-goalhero"
      info={{
        title: 'How goals are checked',
        body: "Each goal is compared with where your plan expected you to be by now, using only what you've logged. Ahead, on track and behind describe that gap; unclear means there's too little data. The goal date is a range that shifts as your trend does. It is an estimate, not a promise.",
        source: { kind: 'estimate', words: 'Your weigh-ins against the plan’s forecast.' },
        range: quiet ? 'Goal dates and trend ranges stay hidden in quiet mode.' : 'The trend range comes from the filter. The goal-date range is an estimate, not a promise.',
        evidence: { to: topicHref('tracking-replanning'), label: 'Tracking and replanning' },
        explain: cards.map((card) => <div key={`${card.goal}:${card.metric}`}><DriftCorrection card={card} quiet={quiet} /></div>),
        twin: quiet ? undefined : <ChartTwin data={{ title: 'Goal table', caption: 'Start, current trend and goal; the trend interval is a conditional estimate range.', head: ['Measure', 'Value'], rows: [
          ['Start', reading.first === null ? 'Unknown' : `${formatNumber(reading.first, 1)} ${unit}`],
          ['Trend now', ready && reading.now !== null ? `${formatNumber(reading.now, 1)} ${unit}` : 'Trend forming'],
          ['Change range', changeRange ? `${formatRange(changeRange[0], changeRange[1], 1)} ${unit}` : 'Unknown'],
          ['Goal', goal === null ? primary?.label ?? 'Plan goal' : `${formatNumber(goal, 1)} ${unit}`],
          ['Goal date', dateRange ? fmtDateRange(dateRange[0], dateRange[1]) : 'Unknown'],
        ], fileName: 'goal.csv', rowNoun: ['measure', 'measures'] }} />,
      }}
      foot={<CardFoot state={{ word: state, icon: primary?.state === 'behind' || primary?.certainty === 'unclear' ? CircleHelp : Check }}
        right={quiet ? undefined : dateRange ? `Goal date ${fmtDateRange(dateRange[0], dateRange[1])}${shifted ? ` · ${shift! > 0 ? '+' : '−'}${Math.abs(shift!)} d` : ''}` : forming ? C.trendForming(reading.weighDays) : undefined} />}
    >
      <div className="lv-goalhero__lead">
        <div>
          <HeroNumber size="hero" value={ready ? progress.change : (weightTrack ? null : state)} format={(v) => formatSigned(v, 1)} unit={ready ? unit : undefined}
            range={!quiet && changeRange ? `Range ${formatRange(changeRange[0], changeRange[1], 1)} ${unit}` : undefined}
            quietWord={quiet ? word : undefined} label={quiet ? word : ready ? `${amount} ${unit} since the start${changeRange ? `, range ${formatRange(changeRange[0], changeRange[1], 1)} ${unit}` : ''}` : forming ? 'Trend forming' : state} />
          <MonoMeta>{quiet ? 'Start to goal' : ready ? `Of ${formatSigned(progress.target, 1)} ${unit}` : primary?.label ?? 'Start to goal'}</MonoMeta>
        </div>
        {primary && primary.action !== 'keepGoing' ? <Key arrow variant="action" loading={busy} onClick={() => void onAction(primary.action === 'replan' ? 'replan' : 'easeOptions')}>{primary.action === 'replan' ? C.replanRest : C.seeEasier}</Key> : null}
      </div>
      {/* DottedTrack calls bands “likely”; this conditional trend interval is named explicitly outside the picture. */}
      <div aria-hidden="true">
        {weightTrack ? <DottedTrack label="Start to goal" value={ready ? progress.done : null} goal={progress?.total ?? 1}
          valueText={ready ? `${amount} ${unit}` : 'Trend forming'} goalText={progress ? `${formatSigned(progress.target, 1)} ${unit}` : 'Goal'}
          band={ready ? distanceRange : undefined} thumb={ready && !distanceRange} quiet quietWord={word}
          endLabels={quiet ? ['Start', 'Goal'] : [reading.first !== null ? `${formatNumber(reading.first, 1)} ${unit}` : 'Start', goal !== null ? `${formatNumber(goal, 1)} ${unit}` : 'Goal']} />
        : <DottedTrack label="Plan time" thumb={!!primary && primary.metric !== 'scaleWeight'} value={primary ? todayDay : null} goal={endDay} valueText={quiet ? 'Plan underway' : `Day ${todayDay + 1}`} goalText="Goal date" band={goalDays} ghost={ghostDay} quiet quietWord="Plan underway" endLabels={quiet ? ['Start', 'Goal'] : [fmtDay(plan.startDate), dateRange ? fmtDateRange(dateRange[0], dateRange[1]) : fmtDay(plan.plannedEndDate)]} />}
      </div>
      {cards.slice(1).map((card) => <div className="lv-goalhero__additional" key={`${card.goal}:${card.metric}`}><DriftGoalCard card={card} quiet={quiet} showCorrection={false} busy={busy} onAction={(a) => void onAction(a)} /></div>)}
      {monitored.map((row) => <div className="lv-goalhero__additional" key={`observed:${row.goal}:${row.metric}`}><ObservedGoal row={row} quiet={quiet} /></div>)}
    </ProgressCard>
  );
}

function ObservedGoal({ row, quiet }: { row: MonitoredGoalRow; quiet: boolean }) {
  const [details, setDetails] = useState(false);
  const decimals = row.unit === 'mmHg' ? 0 : 1;
  const bp = row.bp?.latest;
  const value =
    bp?.sbp !== null && bp?.sbp !== undefined && bp.dbp !== null
      ? `${formatNumber(bp.sbp, 0)}/${formatNumber(bp.dbp, 0)}`
      : row.latest
        ? formatNumber(row.latest.value, decimals)
        : null;
  return (
    <article className="lv-prog-goal" aria-label={row.label}>
      <button type="button" className="lv-goalhero__observed" aria-haspopup="dialog" aria-label={`${row.label} details`} onClick={() => setDetails(true)}>
        <span><span className="lv-prog-goal__title">{row.label}</span><MonoMeta>{quiet ? (value ? 'Observed' : 'Unknown') : value ? `${value} ${row.unit}` : 'Unknown'}</MonoMeta></span>
        <span>{row.latest ? <MonoMeta>{fmtDay(row.latest.date)}</MonoMeta> : null}<Icon icon={ChevronRight} size={18} /></span>
      </button>
      {details ? (
        <ResponsivePanel open title={row.label} onClose={() => setDetails(false)}>
          <dl>
            <div>
              <dt>Status</dt>
              <dd>{row.status === 'observed' ? 'Observed only' : 'Unknown'}</dd>
            </div>
            {!quiet ? <div><dt>Coverage</dt><dd>{row.bp ? `${row.bp.episodes} episodes` : `${row.readings} readings`} · {row.days} days</dd></div> : null}
            {!quiet && (row.bp?.change || row.change !== null) ? <div><dt>Change</dt><dd>{row.bp?.change?.sbp !== null && row.bp?.change?.sbp !== undefined && row.bp.change.dbp !== null ? `${formatSigned(row.bp.change.sbp, 0)}/${formatSigned(row.bp.change.dbp, 0)} ${row.unit}` : row.change !== null ? `${formatSigned(row.change, decimals)} ${row.unit}` : 'Unknown'}</dd></div> : null}
            {!quiet && row.first ? (
              <div>
                <dt>First</dt>
                <dd>
                  {row.bp?.first?.sbp !== null &&
                  row.bp?.first?.sbp !== undefined &&
                  row.bp.first.dbp !== null
                    ? `${formatNumber(row.bp.first.sbp, 0)}/${formatNumber(row.bp.first.dbp, 0)}`
                    : formatNumber(row.first.value, decimals)}{' '}
                  {row.unit} · {fmtDay(row.first.date)}
                </dd>
              </div>
            ) : null}
            {!quiet && row.latest ? (
              <div>
                <dt>Latest</dt>
                <dd>
                  {value} {row.unit} · {fmtDay(row.latest.date)}
                </dd>
              </div>
            ) : null}
            {row.reasonCode ? (
              <div>
                <dt>Comparison</dt>
                <dd>
                  {row.reasonCode === 'incompatibleOperators' || row.reasonCode === 'incompatibleSpecimenOperator'
                    ? 'Different measurement methods'
                    : row.reasonCode === 'occurrenceOrderUnknown'
                      ? 'Observation order unknown'
                      : 'Unknown'}
                </dd>
              </div>
            ) : null}
            {!quiet && row.excludedOperatorReadings ? (
              <div>
                <dt>Other methods</dt>
                <dd>{row.excludedOperatorReadings} readings</dd>
              </div>
            ) : null}
            {!quiet && row.bp ? (
              <div>
                <dt>Protocol</dt>
                <dd>
                  {row.bp.paired} paired · {row.bp.incompleteProtocol} incomplete · {row.bp.protocolUnknown}{' '}
                  unknown
                </dd>
              </div>
            ) : null}
          </dl>
          {!quiet && row.operatorGroups?.length ? (
            <dl>
              {row.operatorGroups.map((group) => (
                <div key={group.operator}>
                  <dt>{group.operator.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll(':', ' · ')}</dt>
                  <dd>
                    {group.readings} readings
                    {group.first
                      ? ` · first ${formatNumber(group.first.value, decimals)} ${row.unit} · ${fmtDay(group.first.date)}`
                      : ''}
                    {group.latest
                      ? ` · latest ${formatNumber(group.latest.value, decimals)} ${row.unit} · ${fmtDay(group.latest.date)}`
                      : ''}
                    {group.change !== null
                      ? ` · change ${formatSigned(group.change, decimals)} ${row.unit}`
                      : ''}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {!quiet && row.bpEpisodes?.length ? (
            <ul>
              {row.bpEpisodes.map((episode) => (
                <li key={episode.id}>
                  {fmtDay(episode.date)} ·{' '}
                  {episode.protocol === 'paired'
                    ? 'Paired'
                    : episode.protocol === 'incompleteProtocol'
                      ? 'Incomplete protocol'
                      : 'Protocol unknown'}{' '}
                  · systolic {episode.readings.sbp.join(', ') || 'Unknown'} · diastolic{' '}
                  {episode.readings.dbp.join(', ') || 'Unknown'} mmHg
                  {episode.setting ? ` · ${episode.setting}` : ''}
                  {episode.restMin !== undefined ? ` · ${episode.restMin} min rest` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </ResponsivePanel>
      ) : null}
    </article>
  );
}
