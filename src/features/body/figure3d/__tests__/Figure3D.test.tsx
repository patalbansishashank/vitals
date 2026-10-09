import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { liveEstimate, stateToAvatarParams } from '@/engine/body';
import { Figure3D } from '../Figure3D';
import type { Figure3DCanvasProps, FigureViewControl } from '../Figure3DCanvas';
import { VIEW_HINT, forgetViewHint } from '../viewHint';

const canvas = vi.hoisted(() => ({
  mode: 'ready' as 'ready' | 'pending' | 'fail' | 'lose' | 'slow' | 'throw',
  props: null as unknown,
  api: null as unknown as Record<keyof FigureViewControl, ReturnType<typeof vi.fn>>,
}));
vi.mock('../Figure3DCanvas', async () => {
  const device = await import('../device');
  function MockCanvas(p: Figure3DCanvasProps) {
    canvas.props = p;
    if (canvas.mode === 'throw') throw new Error('chunk failed');
    useEffect(() => {
      // what the real canvas does through useImperativeHandle
      if (p.controlRef && 'current' in p.controlRef) p.controlRef.current = canvas.api as unknown as FigureViewControl;
      if (canvas.mode === 'fail') p.onFail('figure asset: 404');
      else if (canvas.mode === 'slow') {
        device.markSlowDevice();
        p.onFail('slow device');
      } else if (canvas.mode !== 'pending') {
        p.onReady?.();
        if (canvas.mode === 'lose') setTimeout(() => p.onFail('WebGL context lost'), 0);
      }
      // Mount result is deliberately fixed for each test; prop updates are asserted separately.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <canvas data-testid="fig3d-canvas" />;
  }
  return { default: MockCanvas };
});

const params = stateToAvatarParams(
  liveEstimate({ sex: 'female', ageYears: 40, heightCm: 165, weightKg: 70 }),
);
const start = stateToAvatarParams(liveEstimate({ sex: 'female', ageYears: 40, heightCm: 165, weightKg: 78 }));
const root = (c: HTMLElement) => c.querySelector('.lm-fig3d') as HTMLElement;
function withWebGL2(on: boolean) {
  const w = window as unknown as { WebGL2RenderingContext?: unknown };
  if (on) w.WebGL2RenderingContext = function WebGL2RenderingContext() {};
  else delete w.WebGL2RenderingContext;
}
beforeEach(() => {
  canvas.api = { zoomIn: vi.fn(), zoomOut: vi.fn(), reset: vi.fn() };
});
afterEach(() => {
  withWebGL2(false);
  canvas.mode = 'ready';
  canvas.props = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  forgetViewHint();
});

describe('<Figure3D>', () => {
  it('uses the vector figure when WebGL2 is unavailable', () => {
    const { container } = render(<Figure3D params={params} />);
    expect(root(container)).toHaveAttribute('data-renderer', 'svg');
    expect(container.querySelector('.lm-avatar')).toBeInTheDocument();
    expect(container.querySelector('.lm-fig3d__layer')).toBeNull();
    expect(screen.getByRole('img', { name: /^Figure, 165 cm/ })).toBeInTheDocument();
  });

  it('shows a neutral placeholder while 3D loads, never the vector figure, then presents one rotating 3D figure', async () => {
    withWebGL2(true);
    // every node added to the figure from the very first commit on: none may be the 2D body
    const seen: string[] = [];
    const watch = new MutationObserver((records) => {
      for (const r of records)
        r.addedNodes.forEach((n) => {
          if (n instanceof Element) seen.push(n.matches('.lm-avatar') || n.querySelector('.lm-avatar') ? 'avatar' : n.className.toString());
        });
    });
    const { container } = render(<Figure3D params={params} size="fill" compareTo={start} />);
    watch.observe(container, { childList: true, subtree: true });
    // first paint: the placeholder in the stage, the figure marked busy, no vector figure
    expect(container.querySelector('.lm-avatar')).toBeNull();
    expect(container.querySelector('.lm-fig3d__stage > .lm-fig3d__loading')).toBeInTheDocument();
    expect(root(container)).toHaveAttribute('data-renderer', 'loading');
    expect(root(container)).toHaveAttribute('aria-busy', 'true');
    expect(await screen.findByTestId('fig3d-canvas')).toBeInTheDocument();
    await waitFor(() => expect(root(container)).toHaveAttribute('data-renderer', 'webgl'));
    watch.disconnect();
    expect(seen).not.toContain('avatar');
    expect(container.querySelector('.lm-avatar')).toBeNull();
    expect(container.querySelector('.lm-fig3d__loading')).toBeNull();
    expect(root(container)).not.toHaveAttribute('aria-busy');
    const p = canvas.props as Figure3DCanvasProps;
    expect(p.views).toEqual(['front']);
    expect(p.layout).toBeNull();
    expect(p.compareTo).toBe(start);
    expect(p.autoRotate).toBe(true);
    expect(p.interactive).toBe(true);
    expect(p.anatomyLayers).toEqual({
      skin: true,
      subcutaneousFat: true,
      muscles: true,
      skeleton: true,
    });
  });

  it('keeps the placeholder, not the vector figure, for as long as 3D has not drawn its first frame', async () => {
    withWebGL2(true);
    canvas.mode = 'pending';
    const { container } = render(<Figure3D params={params} />);
    await screen.findByTestId('fig3d-canvas');
    // the 3D code has mounted but nothing is drawn yet: still the placeholder, and the layer is still hidden
    expect(container.querySelector('.lm-avatar')).toBeNull();
    expect(container.querySelector('.lm-fig3d__loading')).toBeInTheDocument();
    expect(container.querySelector('.lm-fig3d__layer')).not.toHaveAttribute('data-ready');
    expect(root(container)).toHaveAttribute('data-renderer', 'loading');
    // the swap happens on the canvas's first drawn frame (onReady), not on mount
    act(() => (canvas.props as Figure3DCanvasProps).onReady?.());
    expect(container.querySelector('.lm-fig3d__loading')).toBeNull();
    expect(container.querySelector('.lm-fig3d__layer')).toHaveAttribute('data-ready');
    expect(container.querySelector('.lm-avatar')).toBeNull();
  });

  it('shows the vector figure only when 3D is unavailable or failed', async () => {
    // no WebGL2 at all: the vector figure from the first paint, no placeholder
    const none = render(<Figure3D params={params} />);
    expect(none.container.querySelector('.lm-avatar')).toBeInTheDocument();
    expect(none.container.querySelector('.lm-fig3d__loading')).toBeNull();
    expect(root(none.container)).toHaveAttribute('data-renderer', 'svg');
    none.unmount();
    withWebGL2(true);
    // asked for the vector figure
    const forced = render(<Figure3D params={params} forceSvg />);
    expect(forced.container.querySelector('.lm-avatar')).toBeInTheDocument();
    expect(forced.container.querySelector('.lm-fig3d__loading')).toBeNull();
    forced.unmount();
    // WebGL2 exists, nothing drawn yet: the placeholder. Then the context cannot be created: the vector figure.
    canvas.mode = 'pending';
    const onFallback = vi.fn();
    const failing = render(<Figure3D params={params} onFallback={onFallback} />);
    await screen.findByTestId('fig3d-canvas');
    expect(failing.container.querySelector('.lm-avatar')).toBeNull();
    expect(failing.container.querySelector('.lm-fig3d__loading')).toBeInTheDocument();
    act(() => (canvas.props as Figure3DCanvasProps).onFail('WebGL context creation failed'));
    expect(failing.container.querySelector('.lm-avatar')).toBeInTheDocument();
    expect(failing.container.querySelector('.lm-fig3d__loading')).toBeNull();
    expect(failing.container.querySelector('.lm-fig3d__layer')).toBeNull();
    expect(root(failing.container)).toHaveAttribute('data-renderer', 'svg');
    expect(root(failing.container)).not.toHaveAttribute('aria-busy');
    expect(onFallback).toHaveBeenCalledWith('WebGL context creation failed');
    failing.unmount();
    // an asset error from the canvas: the vector figure
    canvas.mode = 'fail';
    const assetFail = render(<Figure3D params={params} onFallback={onFallback} />);
    await waitFor(() => expect(assetFail.container.querySelector('.lm-avatar')).toBeInTheDocument());
    expect(onFallback).toHaveBeenCalledWith('figure asset: 404');
    assetFail.unmount();
    // the 3D code itself fails to load or render
    canvas.mode = 'throw';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = render(<Figure3D params={params} onFallback={onFallback} />);
    await waitFor(() => expect(broken.container.querySelector('.lm-avatar')).toBeInTheDocument());
    expect(onFallback).toHaveBeenCalledWith('3D figure: chunk failed');
    broken.unmount();
    // the context is lost after the first frame: back to the vector figure
    canvas.mode = 'ready';
    const lost = render(<Figure3D params={params} />);
    await waitFor(() => expect(root(lost.container)).toHaveAttribute('data-renderer', 'webgl'));
    expect(lost.container.querySelector('.lm-avatar')).toBeNull();
    act(() => (canvas.props as Figure3DCanvasProps).onFail('WebGL context lost'));
    expect(lost.container.querySelector('.lm-avatar')).toBeInTheDocument();
    expect(root(lost.container)).toHaveAttribute('data-renderer', 'svg');
  });

  it('uses the placeholder at every size while loading: plan cards, thumbnails and the onboarding mini figure', async () => {
    withWebGL2(true);
    canvas.mode = 'pending';
    for (const props of [
      { size: 'xs' as const },
      { size: 'sm' as const, caption: false as const },
      { size: 108, controls: false, decorative: true, caption: false as const },
      { size: 'fill' as const },
    ]) {
      const view = render(<Figure3D params={params} {...props} />);
      await screen.findByTestId('fig3d-canvas');
      expect(view.container.querySelector('.lm-avatar')).toBeNull();
      expect(view.container.querySelector('.lm-fig3d__stage > .lm-fig3d__loading')).toBeInTheDocument();
      view.unmount();
    }
  });

  it('keeps transient SVG handles out of the keyboard order while 3D loads', async () => {
    withWebGL2(true);
    canvas.mode = 'pending';
    const interactive = { onRegionDrag: vi.fn() };
    const loading = render(<Figure3D params={params} interactive={interactive} />);
    expect(loading.container.querySelector('.lm-avatar')).toBeNull();
    expect(loading.container.querySelectorAll('.lm-avatar__handle')).toHaveLength(0);
    await screen.findByTestId('fig3d-canvas');
    expect((canvas.props as Figure3DCanvasProps).interactive).toBe(false);
    loading.unmount();

    const fallback = render(<Figure3D params={params} interactive={interactive} forceSvg />);
    expect(fallback.container.querySelectorAll('.lm-avatar__handle')).toHaveLength(4);
  });

  it('shows the layer switches in an always-open panel under a plain "Layers" heading, with no note', async () => {
    withWebGL2(true);
    const { container } = render(<Figure3D params={params} />);
    await screen.findByTestId('fig3d-canvas');
    expect(container.querySelector('.lm-fig3d__tools details, .lm-fig3d__tools summary')).toBeNull();
    const heading = screen.getByRole('heading', { name: 'Layers' });
    const group = screen.getByRole('group', { name: 'Layers' });
    expect(group).toBeVisible();
    expect(heading.nextElementSibling).toBe(group);
    expect(Array.from(group.querySelectorAll('button')).map((b) => b.textContent)).toEqual([
      'Skin',
      'Fat under skin',
      'Muscles',
      'Bones',
    ]);
    // the reference-anatomy note is said once, in the caption under the figure, not in the panel
    expect(container.querySelector('.lm-fig3d__tools')?.textContent).not.toMatch(/reference anatomy/);
    expect(container.querySelector('figcaption')?.textContent).toMatch(/Muscles and bones show reference anatomy\./);
  });

  it('lets the person choose layers and pause turning', async () => {
    withWebGL2(true);
    render(<Figure3D params={params} />);
    await screen.findByTestId('fig3d-canvas');
    fireEvent.click(screen.getByRole('button', { name: 'Fat under skin' }));
    expect((canvas.props as Figure3DCanvasProps).anatomyLayers?.subcutaneousFat).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Pause turning' }));
    expect((canvas.props as Figure3DCanvasProps).autoRotate).toBe(false);
    expect(screen.getByRole('button', { name: 'Resume turning' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('puts an icon-only play/pause button on the canvas stage', async () => {
    withWebGL2(true);
    const { container } = render(<Figure3D params={params} />);
    await screen.findByTestId('fig3d-canvas');
    const button = screen.getByRole('button', { name: 'Pause turning' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button.closest('.lm-fig3d__stage')).toBeInTheDocument();
    expect(container.querySelector('.lm-fig3d__tools')?.contains(button)).toBe(false);
    expect(button).toHaveTextContent('');
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('hides the play/pause button when motion is reduced', async () => {
    withWebGL2(true);
    document.documentElement.setAttribute('data-motion', 'reduce');
    try {
      render(<Figure3D params={params} />);
      await screen.findByTestId('fig3d-canvas');
      expect((canvas.props as Figure3DCanvasProps).autoRotate).toBe(false);
      expect(screen.queryByRole('button', { name: /turning/ })).toBeNull();
    } finally {
      document.documentElement.removeAttribute('data-motion');
    }
  });

  it('omits the 3D visceral layer while keeping the numerical SVG visceral view', async () => {
    withWebGL2(true);
    render(<Figure3D params={params} visceral />);
    await screen.findByTestId('fig3d-canvas');
    fireEvent.click(screen.getByText('Layers'));
    expect(screen.queryByRole('button', { name: /Fat around organs/i })).toBeNull();
    expect((canvas.props as Figure3DCanvasProps).anatomyLayers).not.toHaveProperty('visceralFat');
    expect(
      screen.getByRole('img', { name: /^Waist slice\. Visceral fat about \d+ square centimetres/ }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('visc-section').tagName.toLowerCase()).toBe('svg');
    expect(screen.getByText(/^about \d+ cm²$/)).toBeInTheDocument();
  });

  it('keeps controls on a small plan figure and removes them from decorative thumbnails', async () => {
    withWebGL2(true);
    const plan = render(<Figure3D params={params} size="sm" caption={false} />);
    await screen.findByTestId('fig3d-canvas');
    expect(screen.getByText('Layers')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause turning' })).toBeInTheDocument();
    plan.unmount();
    const mini = render(<Figure3D params={params} size={108} controls={false} decorative caption={false} />);
    await screen.findByTestId('fig3d-canvas');
    expect((canvas.props as Figure3DCanvasProps).interactive).toBe(false);
    expect((canvas.props as Figure3DCanvasProps).autoRotate).toBe(false);
    expect(mini.container.querySelector('figure')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByText('Layers')).toBeNull();
    expect(screen.queryByRole('button', { name: /turning/ })).toBeNull();
  });

  describe('view controls', () => {
    const viewBar = (c: HTMLElement) => c.querySelector('.lm-fig3d__viewbar') as HTMLElement;
    const names = (bar: HTMLElement) => Array.from(bar.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'));

    it('puts zoom in, zoom out, reset view and play/pause in one column on the stage, icon only', async () => {
      withWebGL2(true);
      const { container } = render(<Figure3D params={params} />);
      await screen.findByTestId('fig3d-canvas');
      const bar = viewBar(container);
      expect(bar.closest('.lm-fig3d__stage')).toBeInTheDocument();
      expect(bar).toHaveAttribute('role', 'group');
      expect(bar).toHaveAccessibleName('View controls');
      expect(names(bar)).toEqual(['Zoom in', 'Zoom out', 'Reset view', 'Pause turning']);
      for (const b of Array.from(bar.querySelectorAll('button'))) {
        expect(b).toHaveAttribute('type', 'button');
        expect(b).toHaveTextContent('');
        expect(b.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
        expect(b).toHaveClass('lm-fig3d__vbtn');
      }
      expect((canvas.props as Figure3DCanvasProps).viewControls).toBe(true);
    });

    it('drives the canvas: zoom in, zoom out, reset', async () => {
      withWebGL2(true);
      render(<Figure3D params={params} />);
      await screen.findByTestId('fig3d-canvas');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Zoom in' })).not.toHaveAttribute('aria-disabled'));
      // nothing to reset yet: dimmed, still focusable, and a press does nothing
      const reset = screen.getByRole('button', { name: 'Reset view' });
      expect(reset).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(reset);
      expect(canvas.api.reset).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
      expect(canvas.api.zoomIn).toHaveBeenCalledTimes(1);
      expect(canvas.api.zoomOut).toHaveBeenCalledTimes(1);
      act(() => (canvas.props as Figure3DCanvasProps).onViewState?.({ canZoomIn: true, canZoomOut: true, canReset: true }));
      expect(reset).not.toHaveAttribute('aria-disabled');
      fireEvent.click(reset);
      expect(canvas.api.reset).toHaveBeenCalledTimes(1);
    });

    it('dims a zoom button at its limit and ignores presses there, keeping focus on it', async () => {
      withWebGL2(true);
      render(<Figure3D params={params} />);
      await screen.findByTestId('fig3d-canvas');
      const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
      zoomIn.focus();
      act(() => (canvas.props as Figure3DCanvasProps).onViewState?.({ canZoomIn: false, canZoomOut: true, canReset: true }));
      expect(zoomIn).toHaveAttribute('aria-disabled', 'true');
      expect(zoomIn).not.toBeDisabled();
      expect(document.activeElement).toBe(zoomIn);
      fireEvent.click(zoomIn);
      expect(canvas.api.zoomIn).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Zoom out' })).not.toHaveAttribute('aria-disabled');
    });

    it('pauses the auto-turn when the person turns the figure by hand; play resumes it', async () => {
      withWebGL2(true);
      render(<Figure3D params={params} />);
      await screen.findByTestId('fig3d-canvas');
      expect((canvas.props as Figure3DCanvasProps).autoRotate).toBe(true);
      act(() => (canvas.props as Figure3DCanvasProps).onUserTurn?.());
      expect((canvas.props as Figure3DCanvasProps).autoRotate).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Resume turning' }));
      expect((canvas.props as Figure3DCanvasProps).autoRotate).toBe(true);
      expect(screen.getByRole('button', { name: 'Pause turning' })).toBeInTheDocument();
    });

    it('keeps the view buttons and gestures with reduced motion (only turning and play go)', async () => {
      withWebGL2(true);
      document.documentElement.setAttribute('data-motion', 'reduce');
      try {
        const { container } = render(<Figure3D params={params} />);
        await screen.findByTestId('fig3d-canvas');
        expect(names(viewBar(container))).toEqual(['Zoom in', 'Zoom out', 'Reset view']);
        expect((canvas.props as Figure3DCanvasProps).viewControls).toBe(true);
        expect((canvas.props as Figure3DCanvasProps).autoRotate).toBe(false);
      } finally {
        document.documentElement.removeAttribute('data-motion');
      }
    });

    it('gives small plan figures and decorative thumbnails no view controls and no view gestures', async () => {
      withWebGL2(true);
      const plan = render(<Figure3D params={params} size="sm" caption={false} />);
      await screen.findByTestId('fig3d-canvas');
      expect(names(viewBar(plan.container))).toEqual(['Pause turning']);
      expect((canvas.props as Figure3DCanvasProps).viewControls).toBe(false);
      plan.unmount();
      const mini = render(<Figure3D params={params} size={108} controls={false} decorative caption={false} />);
      await screen.findByTestId('fig3d-canvas');
      expect(viewBar(mini.container)).toBeNull();
      expect((canvas.props as Figure3DCanvasProps).viewControls).toBe(false);
      mini.unmount();
      const xs = render(<Figure3D params={params} size="xs" caption={false} />);
      await screen.findByTestId('fig3d-canvas');
      expect(viewBar(xs.container)).toBeNull();
      expect((canvas.props as Figure3DCanvasProps).viewControls).toBe(false);
    });

    it('has no view controls on the vector fallback', () => {
      const { container } = render(<Figure3D params={params} />);
      expect(viewBar(container)).toBeNull();
    });
  });

  describe('first-time mouse hint', () => {
    const finePointer = (fine: boolean) =>
      vi.stubGlobal('matchMedia', (q: string) => ({
        matches: fine && q.includes('pointer: fine'),
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
      }));

    it('shows one line the first time on a desktop pointer, fades away, and never comes back', async () => {
      withWebGL2(true);
      finePointer(true);
      const timers = vi.spyOn(window, 'setTimeout');
      const first = render(<Figure3D params={params} />);
      expect(await screen.findByText(VIEW_HINT)).toBeInTheDocument();
      expect(VIEW_HINT).toBe('Drag to turn · right-drag to move · scroll to zoom');
      expect(screen.getByText(VIEW_HINT)).toHaveAttribute('aria-hidden', 'true');
      expect(localStorage.getItem('vitals-figure-view-hint')).toBe('1');
      // it removes itself once its fade is done
      const fade = timers.mock.calls.find(([, ms]) => ms === 5200);
      expect(fade).toBeDefined();
      act(() => (fade![0] as () => void)());
      expect(screen.queryByText(VIEW_HINT)).toBeNull();
      first.unmount();
      render(<Figure3D params={params} />);
      await screen.findAllByTestId('fig3d-canvas');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument());
      expect(screen.queryByText(VIEW_HINT)).toBeNull();
    });

    it('is not shown on touch devices, thumbnails or the vector fallback', async () => {
      withWebGL2(true);
      finePointer(false);
      const touch = render(<Figure3D params={params} />);
      await screen.findByTestId('fig3d-canvas');
      expect(screen.queryByText(VIEW_HINT)).toBeNull();
      touch.unmount();
      finePointer(true);
      const small = render(<Figure3D params={params} size="sm" caption={false} />);
      await screen.findByTestId('fig3d-canvas');
      expect(screen.queryByText(VIEW_HINT)).toBeNull();
      small.unmount();
      expect(localStorage.getItem('vitals-figure-view-hint')).toBeNull();
    });

    it('survives blocked storage: shown once per page load, no error', async () => {
      withWebGL2(true);
      finePointer(true);
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      const first = render(<Figure3D params={params} />);
      expect(await screen.findByText(VIEW_HINT)).toBeInTheDocument();
      first.unmount();
      render(<Figure3D params={params} />);
      await screen.findAllByTestId('fig3d-canvas');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument());
      expect(screen.queryByText(VIEW_HINT)).toBeNull();
    });
  });

  it('falls back if the asset fails or the context is lost', async () => {
    withWebGL2(true);
    canvas.mode = 'fail';
    const onFallback = vi.fn();
    const { container, unmount } = render(<Figure3D params={params} onFallback={onFallback} />);
    await waitFor(() => expect(onFallback).toHaveBeenCalledWith('figure asset: 404'));
    expect(root(container)).toHaveAttribute('data-renderer', 'svg');
    expect(container.querySelector('.lm-avatar')).toBeInTheDocument();
    unmount();
    canvas.mode = 'lose';
    const again = render(<Figure3D params={params} onFallback={onFallback} />);
    await waitFor(() => expect(onFallback).toHaveBeenCalledWith('WebGL context lost'));
    expect(root(again.container)).toHaveAttribute('data-renderer', 'svg');
  });

  it('honours explicit vector mode and the persistent slow-device fallback', async () => {
    withWebGL2(true);
    const forced = render(<Figure3D params={params} forceSvg />);
    expect(root(forced.container)).toHaveAttribute('data-renderer', 'svg');
    forced.unmount();
    canvas.mode = 'slow';
    const onFallback = vi.fn();
    const slow = render(<Figure3D params={params} onFallback={onFallback} />);
    await waitFor(() => expect(onFallback).toHaveBeenCalledWith('slow device'));
    slow.unmount();
    canvas.mode = 'ready';
    let again: HTMLElement | null = null;
    act(() => {
      again = render(<Figure3D params={params} />).container;
    });
    expect(root(again!)).toHaveAttribute('data-renderer', 'svg');
  });
});
