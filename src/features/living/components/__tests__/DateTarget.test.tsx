import { fireEvent, render, screen } from '@testing-library/react';
import { Field } from '@/components';
import { DateTarget, dateTargetText } from '../DateTarget';

describe('<DateTarget>', () => {
  it('reads the day, the day and time, or the prompt when there is no date', () => {
    expect(dateTargetText('date', '2026-10-18')).toBe('Sun 18 Oct');
    expect(dateTargetText('datetime-local', '2026-09-30T21:00')).toBe('Wed 30 Sep · 21:00');
    expect(dateTargetText('date', '')).toBe('Choose a date');
    expect(dateTargetText('datetime-local', '')).toBe('Choose a date and time');
  });

  it('takes its label and error from the Field, and shows the picked day instead of the browser field', () => {
    const onChange = vi.fn();
    render(
      <Field label="From" error="Pick a day from today on.">
        <DateTarget value="2026-10-18" min="2026-10-18" onChange={onChange} />
      </Field>,
    );
    const input = screen.getByLabelText('From');
    expect(input).toHaveAttribute('type', 'date');
    expect(input).toHaveValue('2026-10-18');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Pick a day from today on.');
    // the visible text is the target's own label (hidden from assistive tech: the input carries the value)
    expect(screen.getByText('Sun 18 Oct')).toHaveAttribute('aria-hidden', 'true');
    expect(input.closest('.lv-date')?.querySelector('svg')).toHaveAttribute('width', '18');
    fireEvent.change(input, { target: { value: '2026-10-20' } });
    expect(onChange).toHaveBeenCalledWith('2026-10-20');
  });
});
