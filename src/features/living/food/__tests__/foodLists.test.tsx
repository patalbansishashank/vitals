import { fireEvent, screen, within } from '@testing-library/react';
import { renderLiving } from '../../testing';
import { GroceriesFace, type GroceriesFaceProps } from '../components/GroceriesFace';
import { SupplementsFace } from '../components/SupplementsFace';
import type { FoodProfileView } from '../profile';

const groceryProps = (): GroceriesFaceProps => ({
  list: {
    from: '2026-10-01',
    to: '2026-10-01',
    count: 1,
    groups: [
      {
        aisle: 'dairy',
        items: [
          {
            key: 'paneer',
            name: 'paneer',
            aisle: 'dairy',
            grams: 200,
            buy: 'paneer 200 g pack',
            dates: ['2026-10-01'],
            have: false,
            bought: false,
          },
        ],
      },
    ],
  },
  horizon: 'today',
  onHorizon: vi.fn(),
  budget: { tier: 'normal', deferred: false },
  onBudget: vi.fn(),
  onBought: vi.fn(),
  onHave: vi.fn(),
  onShare: vi.fn(),
  onPrint: vi.fn(),
});
const profile: FoodProfileView = {
  dietAnswered: true,
  dietKind: 'vegetarian',
  familyFoodMode: false,
  kitchenScale: false,
  supplementStance: 'food_first',
  safetyFlags: [],
};

describe('food list cards', () => {
  it('keeps shopping quantities in quiet mode while progress uses only words', () => {
    renderLiving(<GroceriesFace {...groceryProps()} quiet />);
    const meter = screen.getByRole('meter', { name: 'Grocery progress' });
    expect(meter).not.toHaveAttribute('aria-valuenow');
    expect(meter).toHaveAttribute('aria-valuetext', 'Grocery progress, Ready to shop');
    expect(screen.getByText('200 g pack')).toBeInTheDocument();
    expect(screen.queryByText('To buy')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Ready to shop' })).toBeInTheDocument();
  });

  it('uses the home icon as a named toggle that writes the pantry', () => {
    const props = groceryProps();
    renderLiving(<GroceriesFace {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Already have paneer' }));
    expect(props.onHave).toHaveBeenCalledWith('paneer', true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(props.onBought).toHaveBeenCalledWith('paneer', true);
  });

  it('puts food-first advice in the info panel and keeps the prescribed dose loggable', async () => {
    const onTaken = vi.fn();
    const dose = { supplementId: 'creatine', dose: 5, unit: 'g' };
    renderLiving(
      <SupplementsFace supplements={[dose]} taken={new Set()} canLog profile={profile} onTaken={onTaken} />,
    );
    expect(screen.getByRole('img', { name: '0 of 1 taken' })).toBeInTheDocument();
    const row = screen.getByRole('button', { name: 'Mark creatine as taken' }).closest('li')!;
    expect(row).toHaveTextContent(/5 g · any time/);
    expect(screen.queryByText(/Vegetarian diets are often low in vitamin B12/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark creatine as taken' }));
    expect(onTaken).toHaveBeenCalledWith(dose);
    fireEvent.click(screen.getByRole('button', { name: 'About Supplements' }));
    const panel = await screen.findByRole('dialog', { name: 'Supplements, food first' });
    expect(
      within(panel).getAllByText(/Vegetarian diets are often low in vitamin B12/).length,
    ).toBeGreaterThan(0);
  });
});
