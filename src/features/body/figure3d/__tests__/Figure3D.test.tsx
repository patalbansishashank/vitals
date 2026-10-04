// <Figure3D>: the SVG figure first and as the fallback (no WebGL2, asset failure, context loss, slow device), the
// cross-fade to the canvas underlay once it has drawn, the overlay (accessible name, handles) staying in both modes.
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { liveEstimate, stateToAvatarParams } from '@/engine/body';
import { Figure3D } from '../Figure3D';
import type { Figure3DCanvasProps } from '../Figure3DCanvas';

/** What the mocked WebGL chunk does once mounted. */
const canvas = vi.hoisted(() => ({ mode: 'ready' as 'ready' | 'fail' | 'lose' | 'slow', props: null as unknown }));

vi.mock('../Figure3DCanvas', async () => {
  const device = await import('../device');
  function MockCanvas(p: Figure3DCanvasProps) {
    canvas.props = p;
    useEffect(() => {
      if (canvas.mode === 'fail') p.onFail('figure asset: 404');
      else if (canvas.mode === 'slow') {
        device.markSlowDevice();
        p.onFail('slow device');
      } else {
        p.onExtent?.({ front: 30, side: 20, height: 170 });
        p.onReady?.();
        if (canvas.mode === 'lose') setTimeout(() => p.onFail('WebGL context lost'), 0);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <canvas data-testid="fig3d-canvas" />;
  }
  return { default: MockCanvas };
});

const params = stateToAvatarParams(liveEstimate({ sex: 'female', ageYears: 40, heightCm: 165, weightKg: 70 }));
const start = stateToAvatarParams(liveEstimate({ sex: 'female', ageYears: 40, heightCm: 165, weightKg: 78 }));
const SEX_WORDS = /\b(female|male|man|woman|masculine|feminine|neutral)\b/i;

const root = (c: HTMLElement) => c.querySelector('.lm-fig3d') as HTMLElement;
const avatar = (c: HTMLElement) => c.querySelector('.lm-avatar') as HTMLElement;
const nameOf = (c: HTMLElement) => c.querySelector('.lm-avatar__svg title')?.textContent ?? '';

function withWebGL2(on: boolean) {
  const w = window as unknown as { WebGL2RenderingContext?: unknown };
  if (on) w.WebGL2RenderingContext = function WebGL2RenderingContext() {};
  else delete w.WebGL2RenderingContext;
}

afterEach(() => {
  withWebGL2(false);
  canvas.mode = 'ready';
  canvas.props = null;
});

describe('<Figure3D> without WebGL2 (jsdom)', () => {
  it('draws the SVG figure in the same box, with a shape-only label', () => {
    const { container } = render(<Figure3D params={params} />);
    expect(root(container).getAttribute('data-renderer')).toBe('svg');
    expect(avatar(container).getAttribute('data-body')).toBe('svg');
    expect(container.querySelector('.lm-fig3d__layer')).toBeNull();
    const label = nameOf(container);
    expect(label).toMatch(/^Figure, 165 cm/);
    expect(label).not.toMatch(SEX_WORDS);
    expect(screen.getByRole('img', { name: label })).toBeInTheDocument();
  });

  it('describes the frame by shape and follows an explicit frame', () => {
    const { container: a } = render(<Figure3D params={params} frame={0} />);
    const { container: b } = render(<Figure3D params={params} frame={1} />);
    expect(nameOf(a)).not.toBe(nameOf(b));
    expect(nameOf(b)).toMatch(/shoulders/);
  });

  it('names the two-layer drawing and the start outline', () => {
    const { container } = render(<Figure3D params={params} layers="two-layer" compareTo={start} />);
    expect(nameOf(container)).toMatch(/Drawn in two layers/);
    expect(nameOf(container)).toMatch(/Grey outline behind it: the start/);
    // the SVG fallback draws the lean core only in two-layer mode
    expect(container.querySelector('.lm-avatar__core')).not.toBeNull();
    const { container: one } = render(<Figure3D params={params} layers="envelope" />);
    expect(one.querySelector('.lm-avatar__core')).toBeNull();
  });

  it('shows the visceral view next to the figure on request', () => {
    render(<Figure3D params={params} visceral caption={false} />);
    expect(screen.getAllByRole('img').some((el) => /Waist slice/.test(el.getAttribute('aria-label') ?? ''))).toBe(true);
  });

  it('forceSvg never loads the WebGL chunk', () => {
    withWebGL2(true);
    const { container } = render(<Figure3D params={params} forceSvg />);
    expect(root(container).getAttribute('data-renderer')).toBe('svg');
    expect(container.querySelector('.lm-fig3d__layer')).toBeNull();
  });
});

describe('<Figure3D> with WebGL2', () => {
  it('keeps the SVG body until the canvas has drawn, then cross-fades and keeps the overlay', async () => {
    withWebGL2(true);
    const onRegionDrag = vi.fn();
    const { container } = render(<Figure3D params={params} size="fill" interactive={{ onRegionDrag }} />);
    expect(await screen.findByTestId('fig3d-canvas')).toBeInTheDocument();
    await waitFor(() => expect(root(container).getAttribute('data-renderer')).toBe('webgl'));
    expect(avatar(container).getAttribute('data-body')).toBe('hidden');
    expect(container.querySelector('.lm-fig3d__layer')).toHaveAttribute('data-ready');
    // the overlay keeps the accessible image and the handles in register with the canvas
    expect(screen.getByRole('img', { name: /^Figure, 165 cm/ })).toBeInTheDocument();
    expect(container.querySelectorAll('.lm-avatar__handle').length).toBe(4);
    const p = canvas.props as Figure3DCanvasProps;
    expect(p.layout?.layout.k).toBeGreaterThan(0);
    expect(p.layout?.layout.x.front).toBeDefined();
    expect(p.layout?.layout.x.side).toBeDefined();
  });

  it('falls back to the SVG figure when the asset fails', async () => {
    withWebGL2(true);
    canvas.mode = 'fail';
    const onFallback = vi.fn();
    const { container } = render(<Figure3D params={params} onFallback={onFallback} />);
    await waitFor(() => expect(onFallback).toHaveBeenCalledWith('figure asset: 404'));
    expect(root(container).getAttribute('data-renderer')).toBe('svg');
    expect(avatar(container).getAttribute('data-body')).toBe('svg');
    expect(screen.queryByTestId('fig3d-canvas')).toBeNull();
  });

  it('falls back to the SVG figure when the WebGL context is lost', async () => {
    withWebGL2(true);
    canvas.mode = 'lose';
    const onFallback = vi.fn();
    const { container } = render(<Figure3D params={params} onFallback={onFallback} />);
    await waitFor(() => expect(onFallback).toHaveBeenCalledWith('WebGL context lost'));
    expect(root(container).getAttribute('data-renderer')).toBe('svg');
    expect(avatar(container).getAttribute('data-body')).toBe('svg');
  });

  it('a slow device switches to the SVG figure for the rest of the session', async () => {
    withWebGL2(true);
    canvas.mode = 'slow';
    const onFallback = vi.fn();
    const { container, unmount } = render(<Figure3D params={params} onFallback={onFallback} />);
    await waitFor(() => expect(onFallback).toHaveBeenCalledWith('slow device'));
    expect(root(container).getAttribute('data-renderer')).toBe('svg');
    unmount();
    canvas.mode = 'ready';
    let again: HTMLElement | null = null;
    act(() => {
      again = render(<Figure3D params={params} />).container;
    });
    expect(root(again!).getAttribute('data-renderer')).toBe('svg');
    expect(again!.querySelector('.lm-fig3d__layer')).toBeNull();
  });
});
