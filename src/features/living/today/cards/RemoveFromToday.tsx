/**
 * "Remove from Today": the foot of a card's (i) panel (AUDIT §2.5, way in 3), so a person looking at a card they dislike
 * removes it without finding a menu. A text key; the panel's one way out stays the ✕. Absent on the hero.
 */
import { Key, type InfoSpec } from '@/components';

export const REMOVE_FROM_TODAY = 'Remove from Today';

export function RemoveFromToday({ onRemove, title }: { onRemove: () => void; title?: string }) {
  return (
    <Key variant="text" onClick={onRemove} {...(title ? { 'aria-label': `${REMOVE_FROM_TODAY}: ${title}` } : {})}>
      {REMOVE_FROM_TODAY}
    </Key>
  );
}

/** An `InfoSpec` with the "Remove from Today" foot when the card can be removed; otherwise the spec as it is. */
export function withRemoveFoot(info: InfoSpec, onRemove: (() => void) | undefined, title?: string): InfoSpec {
  if (!onRemove) return info;
  return { ...info, footer: <RemoveFromToday onRemove={onRemove} {...(title ? { title } : {})} /> };
}
