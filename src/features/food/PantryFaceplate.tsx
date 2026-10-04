/**
 * Food tab › Pantry (design/COMPONENTS.md §14.5, living-mode.md right column): how many things are at home, the 12
 * most recent as chips, a "from your staples:" quick-add row (staples not in the pantry yet) and "Edit pantry" →
 * /food/pantry. Names only: never nutrient numbers.
 */
import { useMemo } from 'react';
import { Chip, Engraved, Faceplate, KeyLink, VisuallyHidden } from '@/components';
import { quickAddPantry, useKitchenView, usePantryView, type PantryView } from './pantryData';

export const RECENT_MAX = 12;
const STAPLES_MAX = 8;

const when = (p: PantryView['items'][number]) => (p.lastConfirmedAt && p.lastConfirmedAt > p.addedAt ? p.lastConfirmedAt : p.addedAt);

export function PantryFaceplate({ className }: { className?: string }) {
  const pantry = usePantryView();
  const kitchen = useKitchenView();
  const items = useMemo(() => pantry.view?.items ?? [], [pantry.view]);
  const recent = useMemo(() => [...items].sort((a, b) => when(b).localeCompare(when(a))).slice(0, RECENT_MAX), [items]);
  const fromStaples = useMemo(() => {
    const have = new Set(items.map((i) => i.id));
    return (kitchen.view?.staples ?? []).filter((s) => !have.has(s.id)).slice(0, STAPLES_MAX);
  }, [items, kitchen.view]);
  const count = items.length;

  return (
    <Faceplate
      id="pantry"
      className={className}
      title="Pantry"
      caption="at home now"
      actions={pantry.view ? <span className="lm-num text-sm text-ink-2">{count === 1 ? '1 item' : `${count} items`}</span> : undefined}
      footer={
        <KeyLink size="sm" to="/food/pantry">
          Edit pantry
        </KeyLink>
      }
    >
      {pantry.loading && !pantry.view ? (
        <p className="m-0 text-sm text-ink-2">Loading…</p>
      ) : pantry.error && !pantry.view ? (
        <p className="m-0 text-sm text-ink-2">{pantry.error}</p>
      ) : count === 0 ? (
        <p className="m-0 text-sm text-ink-2">Nothing listed. You can also tell the Coach what you have at home.</p>
      ) : (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Recently added">
          {recent.map((p) => (
            <li key={p.id}>
              <Chip>{p.qtyApprox ? `${p.label} · ${p.qtyApprox}` : p.label}</Chip>
            </li>
          ))}
          {count > recent.length ? <li className="self-center text-sm text-ink-2">and {count - recent.length} more</li> : null}
        </ul>
      )}
      {fromStaples.length ? (
        <div className="mt-3 grid gap-2">
          <Engraved as="p" className="m-0">
            from your staples:
          </Engraved>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {fromStaples.map((s) => (
              <li key={s.id}>
                <Chip onClick={() => void quickAddPantry([{ id: s.id, label: s.label }])}>
                  <span aria-hidden="true">+ {s.label}</span>
                  <VisuallyHidden>{`Add ${s.label} to the pantry`}</VisuallyHidden>
                </Chip>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Faceplate>
  );
}
