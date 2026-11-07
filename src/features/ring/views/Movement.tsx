/** Movement: steps against the goal and where they came from (Ring › Activity; the Activity card shares its helpers). */
import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  CardFoot,
  DottedTrack,
  HeroNumber,
  Icon,
  MonoMeta,
  RadialTicks,
  clockText,
  formatNumber,
} from '@/components';
import { useQuietMode } from '@/state/settingsStore';
import { RING_COPY as C } from '../copy';
import { useSteps, useTimeline } from '../data';
import { StepsSourcePanel } from '@/features/living/activity/StepsSourceChart';
import { stepsHours } from '@/features/living/activity/model';
import type { RingDay } from '../day';
import { calendarDate, clockOf } from '../model';
import { useNow } from '../useGauge';
import { useStepsDay } from '../stepsDay';
import { quietUpdated } from '../quiet';

// ---------------------------------------------------------------------------------------------------------------
// Activity

/** "Ring and phone" · "Ring" · "Phone" from the fused intervals' lineages (null without S2's `/steps`). */
export function stepsLineageText(lineages: readonly string[]): string | null {
  const ring = lineages.some((l) => l.startsWith('ring'));
  const phone = lineages.some((l) => l.startsWith('phone'));
  if (ring && phone) return 'Ring and phone';
  if (ring) return 'Ring';
  if (phone) return 'Phone';
  return lineages.some((l) => l.startsWith('hc-other')) ? 'Health Connect' : null;
}

/**
 * Steps against the goal (a ring or a linear track), the lineage chip with its disagreement dot opening Steps by source (A.1.3, §V4.1:
 * the same panel as Today), and the measurement update. Secondary distance, active time and estimated energy are in the card's information panel. A day
 * nothing observed reads "No reading", never 0 (Codex UI #6, #25).
 */
export function MovementBody({
  date,
  day,
  compact = false,
  radial = true,
  updated,
}: {
  date: string;
  day: RingDay;
  compact?: boolean;
  radial?: boolean;
  updated?: string;
}) {
  const quiet = useQuietMode().on;
  const sq = useSteps(date, date);
  const tq = useTimeline(date);
  const now = useNow();
  const [open, setOpen] = useState(false);
  const stepsDay = sq.data?.days.find((d) => d.date === date) ?? null;
  const lineages = (sq.data?.intervals ?? [])
    .filter((i) => i.start.slice(0, 10) === date || i.end.slice(0, 10) === date)
    .map((i) => i.lineage);
  const hours = useMemo(() => (tq.status === 'ready' && tq.data ? stepsHours(tq.data) : []), [tq]);
  const inTime = useStepsDay(date);
  const goal = day.goals.steps;
  const steps = day.steps?.value ?? null;
  const lineage = day.steps
    ? day.steps.provisional
      ? C.stepsOnPhone
      : (stepsLineageText(lineages) ?? (day.steps.lineage === 'fused' ? 'Ring and phone' : C.stepsRing))
    : null;
  const disagree =
    hours.some((h) => h.disagree) || (sq.data?.intervals ?? []).some((i) => i.disagreement === true);
  const canInspect = hours.length > 0;
  // The goal source stays visible: plan, then ring, then the default.
  const goalWord =
    goal.source === 'plan' ? C.planGoalWord : goal.source === 'ring' ? C.ringGoalWord : 'Default goal';
  const status =
    steps === null
      ? C.noStepReading
      : steps === goal.value
        ? 'Goal met'
        : steps > goal.value
          ? `+${formatNumber(steps - goal.value, 0)} over`
          : `${formatNumber(goal.value - steps, 0)} to go`;
  const word =
    steps === null ? C.noStepReading : steps >= goal.value ? 'At or past the goal' : 'Short of the goal';
  const hero = (
    <div className="rga-move__number">
      <HeroNumber
        value={steps}
        size={radial ? 'num' : 'num-l'}
        unit={radial ? undefined : 'steps'}
        label={quiet ? word : steps === null ? C.noStepReading : `${formatNumber(steps, 0)} steps`}
        quietWord={quiet ? word : steps === null ? C.noStepReading : undefined}
      />
    </div>
  );
  return (
    <div className="rga-move" data-compact={compact || undefined}>
      <div className="rga-move__hero">
        {radial ? (
          <RadialTicks
            label="Steps"
            value={steps}
            goal={goal.value}
            size={compact ? 160 : 180}
            hue="steps"
            state={steps === null ? 'none' : day.steps?.provisional ? 'provisional' : 'normal'}
            quiet={quiet}
            quietFill="ratio"
            quietWord={word}
            centre={hero}
          />
        ) : (
          <div className="rga-move__linear">
            {hero}
            <DottedTrack
              label="Steps"
              value={steps}
              goal={goal.value}
              valueText={steps === null ? C.noStepReading : formatNumber(steps, 0)}
              quiet={quiet}
              quietWord={word}
              state={steps === null ? 'unknown' : day.steps?.provisional ? 'provisional' : 'normal'}
              hue="steps"
            />
          </div>
        )}
      </div>
      <CardFoot
        state={{ word: quiet ? word : status }}
        right={quiet ? undefined : `${goalWord} ${formatNumber(goal.value, 0)}`}
      >
        {updated ? <MonoMeta>{updated}</MonoMeta> : null}
      </CardFoot>
      {lineage ? (
        canInspect ? (
          <button
            type="button"
            className="rga-source"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-label={`${C.stepsSources} ${lineage}${disagree ? `, ${C.stepsDisagree}` : ''}`}
          >
            <MonoMeta>From {lineage}</MonoMeta>
            {disagree ? (
              <>
                <span className="rg-move__disagree" aria-hidden="true" />
                <span className="lm-sr">{C.stepsDisagree}</span>
              </>
            ) : null}
            <Icon icon={ChevronRight} size={18} />
          </button>
        ) : (
          <MonoMeta>From {lineage}</MonoMeta>
        )
      ) : null}
      {open ? (
        <StepsSourcePanel
          open
          onClose={() => setOpen(false)}
          hours={hours}
          located={stepsDay?.located ?? steps}
          headline={stepsDay?.headline ?? null}
          headlinePolicy={stepsDay?.headlinePolicy ?? null}
          residual={stepsDay?.ringResidual ?? null}
          ringDailyTotal={stepsDay?.ringDailyTotal ?? null}
          nowMs={now}
          day={{
            bins: inTime.bins,
            marks: inTime.marks,
            updatedAt: date === calendarDate(now) ? inTime.updatedAt : null,
            headline: steps,
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * (r069 D3) "Updated 16:23": today, the end of the last counted step minute (what the total and the steps chart are made
 * of, ring or phone); on another day, or before the timeline loads, the ring's own last update. Quiet: a part of the day.
 */
export function stepsUpdatedCaption(
  countedAt: number | null,
  ringUpdate: string | null,
  quiet: boolean,
  now: number,
): string | undefined {
  if (countedAt !== null) return quiet ? quietUpdated(countedAt, now) : `Updated ${clockText(countedAt)}`;
  if (!ringUpdate) return undefined;
  return quiet ? quietUpdated(ringUpdate, now) : `Updated ${clockOf(ringUpdate)}`;
}
