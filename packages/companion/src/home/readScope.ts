/**
 * What a derived Gauge read depended on (r087): the windows of time it looked at in the person's `lumen.db`, so a cached
 * answer (`./gaugeReads.ts`) is dropped only by a write that can change it.
 *
 * Every read is synchronous, so the scope is ambient (as the row budget of `./gaugeDerive.ts` is): `withReadDeps` opens
 * one, the store's read helpers note their windows in it, and a scope inside another also counts in the one around it.
 *
 * - `readIntervals` and `readMetricSamples` note their own window.
 * - Raw SQL (`store.all` / `store.get`) has no window the store can see: the caller runs it inside `readWindow`, which
 *   names it. A raw read outside one counts as `all` (any write drops the answer): forgetting the window costs speed,
 *   never correctness.
 * - Windows are closed `[lo, hi]` over observed time and support time alike (a write names both, `StoreChange`), each
 *   with the kind of events it is about (`kindOf` their category): heart rate uploaded now does not touch an answer that
 *   read only this window's sleep.
 */
/** A closed window of time and the kind of events in it. */
export type Window = readonly [lo: number, hi: number, kind: string];

/**
 * The kind a category's events count as, for windows: every metric is one kind (a reading's subject, not its category,
 * names it), the insights are one, and a Health Connect tombstone is about its record.
 */
export function kindOf(category: string): string {
  if (category.startsWith('metrics/') || category.startsWith('vendor/') || category === 'metrics' || category === 'vendor') return 'metric';
  if (category.startsWith('insights/') || category === 'insights') return 'insights';
  return category === 'hc/deleted' ? 'hc/record' : category;
}

export interface ReadDeps {
  ranges: Window[];
  /** A read without a window: any change to the stored events can change the answer. */
  all: boolean;
  /** The detection tables were read. */
  detections: boolean;
}

let current: ReadDeps | null = null;
/** Inside `readWindow`: the raw reads running now lie in a window that is already noted. */
let windowed = false;

const emptyDeps = (): ReadDeps => ({ ranges: [], all: false, detections: false });

/** By kind then start, with the overlapping and touching windows of one kind joined. */
export function mergeWindows(ranges: readonly Window[]): Window[] {
  const xs = [...ranges].sort((a, b) => (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : a[0] - b[0]));
  const out: Array<[number, number, string]> = [];
  for (const [a, b, kind] of xs) {
    const last = out.at(-1);
    if (last && last[2] === kind && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b, kind]);
  }
  return out;
}

/** Whether any window of `a` meets a window of `b` of the same kind (both as `mergeWindows` leaves them). */
export function windowsMeet(a: readonly Window[], b: readonly Window[]): boolean {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i]!;
    const y = b[j]!;
    if (x[2] !== y[2]) {
      if (x[2] < y[2]) i++;
      else j++;
    } else if (x[1] < y[0]) i++;
    else if (y[1] < x[0]) j++;
    else return true;
  }
  return false;
}

/** Notes everything `deps` names in the open scope. */
function addReadDeps(deps: ReadDeps): void {
  if (!current) return;
  for (const r of deps.ranges) current.ranges.push(r);
  current.all ||= deps.all;
  current.detections ||= deps.detections;
}

/**
 * Runs `f` and answers what it read; the scope around it (if any) sees the same reads, unless `apart`: then the caller
 * says itself what the outer scope read (it read more than it will use: a whole day kept for later, of which this
 * answer takes a part).
 */
export function withReadDeps<T>(f: () => T, apart = false): { value: T; deps: ReadDeps } {
  const outer = current;
  const mine = emptyDeps();
  const outerWindowed = windowed;
  current = mine;
  windowed = false;
  try {
    const value = f();
    mine.ranges = mergeWindows(mine.ranges);
    return { value, deps: mine };
  } finally {
    current = outer;
    windowed = outerWindowed;
    if (!apart) addReadDeps(mine);
  }
}

/** A read of the events of `kind` in the closed window `[lo, hi]` (observed or support time). */
export function noteRead(lo: number, hi: number, kind: string): void {
  if (!current) return;
  const last = current.ranges.at(-1);
  // a paged read notes the same window once per page
  if (last && last[0] === lo && last[1] === hi && last[2] === kind) return;
  current.ranges.push([lo, hi, kind]);
}

export function noteDetectionsRead(): void {
  if (current) current.detections = true;
}

/** Runs raw SQL reads (`store.all` / `store.get`) that only look at the events of `kind` in the closed window `[lo, hi]`. */
export function readWindow<T>(lo: number, hi: number, kind: string, f: () => T): T {
  noteRead(lo, hi, kind);
  const outer = windowed;
  windowed = true;
  try {
    return f();
  } finally {
    windowed = outer;
  }
}

/** The store's raw SQL entry: covered by the window around it, else everything. */
export function noteRawRead(): void {
  if (current && !windowed) current.all = true;
}
