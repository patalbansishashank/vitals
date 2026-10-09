import { act, fireEvent, render } from '@testing-library/react';
import { liveEstimate, stateToAvatarParams } from '@/engine/body';
import type { AvatarParams } from '@/engine/body';
import type { AnatomyInput, AnatomyReply } from '../anatomyPlacement';
import type { Figure3DCanvasProps } from '../Figure3DCanvas';

interface Drawn {
  views: string;
  skin: number;
  core: number | null;
  atlas: number | null;
  colour: number;
  skinVisible: boolean;
  fatVisible: boolean;
  muscles: boolean;
  skeleton: boolean;
}

interface Request {
  input: AnatomyInput;
  done: (reply: AnatomyReply & { positions: Float32Array }) => void;
}

const rig = vi.hoisted(() => ({
  frames: [] as Drawn[],
  requests: [] as Request[],
  fitWarm: [] as boolean[],
  clients: 0,
  cancels: 0,
  colourReads: 0,
}));

vi.mock('../asset', () => ({ loadFigure: () => Promise.resolve({}) }));
vi.mock('../anatomyAsset', () => ({ loadAnatomy: () => Promise.resolve({}) }));
vi.mock('../scene', () => ({
  FigureScene: class {
    model = {
      indices: new Uint16Array(3),
      vertexCount: 1,
      base: new Float32Array(3),
      asset: { thickness: {} },
      manifest: { stats: { referenceHeightCm: 170 }, shell: {} },
    };
    fit(params: AvatarParams, frame: number, warm?: unknown) {
      rig.fitWarm.push(!!warm);
      return { state: { frame, muscle: 0, weight: params.figure.sliders.chest, locals: {} } };
    }
    place(state: { frame: number; weight: number }, heightCm: number, out?: Float32Array) {
      const positions = out ?? new Float32Array(3);
      positions.set([state.weight, heightCm, state.frame]);
      return {
        positions,
        centre: { front: 0, side: 0 },
        half: { front: 20, side: 12 },
        heightCm,
        armSpacing: {},
      };
    }
  },
  coreState: (s: { frame: number; weight: number }) => ({ ...s, weight: 0 }),
  lerpState: (_a: unknown, b: unknown) => b,
}));
vi.mock('../subcutaneousShell', () => ({
  partitionSubcutaneousShell: () => {},
  insetSubcutaneousShell: () => {},
}));
vi.mock('../fatClearance', () => ({ clampFatToAnatomy: () => {} }));
vi.mock('../anatomyClient', () => ({
  AnatomyClient: class {
    constructor() {
      rig.clients++;
    }
    place(input: AnatomyInput, done: Request['done']) {
      rig.requests.push({ input, done });
    }
    cancel() {
      rig.cancels++;
    }
    dispose() {}
  },
}));
vi.mock('../renderer', () => ({
  FigureRenderer: class {
    lost = false;
    draw(frame: {
      views: readonly string[];
      positions: Float32Array;
      core: Float32Array | null;
      colours: { body: [number, number, number] };
      anatomy?: {
        positions?: Float32Array;
        layers: { skin: boolean; subcutaneousFat: boolean; muscles: boolean; skeleton: boolean };
      };
    }) {
      const a = frame.anatomy;
      rig.frames.push({
        views: frame.views.join('|'),
        skin: frame.positions[0]!,
        core: frame.core?.[0] ?? null,
        atlas: a?.positions?.[0] ?? null,
        colour: frame.colours.body[0],
        skinVisible: a?.layers.skin ?? true,
        fatVisible: a?.layers.subcutaneousFat ?? false,
        muscles: a?.layers.muscles ?? false,
        skeleton: a?.layers.skeleton ?? false,
      });
    }
    setAnatomy() {}
    dispose() {}
  },
  readColours: () => {
    const n = ++rig.colourReads;
    return { body: [n, 0, 0], core: [0, 0, 0], outline: [0, 0, 0], ghost: [0, 0, 0] };
  },
}));

import Figure3DCanvas from '../Figure3DCanvas';

class RO {
  observe() {}
  disconnect() {}
}

