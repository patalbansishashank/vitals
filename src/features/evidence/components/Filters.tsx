import { useId } from 'react';
import { RotateCcw } from 'lucide-react';
import { CATEGORY_LABEL, Chip, GradeBadge, Key, ScrollRail, Swatch, formatNumber } from '@/components';
import type { EvidenceCategory, EvidenceGrade } from '@/content/evidence/schema';
import { GRADE_MEANING } from '../copy';
import { CATEGORY_ORDER, GRADE_ORDER, hasFilters, type EvidenceFilters } from '../data/filters';
import type { Facets } from '../data/search';

export interface FiltersProps {
  filters: EvidenceFilters;
  facets: Facets;
  /** Counts are final (every topic loaded). */
  counting: boolean;
  onToggleCategory: (c: EvidenceCategory) => void;
  onToggleGrade: (g: EvidenceGrade) => void;
  onClear: () => void;
  /** `panel` = desktop left column (vertical); `bar` = mobile (chip rail + key row). */
  layout: 'panel' | 'bar';
}

function CategoryChip({
  c,
  pressed,
  count,
  onToggle,
  hit,
}: {
  c: EvidenceCategory;
  pressed: boolean;
  count: number | null;
  onToggle: () => void;
  hit?: boolean;
}) {
  return (
    <Chip kind="filter" pressed={pressed} onPressedChange={onToggle} className={hit ? 'lm-hit' : undefined}>
      <span className="ev-chipline">
        <Swatch category={c} shape="square" />
        {CATEGORY_LABEL[c]}
        {count !== null ? <span className="ev-count">{formatNumber(count)}</span> : null}
      </span>
    </Chip>
  );
}

/** Category chips (OR within), grade keys (OR within), clear. Groups combine with AND. */
export function Filters({
  filters,
  facets,
  counting,
  onToggleCategory,
  onToggleGrade,
  onClear,
  layout,
}: FiltersProps) {
  const catId = useId();
  const gradeId = useId();
  const active = hasFilters(filters);
  const count = (n: number) => (counting ? null : n);

  const categories = CATEGORY_ORDER.map((c) => (
    <CategoryChip
      key={c}
      c={c}
      pressed={filters.categories.includes(c)}
      count={count(facets.category[c])}
      onToggle={() => onToggleCategory(c)}
      hit={layout === 'bar'}
    />
  ));

  const grades = GRADE_ORDER.map((g) => {
    const on = filters.grades.includes(g);
    const n = facets.grade[g];
    return (
      <Key
        key={g}
        size="sm"
        pressed={on}
        indicator={on}
        onClick={() => onToggleGrade(g)}
        aria-label={`Grade ${g}: ${GRADE_MEANING[g].word.toLowerCase()}${counting ? '' : `, ${n} mechanisms`}`}
        title={`${GRADE_MEANING[g].word}: ${GRADE_MEANING[g].text}`}
        className="ev-gradekey"
      >
        <GradeBadge grade={g} size="sm" tooltip={false} />
        {counting || layout === 'bar' ? null : (
          <span className="ev-count" aria-hidden="true">
            {formatNumber(n)}
          </span>
        )}
      </Key>
    );
  });

  const clear = (
    <Key
      size="sm"
      variant="quiet"
      icon={RotateCcw}
      onClick={onClear}
      disabledReason={active ? undefined : 'No filters are on'}
    >
      Clear
    </Key>
  );

  if (layout === 'bar') {
    return (
      <div className="ev-filterbar">
        <div role="group" aria-labelledby={catId}>
          <span id={catId} className="lm-sr">
            Categories
          </span>
          <ScrollRail gap={6} className="ev-chiprail">
            {categories}
          </ScrollRail>
        </div>
        <div className="ev-filterbar__row">
          <div role="group" aria-labelledby={gradeId} className="ev-grades">
            <span id={gradeId} className="lm-sr">
              Grade
            </span>
            {grades}
          </div>
          {active ? clear : null}
        </div>
      </div>
    );
  }

  return (
    <div className="ev-filters">
      <div className="ev-filters__group" role="group" aria-labelledby={catId}>
        <span id={catId} className="lm-eng">
          categories
        </span>
        <div className="ev-catlist">{categories}</div>
      </div>
      <div className="ev-filters__group" role="group" aria-labelledby={gradeId}>
        <span id={gradeId} className="lm-eng">
          grade
        </span>
        <div className="ev-grades">{grades}</div>
        <a href="#grades" className="ev-link ev-small">
          How grades work
        </a>
      </div>
      <div>{clear}</div>
    </div>
  );
}
