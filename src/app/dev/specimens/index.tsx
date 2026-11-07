/**
 * The r071 0B sheets of the component gallery (/dev/components): one default-exported section per specimen file, in
 * reading order, and the jump-list entries for them. ComponentGalleryPage renders `<R071Sheets />` and spreads
 * `R071_JUMP` into its jump list, so 0A's own edits to the page stay out of this folder.
 */
import CardSpecimens from './CardSpecimens';
import LayoutSpecimens from './LayoutSpecimens';
import LineScaleStackWindowSpecimens from './LineScaleStackWindowSpecimens';
import RestyleSpecimens from './RestyleSpecimens';
import RingTrackBarsSpecimens from './RingTrackBarsSpecimens';

export const R071_JUMP: Array<[string, string]> = [
  ['g-cards', 'cards'],
  ['g-ticks', 'rings, tracks, bars'],
  ['g-lines', 'lines, scales'],
  ['g-restyled', 'restyled'],
  ['g-layout2', 'grid, library'],
];

export function R071Sheets() {
  return (
    <>
      <CardSpecimens />
      <RingTrackBarsSpecimens />
      <LineScaleStackWindowSpecimens />
      <RestyleSpecimens />
      <LayoutSpecimens />
    </>
  );
}
