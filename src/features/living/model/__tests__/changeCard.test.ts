import {
  CHANGE_WINDOW_MS,
  availableActions,
  changeCardReducer,
  timeLeft,
  timeLeftText,
  withClock,
  type ChangeCardModel,
  type ChangeClass,
  type ChangeEvent,
  type ChangeState,
} from '../changeCard';

const NOW = new Date('2026-10-01T13:00:00');
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const later = (ms: number) => new Date(NOW.getTime() + ms);

function card(over: Partial<ChangeCardModel> = {}): ChangeCardModel {
  return {
    id: 'c1',
    class: 'edit',
    title: 'Proposal · no training Thu–Sat',
    createdAt: ago(HOUR),
    items: [{ label: 'Thu 1 Oct', before: 'strength session 17:30', after: 'rest' }],
    impact: { goalDates: [{ label: 'goal date', before: ['2026-12-21', '2026-12-30'], after: ['2026-12-23', '2027-01-01'] }], metrics: [{ label: 'weight by the end', delta: 0.2, unit: 'kg', decimals: 1 }] },
    state: 'pending',
    ...over,
  };
}

const REFRESHED: NonNullable<ChangeCardModel['refreshed']> = {
  items: [{ label: 'Fri 2 Oct', before: 'cardio session 07:30', after: 'rest' }],
  impact: { goalDates: [{ label: 'goal date', before: ['2026-12-21', '2026-12-30'], after: ['2026-12-22', '2026-12-31'] }], metrics: [] },
};

const ALL_EVENTS: ChangeEvent[] = [
  { type: 'undo' },
  { type: 'redo' },
  { type: 'apply' },
  { type: 'discard' },
  { type: 'expire' },
  { type: 'stale', refreshed: REFRESHED },
  { type: 'refresh' },
  { type: 'confirmed' },
];
const STATES: ChangeState[] = ['applied', 'pending', 'undone', 'discarded', 'expired', 'stale'];

/** The (class, state) pairs a card can actually be in. */
const REACHABLE: Array<[ChangeClass, ChangeState]> = [
  ['read', 'applied'],
  ['log', 'applied'],
  ['log', 'undone'],
  ['log', 'pending'],
  ['log', 'discarded'],
  ['edit', 'pending'],
  ['edit', 'applied'],
  ['edit', 'undone'],
  ['edit', 'discarded'],
  ['edit', 'expired'],
  ['edit', 'stale'],
  ['destructive', 'pending'],
  ['destructive', 'applied'],
  ['destructive', 'discarded'],
  ['blocked', 'applied'],
  ['blocked', 'pending'],
  ['blocked', 'discarded'],
  ['uiOnly', 'applied'],
  ['uiOnly', 'pending'],
  ['uiOnly', 'discarded'],
];

/** Every (class, state, event) the reducer accepts, as "class/state/event→state" (with the window open). */
const LEGAL = new Set([
  'log/applied/undo→undone',
  'log/undone/redo→applied',
  'log/pending/apply→applied',
  'log/pending/discard→discarded',
  'edit/pending/apply→applied',
  'edit/pending/discard→discarded',
  'edit/pending/stale→stale',
  'edit/stale/discard→discarded',
  'edit/stale/refresh→pending',
  'edit/applied/undo→undone',
  'edit/undone/redo→applied',
  'destructive/pending/confirmed→applied',
  'destructive/pending/discard→discarded',
  'blocked/applied/discard→discarded',
  'blocked/pending/discard→discarded',
  'uiOnly/applied/discard→discarded',
  'uiOnly/pending/discard→discarded',
]);

