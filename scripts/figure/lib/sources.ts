// Exact MakeHuman source files used by the figure bake (all CC0 assets; see src/features/body/figure3d/LICENSES.md).

export const SOURCE_REPO = 'makehumancommunity/makehuman';
/** master as of 2026-10-01. */
export const SOURCE_COMMIT = 'a8bc2d54ff0ac92e78ff71431b1023eda42bf482';

const DATA = 'makehuman/data';

export const BASE_OBJ = `${DATA}/3dobjs/base.obj`;
export const SKELETON = `${DATA}/rigs/default.mhskel`;
export const WEIGHTS = `${DATA}/rigs/default_weights.mhw`;
export const LICENSE = 'LICENSE.md';

export type Sex = 'female' | 'male';
export type Level = 'min' | 'average' | 'max';
export const SEXES: readonly Sex[] = ['female', 'male'];
export const LEVELS: readonly Level[] = ['min', 'average', 'max'];
export const ETHNICITIES = ['african', 'asian', 'caucasian'] as const;

/** Ethnic/age base shape for an adult ("young" = MakeHuman age 25). */
export const ethnicTarget = (eth: string, sex: Sex): string => `${DATA}/targets/macrodetails/${eth}-${sex}-young.target`;

/** Universal muscle x weight macro target for an adult. */
export const universalTarget = (sex: Sex, muscle: Level, weight: Level): string =>
  `${DATA}/targets/macrodetails/universal-${sex}-young-${muscle}muscle-${weight}weight.target`;

/**
 * Local targets used as fitting degrees of freedom, as signed pairs (weight > 0 -> incr, < 0 -> decr).
 * Each one absorbs a residual of the girth fit (R2 sec. 5.4).
 */
export const LOCALS = [
  { id: 'neck', dir: 'measure', name: 'measure-neck-circ' },
  { id: 'bust', dir: 'measure', name: 'measure-bust-circ' },
  { id: 'waist', dir: 'measure', name: 'measure-waist-circ' },
  { id: 'hips', dir: 'measure', name: 'measure-hips-circ' },
  { id: 'thigh', dir: 'measure', name: 'measure-thigh-circ' },
  { id: 'calf', dir: 'measure', name: 'measure-calf-circ' },
  { id: 'upperarm', dir: 'measure', name: 'measure-upperarm-circ' },
  { id: 'shoulders', dir: 'measure', name: 'measure-shoulder-dist' },
  { id: 'belly', dir: 'stomach', name: 'stomach-pregnant' },
  { id: 'torsoDepth', dir: 'torso', name: 'torso-scale-depth' },
  { id: 'torsoWidth', dir: 'torso', name: 'torso-scale-horiz' },
  { id: 'buttocks', dir: 'buttocks', name: 'buttocks-volume' },
] as const;

export const localTarget = (dir: string, name: string, sign: 'incr' | 'decr'): string => `${DATA}/targets/${dir}/${name}-${sign}.target`;

export function allSourceFiles(): string[] {
  const out = [BASE_OBJ, SKELETON, WEIGHTS, LICENSE];
  for (const sex of SEXES) {
    for (const eth of ETHNICITIES) out.push(ethnicTarget(eth, sex));
    for (const m of LEVELS) for (const w of LEVELS) out.push(universalTarget(sex, m, w));
  }
  for (const l of LOCALS) for (const s of ['incr', 'decr'] as const) out.push(localTarget(l.dir, l.name, s));
  return out;
}
