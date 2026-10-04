import { useState } from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderLiving } from '../../testing';
import { ChangeCard, cardObject, withoutEnergy, type ChangeCardView } from '../../components/ChangeCard';

const NOW = new Date('2026-10-01T13:00:00');
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const LOG: ChangeCardView = {
  id: 'log-1',
  class: 'log',
  title: 'Logged lunch · 13:00',
  source: { label: 'Coach · text', confidence: 0.78, band: 'typed meal: about ±20 % for energy' },
  createdAt: ago(HOUR),
  items: [
    { label: 'dal', before: null, after: '1 katori ≈ 150 g (110–200) · 230 kcal' },
    { label: 'rice', before: null, after: '1 cup ≈ 160 g (120–210) · 210 kcal' },
  ],
  totals: '≈ 640 kcal (510–780) · protein 33 g (25–41)',
  state: 'applied',
};

const EDIT: ChangeCardView = {
  id: 'edit-1',
  class: 'edit',
  title: 'Proposal · no training Thu–Sat',
  source: { label: 'Coach · proposal' },
  createdAt: ago(HOUR),
  items: [{ label: 'Thu 1 Oct', before: 'strength session 17:30', after: 'rest, your usual steps' }],
  impact: {
    goalDates: [{ label: 'goal date', before: ['2026-12-21', '2026-12-30'], after: ['2026-12-23', '2027-01-01'] }],
    metrics: [{ label: 'weight by the end', delta: 0.2, unit: 'kg', decimals: 1 }],
  },
  state: 'pending',
};

const CONFIRM: ChangeCardView = {
  id: 'confirm-1',
  class: 'destructive',
  title: 'end Spring cut',
  createdAt: ago(HOUR),
  items: [],
  confirm: { consequence: 'Ends the plan today. Logs and versions are kept; you can restore it for 7 days.', word: 'end', actionLabel: 'End plan' },
  state: 'pending',
};

const BLOCKED: ChangeCardView = {
  id: 'blocked-1',
  class: 'blocked',
  title: 'a 48-hour fast',
  createdAt: ago(HOUR),
  items: [],
  blocked: { rule: 'Your fasting opt-in allows up to 24 hours.', alternatives: [{ id: 'fast24', label: 'Plan a 24-hour fast instead' }] },
  state: 'applied',
};

const PHOTO: ChangeCardView = {
  ...LOG,
  id: 'photo-1',
  source: { label: 'Coach · photo', confidence: 0.74, band: 'photo only: about ±35 % for energy' },
  items: [],
  totals: '≈ 720 kcal (470–970) · protein 24 g (12–36)',
  meal: {
    photo: { url: '', alt: 'Your photo: dal tadka, rice, roti' },
    components: [
      { id: 'dal', name: 'dal tadka', portion: '1 katori', grams: 150, gramsLow: 100, gramsHigh: 210, kcal: 240 },
      { id: 'rice', name: 'rice', portion: '1 plate', grams: 250, gramsLow: 180, gramsHigh: 330, kcal: 325 },
    ],
    cue: 'looks glossy: about 2 tsp oil added',
    saw: ['steel plate (about 26 cm)', 'a katori'],
    unseen: ['how deep the katori is'],
    review: true,
  },
};

function show(card: ChangeCardView, extra: { context?: 'standalone' | 'conversation'; quiet?: boolean } = {}) {
  const onAction = vi.fn();
  const h = renderLiving(<ChangeCard card={card} now={NOW} onAction={onAction} context={extra.context ?? 'conversation'} quiet={extra.quiet} />);
  return { onAction, ...h };
}

