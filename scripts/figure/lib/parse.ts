// Text parsers for MakeHuman .obj and .target files. Pure (strings in, typed arrays out).

export interface ObjBody {
  /** xyz per vertex (MakeHuman units: decimetres). Only vertices of the requested group's index range. */
  positions: Float64Array;
  /** Triangles (quads split on the shorter diagonal). */
  triangles: Uint32Array;
  vertexCount: number;
}

/**
 * Reads the faces of one group (default `body`) and every vertex they reference. MakeHuman's hm08 body group uses
 * vertices 0..13379 contiguously, so vertex indices are kept unchanged (targets index the same vertices).
 */
export function parseObj(text: string, group = 'body'): ObjBody {
  const xyz: number[] = [];
  const tris: number[] = [];
  let g = '';
  let maxIndex = -1;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      xyz.push(Number(p[1]), Number(p[2]), Number(p[3]));
    } else if (line.startsWith('g ')) {
      g = line.slice(2).trim();
    } else if (line.startsWith('f ') && g === group) {
      const ids = line
        .slice(2)
        .trim()
        .split(/\s+/)
        .map((s) => parseInt(s, 10) - 1);
      for (const i of ids) maxIndex = Math.max(maxIndex, i);
      if (ids.length === 3) tris.push(ids[0]!, ids[1]!, ids[2]!);
      else if (ids.length === 4) {
        const [a, b, c, d] = ids as [number, number, number, number];
        const d02 = dist2(xyz, a, c);
        const d13 = dist2(xyz, b, d);
        if (d02 <= d13) tris.push(a, b, c, a, c, d);
        else tris.push(a, b, d, b, c, d);
      } else throw new Error(`unsupported face with ${ids.length} vertices`);
    }
  }
  const vertexCount = maxIndex + 1;
  return { positions: Float64Array.from(xyz.slice(0, vertexCount * 3)), triangles: Uint32Array.from(tris), vertexCount };
}

function dist2(xyz: number[], i: number, j: number): number {
  const dx = xyz[3 * i]! - xyz[3 * j]!;
  const dy = xyz[3 * i + 1]! - xyz[3 * j + 1]!;
  const dz = xyz[3 * i + 2]! - xyz[3 * j + 2]!;
  return dx * dx + dy * dy + dz * dz;
}

/** A target as a dense delta array (zeros where the file lists nothing). Indices >= vertexCount are ignored. */
export function parseTarget(text: string, vertexCount: number): Float64Array {
  const out = new Float64Array(vertexCount * 3);
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const p = line.split(/\s+/);
    const i = parseInt(p[0]!, 10);
    if (!(i >= 0 && i < vertexCount)) continue;
    out[3 * i] = Number(p[1]);
    out[3 * i + 1] = Number(p[2]);
    out[3 * i + 2] = Number(p[3]);
  }
  return out;
}
