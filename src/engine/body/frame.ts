import type { Sex } from './types';

/**
 * Drawing-only skeletal frame from Basics sex: female 0 (hips-led), male 1 (shoulders-led), unknown 0.5 (R2 sec. 4.3).
 * Its own module (re-exported by ./avatar and the package index) so the body store can default the frame without
 * loading the avatar maths into the app's initial bundle.
 */
export function frameForSex(sex: Sex | null | undefined): number {
  return sex === 'female' ? 0 : sex === 'male' ? 1 : 0.5;
}
