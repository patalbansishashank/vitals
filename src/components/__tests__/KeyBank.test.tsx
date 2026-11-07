import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { KeyBank, LinkBank, Tab, TabList, TabPanel, Tabs } from '@/components';

function Bank() {
  const [v, setV] = useState('lanes');
  return (
    <>
      <button type="button">before</button>
      <KeyBank
        label="Chart view"
        value={v}
        onChange={setV}
        options={[
          { value: 'lanes', label: 'lanes' },
          { value: 'overlay', label: 'overlay' },
          { value: 'table', label: 'table', disabled: true },
          { value: 'focus', label: 'focus' },
        ]}
      />
      <button type="button">after</button>
    </>
  );
}

describe('KeyBank (segmented control)', () => {
  it('is a radio group with a single tab stop on the selected key', async () => {
    const user = userEvent.setup();
    render(<Bank />);
    const group = screen.getByRole('radiogroup', { name: 'Chart view' });
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1, -1]);
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: 'before' }));
    await user.tab();
    expect(radios[0]).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus();
  });

  it('arrows move focus and selection, skip disabled keys and wrap; Home/End jump', async () => {
    const user = userEvent.setup();
    render(<Bank />);
    const [lanes, overlay, , focus] = screen.getAllByRole('radio');
    lanes!.focus();
    await user.keyboard('{ArrowRight}');
    expect(overlay).toHaveFocus();
    expect(overlay).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowRight}');
    expect(focus).toHaveFocus(); // skipped the disabled "table"
    await user.keyboard('{ArrowRight}');
    expect(lanes).toHaveFocus(); // wraps
    await user.keyboard('{ArrowLeft}');
    expect(focus).toHaveFocus();
    await user.keyboard('{Home}');
    expect(lanes).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{End}');
    expect(focus).toHaveAttribute('aria-checked', 'true');
    expect(focus!.tabIndex).toBe(0);
    expect(lanes!.tabIndex).toBe(-1);
  });
});

describe('Tabs', () => {
  it('activates tabs with arrow keys and shows the matching panel', async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="overview">
        <TabList label="Plan detail">
          <Tab value="overview">overview</Tab>
          <Tab value="days">days</Tab>
        </TabList>
        <TabPanel value="overview">Overview panel</TabPanel>
        <TabPanel value="days">Days panel</TabPanel>
      </Tabs>,
    );
    const [overview, days] = screen.getAllByRole('tab');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Overview panel');
    overview!.focus();
    await user.keyboard('{ArrowRight}');
    expect(days).toHaveFocus();
    expect(days).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Days panel');
  });
});

describe('equal segments (lumen.md §7)', () => {
  it('KeyBank, LinkBank and TabList give the track one equal column per key; vertical banks stay a column', () => {
    render(
      <MemoryRouter>
        <KeyBank label="From" options={[{ value: 'today', label: 'Today' }, { value: 'tomorrow', label: 'Tomorrow' }]} defaultValue="today" />
        <KeyBank label="Side" orientation="vertical" options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />
        <LinkBank label="Simulator section" items={[{ to: '/a', label: 'Schedule' }, { to: '/b', label: 'Results' }, { to: '/c', label: 'Compare' }]} />
        <Tabs defaultValue="o">
          <TabList label="Plan detail">
            <Tab value="o">Overview</Tab>
            <>
              <Tab value="d">Days</Tab>
              <Tab value="s">Safety</Tab>
            </>
            <Tab value="l">Limits</Tab>
          </TabList>
        </Tabs>
      </MemoryRouter>,
    );
    const from = screen.getByRole('radiogroup', { name: 'From' });
    expect(from).toHaveAttribute('data-segments', '2');
    expect(from.style.getPropertyValue('--lm-bank-n')).toBe('2');
    const side = screen.getByRole('radiogroup', { name: 'Side' });
    expect(side).not.toHaveAttribute('data-segments');
    expect(side.style.getPropertyValue('--lm-bank-n')).toBe('');
    expect(screen.getByRole('navigation', { name: 'Simulator section' })).toHaveAttribute('data-segments', '3');
    expect(screen.getByRole('tablist', { name: 'Plan detail' })).toHaveAttribute('data-segments', '4');
  });

  it('holds one row: columns sized to their labels and sharing the spare width, scrolling only as a last resort', () => {
    // jsdom computes no layout, so the contract is read from the stylesheet (lumen.md §7, SPEC §5)
    const css = readFileSync(resolve(__dirname, '../../styles/components.css'), 'utf8');
    const rule = (sel: string) => {
      const i = css.indexOf(`${sel} {`);
      expect(i, sel).toBeGreaterThan(-1);
      return css.slice(i, css.indexOf('}', i));
    };
    // one column per key (never a second row); each at least its label, equal while there is room
    expect(rule(".lm-bank[data-segments]:not([data-orientation='vertical'])")).toMatch(/grid-template-columns: repeat\(var\(--lm-bank-n\), minmax\(max-content, 1fr\)\);/);
    // a label never wraps and a key never gets narrower than the minimum target
    expect(rule('.lm-bank__key')).toMatch(/white-space: nowrap;/);
    expect(rule('.lm-bank__key')).toMatch(/min-width: var\(--lm-bank-key-min, 48px\);/);
    // the last resort: a sideways scroll inside the track, no visible bar
    expect(rule(".lm-bank:not([data-orientation='vertical'])")).toMatch(/overflow-x: auto;[\s\S]*scrollbar-width: none;/);
    // nothing lets a key span the track
    expect(css).not.toMatch(/\.lm-bank__key[^{]*\{[^}]*grid-column: 1 \/ -1/);
  });

  it('a three-option bank is three keys in one track (the Today row sheet: as planned · partly · skipped)', () => {
    render(
      <KeyBank
        label="How did Breakfast go?"
        size="lg"
        block
        options={[
          { value: 'asPlanned', label: 'As planned' },
          { value: 'partly', label: 'Partly' },
          { value: 'skipped', label: 'Skipped' },
        ]}
      />,
    );
    const bank = screen.getByRole('radiogroup', { name: 'How did Breakfast go?' });
    expect(bank).toHaveAttribute('data-segments', '3');
    expect(bank).toHaveAttribute('data-block', 'true');
    expect(bank.style.getPropertyValue('--lm-bank-n')).toBe('3');
    expect(Array.from(bank.children).map((k) => k.textContent)).toEqual(['As planned', 'Partly', 'Skipped']);
  });
});
