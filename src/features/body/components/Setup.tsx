import { GitBranch, Target } from 'lucide-react';
import { CardHead, DottedTrack, GradientCard, MonoMeta } from '@/components';
import { Figure3D } from '@/features/body/figure3d';
import type { AvatarParams } from '@/engine/body';
import { paths } from '@/app/paths';
import { FIGURE, INFO, SETUP } from '../copy';

export type SetupView = 'basics' | 'shape' | 'habits';

/**
 * The 3-segment progress scale in the header's progress row (IA §4.1: basics · shape · a normal day, not numbered
 * steps); the intake carries the same scale as step 3.
 */
export function SetupProgress({ step }: { step: SetupView }) {
  const idx = SETUP.steps.findIndex((s) => s.id === step);
  return (
    <ol className="lm-body-steps" aria-label={SETUP.progressLabel}>
      {SETUP.steps.map((s, i) => (
        <li
          key={s.id}
          data-state={i < idx ? 'done' : i === idx ? 'current' : 'todo'}
          aria-current={i === idx ? 'step' : undefined}
        >
          <span className="lm-body-steps__bar" aria-hidden="true" />
          <span className="lm-body-steps__label" data-label={s.label}>
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * "Choose a start" (r071; IA §4.1): the hand-over from setup into the Planner or the Simulator. The page title says it
 * (the header); here are only the two ways on. Find plans is the hero (a gold glow and a dotted track from a goal to its
 * plans, drawn as a glyph); Simulate a plan is the slim card under it. Each card's sentence is its (i); the card is one
 * link, through its title.
 */
export function ChooseStart() {
  return (
    <div className="lm-body-start">
      <GradientCard className="lm-body-start__opt" data-primary="" domain="plan" size="hero" href={paths.planGoals} head={<CardHead icon={Target} title={SETUP.plan} info={INFO.plan} />}>
        {/* a goal with a thumb on the way to it: a picture of what the card does, never a reading */}
        <div className="lm-body-start__glyph" aria-hidden="true">
          <DottedTrack label={SETUP.plan} value={64} from={0} to={100} valueText="" dots={32} />
        </div>
        <MonoMeta tone="hue">{SETUP.planMeta}</MonoMeta>
      </GradientCard>
      <GradientCard className="lm-body-start__opt" domain="neutral" size="slim" href={paths.simulate} head={<CardHead icon={GitBranch} title={SETUP.simulate} info={INFO.simulate} />}>
        <MonoMeta>{SETUP.simulateMeta}</MonoMeta>
      </GradientCard>
    </div>
  );
}

/**
 * Sticky mini figure (mobile, your-body.md §3): docks under the header while a shape slider is dragged with the
 * stage out of view; fades 1.5 s after the last input; tap scrolls back to the stage.
 */
export function MiniFigure({
  params,
  frame,
  visible,
  onReturn,
}: {
  params: AvatarParams;
  frame: number;
  visible: boolean;
  onReturn: () => void;
}) {
  return (
    <button
      type="button"
      className="lm-body-mini"
      data-visible={visible || undefined}
      aria-label={FIGURE.miniLabel}
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
      onClick={onReturn}
    >
      <span aria-hidden="true" className="lm-body-mini__fig">
        {visible ? (
          <Figure3D
            params={params}
            frame={frame}
            size={86}
            caption={false}
            ruler={false}
            tween={false}
            controls={false}
            decorative
            label="Figure"
          />
        ) : null}
      </span>
    </button>
  );
}
