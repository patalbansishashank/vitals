# V1f review: markers, catalogues and content (pass 1)

Area: `src/markers/**`, `src/catalogues/**`, `src/content/**`, and the generators `scripts/markers/build-interactions.ts` and `scripts/kitchen-catalogue.mjs`. Branch `wp/V1f`, reviewed 2026-10-03. There is no `src/catalogue/` folder.

## Findings

| ID | Severity | File:line | What is wrong | How confirmed | Fix or reason not fixed |
|---|---|---|---|---|---|
| V1f-1 | high | `src/markers/rules.ts:249` (`noteText`), `src/markers/because.ts:72` (`fillMessage`) | Five retest notes (W-L-ALT-7, W-L-AST-2, W-L-GGT-3, W-L-EGFR-3, W-L-ACR-2) showed the raw placeholders `{date+12w}`, `{date+6w}` and `{date+3m}` on screen. `fillMessage` only matches `\{\w+\}`, and nothing else filled them. | New test `src/markers/__tests__/review.test.ts`: ALT 60 U/L gave "Retest ALT around {date+12w} …". It failed before the fix and passes after. | **Fixed.** `noteText` now fills `{date+Nw}` and `{date+Nm}` from the reading date, in the person's date style. Months are clamped to the end of the month. A table-wide test checks that every placeholder is one the note builder knows. |
| V1f-2 | high | `src/markers/rules.ts:251` (`noteText`) | W-L-INS-1 says "Because your HOMA-IR was {value} …", but `{value}` was filled with the insulin reading. Glucose 90 mg/dL with insulin 12 µU/mL gave "HOMA-IR was 12". The real value is 2.67. | `review.test.ts` "HOMA-IR note" failed before the fix and passes after. | **Fixed.** HOMA-IR is now computed with the same `valueIn` the rule fires on. |
| V1f-3 | medium | `src/catalogues/compose.ts:453,470`, `src/catalogues/equivalence.ts:197,296`, `src/catalogues/user.ts:407,427`, `src/catalogues/params.ts` | Text built here showed kcal with no kJ. It reaches the screen through session item texts (PrintPrescription), the equivalence shortfall (EquivalenceMeter, the train saved line) and the user-food warnings. This breaks the "kJ shown where kcal is" rule. | New static test `src/catalogues/__tests__/energyCopy.test.ts` scans the string and template literals. It listed 7 literals before the fix and 0 after. | **Fixed.** New helper `energyText(kcal)` in `src/catalogues/text.ts` prints "120 kcal (500 kJ)" (kJ to the nearest 10). The fixed strings now carry kJ. 78 test files in living/commands/planner still pass. |
| V1f-4 | medium | `src/markers/context.ts:89` | `dietChangeDate` is set for any live plan that has started. SUITE_SPEC §13.5 says "plan start with a different diet pattern". So any plan start makes HbA1c and lipid readings older than 3 months display-only. Their rules (for example the LDL saturated-fat cap) then stop firing for re-plans. | Read against SUITE_SPEC §13.5 line 1853. `isStale` (`doc.ts:83`) uses months since the reading, not since the change; both readings of the spec are possible. | **Not fixed.** The fix needs the previous and new diet pattern, which the context inputs do not carry (callers in `src/markers/ui/contextSources.ts` and the commands). The spec owner should decide what counts as a diet change. |
| V1f-5 | low | `src/markers/extract/layout.ts:267` (`NUM`) | A decimal comma is read wrongly: "2,45" reads as 245 (grouping) and "5,6" reads as 5. | Read the regex. Indian reports use decimal points; a wrong value usually trips the plausibility or "is this right?" bounds and lowers confidence, and the person confirms every row. | Not fixed: the grouping rule is needed for "1,234". Pass 2 could flag "d,dd" values under 10 for confirmation. |
| V1f-6 | low | `src/markers/rules.ts:301-310` (`missing` rules) | With no reading at all, `also` conditions of kind `sex`, `flag` or `marker` return false, and a `field` condition is compared with `===` whatever its `cmp`. | Read the code. The only `missing` rule (W-L-NA-5) uses one `field eq`, so nothing ships wrong today. | Not fixed (latent). Use `alsoHolds` with a pseudo reading if a new missing rule needs other conditions. |
| V1f-7 | low | `src/markers/interactions.json` W-L-NA-5 message | `{start}` is never filled. The rule only pushes a retest (no note), so the text is never shown today. | Code read; covered by the new placeholder test's known list. | Not fixed. Fill it from the plan start if this rule ever emits a note. |
| V1f-8 | low | `src/markers/rules.ts:370` | Prefer weights: the raw `preferWeight` is compared with the stored, clamped weight, so the winning rule id can change when a weight is above 0.02. | All table weights are ≤ 0.02, so there is no effect today. | Not fixed (no effect). |
| V1f-9 | low | `src/markers/table.ts:23-27` | `loadInteractionTable` / `interactionsOf` have no callers. Vite warns that `interactions.json` is imported both statically and dynamically. The interaction rows are tree-shaken (checked: no `effectText` in any chunk). | `pnpm build` warning; grepped `dist/assets`. | Not fixed. Harmless; remove it or start using it when the Evidence library reads the rows. |
| V1f-10 | low | `src/markers/doc.ts:109` (`migrateProfileLabs`) | The migrated reading's date is the UTC date of `updated`, not the local day. It can be off by one day near midnight. | Code read. | Not fixed. It is a one-time migration and the date is only a label for an old value. |
| V1f-11 | low | `src/markers/ui/MarkerTrends.tsx:101` (`markerSummary`) | If the last point of the forecast band is NaN, the spoken summary reads "NaN to NaN". | Code read: `map` turns non-finite points into NaN and the summary takes the last index. | Not fixed (the band only ends in NaN if the engine emits one). Pass 2: use the last finite index. |
| V1f-12 | low | `src/content/evidence/topics/13-transitions-periodisation.ts:2416` vs `28-blood-markers-and-diet.ts` (`wilson2017`) | The same paper (DOI 10.1519/JSC.0000000000001935, PMID 28399015) is dated 2020 in one topic and 2017 in the other. | Probe over all topic references. Both dates are real (online 2017, print 2020). | Not fixed. Pick one year when the topics are next edited. Not invented. |

