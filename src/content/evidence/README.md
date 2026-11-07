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

## Outcome-scoped metadata

A mechanism may carry `warrants` (kind, confidence and the outcome each covers), `outcomeScope`, `population`,
`observations` (tissue and observation type of the supporting evidence) and `modelStatus` (`production`, `exploratory`,
`notModelled`). A trial grade is one warrant among several; a definition is `analyticallyTrue`, a chosen practice can be
`timeTested` or `livedExperience`. These fields belong in the info/Explain sheet; `warrants.ts` is the one source of
their plain-word labels (`warrantText`, `observationText`, `hasWarrantContent` for the sheets), and an operating screen
shows at most the status word ("Exploratory", "Not modelled"). A key-number range names its `uncertaintyKind`; a
parameter-draw spread is `parameterSensitivity`, never a calibrated prediction.

Autophagy: Vitals does not quantify it. Human blood-cell flux is measurable and stays a `humanTissueFlux` observation of
blood cells; the autophagy index is a `modelDefinition`, an exploratory research display with no goal and no planning or
health credit. Never describe the index or its parameter draws as measured flux, a percentage of autophagy, a longevity
gain or a likely range (`__tests__/outcomeScope.test.ts` checks this).

Code points at articles through `detailsRef` (for example the drift card's balance residual): `__tests__/providers.test.ts`
checks that every such id exists and that a range sent with it is described there with the same `uncertaintyKind`, and
that the autophagy index article states the cellular module's own definition. Article ids are links: never rename one.

## Articles restate what the engine does

An article's `howModelled`, equation and key numbers describe the code that runs, not the research note's plan. A term
that is off, inactive or only a sensitivity says so in the text ("Research sensitivity only", "Opt-in scenario, off by
default", "Proposed, not run", "Inactive, not applied"), and switching a term off is never described as proof of no
effect. `__tests__/scopedOutcomes.test.ts` reads the providers (output contracts, scope declarations, parameters and pure
helpers) and fails when an article drifts from them:

- Hormones: every endocrine output is an exploratory direction relative to the person's baseline, never a predicted lab
  value, a diagnosis or a goal; free testosterone needs measured total testosterone, SHBG and a stated albumin; the
  reproductive output is a concern status (review, insufficient history, concern, not applicable), never a per-cycle
  probability; the IGF-1 protein slope is a scenario range that includes no response.
- Protein: daily protein carries the effect, meal distribution has no penalty in the standard projection (the old curve
  is a research sensitivity); MPS is a simulated response index, never measured synthesis or grams of muscle; no leucine
  amount is invented for an unknown food.
- Carbohydrate: the hourly curve is a gut-appearance approximation; its 60/90 g/h caps are design limits taken from
  exercise oxidation, not absorption maxima; fibre timing is unsupported while its daily energy counts.
- Lipids and liver: the lean-responder LDL term and the sustained ketosis liver-fat term are off by default with an
  uncertain response, not zero; ApoB change is an exploratory proxy; non-HDL is an identity only within one matched panel;
  omega-3 grades cover triglycerides and blood pressure, not heart events; simulated liver fat never clears a flag.
- Energy availability, bone, endurance, wellbeing: raw EA is unclipped and its 45/30/15 tiers are policy references;
  bone density has no personal forecast; the endurance index is task-scoped (cycling near 75 % VO₂max) and never a race
  time; reported concerns override a reassuring model tier; sodium does not mitigate induction symptoms by default.
- Cycle, menopause, stress: the cycle phase is a calendar estimate with phase-average effects when unknown; menopause
  drift is inactive; stress is not modelled.

An article whose charted metrics are all research displays or observed outcomes in the goal-capability registry carries
a model status word (`exploratory` or `notModelled`).
