/** Types for scripts/android-design.mjs (the generator of the Android widget design, r071 W2). */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}
export interface HueSteps {
  solid: Rgba;
  ink: Rgba;
  deep: Rgba;
  dim: Rgba;
}
export interface Design {
  /** Where the palette came from: design/tokens.css, or the RESEARCH.md values until it has the hue tokens. */
  source: string;
  neutrals: Record<string, Rgba>;
  hues: Record<string, HueSteps>;
  glow: Record<string, { pos: [number, number]; size: [number, number]; a: number }>;
  glowK: number;
  stages: Record<string, Rgba>;
  radiusDp: number;
}
export interface Registry {
  version: number;
  targets: Record<string, string>;
  widgets: Array<{ id: string; provider: string; label: string; kind: string; hue: string; cells: [number, number]; tap: string; optIn?: boolean }>;
  icons: Record<string, string>;
}
export const ROOT: string;
export const DOMAINS: string[];
export const SIZE_CLASSES: Record<'square' | 'wide' | 'strip', number>;
export const PLACEHOLDERS: {
  hues: Record<string, { solid: string; ink: string; deep: string; dim: string }>;
  goldDeep: string;
  glow: Record<string, { pos: string; size: string; a: string }>;
  stages: Record<string, string>;
  unlit: string;
  glass: string;
  glassEdge: string;
  cardRadius: string;
};
export function parseTokens(css: string): Map<string, string>;
export function resolveToken(map: Map<string, string>, name: string): string;
export function parseColor(s: string): Rgba;
export function androidColor(c: Rgba, alpha?: number): string;
export function readDesign(tokensCss: string): Design;
export function generate(o?: { root?: string; tokensCss?: string; registry?: Registry }): Map<string, string>;
export function stale(o?: { root?: string; tokensCss?: string; registry?: Registry }): string[];
