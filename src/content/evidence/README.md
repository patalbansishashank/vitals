# Evidence library content
Typed data extracted from `research/NN-*.md`. One file per dossier in `topics/`, default-exporting an
`EvidenceTopic` (see `schema.ts`). `index.ts` maps topic slugs to lazy loaders. Numbers must match the
dossier exactly; prose is original and plain-language. Never add a claim or citation that is not in the dossier.

## Citing a topic from engine data

Engine data (metrics, safety warning rules) cites a topic with a structured `SourceRef` (`{ topic, refs?, legacy? }`, see
`schema.ts`); a screen shows it with `<SourceRefLinks/>` ("Safety limits › references 6, 7"), never as a research-note
pointer. `refs` are positions in the topic page's numbered source list. The research notes' own "[n]" numbers match those
positions except in the safety topic above 80, where sources that are not on the page (helplines, regulatory guidance) were
left out; `topicRefPosition` in `sources.ts` converts, and `src/engine/model/safety/ruleSources.test.ts` checks every
warning rule against the page. `legacy` keeps the maintainers' pointer ("17 §3 [6][7]") and is never rendered.
