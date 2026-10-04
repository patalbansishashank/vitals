/**
 * "Needs: pressure cooker, tawa" on the recipe card and sheet, with "you may not have: …" (ink-2) for equipment the
 * kitchen list does not cover. Only a hint: recipes are never hidden for it.
 */
import { useMemo } from 'react';
import { cx } from '@/components';
import { equipmentLine } from './pantryEquipment';
import { useKitchenCatalogue, useKitchenView } from './pantryData';

export function RecipeEquipmentLine({ equipment, className, bare = false }: { equipment: readonly string[]; className?: string; bare?: boolean }) {
  const { view } = useKitchenView();
  const { catalogue } = useKitchenCatalogue();
  const labels = useMemo(() => (view ? view.equipment.filter((e) => e.use === 'use').map((e) => e.label) : []), [view]);
  const { needs, missing } = useMemo(() => equipmentLine(equipment, labels, catalogue?.index ?? null), [equipment, labels, catalogue]);
  if (!needs.length) return null;
  return (
    <span className={cx('lv-food-needs', className)}>
      {bare ? needs.join(', ') : `Needs: ${needs.join(', ')}`}
      {missing.length ? <span className="text-ink-2"> · you may not have: {missing.join(', ')}</span> : null}
    </span>
  );
}
