/**
 * Readout draws its figure and unit as a HeroNumber (r071 reconcile), and Faceplate is the same material as GradientCard
 * with its markup unchanged. What a Readout said and how it was named before is what it says now.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Faceplate, Readout } from '@/components';

describe('Readout on HeroNumber', () => {
  it('names the whole estimate once, in the figure: value, unit and likely range', () => {
    const { container } = render(<Readout label="fat mass" value={19.7} unit="kg" range={[18.6, 20.9]} />);
    const figure = within(container).getByRole('img', { name: '19.7 kg, range 18.6 to 20.9' });
    expect(figure).toHaveClass('lm-hero', 'lm-readout__hero');
    expect(figure).toHaveAttribute('data-numerals', 'tabular');
    // the digits and the unit are drawn but hidden from assistive technology (the label has them)
    expect(figure.querySelector('.lm-hero__line')).toHaveAttribute('aria-hidden', 'true');
    expect(figure.querySelector('.lm-hero__live')?.textContent).toBe('19.7');
    expect(figure.querySelector('.lm-hero__unit')?.textContent).toBe('kg');
    expect(container.querySelector('.lm-readout__value')).toContainElement(figure);
    // it never counts up: a Readout is a live estimate, not a hero
    expect(container.querySelector('[data-counting]')).toBeNull();
  });

  it('an unknown value is a dash and says so; the unit and the range are not drawn', () => {
    const { container } = render(<Readout label="visceral fat" value={null} unit="L" unknownCaption="needs waist" />);
    expect(container.querySelector('.lm-readout')).toHaveAttribute('data-unknown', 'true');
    expect(within(container).getByRole('img', { name: 'visceral fat unknown' })).toBeInTheDocument();
    expect(container.querySelector('.lm-hero__digits')?.textContent).toBe('—');
    expect(container.querySelector('.lm-hero__unit')).toBeNull();
    expect(screen.getByText('needs waist')).toBeInTheDocument();
  });

  it('a start value draws its "from →" trail before the figure, hidden from assistive technology, and the signed change after', () => {
    const { container } = render(<Readout label="fat mass" value={19.7} from={24.1} unit="kg" />);
    expect(within(container).getByRole('img', { name: '24.1 to 19.7 kg' })).toBeInTheDocument();
    const trail = container.querySelector('.lm-readout__trail');
    expect(trail).toHaveAttribute('aria-hidden', 'true');
    expect(trail?.textContent).toBe('24.1→');
    expect(container.querySelector('.lm-readout__delta')?.textContent).toBe('−4.4 kg');
  });

  it('`animate` rolls the digits that change instead of counting', () => {
    const { container, rerender } = render(<Readout label="body fat" value={23.4} unit="%" animate />);
    expect(container.querySelector('.lm-hero__digits .lm-roll')).not.toBeNull();
    rerender(<Readout label="body fat" value={23.9} unit="%" animate />);
    expect(container.querySelector('.lm-hero__digits')?.textContent).toBe('23.9');
    expect(container.querySelector('.lm-roll__d[data-rolled="true"]')).not.toBeNull();
  });

  it('a custom format is the figure\'s format', () => {
    const { container } = render(<Readout label="maintenance" value={2540} decimals={0} unit="kcal/day" format={(v) => `${(v / 1000).toFixed(2)}k`} />);
    expect(container.querySelector('.lm-hero__live')?.textContent).toBe('2.54k');
  });
});

describe('Faceplate', () => {
  it('keeps its markup: the section, its variant, the header label and actions, the footer', () => {
    const { container } = render(
      <Faceplate title="Where it sits" caption="3 of 7" actions={<span>act</span>} footer={<span>foot</span>} data-domain="energy">
        body
      </Faceplate>,
    );
    const card = container.firstElementChild!;
    expect(card.tagName).toBe('SECTION');
    expect(card).toHaveClass('lm-face');
    expect(card).toHaveAttribute('data-variant', 'plain');
    // a domain card is the one material recipe: the attribute is the whole opt-in (no second class, no inline glow)
    expect(card).toHaveAttribute('data-domain', 'energy');
    expect(card.className).toBe('lm-face');
    expect(card.getAttribute('style')).toBeNull();
    expect(card.querySelector('.lm-face-head__label > .lm-h3')?.textContent).toBe('Where it sits');
    expect(card.querySelector('.lm-face-head__label > .lm-eng')?.textContent).toBe('3 of 7');
    expect(card.querySelector('.lm-face-head__actions')?.textContent).toBe('act');
    expect(card.querySelector('.lm-face-foot')?.textContent).toBe('foot');
  });
});
