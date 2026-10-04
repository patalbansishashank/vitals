/**
 * AI usage ledger (R8 §3.5, settings-sync-ai.md §5.6): token totals and estimated cost per day, provider and model.
 * The Coach runtime appends one `UsageLedgerRow` per request (`recordAiUsage`, passing the preset's price for the
 * model when the server reported no cost); `ai.usage` and Settings › AI provider read the summaries. Rows are folded
 * into daily buckets, one `aiUsage` document per day × preset × model (device-local, never exported or synced; 400
 * days kept). Costs are estimates; the provider's bill is the truth.
 */
import type { UsageLedgerRow } from '@/ai/providers/usage';
import { mintWriteToken, revokeWriteToken, type Doc, type DocumentStore } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { readAiConfig } from './config';

const COL = 'aiUsage' as const;
const KEEP_DAYS = 400;

/** USD per 1M tokens (the shape of `RecommendedModel.price`). */
export interface UsagePrice {
  input: number;
  output: number;
  cachedInput?: number;
}

export interface UsageBucket {
  /** Local calendar day `YYYY-MM-DD`. */
  day: string;
  preset: string;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** Known or price-table cost in USD; requests without a price add nothing and count in `unpriced`. */
  costUsd: number;
  unpriced: number;
  /** Any token count in the bucket was estimated, not reported by the server. */
  estimated: boolean;
}

export interface UsageTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
  unpriced: number;
  estimated: boolean;
}

export interface UsageByProvider extends UsageTotals {
  preset: string;
  model: string;
}

export interface UsageSummary {
  from: string;
  to: string;
  totals: UsageTotals;
  byProvider: UsageByProvider[];
  periods: { today: UsageTotals; last7Days: UsageTotals; last30Days: UsageTotals; thisMonth: UsageTotals };
  spendCapUsdMonthly: number | null;
  /** This month's cost over the cap (null without a cap). */
  capFraction: number | null;
  /** At or over 80 % of the cap. */
  capWarning: boolean;
  atCap: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar day of an instant or Date. */
export function localDay(at: string | Date): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `day` shifted by `delta` calendar days. */
export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

const isBucket = (b: unknown): b is UsageBucket => {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  return typeof o.day === 'string' && typeof o.preset === 'string' && typeof o.model === 'string' && typeof o.requests === 'number' && typeof o.costUsd === 'number';
};

const bucketId = (day: string, preset: string, model: string) => `${day}|${preset}|${model}`;

function bucketOf(d: Doc<unknown>): UsageBucket | null {
  if ((d as { _deleted?: unknown })._deleted) return null;
  return isBucket(d) ? d : null;
}

/** Every daily bucket in the current document store (sync read of the loaded cache). */
export function readUsageBuckets(store: DocumentStore = getDocumentStore()): UsageBucket[] {
  return store.peekAll<UsageBucket>(COL).flatMap((d) => bucketOf(d as Doc<unknown>) ?? []);
}

const listeners = new Set<() => void>();
let watched: DocumentStore | null = null;

/** Called after any usage change (this device's Coach calls, imports, erase). */
export function onAiUsageChange(fn: () => void): () => void {
  const store = getDocumentStore();
  if (watched !== store) {
    watched = store;
    store.subscribe((c) => {
      if (c.col === COL && watched === store) listeners.forEach((l) => l());
    });
  }
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function costOf(row: UsageLedgerRow, price: UsagePrice | undefined): number | undefined {
  if (row.costUsd !== null) return row.costUsd;
  if (!price) return undefined;
  const fresh = Math.max(0, row.in - row.cached);
  return (fresh * price.input + row.cached * (price.cachedInput ?? price.input) + row.out * price.output) / 1e6;
}

/** Appends one request's usage (the Coach runtime calls this after every model call). */
export async function recordAiUsage(row: UsageLedgerRow, price?: UsagePrice): Promise<void> {
  const day = localDay(row.ts);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  const cost = costOf(row, price);
  const store = getDocumentStore();
  await store.ready;
  const token = mintWriteToken('derive', { label: 'ai.usage' });
  try {
    await store.transact(token, async (tx) => {
      const id = bucketId(day, row.preset, row.model);
      const prev = await tx.get<UsageBucket>(COL, id);
      const b: UsageBucket = (prev && bucketOf(prev as Doc<unknown>)) || {
        day, preset: row.preset, model: row.model, requests: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0, unpriced: 0, estimated: false,
      };
      await tx.put<UsageBucket>(COL, {
        _id: id,
        day, preset: row.preset, model: row.model,
        requests: b.requests + 1,
        inputTokens: b.inputTokens + row.in,
        outputTokens: b.outputTokens + row.out,
        cachedInputTokens: b.cachedInputTokens + row.cached,
        costUsd: b.costUsd + (cost ?? 0),
        unpriced: b.unpriced + (cost === undefined ? 1 : 0),
        estimated: b.estimated || row.estimated,
      });
      // retention: drop buckets older than KEEP_DAYS
      const oldest = addDays(day, -KEEP_DAYS);
      for (const old of readUsageBuckets(store)) if (old.day < oldest) await tx.remove(COL, bucketId(old.day, old.preset, old.model));
    });
  } finally {
    revokeWriteToken(token);
  }
}

const empty = (): UsageTotals => ({ requests: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0, unpriced: 0, estimated: false });

function add(t: UsageTotals, b: UsageTotals): void {
  t.requests += b.requests;
  t.inputTokens += b.inputTokens;
  t.outputTokens += b.outputTokens;
  t.cachedInputTokens += b.cachedInputTokens;
  t.costUsd += b.costUsd;
  t.unpriced += b.unpriced;
  t.estimated ||= b.estimated;
}

function total(buckets: UsageBucket[], from: string, to: string): UsageTotals {
  const t = empty();
  for (const b of buckets) if (b.day >= from && b.day <= to) add(t, b);
  return t;
}

/** Totals for `from..to` (inclusive local days; default the last 30 days) plus the standard periods and cap state. */
export function summarizeAiUsage(opts: { today: string; from?: string; to?: string; buckets?: UsageBucket[]; spendCapUsdMonthly?: number | null }): UsageSummary {
  const buckets = opts.buckets ?? readUsageBuckets();
  const to = opts.to ?? opts.today;
  const from = opts.from ?? addDays(to, -29);
  const byKey = new Map<string, UsageByProvider>();
  for (const b of buckets) {
    if (b.day < from || b.day > to) continue;
    const k = `${b.preset}|${b.model}`;
    let row = byKey.get(k);
    if (!row) {
      row = { preset: b.preset, model: b.model, ...empty() };
      byKey.set(k, row);
    }
    add(row, b);
  }
  const thisMonth = total(buckets, `${opts.today.slice(0, 8)}01`, opts.today);
  const cap = opts.spendCapUsdMonthly === undefined ? (readAiConfig()?.spendCapUsdMonthly ?? null) : opts.spendCapUsdMonthly;
  const capFraction = cap ? thisMonth.costUsd / cap : null;
  return {
    from,
    to,
    totals: total(buckets, from, to),
    byProvider: [...byKey.values()].sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests),
    periods: {
      today: total(buckets, opts.today, opts.today),
      last7Days: total(buckets, addDays(opts.today, -6), opts.today),
      last30Days: total(buckets, addDays(opts.today, -29), opts.today),
      thisMonth,
    },
    spendCapUsdMonthly: cap,
    capFraction,
    capWarning: capFraction !== null && capFraction >= 0.8,
    atCap: capFraction !== null && capFraction >= 1,
  };
}
