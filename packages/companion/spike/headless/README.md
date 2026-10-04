# R17 spike: the Vitals person store headless in Node

This is the seed of E25, not production code. The findings are in `research/R17-headless-node.md`.

| File | What it does |
|---|---|
| `personStore.ts` | Opens one person's Evolu store in a directory (0700) with the Node platform (`packages/companion/src/evoluNode.ts`), wraps it as the app's `PersistenceBackend`, and points the app's document runtime (and so the command bus) at it. |
| `headless.test.ts` | One run measures everything: the command bus, ring ingest via `bio.import` from `fixtures/ring.jsonl`, an MCP tool call through `guardedCall`, sync to a second device through the in-process relay, reopening from disk, and 5 persons. It writes `results/r17-results.json`. |
| `traps.ts` | Vitest setup file. It records every access to a browser global (`window`, `document`, `localStorage`, `indexedDB`, `Worker`, `navigator.*`, `fetch`, and others) together with the first app stack frame. |
| `main.ts` + `vite.node.config.ts` | The same flow as a plain Node program (vite SSR bundle), used for cold-start and RSS numbers outside vitest. The owner secret is read from `<dir>/owner.key` (0600); it is never printed. |
| `multi.mjs` | N persons in one process, one `worker_threads` Worker per person. |
| `fixtures/ring.jsonl` | 124 synthetic Lumen CloudEvents for one night (heart rate, SpO2, HRV, sleep timeline, daily activity). It contains no personal data. |
| `results/r17-results-{test,production}.json` | Recorded runs: vitest `MODE=test` and `--mode production`. |

```sh
export TMPDIR="$PWD/.e6-tmp"
pnpm vitest run --config packages/companion/spike/headless/vitest.config.ts [--mode production]
pnpm vite build -c packages/companion/spike/headless/vite.node.config.ts
node packages/companion/spike/headless/dist/main.mjs /path/to/person-dir
node packages/companion/spike/headless/multi.mjs 5 /path/to/base-dir
```

The spike needs no change outside this folder, so `patches/` is empty.
