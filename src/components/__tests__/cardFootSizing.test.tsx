import { act, render } from '@testing-library/react';
import { CardFoot } from '../CardFoot';

it('keeps its measurement subscription for unchanged facts and still follows content/container changes', () => {
  let width = 230;
  let left = 120;
  let reads = 0;
  const observers: Array<{ targets: Set<Element>; notify: () => void; disconnected: boolean }> = [];
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('lm-cardfoot')) { reads++; return width; }
    return 300;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('lm-stateword')) return left;
    if (this.classList.contains('lm-overflow__item')) return this.closest('.lm-cardfoot__right') ? 140 : left;
    return 100;
  });
  vi.stubGlobal('ResizeObserver', class {
    targets = new Set<Element>();
    disconnected = false;
    constructor(private callback: ResizeObserverCallback) { observers.push(this); }
    observe(target: Element) { this.targets.add(target); }
    disconnect() { this.disconnected = true; }
    notify = () => this.callback([], this as unknown as ResizeObserver);
  });
  try {
    const { container, rerender, unmount } = render(<CardFoot state={{ word: 'Goal met' }} right="Goal 10,000" />);
    const foot = container.querySelector('footer')!;
    expect(foot).toHaveAttribute('data-stacked');
    const first = observers.find((observer) => observer.targets.has(foot))!;
    const initialReads = reads;

    rerender(<CardFoot state={{ word: 'Goal met' }} right="Goal 10,000" />);
    expect(reads).toBe(initialReads);
    expect(first.disconnected).toBe(false);
    expect(observers.filter((observer) => observer.targets.has(foot))).toHaveLength(1);

    width = 320;
    act(() => first.notify());
    expect(foot).not.toHaveAttribute('data-stacked');
    left = 240;
    rerender(<CardFoot state={{ word: 'A longer state description' }} right="Goal 10,000" />);
    expect(foot).toHaveAttribute('data-stacked');
    expect(first.disconnected).toBe(true);
    unmount();
    expect(observers.every((observer) => observer.disconnected)).toBe(true);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
