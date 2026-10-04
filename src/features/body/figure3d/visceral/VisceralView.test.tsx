// Visceral view components: render, accessible names, reference marks, ghost, finite attributes.
import { render, screen } from '@testing-library/react';
import {
  estimateInitialState,
  lerpAvatarParams,
  liveEstimate,
  stateToAvatarParams,
  type BodyState,
  type Sex,
} from '@/engine/body';
import { visceralWords } from '@/features/body/avatar/describe';
import { VisceralCutaway, VisceralSection, VisceralView, liveVisceral } from './index';

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
  it('renders one image named by visceralWords, with both panels inside', () => {
    render(<VisceralView params={p} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAccessibleName(visceralWords(p.visceral));
    expect(img).toHaveAccessibleName(
      /^Waist slice\. Visceral fat about 160 square centimetres, likely \d+ to \d+: in the high band/,
    );
    expect(screen.getByTestId('visc-cutaway')).toBeInTheDocument();
    expect(screen.getByTestId('visc-section')).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it('shows the plain-word legend and numbers, no CT jargon', () => {
    const { container } = render(<VisceralView params={p} />);
    expect(screen.getByText('Under the skin (you can pinch it)')).toBeInTheDocument();
    expect(screen.getByText('Deep, around the organs (visceral)')).toBeInTheDocument();
    expect(screen.getByText('Muscle wall')).toBeInTheDocument();
    expect(screen.getByText('typical')).toBeInTheDocument();
    expect(screen.getByText('raised')).toBeInTheDocument();
    expect(screen.getByText('high')).toHaveAttribute('data-current');
    expect(screen.getByText('about 160 cm²')).toBeInTheDocument();
    expect(container.textContent).toMatch(/\(likely \d+–\d+\)/);
    expect(container.textContent).not.toMatch(/L4|L5|CT|VAT|SAT|HU\b/);
    expect(container.textContent).toMatch(/front/);
  });

  it('draws the reference rings, halo, scale bar and slice line', () => {
    const { container } = render(<VisceralView params={p} />);
    expect(container.querySelector('[data-ref="100"]')).not.toBeNull();
    expect(container.querySelector('[data-ref="130"]')).not.toBeNull();
    expect(screen.getByTestId('visc-halo')).toBeInTheDocument();
    expect(screen.getByTestId('visc-scale')).toHaveTextContent(/\d+ cm/);
    expect(screen.getByTestId('visc-slice-line')).toBeInTheDocument();
    expect(screen.queryByTestId('visc-ghost')).toBeNull();
  });

  it('says what the likely range spans, and shows the caption and how line', () => {
    const v = liveVisceral(p.visceral);
    render(<VisceralView params={p} caption="Waist slice, drawn to scale." how="Grade C." />);
    // man 2.82 kg: about 164 cm2, range wide enough to leave the high band
    expect(v.areaRangeCm2[0]).toBeLessThan(130);
    expect(screen.getByTestId('visc-span')).toHaveTextContent(/^The range (reaches raised|spans all three bands)\. A waist measurement narrows it\.$/);
    expect(screen.getByText('Waist slice, drawn to scale.')).toBeInTheDocument();
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

describe('VisceralSection / VisceralCutaway standalone', () => {
  it('section is its own image with legend by default; legend can be hidden', () => {
    const { unmount } = render(<VisceralSection params={p} />);
    expect(screen.getByRole('img')).toHaveAccessibleName(visceralWords(p.visceral));
    expect(screen.getByText('Muscle wall')).toBeInTheDocument();
    unmount();
    render(<VisceralSection params={p} legend={false} label="Slice" />);
    expect(screen.getByRole('img', { name: 'Slice' })).toBeInTheDocument();
    expect(screen.queryByText('Muscle wall')).toBeNull();
  });

  it('cutaway is an image describing the deep-fat share', () => {
    render(<VisceralCutaway params={p} />);
    expect(screen.getByRole('img')).toHaveAccessibleName(
      /^Side view of the belly, cut open\. Deep fat fills about \d+ percent/,
    );
  });
});
