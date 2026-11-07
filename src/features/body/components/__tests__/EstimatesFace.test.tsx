// Estimates (r071): the hero is body fat with its range as a scale, one stacked bar of fat and lean mass, three smaller
// readouts, and a foot that says the state (Calibrating while the estimates rest on averages only, Needs weight without a
// weight) and what the scales show. Calm (quiet or gentle) is words and pictures with no digit until "Show numbers".
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshState } from '@/commands/__tests__/harness';
import { useBodyEstimate, useProfileStore } from '@/state/profileStore';
import type { BodySummary } from '../../model';
import { EstimatesFace, estimatesTwin, type EstimatesFaceProps } from '../EstimatesFace';

function Face({ patch, ...props }: { patch?: Partial<BodySummary> } & Partial<EstimatesFaceProps>) {
  const summary = useBodyEstimate();
  return (
    <MemoryRouter>
      <EstimatesFace summary={{ ...summary, ...patch }} spoken="" {...props} />
    </MemoryRouter>
  );
}

const cardOf = () => screen.getByRole('heading', { name: 'Estimates' }).closest('article')!;

beforeEach(() => {
  freshState();
  act(() => {
    const p = useProfileStore.getState();
    p.setSex('male');
    p.setAge(36);
    p.setHeight(178);
    p.setWeight(84.9);
  });
});
afterEach(() => cleanup());

describe('<EstimatesFace> states', () => {
  it('on averages only: "Calibrating" once, in the foot; the hero scale and the three readouts keep their ranges', () => {
    render(<Face patch={{ basedOnAverages: true, missing: [] }} />);
    const card = cardOf();
    expect(within(card).getAllByText('Calibrating')).toHaveLength(1);
    expect(card.querySelector('.lm-cardfoot')).toContainElement(within(card).getByText('Calibrating'));
    expect(within(card).getByText('80 % range')).toBeInTheDocument();
    // one full scale under the hero and one thin scale in each of the three cells
    expect(card.querySelectorAll('.lm-body-iv')).toHaveLength(4);
    expect(card.querySelectorAll('.lm-body-iv[data-size="thin"]')).toHaveLength(3);
    expect(card.querySelectorAll('.lm-body-est__cell')).toHaveLength(3);
    // the one key in the head is the (i)
    const head = card.querySelector('.lm-cardhead')!;
    expect(within(head as HTMLElement).getAllByRole('button')).toHaveLength(1);
    expect(within(head as HTMLElement).getByRole('button', { name: 'About Estimates' })).toBeInTheDocument();
  });

  it('without a weight: the hero is a dash, the foot says "Needs weight", and nothing calibrates or draws a scale', () => {
    render(<Face patch={{ basedOnAverages: true, missing: ['weight'] }} />);
    const card = cardOf();
    expect(within(card).getAllByText('Needs weight')).toHaveLength(1);
    expect(within(card).queryByText('Calibrating')).toBeNull();
    expect(card.querySelectorAll('.lm-body-iv')).toHaveLength(0);
    expect(card.querySelectorAll('.lm-body-est__cell')).toHaveLength(0);
    expect(within(card).getByRole('img', { name: 'Body fat needs weight' })).toBeInTheDocument();
  });

  it('measured: the state word is "Estimate", with no hourglass', () => {
    render(<Face patch={{ basedOnAverages: false, missing: [] }} />);
    const card = cardOf();
    expect(within(card).getByText('Estimate')).toBeInTheDocument();
    expect(within(card).queryByText('Calibrating')).toBeNull();
  });

  it('says its hero in one spoken sentence with the range', () => {
    render(<Face patch={{ missing: [] }} />);
    const hero = cardOf().querySelector('.lm-hero')!;
    expect(hero).toHaveAttribute('aria-label', expect.stringMatching(/^Body fat \d+\.\d percent, likely \d+\.\d to \d+\.\d$/));
  });

  it('shows fat and lean mass in pounds under imperial units', () => {
    render(<Face patch={{ missing: [] }} units="imperial" />);
    const cells = cardOf().querySelectorAll('.lm-body-est__cell');
    expect(cells[0]!.textContent).toMatch(/lb/);
    expect(cells[1]!.textContent).toMatch(/lb/);
    expect(cells[2]!.textContent).toMatch(/kg\/m²/);
  });
});

