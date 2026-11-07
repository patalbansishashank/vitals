import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fixturePlan, FIXTURE_TODAY } from '../../data/fixtures';
import { renderLiving } from '../../testing';
import { GoalsSection } from './GoalsSection';
import { CheckInsSection } from './CheckInsSection';

const plan = fixturePlan();

describe('Progress Goal hero', () => {
  it('keeps the start-to-goal picture while verdicts and the trend are forming', async () => {
    const h = renderLiving(<GoalsSection plan={plan} today={FIXTURE_TODAY} quiet={false} />, {
      source: (stub) => ({ ...stub.source, driftCards: () => [], monitoredGoals: () => [], trend: () => null }),
    });
    expect(screen.getByRole('heading', { name: 'Goal', level: 2 })).toBeInTheDocument();
    const card = h.result.container.querySelector('#goals')!;
    expect(card.querySelector('.lmz-track')).not.toBeNull();
    expect(card.textContent).toMatch(/Trend forming/);
    expect(card.querySelector('.lmz-track__thumb')).toBeNull();
  });

  it('shows the conditional change range and moves its data into the information panel', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<GoalsSection plan={plan} today={FIXTURE_TODAY} quiet={false} />);
    const card = h.result.container.querySelector('#goals')!;
    expect(card.querySelector('.lm-hero__range')?.textContent).toMatch(/^Range/);
    expect(within(card as HTMLElement).queryByRole('button', { name: 'Table' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'About Goal' }));
    expect(await screen.findByRole('dialog', { name: 'How goals are checked' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Goal table' })).toBeInTheDocument();
  });

  it('quiet mode keeps words and the range picture without digits in the card or its table', async () => {
    const h = renderLiving(<GoalsSection plan={plan} today={FIXTURE_TODAY} quiet />);
    const card = h.result.container.querySelector('#goals')!;
    expect(card.textContent).not.toMatch(/\d|kcal|\bkg\b/);
    await userEvent.click(screen.getByRole('button', { name: 'About Goal' }));
    const panel = await screen.findByRole('dialog', { name: 'How goals are checked' });
    expect(within(panel).queryByRole('table')).toBeNull();
    expect(panel.textContent).not.toMatch(/kcal|\bkg\b/);
  });
});

describe('Progress Check-ins', () => {
  it('shows four dated rows, lets the person expand the history, and opens the selected weekly report', async () => {
    const user = userEvent.setup();
    const longer = fixturePlan(FIXTURE_TODAY, { dayIndex: 70 });
    renderLiving(<CheckInsSection plan={longer} today={FIXTURE_TODAY} quiet={false} />, { plan: longer });
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'See all' }));
    expect(within(list).getAllByRole('listitem').length).toBeGreaterThan(4);
    await user.click(screen.getByRole('button', { name: 'Check-in Thu 1 Oct' }));
    expect(await screen.findByRole('dialog', { name: 'Check-in Thu 1 Oct' })).toBeInTheDocument();
  });

  it('quiet mode keeps dates and directions, with no change or compliance numbers', () => {
    const h = renderLiving(<CheckInsSection plan={plan} today={FIXTURE_TODAY} quiet />);
    const card = h.result.container.querySelector('#checkins')!;
    expect(card.textContent).not.toMatch(/kg|\d\s*%|complete food days \d|\d weeks/);
  });
});
