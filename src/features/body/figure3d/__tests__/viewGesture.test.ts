import { PointerGestures } from '../viewGesture';

describe('PointerGestures', () => {
  it('turns with one pointer by how far it moved since the last move', () => {
    const g = new PointerGestures();
    g.down(1, 100, 100);
    expect(g.move(1, 110, 95)).toEqual({ kind: 'orbit', dx: 10, dy: -5 });
    expect(g.move(1, 112, 95)).toEqual({ kind: 'orbit', dx: 2, dy: 0 });
    g.up(1);
    expect(g.count).toBe(0);
    expect(g.move(1, 150, 150)).toBeNull();
  });

  it('pans instead when the pointer went down as a pan drag', () => {
    const g = new PointerGestures();
    g.down(1, 0, 0, 'pan');
    expect(g.move(1, 7, -3)).toEqual({ kind: 'pan', dx: 7, dy: -3 });
    g.up(1);
    g.down(2, 0, 0);
    expect(g.move(2, 1, 1)?.kind).toBe('orbit');
  });

  it('ignores pointers that are not down', () => {
    expect(new PointerGestures().move(9, 1, 1)).toBeNull();
  });

  it('pinches with two pointers: scale from the gap, drag from the midpoint', () => {
    const g = new PointerGestures();
    g.down(1, 100, 200);
    g.down(2, 200, 200);
    // finger 2 moves right by 20: the gap grows from 100 to 120, the midpoint moves 10 right
    expect(g.move(2, 220, 200)).toEqual({ kind: 'pinch', scale: 1.2, midX: 160, midY: 200, dMidX: 10, dMidY: 0 });
    // both fingers drag down by 30 together (one event each): the gap is back where it was, the midpoint is 30 down
    const first = g.move(1, 100, 230);
    const second = g.move(2, 220, 230);
    expect(first?.kind === 'pinch' && second?.kind === 'pinch' && first.scale * second.scale).toBeCloseTo(1, 10);
    expect(second).toMatchObject({ kind: 'pinch', midY: 215 + 15 });
    expect((first as { dMidY: number }).dMidY + (second as { dMidY: number }).dMidY).toBe(30);
  });

  it('does not jump when a second finger lands or one lifts', () => {
    const g = new PointerGestures();
    g.down(1, 50, 50);
    g.move(1, 60, 60);
    g.down(2, 160, 60);
    // measured from where the pair is now, not from the first finger's old spot
    expect(g.move(1, 60, 60)).toMatchObject({ kind: 'pinch', scale: 1, dMidX: 0, dMidY: 0 });
    g.up(2);
    // the finger left behind continues the turn from where it is
    expect(g.move(1, 65, 60)).toEqual({ kind: 'orbit', dx: 5, dy: 0 });
  });

  it('only the first two pointers count', () => {
    const g = new PointerGestures();
    g.down(1, 0, 0);
    g.down(2, 100, 0);
    g.down(3, 50, 50);
    expect(g.move(3, 60, 60)).toBeNull();
    expect(g.move(1, 0, 0)).toMatchObject({ kind: 'pinch', scale: 1 });
  });

  it('forgets everything on clear', () => {
    const g = new PointerGestures();
    g.down(1, 0, 0);
    g.down(2, 10, 0);
    g.clear();
    expect(g.count).toBe(0);
    expect(g.move(1, 5, 5)).toBeNull();
  });
});
