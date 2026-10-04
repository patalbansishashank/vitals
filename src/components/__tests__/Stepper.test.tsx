import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Field, MeasureStepper, Stepper } from '@/components';

function Harness({ initial = 36 }: { initial?: number }) {
  const [v, setV] = useState<number | null>(initial);
  return (
    <>
      <Field label="age">
        <Stepper name="age" value={v} onChange={setV} min={18} max={90} unit="yrs" inputMode="numeric" />
      </Field>
      <output data-testid="value">{v}</output>
    </>
  );
}

describe('Stepper', () => {
  it('clamps at the bounds and disables the key that would pass them', async () => {
    render(<Harness initial={89} />);
    const plus = screen.getByRole('button', { name: 'Increase age' });
    fireEvent.pointerDown(plus, { button: 0 });
    fireEvent.pointerUp(plus);
    expect(screen.getByTestId('value')).toHaveTextContent('90');
    expect(plus).toBeDisabled();
    fireEvent.pointerDown(plus, { button: 0 });
    fireEvent.pointerUp(plus);
    expect(screen.getByTestId('value')).toHaveTextContent('90');
  });

  it('steps with the arrow keys and clamps', async () => {
    const user = userEvent.setup();
    render(<Harness initial={19} />);
    const input = screen.getByRole('spinbutton', { name: /age/ });
    input.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(screen.getByTestId('value')).toHaveTextContent('18');
    expect(input).toHaveAttribute('aria-valuenow', '18');
    await user.keyboard('{Shift>}{ArrowUp}{/Shift}');
    expect(screen.getByTestId('value')).toHaveTextContent('28');
  });

  it('rejects typed values outside the range with a message and keeps the last valid value', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('spinbutton', { name: /age/ });
    await user.clear(input);
    await user.type(input, '120{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Age must be 18–90 yrs.');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('value')).toHaveTextContent('36');
    await user.clear(input);
    await user.type(input, '41{Enter}');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('value')).toHaveTextContent('41');
  });

  it('shows imperial units while storing metric', async () => {
    const user = userEvent.setup();
    let stored = 0;
    function Mass() {
      const [v, setV] = useState<number | null>(80);
      return (
        <MeasureStepper
          quantity="mass"
          system="imperial"
          name="weight"
          value={v}
          min={30}
          max={300}
          onChange={(kg) => {
            stored = kg;
            setV(kg);
          }}
        />
      );
    }
    render(<Mass />);
    const input = screen.getByRole('spinbutton', { name: 'weight' });
    expect(input).toHaveValue('176.4');
    await user.clear(input);
    await user.type(input, '200{Enter}');
    expect(stored).toBeCloseTo(90.718, 2);
  });
});
