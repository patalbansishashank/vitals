import type { EvidenceTopic } from '../schema';

const topic: EvidenceTopic = {
  dossier: '27',
  slug: 'evidence-policy',
  title: 'How Vitals weighs evidence',
  scope:
    'Every claim, number and activity in Vitals carries two separate labels: whether there is a known way it works that the model can follow, and how certain the human evidence is, from A to D. This topic explains what those labels mean, what each one does and, just as important, what neither does. It also explains how an activity or food nobody has studied is counted by borrowing from a studied one that works the same way, and how wording and uncertainty bands change with the grade. All the numeric settings here are Vitals modelling choices, not findings from studies.',
  mechanisms: [
    {
      id: '27-two-axes',
      title: 'Two separate labels: how it works, and how sure the evidence is',
      category: 'cellular',
      summary:
        'Vitals asks two different questions about everything it uses. First, is there a known way this works, and does that way reach something the model tracks? Second, how certain is the human evidence for the size of the effect? The answers are kept apart because they measure different things: a plain, obvious mechanism can have almost no trials, and a well-studied effect can work through a pathway the model cannot yet follow.',
      howModelled:
        'The first label names the pathway and says how it reaches the model: modelled (the model has equations for it), mapped (the item is expressed through a modelled pathway by a declared mapping) or information only (a pathway is known but reaches nothing the model tracks yet). The label is given for each pair of item and outcome, not per item: a swinging club can be mapped for muscle gain and information only for rotational sport skills. The second label is the A–D certainty. Neither label is calculated from the other, except that a mapped item’s certainty is worked out from its anchor (see the mapped-certainty mechanism).',
      keyNumbers: [
        {
          label: 'Mechanism label routes',
          value: 'modelled, mapped, information only',
          note: 'Information-only items are shown in the Evidence library and in plan text, not simulated. Vitals does not call them "not evidence-based"; it says it does not simulate them yet.',
        },
        {
          label: 'Certainty scale',
          value: 'A, B, C, D',
          note: 'Defined in the grade-meaning mechanism below.',
        },
        {
          label: 'What counts as a known mechanism',
          value: 'Every link from the item to something the model tracks is named',
          note: 'A free-standing story such as "detox" or "activates metabolism" does not count.',
          referenceIds: ['russo2007', 'parkkinen2018'],
        },
        {
          label: 'GRADE has no slot for mechanism as a positive source of certainty',
          value:
            'Its upgrade routes are large effect, dose-response and opposing confounding, all for observational data',
          referenceIds: ['guyatt2011indirect'],
        },
      ],
      grade: 'D',
      gradeReason:
        'The idea that causal claims need both difference-making and mechanistic evidence is well argued in the philosophy of medicine, but how Vitals applies it is a modelling choice.',
      status: 'proposed-fit',
      caveats:
        'Howick and colleagues warn that one can find a theory to explain almost anything and that mechanistic appeals have justified treatments that proved harmful. That is why a mechanism earns an item a place in the model but does not earn it narrow uncertainty.',
      referenceIds: ['russo2007', 'parkkinen2018', 'howick2009', 'guyatt2011indirect'],
      relatedMetricIds: [],
    },
    {
      id: '27-grades-never-gate',
      title: 'Grades inform but never decide what is included',
      category: 'cellular',
      summary:
        'A low evidence grade does not keep something out of a plan. An activity or food is included when it has a known way of working that reaches something the model simulates. It is left out only if there is no such way, or if trials of that very item found no effect or harm for the goal it would be used for. A shortage of trials never counts as a reason to exclude.',
      howModelled:
        'The inclusion test looks at the mechanism label only: is a pathway named, and does it reach the model through a modelled or mapped route? The certainty grade is not consulted. The one override is direct null or adverse evidence for the specific outcome. Certainty is not used to order, prune or score candidate plans either; a wide-band item can lose to a plan only because its simulated lower outcome is worse, which is honest uncertainty and not a penalty for its label. A test confirms that removing every grade leaves the planner’s output unchanged except for band widths.',
      keyNumbers: [
        {
          label: 'Reasons to exclude an item',
          value: 'No nameable pathway, or direct evidence of no effect or of harm for that outcome',
          note: 'Missing trials are not a reason.',
        },
        {
          label: 'Places certainty acts',
          value: 'Two: band width and wording',
          note: 'It is not used for search ordering, pruning or the plan objective.',
        },
        {
          label: 'Example of an item with no pathway',
          value:
            'A claim that cumin water melts fat has no link to energy intake, expenditure, partitioning or water',
          note: 'It is not simulated. If someone claims an appetite effect, it becomes information only, because appetite is something the model tracks.',
        },
      ],
      grade: 'D',
      gradeReason:
        'This is a design rule chosen by Vitals so that low-evidence but mechanistically obvious activities are not refused.',
      status: 'proposed-fit',
      caveats:
        'Excluding on direct null or harm evidence needs a citation to that evidence; thin evidence alone does not qualify and relabels the item as information only.',
      referenceIds: ['howick2009', 'hill1965'],
      relatedMetricIds: [],
    },
    {
      id: '27-grade-meanings',
      title: 'What grades A to D mean',
      category: 'cellular',
      summary:
        'The grade describes the human evidence for an estimate, the way the GRADE method does, and the grade is about the number, not the importance. A is the strongest and D is the weakest and is also where engineering choices sit.',
      howModelled:
        'Grade A is a meta-analysis, a validated model or several controlled human trials. Grade B is a few randomised trials or consistent human mechanistic data. Grade C is limited or indirect human evidence. Grade D is animal or laboratory work, expert opinion or a Vitals engineering choice with no study. GRADE rates certainty per outcome, starting high for randomised trials and moving down for risk of bias, inconsistency, indirectness, imprecision and publication bias. Vitals expresses imprecision as the width of the band instead of as a separate rule.',
      keyNumbers: [
        {
          label: 'Grade A',
          value: 'meta-analysis, validated model, or multiple controlled human trials',
        },
        {
          label: 'Grade B',
          value: 'few randomised trials, or consistent human mechanistic data',
        },
        {
          label: 'Grade C',
          value: 'limited or indirect human evidence',
        },
        {
          label: 'Grade D',
          value: 'animal, laboratory or expert opinion; an engineering choice with no study',
        },
        {
          label: 'Four kinds of indirectness in GRADE',
          value:
            'different population, different intervention, surrogate outcome, no head-to-head comparison',
          referenceIds: ['guyatt2011indirect'],
        },
      ],
      grade: 'D',
      gradeReason: 'The definitions are Vitals’ own protocol, adapted from GRADE.',
      status: 'proposed-fit',
      caveats:
        'A grade applies to an estimate in a population, so the same mechanism can carry different grades for different outcomes. Parameters that are a Vitals choice are labelled proposed fit and sit at D.',
      referenceIds: ['guyatt2011indirect'],
      relatedMetricIds: [],
    },
    {
      id: '27-band-floor',
      title: 'Lower certainty widens the uncertainty band and never moves the centre',
      category: 'cellular',
      summary:
        'Every uncertain number in the model has a range. Certainty sets a floor on how narrow that range can be: an A-grade number can have a fairly tight band, while a D-grade number must have a wide one however tight its source looked. The grade can only widen a band. It never narrows one and it never shifts the central value, so a low-certainty item is not treated pessimistically.',
      howModelled:
        'The existing range is read as the 10th to 90th percentile of the spread between people. From it comes a band spread: the width divided by 2.563. The grade sets a floor on that spread as a share of the value: 5 % for A, 10 % for B, 20 % for C and 35 % for D. The inflation factor k is the larger of 1 and the floor divided by the band spread. Each side of the band is stretched away from the centre by k, then clipped to physical limits (a fraction stays between 0 and 1; a rate stays above zero). A parameter fixed at a single value gets a symmetric band at the floor. If a number’s source already gave a deliberately wide band, the floor can be switched off with a note.',
      equation:
        'band spread = (high − low) ÷ 2.563\nfloor = grade share × |value|; 5 % A, 10 % B, 20 % C, 35 % D\nk = max(1, floor ÷ band spread)\nnew low = value − k × (value − low); new high = value + k × (high − value)\nIllustration: value 100, range 80–120, grade C: spread 15.6, floor 20, k = 1.28, new range 74.4–125.6',
      keyNumbers: [
        {
          label: 'Floor on relative spread, grade A',
          value: '5 %',
          note: 'Proposed fit.',
        },
        {
          label: 'Floor, grade B',
          value: '10 %',
          note: 'Proposed fit.',
        },
        {
          label: 'Floor, grade C',
          value: '20 %',
          note: 'Proposed fit.',
        },
        {
          label: 'Floor, grade D',
          value: '35 %',
          note: 'Proposed fit.',
        },
        {
          label: 'Conversion from a 10th–90th percentile range to a spread',
          value: 'divide the width by 2.563',
          note: 'Twice the 90th-percentile standard normal value of 1.2816.',
        },
        {
          label: 'Design target for the floors',
          value: 'No more than about 15 % of existing A and B bands change',
          note: 'The floors are tuned so that well-supported numbers are barely touched.',
        },
      ],
      moderators:
        'The size of the original band, the physical limits of the quantity, and whether the item is mapped (see the transfer-factor mechanism).',
      grade: 'D',
      gradeReason:
        'The idea that low certainty should widen uncertainty is standard, but the specific 5, 10, 20 and 35 percent floors are Vitals modelling choices.',
      status: 'proposed-fit',
      caveats:
        'The floors are untested against outcomes and need tuning. For a mapped item the floor is checked on the combined spread of the anchor numbers and the transfer factor, not on each separately.',
      referenceIds: ['guyatt2011indirect', 'turner2009'],
      relatedMetricIds: [],
      relatedParamIds: [
        'catalogue.bandFloorA',
        'catalogue.bandFloorB',
        'catalogue.bandFloorC',
        'catalogue.bandFloorD',
      ],
    },
    {
      id: '27-wording-hedges',
      title: 'The grade sets the verb: "lowers", "probably lowers", "may lower", "might lower"',
      category: 'cellular',
      summary:
        'How strongly a sentence is worded follows how certain the evidence is. An A-grade effect is stated plainly. A B-grade effect is "probably". C is "may" and D is "might". The wording never uses "speculative", which reads as "do not do this".',
      howModelled:
        'The verb is chosen from the certainty grade: no hedge for A, "probably" for B, "may" for C and "might" for D. For a mapped item, or any D-grade item, the sentence also names the pathway in plain words, because the pathway is the reason the item is in the plan. For an item that is information only, the text says it is not simulated yet and gives the pathway. Bands are always shown beside the words, and their width does the rest of the hedging.',
      keyNumbers: [
        {
          label: 'Verb by certainty',
          value: 'A: "lowers"; B: "probably lowers"; C: "may lower"; D: "might lower"',
          referenceIds: ['santesso2020'],
        },
        {
          label: 'GRADE wording for a large effect at high, moderate and low certainty',
          value: '"results in", "likely results in", "may result in"',
          referenceIds: ['santesso2020'],
        },
        {
          label: 'Wording for a mapped item at grade A or B',
          value: '"Counted as" the anchor, then the effect',
        },
        {
          label: 'Wording for a mapped item at grade C or D',
          value:
            '"Counted as" the anchor, the pathway in brackets, and a note that the range is wide because few trials exist',
        },
      ],
      grade: 'C',
      gradeReason:
        'The wording scheme follows published GRADE guidance for communicating findings, but applying it to the model’s grades is Vitals’ own.',
      status: 'proposed-fit',
      caveats:
        'Plain-language hedging helps only if the grade it reflects is right, and several grades in the model are themselves proposals.',
      referenceIds: ['santesso2020'],
      relatedMetricIds: [],
    },
    {
      id: '27-mapping-by-shared-mechanism',
      title: 'Counting an unstudied item by how it works, using a studied item as anchor',
      category: 'cellular',
      summary:
        'Many sensible activities and foods have never been trialled: a steel club swing, a roasted chickpea flour. If one works the same way as something that has been studied, Vitals counts it as that, adjusted by a factor that expresses how well the study transfers, and with a wider band. The mechanism earns the place; the uncertainty reflects how much has been assumed.',
      howModelled:
        'Each unstudied item is written in the anchor’s own terms. A swing is expressed as effective sets on the shoulder and grip muscles, and a food as protein quality for the daily and per-meal calculations. The anchor effect is then multiplied by a transfer factor τ drawn at the stimulus level, so every downstream step (saturation, recovery, energy) acts on the mapped dose exactly as on a studied one. The same τ is used for all candidate plans so that plans using the same item are compared fairly. Where the difference between the item and the anchor sits on a node the model does not have, the item is information only for that outcome. Each mapping also records the trial that would settle it.',
      equation: 'effect of the item = τ × effect of the anchor at the item’s inputs',
      keyNumbers: [
        {
          label: 'Causal transport',
          value:
            'An effect can be transported if the differences between settings sit on identifiable nodes of a shared causal graph',
          note: 'In Vitals the model is the shared graph.',
          referenceIds: ['bareinboim2016'],
        },
        {
          label: 'Bias-adjusted synthesis',
          value: 'Prior distributions for each study’s internal bias (rigour) and external bias (relevance)',
          note: 'The transfer factor is the relevance part applied as a multiplier.',
          referenceIds: ['turner2009'],
        },
        {
          label: 'Analogy and similarity as a licence',
          value: 'Hill’s viewpoint of analogy is regrouped as parallel evidence',
          referenceIds: ['howick2009', 'hill1965'],
        },
      ],
      grade: 'D',
      gradeReason:
        'Transport and bias-adjustment ideas have a statistical literature, but the mapping layer and its settings are Vitals’ own engineering.',
      status: 'proposed-fit',
      caveats:
        'A mapping is only as good as the claim that the items share a mechanism. The extra width and the no-transfer component in the transfer factor are the guard against being wrong about that.',
      referenceIds: ['bareinboim2016', 'turner2009', 'howick2009', 'hill1965'],
      relatedMetricIds: [],
    },
    {
      id: '27-similarity-and-transfer-factor',
      title: 'Similarity score and the transfer factor: less alike means a wider band',
      category: 'cellular',
      summary:
        'How well a studied result transfers depends on how alike the two things are. Vitals scores that likeness across nine dimensions of the stimulus, and the lower the score the wider the uncertainty on the transfer factor. The transfer factor also includes a small chance that nothing transfers, so the model cannot be fully confident in a mapping.',
      howModelled:
        'For an exercise the nine dimensions are movement pattern, muscle regions, load type, relative intensity, velocity profile, range of motion, volume, duration and cardio profile. Each is scored 0 (different), 0.5 (partly alike) or 1 (alike), and the similarity S is the average. The transfer factor τ is drawn from a mixture: most of the time from a log-normal curve centred on a median (1 unless the mismatch has a known direction, for instance a ballistic swing spends less time under tension, giving 0.8), and with a small weight w from a uniform range between 0 and 0.5 that stands for "it transfers poorly". The spread of the log-normal part rises as similarity falls. The weight w is 0.10 when every link is shown in humans and 0.25 when a link is assumed or an AI wrote the mapping.',
      equation:
        'S = average of the nine dimension scores (each 0, 0.5 or 1)\nτ ~ (1 − w) × LogNormal(median, σ) + w × Uniform(0, 0.5)\nσ = 0.10 + 0.50 × (1 − S)\nS = 1 gives σ = 0.10; S = 0 gives σ = 0.60',
      keyNumbers: [
        {
          label: 'Base spread of τ when items are identical in mechanism',
          value: '0.10 (log scale)',
          note: 'Proposed fit.',
        },
        {
          label: 'Slope of the spread with dissimilarity',
          value: '0.50 per unit of (1 − S)',
          note: 'Proposed fit.',
        },
        {
          label: 'Top of the "transfers poorly" component',
          value: '0.5',
          note: 'Proposed fit.',
        },
        {
          label: 'No-transfer weight when every link is shown in humans',
          value: '0.10',
          note: 'Proposed fit.',
        },
        {
          label: 'No-transfer weight when a link is assumed or the author is AI',
          value: '0.25',
          note: 'Proposed fit.',
        },
        {
          label: 'Robust mixture principle',
          value:
            'A vague component added to an informative prior lets the result fall back on the data if prior and data conflict',
          referenceIds: ['schmidli2014'],
        },
      ],
      moderators:
        'The number of dimensions mismatched, whether the direction of a mismatch is known, whether every link is shown in humans.',
      grade: 'D',
      gradeReason:
        'The mixture-prior method is published, but the dimensions, the scoring and every number in the transfer factor are Vitals modelling choices.',
      status: 'proposed-fit',
      caveats:
        'The scoring of similarity is a judgement by the person or process that writes the mapping. The constants have not been checked against outcome data.',
      referenceIds: ['schmidli2014', 'turner2009'],
      relatedMetricIds: [],
      relatedParamIds: [
        'catalogue.tauSigmaBase',
        'catalogue.tauSigmaSlope',
        'catalogue.tauLo',
        'catalogue.tauWShown',
        'catalogue.tauWAssumed',
      ],
    },
    {
      id: '27-mapped-certainty',
      title: 'A mapped item’s certainty is the anchor’s grade, lowered for indirectness',
      category: 'cellular',
      summary:
        'The certainty of a mapped item is worked out, not asserted. It starts at the grade of the studied anchor and drops one step for each serious way the evidence is indirect: a different population, a different intervention or an outcome measured by a stand-in. If a human trial of the item itself agrees in direction, it can move back up one step, but never above the anchor.',
      howModelled:
        'The grade is turned into steps (A, B, C, D) and the indirectness count is added, then capped at D. A serious problem counts as one step and a very serious one as two. The three domains scored are population, intervention and outcome. An agreeing direct human trial lifts the result one step, capped at the anchor’s grade. The stored grade is recomputed in tests so that it cannot drift from the rule.',
      equation:
        'certainty of the item = anchor grade, moved down one step per indirectness point (to D at most);\nmoved back up one step if a human trial of the item itself agrees in sign (never above the anchor)',
      keyNumbers: [
        {
          label: 'Indirectness domains scored',
          value: 'population, intervention, outcome (each 0, 1 or 2)',
        },
        {
          label: 'Example: swinging a steel mace, muscle gain',
          value: 'anchor A, minus 2 for indirectness = C',
          note: 'The intervention is a serious mismatch, and no muscle growth was measured.',
        },
        {
          label: 'Example: swinging a steel mace, strength and stability',
          value: 'C',
          note: 'One 12-week trial in 27 elite male wrestlers found improved grip strength, shoulder flexibility, closed-chain upper-limb stability and push-up endurance, but not proprioception. Abstract only.',
          referenceIds: ['akaras2026'],
        },
        {
          label: 'GRADE advice for indirect evidence',
          value: 'Rate down and keep using it',
          referenceIds: ['guyatt2011indirect'],
        },
      ],
      grade: 'D',
      gradeReason:
        'GRADE’s approach to indirectness is established, but the step counts and the one-step recovery rule are Vitals choices.',
      status: 'proposed-fit',
      caveats:
        'The mace trial’s full text, adverse events and effect-size ranges were not read. No energy-cost entry for mace swinging was confirmed, so an interim class of resistance training or circuit work is used.',
      referenceIds: ['guyatt2011indirect', 'akaras2026'],
      relatedMetricIds: [],
    },
    {
      id: '27-ai-authored-items',
      title: 'Items written on the spot by the AI get wider bands',
      category: 'cellular',
      summary:
        'When the AI trainer resolves an activity or food that is not in the catalogue, the mapping is a guess about similarity. Vitals therefore treats every dimension as only half-alike and raises the no-transfer weight, so the band is wide and the item is never counted as tightly as a catalogued one.',
      howModelled:
        'An item resolved by the AI is scored 0.5 on every one of the nine dimensions, so the similarity S is 0.5. Its no-transfer weight is at least 0.25 even if the mapping claims otherwise. Together with a similarity of 0.5, this gives a log-normal spread of 0.35 plus a quarter of the mass on the poor-transfer component. A person can still use the item; the plan counts it with a wide range and a plain-language statement of how it was counted.',
      equation:
        'AI-authored: S = 0.5 (every dimension 0.5), weight of the no-transfer component at least 0.25, σ = 0.10 + 0.50 × 0.5 = 0.35',
      keyNumbers: [
        {
          label: 'Similarity when the AI resolves an item',
          value: '0.5 on every dimension',
          note: 'Proposed fit.',
        },
        {
          label: 'No-transfer weight',
          value: 'at least 0.25',
          note: 'Proposed fit.',
        },
        {
          label: 'Resulting log-scale spread',
          value: '0.35',
        },
      ],
      grade: 'D',
      gradeReason: 'These are cautious engineering defaults with no study behind them.',
      status: 'proposed-fit',
      caveats:
        'The defaults assume the AI is no better than half-informed about each dimension. A mapping checked and confirmed by the person or by a later study would justify narrower values.',
      referenceIds: ['schmidli2014'],
      relatedMetricIds: [],
      relatedParamIds: ['catalogue.tauWAssumed', 'catalogue.tauSigmaBase', 'catalogue.tauSigmaSlope'],
    },
    {
      id: '27-worked-mappings',
      title: 'Two worked examples: swinging a steel mace, and roasted chickpea flour',
      category: 'cellular',
      summary:
        'A mace swing loads the shoulders, forearms, upper back and trunk, so it counts as shoulder and grip resistance work. Roasted chickpea flour (sattu) is a legume protein, so it counts like other legume proteins. Both are included and simulated, with ranges widened to reflect the assumptions.',
      howModelled:
        'Mace: effective sets per region are the sets times a repetitions-in-reserve factor times a load factor, which for a swing is drawn from a triangular range because a percentage of the one-repetition maximum is undefined. With 3 sets a side near RIR 2, shoulders and forearms get about 2.1 effective sets (range 1.2–2.6) and the upper back and trunk about 1.1 (0.6–1.3). Sattu: daily protein quality follows a triangular range, and the per-meal quality is adjusted by the leucine share of the protein. It is a pure change of inputs to an existing mechanism, no new pathway.',
      equation:
        'mace: effective sets = sets × RIR factor × load factor; load factor ~ Triangular(0.45, 0.8, 1.0)\nsattu: daily protein quality ~ Triangular(0.62, 0.76, 0.86); per-meal quality = √daily quality × min(1.15, √(leucine % ÷ 8))',
      keyNumbers: [
        {
          label: 'Mace similarity across the nine dimensions',
          value:
            'S ≈ 0.67; spread 0.27 (0.33 with an allowance for unknown mass distribution); median τ 0.8; weight 0.15',
          note: 'Proposed fits.',
        },
        {
          label: 'Mace, effective sets per week on shoulders',
          value: '≈ 2.1 (1.2–2.6)',
          note: 'Counted for 3 sets a side; the 0.45 corner is from a 20 % of one-repetition-maximum value, the 0.8 mode is a proposal.',
        },
        {
          label: 'Mace trial',
          value: '27 elite male wrestlers, 3 times a week for 12 weeks',
          note: 'Grip strength, shoulder flexibility, closed-chain upper-limb stability and push-up endurance improved versus control; proprioception did not. Abstract only.',
          referenceIds: ['akaras2026'],
        },
        {
          label: 'Sattu, daily protein quality',
          value: 'Triangular (0.62, 0.76, 0.86); per-meal quality ≈ 0.83 (0.75–0.89)',
          note: 'Leucine share about 7–7.5 % of protein is an unverified legume-typical figure; dry roasting can lower available lysine.',
        },
        {
          label: 'Chickpea protein quality score (DIAAS, cooked, baked, extruded)',
          value: '0.76–0.78 cooked; 0.84 baked; 0.82 extruded',
          note: 'From a rat-assay study seen only in a search summary; no sattu-specific figure was found.',
          referenceIds: ['nosworthy2020'],
        },
        {
          label: 'Sattu similarity and transfer',
          value: 'S = 0.8; spread 0.20; median 1.0; weight 0.10',
          note: 'Proposed fits. Certainty C.',
        },
      ],
      grade: 'D',
      gradeReason:
        'These examples show how the policy is applied; the numbers are proposals built on a single abstract-level trial and a rat-assay figure.',
      status: 'proposed-fit',
      caveats:
        'Typical mace mass and handle length (4–15 kg, 0.9–1.2 m) and the gross efficiency of swinging implements are unverified placeholders. The trial that would settle the mace mapping is a 10-week trial in untrained adults comparing mace to volume-matched dumbbell shoulder work with ultrasound muscle thickness.',
      referenceIds: ['akaras2026', 'nosworthy2020'],
      relatedMetricIds: [],
      relatedParamIds: ['catalogue.tauSigmaBase', 'catalogue.tauSigmaSlope', 'catalogue.tauWShown'],
    },
    {
      id: '27-personal-updating',
      title: 'Your own data can tighten a population number, with guards against over-fitting',
      category: 'cellular',
      summary:
        'The uncertainty band of a parameter is a ready-made prior for one person: the spread of people. A short list of identifiable parameters, such as the energy-gap offset and adherence by block type, may be updated from your own logged data, but only after a minimum amount of data and with limits that stop a few odd days pulling the number far.',
      howModelled:
        'The design treats the band as a prior and updates it sequentially, with a heavy-tailed likelihood so a single wild weigh-in or mislogged meal cannot move the estimate much. At least 20 % of the weight always stays on the population value. A parameter is marked personalised only once its variance has fallen to 60 % of the prior or less, and not before 14 days of data for the energy gap or 8 weeks for training responses. When your data disagree with the typical value for two weeks, the band is widened once and the app says so. Scores from wearables can modulate parameters that already have a mechanism; they cannot create new ones, so heart-rate variability cannot become a direct link to fat loss.',
      equation: 'estimate = B × population value + (1 − B) × value from your data; B never below 0.2',
      keyNumbers: [
        {
          label: 'Likelihood',
          value: 'Student-t, 4 degrees of freedom',
          note: 'Proposed fit.',
        },
        {
          label: 'Minimum data before a parameter is called personalised',
          value: '14 days (energy gap); 8 weeks (training responders)',
          note: 'Proposed fits.',
        },
        {
          label: 'Variance needed to call it personalised',
          value: '≤ 0.6 of the prior variance',
          note: 'Proposed fit.',
        },
        {
          label: 'Share of weight kept on the population prior',
          value: 'at least 20 %',
          note: 'Proposed fit.',
        },
        {
          label: 'Prior-data conflict test',
          value: 'mean absolute standardised innovation > 2.5 over 14 days widens the prior once',
          note: 'Proposed fit.',
        },
        {
          label: 'Hierarchical combination of N-of-1 trials',
          value:
            'Each person’s estimate is a compromise between the population mean and their own data, weighted by within- and between-person variance',
          note: 'A single normal population curve can over-shrink genuine responders; Vitals uses heavy tails to reduce that.',
          referenceIds: ['zucker1997'],
        },
      ],
      grade: 'D',
      gradeReason:
        'Hierarchical updating from N-of-1 data is published, but every guard setting is a Vitals proposal that has not yet been validated.',
      status: 'proposed-fit',
      caveats:
        'This describes the intended design for the short list of identifiable parameters. Whether to show a person their own updated numbers, such as a maintenance offset with its range, is an open question.',
      referenceIds: ['zucker1997', 'schmidli2014'],
      relatedMetricIds: [],
    },
  ],
  myths: [
    {
      id: '27-myth-no-trials-no-use',
      claim: 'If there are no studies on an activity, it should not be in a plan.',
      verdict: 'not-supported',
      explanation:
        'Vitals treats a known way of working as evidence. An activity that loads the same muscles in a similar way as a studied one is counted through that anchor, with a wider band. Missing trials widen uncertainty and never exclude. Exclusion needs either no nameable mechanism or direct evidence of no effect or of harm.',
      referenceIds: ['howick2009', 'guyatt2011indirect'],
    },
    {
      id: '27-myth-grade-importance',
      claim: 'A grade D means an item is a bad idea or is rejected by the planner.',
      verdict: 'not-supported',
      explanation:
        'The grade is about how certain the human evidence is for a number. It sets a wider band and a more cautious verb, and does not change the planner’s choice by itself; the plan can still prefer a D-grade item when its simulated outcomes are good across the range.',
      referenceIds: ['guyatt2011indirect', 'santesso2020'],
    },
    {
      id: '27-myth-mechanism-proof',
      claim: 'If you can explain how something works, it works.',
      verdict: 'oversimplified',
      explanation:
        'A mechanism earns an item a place in the model but not narrow uncertainty. It is easy to find a theory to explain almost anything, and mechanistic arguments have supported treatments that later proved harmful, so mapped items get wider bands and a no-transfer component.',
      referenceIds: ['howick2009', 'russo2007'],
    },
    {
      id: '27-myth-low-grade-pessimistic',
      claim: 'A low certainty grade lowers the expected benefit.',
      verdict: 'not-supported',
      explanation:
        'Lower certainty widens the range around the central estimate and leaves the central estimate where it was. The expected benefit is not reduced.',
      referenceIds: ['guyatt2011indirect'],
    },
  ],
  openQuestions: [
    'Do the floors of 5, 10, 20 and 35 percent give bands that contain real outcomes about as often as stated? They are untested proposals.',
    'How should similarity be scored when the mapping is written by a person or an AI rather than from the catalogue? Should confirmed mappings earn a narrower weight over time?',
    'Should the planner’s best-case view rank on the median so that high-upside, low-certainty plans stay visible, or on a lower quantile?',
    'Whether to show people their updated personal parameters, such as a maintenance offset with a range, or only the effect on the plan.',
    'How should one-sided or unilateral movements, such as swings, be counted when a mapping assigns effective sets per region?',
  ],
  references: [
    {
      id: 'guyatt2011indirect',
      authors: 'Guyatt GH, et al.',
      year: 2011,
      title: 'GRADE guidelines: 8. Rating the quality of evidence: indirectness',
      journal: 'J Clin Epidemiol 64:1303',
      pmid: '21802903',
      doi: '10.1016/j.jclinepi.2011.04.014',
      url: 'https://researchonline.lshtm.ac.uk/id/eprint/60495',
      verification: 'abstract',
    },
    {
      id: 'santesso2020',
      authors: 'Santesso N, et al.',
      year: 2020,
      title:
        'GRADE guidelines 26: informative statements to communicate the findings of systematic reviews of interventions',
      journal: 'J Clin Epidemiol 119:126',
      pmid: '31711912',
      doi: '10.1016/j.jclinepi.2019.10.014',
      url: 'https://usblog.gradeworkinggroup.org/2020/02/research-shorts-informative-statements.html',
      verification: 'abstract',
    },
    {
      id: 'russo2007',
      authors: 'Russo F, Williamson J.',
      year: 2007,
      title: 'Interpreting causality in the health sciences',
      journal: 'Int Stud Philos Sci 21(2):157-170',
      doi: '10.1080/02698590701498084',
      url: 'https://kar.kent.ac.uk/2510/',
      verification: 'abstract',
    },
    {
      id: 'parkkinen2018',
      authors: 'Parkkinen V-P, Wallmann C, Wilde M, Clarke B, Illari P, Kelly MP, et al.',
      year: 2018,
      title: 'Evaluating evidence of mechanisms in medicine: principles and procedures',
      journal: 'SpringerBriefs in Philosophy (Springer, 2018; open access, NCBI Bookshelf NBK543865)',
      pmid: '31314227',
      url: 'https://www.ncbi.nlm.nih.gov/books/NBK543865/',
      verification: 'abstract',
    },
    {
      id: 'hill1965',
      authors: 'Hill AB.',
      year: 1965,
      title: 'The environment and disease: association or causation?',
      journal: 'Proc R Soc Med 58:295',
      url: 'https://embryo.asu.edu/pages/environment-and-disease-association-or-causation-1965-austin-bradford-hill',
    },
    {
      id: 'howick2009',
      authors: 'Howick J, Glasziou P, Aronson JK.',
      year: 2009,
      title:
        'The evolution of evidence hierarchies: what can Bradford Hill’s guidelines for causation contribute?',
      journal: 'J R Soc Med 102:186',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2677430/',
    },
    {
      id: 'turner2009',
      authors: 'Turner RM, Spiegelhalter DJ, Smith GCS, Thompson SG.',
      year: 2009,
      title: 'Bias modelling in evidence synthesis',
      journal: 'J R Stat Soc A 172:21',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2667303/',
    },
    {
      id: 'schmidli2014',
      authors: 'Schmidli H, et al.',
      year: 2014,
      title: 'Robust meta-analytic-predictive priors in clinical trials with historical control information',
      journal: 'Biometrics 70:1023',
      url: 'https://boris.unibe.ch/59957',
    },
    {
      id: 'bareinboim2016',
      authors: 'Bareinboim E, Pearl J.',
      year: 2016,
      title: 'Causal inference and the data-fusion problem',
      journal: 'Proc Natl Acad Sci USA 113:7345',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4941504',
    },
    {
      id: 'zucker1997',
      authors: 'Zucker DR, Schmid CH, et al.',
      year: 1997,
      title:
        'Combining single patient (N-of-1) trials to estimate population treatment effects and to evaluate individual patient responses to treatment',
      journal: 'J Clin Epidemiol',
      pmid: '9179098',
      doi: '10.1016/s0895-4356(96)00429-5',
      url: 'https://www.jameslindlibrary.org/?p=14683',
      verification: 'abstract',
    },
    {
      id: 'akaras2026',
      authors: 'Akaras E, et al.',
      year: 2026,
      title:
        'The effect of mace training on strength, flexibility, and stability in elite wrestlers: a randomized controlled trial',
      journal: 'BMC Sports Sci Med Rehabil 18:138',
      pmid: '41566515',
      doi: '10.1186/s13102-026-01545-8',
      url: 'https://pubmed.ncbi.nlm.nih.gov/41566515/',
      verification: 'abstract',
    },
    {
      id: 'nosworthy2020',
      authors: 'Nosworthy MG, et al.',
      year: 2020,
      title: 'Thermal processing methods differentially affect the protein quality of chickpea',
      journal: 'Food Sci Nutr 8:2950-2958',
      pmid: '32566213',
      doi: '10.1002/fsn3.1597',
      url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7300037/',
      verification: 'abstract',
    },
  ],
};

export default topic;
