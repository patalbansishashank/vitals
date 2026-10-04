/**
 * The real Coach adapter (`CoachAdapter`, src/features/living/coach/adapter.ts) over `src/ai`: the conversation loop
 * (SUITE_SPEC §5.2) on a `ChatModel`, the standing briefing rebuilt by code every turn (§5.3), tools generated from the
 * command registry and run through the bus by confirmation class (§1.8, §5.5, §5.7), conversation segments with day
 * summaries (§5.4), the photo flow (§5.6) and capability degradation (R8 §3.6).
 *
 *   const adapter = createCoachAdapter({ bus, model, provider: { name: 'Anthropic', model: 'Claude Sonnet 5.5' } });
 *
 * Tier H: the UI-specific pieces (visible briefing rendering, blob store, availability flag) are injected by
 * `runtime.ts` / `CoachRuntimeProvider.tsx`.
 */
import { appDay } from '@/living/appDay';
import { addDays } from '@/living/dates';
import type { ChatMessage, ChatModel, ChatRequest, ProviderErrorInfo, ToolCall, Usage } from '../providers/types';
import { abortableSleep } from '../providers/retry';
import { addUsage } from '../providers/usage';
import { stepLimit, type DaySummary } from '../tools/budget';
import { buildBriefing, gatherBriefingData, type BuiltBriefing, type VisibleBriefingInput } from './briefing';
import { readCard } from './cards';
import { createMemoryConversationStore, needsSummary, recentStart, summariseDays, type ConversationStore } from './conversation';
import { CoachExecutor, type TurnContext } from './executor';
import { extractJsonObject } from './modelJson';
import { CoachToolset, type CoachBus, type Tier } from './tools';
import {
  MAIN_CONVERSATION,
  type BriefingModelView,
  type CardAction,
  type CardActionExtra,
  type CardModel,
  type CardView,
  type CoachAdapterShape,
  type CoachStatusView,
  type ConversationSummaryView,
  type SendInputView,
  type StreamEventView,
  type TurnView,
} from './types';

export const COACH_TEXT = {
  noProvider: 'Connect an AI provider in Settings to chat. You can still log everything by hand.',
  offline: 'You’re offline. Your message is kept; send it when you’re back.',
  keyRefused: (p: string) => `Your key was refused by ${p}. Check it in Settings › AI provider.`,
  outOfCredit: 'Your provider says you’re out of credit (or at your plan’s limit). Nothing was logged.',
  rateLimited: 'The provider is busy. Try again in a minute.',
  // a browser reports "server not running" and "server refuses web pages" (CORS) as the same failure: name both
  cors: (p: string) => `No answer from ${p}: it may not be running or reachable, or it may not accept requests from a web page. Check that it is running; if it is, choose a provider that runs through your Vitals server, or another provider.`,
  network: (p: string) => `Couldn’t reach ${p}. Nothing was logged.`,
  modelMissing: (p: string, m: string) => `${p} doesn’t offer the model “${m}” (any more). Choose another model in Settings › AI provider.`,
  tooLong: 'This conversation is too long for this model. Try a shorter message, or choose a model that takes more text in Settings › AI provider.',
  declined: (p: string) => `${p} declined to answer this message. Nothing was logged.`,
  providerProblem: (p: string) => `${p} had a problem answering. Nothing was logged; try again in a minute.`,
  badRequest: (p: string) => `${p} could not handle this request. Nothing was logged. If it keeps happening, choose another model in Settings › AI provider.`,
  unexpected: 'Something went wrong while answering. Nothing was logged; try again.',
  noVision: 'This model can’t see photos. Describe the meal in words, or choose a model with vision in Settings.',
  spendCap: 'You’ve reached the monthly AI spend cap you set in Settings. Raise it there to keep chatting.',
  spendWarning: 'You’ve used over 80 % of your monthly AI spend cap.',
  stepLimit: 'You have used all tool steps for this message: summarise what was done and what is waiting, then stop.',
  photoAlt: 'Your photo',
} as const;

