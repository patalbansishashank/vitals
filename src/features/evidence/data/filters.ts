import type { EvidenceCategory, EvidenceGrade } from '@/content/evidence/schema';

/** Design order of the eight metric families (DESIGN_DIRECTION §3.2, `CATEGORY_LABEL`). */
export const CATEGORY_ORDER: readonly EvidenceCategory[] = [
  'body',
  'fuel',
  'energy',
  'cellular',
  'performance',
  'recovery',
  'cardio',
  'hormones',
];
export const GRADE_ORDER: readonly EvidenceGrade[] = ['A', 'B', 'C', 'D'];

/** How the unfiltered index groups its rows. */
export type GroupBy = 'category' | 'topic';

/** Filter groups combine with AND; values within a group with OR (evidence-library.md §7). */
export interface EvidenceFilters {
  categories: readonly EvidenceCategory[];
  grades: readonly EvidenceGrade[];
}

/** Everything the index keeps in the query string: `?q=&cat=&grade=&group=`. */
export interface IndexUrlState extends EvidenceFilters {
  q: string;
  group: GroupBy;
}

export const EMPTY_FILTERS: EvidenceFilters = { categories: [], grades: [] };
export const DEFAULT_INDEX_STATE: IndexUrlState = { q: '', categories: [], grades: [], group: 'category' };

/** Accepted spellings in links: the design calls the family "cardiometabolic". */
const CATEGORY_ALIASES: Record<string, EvidenceCategory> = {
  cardiometabolic: 'cardio',
  'body-composition': 'body',
  ketosis: 'fuel',
  metabolism: 'energy',
  signalling: 'cellular',
  signaling: 'cellular',
  training: 'performance',
  wellbeing: 'recovery',
  appetite: 'hormones',
};

export const isCategory = (v: string): v is EvidenceCategory =>
  (CATEGORY_ORDER as readonly string[]).includes(v);
export const isGrade = (v: string): v is EvidenceGrade => (GRADE_ORDER as readonly string[]).includes(v);

/** Read a multi-value param written as `a,b` or repeated `x=a&x=b`. */
function readList(params: URLSearchParams, key: string): string[] {
  return params
    .getAll(key)
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Keep known values once, in canonical order. */
function canonical<T extends string>(values: Iterable<T>, order: readonly T[]): T[] {
  const set = new Set(values);
  return order.filter((v) => set.has(v));
}

export function parseCategories(values: string[]): EvidenceCategory[] {
  const mapped = values
    .map((v) => v.toLowerCase())
    .map((v) => (isCategory(v) ? v : CATEGORY_ALIASES[v]))
    .filter((v): v is EvidenceCategory => Boolean(v));
  return canonical(mapped, CATEGORY_ORDER);
}

export function parseGrades(values: string[]): EvidenceGrade[] {
  return canonical(values.map((v) => v.toUpperCase()).filter(isGrade), GRADE_ORDER);
}

/** URL → state. Unknown values are dropped silently so a stale link still opens. */
export function parseIndexParams(params: URLSearchParams): IndexUrlState {
  const group = params.get('group');
  return {
    q: (params.get('q') ?? '').slice(0, 200),
    categories: parseCategories(readList(params, 'cat')),
    grades: parseGrades(readList(params, 'grade')),
    // `dossier` is the name older links used for `topic`
    group: group === 'dossier' || group === 'topic' ? 'topic' : 'category',
  };
}

const OWN_KEYS = ['q', 'cat', 'grade', 'group'] as const;

/**
 * State → URL. Unrelated params (e.g. `?theme=dark`) are preserved; empty values
 * are omitted so the clean index stays `/evidence`.
 */
export function writeIndexParams(state: Partial<IndexUrlState>, base?: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(base);
  for (const k of OWN_KEYS) next.delete(k);
  const q = state.q?.trim();
  if (q) next.set('q', q);
  const cats = canonical(state.categories ?? [], CATEGORY_ORDER);
  if (cats.length) next.set('cat', cats.join(','));
  const grades = canonical(state.grades ?? [], GRADE_ORDER);
  if (grades.length) next.set('grade', grades.join(','));
  if (state.group === 'topic') next.set('group', 'topic');
  return next;
}

/** `?q=…` suffix for links into the index ("" when empty). */
export function indexSearch(state: Partial<IndexUrlState>): string {
  const s = writeIndexParams(state).toString();
  return s ? `?${s}` : '';
}

/** Toggle a value in a canonical list. */
export function toggleValue<T extends string>(list: readonly T[], value: T, order: readonly T[]): T[] {
  return canonical(list.includes(value) ? list.filter((v) => v !== value) : [...list, value], order);
}

export const hasFilters = (f: EvidenceFilters): boolean => f.categories.length > 0 || f.grades.length > 0;

/** Stable string key for memo dependencies. */
export const filtersKey = (f: EvidenceFilters): string => `${f.categories.join(',')}|${f.grades.join(',')}`;

export function filtersFromKey(key: string): EvidenceFilters {
  const [c = '', g = ''] = key.split('|');
  return {
    categories: parseCategories(c.split(',').filter(Boolean)),
    grades: parseGrades(g.split(',').filter(Boolean)),
  };
}
