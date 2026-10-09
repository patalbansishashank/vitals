// Visceral view components: render, accessible names, the plate's parts, reference marks, ghost, finite attributes, the
// eased follow.
import { act, render, renderHook, screen } from '@testing-library/react';
import {
  estimateInitialState,
  lerpAvatarParams,
  liveEstimate,
  stateToAvatarParams,
  type BodyState,
  type Sex,
} from '@/engine/body';
import { visceralWords } from '@/features/body/avatar/describe';
import { VisceralSection, VisceralView, lerpVisceral, liveVisceral, useVisceralTween } from './index';

const man = estimateInitialState({ sex: 'male', ageYears: 40, heightCm: 178, weightKg: 88, waistCm: 96 });
const withVat = (s: BodyState, vatKg: number): BodyState => ({ ...s, fat: { ...s.fat, vatKg } });
const p = stateToAvatarParams(withVat(man, 2.82));

function numericAttrs(container: HTMLElement): string[] {
  const out: string[] = [];
  container.querySelectorAll('svg *').forEach((el) => {
    for (const a of Array.from(el.attributes))
      if (/^(d|cx|cy|r|x|y|viewBox|font-size)$/.test(a.name)) out.push(a.value);
  });
  return out;
}

describe('VisceralView', () => {
  it('renders one image named by visceralWords, the slice inside it', () => {
    render(<VisceralView params={p} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAccessibleName(visceralWords(p.visceral));
    expect(img).toHaveAccessibleName(
      /^Waist slice\. Visceral fat about 160 square centimetres, likely \d+ to \d+: in the high band/,
    );
    expect(img).toContainElement(screen.getByTestId('visc-section'));
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it('draws an axial slice: fat under the skin, muscles, vertebra, vessels, bowel loops in the deep fat', () => {
    const { container } = render(<VisceralView params={p} />);
    const svg = screen.getByTestId('visc-section');
    for (const id of ['visc-sat', 'visc-muscle', 'visc-deep', 'visc-organs', 'visc-spine', 'visc-vessels', 'visc-fascia'])
      expect(screen.getByTestId(id), id).toBeInTheDocument();
    expect(screen.getAllByTestId('visc-psoas')).toHaveLength(2);
    // bowel loops (each with its lumen) and the two colons; no old slab, no single organ blob, no "organs" label
    const loops = screen.getByTestId('visc-organs');
    expect(loops.querySelectorAll('[data-kind="colon"]')).toHaveLength(2);
    expect(loops.querySelectorAll('[data-kind="bowel"]').length).toBeGreaterThanOrEqual(10);
    expect(loops.querySelectorAll('.lm-visc__lumen').length).toBe(loops.querySelectorAll('.lm-visc__loop').length);
    expect(svg.querySelector('.lm-visc__slab')).toBeNull();
    expect(screen.queryByText('organs')).toBeNull();
    // the deep fat is the cavity's fill, under the loops; the vertebra and vessels sit on top
    const deep = screen.getByTestId('visc-deep');
    expect(deep.getAttribute('fill')).toMatch(/^url\(#/);
    expect(deep.compareDocumentPosition(loops) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // the likely range: a soft band masked from its low to its high end, clipped inside the muscle
    const band = screen.getByTestId('visc-halo');
    const mask = container.querySelector(`mask${band.getAttribute('mask')!.replace(/^url\((#[^)]+)\)$/, '$1')}`);
    expect(mask?.querySelector('path')?.getAttribute('d')?.match(/M/g)).toHaveLength(2); // outer and inner edge
    expect(band.parentElement?.getAttribute('clip-path')).toMatch(/^url\(#/);
  });

  it('shows the plain-word legend (the layer names of the 3D figure) and numbers, no CT jargon', () => {
    const { container } = render(<VisceralView params={p} />);
    for (const w of ['Fat around organs', 'Fat under skin', 'Muscle', 'Bowel and organs', 'Likely range'])
      expect(screen.getByText(w), w).toBeInTheDocument();
    expect(screen.getByText('100 and 130 cm² outlines')).toBeInTheDocument();
    expect(screen.getByText('typical')).toBeInTheDocument();
    expect(screen.getByText('raised')).toBeInTheDocument();
    expect(screen.getByText('high')).toHaveAttribute('data-current');
    expect(screen.getByText('about 160 cm²')).toBeInTheDocument();
    expect(container.textContent).toMatch(/\(likely \d+–\d+\)/);
    expect(container.textContent).not.toMatch(/L3|L4|L5|CT|VAT|SAT|HU\b/);
    expect(container.textContent).toMatch(/not a scan/);
  });

  it('places the chrome on one margin: locator and key at the top, "front" on the slice, the scale bottom right', () => {
    const { container } = render(<VisceralView params={p} />);
    const plate = container.querySelector('.lm-visc__plate')!;
    // the locator and the key to the dashed outlines are the plate's own corners
    expect(plate.querySelector(':scope > .lm-visc__locator')).not.toBeNull();
    const key = plate.querySelector(':scope > .lm-visc__key')!;
    expect(key.querySelector('[data-tag="100"]')).toHaveTextContent('100 cm²');
    expect(key.querySelector('[data-tag="130"]')).toHaveTextContent('130 cm²');
    expect(key.querySelector('[data-ref="100"]')).not.toBeNull();
    // "front" belongs to the drawing (it sits just above the slice)
    expect(container.querySelector('.lm-visc__panels > .lm-visc__front')).toHaveTextContent('front');
    // the scale bar sits in the fit box beside the drawing (CSS puts it bottom right on the margin) and its length
    // is the drawing's true scale: --vs-sf = scale cm / drawing width cm
    const scale = screen.getByTestId('visc-scale');
    expect(scale.parentElement).toHaveClass('lm-visc__fit');
    expect(scale).toHaveTextContent(/^10 cm$/);
    const vb = screen.getByTestId('visc-section').getAttribute('viewBox')!.split(' ').map(Number);
    const sf = Number(scale.style.getPropertyValue('--vs-sf'));
    expect(sf * vb[2]!).toBeCloseTo(10, 2);
    expect(container.querySelector('[data-ref="100"]')).not.toBeNull();
    expect(screen.getByTestId('visc-slice-line')).toBeInTheDocument();
    expect(screen.queryByTestId('visc-ghost')).toBeNull();
  });

  it('three bodies: lean packs the loops, high deep fat spreads them in fat; every number finite', () => {
    const lean = stateToAvatarParams(liveEstimate({ sex: 'male', ageYears: 25, heightCm: 185, weightKg: 64 }));
    const mid = stateToAvatarParams(liveEstimate({ sex: 'male', ageYears: 45, heightCm: 178, weightKg: 84 }));
    const high = stateToAvatarParams(liveEstimate({ sex: 'male', ageYears: 55, heightCm: 175, weightKg: 128 }));
    const share: number[] = [];
    for (const b of [lean, mid, high]) {
      const { container, unmount } = render(<VisceralView params={b} />);
      expect(screen.getByRole('img')).toHaveAccessibleName(visceralWords(b.visceral));
      for (const v of numericAttrs(container)) expect(v).not.toMatch(/NaN|Infinity/);
      share.push(b.visceral.organsAreaCm2 / (b.visceral.organsAreaCm2 + b.visceral.vatAreaCm2));
      unmount();
    }
    // the organs' share of the cavity falls from lean to high: the drawing's loops go from packed to spread
    expect(share[0]!).toBeGreaterThan(share[1]!);
    expect(share[1]!).toBeGreaterThan(share[2]!);
  });

  it('says what the likely range spans, and shows the caption and how line', () => {
    const v = liveVisceral(p.visceral);
    render(<VisceralView params={p} caption="Drawn to scale." how="Grade C." />);
    // man 2.82 kg: about 164 cm2, range wide enough to leave the high band
    expect(v.areaRangeCm2[0]).toBeLessThan(130);
    expect(screen.getByTestId('visc-span')).toHaveTextContent(/^The range (reaches raised|spans all three bands)\. A waist measurement narrows it\.$/);
    expect(screen.getByText('Drawn to scale.')).toBeInTheDocument();
    expect(screen.getByText('Grade C.')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName(/though the range (reaches raised|spans all three bands)/);
  });

  it('a narrow range inside one band adds no span line', () => {
    const lean = stateToAvatarParams(withVat(man, 0.4));
    render(<VisceralView params={lean} />);
    expect(screen.queryByTestId('visc-span')).toBeNull();
  });

  it('names the start in the image when comparing', () => {
    const before = stateToAvatarParams(withVat(man, 3.5));
    render(<VisceralView params={p} compareTo={before} />);
    expect(screen.getByRole('img')).toHaveAccessibleName(/At the start: about \d+ square centimetres\.$/);
  });

  it('draws a ghost of the start state when comparing', () => {
    const before = stateToAvatarParams(withVat(man, 3.5));
    render(<VisceralView params={p} compareTo={before} />);
    const ghost = screen.getByTestId('visc-ghost');
    expect(ghost.querySelector('[data-ghost="outline"]')).not.toBeNull();
    expect(ghost.querySelector('[data-ghost="deep"]')).not.toBeNull();
    expect(screen.getByText('Grey lines: the start')).toBeInTheDocument();
  });

  it('uses the frame-accurate band on interpolated params', () => {
    const lo = stateToAvatarParams(withVat(man, 0.5));
    const mid = lerpAvatarParams(lo, p, 0.9);
    expect(mid.visceral.band).toBe('typical'); // the engine keeps the start band until t = 1
    expect(liveVisceral(mid.visceral).band).toBe('high');
    render(<VisceralView params={mid} />);
    expect(screen.getByRole('img')).toHaveAccessibleName(/in the high band/);
  });

  it('no NaN or Infinity in any attribute across a body matrix', () => {
    for (const sex of ['male', 'female'] as Sex[])
      for (const bmi of [16, 25, 45])
        for (const heightCm of [150, 200]) {
          const e = liveEstimate({ sex, ageYears: 50, heightCm, weightKg: bmi * (heightCm / 100) ** 2 });
          const { container, unmount } = render(
            <VisceralView params={stateToAvatarParams(e)} compareTo={p} />,
          );
          for (const v of numericAttrs(container))
            expect(v, `${sex} ${bmi} ${heightCm}`).not.toMatch(/NaN|Infinity/);
          unmount();
        }
  });
});

describe('VisceralSection standalone', () => {
  it('section is its own image with legend by default; legend can be hidden', () => {
    const { unmount } = render(<VisceralSection params={p} />);
    expect(screen.getByRole('img')).toHaveAccessibleName(visceralWords(p.visceral));
    expect(screen.getByText('Muscle')).toBeInTheDocument();
    unmount();
    render(<VisceralSection params={p} legend={false} label="Slice" />);
    expect(screen.getByRole('img', { name: 'Slice' })).toBeInTheDocument();
    expect(screen.queryByText('Muscle')).toBeNull();
  });
});

describe('the drawing follows its numbers', () => {
  const hi = stateToAvatarParams(withVat(man, 3.5)).visceral;

  afterEach(() => document.documentElement.removeAttribute('data-motion'));

  it('lerpVisceral eases every number and keeps the band and thresholds of the target', () => {
    const lo = p.visceral;
    expect(lerpVisceral(lo, hi, 0).vatAreaCm2).toBe(lo.vatAreaCm2);
    expect(lerpVisceral(lo, hi, 1)).toBe(hi);
    const mid = lerpVisceral(lo, hi, 0.5);
    expect(mid.vatAreaCm2).toBeCloseTo((lo.vatAreaCm2 + hi.vatAreaCm2) / 2, 9);
    expect(mid.waist.halfWidthCm).toBeCloseTo((lo.waist.halfWidthCm + hi.waist.halfWidthCm) / 2, 9);
    expect(mid.areaRangeCm2[1]).toBeCloseTo((lo.areaRangeCm2[1] + hi.areaRangeCm2[1]) / 2, 9);
    expect(mid.band).toBe(hi.band);
    expect(mid.thresholdsCm2).toBe(hi.thresholdsCm2);
  });

  it('snaps to new numbers under reduced motion', () => {
    document.documentElement.setAttribute('data-motion', 'reduce');
    const { result, rerender } = renderHook(({ v }) => useVisceralTween(v), { initialProps: { v: p.visceral } });
    rerender({ v: hi });
    expect(result.current).toBe(hi);
  });

  it('eases to new numbers otherwise, while the words say the target at once', () => {
    document.documentElement.setAttribute('data-motion', 'full');
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    try {
      const { result, rerender } = renderHook(({ v }) => useVisceralTween(v), { initialProps: { v: p.visceral } });
      rerender({ v: hi });
      act(() => vi.advanceTimersByTime(48));
      const shown = result.current.vatAreaCm2;
      expect(shown).toBeGreaterThan(p.visceral.vatAreaCm2);
      expect(shown).toBeLessThan(hi.vatAreaCm2);
      act(() => vi.advanceTimersByTime(2000));
      expect(result.current).toBe(hi);
    } finally {
      vi.useRealTimers();
    }
  });
});