const STRUCTURED_INTENTS: Record<string, string> = {
  log_meal: 'log.meal',
  log_session: 'log.session',
  log_measurement: 'log.measurement',
  log_fast: 'log.fast',
  log_steps: 'log.steps',
  log_note: 'log.note',
};

const STRUCTURED_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'What to say to the person.' },
    intent: { type: 'string', enum: ['none', ...Object.keys(STRUCTURED_INTENTS)] },
    args: { type: 'object', description: 'Arguments for the log: log_meal {slot?, components:[{name, grams}]}, log_session {status, performed:[]}, log_measurement {metric, value, unit}, log_fast {action}, log_steps {steps}, log_note {text}.' },
  },
  required: ['reply', 'intent'],
};

/** Daily-summary hook and its cost: injected so tests can force or skip it. */
export interface SpendPort {
  /** Monthly cap in USD (none = no cap). */
  capUsd?: () => number | undefined;
  /** Spent this month in USD. */
  spentUsd: () => number;
  record?: (usage: Usage, conversationId: string) => void;
}

export interface CoachAdapterDeps {
  bus: CoachBus;
  /** null = no provider configured. */
  model: ChatModel | null;
  provider?: { name: string; model: string; keyOwner?: 'your key' | 'local' };
  /** Basic tier (small / local models): read and log tools only. Default from the caller's `degradeFor`. */
  tier?: Tier;
  smallEditsWithoutAsking?: () => boolean;
  now?: () => Date;
  newId?: () => string;
  /** The app's day at an instant (default `appDay`: rollover at 04:00). */
  localDate?: (d: Date) => string;
  /** Stores an attached photo (blob store) and returns its attachment id and a thumbnail URL. */
  putPhoto?: (file: File) => Promise<{ attachmentId: string; url: string }>;
  /** Renders the visible "What the Coach knows" panel (the UI's `buildCoachBriefing`). */
  visibleBriefing?: (input: VisibleBriefingInput) => BriefingModelView;
  store?: ConversationStore;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  isOnline?: () => boolean;
  spend?: SpendPort;
  /** Loop-level retries after the provider's own retries ran out on a rate limit (default 3). */
  maxRateRetries?: number;
  /** Actor id for the Coach (`Actor.id`): the provider preset id. */
  aiActorId?: string;
  /** Called with every provider error a turn ends on (not on stop); the runtime drops wrong cached capabilities. */
  onProviderError?: (error: ProviderErrorInfo) => void;
}

interface ConvState {
  id: string;
  turns: TurnView[];
  /** Model messages of the current segment. */
  history: ChatMessage[];
  segment: number;
  summaries: DaySummary[];
  loadedGroups: Set<string>;
  notes: string[];
  createdAt: string;
  /** Resolves once the stored turns, messages and summaries are merged in (a reload resumes the conversation). */
  loaded: Promise<void>;
}

let seq = 0;
function defaultId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  return c?.randomUUID ? c.randomUUID() : `id-${Date.now().toString(36)}-${(++seq).toString(36)}`;
}

function objectUrl(f: File): string {
  try {
    return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : '';
  } catch {
    return '';
  }
}

function summaryText(s: readonly DaySummary[]): string {
  return [
    'Summary of the earlier conversation, one line per day:',
    ...s.map((d) => {
      const parts = [
        d.decisions.length ? `decided: ${d.decisions.join('; ')}` : '',
        d.logged.length ? `logged: ${d.logged.join('; ')}` : '',
        d.openQuestions.length ? `open: ${d.openQuestions.join('; ')}` : '',
        d.userPrefsLearned.length ? `prefers: ${d.userPrefsLearned.join('; ')}` : '',
      ].filter(Boolean);
      return `${d.date}: ${parts.join(' | ') || 'nothing notable'}`;
    }),
  ].join('\n');
}

export interface CoachAdapter extends CoachAdapterShape {
  /** The last briefing sent to the model (tests, Settings › AI "what is sent"). */
  lastBriefing(): BuiltBriefing | null;
  /** The tool names offered on the last request (tests). */
  lastToolNames(): string[];
  /** Rebuild the visible briefing now. */
  refreshBriefing(): Promise<void>;
}

