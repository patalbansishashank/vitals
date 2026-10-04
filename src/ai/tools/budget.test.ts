// @vitest-environment node
/** Context budgets (R8 §3.4–§3.6, §5.4, §5.5). */
import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatRequest } from '../providers/types';
import { estimateTextTokens } from '../providers/usage';
import { validate } from './validate';
import { strictProjection } from './render';
import {
  buildSegment,
  capToolResult,
  DAY_SUMMARY_SCHEMA,
  fitBriefing,
  KEEP_RECENT_TURNS,
  needsCompaction,
  shouldSummarise,
  stepLimit,
  type DaySummary,
} from './budget';

const text = (role: ChatMessage['role'], t: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ role, parts: [{ type: 'text', text: t }], ...extra });

describe('fitBriefing', () => {
  const sections = [
    { id: 'date', text: 'Today is Thu 1 Oct 2026.', priority: 10 },
    { id: 'plan', text: 'P'.repeat(700), priority: 8 },
    { id: 'week', text: 'W'.repeat(700), priority: 3 },
    { id: 'supps', text: 'S'.repeat(350), priority: 1 },
  ];

  it('keeps everything when it fits', () => {
    const r = fitBriefing(sections, 3000);
    expect(r.dropped).toEqual([]);
    expect(r.truncated).toEqual([]);
    expect(r.sections.map((s) => s.id)).toEqual(['date', 'plan', 'week', 'supps']);
  });

  it('drops the lowest priority first, then truncates, keeping order', () => {
    const r = fitBriefing(sections, 350);
    expect(r.tokens).toBeLessThanOrEqual(350);
    expect(r.dropped).toEqual(['supps']);
    expect(r.truncated).toEqual(['week']);
    expect(r.sections.map((s) => s.id)).toEqual(['date', 'plan', 'week']);
    expect(r.sections[2]!.text.endsWith('…')).toBe(true);
  });

  it('drops a section entirely when too little room remains', () => {
    const r = fitBriefing(sections, 215);
    expect(r.tokens).toBeLessThanOrEqual(215);
    expect(r.dropped).toEqual(['supps', 'week']);
    expect(r.sections.map((s) => s.id)).toEqual(['date', 'plan']);
  });
});

describe('capToolResult', () => {
  it('returns small data unchanged', () => {
    const data = { a: [1, 2, 3] };
    expect(capToolResult(data, 100)).toEqual({ data, truncated: false });
  });

  it('shrinks arrays from the end, keeps first items, surfaces nextCursor', () => {
    const data = { entries: Array.from({ length: 500 }, (_, i) => ({ id: i, label: `entry number ${i}` })), nextCursor: 'c2' };
    const r = capToolResult(data, 400);
    expect(r.truncated).toBe(true);
    expect(r.hint).toBe('narrow the range or fields');
    expect(r.nextCursor).toBe('c2');
    const out = r.data as typeof data;
    expect(out.entries.length).toBeGreaterThan(0);
    expect(out.entries.length).toBeLessThan(500);
    expect(out.entries[0]).toEqual({ id: 0, label: 'entry number 0' });
    expect(estimateTextTokens(JSON.stringify(out))).toBeLessThanOrEqual(400);
    expect(data.entries).toHaveLength(500);
  });

  it('shortens long strings', () => {
    const r = capToolResult({ note: 'x'.repeat(10_000), id: 'n1' }, 100);
    expect(r.truncated).toBe(true);
    expect((r.data as { id: string }).id).toBe('n1');
    expect(estimateTextTokens(JSON.stringify(r.data))).toBeLessThanOrEqual(100);
  });

  it('falls back to a cut JSON string when nothing can shrink', () => {
    const big = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`key${i}`, i]));
    const r = capToolResult(big, 50);
    expect(r.truncated).toBe(true);
    expect(typeof r.data).toBe('string');
    expect(estimateTextTokens(r.data as string)).toBeLessThanOrEqual(50);
  });
});

describe('thresholds', () => {
  it('shouldSummarise at 30 turns or 60k tokens', () => {
    expect(shouldSummarise({ turns: 29, tokens: 59_999 })).toBe(false);
    expect(shouldSummarise({ turns: 30, tokens: 0 })).toBe(true);
    expect(shouldSummarise({ turns: 1, tokens: 60_000 })).toBe(true);
  });

  it('needsCompaction over 70 % of context', () => {
    const req = (chars: number): ChatRequest => ({ messages: [text('user', 'x'.repeat(chars))] });
    expect(needsCompaction(req(3500 * 0.6), 1000)).toBe(false);
    expect(needsCompaction(req(3500 * 0.8), 1000)).toBe(true);
  });

  it('stepLimit depends on parallel tools', () => {
    expect(stepLimit({ parallelTools: true })).toBe(8);
    expect(stepLimit({ parallelTools: false })).toBe(12);
  });
});

describe('DaySummary', () => {
  const s: DaySummary = { date: '2026-09-30', decisions: ['shift plan by 2 days'], logged: ['dinner'], openQuestions: [], userPrefsLearned: ['no pork'] };

  it('schema validates a summary and is strict-stable', () => {
    expect(validate(DAY_SUMMARY_SCHEMA, s)).toEqual({ ok: true });
    expect(validate(DAY_SUMMARY_SCHEMA, { ...s, extra: 1 }).ok).toBe(false);
    expect(strictProjection(DAY_SUMMARY_SCHEMA)).toEqual(DAY_SUMMARY_SCHEMA);
  });

  it('buildSegment keeps the last N user turns and never splits tool calls from results', () => {
    const history: ChatMessage[] = [];
    for (let i = 0; i < 10; i++) {
      history.push(text('user', `u${i}`));
      history.push(text('assistant', '', { toolCalls: [{ id: `c${i}`, name: 'today_get', args: {}, rawArgs: '{}' }] }));
      history.push(text('tool', '{}', { toolCallId: `c${i}`, toolName: 'today_get' }));
      history.push(text('assistant', `a${i}`));
    }
    const seg = buildSegment([s], history);
    expect(seg[0]!.role).toBe('system');
    expect((seg[0]!.parts[0] as { text: string }).text).toContain('2026-09-30: decided: shift plan by 2 days | logged: dinner | prefers: no pork');
    const rest = seg.slice(1);
    expect(rest.filter((m) => m.role === 'user')).toHaveLength(KEEP_RECENT_TURNS);
    expect(rest[0]).toBe(history[4 * (10 - KEEP_RECENT_TURNS)]);
    expect(rest.at(-1)).toBe(history.at(-1));
    for (let i = 0; i < rest.length; i++) {
      const m = rest[i]!;
      if (m.role === 'tool') expect(rest.slice(0, i).some((p) => p.toolCalls?.some((c) => c.id === m.toolCallId))).toBe(true);
    }
  });

  it('buildSegment with fewer turns keeps the whole history from the first user message', () => {
    const history = [text('system', 'old'), text('user', 'u'), text('assistant', 'a')];
    expect(buildSegment([], history, 6)).toEqual([history[1], history[2]]);
  });
});