describe('changeCard — time left', () => {
  it('counts the 24 h window from createdAt, or until when given', () => {
    expect(timeLeft(card({ createdAt: ago(HOUR) }), NOW)).toBe(CHANGE_WINDOW_MS - HOUR);
    expect(timeLeft(card({ createdAt: ago(30 * HOUR) }), NOW)).toBe(0);
    expect(timeLeft(card({ createdAt: ago(30 * HOUR), until: later(2 * HOUR).toISOString() }), NOW)).toBe(2 * HOUR);
  });

  it('words the undo window and the expiry', () => {
    expect(timeLeftText(card({ class: 'log', state: 'applied' }), NOW)).toBe('23 h to undo');
    expect(timeLeftText(card({ class: 'edit', state: 'pending' }), NOW)).toBe('expires in 23 h');
    // applied plan edits keep Undo for the window, so they show it too
    expect(timeLeftText(card({ class: 'edit', state: 'applied' }), NOW)).toBe('23 h to undo');
  });

  it('switches to minutes in the last hour and rounds up', () => {
    expect(timeLeftText(card({ class: 'log', state: 'applied', createdAt: ago(23.5 * HOUR) }), NOW)).toBe('30 min to undo');
    expect(timeLeftText(card({ class: 'edit', state: 'pending', createdAt: ago(CHANGE_WINDOW_MS - 20_000) }), NOW)).toBe('expires in 1 min');
  });

  it('says nothing when the window is over or the state has no window', () => {
    expect(timeLeftText(card({ class: 'log', state: 'applied', createdAt: ago(25 * HOUR) }), NOW)).toBeNull();
    expect(timeLeftText(card({ class: 'log', state: 'undone' }), NOW)).toBeNull();
    expect(timeLeftText(card({ class: 'destructive', state: 'pending' }), NOW)).toBeNull();
    expect(timeLeftText(card({ class: 'read', state: 'applied' }), NOW)).toBeNull();
    expect(timeLeftText(card({ class: 'edit', state: 'stale' }), NOW)).toBeNull();
  });
});

