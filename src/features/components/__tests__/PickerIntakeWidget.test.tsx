import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { dispatch, outputOf, settleCommits } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { loadKitchen } from '@/content/catalogues/kitchenCatalogue';
import { PickerIntakeWidget } from '../PickerIntakeWidget';
import type { PickerValue } from '../PickerTypes';

beforeAll(async () => {
  await loadKitchen();
});
beforeEach(() => {
  freshState();
});

const q = (kind: string) => ({ id: `food.${kind}`, widget: `cataloguePicker:${kind}`, prompt: 'What cooking equipment do you have in your kitchen?' });

describe('picker as an intake turn', () => {
  it('starts from the region of the cuisines answered before; Done saves the kitchen and commits the list', async () => {
    const user = userEvent.setup();
    const commits: PickerValue[] = [];
    render(<PickerIntakeWidget q={q('equipment')} value={undefined} values={{ 'food.cuisines': [{ id: 'cu.kerala' }] }} ctx={{ india: true }} onCommit={(v) => commits.push(v)} labelledBy="x" />);
    const done = await screen.findByRole('button', { name: /^Done \(\d+\)$/ });
    expect(screen.getByText(/defaults for a Kerala kitchen/)).toBeInTheDocument();
    await user.click(done);
    await waitFor(() => expect(commits).toHaveLength(1));
    expect(commits[0]!.length).toBeGreaterThan(5);
    expect(commits[0]!.some((e) => 'assumed' in e)).toBe(false);
    // each catalogue item carries its name for the answered list (Q3-J1-08), and only in the answer
    expect(commits[0]!.every((e) => typeof e.name === 'string' && e.name.length > 0 && !e.name.includes('.'))).toBe(true);
    await settleCommits();
    const view = outputOf(await dispatch('kitchen.get', {}))!;
    expect(view.equipment.map((e) => e.id)).toEqual(commits[0]!.map((e) => e.id));
    expect(view.equipment.every((e) => !('name' in e))).toBe(true);
  });

  it('pantry: "Skip this list" commits an empty answer and writes an empty pantry', async () => {
    const user = userEvent.setup();
    const commits: PickerValue[] = [];
    render(<PickerIntakeWidget q={q('pantry')} value={undefined} values={{}} ctx={{ india: false }} onCommit={(v) => commits.push(v)} labelledBy="x" />);
    await user.click(await screen.findByRole('button', { name: 'Skip this list' }));
    await waitFor(() => expect(commits).toEqual([[]]));
  });
});
