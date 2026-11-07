/**
 * The r071 card components: GradientCard, CardHead and its (i), InfoPanel, CardFoot, HeroNumber, StatusDot, MonoMeta.
 * What matters: the card is labelled by its title, the (i) is a named dialog trigger with a panel that has one way
 * out, a number never lets assistive technology hear a count, the final markup equals the animated one, quiet draws no
 * digit, and the pictures inherit the card's domain.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { Footprints } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardFoot, CardHead, GradientCard, HeroNumber, InfoPanel, MonoMeta, StateWord, StatusDot, domainToken } from '@/components';
import { fakeMotion } from '../viz/__tests__/motionHelpers';

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-motion');
});

describe('MonoMeta', () => {
  it('keeps sentence case in the DOM (the caps are CSS) and joins text facts as one line', () => {
    const { container } = render(<MonoMeta items={['Of 2 050', null, 'Left 1 300', false]} tone="ink" />);
    expect(container.textContent).toBe('Of 2 050 · Left 1 300');
    expect(container.querySelectorAll('.lm-overflow')).toHaveLength(1);
    expect(container.firstChild).toHaveAttribute('data-tone', 'ink');
  });
});

describe('GradientCard', () => {
  it('is labelled by its head title and carries its domain, size and the entrance hook', () => {
    wrap(
      <GradientCard domain="steps" size="tile" head={<CardHead icon={Footprints} title="Steps" />}>
        <p>7 605</p>
      </GradientCard>,
    );
    const card = screen.getByRole('article', { name: 'Steps' });
    expect(card).toHaveAttribute('data-domain', 'steps');
    expect(card).toHaveAttribute('data-size', 'tile');
    expect(card).toHaveAttribute('data-enter');
    expect(card).not.toHaveAttribute('data-reveal');
    expect(within(card).getByRole('heading', { name: 'Steps' })).toBeInTheDocument();
  });

  it('defaults to a neutral card; glow positions are data, an object is custom properties', () => {
    const { rerender } = wrap(<GradientCard aria-label="Plain">x</GradientCard>);
    expect(screen.getByRole('article', { name: 'Plain' })).toHaveAttribute('data-domain', 'neutral');
    rerender(
      <MemoryRouter>
        <GradientCard aria-label="Plain" domain="sleep" glow="tl">
          x
        </GradientCard>
      </MemoryRouter>,
    );
    expect(screen.getByRole('article', { name: 'Plain' })).toHaveAttribute('data-glow', 'tl');
    rerender(
      <MemoryRouter>
        <GradientCard aria-label="Plain" domain="sleep" glow={{ pos: '10% 20%', size: '50% 60%', a: 0.4 }}>
          x
        </GradientCard>
      </MemoryRouter>,
    );
    const card = screen.getByRole('article', { name: 'Plain' });
    expect(card).toHaveAttribute('data-glow', 'custom');
    expect(card.style.getPropertyValue('--lm-glow-pos')).toBe('10% 20%');
    expect(card.style.getPropertyValue('--lm-glow-a')).toBe('0.4');
    // `none` switches the glow off (card.css)
    rerender(
      <MemoryRouter>
        <GradientCard aria-label="Plain" domain="sleep" glow="none">
          x
        </GradientCard>
      </MemoryRouter>,
    );
    expect(screen.getByRole('article', { name: 'Plain' })).toHaveAttribute('data-glow', 'none');
  });

  it('is the shared material (the one glow recipe is components.css\'s): lm-material plus its own layout class', () => {
    wrap(<GradientCard aria-label="Energy" domain="energy">x</GradientCard>);
    const card = screen.getByRole('article', { name: 'Energy' });
    expect(card).toHaveClass('lm-material', 'lm-gcard');
    expect(card).toHaveAttribute('data-domain', 'energy');
  });

  it('opens through a stretched title: a link for href, a button for onOpen, nothing nested in the (i)', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const { rerender } = wrap(
      <GradientCard domain="sleep" href="/sleep" head={<CardHead icon={Footprints} title="Sleep" info={{ body: 'About sleep.' }} />}>
        x
      </GradientCard>,
    );
    expect(screen.getByRole('link', { name: 'Sleep' })).toHaveAttribute('href', '/sleep');
    expect(screen.getByRole('article', { name: 'Sleep' })).toHaveAttribute('data-open');
    expect(screen.getByRole('button', { name: 'About Sleep' }).closest('a')).toBeNull();
    rerender(
      <MemoryRouter>
        <GradientCard domain="sleep" onOpen={onOpen} openLabel="Open last night" head={<CardHead icon={Footprints} title="Sleep" />}>
          x
        </GradientCard>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Open last night' }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('shows the glow-off state first where motion can run and clears it on first view; the final markup is the static one', async () => {
    const restoreHeld = await fakeMotion({ inView: false });
    try {
      wrap(<GradientCard domain="energy" aria-label="Energy">x</GradientCard>);
      expect(screen.getByRole('article', { name: 'Energy' })).toHaveAttribute('data-reveal', 'pending');
    } finally {
      restoreHeld();
    }
    const staticMarkup = render(<MemoryRouter><GradientCard domain="energy" aria-label="Energy" animate={false}>x</GradientCard></MemoryRouter>).container.innerHTML;
    const restore = await fakeMotion();
    try {
      const animated = render(<MemoryRouter><GradientCard domain="energy" aria-label="Energy">x</GradientCard></MemoryRouter>);
      await act(async () => {});
      expect(animated.container.innerHTML).toBe(staticMarkup);
    } finally {
      restore();
    }
  });
});

describe('CardHead and the (i)', () => {
  const info = {
    body: 'The calories your body has used since midnight.',
    source: { kind: 'estimate' as const, words: 'Resting burn plus movement.' },
    terms: [{ term: 'Resting', text: 'What your body uses doing nothing.' }],
    evidence: { to: '/evidence/10-wearable-calorie-error', label: 'How accurate wearables are', grade: 'B' as const },
    footer: <button type="button">Remove from Today</button>,
  };

  it('has an About {title} key that is a 28 px circle with a dialog popup; no key without info', () => {
    const { rerender } = wrap(<GradientCard head={<CardHead icon={Footprints} title="Energy" info={info} />}>x</GradientCard>);
    const key = screen.getByRole('button', { name: 'About Energy' });
    expect(key).toHaveAttribute('aria-haspopup', 'dialog');
    expect(key).toHaveClass('lm-info');
    rerender(
      <MemoryRouter>
        <GradientCard head={<CardHead icon={Footprints} title="Energy" />}>x</GradientCard>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /About/ })).toBeNull();
  });

  it('opens the panel: the card title, the reading text, source, terms, evidence and a foot action; ✕ is the one way out', async () => {
    const user = userEvent.setup();
    wrap(<GradientCard head={<CardHead icon={Footprints} title="Energy" info={info} />}>x</GradientCard>);
    const key = screen.getByRole('button', { name: 'About Energy' });
    await user.click(key);
    const panel = await screen.findByRole('dialog', { name: 'Energy' });
    expect(key).toHaveAttribute('aria-expanded', 'true');
    expect(within(panel).getByText('The calories your body has used since midnight.')).toBeInTheDocument();
    expect(within(panel).getByText('Where this comes from')).toBeInTheDocument();
    expect(within(panel).getByText('An estimate. Resting burn plus movement.')).toBeInTheDocument();
    expect(within(panel).getByText('Resting')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /How accurate wearables are/ })).toHaveAttribute('href', '/evidence/10-wearable-calorie-error');
    expect(within(panel).getByRole('button', { name: 'Remove from Today' })).toBeInTheDocument();
    // nothing commits, so one close key and no Cancel or Done
    expect(within(panel).getAllByRole('button', { name: 'Close' })).toHaveLength(1);
    expect(within(panel).queryByRole('button', { name: /Cancel|Done/ })).toBeNull();
    await user.click(within(panel).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(key).toHaveFocus();
  });

  it('T opens the panel at the Table twin when the card has one, and ignores T in a field or without a twin', async () => {
    const user = userEvent.setup();
    wrap(
      <GradientCard head={<CardHead icon={Footprints} title="Steps" info={{ body: 'Steps.', twin: <table><caption>Steps by day</caption><tbody><tr><td>7 605</td></tr></tbody></table> }} />}>
        <input aria-label="note" />
        <button type="button">Log</button>
      </GradientCard>,
    );
    await user.click(screen.getByRole('textbox', { name: 'note' }));
    await user.keyboard('t');
    expect(screen.queryByRole('dialog')).toBeNull();
    screen.getByRole('button', { name: 'Log' }).focus();
    await user.keyboard('t');
    const panel = await screen.findByRole('dialog', { name: 'Steps' });
    expect(within(panel).getByText('Data table')).toBeInTheDocument();
    expect(within(panel).getByRole('table', { name: 'Steps by day' })).toBeInTheDocument();
  });

  it('no twin: T does nothing', async () => {
    const user = userEvent.setup();
    wrap(
      <GradientCard head={<CardHead icon={Footprints} title="Steps" info={{ body: 'Steps.' }} />}>
        <button type="button">Log</button>
      </GradientCard>,
    );
    screen.getByRole('button', { name: 'Log' }).focus();
    await user.keyboard('t');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('InfoPanel', () => {
  it('sections with their own headings, several evidence rows and an Explain node', () => {
    wrap(
      <InfoPanel
        open
        onClose={() => undefined}
        title="Heart rate"
        body={[
          { heading: 'What it is', body: 'Beats a minute.' },
          { heading: 'What moves it', body: 'Effort, heat, sleep.' },
        ]}
        evidence={[
          { to: '/evidence/a', label: 'Resting heart rate' },
          { to: '/evidence/b', label: 'HRV', grade: 'A' },
        ]}
        explain={<p>The explain body.</p>}
        range={<span>60 to 100 at rest</span>}
      />,
    );
    const panel = screen.getByRole('dialog', { name: 'Heart rate' });
    expect(within(panel).getByRole('heading', { name: 'What it is' })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: 'What moves it' })).toBeInTheDocument();
    expect(within(panel).getAllByRole('link')).toHaveLength(2);
    expect(within(panel).getByText('The explain body.')).toBeInTheDocument();
    expect(within(panel).getByText('60 to 100 at rest')).toBeInTheDocument();
  });
});

describe('CardFoot', () => {
  it('draws nothing when it has nothing to say', () => {
    const { container } = render(<CardFoot />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a state word on the left (a mark plus a word), the range on the right, one navigation, one control', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    wrap(
      <CardFoot state={{ word: 'On plan', tone: 'caution' }} right="By bedtime 2 595" link={{ to: '/energy', label: 'Energy' }}>
        <button type="button">All logged</button>
      </CardFoot>,
    );
    expect(screen.getByText('On plan').closest('.lm-stateword')).toHaveAttribute('data-tone', 'caution');
    expect(screen.getByText('By bedtime 2 595').closest('.lm-cardfoot__right')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Energy' })).toHaveAttribute('href', '/energy');
    expect(screen.getByRole('button', { name: 'All logged' })).toBeInTheDocument();
    render(<CardFoot link={{ onClick, label: 'Open' }} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('StateWord alone: the dot is decorative, the word is the state', () => {
    const { container } = render(<StateWord word="Behind" />);
    expect(container.querySelector('.lm-stateword__dot')).toHaveAttribute('aria-hidden', 'true');
    expect(container).toHaveTextContent('Behind');
  });
});

describe('HeroNumber', () => {
  it('is one image named by its spoken value; the digits are hidden from assistive technology; the unit is small', () => {
    const { container } = render(<HeroNumber value={1096} unit="kcal" size="hero" label="1,096 kilocalories" />);
    const hero = screen.getByRole('img', { name: '1,096 kilocalories' });
    expect(hero).toHaveAttribute('data-size', 'hero');
    expect(hero).toHaveAttribute('data-numerals', 'proportional');
    expect(container.querySelector('.lm-hero__line')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.lm-hero__live')?.textContent).toBe('1,096');
    expect(container.querySelector('.lm-hero__unit')).toHaveTextContent('kcal');
  });

  it('clocks and secondary figures are tabular; decimals and a custom format apply', () => {
    const { rerender } = render(<HeroNumber value="16:30" size="time" label="16:30" />);
    expect(screen.getByRole('img', { name: '16:30' })).toHaveAttribute('data-numerals', 'tabular');
    rerender(<HeroNumber value={85.2} decimals={1} unit="kg" size="num" label="85.2 kilograms" />);
    expect(screen.getByRole('img')).toHaveTextContent('85.2');
    rerender(<HeroNumber value={0.42} format={(n) => `${Math.round(n * 100)}`} unit="%" size="stat" label="42 percent" />);
    expect(screen.getByRole('img')).toHaveTextContent('42');
  });

  it('parts: "7 h 56", each with its own small unit', () => {
    const { container } = render(<HeroNumber parts={[{ value: 7, unit: 'h' }, { value: 56, unit: 'm' }]} size="num-l" label="7 hours 56 minutes" />);
    expect(container.querySelectorAll('.lm-hero__part')).toHaveLength(2);
    expect(container.textContent).toBe('7h56m');
  });

  it('an estimate says its likely range under the number, from a pair or a string', () => {
    const { container, rerender } = render(<HeroNumber value={1096} range={[983, 1209]} size="num" label="about 1,096" />);
    expect(container.querySelector('.lm-hero__range')?.textContent).toBe('Likely 983\u20131,209');
    rerender(<HeroNumber value={1096} range="Likely 983-1 209" size="num" label="about 1,096" />);
    expect(container.querySelector('.lm-hero__range')?.textContent).toBe('Likely 983-1 209');
  });

  it('null is a dash, never a zero; quiet draws its word and not one digit; a null quiet word draws nothing', () => {
    const { container, rerender } = render(<HeroNumber value={null} size="num" label="no weight yet" />);
    expect(container.querySelector('.lm-hero__digits')?.textContent).toBe('\u2014');
    rerender(<HeroNumber value={1096} unit="kcal" range={[983, 1209]} size="hero" label="a little over a third" quietWord="A third" />);
    expect(container.textContent).toBe('A third');
    expect(container.textContent).not.toMatch(/\d/);
    rerender(<HeroNumber value={1096} size="hero" label="hidden" quietWord={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a figure that was hidden (a null quiet word) and comes back is not left waiting for a first view', async () => {
    const restore = await fakeMotion();
    try {
      const { container, rerender } = render(<HeroNumber value={5} unit="kcal" size="num" label="5 kcal" quietWord={null} />);
      expect(container).toBeEmptyDOMElement();
      rerender(<HeroNumber value={5} unit="kcal" size="num" label="5 kcal" />);
      await act(async () => {});
      expect(container.querySelector('.lm-hero')).not.toHaveAttribute('data-reveal');
    } finally {
      restore();
    }
  });

  it('counts up on first view with its final width held by an invisible twin, then ends as the static markup', async () => {
    const staticMarkup = render(<HeroNumber value={1096} unit="kcal" size="hero" label="1,096 kilocalories" animate={false} />).container.innerHTML;
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const restore = await fakeMotion();
    try {
      const { container } = render(<HeroNumber value={1096} unit="kcal" size="hero" label="1,096 kilocalories" />);
      await act(async () => {});
      await act(async () => {
        vi.advanceTimersByTime(50);
      });
      expect(container.querySelector('.lm-hero__digits')).toHaveAttribute('data-counting');
      expect(container.querySelector('.lm-hero__ghost')?.textContent).toBe('1,096');
      expect(container.querySelector('.lm-hero__live')?.textContent).not.toBe('1,096');
      // the screen reader name never changes while it counts
      expect(within(container).getByRole('img', { name: '1,096 kilocalories' })).toBeInTheDocument();
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      expect(container.innerHTML).toBe(staticMarkup);
    } finally {
      restore();
    }
  });

  it('a later change counts from the old value to the new, not from zero', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const restore = await fakeMotion();
    try {
      const { container, rerender } = render(<HeroNumber value={1000} size="num" label="1,000" />);
      await act(async () => {});
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      expect(container.querySelector('.lm-hero__live')?.textContent).toBe('1,000');
      rerender(<HeroNumber value={1200} size="num" label="1,200" />);
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      const mid = Number((container.querySelector('.lm-hero__live')?.textContent ?? '').replace(/\D/g, ''));
      expect(mid).toBeGreaterThan(1000);
      expect(mid).toBeLessThan(1200);
      await act(async () => {
        vi.advanceTimersByTime(600);
      });
      expect(container.querySelector('.lm-hero__live')?.textContent).toBe('1,200');
    } finally {
      restore();
    }
  });
});

describe('StatusDot', () => {
  it('is a dot and its word; the word can stay for assistive technology only; pulse is a data flag', () => {
    const { container, rerender } = render(<StatusDot tone="live" label="Recording" pulse />);
    expect(container.querySelector('.lm-status')).toHaveAttribute('data-tone', 'live');
    expect(container.querySelector('.lm-status')).toHaveAttribute('data-pulse');
    expect(container.querySelector('.lm-status__dot')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Recording')).toHaveClass('lm-mono');
    rerender(<StatusDot tone="ok" label="Synced" hideLabel />);
    expect(screen.getByText('Synced')).toHaveClass('lm-sr');
    expect(container.querySelector('.lm-status')).not.toHaveAttribute('data-pulse');
  });
});

describe('domainToken', () => {
  it('names the role token of a domain; plan is gold, neutral is ivory', () => {
    expect(domainToken('energy')).toBe('var(--lm-hue-energy)');
    expect(domainToken('sleep', 'ink')).toBe('var(--lm-hue-sleep-ink)');
    expect(domainToken('heart', 'dim')).toBe('var(--lm-hue-heart-dim)');
    expect(domainToken('plan')).toBe('var(--lm-signal)');
    expect(domainToken('plan', 'deep')).toBe('var(--lm-hue-gold-deep)');
    expect(domainToken(undefined)).toBe('var(--lm-ink)');
  });
});