### Evidence sources that look invented
None found. I probed every reference of the 28 topics: the DOI and PMID formats, years, duplicate ids, the same DOI or PMID with different years, and sources with no link. Five references have no DOI, PMID or URL, and all five are already marked unverified. Each is a real classic work, though I did not open them:

| Topic / id | Work |
|---|---|
| body-weight-models/mcbride1941 (`01-…:1387`) | McBride, Guest, Scott 1941, liver glycogen storage |
| body-weight-models/balasse1989 (`01-…:1586`; also `05-…:1957`) | Balasse & Féry 1989, ketone body production and disposal |
| energy-surplus/keys1950 (`11-…:2405`; also `12-…:2790`, `19-…:3380`) | Keys et al. 1950, *The Biology of Human Starvation* |
| body-composition-estimation/hodgdon1984 (`14-…:1342`) | Hodgdon & Beckett 1984, U.S. Navy circumference equations |

There are 39 references marked `verification: 'unverified'` in total. The pages already show this status, so no action is needed. There are 49 PMIDs above 41.5 M; all belong to 2026 papers, which is the expected range.

## Verified fine (pass 2 need not redo)

- **Generated tables equal their sources.** `node scripts/markers/build-interactions.ts --check` and `node scripts/kitchen-catalogue.mjs --check` both report up to date. `interactions.test.ts` also compares with a fresh build.
- **Unit factors** in `src/markers/units.ts`: lipids and glucose come from the engine constants; HbA1c NGSP = 0.09148 × IFCC + 2.152; urate 59.48; creatinine 88.42; UACR 8.84; fT3 1.536; Hb mmol/L 1.611; B12 0.738; vitamin D 2.496; hs-CRP mg/dL ×10; testosterone 0.03467; cortisol 27.59; µkat/L ×60. Lp(a) is never converted. VLDL is recomputed as TG/2.2 (mmol/L) or TG/5 (mg/dL). The µIU/mL ↔ µU/mL ↔ mIU/L equivalence for insulin is handled in extraction (`layout.ts:558`).
- **Bounds:** `checkBounds` blocks NaN and Infinity. The Lp(a) nmol/L bounds scale with the unit.
- **W-L rule semantics:** kinds are only cap, prefer, warn, retest, clinician and reask (157 rules, ids unique). No message tells the person to ban or forbid anything. The only "avoid" is "avoid hard lifting for 7 days before" a retest. Caps of 0 are limited to alcohol, creatine and potassium salt, as the existing test requires. Locks keep the stricter value; floors and caps are handled in both `evaluateMarkers` and `mergeSafety`. When sex is not given, the more cautious threshold is used.
- **Thresholds:** `healthyULN` and `whoCutoff` rules are written in U/L and g/dL, which match the conversions.
- **Data validity:**
  - No non-finite numbers in the interaction table, the kitchen seed or the unit table.
  - Kitchen ids are unique per list.
  - `validateCatalogue` (seed test) checks unique ids, equipment and source references, region weights in (0, 1] (NaN fails), MET ranges, doses and mappings.
  - Supplement upper-limit units are plain (mg, IU), so `convertDose` resolves them. Vitamin D uses 40 IU = 1 µg.
- **Evidence pointers:**
  - Every `SourceRef` on 93 metrics, 82 safety rules and 1719 parameters names an existing topic and a reference number that is on the page.
  - This had no test before; it is now `src/content/evidence/__tests__/refRange.test.ts`.
- **Internal names in shipped data:**
  - The leak patterns and the extra patterns (W-L ids, HC ids, R-numbers, `[Sn]`, `plan/`) find nothing in rule messages, marker labels, group labels or the 19 k kitchen strings. This is now a test in `review.test.ts`.
  - The table's `ranges.note`, `effectText` and `dossier` fields carry research pointers, but no UI reads them, and they are tree-shaken from the bundle.
- **PDF and photo path:**
  - pdf.js loads only in the worker, through a dynamic import.
  - Vision images are masked (a 0.22 header band plus known boxes) before `port.readRows`.
  - Reply rows are checked against the marker ids, with non-finite values dropped and patient-like names, ranges and methods stripped.
  - Calculated rows other than LDL, eGFR and UACR are shown but not used.
  - Cancelling rethrows `AbortError`.
  - The synthetic-fixture tests (`extract/__tests__/fixtures.test.ts`, `layout.test.ts`, `vision.test.ts`) pass.
- **Marker trends chart:** the engine series units match the canonical marker units (mmol/L, g/L), and relative series scale from the reading at plan start.
