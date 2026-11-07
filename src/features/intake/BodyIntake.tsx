/**
 * What Your body shows of the intake: the asked-later reminder (a status icon in the header) and the maintenance card
 * (engine band and parts, one key that opens chapter A). Answering happens in the chapter screen.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Flame, MessageCircleQuestionMark } from 'lucide-react';
import { CardHead, GradientCard, KeyLink, StatusCapsule } from '@/components';
import { useSafetyStore } from '@/state/safetyStore';
import { useSettingsStore } from '@/state/settingsStore';
import { CHAPTER_QUESTIONS } from './chapters';
import { MaintenanceResult, maintenanceInfo } from './components/Maintenance';
import { detectIndia } from './context';
import { BODY } from './copy';
import { frozenContext, type FlowContext } from './flow';
import type { SectionContext } from './sections';
import { intakePath } from './paths';
import { askedLaterCount, nextOpen } from './summary';
import { useChapterFlow } from './useChapterFlow';
import { useLiveMaintenance } from './useMaintenance';
import { CHAPTER_ROUTE, type ChapterId, type IntakeDoc } from './types';
import './intake.css';

const sectionOf = (c: ChapterId) => CHAPTER_ROUTE[c];

/**
 * The flow context for Your body without re-running the safety evaluation (Your body already has `gentle`); cheap, so
 * shape drags stay one estimate per frame.
 */
export function useBodyFlowContext(_doc: IntakeDoc, gentle: boolean): FlowContext {
  const [india] = useState(detectIndia);
  return useMemo(() => ({ india, gentle }), [india, gentle]);
}

const sectionContext = (ctx: FlowContext): SectionContext => ({
  ...ctx,
  safety: useSafetyStore.getState().answers,
  now: new Date().toISOString(),
});

/** Where "answer now" goes: the first unanswered chapter, else the first question asked later. */
function laterTarget(doc: IntakeDoc, ctx: FlowContext): string {
  const open = nextOpen(doc, ctx);
  if (!open) return intakePath('activity', { from: 'body' });
  return intakePath(sectionOf(open.chapter), {
    from: 'body',
    ...(open.question ? { anchor: open.question.anchor ?? open.question.id } : {}),
  });
}

/** The header's status icon "N questions asked later — answer now": opens the first one. Nothing when none are waiting. */
export function IntakeReminderChip({ doc, ctx }: { doc: IntakeDoc; ctx: FlowContext }) {
  const n = askedLaterCount(doc, ctx);
  if (n === 0) return null;
  return (
    <StatusCapsule
      icon={MessageCircleQuestionMark}
      label={BODY.reminderLabel(n)}
      attention
      to={laterTarget(doc, ctx)}
    />
  );
}

/**
 * The maintenance card on Your body (design v3 §4.4): the engine's number and range and its parts, read from chapter A
 * ("A normal day") — the same graph and document as the chapter screen. One key in the header opens the chapter
 * (`from=body`), and so does fixing the biggest unknown; the card asks nothing itself and opens no sheet.
 */
export function MaintenanceFace({
  ctx,
  quiet,
  id,
}: {
  doc?: IntakeDoc;
  ctx: FlowContext;
  quiet: boolean;
  id?: string;
}) {
  const navigate = useNavigate();
  const unit = useSettingsStore((s) => s.energyUnit);
  const sctx = useMemo(() => sectionContext(ctx), [ctx]);
  const flow = useChapterFlow('activity', CHAPTER_QUESTIONS.activity, sctx, ctx);
  const { answers } = flow.state;
  const fctx = useMemo(() => frozenContext(answers, ctx), [answers, ctx]);
  const live = useLiveMaintenance(answers, fctx, unit, false);
  const started = Object.keys(answers.status).length > 0;
  return (
    <GradientCard
      as="section"
      domain="energy"
      id={id}
      className="lm-ik-maint"
      head={<CardHead icon={Flame} title={BODY.maintTitle} as="h2" info={maintenanceInfo} />}
      foot={
        <KeyLink to={intakePath('activity', { from: 'body' })} variant="text" size="sm">
          {started ? BODY.edit : BODY.start}
        </KeyLink>
      }
    >
      <MaintenanceResult
        inset={false}
        compact
        title={BODY.maintTitle}
        m={live.summary.maintenance}
        view={live.view}
        unit={unit}
        quiet={quiet}
        typicalBody={!live.summary.complete}
        measured={live.result.measured}
        onChangeAnswer={(q) => navigate(intakePath('activity', { from: 'body', anchor: q }))}
      />
    </GradientCard>
  );
}
