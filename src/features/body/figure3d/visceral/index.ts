// Visceral view (R2 sec. 3.4): waist slice + side cutaway, SVG, driven by AvatarParams.visceral.

export { VisceralView } from './VisceralView';
export type { VisceralViewProps } from './VisceralView';
export { VisceralSection, VisceralLegend, liveVisceral } from './VisceralSection';
export type { VisceralSectionProps } from './VisceralSection';
export { VisceralCutaway } from './VisceralCutaway';
export type { VisceralCutawayProps } from './VisceralCutaway';
export {
  SAMPLES,
  bisect,
  cutawayGeometry,
  ellipseRadius,
  growContour,
  lobe,
  polarArea,
  polarPoints,
  polyD,
  polygonArea,
  scaleContour,
  sliceGeometry,
  smoothD,
} from './geometry';
export type { Circle, CutawayGeometry, Pt, SliceAreas, SliceGeometry } from './geometry';
export { visceralWords } from '@/features/body/avatar/describe';
