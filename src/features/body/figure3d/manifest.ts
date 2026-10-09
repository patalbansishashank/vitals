// Format of public/figure/figure.json + figure.bin (written by scripts/figure/bake.ts, read by asset.ts).
// Pure types: imported by the Node bake script too, so keep this file free of runtime imports.

export interface BinSection {
  /** Byte offset into figure.bin (4-byte aligned). */
  offset: number;
  byteLength: number;
}

/** A morph target: int16 deltas (cm = q * step); dense over all vertices or sparse with a uint16 vertex list. */
export interface TargetEntry {
  id: string;
  step: number;
  /** Number of vertices carried. */
  count: number;
  deltas: BinSection;
  /** Present for sparse targets. */
  indices?: BinSection;
}

export type RingId = 'neck' | 'chest' | 'waist' | 'hip' | 'thigh' | 'calf' | 'arm';
export const RING_IDS: readonly RingId[] = ['neck', 'chest', 'waist', 'hip', 'thigh', 'calf', 'arm'];

/**
 * A tape-measure ring: the mesh is cut by the plane through vertex `anchor` with normal `normal`; the cut points of
 * the candidate `edges` are projected on (u, v) and the girth is the perimeter of their 2D convex hull.
 * v is the sagittal (front-back) direction for torso rings, so the hull's v-extent is the sagittal depth.
 */
export interface RingDef {
  id: RingId;
  anchor: number;
  normal: [number, number, number];
  u: [number, number, number];
  v: [number, number, number];
  /** Candidate edges as flat vertex pairs. */
  edges: number[];
}

export type MacroLevel = 'min' | 'average' | 'max';
export type FrameEnd = 'hipsLed' | 'shouldersLed';

/** Joint centres from MakeHuman's posed helper geometry, in ground-relative cm. */
export interface FigureJoint {
  id: string;
  hipsLed: [number, number, number];
  shouldersLed: [number, number, number];
  /** Small surface stencil for thin digits, whose helper tips may leave the skin. */
  skinVertices?: number[];
}

export interface FigureManifest {
  format: 'vitals-figure';
  version: 1;
  source: { repo: string; commit: string; files: string[]; licence: string };
  units: 'cm';
  vertexCount: number;
  triangleCount: number;
  bin: { file: string; byteLength: number };
  positions: { step: number; section: BinSection };
  indices: { section: BinSection };
  targets: TargetEntry[];
  model: {
    /** Frame end shapes (MakeHuman's two adult base shapes, mixed linearly by `frame`). */
    frame: Record<FrameEnd, string>;
    /** Muscle x weight macro targets per frame end, keyed `${muscle}-${weight}` (the average-average target is empty). */
    macro: Record<FrameEnd, Partial<Record<`${MacroLevel}-${MacroLevel}`, string>>>;
    /** Signed local targets: weight > 0 uses `incr`, < 0 uses `decr`. */
    locals: Array<{ id: string; incr?: string; decr?: string }>;
    /** Baked arm angle from vertical, degrees. */
    armAngleDeg: number;
  };
  rings: RingDef[];
  /** Vertices whose x-extent is the bideltoid breadth. */
  breadth: number[];
  /** Highest and lowest vertex of the reference shape (stature). */
  height: { top: number; bottom: number };
  /**
   * Per-vertex skin thickness along the inward normal (uint8 x step cm, least over the baked shapes, at the reference
   * stature). The under-skin fat shell never insets deeper than a fraction of it.
   */
  shell?: {
    step: number;
    thickness: BinSection;
    /** The nipple tip on each side of the chest. */
    nippleTips?: number[];
    /** Small bumps (the nipples and three rings) the fat layer passes under: filled in from the surrounding layer. */
    pinned?: number[];
  };
  /** Shared anatomical rest pose; the atlas bake consumes these exact landmarks. */
  joints?: FigureJoint[];
  /** Source rig skin regions for independent arm/body collision checks. */
  armClearance?: { leftArm: number[]; rightArm: number[]; centralBody: number[] };
  /** Baked rig weights used by the shared pose to relieve crowded underarms. */
  armPose?: { leftWeights: number[]; rightWeights: number[]; clearanceCm: number };
  /** Outward, closed outer-rim caps replacing the inward eye/mouth pockets. */
  headSurface?: { removedSourceTriangles: number; caps: Array<{id:string;rim:number[];triangles:number[];faces:number[]}> };
  stats: Record<string, number | string>;
}
