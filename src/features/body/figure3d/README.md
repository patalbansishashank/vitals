# Figure 3D (R2 decision c) and visceral view

`<Figure3D params frame visceral />` draws the engine's body as a MakeHuman-derived mesh. Each girth is fitted to
`AvatarParams` at runtime, and the existing SVG `BodyAvatar` is the fallback.

```tsx
import { Figure3D } from '@/features/body/figure3d';

<Figure3D
  params={stateToAvatarParams(state, { baseline })}  // engine truth
  frame={params.figure.frame}                        // optional, drawing only: 0 hips-led .. 1 shoulders-led
  visceral                                           // optional: waist slice + cutaway next to the figure
  compareTo={startParams}                            // optional ghost
  layers="envelope"                                  // or "two-layer" (lean core under a translucent envelope)
/>
```

| File | Role |
|---|---|
| `Figure3D.tsx` | Public component, in the importing chunk. Shows the SVG figure while loading, without WebGL2, on asset failure or on context loss. Accessible name from `describeAvatar` (shape words only). |
| `Figure3DCanvas.tsx` | Lazy chunk: loads the pack, fits (warm-started), tweens morph weights (none with reduced motion) and draws. |
| `asset.ts` | Fetches and inflates (`DecompressionStream`, CSP-safe) and decodes `public/figure/figure-v1.bin`. |
| `model.ts` | Morph model: frame, muscle and weight macros (MakeHuman semantics) plus signed locals. CPU evaluation; `SubsetModel` for the fitter. |
| `measure.ts` | Tape measure: plane cut, convex-hull perimeter, sagittal depth, bideltoid breadth. |
| `fit.ts` | Projected Levenberg-Marquardt over muscle, weight and 12 locals. Matches 7 girths, 2 depths and the bideltoid breadth to the engine. |
| `scene.ts` | Places meshes (stature, floor at 0); lean-core state; state interpolation. |
| `renderer.ts` | WebGL2: ortho front and side views in one canvas, flat clay shading, inverted-hull outline, two-layer and ghost passes. |
| `visceral/` | SVG visceral view (`VisceralView`, `VisceralSection`, `VisceralCutaway`). |
| `DevFigurePage.tsx` | `/dev/figure`: fit errors, fps benchmark, comparison with the SVG figure. |
| `LICENSES.md` | Exact sources and licences. |

Re-bake: `node scripts/figure/fetch.ts && node scripts/figure/bake.ts` (Node ≥ 22.18). This writes `public/figure/figure-v1.bin` and `scripts/figure/bake-report.json`. Bump the file version when the format or the content changes.
