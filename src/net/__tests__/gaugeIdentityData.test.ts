/** (r087) A data listener that throws does not keep the others from hearing the word. */
import { afterEach, expect, it, vi } from 'vitest';
import { notifyGaugeDataChanged, onGaugeDataChanged } from '../gaugeIdentity';

afterEach(() => vi.restoreAllMocks());

it('tells every listener even when one throws', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const before = vi.fn();
  const after = vi.fn();
  const offs = [
    onGaugeDataChanged(before),
    onGaugeDataChanged(() => { throw new Error('boom'); }),
    onGaugeDataChanged(after),
  ];
  expect(() => notifyGaugeDataChanged(123)).not.toThrow();
  expect(before).toHaveBeenCalledWith(123);
  expect(after).toHaveBeenCalledWith(123);
  expect(error).toHaveBeenCalledTimes(1);
  for (const off of offs) off();
});
