/**
 * The card grid (r071 0B, AUDIT §2.7): the pure packing and the grid that draws it in list order.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPlatformForTests } from '@/platform/detect';
import { MQ } from '../lib/hooks';
import { BASE_SPAN, CardGrid, packHeights, packRows, type CardGridItem, type CardSize } from '../CardGrid';

let desktop = true;
const mediaUpdates = new Set<() => void>();
const setDesktop = (value: boolean) => act(() => { desktop = value; for (const update of mediaUpdates) update(); });
beforeEach(() => {
  desktop = true;
  mediaUpdates.clear();
  setPlatformForTests('web');
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === MQ.lg && desktop,
    media: query,
    addEventListener: (_event: string, update: () => void) => { if (query === MQ.lg) mediaUpdates.add(update); },
    removeEventListener: (_event: string, update: () => void) => mediaUpdates.delete(update),
  }));
});
afterEach(() => { vi.unstubAllGlobals(); setPlatformForTests(undefined); });

const it_ = (...sizes: CardSize[]) => sizes.map((size, i) => ({ id: `c${i}`, size }));
const spans = (rows: ReturnType<typeof packRows>) => rows.map((r) => r.map((p) => p.span));

describe('packRows: desktop (12 columns)', () => {
  it('widens a row that would end with free columns, last card first', () => {
    expect(spans(packRows(it_('tile', 'tile'), 12))).toEqual([[6, 6]]);
    expect(spans(packRows(it_('card', 'tile'), 12))).toEqual([[6, 6]]);
    expect(spans(packRows(it_('tile'), 12))).toEqual([[12]]);
    expect(spans(packRows(it_('card'), 12))).toEqual([[12]]);
    expect(spans(packRows(it_('tile', 'tile', 'tile'), 12))).toEqual([[3, 3, 6]]);
    expect(spans(packRows(it_('tile', 'card'), 12))).toEqual([[6, 6]]);
  });

  it('the default Today set: the hero, two cards, then a card and two tiles', () => {
    expect(spans(packRows(it_('hero', 'card', 'card', 'card', 'tile', 'tile'), 12))).toEqual([[12], [6, 6], [6, 3, 3]]);
  });

  it('without the ring (no Sleep) the two tiles take the row', () => {
    expect(spans(packRows(it_('hero', 'card', 'card', 'tile', 'tile'), 12))).toEqual([[12], [6, 6], [6, 6]]);
  });
  it('a chosen full-width card reserves its own row without changing order', () => {
    expect(spans(packRows(it_('card', 'wide', 'tile', 'tile'), 12))).toEqual([[12], [12], [6, 6]]);
    expect(packRows(it_('card', 'wide', 'tile'), 12).flat().map((item) => item.id)).toEqual(['c0', 'c1', 'c2']);
  });
  it('can keep explicit widths instead of widening a lone quarter card', () => {
    expect(spans(packRows(it_('tile'), 12, false))).toEqual([[3]]);
    expect(spans(packRows(it_('card', 'tile'), 12, false))).toEqual([[6, 3]]);
  });

  it('hero and slim are always a full row, and a tile before one is widened', () => {
    expect(spans(packRows(it_('hero', 'slim', 'hero'), 12))).toEqual([[12], [12], [12]]);
    expect(spans(packRows(it_('tile', 'hero', 'tile', 'slim'), 12))).toEqual([[12], [12], [12], [12]]);
  });

  it('a card that does not fit starts the next row', () => {
    expect(spans(packRows(it_('card', 'tile', 'card'), 12))).toEqual([[6, 6], [12]]);
  });
});

describe('packRows: phone (2 columns)', () => {
  it('a lone tile fills the row; three tiles are two and one wide', () => {
    expect(spans(packRows(it_('tile'), 2))).toEqual([[2]]);
    expect(spans(packRows(it_('tile', 'tile', 'tile'), 2))).toEqual([[1, 1], [2]]);
    expect(spans(packRows(it_('hero', 'card', 'tile', 'tile', 'slim'), 2))).toEqual([[2], [2], [1, 1], [2]]);
  });
});

describe('packHeights: intrinsic geometry', () => {
  it('fills below short Sleep while Energy continues, then places Energy by kind below Energy', () => {
    const placed = packHeights([
      { id: 'hero', span: 12, height: 200, preferredColumn: 1 },
      { id: 'sleep', span: 6, height: 110, preferredColumn: 1 },
      { id: 'energy', span: 6, height: 388, preferredColumn: 7 },
      { id: 'steps', span: 3, height: 328, preferredColumn: 1 },
      { id: 'weight', span: 3, height: 225, preferredColumn: 4 },
      { id: 'kinds', span: 6, height: 500, preferredColumn: 7 },
    ], 12, 16);
    const byId = new Map(placed.map((p) => [p.id, p]));
    expect(placed.map((p) => p.id)).toEqual(['hero', 'sleep', 'energy', 'steps', 'weight', 'kinds']);
    expect([byId.get('sleep')?.row, byId.get('energy')?.row]).toEqual([55, 55]);
    expect([byId.get('steps')?.column, byId.get('weight')?.column]).toEqual([1, 4]);
    expect(byId.get('steps')?.row).toBe(87); // 16 px after the short Sleep, not after Energy
    expect(byId.get('weight')?.row).toBe(87);
    expect([byId.get('kinds')?.column, byId.get('kinds')?.row]).toEqual([7, 156]);
  });

  it('keeps full-width cards as barriers and top order monotonic', () => {
    const placed = packHeights([
      { id: 'a', span: 3, height: 200 },
      { id: 'b', span: 6, height: 40 },
      { id: 'c', span: 3, height: 80 },
      { id: 'full', span: 12, height: 100 },
      { id: 'after', span: 6, height: 120 },
    ], 12, 16);
    expect(placed.map((p) => p.row)).toEqual([...placed.map((p) => p.row)].sort((a, b) => a - b));
    expect(placed[3]?.column).toBe(1);
    expect(placed[4]!.row).toBeGreaterThan(placed[3]!.row + placed[3]!.rows);
  });
});

describe('packRows: invariants', () => {
  it('keeps every id once and in list order, and every row is exactly full (any mix of sizes)', () => {
    const sizes: CardSize[] = ['hero', 'wide', 'card', 'tile', 'slim'];
    // mulberry32: a small seeded generator, so the sequences are the same on every run
    let a = 7;
    const rnd = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let n = 0; n < 60; n++) {
      const list = Array.from({ length: 1 + Math.floor(rnd() * 12) }, (_, i) => ({ id: `x${i}`, size: sizes[Math.floor(rnd() * sizes.length)]! }));
      for (const cols of [2, 12] as const) {
        const rows = packRows(list, cols);
        expect(rows.flat().map((p) => p.id)).toEqual(list.map((l) => l.id));
        for (const row of rows) expect(row.reduce((s, p) => s + p.span, 0)).toBe(cols);
        for (const p of rows.flat()) expect(p.span).toBeGreaterThanOrEqual(BASE_SPAN[cols][list.find((l) => l.id === p.id)!.size]);
      }
    }
  });

  it('an empty list has no rows', () => {
    expect(packRows([], 12)).toEqual([]);
  });
});

describe('<CardGrid>', () => {
  const node = (id: string) => <article aria-label={id}>{id}</article>;
  const items = (...defs: Array<[string, CardSize]>): CardGridItem[] => defs.map(([id, size]) => ({ id, size, node: node(id) }));

  it('draws phone cards full width while retaining their saved desktop sizes and order', () => {
    setDesktop(false);
    const { container } = render(<CardGrid items={items(['energy', 'card'], ['steps', 'tile'], ['weight', 'tile'], ['heart', 'tile'])} />);
    const cells = Array.from(container.querySelectorAll<HTMLElement>('.lm-cardgrid__cell'));
    expect(cells.map((c) => c.dataset.id)).toEqual(['energy', 'steps', 'weight', 'heart']);
    expect(cells.map((c) => c.dataset.size)).toEqual(['card', 'tile', 'tile', 'tile']);
    expect(cells.map((c) => c.dataset.span)).toEqual(['2', '2', '2', '2']);
    expect(cells[3]!.style.gridColumn).toBe('span 2');
    expect(cells.map((c) => c.hasAttribute('data-widened'))).toEqual([false, false, false, false]);
    expect(container.querySelector('.lm-cardgrid')).toHaveAttribute('data-cols', '2');
  });

  it('cols forces the desktop layout', () => {
    const { container } = render(<CardGrid cols={12} items={items(['hero', 'hero'], ['eaten', 'card'], ['energy', 'card'], ['steps', 'tile'], ['weight', 'tile'])} />);
    expect(container.querySelector('.lm-cardgrid')).toHaveAttribute('data-cols', '12');
    expect(Array.from(container.querySelectorAll<HTMLElement>('.lm-cardgrid__cell')).map((c) => c.dataset.span)).toEqual(['12', '6', '6', '3', '3']);
  });
  it('applies measured rows and follows an async Sleep height change', async () => {
    const originalObserver = globalThis.ResizeObserver;
    let resized: ResizeObserverCallback | undefined;
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) { resized = callback; }
      observe() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    const heights: Record<string, number> = { hero: 200, sleep: 110, energy: 388, steps: 328, weight: 225, kinds: 500 };
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const base = originalRect.call(this);
      const height = heights[this.dataset.id ?? ''];
      return height ? { ...base, height, bottom: base.top + height, toJSON: () => ({}) } : base;
    });
    try {
      const { container } = render(<CardGrid cols={12} items={items(
        ['hero', 'hero'], ['sleep', 'card'], ['energy', 'card'],
        ['steps', 'tile'], ['weight', 'tile'], ['kinds', 'card'],
      )} />);
      const cell = (id: string) => container.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
      expect(container.querySelector('.lm-cardgrid')).toHaveAttribute('data-packed', 'true');
      const row = (id: string) => Number.parseInt(cell(id).style.gridRow, 10);
      const rows = (id: string) => Number.parseInt(cell(id).style.gridRow.split('span ')[1]!, 10);
      const gapRows = row('sleep') - row('hero') - rows('hero');
      expect(row('steps')).toBe(row('sleep') + rows('sleep') + gapRows);
      expect(row('steps')).toBeLessThan(row('energy') + rows('energy'));
      expect(row('kinds')).toBe(row('energy') + rows('energy') + gapRows);
      expect(cell('kinds').style.gridColumn).toBe('7 / span 6');
      heights.sleep = 180;
      act(() => resized?.([], {} as ResizeObserver));
      await waitFor(() => expect(row('steps')).toBe(row('sleep') + Math.ceil(180 / 4) + gapRows));
    } finally {
      rect.mockRestore();
      globalThis.ResizeObserver = originalObserver;
    }
  });
  it('uses the available card area when its container narrows', () => {
    const resize: Array<(entries: Array<{ contentRect: { width: number } }>) => void> = [];
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(callback: (entries: Array<{ contentRect: { width: number } }>) => void) { resize.push(callback); }
      observe() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    try {
      const { container } = render(<CardGrid items={items(['a', 'card'], ['b', 'tile'])} />);
      const grid = container.querySelector('.lm-cardgrid');
      act(() => resize[0]?.([{ contentRect: { width: 1100 } }]));
      expect(grid).toHaveAttribute('data-cols', '12');
      act(() => resize[0]?.([{ contentRect: { width: 620 } }]));
      expect(grid).toHaveAttribute('data-cols', '2');
      expect(Array.from(container.querySelectorAll<HTMLElement>('.lm-cardgrid__cell')).map((cell) => cell.dataset.id)).toEqual(['a', 'b']);
    } finally {
      globalThis.ResizeObserver = original;
    }
  });
  it('drags a card surface after a threshold, while a short movement leaves it in place', () => {
    const onReorder = vi.fn();
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const base = originalRect.call(this);
      if (this.classList.contains('lm-cardgrid')) return { ...base, left: 0, right: 400, top: 0, bottom: 400, width: 400, height: 400, toJSON: () => ({}) };
      const x = ({ a: 0, b: 100, c: 200 } as Record<string, number>)[this.dataset.id ?? ''];
      return x === undefined ? base : { ...base, left: x, right: x + 80, top: 0, bottom: 80, width: 80, height: 80, toJSON: () => ({}) };
    });
    try {
      const edit = (id: string): CardGridItem => ({ id, size: 'tile', node: node(id), edit: { label: id.toUpperCase(), sizes: ['tile', 'card', 'wide'] } });
      const { container } = render(<CardGrid cols={12} items={[{ id: 'hero', size: 'hero', node: node('hero') }, edit('a'), edit('b'), edit('c')]}
        editor={{ onResize: vi.fn(), onReorder }} />);
      const cell = container.querySelector<HTMLElement>('[data-id="c"]')!;
      fireEvent.pointerDown(cell, { button: 0, pointerId: 2, pointerType: 'mouse', isPrimary: true, clientX: 240, clientY: 40 });
      fireEvent.pointerMove(window, { pointerId: 2, clientX: 238, clientY: 40 });
      fireEvent.pointerUp(window, { pointerId: 2, clientX: 238, clientY: 40 });
      expect(onReorder).not.toHaveBeenCalled();
      fireEvent.pointerDown(cell, { button: 0, pointerId: 3, pointerType: 'mouse', isPrimary: true, clientX: 240, clientY: 40 });
      fireEvent.pointerMove(window, { pointerId: 3, clientX: 40, clientY: 40 });
      expect(cell.style.transform).toMatch(/^translate3d\(-200px, 0px, 0/);
      expect(container.querySelector('[data-id="a"]')).toHaveAttribute('data-drop-target', 'true');
      expect(Array.from(container.querySelectorAll(':scope > .lm-cardgrid > [data-id]')).map((el) => (el as HTMLElement).dataset.id)).toEqual(['hero', 'a', 'b', 'c']);
      fireEvent.pointerUp(window, { pointerId: 3, clientX: 40, clientY: 40 });
      expect(onReorder).toHaveBeenCalledWith(['c', 'a', 'b']);
    } finally {
      rect.mockRestore();
    }
  });
  it('keeps a dragged card within grid bounds and cancels an outside release', () => {
    const onReorder = vi.fn();
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const base = originalRect.call(this);
      if (this.classList.contains('lm-cardgrid')) return { ...base, left: 0, right: 400, top: 0, bottom: 400, width: 400, height: 400, toJSON: () => ({}) };
      if (this.dataset.id === 'a') return { ...base, left: 100, right: 180, top: 40, bottom: 120, width: 80, height: 80, toJSON: () => ({}) };
      return base;
    });
    try {
      const { container } = render(<CardGrid cols={12} items={[{ id: 'hero', size: 'hero', node: node('hero') }, { id: 'a', size: 'tile', node: node('a'), edit: { label: 'A', sizes: ['tile', 'card'] } }]}
        editor={{ onResize: vi.fn(), onReorder }} />);
      const cell = container.querySelector<HTMLElement>('[data-id="a"]')!;
      fireEvent.pointerDown(cell, { button: 0, pointerId: 18, pointerType: 'mouse', isPrimary: true, clientX: 120, clientY: 80 });
      fireEvent.pointerMove(window, { pointerId: 18, clientX: 1000, clientY: 80 });
      expect(cell.style.transform).toMatch(/^translate3d\(220px, 0px, 0/); // right edge: 400 − 80
      fireEvent.pointerUp(window, { pointerId: 18, clientX: 1000, clientY: 80 });
      expect(cell.style.transform).toBe('');
      expect(onReorder).not.toHaveBeenCalled();
    } finally { rect.mockRestore(); }
  });
  it('resizes from a corner grip and exposes keyboard move in edit mode', () => {
    const onResize = vi.fn(), onReorder = vi.fn();
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const base = originalRect.call(this);
      return this.classList.contains('lm-cardgrid') ? { ...base, left: 0, right: 1200, top: 0, bottom: 400, width: 1200, height: 400, toJSON: () => ({}) } : base;
    });
    try {
      const edit = (id: string): CardGridItem => ({ id, size: 'tile', node: node(id), edit: { label: id.toUpperCase(), sizes: ['tile', 'card', 'wide'] } });
      const { container } = render(<CardGrid cols={12} keyboardEditing items={[{ id: 'hero', size: 'hero', node: node('hero') }, edit('a'), edit('b')]}
        editor={{ onResize, onReorder }} />);
      expect(document.activeElement).toBe(container.querySelector('[data-id="a"]'));
      expect(fireEvent.keyDown(container.querySelector('[data-id="a"]')!, { key: 'ArrowLeft', altKey: true, cancelable: true })).toBe(false);
      expect(onReorder).not.toHaveBeenCalled();
      const corner = screen.getByRole('slider', { name: 'Width of A' });
      fireEvent.pointerDown(corner, { button: 0, pointerId: 4, pointerType: 'mouse', isPrimary: true, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(window, { pointerId: 4, clientX: 190, clientY: 100 });
      fireEvent.pointerUp(window, { pointerId: 4, clientX: 190, clientY: 100 });
      expect(onResize).toHaveBeenCalledWith('a', 'card');
      fireEvent.keyDown(container.querySelector('[data-id="a"]')!, { key: 'ArrowDown', altKey: true });
      expect(onReorder).toHaveBeenCalledWith(['b', 'a']);
    } finally { rect.mockRestore(); }
  });
  it('allows a touch swipe to scroll but rearranges after a stationary long press', () => {
    const onReorder = vi.fn();
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const base = originalRect.call(this);
      if (this.classList.contains('lm-cardgrid')) return { ...base, left: 0, right: 400, top: 0, bottom: 400, width: 400, height: 400, toJSON: () => ({}) };
      const x = ({ a: 0, b: 100 } as Record<string, number>)[this.dataset.id ?? ''];
      return x === undefined ? base : { ...base, left: x, right: x + 80, top: 0, bottom: 80, width: 80, height: 80, toJSON: () => ({}) };
    });
    const edit = (id: string): CardGridItem => ({ id, size: 'tile', node: node(id), edit: { label: id, sizes: ['tile', 'card'] } });
    try {
      const { container } = render(<CardGrid cols={12} items={[{ id: 'hero', size: 'hero', node: node('hero') }, edit('a'), edit('b')]}
        editor={{ onResize: vi.fn(), onReorder }} />);
      const cell = container.querySelector<HTMLElement>('[data-id="b"]')!;
      vi.useFakeTimers();
      fireEvent.pointerDown(cell, { button: 0, pointerId: 11, pointerType: 'touch', isPrimary: true, clientX: 140, clientY: 40 });
      fireEvent.pointerMove(window, { pointerId: 11, clientX: 140, clientY: 55 });
      act(() => vi.advanceTimersByTime(500));
      fireEvent.pointerMove(window, { pointerId: 11, clientX: 40, clientY: 40 });
      fireEvent.pointerUp(window, { pointerId: 11, clientX: 40, clientY: 40 });
      expect(onReorder).not.toHaveBeenCalled();

      fireEvent.pointerDown(cell, { button: 0, pointerId: 12, pointerType: 'touch', isPrimary: true, clientX: 140, clientY: 40 });
      expect(fireEvent.touchMove(cell, { cancelable: true })).toBe(true);
      act(() => vi.advanceTimersByTime(421));
      expect(fireEvent.touchMove(cell, { cancelable: true })).toBe(false);
      fireEvent.pointerMove(window, { pointerId: 12, clientX: 40, clientY: 40 });
      fireEvent.pointerUp(window, { pointerId: 12, clientX: 40, clientY: 40 });
      expect(onReorder).toHaveBeenCalledWith(['b', 'a']);
    } finally { vi.useRealTimers(); rect.mockRestore(); }
  });
  it('widens the right-hand half card with short horizontal travel into the gutter and shrinks left', () => {
    const onResize = vi.fn();
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const base = originalRect.call(this);
      return this.classList.contains('lm-cardgrid') ? { ...base, left: 0, right: 1200, top: 0, bottom: 500, width: 1200, height: 500, toJSON: () => ({}) } : base;
    });
    try {
      const makeItems = (size: CardSize): CardGridItem[] => [{ id: 'hero', size: 'hero', node: node('hero') }, { id: 'left', size: 'card', node: node('left') }, { id: 'energy', size, node: node('energy'), edit: { label: 'Energy', sizes: ['card', 'wide'] } }];
      const editor = { onResize, onReorder: vi.fn() };
      const { rerender } = render(<CardGrid cols={12} items={makeItems('card')} editor={editor} />);
      const corner = screen.getByRole('slider', { name: 'Width of Energy' });
      fireEvent.pointerDown(corner, { button: 0, pointerId: 43, pointerType: 'mouse', isPrimary: true, clientX: 1178, clientY: 100 });
      fireEvent.pointerMove(window, { pointerId: 43, clientX: 1178, clientY: 220 });
      fireEvent.pointerUp(window, { pointerId: 43, clientX: 1178, clientY: 220 });
      expect(onResize).not.toHaveBeenCalled();
      fireEvent.pointerDown(corner, { button: 0, pointerId: 44, pointerType: 'mouse', isPrimary: true, clientX: 1178, clientY: 100 });
      fireEvent.pointerMove(window, { pointerId: 44, clientX: 1223, clientY: 100 });
      expect(screen.getByRole('slider', { name: 'Width of Energy' })).toHaveAttribute('aria-valuetext', 'Full width');
      fireEvent.pointerUp(window, { pointerId: 44, clientX: 1223, clientY: 100 });
      expect(onResize).toHaveBeenCalledWith('energy', 'wide');
      onResize.mockClear();
      rerender(<CardGrid cols={12} items={makeItems('wide')} editor={editor} />);
      const fullCorner = screen.getByRole('slider', { name: 'Width of Energy' });
      fireEvent.pointerDown(fullCorner, { button: 0, pointerId: 45, pointerType: 'mouse', isPrimary: true, clientX: 1178, clientY: 100 });
      fireEvent.pointerMove(window, { pointerId: 45, clientX: 1138, clientY: 100 });
      const guide = fullCorner.closest('.lm-cardgrid__cell')!.querySelector<HTMLElement>('.lm-cardgrid__resize-guide')!;
      expect(Number.parseFloat(guide.style.width)).toBeGreaterThan(600);
      expect(Number.parseFloat(guide.style.width)).toBeLessThan(1200);
      expect(fullCorner.closest('.lm-cardgrid__cell')).toHaveAttribute('data-size', 'wide');
      fireEvent.pointerMove(window, { pointerId: 45, clientX: 1078, clientY: 100 });
      fireEvent.pointerUp(window, { pointerId: 45, clientX: 1078, clientY: 100 });
      expect(onResize).toHaveBeenCalledWith('energy', 'card');
    } finally { rect.mockRestore(); }
  });
  it('resizes a touch corner vertically at the right edge and cancels an interrupted preview', () => {
    const onResize = vi.fn();
    const items: CardGridItem[] = [{ id: 'a', size: 'card', node: node('a'), edit: { label: 'A', sizes: ['card', 'wide'] } }];
    const { container, rerender } = render(<CardGrid cols={12} items={items} editor={{ onResize, onReorder: vi.fn() }} />);
    const corner = screen.getByRole('slider', { name: 'Width of A' });
    vi.useFakeTimers();
    try {
      fireEvent.pointerDown(corner, { button: 0, pointerId: 60, pointerType: 'touch', isPrimary: true, clientX: 370, clientY: 200 });
      act(() => vi.advanceTimersByTime(421));
      fireEvent.pointerMove(window, { pointerId: 60, clientX: 372, clientY: 280 });
      expect(corner).toHaveAttribute('aria-valuetext', 'Full width');
      fireEvent.pointerCancel(window, { pointerId: 60 });
      expect(onResize).not.toHaveBeenCalled();
      expect(container.querySelector('[data-resizing]')).toBeNull();
      expect(corner).toHaveAttribute('aria-valuetext', 'Half width');
      fireEvent.pointerDown(corner, { button: 0, pointerId: 61, pointerType: 'touch', isPrimary: true, clientX: 370, clientY: 200 });
      act(() => vi.advanceTimersByTime(421));
      fireEvent.pointerMove(window, { pointerId: 61, clientX: 372, clientY: 280 });
      fireEvent.pointerUp(window, { pointerId: 61, clientX: 372, clientY: 280 });
      expect(onResize).toHaveBeenLastCalledWith('a', 'wide');
      rerender(<CardGrid cols={12} items={items.map(item => ({ ...item, size: 'wide' }))} editor={{ onResize, onReorder: vi.fn() }} />);
      fireEvent.pointerDown(corner, { button: 0, pointerId: 62, pointerType: 'touch', isPrimary: true, clientX: 370, clientY: 200 });
      act(() => vi.advanceTimersByTime(421));
      fireEvent.pointerMove(window, { pointerId: 62, clientX: 368, clientY: 120 });
      fireEvent.pointerUp(window, { pointerId: 62, clientX: 368, clientY: 120 });
      expect(onResize).toHaveBeenLastCalledWith('a', 'card');
    } finally { vi.useRealTimers(); }
  });
  it('gives a second touch back to the browser without committing a held gesture', () => {
    const onReorder = vi.fn();
    const { container } = render(<CardGrid cols={2} items={[{ id: 'a', size: 'tile', node: node('a'), edit: { label: 'A', sizes: ['tile', 'card'] } }]}
      editor={{ onResize: vi.fn(), onReorder }} />);
    const cell = container.querySelector('[data-id="a"]')!;
    vi.useFakeTimers();
    try {
      fireEvent.pointerDown(cell, { button: 0, pointerId: 80, pointerType: 'touch', isPrimary: true, clientX: 100, clientY: 200 });
      act(() => vi.advanceTimersByTime(421));
      expect(cell).toHaveAttribute('data-dragging');
      fireEvent.pointerDown(window, { button: 0, pointerId: 81, pointerType: 'touch', isPrimary: false });
      expect(cell).not.toHaveAttribute('data-dragging');
      expect(fireEvent.touchMove(cell, { cancelable: true })).toBe(true);
      fireEvent.pointerUp(window, { pointerId: 80, clientX: 200, clientY: 300 });
      expect(onReorder).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('reserves all interactive card content for drag gestures only while editing', () => {
    const onReorder = vi.fn(), pointerDown = vi.fn();
    const { container } = render(<CardGrid cols={12} items={[{ id: 'a', size: 'tile', node: <article><button onPointerDown={pointerDown}>Info</button><button disabled>Disabled</button><a href="/today">Open</a><div data-scrub="true" onPointerDown={pointerDown}>Chart</div></article>, edit: { label: 'A', sizes: ['tile', 'card'] } }]}
      editor={{ onResize: vi.fn(), onReorder }} />);
    expect(container.querySelector('.lm-cardgrid__content')).toHaveAttribute('inert');
    expect(container.querySelector('.lm-cardgrid__drag-surface')).not.toBeNull();
    vi.useFakeTimers();
    try {
      for (const control of container.querySelectorAll('article button, article a, [data-scrub]')) {
        fireEvent.pointerDown(control, { button: 0, pointerId: 90, pointerType: 'touch', isPrimary: true, clientX: 100, clientY: 200 });
        act(() => vi.advanceTimersByTime(421));
        expect(container.querySelector('[data-dragging]')).not.toBeNull();
        fireEvent.pointerCancel(window, { pointerId: 90 });
      }
      expect(pointerDown).not.toHaveBeenCalled();
      expect(onReorder).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('consumes a held gesture click even when capture retargets it to a control, then allows a fresh tap', () => {
    const clicked = vi.fn();
    const items: CardGridItem[] = [{ id: 'a', size: 'tile', node: <article>Surface<button onClick={clicked}>Action</button></article>, edit: { label: 'A', sizes: ['tile', 'card'] } }];
    const { container, rerender } = render(<CardGrid cols={2} items={items} editor={{ onResize: vi.fn(), onReorder: vi.fn() }} />);
    const cell = container.querySelector('[data-id="a"]')!;
    const button = container.querySelector('article button')!;
    vi.useFakeTimers();
    try {
      fireEvent.pointerDown(cell, { button: 0, pointerId: 100, pointerType: 'touch', isPrimary: true, clientX: 0, clientY: 0 });
      act(() => vi.advanceTimersByTime(421));
      fireEvent.pointerUp(window, { pointerId: 100, clientX: 0, clientY: 0 });
      rerender(<CardGrid cols={2} items={items} />);
      fireEvent.click(button, { detail: 1, clientX: 100, clientY: 200 });
      expect(clicked).not.toHaveBeenCalled();
      fireEvent.pointerDown(button, { button: 0, pointerId: 101, pointerType: 'touch', isPrimary: true });
      fireEvent.click(button, { detail: 1 });
      expect(clicked).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it('keeps a held touch active when implicit child capture transfers to the grid', () => {
    const onResize = vi.fn();
    const { container } = render(<CardGrid cols={12} items={[{ id: 'a', size: 'card', node: node('a'), edit: { label: 'A', sizes: ['card', 'wide'] } }]}
      editor={{ onResize, onReorder: vi.fn() }} />);
    const corner = screen.getByRole('slider', { name: 'Width of A' });
    const grid = container.querySelector('.lm-cardgrid')!;
    vi.useFakeTimers();
    try {
      fireEvent.pointerDown(corner, { button: 0, pointerId: 110, pointerType: 'touch', isPrimary: true, clientX: 100, clientY: 200 });
      fireEvent.pointerMove(window, { pointerId: 110, clientX: 104, clientY: 203 });
      act(() => vi.advanceTimersByTime(421));
      // Real browsers dispatch this on the original touch target, bubbling through the grid.
      fireEvent.lostPointerCapture(corner, { pointerId: 110, bubbles: true });
      expect(container.querySelector('[data-resizing]')).not.toBeNull();
      fireEvent.pointerMove(window, { pointerId: 110, clientX: 104, clientY: 280 });
      fireEvent.pointerUp(window, { pointerId: 110, clientX: 104, clientY: 280 });
      expect(onResize).toHaveBeenCalledWith('a', 'wide');
      fireEvent.pointerDown(corner, { button: 0, pointerId: 111, pointerType: 'touch', isPrimary: true, clientX: 100, clientY: 200 });
      act(() => vi.advanceTimersByTime(421));
      fireEvent.lostPointerCapture(grid, { pointerId: 111, bubbles: true });
      expect(container.querySelector('[data-resizing]')).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it.each(['mouse', 'touch'])('does not activate card content when an active %s gesture is cancelled with Escape', (pointerType) => {
    const clicked = vi.fn();
    const items: CardGridItem[] = [{ id: 'a', size: 'tile', node: <article>Surface<button onClick={clicked}>Action</button></article>, edit: { label: 'A', sizes: ['tile', 'card'] } }];
    const { container, rerender } = render(<CardGrid cols={2} items={items} editor={{ onResize: vi.fn(), onReorder: vi.fn() }} />);
    const cell = container.querySelector('[data-id="a"]')!;
    const button = container.querySelector('article button')!;
    vi.useFakeTimers();
    try {
      fireEvent.pointerDown(cell, { button: 0, pointerId: 120, pointerType, isPrimary: true, clientX: 0, clientY: 0 });
      if (pointerType === 'touch') act(() => vi.advanceTimersByTime(421));
      else fireEvent.pointerMove(window, { pointerId: 120, clientX: 15, clientY: 0 });
      expect(cell).toHaveAttribute('data-dragging');
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(cell).not.toHaveAttribute('data-dragging');
      fireEvent.pointerUp(window, { pointerId: 120, clientX: 15, clientY: 0 });
      rerender(<CardGrid cols={2} items={items} />);
      fireEvent.click(button, { detail: 1 });
      expect(clicked).not.toHaveBeenCalled();
      fireEvent.pointerDown(button, { button: 0, pointerId: 121, pointerType, isPrimary: true });
      fireEvent.click(button, { detail: 1 });
      expect(clicked).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it('keeps a right-edge diagonal resize on a reachable axis without changing it during later drift', () => {
    const onResize = vi.fn();
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    render(<CardGrid cols={12} items={[{ id: 'a', size: 'card', node: node('a'), edit: { label: 'A', sizes: ['card', 'wide'] } }]}
      editor={{ onResize, onReorder: vi.fn() }} />);
    const corner = screen.getByRole('slider', { name: 'Width of A' });
    vi.useFakeTimers();
    try {
      fireEvent.pointerDown(corner, { button: 0, pointerId: 130, pointerType: 'touch', isPrimary: true, clientX: 1180, clientY: 200 });
      fireEvent.pointerMove(window, { pointerId: 130, clientX: 1184, clientY: 203 });
      act(() => vi.advanceTimersByTime(421));
      fireEvent.lostPointerCapture(corner, { pointerId: 130, bubbles: true });
      fireEvent.pointerMove(window, { pointerId: 130, clientX: 1188, clientY: 208 });
      fireEvent.pointerMove(window, { pointerId: 130, clientX: 1199, clientY: 285 });
      expect(corner).toHaveAttribute('aria-valuetext', 'Full width');
      // Horizontal drift must not switch a decided vertical gesture back to shrinking.
      fireEvent.pointerMove(window, { pointerId: 130, clientX: 1000, clientY: 285 });
      expect(corner).toHaveAttribute('aria-valuetext', 'Full width');
      fireEvent.pointerUp(window, { pointerId: 130, clientX: 1199, clientY: 285 });
      expect(onResize).toHaveBeenCalledWith('a', 'wide');
    } finally {
      vi.useRealTimers();
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    }
  });
  it.each([false, true])('keeps phone rendering full and restores saved desktop widths (editing=%s)', (editing) => {
    const onResize = vi.fn();
    const items: CardGridItem[] = [
      { id: 'wide', size: 'wide', node: size => <article>{size}</article>, edit: { label: 'Wide', sizes: ['tile', 'card', 'wide'] } },
      { id: 'tile', size: 'tile', node: size => <article>{size}</article>, edit: { label: 'Tile', sizes: ['tile', 'card', 'wide'] } },
    ];
    const { container } = render(<CardGrid cols={12} items={items} editor={editing ? { onResize, onReorder: vi.fn() } : undefined} />);
    const tile = container.querySelector('[data-id="tile"]')!;
    expect(tile).toHaveAttribute('data-span', '3');
    expect(tile.querySelector('article')).toHaveTextContent('tile');
    setDesktop(false);
    expect(container.querySelector('.lm-cardgrid')).toHaveAttribute('data-cols', '2');
    expect([...container.querySelectorAll('[data-id]')].map(el => el.getAttribute('data-span'))).toEqual(['2', '2']);
    expect(tile).toHaveAttribute('data-size', 'tile');
    expect(tile.querySelector('article')).toHaveTextContent('card');
    expect(screen.queryByRole('slider')).toBeNull();
    setDesktop(true);
    expect(tile).toHaveAttribute('data-span', '3');
    expect(tile.querySelector('article')).toHaveTextContent('tile');
    expect(onResize).not.toHaveBeenCalled();
  });
  it('leaves normal-mode buttons, charts, and text alone even when edit metadata and keyboardEditing are present', () => {
    const down = vi.fn(), clicked = vi.fn();
    const { container } = render(<CardGrid cols={12} keyboardEditing items={[{ id: 'a', size: 'tile', node: <article><button onPointerDown={down} onClick={clicked}>Info</button><div data-scrub="true" onPointerDown={down}>Chart</div></article>, edit: { label: 'A', sizes: ['tile', 'card'] } }]} />);
    const cell = container.querySelector<HTMLElement>('[data-id="a"]')!;
    expect(cell).not.toHaveAttribute('tabindex');
    expect(container.querySelector('[inert], .lm-cardgrid__drag-surface, .lm-cardgrid__corner')).toBeNull();
    expect(container.querySelector('.lm-cardgrid')).not.toHaveAttribute('data-rearrange');
    vi.useFakeTimers();
    try {
      const button = screen.getByRole('button', { name: 'Info' });
      fireEvent.pointerDown(button, { button: 0, pointerId: 150, pointerType: 'touch', isPrimary: true });
      act(() => vi.advanceTimersByTime(500));
      expect(cell).not.toHaveAttribute('data-dragging');
      fireEvent.pointerMove(window, { pointerId: 150, clientX: 200, clientY: 300 });
      fireEvent.pointerUp(window, { pointerId: 150, clientX: 200, clientY: 300 });
      fireEvent.click(button, { detail: 1 });
      fireEvent.pointerDown(container.querySelector('[data-scrub]')!, { button: 0, pointerId: 151, pointerType: 'mouse', isPrimary: true });
      expect(clicked).toHaveBeenCalledOnce();
      expect(down).toHaveBeenCalledTimes(2);
      expect(cell.style.transform).toBe('');
    } finally { vi.useRealTimers(); }
  });

  it.each([100, 450])('cancels edit-mode exit after %sms and consumes its release before allowing a new normal tap', (holdMs) => {
    const clicked = vi.fn(), onReorder = vi.fn(), onResize = vi.fn();
    const items: CardGridItem[] = [{ id: 'a', size: 'tile', node: <article><button onClick={clicked}>Action</button></article>, edit: { label: 'A', sizes: ['tile', 'card'] } }];
    const { container, rerender } = render(<CardGrid cols={12} keyboardEditing items={items} editor={{ onResize, onReorder }} />);
    const button = container.querySelector('article button')!;
    vi.useFakeTimers();
    try {
      fireEvent.pointerDown(button, { button: 0, pointerId: 160, pointerType: 'touch', isPrimary: true });
      act(() => vi.advanceTimersByTime(holdMs));
      rerender(<CardGrid cols={12} keyboardEditing items={items} />);
      act(() => vi.advanceTimersByTime(500 - holdMs));
      expect(container.querySelector('[data-dragging], [inert], .lm-cardgrid__corner, [data-keyboard-card]')).toBeNull();
      fireEvent.pointerUp(window, { pointerId: 160 });
      fireEvent.click(button, { detail: 1 });
      expect(clicked).not.toHaveBeenCalled();
      expect(onReorder).not.toHaveBeenCalled();
      expect(onResize).not.toHaveBeenCalled();
      fireEvent.pointerDown(button, { button: 0, pointerId: 161, pointerType: 'touch', isPrimary: true });
      fireEvent.click(button, { detail: 1 });
      expect(clicked).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it('cancels a desktop resize when the viewport becomes mobile without saving its preview', () => {
    const onResize = vi.fn();
    const { container } = render(<CardGrid cols={12} items={[{ id: 'a', size: 'card', node: node('a'), edit: { label: 'A', sizes: ['card', 'wide'] } }]}
      editor={{ onResize, onReorder: vi.fn() }} />);
    const corner = screen.getByRole('slider', { name: 'Width of A' });
    fireEvent.pointerDown(corner, { button: 0, pointerId: 170, pointerType: 'mouse', isPrimary: true, clientX: 400, clientY: 200 });
    fireEvent.pointerMove(window, { pointerId: 170, clientX: 600, clientY: 200 });
    expect(corner).toHaveAttribute('aria-valuetext', 'Full width');
    setDesktop(false);
    expect(container.querySelector('[data-resizing], .lm-cardgrid__corner')).toBeNull();
    fireEvent.pointerUp(window, { pointerId: 170, clientX: 600, clientY: 200 });
    expect(onResize).not.toHaveBeenCalled();
    expect(container.querySelector('[data-id="a"]')).toHaveAttribute('data-size', 'card');
  });

  it('keeps native Android landscape and narrow desktop containers full width with expanded content', () => {
    const item: CardGridItem = { id: 'a', size: 'tile', node: size => <article>{size}</article>, edit: { label: 'A', sizes: ['tile', 'card', 'wide'] } };
    const editor = { onResize: vi.fn(), onReorder: vi.fn() };
    setPlatformForTests('android');
    const { container, rerender } = render(<CardGrid cols={12} items={[item]} editor={editor} />);
    expect(container.querySelector('.lm-cardgrid')).toHaveAttribute('data-cols', '2');
    expect(container.querySelector('[data-id="a"]')).toHaveAttribute('data-span', '2');
    expect(container.querySelector('article')).toHaveTextContent('card');
    expect(screen.queryByRole('slider')).toBeNull();
    setPlatformForTests('web');
    rerender(<CardGrid cols={2} items={[item]} editor={editor} />);
    expect(container.querySelector('[data-id="a"]')).toHaveAttribute('data-span', '2');
    expect(container.querySelector('article')).toHaveTextContent('card');
    expect(screen.queryByRole('slider')).toBeNull();
    expect(editor.onResize).not.toHaveBeenCalled();
  });

  it('does not let a wide measured container bypass the phone breakpoint', () => {
    setDesktop(false);
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { observe() {} disconnect() {} } as unknown as typeof ResizeObserver;
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 950, 400));
    try {
      const { container } = render(<CardGrid items={[{ id: 'a', size: 'tile', node: node('a'), edit: { label: 'A', sizes: ['tile', 'card'] } }]} editor={{ onResize: vi.fn(), onReorder: vi.fn() }} />);
      expect(container.querySelector('.lm-cardgrid')).toHaveAttribute('data-cols', '2');
      expect(container.querySelector('[data-id="a"]')).toHaveAttribute('data-span', '2');
      expect(screen.queryByRole('slider')).toBeNull();
    } finally { rect.mockRestore(); globalThis.ResizeObserver = original; }
  });

  it('keeps the hero locked and its controls usable even if malformed edit metadata is supplied', () => {
    const clicked = vi.fn();
    const { container } = render(<CardGrid cols={12} keyboardEditing items={[{ id: 'hero', size: 'hero', node: <button onClick={clicked}>Hero action</button>, edit: { label: 'Hero', sizes: ['hero', 'tile'] } }]}
      editor={{ onResize: vi.fn(), onReorder: vi.fn() }} />);
    expect(container.querySelector('[data-editable], [inert], .lm-cardgrid__corner, [data-keyboard-card]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hero action' }), { detail: 1 });
    expect(clicked).toHaveBeenCalledOnce();
  });
  it('hides a corner when responsive widths have the same effective span', () => {
    render(<CardGrid cols={2} items={[{ id: 'hero', size: 'hero', node: node('hero') }, { id: 'energy', size: 'card', node: node('energy'), edit: { label: 'Energy', sizes: ['card', 'wide'] } }]}
      editor={{ onResize: vi.fn(), onReorder: vi.fn() }} />);
    expect(screen.queryByRole('slider', { name: 'Width of Energy' })).toBeNull();
  });
  it('omits a null-rendering cell and restores it when content arrives', async () => {
    const originalObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { observe() {} disconnect() {} } as unknown as typeof ResizeObserver;
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const base = originalRect.call(this);
      const heights: Record<string, number> = { hero: 180, sleep: 112, energy: 370, steps: 300 };
      const height = heights[this.dataset.id ?? ''];
      return height ? { ...base, height, bottom: base.top + height, toJSON: () => ({}) } : base;
    });
    try {
      const edit = (id: string, node: CardGridItem['node']): CardGridItem => ({ id, size: 'card', node, edit: { label: id, sizes: ['card', 'wide'] } });
      const editor = { onResize: vi.fn(), onReorder: vi.fn() };
      const first: CardGridItem[] = [{ id: 'hero', size: 'hero', node: node('hero') }, edit('sleep', node('sleep')), edit('energy', node('energy')), edit('videos', () => null), edit('steps', node('steps'))];
      const { container, rerender } = render(<CardGrid cols={12} items={first} editor={editor} />);
      expect(container.querySelector('[data-id="videos"]')).toHaveAttribute('data-empty', 'true');
      expect(container.querySelector('.lm-cardgrid')).toHaveAttribute('data-packed', 'true');
      expect(container.querySelector('[data-id="videos"]')).not.toHaveAttribute('data-keyboard-card');
      rerender(<CardGrid cols={12} items={first.map((item) => item.id === 'videos' ? edit('videos', node('videos')) : item)} editor={editor} />);
      await waitFor(() => expect(container.querySelector('[data-id="videos"]')).not.toHaveAttribute('data-empty'));
      expect(container.querySelector('[data-id="videos"] .lm-cardgrid__content')).toHaveTextContent('videos');
    } finally { rect.mockRestore(); globalThis.ResizeObserver = originalObserver; }
  });

  it('reordering, adding and removing follow the list with no animation where motion cannot run', () => {
    const { container, rerender } = render(<CardGrid items={items(['a', 'card'], ['b', 'card'])} />);
    const ids = () => Array.from(container.querySelectorAll<HTMLElement>('.lm-cardgrid__cell')).map((c) => c.dataset.id);
    rerender(<CardGrid items={items(['b', 'card'], ['a', 'card'])} />);
    expect(ids()).toEqual(['b', 'a']);
    rerender(<CardGrid items={items(['b', 'card'], ['c', 'tile'], ['a', 'card'])} />);
    expect(ids()).toEqual(['b', 'c', 'a']);
    rerender(<CardGrid items={items(['c', 'tile'])} />);
    expect(ids()).toEqual(['c']);
    expect(screen.getByLabelText('c')).toBeInTheDocument();
  });

  it('equalRows is opt-in', () => {
    const { container, rerender } = render(<CardGrid items={items(['a', 'tile'], ['b', 'tile'])} />);
    expect(container.querySelector('.lm-cardgrid')).not.toHaveAttribute('data-equal');
    rerender(<CardGrid equalRows items={items(['a', 'tile'], ['b', 'tile'])} />);
    expect(container.querySelector('.lm-cardgrid')).toHaveAttribute('data-equal', 'true');
  });

  it('a label makes the cards one named group', () => {
    render(<CardGrid label="Today's cards" items={items(['a', 'card'])} />);
    expect(screen.getByRole('group', { name: "Today's cards" })).toBeInTheDocument();
  });
});
