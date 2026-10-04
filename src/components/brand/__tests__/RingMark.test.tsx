import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render } from '@testing-library/react';
import { RingMark } from '../RingMark';
import { PALETTE, SMALL, STANDARD, trimOffset } from '../geometry';

const brandCss = readFileSync(path.resolve(__dirname, '..', 'brand.css'), 'utf8');

const parts = (container: HTMLElement) => {
  const svg = container.querySelector('svg')!;
  return { svg, ring: svg.querySelector('path')!, dot: svg.querySelector('circle')! };
};

afterEach(() => document.documentElement.removeAttribute('data-motion'));

describe('RingMark', () => {
  it('is 22 px, decorative and theme-aware by default (the wordmark beside "vitals")', () => {
    const { svg, ring, dot } = parts(render(<RingMark />).container);
    expect(svg).toHaveAttribute('width', '22');
    expect(svg).toHaveAttribute('height', '22');
    expect(svg).toHaveAttribute('viewBox', '18 18 72 72');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg).not.toHaveAttribute('role');
    expect(svg).toHaveAttribute('data-tone', 'auto');
    expect(ring).toHaveAttribute('stroke', 'var(--lm-ink)');
    expect(dot).toHaveAttribute('fill', 'var(--lm-signal)');
    expect(dot).toHaveAttribute('stroke', 'var(--lm-signal-edge)');
  });

  it('uses the small cut at 32 px and under, the standard cut above', () => {
    const small = parts(render(<RingMark size={32} />).container);
    expect(small.svg).toHaveAttribute('data-cut', 'small');
    expect(small.ring).toHaveAttribute('d', SMALL.ring.d);
    expect(small.ring).toHaveAttribute('stroke-width', String(SMALL.ring.stroke));
    expect(small.dot).toHaveAttribute('r', String(SMALL.dot.r));
    expect(small.dot).toHaveAttribute('stroke-width', String(SMALL.dot.edge));

    const standard = parts(render(<RingMark size={33} />).container);
    expect(standard.svg).toHaveAttribute('data-cut', 'standard');
    expect(standard.ring).toHaveAttribute('d', STANDARD.ring.d);
    expect(standard.ring).toHaveAttribute('stroke-width', String(STANDARD.ring.stroke));
    expect(standard.dot).toHaveAttribute('cx', String(STANDARD.dot.cx));
    expect(standard.dot).toHaveAttribute('stroke-width', String(STANDARD.dot.edge));
  });

  it('light and dark tones are the fixed palette; dark has no dot edge', () => {
    const light = parts(render(<RingMark tone="light" size={88} />).container);
    expect(light.ring).toHaveAttribute('stroke', PALETTE.light.ink);
    expect(light.dot).toHaveAttribute('fill', PALETTE.light.signal);
    expect(light.dot).toHaveAttribute('stroke', PALETTE.light.edge);
    expect(light.dot).toHaveAttribute('stroke-width', '1.5');

    const dark = parts(render(<RingMark tone="dark" size={88} />).container);
    expect(dark.ring).toHaveAttribute('stroke', PALETTE.dark.ink);
    expect(dark.dot).toHaveAttribute('fill', PALETTE.dark.signal);
    expect(dark.dot).not.toHaveAttribute('stroke');
    expect(dark.dot).not.toHaveAttribute('stroke-width');
  });

  it('mono draws ring and dot in currentColor with no edge', () => {
    const { ring, dot } = parts(render(<RingMark tone="mono" />).container);
    expect(ring).toHaveAttribute('stroke', 'currentColor');
    expect(dot).toHaveAttribute('fill', 'currentColor');
    expect(dot).not.toHaveAttribute('stroke');
  });

  it('with a title it is an image with that name', () => {
    const { getByRole } = render(<RingMark title="Vitals" />);
    const svg = getByRole('img', { name: 'Vitals' });
    expect(svg).not.toHaveAttribute('aria-hidden');
  });

  it('animate sets up the draw-on: dasharray = arc length, trim offset as a CSS var, data-animate for the CSS', () => {
    const { svg, ring } = parts(render(<RingMark size={88} animate />).container);
    expect(svg).toHaveAttribute('data-animate', 'true');
    expect(ring).toHaveAttribute('stroke-dasharray', String(STANDARD.ring.length));
    expect(svg.style.getPropertyValue('--lm-ringmark-len')).toBe(String(STANDARD.ring.length));
    expect(svg.style.getPropertyValue('--lm-ringmark-trim')).toBe(String(trimOffset(STANDARD)));
    const still = parts(render(<RingMark size={88} />).container);
    expect(still.svg).not.toHaveAttribute('data-animate');
    expect(still.ring).not.toHaveAttribute('stroke-dasharray');
  });

  // jsdom runs no animations, so the motion rules are checked in the stylesheet itself.
  it('brand.css plays the ring (500 ms, fast-out-slow-in) then the dot (220 ms from 420 ms) and stills both under reduced motion', () => {
    expect(brandCss).toMatch(/\.lm-ringmark\[data-animate\] \.lm-ringmark__ring\s*{[^}]*animation: lm-ringmark-draw 500ms cubic-bezier\(0\.4, 0, 0\.2, 1\) var\(--lm-ringmark-t0, 0ms\) both/);
    expect(brandCss).toMatch(/\.lm-ringmark\[data-animate\] \.lm-ringmark__dot\s*{[^}]*animation: lm-ringmark-pop 220ms var\(--lm-ease-needle,[^)]*\)\) calc\(420ms \+ var\(--lm-ringmark-t0, 0ms\)\) both/);
    expect(brandCss).toMatch(/@keyframes lm-ringmark-draw\s*{\s*from\s*{\s*stroke-dashoffset: var\(--lm-ringmark-trim\)/);
    expect(brandCss).toMatch(/@keyframes lm-ringmark-pop\s*{\s*from\s*{\s*transform: scale\(0\)/);
    expect(brandCss).toMatch(/:root\[data-motion='reduce'\] \.lm-ringmark__ring,\s*:root\[data-motion='reduce'\] \.lm-ringmark__dot\s*{\s*animation: none;/);
    expect(brandCss).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{\s*:root:not\(\[data-motion='full'\]\) \.lm-ringmark__ring,\s*:root:not\(\[data-motion='full'\]\) \.lm-ringmark__dot\s*{\s*animation: none;/);
  });

  it('reduced motion (data-motion="reduce") drops the animation and shows the still mark', () => {
    document.documentElement.setAttribute('data-motion', 'reduce');
    const { svg, ring } = parts(render(<RingMark size={88} animate />).container);
    expect(svg).not.toHaveAttribute('data-animate');
    expect(ring).not.toHaveAttribute('stroke-dasharray');
    expect(ring).toHaveAttribute('d', STANDARD.ring.d);
  });
});
