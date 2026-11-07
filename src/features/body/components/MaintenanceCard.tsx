import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Flame, Sparkles } from 'lucide-react';
import { CardFoot, CardHead, GradientCard, HeroNumber, Icon, InlineWarning, Key } from '@/components';
import { intakePath } from '@/features/intake';
import { CHAPTER_QUESTIONS } from '@/features/intake/chapters';
import { DriverBar, measuredLine } from '@/features/intake/components/Maintenance';
import { BODY, MAINT, TURN } from '@/features/intake/copy';
import { frozenContext, type FlowContext } from '@/features/intake/flow';
import { DRIVER_QUESTION, energyOut, unitWord } from '@/features/intake/maintenanceView';
import type { SectionContext } from '@/features/intake/sections';
import { useChapterFlow } from '@/features/intake/useChapterFlow';
import { useLiveMaintenance } from '@/features/intake/useMaintenance';
import { useSafetyStore } from '@/state/safetyStore';
import { useSettingsStore } from '@/state/settingsStore';
import { INFO, MAINTENANCE } from '../copy';
import { IntervalBar } from './IntervalBar';
import { MAINTENANCE_GLOW } from './glow';

const sectionContext = (ctx: FlowContext): SectionContext => ({ ...ctx, safety: useSafetyStore.getState().answers, now: new Date().toISOString() });

export interface MaintenanceCardProps {
  ctx: FlowContext;
  /** Quiet or gentle mode: a word line instead of the number, the bar without kcal; "Show numbers" brings them back here. */
  calm: boolean;
  id?: string;
}

/**
 * Maintenance on Your body (r071): the engine's number and 80 % range as the hero and its scale, the split as the driver
 * bar with its compact parts list, and the one answer that would narrow the range as a row with a pill. It reads chapter
 * A of the intake ("A normal day") through the same hooks as the chapter screen, so it is one document and one estimate;
 * the card asks nothing itself and opens no sheet: "Answer questions" and the pill go to the chapter. The bar is the
 * intake's `DriverBar`, unchanged; its ember steps are `.lm-body-maint` in body.css.
 */
export function MaintenanceCard({ ctx, calm, id }: MaintenanceCardProps) {
  const navigate = useNavigate();
  const unit = useSettingsStore((s) => s.energyUnit);
  const sctx = useMemo(() => sectionContext(ctx), [ctx]);
  const flow = useChapterFlow('activity', CHAPTER_QUESTIONS.activity, sctx, ctx);
  const { answers } = flow.state;
  const fctx = useMemo(() => frozenContext(answers, ctx), [answers, ctx]);
  const live = useLiveMaintenance(answers, fctx, unit, false);
  const [showNumbers, setShowNumbers] = useState(false);
  const started = Object.keys(answers.status).length > 0;
  const quiet = calm && !showNumbers;

  const m = live.summary.maintenance;
  const view = live.view;
  const kcal = energyOut(m.kcal, unit);
  const [lo, hi] = [energyOut(m.band80[0], unit), energyOut(m.band80[1], unit)];
  const unitText = `${unitWord(unit)}/day`;
  const b = view.explanation.biggestUnknown;
  const fixTarget = b ? (b.driver === 'rmr' ? 'measuredEver' : b.driver === 'steps' ? 'stepsKnown' : b.driver === 'work' ? 'job' : (DRIVER_QUESTION[b.driver] ?? b.driver)) : null;
  const goTo = (question: string) => navigate(intakePath('activity', { from: 'body', anchor: question }));
  const line = measuredLine(live.result.measured, m);
  const typicalBody = !live.summary.complete;

  return (
    <GradientCard
      id={id}
      className="lm-body-maint"
      domain="energy"
      glow={MAINTENANCE_GLOW}
      head={<CardHead icon={Flame} title={BODY.maintTitle} info={INFO.maintenance} />}
      foot={
        <CardFoot state={{ word: MAINTENANCE.from }} link={{ to: intakePath('activity', { from: 'body' }), label: started ? BODY.edit : BODY.start }}>
          {calm ? (
            <Key variant="text" size="sm" aria-pressed={showNumbers} onClick={() => setShowNumbers((x) => !x)}>
              {showNumbers ? MAINT.hideNumbers : MAINT.showNumbers}
            </Key>
          ) : null}
        </CardFoot>
      }
    >
      <section className="lm-body-maint__lead" aria-live="polite" aria-label={BODY.maintTitle}>
        {quiet ? (
          <p className="lm-body-maint__quiet">{MAINT.quietHeadline}</p>
        ) : (
          <>
            <HeroNumber value={kcal} unit={unitText} size="num-l" label={`${BODY.maintTitle}: about ${kcal} ${unitWord(unit)} a day, likely ${lo} to ${hi}`} />
            <IntervalBar low={lo} high={hi} value={kcal} decimals={0} />
          </>
        )}
        {quiet ? null : <p className="lm-sr">{view.headline}</p>}
      </section>
      {/* quiet: the parts by name only (the steps part's own "7 000 steps" line is a number too) */}
      <DriverBar rows={view.rows} unit={unit} quiet={quiet} table compact />
      {view.palNote || typicalBody || (line && !quiet) ? (
        <div className="lm-body-maint__lines">
          {view.palNote ? <InlineWarning severity="caution">{view.palNote}</InlineWarning> : null}
          {typicalBody ? <p>{MAINT.needsBody}</p> : null}
          {line && !quiet ? <p className="lm-body-maint__measured">{line}</p> : null}
        </div>
      ) : null}
      {view.unknownText && b && fixTarget ? (
        <div className="lm-body-maint__unknown">
          <Icon icon={Sparkles} size={16} className="lm-body-maint__spark" />
          <p>{quiet ? (MAINTENANCE.unknownQuiet[b.driver as keyof typeof MAINTENANCE.unknownQuiet] ?? view.unknownText) : view.unknownText}</p>
          <Key size="sm" variant="action" onClick={() => goTo(fixTarget)}>
            {MAINT.fix[b.driver as keyof typeof MAINT.fix] ?? TURN.change}
          </Key>
        </div>
      ) : null}
    </GradientCard>
  );
}
