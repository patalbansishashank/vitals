import { useState } from 'react';
import { act, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '@/components';
import type { KitchenKind, ParsedItem } from '@/catalogues/kitchen';
import { loadKitchen, type LoadedKitchen } from '@/content/catalogues/kitchenCatalogue';
import { leak, strings } from '@/content/evidence/__tests__/leakScan';
import { CataloguePicker } from '../Picker';
import { PICKER_COPY } from '../PickerCopy';
import { shortRegion, truncate, withRegionDefaults } from '../PickerModel';
import type { CataloguePickerProps, PickerValue } from '../PickerTypes';

let kit: LoadedKitchen;
beforeAll(async () => {
  kit = await loadKitchen();
}, 30_000);

type HarnessProps = Partial<CataloguePickerProps> & { kind: KitchenKind; initial?: PickerValue; spy?: (v: PickerValue) => void };

function Harness({ kind, initial = [], spy, ...rest }: HarnessProps) {
  const [value, setValue] = useState<PickerValue>(initial);
  const [regions, setRegions] = useState<string[] | undefined>(rest.regions ? [...rest.regions] : undefined);
  return (
    <>
      <CataloguePicker
        label="Test list"
        {...rest}
        kind={kind}
        value={value}
        regions={regions}
        onRegionsChange={rest.regions ? setRegions : undefined}
        onChange={(v) => {
          spy?.(v);
          setValue(v);
        }}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
      <Toaster />
    </>
  );
}

const current = (): PickerValue => JSON.parse(screen.getByTestId('value').textContent ?? '[]') as PickerValue;
const group = (name: RegExp) => screen.getByRole('button', { name });

describe('CataloguePicker', () => {
  it('search filters across groups, opens matching groups and updates the live count', async () => {
    const user = userEvent.setup();
    render(<Harness kind="equipment" />);
    const box = screen.getByRole('searchbox');
    expect(box).toHaveAttribute('placeholder', `Search ${kit.cat.list('equipment').length} items`);
    // closed groups: no chips before searching
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    await user.type(box, 'kettle');
    const count = await screen.findByText(/\d+ match(es)?$/);
    expect(count).toHaveAttribute('aria-live', 'polite');
    const chips = screen.getAllByRole('checkbox');
    expect(count.textContent).toBe(`${chips.length} matches`);
    expect(screen.getByRole('checkbox', { name: 'Electric kettle' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Electric kettle' }).querySelector('b')?.textContent).toBe('kettle');
    await user.clear(box);
    await user.type(box, 'zorbulator');
    expect(await screen.findByText("No match for 'zorbulator'")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add it as your own item' }));
    expect(current()).toEqual([{ id: 'custom:zorbulator', label: 'zorbulator', source: 'picker' }]);
  });

  it('matches regional names (bhindi finds okra)', async () => {
    const user = userEvent.setup();
    render(<Harness kind="pantry" />);
    await user.type(screen.getByRole('searchbox'), 'bhindi');
    expect(await screen.findByRole('checkbox', { name: 'Okra (bhindi)' })).toBeInTheDocument();
  });

  it('toggling a chip calls onChange; chips are checkboxes; Space toggles', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness kind="equipment" spy={spy} />);
    await user.click(group(/^cooking/));
    const chip = screen.getByRole('checkbox', { name: 'OTG oven' });
    expect(chip).toHaveAttribute('aria-checked', 'false');
    await user.click(chip);
    expect(spy).toHaveBeenLastCalledWith([{ id: 'eq.otg', source: 'picker' }]);
    expect(screen.getByRole('checkbox', { name: 'OTG oven' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    const kettle = screen.getByRole('checkbox', { name: 'Electric kettle' });
    kettle.focus();
    await user.keyboard(' ');
    expect(kettle).toHaveAttribute('aria-checked', 'true');
    await user.keyboard(' ');
    expect(kettle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('group', { name: /^cooking/ })).toBeInTheDocument();
  });

  it('region defaults are dashed and described; touching one clears assumed; Clear defaults removes only assumed', async () => {
    const user = userEvent.setup();
    const initial = [{ id: 'eq.otg', source: 'picker' as const }, ...withRegionDefaults(kit.cat, 'equipment', ['IN-south-kerala'], [])];
    const assumed = initial.filter((e) => 'assumed' in e).length;
    expect(assumed).toBeGreaterThan(2);
    render(<Harness kind="equipment" regions={['IN-south-kerala']} initial={initial} />);
    expect(screen.getByText("Pre-ticked: defaults for a Kerala kitchen. Untick what you don't have.")).toBeInTheDocument();
    // the first group with a ticked item is open
    expect(group(/^cooking/)).toHaveAttribute('aria-expanded', 'true');
    const cookingIds = new Set(kit.cat.groups('equipment').find((g) => g.id === 'cooking')!.items.map((i) => i.id));
    const pick = initial.find((e) => 'assumed' in e && cookingIds.has(e.id))!;
    const pickLabel = kit.cat.get(pick.id)!.label;
    const kettle = screen.getByRole('checkbox', { name: pickLabel });
    expect(kettle).toHaveAttribute('data-assumed', 'true');
    expect(kettle).toHaveAccessibleDescription('default for Kerala');
    expect(screen.getByRole('checkbox', { name: 'OTG oven' })).not.toHaveAttribute('data-assumed');
    // untick then tick again: no longer assumed
    await user.click(kettle);
    await user.click(screen.getByRole('checkbox', { name: pickLabel }));
    expect(screen.getByRole('checkbox', { name: pickLabel })).not.toHaveAttribute('data-assumed');
    await user.click(screen.getByRole('button', { name: 'Clear defaults' }));
    expect(current().map((e) => e.id)).toEqual(['eq.otg', pick.id]);
    expect(screen.queryByRole('button', { name: 'Clear defaults' })).toBeNull();
  });

  it('says "pre-ticked" only while defaults are ticked; an empty list offers to tick them (Q3-J5-03)', async () => {
    const user = userEvent.setup();
    render(<Harness kind="pantry" regions={['IN-south-kerala']} />);
    expect(screen.queryByText(/^Pre-ticked/)).toBeNull();
    expect(screen.getByText(/^Nothing is pre-ticked\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tick the usual items for a Kerala kitchen' }));
    expect(current().length).toBeGreaterThan(0);
    expect(current().every((e) => e.assumed)).toBe(true);
    expect(screen.getByText(/^Pre-ticked: defaults for a Kerala kitchen/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Tick the usual items/ })).toBeNull();
  });

  it('shows the empty-region note', () => {
    render(<Harness kind="equipment" regions={[]} />);
    expect(screen.getByText('No defaults for your region; pick what you have.')).toBeInTheDocument();
  });

  it('group header counts "n of N" and clear unticks the group with an Undo toast', async () => {
    const user = userEvent.setup();
    const cooking = kit.cat.groups('equipment').find((g) => g.id === 'cooking')!;
    render(<Harness kind="equipment" initial={[{ id: 'eq.otg' }, { id: 'eq.tawa' }, { id: cooking.items[0]!.id }]} />);
    const n = new Set(['eq.otg', 'eq.tawa', cooking.items[0]!.id].filter((id) => cooking.items.some((i) => i.id === id))).size;
    expect(group(/^cooking/)).toHaveTextContent(`${n} of ${cooking.items.length}`);
    await user.click(screen.getByRole('button', { name: 'Clear cooking' }));
    expect(group(/^cooking/)).toHaveTextContent(`0 of ${cooking.items.length}`);
    expect(await screen.findByText('Cleared cooking')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(group(/^cooking/)).toHaveTextContent(`${n} of ${cooking.items.length}`);
  });

  it('cuisines show rank numerals in tap order and re-number on untick', async () => {
    const user = userEvent.setup();
    render(<Harness kind="cuisines" />);
    await user.type(screen.getByRole('searchbox'), 'indian');
    const north = await screen.findByRole('checkbox', { name: 'North Indian' });
    await user.click(north);
    const south = screen.getAllByRole('checkbox').find((c) => c.getAttribute('aria-checked') === 'false')!;
    await user.click(south);
    expect(south.querySelector('.lm-pk__rank')?.textContent).toBe('2');
    expect(south).toHaveAccessibleDescription('number 2 in your order');
    await user.click(screen.getByRole('checkbox', { name: 'North Indian' }));
    expect(south.querySelector('.lm-pk__rank')?.textContent).toBe('1');
    expect(screen.getByRole('checkbox', { name: 'North Indian' }).querySelector('.lm-pk__rank')).toBeNull();
  });

  it('note popover writes note and the switch writes ownNotUsed; chip reads "· note"', async () => {
    const user = userEvent.setup();
    render(<Harness kind="equipment" initial={[{ id: 'eq.otg', assumed: true }]} />);
    await user.click(screen.getByRole('button', { name: 'Note for OTG oven' }));
    const field = await screen.findByRole('textbox', { name: 'Note for OTG oven' });
    expect(field).toHaveAttribute('placeholder', 'size in litres, e.g. 28 L');
    expect(field).toHaveAttribute('maxLength', '80');
    await user.type(field, 'small, 28 L');
    await user.click(screen.getByRole('switch', { name: "I own it but don't use it" }));
    expect(current()).toEqual([{ id: 'eq.otg', note: 'small, 28 L', ownNotUsed: true }]);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    const chip = screen.getByRole('checkbox', { name: 'OTG oven · small, 28 L · not used' });
    expect(chip).toHaveTextContent('OTG oven · small, 28 L · not used');
    expect(chip).not.toHaveAttribute('data-assumed');
  });

  it('truncates long notes at 32 characters with the full text in the title', async () => {
    const user = userEvent.setup();
    const note = 'large one from my mother, 40 litres';
    render(<Harness kind="equipment" initial={[{ id: 'eq.otg', note }]} />);
    expect(group(/^cooking/)).toHaveAttribute('aria-expanded', 'true');
    await user.click(group(/^cooking/));
    await user.click(group(/^cooking/));
    const chip = screen.getByRole('checkbox', { name: `OTG oven · ${note}` });
    expect(chip).toHaveAttribute('title', `OTG oven · ${note}`);
    expect(chip.textContent).toBe(truncate(`OTG oven · ${note}`));
    expect(chip.textContent!.length).toBeLessThanOrEqual(32);
  });

  it('"I also have…" adds matched and kept-as-written items to "added by you"', async () => {
    const user = userEvent.setup();
    render(<Harness kind="equipment" />);
    await user.type(screen.getByRole('textbox', { name: 'I also have…' }), 'soda maker, zorbulator press{Enter}');
    expect(await screen.findByText('kept as you wrote it')).toBeInTheDocument();
    expect(screen.getByText('matched: Soda maker')).toBeInTheDocument();
    expect(current()).toEqual([
      { id: 'eq.soda_maker', label: 'soda maker', source: 'picker' },
      { id: 'custom:zorbulator-press', label: 'zorbulator press', source: 'picker' },
    ]);
    expect(screen.getByRole('checkbox', { name: 'zorbulator press' })).toHaveAttribute('aria-checked', 'true');
  });

  it('shows "matching…" while a resolver works', async () => {
    const user = userEvent.setup();
    let done: (v: ParsedItem[]) => void = () => undefined;
    const resolve = () => new Promise<ParsedItem[]>((r) => (done = r));
    render(<Harness kind="equipment" resolve={resolve} />);
    await user.type(screen.getByRole('textbox', { name: 'I also have…' }), 'a fizzy water machine{Enter}');
    expect(screen.getByText('matching…')).toBeInTheDocument();
    await act(async () => done([{ label: 'a fizzy water machine', id: 'eq.soda_maker', confidence: 0.9 }]));
    expect(screen.getByText('matched: Soda maker')).toBeInTheDocument();
    expect(screen.queryByText('matching…')).toBeNull();
  });

  it('paste a list: preview counts, untick a line, add with source paste and quantities as notes', async () => {
    const user = userEvent.setup();
    render(<Harness kind="pantry" optional />);
    expect(screen.getByText(PICKER_COPY.optional)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Paste a list' }));
    await user.type(screen.getByRole('textbox', { name: 'Your list' }), '2 kg onions{Enter}bhindi 500 g{Enter}dragon jelly{Enter}moon cheese');
    await user.click(screen.getByRole('button', { name: 'Read the list' }));
    expect(await screen.findByText('2 matched · 2 kept as written')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Okra (bhindi)' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Add 4 items' })).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /moon cheese/ }));
    await user.click(screen.getByRole('button', { name: 'Add 3 items' }));
    const v = current();
    expect(v).toHaveLength(3);
    expect(v.every((e) => e.source === 'paste')).toBe(true);
    const okra = v.find((e) => e.id === 'pa.okra')!;
    expect(okra).toMatchObject({ label: 'bhindi', note: '500 g' });
    const onion = v.find((e) => e.label === 'onions')!;
    expect(onion.note).toBe('2 kg');
    expect(onion.id).not.toMatch(/kg/);
    expect(v.find((e) => e.label === 'dragon jelly')!.id).toBe('custom:dragon-jelly');
  });

  it('renders at once when the list is already loaded', () => {
    render(<Harness kind="staples" />);
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('copy has no internal references', () => {
    const found: Array<[string, string]> = [];
    strings(PICKER_COPY, 'PICKER_COPY', found);
    const hits = found.map(([p, t]) => (leak(t) || /\bR1\d\b|\bseed\b|catalogue id/i.test(t) ? `${p}: ${t}` : null)).filter(Boolean);
    expect(hits).toEqual([]);
    expect(shortRegion('North India (Punjab, Haryana)')).toBe('North India');
  });

  it('every group is reachable and labelled', async () => {
    const user = userEvent.setup();
    render(<Harness kind="staples" />);
    for (const g of kit.cat.groups('staples')) {
      const head = screen.getByRole('button', { name: new RegExp(`^${g.label.replace(/[()]/g, '.')}`) });
      expect(head).toHaveAttribute('aria-expanded', 'false');
    }
    const first = kit.cat.groups('staples')[0]!;
    await user.click(screen.getByRole('button', { name: new RegExp(`^${first.label}`) }));
    await waitFor(() => expect(within(screen.getByRole('group', { name: new RegExp(`^${first.label}`) })).getAllByRole('checkbox')).toHaveLength(first.items.length));
  });
});
