/**
 * Coach conversation persistence (SUITE_SPEC §2, §5.4) in the `conversations` (one document per conversation, LWW-F)
 * and `messages` (append-only) collections:
 *
 * - a conversation is a `conversations` document `{title, kind, createdAt, segment, preset, model, archived?}`;
 * - a turn is a `messages` document `{conversationId, segment, at, role, parts, text, cards?, toolCalls?, toolCallId?,
 *   usage?, changeSetIds?, pendingIds?}`;
 * - a day summary is a `messages` document with `role: 'note'` and `summary: {date, text, turnsCovered,
 *   tokensCovered}` (§5.4: "DaySummary items stored as note messages").
 *
 * The AI loop calls this API directly (reads from the store cache; writes in one transaction under a `derive` token) or
 * the commands call it with `ctx.docs` (`tx`), so the writes join the command's change set. Deleting is a tombstone
 * of the conversation document (`tx.remove`) and, because `messages` is append-only (§2.5), one `{kind: 'retract',
 * target}` message per message, which every reader here treats as the effective view.
 */
import { bodyOf, mintWriteToken, revokeWriteToken, ulid, type Doc, type Tx } from '@/store';
import { getDocumentStore } from '@/state/runtime';

export type TurnRole = 'user' | 'assistant' | 'tool' | 'note';

export interface ToolCallRecord {
  id: string;
  name: string;
  input?: unknown;
  /** Result summary (≤ 4 KB per §2 budget); the loop truncates before storing. */
  output?: unknown;
  ok?: boolean;
}

export interface TurnTokens {
  input: number;
  output: number;
}

export interface Turn {
  id: string;
  conversationId: string;
  segment: number;
  at: string;
  role: TurnRole;
  text: string;
  /** Change cards (§5.5) as JSON. */
  cards?: unknown[];
  toolCalls?: ToolCallRecord[];
  toolCallId?: string;
  tokens?: TurnTokens;
  changeSetIds?: string[];
  pendingIds?: string[];
  /** The Coach loop's own record (settled turn view, model messages); opaque to readers here. */
  coach?: unknown;
}

export type TurnInput = Omit<Turn, 'id' | 'conversationId' | 'segment' | 'at'> & { id?: string; at?: string; segment?: number };

export interface ConversationRecord {
  id: string;
  title: string;
  kind: 'coach' | 'onboarding';
  createdAt: string;
  segment: number;
  preset: string;
  model: string;
  archived?: boolean;
}

export interface ConversationSummary extends ConversationRecord {
  lastAt: string;
  turnCount: number;
}

export interface DaySummaryRecord {
  id: string;
  conversationId: string;
  segment: number;
  /** LocalDate the summary covers. */
  date: string;
  text: string;
  turnsCovered: number;
  tokensCovered: number;
  /** Structured form the Coach keeps (decisions, logged, open questions, preferences). */
  detail?: unknown;
  /** Instant it was written. */
  at: string;
}

export type DaySummaryInput = Omit<DaySummaryRecord, 'id' | 'conversationId' | 'segment' | 'at'> & { segment?: number; at?: string };

type Write = Pick<Tx, 'append' | 'put' | 'patch' | 'remove'>;

interface MessageBody {
  conversationId: string;
  segment: number;
  at: string;
  role: TurnRole;
  parts?: Array<{ type: 'text'; text: string }>;
  text?: string;
  cards?: unknown[];
  toolCalls?: ToolCallRecord[];
  toolCallId?: string;
  usage?: { inputTokens: number; outputTokens: number };
  changeSetIds?: string[];
  pendingIds?: string[];
  coach?: unknown;
  summary?: { date: string; text: string; turnsCovered: number; tokensCovered: number; detail?: unknown };
  /** §2.5 retract entry: `target` is the message it removes from the effective view. */
  kind?: 'retract';
  target?: string;
}

type ConversationBody = Omit<ConversationRecord, 'id'>;

async function ready() {
  const store = getDocumentStore();
  await store.ready;
  return store;
}

async function write<R>(tx: Tx | undefined, fn: (tx: Write) => Promise<R>): Promise<R> {
  if (tx) return fn(tx);
  const store = await ready();
  const token = mintWriteToken('derive', { label: 'coach.store' });
  try {
    return await store.transact(token, fn);
  } finally {
    revokeWriteToken(token);
  }
}

const conversationOf = (d: Doc<ConversationBody>): ConversationRecord => ({ ...(bodyOf(d as unknown as Record<string, unknown>) as unknown as ConversationBody), id: d._id });

