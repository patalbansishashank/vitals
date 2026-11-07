/**
 * The r071 foundation's primitives (package 0A): the gold pill `Key` with its arrow icon, the domain `Chip` and
 * `domainColor`, and the key bank's mono-caps labels. Their painted shape (radius, height, uppercase, spring) is CSS,
 * pinned as text in src/styles/__tests__/primitivesCss.test.ts; this file keeps what the components render.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { Chip, Key, KeyBank, KeyLink, Swatch, domainColor } from '@/components';

describe('Key (primary: the gold pill)', () => {
  it('`arrow` draws the arrow as an icon, 18 px at stroke 2.25, never the glyph; the key knows it has a trailing icon', () => {
    render(
      <Key variant="primary" size="lg" arrow>
        Add task
      </Key>,
    );
    const key = screen.getByRole('button', { name: 'Add task' });
    expect(key).toHaveAttribute('data-variant', 'primary');
    expect(key).toHaveAttribute('data-trailing', 'true');
    expect(key.textContent).toBe('Add task'); // no U+2192 in the label: the arrow is an svg
    const icons = key.querySelectorAll('svg');
    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveAttribute('width', '18');
    // the Icon keeps the stroke absolute (2.25 px at 18 px), so the svg attribute is 2.25 × 24 / 18 = 3 in its 24-unit viewBox
    expect(icons[0]).toHaveAttribute('stroke-width', '3');
    expect(icons[0]).toHaveAttribute('aria-hidden', 'true');
  });

  it('a secondary key keeps its 16 px trailing icon at the house stroke, and a key without one is not trailing', () => {
    render(
      <>
        <Key trailingIcon={ChevronDown}>Details</Key>
        <Key variant="primary">Save</Key>
        <Key variant="solid" trailingIcon={ArrowRight}>
          Next
        </Key>
      </>,
    );
    const details = screen.getByRole('button', { name: 'Details' });
    expect(details.querySelector('svg')).toHaveAttribute('width', '16');
    expect(details.querySelector('svg')).toHaveAttribute('stroke-width', '2.25'); // the house 1.5 px at 16 px: 1.5 × 24 / 16 in the viewBox
    expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('data-trailing');
    // `solid` and `signal` are aliases of primary: the same 18 px arrow
    expect(screen.getByRole('button', { name: 'Next' }).querySelector('svg')).toHaveAttribute('width', '18');
  });

  it('KeyLink takes the same arrow', () => {
    render(
      <MemoryRouter>
        <KeyLink to="/plan" variant="primary" arrow>
          Open the plan
        </KeyLink>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Open the plan' });
    expect(link).toHaveAttribute('data-trailing', 'true');
    expect(link.querySelector('svg')).toHaveAttribute('width', '18');
  });

  it('a disabled primary stays focusable with its reason and says so (the pill turns raised, not half-gold)', () => {
    render(
      <Key variant="primary" disabledReason="Type your weight first.">
        Log
      </Key>,
    );
    const key = screen.getByRole('button', { name: 'Log' });
    expect(key).toHaveAttribute('aria-disabled', 'true');
    expect(key).not.toBeDisabled();
  });
});

describe('domainColor and the domain Chip', () => {
  it('reads the domain tokens: the eight hues by name, plan is gold, neutral is ink', () => {
    expect(domainColor('energy')).toBe('var(--lm-hue-energy)');
    expect(domainColor('recovery')).toBe('var(--lm-hue-recovery)');
    expect(domainColor('videos')).toBe('var(--lm-hue-videos)');
    expect(domainColor('plan')).toBe('var(--lm-signal)');
    expect(domainColor('neutral')).toBe('var(--lm-ink)');
  });

  it('draws the dot in the domain solid and keeps the words stone: colour on the mark only', () => {
    render(<Chip kind="domain" domain="sleep">Sleep</Chip>);
    const chip = screen.getByText('Sleep').closest('.lm-chip') as HTMLElement;
    expect(chip).toHaveAttribute('data-kind', 'domain');
    const dot = chip.querySelector('.lm-chip__dot') as HTMLElement;
    expect(dot.style.getPropertyValue('--lm-chip-hue')).toBe('var(--lm-hue-sleep)');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    // a chip that acts is a button, and a read-only one a span
    expect(chip.tagName).toBe('SPAN');
  });

  it('a domain chip with onClick is a button; a Swatch takes a domain', () => {
    const onClick = vi.fn();
    render(
      <>
        <Chip kind="domain" domain="food" onClick={onClick}>
          Food
        </Chip>
        <Swatch domain="steps" shape="square" />
      </>,
    );
    screen.getByRole('button', { name: 'Food' }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
    const swatch = document.querySelector('.lm-swatch') as HTMLElement;
    expect(swatch.style.color).toBe('var(--lm-hue-steps)');
  });
});

describe('KeyBank (mono caps)', () => {
  it('keeps the DOM labels in sentence case: the caps are drawn by CSS, so the accessible names do not change', () => {
    render(
      <KeyBank
        label="Show"
        defaultValue="open"
        options={[
          { value: 'all', label: 'All' },
          { value: 'open', label: 'Open' },
          { value: 'done', label: 'Done' },
        ]}
      />,
    );
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['All', 'Open', 'Done']);
    expect(screen.getByRole('radio', { name: 'Open' })).toHaveAttribute('aria-checked', 'true');
  });
});
