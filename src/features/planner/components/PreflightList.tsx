import { Faceplate, Key, Notice, Spinner, StatusMark } from '@/components';
import type { HintAction, PreflightHint } from '../preflight';

export interface PreflightListProps {
  hints: readonly PreflightHint[];
  onAction: (a: HintAction) => void;
  /** A conflict summary line from the relations table (shown when there are no hints). */
  empty?: string;
  /** The planner's reachability estimate is still computing (first call ≈ 1 s): say so instead of "nothing to flag". */
  pending?: boolean;
}

/** "Before you run" (planner-goals.md §6): feasibility and conflict hints, risk first, then the one-tap remedy. */
export function PreflightList({ hints, onAction, empty, pending = false }: PreflightListProps) {
  const caption = hints.length ? `${hints.length} note${hints.length === 1 ? '' : 's'}` : pending ? 'checking' : 'nothing to flag';
  return (
    <Faceplate title="Before you run" caption={caption} className="lp-preflight" aria-busy={pending || undefined}>
      {pending ? (
        <p className="lp-preflight__pending" role="status">
          <Spinner size={16} />
          <span>Checking what a safe rate can reach in this horizon…</span>
        </p>
      ) : null}
      {hints.length === 0 && pending ? null : hints.length === 0 ? (
        <p className="lp-preflight__ok">
          <StatusMark severity="ok" size={16} />
          <span>{empty ?? 'No obvious conflicts. The full run checks every goal against your limits.'}</span>
        </p>
      ) : (
        <div className="lp-preflight__list" aria-live="polite">
          {hints.map((h) => (
            <Notice
              key={h.id}
              layout="ruled"
              severity={h.severity}
              title={h.title}
              actions={
                h.action ? (
                  <Key size="sm" onClick={() => onAction(h.action!)}>
                    {h.action.label}
                  </Key>
                ) : undefined
              }
            >
              {h.body}
            </Notice>
          ))}
        </div>
      )}
    </Faceplate>
  );
}