function turnOf(d: Doc<MessageBody>): Turn {
  const b = bodyOf(d as unknown as Record<string, unknown>) as unknown as MessageBody;
  return {
    id: d._id,
    conversationId: b.conversationId,
    segment: b.segment,
    at: b.at,
    role: b.role,
    text: b.text ?? b.parts?.map((p) => p.text).join('') ?? '',
    ...(b.cards ? { cards: b.cards } : {}),
    ...(b.toolCalls ? { toolCalls: b.toolCalls } : {}),
    ...(b.toolCallId ? { toolCallId: b.toolCallId } : {}),
    ...(b.usage ? { tokens: { input: b.usage.inputTokens, output: b.usage.outputTokens } } : {}),
    ...(b.changeSetIds ? { changeSetIds: b.changeSetIds } : {}),
    ...(b.pendingIds ? { pendingIds: b.pendingIds } : {}),
    ...(b.coach !== undefined ? { coach: b.coach } : {}),
  };
}

const bySequence = (a: { at: string; id: string }, b: { at: string; id: string }): number => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Effective messages (neither retracted nor retract entries), optionally of one conversation. */
async function effectiveMessages(conversationId?: string): Promise<Array<Doc<MessageBody>>> {
  const store = await ready();
  const all = store.peekAll<MessageBody>('messages');
  const retracted = new Set(all.flatMap((d) => ((d as unknown as MessageBody).kind === 'retract' && (d as unknown as MessageBody).target ? [(d as unknown as MessageBody).target!] : [])));
  return all.filter((d) => (d as unknown as MessageBody).kind !== 'retract' && !retracted.has(d._id) && (conversationId === undefined || (d as unknown as MessageBody).conversationId === conversationId));
}

const messagesOf = (conversationId: string): Promise<Array<Doc<MessageBody>>> => effectiveMessages(conversationId);

/** Create a conversation document (the Coach tab's "new conversation", or the onboarding conversation). */
export async function createConversation(
  init: { id?: string; title?: string; kind?: 'coach' | 'onboarding'; preset?: string; model?: string; now?: string },
  tx?: Tx,
): Promise<ConversationRecord> {
  const id = init.id ?? ulid();
  const body: ConversationBody = {
    title: init.title ?? 'New conversation',
    kind: init.kind ?? 'coach',
    createdAt: init.now ?? new Date().toISOString(),
    segment: 1,
    preset: init.preset ?? '',
    model: init.model ?? '',
  };
  await write(tx, (w) => w.put<ConversationBody>('conversations', { ...body, _id: id }));
  return { ...body, id };
}

export async function getConversation(id: string): Promise<ConversationRecord | null> {
  const store = await ready();
  const d = store.peek<ConversationBody>('conversations', id);
  return d && !d._deleted ? conversationOf(d) : null;
}

/** Conversations with last activity and turn count, most recent first. Day summaries are not counted as turns. */
export async function listConversations(opts: { includeArchived?: boolean } = {}): Promise<ConversationSummary[]> {
  const store = await ready();
  const all = await effectiveMessages();
  const stats = new Map<string, { lastAt: string; turns: number }>();
  for (const m of all) {
    const b = m as unknown as MessageBody;
    const s = stats.get(b.conversationId) ?? { lastAt: '', turns: 0 };
    if (b.role !== 'note') {
      s.turns += 1;
      if (b.at > s.lastAt) s.lastAt = b.at;
    }
    stats.set(b.conversationId, s);
  }
  return store
    .peekAll<ConversationBody>('conversations')
    .map(conversationOf)
    .filter((c) => opts.includeArchived || !c.archived)
    .map((c) => ({ ...c, lastAt: stats.get(c.id)?.lastAt || c.createdAt, turnCount: stats.get(c.id)?.turns ?? 0 }))
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : a.id < b.id ? 1 : -1));
}

/** Append one turn. Creates the conversation (titled from the first user text) when it does not exist yet. */
export async function appendTurn(conversationId: string, turn: TurnInput, tx?: Tx): Promise<Turn> {
  const conv = await getConversation(conversationId);
  const at = turn.at ?? new Date().toISOString();
  const id = turn.id ?? ulid();
  const segment = turn.segment ?? conv?.segment ?? 1;
  const body: MessageBody = {
    conversationId,
    segment,
    at,
    role: turn.role,
    parts: [{ type: 'text', text: turn.text }],
    text: turn.text,
    ...(turn.cards?.length ? { cards: turn.cards } : {}),
    ...(turn.toolCalls?.length ? { toolCalls: turn.toolCalls } : {}),
    ...(turn.toolCallId ? { toolCallId: turn.toolCallId } : {}),
    ...(turn.tokens ? { usage: { inputTokens: turn.tokens.input, outputTokens: turn.tokens.output } } : {}),
    ...(turn.changeSetIds?.length ? { changeSetIds: turn.changeSetIds } : {}),
    ...(turn.pendingIds?.length ? { pendingIds: turn.pendingIds } : {}),
    ...(turn.coach !== undefined ? { coach: turn.coach } : {}),
  };
  await write(tx, async (w) => {
    if (!conv) {
      const title = turn.role === 'user' ? turn.text.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
      await w.put<ConversationBody>('conversations', { _id: conversationId, title: title || 'New conversation', kind: 'coach', createdAt: at, segment, preset: '', model: '' });
    }
    await w.append<MessageBody>('messages', { ...body, _id: id });
  });
  return turnOf({ ...(body as unknown as Doc<MessageBody>), _id: id } as Doc<MessageBody>);
}

