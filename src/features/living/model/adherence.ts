/**
 * Adherence view helpers: E5's `AdherenceScore` → the dial's items (labels, prescription time order). The score, the
 * credits and the weights come from E5; nothing here computes them.
 */
import type { AdherenceScore, PlanItemType, PrescribedDaySnapshot } from '@/living';
import type { DialItem } from '@/features/charts/living/types';
import { fmtHours, mealName } from '../format';

const TYPE_LABEL: Record<PlanItemType, string> = {
  energy: 'Food energy',
  protein: 'Protein',
  window: 'Eating window',
  fast: 'Fast',
  rtSession: 'Strength session',
  cardioSession: 'Cardio session',
  steps: 'Steps',
  sleep: 'Sleep',
  supplement: 'Supplement',
};

/** Plain label of an adherence item, enriched by the prescription when present ("Lift · 45 min"). */
export function itemLabel(itemId: string, type: PlanItemType, rx?: PrescribedDaySnapshot | null): string {
  if ((type === 'rtSession' || type === 'cardioSession') && rx) {
    const slot = itemId.slice(itemId.indexOf(':') + 1);
    const s = rx.sessions.find((x) => x.slotKey === slot);
    if (s) return `${s.kind === 'resistance' ? 'Lift' : 'Cardio'} · ${fmtHours(s.durationMin / 60)}`;
  }
  if (type === 'supplement') {
    const id = itemId.slice(itemId.indexOf(':') + 1);
    return id ? id.charAt(0).toUpperCase() + id.slice(1) : TYPE_LABEL.supplement;
  }
  return TYPE_LABEL[type];
}

/** Clock hour an item sits at, for prescription time order (untimed items last). */
function itemClock(itemId: string, type: PlanItemType, rx?: PrescribedDaySnapshot | null): number {
  if (!rx) return 99;
  if (type === 'window') return rx.window?.startH ?? 50;
  if (type === 'energy' || type === 'protein') return (rx.meals[0]?.clockH ?? 50) + (type === 'protein' ? 0.01 : 0);
  if (type === 'rtSession' || type === 'cardioSession') {
    const slot = itemId.slice(itemId.indexOf(':') + 1);
    return rx.sessions.find((x) => x.slotKey === slot)?.startH ?? 60;
  }
  if (type === 'fast') return -1;
  if (type === 'sleep') return 90;
  if (type === 'steps') return 91;
  return 92;
}

/** The dial's arcs for a scored day, in prescription time order, with tooltip text. */
export function dialItemsOf(score: AdherenceScore | null, rx?: PrescribedDaySnapshot | null): DialItem[] {
  if (!score) return [];
  return [...score.items]
    .sort((a, b) => itemClock(a.itemId, a.type, rx) - itemClock(b.itemId, b.type, rx))
    .map((it) => {
      const label = itemLabel(it.itemId, it.type, rx);
      const counted = it.credit === null ? 'not logged' : `counted ${Math.round(it.credit * 100)} %`;
      return {
        id: it.itemId,
        label,
        weight: it.weight,
        credit: it.credit,
        status: it.credit === null ? 'unknown' : it.credit <= 0 ? 'skipped' : it.credit >= 0.999 ? 'done' : 'partial',
        detail: `${label} · ${counted} · carried ${Math.round(it.weight * 100)} % of the day`,
      } satisfies DialItem;
    });
}

/** Coverage line ("based on 3 of 5 items") only when coverage < 0.6 — E5's rule. */
export { coverageLabel as coverageText } from '@/living';

export { mealName };