describe('changeCard — reducer', () => {
  it('accepts exactly the legal transitions; every other event is a no-op returning the same card', () => {
    const seen = new Set<string>();
    for (const [cls, state] of REACHABLE) {
      for (const ev of ALL_EVENTS) {
        const c = card({ class: cls, state, ...(state === 'stale' ? { refreshed: REFRESHED } : {}) });
        const next = changeCardReducer(c, ev, NOW);
        if (next === c) continue;
        seen.add(`${cls}/${state}/${ev.type}→${next.state}`);
      }
    }
    expect(seen).toEqual(LEGAL);
  });

  it('with the window over, undo and apply stop working but discard still does', () => {
    const over = { createdAt: ago(25 * HOUR) };
    const log = card({ class: 'log', state: 'applied', ...over });
    expect(changeCardReducer(log, { type: 'undo' }, NOW)).toBe(log);
    const edit = card({ state: 'pending', ...over });
    expect(changeCardReducer(edit, { type: 'apply' }, NOW)).toBe(edit);
    expect(changeCardReducer(edit, { type: 'expire' }, NOW).state).toBe('expired');
    expect(changeCardReducer(edit, { type: 'discard' }, NOW).state).toBe('discarded');
    const appliedEdit = card({ state: 'applied', ...over });
    expect(changeCardReducer(appliedEdit, { type: 'undo' }, NOW)).toBe(appliedEdit);
  });

  it('log: undo within the window, redo while undone; undo after the window does nothing', () => {
    const applied = card({ class: 'log', state: 'applied', title: 'Logged lunch · 13:00' });
    const undone = changeCardReducer(applied, { type: 'undo' }, NOW);
    expect(undone.state).toBe('undone');
    expect(changeCardReducer(undone, { type: 'redo' }, NOW).state).toBe('applied');
    const old = card({ class: 'log', state: 'applied', createdAt: ago(25 * HOUR) });
    expect(changeCardReducer(old, { type: 'undo' }, NOW)).toBe(old);
  });

  it('log: a suggested (pending) log is confirmed with apply; its undo window starts then', () => {
    const suggested = card({ class: 'log', state: 'pending', createdAt: ago(20 * HOUR) });
    const logged = changeCardReducer(suggested, { type: 'apply' }, NOW);
    expect(logged.state).toBe('applied');
    expect(logged.createdAt).toBe(NOW.toISOString());
    expect(logged.until).toBeUndefined();
    expect(timeLeftText(logged, NOW)).toBe('24 h to undo');
  });

  it('edit: apply only while the proposal is live, and the undo window restarts at apply', () => {
    const live = card({ until: later(HOUR).toISOString() });
    const applied = changeCardReducer(live, { type: 'apply' }, NOW);
    expect(applied.state).toBe('applied');
    expect(applied.createdAt).toBe(NOW.toISOString());
    expect(applied.until).toBeUndefined();
    expect(changeCardReducer(applied, { type: 'undo' }, later(2 * HOUR)).state).toBe('undone');
    const old = card({ createdAt: ago(25 * HOUR) });
    expect(changeCardReducer(old, { type: 'apply' }, NOW)).toBe(old);
  });

  it('edit: expires only once the window is over', () => {
    const live = card();
    expect(changeCardReducer(live, { type: 'expire' }, NOW)).toBe(live);
    expect(changeCardReducer(live, { type: 'expire' }, later(24 * HOUR)).state).toBe('expired');
    const viaUntil = card({ until: later(HOUR).toISOString() });
    expect(changeCardReducer(viaUntil, { type: 'expire' }, later(2 * HOUR)).state).toBe('expired');
  });

  it('edit: stale blocks Apply until the refreshed version is taken; refresh re-enables Apply', () => {
    const stale = changeCardReducer(card(), { type: 'stale', refreshed: REFRESHED }, NOW);
    expect(stale.state).toBe('stale');
    expect(stale.refreshed).toEqual(REFRESHED);
    expect(changeCardReducer(stale, { type: 'apply' }, NOW)).toBe(stale);
    expect(availableActions(stale, NOW)).not.toContain('apply');

    const refreshed = changeCardReducer(stale, { type: 'refresh' }, later(HOUR));
    expect(refreshed.state).toBe('pending');
    expect(refreshed.items).toEqual(REFRESHED.items);
    expect(refreshed.impact).toEqual(REFRESHED.impact);
    expect(refreshed.refreshed).toBeUndefined();
    expect(refreshed.createdAt).toBe(later(HOUR).toISOString());
    expect(availableActions(refreshed, later(HOUR))).toContain('apply');
    expect(changeCardReducer(refreshed, { type: 'apply' }, later(HOUR)).state).toBe('applied');
  });

  it('edit: a refreshed version without impact drops the stale impact', () => {
    const stale = changeCardReducer(card(), { type: 'stale', refreshed: { items: REFRESHED.items } }, NOW);
    const refreshed = changeCardReducer(stale, { type: 'refresh' }, NOW);
    expect(refreshed.items).toEqual(REFRESHED.items);
    expect(refreshed.impact).toBeUndefined();
  });

  it('edit: refresh needs a refreshed version; stale only applies to live proposals', () => {
    const staleWithout = card({ state: 'stale' });
    expect(changeCardReducer(staleWithout, { type: 'refresh' }, NOW)).toBe(staleWithout);
    const applied = card({ state: 'applied' });
    expect(changeCardReducer(applied, { type: 'stale', refreshed: REFRESHED }, NOW)).toBe(applied);
  });

  it('destructive: only the typed confirmation completes it; apply and undo never do', () => {
    const confirm = card({ class: 'destructive', title: 'end Spring cut', confirm: { consequence: 'Ends the plan today.', word: 'end', actionLabel: 'End plan' } });
    expect(changeCardReducer(confirm, { type: 'apply' }, NOW)).toBe(confirm);
    expect(changeCardReducer(confirm, { type: 'undo' }, NOW)).toBe(confirm);
    expect(changeCardReducer(confirm, { type: 'confirmed' }, NOW).state).toBe('applied');
    expect(changeCardReducer(confirm, { type: 'discard' }, NOW).state).toBe('discarded');
    // "confirmed" means nothing to any other class
    for (const cls of ['log', 'edit', 'blocked', 'uiOnly', 'read'] as const) {
      const c = card({ class: cls });
      expect(changeCardReducer(c, { type: 'confirmed' }, NOW)).toBe(c);
    }
  });

  it('blocked and UI-only cards can be dismissed; read cards cannot change', () => {
    expect(changeCardReducer(card({ class: 'blocked', state: 'applied' }), { type: 'discard' }, NOW).state).toBe('discarded');
    expect(changeCardReducer(card({ class: 'uiOnly', state: 'applied' }), { type: 'discard' }, NOW).state).toBe('discarded');
    const read = card({ class: 'read', state: 'applied' });
    for (const ev of ALL_EVENTS) expect(changeCardReducer(read, ev, NOW)).toBe(read);
  });
});

