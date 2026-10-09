// Pointer gestures for the 3D figure, free of the DOM: one pointer (a mouse or one finger) orbits, or pans when it went
// down as a pan drag (middle or right button, shift + left); two pointers pinch and drag together. Feed it the pointer
// events' client coordinates; it answers with what moved since the last call.

export type PointerMode = 'orbit' | 'pan';

export type GestureStep =
  /** One pointer moved by (dx, dy) CSS px: it turns the figure... */
  | { kind: 'orbit'; dx: number; dy: number }
  /** ...or, when it went down as a pan drag, moves the picture. */
  | { kind: 'pan'; dx: number; dy: number }
  /** Two pointers: the gap between them changed by `scale`, and their midpoint (now midX, midY) moved by (dMidX, dMidY). */
  | { kind: 'pinch'; scale: number; midX: number; midY: number; dMidX: number; dMidY: number };

interface Pt {
  x: number;
  y: number;
  mode: PointerMode;
}

export class PointerGestures {
  private pts = new Map<number, Pt>();
  private base = { x: 0, y: 0, dist: 0 };

  get count(): number {
    return this.pts.size;
  }

  down(id: number, x: number, y: number, mode: PointerMode = 'orbit'): void {
    this.pts.set(id, { x, y, mode });
    this.rebase();
  }

  /** Null for a pointer that is not down, or a third finger (only the first two count). */
  move(id: number, x: number, y: number): GestureStep | null {
    const p = this.pts.get(id);
    if (!p) return null;
    const pair = this.pair();
    if (!pair.includes(p)) return null;
    p.x = x;
    p.y = y;
    const prev = this.base;
    if (pair.length === 1) {
      this.base = { x, y, dist: 0 };
      return { kind: p.mode === 'pan' ? 'pan' : 'orbit', dx: x - prev.x, dy: y - prev.y };
    }
    const [a, b] = pair as [Pt, Pt];
    const midX = (a.x + b.x) / 2,
      midY = (a.y + b.y) / 2,
      dist = Math.hypot(a.x - b.x, a.y - b.y);
    this.base = { x: midX, y: midY, dist };
    return {
      kind: 'pinch',
      scale: prev.dist > 1 && dist > 1 ? dist / prev.dist : 1,
      midX,
      midY,
      dMidX: midX - prev.x,
      dMidY: midY - prev.y,
    };
  }

  up(id: number): void {
    if (this.pts.delete(id)) this.rebase();
  }

  clear(): void {
    this.pts.clear();
    this.rebase();
  }

  private pair(): Pt[] {
    return [...this.pts.values()].slice(0, 2);
  }

  /** After a pointer joins or leaves, measure from where the remaining ones are, so the picture never jumps. */
  private rebase(): void {
    const pair = this.pair();
    if (pair.length === 0) this.base = { x: 0, y: 0, dist: 0 };
    else if (pair.length === 1) this.base = { x: pair[0]!.x, y: pair[0]!.y, dist: 0 };
    else {
      const [a, b] = pair as [Pt, Pt];
      this.base = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
    }
  }
}
