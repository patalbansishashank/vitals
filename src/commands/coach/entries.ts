/** Appending a log entry from E9b executors, the same way `../living` does (E5 keeps its helper private). */
import { isLive, planDay, type LogEntry, type PlanDoc } from '@/living';
import { bodyOf } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import type { CommandContext } from '../types';

type Body<K extends LogEntry['kind']> = Omit<Extract<LogEntry, { kind: K }>, 'id' | 'date' | 'tz' | 'at' | 'source' | 'planId' | 'planDay'>;

export async function appendLogEntry<K extends LogEntry['kind']>(ctx: CommandContext, date: string, body: Body<K>): Promise<string> {
  const store = getDocumentStore();
  await store.ready;
  const active = store.peek<{ planId: string | null }>('activePlan', 'me');
  const plans = store.peekAll<PlanDoc>('plans').map((d) => ({ ...bodyOf<PlanDoc>(d), id: d._id }));
  const plan = (active?.planId ? plans.find((p) => p.id === active.planId) : undefined) ?? plans.filter(isLive).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  const k = ctx.actor.kind;
  const by = k === 'user' ? 'user' : k === 'system' ? 'system' : k === 'companion' ? 'import' : 'ai';
  const source = {
    by,
    method: by === 'ai' ? 'aiText' : 'typed',
    ...(ctx.actor.conversationId ? { conversationId: ctx.actor.conversationId } : {}),
    ...(ctx.actor.toolCallId ? { toolCallId: ctx.actor.toolCallId } : {}),
    actorId: ctx.actor.id,
  };
  const id = ctx.newId();
  await ctx.docs.append('dailyLogs', {
    ...body,
    date,
    tz: ctx.tz,
    at: ctx.now,
    source,
    ...(plan && isLive(plan) ? { planId: plan.id, planDay: planDay(plan, date) } : {}),
    _id: id,
  });
  return id;
}