describe('<EstimatesFace> calm (quiet or gentle)', () => {
  const noDigit = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ');

  it('is words and pictures: no digit from a reading in the card until "Show numbers"', async () => {
    render(<Face patch={{ missing: [] }} calm calmWord="as expected" />);
    const card = cardOf();
    // the hero word, the lean mass index scale without numerals, the bar's parts as words, the foot's state
    expect(within(card).getByText('As expected')).toBeInTheDocument();
    expect(noDigit(card)).not.toMatch(/\d/);
    // assistive technology reads no number either: the bar's name and the scale's sentence are words
    expect(card.querySelector('[role="img"][aria-label*="Fat and lean mass"]')?.getAttribute('aria-label')).not.toMatch(/\d/);
    expect(card.querySelector('.lm-body-iv .lm-sr')?.textContent).not.toMatch(/\d/);
    expect(card.querySelectorAll('.lm-body-iv__ends')).toHaveLength(0);
    expect(card.querySelectorAll('.lm-body-est__cell')).toHaveLength(0);
    expect(within(card).queryByText('80 % range')).toBeNull();

    // the numbers come back for this card only, and go again
    await userEvent.click(within(card).getByRole('button', { name: 'Show numbers' }));
    expect(card.querySelectorAll('.lm-body-est__cell')).toHaveLength(3);
    expect(card.querySelector('.lm-hero')?.getAttribute('aria-label')).toMatch(/\d/);
    await userEvent.click(within(card).getByRole('button', { name: 'Hide numbers' }));
    expect(noDigit(card)).not.toMatch(/\d/);
  });

  it('is the normal card, with no "Show numbers" key, when not calm', () => {
    render(<Face patch={{ missing: [] }} />);
    expect(within(cardOf()).queryByRole('button', { name: /numbers/ })).toBeNull();
  });
});

describe('<EstimatesFace> Table twin', () => {
  it('estimatesTwin lists the four estimates with their values and 80 % ranges, in the card\'s units', () => {
    function Probe({ units }: { units: 'metric' | 'imperial' }) {
      const summary = useBodyEstimate();
      return <output data-testid="twin">{JSON.stringify(estimatesTwin(summary, units))}</output>;
    }
    const read = () => JSON.parse(screen.getByTestId('twin').textContent!) as ReturnType<typeof estimatesTwin>;
    const a = render(<Probe units="metric" />);
    const metric = read();
    expect(metric.rows.map((r) => r[0])).toEqual(['Body fat', 'Fat mass', 'Lean mass', 'Lean mass index']);
    expect(metric.head).toEqual(['Estimate', 'Value', 'Likely range (80 %)']);
    expect(String(metric.rows[0]![1])).toMatch(/^\d+\.\d %$/);
    expect(String(metric.rows[1]![1])).toMatch(/ kg$/);
    a.unmount();
    render(<Probe units="imperial" />);
    const imperial = read();
    expect(String(imperial.rows[1]![1])).toMatch(/ lb$/);
    expect(String(imperial.rows[1]![2])).toMatch(/ lb$/);
  });

  it('the (i) panel holds it under "Data table", and the card\'s T key opens the panel there', async () => {
    render(<Face patch={{ missing: [] }} />);
    const card = cardOf();
    within(card).getByRole('button', { name: 'About Estimates' }).focus();
    await userEvent.keyboard('t');
    const panel = await screen.findByRole('dialog', { name: 'How these are estimated' });
    expect(within(panel).getByText('Data table')).toBeInTheDocument();
    expect(within(panel).getByRole('table')).toBeInTheDocument();
    expect(within(panel).getAllByRole('row').length).toBeGreaterThanOrEqual(5);
  });

  it('the calm form has no table (its numbers are hidden)', async () => {
    render(<Face patch={{ missing: [] }} calm calmWord="as expected" />);
    within(cardOf()).getByRole('button', { name: 'About Estimates' }).focus();
    await userEvent.keyboard('t');
    expect(screen.queryByText('Data table')).toBeNull();
  });
});
