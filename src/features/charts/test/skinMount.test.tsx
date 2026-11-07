/**
 * The skin's DOM half in jsdom (r071): the plot engine's `onDraw` hook, the focused lane's pulse (placed on the model's
 * end point, mounted only while `usePulse` allows it, never in another lane), the crosshair dots wearing the series' hue
 * through `--lmc-dot`, and the stylesheet's switches (reduced motion, forced colours, more contrast) written down.
 */
import './setupDom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const motion = vi.hoisted(() => ({ pulse: true }));
vi.mock('@/app/motion', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), usePulse: () => motion.pulse }));

import { ChartFrame } from '../components/ChartFrame';
import { ChartController } from '../core/controller';
import { lineLaneModel } from '../core/models';
import { PlotCanvas, type PlotApi } from '../core/PlotCanvas';
import { makeChartData } from '../fixtures';

const data = makeChartData({ days: 84 });
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });
};

afterEach(() => {
  cleanup();
  motion.pulse = true;
});

describe('PlotApi.onDraw', () => {
  it('tells a listener after every draw until it unsubscribes', async () => {
    const controller = new ChartController(84);
    const model = lineLaneModel(data.series.find((s) => s.id === 'fat_mass')!, { mode: 'lane', tickColCss: 32 });
    let api: PlotApi | null = null;
    render(<PlotCanvas model={model} controller={controller} width={600} height={120} padding={{ top: 8, bottom: 8, left: 32, right: 8 }} onApi={(a) => (api = a)} />);
    await flush();
    expect(api).not.toBeNull();
    // uPlot commits a redraw in a microtask
    const redraw = () =>
      act(async () => {
        api!.redraw();
        await new Promise((r) => setTimeout(r, 5));
      });
    const seen = vi.fn();
    const off = api!.onDraw(seen);
    await redraw();
    expect(seen).toHaveBeenCalledTimes(1);
    await redraw();
    expect(seen).toHaveBeenCalledTimes(2);
    off();
    await redraw();
    expect(seen).toHaveBeenCalledTimes(2);
  });
});

describe('the focused lane pulses', () => {
  const frame = (focus: string | null) => (
    <ChartFrame data={data} defaultLaneIds={['fat_mass', 'lean_mass', 'glycogen']} defaultView={focus ? 'focus' : 'lanes'} defaultFocusId={focus} />
  );

  it('mounts one ring on the focused lane, in its hue, placed on the end of its line', async () => {
    render(frame('fat_mass'));
    await flush();
    const rings = document.querySelectorAll<HTMLElement>('.lmc-pulse');
    expect(rings).toHaveLength(1);
    const ring = rings[0]!;
    expect(ring.style.getPropertyValue('--lmc-dot')).toBe('var(--lm-cat-body)');
    expect(ring.querySelector('i')).not.toBeNull();
    expect(ring.closest('[data-lane="fat_mass"]')).not.toBeNull();
    expect(ring.getAttribute('data-on')).toBe('true');
    expect(ring.style.transform).toMatch(/^translate\(-?[\d.]+px, -?[\d.]+px\)$/);
  });

  it('is not mounted in lane mode, in a strip, or when motion is off (usePulse false)', async () => {
    render(frame(null));
    await flush();
    expect(document.querySelector('.lmc-pulse')).toBeNull();
    cleanup();
    motion.pulse = false;
    render(frame('fat_mass'));
    await flush();
    expect(document.querySelector('.lmc-pulse')).toBeNull();
  });

  it('leaves the other lanes of a focus view as strips, without a ring', async () => {
    render(frame('fat_mass'));
    await flush();
    expect(document.querySelectorAll('[data-mode="strip"] .lmc-pulse')).toHaveLength(0);
  });
});

describe('the crosshair dot wears the series hue', () => {
  it('through --lmc-dot, not an inline background', async () => {
    render(<ChartFrame data={data} defaultLaneIds={['fat_mass', 'ketones']} />);
    await flush();
    const dots = [...document.querySelectorAll<HTMLElement>('.lmc-dot')];
    expect(dots.length).toBeGreaterThanOrEqual(2);
    for (const d of dots) {
      expect(d.style.background).toBe('');
      expect(d.style.getPropertyValue('--lmc-dot')).toMatch(/^var\(--lm-cat-[a-z]+\)$/);
    }
    expect(dots.map((d) => d.style.getPropertyValue('--lmc-dot'))).toEqual(expect.arrayContaining(['var(--lm-cat-body)', 'var(--lm-cat-fuel)']));
  });
});

