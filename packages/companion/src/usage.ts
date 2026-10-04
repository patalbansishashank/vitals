/**
 * AI usage per person on the server (SUITE_SPEC §14.1 `persons/<id>/usage.jsonl`, §14.3 `GET /v1/ai/usage`): one line
 * per AI request `{ at, preset, model, inputTokens, outputTokens, status }`, never prompt text. The daily cap counts
 * the lines of the person's own day (their time zone, not the host's).
 */
import { appendFile, chmod, mkdir, readFile, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface UsageLine {
  at: string;
  preset: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  status: number;
}

export interface UsageSummary {
  today: { requests: number; inputTokens: number; outputTokens: number };
  cap?: { requestsPerDay: number };
}

/** Rotate `usage.jsonl` to `usage.1.jsonl` above this size (about 40 000 lines); the previous rotation is replaced. */
export const USAGE_ROTATE_BYTES = 4 * 1024 * 1024;

/** `YYYY-MM-DD` of an instant in a time zone. */
export function dayIn(timeZone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

export function createUsageLog(opts: { personDir: string; timeZone: () => string; requestsPerDay?: number; now?: () => number }) {
  const { personDir, now = Date.now } = opts;
  // NaN or a negative cap would block every request (`requests >= -1`) or never apply; only a whole number >= 1 is a cap
  const requestsPerDay = typeof opts.requestsPerDay === 'number' && Number.isFinite(opts.requestsPerDay) && opts.requestsPerDay >= 1 ? Math.floor(opts.requestsPerDay) : undefined;
  const file = join(personDir, 'usage.jsonl');
  /** Lines of today counted in memory after the first read, so the cap check does not re-read the file per request. */
  let cache: { day: string; summary: UsageSummary['today'] } | null = null;
  let writing: Promise<void> = Promise.resolve();

  const readToday = async (day: string, tz: string): Promise<UsageSummary['today']> => {
    if (cache?.day === day) return cache.summary;
    const summary = { requests: 0, inputTokens: 0, outputTokens: 0 };
    const text = await readFile(file, 'utf8').catch(() => '');
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const u = JSON.parse(line) as UsageLine;
        if (dayIn(tz, new Date(u.at)) !== day) continue;
        summary.requests += 1;
        summary.inputTokens += Number(u.inputTokens) || 0;
        summary.outputTokens += Number(u.outputTokens) || 0;
      } catch {
        // a torn last line after a crash is skipped
      }
    }
    cache = { day, summary };
    return summary;
  };

  return {
    file,
    async summary(): Promise<UsageSummary> {
      const tz = opts.timeZone();
      await writing;
      const today = { ...(await readToday(dayIn(tz, new Date(now())), tz)) };
      return { today, ...(requestsPerDay ? { cap: { requestsPerDay } } : {}) };
    },
    /** True when the person's daily cap is reached. */
    async capReached(): Promise<boolean> {
      if (!requestsPerDay) return false;
      return (await this.summary()).today.requests >= requestsPerDay;
    },
    append(u: Omit<UsageLine, 'at'>): Promise<void> {
      const at = new Date(now());
      const line: UsageLine = { at: at.toISOString(), preset: u.preset, model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, status: u.status };
      const tz = opts.timeZone();
      const day = dayIn(tz, at);
      writing = writing.then(async () => {
        await mkdir(dirname(file), { recursive: true, mode: 0o700 });
        const size = (await stat(file).catch(() => null))?.size ?? 0;
        if (size > USAGE_ROTATE_BYTES) await rename(file, join(personDir, 'usage.1.jsonl')).catch(() => undefined);
        await appendFile(file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
        await chmod(file, 0o600).catch(() => undefined);
        if (cache?.day === day) {
          cache.summary.requests += 1;
          cache.summary.inputTokens += line.inputTokens;
          cache.summary.outputTokens += line.outputTokens;
        }
      }).catch(() => undefined);
      return writing;
    },
  };
}

export type UsageLog = ReturnType<typeof createUsageLog>;
