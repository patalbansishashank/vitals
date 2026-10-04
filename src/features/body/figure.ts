/**
 * What the figure draws and where every shape slider sits.
 *
 * The sliders describe the FIGURE ("start from our estimate, then match the figure to how you look", your-body.md
 * §6); the Estimates panel shows the engine's fused posterior, which weighs the figure (σ 5.5 %BF) against the
 * equations, the waist and the training history (dossier 14 M3). So:
 *   - body fat touched            → the figure is drawn at that body fat (engine `bodyFatPctOverride`);
 *   - only muscle touched         → the figure carries that muscularity at the user's real weight
 *                                   (BF = 1 − FFMI·h²/W), unless a measured body fat anchors it;
 *   - nothing touched             → the figure is the posterior estimate.
 * Weight is always the hard constraint (FM + FFM = W), so the drawing is always a real, valid body.
 * Untouched sliders display the figure's own values and are never written back (engine unused-slider rule).
 */
import {
  estimateInitialState,
  ffmiToSlider,
  lerpAvatarParams,
  sliderToFfmi,
  stateToAvatarParams,
  zToBellySlider,
  type AvatarParams,
  type BodyEstimate,
  type Sex,
} from '@/engine/body';
import { figureFrameOf, type BodyProfileValues, type ShapeInputs } from '@/state/profileStore';
import { bodyInputsFor, displaySexes, effectiveBasics, equationSex, touchedMuscularity, type BodySummary } from './model';

export type ShownShape = Required<ShapeInputs>;
export type ShareRegion = 'belly' | 'hips' | 'chest' | 'arms';

