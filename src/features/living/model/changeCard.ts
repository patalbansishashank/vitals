/**
 * Change card view model and state machine (docs/SUITE_SPEC.md §5.5; design/COMPONENTS.md §13.11; living-mode.md §7.2).
 * One model, looks keyed by confirmation class:
 *   read        — "looked at …", nothing changed (collapsed line)
 *   log         — applied at once with Undo (24 h) and Edit
 *   edit        — a proposal: diff + goal dates before → after; Apply / Adjust / Discard; expires in 24 h; may turn stale
 *   destructive — "Needs your confirmation"; only the typed-confirmation dialog completes it
 *   blocked     — not allowed by the safety settings; offers the allowed alternatives
 *   uiOnly      — "Only you can change that" + a link to the setting
 * Pure: the clock is an argument. Today, the Coach, Progress and Plan details all render cards through this model.
 */

export type ChangeClass = 'read' | 'log' | 'edit' | 'destructive' | 'blocked' | 'uiOnly';
export type ChangeState = 'applied' | 'pending' | 'undone' | 'discarded' | 'expired' | 'stale';
export type ChangeAction = 'undo' | 'redo' | 'edit' | 'apply' | 'adjust' | 'discard' | 'review' | 'dismiss' | 'alternative' | 'open';

/** 24 h undo window for applied cards and expiry for proposals. */
export const CHANGE_WINDOW_MS = 24 * 3600 * 1000;

export interface ChangeCardModel {
  id: string;
  class: ChangeClass;
  /** "Logged lunch · 13:10", "Proposal · no training Thu–Sat", "end Spring cut". */
  title: string;
  /** Who made it and how: "you · typed", "Coach · photo", "the plan · small adjustment". */
  source?: { label: string; confidence?: number; band?: string };
  createdAt: string;
  /** Undo window end (applied) or expiry (pending). Defaults to createdAt + 24 h. */
  until?: string;
  /** Diff rows (label · before · after); for logs, before is null. */
  items: Array<{ label: string; before: string | null; after: string | null }>;
  /** Log cards: the totals line ("total ≈ 640 kcal (510–780) · protein 33 g (25–41)"). */
  totals?: string;
  /** Edit cards: goal dates before → after (ranges as LocalDate pairs) and metric impacts. */
  impact?: {
    goalDates: Array<{ label: string; before: [string, string] | null; after: [string, string] | null }>;
    metrics: Array<{ label: string; delta: number; unit: string; decimals?: number }>;
  };
  /** Read cards: what was looked at. */
  reads?: Array<{ label: string; summary?: string }>;
  /** Destructive cards: the consequence and the word to type. */
  confirm?: { consequence: string; word: string; actionLabel: string };
  /** Blocked cards: the rule in plain words and the allowed alternatives. */
  blocked?: { rule: string; alternatives: Array<{ id: string; label: string }> };
  /** UI-only: where the person changes it. */
  setting?: { label: string; to: string };
  state: ChangeState;
  /** Stale cards: the refreshed version Apply acts on. */
  refreshed?: Pick<ChangeCardModel, 'items' | 'impact'>;
  /** Free text under the title ("Ends the plan today. Logs and versions are kept…"). */
  note?: string;
}

export type ChangeEvent =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'apply' }
  | { type: 'discard' }
  | { type: 'expire' }
  | { type: 'stale'; refreshed: NonNullable<ChangeCardModel['refreshed']> }
  /** Accept the refreshed version as the proposal (stale → pending). */
  | { type: 'refresh' }
  /** Typed confirmation completed in the dialog (destructive only). */
  | { type: 'confirmed' };

function windowEnd(card: Pick<ChangeCardModel, 'createdAt' | 'until'>): number {
  return card.until ? Date.parse(card.until) : Date.parse(card.createdAt) + CHANGE_WINDOW_MS;
}

/** Milliseconds left in the undo window (applied) or before expiry (pending); 0 when over. */
export function timeLeft(card: Pick<ChangeCardModel, 'createdAt' | 'until'>, now: Date): number {
  return Math.max(0, windowEnd(card) - now.getTime());
}

/** "23 h to undo" / "expires in 23 h" / "40 min to undo". */
export function timeLeftText(card: ChangeCardModel, now: Date): string | null {
  const ms = timeLeft(card, now);
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  const span = h >= 1 ? `${h} h` : `${Math.max(1, Math.ceil(ms / 60_000))} min`;
  // applied edits (automatic load-lowering changes, applied proposals) keep Undo for the window too, so they show it
  if (card.state === 'applied' && (card.class === 'log' || card.class === 'edit')) return `${span} to undo`;
  if (card.state === 'pending' && card.class === 'edit') return `expires in ${span}`;
  return null;
}

