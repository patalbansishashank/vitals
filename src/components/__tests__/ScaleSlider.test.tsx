import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScaleRange, ScaleSlider } from '@/components';

function Harness(props: { initial?: number; locked?: boolean; onCommit?: (v: number) => void }) {
  const [v, setV] = useState(props.initial ?? 20);
  return (
    <ScaleSlider
      label="body fat"
      value={v}
      onChange={setV}
      onCommit={props.onCommit}
      min={4}
      max={60}
      step={0.5}
      minorStep={1}
      majorStep={5}
      unit="%"
      locked={props.locked}
      valueText={(x) => `${x} percent body fat`}
    />
  );
}

describe('ScaleSlider', () => {
  it('exposes a labelled slider with units in aria-valuetext', () => {
    render(<Harness />);
    const slider = screen.getByRole('slider', { name: 'body fat' });
    expect(slider).toHaveAttribute('aria-valuetext', '20 percent body fat');
    expect(slider).toHaveAttribute('min', '4');
    expect(slider).toHaveAttribute('max', '60');
  });

  it('steps with arrows, ×10 with Shift, by the major tick with PgUp/PgDn, and jumps with Home/End', async () => {
    const user = userEvent.setup();
    const commits: number[] = [];
    render(<Harness onCommit={(v) => commits.push(v)} />);
    const slider = screen.getByRole('slider', { name: 'body fat' });
    slider.focus();
    await user.keyboard('{ArrowRight}');
    expect(slider).toHaveValue('20.5');
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(slider).toHaveValue('19.5');
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(slider).toHaveValue('24.5');
    await user.keyboard('{PageUp}');
    expect(slider).toHaveValue('29.5');
    await user.keyboard('{PageDown}{PageDown}');
    expect(slider).toHaveValue('19.5');
    await user.keyboard('{End}');
    expect(slider).toHaveValue('60');
    await user.keyboard('{ArrowRight}');
    expect(slider).toHaveValue('60');
    await user.keyboard('{Home}');
    expect(slider).toHaveValue('4');
    expect(commits.at(-1)).toBe(4);
  });

  it('opens a typed entry on Enter and clamps the committed value', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const slider = screen.getByRole('slider', { name: 'body fat' });
    slider.focus();
    await user.keyboard('{Enter}');
    const box = screen.getByRole('textbox', { name: /type a value/i });
    await user.clear(box);
    await user.type(box, '75{Enter}');
    expect(slider).toHaveValue('60');
    expect(slider).toHaveFocus();
  });

  it('ignores input while locked', async () => {
    const user = userEvent.setup();
    render(<Harness locked />);
    const slider = screen.getByRole('slider', { name: 'body fat' });
    expect(slider).toHaveAttribute('aria-disabled', 'true');
    slider.focus();
    await user.keyboard('{ArrowRight}{End}');
    expect(slider).toHaveValue('20');
  });
});

describe('ScaleRange', () => {
  function RangeHarness() {
    const [v, setV] = useState<[number, number]>([6, 8]);
    return <ScaleRange label="eating window" value={v} onChange={setV} min={2} max={16} step={1} minGap={1} thumbLabels={['shortest', 'longest']} unit="h" />;
  }

  it('moves each thumb independently and never lets them cross', async () => {
    const user = userEvent.setup();
    render(<RangeHarness />);
    const low = screen.getByRole('slider', { name: 'shortest' });
    const high = screen.getByRole('slider', { name: 'longest' });
    low.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(low).toHaveValue('7'); // stops one gap below the high thumb
    expect(high).toHaveValue('8');
    high.focus();
    await user.keyboard('{Home}');
    expect(high).toHaveValue('8'); // pushed thumb stops, no swap
    await user.keyboard('{End}');
    expect(high).toHaveValue('16');
    expect(screen.getByRole('group', { name: 'eating window' })).toBeInTheDocument();
  });
});
