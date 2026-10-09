// The canvas's input handling, with the asset, scene and renderer replaced by stand-ins that record each frame: what a
// drag, pinch, wheel or key does to the camera the renderer is given.
import { act, createEvent, fireEvent, render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { liveEstimate, stateToAvatarParams } from '@/engine/body';
import { KEY_TURN, PITCH_LIMIT, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, panLimits, type ViewCamera } from '../camera';
import type { FigureFrame } from '../renderer';
import type { FigureViewControl, FigureViewState } from '../Figure3DCanvas';

const rig = vi.hoisted(() => ({ frames: [] as unknown[] }));

vi.mock('../asset', () => ({ loadFigure: () => Promise.resolve({}) }));
vi.mock('../scene', () => {
  const state = { frame: 0, muscle: 0, weight: 0.5, locals: {} };
  class FigureScene {
    model = { indices: new Uint16Array(3), vertexCount: 1 };
    fit() {
      return { state };
    }
    place() {
      return {
        positions: new Float32Array(3),
        centre: { front: 0, side: 0 },
        half: { front: 20, side: 12 },
        heightCm: 170,
      };
    }
  }
  return { FigureScene, coreState: (s: unknown) => s, lerpState: (a: unknown) => a };
});
vi.mock('../renderer', () => ({
  FigureRenderer: class {
    lost = false;
    draw(f: unknown) {
      rig.frames.push({ ...(f as object) });
    }
    setAnatomy() {}
    dispose() {}
  },
  readColours: () => ({}),
}));

import Figure3DCanvas from '../Figure3DCanvas';

const params = stateToAvatarParams(liveEstimate({ sex: 'female', ageYears: 40, heightCm: 170, weightKg: 70 }));
const frames = () => rig.frames as FigureFrame[];
const last = () => frames().at(-1)!;
const cam = (): ViewCamera => last().camera!;

class RO {
  observe() {}
  disconnect() {}
}

async function setup(extra: Partial<Parameters<typeof Figure3DCanvas>[0]> = {}) {
  const handle = createRef<FigureViewControl>();
  const onUserTurn = vi.fn();
  const states: FigureViewState[] = [];
  const view = render(
    <Figure3DCanvas
      params={params}
      frame={0}
      views={['front']}
      layers="envelope"
      reducedMotion
      autoRotate={false}
      interactive
      viewControls
      controlRef={handle}
      onUserTurn={onUserTurn}
      onViewState={(s) => states.push(s)}
      onFail={(r) => {
        throw new Error(r);
      }}
      {...extra}
    />,
  );
  const el = view.container.querySelector('canvas') as HTMLCanvasElement;
  await waitFor(() => expect(frames().length).toBeGreaterThan(0));
  // a 400 x 500 canvas at the page's origin
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 500, right: 400, bottom: 500, x: 0, y: 0, toJSON: () => ({}) });
  return { el, handle, onUserTurn, states, ...view };
}

const pointer = (type: string, el: Element, init: Record<string, unknown>) => {
  const ev = createEvent[type as 'pointerDown'](el, { pointerType: 'mouse', button: 0, ...init });
  // jsdom may lack PointerEvent: carry the fields the handlers read
  for (const k of ['pointerId', 'pointerType', 'button', 'clientX', 'clientY', 'shiftKey'] as const) {
    if (init[k] !== undefined && (ev as unknown as Record<string, unknown>)[k] !== init[k])
      Object.defineProperty(ev, k, { value: init[k] });
  }
  if ((ev as unknown as Record<string, unknown>).pointerType === undefined)
    Object.defineProperty(ev, 'pointerType', { value: 'mouse' });
  fireEvent(el, ev);
};

beforeEach(() => {
  rig.frames.length = 0;
  vi.stubGlobal('ResizeObserver', RO);
});
afterEach(() => vi.unstubAllGlobals());