describe('ChangeCard', () => {
  it('names keys with their object', () => {
    expect(cardObject(LOG)).toBe('logged lunch');
    expect(cardObject(EDIT)).toBe('proposal: no training Thu–Sat');
    expect(cardObject(CONFIRM)).toBe('end Spring cut');
    expect(withoutEnergy('≈ 640 kcal (510–780) · protein 33 g (25–41)')).toBe('protein 33 g (25–41)');
  });

  it('log: an applied card with values, source and undo window; Undo and Edit report their action', async () => {
    const user = userEvent.setup();
    const { onAction } = show(LOG);
    const article = screen.getByRole('article', { name: 'Logged lunch · 13:00' });
    expect(within(article).getByText('Coach · text')).toBeInTheDocument();
    expect(within(article).getByText('23 h to undo')).toBeInTheDocument();
    expect(within(article).getByText('1 katori ≈ 150 g (110–200) · 230 kcal')).toBeInTheDocument();
    expect(within(article).getByText('≈ 640 kcal (510–780) · protein 33 g (25–41)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo logged lunch' }));
    expect(onAction).toHaveBeenLastCalledWith('undo');
    await user.click(screen.getByRole('button', { name: 'Edit logged lunch' }));
    expect(onAction).toHaveBeenLastCalledWith('edit');
  });

  it('log in quiet mode shows portions without kcal', () => {
    show(LOG, { quiet: true });
    expect(screen.getByText('1 katori ≈ 150 g (110–200)')).toBeInTheDocument();
    expect(screen.getByText('protein 33 g (25–41)')).toBeInTheDocument();
    expect(screen.queryByText(/kcal/)).not.toBeInTheDocument();
  });

  it('edit: diff, goal dates before → after and metric impact; Apply is never pre-focused', async () => {
    const user = userEvent.setup();
    const { onAction } = show(EDIT);
    const apply = screen.getByRole('button', { name: 'Apply proposal: no training Thu–Sat' });
    expect(apply).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
    expect(screen.getByText('strength session 17:30')).toBeInTheDocument();
    expect(screen.getByText('rest, your usual steps')).toBeInTheDocument();
    expect(screen.getByText('21–30 Dec')).toBeInTheDocument();
    expect(screen.getByText('23 Dec 2026–1 Jan 2027')).toBeInTheDocument();
    expect(screen.getByText('weight by the end')).toBeInTheDocument();
    expect(screen.getByText('expires in 23 h')).toBeInTheDocument();
    await user.click(apply);
    expect(onAction).toHaveBeenLastCalledWith('apply');
    await user.click(screen.getByRole('button', { name: 'Adjust proposal: no training Thu–Sat' }));
    expect(onAction).toHaveBeenLastCalledWith('adjust');
    await user.click(screen.getByRole('button', { name: 'Discard proposal: no training Thu–Sat' }));
    expect(onAction).toHaveBeenLastCalledWith('discard');
  });

  it('destructive: carries no action itself — only Review and confirm… and Not now', async () => {
    const user = userEvent.setup();
    const { onAction } = show(CONFIRM);
    expect(screen.getByRole('article', { name: 'Needs your confirmation · end Spring cut' })).toBeInTheDocument();
    expect(screen.getByText('Ends the plan today. Logs and versions are kept; you can restore it for 7 days.')).toBeInTheDocument();
    const keys = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(keys).toEqual(['Review and confirm: end Spring cut', 'Not now: end Spring cut']);
    expect(screen.queryByRole('button', { name: /^(apply|confirm|end plan)/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review and confirm: end Spring cut' }));
    expect(onAction).toHaveBeenLastCalledWith('review');
    await user.click(screen.getByRole('button', { name: 'Not now: end Spring cut' }));
    expect(onAction).toHaveBeenLastCalledWith('dismiss');
  });

  it('blocked: names the rule and offers the allowed alternatives as keys', async () => {
    const user = userEvent.setup();
    const { onAction } = show(BLOCKED);
    expect(screen.getByRole('article', { name: 'Not allowed by your safety settings · a 48-hour fast' })).toBeInTheDocument();
    expect(screen.getByText(/Your fasting opt-in allows up to 24 hours\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Plan a 24-hour fast instead' }));
    expect(onAction).toHaveBeenLastCalledWith('alternative', { alternativeId: 'fast24' });
    await user.click(screen.getByRole('button', { name: 'Leave it: a 48-hour fast' }));
    expect(onAction).toHaveBeenLastCalledWith('dismiss');
  });

  it('stale: shows the refreshed diff and offers the update instead of Apply', async () => {
    const user = userEvent.setup();
    const { onAction } = show({ ...EDIT, state: 'stale', refreshed: { items: [{ label: 'Fri 2 Oct', before: 'cardio session 07:30', after: 'rest' }] } });
    expect(screen.getByText('Something changed since this was proposed. Updated version:')).toBeInTheDocument();
    expect(screen.getByText('cardio session 07:30')).toBeInTheDocument();
    expect(screen.queryByText('strength session 17:30')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Apply/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use the updated proposal: no training Thu–Sat' }));
    expect(onAction).toHaveBeenLastCalledWith('review');
  });

  it('undone: the title is struck and only Redo is offered', async () => {
    const user = userEvent.setup();
    const { onAction } = show({ ...LOG, state: 'undone' });
    const article = screen.getByRole('article', { name: /Logged lunch · 13:00\s*\(undone\)/ });
    expect(article).toHaveAttribute('data-state', 'undone');
    expect(screen.queryByRole('button', { name: 'Undo logged lunch' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Redo logged lunch' }));
    expect(onAction).toHaveBeenLastCalledWith('redo');
  });

  it('expired: an out-of-date proposal says so and offers nothing', () => {
    show({ ...EDIT, createdAt: ago(25 * HOUR) });
    expect(screen.getByText('Expired — ask again')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('discarded: collapses to one line', () => {
    show({ ...EDIT, state: 'discarded' });
    expect(screen.getByRole('heading', { name: 'Discarded · Proposal · no training Thu–Sat' })).toBeInTheDocument();
    expect(screen.queryByText('strength session 17:30')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('UI-only: "Only you can change that" with a link to the setting', () => {
    show({ id: 'ui-1', class: 'uiOnly', title: 'sync', createdAt: ago(HOUR), items: [], setting: { label: 'Open Settings', to: '/settings' }, state: 'applied' });
    expect(screen.getByRole('article', { name: 'Only you can change that · sync' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '/settings');
  });

  it('read: one collapsed line that discloses each lookup', async () => {
    const user = userEvent.setup();
    show({ id: 'read-1', class: 'read', title: 'looked at', createdAt: ago(HOUR), items: [], reads: [{ label: 'today’s log', summary: 'Nothing since breakfast.' }, { label: 'plan v3' }], state: 'applied' });
    const toggle = screen.getByRole('button', { name: /looked at · today’s log · plan v3/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Nothing since breakfast.')).not.toBeVisible();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Nothing since breakfast.')).toBeVisible();
  });

  it('is a faceplate standalone and an inset region inside the conversation', () => {
    const a = show(LOG, { context: 'standalone' });
    expect(screen.getByRole('article', { name: 'Logged lunch · 13:00' })).toHaveClass('lm-face');
    a.result.unmount();
    show(LOG, { context: 'conversation' });
    const inset = screen.getByRole('article', { name: 'Logged lunch · 13:00' });
    expect(inset).not.toHaveClass('lm-face');
    expect(inset).toHaveAttribute('data-context', 'conversation');
  });

  it('what I saw: thumbnail, cue, references, uncertainties; editing a gram chip reports the grams', async () => {
    const user = userEvent.setup();
    const { onAction } = show(PHOTO);
    expect(screen.getByRole('img', { name: 'Your photo: dal tadka, rice, roti' })).toBeInTheDocument();
    expect(screen.getByText('looks glossy: about 2 tsp oil added')).toBeInTheDocument();
    expect(screen.getByText(/steel plate \(about 26 cm\), a katori/)).toBeInTheDocument();
    expect(screen.getByText(/how deep the katori is/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Looks right: logged lunch' }));
    expect(onAction).toHaveBeenLastCalledWith('dismiss');
    await user.click(screen.getByRole('button', { name: 'Change dal tadka: 1 katori ≈ 150 g (100–210)' }));
    const field = screen.getByLabelText('dal tadka, grams');
    await user.clear(field);
    await user.type(field, '180{Enter}');
    expect(onAction).toHaveBeenLastCalledWith('edit', { componentId: 'dal', grams: 180 });
  });

  it('announces state changes politely, not on first render', async () => {
    const user = userEvent.setup();
    function Flip() {
      const [c, setC] = useState<ChangeCardView>(LOG);
      return (
        <>
          <button type="button" onClick={() => setC({ ...LOG, state: 'undone' })}>
            flip
          </button>
          <ChangeCard card={c} now={NOW} onAction={() => undefined} context="conversation" />
        </>
      );
    }
    renderLiving(<Flip />);
    const live = screen.getByRole('article').querySelector('[aria-live="polite"]')!;
    expect(live).toHaveTextContent('');
    await user.click(screen.getByRole('button', { name: 'flip' }));
    expect(live).toHaveTextContent('Logged lunch · 13:00: undone. Redo available.');
  });
});
