// Parametric body avatar (design/AVATAR_SPEC.md), driven by the engine's AvatarParams (src/engine/body).
// See README.md in this folder for the component API and integration notes.

export { BodyAvatar, DEFAULT_CAPTION } from './BodyAvatar';
export type {
  BodyAvatarProps,
  AvatarInteraction,
  AvatarSize,
  DragChannel,
  DragRegion,
  HandleValue,
  MeasureId,
  RegionDragDelta,
  AvatarUnderlay,
} from './BodyAvatar';
export { AvatarMorph } from './AvatarMorph';
export type { AvatarMorphProps } from './AvatarMorph';
export {
  describeAvatar,
  fatPatternWords,
  muscularityWords,
  frameWords,
  frameSliderWords,
  frameBin,
  frameRatio,
  visceralWords,
  rangeSpanWords,
  roundArea,
  FRAME_RATIO_CUTS,
  FRAME_SLIDER_WORDS,
} from './describe';
export type { DescribeOptions } from './describe';
export {
  avatarGeometry,
  lerpGeometry,
  lerpPts,
  maxDisplacement,
  pathD,
  sectionsFrom,
  resolveFrame,
  FRONT_HALF_WIDTH_CM,
  SIDE_HALF_WIDTH_CM,
  STAGE_HEIGHT_CM,
} from './geometry';
export type {
  AvatarGeometry,
  DefinitionStroke,
  Ellipse,
  FrontGeometry,
  GeometryOptions,
  HandleRegion,
  LandmarkId,
  Layered,
  Pt,
  SideGeometry,
} from './geometry';
export { stageLayout, MIN_TEXT_PX } from './layout';
export type { AvatarView, StageLayout, StageLayoutInput } from './layout';
