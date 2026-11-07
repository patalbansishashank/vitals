/**
 * Food's small panels (from the header ⋯): Things that won't help your goals (the no-benefit list with reasons) and
 * Use what's in my kitchen (recipes from the pantry). There is one pantry — the document /food/pantry edits — and the
 * kitchen panel reads it and links there; it never keeps a list of its own.
 */
import { ChevronRight } from 'lucide-react';
import { GradeBadge, Key, KeyLink, ResponsivePanel } from '@/components';
import { usePantryView } from '@/features/food/pantryData';
import { FOOD_COPY } from '../copy';
import { noBenefitItems } from '../supplements';

export function NoBenefitPanel({ open, onClose }: { open: boolean; onClose(): void }) {
  const items = noBenefitItems();
  return (
    <ResponsivePanel open={open} onClose={onClose} title={FOOD_COPY.noBenefit.title}>
      <div className="lv-food-sheet">
        <ul className="lv-food-nobenefit">
          {items.map((i) => (
            <li key={i.record.id}>
              <span className="lv-food-nobenefit__name">{i.name}</span>
              <GradeBadge grade={i.grade} size="sm" />
              <span className="lv-food-note lv-food-nobenefit__why">{i.reason}</span>
            </li>
          ))}
        </ul>
      </div>
    </ResponsivePanel>
  );
}

export interface KitchenPanelProps {
  open: boolean;
  onClose(): void;
  /** Why recipes can't be made now (food rules not answered, past day, nothing open), or null. */
  blocked: { reason: string; link?: { to: string; label: string } } | null;
  /** Plan the open meals from these pantry items (names). */
  onRun(pantry: string[]): void;
}

export function KitchenPanel({ open, onClose, blocked, onRun }: KitchenPanelProps) {
  const K = FOOD_COPY.kitchen;
  const pantry = usePantryView();
  const items = pantry.view?.items ?? [];
  const footer = blocked ? undefined : (
    <Key variant="primary" onClick={() => onRun(items.map((i) => i.label))} disabledReason={items.length === 0 ? K.needPantry : undefined}>
      {K.run}
    </Key>
  );
  return (
    <ResponsivePanel open={open} onClose={onClose} title={K.title} footer={footer}>
      <div className="lv-food-sheet">
        {blocked ? (
          <p className="lv-food-sheet__state">
            {blocked.reason}{' '}
            {blocked.link ? (
              <KeyLink to={blocked.link.to} variant="text" size="sm">
                {blocked.link.label}
              </KeyLink>
            ) : null}
          </p>
        ) : null}
        <KeyLink to="/food/pantry" variant="text" trailingIcon={ChevronRight} className="lv-food-sheet__row">
          {K.pantryRow(items.length)}
        </KeyLink>
      </div>
    </ResponsivePanel>
  );
}
