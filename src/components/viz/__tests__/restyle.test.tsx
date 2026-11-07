/**
 * r071 restyle of Hypnogram, StateStrip, Stat, ShareBar and TwinKey: the new props (`legend`, `hatch`, `sessions`,
 * `hue`, `stateHues`, `labels`), the mono-caps words, and the reveal contract (a picture that cannot animate, or is told
 * not to, renders exactly the markup an animated one ends on).
 */
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Hypnogram, ShareBar, Stat, StatChipView, StatGroup, StateStrip, TwinKey, spokenHypnogram } from '@/components';
import { sessionsWindow } from '../Hypnogram';
import { fakeMotion } from './motionHelpers';

const T = (hhmm: string, day = '2026-10-26') => Date.parse(`${day}T${hhmm}:00Z`);
const TZ = 'UTC';
const min = (n: number, from = T('23:00', '2026-10-25')) => from + n * 60_000;
/** Markup with the generated ids (useId) made equal, so two renders can be compared. */
const norm = (html: string) => html.replace(/_r_[0-9a-z]+_|«r[0-9a-z]+»|:r[0-9a-z]+:/g, 'ID');
const visible = (el: Element) => {
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll('.lm-sr').forEach((n) => n.remove());
  return c.textContent ?? '';
};

afterEach(() => document.documentElement.removeAttribute('data-motion'));

/** A night: awake, light, REM, deep, light (250 min). */
const NIGHT = [
  { from: min(0), to: min(10), state: 0 },
  { from: min(10), to: min(70), state: 2 },
  { from: min(70), to: min(110), state: 1 },
  { from: min(110), to: min(180), state: 3 },
  { from: min(180), to: min(250), state: 2 },
];
const night = { label: 'Sleep stages', from: min(0), to: min(250), segments: NIGHT, tz: TZ };

