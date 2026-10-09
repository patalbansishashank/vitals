// Visceral view (R2 sec. 3.4): the waist slice as a plate, SVG, driven by AvatarParams.visceral.

export { VisceralView } from './VisceralView';
export type { VisceralViewProps } from './VisceralView';
export {
  VisceralLegend,
  VisceralLocator,
  VisceralPlate,
  VisceralSection,
  liveVisceral,
} from './VisceralSection';
export type { VisceralSectionProps } from './VisceralSection';
export { lerpVisceral, useVisceralTween } from './useVisceralTween';
export {
  SAMPLES,
  BACK,
  FRONT,
  bisect,
  ellipseRadius,
  polarArea,
  lineD,
  polarPoints,
  polyD,
  polygonArea,
  radiusAt,
  sliceGeometry,
  smoothD,
} from './geometry';
export type { Circle, Loop, LoopKind, Oval, Pt, SliceAreas, SliceGeometry, Vessels } from './geometry';
export { visceralWords } from '@/features/body/avatar/describe';