const estimate = stateToAvatarParams(
  liveEstimate({ sex: 'female', ageYears: 40, heightCm: 170, weightKg: 70 }),
);
const base: AvatarParams = {
  ...estimate,
  figure: { ...estimate.figure, sliders: { ...estimate.figure.sliders, chest: 0.5 } },
};
const shape = (chestPercent: number): AvatarParams => ({
  ...base,
  figure: { ...base.figure, sliders: { ...base.figure.sliders, chest: chestPercent / 100 } },
});
const layers = { skin: true, subcutaneousFat: true, muscles: true, skeleton: true };
const last = () => rig.frames.at(-1)!;
const tick = (ms = 80) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const complete = (request: Request) =>
  act(() => {
    request.done({
      id: 1,
      skin: request.input.skin,
      positions: new Float32Array([request.input.skin[0]! * 100, 0, 0]),
    });
  });
const requestFor = (chestPercent: number) =>
  rig.requests.findLast((r) => r.input.skin[0] === chestPercent / 100);

function view(
  params: AvatarParams,
  anatomyLayers: Figure3DCanvasProps['anatomyLayers'] = layers,
  views: Figure3DCanvasProps['views'] = ['front'],
) {
  return (
    <>
      <input type="range" aria-label="Body shape" min="0" max="100" />
      <Figure3DCanvas
        params={params}
        frame={0}
        views={views}
        layers="envelope"
        anatomyLayers={anatomyLayers}
        reducedMotion
        autoRotate={false}
        onFail={(reason) => {
          throw new Error(reason);
        }}
      />
    </>
  );
}

async function setup(anatomyLayers: Figure3DCanvasProps['anatomyLayers'] = layers, expectFrame = true) {
  let mounted!: ReturnType<typeof render>;
  await act(async () => {
    mounted = render(view(base, anatomyLayers));
  });
  if (expectFrame) expect(rig.frames.length).toBeGreaterThan(0);
  const slider = mounted.getByRole('slider');
  const canvas = mounted.container.querySelector('canvas')!;
  return { ...mounted, slider, canvas };
}

