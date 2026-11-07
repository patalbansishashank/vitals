import { useMemo } from 'react';
import { allocateRegional, stateToAvatarParams, type BodyEstimate, type BodyState } from '@/engine/body';
import type { SimulationResult } from '@/engine';
import { Figure3D } from '@/features/body/figure3d';
import { formatNumber } from '@/components';
import { figureFrameOf, useProfileStore } from '@/state/profileStore';

const last = (a: Float32Array | undefined): number | null => {
  if (!a || a.length === 0) return null;
  const v = a[a.length - 1]!;
  return Number.isFinite(v) ? v : null;
};

/** The body at the end of a plan, from the simulation's tissue masses (never raw scale weight). */
export function endBodyState(start: BodyEstimate, sim: SimulationResult): BodyState | null {
  const fm = last(sim.daily.fatMass);
  if (fm === null) return null;
  const leanEnd = last(sim.daily.leanTissue);
  const lean0 = sim.initial.leanTissue;
  const dLean = leanEnd !== null && lean0 !== undefined && Number.isFinite(lean0) ? leanEnd - lean0 : 0;
  const smEnd = last(sim.daily.skeletalMuscle) ?? start.skeletalMuscleKg + dLean * 0.5;
  const ffm = start.fatFreeMassKg + dLean;
  const regional = allocateRegional(
    { fat: start.fat, muscle: start.muscle },
    { fatMassKg: Math.max(1, fm), skeletalMuscleKg: Math.max(5, smEnd) },
  );
  return {
    ...start,
    fatMassKg: fm,
    fatFreeMassKg: ffm,
    weightKg: fm + ffm,
    skeletalMuscleKg: smEnd,
    fat: regional.fat,
    muscle: regional.muscle,
  };
}

/**
 * The selected plan's figure, start → end (plan-ladder.md §6.6, Overview tab): the outer silhouette at the end of the
 * plan with the start silhouette as a ghost — neutral material, no labels. Hidden when Settings › "Show figure" is off
 * (gentle mode). Ladder cards carry no figure.
 */
export function PlanFigure({
  start,
  sim,
  planTitle,
  size = 'xs',
}: {
  start: BodyEstimate;
  sim: SimulationResult;
  planTitle: string;
  size?: 'xs' | 'sm' | 'md' | 'fill';
}) {
  const params = useMemo(() => {
    try {
      const end = endBodyState(start, sim);
      if (!end) return null;
      return {
        from: stateToAvatarParams(start),
        to: stateToAvatarParams(end, { baseline: start }),
        fat: end.fatMassKg - start.fatMassKg,
      };
    } catch {
      return null;
    }
  }, [start, sim]);
  // the person's drawing frame (Body › Shape), as on the Body page and the Simulator figure
  const frame = useProfileStore((st) => figureFrameOf(st));
  if (!params) return null;
  // r068 W2-14: the Overview's figure fills its column, the start's outline behind the end, with a one-line key
  if (size === 'fill')
    return (
      <div className="lp-figure">
        <div className="lp-figure__stage">
          <Figure3D
            params={params.to}
            compareTo={params.from}
            frame={frame}
            size="fill"
            caption={false}
            ruler={false}
            tween={false}
            label={`Illustrative figure at the end of the ${planTitle} plan, outline of the start behind it; fat mass ${params.fat <= 0 ? 'down' : 'up'} ${formatNumber(Math.abs(params.fat), 1)} kilograms.`}
          />
        </div>
        <p className="lp-figure__key" aria-hidden="true">
          <span>
            <i data-k="start" />
            start (outline)
          </span>
          <span>
            <i data-k="end" />
            end of the {planTitle} plan · fat {params.fat <= 0 ? '−' : '+'}
            {formatNumber(Math.abs(params.fat), 1)} kg
          </span>
        </p>
      </div>
    );
  return (
    <div className="lp-card__figure" style={{ width: size === 'xs' ? 56 : size === 'sm' ? 112 : 200, overflow: 'visible' }}>
      <Figure3D
        params={params.to}
        compareTo={params.from}
        frame={frame}
        size={size}
        caption={false}
        ruler={false}
        tween={false}
        label={`Illustrative figure at the end of the ${planTitle} plan, outline of the start behind it; fat mass ${params.fat <= 0 ? 'down' : 'up'} ${formatNumber(Math.abs(params.fat), 1)} kilograms.`}
      />
    </div>
  );
}
