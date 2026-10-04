/**
 * Context budgets for the Coach (R8 §3.4, §3.5, §3.6, §5.4, §5.5): briefing fit, tool-result caps, segment
 * summarisation and step limits. Pure functions over canonical types.
 */
import type { Capabilities, ChatMessage, ChatRequest, JsonSchema } from '../providers/types';
import { estimateRequestTokens, estimateTextTokens, CHARS_PER_TOKEN } from '../providers/usage';

/** Static (~1.5k) + dynamic (~1.5k) briefing (R8 §5.4). */
export const BRIEFING_MAX_TOKENS = 3000;
/** A tool result over this is truncated with a hint (R8 §5.5; SUITE_SPEC §1.8 "≤ 4k tokens"). */
export const TOOL_RESULT_MAX_TOKENS = 4000;
/** Start a new segment after this many turns (R8 §5.5). */
export const SUMMARISE_AFTER_TURNS = 30;
/** … or after this many conversation tokens (R8 §5.5). */
export const SUMMARISE_AFTER_TOKENS = 60_000;
/** Turns carried verbatim into a new segment (R8 §5.5). */
export const KEEP_RECENT_TURNS = 6;
/** Tool steps per user turn (R8 §3.4). */
export const MAX_TOOL_STEPS = 8;
/** Step cap when the model cannot call tools in parallel (R8 §3.6). */
export const MAX_TOOL_STEPS_NO_PARALLEL = 12;
/** Output tokens per user turn before the model is told to summarise and stop (R8 §3.4). */
export const MAX_OUTPUT_TOKENS_PER_TURN = 40_000;
/** Compact before sending when the request estimate exceeds this share of `contextTokens` (R8 §3.5). */
export const PREFLIGHT_COMPACT_RATIO = 0.7;

const SECTION_SEPARATOR = '\n\n';
/** A section is truncated rather than dropped only if at least this many tokens of it fit. */
const MIN_TRUNCATED_TOKENS = 24;
const TRUNCATION_MARK = '…';

export interface BriefingSection {
  id: string;
  text: string;
  /** Higher = more important; the lowest goes first. */
  priority: number;
}

export interface FittedBriefing {
  text: string;
  tokens: number;
  /** Kept sections in their original order (some possibly truncated). */
  sections: { id: string; text: string }[];
  dropped: string[];
  truncated: string[];
}

function truncateToTokens(text: string, tokens: number): string {
  const chars = Math.max(0, Math.floor(tokens * CHARS_PER_TOKEN) - TRUNCATION_MARK.length);
  return text.length <= chars ? text : text.slice(0, chars).trimEnd() + TRUNCATION_MARK;
}

/** Drops (or truncates) the lowest-priority sections until the joined text fits `max` tokens. Ties: later first. */
export function fitBriefing(sections: readonly BriefingSection[], max = BRIEFING_MAX_TOKENS): FittedBriefing {
  const kept = sections.map((s, i) => ({ ...s, i }));
  const dropped: string[] = [];
  const truncated: string[] = [];
  const total = () => estimateTextTokens(kept.map((s) => s.text).join(SECTION_SEPARATOR));
  while (kept.length && total() > max) {
    let victim = 0;
    for (let j = 1; j < kept.length; j++) if (kept[j]!.priority <= kept[victim]!.priority) victim = j;
    const v = kept[victim]!;
    const others = kept.filter((_, j) => j !== victim).map((s) => s.text);
    const room = max - estimateTextTokens(others.join(SECTION_SEPARATOR)) - (others.length ? estimateTextTokens(SECTION_SEPARATOR) + 2 : 0);
    if (room >= MIN_TRUNCATED_TOKENS && room < estimateTextTokens(v.text)) {
      kept[victim] = { ...v, text: truncateToTokens(v.text, room) };
      truncated.push(v.id);
      if (total() <= max) break;
    }
    kept.splice(victim, 1);
    dropped.push(v.id);
    const t = truncated.indexOf(v.id);
    if (t >= 0) truncated.splice(t, 1);
  }
  const text = kept.map((s) => s.text).join(SECTION_SEPARATOR);
  return { text, tokens: estimateTextTokens(text), sections: kept.map(({ id, text: t }) => ({ id, text: t })), dropped, truncated };
}

export const TRUNCATION_HINT = 'narrow the range or fields';

export interface CappedResult {
  data: unknown;
  truncated: boolean;
  nextCursor?: string;
  hint?: string;
  /** With `rowsKey`: rows of `data[rowsKey]` before and after the cut (absent when the result became a string). */
  rowsBefore?: number;
  rowsKept?: number;
}

const MIN_STRING_CHARS = 80;
const MAX_SHRINK_ROUNDS = 200;

type Slot = { get: () => unknown; set: (v: unknown) => void };

function collectShrinkable(root: { v: unknown }): Slot[] {
  const out: Slot[] = [];
  const walk = (slot: Slot) => {
    const v = slot.get();
    if (typeof v === 'string') {
      if (v.length > MIN_STRING_CHARS) out.push(slot);
    } else if (Array.isArray(v)) {
      if (v.length > 1) out.push(slot);
      v.forEach((_, i) => walk({ get: () => v[i], set: (x) => { v[i] = x; } }));
    } else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      for (const k of Object.keys(o)) walk({ get: () => o[k], set: (x) => { o[k] = x; } });
    }
  };
  walk({ get: () => root.v, set: (x) => { root.v = x; } });
  return out;
}

function sizeOf(v: unknown): number {
  return (JSON.stringify(v) ?? '').length;
}

