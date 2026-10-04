// 3D figure (R2 decision c) and visceral view. Only <Figure3D> and the pure helpers are in the importing chunk; the
// WebGL renderer, fitter and asset load lazily (Figure3DCanvas).

export { Figure3D, webgl2Available } from './Figure3D';
export { FigureMorph } from './FigureMorph';
export { askDetailedFigure, isSlowDevice, saveDataPreferred } from './device';
export type { Figure3DProps } from './Figure3D';
export type { FigureView, FigureLayout } from './renderer';
export type { MeshExtent } from './Figure3DCanvas';
export type { FitResult, FitTargets } from './fit';
export type { MorphState } from './model';
export type { FigureManifest, RingId } from './manifest';
export * from './visceral';
