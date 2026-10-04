# Shared 3D body figure

`Figure3D` is the shared React figure for the website/PWA, Electron and Capacitor.
It receives the engine's `AvatarParams`; it never writes slider values back to a
profile. The Body page supplies `deriveFigure(...).params`, while plan and simulator
figures supply `stateToAvatarParams(...)` for the selected projected state.

The visible body is a fitted, 9,000-vertex MakeHuman hm08 mesh. Bones and muscles
come from the official BodyParts3D reference atlas. Fat under skin and fat around
organs are illustrative layers driven by the engine. These are reference anatomy
and estimates, not a personal scan. See [the research decision](../../../../docs/wp/C-BODY-research.md)
and [asset licences](LICENSES.md).

```tsx
import { Figure3D } from '@/features/body/figure3d';

<Figure3D
  params={stateToAvatarParams(state, { baseline })}
  frame={params.figure.frame}
  compareTo={startParams}
  size="fill"
/>;
```

The stage reserves its space and shows the original SVG while the lazy WebGL
renderer loads. The same SVG is the fallback on unavailable WebGL2, failed assets,
failed lazy imports or context loss. Production uses one body with slow constant
rotation; pointer dragging and arrow keys allow inspection. Reduced motion stops
automatic turning. The layer controls use plain names and explain the estimated
organ fat. The optional visceral waist slice remains available for the engine's
area estimate and uncertainty range.

| File                   | Responsibility                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `Figure3D.tsx`         | Shared public component, loading/failure fallback, accessible controls.                      |
| `Figure3DCanvas.tsx`   | Lazy asset loading, fitting, rotation, lifecycle and visibility handling.                    |
| `asset.ts`, `model.ts` | Compact outer mesh decoder and MakeHuman morph basis.                                        |
| `composition.ts`       | Engine tissue masses to illustration scales; bone proportions independent of fat and weight. |
| `fit.ts`, `measure.ts` | Match seven girths, two depths and shoulder breadth to engine outputs.                       |
| `renderer.ts`          | WebGL2 buffers, smooth shading and tissue materials; no third-party renderer dependency.     |
| `subcutaneousShell.ts` | Partitions the illustrative abdominal shell using estimated visceral and under-skin fat. |
| `scene.ts`             | Morph evaluation, stature, floor placement and interpolation.                                |
| `visceral/`            | Optional SVG waist slice and explanatory cutaway.                                            |
| `DevFigurePage.tsx`    | Synthetic fixture and performance harness at `/dev/figure`.                                  |

Rebuild the exterior with Node 22.18 or newer:

```sh
node scripts/figure/fetch.ts
node scripts/figure/bake.ts
```

The source commit is pinned in `scripts/figure/lib/sources.ts`. The output is
`public/figure/figure-v2.bin`, already gzip-compressed; `bake-report.json` records
its size. Normal rotation changes uniforms, so it does not refit or upload the
human mesh every frame. Renderer resources and listeners are released on unmount.
Shared immutable decoded assets are retained for reuse between app screens.

The total compressed figure-assets-and-lazy-code budget is 3 MB. The exterior
pack is 385,188 bytes. Measured anatomy size, frame timings, screenshot paths and
validation results are recorded in the C-BODY handback; performance targets are
60 fps on the development PC and at least 30 fps on a mid-range Android phone.
A software-GL smoke test does not establish physical-device performance.

Rebuild the anatomy with `python scripts/figure/fetch-anatomy.py` and
`python scripts/figure/bake-anatomy.py`. Its manifest retains named source parts
and the bake report records the pinned input and derived-output checksums.
After a production build, `node scripts/figure/check-budget.mjs` checks the
3 MB download limit. Run `node scripts/figure/browser-qa.mjs` for isolated
software-GL smoke checks and screenshots. The hardware probe uses Vulkan by default:

```sh
BENCH_BROWSER_MODE=native node scripts/figure/browser-qa.mjs --probe-gl
```

Results go to ignored
`bench-results/C-BODY/`; see `docs/wp/C-BODY-validation.md` for measured results.