export interface FigureView {
  /** What the figure draws, with the drawing-only frame applied (`stateToAvatarParams(…, { frame })`). */
  params: AvatarParams;
  /** Drawing-only frame 0..1 (0 = hips-led, 1 = shoulders-led): stored, or "match my basics". */
  frame: number;
  /** Body fat the figure is drawn at (= the body-fat slider's position). */
  bodyFatPct: number;
  /** Slider positions: touched values or the figure's own. */
  shown: ShownShape;
  /** Each region's share of total fat on the figure, % (head/neck not listed). */
  shares: Record<ShareRegion, number>;
  /** Waist girth of the figure, cm (the locked waist scale shows it). */
  waistCm: number;
  ffmi: number;
  /** The figure differs from the estimate by ≥ 1.5 points of body fat. */
  diverges: boolean;
  /** Engine estimate the P50 figure was drawn from. */
  estimate: BodyEstimate;
  /** Muscle scales for this body: words relative to what its numbers imply, and where that expectation sits. */
  muscle: MuscleScale;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** The same params drawn at another frame (frame changes nothing else; engine figure contract). */
export function withFrame(params: AvatarParams, frame: number): AvatarParams {
  return params.figure.frame === frame ? params : { ...params, figure: { ...params.figure, frame } };
}

/** Body fat at which a body of this weight carries the given muscularity (engine anchors), %. */
export function muscleImpliedBodyFat(sex: Sex, muscularity: number, heightCm: number, weightKg: number): number {
  const ffmi = sliderToFfmi(sex, muscularity);
  const h2 = (heightCm / 100) ** 2;
  return clamp(100 * (1 - (ffmi * h2) / weightKg), 4, 60);
}

/**
 * Muscle scales in words RELATIVE to what the numbers alone imply for this body. The engine's muscularity scale is
 * absolute (FFMI anchors, dossier 14 T3), and a larger body carries more lean mass, so absolute descriptors would
 * call a heavy untrained body "bodybuilder-class". Instead each position is compared with the lean mass index the
 * engine expects from height, weight, age, training and any measurement (the estimate without the visual scales),
 * in units of that estimate's own SD: |z| ≤ 0.5 "as expected", ≤ 1.5 "less / more than expected", beyond "much …".
 */
export function muscleWordsForZ(z: number): string {
  if (z < -1.5) return 'much less than expected';
  if (z < -0.5) return 'less than expected';
  if (z <= 0.5) return 'as expected';
  if (z <= 1.5) return 'more than expected';
  return 'much more than expected';
}

export interface MuscleScale {
  /** Words for a slider position ("as expected", "more than expected" …). */
  words: (position: number) => string;
  /** z of a slider position against the expectation. */
  z: (position: number) => number;
  /** Slider position of the expectation (the scales' reference tick). */
  expected: number;
  /** Lean mass index expected for this body, kg/m². */
  expectedFfmi: number;
  /** Words for the figure as drawn. */
  figureWords: string;
}

function muscleScale(v: BodyProfileValues, sex: Sex, figureFfmi: number): MuscleScale {
  const b = effectiveBasics(v);
  const h2 = (b.heightCm / 100) ** 2;
  // the estimate from everything except the visual scales
  const blind = estimateInitialState(bodyInputsFor({ ...v, shape: { ...v.shape, bodyFatPct: undefined, muscleUpper: undefined, muscleLower: undefined } }, sex));
  const expectedFfmi = blind.ffmi;
  const sd = Math.max((b.weightKg * blind.bodyFatSdPct) / 100 / h2, 0.25);
  const z = (position: number) => (sliderToFfmi(sex, position) - expectedFfmi) / sd;
  return {
    z,
    words: (position) => muscleWordsForZ(z(position)),
    expected: ffmiToSlider(sex, expectedFfmi),
    expectedFfmi,
    figureWords: muscleWordsForZ((figureFfmi - expectedFfmi) / sd),
  };
}

interface PerSex {
  sex: Sex;
  fig: BodyEstimate;
  bf: number;
  params: AvatarParams;
}

export function deriveFigure(v: BodyProfileValues, summary: BodySummary): FigureView {
  const basics = effectiveBasics(v);
  const eqSex = equationSex(v);
  const m = touchedMuscularity(v.shape);
  const measuredBf = v.knownBodyFat.use && v.knownBodyFat.pct !== null;
  const frame = figureFrameOf(v);

  const per: PerSex[] = displaySexes(v).map((sex) => {
    const inputs = bodyInputsFor(v, sex);
    const posterior = sex === eqSex ? summary.estimate : estimateInitialState(inputs);
    let bf = posterior.bodyFatPct;
    if (v.shape.bodyFatPct !== undefined) bf = v.shape.bodyFatPct;
    else if (m !== undefined && !measuredBf) bf = muscleImpliedBodyFat(sex, m, basics.heightCm, basics.weightKg);
    const fig = Math.abs(bf - posterior.bodyFatPct) < 0.01 ? posterior : estimateInitialState(inputs, { bodyFatPctOverride: bf });
    return { sex, fig, bf, params: stateToAvatarParams(fig, { frame }) };
  });

  const first = per[0]!;
  const eqFig = (per.find((p) => p.sex === eqSex) ?? first).fig;
  const params = per.length === 1 ? first.params : lerpAvatarParams(per[0]!.params, per[1]!.params, 0.5);
  const fatOf = (f: (e: BodyEstimate) => number) => mean(per.map((p) => f(p.fig)));
  const totalFat = fatOf((e) => e.fatMassKg);
  const share = (kg: number) => (totalFat > 0 ? (100 * kg) / totalFat : 0);
  const bodyFatPct = mean(per.map((p) => p.bf));
  const musclePos = mean(per.map((p) => ffmiToSlider(p.sex, p.fig.ffmi)));

  const waistMeasured = v.waist.use && v.waist.cm !== null;
  const hips = v.shape.hips ?? 0;
  const belly = waistMeasured ? clamp(fatOf((e) => zToBellySlider(e.bellyZ)) + hips, -1, 1) : (v.shape.belly ?? 0);

  return {
    params,
    frame,
    bodyFatPct,
    shown: {
      bodyFatPct,
      belly,
      hips,
      chest: v.shape.chest ?? 0,
      arms: v.shape.arms ?? 0,
      muscleUpper: v.shape.muscleUpper ?? musclePos,
      muscleLower: v.shape.muscleLower ?? musclePos,
    },
    shares: {
      belly: share(fatOf((e) => e.satSplitKg.abdominal + e.satSplitKg.backFlank + e.fat.vatKg)),
      hips: share(fatOf((e) => e.fat.legsKg)),
      chest: share(fatOf((e) => e.satSplitKg.chest)),
      arms: share(fatOf((e) => e.fat.armsKg)),
    },
    waistCm: fatOf((e) => e.circumferences.waistCm),
    ffmi: fatOf((e) => e.ffmi),
    diverges: Math.abs(bodyFatPct - summary.bodyFatPct) >= 1.5,
    estimate: eqFig,
    muscle: muscleScale(v, eqSex, eqFig.ffmi),
  };
}
