import { useContext, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Key } from '@/components';
import { CardCommit } from './widgetTypes';

export interface CommitKeyProps {
  /** Commits the widget's current answer. */
  onClick: () => void;
  /** Why it cannot commit yet (Next shows it as its disabled reason). */
  disabledReason?: string;
  /** Label of the stand-alone key (outside a QuestionCard). */
  children: ReactNode;
}

/**
 * A widget's commit. Inside a QuestionCard it renders nothing and hands its action to the card's Next (one forward
 * key per step); anywhere else it is a plain key.
 */
export function CommitKey({ onClick, disabledReason, children }: CommitKeyProps) {
  const api = useContext(CardCommit);
  const latest = useRef(onClick);
  useLayoutEffect(() => {
    latest.current = onClick;
  });
  useLayoutEffect(() => {
    if (!api) return;
    api.setRun(() => latest.current());
    return () => {
      api.setRun(null);
      api.setReason(undefined);
    };
  }, [api]);
  useLayoutEffect(() => {
    api?.setReason(disabledReason ?? null);
  }, [api, disabledReason]);
  if (api) return null;
  return (
    <div className="lm-ik-done">
      <Key onClick={onClick} disabledReason={disabledReason}>
        {children}
      </Key>
    </div>
  );
}