describe('<Figure3DCanvas> input', () => {
  it('starts on the default camera and reports that there is nothing to reset', async () => {
    const { states } = await setup();
    expect(cam()).toEqual({ pitch: 0, zoom: 1, panX: 0, panY: 0 });
    expect(last().angleRad).toBe(0);
    expect(states.at(-1)).toEqual({ canZoomIn: true, canZoomOut: true, canReset: false });
  });

  it('left-drag turns about the vertical axis, tilts a little (clamped) and pauses the auto-turn', async () => {
    const { el, onUserTurn } = await setup();
    pointer('pointerDown', el, { pointerId: 1, clientX: 200, clientY: 250 });
    pointer('pointerMove', el, { pointerId: 1, clientX: 250, clientY: 250 });
    expect(last().angleRad).toBeCloseTo(50 * 0.012, 10);
    expect(cam().pitch).toBe(0);
    pointer('pointerMove', el, { pointerId: 1, clientX: 250, clientY: 300 });
    expect(cam().pitch).toBeCloseTo(50 * 0.006, 10);
    expect(onUserTurn).toHaveBeenCalled();
    pointer('pointerMove', el, { pointerId: 1, clientX: 250, clientY: 2000 });
    expect(cam().pitch).toBe(PITCH_LIMIT);
    pointer('pointerMove', el, { pointerId: 1, clientX: 250, clientY: -5000 });
    expect(cam().pitch).toBe(-PITCH_LIMIT);
    pointer('pointerUp', el, { pointerId: 1 });
    pointer('pointerMove', el, { pointerId: 1, clientX: 100, clientY: 100 });
    expect(cam().pitch).toBe(-PITCH_LIMIT);
  });

  it('right-drag, middle-drag and shift + left-drag pan; they do not turn or tilt', async () => {
    const { el, handle, onUserTurn } = await setup();
    act(() => handle.current!.zoomIn());
    act(() => handle.current!.zoomIn());
    await waitFor(() => expect(cam().zoom).toBeCloseTo(ZOOM_STEP ** 2, 5)); // reduced motion: instant
    const a0 = last().angleRad;
    let pan = [cam().panX, cam().panY];
    for (const init of [{ button: 2 }, { button: 1 }, { button: 0, shiftKey: true }]) {
      pointer('pointerDown', el, { pointerId: 5, clientX: 200, clientY: 250, ...init });
      pointer('pointerMove', el, { pointerId: 5, clientX: 220, clientY: 235 });
      pointer('pointerUp', el, { pointerId: 5 });
      // 20 px right of 400 = +0.1 clip, 15 px up of 500 = +0.06 clip
      expect(cam().panX).toBeCloseTo(pan[0]! + 0.1, 6);
      expect(cam().panY).toBeCloseTo(pan[1]! + 0.06, 6);
      pan = [cam().panX, cam().panY];
    }
    expect(last().angleRad).toBe(a0);
    expect(cam().pitch).toBe(0);
    expect(onUserTurn).not.toHaveBeenCalled();
  });

  it('keeps a pan inside the limits so the body never leaves the frame', async () => {
    const { el, handle } = await setup();
    act(() => handle.current!.zoomIn());
    pointer('pointerDown', el, { pointerId: 1, clientX: 0, clientY: 0, button: 2 });
    pointer('pointerMove', el, { pointerId: 1, clientX: 4000, clientY: -4000 });
    const z = cam().zoom;
    expect(cam().panX).toBeCloseTo(0.35 + 0.5 * (z - 1), 6);
    expect(cam().panY).toBeCloseTo(panLimits(z).yMax, 6);
    pointer('pointerMove', el, { pointerId: 1, clientX: -4000, clientY: 4000 });
    expect(cam().panX).toBeCloseTo(-(0.35 + 0.5 * (z - 1)), 6);
  });

  it('suppresses the context menu on the canvas only when the view controls are on', async () => {
    const { el } = await setup();
    expect(fireEvent.contextMenu(el)).toBe(false);
    expect(fireEvent.contextMenu(document.body)).toBe(true);
    const thumb = await setup({ viewControls: false });
    expect(fireEvent.contextMenu(thumb.el)).toBe(true);
  });

  it('two-finger pinch zooms (clamped) and drags the picture', async () => {
    const { el } = await setup();
    pointer('pointerDown', el, { pointerId: 1, clientX: 150, clientY: 250, pointerType: 'touch' });
    pointer('pointerDown', el, { pointerId: 2, clientX: 250, clientY: 250, pointerType: 'touch' });
    pointer('pointerMove', el, { pointerId: 2, clientX: 300, clientY: 250, pointerType: 'touch' });
    expect(cam().zoom).toBeCloseTo(1.5, 6); // the gap went from 100 to 150
    pointer('pointerMove', el, { pointerId: 2, clientX: 4000, clientY: 250, pointerType: 'touch' });
    expect(cam().zoom).toBe(ZOOM_MAX);
    // both fingers drag down together: the picture follows (clip y goes down)
    const y0 = cam().panY;
    pointer('pointerMove', el, { pointerId: 1, clientX: 150, clientY: 290, pointerType: 'touch' });
    pointer('pointerMove', el, { pointerId: 2, clientX: 4000, clientY: 290, pointerType: 'touch' });
    expect(cam().panY).toBeLessThan(y0);
    // pinching in shrinks it, never below the minimum
    pointer('pointerMove', el, { pointerId: 2, clientX: 170, clientY: 290, pointerType: 'touch' });
    expect(cam().zoom).toBe(ZOOM_MIN);
    pointer('pointerUp', el, { pointerId: 1, pointerType: 'touch' });
    pointer('pointerUp', el, { pointerId: 2, pointerType: 'touch' });
  });

  it('one finger turns and tilts like a left-drag', async () => {
    const { el, onUserTurn } = await setup();
    pointer('pointerDown', el, { pointerId: 3, clientX: 100, clientY: 100, pointerType: 'touch' });
    pointer('pointerMove', el, { pointerId: 3, clientX: 140, clientY: 140, pointerType: 'touch' });
    expect(last().angleRad).toBeCloseTo(40 * 0.012, 10);
    expect(cam().pitch).toBeCloseTo(40 * 0.006, 10);
    expect(onUserTurn).toHaveBeenCalled();
  });

  it('wheel and ctrl-wheel (trackpad pinch) zoom toward the pointer and stop the page scrolling', async () => {
    const { el } = await setup();
    const wheel = (init: WheelEventInit) => {
      const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
      act(() => {
        el.dispatchEvent(ev);
      });
      return ev;
    };
    const plain = wheel({ deltaY: -100, clientX: 300, clientY: 100 });
    expect(plain.defaultPrevented).toBe(true);
    expect(cam().zoom).toBeGreaterThan(1.1);
    // toward the pointer (upper right): the point under it stays put, so the picture shifts down and left of centre
    expect(cam().panX).toBeLessThan(0);
    expect(cam().panY).toBeLessThan(0);
    const z = cam().zoom;
    const pinch = wheel({ deltaY: 5, ctrlKey: true, clientX: 200, clientY: 250 });
    expect(pinch.defaultPrevented).toBe(true);
    expect(cam().zoom).toBeLessThan(z);
    for (let i = 0; i < 40; i++) wheel({ deltaY: -400 });
    expect(cam().zoom).toBe(ZOOM_MAX);
    for (let i = 0; i < 80; i++) wheel({ deltaY: 400 });
    expect(cam().zoom).toBe(ZOOM_MIN);
  });

  it('leaves a page scroll that is already under way alone', async () => {
    const { el } = await setup();
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(cam().zoom).toBe(1);
  });

  it('does not touch the wheel without the view controls', async () => {
    const { el } = await setup({ viewControls: false });
    const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(cam().zoom).toBe(1);
  });

  it('keys: arrows turn and tilt, +/- zoom, shift + arrows move the picture', async () => {
    const { el, onUserTurn } = await setup();
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    expect(last().angleRad).toBeCloseTo(KEY_TURN, 10);
    fireEvent.keyDown(el, { key: 'ArrowLeft' });
    expect(last().angleRad).toBeCloseTo(0, 10);
    expect(onUserTurn).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    expect(cam().pitch).toBeGreaterThan(0);
    fireEvent.keyDown(el, { key: 'ArrowUp' });
    fireEvent.keyDown(el, { key: 'ArrowUp' });
    expect(cam().pitch).toBeLessThan(0);
    fireEvent.keyDown(el, { key: '+' });
    expect(cam().zoom).toBeCloseTo(ZOOM_STEP, 6);
    fireEvent.keyDown(el, { key: '-' });
    expect(cam().zoom).toBeCloseTo(1, 6);
    fireEvent.keyDown(el, { key: '+' });
    fireEvent.keyDown(el, { key: 'ArrowRight', shiftKey: true });
    expect(cam().panX).toBeGreaterThan(0);
    expect(last().angleRad).toBeCloseTo(0, 10); // shift + arrow moved the picture, it did not turn it
    // browser zoom shortcuts are left to the browser
    const ev = createEvent.keyDown(el, { key: '+', ctrlKey: true });
    fireEvent(el, ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('without the view controls only the plain turn is left (thumbnails)', async () => {
    const { el } = await setup({ viewControls: false });
    pointer('pointerDown', el, { pointerId: 1, clientX: 100, clientY: 100 });
    pointer('pointerMove', el, { pointerId: 1, clientX: 150, clientY: 400 });
    expect(last().angleRad).toBeCloseTo(50 * 0.012, 10);
    expect(cam().pitch).toBe(0);
    pointer('pointerUp', el, { pointerId: 1 });
    fireEvent.keyDown(el, { key: '+' });
    fireEvent.keyDown(el, { key: 'ArrowUp' });
    expect(cam()).toEqual({ pitch: 0, zoom: 1, panX: 0, panY: 0 });
    // a right-drag does nothing at all there
    pointer('pointerDown', el, { pointerId: 2, clientX: 100, clientY: 100, button: 2 });
    pointer('pointerMove', el, { pointerId: 2, clientX: 150, clientY: 150 });
    expect(last().angleRad).toBeCloseTo(50 * 0.012, 10);
  });

  it('a decorative figure ignores every gesture and key', async () => {
    const { el, onUserTurn } = await setup({ interactive: false });
    pointer('pointerDown', el, { pointerId: 1, clientX: 100, clientY: 100 });
    pointer('pointerMove', el, { pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    fireEvent.keyDown(el, { key: '+' });
    expect(last().angleRad).toBe(0);
    expect(cam().zoom).toBe(1);
    expect(onUserTurn).not.toHaveBeenCalled();
  });

  it('reset view returns the default camera, facing front by the shortest way', async () => {
    const { el, handle, states } = await setup();
    pointer('pointerDown', el, { pointerId: 1, clientX: 0, clientY: 0 });
    pointer('pointerMove', el, { pointerId: 1, clientX: 600, clientY: 100 }); // a bit over one turn
    pointer('pointerUp', el, { pointerId: 1 });
    act(() => handle.current!.zoomIn());
    expect(states.at(-1)?.canReset).toBe(true);
    act(() => handle.current!.reset());
    await waitFor(() => expect(cam()).toEqual({ pitch: 0, zoom: 1, panX: 0, panY: 0 }));
    expect(last().angleRad).toBe(0);
    expect(states.at(-1)).toEqual({ canZoomIn: true, canZoomOut: true, canReset: false });
  });

  it('the zoom buttons stop at the limits and say so', async () => {
    const { handle, states } = await setup();
    for (let i = 0; i < 12; i++) act(() => handle.current!.zoomIn());
    expect(cam().zoom).toBe(ZOOM_MAX);
    expect(states.at(-1)?.canZoomIn).toBe(false);
    for (let i = 0; i < 30; i++) act(() => handle.current!.zoomOut());
    expect(cam().zoom).toBe(ZOOM_MIN);
    expect(states.at(-1)?.canZoomOut).toBe(false);
    expect(states.at(-1)?.canZoomIn).toBe(true);
  });

  it('the canvas names its controls', async () => {
    const { el } = await setup();
    expect(el).toHaveAttribute('aria-label', expect.stringMatching(/turn.*plus and minus to zoom.*shift and arrow keys to move/));
    expect(el).toHaveAttribute('tabindex', '0');
  });
});
