import { StackBar, formatNumber } from '@/components';

export interface MacroAmounts {
  proteinG: number;
  carbG: number;
  fatG: number;
}

/** Composition of the named macros, by their energy contribution; this is not a second estimate of meal energy. */
export function macroSplitRows(amounts: MacroAmounts) {
  const parts = [
    { id: 'protein', label: 'Protein', grams: amounts.proteinG, factor: 4 },
    { id: 'carbs', label: 'Carbs', grams: amounts.carbG, factor: 4 },
    { id: 'fat', label: 'Fat', grams: amounts.fatG, factor: 9 },
  ].map((p) => ({ ...p, grams: Number.isFinite(p.grams) ? Math.max(0, p.grams) : 0 }));
  const total = parts.reduce((sum, p) => sum + p.grams * p.factor, 0);
  return parts.map((p) => ({
    id: p.id,
    label: p.label,
    valueText: `${formatNumber(p.grams, 0)} g`,
    share: total > 0 ? (p.grams * p.factor) / total : 0,
    hue: `var(--lm-macro-${p.id})`,
  }));
}

/** One small macro composition, shared by a recipe row, its sheet and the live meal logger. */
export function MacroSplit({
  proteinG,
  carbG,
  fatG,
  quiet = false,
  legend = 'inline',
}: MacroAmounts & { quiet?: boolean; legend?: 'inline' | 'below' | 'none' }) {
  return (
    <StackBar
      label="Macro energy split"
      rows={macroSplitRows({ proteinG, carbG, fatG })}
      size="sm"
      legend={legend}
      quiet={quiet}
      hue="food"
    />
  );
}
