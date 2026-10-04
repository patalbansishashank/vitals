/**
 * Progress › Goals (living-mode.md §8.2 item 2; IA §4.11): one drift card per ranked goal, one action each.
 * "See easier options" opens Today, where the proposal sits; "Re-plan the rest" starts the re-plan job, which leaves a
 * proposal on Today.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Faceplate, Rule, toast } from '@/components';
import { daysBetween } from '@/living/dates';
import type { LocalDate } from '@/living';
import type { ActivePlan } from '../../activePlan';
import { useLivingActions } from '../../data/actions';
import { useLiving } from '../../data/source';
import { livingPaths } from '../../paths';
import { DriftGoalCard } from '../components/DriftGoalCard';
import { PROGRESS_COPY as C } from '../copy';

export function GoalsSection({ plan, today }: { plan: ActivePlan; today: LocalDate }) {
  const cards = useLiving((s) => s.driftCards(), []);
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

  return (
    <Faceplate id="goals" title={C.faces.goals} className="lv-prog-face">
      {cards.length === 0 ? <p className="lv-prog-state">{C.noGoals}</p> : null}
      {cards.map((card, i) => (
        <div key={`${card.goal}:${card.metric}`}>
          {i > 0 ? <Rule /> : null}
          <DriftGoalCard card={card} busy={busy} onAction={(a) => void onAction(a)} />
        </div>
      ))}
    </Faceplate>
  );
}