describe('charts.css: the skin written down', () => {
  const root = resolve(__dirname, '../../../..');
  const css = readFileSync(resolve(root, 'src/features/charts/charts.css'), 'utf8');
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector: string): string => {
    const i = code.indexOf(`${selector} {`);
    expect(i, `${selector} is styled`).toBeGreaterThanOrEqual(0);
    return code.slice(i, code.indexOf('}', i));
  };

  it('keeps the skin numbers as chart-local tokens the canvas reads', () => {
    for (const t of ['--lmc-grid-a', '--lmc-area-top', '--lmc-dot-halo-a', '--lmc-dot-halo', '--lmc-dot-glow-a', '--lmc-dot-glow']) expect(code).toMatch(new RegExp(`${t}:\\s*[\\d.]+(px)?;`));
    expect(code).toMatch(/--lmc-area-top:\s*0\.26;/);
  });
  it('builds the TDEE ramp from the r071 intensity set and no longer has a hex ramp of its own', () => {
    expect(code).toMatch(/--lmc-energy-ramp-1:\s*var\(--lm-intensity-resting\);/);
    expect(code).toMatch(/--lmc-energy-ramp-2:\s*var\(--lm-intensity-light\);/);
    expect(code).toMatch(/--lmc-energy-ramp-3:\s*var\(--lm-intensity-active\);/);
    expect(code).toMatch(/--lmc-energy-ramp-4:\s*var\(--lm-intensity-exercise\);/);
    expect(code).not.toMatch(/--lmc-energy-ramp-\d:\s*#/);
  });
  it('paints the dot from --lmc-dot with the ring and a halo, and the crosshair hairline fades at both ends', () => {
    const dot = rule('.lmc-dot');
    expect(dot).toMatch(/background:\s*var\(--lmc-dot\)/);
    expect(dot).toMatch(/outline:\s*2px solid var\(--lm-chart-ring\)/);
    expect(dot).toMatch(/box-shadow:/);
    expect(rule('.lmc-xhair')).toMatch(/background:\s*linear-gradient\(to bottom, transparent, .*, transparent\);/);
  });
  it('pulses twice at most (under WCAG 2.2.2) and hides the pulse and the glow under reduced motion, forced colours and more contrast', () => {
    expect(rule('.lmc-pulse > i')).toMatch(/animation:\s*lmc-pulse var\(--lmc-pulse-dur\) ease-out var\(--lm-pulse-cycles, 2\)/);
    expect(code).toMatch(/@keyframes lmc-pulse\s*\{\s*from\s*\{\s*transform:\s*scale\(1\);\s*opacity:\s*0\.45;\s*\}\s*to\s*\{\s*transform:\s*scale\(1\.9\);\s*opacity:\s*0;/);
    for (const query of ['@media (forced-colors: active)', '@media (prefers-contrast: more)', '@media (prefers-reduced-motion: reduce)']) {
      const i = code.indexOf(query);
      expect(i, query).toBeGreaterThanOrEqual(0);
      expect(code.slice(i, i + 600), query).toMatch(/\.lmc-pulse|\.lmc-halo/);
    }
    expect(code).toMatch(/:root\[data-motion='reduce'\] \.lmc-dot\s*\{\s*box-shadow:\s*none;/);
    expect(code).toMatch(/:root\[data-motion='reduce'\] :is\(\.lmc-pulse, \.lmc-halo\)\s*\{\s*display:\s*none;/);
  });
  it('draws the small charts\' gridlines dotted and dim, like the canvas', () => {
    const grid = rule('.lmc-grid');
    expect(grid).toMatch(/stroke-dasharray:\s*1 3/);
    expect(grid).toMatch(/stroke-opacity:\s*var\(--lmc-grid-a\)/);
  });
  it('leaves gold to the playhead: no data rule reads --lm-signal but the sweep', () => {
    const uses = [...code.matchAll(/([^{}]+)\{[^}]*var\(--lm-signal\)[^}]*\}/g)].map((m) => m[1]!.trim());
    expect(uses).toEqual(['.lmc-sweep']);
  });
});
