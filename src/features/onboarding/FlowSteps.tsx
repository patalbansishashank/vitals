/**
 * The setup flow's one progress row, shared by every intake header: the first-run steps on /welcome and the intake
 * chapters on /onboarding/*. One 4 px segment per step or chapter, in one of three whole states: a finished step is
 * filled (bronze), the step you are on is gold, a later or unfinished one is the bare track. No partial fills, no
 * count, no names, no dashed or hatched states. The header carries the step's name (Back · centred title · this row).
 *
 * `list` draws it as an ordered list whose items tell assistive tech each step's state (the welcome steps). Without
 * it, the caller wraps the segments in its own element, such as a progressbar with a full value text (the chapters).
 */
import { VisuallyHidden, cx } from '@/components';
import './onboarding.css';

export type FlowStepState = 'done' | 'current' | 'todo';

export interface FlowStep {
  id: string;
  state: FlowStepState;
  /** Text for assistive tech only (`list`), e.g. "About you, step 2 of 3". */
  srText?: string;
}

export function FlowSteps({ steps, list = false, label, className }: { steps: readonly FlowStep[]; list?: boolean; label?: string; className?: string }) {
  const segs = steps.map((s) => {
    const bar = <span className="lm-steps__bar" aria-hidden="true" />;
    return list ? (
      <li key={s.id} className="lm-steps__seg" data-state={s.state} aria-current={s.state === 'current' ? 'step' : undefined}>
        {bar}
        {s.srText ? <VisuallyHidden>{s.srText}</VisuallyHidden> : null}
      </li>
    ) : (
      <span key={s.id} className="lm-steps__seg" data-state={s.state}>
        {bar}
      </span>
    );
  });
  return list ? (
    <ol className={cx('lm-steps', className)} aria-label={label}>
      {segs}
    </ol>
  ) : (
    <span className={cx('lm-steps', className)} aria-hidden="true">
      {segs}
    </span>
  );
}