/** Patch a conversation's title or segment (LWW). */
export async function updateConversation(conversationId: string, patch: { title?: string; segment?: number }, tx?: Tx): Promise<void> {
  await write(tx, (w) => w.patch('conversations', conversationId, patch));
}

/** Start a new segment (§5.4: after summarising at 30 turns or 60k tokens). Returns the new segment number. */
export async function startSegment(conversationId: string, tx?: Tx): Promise<number> {
  const conv = await getConversation(conversationId);
  const next = (conv?.segment ?? 1) + 1;
  await write(tx, (w) => w.patch('conversations', conversationId, { segment: next }));
  return next;
}

/**
 * Turns of a conversation in time order (oldest first; day summaries excluded unless `includeNotes`). With `limit` the
 * LAST `limit` turns are returned (the newest page); `before` (a turn id) pages backwards from there.
 */
export async function listTurns(conversationId: string, opts: { before?: string; limit?: number; segment?: number; includeNotes?: boolean } = {}): Promise<Turn[]> {
  let turns = (await messagesOf(conversationId))
    .map(turnOf)
    .filter((t) => (opts.includeNotes || t.role !== 'note') && (opts.segment === undefined || t.segment === opts.segment))
    .sort(bySequence);
  if (opts.before) {
    const i = turns.findIndex((t) => t.id === opts.before);
    if (i >= 0) turns = turns.slice(0, i);
  }
  return opts.limit !== undefined ? turns.slice(Math.max(0, turns.length - opts.limit)) : turns;
}

/** Store a day summary (a `note` message). */
export async function saveSummary(conversationId: string, summary: DaySummaryInput, tx?: Tx): Promise<DaySummaryRecord> {
  const conv = await getConversation(conversationId);
  const at = summary.at ?? new Date().toISOString();
  const id = ulid();
  const segment = summary.segment ?? conv?.segment ?? 1;
  const { date, text, turnsCovered, tokensCovered, detail } = summary;
  await write(tx, async (w) => {
    if (!conv) await w.put<ConversationBody>('conversations', { _id: conversationId, title: 'New conversation', kind: 'coach', createdAt: at, segment, preset: '', model: '' });
    await w.append<MessageBody>('messages', { _id: id, conversationId, segment, at, role: 'note', parts: [{ type: 'text', text }], text, summary: { date, text, turnsCovered, tokensCovered, ...(detail !== undefined ? { detail } : {}) } });
  });
  return { id, conversationId, segment, date, text, turnsCovered, tokensCovered, ...(detail !== undefined ? { detail } : {}), at };
}

/** Day summaries of a conversation (or of all, when `conversationId` is null), oldest first. */
export async function listSummaries(conversationId: string | null, opts: { from?: string; to?: string } = {}): Promise<DaySummaryRecord[]> {
  const out: DaySummaryRecord[] = [];
  for (const d of await effectiveMessages()) {
    const b = d as unknown as MessageBody;
    if (b.role !== 'note' || !b.summary || (conversationId !== null && b.conversationId !== conversationId)) continue;
    if ((opts.from && b.summary.date < opts.from) || (opts.to && b.summary.date > opts.to)) continue;
    out.push({ id: d._id, conversationId: b.conversationId, segment: b.segment, at: b.at, ...b.summary });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : bySequence(a, b)));
}

/** Tombstone a conversation and all its messages (retract entries). Returns false when there was nothing to delete. */
export async function deleteConversation(conversationId: string, tx?: Tx): Promise<boolean> {
  const conv = await getConversation(conversationId);
  const msgs = await messagesOf(conversationId);
  if (!conv && msgs.length === 0) return false;
  await write(tx, async (w) => {
    const at = new Date().toISOString();
    for (const m of msgs) await w.append<MessageBody>('messages', { _id: ulid(), conversationId, segment: 0, at, role: 'note', kind: 'retract', target: m._id });
    if (conv) await w.remove('conversations', conversationId);
  });
  return true;
}
