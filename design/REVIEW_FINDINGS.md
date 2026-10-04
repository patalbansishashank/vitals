# Finish-review findings on the prototype (apply these in the real implementation)
An independent review of `design/prototype` came back after the design hand-off. The prototype was NOT
updated. Where the prototype and this list disagree, **this list wins**.

## Keep undiluted
Achromatic mineral-grey / anthracite chassis with the Archivo width system; yellow-dot key banks as the
only accent; per-lane grade badge + likely-range band on every channel; humane non-moralising warning
copy with a one-tap remedy.

## Fix in implementation
1. **Results layout ≥1280 px:** the channel stack spans the full width. "Figure over time" and "Warnings"
   do not live in a 316 px right aside — put them in a band under the readout strip or a drawer toggled
   from the context bar. Mobile keeps the Run key in a bottom run bar (accepted adaptation); drop the
   duplicate "Run" caption beside the key.
2. **Printed tick scales everywhere they belong:** lane gutters (tick marks beside the numerals), the
   readout-strip "likely" range gauges, and a fully labelled overlay y-axis (not only +20 and 0).
3. **24 h clock dial:** a printed dial — 24 hour ticks, hairline bezel, fast and eating-window as thin
   bands, never a thick donut/progress ring (incl. mobile fast day). Centre readout must clear the 18/06 numerals.
4. **Schedule raster encoding:** step the energy fill every 5 % (85/80/75 % must be distinguishable in both
   themes); in dark, fast cells get their own treatment (hatch or anthracite-inverse) so white stays
   reserved for the selection outline; avoid a full-chroma slab in dark; "36 h" must not wrap at 375 px.
5. **Chrome stays achromatic:** no blue-filled info banners or coloured headings. Notices = faceplate text
   with a drawn status mark + hairline rule; colour on the mark only.
6. **Truthful labels:** never clip a block name into a different meaning ("diet break" → "diet"); use the
   full name or an honest short form with the full name in the tooltip.
7. **Mobile scroll strips:** add `scroll-padding-inline` equal to the container padding; size cells so the
   next cell deliberately peeks.
8. **Craft:** minimum rendered text size inside scaled SVGs (no ~5 px labels); rail indicator dot sits
   inside the viewport edge; the intake lane's "maintenance" label must not overprint the step line; the
   fat envelope of the avatar needs more contrast against the light stage.
