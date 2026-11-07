import { render, screen, within } from '@testing-library/react';
import { ReadoutRail } from '../components/ReadoutRail';
import type { ReadoutDatum } from '../lib/readouts';

const readout = (over: Partial<ReadoutDatum> = {}): ReadoutDatum => ({
  id: 'weight', label: 'Scale weight', shortLabel: 'scale weight', unit: 'kg', decimals: 1,
  category: 'body', grade: 'A', start: 92, end: 86, delta: -6, pctChange: -6.5,
  range: [83.9, 88.1], wide: false, relative: false, day: 28, ...over,
});

it('keeps exact range/start/change quantities with their units in complete bounded facts', () => {
  render(<ReadoutRail readouts={[readout()]} pinnedIds={[]} animate={false} />);
  const strip = screen.getByRole('region', { name: 'Start to end' });
  expect(within(strip).getByRole('img', { name: '86.0 kg, range 83.9–88.1 kg' })).toBeInTheDocument();
  for (const fact of ['83.9–88.1 kg', '92.0 kg', '−6.0 kg', '−6.5 %']) {
    const value = within(strip).getByText(fact, { exact: true });
    expect(value).toHaveClass('lm-overflow__item');
    expect(value.closest('.lm-overflow')).toHaveTextContent(fact);
  }
  expect(strip.querySelector('.rs-readout__range')).toHaveTextContent('range 83.9–88.1 kg');
  expect(strip.querySelector('.rs-readout__start')).toHaveTextContent('Start 92.0 kg Change −6.0 kg');
});

it('preserves no-range and unsupported statuses rather than manufacturing a range or visible value', () => {
  const { rerender } = render(<ReadoutRail readouts={[readout({ range: undefined })]} pinnedIds={[]} animate={false} />);
  expect(screen.getByRole('img', { name: '86.0 kg, No range' })).toBeInTheDocument();
  expect(screen.getByText('No range')).toBeInTheDocument();
  rerender(<ReadoutRail readouts={[readout({ status: 'outOfDomain', statusText: 'Unsupported' })]} pinnedIds={[]} animate={false} />);
  const strip = screen.getByRole('region', { name: 'Start to end' });
  expect(within(strip).getByRole('img', { name: 'Unsupported' })).toBeInTheDocument();
  expect(within(strip).getByText('Unsupported')).toBeInTheDocument();
  expect(strip.querySelector('.rs-readout__range')).toBeNull();
  expect(strip.querySelector('.rs-readout__start')).toBeNull();
  expect(strip).not.toHaveTextContent('86.0');
});
