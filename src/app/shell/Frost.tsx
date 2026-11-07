/**
 * The shell's tintless frost (SPEC §3, lumen.md §6): three stacked backdrop blurs (4, 9 and 14 px), each masked on its
 * own, so the material is densest where the chrome's controls sit and thins out toward the edge where content passes
 * under it, instead of stopping at one hard line. Chrome only: the top bar, the phone dock and a focused flow's docked
 * toolbar. The top bar's first layer carries a chassis tint under its blur (r068 S13), so scrolled content reads as calm
 * tone behind the title; the docks stay tintless.
 *
 * - `side="top"` (a top bar): full frost down to the last 24 px above the bar's bottom edge, where the 14 px and then
 *   the 9 px layer fade out; the 4 px layer runs on to the edge, which the bar's hairline rules.
 * - `side="bottom"` (a bottom dock): the mirror image; nothing rules its top edge, so all three layers fade in over the
 *   top 24 px (the 4 px layer first, the 14 px layer last).
 *
 * It fills its host (absolute, behind the host's content); a host that wants the fade above itself sets the inset
 * (src/styles/shell.css). Each layer's box reaches past the visible edge, where its mask hides it, so the blur samples
 * real content there rather than a mirrored edge. The layers carry the opacity (`--lm-frost`, default 1; the top bar
 * writes its scroll share), never an ancestor: an ancestor's opacity would cut the blur off from the page behind.
 */
export function Frost({ side }: { side: 'top' | 'bottom' }) {
  return (
    <div className="lm-frost" data-side={side} aria-hidden="true">
      <i />
      <i />
      <i />
    </div>
  );
}
