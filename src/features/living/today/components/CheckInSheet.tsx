/**
 * Weekly check-in (living-mode.md §4.5; IA §4.10): trend against the forecast band, one verdict (or what is missing —
 * the verdict section is replaced, never faked), adherence per block with the item that cost most, this week's
 * proposal (Apply / Keep the plan), and the next check-in date.
 */
import { Key, ResponsivePanel, Section, StatusMark, toast } from '@/components';
import { BlockBars } from '@/features/charts/living/BlockBars';
import { TrendLane } from '@/features/charts/living/TrendLane';
import type { LocalDate } from '@/living';
import { useLivingClock } from '../../clock';
import { TODAY_COPY } from '../../copy';
import { useLivingActions } from '../../data/actions';
import { useLiving } from '../../data/source';
import { fmtDateRange, fmtDay, quietWord } from '../../format';
import { ChangeCard } from '../../components/ChangeCard';
import type { ChangeAction } from '../../model/changeCard';

export function CheckInSheet({ open, onClose, today, quiet }: { open: boolean; onClose: () => void; today: LocalDate; quiet: boolean }) {
  const report = useLiving((s) => (open ? s.checkIn(today) : null), [open, today]);
  const changes = useLiving((s) => (open ? s.changes('all') : []), [open]);
  const actions = useLivingActions();
  const now = useLivingClock().now();
  const proposal = report?.proposalId ? changes.find((c) => c.id === report.proposalId) : undefined;
  const onAction = (action: ChangeAction) => {
    if (!proposal) return;
    if (action === 'apply') void actions.applyChange(proposal.id).then((o) => toast(o.ok ? 'Applied. The plan is updated.' : (o.message ?? 'Couldn’t apply.')));
    if (action === 'discard') void actions.discardChange(proposal.id).then((o) => toast(o.ok ? 'Kept the plan as it was.' : (o.message ?? 'Couldn’t discard.')));
  };
  return (
    <ResponsivePanel
      open={open}
      onClose={onClose}
      title="Weekly check-in"
      defaultDetent="full"
      footer={
        <Key
          onClick={() => {
            void actions.checkIn();
            onClose();
          }}
        >
          Done
        </Key>
      }
    >
      {report ? (
        <div className="lv-checkin">
          <Section label="trend">
            {report.trend ? <TrendLane data={report.trend} size="checkin" quiet={quiet} /> : null}
            <p className="lv-checkin__text">{quiet ? 'Your weekly trend is in the chart.' : report.trendText}</p>
          </Section>
          <Section label="verdict">
            {report.verdict ? (
              <>
                <p className="lv-checkin__verdict">
                  <StatusMark severity={report.verdict.state === 'behind' ? 'info' : 'ok'} size={16} />
                  <strong>{TODAY_COPY.drift[report.verdict.state]}</strong>
                  {report.verdict.goalDate ? ` · goal date likely ${fmtDateRange(report.verdict.goalDate[0], report.verdict.goalDate[1])}` : ''}
                  {report.verdict.shiftText ? `, ${report.verdict.shiftText}` : ''}
                </p>
                <p className="lv-checkin__text">{report.verdict.cause}</p>
              </>
            ) : (
              <p className="lv-checkin__text">{report.missingText}</p>
            )}
          </Section>
          <Section label="adherence">
            <BlockBars bars={report.adherence.blocks.map((b) => ({ id: b.type, label: b.label, mean: b.mean, n: b.n }))} costliest={report.adherence.costliest ?? undefined} quiet={quiet} />
            {quiet && report.adherence.a7 !== null ? <p className="lv-checkin__text">This week: {quietWord(report.adherence.a7)}.</p> : null}
          </Section>
          <Section label="this week’s proposal">
            {proposal ? <ChangeCard card={proposal} now={now} context="conversation" onAction={onAction} /> : <p className="lv-checkin__text">No change this week. Keep going.</p>}
          </Section>
          <p className="lv-checkin__next">Next check-in {fmtDay(report.nextDate)}.</p>
        </div>
      ) : null}
    </ResponsivePanel>
  );
}