describe('Hypnogram (r071)', () => {
  it('row words are mono caps (the DOM keeps sentence case) and the blocks are 10-12 px', () => {
    const { container } = render(<Hypnogram {...night} />);
    const rows = [...container.querySelectorAll('[data-row] text')];
    expect(rows.map((t) => t.textContent)).toEqual(['Awake', 'REM', 'Light', 'Deep']);
    for (const t of rows) expect(t).toHaveClass('lm-mono');
    const h = Number(container.querySelector('.lmv-hyp__bar')!.getAttribute('height'));
    expect(h).toBeGreaterThanOrEqual(10);
    expect(h).toBeLessThanOrEqual(12);
  });

  it('legend: the stage totals from the RAW spans, deepest first, hidden from assistive technology; quiet drops the figures', () => {
    const { container, rerender } = render(<Hypnogram {...night} legend />);
    const legend = container.querySelector('.lmv-hyp__legend')!;
    expect(legend).toHaveAttribute('aria-hidden', 'true');
    const items = [...legend.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual(['Deep1 h 10', 'Light2 h 10', 'REM40 min', 'Awake10 min']);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(spokenHypnogram(night));
    rerender(<Hypnogram {...night} legend quiet />);
    expect(container.querySelector('.lmv-hyp__legend')!.textContent).toBe('DeepLightREMAwake');
    expect(visible(container)).not.toMatch(/\d/);
  });

  it('no legend unless asked', () => {
    const { container } = render(<Hypnogram {...night} />);
    expect(container.querySelector('.lmv-hyp__legend')).toBeNull();
  });

  it('hatch: a texture on every block but Awake, one pattern per stage, none when off', () => {
    const { container, rerender } = render(<Hypnogram {...night} hatch />);
    expect(container.querySelector('.lmv-hyp')).toHaveAttribute('data-hatch', 'true');
    const bars = container.querySelectorAll('.lmv-hyp__bar').length;
    const awake = container.querySelectorAll('.lmv-hyp__bar[data-stage="awake"]').length;
    expect(container.querySelectorAll('.lmv-hyp__tex')).toHaveLength(bars - awake);
    expect(container.querySelectorAll('pattern .lmv-hyp__hatchline')).toHaveLength(3);
    rerender(<Hypnogram {...night} />);
    expect(container.querySelector('.lmv-hyp__tex')).toBeNull();
    expect(container.querySelector('.lmv-hyp')).not.toHaveAttribute('data-hatch');
  });

  describe('sessions: a night in parts on one shared axis', () => {
    const parts = [
      { from: min(0), to: min(120), segments: NIGHT.filter((s) => s.to <= min(110)).concat([{ from: min(110), to: min(120), state: 3 }]) },
      { from: min(180), to: min(250), segments: [{ from: min(180), to: min(250), state: 2 }] },
    ];

    it('is merged: the window runs from the first start to the last end and the stretch between is one hatched No stage band', () => {
      expect(sessionsWindow(parts)).toMatchObject({ from: min(0), to: min(250) });
      const { container } = render(<Hypnogram label="Sleep stages" sessions={parts} tz={TZ} />);
      expect(container.querySelectorAll('[data-mark="gap"]')).toHaveLength(1);
      expect(within(screen.getByRole('list', { name: 'Sleep stages key' })).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['No stage']);
      // the sentence reads the merged raw spans: the whole window, the stages of both parts, the stretch between as no stage
      expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Sleep stages, 23:00 to 03:10: awake 10 min, REM 40 min, light 2 h 10, deep 10 min; no stage 1 h');
    });

    it('wins over segments, and an empty list draws nothing', () => {
      const { container, rerender } = render(<Hypnogram label="Sleep stages" sessions={parts} segments={[{ from: min(0), to: min(250), state: 3 }]} from={min(0)} to={min(250)} tz={TZ} />);
      expect(container.querySelector('.lmv-hyp__bar[data-stage="deep"]')).not.toBeNull();
      expect(container.querySelectorAll('.lmv-hyp__bar[data-stage="deep"]').length).toBe(1); // only the part's 10 min of deep, never the whole-night deep block
      rerender(<Hypnogram label="Sleep stages" sessions={[]} tz={TZ} />);
      expect(container.querySelector('.lmv-hyp__bar')).toBeNull();
      expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Sleep stages: no stages recorded');
    });
  });

  it('the single-session form is unchanged by the new props', () => {
    const a = render(<Hypnogram {...night} />).container.innerHTML;
    const b = render(<Hypnogram {...night} sessions={undefined} legend={false} hatch={false} />).container.innerHTML;
    expect(norm(b)).toBe(norm(a));
  });

  it('first view: pending until seen, then the final markup equals the static markup (animate on and off)', async () => {
    const restore = await fakeMotion({ inView: false });
    try {
      const { container } = render(<Hypnogram {...night} legend />);
      expect(container.querySelector('.lmv-hyp')).toHaveAttribute('data-reveal', 'pending');
    } finally {
      restore();
    }
    const restoreSeen = await fakeMotion();
    try {
      const on = render(<Hypnogram {...night} legend />);
      await act(async () => {});
      const off = render(<Hypnogram {...night} legend animate={false} />);
      expect(on.container.querySelector('.lmv-hyp')).not.toHaveAttribute('data-reveal');
      expect(norm(on.container.innerHTML)).toBe(norm(off.container.innerHTML));
    } finally {
      restoreSeen();
    }
  });
});

describe('StateStrip (r071)', () => {
  const day = { from: T('00:00'), to: T('00:00', '2026-10-27'), now: T('16:20') };
  const segs = [
    { from: T('02:20'), to: T('10:50'), state: 0 },
    { from: T('11:15'), to: T('12:40'), state: 2 },
    { from: T('13:00'), to: T('14:10'), state: 3 },
  ];
  const stateLabels = ['Calm', 'Normal', 'Elevated', 'High'];

  it('hue: the root names the domain and the legend swatches follow its ramp; no hue, no attribute', () => {
    const { container, rerender } = render(<StateStrip label="Stress today" {...day} segments={segs} stateLabels={stateLabels} tz={TZ} />);
    expect(container.querySelector('.lmv-strip')).not.toHaveAttribute('data-hue');
    rerender(<StateStrip label="Stress today" {...day} segments={segs} stateLabels={stateLabels} tz={TZ} hue="recovery" />);
    expect(container.querySelector('.lmv-strip')).toHaveAttribute('data-hue', 'recovery');
    // the ordinal steps are unchanged: the ramp is the CSS's
    expect(container.querySelector('.lmv-strip__seg rect[data-step="1"]')).not.toBeNull();
  });

  it('stateHues: a category wears its domain on the segment and its legend swatch', () => {
    const late = { ...day, now: T('23:00') };
    const cat = [
      { from: T('00:00'), to: T('07:00'), state: 0 },
      { from: T('12:00'), to: T('20:00'), state: 1 },
    ];
    const { container } = render(<StateStrip label="Your day" {...late} segments={cat} stateLabels={['Sleep', 'Eating']} stateHues={['sleep', 'food']} mode="category" tz={TZ} />);
    expect([...container.querySelectorAll('.lmv-strip__seg rect[data-hue]')].map((r) => r.getAttribute('data-hue'))).toEqual(['sleep', 'food']);
    expect([...container.querySelectorAll('.lmv-legend__sw rect[data-hue]')].map((r) => r.getAttribute('data-hue'))).toEqual(['sleep', 'food']);
    const plain = render(<StateStrip label="Your day" {...late} segments={cat} stateLabels={['Sleep', 'Eating']} mode="category" tz={TZ} />);
    expect(plain.container.querySelector('[data-hue]')).toBeNull();
  });

  describe('labels', () => {
    const cat = [
      { from: T('00:00'), to: T('07:00'), state: 0 },
      { from: T('07:00'), to: T('07:30'), state: 1 },
      { from: T('12:00'), to: T('20:00'), state: 2 },
    ];
    const props = { label: 'Your day', ...day, now: T('23:00'), segments: cat, stateLabels: ['Sleep', 'Fast', 'Eating'], stateHues: ['sleep', 'energy', 'food'] as const, mode: 'category' as const, tz: TZ };

    it('puts the word inside every segment wide enough for it, nothing in a narrow one, and keeps a key only for what no word names', () => {
      const { container } = render(<StateStrip {...props} labels />);
      expect([...container.querySelectorAll('.lmv-strip__label')].map((t) => t.textContent)).toEqual(['Sleep', 'Eating']);
      for (const t of container.querySelectorAll('.lmv-strip__label')) expect(t).toHaveClass('lm-mono');
      // Sleep and Eating are named in the picture; Fast (30 minutes, 6 px) is not, and the gaps are "No reading"
      const key = screen.getByRole('list', { name: 'Your day states' });
      expect(within(key).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['Fast', 'No reading']);
      expect(container.querySelector('.lmv-strip')).toHaveAttribute('data-labels', 'true');
      // a taller track: 44 px
      expect(container.querySelector('.lmv-strip__svg')).toHaveAttribute('height', '44');
    });

    it('is the plain strip when off: no words in the picture, the legend back, a 22 px svg', () => {
      const { container } = render(<StateStrip {...props} />);
      expect(container.querySelector('.lmv-strip__label')).toBeNull();
      expect(screen.getByRole('list', { name: 'Your day states' })).toBeInTheDocument();
      expect(container.querySelector('.lmv-strip__svg')).toHaveAttribute('height', '22');
    });

    it('quiet keeps the words (the axis numerals go); the spoken sentence is unchanged by labels', () => {
      const { container } = render(<StateStrip {...props} labels quiet />);
      expect(container.querySelectorAll('.lmv-strip__label')).toHaveLength(2);
      expect(container.querySelector('.lmv-strip__ticks')).toBeNull();
      const a = render(<StateStrip {...props} />);
      const b = render(<StateStrip {...props} labels />);
      expect(a.container.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe(b.container.querySelector('[role="img"]')!.getAttribute('aria-label'));
    });
  });

  it('the legend is mono caps; the tick words are mono', () => {
    const { container } = render(<StateStrip label="Stress today" {...day} segments={segs} stateLabels={stateLabels} tz={TZ} />);
    for (const li of container.querySelectorAll('.lmv-legend li')) expect(li).toHaveClass('lm-mono');
    for (const s of container.querySelectorAll('.lmv-strip__ticks span')) expect(s).toHaveClass('lm-mono');
  });

  it('first view: pending until seen, then the final markup equals the static markup', async () => {
    const restore = await fakeMotion({ inView: false });
    try {
      const { container } = render(<StateStrip label="Stress today" {...day} segments={segs} stateLabels={stateLabels} tz={TZ} />);
      expect(container.querySelector('.lmv-strip')).toHaveAttribute('data-reveal', 'pending');
    } finally {
      restore();
    }
    const restoreSeen = await fakeMotion();
    try {
      const on = render(<StateStrip label="Stress today" {...day} segments={segs} stateLabels={stateLabels} tz={TZ} />);
      await act(async () => {});
      const off = render(<StateStrip label="Stress today" {...day} segments={segs} stateLabels={stateLabels} tz={TZ} animate={false} />);
      expect(norm(on.container.innerHTML)).toBe(norm(off.container.innerHTML));
    } finally {
      restoreSeen();
    }
  });
});

describe('Stat (r071)', () => {
  it('the label is mono caps (the DOM keeps its words); a hue puts a dot on the cell, none otherwise', () => {
    const { container } = render(
      <StatGroup label="Night">
        <Stat label="HRV" value="48" unit="ms" hue="recovery" />
        <Stat label="Resting HR" value="52" unit="bpm" />
      </StatGroup>,
    );
    const cells = container.querySelectorAll('.lmv-stat');
    expect(cells[0]).toHaveAttribute('data-hue', 'recovery');
    expect(cells[1]).not.toHaveAttribute('data-hue');
    expect(screen.getAllByRole('term').map((t) => t.textContent)).toEqual(['HRV', 'Resting HR']);
    expect(container.querySelectorAll('dt > span.lm-mono')).toHaveLength(2);
  });

  it('a tile\'s chip is a mono fact line; the standalone chip view is not', () => {
    const chip = { kind: 'qualifier', text: 'a day' } as const;
    const tile = render(
      <StatGroup>
        <Stat label="Steps" value="8 400" chip={chip} />
      </StatGroup>,
    );
    expect(tile.container.querySelector('.lmv-stat__chip .lm-chip__text')).toHaveClass('lm-mono');
    const alone = render(<StatChipView chip={chip} />);
    expect(alone.container.querySelector('.lm-chip__text')).not.toHaveClass('lm-mono');
  });

  it('a loading cell still names its label, and quiet still drops the value', () => {
    const { container, rerender } = render(
      <StatGroup>
        <Stat label="SpO2" value={null} state="loading" hue="heart" />
      </StatGroup>,
    );
    expect(screen.getByRole('term')).toHaveTextContent('SpO2');
    expect(container.querySelector('.lmv-stat')).toHaveAttribute('aria-busy', 'true');
    rerender(
      <StatGroup>
        <Stat label="SpO2" value="96" unit="%" quiet chip={{ kind: 'status', severity: 'ok', word: 'Normal' }} />
      </StatGroup>,
    );
    expect(container.querySelector('.lmv-stat__value')).toBeNull();
    expect(screen.getByText('Normal')).toBeInTheDocument();
  });
});

describe('ShareBar (r071)', () => {
  const rows = [
    { id: 'deep', label: 'Deep', valueText: '1 h 08', share: 0.25, hue: 'var(--lm-stage-deep)' },
    { id: 'light', label: 'Light', valueText: '4 h 34', share: 0.55, hue: 'var(--lm-stage-light)' },
    { id: 'awake', label: 'Awake', valueText: '0 min', share: 0, hue: 'var(--lm-stage-awake)' },
  ];

  it('rows carry their index for the stagger; the share is mono caps; the fill keeps its inline width', () => {
    const { container } = render(<ShareBar label="Sleep stages" rows={rows} shareOf="of the night" />);
    expect([...container.querySelectorAll<HTMLElement>('.lmv-share__row')].map((r) => r.style.getPropertyValue('--lmv-i'))).toEqual(['0', '1', '2']);
    for (const p of container.querySelectorAll('.lmv-share__pct')) expect(p).toHaveClass('lm-mono');
    expect(container.querySelector<HTMLElement>('.lmv-share__fill')!.style.width).toBe('25%');
    expect(container.querySelector<HTMLElement>('.lmv-share__sw')!.style.background).toBe('var(--lm-stage-deep)');
  });

  it('first view: pending until seen, then the final markup equals the static markup', async () => {
    const restore = await fakeMotion({ inView: false });
    try {
      const { container } = render(<ShareBar label="Sleep stages" rows={rows} />);
      expect(container.querySelector('.lmv-share')).toHaveAttribute('data-reveal', 'pending');
    } finally {
      restore();
    }
    const restoreSeen = await fakeMotion();
    try {
      const on = render(<ShareBar label="Sleep stages" rows={rows} />);
      await act(async () => {});
      const off = render(<ShareBar label="Sleep stages" rows={rows} animate={false} />);
      expect(on.container.querySelector('.lmv-share')).not.toHaveAttribute('data-reveal');
      expect(norm(on.container.innerHTML)).toBe(norm(off.container.innerHTML));
    } finally {
      restoreSeen();
    }
  });

  it('quiet still prints no figures', () => {
    const { container } = render(<ShareBar label="Sleep stages" rows={rows} quiet />);
    expect(visible(container)).not.toMatch(/\d/);
  });
});

describe('TwinKey (r071)', () => {
  it('is a text key with the table icon in both states, and says which state it is in', async () => {
    const user = userEvent.setup();
    let open = false;
    const { rerender } = render(<TwinKey open={open} onToggle={() => (open = !open)} controls="t" />);
    const key = screen.getByRole('button', { name: 'Table' });
    expect(key).toHaveAttribute('data-variant', 'text');
    expect(key).toHaveAttribute('aria-expanded', 'false');
    expect(key.querySelector('svg')).not.toBeNull();
    await user.click(key);
    expect(open).toBe(true);
    rerender(<TwinKey open={open} onToggle={() => (open = !open)} controls="t" />);
    const hide = screen.getByRole('button', { name: 'Hide table' });
    expect(hide).toHaveAttribute('data-variant', 'text');
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    expect(hide.querySelector('svg')).not.toBeNull();
  });
});
