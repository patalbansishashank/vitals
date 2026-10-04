/**
 * Conversation memory (SUITE_SPEC §5.4): one continuous Coach conversation day after day. Turns carry their segment
 * number; at 30 turns or 60k tokens the earlier days are summarised by the model (`DaySummary`, low effort) and the
 * next requests carry the summaries plus the last 6 turns only.
 *
 * `ConversationStore` is the persistence seam (E9b's `src/commands/coach/store.ts` documents, through the
 * `coach.history` / `coach.conversations` commands); `createMemoryConversationStore` keeps everything in memory
 * (tests, and until the documents are wired).
 */
import type { ChatMessage, ChatModel } from '../providers/types';
import { estimateMessageTokens } from '../providers/usage';
import { DAY_SUMMARY_SCHEMA, KEEP_RECENT_TURNS, shouldSummarise, type DaySummary } from '../tools/budget';
import type { TurnView } from './types';

export interface StoredConversation {
  id: string;
  title: string;
  kind: 'coach' | 'onboarding';
  createdAt: string;
  updatedAt: string;
  segment: number;
}

export interface ConversationStore {
  conversations(): Promise<StoredConversation[]>;
  saveConversation(c: StoredConversation): Promise<void>;
  /** Turns as shown (cards included). */
  appendTurn(conversationId: string, turn: TurnView): Promise<void>;
  updateTurn(conversationId: string, turn: TurnView): Promise<void>;
  listTurns(conversationId: string): Promise<TurnView[]>;
  /** Model messages of the conversation (append-only), with their segment. */
  appendMessages(conversationId: string, segment: number, messages: ChatMessage[]): Promise<void>;
  listMessages(conversationId: string, segment: number): Promise<ChatMessage[]>;
  saveSummaries(conversationId: string, segment: number, summaries: DaySummary[]): Promise<void>;
  listSummaries(conversationId: string): Promise<DaySummary[]>;
}

export function createMemoryConversationStore(): ConversationStore {
  const convs = new Map<string, StoredConversation>();
  const turns = new Map<string, TurnView[]>();
  const messages = new Map<string, Array<{ segment: number; m: ChatMessage }>>();
  const summaries = new Map<string, DaySummary[]>();
  return {
    conversations: async () => [...convs.values()],
    saveConversation: async (c) => void convs.set(c.id, { ...c }),
    appendTurn: async (id, t) => void turns.set(id, [...(turns.get(id) ?? []), t]),
    updateTurn: async (id, t) => void turns.set(id, (turns.get(id) ?? []).map((x) => (x.id === t.id ? t : x))),
    listTurns: async (id) => turns.get(id) ?? [],
    appendMessages: async (id, segment, ms) => void messages.set(id, [...(messages.get(id) ?? []), ...ms.map((m) => ({ segment, m }))]),
    listMessages: async (id, segment) => (messages.get(id) ?? []).filter((x) => x.segment === segment).map((x) => x.m),
    saveSummaries: async (id, _segment, s) => void summaries.set(id, [...(summaries.get(id) ?? []), ...s]),
    listSummaries: async (id) => summaries.get(id) ?? [],
  };
}

/** User turns and estimated tokens of a segment's history. */
export function segmentLoad(history: readonly ChatMessage[]): { turns: number; tokens: number } {
  let turns = 0;
  let tokens = 0;
  for (const m of history) {
    if (m.role === 'user') turns++;
    tokens += estimateMessageTokens(m);
  }
  return { turns, tokens };
}

export function needsSummary(history: readonly ChatMessage[]): boolean {
  return shouldSummarise(segmentLoad(history));
}

/** Index where the last `keep` user turns start (an assistant tool call is never separated from its results). */
export function recentStart(history: readonly ChatMessage[], keep = KEEP_RECENT_TURNS): number {
  const users: number[] = [];
  history.forEach((m, i) => {
    if (m.role === 'user') users.push(i);
  });
  if (users.length <= keep) return 0;
  return users[users.length - keep]!;
}

function transcript(messages: readonly ChatMessage[]): string {
  return messages
    .map((m) => {
      const text = m.parts.map((p) => (p.type === 'text' ? p.text : '[photo]')).join(' ');
      const calls = (m.toolCalls ?? []).map((c) => `${c.name}(${c.rawArgs.slice(0, 200)})`).join(', ');
      return `${m.role}: ${text.slice(0, 1500)}${calls ? ` [calls: ${calls}]` : ''}`;
    })
    .join('\n');
}

const SUMMARIES_SCHEMA = {
  type: 'object',
  properties: { days: { type: 'array', items: DAY_SUMMARY_SCHEMA } },
  required: ['days'],
  additionalProperties: false,
};

function isSummary(v: unknown): v is DaySummary {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  const list = (x: unknown) => Array.isArray(x) && x.every((y) => typeof y === 'string');
  return typeof s.date === 'string' && list(s.decisions) && list(s.logged) && list(s.openQuestions) && list(s.userPrefsLearned);
}

/** Asks the model (low effort) for one `DaySummary` per day of `older`. Throws when the reply is unusable. */
export async function summariseDays(model: ChatModel, older: readonly ChatMessage[], signal?: AbortSignal): Promise<DaySummary[]> {
  const res = await model.complete(
    {
      messages: [
        { role: 'system', parts: [{ type: 'text', text: 'Summarise this coaching conversation, one item per calendar day (YYYY-MM-DD from the messages): decisions, what was logged, open questions, preferences learned. Plain words, no numbers you did not see. Reply with JSON only.' }] },
        { role: 'user', parts: [{ type: 'text', text: transcript(older) }] },
      ],
      responseSchema: { name: 'day_summaries', schema: SUMMARIES_SCHEMA },
      effort: 'low',
      maxOutputTokens: 1500,
    },
    signal,
  );
  if (res.error) throw new Error(res.error.message);
  const text = res.message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const json = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text) as { days?: unknown };
  const days = Array.isArray(json.days) ? json.days.filter(isSummary) : [];
  if (!days.length) throw new Error('No summaries in the reply');
  return days;
}
