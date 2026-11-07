import type { ReactElement } from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '@/components';
import { renderLiving } from '../../testing';
import FoodPage from '../FoodPage';
import { resetFoodStore, useFoodStore } from '../mealPlanStore';
import { FoodProfileContext, type FoodProfileView } from '../profile';
import { createMockRecipeProvider, RecipeProviderContext, type RecipeProvider } from '../recipes';

const ANSWERED: FoodProfileView = { dietAnswered: true, dietKind: 'vegetarian', familyFoodMode: false, kitchenScale: false, supplementStance: 'food_first', safetyFlags: [] };

function ui(o: { provider?: RecipeProvider; profile?: FoodProfileView } = {}): ReactElement {
  let el: ReactElement = (
    <>
      <FoodPage />
      <Toaster />
    </>
  );
  if (o.profile) el = <FoodProfileContext.Provider value={o.profile}>{el}</FoodProfileContext.Provider>;
  if (o.provider) el = <RecipeProviderContext.Provider value={o.provider}>{el}</RecipeProviderContext.Provider>;
  return el;
}

/** The Undo key of the toast that says `message`. */
async function undoIn(message: string | RegExp) {
  const msg = await screen.findByText(message, { selector: '.lm-toast__msg' });
  return within(msg.parentElement!).getByRole('button', { name: 'Undo' });
}

const groceries = () => document.getElementById('groceries')!;
const TARGETS = /1,850 kcal/i;
async function planDay(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'More' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Plan my day' }));
}

beforeEach(() => resetFoodStore());

