/**
 * Rendering of the shared viz modules: roles and their one-sentence text alternatives, and the edge states (no data,
 * calibrating, over the goal, quiet, reduced motion).
 */
import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ArcRuler, DayDisc, DotFill, Hypnogram, LearningLine, LevelBar, MonitorSheet, OvernightTrace, ReadingAge, ShareBar, Stat, StatGroup, StateStrip, TickStrip, type MonitorItem } from '@/components';

const T = (hhmm: string, day = '2026-10-26') => Date.parse(`${day}T${hhmm}:00Z`);
const TZ = 'UTC';
/** Visible text without the screen-reader-only parts. */
const visible = (el: Element) => {
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll('.lm-sr').forEach((n) => n.remove());
  return c.textContent ?? '';
};

afterEach(() => document.documentElement.removeAttribute('data-motion'));

describe('TickStrip', () => {
  it('is a meter whose value text is the sentence; ticks are hidden', () => {
    const { container } = render(<TickStrip label="Sleep" value={476} goal={420} valueText="7 h 56" goalText="of 7 h" statusText="Goal met" spokenValue="7 h 56 asleep" />);
    const m = screen.getByRole('meter', { name: 'Sleep' });
    expect(m).toHaveAttribute('aria-valuetext', '7 h 56 asleep, goal 7 h, met');
    expect(m).toHaveAttribute('aria-valuemin', '0');
    expect(m).toHaveAttribute('aria-valuemax', '600');
    expect(m).toHaveAttribute('aria-valuenow', '476');
    expect(container.querySelector('.lmv-tick__plot')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.lmv-tick__goalword')).toHaveTextContent('Goal 7 h');
  });

  it('over a limit hatches beyond the goal and stays ivory and gold, never rose', () => {
    const { container } = render(<TickStrip label="Eaten" value={2450} goal={2100} goalKind="limit" valueText="2 450 kcal" goalText="of 2 100 kcal" statusText="350 kcal over" />);
    expect(container.querySelector('.lmv-tick')).toHaveAttribute('data-over', 'true');
    expect(container.querySelector('.lmv-tick__limit pattern')).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/danger/);
  });

  it('no value shows a dash and no value tick; quiet shows words and no digits', () => {
    const { container, rerender } = render(<TickStrip label="Sleep" value={null} goal={420} valueText="" goalText="of 7 h" />);
    expect(container.querySelector('.lmv-tick__value')).toBeNull();
    expect(container.querySelector('.lmv-fact__value')).toHaveTextContent('—');
    expect(screen.getByRole('meter')).not.toHaveAttribute('aria-valuenow');
    rerender(<TickStrip label="Eaten" value={1900} goal={2100} valueText="1 900 kcal" goalText="of 2 100 kcal" quiet quietText="A little short" />);
    expect(visible(container)).not.toMatch(/\d/);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', 'Eaten, A little short');
  });
});

describe('quiet mode reaches assistive technology (Claude UI P1-1)', () => {
  const noNumbers = (el: HTMLElement) => {
    for (const a of ['aria-valuenow', 'aria-valuemin', 'aria-valuemax']) expect(el).not.toHaveAttribute(a);
    expect(el.getAttribute('aria-valuetext') ?? '').not.toMatch(/\d/);
  };
  it('TickStrip, ArcRuler and DotFill drop the numeric value and range and speak words only', () => {
    const bands = [{ from: -Infinity, word: 'Calm', severity: 'ok' as const }, { from: 51, word: 'Elevated', severity: 'caution' as const }];
    const { rerender } = render(<TickStrip label="Day score against the target" value={68} goal={70} domain={[0, 100]} valueText="68" goalText="target 70" quiet quietText="below the target" />);
    noNumbers(screen.getByRole('meter'));
    rerender(<ArcRuler label="Stress" value={59} unit="ring index" bands={bands} state="stale" ageText="3 h ago" quiet />);
    noNumbers(screen.getByRole('meter'));
    rerender(<DotFill label="Steps" value={6400} goal={9000} valueText="6 400" goalText="of 9 000 steps" quiet />);
    noNumbers(screen.getByRole('meter'));
    // not quiet: the numbers are there
    rerender(<DotFill label="Steps" value={6400} goal={9000} valueText="6 400" goalText="of 9 000 steps" />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '6400');
  });
});

