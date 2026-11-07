import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardFoot, MonoMeta, OverflowText } from '@/components';

const resizeCallbacks: ResizeObserverCallback[] = [];
let intersect: IntersectionObserverCallback | null = null;

beforeEach(() => {
  resizeCallbacks.length = 0;
  intersect = null;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resizeCallbacks.push(callback); }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe() {}
    disconnect() {}
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function width(node: Element, name: 'clientWidth' | 'scrollWidth', value: number) {
  Object.defineProperty(node, name, { configurable: true, value });
}

function resize() {
  act(() => {
    for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
  });
}

describe('OverflowText', () => {
  it('duplicates and scrolls only measured overflow, then returns to static text when it fits', () => {
    const { container } = render(<OverflowText text="By bedtime 2,442 kcal · 2,193–2,690" />);
    const view = container.querySelector<HTMLElement>('.lm-overflow')!;
    const item = container.querySelector<HTMLElement>('.lm-overflow__item')!;
    width(view, 'clientWidth', 120);
    width(item, 'scrollWidth', 230);
    resize();
    expect(view).toHaveAttribute('data-overflow');
    expect(view).toHaveAttribute('tabindex', '0');
    expect(view).toHaveAttribute('aria-label', 'By bedtime 2,442 kcal · 2,193–2,690');
    expect(container.querySelector('.lm-overflow__copy')).toHaveAttribute('aria-hidden', 'true');

    width(item, 'scrollWidth', 100);
    resize();
    expect(view).not.toHaveAttribute('data-overflow');
    expect(view).not.toHaveAttribute('tabindex');
    expect(container.querySelector('.lm-overflow__copy')).toBeNull();
  });

  it('marks offscreen content paused while retaining its full accessible text', () => {
    const { container } = render(<OverflowText text="Long forecast" />);
    const view = container.querySelector<HTMLElement>('.lm-overflow')!;
    const item = container.querySelector<HTMLElement>('.lm-overflow__item')!;
    width(view, 'clientWidth', 40);
    width(item, 'scrollWidth', 120);
    resize();
    act(() => intersect?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(view).toHaveAttribute('data-visible', 'false');
    expect(view.querySelector('.lm-overflow__item')?.textContent).toBe('Long forecast');
    act(() => intersect?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(view).toHaveAttribute('data-visible', 'true');
  });

  it('measures again on resize where ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const { container } = render(<OverflowText text="Full fact" />);
    const view = container.querySelector<HTMLElement>('.lm-overflow')!;
    const item = container.querySelector<HTMLElement>('.lm-overflow__item')!;
    width(view, 'clientWidth', 40);
    width(item, 'scrollWidth', 80);
    act(() => window.dispatchEvent(new Event('resize')));
    expect(view).toHaveAttribute('data-overflow');
    width(item, 'scrollWidth', 30);
    act(() => window.dispatchEvent(new Event('resize')));
    expect(view).not.toHaveAttribute('data-overflow');
  });

  it('keeps a tab stop under programmatically focused main, but not under a focusable parent', () => {
    const { container, rerender } = render(<main tabIndex={-1}><OverflowText text="Long fact" /></main>);
    let view = container.querySelector<HTMLElement>('.lm-overflow')!;
    let item = container.querySelector<HTMLElement>('.lm-overflow__item')!;
    width(view, 'clientWidth', 40);
    width(item, 'scrollWidth', 120);
    resize();
    expect(view).toHaveAttribute('tabindex', '0');

    rerender(<div tabIndex={0}><OverflowText text="Long fact" /></div>);
    view = container.querySelector<HTMLElement>('.lm-overflow')!;
    item = container.querySelector<HTMLElement>('.lm-overflow__item')!;
    width(view, 'clientWidth', 40);
    width(item, 'scrollWidth', 120);
    resize();
    expect(view).not.toHaveAttribute('tabindex');
  });
});

describe('MonoMeta overflow routing', () => {
  it('keeps scalar and flat-array text exactly as supplied, and joins all-text items into one bounded line', () => {
    const { container, rerender } = render(<MonoMeta>{['Eat ', '12:00', '–', '20:00']}</MonoMeta>);
    expect(container.textContent).toBe('Eat 12:00–20:00');
    expect(container.querySelectorAll('.lm-overflow')).toHaveLength(1);
    rerender(<MonoMeta items={['Goal 10,000', 'Likely 9,200–10,400']} />);
    expect(container.querySelectorAll('.lm-overflow')).toHaveLength(1);
    expect(container.textContent).toBe('Goal 10,000 · Likely 9,200–10,400');
    const view = container.querySelector<HTMLElement>('.lm-overflow')!;
    const item = container.querySelector<HTMLElement>('.lm-overflow__item')!;
    width(view, 'clientWidth', 80);
    width(item, 'scrollWidth', 250);
    resize();
    expect(view).toHaveAttribute('data-overflow');
    expect(container.querySelectorAll('.lm-overflow__copy')).toHaveLength(1);
  });

  it('preserves controls and other complex children without inserting a duplicate or tab stop', () => {
    const { container, rerender } = render(<MonoMeta><button type="button">Edit goal</button></MonoMeta>);
    expect(container.querySelector('.lm-overflow')).toBeNull();
    rerender(<button type="button"><MonoMeta>Long visible fact</MonoMeta></button>);
    const view = container.querySelector<HTMLElement>('.lm-overflow')!;
    const item = container.querySelector<HTMLElement>('.lm-overflow__item')!;
    width(view, 'clientWidth', 40);
    width(item, 'scrollWidth', 120);
    resize();
    expect(view).toHaveAttribute('data-overflow');
    expect(view).not.toHaveAttribute('tabindex');
    expect(container.querySelector('button')).toHaveAttribute('type', 'button');
  });
});

describe('CardFoot', () => {
  it('keeps independent facts on opposite edges when they fit and stacks both left when they do not', () => {
    const { container } = render(<CardFoot state={{ word: 'On course' }} right="By bedtime 10,032" />);
    const foot = container.querySelector<HTMLElement>('.lm-cardfoot')!;
    const state = container.querySelector<HTMLElement>('.lm-stateword')!;
    const fact = container.querySelector<HTMLElement>('.lm-cardfoot__right .lm-overflow__item')!;
    width(foot, 'clientWidth', 250);
    width(state, 'scrollWidth', 80);
    width(fact, 'scrollWidth', 130);
    resize();
    expect(foot).not.toHaveAttribute('data-stacked');
    width(foot, 'clientWidth', 180);
    resize();
    expect(foot).toHaveAttribute('data-stacked');
    width(foot, 'clientWidth', 250);
    resize();
    expect(foot).not.toHaveAttribute('data-stacked');
  });
});
