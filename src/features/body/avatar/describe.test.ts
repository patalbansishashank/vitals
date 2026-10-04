// Accessible wording (R2 sec. 3.4 / 4.3, body-figure-v2.md §8): frame in shape words, never sex or gender words; the
// two-layer and ghost states; visceral text with the range, the bands and the reference rings.
import { liveEstimate, stateToAvatarParams, type AvatarParams, type Sex } from '@/engine/body';
import { DRAWING, FIGURE } from '../copy';
import {
  FRAME_RATIO_CUTS,
  FRAME_SLIDER_WORDS,
  describeAvatar,
  frameRatio,
  frameSliderWords,
  frameWords,
  rangeSpanWords,
  roundArea,
  visceralWords,
} from './describe';
import { resolveFrame } from './sections';

const FORBIDDEN = /\b(female|male|man|woman|men|women|masculine|feminine|neutral|base|type [ab]|body type|sex|gender)\b/i;

function params(sex: Sex, bmi: number, heightCm = sex === 'male' ? 178 : 165): AvatarParams {
  return stateToAvatarParams(
    liveEstimate({ sex, ageYears: 40, heightCm, weightKg: bmi * (heightCm / 100) ** 2 }),
  );
}

describe('resolveFrame', () => {
  it('resolves frame > params.figure.frame > sex, clamped', () => {
    const p = params('female', 24);
    expect(resolveFrame(p)).toBe(0);
    expect(resolveFrame({ ...p, figure: { ...p.figure, frame: 0.3 } })).toBe(0.3);
    expect(resolveFrame(p, 0.4)).toBe(0.4);
    expect(resolveFrame(p, 7)).toBe(1);
    expect(resolveFrame(p, -1)).toBe(0);
    expect(resolveFrame(p, Number.NaN)).toBe(0.5);
  });
});

describe('describeAvatar / frameWords', () => {
  it('never uses sex or gender words, for any body, frame or legacy base', () => {
    for (const sex of ['male', 'female'] as Sex[])
      for (const bmi of [16, 22, 30, 45])
        for (const frame of [0, 0.25, 0.5, 0.75, 1]) {
          const p = params(sex, bmi);
          const full = describeAvatar(p, { frame, layers: 'two-layer', compareTo: params(sex, bmi + 3), visceral: true });
          expect(full, `${sex} ${bmi} ${frame}`).not.toMatch(FORBIDDEN);
          expect(frameWords(p, frame)).not.toMatch(FORBIDDEN);
          expect(frameSliderWords(p, frame)).not.toMatch(FORBIDDEN);
        }
  });

  it('the Frame slider and the drawing copy carry no sex or gender words', () => {
    for (const w of FRAME_SLIDER_WORDS) expect(w).not.toMatch(FORBIDDEN);
    for (const [k, v] of Object.entries(DRAWING)) expect(v, k).not.toMatch(FORBIDDEN);
    for (const k of ['adjustDrawing', 'loadDetailed', 'slowSwitch', 'visceralCaption', 'visceralHow', 'visceralHowLink'] as const)
      expect(FIGURE[k], k).not.toMatch(FORBIDDEN);
    for (const o of FIGURE.views) expect(o.label).not.toMatch(FORBIDDEN);
  });

  it('slider words are the same five bins as the description', () => {
    const p = params('male', 24);
    for (const frame of [0, 0.25, 0.5, 0.75, 1]) {
      const i = FRAME_SLIDER_WORDS.indexOf(frameSliderWords(p, frame) as (typeof FRAME_SLIDER_WORDS)[number]);
      expect(i).toBeGreaterThanOrEqual(0);
      // both read the same drawn ratio
      const long = frameWords(p, frame);
      expect(long.startsWith(FRAME_SLIDER_WORDS[i]!.split(' ')[0]!) || FRAME_SLIDER_WORDS[i] === 'about even').toBe(true);
    }
  });

  it('says how it is drawn: two layers, the start outline and the visceral view', () => {
    const p = params('female', 30);
    const start = params('female', 34);
    const plain = describeAvatar(p);
    expect(plain).not.toMatch(/two layers|outline|Waist slice/);
    const full = describeAvatar(p, { layers: 'two-layer', compareTo: start, visceral: true, muscle: 'Muscle as expected for this size.' });
    expect(full).toMatch(/Muscle as expected for this size\./);
    expect(full).toMatch(/Drawn in two layers: lean tissue inside, fat as a see-through outer layer\./);
    expect(full).toMatch(/Grey outline behind it: the start, at \d+ percent body fat\./);
    expect(full).toMatch(/Waist slice\. Visceral fat about \d+ square centimetres, likely \d+ to \d+: in the (typical|raised|high) band/);
    expect(full).toMatch(/At the start: about \d+ square centimetres\.$/);
    expect(describeAvatar(p, { layers: 'envelope' })).not.toMatch(/two layers/);
  });

  it('reads like the R2 example and follows the drawn ratio', () => {
    const p = params('male', 24);
    expect(describeAvatar(p, { heightText: '178 cm' })).toMatch(
      /^Figure, 178 cm, shoulders (clearly|a little) wider than hips\. Estimated body fat \d+ percent/,
    );
    // the frame moves the drawn ratio: shoulders-led >= hips-led
    expect(frameRatio(p, 1)).toBeGreaterThan(frameRatio(p, 0));
  });

  it('uses all five bins over the cut points', () => {
    const words = new Set<string>();
    for (const sex of ['male', 'female'] as Sex[])
      for (let bmi = 15; bmi <= 60; bmi += 1)
        for (const frame of [0, 1]) {
          const p = params(sex, bmi);
          const r = frameRatio(p, frame);
          const w = frameWords(p, frame);
          words.add(w);
          if (r < FRAME_RATIO_CUTS[0]) expect(w).toBe('hips clearly wider than shoulders');
          else if (r >= FRAME_RATIO_CUTS[3]) expect(w).toBe('shoulders clearly wider than hips');
        }
    expect(words.size).toBeGreaterThanOrEqual(4);
  });
});

