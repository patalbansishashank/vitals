import '../cards/sheets.css';
/**
 * The sheets Today's header and banner open (SPEC §4: plan events are a status capsule that opens the relevant sheet;
 * app-level states are the one banner under the header). Nothing here renders in the page flow.
 * - ChangesSheet: the proposals waiting for the person ("2 changes waiting"), as change cards with Apply / Discard.
 * - PausedSheet: "Plan paused · Since Sat 10 Oct" with Resume plan.
 * - WelcomeBackSheet: once per lapse, "You missed 3 days" · Fill in as planned / Leave empty.
 * (The sheet for entries changed on two devices is shared: ConflictSheet in ../../components/LogConflict.)
 * - SafetyResumeDialog: the acknowledgement before resuming a plan paused for safety (only the person resumes).
 */
import { useNavigate } from 'react-router';
import { Dialog, Key, ResponsivePanel, toast } from '@/components';
import type { LocalDate } from '@/living';
import { useLivingClock } from '../../clock';
import { TODAY_COPY } from '../../copy';
import { useLivingActions, type ActionOutcome } from '../../data/actions';
import { ChangeCard } from '../../components/ChangeCard';
import { fmtDay } from '../../format';
import { livingPaths } from '../../paths';
import { withClock, type ChangeAction, type ChangeCardModel } from '../../model/changeCard';

const C = TODAY_COPY;

/** The cards the changes sheet lists: everything not yet settled (pending, stale) and what was just applied (Undo). */
export function openChanges(changes: readonly ChangeCardModel[], now: Date): ChangeCardModel[] {
  return changes
    .map((c) => withClock(c, now))
    .filter((c) => c.state !== 'discarded' && c.state !== 'expired');
}

/** Proposals still waiting for an answer (the capsule's count). */
export function waitingChanges(changes: readonly ChangeCardModel[], now: Date): number {
  return openChanges(changes, now).filter((c) => c.state === 'pending' || c.state === 'stale').length;
}

/** Apply / discard / undo / redo a change card from Today, with the toast (and its Undo) the person expects. */
export function useChangeActions() {
  const actions = useLivingActions();
  const navigate = useNavigate();
  const say = (o: ActionOutcome, ok: string) => toast(o.ok ? ok : (o.message ?? C.failed));
  return (card: ChangeCardModel) => (action: ChangeAction) => {
    if (action === 'apply')
      void actions
        .applyChange(card.id)
        .then((o) =>
          toast(
            o.ok ? C.changes.applied : (o.message ?? C.failed),
            o.ok && o.undo
              ? {
                  action: {
                    label: C.undo,
                    onClick: () => void o.undo?.().then((u) => say(u, C.changes.undone)),
                  },
                }
              : {},
          ),
        );
    else if (action === 'discard' || action === 'dismiss')
      void actions.discardChange(card.id).then((o) => say(o, C.changes.kept));
    else if (action === 'undo') void actions.undoChange(card.id).then((o) => say(o, C.changes.undone));
    else if (action === 'redo') void actions.redoChange(card.id).then((o) => say(o, C.changes.redone));
    else if (action === 'adjust') navigate(livingPaths.planActive);
  };
}

export function ChangesSheet({
  open,
  onClose,
  changes,
}: {
  open: boolean;
  onClose: () => void;
  changes: readonly ChangeCardModel[];
}) {
  const now = useLivingClock().now();
  const onAction = useChangeActions();
  const cards = openChanges(changes, now);
  return (
    <ResponsivePanel open={open} onClose={onClose} title={C.changes.sheetTitle}>
      <div className="lv-sheet lv-sheet--today">
        {cards.map((c) => (
          <ChangeCard
            key={c.id}
            card={c}
            now={now}
            context="conversation"
            headingLevel="h3"
            onAction={onAction(c)}
          />
        ))}
      </div>
    </ResponsivePanel>
  );
}

export function PausedSheet({
  open,
  onClose,
  since,
  today,
}: {
  open: boolean;
  onClose: () => void;
  since: LocalDate | null;
  today: LocalDate;
}) {
  const actions = useLivingActions();
  const resume = () =>
    void actions.resume(today).then((o) => {
      toast(o.ok ? C.paused.resumed : (o.message ?? C.failed));
      if (o.ok) onClose();
    });
  return (
    <ResponsivePanel open={open} onClose={onClose} title={C.paused.title}>
      <div className="lv-sheet lv-sheet--today">
        {since ? <p className="lv-sheet__fact">{C.paused.since(fmtDay(since))}</p> : null}
        <Key variant="primary" size="lg" block onClick={resume}>
          {C.paused.resume}
        </Key>
      </div>
    </ResponsivePanel>
  );
}

export function WelcomeBackSheet({ gap, onAnswer }: { gap: readonly LocalDate[]; onAnswer: () => void }) {
  const actions = useLivingActions();
  const fill = () =>
    void actions.backfill(gap).then((o) => {
      toast(o.ok ? C.welcome.filled(gap.length) : (o.message ?? C.failed));
      if (o.ok) onAnswer();
    });
  return (
    <ResponsivePanel open onClose={onAnswer} title={C.welcome.title(gap.length)}>
      <div className="lv-sheet lv-sheet--today">
        <Key variant="primary" size="lg" block onClick={fill}>
          {C.welcome.fill}
        </Key>
        <Key variant="text" block onClick={onAnswer}>
          {C.welcome.leave}
        </Key>
      </div>
    </ResponsivePanel>
  );
}

export function SafetyResumeDialog({
  open,
  onClose,
  today,
}: {
  open: boolean;
  onClose: () => void;
  today: LocalDate;
}) {
  const actions = useLivingActions();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={C.safety.ackTitle}
      role="alertdialog"
      footer={
        <>
          <Key variant="text" onClick={onClose}>
            {C.cancel}
          </Key>
          <Key
            variant="danger"
            onClick={() =>
              void actions.resume(today).then((o) => {
                toast(o.ok ? C.paused.resumed : (o.message ?? C.failed));
                if (o.ok) onClose();
              })
            }
          >
            {C.safety.ackKey}
          </Key>
        </>
      }
    >
      <p>{C.safety.ackBody}</p>
    </Dialog>
  );
}
