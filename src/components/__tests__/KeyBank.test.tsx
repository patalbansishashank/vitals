import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KeyBank, Tab, TabList, TabPanel, Tabs } from '@/components';

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
