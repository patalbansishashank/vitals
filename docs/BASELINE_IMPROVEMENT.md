# Comparing changes to an existing routine

`planner.improveCurrent` is a bounded counterfactual analysis of a supplied Simulator scenario. Its reference is the
actual supplied schedule, rather than a maintenance template or a different policy-feasible diet. It does not issue a
safety certificate, start a living plan, or guarantee an individual tissue outcome.

The source must currently have fixed daily kcal, grams of protein and fat, remainder carbohydrate, and both resistance
and non-resistance days. Partial day overrides use the same deep merge as the schedule compiler. Unsupported sources
return an explanation rather than a fabricated comparison.

## Declared search and controls

The nutrition family tests protein, meal timing, lifting-day energy distribution and lower-carbohydrate rest days.
Weekly and whole-horizon energy remain equal to the source, including the last partial week. A higher-protein main
effect is distinguished from timing: cycling has a steady comparator with the same compiled weekly energy, protein,
fat, net carbohydrate and fibre. The diagnostic daily-energy bound is a search boundary, not a finding of safety.

The optional training family uses actual available equipment, no purchases, the original resistance weekdays and
the existing counted-set ramp for novices. The catalogue composer supplies the delivered exercises, groups and
minutes. Targets that equipment or time cannot supply remain explicit. A partial final week does not receive a full
week's sets in one remaining session. Existing cardio, steps, diet and sleep are preserved by training-only changes.

The complete declared nutrition × training cross is evaluated. Each joint row has both a nutrition comparator with
the same training and an exercise comparator with the same nutrition. Component comparisons explain attribution;
they do not veto a genuine improvement against the original source merely because a component has a tradeoff.

All candidates use the same parameter members and fixed seed. A failed, aborted, truncated or unavailable trajectory
cannot become a favorable endpoint. Availability of required policy quantities is checked explicitly; a finite
not-applicable sentinel is not evidence of availability. The model's frozen initial muscle baseline is preserved
when the allowed loss changes.

The report separates baseline dominators, the diagnostic Pareto frontier, maximum modeled fat loss and maximum
modeled muscle change without less fat loss. It does not claim a global optimum outside the declared family.
The numerical materiality threshold is a reporting rule, not a clinical minimum detectable change.

## Meaning of the results

`meanFatDeltaKg` and its range are differences in **remaining fat mass**, so negative means more fat lost. The interface
inverts that sign when displaying extra fat loss. Skeletal-muscle changes are model compartment estimates. Glycogen,
water and apparent non-fat scale mass are separate endpoints.

Paired dominance requires available outcomes and nonworse fat and muscle in every declared parameter member, a
material mean improvement, and the selected whole-plan model muscle floor. These members are sensitivity cases,
not a calibrated distribution of personal outcomes or an empirical probability of retaining muscle.

Policy feasibility is reported separately. An aggressive baseline may be beaten inside the model while every variant
still fails deficit, energy-availability, loss-rate or other policy rules. An exploratory protein target can exceed
the general protein energy-share policy while retaining its explicit failure; the policy is not silently changed.
Such a result is a **diagnostic model improvement**, never an approved prescription. Saving it to Simulator does not
authorize adoption. Living-plan start paths retain their existing revalidation and certificate requirements.

## Data representation

A documented habitual sleep duration can be supplied independently of unknown bed and wake times. Explicit program
hours or clock edits take precedence. The input keeps duration provenance and leaves unmeasured clock times distinct
from measurements.

Documented habitual cardio replaces generic cardio allocation while preserving the generic resistance share. When
the same activity was originally recorded as recreation, an explicit `recreationSourceId` links the typed routine to
that raw row's `id`. Only that row is removed from the engine activity projection; raw intake/profile reports and
unrelated recreation remain intact. The projection records its basis and minutes. Missing, duplicate or inconsistent
links are rejected before profile/intake mutations commit. A label alone never establishes a shared physical bout.
Unknown treadmill step overlap remains unknown.

## Agent API

An explicitly chosen Simulator scenario can be started with `plan.start { source: { scenarioId }, startDate,
experimentalTracking: true }`. This runs the current clinical review while retaining population-policy failures as
experimental warnings. It stores no verified-plan certificate, preserves the user's practical limits and retention
budget, and starts with automatic changes off. Warnings are in a collapsed **Experimental model notes** section of
Plan Details. Medical, symptom, clinician and unresolved mandatory nutrition restrictions still block; a missing or
incomplete current simulation cannot authorize tracking. Ordinary checked-plan activation is unchanged.

`enforceDefaultDeficitCap: false` independently disables only the general adult 25% preset and its generated screening
duplicate. It never removes clinician, imported, marker or condition-specific screening caps. In experimental mode it
is selected explicitly as part of the mode. Physiology, uncertainty draws, original failures and warning text are kept.
Experimental tracking also treats generated body-size variants of that policy as advisory after a weight update;
condition-specific screening and clinical caps remain mandatory. A checked plan keeps enforcing those presets.

- `planner.improveCurrent`: `scenarioId`, optional `maxMuscleLossPct`, `draws`, `includeTrainingChanges`. Returns a
  background job; use `job.status` and `job.result` if the first response is still running.
- `planner.improvementResult`: read the completed report by `runId`.
- `planner.openImprovement`: copy an exact frozen candidate by `runId` and `candidateId`. It creates a new diagnostic
  Simulator scenario. Changes to the body, screening, equipment, goals, limits or source invalidate the cached copy.

Cached comparisons are ephemeral; saved scenarios persist. The report includes automatic representative IDs so an
agent need not choose a winner by manually trying arbitrary schedules. Authorized local owner sessions can use the
same commands through [owner-delegated MCP control](OWNER_AGENT_CONTROL.md).

## Evidence boundaries

The carbohydrate-refeed trial reported a difference in derived dry fat-free mass. Its published statistical comment
and unmeasured glycogen do not establish a large skeletal-muscle benefit from the proposed mechanism.
[Trial](https://pmc.ncbi.nlm.nih.gov/articles/PMC7739314/),
[statistical comment](https://pmc.ncbi.nlm.nih.gov/articles/PMC7739336/).

ICECAP found no fat-free-mass or strength advantage for diet breaks, despite appetite benefits.
[Primary trial](https://pubmed.ncbi.nlm.nih.gov/33587549/).

A controlled isocaloric ketogenic switch did not increase body-fat loss. More fat oxidation is not interchangeable
with more net adipose loss. [Metabolic-ward study](https://pmc.ncbi.nlm.nih.gov/articles/PMC4962163/).

Higher protein combined with substantial training can support lean-mass preservation or gain in a deficit, but that
does not validate this model's exact personal skeletal-muscle forecast.
[Longland trial](https://pubmed.ncbi.nlm.nih.gov/26817506/).

No new refeed, ketosis or muscle-gain bonus is added by this analysis. Existing physiological equations and their
known limitations remain visible in the [validation report](VALIDATION_REPORT.md).
