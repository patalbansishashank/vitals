import { memo } from 'react';
import { Faceplate, KeyLink } from '@/components';
import { BodyAvatar } from '@/features/body/avatar';
import type { AvatarParams } from '@/engine/body';
import { paths } from '@/app/paths';
import { CONTINUE, FIGURE, SETUP } from '../copy';

export type SetupView = 'basics' | 'shape' | 'habits';

/** The 3-segment progress scale in the context bar (IA §4.1: basics · shape · habits, not numbered steps). */
export function SetupProgress({ step }: { step: SetupView }) {
  const idx = SETUP.steps.findIndex((s) => s.id === step);
  return (
    <ol className="lm-body-steps" aria-label={SETUP.progressLabel}>
      {SETUP.steps.map((s, i) => (
        <li key={s.id} data-state={i < idx ? 'done' : i === idx ? 'current' : 'todo'} aria-current={i === idx ? 'step' : undefined}>
          <span className="lm-body-steps__bar" aria-hidden="true" />
          <span className="lm-body-steps__label">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

/** "Choose a start" (IA §4.1): the hand-over from setup into the Simulator or the Planner. */
export function ChooseStart() {
  return (
    <Faceplate className="lm-body-start" title={SETUP.startTitle}>
      <p className="lm-body-lead">{SETUP.startLead}</p>
      <div className="lm-body-start__keys">
        <div className="lm-body-start__opt">
          <KeyLink to={paths.simulate} size="lg" block>
            {SETUP.simulate}
          </KeyLink>
          <p className="lm-body-hint">{SETUP.simulateHint}</p>
        </div>
        <div className="lm-body-start__opt">
          <KeyLink to={paths.planGoals} size="lg" block>
            {SETUP.plan}
          </KeyLink>
          <p className="lm-body-hint">{SETUP.planHint}</p>
        </div>
      </div>
      <KeyLink to={paths.body} variant="quiet" size="sm">
        {SETUP.stay}
      </KeyLink>
    </Faceplate>
  );
}

/** Normal mode: nothing to confirm (autosave); the way on into the two features. */
export const ContinueFace = memo(function ContinueFace() {
  return (
    <Faceplate as="div" className="lm-body-continue" variant="inset">
      <p className="lm-body-hint">{CONTINUE.lead}</p>
      <div className="lm-body-row">
        <KeyLink to={paths.simulate} size="sm">
          {CONTINUE.simulate}
        </KeyLink>
        <KeyLink to={paths.planGoals} size="sm">
          {CONTINUE.plan}
        </KeyLink>
      </div>
    </Faceplate>
  );
});

/**
 * Sticky mini figure (mobile, your-body.md §3): docks under the top bar while a shape slider is dragged with the
 * stage out of view; fades 1.5 s after the last input; tap scrolls back to the stage.
 */
export function MiniFigure({ params, frame, visible, onReturn }: { params: AvatarParams; frame: number; visible: boolean; onReturn: () => void }) {
  return (
    <button type="button" className="lm-body-mini" data-visible={visible || undefined} aria-label={FIGURE.miniLabel} tabIndex={visible ? 0 : -1} aria-hidden={!visible} onClick={onReturn}>
      <span aria-hidden="true" className="lm-body-mini__fig">
        <BodyAvatar params={params} frame={frame} size={108} view="front" caption={false} ruler={false} tween={false} label="Figure" />
      </span>
    </button>
  );
}