export function createCoachAdapter(deps: CoachAdapterDeps): CoachAdapter {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? defaultId;
  const localDate = deps.localDate ?? ((d: Date) => appDay(d)); // the app's day: before 04:00 it is still yesterday
  const store = deps.store ?? createMemoryConversationStore();
  const sleep = deps.sleep ?? abortableSleep;
  const model = deps.model;
  const caps = model?.capabilities;
  const providerName = deps.provider?.name ?? model?.presetId ?? '';
  const tier: Tier = deps.tier ?? 'full';
  const executor = new CoachExecutor({ bus: deps.bus, now, newId, aiActorId: deps.aiActorId ?? model?.presetId ?? 'coach' });
  const maxRateRetries = deps.maxRateRetries ?? 3;

  const convs = new Map<string, ConvState>();
  const listeners = new Set<() => void>();
  let rev = 0;
  let transient: CoachStatusView | null = null;
  let briefingCache: BuiltBriefing | null = null;
  let visibleInput: VisibleBriefingInput | null = null;
  let toolNames: string[] = [];
  let warnedSpend = false;

  const bump = () => {
    rev++;
    listeners.forEach((l) => l());
  };
  const nowIso = () => now().toISOString();
  const providerInfo = deps.provider ? { name: deps.provider.name, model: deps.provider.model } : model ? { name: model.presetId, model: model.model } : null;

  function baseStatus(): CoachStatusView {
    if (!model || !caps) return { kind: 'noProvider', vision: false };
    const common = { provider: providerName, model: deps.provider?.model ?? model.model, keyOwner: deps.provider?.keyOwner ?? 'your key', vision: caps.vision } as const;
    if (!caps.tools) return { kind: 'noTools', ...common };
    if (briefingCache?.noPlanning) return { kind: 'safetyNoPlanning', ...common };
    if (tier === 'basic') return { kind: 'basic', ...common };
    return { kind: 'ready', ...common };
  }

  function conv(id: string): ConvState {
    let c = convs.get(id);
    if (!c) {
      const fresh: ConvState = { id, turns: [], history: [], segment: 0, summaries: [], loadedGroups: new Set(), notes: [], createdAt: nowIso(), loaded: Promise.resolve() };
      fresh.loaded = restore(fresh).catch(() => undefined);
      convs.set(id, fresh);
      c = fresh;
    }
    return c;
  }

  async function restore(c: ConvState): Promise<void> {
    const stored = (await store.conversations()).find((x) => x.id === c.id);
    if (!stored) {
      await store.saveConversation({ id: c.id, title: 'Coach', kind: 'coach', createdAt: c.createdAt, updatedAt: c.createdAt, segment: 0 });
      return;
    }
    const [turns, summaries, messages] = await Promise.all([store.listTurns(c.id), store.listSummaries(c.id), store.listMessages(c.id, stored.segment)]);
    const known = new Set(turns.map((t) => t.id));
    c.createdAt = stored.createdAt;
    c.segment = stored.segment;
    // cards carry their stored record (Undo works after a reload); one past its undo window says so
    const at = now();
    c.turns = [...turns.map((t) => ({ ...t, streaming: false, cards: (t.cards ?? []).map((card) => CoachExecutor.restored(card, at)) })), ...c.turns.filter((t) => !known.has(t.id))];
    c.summaries = [...summaries, ...c.summaries];
    c.history = [...messages, ...c.history];
    bump();
  }

  function push(c: ConvState, t: TurnView): void {
    c.turns = [...c.turns, t];
    void store.appendTurn(c.id, t);
    bump();
  }

  function update(c: ConvState, id: string, f: (t: TurnView) => TurnView): TurnView | null {
    let next: TurnView | null = null;
    c.turns = c.turns.map((t) => (t.id === id ? (next = f(t)) : t));
    if (next) void store.updateTurn(c.id, next);
    bump();
    return next;
  }

  async function rebuildBriefing(signal?: AbortSignal): Promise<BuiltBriefing> {
    const at = now();
    const today = localDate(at);
    const data = await gatherBriefingData(deps.bus, at, today, addDays);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const built = buildBriefing(data, { provider: providerInfo, addDays });
    briefingCache = built;
    visibleInput = built.visible;
    bump();
    return built;
  }

  function errorFor(e: ProviderErrorInfo): { kind: string; message: string } {
    switch (e.kind) {
      case 'auth':
        return { kind: 'keyRefused', message: COACH_TEXT.keyRefused(providerName) };
      case 'quota':
        return { kind: 'outOfCredit', message: COACH_TEXT.outOfCredit };
      case 'rate_limit':
      case 'overloaded':
        return { kind: 'rateLimited', message: COACH_TEXT.rateLimited };
      case 'cors':
        return { kind: 'cors', message: COACH_TEXT.cors(providerName || 'your provider') };
      case 'network':
        return { kind: 'offline', message: COACH_TEXT.network(providerName) };
      // the provider's own text is technical (field paths, codes): plain words instead
      case 'model_not_found':
        return { kind: 'error', message: COACH_TEXT.modelMissing(providerName || 'Your provider', deps.provider?.model ?? model?.model ?? '') };
      case 'context_length':
        return { kind: 'error', message: COACH_TEXT.tooLong };
      case 'content_policy':
        return { kind: 'error', message: COACH_TEXT.declined(providerName || 'Your provider') };
      case 'server':
      case 'stream':
        return { kind: 'error', message: COACH_TEXT.providerProblem(providerName || 'Your provider') };
      case 'bad_request':
      case 'unsupported_param':
        return { kind: 'error', message: COACH_TEXT.badRequest(providerName || 'Your provider') };
      default:
        return { kind: 'error', message: e.message };
    }
  }

  interface StepResult {
    text: string;
    calls: ToolCall[];
    error: ProviderErrorInfo | null;
    message: ChatMessage;
  }

  /** One model request, streamed into the coach turn; retried (status `rateLimited`) when the provider stays busy. */
  async function step(c: ConvState, coachId: string, req: ChatRequest, onEvent: (e: StreamEventView) => void, signal: AbortSignal): Promise<StepResult> {
    for (let attempt = 0; ; attempt++) {
      let text = '';
      const calls: ToolCall[] = [];
      let error: ProviderErrorInfo | null = null;
      let usage: Usage | null = null;
      let providerState: ChatMessage['providerState'];
      for await (const ev of model!.stream(req, signal)) {
        if (ev.type === 'text') {
          text += ev.delta;
          update(c, coachId, (t) => ({ ...t, text: t.text + ev.delta }));
          onEvent({ type: 'text', delta: ev.delta });
        } else if (ev.type === 'tool_call_end') calls.push(ev.call);
        else if (ev.type === 'usage') usage = addUsage(usage, ev.usage);
        else if (ev.type === 'provider_state') providerState = ev.state;
        else if (ev.type === 'error') error = ev.error;
      }
      if (usage) deps.spend?.record?.(usage, c.id);
      const busy = error && (error.kind === 'rate_limit' || error.kind === 'overloaded');
      if (busy && attempt < maxRateRetries && !text && !calls.length && !signal.aborted) {
        const retryInS = Math.max(1, Math.ceil((error!.retryAfterMs ?? 20_000) / 1000));
        transient = { ...baseStatus(), kind: 'rateLimited', retryInS };
        bump();
        try {
          await sleep(retryInS * 1000, signal);
        } catch {
          /* aborted while waiting */
        }
        transient = null;
        bump();
        if (signal.aborted) return { text, calls, error: { kind: 'aborted', message: 'Stopped', retryable: false }, message: { role: 'assistant', parts: [] } };
        continue;
      }
      const message: ChatMessage = { role: 'assistant', parts: text ? [{ type: 'text', text }] : [], ...(calls.length ? { toolCalls: calls } : {}), ...(providerState ? { providerState } : {}) };
      return { text, calls, error, message };
    }
  }

  async function maybeSummarise(c: ConvState, signal: AbortSignal): Promise<void> {
    if (!model || !needsSummary(c.history)) return;
    const start = recentStart(c.history);
    if (start <= 0) return;
    try {
      const metered: ChatModel = { ...model, complete: async (req, sig) => {
        const res = await model.complete(req, sig);
        if (res.usage) deps.spend?.record?.(res.usage, c.id);
        return res;
      } };
      const days = await summariseDays(metered, c.history.slice(0, start), signal);
      c.summaries = [...c.summaries, ...days];
      void store.saveSummaries(c.id, c.segment, days);
    } catch {
      // without summaries the oldest turns are dropped anyway: the request must stay inside the window
    }
    c.history = c.history.slice(start);
    c.segment += 1;
    void store.saveConversation({ id: c.id, title: 'Coach', kind: 'coach', createdAt: c.createdAt, updatedAt: nowIso(), segment: c.segment });
  }

  function systemMessage(c: ConvState, briefing: BuiltBriefing): ChatMessage {
    const text = c.summaries.length ? `${briefing.text}\n\n${summaryText(c.summaries)}` : briefing.text;
    return { role: 'system', parts: [{ type: 'text', text }] };
  }

  async function runTools(c: ConvState, coachId: string, calls: ToolCall[], ctx: TurnContext, onEvent: (e: StreamEventView) => void): Promise<ChatMessage[]> {
    const toolset = currentToolset();
    // reads first, in parallel; writes in the model's order
    const outcomes = new Array<Awaited<ReturnType<CoachExecutor['run']>>>(calls.length);
    const readIdx: number[] = [];
    const writeIdx: number[] = [];
    calls.forEach((call, i) => {
      const r = toolset.resolve(call.name);
      (r && !('excluded' in r) && r.cls === 'read' ? readIdx : writeIdx).push(i);
    });
    await Promise.all(readIdx.map(async (i) => (outcomes[i] = await executor.run(toolset, calls[i]!, ctx))));
    for (const i of writeIdx) outcomes[i] = await executor.run(toolset, calls[i]!, ctx);
    const reads = outcomes.flatMap((o) => (o.read ? [o.read] : []));
    if (reads.length) {
      const turn = update(c, coachId, (t) => {
        const prev = t.reads?.reads ?? [];
        return { ...t, reads: readCard(t.reads?.id ?? `read-${newId()}`, [...prev, ...reads], t.reads?.createdAt ?? nowIso()) };
      });
      if (turn?.reads) onEvent({ type: 'read', card: turn.reads });
    }
    for (const o of outcomes) {
      if (!o.card) continue;
      const card = o.card;
      update(c, coachId, (t) => ({ ...t, cards: [...t.cards, card] }));
      onEvent({ type: 'card', card });
    }
    return outcomes.map((o) => o.message);
  }

  let toolsetCache: { rev: string; set: CoachToolset } | null = null;
  function currentToolset(): CoachToolset {
    // the registry can grow at runtime (executors implemented by lazily loaded modules): rebuild when it changes
    const key = String(deps.bus.manifest().filter((d) => !d.notImplemented).length);
    if (!toolsetCache || toolsetCache.rev !== key) toolsetCache = { rev: key, set: new CoachToolset(deps.bus) };
    return toolsetCache.set;
  }

  async function structuredReply(c: ConvState, coachId: string, messages: ChatMessage[], onEvent: (e: StreamEventView) => void, signal: AbortSignal, quiet: boolean): Promise<ProviderErrorInfo | null> {
    const req: ChatRequest = {
      messages: [
        ...messages.slice(0, 1),
        { role: 'system', parts: [{ type: 'text', text: 'You cannot call tools. Reply with JSON only: {"reply": what to say, "intent": one of none|log_meal|log_session|log_measurement|log_fast|log_steps|log_note, "args": the log\'s arguments}. A log you return is shown to the person as a card to confirm; say so.' }] },
        ...messages.slice(1),
      ],
      responseSchema: { name: 'coach_reply', schema: STRUCTURED_SCHEMA },
    };
    const res = await model!.complete(req, signal);
    if (res.usage) deps.spend?.record?.(res.usage, c.id);
    if (res.error) return res.error;
    const raw = res.message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
    let parsed: Record<string, unknown> | null;
    try {
      const j = extractJsonObject(raw);
      parsed = j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
    } catch {
      parsed = null;
    }
    const reply = typeof parsed?.reply === 'string' ? parsed.reply : raw;
    if (reply) {
      update(c, coachId, (t) => ({ ...t, text: t.text + reply }));
      onEvent({ type: 'text', delta: reply });
    }
    c.history.push({ role: 'assistant', parts: [{ type: 'text', text: reply }] });
    const commandId = typeof parsed?.intent === 'string' ? STRUCTURED_INTENTS[parsed.intent] : undefined;
    const args = parsed?.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args) ? (parsed.args as Record<string, unknown>) : null;
    if (commandId && args) {
      const card = executor.suggest(commandId, args, { conversationId: c.id, quiet });
      if (card) {
        update(c, coachId, (t) => ({ ...t, cards: [...t.cards, card] }));
        onEvent({ type: 'card', card });
      }
    }
    return null;
  }

  async function send(input: SendInputView, onEvent: (e: StreamEventView) => void, signal: AbortSignal): Promise<void> {
    const c = conv(input.conversationId || MAIN_CONVERSATION);
    await c.loaded;
    const at = nowIso();
    let photo: { attachmentId: string; url: string } | null = null;
    const you: TurnView = { id: `you-${newId()}`, role: 'you', at, text: input.text, cards: [], segment: c.segment };
    push(c, you);
    const fail = (kind: string, message: string) => {
      push(c, { id: `coach-${newId()}`, role: 'coach', at: nowIso(), text: '', cards: [], error: { kind, message }, segment: c.segment });
      onEvent({ type: 'error', kind, message });
    };
    if (!model || !caps) return fail('noProvider', COACH_TEXT.noProvider);
    if (deps.isOnline && !deps.isOnline()) return fail('offline', COACH_TEXT.offline);
    const cap = deps.spend?.capUsd?.();
    const spent = deps.spend?.spentUsd() ?? 0;
    if (cap !== undefined && cap > 0 && spent >= cap) return fail('outOfCredit', COACH_TEXT.spendCap);

    const coachId = `coach-${newId()}`;
    push(c, { id: coachId, role: 'coach', at, text: '', cards: [], streaming: true, segment: c.segment });
    const finish = (patch: Partial<TurnView> = {}) => update(c, coachId, (t) => ({ ...t, streaming: false, ...patch }));
    const say = (text: string) => {
      update(c, coachId, (t) => ({ ...t, text: t.text + text }));
      onEvent({ type: 'text', delta: text });
    };

    // E20: a PDF (a blood test report) is read by the app's own reader; it needs no image input
    const isPdf = input.photo?.type === 'application/pdf';
    if (input.photo) {
      if (!caps.vision && !isPdf) {
        say(COACH_TEXT.noVision);
        finish();
        onEvent({ type: 'done' });
        return;
      }
      photo = deps.putPhoto ? await deps.putPhoto(input.photo) : { attachmentId: newId(), url: objectUrl(input.photo) };
      update(c, you.id, (t) => ({ ...t, photo: { url: photo!.url, alt: COACH_TEXT.photoAlt } }));
    }

    try {
      const before = c.segment;
      await maybeSummarise(c, signal);
      if (c.segment !== before) {
        update(c, you.id, (t) => ({ ...t, segment: c.segment }));
        update(c, coachId, (t) => ({ ...t, segment: c.segment }));
      }
      if (signal.aborted) {
        finish({ stopped: true });
        return;
      }
      const briefing = await rebuildBriefing(signal);
      const quiet = briefing.quiet;
      const noteLines = c.notes.splice(0);
      const contextBits = [input.context?.screen && `from ${input.context.screen}`, input.context?.slot && `slot ${input.context.slot}${input.context.slotName ? ` (${input.context.slotName})` : ''}`, input.context?.date && `date ${input.context.date}`].filter(Boolean);
      const userText = [
        ...noteLines,
        input.text,
        contextBits.length ? `[context: ${contextBits.join(', ')}]` : '',
        photo && isPdf ? `[file attached: attachmentId "${photo.attachmentId}" (PDF). If it is a blood test report, read it with markers_import.]` : '',
        photo && !isPdf ? `[photo attached: attachmentId "${photo.attachmentId}". Log it with log_meal_from_photo; if it is a blood test report, read it with markers_import.]` : '',
      ].filter(Boolean).join('\n');
      const userMsg: ChatMessage = { role: 'user', parts: [{ type: 'text', text: userText }] };
      const turnMsgs: ChatMessage[] = [userMsg];
      const system = systemMessage(c, briefing);

      if (!caps.tools) {
        const err = await structuredReply(c, coachId, [system, ...c.history, userMsg], onEvent, signal, quiet);
        c.history.splice(c.history.length - 1, 0, userMsg);
        void store.appendMessages(c.id, c.segment, [userMsg]);
        if (err) return endWithError(c, coachId, err, onEvent, signal);
        finish();
        onEvent({ type: 'done' });
        return;
      }

      const ctx: TurnContext = {
        conversationId: c.id,
        turnId: coachId,
        ...(input.context?.date ? { date: input.context.date } : {}),
        tier,
        noPlanning: briefing.noPlanning,
        smallEditsWithoutAsking: deps.smallEditsWithoutAsking?.() ?? false,
        quiet,
        signal,
        photos: new Map(photo ? [[photo.attachmentId, { url: photo.url, alt: COACH_TEXT.photoAlt }]] : []),
        planName: briefing.visible.today?.plan?.name ?? null,
        loadGroups: (groups) => groups.forEach((g) => c.loadedGroups.add(g)),
        counts: { calls: 0, writes: 0, destructive: 0 },
      };
      const limit = stepLimit(caps);
      let error: ProviderErrorInfo | null = null;
      for (let n = 0; n < limit; n++) {
        const last = n === limit - 1;
        const tools = last ? [] : currentToolset().specs({ tier, noPlanning: briefing.noPlanning, loadedGroups: [...c.loadedGroups] });
        toolNames = tools.map((t) => t.name);
        const req: ChatRequest = {
          messages: [system, ...c.history, ...turnMsgs, ...(last ? [{ role: 'system' as const, parts: [{ type: 'text' as const, text: COACH_TEXT.stepLimit }] }] : [])],
          ...(tools.length ? { tools, toolChoice: 'auto' as const, parallelTools: caps.parallelTools } : {}),
        };
        const r = await step(c, coachId, req, onEvent, signal);
        if (r.message.parts.length || r.message.toolCalls?.length) turnMsgs.push(r.message);
        if (r.error || signal.aborted) {
          error = r.error ?? { kind: 'aborted', message: 'Stopped', retryable: false };
          break;
        }
        if (!r.calls.length) break;
        const results = await runTools(c, coachId, r.calls, ctx, onEvent);
        turnMsgs.push(...results);
        if (signal.aborted) {
          error = { kind: 'aborted', message: 'Stopped', retryable: false };
          break;
        }
      }
      // keep the turn's messages (a stopped turn keeps what arrived; a dangling tool call is closed off)
      const tail = turnMsgs[turnMsgs.length - 1];
      if (tail?.role === 'assistant' && tail.toolCalls?.length) {
        for (const call of tail.toolCalls) turnMsgs.push({ role: 'tool', toolCallId: call.id, toolName: call.name, isError: true, parts: [{ type: 'text', text: JSON.stringify({ ok: false, status: 'rejected', summary: 'Stopped before this ran.' }) }] });
      }
      c.history.push(...turnMsgs);
      void store.appendMessages(c.id, c.segment, turnMsgs);
      if (error) return endWithError(c, coachId, error, onEvent, signal);
      if (cap !== undefined && cap > 0 && !warnedSpend && (deps.spend?.spentUsd() ?? 0) >= 0.8 * cap) {
        warnedSpend = true;
        say(`\n\n${COACH_TEXT.spendWarning}`);
      }
      finish();
      onEvent({ type: 'done' });
    } catch (e) {
      if (signal.aborted) {
        finish({ stopped: true });
        return;
      }
      // configuration and network-guard errors are already in plain words; anything else is a bug, not for the screen
      const message = e instanceof Error && /^(ProviderConfigError|NetBlockedError|CompanionError)$/.test(e.name) ? e.message : COACH_TEXT.unexpected;
      finish({ error: { kind: 'error', message } });
      onEvent({ type: 'error', kind: 'error', message });
    }
  }

  function endWithError(c: ConvState, coachId: string, error: ProviderErrorInfo, onEvent: (e: StreamEventView) => void, signal: AbortSignal): void {
    if (error.kind === 'aborted' || signal.aborted) {
      update(c, coachId, (t) => ({ ...t, streaming: false, stopped: true }));
      return;
    }
    try {
      deps.onProviderError?.(error);
    } catch {
      // a failing observer must not hide the error from the person
    }
    const mapped = errorFor(error);
    update(c, coachId, (t) => ({ ...t, streaming: false, error: mapped }));
    onEvent({ type: 'error', ...mapped });
  }

  function findCard(cardId: string): { c: ConvState; turn: TurnView; card: CardView } | null {
    for (const c of convs.values()) {
      for (const turn of c.turns) {
        const card = turn.cards.find((x) => x.id === cardId);
        if (card) return { c, turn, card };
      }
    }
    return null;
  }

  async function act(cardId: string, action: CardAction, extra?: CardActionExtra): Promise<{ ok: boolean; message?: string }> {
    const found = findCard(cardId);
    if (!found) return { ok: false, message: 'That card is no longer here.' };
    const r = await executor.act(found.card, action, extra);
    if (r.card) {
      const next = r.card;
      update(found.c, found.turn.id, (t) => ({ ...t, cards: t.cards.map((x) => (x.id === cardId ? next : x)) }));
      if (found.card.class === 'edit' && found.card.state !== next.state && (next.state === 'applied' || next.state === 'discarded')) {
        found.c.notes.push(`[system note: proposal "${found.card.title}" ${next.state}]`);
      }
      if (found.card.class === 'destructive' && next.state === 'applied') found.c.notes.push(`[system note: the person confirmed "${found.card.title}"]`);
    }
    return { ok: r.ok, ...(r.message ? { message: r.message } : {}) };
  }

  function conversations(): ConversationSummaryView[] {
    return [...convs.values()]
      .filter((c) => c.turns.length > 0)
      .map((c) => ({ id: c.id, title: 'Coach', kind: 'coach' as const, updatedAt: c.turns[c.turns.length - 1]!.at }));
  }

  const EMPTY: TurnView[] = [];
  let briefingRequested = false;
  const fallbackBriefing: BriefingModelView = { sections: [] };

  return {
    status: () => transient ?? baseStatus(),
    conversations,
    history: (id) => (id ? conv(id).turns : EMPTY),
    send,
    act,
    briefing: () => {
      if (!visibleInput && !briefingRequested) {
        briefingRequested = true;
        void rebuildBriefing().catch(() => undefined);
      }
      const input: VisibleBriefingInput = visibleInput ?? { today: null, waiting: 0, provider: providerInfo, about: [], ask: [] };
      return deps.visibleBriefing?.(input) ?? fallbackBriefing;
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    revision: () => rev,
    lastBriefing: () => briefingCache,
    lastToolNames: () => toolNames,
    refreshBriefing: async () => {
      await rebuildBriefing();
    },
  };
}

export type { CardModel };
