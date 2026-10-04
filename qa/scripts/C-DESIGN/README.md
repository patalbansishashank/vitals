# Design layout evidence

Run against a production `vite preview` URL supplied as `BASE`. The scripts use only synthetic tracked fixtures and isolated Chromium contexts. Captures and IndexedDB storage states stay in git-ignored `.e6-tmp/c-design/`.

```sh
BASE='<preview-url>' node qa/scripts/C-DESIGN/layout.mjs before
BASE='<preview-url>' node qa/scripts/C-DESIGN/states.mjs before
BASE='<preview-url>' node qa/scripts/C-DESIGN/results.mjs before
```

Rebuild the production site after layout changes, then use `after` for all three commands. Run one script at a time to bound browser memory. `before` records known layout defects; capture errors still need resolving. `after` exits nonzero for measured regressions.

`layout.mjs` covers stable routes at 390, 768, 1024, 1280 and 1440 pixels in both themes. `states.mjs` covers first visit, screening, consent, empty and populated ring/signals, a food log sheet, Train week and a 24-pixel bottom safe inset. `results.mjs` performs a real planner search and simulation, then resizes the live result views across the matrix. Planner results cannot be restored from a storage snapshot, so this live pass is required. `seed.mjs` and `ring-seed.mjs` supply the separate synthetic profiles.

The short-lived floating Body preview has a separate, fresh-context SVG-fallback check. Run it after the normal renderer matrix:

```sh
BASE='<preview-url>' node qa/scripts/C-DESIGN/mini.mjs after
```

The after scripts reuse the saved fixtures. They can target a second preview origin: storage-state origins are remapped in memory, leaving the original fixture files intact.

To recapture one route or boundary without repeating the matrix:

```sh
DESIGN_REUSE_STATE=1 DESIGN_ROUTES=/body DESIGN_WIDTHS=1344 BASE='<preview-url>' node qa/scripts/C-DESIGN/layout.mjs before
```

The JSON files record actual rendered paths so a redirect never masquerades as a screenshot of another route. Main screenshots are full-page; the fixed navigation appears at its initial viewport position in those images.

Use `DESIGN_SCHEMES=dark` with the layout script to resume a theme subset. Partial reruns replace matching rows and retain the earlier evidence. Confirm the combined JSON has no capture errors before counting a matrix as complete.
