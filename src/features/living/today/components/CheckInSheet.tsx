/**
 * Weekly check-in (living-mode.md §4.5; IA §4.10), opened from the header's check-in icon ("Weekly check-in ready").
 * Three parts: Weight (the trend against the forecast band, "88.7 kg · −0.5 kg this week", one verdict or what is missing — never
 * faked), This week (adherence per block with a logged value, sentence-case labels, and the biggest gap), and Change
 * (this week's proposal, with its own Apply / Discard).
 * The check-in is a decision the person confirms (C6, D5-02/D5-06): the header is Cancel · title · Check in, and only the
 * verb records it. Closing or cancelling never confirms a check-in. One state word opens the sheet (Change ready · Review ·
 * Check-in ready · Plan changed · Estimate updated); the trend reads as its range where the filter gives its SD ("88.4–89.0 kg"). The weight verdict is a word (ahead · on track ·
 * behind · unclear); no cause is inferred from the logs (D5-02: no causal shares). The goal date is a plain range (C6:
 * never "likely"). One fact line may follow: the model correction with its range (a labelled balance residual, never
 * expenditure) and the complete food days of the window (D5-01: "complete food days 3/7", the days whose food report
 * makes them quantitative; meal count alone never does). The week may end with one line of entered and logged facts:
 * calendar energy availability as a value in kcal/kg FFM/day or Incomplete (D4-04), the latest entered hunger 0–10
 * (D2-06) and the concern word (D8-09: Review · No flagged concern); never a healthy/unsafe verdict.
 */
import { useState } from 'react';
import { Chip, GlowLine, Key, ResponsivePanel, formatNumber, formatRange, toast } from '@/components';
import { BlockBars } from '@/features/charts/living/BlockBars';
import { weightLine } from './Faces';
import '../cards/sheets.css';
import type { TrendLaneData } from '@/features/charts/living/types';
import { CHECK_IN_STATUS, type LocalDate } from '@/living';
import { useLivingClock } from '../../clock';
import { TODAY_COPY } from '../../copy';
import { useLivingActions } from '../../data/actions';
import { useLiving } from '../../data/source';
import { fmtDateRange, fmtDay, quietWord } from '../../format';
import { ChangeCard } from '../../components/ChangeCard';
import type { ChangeAction } from '../../model/changeCard';
import { correctionText } from '../../progress/components/DriftGoalCard';
import { useEnergyUnit } from '@/state/settingsStore';
import type { CheckInModel } from '../../data/types';
import { plainReason } from '../../start/plainReason';
import { WeeklyModelSummary } from './WeeklyModelSummary';

const C = TODAY_COPY.checkIn;
/** (r068 S3) the label before the week's trend range ("Trend 84.8–85.5 kg"). */
export const TREND_LABEL = 'Trend';

/** The header verb: confirms this check-in once. */
export const CHECK_IN_VERB = 'Check in';
/** Drift too uncertain to classify, or too little data (distinct from on track, D5-02). */
export const DRIFT_UNCLEAR = 'unclear';

/** The verdict word: unclear certainty overrides the state (insufficient data is never "on track"). */
export function driftWord(state: keyof typeof TODAY_COPY.drift, certainty?: 'clear' | 'unclear'): string {
  return certainty === 'unclear' ? DRIFT_UNCLEAR : TODAY_COPY.drift[state];
}

/** "Goal date 21–30 Dec": the forecast's date range, plain (C6: never "likely", no probability). */
export const goalDateLine = (range: string): string => `Goal date ${range}`;

/** "complete food days 3/7" (D5-01): calibration-eligible days in the check-in window; null when the source has no count. */
export function foodDaysText(
  d: NonNullable<CheckInModel['verdict']>['loggedIntakeDiff'] | undefined,
): string | null {
  return d && d.daysInWindow > 0 ? `complete food days ${d.quantDays}/${d.daysInWindow}` : null;
}

