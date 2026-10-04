/**
 * Notices on Today (living-mode.md §3), in priority order, at most two visible, then "+n more": safety pause, danger
 * warnings, proposals waiting (change cards), applied automatic changes with Undo, check-in due, then welcome back /
 * minimal mode / sync. Notices are faceplate text with a drawn status mark (REVIEW_FINDINGS #5); proposals are change
 * cards (COMPONENTS §13.11) — Apply never pre-focused.
 */
import { useState, type ReactNode } from 'react';
import { Key, Notice, energyInText, toast, type Severity } from '@/components';
import { useEnergyUnit } from '@/state/settingsStore';
import type { Notice as LivingNotice } from '@/living';
import { useLivingClock } from '../../clock';
import { TODAY_COPY } from '../../copy';
import { useLivingActions, type ActionOutcome } from '../../data/actions';
import { ChangeCard } from '../../components/ChangeCard';
import { withClock, type ChangeAction, type ChangeCardModel } from '../../model/changeCard';

interface ZoneItem {
  key: string;
  rank: number;
  node: ReactNode;
}

const LEVEL: Record<LivingNotice['level'], Severity> = { info: 'info', caution: 'caution', danger: 'danger' };

export interface NoticesZoneProps {
  notices: readonly LivingNotice[];
  changes: readonly ChangeCardModel[];
  /** Extra notices rendered by the page (paused, welcome back, check-in card…), already ranked. */
  extra?: ReadonlyArray<{ key: string; rank: number; node: ReactNode }>;
  onCheckIn: () => void;
}

export function NoticesZone({ notices, changes, extra = [], onCheckIn }: NoticesZoneProps) {
  const eu = useEnergyUnit();
  const actions = useLivingActions();
  const now = useLivingClock().now();
  const [all, setAll] = useState(false);
  const say = (o: ActionOutcome, ok: string) => toast(o.ok ? ok : (o.message ?? 'That didn’t work. Try again.'));
  const onAction = (card: ChangeCardModel) => (action: ChangeAction) => {
    if (action === 'apply')
      void actions.applyChange(card.id).then((o) =>
        toast(
          o.ok ? 'Applied. The plan is updated.' : (o.message ?? 'That didn’t work. Try again.'),
          o.ok && o.undo ? { action: { label: 'Undo', onClick: () => void o.undo?.().then((u) => say(u, 'Undone. The plan is as it was.')) } } : {},
        ),
      );
    else if (action === 'discard' || action === 'dismiss') void actions.discardChange(card.id).then((o) => say(o, 'Kept the plan as it was.'));
    else if (action === 'undo') void actions.undoChange(card.id).then((o) => say(o, 'Undone.'));
    else if (action === 'redo') void actions.redoChange(card.id).then((o) => say(o, 'Redone.'));
    else if (action === 'adjust') toast('Ask the Coach to change it, or open Plan details.');
  };
  const items: ZoneItem[] = [...extra];
  for (const n of notices) {
    if (n.kind === 'checkIn') {
      items.push({
        key: n.id,
        rank: 5,
        node: (
          <Notice severity="info" layout="ruled" title={energyInText(n.text, eu)} actions={<Key size="sm" onClick={onCheckIn}>{TODAY_COPY.checkIn}</Key>} />
        ),
      });
    } else if (n.kind !== 'welcomeBack' && n.kind !== 'info') {
      items.push({ key: n.id, rank: n.level === 'danger' ? 1 : n.kind === 'burden' ? 6 : 6, node: <Notice severity={LEVEL[n.level]} layout="ruled" title={energyInText(n.text, eu)} /> });
    }
  }
  for (const c of changes.map((x) => withClock(x, now))) {
    if (c.state === 'discarded' || c.state === 'expired') continue;
    const rank = c.state === 'pending' || c.state === 'stale' ? 3 : 4;
    items.push({ key: c.id, rank, node: <ChangeCard card={c} now={now} context="standalone" onAction={onAction(c)} /> });
  }
  items.sort((a, b) => a.rank - b.rank);
  if (items.length === 0) return null;
  const shown = all ? items : items.slice(0, 2);
  return (
    <div className="lv-notices" role="region" aria-label="Notices">
      {shown.map((i) => (
        <div key={i.key} className="lv-notices__item">
          {i.node}
        </div>
      ))}
      {items.length > 2 ? (
        <Key size="sm" variant="quiet" onClick={() => setAll((a) => !a)} aria-expanded={all}>
          {all ? 'Show fewer' : TODAY_COPY.notices.more(items.length - 2)}
        </Key>
      ) : null}
    </div>
  );
}