describe('DotFill: null is unknown, never zero (Claude UI P2-15)', () => {
  it('draws no head, shows a dash and says "no value yet", quiet too', () => {
    const { container, rerender } = render(<DotFill label="Steps" value={null} goal={9000} valueText="—" goalText="of 9 000 steps" state="zero" />);
    expect(container.querySelector('.lmv-dots__pill')).toBeNull();
    expect(container.querySelector('circle[data-filled]')).toBeNull();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', 'Steps, no value yet');
    rerender(<DotFill label="Steps" value={null} goal={9000} valueText="—" goalText="of 9 000 steps" quiet />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', 'Steps, no value yet');
    expect(screen.getByText('no value yet')).toBeInTheDocument();
    // an observed zero keeps its hollow head
    rerender(<DotFill label="Steps" value={0} goal={9000} valueText="0" goalText="of 9 000 steps" />);
    expect(container.querySelector('.lmv-dots__pill')).toHaveAttribute('data-hollow', 'true');
  });
});

describe('DotFill', () => {
  it('reads "9 664 steps of a 10 000 goal" with the dots hidden', () => {
    const { container } = render(<DotFill label="Steps" value={9664} goal={10000} valueText="9 664" goalText="of 10 000 steps" />);
    expect(screen.getByRole('meter', { name: 'Steps' })).toHaveAttribute('aria-valuetext', '9 664 steps of a 10 000 goal');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('over the goal fills every dot, lights the second lap and says the excess (no multiple tag)', () => {
    const { container } = render(<DotFill label="Ring energy" value={1644} goal={630} valueText="1 644" goalText="of 630 kcal" overText="+1 014 kcal over" />);
    const dots = container.querySelectorAll('circle');
    expect([...dots].every((d) => d.hasAttribute('data-filled'))).toBe(true);
    expect(container.querySelector('.lmv-dots__over')).toHaveTextContent(/^\+1 014 kcal over$/);
    // 1 644 of 630 is past twice the goal: the whole second lap is lit
    expect([...dots].every((d) => d.getAttribute('data-lap') === '2')).toBe(true);
  });

  it('zero draws a hollow head; provisional shows its chip; loading draws no head', () => {
    const { container, rerender } = render(<DotFill label="Distance" value={0} goal={8} valueText="0" goalText="of 8 km" state="zero" />);
    expect(container.querySelector('.lmv-dots__pill')).toHaveAttribute('data-hollow', 'true');
    rerender(<DotFill label="Active energy" value={410} goal={500} valueText="410" goalText="of 500 kcal" state="provisional" chip="Ring estimate" />);
    expect(screen.getByText('Ring estimate')).toHaveAttribute('data-kind', 'provisional');
    rerender(<DotFill label="Steps" value={null} goal={10000} valueText="" goalText="of 10 000 steps" state="loading" />);
    expect(container.querySelector('.lmv-dots__pill')).toBeNull();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-busy', 'true');
  });
});

describe('Stat', () => {
  it('is a dl cell: dt the label, dd the value then the chip, the minus spoken', () => {
    render(
      <StatGroup label="Night" columns={3}>
        <Stat label="HRV" value="70" unit="ms" chip={{ kind: 'delta', dir: 'down', text: '−14 ms vs usual', caution: true }} />
        <Stat label="Skin temperature" value={null} chip={{ kind: 'provisional', text: 'Calibrating · night 3 of 7' }} />
      </StatGroup>,
    );
    const dl = screen.getAllByRole('definition')[0]!.closest('dl')!;
    expect(dl.tagName).toBe('DL');
    expect(within(dl).getAllByRole('term').map((t) => t.textContent)).toEqual(['HRV', 'Skin temperature']);
    expect(screen.getByText('minus 14 ms vs usual')).toHaveClass('lm-sr');
    expect(screen.getByText('Calibrating · night 3 of 7').closest('[data-kind]')).toHaveAttribute('data-kind', 'provisional');
    expect(screen.getByText('no value')).toHaveClass('lm-sr');
  });

  it('stale adds the gold dot and says stale; the info key opens the method', async () => {
    const user = userEvent.setup();
    render(
      <StatGroup>
        <Stat label="SpO2" value="95" unit="%" state="stale" info={{ text: 'Lowest stable reading.', method: 'sleep-metrics/1' }} />
      </StatGroup>,
    );
    expect(screen.getByRole('term')).toHaveTextContent('SpO2, stale');
    await user.click(screen.getByRole('button', { name: 'About SpO2' }));
    expect(await screen.findByText('Method sleep-metrics/1')).toBeInTheDocument();
  });
});

describe('OvernightTrace', () => {
  const pts = Array.from({ length: 20 }, (_, i) => ({ t: T('02:25') + i * 5 * 60_000, v: 60 - (i < 15 ? i : 30 - i) }));
  const low = { t: T('02:25') + 15 * 5 * 60_000, v: 45 };

  it('is one img with the sentence; the low point is marked', () => {
    const { container } = render(<OvernightTrace label="Heart rate" unit="bpm" from={T('02:25')} to={T('04:00')} points={pts} low={low} trend={{ word: 'Rising', magnitude: 'Slight' }} tz={TZ} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/^Heart rate overnight, 02:25 to 04:00: starts at 60, lowest of 45 at 03:40, ends at 49, rising slightly toward morning; 20 readings$/);
    expect(container.querySelector('[data-mark="low"]')).toHaveTextContent('Lowest 45 · 03:40');
    expect(screen.getByText('Slight rise')).toBeInTheDocument();
  });

  it('the table twin lists every reading with a CSV key', async () => {
    const user = userEvent.setup();
    render(<OvernightTrace label="Heart rate" unit="bpm" from={T('02:25')} to={T('04:00')} points={pts} tz={TZ} />);
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const region = screen.getByRole('region', { name: 'Heart rate overnight table' });
    expect(within(region).getAllByRole('row')).toHaveLength(21);
    expect(screen.getByText('20 readings')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeInTheDocument();
  });

  it('sparse: dots only, no trend, no low, "Too few readings overnight"; empty says so', () => {
    const { container, rerender } = render(<OvernightTrace label="Heart rate" unit="bpm" from={T('02:25')} to={T('04:00')} points={pts.slice(0, 4)} low={low} trend={{ word: 'Rising' }} state="sparse" tz={TZ} />);
    expect(container.querySelector('path.lmv-trace__line')).toBeNull();
    expect(container.querySelector('[data-mark="low"]')).toBeNull();
    expect(screen.queryByText('Rising')).toBeNull();
    expect(screen.getByText('Too few readings overnight')).toBeInTheDocument();
    rerender(<OvernightTrace label="Heart rate" unit="bpm" from={T('02:25')} to={T('04:00')} points={[]} tz={TZ} />);
    expect(screen.getByRole('img')).toHaveTextContent('No night recorded');
  });

  it('quiet prints no numerals', () => {
    const { container } = render(<OvernightTrace label="Heart rate" unit="bpm" from={T('02:25')} to={T('04:00')} points={pts} low={low} trend={{ word: 'Steady' }} tz={TZ} quiet />);
    expect(visible(container)).not.toMatch(/\d/);
  });
});

describe('StateStrip', () => {
  const day = { from: T('00:00'), to: T('00:00', '2026-10-27'), now: T('16:20') };
  const segs = [
    { from: T('02:20'), to: T('10:50'), state: 0 },
    { from: T('11:15'), to: T('12:40'), state: 2 },
    { from: T('13:00'), to: T('14:10'), state: 3 },
  ];
  const labels = ['Calm', 'Normal', 'Elevated', 'High'];

  it('is one tab stop; arrows read each segment politely', () => {
    render(<StateStrip label="Stress today" {...day} segments={segs} stateLabels={labels} tz={TZ} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('tabindex', '0');
    expect(img.getAttribute('aria-label')).toMatch(/^Stress today: .*high 13:00 to 14:10; no readings after 14:10$/);
    fireEvent.keyDown(img, { key: 'ArrowRight' });
    fireEvent.keyDown(img, { key: 'ArrowRight' });
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('Calm 02:20 to 10:50, 8 h 30');
  });

  it('hatches the top state, outlines no reading and lists only the states present', () => {
    const { container } = render(<StateStrip label="Stress today" {...day} segments={segs} stateLabels={labels} tz={TZ} />);
    expect(container.querySelectorAll('.lmv-strip__none').length).toBeGreaterThan(0);
    expect(container.querySelector('.lmv-strip__seg rect[fill^="url("]')).not.toBeNull();
    const legend = screen.getByRole('list', { name: 'Stress today states' });
    expect(within(legend).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['Calm', 'Elevated', 'High', 'No reading']);
  });

  it('quiet hides the clock ticks; loading is busy with no segments', () => {
    const { container, rerender } = render(<StateStrip label="Stress today" {...day} segments={segs} stateLabels={labels} tz={TZ} quiet />);
    expect(container.querySelector('.lmv-strip__ticks')).toBeNull();
    rerender(<StateStrip label="Stress today" {...day} segments={[]} stateLabels={labels} state="loading" />);
    expect(container.querySelector('.lmv-strip')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('.lmv-strip__seg')).toBeNull();
  });
});

describe('ShareBar', () => {
  it('hides the bars; each item reads its sentence; zero is an empty track', () => {
    const { container } = render(
      <ShareBar
        label="Sleep stages"
        shareOf="of the night"
        rows={[
          { id: 'deep', label: 'Deep', valueText: '1 h 08', share: 0.14, hue: 'var(--lm-hr-zone-1)' },
          { id: 'awake', label: 'Awake', valueText: '0 min', share: 0, hue: 'var(--lm-ink-3)' },
        ]}
      />,
    );
    const items = within(screen.getByRole('list', { name: 'Sleep stages' })).getAllByRole('listitem');
    expect(items[0]!.querySelector('.lm-sr')).toHaveTextContent('Deep, 1 h 08, 14 % of the night');
    expect(items[1]!.querySelector('.lmv-share__fill')).toBeNull();
    expect(container.querySelector('.lmv-share__track')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('LevelBar', () => {
  it('draws 7 cells by default and 10 behind columns; hidden inside a row', () => {
    const { container, rerender } = render(<LevelBar cell={2} usual={[1, 3]} severity="ok" />);
    expect(container.querySelectorAll('.lmv-level__cell')).toHaveLength(7);
    expect(container.querySelector('.lmv-level')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('[data-usual]')).toHaveLength(3);
    rerender(<LevelBar cell={4} columns={10} severity="ok" />);
    expect(container.querySelectorAll('.lmv-level__cell')).toHaveLength(10);
  });

  it('alone it is a meter; calibrating and no reading light nothing; stale adds the dot', () => {
    const { container, rerender } = render(<LevelBar cell={3} usual={[1, 3]} asMeter label="Heart rate" wordText="Normal" />);
    expect(screen.getByRole('meter', { name: 'Heart rate' })).toHaveAttribute('aria-valuetext', 'Normal, upper half of your usual range');
    rerender(<LevelBar cell={3} state="calibrating" />);
    expect(container.querySelector('[data-lit]')).toBeNull();
    rerender(<LevelBar cell={null} />);
    expect(container.querySelector('[data-lit]')).toBeNull();
    rerender(<LevelBar cell={5} state="stale" />);
    expect(container.querySelector('.lmv-stale-dot')).not.toBeNull();
  });
});

describe('ArcRuler', () => {
  const bands = [
    { from: -Infinity, word: 'Calm', severity: 'ok' as const },
    { from: 26, word: 'Normal', severity: 'ok' as const },
    { from: 51, word: 'Elevated', severity: 'caution' as const },
    { from: 76, word: 'High', severity: 'caution' as const },
  ];

  it('is a meter "Stress 89 of 100, high"; the SVG is decorative', () => {
    const { container } = render(<ArcRuler label="Stress" value={89} unit="/ 100" bands={bands} />);
    const m = screen.getByRole('meter', { name: 'Stress' });
    expect(m).toHaveAttribute('aria-valuetext', 'Stress 89 of 100, high');
    expect(m).toHaveAttribute('aria-valuemax', '100');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.lmv-arc__word')).toHaveTextContent('High');
  });

  it('announces a change politely after 400 ms', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<ArcRuler label="Stress" value={40} unit="/ 100" bands={bands} />);
      rerender(<ArcRuler label="Stress" value={80} unit="/ 100" bands={bands} />);
      const live = document.querySelector('.lmv-arc [aria-live="polite"]')!;
      expect(live).toHaveTextContent('');
      act(() => vi.advanceTimersByTime(400));
      expect(live).toHaveTextContent('Stress 80 of 100, high');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reduced motion moves the scale at once', () => {
    document.documentElement.setAttribute('data-motion', 'reduce');
    const { container, rerender } = render(<ArcRuler label="Stress" value={40} unit="/ 100" bands={bands} />);
    rerender(<ArcRuler label="Stress" value={60} unit="/ 100" bands={bands} />);
    // the tick under the needle (angle 0) is the new value straight away
    const numerals = [...container.querySelectorAll('.lmv-arc__numeral')].map((n) => n.textContent);
    expect(numerals).toContain('50');
    expect(numerals).toContain('70');
    expect(numerals).not.toContain('30');
  });

  it('calibrating drops the bands and shows "Building baseline"; quiet hides the numerals; no reading says so', () => {
    const { container, rerender } = render(<ArcRuler label="Skin temperature" value={0.2} unit="°C" decimals={1} center={0} window={1.2} state="calibrating" />);
    expect(screen.getByText('Building baseline')).toHaveAttribute('data-kind', 'provisional');
    expect(container.querySelector('[data-edge]')).toBeNull();
    rerender(<ArcRuler label="Stress" value={89} unit="/ 100" bands={bands} quiet />);
    expect(visible(container)).not.toMatch(/\d/);
    rerender(<ArcRuler label="Stress" value={null} unit="/ 100" bands={bands} ageText="3 h ago" state="none" />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', 'Stress, no reading');
  });
});

describe('DayDisc', () => {
  const arcs = [
    { id: 'recovery' as const, label: 'Recovery', score: 71 },
    { id: 'activity' as const, label: 'Activity', score: 92 },
    { id: 'sleep' as const, label: 'Sleep', score: 88 },
  ];

  it('is one img with the sentence, lit dots per score and the target strip', () => {
    const { container } = render(<DayDisc label="Day score" score={84} band="Good" arcs={arcs} target={70} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Day score 84 of 100: recovery 71, activity 92, sleep 88; target 70; based on 3 of 3');
    expect(container.querySelectorAll('[data-arc="recovery"] circle[data-lit]')).toHaveLength(26);
    expect(screen.getByRole('meter', { name: 'Day score against the target' })).toHaveAttribute('aria-valuenow', '84');
  });

  it('a missing sub-score is a dashed outline with what it needs; the centre says based on 2 of 3', () => {
    const { container } = render(<DayDisc label="Day score" score={78} arcs={[{ ...arcs[0]!, score: null, needs: 'needs 3 more nights' }, arcs[1]!, arcs[2]!]} />);
    expect(container.querySelector('[data-arc="recovery"] .lmv-disc__missing')).not.toBeNull();
    expect(screen.getByText('needs 3 more nights')).toBeInTheDocument();
    expect(screen.getByText('based on 2 of 3')).toBeInTheDocument();
  });

  it('quiet shows the band word and no digits', () => {
    const { container } = render(<DayDisc label="Day score" score={84} band="Good" arcs={arcs} target={70} quiet />);
    expect(visible(container)).not.toMatch(/\d/);
    expect(screen.getByText('Good')).toBeInTheDocument();
  });

  it('quiet: a supplied completeness line and a missing arc’s need are words, shown and spoken (Codex UI #9)', () => {
    const { container } = render(
      <DayDisc label="Day score" score={78} band="Good" arcs={[{ ...arcs[0]!, score: null, needs: 'needs 3 more nights' }, arcs[1]!, arcs[2]!]} basedOn="based on 2 of 3" target={70} quiet />,
    );
    expect(visible(container)).not.toMatch(/\d/);
    expect(screen.getByRole('img').getAttribute('aria-label')).not.toMatch(/\d/);
    expect(screen.getByText('based on two of three')).toBeInTheDocument();
    expect(screen.getByText('needs three more nights')).toBeInTheDocument();
  });
});

describe('marks', () => {
  it('age with the stale dot hidden; the learning line', () => {
    const { container } = render(
      <>
        <ReadingAge ageText="18 h ago" stale />
        <LearningLine nights={3} of={7} />
      </>,
    );
    expect(container.querySelector('.lmv-stale-dot')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('.lmv-learning__dots [data-filled]')).toHaveLength(3);
    expect(screen.getByText('Learning your baseline · night 3 of 7')).toBeInTheDocument();
  });
});

describe('MonitorSheet', () => {
  const ALL: MonitorItem[] = [
    { id: 'hrv', label: 'HRV', valueText: '70 ms' },
    { id: 'rhr', label: 'Resting HR', valueText: '53 bpm' },
    { id: 'temp', label: 'Skin temperature', calibrating: true },
    { id: 'steps', label: 'Steps', valueText: '9 664' },
  ];
  function Harness({ max }: { max?: number }) {
    const [ids, setIds] = useState(['hrv', 'rhr', 'temp']);
    return (
      <MonitorSheet
        open
        onOpenChange={() => {}}
        selected={ids.map((id) => ALL.find((x) => x.id === id)!)}
        available={ALL.filter((x) => !ids.includes(x.id))}
        defaultIds={['hrv', 'rhr', 'temp']}
        max={max}
        onChange={setIds}
        onReset={() => setIds(['hrv', 'rhr', 'temp'])}
      />
    );
  }
  const order = () => screen.getAllByRole('listitem').filter((li) => li.getAttribute('aria-roledescription') === 'sortable item').map((li) => li.querySelector('.lmv-mon__label')!.textContent);

  it('title · ✕, sortable items, capacity text and the calibrating word', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^cancel$/i })).toBeNull();
    expect(order()).toEqual(['HRV', 'Resting HR', 'Skin temperature']);
    expect(screen.getByText('3 of 4')).toBeInTheDocument();
    expect(screen.getByText('Calibrating')).toBeInTheDocument();
  });

  it('Space picks up, arrows move, Space drops; the live region says where; focus stays on the row', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const grip = screen.getByRole('button', { name: /^Resting HR|^Move Resting HR/ });
    grip.focus();
    await user.keyboard(' ');
    await user.keyboard('{ArrowDown}');
    expect(document.querySelector('.lmv-mon [aria-live="polite"]')).toHaveTextContent('Resting HR moved to position 3 of 3');
    await user.keyboard(' ');
    expect(order()).toEqual(['HRV', 'Skin temperature', 'Resting HR']);
    expect(document.activeElement).toHaveAccessibleName(/Move Resting HR, position 3 of 3/);
  });

  it('Esc cancels a move', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole('button', { name: /Move HRV/ }).focus();
    await user.keyboard(' {ArrowDown}{Escape}');
    expect(order()).toEqual(['HRV', 'Resting HR', 'Skin temperature']);
    expect(document.querySelector('.lmv-mon [aria-live="polite"]')).toHaveTextContent('Move cancelled');
  });

  it('a removed item comes back at its old place; adding past max is refused', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Remove Resting HR' }));
    expect(order()).toEqual(['HRV', 'Skin temperature']);
    await user.click(screen.getByRole('button', { name: 'Add Resting HR' }));
    expect(order()).toEqual(['HRV', 'Resting HR', 'Skin temperature']);
    unmount();
    render(<Harness max={3} />);
    await user.click(screen.getByRole('button', { name: 'Add Steps' }));
    expect(order()).toHaveLength(3);
  });
});

describe('Hypnogram (r064)', () => {
  const at = (m: number) => T('23:00', '2026-10-25') + m * 60_000;
  // a fragmented raw night: minute flips, Mixed, a short and a long gap
  const raw = [
    { from: at(0), to: at(12), state: 0 },
    { from: at(12), to: at(40), state: 2 },
    { from: at(40), to: at(41), state: 1 },
    { from: at(41), to: at(43), state: 'mixed' as const },
    { from: at(43), to: at(90), state: 3 },
    { from: at(90), to: at(92), state: 0 },
    { from: at(92), to: at(120), state: 2 },
    // 120–128: no reading (short), bridged
    { from: at(128), to: at(150), state: 1 },
    // 150–200: no reading (long), one hatched band
    { from: at(200), to: at(260), state: 2 },
  ];
  const props = { label: 'Sleep stages', from: at(0), to: at(260), segments: raw, tz: TZ };

  it('draws four levels only, the long gap once, and no Mixed', () => {
    const { container } = render(<Hypnogram {...props} />);
    const levels = new Set([...container.querySelectorAll('.lmv-hyp__bar')].map((b) => b.getAttribute('data-stage')));
    expect([...levels].every((l) => ['awake', 'rem', 'light', 'deep'].includes(l!))).toBe(true);
    expect([...container.querySelectorAll('[data-row]')].map((r) => r.textContent)).toEqual(['Awake', 'REM', 'Light', 'Deep']);
    expect(container.querySelectorAll('[data-mark="gap"]')).toHaveLength(1);
    expect(visible(container)).not.toMatch(/Mixed/);
    expect(within(screen.getByRole('list', { name: 'Sleep stages key' })).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['No stage']);
  });

  it('no long gap: no "No stage" key', () => {
    const { container } = render(<Hypnogram {...props} segments={raw.slice(0, 8)} to={at(150)} />);
    expect(container.querySelector('[data-mark="gap"]')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Sleep stages key' })).toBeNull();
  });

  it('speaks the RAW totals, Mixed and No stage included', () => {
    render(<Hypnogram {...props} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Sleep stages, 23:00 to 03:20: awake 14 min, REM 23 min, light 116 min, deep 47 min; mixed 2 min; no stage 58 min'.replace('116 min', '1 h 56'));
  });

  it('the table twin and CSV keep the raw spans', async () => {
    const user = userEvent.setup();
    render(<Hypnogram {...props} />);
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const region = screen.getByRole('region', { name: 'Sleep stages table' });
    const heads = within(region).getAllByRole('rowheader').map((c) => c.textContent);
    expect(heads).toEqual(['Awake', 'Light', 'REM', 'Mixed', 'Deep', 'Awake', 'Light', 'No stage', 'REM', 'No stage', 'Light']);
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeInTheDocument();
  });

  it('is one tab stop; arrows read the drawn runs; quiet prints no numerals and hides the table', () => {
    const { container, rerender } = render(<Hypnogram {...props} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(img, { key: 'ArrowRight' });
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(/^Awake 23:00 to 23:12, 12 min$/);
    rerender(<Hypnogram {...props} quiet />);
    expect(visible(container)).not.toMatch(/\d/);
    expect(screen.getByRole('img').getAttribute('aria-label')).not.toMatch(/\d/);
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull();
  });
});

describe('OvernightTrace smoothing (r064)', () => {
  it('draws a smoothed line with a band, no per-reading dots, and breaks at a long gap', () => {
    const pts = [
      ...Array.from({ length: 30 }, (_, i) => ({ t: T('00:00') + i * 5 * 60_000, v: i === 12 ? 95 : 58 + (i % 3) })),
      ...Array.from({ length: 30 }, (_, i) => ({ t: T('04:00') + i * 5 * 60_000, v: 55 + (i % 3) })),
    ];
    const { container } = render(<OvernightTrace label="Heart rate" unit="bpm" from={T('00:00')} to={T('06:30')} points={pts} low={{ t: T('04:10'), v: 55 }} tz={TZ} />);
    expect(container.querySelectorAll('path.lmv-trace__line')).toHaveLength(2);
    expect(container.querySelectorAll('path.lmv-trace__band')).toHaveLength(2);
    expect(container.querySelectorAll('circle.lmv-trace__dot')).toHaveLength(0);
    // the spike does not set the scale; the spoken sentence still counts every raw reading
    expect([...container.querySelectorAll('text.lmc-lv-tick')].map((t) => t.textContent)).not.toContain('100');
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/; 60 readings$/);
    expect(container.querySelector('[data-mark="low"]')).toHaveTextContent('Lowest 55 · 04:10');
  });
});