/** The latest trend point in the lane (the trend weight as of the check-in) and its filter SD when the lane has one. */
function lastTrend(t: TrendLaneData | null | undefined): { kg: number; sd: number | null } | null {
  if (!t) return null;
  for (let i = t.trend.length - 1; i >= 0; i--)
    if (Number.isFinite(t.trend[i])) {
      const sd = t.trendSd?.[i];
      return { kg: t.trend[i]!, sd: sd !== undefined && Number.isFinite(sd) && sd > 0 ? sd : null };
    }
  return null;
}

/** "88.4–89.0" (the trend's 10th–90th percentile from the filter SD, a conditional range: D5-02/D5-04), else the value. */
export function trendRangeText(kg: number, sd: number | null): string {
  return sd !== null && sd > 0 ? formatRange(kg - 1.2816 * sd, kg + 1.2816 * sd, 1) : formatNumber(kg, 1);
}

/**
 * The check-in's state word (D5-06): "Change ready" while a proposal waits on its own Apply / Discard, "Review" when the
 * prescription needs review or a concern was entered, "Check-in ready" while the week waits to be confirmed, "Plan
 * changed" after a version took effect since the last check-in, else "Estimate updated" (the derived preview only).
 */
export function checkInStateWord(i: {
  due: boolean;
  proposal: boolean;
  review?: boolean;
  planChanged?: boolean;
}): string {
  if (i.proposal) return CHECK_IN_STATUS.change;
  if (i.review) return CHECK_IN_STATUS.review;
  if (i.due) return CHECK_IN_STATUS.ready;
  return i.planChanged ? CHECK_IN_STATUS.changed : CHECK_IN_STATUS.updated;
}

const REVIEW_REASON: Readonly<Record<string, string>> = {
  repeatedCalendarEaBelowReference: 'Repeated calendar energy availability below the provisional reference',
  illness: 'Illness',
  travel: 'Travel',
  dietBreak: 'Diet break',
  creatineStart: 'Creatine started',
  newBlock: 'New training block',
  compositionScan: 'New composition reading',
  symptom: 'Entered symptom',
  longFastEnd: 'A long fast ended',
  weighInGap: 'Gap between weigh-ins',
  engineVersion: 'Model version changed',
  eligibility: 'Current prescription needs review',
  wellbeing: 'Entered concern',
};

const EA_UNIT = 'kcal/kg FFM/day';

/** "energy availability 32 kcal/kg FFM/day" · "≥ 28 …" (partial intake) · "Incomplete"; null with no ledger days (D4-04). */
export function energyAvailabilityText(ea: CheckInModel['energyAvailability'], quiet = false): string | null {
  if (!ea || ea.days === 0) return null;
  const label = 'energy availability';
  if (quiet) return ea.value !== undefined || ea.range ? null : `${label} Incomplete`;
  if (ea.range)
    return `${label} ${formatRange(ea.range[0], ea.range[1], 0)} ${EA_UNIT}${ea.status === 'scenario' ? ' · Scenario' : ''}`;
  if (ea.value !== undefined)
    return `${label} ${formatNumber(ea.value, 0)} ${EA_UNIT}${ea.status === 'scenario' ? ' · Scenario' : ''}`;
  if (ea.lowerBound !== undefined) return `${label} ≥ ${formatNumber(ea.lowerBound, 0)} ${EA_UNIT} · Partial`;
  return `${label} Incomplete`;
}

/** "hunger 6/10 · mood 7/10 · No flagged concern" from entered ratings only (D2-06/D8-09); null when nothing was entered. */
export function wellbeingText(w: CheckInModel['wellbeing'], quiet = false): string | null {
  if (!w) return null;
  const parts: string[] = [];
  if (w.hunger !== null && !quiet) parts.push(`hunger ${formatNumber(w.hunger, 0)}/10`);
  if (w.mood !== undefined && w.mood !== null && !quiet) parts.push(`mood ${formatNumber(w.mood, 0)}/10`);
  if (w.status === 'review') parts.push(CHECK_IN_STATUS.review);
  else if (w.status === 'noFlag') parts.push('No flagged concern');
  return parts.length ? parts.join(' · ') : null;
}