describe('changeCard — actions on offer', () => {
  const acts = (over: Partial<ChangeCardModel>, at: Date = NOW) => availableActions(card(over), at);

  it('read cards offer nothing', () => {
    expect(acts({ class: 'read', state: 'applied' })).toEqual([]);
  });

  it('log cards: Edit and Undo in the window, Edit after it, Redo when undone, Log it when suggested', () => {
    expect(acts({ class: 'log', state: 'applied' })).toEqual(['edit', 'undo']);
    expect(acts({ class: 'log', state: 'applied', createdAt: ago(25 * HOUR) })).toEqual(['edit']);
    expect(acts({ class: 'log', state: 'undone' })).toEqual(['redo']);
    expect(acts({ class: 'log', state: 'pending' })).toEqual(['apply', 'discard']);
    expect(acts({ class: 'log', state: 'discarded' })).toEqual([]);
  });

  it('edit cards: Apply · Adjust · Discard while live; review on stale; Undo in the window; nothing once over', () => {
    expect(acts({ state: 'pending' })).toEqual(['apply', 'adjust', 'discard']);
    expect(acts({ state: 'pending', createdAt: ago(25 * HOUR) })).toEqual([]);
    expect(acts({ state: 'stale', refreshed: REFRESHED })).toEqual(['review', 'discard']);
    expect(acts({ state: 'applied' })).toEqual(['undo']);
    expect(acts({ state: 'applied', createdAt: ago(25 * HOUR) })).toEqual([]);
    expect(acts({ state: 'undone' })).toEqual(['redo']);
    expect(acts({ state: 'expired' })).toEqual([]);
    expect(acts({ state: 'discarded' })).toEqual([]);
  });

  it('destructive cards only offer review (the dialog) and not now — never a direct action', () => {
    expect(acts({ class: 'destructive', state: 'pending' })).toEqual(['review', 'dismiss']);
    for (const state of STATES) {
      const a = acts({ class: 'destructive', state });
      expect(a).not.toContain('apply');
      expect(a).not.toContain('undo');
    }
    expect(acts({ class: 'destructive', state: 'applied' })).toEqual([]);
  });

  it('blocked cards offer the alternatives and leave it; UI-only cards a link', () => {
    expect(acts({ class: 'blocked', state: 'applied' })).toEqual(['alternative', 'dismiss']);
    expect(acts({ class: 'blocked', state: 'discarded' })).toEqual([]);
    expect(acts({ class: 'uiOnly', state: 'applied' })).toEqual(['open']);
    expect(acts({ class: 'uiOnly', state: 'discarded' })).toEqual([]);
  });
});

describe('changeCard — withClock', () => {
  it('collapses an out-of-date proposal to expired at render time', () => {
    const old = card({ createdAt: ago(25 * HOUR) });
    expect(withClock(old, NOW).state).toBe('expired');
    const live = card();
    expect(withClock(live, NOW)).toBe(live);
  });

  it('leaves everything else as stored', () => {
    for (const c of [
      card({ class: 'log', state: 'applied', createdAt: ago(25 * HOUR) }),
      card({ class: 'destructive', state: 'pending', createdAt: ago(25 * HOUR) }),
      card({ state: 'stale', createdAt: ago(25 * HOUR), refreshed: REFRESHED }),
    ]) {
      expect(withClock(c, NOW)).toBe(c);
    }
  });
});
