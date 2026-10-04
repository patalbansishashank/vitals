/**
 * Engine-agnostic optimisation core of the Planner (dossier 18). See README.md in this folder.
 * Toy problems for tests live in './toys' and are intentionally not re-exported.
 */
export * from './types';
export * from './rng';
export * from './cmaes';
export * from './goals';
export * from './archive';
export * from './conflicts';
export * from './robust';
export * from './pipeline';
export * from './hybrid';
export * from './ladder';
export * from './race';
export * from './checkpoint';
export { mean, quantile, quantileSorted, cvarLower, spearman, normCdf, normInv } from './stats';
