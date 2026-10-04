import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { liveEstimate, stateToAvatarParams } from '@/engine/body';
import { Figure3D } from '../Figure3D';
import type { Figure3DCanvasProps } from '../Figure3DCanvas';

const canvas = vi.hoisted(() => ({
  mode: 'ready' as 'ready' | 'fail' | 'lose' | 'slow',
  props: null as unknown,
}));
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
afterEach(() => {
  withWebGL2(false);
  canvas.mode = 'ready';
  canvas.props = null;
});

describe('<Figure3D>', () => {
  it('uses the vector figure when WebGL2 is unavailable', () => {
    const { container } = render(<Figure3D params={params} />);
    expect(root(container)).toHaveAttribute('data-renderer', 'svg');
    expect(container.querySelector('.lm-avatar')).toBeInTheDocument();
    expect(container.querySelector('.lm-fig3d__layer')).toBeNull();
    expect(screen.getByRole('img', { name: /^Figure, 165 cm/ })).toBeInTheDocument();
  });

  it('keeps the vector visible during loading, then presents one rotating 3D figure', async () => {
    withWebGL2(true);
    const { container } = render(<Figure3D params={params} size="fill" compareTo={start} />);
    expect(container.querySelector('.lm-avatar')).toBeInTheDocument();
    expect(await screen.findByTestId('fig3d-canvas')).toBeInTheDocument();
    await waitFor(() => expect(root(container)).toHaveAttribute('data-renderer', 'webgl'));
    expect(container.querySelector('.lm-avatar')).toBeNull();
    const p = canvas.props as Figure3DCanvasProps;
    expect(p.views).toEqual(['front']);
    expect(p.layout).toBeNull();
    expect(p.compareTo).toBe(start);
    expect(p.autoRotate).toBe(true);
    expect(p.anatomyLayers).toEqual({
      skin: true,
      subcutaneousFat: true,
      visceralFat: true,
      muscles: true,
      skeleton: true,
    });
  });

  it('lets the person choose layers and pause turning', async () => {
    withWebGL2(true);
    render(<Figure3D params={params} />);
    await screen.findByTestId('fig3d-canvas');
    fireEvent.click(screen.getByText('Layers'));
    fireEvent.click(screen.getByRole('button', { name: 'Fat around organs (estimate)' }));
    expect((canvas.props as Figure3DCanvasProps).anatomyLayers?.visceralFat).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Pause turning' }));
    expect((canvas.props as Figure3DCanvasProps).autoRotate).toBe(false);
    expect(screen.getByRole('button', { name: 'Resume turning' })).toBeInTheDocument();
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
