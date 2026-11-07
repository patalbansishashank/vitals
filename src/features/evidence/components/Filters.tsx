import { useId, type ReactNode } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { CATEGORY_LABEL, Icon, InfoKey, Key, Sheet, VisuallyHidden, formatNumber } from '@/components';
import { useReveal } from '@/components/lib/reveal';
import type { EvidenceCategory, EvidenceGrade } from '@/content/evidence/schema';
import { GRADE_MEANING, GRADES_HELP_TITLE, sentence } from '../copy';
import { CATEGORY_ORDER, GRADE_ORDER, hasFilters, type EvidenceFilters } from '../data/filters';
import type { Facets } from '../data/search';

export interface FiltersProps {
  filters: EvidenceFilters;
  facets: Facets;
  /** Counts are not final yet (topics still loading): hide them. */
  counting: boolean;
  onToggleCategory: (c: EvidenceCategory) => void;
  onToggleGrade: (g: EvidenceGrade) => void;
  onClear: () => void;
  /** Opens "How grades work" (the desktop column offers it; the phone sheet relies on the grade words). */
  onGradesHelp?: () => void;
}

/** A chip's count. Spaces are bare text nodes (they survive accessible-name computation; flex layout drops them). */
function Count({ n, unit }: { n: number | null; unit?: [one: string, many: string] }) {
  if (n === null) return null;
  return (
    <>
      {' '}
      <span className="ev-count">
        {formatNumber(n)}
        {unit ? (
          <>
            {' '}
            <VisuallyHidden>{n === 1 ? unit[0] : unit[1]}</VisuallyHidden>
          </>
        ) : null}
      </span>
    </>
  );
}

/** One selectable filter row: its words, its count and a check at the trailing edge (r068 EV-2). */
function FilterRow({
  pressed,
  onToggle,
  children,
  count,
  grade,
  share,
}: {
  pressed: boolean;
  onToggle: () => void;
  children: ReactNode;
  count: ReactNode;
  grade?: EvidenceGrade;
  share?: number;
}) {
  const [ref, pending] = useReveal<HTMLButtonElement>({ animate: share !== undefined });
  return (
    <button
      ref={ref}
      type="button"
      className="ev-frow"
      data-grade={grade}
      aria-pressed={pressed}
      onClick={onToggle}
    >
      <span className="ev-frow__label">{children}</span>
      {count}
      <span className="ev-frow__check" aria-hidden="true">
        {pressed ? <Icon icon={Check} size={16} /> : null}
      </span>
      {share !== undefined ? (
        <span className="ev-frow__share" aria-hidden="true">
          <span style={{ transform: `scaleX(${pending ? 0 : share})` }} />
        </span>
      ) : null}
    </button>
  );
}

/**
 * The library's one filter layer: category rows and grade rows (OR within a group, AND across groups) and Clear.
 * Grade chips read "A Strong", so the letter never needs a legend to be understood.
 */
export function FilterGroups({
  filters,
  facets,
  counting,
  onToggleCategory,
  onToggleGrade,
  onClear,
  onGradesHelp,
}: FiltersProps) {
  const catId = useId();
  const gradeId = useId();
  const count = (n: number) => (counting ? null : n);
  const gradeTotal = GRADE_ORDER.reduce((n, grade) => n + facets.grade[grade], 0);

  return (
    <div className="ev-filters">
      <div className="ev-filters__group" role="group" aria-labelledby={catId}>
        <p id={catId} className="ev-filters__label">
          Category
        </p>
        <div className="ev-frows">
          {CATEGORY_ORDER.map((c) => (
            <FilterRow
              key={c}
              pressed={filters.categories.includes(c)}
              onToggle={() => onToggleCategory(c)}
              count={<Count n={count(facets.category[c])} />}
            >
              {sentence(CATEGORY_LABEL[c])}
            </FilterRow>
          ))}
        </div>
      </div>
      <div className="ev-filters__group" role="group" aria-labelledby={gradeId}>
        <div className="ev-filters__head">
          <p id={gradeId} className="ev-filters__label">
            Grade
          </p>
          {onGradesHelp ? <InfoKey label={GRADES_HELP_TITLE} onClick={onGradesHelp} /> : null}
        </div>
        <div className="ev-frows">
          {GRADE_ORDER.map((g) => (
            <FilterRow
              key={g}
              grade={g}
              share={counting ? undefined : gradeTotal > 0 ? facets.grade[g] / gradeTotal : 0}
              pressed={filters.grades.includes(g)}
              onToggle={() => onToggleGrade(g)}
              count={<Count n={count(facets.grade[g])} unit={['mechanism', 'mechanisms']} />}
            >
              <VisuallyHidden>Grade</VisuallyHidden> <span className="ev-gradechip__g">{g}</span>
              <VisuallyHidden>:</VisuallyHidden> {GRADE_MEANING[g].word}
            </FilterRow>
          ))}
        </div>
      </div>
      {hasFilters(filters) ? (
        <div className="ev-filters__act">
          <Key variant="text" size="sm" icon={RotateCcw} onClick={onClear}>
            Clear filters
          </Key>
        </div>
      ) : null}
    </div>
  );
}

/** Phones: the same filters in a bottom sheet, opened from the key beside the search field. */
export function FilterSheet({
  open,
  onClose,
  ...props
}: FiltersProps & { open: boolean; onClose: () => void }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Filter"
      detents={['half', 'full']}
      footer={
        <div className="ev-sheetfoot">
          <Key variant="primary" block onClick={onClose}>
            Show results
          </Key>
        </div>
      }
    >
      <div className="ev-panelbody">
        <FilterGroups {...props} onGradesHelp={undefined} />
      </div>
    </Sheet>
  );
}
