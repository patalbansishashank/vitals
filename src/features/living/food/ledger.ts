/**
 * The Food trust ledger (design/screens/living-mode.md, Food › Meals and recipes): how this week's meals were logged —
 * as planned, typed by you, or estimated by the Coach. A count of entries by source; nothing is scored here.
 */
import type { LogEntrySummary, TodayView } from '@/living';

/**
 * How an entry was logged. `LogEntrySummary` carries who (`source`) but not the method or slot yet.
 * TODO(E5): add `method` (EntrySource['method']) and `slot` to `LogEntrySummary`; until then a user entry is "as
 * planned" when its label says so (the stand-in's as-planned label) and "typed" otherwise.
 */
export function entryMethod(e: LogEntrySummary): string | undefined {
  const m = (e as LogEntrySummary & { method?: string }).method;
  if (m) return m;
  if (e.source !== 'user') return undefined;
  return /\bas planned$/i.test(e.label) ? 'asPlanned' : 'typed';
}

/** The slot an entry belongs to, when the summary says so. */
export function entrySlot(e: LogEntrySummary): string | undefined {
  return (e as LogEntrySummary & { slot?: string }).slot;
}

export interface TrustLedger {
  asPlanned: number;
  typed: number;
  coach: number;
  other: number;
  total: number;
  /** More than half of the week's meals were estimated by the Coach. */
  mostlyCoach: boolean;
}

export function trustLedger(views: ReadonlyArray<TodayView | null>): TrustLedger {
  const out: TrustLedger = { asPlanned: 0, typed: 0, coach: 0, other: 0, total: 0, mostlyCoach: false };
  for (const v of views) {
    for (const e of v?.logged.entries ?? []) {
      if (e.kind !== 'meal') continue;
      out.total += 1;
      if (e.aiEstimated || e.source === 'ai') out.coach += 1;
      else if (e.source === 'user') {
        if (entryMethod(e) === 'asPlanned') out.asPlanned += 1;
        else out.typed += 1;
      } else out.other += 1;
    }
  }
  out.mostlyCoach = out.total >= 3 && out.coach * 2 > out.total;
  return out;
}