/**
 * Caps a tool result to `maxTokens` (R8 §5.5): repeatedly halves the largest array (keeping its first items) or long
 * string until the JSON fits; as a last resort returns a truncated JSON string. A top-level `nextCursor` string in the
 * data is surfaced so the model can page. With `rowsKey`, reports how many rows of the top-level array `data[rowsKey]`
 * were kept (always the first ones), so the caller can point an offset cursor at the first row that was cut.
 */
export function capToolResult(data: unknown, maxTokens = TOOL_RESULT_MAX_TOKENS, rowsKey?: string): CappedResult {
  const json = JSON.stringify(data);
  if (json === undefined || estimateTextTokens(json) <= maxTokens) return { data, truncated: false };
  const cursor = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>).nextCursor : undefined;
  const root = { v: JSON.parse(json) as unknown };
  const rowsOf = (v: unknown): number | undefined => {
    const rows = rowsKey !== undefined && v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>)[rowsKey] : undefined;
    return Array.isArray(rows) ? rows.length : undefined;
  };
  const rowsBefore = rowsOf(root.v);
  for (let round = 0; round < MAX_SHRINK_ROUNDS && estimateTextTokens(JSON.stringify(root.v)) > maxTokens; round++) {
    const slots = collectShrinkable(root);
    if (!slots.length) break;
    let biggest = slots[0]!;
    let biggestSize = sizeOf(biggest.get());
    for (const s of slots.slice(1)) {
      const size = sizeOf(s.get());
      if (size > biggestSize) { biggest = s; biggestSize = size; }
    }
    const v = biggest.get();
    if (typeof v === 'string') biggest.set(v.slice(0, Math.max(MIN_STRING_CHARS, Math.floor(v.length / 2))) + TRUNCATION_MARK);
    else if (Array.isArray(v)) biggest.set(v.slice(0, Math.ceil(v.length / 2)));
  }
  let out = root.v;
  const outJson = JSON.stringify(out);
  if (estimateTextTokens(outJson) > maxTokens) {
    out = truncateToTokens(outJson, Math.max(1, maxTokens - 2));
  }
  const rowsKept = rowsOf(out);
  const rows = rowsBefore !== undefined && rowsKept !== undefined ? { rowsBefore, rowsKept } : {};
  return { data: out, truncated: true, hint: TRUNCATION_HINT, ...(typeof cursor === 'string' ? { nextCursor: cursor } : {}), ...rows };
}

export function shouldSummarise({ turns, tokens }: { turns: number; tokens: number }): boolean {
  return turns >= SUMMARISE_AFTER_TURNS || tokens >= SUMMARISE_AFTER_TOKENS;
}

/** Pre-flight (R8 §3.5): compact first when the request estimate is over 70 % of the context window. */
export function needsCompaction(req: ChatRequest, contextTokens: number): boolean {
  return estimateRequestTokens(req) > PREFLIGHT_COMPACT_RATIO * contextTokens;
}

/** Structured segment summary the model writes at cheap effort (R8 §5.5). */
export interface DaySummary {
  /** LocalDate 'YYYY-MM-DD'. */
  date: string;
  decisions: string[];
  logged: string[];
  openQuestions: string[];
  userPrefsLearned: string[];
}

const stringList: JsonSchema = { type: 'array', items: { type: 'string' } };

/** Strict-compatible (every property required, no extra keys, no stripped keywords). */
export const DAY_SUMMARY_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    date: { type: 'string', description: 'Calendar date YYYY-MM-DD' },
    decisions: { ...stringList, description: 'Decisions the person made or agreed to' },
    logged: { ...stringList, description: 'What was logged, in plain words' },
    openQuestions: { ...stringList, description: 'Questions still open' },
    userPrefsLearned: { ...stringList, description: 'Preferences learned about the person' },
  },
  required: ['date', 'decisions', 'logged', 'openQuestions', 'userPrefsLearned'],
  additionalProperties: false,
};

function summaryLine(s: DaySummary): string {
  const parts = [
    s.decisions.length ? `decided: ${s.decisions.join('; ')}` : '',
    s.logged.length ? `logged: ${s.logged.join('; ')}` : '',
    s.openQuestions.length ? `open: ${s.openQuestions.join('; ')}` : '',
    s.userPrefsLearned.length ? `prefers: ${s.userPrefsLearned.join('; ')}` : '',
  ].filter(Boolean);
  return `${s.date}: ${parts.length ? parts.join(' | ') : 'nothing notable'}`;
}

/**
 * History for a new segment (R8 §5.5): one system message with the summaries, then the history from the `keep`-th
 * last user message onwards. Starting at a user message means an assistant tool call is never separated from its tool
 * results. Messages are reused as-is (append-only; nothing old is edited).
 */
export function buildSegment(summaries: readonly DaySummary[], history: readonly ChatMessage[], keep = KEEP_RECENT_TURNS): ChatMessage[] {
  const userIdx: number[] = [];
  history.forEach((m, i) => { if (m.role === 'user') userIdx.push(i); });
  const start = keep <= 0 ? history.length : userIdx.length === 0 ? history.length : userIdx[Math.max(0, userIdx.length - keep)]!;
  const out: ChatMessage[] = [];
  if (summaries.length) {
    const text = ['Summary of the earlier conversation, one line per day:', ...summaries.map(summaryLine)].join('\n');
    out.push({ role: 'system', parts: [{ type: 'text', text }] });
  }
  return out.concat(history.slice(start));
}

/** Tool steps allowed per user turn for a model (R8 §3.4, §3.6). */
export function stepLimit(caps: Pick<Capabilities, 'parallelTools'>): number {
  return caps.parallelTools ? MAX_TOOL_STEPS : MAX_TOOL_STEPS_NO_PARALLEL;
}
