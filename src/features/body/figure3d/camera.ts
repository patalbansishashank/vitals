// The person's view of the 3D figure (tilt, zoom, pan) as plain numbers, the clamps that keep it sensible, and the
// matrices the renderer draws with. No DOM, no WebGL: everything here is unit-tested. The turn about the vertical
// axis (yaw) lives beside it in the canvas because the slow auto-turn also drives it.

export interface ViewCamera {
  /** Tilt in radians. Positive looks down on the figure from above. Clamped to ±PITCH_LIMIT. */
  pitch: number;
  /** Magnification about the middle of the canvas. 1 fits the whole body. */
  zoom: number;
  /** Shift of the picture in clip units (the canvas is 2 wide and 2 tall), right and up positive. */
  panX: number;
  panY: number;
}

export const DEFAULT_VIEW: Readonly<ViewCamera> = Object.freeze({ pitch: 0, zoom: 1, panX: 0, panY: 0 });

export const ZOOM_MIN = 0.8;
export const ZOOM_MAX = 3;
/** One press of a zoom button. */
export const ZOOM_STEP = 1.25;
/** About 20 degrees each way: enough to read the body's depth, never enough to lose the stance. */
export const PITCH_LIMIT = 0.35;
/** One arrow-key press turns by this much about the vertical axis, and tilts by KEY_TILT. */
export const KEY_TURN = Math.PI / 24;
export const KEY_TILT = 0.05;
/** Shift + arrow key moves the picture by this much (clip units). */
export const KEY_PAN = 0.1;
/**
 * Clip y of the soles and of the top of the head at zoom 1, as the canvas draws a single view: the stage is the
 * stature plus 4 % headroom, with the ground line at -0.96.
 */
export const BODY_FLOOR = -0.96;
export const BODY_TOP = 2 / 1.04 + BODY_FLOOR;
/** Zoomed in, the top of the head may come this far (clip units per unit of zoom) below the frame's top edge. */
export const HEAD_ROOM = 0.3;

const TAU = Math.PI * 2;
// `+ 0` turns -0 into 0 so cameras compare cleanly
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v)) + 0;

/**
 * How far the picture may shift at a zoom, so the body never leaves the frame. Zoomed out or just fitting, the whole body
 * stays in view (a little sideways room, none to speak of up and down). Zoomed in, the body keeps covering the frame
 * from the feet up, and the top of the head may come down into the frame so the whole head can be framed. Grows with
 * zoom, so zooming in never snaps the picture back.
 */
export function panLimits(zoom: number): { x: number; yMin: number; yMax: number } {
  const floor = -1 - BODY_FLOOR * zoom; // the soles at the frame's bottom edge
  const head = 1 - BODY_TOP * zoom - HEAD_ROOM * Math.max(0, zoom - 1); // the top of the head inside the frame
  return { x: 0.35 + 0.5 * Math.max(0, zoom - 1), yMin: Math.min(floor, head), yMax: Math.max(floor, head) };
}

export function clampView(c: ViewCamera): ViewCamera {
  const zoom = clamp(c.zoom, ZOOM_MIN, ZOOM_MAX);
  const lim = panLimits(zoom);
  return {
    pitch: clamp(c.pitch, -PITCH_LIMIT, PITCH_LIMIT),
    zoom,
    panX: clamp(c.panX, -lim.x, lim.x),
    panY: clamp(c.panY, lim.yMin, lim.yMax),
  };
}

/** Zooms by a factor, keeping the picture point under (ax, ay) (clip units, 0,0 = the middle) where it is. */
export function zoomView(c: ViewCamera, factor: number, ax = 0, ay = 0): ViewCamera {
  const zoom = clamp(c.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  const k = zoom / c.zoom;
  return clampView({ ...c, zoom, panX: ax - k * (ax - c.panX), panY: ay - k * (ay - c.panY) });
}

export function panView(c: ViewCamera, dx: number, dy: number): ViewCamera {
  return clampView({ ...c, panX: c.panX + dx, panY: c.panY + dy });
}

export function tiltView(c: ViewCamera, dPitch: number): ViewCamera {
  return clampView({ ...c, pitch: c.pitch + dPitch });
}

export const canZoomIn = (c: ViewCamera) => c.zoom < ZOOM_MAX - 1e-6;
export const canZoomOut = (c: ViewCamera) => c.zoom > ZOOM_MIN + 1e-6;

export function isDefaultView(c: ViewCamera): boolean {
  return (
    Math.abs(c.pitch) < 1e-4 && Math.abs(c.zoom - 1) < 1e-4 && Math.abs(c.panX) < 1e-4 && Math.abs(c.panY) < 1e-4
  );
}

export function lerpView(a: ViewCamera, b: ViewCamera, t: number): ViewCamera {
  const m = (x: number, y: number) => x + (y - x) * t;
  return { pitch: m(a.pitch, b.pitch), zoom: m(a.zoom, b.zoom), panX: m(a.panX, b.panX), panY: m(a.panY, b.panY) };
}

/** The whole-turn multiple of 2π nearest a turn angle: the front view the turn reaches by the shortest way. */
export const nearestTurn = (yaw: number) => Math.round(yaw / TAU) * TAU;

/** True when the turn angle is facing front (any whole number of turns). */
export const isFacingFront = (yaw: number) => Math.abs(yaw - nearestTurn(yaw)) < 1e-3;

export interface ViewMatrixInput {
  /** Turn about the vertical axis, radians (the side view adds a quarter turn). */
  yaw: number;
  camera?: ViewCamera | null | undefined;
  /** The base orthographic mapping: clip = (sx * (x - cx) + tx, sy * y + ty). */
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  cx: number;
  /** Height (cm) the tilt turns about: the middle of the body. */
  pivotY: number;
  /** Clip depth per cm (negative: nearer the viewer is nearer the camera). */
  sz?: number;
}

/**
 * Column-major mvp (4 x 4) and rotation (3 x 3, for normals). The rotation is the turn about the vertical axis followed
 * by the tilt about the screen's horizontal axis through `pivotY`; zoom and pan then act on the picture (x and y only).
 * With the default camera this is exactly the plain turn the figure always had.
 */
export function viewMatrices(i: ViewMatrixInput): { mvp: Float32Array; rot: Float32Array } {
  const cam = i.camera ?? DEFAULT_VIEW;
  const cy = Math.cos(i.yaw),
    sy = Math.sin(i.yaw),
    cp = Math.cos(cam.pitch),
    sp = Math.sin(cam.pitch);
  // columns of Rx(pitch) * Ry(yaw)
  const rot = new Float32Array([cy, sp * sy, -cp * sy, 0, cp, sp, sy, -sp * cy, cp * cy]);
  const SX = i.sx * cam.zoom,
    SY = i.sy * cam.zoom,
    SZ = i.sz ?? -1 / 200;
  const mvp = new Float32Array([
    SX * rot[0]!,
    SY * rot[1]!,
    SZ * rot[2]!,
    0,
    SX * rot[3]!,
    SY * rot[4]!,
    SZ * rot[5]!,
    0,
    SX * rot[6]!,
    SY * rot[7]!,
    SZ * rot[8]!,
    0,
    i.tx * cam.zoom + cam.panX - SX * i.cx,
    i.ty * cam.zoom + cam.panY + SY * i.pivotY * (1 - cp),
    SZ * -sp * i.pivotY,
    1,
  ]);
  return { mvp, rot };
}