describe('visceralWords', () => {
  it('produces the design sentence: range, band, what the range spans, thresholds, rings, fat under the skin', () => {
    const text = visceralWords({
      vatAreaCm2: 164.1,
      satAreaCm2: 188,
      band: 'high',
      thresholdsCm2: [100, 130],
      areaRangeCm2: [95, 270],
    });
    expect(text).toBe(
      'Waist slice. Visceral fat about 160 square centimetres, likely 95 to 270: in the high band, though the range spans all three bands ' +
        '(under 100 is typical, 100 to 130 raised, 130 and over high). The deep fat reaches past the dashed 130 ring. ' +
        'Fat under the skin about 190 square centimetres.',
    );
    expect(roundArea(47)).toBe(45);
    expect(roundArea(-3)).toBe(0);
  });

  it('without a range it keeps to the band; the band follows the area, not a stale engine band', () => {
    const text = visceralWords({ vatAreaCm2: 80, satAreaCm2: 120, band: 'high', thresholdsCm2: [100, 130] });
    expect(text).toMatch(/^Waist slice\. Visceral fat about 80 square centimetres, in the typical band \(under 100/);
    expect(text).toMatch(/stays inside the dashed 100 ring/);
    expect(visceralWords({ vatAreaCm2: 115, satAreaCm2: 120, thresholdsCm2: [100, 130] })).toMatch(/between the dashed 100 and 130 rings/);
  });

  it('rangeSpanWords: nothing inside one band, "reaches" for one more, "spans all three"', () => {
    expect(rangeSpanWords({ vatAreaCm2: 60, areaRangeCm2: [40, 90] })).toBe('');
    expect(rangeSpanWords({ vatAreaCm2: 140, areaRangeCm2: [120, 180] })).toBe('the range reaches raised');
    expect(rangeSpanWords({ vatAreaCm2: 90, areaRangeCm2: [60, 110] })).toBe('the range reaches raised');
    expect(rangeSpanWords({ vatAreaCm2: 160, areaRangeCm2: [95, 270] })).toBe('the range spans all three bands');
  });

  it('adds the start when comparing', () => {
    const v = params('female', 30).visceral;
    const s0 = params('female', 36).visceral;
    expect(visceralWords(v, { compareTo: s0 })).toMatch(/At the start: about \d+ square centimetres\.$/);
  });

  it('works on engine params', () => {
    const v = params('female', 30).visceral;
    expect(visceralWords(v)).toMatch(
      /^Waist slice\. Visceral fat about \d+ square centimetres, likely \d+ to \d+: in the (typical|raised|high) band/,
    );
    expect(visceralWords(v)).not.toMatch(FORBIDDEN);
  });
});