beforeEach(() => {
  rig.frames.length = 0;
  rig.requests.length = 0;
  rig.fitWarm.length = 0;
  rig.clients = 0;
  rig.cancels = 0;
  rig.colourReads = 0;
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', RO);
});
afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('<Figure3DCanvas> shape scheduling', () => {
  it('cancels a queued newer fit when input returns to the already displayed value', async () => {
    const mounted = await setup({ ...layers, muscles: false, skeleton: false });
    mounted.rerender(view(shape(75), { ...layers, muscles: false, skeleton: false }));
    mounted.rerender(view(base, { ...layers, muscles: false, skeleton: false }));
    tick();
    expect(last().skin).toBe(0.5);
  });
  it('fits and places the mount input once, and reads colours only again when the theme changes', async () => {
    const mounted = await setup();
    expect(rig.fitWarm).toHaveLength(1);
    expect(rig.requests).toHaveLength(1);
    expect(rig.colourReads).toBe(1);
    tick(200);
    mounted.rerender(view(base));
    tick(200);
    expect(rig.fitWarm).toHaveLength(1);
    expect(rig.requests).toHaveLength(1);

    mounted.rerender(view(shape(75)));
    tick();
    mounted.rerender(view(shape(100)));
    tick();
    expect(last().skin).toBe(1);
    expect(rig.colourReads).toBe(1);
    expect(last().colour).toBe(1);

    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'test-theme');
      await Promise.resolve();
    });
    tick();
    expect(rig.colourReads).toBe(2);
    expect(last().colour).toBe(2);
  });

  it('shows current skin and fat while waiting, and only reveals anatomy for the matching settled shape', async () => {
    const mounted = await setup();
    tick();
    complete(rig.requests.at(-1)!);
    expect(last().muscles).toBe(true);

    fireEvent.pointerDown(mounted.slider);
    expect(last().muscles).toBe(false);
    mounted.rerender(view(shape(75)));
    tick();
    const older = requestFor(75)!;
    expect(older).toBeDefined();
    expect(last()).toMatchObject({
      skin: 0.75,
      core: 0,
      skinVisible: true,
      fatVisible: true,
      muscles: false,
      skeleton: false,
    });

    mounted.rerender(view(shape(100)));
    tick();
    const newer = requestFor(100)!;
    expect(newer).toBeDefined();
    expect(last()).toMatchObject({ skin: 1, core: 0, muscles: false, skeleton: false });
    complete(older);
    expect(last()).toMatchObject({ skin: 1, muscles: false, skeleton: false });
    complete(newer);
    expect(last()).toMatchObject({ skin: 1, muscles: false, skeleton: false });

    fireEvent.pointerUp(window);
    tick();
    const final = rig.requests.at(-1)!;
    expect(final.input.skin[0]).toBe(1);
    expect(last().muscles).toBe(false);
    complete(final);
    expect(last()).toMatchObject({ skin: 1, core: 0, atlas: 100, muscles: true, skeleton: true });
    expect(mounted.canvas.dataset.anatomyPending).toBe('false');
    expect(rig.fitWarm.at(-1)).toBe(false);
    for (const frame of rig.frames) {
      if (frame.muscles || frame.skeleton) expect(frame.atlas).toBe(frame.skin * 100);
    }
  });

  it('recovers a drag whose pointerup was lost on window blur', async () => {
    const mounted = await setup();
    tick();
    complete(rig.requests.at(-1)!);
    fireEvent.pointerDown(mounted.slider);
    expect(last().muscles).toBe(false);
    fireEvent.blur(window);
    tick();
    complete(rig.requests.at(-1)!);
    expect(last()).toMatchObject({ skin: 0.5, atlas: 50, muscles: true, skeleton: true });
    expect(rig.fitWarm.at(-1)).toBe(false);
  });

  it('skips the worker when both internal anatomy layers are off', async () => {
    const mounted = await setup({ ...layers, muscles: false, skeleton: false });
    tick();
    expect(rig.clients).toBe(0);
    expect(rig.requests).toHaveLength(0);
    expect(last()).toMatchObject({ skin: 0.5, core: 0, fatVisible: true, muscles: false, skeleton: false });
    mounted.rerender(view(shape(75), { ...layers, muscles: false, skeleton: false }));
    tick();
    expect(last().skin).toBe(0.75);
    expect(rig.requests).toHaveLength(0);
  });

  it('keeps the previous atlas visible and shows every matching completion in atlas-only mode', async () => {
    const atlasOnly = { ...layers, skin: false, subcutaneousFat: false };
    const mounted = await setup(atlasOnly, false);
    expect(rig.frames).toHaveLength(0);
    complete(rig.requests.at(-1)!);
    expect(last()).toMatchObject({ skin: 0.5, atlas: 50, muscles: true, skeleton: true });

    fireEvent.pointerDown(mounted.slider);
    expect(last().muscles).toBe(true);
    mounted.rerender(view(shape(75), atlasOnly));
    tick();
    const older = requestFor(75)!;
    expect(older).toBeDefined();
    expect(last()).toMatchObject({ skin: 0.5, atlas: 50, muscles: true });
    mounted.rerender(view(shape(100), atlasOnly));
    tick();
    const newer = requestFor(100)!;
    expect(newer).toBeDefined();
    expect(last()).toMatchObject({ skin: 0.5, atlas: 50, muscles: true });

    complete(older);
    expect(last()).toMatchObject({ skin: 0.75, atlas: 75, muscles: true, skeleton: true });
    complete(newer);
    expect(last()).toMatchObject({ skin: 1, atlas: 100, muscles: true, skeleton: true });
    for (const frame of rig.frames) {
      expect(frame.muscles || frame.skeleton).toBe(true);
      expect(frame.atlas).toBe(frame.skin * 100);
    }
  });

  it('does not redraw an old front atlas after the view switches to side', async () => {
    const atlasOnly = { ...layers, skin: false, subcutaneousFat: false };
    const mounted = await setup(atlasOnly, false);
    complete(rig.requests.at(-1)!);
    expect(last().views).toBe('front');

    mounted.rerender(view(shape(75), atlasOnly, ['front']));
    tick();
    const oldFront = requestFor(75)!;
    expect(oldFront).toBeDefined();
    mounted.rerender(view(shape(100), atlasOnly, ['side']));
    tick();
    const newSide = requestFor(100)!;
    expect(newSide).toBeDefined();

    const beforeOldReply = rig.frames.length;
    complete(oldFront);
    expect(rig.frames).toHaveLength(beforeOldReply);
    complete(newSide);
    expect(last()).toMatchObject({ views: 'side', skin: 1, atlas: 100, muscles: true });
  });
});
