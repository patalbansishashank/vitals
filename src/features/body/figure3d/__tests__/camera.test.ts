import {
  BODY_FLOOR,
  BODY_TOP,
  DEFAULT_VIEW,
  PITCH_LIMIT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  canZoomIn,
  canZoomOut,
  clampView,
  isDefaultView,
  isFacingFront,
  lerpView,
  nearestTurn,
  panLimits,
  panView,
  tiltView,
  viewMatrices,
  zoomView,
  type ViewCamera,
} from '../camera';

const view = (c: Partial<ViewCamera> = {}): ViewCamera => ({ ...DEFAULT_VIEW, ...c });

/** Column-major 4 x 4 times (x, y, z, 1). */
function apply(m: Float32Array, [x, y, z]: [number, number, number]): [number, number, number] {
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ];
}

describe('view camera clamps', () => {
  it('keeps zoom between 0.8x and 3x', () => {
    expect(clampView(view({ zoom: 10 })).zoom).toBe(ZOOM_MAX);
    expect(clampView(view({ zoom: 0.1 })).zoom).toBe(ZOOM_MIN);
    expect([ZOOM_MIN, ZOOM_MAX]).toEqual([0.8, 3]);
    let c = DEFAULT_VIEW as ViewCamera;
    for (let i = 0; i < 20; i++) c = zoomView(c, ZOOM_STEP);
    expect(c.zoom).toBe(ZOOM_MAX);
    for (let i = 0; i < 40; i++) c = zoomView(c, 1 / ZOOM_STEP);
    expect(c.zoom).toBe(ZOOM_MIN);
  });

  it('clamps the tilt to a sensible range either way', () => {
    expect(tiltView(DEFAULT_VIEW, 5).pitch).toBe(PITCH_LIMIT);
    expect(tiltView(DEFAULT_VIEW, -5).pitch).toBe(-PITCH_LIMIT);
    expect(PITCH_LIMIT).toBeGreaterThan(0.2);
    expect(PITCH_LIMIT).toBeLessThan(0.6);
    expect(tiltView(view({ pitch: 0.1 }), 0.05).pitch).toBeCloseTo(0.15, 10);
  });

  it('lets the picture shift more the more it is zoomed, and never snaps back on zoom in', () => {
    let last = panLimits(ZOOM_MIN);
    for (let z = 0.85; z <= ZOOM_MAX + 1e-9; z += 0.05) {
      const lim = panLimits(z);
      expect(lim.x).toBeGreaterThanOrEqual(last.x - 1e-12);
      last = lim;
    }
    // zoomed in a long way, the body can be moved to show its head or its feet
    expect(panLimits(3).yMin).toBeLessThan(-1.5);
    expect(panLimits(3).yMax).toBeGreaterThan(1.5);
  });

  it('frames the whole head, crown to chin, at every zoom', () => {
    // The head is about an eighth of the stature; the canvas draws the crown at BODY_TOP and the soles at BODY_FLOOR.
    const head = (BODY_TOP - BODY_FLOOR) / 7.5;
    for (let z = 1; z <= ZOOM_MAX + 1e-9; z += 0.25) {
      const c = clampView(view({ zoom: z, panY: -50 }));
      const crown = BODY_TOP * c.zoom + c.panY;
      expect(crown).toBeLessThanOrEqual(1 + 1e-9);
      expect(crown - head * c.zoom).toBeGreaterThanOrEqual(-1);
    }
    // at the largest zoom the crown sits well inside the frame, not on its edge
    const top = clampView(view({ zoom: ZOOM_MAX, panY: -50 }));
    expect(BODY_TOP * top.zoom + top.panY).toBeLessThan(0.7);
  });

  it('never lets the body leave the frame: whole inside when it fits, filling the frame from below when zoomed in', () => {
    for (let z = ZOOM_MIN; z <= ZOOM_MAX + 1e-9; z += 0.1) {
      const lim = panLimits(z);
      for (const py of [lim.yMin, lim.yMax]) {
        const c = clampView(view({ zoom: z, panY: py }));
        const bottom = BODY_FLOOR * c.zoom + c.panY;
        const top = BODY_TOP * c.zoom + c.panY;
        const inside = bottom >= -1 - 1e-9 && top <= 1 + 1e-9;
        // zoomed in, the body reaches the frame's bottom edge and at least its middle
        const fills = bottom <= -1 + 1e-9 && top >= 0;
        const covers = bottom <= -1 + 1e-9 && top >= 1 - 1e-9;
        expect(inside || fills || covers).toBe(true);
      }
      // far beyond the limit is pulled back to it, both ways, on both axes
      const far = clampView(view({ zoom: z, panX: 50, panY: -50 }));
      expect(far.panX).toBeCloseTo(lim.x, 10);
      expect(far.panY).toBeCloseTo(lim.yMin, 10);
      expect(clampView(view({ zoom: z, panX: -50, panY: 50 })).panY).toBeCloseTo(lim.yMax, 10);
    }
  });

  it('panView moves by the amount asked, inside the limits', () => {
    const z = view({ zoom: 2 });
    expect(panView(z, 0.1, 0.2)).toMatchObject({ panX: 0.1, panY: 0.2 });
    expect(panView(z, 9, 9)).toMatchObject({ panX: panLimits(2).x, panY: panLimits(2).yMax });
  });

  it('zooms toward a point: the picture under it stays under it', () => {
    const c = view({ zoom: 2, panX: 0.2, panY: 0.3 });
    const [ax, ay] = [0.4, -0.2];
    const z = zoomView(c, 1.2, ax, ay);
    // the picture point under (ax, ay) before: a = (anchor - pan) / zoom; after the zoom it must map back to the anchor
    const under = [(ax - c.panX) / c.zoom, (ay - c.panY) / c.zoom] as const;
    expect(z.zoom).toBeCloseTo(2.4, 10);
    expect(z.zoom * under[0] + z.panX).toBeCloseTo(ax, 10);
    expect(z.zoom * under[1] + z.panY).toBeCloseTo(ay, 10);
  });

  it('zooming back out at the centre recentres the picture', () => {
    const c = zoomView(zoomView(DEFAULT_VIEW, ZOOM_STEP), 1 / ZOOM_STEP);
    expect(c).toEqual(DEFAULT_VIEW);
    expect(Object.is(c.panX, -0)).toBe(false);
  });

  it('reports what the buttons can still do', () => {
    expect(canZoomIn(DEFAULT_VIEW)).toBe(true);
    expect(canZoomOut(DEFAULT_VIEW)).toBe(true);
    expect(canZoomIn(view({ zoom: ZOOM_MAX }))).toBe(false);
    expect(canZoomOut(view({ zoom: ZOOM_MIN }))).toBe(false);
    expect(isDefaultView(DEFAULT_VIEW)).toBe(true);
    expect(isDefaultView(view({ zoom: 1.2 }))).toBe(false);
    expect(isDefaultView(view({ pitch: 0.1 }))).toBe(false);
    expect(isDefaultView(view({ panX: 0.1 }))).toBe(false);
  });

  it('eases between views and finds the front by the shortest way', () => {
    const a = view({ pitch: 0.2, zoom: 2, panX: 0.4, panY: 0.2 });
    expect(lerpView(a, DEFAULT_VIEW, 0)).toEqual(a);
    expect(lerpView(a, DEFAULT_VIEW, 1)).toEqual(DEFAULT_VIEW);
    expect(lerpView(a, DEFAULT_VIEW, 0.5)).toEqual({ pitch: 0.1, zoom: 1.5, panX: 0.2, panY: 0.1 });
    expect(nearestTurn(0.4)).toBe(0);
    expect(nearestTurn(Math.PI * 2 - 0.4)).toBeCloseTo(Math.PI * 2, 10);
    expect(nearestTurn(-Math.PI * 4 - 0.1)).toBeCloseTo(-Math.PI * 4, 10);
    expect(isFacingFront(Math.PI * 4)).toBe(true);
    expect(isFacingFront(0.2)).toBe(false);
  });
});