/**
 * The transition function. Illegal events return the card unchanged (the UI never offers them; the reducer is total).
 *  log:          applied ⇄ undone (undo within the window; redo while undone); pending (a suggested log: confidence
 *                0.4–0.7, or a model that can't use tools) → applied (apply) | discarded
 *  edit:        pending → applied (apply) | discarded | expired | stale; stale → pending (refresh) | discarded;
 *                applied → undone (undo within the window, automatic load-lowering changes)
 *  destructive:  pending → applied only by `confirmed`; discard
 *  read/blocked/uiOnly: informational; blocked and uiOnly can be dismissed (discarded)
 */
export function changeCardReducer(card: ChangeCardModel, ev: ChangeEvent, now: Date = new Date()): ChangeCardModel {
  const open = timeLeft(card, now) > 0;
  switch (ev.type) {
    case 'undo':
      if (card.state === 'applied' && open && (card.class === 'log' || card.class === 'edit')) return { ...card, state: 'undone' };
      return card;
    case 'redo':
      if (card.state === 'undone') return { ...card, state: 'applied' };
      return card;
    case 'apply':
      // Apply acts only on a live proposal; a stale card must be refreshed first (Apply re-enabled on the refreshed version)
      if (card.class === 'edit' && card.state === 'pending' && open) return { ...card, state: 'applied', createdAt: now.toISOString(), until: undefined };
      // A suggested log the person confirms ("Log it"); its undo window starts now
      if (card.class === 'log' && card.state === 'pending') return { ...card, state: 'applied', createdAt: now.toISOString(), until: undefined };
      return card;
    case 'confirmed':
      if (card.class === 'destructive' && card.state === 'pending') return { ...card, state: 'applied' };
      return card;
    case 'discard':
      if (card.state === 'pending' || card.state === 'stale') return { ...card, state: 'discarded' };
      if ((card.class === 'blocked' || card.class === 'uiOnly') && card.state === 'applied') return { ...card, state: 'discarded' };
      return card;
    case 'expire':
      if (card.state === 'pending' && !open) return { ...card, state: 'expired' };
      return card;
    case 'stale':
      if (card.class === 'edit' && card.state === 'pending') return { ...card, state: 'stale', refreshed: ev.refreshed };
      return card;
    case 'refresh':
      if (card.state === 'stale' && card.refreshed) {
        // the stale version's impact no longer holds: keep only what the refreshed version says
        const { refreshed, impact: _stale, ...rest } = card;
        return { ...rest, items: refreshed.items, ...(refreshed.impact ? { impact: refreshed.impact } : {}), state: 'pending', createdAt: now.toISOString(), until: undefined };
      }
      return card;
  }
}

/** The actions a card offers now, in display order. Apply is never pre-focused (the component's job). */
export function availableActions(card: ChangeCardModel, now: Date = new Date()): ChangeAction[] {
  const open = timeLeft(card, now) > 0;
  switch (card.class) {
    case 'read':
      return [];
    case 'log':
      if (card.state === 'applied') return open ? ['edit', 'undo'] : ['edit'];
      if (card.state === 'undone') return ['redo'];
      if (card.state === 'pending') return ['apply', 'discard'];
      return [];
    case 'edit':
      if (card.state === 'pending') return open ? ['apply', 'adjust', 'discard'] : [];
      if (card.state === 'stale') return ['review', 'discard'];
      if (card.state === 'applied') return open ? ['undo'] : [];
      if (card.state === 'undone') return ['redo'];
      return [];
    case 'destructive':
      return card.state === 'pending' ? ['review', 'dismiss'] : [];
    case 'blocked':
      return card.state === 'applied' || card.state === 'pending' ? ['alternative', 'dismiss'] : [];
    case 'uiOnly':
      return card.state === 'applied' || card.state === 'pending' ? ['open'] : [];
  }
}

/** Collapse expired proposals at render time (cards are stored as made; time moves on). */
export function withClock(card: ChangeCardModel, now: Date): ChangeCardModel {
  return card.state === 'pending' && card.class === 'edit' && timeLeft(card, now) <= 0 ? changeCardReducer(card, { type: 'expire' }, now) : card;
}