export function CheckInSheet({
  open,
  onClose,
  today,
  quiet,
}: {
  open: boolean;
  onClose: () => void;
  today: LocalDate;
  quiet: boolean;
}) {
  const report = useLiving((s) => (open ? s.checkIn(today) : null), [open, today]);
  const changes = useLiving((s) => (open ? s.changes('all') : []), [open]);
  const actions = useLivingActions();
  const now = useLivingClock().now();
  const proposal = report?.proposalId ? changes.find((c) => c.id === report.proposalId) : undefined;
  const onAction = (action: ChangeAction) => {
    if (!proposal) return;
    // adopting revalidates current safety (C5): a refusal says why in plain words
    if (action === 'apply')
      void actions
        .applyChange(proposal.id)
        .then((o) =>
          toast(o.ok ? TODAY_COPY.changes.applied : o.message ? plainReason(o.message) : TODAY_COPY.failed),
        );
    if (action === 'discard')
      void actions
        .discardChange(proposal.id)
        .then((o) => toast(o.ok ? TODAY_COPY.changes.kept : (o.message ?? TODAY_COPY.failed)));
  };
  const now0 = lastTrend(report?.trend);
  const kg = now0?.kg ?? null;
  const blocks = report ? report.adherence.blocks.filter((b) => b.n > 0) : [];
  const v = report?.verdict ?? null;
  // (the drift contract's certainty, when the source carries it on the verdict)
  const certainty = v?.certainty;
  const eu = useEnergyUnit();
  const facts =
    v && !quiet
      ? [correctionText(v.residual, eu), foodDaysText(v.loggedIntakeDiff)].filter(Boolean).join(' · ')
      : '';
  const weekFacts = report
    ? [energyAvailabilityText(report.energyAvailability, quiet), wellbeingText(report.wellbeing, quiet)]
        .filter(Boolean)
        .join(' · ')
    : '';
  const [reviewOpen, setReviewOpen] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // C6: closing is side-effect free; only the header verb confirms the check-in (once)
  const confirm = async () => {
    if (!report?.previewId || sending) return;
    setSending(true);
    const o = await actions.checkIn(report.previewId);
    setSending(false);
    if (!o.ok) {
      setConflict(o.message ?? TODAY_COPY.failed);
      toast(o.message ?? TODAY_COPY.failed);
      return;
    }
    setConflict(null);
    onClose();
  };
  return (
    <ResponsivePanel
      open={open}
      onClose={onClose}
      title={C.title}
      defaultDetent="full"
      onDone={() => void confirm()}
      doneLabel={CHECK_IN_VERB}
      doneDisabled={!report?.previewId || sending}
    >
      {report ? (
        <div className="lv-checkin">
          {conflict ? (
            <p className="lv-checkin__text" role="status">
              {conflict}
            </p>
          ) : null}
          {/* (r068 V11) with a change waiting, the Change section says so: no "Change ready" line over the chart */}
          {proposal && !report.review ? null : (
            <p className="lv-checkin__verdict">
              <Chip kind="status" severity="info">
                {checkInStateWord({
                  due: report.due,
                  proposal: !!proposal,
                  review: report.review,
                  planChanged: report.planChanged,
                })}
              </Chip>
              {report.review ? (
                <Key size="sm" variant="outlined" aria-haspopup="dialog" onClick={() => setReviewOpen(true)}>
                  Review details
                </Key>
              ) : null}
            </p>
          )}
          {reviewOpen ? (
            <ResponsivePanel open onClose={() => setReviewOpen(false)} title="Review details">
              <ul>
                {report.reviewReasons?.map((reason) => (
                  <li key={reason}>{REVIEW_REASON[reason] ?? plainReason(reason)}</li>
                ))}
              </ul>
              <dl>
                {report.reviewDetails?.map((detail) => (
                  <div key={detail.label}>
                    <dt>{detail.label}</dt>
                    <dd>{detail.value}</dd>
                  </div>
                ))}
              </dl>
            </ResponsivePanel>
          ) : null}
          <section className="lv-checkin__part" data-domain="body" aria-labelledby="lv-checkin-weight">
            <h3 id="lv-checkin-weight" className="lm-h3">
              {C.weight}
            </h3>
            {report.trend ? <GlowLine {...weightLine(report.trend, quiet, 120)} /> : null}
            {quiet ? null : (
              <p className="lv-checkin__readout">
                {kg !== null ? (
                  <>
                    {/* (r068 S3) the range says what it is */}
                    <span className="lv-checkin__muted">{TREND_LABEL} </span>
                    <span className="lv-checkin__value lm-display lm-num">
                      {trendRangeText(kg, now0?.sd ?? null)}
                    </span>
                    <span className="lm-unit">kg</span>
                    <span className="lv-checkin__sep"> · </span>
                  </>
                ) : null}
                <span className="lv-checkin__delta">{report.trendText}</span>
                {/* (r068 V11) where the trend stands is a word on the trend's own line ("· behind"), not a line of its own */}
                {v ? (
                  <span
                    className="lv-checkin__state"
                    data-state={certainty === 'unclear' ? 'unclear' : v.state}
                  >
                    {' · '}
                    {driftWord(v.state, certainty)}
                  </span>
                ) : null}
              </p>
            )}
            {v && quiet ? <p className="lv-checkin__text">{driftWord(v.state, certainty)}</p> : null}
            {/* (r068 S3) one forecast block: the goal date, then how it moved, on two deliberate lines */}
            {v && !quiet && (v.goalDate || v.shiftText) ? (
              <p className="lv-checkin__goal">
                {v.goalDate ? <span>{goalDateLine(fmtDateRange(v.goalDate[0], v.goalDate[1]))}</span> : null}
                {v.shiftText ? <span className="lv-checkin__muted">{v.shiftText}</span> : null}
              </p>
            ) : null}
            {v && facts ? <p className="lv-checkin__text lm-num">{facts}</p> : null}
            {v ? null : report.missingText ? <p className="lv-checkin__text">{report.missingText}</p> : null}
          </section>
          {blocks.length ? (
            <section className="lv-checkin__part" aria-labelledby="lv-checkin-week">
              <h3 id="lv-checkin-week" className="lm-h3">
                {C.week}
              </h3>
              <BlockBars
                bars={blocks.map((b) => ({ id: b.type, label: b.label, mean: b.mean, n: b.n }))}
                quiet={quiet}
              />
              {quiet && report.adherence.a7 !== null ? (
                <p className="lv-checkin__text">{quietWord(report.adherence.a7)}</p>
              ) : null}
              {!quiet && report.adherence.costliest ? (
                <p className="lv-checkin__text">{C.biggestGap(report.adherence.costliest)}</p>
              ) : null}
              {weekFacts ? <p className="lv-checkin__text lm-num">{weekFacts}</p> : null}
            </section>
          ) : weekFacts ? (
            <section className="lv-checkin__part" aria-labelledby="lv-checkin-week">
              <h3 id="lv-checkin-week" className="lm-h3">
                {C.week}
              </h3>
              <p className="lv-checkin__text lm-num">{weekFacts}</p>
            </section>
          ) : null}
          {report.weeklyModel ? <WeeklyModelSummary model={report.weeklyModel} quiet={quiet} /> : null}
          <section className="lv-checkin__part" aria-labelledby="lv-checkin-change">
            <h3 id="lv-checkin-change" className="lm-h3">
              {C.change}
            </h3>
            {proposal ? (
              <ChangeCard
                card={proposal}
                now={now}
                context="conversation"
                headingLevel="h4"
                onAction={onAction}
              />
            ) : (
              <p className="lv-checkin__text">{C.noChange}</p>
            )}
          </section>
          <p className="lv-checkin__next">{C.next(fmtDay(report.nextDate))}</p>
        </div>
      ) : null}
    </ResponsivePanel>
  );
}
