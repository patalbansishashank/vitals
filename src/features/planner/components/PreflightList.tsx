import { Faceplate, Key, Spinner, StatusMark } from '@/components';
import type { HintAction, PreflightHint } from '../preflight';

export interface PreflightListProps {
  hints: readonly PreflightHint[];
  onAction: (a: HintAction) => void;
  /** The planner's reachability estimate is still computing (first call ≈ 1 s): say so while it runs. */
  pending?: boolean;
}

/**
 * "Before you run" (planner-goals.md §6): feasibility and conflict hints, risk first, each with its one-tap remedy, as
 * rows of the card (no boxed notices). Nothing to flag → no card at all.
 */
export function PreflightList({ hints, onAction, pending = false }: PreflightListProps) {
  if (hints.length === 0 && !pending) return null;
  const caption = hints.length ? `${hints.length} note${hints.length === 1 ? '' : 's'}` : 'checking';
  return (
    <Faceplate title="Before you run" caption={caption} className="lp-preflight" aria-busy={pending || undefined}>
      {pending ? (
        <p className="lp-preflight__pending" role="status">
          <Spinner size={16} />
          <span>Checking what a safe rate can reach in this horizon…</span>
        </p>
      ) : null}
      {hints.length ? (
        <ul className="lp-preflight__list" aria-live="polite">
          {hints.map((h) => (
            <li key={h.id} className="lp-hint" data-severity={h.severity}>
              <StatusMark severity={h.severity} size={16} className="lp-hint__mark" />
              <div className="lp-hint__text">
                <p className="lp-hint__title">{h.title}</p>
                {h.body ? <p className="lp-hint__body">{h.body}</p> : null}
              </div>
              {h.action ? (
                <Key size="sm" variant="action" className="lp-hint__action" onClick={() => onAction(h.action!)}>
                  {h.action.label}
                </Key>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Faceplate>
  );
}