describe('viewMatrices', () => {
  const base = { sx: 0.01, sy: 0.011, tx: 0.2, ty: -1, cx: 3, pivotY: 90 };

  it('is exactly the plain turn the figure always had with the default camera', () => {
    for (const yaw of [0, 0.7, Math.PI / 2, -2]) {
      const { mvp, rot } = viewMatrices({ ...base, yaw });
      const c = Math.cos(yaw),
        s = Math.sin(yaw);
      const legacyRot = [c, 0, -s, 0, 1, 0, s, 0, c];
      // equal to float32 precision (and a signed zero is a zero)
      const close = (got: Float32Array, want: number[]) =>
        want.forEach((w, i) => expect(Math.abs(got[i]! - w)).toBeLessThan(1e-6 * Math.max(1, Math.abs(w))));
      close(rot, legacyRot);
      const sz = -1 / 200;
      const legacy = [
        base.sx * legacyRot[0]!,
        base.sy * legacyRot[1]!,
        sz * legacyRot[2]!,
        0,
        base.sx * legacyRot[3]!,
        base.sy * legacyRot[4]!,
        sz * legacyRot[5]!,
        0,
        base.sx * legacyRot[6]!,
        base.sy * legacyRot[7]!,
        sz * legacyRot[8]!,
        0,
        base.tx - base.sx * base.cx,
        base.ty,
        0,
        1,
      ];
      close(mvp, legacy);
    }
  });

  it('tilts about the middle of the body: that height stays put, the camera looks down from above', () => {
    const flat = viewMatrices({ ...base, yaw: 0 }).mvp;
    const tilted = viewMatrices({ ...base, yaw: 0, camera: view({ pitch: 0.3 }) }).mvp;
    const mid: [number, number, number] = [3, 90, 0];
    expect(apply(tilted, mid)[1]).toBeCloseTo(apply(flat, mid)[1], 5);
    // a point on the front of the body moves down the picture when the camera looks down from above
    const front: [number, number, number] = [3, 90, 12];
    expect(apply(tilted, front)[1]).toBeLessThan(apply(flat, front)[1]);
    // the head comes toward the viewer (nearer = smaller clip depth, since the depth scale is negative)
    const head: [number, number, number] = [3, 170, 0];
    expect(apply(tilted, head)[2]).toBeLessThan(apply(flat, head)[2]);
  });

  it('zooms about the middle of the canvas and pans in clip units', () => {
    const plain = viewMatrices({ ...base, yaw: 0 }).mvp;
    const zoomed = viewMatrices({ ...base, yaw: 0, camera: view({ zoom: 2 }) }).mvp;
    const p: [number, number, number] = [10, 120, 0];
    expect(apply(zoomed, p)[0]).toBeCloseTo(2 * apply(plain, p)[0], 5);
    expect(apply(zoomed, p)[1]).toBeCloseTo(2 * apply(plain, p)[1], 5);
    expect(apply(zoomed, p)[2]).toBeCloseTo(apply(plain, p)[2], 6);
    const panned = viewMatrices({ ...base, yaw: 0, camera: view({ panX: 0.25, panY: -0.5 }) }).mvp;
    expect(apply(panned, p)[0]).toBeCloseTo(apply(plain, p)[0] + 0.25, 5);
    expect(apply(panned, p)[1]).toBeCloseTo(apply(plain, p)[1] - 0.5, 5);
  });

  it('gives a unit-length normal basis at any turn and tilt', () => {
    const { rot } = viewMatrices({ ...base, yaw: 1.1, camera: view({ pitch: -0.3 }) });
    for (const col of [0, 3, 6]) expect(Math.hypot(rot[col]!, rot[col + 1]!, rot[col + 2]!)).toBeCloseTo(1, 5);
    const dot = (a: number, b: number) => rot[a]! * rot[b]! + rot[a + 1]! * rot[b + 1]! + rot[a + 2]! * rot[b + 2]!;
    expect(dot(0, 3)).toBeCloseTo(0, 5);
    expect(dot(0, 6)).toBeCloseTo(0, 5);
    expect(dot(3, 6)).toBeCloseTo(0, 5);
  });
});