describe('Food', () => {
  it('renders the targets and the three meal slots with plain targets when there is no AI provider', async () => {
    const user = userEvent.setup();
    renderLiving(ui(), { path: '/food', route: 'food' });
    // the header: the destination as the title, the date once as its fact line
    const h1 = await screen.findByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent(/^Food$/);
    expect(screen.getByText('Thursday, 1 October')).toBeInTheDocument();
    expect(document.title).toBe('Food · Thu 1 Oct · Vitals');
    expect(screen.getByRole('heading', { name: 'Targets' })).toBeInTheDocument();
    // the Targets card is a channel strip: one line per nutrient with its target readout
    expect(document.getElementById('targets')!.textContent).toMatch(TARGETS);
    for (const slot of ['lunch', 'snack', 'dinner']) expect(screen.getByRole('heading', { level: 3, name: slot })).toBeInTheDocument();
    // r068 L8: each open meal leads with its dish (the plan's kind of meal as an example) over its numbers
    const meals = document.getElementById('meals')!;
    expect(meals.querySelectorAll('.lv-meal__dish')).toHaveLength(3);
    // no provider: no notice on the page and no disabled "Plan my day"; the reason and its one key are in the recipe flow
    // (r068 L9: the meal's sheet leads with the dish and carries no footnote)
    expect(screen.queryByText('Recipes need an AI provider')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Plan my day' })).not.toBeInTheDocument();
    // one ⋯ per screen: the meal rows carry none
    expect(within(meals).queryByRole('button', { name: /^More for / })).not.toBeInTheDocument();
    await user.click(within(meals).getByRole('button', { name: 'lunch' }));
    const sheet = await screen.findByRole('dialog', { name: 'Lunch' });
    expect(within(sheet).queryByText('Recipes need an AI provider')).not.toBeInTheDocument();
    expect(sheet.querySelector('.lv-mealsheet__dish')?.textContent).toMatch(/^For example /);
    await user.click(within(sheet).getByRole('button', { name: 'Recipe and targets' }));
    const recipe = await screen.findByRole('dialog', { name: 'Lunch targets' });
    expect(within(recipe).getByText('Recipes need an AI provider')).toBeInTheDocument();
    expect(within(recipe).getByRole('link', { name: 'Set up a provider' })).toHaveAttribute('href', '/settings');
    await user.click(within(recipe).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Lunch targets' })).not.toBeInTheDocument());
    // nothing to buy all week: no Groceries card; no weekly ledger, no in-page notices, no grocery bar
    expect(document.getElementById('groceries')).toBeNull();
    expect(screen.queryByText(/^This week/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Groceries ·/ })).not.toBeInTheDocument();
    // one ⋯ on the page: the header's, with the page's items first (no kitchen planning without a provider)
    expect(screen.queryByRole('button', { name: 'Food menu' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.queryByRole('menuitem', { name: 'Pantry' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Things that won’t help' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Use what’s in my kitchen' })).not.toBeInTheDocument();
  });

  it('opens the one pantry page from its card foot', async () => {
    const user = userEvent.setup();
    const h = renderLiving(ui(), { path: '/food', route: 'food', routes: [{ path: 'food/pantry', element: <p>pantry page</p> }] });
    await user.click(await screen.findByRole('link', { name: 'Edit pantry' }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe('/food/pantry'));
  });

  it('"I ate this" logs the slot as planned with an estimate and no source chip, and Undo takes it back', async () => {
    const user = userEvent.setup();
    const h = renderLiving(ui(), { path: '/food', route: 'food' });
    await user.click(await screen.findByRole('button', { name: 'I ate this: lunch as planned' }));
    // inside the Lunch slot the entry drops the slot's own name: "as planned ≈ 685 kcal"
    const label = await screen.findByText('as planned');
    const row = label.closest('li')!;
    expect(within(row).getByText(/≈/)).toBeInTheDocument();
    expect(within(row).getByText(/\d+[–−]\d+/)).toBeInTheDocument();
    expect(within(row).queryByText(/^you ·/)).not.toBeInTheDocument();
    expect(h.stub.inspect().entries).toHaveLength(1);
    // the Targets card: energy says what is left; the macro tiles carry no "left / over" caption of their own
    await waitFor(() => expect(document.getElementById('targets')!.textContent).toMatch(/kcal left/));
    expect(document.getElementById('targets')!.textContent).not.toMatch(/\d g (left|over)/);

    await user.click(await undoIn('Lunch logged as planned'));
    await waitFor(() => expect(h.stub.inspect().entries).toHaveLength(0));
    await waitFor(() => expect(screen.queryByText('as planned')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'I ate this: lunch as planned' })).toBeInTheDocument();
  });

  it('keeps Accept (plan it, groceries update) and I ate this (log it) apart', async () => {
    const user = userEvent.setup();
    const h = renderLiving(ui({ provider: createMockRecipeProvider(), profile: ANSWERED }), { path: '/food', route: 'food' });
    await screen.findByRole('heading', { name: 'Targets' });
    await planDay(user);
    await user.click(await screen.findByRole('button', { name: 'Accept paneer bhurji for lunch' }));

    await waitFor(() => expect(document.getElementById('groceries')).not.toBeNull());
    expect(await within(groceries()).findByText((_, el) => !!el?.classList.contains('lv-food-grocery__label') && /paneer\s*200 g pack/.test(el.textContent ?? ''))).toBeInTheDocument();
    expect(within(groceries()).getByRole('heading', { name: 'Dairy' })).toBeInTheDocument();
    // the count is the card's fact line, not a bar of its own
    expect(within(groceries()).getByText('To buy')).toBeInTheDocument();
    expect(within(groceries()).getByRole('meter', { name: /Grocer/ })).toBeInTheDocument();
    expect(h.stub.inspect().entries).toHaveLength(0);
    expect(screen.getByText('accepted')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept paneer bhurji for lunch' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'I ate this: lunch as planned' }));
    await waitFor(() => expect(h.stub.inspect().entries).toHaveLength(1));
    expect(within(groceries()).getByText((_, el) => !!el?.classList.contains('lv-food-grocery__label') && /paneer\s*200 g pack/.test(el.textContent ?? ''))).toBeInTheDocument();
    expect(screen.getByText('accepted')).toBeInTheDocument();
  });

  it('"I ate this" on an accepted recipe logs one serving of the recipe, not the slot target (Q1B-B-05)', async () => {
    const user = userEvent.setup();
    const h = renderLiving(ui({ provider: createMockRecipeProvider(), profile: ANSWERED }), { path: '/food', route: 'food' });
    const answerMeal = vi.spyOn(h.stub.actions, 'answerMeal');
    await screen.findByRole('heading', { name: 'Targets' });
    await planDay(user);
    await user.click(await screen.findByRole('button', { name: 'Accept paneer bhurji for lunch' }));
    const recipe = useFoodStore.getState().accepted[Object.keys(useFoodStore.getState().accepted)[0]!]!.recipe;
    await user.click(screen.getByRole('button', { name: 'I ate this: lunch as planned' }));
    await waitFor(() => expect(answerMeal).toHaveBeenCalledTimes(1));
    expect(answerMeal.mock.calls[0]![1]).toEqual({
      slot: 'lunch',
      mark: 'asPlanned',
      replaces: [],
      serving: {
        name: recipe.dish,
        energyKcal: recipe.perServing.energyKcal.value,
        proteinG: recipe.perServing.proteinG.value,
        carbG: recipe.perServing.carbG.value,
        fatG: recipe.perServing.fatG.value,
        // the recipe's fibre travels with the serving so the frozen numbers close their convention energy (D6-02)
        ...(recipe.perServing.fibreG ? { fibreG: recipe.perServing.fibreG.value } : {}),
      },
    });
    // exactly one serving of the recipe is logged, carrying the recipe's own numbers
    await waitFor(() => expect(h.stub.inspect().entries).toHaveLength(1));
    const e = h.stub.inspect().entries[0]!;
    expect(e).toMatchObject({ kind: 'meal', slot: 'lunch' });
    expect(e.kind === 'meal' && e.components.map((c) => c.name)).toEqual([recipe.dish]);
    expect(e.kind === 'meal' && e.totals.energyKcal.value).toBe(recipe.perServing.energyKcal.value);
  });

  it('asks "Don’t suggest … again?" after a swap', async () => {
    const user = userEvent.setup();
    renderLiving(ui({ provider: createMockRecipeProvider(), profile: ANSWERED }), { path: '/food', route: 'food' });
    await screen.findByRole('heading', { name: 'Targets' });
    await planDay(user);
    await screen.findByRole('button', { name: 'Accept paneer bhurji for lunch' });
    expect(screen.getByText('Chana masala, rice, salad')).toBeInTheDocument();
    expect(screen.getByText('Closest fit')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Swap the lunch recipe' }));
    expect(await screen.findByText('Don’t suggest paneer bhurji again?')).toBeInTheDocument();
    expect(screen.getByText('Moong dal chilla with curd')).toBeInTheDocument();
    expect(screen.getByText('Chana masala, rice, salad')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Don’t suggest' }));
    expect(screen.queryByText('Don’t suggest paneer bhurji again?')).not.toBeInTheDocument();
    expect(useFoodStore.getState().dontSuggest).toContain('paneer bhurji');
  });

  it('opens a suggested recipe straight from its dish on the row', async () => {
    const user = userEvent.setup();
    renderLiving(ui({ provider: createMockRecipeProvider(), profile: ANSWERED }), { path: '/food', route: 'food' });
    await screen.findByRole('heading', { name: 'Targets' });
    await planDay(user);
    const dish = await screen.findByRole('button', { name: 'Chana masala, rice, salad' });
    expect(dish.closest('.lm-rail__title')).not.toBeNull();
    expect(dish.closest('li')!.querySelector('.lv-food-recipe__dish')).toBeNull();
    expect(dish.closest('li')!.querySelector('.lv-food-recipe__amount')).toHaveTextContent(/target/);
    await user.click(dish);
    const sheet = await screen.findByRole('dialog', { name: 'Chana masala, rice, salad' });
    expect(within(sheet).getByRole('heading', { name: 'Ingredients' })).toBeInTheDocument();
  });

  it('shows a per-slot failure with Try again', async () => {
    const user = userEvent.setup();
    renderLiving(ui({ provider: createMockRecipeProvider({ fail: ['snack'] }), profile: ANSWERED }), { path: '/food', route: 'food' });
    await screen.findByRole('heading', { name: 'Targets' });
    await planDay(user);
    expect(await screen.findByText('Couldn’t make a recipe this time.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again: snack recipe' })).toBeInTheDocument();
    expect(screen.queryAllByText(/for example/)).toHaveLength(0);
  });

  it('asks for the food rules before recipes, with one link in the meal sheet and no disabled key', async () => {
    const user = userEvent.setup();
    renderLiving(ui({ provider: createMockRecipeProvider() }), { path: '/food', route: 'food' });
    await screen.findByRole('heading', { name: 'Targets' });
    expect(screen.queryByRole('link', { name: 'Tell us what you eat to get recipes' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'dinner' }));
    const sheet = await screen.findByRole('dialog', { name: 'Dinner' });
    const link = within(sheet).getByRole('link', { name: 'Tell us what you eat to get recipes' });
    expect(link).toHaveAttribute('href', '/onboarding/diet');
    expect(screen.queryByRole('button', { name: 'Plan my day' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Targets' })).toBeInTheDocument();
  });

  it('offers "Use what’s in my kitchen" in the header ⋯ once recipes can run, reading the one pantry', async () => {
    const user = userEvent.setup();
    renderLiving(ui({ provider: createMockRecipeProvider(), profile: ANSWERED }), { path: '/food', route: 'food' });
    await user.click(await screen.findByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Use what’s in my kitchen' }));
    const row = await screen.findByRole('link', { name: /^Pantry · \d+ items?$/ });
    expect(row).toHaveAttribute('href', '/food/pantry');
    expect(screen.queryByText('Nothing marked yet.')).not.toBeInTheDocument();
  });

  it('logs a typed meal from the manual logger', async () => {
    const user = userEvent.setup();
    const h = renderLiving(ui(), { path: '/food', route: 'food' });
    // the row opens its sheet (no per-row ⋯); "I ate something else" there opens the logger
    await user.click(await screen.findByRole('button', { name: 'snack' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Snack' })).getByRole('button', { name: 'I ate something else' }));
    // r068 L10: one field searches the food table or, with nothing picked, is the description
    const search = await screen.findByRole('searchbox', { name: 'Search or describe' });
    // a placeholder, not a help line; no "Tell the Coach instead" without a provider
    expect(search).toHaveAttribute('placeholder', 'dal, or 2 idlis with sambar');
    expect(screen.queryByText(/^Try dal/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tell the Coach instead' })).not.toBeInTheDocument();
    await user.type(search, 'dal');
    await user.click(await screen.findByRole('button', { name: 'Add dal' }));
    expect(screen.getByText('estimated composition')).toBeInTheDocument();
    // the commit is the sheet header's verb (the title already names the meal)
    await user.click(screen.getByRole('button', { name: 'Log' }));

    await waitFor(() => expect(h.stub.inspect().entries).toHaveLength(1));
    const e = h.stub.inspect().entries[0]!;
    expect(e.source.method).toBe('typed');
    expect(e.kind === 'meal' && e.slot).toBe('snack');
    expect(e.kind === 'meal' && e.components[0]!.name).toBe('dal · 1 × katori (155 mL)');
    expect(await screen.findByText('dal · 1 × katori (155 mL)')).toBeInTheDocument();
    expect(screen.queryByText(/typed by you/)).not.toBeInTheDocument();
  });

  it('"Tell the Coach instead" hands the Coach what was typed, with the slot and date (Q4-10)', async () => {
    const user = userEvent.setup();
    const h = renderLiving(ui({ provider: createMockRecipeProvider(), profile: ANSWERED }), { path: '/food', route: 'food', routes: [{ path: 'coach', element: <p>coach</p> }] });
    await user.click(await screen.findByRole('button', { name: 'lunch' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Lunch' })).getByRole('button', { name: 'I ate something else' }));
    await user.type(await screen.findByRole('searchbox', { name: 'Search or describe' }), 'poha and chai');
    await user.click(screen.getByRole('button', { name: 'Tell the Coach instead' }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe('/coach'));
    expect(h.router.state.location.state).toEqual({ draft: { text: 'poha and chai', prefill: true, context: { date: '2026-10-01', screen: 'food', slot: 'lunch', slotName: 'lunch' } } });
  });

  it('logs a described meal with its energy as other food', async () => {
    const user = userEvent.setup();
    const h = renderLiving(ui(), { path: '/food', route: 'food' });
    await user.click(await screen.findByRole('button', { name: 'Add food' }));
    await user.type(await screen.findByRole('searchbox', { name: 'Search or describe' }), '2 idlis with sambar');
    // r068 L10: the numbers are optional, folded under "Enter numbers"
    await user.click(screen.getByText('Enter numbers'));
    await user.type(screen.getByRole('spinbutton', { name: /^Energy/ }), '250{Enter}');
    await user.click(screen.getByRole('button', { name: 'Log' }));
    await waitFor(() => expect(h.stub.inspect().entries).toHaveLength(1));
    const e = h.stub.inspect().entries[0]!;
    expect(e.kind === 'meal' && e.totals.energyKcal.value).toBe(250);
    // r068 L8: food outside the meals is a stop on the same rail, at its time
    const logged = await screen.findByText('2 idlis with sambar');
    expect(logged.closest('.lv-meal--other')).not.toBeNull();
  });

  it('shows a future date as a read-only preview, without helper lines or row menus', async () => {
    const user = userEvent.setup();
    renderLiving(ui(), { path: '/food/2026-10-03', route: 'food/:date' });
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/^Food$/);
    expect(screen.getByText('Saturday, 3 October')).toBeInTheDocument();
    expect(screen.queryByText(/^Preview/)).not.toBeInTheDocument();
    for (const name of ['lunch', 'snack', 'dinner']) expect(screen.getByRole('heading', { level: 3, name })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /I ate this/ })).not.toBeInTheDocument();
    // no ⋯ on the row; the row opens its sheet, which holds no logging keys for a day ahead, only the recipe and targets
    expect(screen.queryByRole('button', { name: /^More for / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add food' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /as taken/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'lunch' }));
    const sheet = await screen.findByRole('dialog', { name: 'Lunch' });
    expect(within(sheet).queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'I ate something else' })).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Recipe and targets' }));
    expect(await screen.findByRole('heading', { name: 'Lunch targets' })).toBeInTheDocument();
  });

  it('opens the meal row sheet on a row tap — the same sheet as Today’s: the answers, something else, the recipe', async () => {
    const user = userEvent.setup();
    const h = renderLiving(ui(), { path: '/food', route: 'food' });
    await user.click(await screen.findByRole('button', { name: 'dinner' }));
    let sheet = await screen.findByRole('dialog', { name: 'Dinner' });
    // the meal's targets as one readout line, then how it went as one row of three answers (no full-width key)
    expect(within(sheet).getByText(/kcal/)).toBeInTheDocument();
    const bank = within(sheet).getByRole('radiogroup', { name: 'How did dinner go?' });
    expect(within(bank).getAllByRole('radio').map((r) => r.textContent)).toEqual(['As planned', 'Partly', 'Skipped']);
    expect(bank).toHaveAttribute('data-segments', '3');
    expect(within(sheet).queryByRole('button', { name: 'As planned' })).not.toBeInTheDocument();
    expect(sheet.querySelector('.lv-sheet .lm-key[data-block="true"]')).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'I ate something else' })).toBeInTheDocument();
    await user.click(within(bank).getByRole('radio', { name: 'As planned' }));
    await waitFor(() => expect(h.stub.inspect().entries).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Dinner' })).not.toBeInTheDocument());
    // the row keeps its own Undo for the answer given in the sheet
    expect(screen.getByRole('button', { name: 'Undo dinner' })).toBeInTheDocument();
    // logged: the sheet reads what was logged against the plan, shows the answer, offers "Add more" and the recipe
    await user.click(screen.getByRole('button', { name: 'dinner' }));
    sheet = await screen.findByRole('dialog', { name: 'Dinner' });
    expect(within(sheet).getByRole('meter', { name: /meal|dinner/i })).toBeInTheDocument();
    expect(within(sheet).getByRole('radio', { name: 'As planned' })).toHaveAttribute('aria-checked', 'true');
    expect(within(sheet).getByRole('button', { name: 'Add more' })).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Recipe and targets' }));
    expect(await screen.findByRole('heading', { name: 'Dinner targets' })).toBeInTheDocument();
  });

  it('a meal skipped in its sheet reads "skipped" on the row', async () => {
    const user = userEvent.setup();
    const h = renderLiving(ui(), { path: '/food', route: 'food' });
    const answerMeal = vi.spyOn(h.stub.actions, 'answerMeal');
    await user.click(await screen.findByRole('button', { name: 'snack' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Snack' })).getByRole('radio', { name: 'Skipped' }));
    await waitFor(() => expect(answerMeal).toHaveBeenCalledWith('2026-10-01', { slot: 'snack', mark: 'skipped', replaces: [] }));
    const row = (await screen.findByRole('heading', { level: 3, name: 'snack' })).closest('li')!;
    await waitFor(() => expect(within(row).getByText('skipped')).toBeInTheDocument());
    expect(row.querySelector('.lm-rail__node')).toHaveAttribute('data-status', 'skipped');
  });

  it('hides kcal in quiet mode until "show numbers"', async () => {
    const user = userEvent.setup();
    const h = renderLiving(ui(), { path: '/food', route: 'food' });
    await screen.findByRole('heading', { name: 'Targets' });
    await act(async () => {
      await h.stub.actions.setQuietMode(true);
    });
    const key = await screen.findByRole('button', { name: 'show numbers' });
    expect(document.body.textContent).not.toMatch(/kcal/);
    expect(screen.getAllByText(/nothing logged yet/i).length).toBeGreaterThan(0);
    expect(document.getElementById('meals')!.querySelectorAll('.lv-meal__dish')).toHaveLength(3);

    await user.click(key);
    // the Targets card is a channel strip: one line per nutrient with its target readout
    expect(document.getElementById('targets')!.textContent).toMatch(TARGETS);
    expect(screen.getByRole('button', { name: 'hide numbers' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('marks a supplement as taken', async () => {
    const user = userEvent.setup();
    renderLiving(ui(), { path: '/food', route: 'food' });
    await user.click(await screen.findByRole('button', { name: 'Mark creatine as taken' }));
    expect(await screen.findByRole('button', { name: 'Undo creatine taken' })).toHaveAttribute('data-status', 'done');
    expect(screen.queryByText('Vegetarian diets are often low in vitamin B12 — consider a test; ask a doctor.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'About Supplements' }));
    expect(await screen.findByRole('dialog', { name: 'Supplements, food first' })).toHaveTextContent(/vitamin B12/);
    expect(screen.queryByText(/third-party batch testing/)).not.toBeInTheDocument();
  });

  it('merges the plan\'s supplement with the person\'s own row: one line, both doses, one Taken key (Q6-11)', async () => {
    const user = userEvent.setup();
    const supplements = { _v: 2 as const, stance: 'food_first' as const, rows: [{ supplementId: 'creatine_monohydrate', state: 'taking' as const, dose: 7, unit: 'g', timesOfDay: ['morning' as const] }] };
    renderLiving(ui({ profile: { ...ANSWERED, supplements } }), { path: '/food', route: 'food' });
    const key = await screen.findByRole('button', { name: 'Mark Creatine monohydrate as taken' });
    const face = document.getElementById('supplements')!;
    expect(within(face).getAllByRole('button', { name: /^Mark .*creatine.* as taken/i })).toHaveLength(1);
    expect(within(face).getByText(/^you take 7 g · morning · plan suggests \d+(\.\d+)? g$/)).toBeInTheDocument();
    expect(within(face).queryByRole('heading', { name: 'yours' })).not.toBeInTheDocument();
    await user.click(key);
    expect(await screen.findByRole('button', { name: 'Undo Creatine monohydrate taken' })).toHaveAttribute('data-status', 'done');
  });

  it('shows supplement options with the testing line in their details when the person chose "open"', async () => {
    renderLiving(ui({ profile: { ...ANSWERED, supplementStance: 'open', safetyFlags: ['milk_allergy'] } }), { path: '/food', route: 'food' });
    await waitFor(() => expect(document.getElementById('supplements')).not.toBeNull());
    const face = document.getElementById('supplements')!;
    // the testing line is a row of each option's details (one per option), never a paragraph under the list
    expect((await within(face).findAllByText(/third-party batch testing/)).every((el) => el.closest('details.lv-food-opt'))).toBe(true);
    expect(within(face).queryByText(/change the plan only through a proposal/)).not.toBeInTheDocument();
    expect(within(face).queryByRole('button', { name: 'What won’t help' })).not.toBeInTheDocument();
    // listed by name right under the card's title (r068 F6: no "Options" subheading), never folded behind a count
    expect(within(face).queryByRole('heading', { name: 'Options' })).not.toBeInTheDocument();
    expect(within(face).queryByText(/^\d+ options?$/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^psyllium husk \(isabgol\)/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^whey protein/ })).not.toBeInTheDocument();
    // D7-03: what is held back is named with its status and reason under one tap-open line, never only counted
    expect(screen.queryByText(/not shown because of your safety answers/)).not.toBeInTheDocument();
    expect(within(face).getByText(/^Not suggested · \d+$/)).toBeInTheDocument();
    expect(within(face).getByText(/^whey protein/i)).toBeInTheDocument();
    expect(within(face).getByText(/^milk allergy/)).toBeInTheDocument();
    // unknown is never a negative screen: with the food rules unanswered, plant protein waits for the soy answer
    expect(screen.queryByRole('heading', { name: /^plant protein powder/ })).not.toBeInTheDocument();
    expect(within(face).getByText('Unchecked · soy allergy (not answered)')).toBeInTheDocument();
  });

  it('moves one day with ] and opens the slot sheet from ?recipe=', async () => {
    const h = renderLiving(ui(), { path: '/food?recipe=lunch', route: 'food' });
    expect(await screen.findByRole('heading', { name: 'Lunch targets' })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: ']' });
    await waitFor(() => expect(h.router.state.location.pathname).toBe('/food/2026-10-02'));
  });
});
