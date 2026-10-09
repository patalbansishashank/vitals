// Triangle BVH shared by the skin-cage bake and fitted geometry placement.
export type Point = [number, number, number];
export interface Hit {
  distance: number;
  indices: Point;
  weights: Point;
}
interface Node {
  low: Point;
  high: Point;
  left?: Node;
  right?: Node;
  faces?: number[];
}

export class Surface {
  private root: Node;
  private stack: Node[] = [];
  private edges: Float64Array;
  readonly positions: ArrayLike<number>;
  readonly indices: ArrayLike<number>;
  constructor(positions: ArrayLike<number>, indices: ArrayLike<number>) {
    this.positions = positions;
    this.indices = indices;
    this.edges = new Float64Array(indices.length * 3);
    this.root = this.build(Array.from({ length: indices.length / 3 }, (_, i) => i));
    this.updateEdges();
  }

  private updateEdges(): void {
    for (let face = 0; face < this.indices.length / 3; face++) {
      const a = this.indices[3 * face]! * 3,
        b = this.indices[3 * face + 1]! * 3,
        c = this.indices[3 * face + 2]! * 3;
      for (let axis = 0; axis < 3; axis++) {
        this.edges[9 * face + axis] = this.positions[a + axis]!;
        this.edges[9 * face + 3 + axis] = this.positions[b + axis]! - this.positions[a + axis]!;
        this.edges[9 * face + 6 + axis] = this.positions[c + axis]! - this.positions[a + axis]!;
      }
    }
  }

  /** The skin buffer is reused; refit bounds without sorting or rebuilding topology. */
  refit(): void {
    this.updateEdges();
    const visit = (node: Node) => {
      node.low.fill(Infinity);
      node.high.fill(-Infinity);
      if (node.faces)
        for (const face of node.faces)
          for (let k = 0; k < 3; k++)
            for (let axis = 0; axis < 3; axis++) {
              const value = this.positions[3 * this.indices[3 * face + k]! + axis]!;
              node.low[axis] = Math.min(node.low[axis]!, value);
              node.high[axis] = Math.max(node.high[axis]!, value);
            }
      else {
        visit(node.left!);
        visit(node.right!);
        for (let axis = 0; axis < 3; axis++) {
          node.low[axis] = Math.min(node.left!.low[axis]!, node.right!.low[axis]!);
          node.high[axis] = Math.max(node.left!.high[axis]!, node.right!.high[axis]!);
        }
      }
    };
    visit(this.root);
  }

  private build(faces: number[]): Node {
    const low: Point = [Infinity, Infinity, Infinity],
      high: Point = [-Infinity, -Infinity, -Infinity];
    for (const face of faces)
      for (let k = 0; k < 3; k++)
        for (let axis = 0; axis < 3; axis++) {
          const value = this.positions[3 * this.indices[3 * face + k]! + axis]!;
          low[axis] = Math.min(low[axis]!, value);
          high[axis] = Math.max(high[axis]!, value);
        }
    if (faces.length <= 16) return { low, high, faces };
    let axis = 0;
    for (let a = 1; a < 3; a++) if (high[a]! - low[a]! > high[axis]! - low[axis]!) axis = a;
    const centre = (face: number) =>
      (this.positions[3 * this.indices[3 * face]! + axis]! +
        this.positions[3 * this.indices[3 * face + 1]! + axis]! +
        this.positions[3 * this.indices[3 * face + 2]! + axis]!) /
      3;
    faces.sort((a, b) => centre(a) - centre(b));
    const mid = faces.length >> 1;
    return { low, high, left: this.build(faces.slice(0, mid)), right: this.build(faces.slice(mid)) };
  }

  ray(origin: readonly number[], direction: readonly number[]): Hit | null {
    return this.cast(origin, direction, Infinity, true) as Hit | null;
  }

  /**
   * Bounded distance-only query used for the inset, without per-triangle objects. With `exitOnly`, only faces the
   * ray leaves through count (outward-wound surface), so a start just outside the surface finds no hit.
   */
  distance(origin: readonly number[], direction: readonly number[], limit: number, exitOnly = false): number | null {
    return this.cast(origin, direction, limit, false, exitOnly) as number | null;
  }

  private cast(
    origin: readonly number[],
    direction: readonly number[],
    limit: number,
    details: boolean,
    exitOnly = false,
  ): Hit | number | null {
    let best: Hit | null = null;
    let bestDistance = limit;
    let found = false;
    const stack = this.stack;
    let top = 1;
    stack[0] = this.root;
    traverse: while (top > 0) {
      const node = stack[--top]!;
      let near = 0,
        far = bestDistance;
      for (let axis = 0; axis < 3; axis++) {
        const d = direction[axis]!;
        if (Math.abs(d) < 1e-12) {
          if (origin[axis]! < node.low[axis]! || origin[axis]! > node.high[axis]!) continue traverse;
        } else {
          const a = (node.low[axis]! - origin[axis]!) / d,
            b = (node.high[axis]! - origin[axis]!) / d;
          near = Math.max(near, Math.min(a, b));
          far = Math.min(far, Math.max(a, b));
          if (near > far) continue traverse;
        }
      }
      if (node.faces)
        for (const face of node.faces) {
          const E = this.edges,
            offset = 9 * face;
          const e1x = E[offset + 3]!,
            e1y = E[offset + 4]!,
            e1z = E[offset + 5]!;
          const e2x = E[offset + 6]!,
            e2y = E[offset + 7]!,
            e2z = E[offset + 8]!;
          const px = direction[1]! * e2z - direction[2]! * e2y,
            py = direction[2]! * e2x - direction[0]! * e2z,
            pz = direction[0]! * e2y - direction[1]! * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (Math.abs(det) < 1e-10 || (exitOnly && det > 0)) continue;
          const tx = origin[0]! - E[offset]!,
            ty = origin[1]! - E[offset + 1]!,
            tz = origin[2]! - E[offset + 2]!;
          const u = (tx * px + ty * py + tz * pz) / det;
          if (u < -1e-8 || u > 1 + 1e-8) continue;
          const qx = ty * e1z - tz * e1y,
            qy = tz * e1x - tx * e1z,
            qz = tx * e1y - ty * e1x;
          const v = (direction[0]! * qx + direction[1]! * qy + direction[2]! * qz) / det;
          if (v < -1e-8 || u + v > 1 + 1e-8) continue;
          const distance = (e2x * qx + e2y * qy + e2z * qz) / det;
          if (distance > 1e-5 && distance < bestDistance) {
            bestDistance = distance;
            found = true;
            if (details)
              best = {
                distance,
                indices: [this.indices[3 * face]!, this.indices[3 * face + 1]!, this.indices[3 * face + 2]!],
                weights: [1 - u - v, u, v],
              };
          }
        }
      else {
        const left = node.left!,
          right = node.right!;
        const order =
          direction[0]! * (left.low[0] + left.high[0] - right.low[0] - right.high[0]) +
          direction[1]! * (left.low[1] + left.high[1] - right.low[1] - right.high[1]) +
          direction[2]! * (left.low[2] + left.high[2] - right.low[2] - right.high[2]);
        if (order < 0) {
          stack[top++] = right;
          stack[top++] = left;
        } else {
          stack[top++] = left;
          stack[top++] = right;
        }
      }
    }
    return details ? best : found ? bestDistance : null;
  }
}
