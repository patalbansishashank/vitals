import '../../test/setupDom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { categoryColor, domainColor } from '@/components';
import { AdherenceDial } from '../AdherenceDial';
import { blockRows } from '../BlockBars';
import { ScoreHistory } from '../ScoreHistory';
import { chartHue, EndDot, isMetricCategory, SkinGradients } from '../skin';
import { TrendLane } from '../TrendLane';
import { BARS, scoreFixture, trendFixture } from './fixtures';

afterEach(() => cleanup());

const css = readFileSync(resolve(__dirname, '../living-charts.css'), 'utf8');
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));

describe('the chart skin: one hue per chart, read from the tokens', () => {
  it('a metric category goes through categoryColor, anything else through domainColor', () => {
    expect(chartHue('body')).toBe(categoryColor('body'));
    expect(chartHue('cardio')).toBe(categoryColor('cardio'));
    expect(chartHue('plan')).toBe(domainColor('plan'));
    expect(chartHue('steps')).toBe(domainColor('steps'));
    expect(chartHue('sleep')).toBe('var(--lm-hue-sleep)');
    expect(chartHue(undefined)).toBe('var(--lm-cat-body)');
    expect(chartHue(undefined, 'plan')).toBe('var(--lm-signal)');
    expect(isMetricCategory('energy') && !isMetricCategory('plan')).toBe(true);
  });

  it('TrendLane, ScoreHistory, the dial and the block bars set their hue as a variable, never a hex', async () => {
    const { container, rerender } = render(<TrendLane data={trendFixture()} size="progress" />);
    await flush();
    expect(container.querySelector('.lmc-tl')).toHaveStyle({ '--lmc-hue': 'var(--lm-cat-body)' });
    rerender(<TrendLane data={trendFixture()} size="progress" hue="steps" />);
    expect(container.querySelector('.lmc-tl')).toHaveStyle({ '--lmc-hue': 'var(--lm-hue-steps)' });
    cleanup();
    const sh = render(<ScoreHistory data={scoreFixture()} label="HRV" />);
    expect(sh.container.querySelector('.lmc-sh')).toHaveStyle({ '--lmc-sh-hue': 'var(--lm-cat-recovery)' });
    cleanup();
    const dial = render(<AdherenceDial items={[]} score={50} size="sm" hue="food" />);
    expect(dial.container.querySelector('.lmc-dial')).toHaveStyle({ '--lmc-hue': 'var(--lm-hue-food)' });
    expect(blockRows(BARS, { hue: 'var(--lm-hue-steps)', markWeakest: true })[0]!.hue).toContain('--lm-hue-steps');
    expect(blockRows(BARS)[0]!.hue).toBe('var(--lm-signal)');
    for (const src of [readFileSync(resolve(__dirname, '../skin.tsx'), 'utf8'), readFileSync(resolve(__dirname, '../TrendLane.tsx'), 'utf8')]) expect(src.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-f]{6}\b/i);
  });

  it('the end dot is a halo, a surface ring and the dot; a pulse ring only while it pulses', () => {
    const a = render(<svg><EndDot x={10} y={20} r={5} /></svg>).container;
    expect([...a.querySelectorAll('circle')].map((c) => c.getAttribute('class'))).toEqual(['lmc-end__halo', 'lmc-end__ring', 'lmc-end__dot']);
    expect(a.querySelector('.lmc-end__dot')).toHaveAttribute('r', '5');
    expect(a.querySelector('.lmc-end__halo')).toHaveAttribute('r', '11'); // dot + 6 px of halo
    cleanup();
    const b = render(<svg><EndDot x={10} y={20} pulse hollow /></svg>).container;
    expect(b.querySelector('.lmc-end__pulse')).not.toBeNull();
    expect(b.querySelector('.lmc-end')).toHaveAttribute('data-hollow', 'true');
  });

  it('the gradients are the chart\'s hue (or a series\' own) and static: nothing animates a gradient', () => {
    const { container } = render(
      <svg>
        <defs>
          <SkinGradients id="x" />
          <SkinGradients id="y" hue="var(--lm-hue-food)" />
        </defs>
      </svg>,
    );
    expect(container.querySelectorAll('linearGradient')).toHaveLength(4);
    expect(container.querySelector('#x-area stop')).not.toHaveAttribute('style');
    expect((container.querySelector('#y-band stop') as SVGElement).style.stopColor).toBe('var(--lm-hue-food)');
    expect(css).not.toMatch(/@keyframes[^{]*\{[^@]*(stop-color|stop-opacity)/);
  });
});

describe('TrendLane in a card (r071)', () => {
  it('ends in a dot at today\'s trend value, and the first-view wipe leaves the markup alone when it cannot run', async () => {
    const { container } = render(<TrendLane data={trendFixture()} size="progress" />);
    await flush();
    const dot = container.querySelector('.lmc-end__dot')!;
    const trend = container.querySelector('[data-mark="trend"]')!.getAttribute('d')!;
    // the dot sits on the last point of the line
    const last = trend.split(/[CM]/).filter(Boolean).at(-1)!.split(',').slice(-2).map(Number);
    expect(Number(dot.getAttribute('cx'))).toBeCloseTo(last[0]!, 0);
    expect(Number(dot.getAttribute('cy'))).toBeCloseTo(last[1]!, 0);
    expect(container.querySelector('.lmc-tl')).not.toHaveAttribute('data-reveal');
    expect(container.querySelector('.lmc-draw')).not.toBeNull();
    expect(container.querySelector('.lmc-end__pulse')).toBeNull(); // reduced / no motion: the dot stays, still
  });

  it('the small charts get the small dot; a trend with no forecast gets the soft area under it', async () => {
    const { container } = render(<TrendLane data={trendFixture()} size="checkin" />);
    await flush();
    expect(container.querySelector('.lmc-end__dot')).toHaveAttribute('r', '3.5');
    expect(container.querySelector('[data-mark="area"]')).toBeNull(); // the band does the job
    cleanup();
    const data = trendFixture();
    delete data.realistic;
    const none = render(<TrendLane data={data} size="progress" />);
    await flush();
    expect(none.container.querySelector('[data-mark="area"]')?.getAttribute('fill')).toMatch(/^url\(#.+-area\)$/);
    expect(none.container.querySelector('.lmc-end__dot')).toHaveAttribute('r', '5');
  });

  it('a card turns the legend off (the band names itself) and hosts the table twin in its (i): no key, no T', async () => {
    const { container } = render(<TrendLane data={trendFixture()} size="progress" legend={false} tableTwin={false} readout={false} />);
    await flush();
    expect(screen.queryByText('Unusual, kept')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull();
    expect(container.querySelector('[data-mark="band-word"]')?.textContent).toBe('Forecast');
    const plot = screen.getByRole('img', { name: /^Weight trend/ });
    act(() => plot.focus());
    const notPrevented = fireEvent.keyDown(plot, { key: 't' });
    expect(notPrevented).toBe(true); // the card's own handler gets the T key
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('quiet: no band word either, and the hue still reaches the end dot', async () => {
    const { container } = render(<TrendLane data={trendFixture()} size="progress" legend={false} quiet readout={false} />);
    await flush();
    expect(container.querySelector('[data-mark="band-word"]')).toBeNull();
    expect(container.querySelector('.lmc-end__dot')).not.toBeNull();
  });
});

describe('the skin\'s stylesheet', () => {
  it('draws a dotted dim grid and a firmer baseline from one more selector than the copied rules (so viz.css keeps its copy)', () => {
    expect(css).toMatch(/\.lmc-lv-svg \.lmc-lv-grid \{[^}]*stroke-dasharray: 1 3;/);
    expect(css).toMatch(/\.lmc-lv-svg \.lmc-lv-axis \{[^}]*stroke-opacity: 0\.14;/);
  });

  it('puts ivory on the focal marks of a card with a glow and stone-2 on its ticks', () => {
    expect(css).toMatch(/\.lm-gcard\[data-domain\]:not\(\[data-domain='neutral'\]\) \.lmc-skin \{[^}]*--lmc-line: var\(--lm-ink\);/);
    expect(css).toMatch(/\.lmc-skin \.lmc-lv-tick \{\s*fill: var\(--lm-ink-2\);/);
  });

  it('has no glow, no pulse and no wash under forced colours, and stops the wipe and the pulse under reduced motion', () => {
    const fc = css.slice(css.indexOf('@media (forced-colors: active)', css.indexOf('The r071 skin')));
    expect(fc).toMatch(/\.lmc-end__halo[^{]*\{\s*display: none;/);
    expect(fc).toMatch(/\.lmc-end \{\s*filter: none;/);
    expect(css).toMatch(/data-motion='reduce'\] \.lmc-end__pulse \{\s*display: none;/);
    expect(css).toMatch(/data-motion='reduce'\] :is\(\.lmc-draw, \.lmc-cal__row\) \{\s*transition: none;/);
  });
});
