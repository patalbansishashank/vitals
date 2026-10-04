import type { EvidenceTopic } from '../schema';

const topic: EvidenceTopic = {
  dossier: '08',
  slug: 'autophagy-longevity',
  title: 'Autophagy and nutrient-sensing pathways',
  scope:
    "Autophagy is the cell's recycling process. This topic covers the nutrient-sensing pathways that steer it (mTORC1, AMPK, sirtuins, insulin and IGF-1), how meals, fasting and exercise are thought to move them, and how good the human evidence really is. It also covers calorie restriction and fasting-mimicking studies, and explains why Vitals shows autophagy as a relative signal rather than a measurement.",
  mechanisms: [
    {
      id: '08-human-autophagy-evidence',
      title: 'What has actually been measured in people',
      category: 'cellular',
      summary:
        "Autophagy is a process, not a level. Parts of a cell are wrapped in a membrane, carried to a recycling compartment and broken down. No routine test can tell how fast this runs in a living person's organs. The one validated human method uses blood cells that are treated in a test tube after the sample is taken, and its results for fasting, protein and calorie restriction are mostly small or null.",
      howModelled:
        'Vitals does not treat any single human marker as autophagy itself. It uses the human studies as anchors for when the conditions that favour autophagy are present, and it labels the result a relative signal (see the Autophagy Signal Index article).',
      keyNumbers: [
        {
          label: '72 h water fast, skeletal muscle (8 healthy men)',
          value: 'LC3B-II ≈ +30 %; mTOR phosphorylation −40–50 %',
          note: 'LC3B-II is a marker protein on the membranes that wrap material for recycling. It is a static reading, so a rise can mean more formation or blocked clearance.',
          referenceIds: ['vendelbo2014'],
        },
        {
          label: '36 h fast, skeletal muscle',
          value: 'Modest, mixed changes',
          note: 'LC3-I, LC3-II and p62 fell in untrained men only. Group sizes were not extracted from the papers (not confirmed against the original papers).',
          referenceIds: ['dethlefsen2018', 'moller2015'],
        },
        {
          label: 'Blood cells, 35 g protein after a 12 h fast, flux at 1 h (42 people)',
          value: 'No change in flux',
          note: 'Flux means the measured rate of recycling, using a lysosomal blocker. Plasma BCAA rose and mTORC1 rose modestly.',
          referenceIds: ['singh2025'],
        },
        {
          label: 'Blood cells, 4 weeks of 10 % vs 20 % of energy as protein (63 completers)',
          value: '−8.46 ng LC3B-II/mg/h (95 % CI −24.06 to 7.14; p = 0.28)',
          note: 'No difference between arms.',
          referenceIds: ['singh2026'],
        },
        {
          label:
            'Blood cells, 6 months: intermittent fasting plus early eating window vs standard care (121 people with obesity)',
          value: 'P = 0.04 (post hoc); no rise within the group',
          note: 'Partly due to a decline in the standard-care group. Continuous calorie restriction was not different from standard care.',
          referenceIds: ['bensalem2025'],
        },
        {
          label: 'Blood cells, 5-day fasting-mimicking diet pilot (30 people)',
          value: 'Change in LC3B-II/I ratio to day 6: +1.9 (SD 2.9) vs −1.1 (SD 2.0) in control',
          note: "The abstract reports a between-group p < 0.05, while the extracted table gives p ≈ 0.09 for the three-group test (this should be checked against the original paper). The study was sponsored by the diet's maker.",
          referenceIds: ['espinoza2026'],
        },
        {
          label: '4 days of early time-restricted eating (08:00–14:00), blood LC3A mRNA (11 people)',
          value: '+22 ± 5 % (p = 0.001)',
          note: 'mRNA is a gene-activity reading, not proof of recycling activity.',
          referenceIds: ['jamshed2019'],
        },
        {
          label: 'Basal blood-cell flux and age (114 adults at risk of type 2 diabetes)',
          value: 'Flux increased with age',
          note: 'The opposite of the common assumption that autophagy simply declines with age.',
          referenceIds: ['bensalem2023'],
        },
        {
          label: 'Ramadan fasting (about 14–16 h daily), blood mRNA',
          value: 'ULK1 and ATG5 up at 2 and 4 weeks, back to baseline 1 week after',
          note: 'In 25 young men. A second Ramadan study (24 fasting, 26 non-fasting) found Beclin-1 mRNA up and LC3β and p62 mRNA down. Food intake and sleep were not recorded in the first.',
          referenceIds: ['erlangga2023', 'dastghaib2025'],
        },
        {
          label: 'Liver, brain and heart',
          value: 'No human in-vivo data located',
          note: 'A planned 23 h human time-course (NCT04842864) was withdrawn with no one enrolled. A periodic-fasting kinetics study (NCT04739852) has posted no results.',
        },
      ],
      timeCourse:
        'No human study has followed recycling activity over time in a solid organ. Muscle markers changed clearly at 72 h and only modestly at 36 h. Blood-cell changes appeared at about 4 days, in neutrophils only, and a borderline change appeared at day 6 of a 5-day fasting-mimicking diet.',
      moderators:
        'Age and sex show up in blood-cell flux: flux rises with age, and females had higher flux than males in two studies. The directions differ between tissues, so Vitals applies no age or sex multiplier.',
      grade: 'C',
      gradeReason:
        'The idea that fasting raises autophagy in people rests on two small muscle studies, gene-activity studies, and flux studies that are null or borderline. The direction is plausible; the size and timing are unknown.',
      status: 'contested',
      caveats:
        "Autophagy (the cell's recycling process) cannot be measured in your organs by any routine test. This line is a relative model signal that shows when the conditions linked to autophagy in animal and a few small human studies are present — no recent protein or sugar, low insulin, depleted liver glycogen, rising ketones, recent hard exercise. It does not tell you how much autophagy is happening, in which tissue, or whether it improves your health; human studies measuring autophagy directly have mostly found small or no effects of fasting, protein timing or calorie restriction. Evidence grade: C–D (low). The shaded band shows how uncertain the timing is: the fasting length at which the signal reaches its midpoint could be anywhere from about 1 to 4 days. A higher LC3-II can mean more recycling or blocked clearance, and the authors of the 72 h muscle study could not rule out the second reading. Blood LC3 or Beclin-1 tests and gene-activity readings are not accepted measures of flux. Flux needs a lysosomal blocker, which is impossible in human organs in vivo.",
      referenceIds: [
        'vendelbo2014',
        'dethlefsen2018',
        'moller2015',
        'singh2025',
        'singh2026',
        'bensalem2025',
        'espinoza2026',
        'jamshed2019',
        'bensalem2023',
        'erlangga2023',
        'dastghaib2025',
        'klionsky2021',
      ],
      relatedMetricIds: ['autophagyIdx'],
    },
    {
      id: '08-mouse-to-human-timescale',
      title: 'Why mouse hours are not human hours',
      category: 'cellular',
      summary:
        'Popular timings such as “autophagy peaks at 24 hours” come from mice. A mouse burns energy about 7 times faster per gram than a person, and loses about 20 % of its body weight in 48 h of fasting. A person loses under 2 % over 4 days. So Vitals compares physiological states, not clock hours.',
      howModelled:
        'The model compares states: how far liver glycogen has fallen, how low insulin is, how high endogenous ketones are, and how much of the energy reserve has been used. Human anchors then place the midpoint of the fasting clock at 48 h, with a plausible range of 24–96 h. This is a proposed value.',
      equation:
        'Kleiber scaling: metabolic rate ∝ M^0.75\nmass-specific rate ratio = (70 / 0.025)^0.25 ≈ 7.27',
      keyNumbers: [
        {
          label: 'Mouse (≈ 25 g) vs human (≈ 70 kg), mass-specific metabolic rate',
          value: '≈ 7.3 × human',
          referenceIds: ['kleiber1947'],
        },
        {
          label: 'Weight lost during a fast',
          value: 'Mouse ~20 % in 48 h; human < 2 % over 4 d (as reported)',
          referenceIds: ['pietrocola2017'],
        },
        {
          label: 'Mouse liver autophagosomes',
          value: 'Peak at 24 h; “returned to almost the basal level” during the next 24 h',
          referenceIds: ['mizushima2004'],
        },
        {
          label: 'Mouse skeletal muscle',
          value:
            'Fast-twitch muscle: many at 24 h, sustained or slightly lower at 48 h; slow muscle: only at 48 h',
          note: 'In human muscle, LC3B-II was +30 % at 72 h (static marker).',
          referenceIds: ['mizushima2004', 'vendelbo2014'],
        },
        {
          label: 'Mouse brain',
          value: 'No induction at 48 h with one method; “profound” neuronal increase at 24–48 h with another',
          referenceIds: ['mizushima2004', 'alirezaei2010'],
        },
        {
          label: 'White blood cells',
          value: 'Mouse: all subsets up at 48 h; human: neutrophils only, up to 4 d',
          referenceIds: ['pietrocola2017'],
        },
        {
          label: 'Metabolic-time scaling (upper bound)',
          value: 'Mouse 24 h liver peak ≈ ~7 d in a human',
          note: 'Energy reserves such as glycogen and fat fraction do not scale identically, so this overstates the delay.',
          referenceIds: ['kleiber1947'],
        },
        {
          label: 'Fasting-clock midpoint used in the model (h50)',
          value: '48 h (range 24–96 h)',
          note: 'Proposed. Bracketed by human muscle markers: 36 h mixed, 72 h clear, and 4 d in white blood cells.',
          referenceIds: ['dethlefsen2018', 'moller2015', 'vendelbo2014', 'pietrocola2017'],
        },
      ],
      timeCourse:
        'Mice are nocturnal and eat about two thirds of their food at night, so a daytime “overnight” fast in a mouse is a fast during its active phase.',
      moderators: 'Species, body size and energy reserves. Human feeding is diurnal, mouse feeding is not.',
      grade: 'D',
      gradeReason:
        'It rests on animal data and a scaling argument, with only sparse human anchors for the midpoint.',
      status: 'proposed-fit',
      caveats:
        "Autophagy (the cell's recycling process) cannot be measured in your organs by any routine test. This line is a relative model signal that shows when the conditions linked to autophagy in animal and a few small human studies are present — no recent protein or sugar, low insulin, depleted liver glycogen, rising ketones, recent hard exercise. It does not tell you how much autophagy is happening, in which tissue, or whether it improves your health; human studies measuring autophagy directly have mostly found small or no effects of fasting, protein timing or calorie restriction. Evidence grade: C–D (low). The shaded band shows how uncertain the timing is: the fasting length at which the signal reaches its midpoint could be anywhere from about 1 to 4 days. The midpoint h50 is the single most influential parameter in the model. It is bracketed by human muscle markers and state-scaled mouse data, and no human time-course of blood-cell flux has been published to replace it.",
      referenceIds: [
        'kleiber1947',
        'pietrocola2017',
        'mizushima2004',
        'alirezaei2010',
        'jensen2013',
        'vendelbo2014',
        'dethlefsen2018',
        'moller2015',
      ],
      relatedMetricIds: ['autophagyIdx'],
    },
    {
      id: '08-amino-acids-mtorc1',
      title: 'Amino acids switch recycling off',
      category: 'cellular',
      summary:
        'Amino acids, above all leucine, switch on a growth-signalling complex called mTORC1. When it is active it blocks the first step of autophagy. In human muscle, essential amino acids plus carbohydrate after resistance exercise lowered an autophagy marker. In blood cells, 35 g of protein did not change measured flux at 1 h.',
      howModelled:
        'The model takes how far plasma leucine rises above its post-absorptive level after a meal and passes it through an S-shaped curve. The result is a suppression value between 0 and 1. It is one of two suppression terms; the other is insulin. If no leucine signal is available, a fallback estimates it from protein grams and how quickly the meal is absorbed.',
      equation:
        'ΔL = max(0, leucine − 1), the fold rise above the post-absorptive level\nS_aa = ΔL^nL / (ΔL^nL + EC50_L^nL)\nFallback: leu_g = protein_g × leuFrac\nΔL(t) = Σ_meals 1.5 · leu_g² / (leu_g² + 2.0²) · k(t − t_meal; tp)\nk(t; tp) = (t/tp)² · exp(2 · (1 − t/tp)) for t > 0',
      keyNumbers: [
        {
          label: 'EC50_L (half-effect leucine rise)',
          value: '0.5 (range 0.25–1.0) fold above baseline',
          note: 'Proposed. Half-effect at +50 % leucine; post-meal peaks were +100–150 %.',
          referenceIds: ['atherton2010'],
        },
        { label: 'nL (steepness of the curve)', value: '1.5 (range 1–2)', note: 'Proposed.' },
        {
          label: 'w_aa (weight of amino acids in the combined suppression)',
          value: '0.6 (range 0.3–0.8)',
          note: 'Proposed. Muscle data support it; blood-cell flux did not change.',
          referenceIds: ['glynn2010', 'singh2025'],
        },
        {
          label: 'Plasma essential amino acids after 48 g whey',
          value: '+130 % at 120 min, +80 % at 180 min',
          note: 'S6K1 and 4EBP1 phosphorylation (mTORC1 signalling) rose in parallel, while muscle protein synthesis returned to baseline after about 90–120 min.',
          referenceIds: ['atherton2010'],
        },
        {
          label: 'Duration of mTORC1 elevation',
          value: '≈ 3 h after whey (range 2–5 h)',
          note: 'Longer for mixed meals, but the mixed-meal duration is unverified.',
          referenceIds: ['atherton2010'],
        },
        {
          label: 'Fallback: leucine fraction of protein and peak time',
          value: 'leuFrac 0.08–0.11 (whey ≈ 0.11); tp 1.0 h (whey or liquid) to 1.5 h (mixed meal)',
          note: 'The fallback shapes are unverified. The protein topic owns the real curve.',
        },
      ],
      timeCourse:
        'Suppression follows the leucine peak, which is at about 1 h for whey and 1.5 h for a mixed meal, and fades over roughly 2–5 h. In the fallback curve the effect is about 10 % of its peak by 3.3 times the peak time.',
      moderators:
        'None applied. Age-related resistance to the muscle-building effect of protein belongs to the muscle protein module (covered in the protein topic), not to this term.',
      grade: 'C',
      gradeReason:
        'Human muscle data and known signalling biology support the direction, but blood-cell flux contradicts an acute effect and the curve is a proposed shape.',
      status: 'proposed-fit',
      caveats:
        "Autophagy (the cell's recycling process) cannot be measured in your organs by any routine test. This line is a relative model signal that shows when the conditions linked to autophagy in animal and a few small human studies are present — no recent protein or sugar, low insulin, depleted liver glycogen, rising ketones, recent hard exercise. It does not tell you how much autophagy is happening, in which tissue, or whether it improves your health; human studies measuring autophagy directly have mostly found small or no effects of fasting, protein timing or calorie restriction. Evidence grade: C–D (low). The shaded band shows how uncertain the timing is: the fasting length at which the signal reaches its midpoint could be anywhere from about 1 to 4 days. The equation is proposed: Vitals' evidence review rates it D for autophagy itself and B for the mTORC1 direction. In perfused rat liver, amino acids alone controlled recycling over its full range, but that is animal work.",
      referenceIds: ['atherton2010', 'glynn2010', 'singh2025', 'mortimore1989'],
      relatedMetricIds: ['autophagyIdx', 'mtorIdx'],
    },
    {
      id: '08-insulin-akt-suppression',
      title: 'Insulin turns recycling down after meals',
      category: 'cellular',
      summary:
        'Insulin activates a signalling relay (Akt) that turns mTORC1 on and keeps a gene switch called FoxO3 out of the cell nucleus. FoxO3 otherwise drives the genes that build autophagy machinery in muscle. In human muscle, insulin lowered the autophagy marker LC3-II. A modest rise in insulin is enough to halve leg protein breakdown.',
      howModelled:
        'Insulin above your fasting baseline goes through an S-shaped curve to give a second suppression value. It is combined with the amino-acid term so that either can suppress and both together are capped at 0.94. Insulin carries a weight of 0.8.',
      equation:
        'ΔI = max(0, insulin − insulin_fasting_basal), in µU/mL\nS_ins = ΔI^nI / (ΔI^nI + EC50_I^nI)\nS = 1 − (1 − w_aa · S_aa) · (1 − w_ins · S_ins), the combined nutrient suppression, maximum 0.94\nFallback (unverified placeholder): ΔI(t) = Σ min(60, 0.5 · carb_g + 0.2 · protein_g) · k(t − t_meal; tp = 0.75 h)',
      keyNumbers: [
        {
          label: 'EC50_I (insulin rise for half-effect)',
          value: '5 (range 3–15) µU/mL above fasting basal',
          note: 'Proposed fit. Data points used: ΔI ≈ +10 µU/mL gave 47 % suppression of leg protein breakdown, about 94 % of the ~50 % maximum; ΔI ≈ +25 was maximal.',
          referenceIds: ['greenhaff2008', 'wilkes2009'],
        },
        { label: 'nI (steepness of the curve)', value: '1.5 (range 1–2)', note: 'Proposed.' },
        {
          label: 'w_ins (weight of insulin in the combined suppression)',
          value: '0.8 (range 0.6–0.9)',
          note: 'A 4 h insulin clamp after exercise cut LC3-II/LC3-I by about 80 % in human muscle.',
          referenceIds: ['fritzen2016'],
        },
        {
          label: 'Leg protein breakdown with insulin raised from 5 to 30 mU/L',
          value: 'Halved, with no further effect at 72 or 167 mU/L',
          referenceIds: ['greenhaff2008'],
        },
        {
          label: 'Leg protein breakdown with ~15 µU/mL insulin',
          value: '−47 % in young men, −12 % in older men',
          referenceIds: ['wilkes2009'],
        },
        {
          label: 'Fasting basal insulin',
          value: '5.5 ± 2.2 µU/mL at baseline, 1.3 ± 0.9 µU/mL after 72 h of fasting',
          note: 'In practice the person-specific value comes from the carbohydrate topic.',
          referenceIds: ['chan2008'],
        },
        {
          label: 'Insulin clamp in muscle on both study days',
          value: 'LC3B-II lowered after an overnight fast and after 72 h of fasting',
          referenceIds: ['vendelbo2014'],
        },
      ],
      timeCourse:
        'Suppression switches on within about 1 h and switches off as insulin returns to baseline, roughly 2.5–4 h after mixed meals (the carbohydrate topic).',
      moderators:
        "Age dulls insulin's anti-breakdown effect in muscle (−47 % vs −12 %). The model deliberately does not apply this, because it would raise older adults' fed-state signal and its meaning is unclear.",
      grade: 'C',
      gradeReason:
        'The human muscle data are good for protein breakdown (grade B), but applying them to autophagy is an extrapolation, and blood-cell flux showed no change after protein.',
      status: 'proposed-fit',
      caveats:
        "Autophagy (the cell's recycling process) cannot be measured in your organs by any routine test. This line is a relative model signal that shows when the conditions linked to autophagy in animal and a few small human studies are present — no recent protein or sugar, low insulin, depleted liver glycogen, rising ketones, recent hard exercise. It does not tell you how much autophagy is happening, in which tissue, or whether it improves your health; human studies measuring autophagy directly have mostly found small or no effects of fasting, protein timing or calorie restriction. Evidence grade: C–D (low). The shaded band shows how uncertain the timing is: the fasting length at which the signal reaches its midpoint could be anywhere from about 1 to 4 days. The equation is a proposed fit to protein-breakdown data, applied to autophagy signalling by analogy. The fallback insulin curve, used when the carbohydrate topic's curve is unavailable, is an unverified placeholder.",
      referenceIds: ['greenhaff2008', 'wilkes2009', 'fritzen2016', 'vendelbo2014', 'chan2008'],
      relatedMetricIds: ['autophagyIdx', 'mtorIdx'],
    },
    {
      id: '08-fasting-depth-drive',
      title: 'How deep the fast is',
      category: 'cellular',
      summary:
        "The longer it is since a meaningful meal, the lower insulin falls, the more liver glycogen is used up and the more ketones build up. Vitals folds a fasting clock, liver glycogen and the body's own ketone level (β-hydroxybutyrate, BHB) into one fasting-depth number between 0 and 1. Human muscle showed clear signs of lower mTOR activity at 72 h; earlier time points are mixed.",
      howModelled:
        'Three parts are added with weights. First, a clock counting hours since the last meaningful intake, passed through an S-shaped curve with its midpoint at 48 h. Second, how far liver glycogen has fallen below its normal 12 h value. Third, the endogenous ketone level. The clock resets when a meal has at least 10 g of protein or 15 g of digestible carbohydrate. Black coffee, tea, electrolytes, a splash of milk and pure fat do not reset it. Only ketones made by the body count, not ketone drinks.',
      equation:
        'F_clock = hFast^nh / (hFast^nh + h50^nh)\nF_glyc = clamp01(1 − liverGlycogenFrac / G_ref12)\nF_ket = bhbEndo² / (bhbEndo² + K_bhb²)\nF = w_c · F_clock + w_g · F_glyc + w_k · F_ket',
      keyNumbers: [
        {
          label: 'h50 (clock midpoint)',
          value: '48 h (range 24–96 h, log-uniform)',
          note: 'Proposed, grade D. Human anchors: 36 h modest, 72 h clear (static markers), 4 d in white blood cells.',
          referenceIds: ['dethlefsen2018', 'moller2015', 'vendelbo2014', 'pietrocola2017'],
        },
        {
          label: 'nh (steepness of the clock curve)',
          value: '2 (range 1.5–3)',
          note: 'No data behind it. Grade D.',
        },
        {
          label: 'Weights w_c / w_g / w_k',
          value: '0.6 / 0.2 / 0.2 (each ±50 %, renormalised)',
          note: 'The clock is the only input with human anchors. The glycogen and ketone terms let the signal respond to diet composition and fasted exercise. Grade D.',
        },
        {
          label: 'K_bhb (ketone level for half weight)',
          value: '1.5 (range 1.0–2.5) mmol/L',
          note: 'Reached about day 2 of a water fast (the fat oxidation and extended water-only fasting topics). Grade D.',
        },
        {
          label: 'G_ref12 (liver-glycogen fraction 12 h after a meal)',
          value: '0.5 placeholder',
          note: 'Computed from the carbohydrate topic in practice. The placeholder is unverified.',
        },
        {
          label: 'Insulin fall over a 72 h fast',
          value: '5.5 → 1.3 µU/mL',
          referenceIds: ['chan2008'],
        },
        {
          label: 'Gluconeogenesis share of glucose output',
          value: '64 % in the first 22 h, 82 % in the next 14 h, 96 % after',
          note: 'Gluconeogenesis is the liver making new glucose as glycogen runs out.',
          referenceIds: ['rothman1991'],
        },
        {
          label: 'Muscle mTOR phosphorylation at 72 h of fasting',
          value: '−40–50 %',
          referenceIds: ['vendelbo2014'],
        },
        {
          label: 'BHB infusion in humans',
          value: 'Leucine oxidation −30 %; muscle protein synthesis ~+10 %',
          referenceIds: ['nair1988'],
        },
      ],
      timeCourse:
        'The clock starts at the last meaningful meal and has no memory of its own. The glycogen and ketone terms do carry memory: someone who has just eaten but still has low liver glycogen or high ketones keeps a higher signal between meals. That follows from the design and is plausible but unproven. The drive approaches about 0.95 after 5–7 days. Whether autophagy falls again after several days is unknown, so the model plateaus.',
      moderators:
        'A blunted insulin fall in obesity enters automatically through the insulin signal. No age or sex multiplier is applied.',
      grade: 'C',
      gradeReason:
        'The direction is supported by human muscle at 72 h (grade C); the shape and weights are expert-set (grade D).',
      status: 'proposed-fit',
      caveats:
        "Autophagy (the cell's recycling process) cannot be measured in your organs by any routine test. This line is a relative model signal that shows when the conditions linked to autophagy in animal and a few small human studies are present — no recent protein or sugar, low insulin, depleted liver glycogen, rising ketones, recent hard exercise. It does not tell you how much autophagy is happening, in which tissue, or whether it improves your health; human studies measuring autophagy directly have mostly found small or no effects of fasting, protein timing or calorie restriction. Evidence grade: C–D (low). The shaded band shows how uncertain the timing is: the fasting length at which the signal reaches its midpoint could be anywhere from about 1 to 4 days. BHB is a marker of fasting depth, not a proven human driver of autophagy. A ketone-ester drink after exercise raised rather than lowered muscle mTORC1 signalling, so only ketones made by the body may count. BHB blocks a class of gene-silencing enzymes and induces FOXO3A in mice, which is grade D. If endogenous and drink-derived ketones cannot be separated, the ketone weight is set to 0. Mouse liver autophagy returns toward baseline by 48 h, and a human muscle-breakdown marker (3-methylhistidine) rose to day 5 then fell; the model plateaus regardless.",
      referenceIds: [
        'dethlefsen2018',
        'moller2015',
        'vendelbo2014',
        'pietrocola2017',
        'chan2008',
        'rothman1991',
        'nair1988',
        'vandoorne2017',
        'shimazu2013',
        'mizushima2004',
        'laurens2021',
        'wijngaarden2013',
      ],
      relatedMetricIds: ['autophagyIdx'],
    },
    {
      id: '08-ampk-exercise-glycogen',
      title: 'AMPK follows hard exercise, not fasting',
      category: 'cellular',
      summary:
        'AMPK is an enzyme that senses low cellular energy. When active, it nudges autophagy on and mTORC1 off. In human muscle it rose 3–4-fold after 60 min at about 75 % of maximal oxygen uptake, and it did not rise after 90 min at about 50 %. A 48 h fast lowered it in lean men. So AMPK follows exercise intensity and low muscle glycogen, not fasting.',
      howModelled:
        'A companion output, the muscle AMPK index (0–100), with rest set to 20. It rises with exercise intensity above about 55 % of maximal oxygen uptake, reaching full effect at 75 %, and decays over about an hour. It gets a smaller lift when muscle glycogen is low and a small dip during a long fast.',
      equation:
        'ampkIdx = 100 · clamp01( a0 · (1 + g_gly · dGly) · (1 − f_fast · F_clock) + a_ex · Σ_bouts fI_ampk(bout) · pulse(t; bout, tauA) )\nfI_ampk = clamp( (I_frac − 0.55) / (0.75 − 0.55), 0, 1.3 ), where I_frac is the fraction of VO2max\npulse = ramp 0→1 over the first 10 min of a bout, hold to the end, then exp(−(t − t_end) / tauA)\ndGly = clamp01( (G_norm − G_musc) / (G_norm − 150) ), in mmol/kg dw',
      keyNumbers: [
        {
          label: 'α2-AMPK after 60 min at ~75 % VO2max',
          value: '3–4-fold, fully reversed 3 h after exercise',
          note: 'No activation after 90 min at ~50 % VO2max.',
          referenceIds: ['wojtaszewski2000'],
        },
        {
          label: 'Glycogen-depleted muscle at rest (≈ 160 vs 900 mmol/kg dw)',
          value: 'α1 +60 %, α2 +45 % AMPK activity',
          referenceIds: ['wojtaszewski2003'],
        },
        {
          label: '48 h fast, muscle AMPK activity',
          value: 'Lower in lean men (n = 12), unchanged in obese (n = 14)',
          referenceIds: ['wijngaarden2013'],
        },
        { label: 'a0 (resting level)', value: '0.20', note: 'Normalisation: rest = 20.' },
        {
          label: 'a_ex (exercise weight)',
          value: '0.50 (range 0.4–0.6)',
          note: '75 % VO2max gives 0.70, which is 3.5 × rest.',
          referenceIds: ['wojtaszewski2000'],
        },
        {
          label: 'Threshold / full-effect intensity',
          value: '0.55 / 0.75 of VO2max (ranges 0.45–0.60 / 0.70–0.80)',
          referenceIds: ['wojtaszewski2000'],
        },
        {
          label: 'tauA (decay time of the pulse)',
          value: '1.0 h (range 0.5–1.5)',
          referenceIds: ['wojtaszewski2000'],
        },
        {
          label: 'g_gly (glycogen gain)',
          value: '0.5 (range 0.3–0.7)',
          referenceIds: ['wojtaszewski2003'],
        },
        {
          label: 'f_fast (fasting dip)',
          value: '0.2 (range 0–0.4)',
          referenceIds: ['wijngaarden2013'],
        },
        {
          label: 'Resistance session',
          value: 'fI_ampk = 0.6 × min(1, sets / 15)',
          note: 'Unverified; the resistance training and cardio topics own the real value.',
        },
      ],
      timeCourse:
        'AMPK rises during the bout, decays with a time constant of about 1 h, and is fully back to rest 3 h after exercise.',
      moderators:
        'Exercise intensity, muscle glycogen, and training status. AMPK Thr172 phosphorylation was lower in trained than untrained men during a 36 h fast.',
      grade: 'B',
      gradeReason:
        'Several human biopsy studies agree on the dependence on exercise intensity; the glycogen and fasting effects are grade C.',
      status: 'proposed-fit',
      caveats:
        "AMPK's causal role in human muscle autophagy is unsettled. ULK1 Ser555 phosphorylation after 1 h at 50 % VO2max correlated with AMPK Thr172 and inversely with LC3B lipidation. But in another study the fall in LC3-II/I did not correlate with AMPK activation, and the AMPK-activating drug AICAR did not change LC3-II/I in mouse muscle. The index equation is a proposed fit to the human data.",
      referenceIds: [
        'wojtaszewski2000',
        'wojtaszewski2003',
        'wijngaarden2013',
        'dethlefsen2018',
        'moller2015',
        'fritzen2016',
      ],
      relatedMetricIds: ['ampkIdx'],
    },
    {
      id: '08-sirtuins-nad',
      title: 'Sirtuins and NAD+',
      category: 'cellular',
      summary:
        'Sirtuins are enzymes that need a molecule called NAD+ to work, and they are often linked to longevity. The human data are indirect. Early time-restricted eating raised SIRT1 gene activity in blood cells by 10 ± 3 %, and 6 months of calorie restriction raised it in muscle. No human study links any of this to autophagy flux.',
      howModelled:
        'Not modelled as a separate state. The autophagy signal already responds to the upstream drivers (fasting and exercise), so a sirtuin term would count them twice.',
      keyNumbers: [
        {
          label: '4 days of early time-restricted eating, whole-blood SIRT1 mRNA',
          value: '+10 ± 3 %',
          referenceIds: ['jamshed2019'],
        },
        {
          label: '6 months of 25 % calorie restriction, muscle mitochondrial DNA',
          value: '+35 ± 5 % (restriction plus exercise: +21 %)',
          note: 'SIRT1 and PPARGC1A mRNA also rose. Citrate synthase and COX activity did not change.',
          referenceIds: ['civitarese2007'],
        },
        {
          label: 'Endurance training, muscle NAMPT protein (an enzyme that makes NAD+)',
          value: '+127 % in 3 weeks (athletes ≈ 2 × sedentary)',
          referenceIds: ['costford2010'],
        },
        {
          label: 'Nicotinamide riboside 1 g/d for 21 d, older muscle',
          value: 'Raised the NAD+ metabolome without changing mitochondrial function',
          referenceIds: ['elhassan2019'],
        },
        {
          label: 'Nicotinamide riboside for 6 weeks, blood NAD+',
          value: 'Raised in middle-aged and older adults',
          referenceIds: ['martens2018'],
        },
      ],
      moderators: 'Training raises muscle NAMPT; nothing else covered here moves this pathway.',
      grade: 'D',
      gradeReason:
        'Any human link from sirtuins to autophagy rests on indirect markers and mouse mechanisms; none has been measured in people.',
      status: 'contested',
      caveats:
        "Autophagy (the cell's recycling process) cannot be measured in your organs by any routine test. This line is a relative model signal that shows when the conditions linked to autophagy in animal and a few small human studies are present — no recent protein or sugar, low insulin, depleted liver glycogen, rising ketones, recent hard exercise. It does not tell you how much autophagy is happening, in which tissue, or whether it improves your health; human studies measuring autophagy directly have mostly found small or no effects of fasting, protein timing or calorie restriction. Evidence grade: C–D (low). The shaded band shows how uncertain the timing is: the fasting length at which the signal reaches its midpoint could be anywhere from about 1 to 4 days. NAD+ precursors raise NAD+ levels but no human study connects that to recycling activity.",
      referenceIds: ['jamshed2019', 'civitarese2007', 'costford2010', 'elhassan2019', 'martens2018'],
      relatedMetricIds: [],
    },
    {
      id: '08-exercise-autophagy-pulse',
      title: 'Hard or long exercise gives a short autophagy pulse',
      category: 'cellular',
      summary:
        'Exercise moves autophagy markers in human muscle more clearly than fasting does. Three hours after a vigorous bout, the marker LC3-II rose about 1.7-fold in muscle and blood cells of untrained men. After a 24 h run, LC3b-II in muscle was up 554 %. The changes depend on intensity and duration, were absent in endurance-trained men, and were not increased by fasting.',
      howModelled:
        'Each bout adds a pulse that ramps up during the session and fades with a 3 h time constant. Its size grows with intensity (from 40 % to 80 % of maximal oxygen uptake) and with duration (square-root scaling, capped at 1.5), and it is damped by training status. A resistance session counts up to 0.5. The headline signal can gain up to 15 index points and the muscle-specific one up to 25. Fasting does not boost it.',
      equation:
        'A_bout (endurance) = fI · fD · mT\nfI = clamp01( (I_frac − 0.40) / (0.80 − 0.40) )\nfD = min(1.5, √(duration_min / 60))\nmT = 1.0 untrained | 0.75 recreational | 0.5 endurance-trained\nA_bout (resistance) = 0.5 · min(1, totalSets / 15) · (1.0 untrained | 0.7 trained)\nxEx(t) = Σ_bouts A_bout · (ramp 0→1 during the bout; exp(−(t − t_end) / tauEx) after)\nasi contribution = A_ex · min(1.5, xEx); asiMuscle contribution = A_ex_m · min(1.5, xEx)',
      keyNumbers: [
        {
          label: 'A_ex (headline signal, index points)',
          value: '15 (range 5–25)',
          note: 'Grade D. Blood-cell LC3-II ×1.74 in untrained men was larger than any fasting effect seen in blood cells; the value is kept moderate.',
          referenceIds: ['specht2026'],
        },
        {
          label: 'A_ex_m (muscle signal, index points)',
          value: '25 (range 10–40)',
          note: 'Grade C/D.',
          referenceIds: ['schwalm2015', 'brandt2018', 'jamart2012', 'specht2026'],
        },
        {
          label: 'tauEx (pulse decay)',
          value: '3 h (range 2–6 h)',
          note: 'AMPK was back to rest by 3 h; LC3 and p62 changes appear over 1–3 h.',
          referenceIds: ['wojtaszewski2000', 'schwalm2015', 'brandt2018', 'specht2026'],
        },
        {
          label: 'Intensity floor / full effect',
          value: '0.40 / 0.80 of VO2max (±0.1)',
          note: 'Some signal at 50 %; strongest at high intensity. So 50 % gives 0.25, 65 % gives 0.63 and 80 % or more gives 1.',
          referenceIds: ['moller2015', 'schwalm2015', 'wojtaszewski2000'],
        },
        {
          label: 'Duration factor',
          value: '30 min → 0.71; 60 → 1; 120 → 1.41; ≥ 135 → 1.5',
        },
        {
          label: 'Fed/fasted synergy',
          value: 'None (×1.0; range 1.0–1.2)',
          note: 'Fasting did not potentiate the exercise effect.',
          referenceIds: ['moller2015', 'schwalm2015'],
        },
        {
          label: 'Vigorous bout at the 2nd ventilatory threshold, 3 h later, LC3-II fold change',
          value: 'Untrained: 1.74 (blood cells) / 1.69 (muscle); trained: no change',
          note: 'p62 fell to 0.50 (blood cells) and 0.57 (muscle) in untrained men. 7 endurance-trained and 5 untrained men.',
          referenceIds: ['specht2026'],
        },
        {
          label: '24 h treadmill run (149.8 ± 16.3 km), muscle',
          value:
            'LC3b-II +554 ± 256 %; AMPK phosphorylation +247 ± 170 %; Akt −74 %; mTOR Ser2448 −32 ± 14 %',
          referenceIds: ['jamart2012'],
        },
        {
          label: 'Resistance exercise, direction of LC3',
          value:
            'LC3B-II/I lower at 3–24 h in young and old; LC3-II higher at 48 h in untrained young men only',
          referenceIds: ['fry2013', 'hentila2018'],
        },
      ],
      timeCourse:
        'Acute endurance exercise lowered muscle LC3-II during or just after the session, then raised LC3 and BNIP3 and lowered p62 over the next 1–3 h. A delayed rise after resistance exercise (LC3-II up at 48 h in untrained young men) is switched off by default because another study saw the opposite direction at 24 h.',
      moderators:
        'Intensity and duration; training status (blunted in trained people); not whether you are fed or fasted.',
      grade: 'C',
      gradeReason:
        'It is well supported that high-intensity or long exercise changes muscle autophagy markers (grade B); the size of the effect on the index rests on small studies with static markers.',
      status: 'proposed-fit',
      caveats:
        "Autophagy (the cell's recycling process) cannot be measured in your organs by any routine test. This line is a relative model signal that shows when the conditions linked to autophagy in animal and a few small human studies are present — no recent protein or sugar, low insulin, depleted liver glycogen, rising ketones, recent hard exercise. It does not tell you how much autophagy is happening, in which tissue, or whether it improves your health; human studies measuring autophagy directly have mostly found small or no effects of fasting, protein timing or calorie restriction. Evidence grade: C–D (low). The shaded band shows how uncertain the timing is: the fasting length at which the signal reaches its midpoint could be anywhere from about 1 to 4 days. Resistance-exercise results point in different directions between studies. The study behind the size of the pulse had 12 men and static markers. In mice, exercise-induced autophagy in muscle was required for exercise's glucose benefits, which is grade D.",
      referenceIds: [
        'schwalm2015',
        'moller2015',
        'fritzen2016',
        'brandt2018',
        'jamart2012',
        'specht2026',
        'fry2013',
        'hentila2018',
        'glynn2010',
        'wojtaszewski2000',
        'he2012',
      ],
      relatedMetricIds: ['autophagyIdx', 'ampkIdx'],
    },
    {
      id: '08-chronic-restriction-term',
      title: 'Long-term calorie or protein restriction',
      category: 'cellular',
      summary:
        'Blood-cell flux did not change after 6 months of calorie restriction or after 4 weeks of eating half as much protein. Muscle did show shifts in gene activity after 2 years of about 12 % restriction, and higher LC3 and Beclin-1 in people who had restricted for 3–15 years. So Vitals adds only a small term for sustained restriction and none for protein restriction.',
      howModelled:
        'The model keeps a 7-day moving average of the energy deficit, with a fast day counting as 1.0. A deficit of 25 % of maintenance or more gives up to 3 index points, and smaller deficits give proportionally less. Protein restriction gives zero. The term is small by design, so a restriction-only arm stays within about 4 points of control.',
      equation:
        'd(cDef)/dt = (clamp01(1 − intake_kcal / maintenance_kcal) − cDef) / tauCR, evaluated daily; a fast day counts as 1\nasi_CR = A_CR · clamp01(cDef / 0.25)',
      keyNumbers: [
        {
          label: 'A_CR (maximum index points)',
          value: '3 (range 0–8)',
          note: 'Grade D. Null blood-cell flux versus positive muscle data, so the term is kept small.',
          referenceIds: ['bensalem2025', 'yang2016', 'das2023'],
        },
        { label: 'tauCR (averaging time)', value: '7 d (range 3–14)', note: 'Proposed.' },
        {
          label: 'Protein-restriction term',
          value: '0',
          note: 'Based on a null randomised trial (grade B for the null).',
          referenceIds: ['singh2026'],
        },
        {
          label: '6 months of continuous restriction (70 % of needs) vs standard care, blood-cell flux',
          value: 'Not different',
          referenceIds: ['bensalem2025'],
        },
        {
          label: '4 weeks of 10 % vs 20 % of energy as protein, blood-cell flux',
          value: '−8.46 ng LC3B-II/mg/h (95 % CI −24.06 to 7.14; p = 0.28)',
          referenceIds: ['singh2026'],
        },
        {
          label: '2 years of ~12 % restriction, muscle RNA-seq (90 people)',
          value: 'Proteostasis, FOXO3, mitochondrial-biogenesis and inflammation genes changed',
          referenceIds: ['das2023'],
        },
        {
          label: 'Self-imposed restriction for 3–15 years, muscle (cross-sectional)',
          value: 'Higher LC3, Beclin-1, HSP70, Grp78; cortisol 15.6 ± 4.6 vs 12.3 ± 3.9 ng/dL',
          referenceIds: ['yang2016'],
        },
      ],
      timeCourse:
        'The chronic term follows a 7-day moving average of the deficit, so it builds and fades with a time constant of about a week.',
      moderators: 'Size of the deficit only.',
      grade: 'D',
      gradeReason:
        "Vitals' evidence review rates this C/D: positive muscle data conflict with null blood-cell flux, so the term is kept small.",
      status: 'proposed-fit',
      caveats:
        "Autophagy (the cell's recycling process) cannot be measured in your organs by any routine test. This line is a relative model signal that shows when the conditions linked to autophagy in animal and a few small human studies are present — no recent protein or sugar, low insulin, depleted liver glycogen, rising ketones, recent hard exercise. It does not tell you how much autophagy is happening, in which tissue, or whether it improves your health; human studies measuring autophagy directly have mostly found small or no effects of fasting, protein timing or calorie restriction. Evidence grade: C–D (low). The shaded band shows how uncertain the timing is: the fasting length at which the signal reaches its midpoint could be anywhere from about 1 to 4 days. Methionine restriction has no human autophagy data.",
      referenceIds: ['bensalem2025', 'yang2016', 'das2023', 'singh2026'],
      relatedMetricIds: ['autophagyIdx'],
    },
    {
      id: '08-autophagy-signal-index',
      title: 'The Autophagy Signal Index',
      category: 'cellular',
      summary:
        "Vitals' autophagy line is not a measurement. It is a relative 0–100 index of how many conditions linked to autophagy are present at a given hour: no recent protein or carbohydrate, low insulin, depleted liver glycogen, rising ketones and recent hard exercise. It is set to 25 at 12 h after a meal by definition. Changing meal timing moves its daily mean by only a few points. Multi-day fasts and hard or long exercise move it most.",
      howModelled:
        'Each hour the model works out the fasting clock, the nutrient suppression from amino acids and insulin, the fasting-depth drive, any recent exercise pulse, and a small term for sustained restriction. The core is (1 − suppression) times a baseline plus the fasting drive. A baseline constant B0 is calibrated so that the index reads exactly 25 at 12 h after a meal. The result is then plotted with a likely-range band.',
      equation:
        'ASI_core = 100 · (1 − S) · ( B0 + (1 − B0) · F )\nasi = clamp( ASI_core + A_ex · min(1.5, xEx) + asi_CR, 0, 100 )\nasiMuscle = clamp( ASI_core + A_ex_m · min(1.5, xEx) + asi_CR, 0, 100 )\nB0 = (0.25 − F12) / (1 − F12), where F12 is F at 12 h since the last meal',
      keyNumbers: [
        {
          label: 'Central value by hours since the last meal',
          value:
            '0–1 h: 2–5; 4 h: 15–18; 12 h: 25 (by definition); 16 h: 28; 18 h: 30; 24 h: 36; 36 h: 49; 48 h: 60; 72 h: 75; 96 h: 84; 120 h: 89; 168 h: 94',
          note: 'Check anchors, to be matched within ±5 points after calibration; if not, adjust h50 within 36–60 h.',
        },
        {
          label: 'P10–P90 band (h50 24–96 h, nh 1.5–3; 20 000 draws)',
          value:
            '16 h: 26–33; 18 h: 26–37; 24 h: 28–49; 36 h: 34–69; 48 h: 41–81; 72 h: 56–92; 96 h: 67–96; 120 h: 76–98; 168 h: 86–99',
        },
        {
          label: 'Clock reset rule',
          value: 'Protein ≥ 10 g or digestible carbohydrate ≥ 15 g',
          note: 'Proposed threshold, grade D. Chosen so black coffee, tea, electrolytes, a splash of milk and pure-fat additions do not reset it, but a real meal or about 2 eggs do.',
        },
        {
          label: 'B0 with the clock-only fallback',
          value: '0.203',
          note: 'Recalibrated per draw so that 12 h reads 25.',
        },
        {
          label: 'Labels for the display',
          value:
            '0–15 “fed, suppressed”; 15–30 “post-absorptive (baseline)”; 30–50 “extended or short fast”; 50–75 “prolonged fast”; 75–100 “multi-day fast”',
        },
        {
          label: 'Daily mean signal by eating pattern (illustrative)',
          value:
            '4 meals 08:00–19:00: 13; 3 meals in a 12 h window: 15; 8 h window (12/16/20): 16; early 6 h window (08:00 and 13:30): 18; 6 h window (13/19): 18; 4 h window (16:00 and 19:30): 19; one meal a day: 24; a 36 h fast day: 30; water-only fast, hours ~53–77: 72',
          note: 'Clock-only fallback with placeholder insulin and leucine curves, 120 g protein and 220 g carbohydrate a day, steady state on day 4. These figures will change once the full protein and carbohydrate curves replace the placeholders.',
        },
        {
          label: 'Hard 60 min bout at ≥ 80 % VO2max (untrained), added',
          value: '+15 at bout end; half-life ~2 h',
        },
        {
          label: 'Prototype weekly means for the 6-month trial arms (clock-only)',
          value:
            'Standard care 14.9; continuous restriction 18.7; intermittent fasting plus early eating window 20.6',
          note: 'Only the order matters: fasting arm > restriction ≥ standard care.',
          referenceIds: ['bensalem2025'],
        },
      ],
      timeCourse:
        'Updated hourly. The signal climbs from about 25 at 12 h to about 94 by 168 h of fasting. An exercise pulse adds points that fade with a half-life of about 2 h. Nutrient suppression switches on within about an hour of a meal.',
      moderators:
        "Deliberately none for age or sex. Blood-cell flux rises with age, older monocytes respond more to amino-acid starvation, older men lacked the resistance-exercise rise, and insulin's effect is dulled with age, so the directions conflict. Females show higher flux, but the index is relative within a person. Training status applies to exercise pulses only.",
      grade: 'D',
      gradeReason:
        "Vitals' evidence review rates the index C/D overall: the direction has some human support, but the weights are expert-set and no human data link any schedule to flux in a solid organ.",
      status: 'proposed-fit',
      caveats:
        "Autophagy (the cell's recycling process) cannot be measured in your organs by any routine test. This line is a relative model signal that shows when the conditions linked to autophagy in animal and a few small human studies are present — no recent protein or sugar, low insulin, depleted liver glycogen, rising ketones, recent hard exercise. It does not tell you how much autophagy is happening, in which tissue, or whether it improves your health; human studies measuring autophagy directly have mostly found small or no effects of fasting, protein timing or calorie restriction. Evidence grade: C–D (low). The shaded band shows how uncertain the timing is: the fasting length at which the signal reaches its midpoint could be anywhere from about 1 to 4 days. One known result the model does not reproduce: 35 g of protein did not change blood-cell flux at 1 h, whereas the index drops sharply after any protein meal by design (from muscle data). The dip reflects signalling in muscle, not measured flux in blood. The midpoint h50 (24–96 h) is the most influential parameter.",
      referenceIds: [
        'bensalem2025',
        'singh2025',
        'singh2026',
        'jamshed2019',
        'bensalem2023',
        'dang2025',
        'hentila2018',
        'wilkes2009',
        'dethlefsen2018',
        'specht2026',
      ],
      relatedMetricIds: ['autophagyIdx'],
    },
    {
      id: '08-muscle-mtorc1-index',
      title: 'Muscle growth-signalling index (mTORC1)',
      category: 'cellular',
      summary:
        'mTORC1 is the growth-signalling complex that protein, insulin and resistance training switch on. Vitals offers an advanced index that follows this signalling, not muscle protein synthesis itself. It rises after protein, more so after resistance training, and sits lower during a long fast, where mTOR phosphorylation fell 40–50 % at 72 h.',
      howModelled:
        "A low resting baseline that falls with the fasting clock, plus an acute part driven by amino acids with a small insulin bonus, boosted by a training sensitivity that fades over 24–48 h. Vitals' evidence review recommends showing it only in an advanced signalling view.",
      equation:
        'mBase = 0.20 · (1 − 0.65 · F_clock)\nmAcute = S_aa · (0.77 + 0.23 · S_ins)\nmtorIdx = 100 · clamp01( mBase + (1 − mBase) · mAcute · (1 + kRE · reSens(t)) )',
      keyNumbers: [
        {
          label: 'Fasting baseline fall',
          value: '0.65 (range 0.4–0.8)',
          note: 'Check: at 72 h, 0.2 × (1 − 0.65 × 0.69) = 0.11, about −45 %.',
          referenceIds: ['vendelbo2014'],
        },
        {
          label: 'kRE (resistance-training boost)',
          value: '0.3 (range 0.1–0.5)',
          note: 'Unverified. The sensitivity term from the protein topic is preferred.',
        },
        {
          label: 'Ultra-endurance run, muscle mTOR Ser2448',
          value: '−32 ± 14 %',
          referenceIds: ['jamart2012'],
        },
        {
          label: 'Ketone-ester drink after exercise',
          value: 'Raised mTORC1 signalling (S6K1, 4E-BP1 phosphorylation)',
          referenceIds: ['vandoorne2017'],
        },
        {
          label: '“Muscle full” effect after protein',
          value: 'Protein synthesis back to baseline at ~2 h while S6K1 and 4EBP1 stay up ≥ 3 h',
          referenceIds: ['atherton2010'],
        },
      ],
      timeCourse:
        'After protein, signalling stays raised for about 2–4 h. Resistance training extends and enlarges the response, with a sensitivity that fades over 24–48 h. Prolonged fasting lowers the baseline.',
      moderators: 'Protein dose, insulin, resistance training and fasting time.',
      grade: 'B',
      gradeReason: 'Direction and timing are well supported in human muscle; the magnitudes are grade C.',
      status: 'proposed-fit',
      caveats:
        'The index tracks signalling, not protein synthesis: synthesis returns to baseline at about 2 h while signalling stays up for at least 3 h.',
      referenceIds: ['vendelbo2014', 'jamart2012', 'vandoorne2017', 'atherton2010'],
      relatedMetricIds: ['mtorIdx'],
    },
    {
      id: '08-igf1-relative-level',
      title: 'IGF-1 in fasting and protein restriction',
      category: 'hormones',
      summary:
        'IGF-1 is a growth signal made mostly by the liver. It stays put in a 24 h fast, falls by about half by 72 h and to about a quarter by 10 days. Eating brings it back much more slowly than it fell. Calorie restriction with adequate protein did not lower it in people, while eating less protein did.',
      howModelled:
        'A relative level where 1.0 is your usual on your habitual diet. A fasting target of 0.25 switches on after about 30 h. It is multiplied by a slow protein factor based on your recent protein intake. The level then drifts towards the target with a time constant of 44 h going down and 173 h going up.',
      equation:
        's = 1 / (1 + exp(−(hFast − LAG) / LW))\nT_E = 1 − (1 − A_inf) · s\nTP(P) = clamp(1 − 0.306 · (1.67 − P), 0.5, 1.0), where P is the 7-day mean protein in g/kg/d on eating days\nd(igfProt)/dt = (TP(P7) / TP(P_habitual) − igfProt) / tauP, applied only while hFast < 24\nT = T_E · igfProt\nd(igf1Rel)/dt = (T − igf1Rel) / (T < igf1Rel ? tauDown : tauUp)',
      keyNumbers: [
        {
          label: '24 h fast (n = 47)',
          value: 'IGF-1 unchanged (growth hormone ≈ 5-fold up)',
          referenceIds: ['hollstein2022'],
        },
        {
          label: '72 h fast (n = 14)',
          value: 'Total IGF-1 334 → 166 µg/L (−50 %); free IGF-1 −70 %; IGFBP-1 ×4.4',
          note: 'Insulin fell from 5.5 to 1.3 µU/mL.',
          referenceIds: ['chan2008'],
        },
        {
          label: '5 d fast (n = 5, normal weight)',
          value: 'Somatomedin-C 1.85 → 0.67 U/mL (0.36 of baseline)',
          note: 'Then 5 d normal diet: 1.26 U/mL (0.68). Then 5 d isocaloric at 32 % of control protein: 0.90 U/mL (0.49). Then 5 d with protein and energy deficient: 0.31 U/mL (0.17).',
          referenceIds: ['isley1983'],
        },
        {
          label: '10 d fast (7 obese men)',
          value: '0.83 → 0.21 U/mL (0.25)',
          referenceIds: ['clemmons1981'],
        },
        {
          label: 'Protein 1.67 → 0.95 g/kg/d for 3 weeks (6 restriction practitioners)',
          value: '194 → 152 ng/mL (0.78)',
          note: 'Severe long-term restriction (1 and 6 y) with adequate protein: no change in IGF-1 or IGF-1:IGFBP-3.',
          referenceIds: ['fontana2008'],
        },
        {
          label: '2 years of ~12 % calorie restriction (CALERIE)',
          value: 'IGF-1 unchanged; IGFBP-1 +21 %; IGF-1:IGFBP-1 −42 %',
          referenceIds: ['fontana2016'],
        },
        {
          label: 'Fasting-mimicking diet, 3 cycles of 5 d a month, measured 5–7 d after the third',
          value: '−21.7 ± 46.2 vs +8.7 ± 36.9 ng/mL (≈ −13 %)',
          referenceIds: ['wei2017'],
        },
        {
          label: 'Fasting-mimicking diet, 5 d, day 6',
          value: '−23 ng/mL (not significant vs control −5)',
          referenceIds: ['espinoza2026'],
        },
        {
          label: '8 weeks of an 8 h eating window plus resistance training, isocaloric',
          value: 'IGF-1 decreased (p = 0.04)',
          note: 'Magnitude was not extracted.',
          referenceIds: ['moro2016'],
        },
        {
          label: 'LAG / LW',
          value: '30 h (24–42) / 3 h (2–6)',
          note: '24 h unchanged, fall by 72 h. Fitted.',
          referenceIds: ['hollstein2022', 'chan2008'],
        },
        {
          label: 'A_inf (long-fast floor)',
          value: '0.25 (range 0.2–0.3)',
          referenceIds: ['clemmons1981'],
        },
        {
          label: 'tauDown / tauUp',
          value: '44 h (30–60) / 173 h (120–240)',
          note: 'Recovery is about 4 times slower than the fall. Fitted to the 72 h and 5 d data and to the 5 d refeed (0.36 → 0.68).',
          referenceIds: ['chan2008', 'isley1983'],
        },
        {
          label: 'Protein slope / tauP',
          value: '0.306 per g/kg/d (0.2–0.4) / 168 h (72–240)',
          note: 'The slope comes from 1.67 → 0.95 g/kg ⇒ 0.78. tauP is a compromise between the fast refeeding data and the slow fasting-mimicking data.',
          referenceIds: ['fontana2008', 'isley1983', 'espinoza2026', 'wei2017'],
        },
        {
          label: 'Fit quality, model (observed)',
          value:
            '24 h 0.98 (~1.0); 72 h 0.52 (0.50); 5 d 0.33 (0.36); 10 d 0.24 (0.25); normal refeed 0.62 (0.68); protein-deficient refeed 0.58 (0.49); 0.95 g/kg × 3 weeks 0.79 (0.78); fasting-mimicking day 5 0.84 (~0.86–0.88)',
        },
      ],
      timeCourse:
        'No change through 24 h. After about 30 h it falls with a time constant of 44 h, reaching about 0.5 at 72 h and about 0.25 by 10 days. On refeeding it recovers with a time constant of 173 h, so a 5-day refeed after a 5-day fast only reached 0.68.',
      moderators:
        'Protein intake (a slow factor). Energy restriction on its own, with adequate protein, has no term. The model mixes normal-weight (5 d) and obese (10 d) fasting data.',
      grade: 'B',
      gradeReason:
        'Several human fasting and protein studies agree on direction and size; the time constants are grade C and come from small studies of 5–14 people.',
      status: 'proposed-fit',
      caveats:
        'The health meaning of IGF-1 is U-shaped, so the index is informational and is not a “lower is better” goal. The fit mixes small studies and has errors of up to ±0.09.',
      referenceIds: [
        'hollstein2022',
        'chan2008',
        'isley1983',
        'clemmons1981',
        'fontana2008',
        'fontana2016',
        'wei2017',
        'espinoza2026',
        'moro2016',
      ],
      relatedMetricIds: ['igf1'],
    },
    {
      id: '08-fgf21-not-charted',
      title: 'FGF21 and why it is not charted',
      category: 'hormones',
      summary:
        'FGF21 is a liver hormone that is sometimes linked to fasting benefits. In people it varies about 250-fold between individuals, did not change after a 2-day fast or a ketone-raising diet, and rose 74 % only after 7 days of fasting. It also rises after fructose, sucrose, low-protein diets and, in men, exercise. A fasting-driven FGF21 curve would mislead, so Vitals does not chart it.',
      howModelled: 'Not modelled. The Evidence library mentions it, but no curve is drawn.',
      keyNumbers: [
        {
          label: 'Variation between individuals',
          value: '≈ 250-fold',
          referenceIds: ['galman2008'],
        },
        {
          label: 'Prolonged fasting',
          value: '+74 % after 7 days; no change after a 2-day fast',
          referenceIds: ['galman2008'],
        },
        {
          label: 'Low-protein diet for 28 days',
          value: 'Rises “dramatically”',
          note: 'No magnitude is given in the research summary.',
          referenceIds: ['laeger2014'],
        },
        {
          label: '75 g fructose',
          value: '3.4-fold at 2 h; back to baseline by 5 h',
          referenceIds: ['dushay2015'],
        },
        {
          label: 'Sucrose',
          value: 'Rises after intake',
          referenceIds: ['soberg2017'],
        },
        {
          label: 'Exercise',
          value: 'Rises in men but not in women',
          referenceIds: ['peterson2025'],
        },
      ],
      moderators: 'Sex, sugar and alcohol intake, and protein intake all matter more than fasting.',
      grade: 'C',
      gradeReason:
        'Several human studies agree it is driven by fructose, protein restriction and sex, though sizes vary.',
      status: 'established',
      caveats:
        'The reason for leaving it out is that fructose, alcohol and sex effects swamp any fasting effect, so a fasting-only curve would not represent what people actually see.',
      referenceIds: ['galman2008', 'laeger2014', 'dushay2015', 'soberg2017', 'peterson2025'],
      relatedMetricIds: [],
    },
    {
      id: '08-tissue-specificity',
      title: 'Is more autophagy always better?',
      category: 'cellular',
      summary:
        'No. In muscle, a baseline level of autophagy is needed to keep muscle mass, yet too much FoxO3-driven autophagy promotes wasting. In people, a 72 h fast doubled net muscle phenylalanine release, and a 10-day fast lost 5.9 kg (7 %), of which 3.53 kg was lean soft tissue. In mice, health gains did not track lifespan gains. Health, lifespan and autophagy are three different things.',
      howModelled:
        'Vitals never labels a higher autophagy signal as healthier. It describes the signal as a set of conditions. The Planner will not trade lean mass, bone or safety outcomes of grade A or B for a grade C/D signal gain.',
      keyNumbers: [
        {
          label: 'Muscle-specific Atg7 deletion in mice',
          value: 'Muscle wasting, abnormal mitochondria, weakness',
          note: 'Autophagy inhibition also worsened muscle loss during fasting and denervation.',
          referenceIds: ['masiero2009'],
        },
        {
          label: 'FoxO3-driven autophagy in muscle',
          value: 'A driver of atrophy when excessive',
          referenceIds: ['mammucari2007'],
        },
        {
          label: '72 h fast, net muscle phenylalanine release',
          value: '≈ +100 %',
          referenceIds: ['vendelbo2014'],
        },
        {
          label: '10 d fast (about 200–250 kcal/d, low-intensity activity)',
          value: '−5.9 kg (7 %), of which 3.53 kg lean soft tissue',
          note: 'Plasma 3-methylhistidine, a muscle-breakdown marker, rose to day 5 then fell.',
          referenceIds: ['laurens2021'],
        },
        {
          label: 'Atg5 over-expression in mice',
          value: 'Median lifespan +17.2 %',
          referenceIds: ['pyo2013'],
        },
        {
          label: '960 genetically diverse mice',
          value:
            'Calorie restriction and intermittent fasting extended lifespan in proportion to restriction',
          note: 'Metabolic improvements did not track lifespan, 40 % restriction cost lean mass and immune repertoire, and fasting did not help heavier mice.',
          referenceIds: ['difrancesco2024'],
        },
        {
          label: 'Blood-cell flux and age',
          value: 'Rises with age, possibly a stress response',
          note: 'This questions the idea that higher flux means younger.',
          referenceIds: ['bensalem2023'],
        },
        {
          label: 'Human fat tissue after a 10 d fast',
          value: 'Lysosome programme engaged; lysosome inhibitors reduced lipolysis in explants',
          referenceIds: ['kumar2025'],
        },
      ],
      timeCourse:
        'In rat liver, recycling supplies amino acids for making glucose early in a fast. There are no human data for liver, brain or heart.',
      moderators: 'Tissue, age, and how long the fast lasts.',
      grade: 'D',
      gradeReason: 'No human study links any level of autophagy to health outcomes in a dose-response way.',
      status: 'contested',
      caveats:
        "Autophagy (the cell's recycling process) cannot be measured in your organs by any routine test. This line is a relative model signal that shows when the conditions linked to autophagy in animal and a few small human studies are present — no recent protein or sugar, low insulin, depleted liver glycogen, rising ketones, recent hard exercise. It does not tell you how much autophagy is happening, in which tissue, or whether it improves your health; human studies measuring autophagy directly have mostly found small or no effects of fasting, protein timing or calorie restriction. Evidence grade: C–D (low). The shaded band shows how uncertain the timing is: the fasting length at which the signal reaches its midpoint could be anywhere from about 1 to 4 days. Brain results in mice conflict (none at 48 h with one method, profound induction with another). Ethanol inhibited recycling in perfused rat liver, which is animal evidence only.",
      referenceIds: [
        'masiero2009',
        'mammucari2007',
        'vendelbo2014',
        'laurens2021',
        'pyo2013',
        'difrancesco2024',
        'bensalem2023',
        'kumar2025',
        'mortimore1989',
        'poso1987',
        'mizushima2004',
        'alirezaei2010',
      ],
      relatedMetricIds: ['autophagyIdx'],
    },
    {
      id: '08-autophagy-vs-muscle-gain',
      title: 'Autophagy and muscle gain: where they conflict',
      category: 'cellular',
      summary:
        'Autophagy-favouring and muscle-building states take turns within a day; they do not exclude each other. After a protein feeding, muscle mTORC1 signalling stays raised for about 2–4 h. A day with 3 protein feedings therefore has about 6–10 h of building state and 14–18 h of low-mTOR state. Trials of shorter eating windows with resistance training and enough protein found similar muscle gains. Multi-day fasts, sustained calorie restriction and low protein do conflict with gaining muscle.',
      howModelled:
        'The Planner uses a compatibility table plus four proposed rules. If muscle gain ranks above autophagy: protein at least 1.6 g/kg/d in at least 3 feedings spaced 3 h or more apart (an eating window of about 7–8 h or longer), energy at or above maintenance, and no fasts over 24 h. If autophagy ranks first: allow 16–20 h windows and occasional 24–36 h fasts within the safety limits, keep protein at 1.2–1.6 g/kg/d on eating days and at least 2 resistance sessions a week, and warn that gains will be slower. Grade A or B outcomes are never traded for a C/D signal unless the user ranked autophagy first and acknowledged the evidence statement. A concave utility stops the optimiser chasing ever-longer fasts.',
      equation: 'U(ASI) = max(0, 1 − exp(−(asiWeeklyMean − 13) / 15))',
      keyNumbers: [
        {
          label: '10–12 h eating window, 3–4 feedings',
          value: 'Signal ≈ 13–15; fully compatible with muscle gain',
        },
        {
          label:
            '8 h window, ≥ 3 feedings of ≥ 0.3–0.4 g/kg, ≥ 1.6 g/kg/d, energy ≥ maintenance, with resistance training',
          value: '+1 to +3 points; compatible',
          note: 'Grade B.',
          referenceIds: ['tinsley2019', 'moro2016'],
        },
        {
          label: '6 h window (2–3 feedings)',
          value: '+3 to +5 points; mild conflict',
          note: 'Grade C. Fewer, larger feedings.',
          referenceIds: ['areta2013'],
        },
        {
          label: '4 h window or one meal a day',
          value: '+5 to +10 points; conflict',
          note: 'Grade C. One or two feedings; hard to reach a surplus and a good distribution.',
        },
        {
          label: '24–36 h fast once a week',
          value: '+2 to +4 points; moderate conflict',
          note: 'Grade C/D.',
        },
        {
          label: '48–72 h or longer fasts',
          value: '+40–60 during the fast; strong conflict',
          note: 'Grade B. Net muscle protein loss doubled at 72 h, and lean tissue was lost.',
          referenceIds: ['vendelbo2014', 'laurens2021'],
        },
        {
          label: 'Continuous calorie restriction of 10–25 %',
          value: '+2 to +4 points; conflict with gain',
          note: 'Grade A/B. CALERIE fat-free mass −2.2 kg over 2 years.',
          referenceIds: ['villareal2016'],
        },
        {
          label: 'Protein ≤ 0.8 g/kg',
          value: 'About 0; strong conflict',
          note: 'Grade B. No flux effect.',
          referenceIds: ['morton2018', 'singh2026'],
        },
        {
          label: 'Hard endurance bouts ≥ 70 % VO2max',
          value: '+10–25 transient; compatible in moderate volume',
          note: 'Grade B/C. Interference with lifting is covered in the cardio topic.',
        },
        {
          label: 'Resistance training',
          value: 'Small transient rise; synergistic',
          note: 'Grade A. It is required for gain.',
        },
        {
          label: 'Training fasted vs fed',
          value: 'No extra signal; neutral to slightly negative for performance',
          note: 'Grade B.',
          referenceIds: ['moller2015', 'schwalm2015'],
        },
        {
          label: '8 weeks, resistance-trained women, ~7.5 h window (12:00–20:00), 1.6 g/kg/d with whey',
          value: 'Fat-free mass +2–3 % and hypertrophy equal to a ~13 h window',
          referenceIds: ['tinsley2019'],
        },
        {
          label: '8 weeks, resistance-trained men, 8 h window (13/16/20 h meals), isocaloric (~22 % protein)',
          value:
            'Fat mass down; fat-free mass, muscle area and strength maintained; testosterone and IGF-1 down',
          referenceIds: ['moro2016'],
        },
        {
          label: '12 weeks, 12:00–20:00 window, no resistance training',
          value: 'Appendicular lean-mass index −0.16 kg/m² vs control (95 % CI −0.27 to −0.05)',
          referenceIds: ['lowe2020'],
        },
        {
          label: 'Protein distribution over 12 h after resistance exercise',
          value:
            '4 × 20 g every 3 h gave 31–48 % more muscle protein synthesis than 2 × 40 g every 6 h or 8 × 10 g',
          referenceIds: ['areta2013'],
        },
      ],
      timeCourse:
        'The building state lasts about 2–4 h after each protein feeding. Muscle protein synthesis itself returns to baseline by about 2 h.',
      moderators:
        'Protein amount (at least 1.6 g/kg/d supports gains) and how it is spread across feedings, energy availability, and resistance training.',
      grade: 'C',
      gradeReason:
        "Vitals' evidence review mixes grade B (shorter windows with training and adequate protein) with C and D (longer windows and weekly fasts), so the overall grade is set to C.",
      status: 'proposed-fit',
      caveats:
        "Autophagy (the cell's recycling process) cannot be measured in your organs by any routine test. This line is a relative model signal that shows when the conditions linked to autophagy in animal and a few small human studies are present — no recent protein or sugar, low insulin, depleted liver glycogen, rising ketones, recent hard exercise. It does not tell you how much autophagy is happening, in which tissue, or whether it improves your health; human studies measuring autophagy directly have mostly found small or no effects of fasting, protein timing or calorie restriction. Evidence grade: C–D (low). The shaded band shows how uncertain the timing is: the fasting length at which the signal reaches its midpoint could be anywhere from about 1 to 4 days. The effect-on-signal column comes from the model itself, so it is only as reliable as the index. The planner rules are proposed, not tested.",
      referenceIds: [
        'atherton2010',
        'vendelbo2014',
        'fritzen2016',
        'tinsley2019',
        'moro2016',
        'lowe2020',
        'areta2013',
        'morton2018',
        'villareal2016',
        'laurens2021',
        'moller2015',
        'schwalm2015',
        'singh2026',
      ],
      relatedMetricIds: ['autophagyIdx', 'mtorIdx'],
    },
    {
      id: '08-protein-restriction-igf1',
      title: 'Protein restriction, IGF-1 and ageing',
      category: 'hormones',
      summary:
        'Some studies link lower protein intake to lower IGF-1 and lower cancer deaths in people under 65, but the same data show the opposite pattern after 65. Lower IGF-1 is not simply better: death rates are lowest in the middle. Older adults who ate more protein lost less lean mass. In a randomised trial in young adults, eating less protein produced no autophagy benefit.',
      howModelled:
        'Protein restriction is not treated as an autophagy lever. IGF-1 is shown as an informational output with a U-shape caveat and is not a goal by default. Age-dependent protein floors override any longevity-motivated restriction. If someone still wants lower protein, the app shows the predicted IGF-1 change next to the predicted lean-mass cost.',
      keyNumbers: [
        {
          label:
            'NHANES III, ages 50–65, high protein (≥ 20 % of energy) vs low (< 10 %), all-cause mortality',
          value: 'HR 1.74 (1.02–2.97)',
          note: 'n = 6,381 aged 50 and over, 18-year follow-up, a single 24 h dietary recall. Cancer HR 4.33 (1.96–9.56); attenuated when protein was plant-derived.',
          referenceIds: ['levine2014'],
        },
        {
          label: 'NHANES III, ages over 65, high protein, all-cause mortality',
          value: 'HR 0.72 (0.55–0.94)',
          note: 'IGF-1 sub-cohort (n = 2,253): cancer mortality HR ×1.09 per +10 ng/mL for high vs low protein.',
          referenceIds: ['levine2014'],
        },
        {
          label: 'Protein 1.67 → 0.95 g/kg/d',
          value: 'IGF-1 −22 %',
          note: 'Calorie restriction without protein restriction does not lower IGF-1.',
          referenceIds: ['fontana2008'],
        },
        {
          label: 'IGF-1 and mortality, meta-analysis (12 studies, 14,906 people)',
          value: 'Low IGF-1 HR 1.27 (1.08–1.49); high HR 1.18 (1.04–1.34)',
          note: '10th vs 50th percentile HR 1.56; 90th vs 50th HR 1.29. The relationship is U-shaped. Observational.',
          referenceIds: ['burgers2011'],
        },
        {
          label: 'Growth-hormone-receptor deficiency (Ecuador)',
          value: 'One non-lethal cancer and no diabetes, vs 17 % cancer and 5 % diabetes in relatives',
          note: 'Insulin 1.4 vs 4.4 µU/mL. The paper reports disease incidence, not longer lifespan.',
          referenceIds: ['guevaraaguirre2011'],
        },
        {
          label: 'Methionine restriction, 16 weeks at 2 mg/kg/d (26 obese adults with metabolic syndrome)',
          value: 'Fat oxidation +12 % (vs −8 %); liver fat down',
          note: 'Independent of the similar weight loss in both arms. An 8-week trial did not change epigenetic clocks. No human autophagy data.',
          referenceIds: ['plaisance2011', 'hernandezarciga2025'],
        },
        {
          label: 'Protein for people over 65 (position paper)',
          value: '≥ 1.0–1.2 g/kg/d; ≥ 1.2 if active; 1.2–1.5 with illness',
          referenceIds: ['bauer2013'],
        },
        {
          label: 'Health ABC (ages 70–79, n = 2,066), highest protein quintile',
          value: 'Lost ~40 % less lean mass over 3 years (−0.50 vs −0.88 kg)',
          referenceIds: ['houston2008'],
        },
        {
          label: 'Resistance-training gains vs protein intake',
          value: 'Plateau at ~1.62 g/kg/d',
          referenceIds: ['morton2018'],
        },
        {
          label: 'Protein restriction and blood-cell autophagy flux (young adults)',
          value: 'No benefit',
          referenceIds: ['singh2026'],
        },
      ],
      timeCourse: 'The IGF-1 response to protein is slow, over about a week or more (see the IGF-1 article).',
      moderators: 'Age (the protein and mortality link reverses after 65), activity, illness.',
      grade: 'C',
      gradeReason:
        'The evidence is mostly observational, and the main cohort used one dietary recall; only the autophagy null is from a randomised trial.',
      status: 'contested',
      caveats:
        'NHANES III is observational, based on a single 24 h recall, with residual confounding. The Ecuador study reports disease incidence rather than lifespan.',
      referenceIds: [
        'levine2014',
        'fontana2008',
        'burgers2011',
        'guevaraaguirre2011',
        'plaisance2011',
        'hernandezarciga2025',
        'bauer2013',
        'houston2008',
        'morton2018',
        'singh2026',
      ],
      relatedMetricIds: ['igf1'],
    },
    {
      id: '08-calerie-calorie-restriction',
      title: 'Two years of calorie restriction in people (CALERIE)',
      category: 'energy',
      summary:
        'CALERIE-2 randomised 218 adults (21–50 y, BMI 22–28) to a prescribed 25 % restriction for 2 years. They actually achieved about 12 %. Blood pressure, LDL cholesterol and inflammation improved. IGF-1 did not change. Bone density and fat-free mass fell. A DNA-methylation pace-of-ageing measure came out about 2–3 % slower, but only in a post hoc analysis.',
      howModelled:
        'The results serve as validation targets and as the basis for warnings. Vitals shows the predicted bone and lean-mass cost when a deficit of 10 % or more is sustained for 6 months or longer. The pace-of-ageing result is not modelled, because there is a single randomised trial and no dose model.',
      keyNumbers: [
        {
          label: 'Achieved restriction',
          value: '11.7 ± 0.7 % in one report; 11.9 % (2,467 → 2,170 kcal) in another',
          note: '19.5 % in the first 6 months, 9.1 % in the next 18 months.',
          referenceIds: ['ravussin2015', 'kraus2019', 'fontana2016'],
        },
        {
          label: 'Weight change',
          value: '−10.4 ± 0.4 % (−7.5 kg; 71 % fat; fat mass −5.3 kg)',
          referenceIds: ['ravussin2015', 'kraus2019'],
        },
        {
          label: 'Fat-free mass',
          value: '−2.2 ± 0.2 kg vs −0.2 kg in controls',
          note: 'Minor leg lean loss without a change in strength.',
          referenceIds: ['villareal2016', 'das2023'],
        },
        {
          label: 'Cardiometabolic markers',
          value:
            'LDL-C, total-to-HDL cholesterol ratio, systolic and diastolic blood pressure down (all p ≤ 0.001); CRP down (p = 0.012)',
          note: 'Insulin sensitivity up and the metabolic-syndrome score down; robust to adjustment for weight loss.',
          referenceIds: ['kraus2019'],
        },
        {
          label: 'Resting metabolic rate and energy expenditure',
          value:
            'RMR residual lower at 12 months (p = .04) but not at 24; in a ~15 % restriction sub-study (−8.7 kg), 24 h energy expenditure 80–120 kcal/d below prediction',
          note: 'T3 lower; F2-isoprostanes lower.',
          referenceIds: ['ravussin2015', 'redman2018'],
        },
        {
          label: 'TNF-α',
          value: 'Lower at 24 months (p = .02)',
          referenceIds: ['ravussin2015'],
        },
        {
          label: 'IGF-1 and cortisol',
          value: 'IGF-1 unchanged; IGFBP-1 +21 %; cortisol up at 1 year only',
          referenceIds: ['fontana2016'],
        },
        {
          label: 'Bone mineral density at 24 months (restriction vs control)',
          value:
            'Spine −0.013 vs +0.007 g/cm²; total hip −0.017 vs +0.001; femoral neck −0.015 vs −0.005 (all p ≤ 0.03)',
          referenceIds: ['villareal2016'],
        },
        {
          label: 'DunedinPACE pace of ageing',
          value: 'd = −0.29 (12 months), −0.25 (24 months), about 2–3 % slower',
          note: 'No effect on the PhenoAge or GrimAge clocks. Post hoc.',
          referenceIds: ['waziry2023'],
        },
        {
          label: 'About 14 % restriction, immune system',
          value: 'Improved thymus output and lower PLA2G7 in fat tissue',
          referenceIds: ['spadaro2022'],
        },
        {
          label: 'Safety',
          value: '3 withdrawn for safety',
          note: 'More musculoskeletal, nervous-system and reproductive adverse events in normal-weight than overweight participants; the authors advise monitoring bone and anaemia.',
          referenceIds: ['romashkan2016'],
        },
        {
          label: 'Earlier 6-month phase 1',
          value: 'Mitochondrial DNA +35 %; 24 h energy expenditure −135 kcal/d',
          note: 'SIRT1 and PPARGC1A mRNA up; DNA damage down.',
          referenceIds: ['civitarese2007'],
        },
      ],
      timeCourse:
        'Restriction was deepest in the first 6 months (19.5 %) and eased to 9.1 % in the next 18 months. The resting-metabolic-rate effect was seen at 12 months but not at 24.',
      moderators:
        'Body-mass index (adverse events differed between normal-weight and overweight participants) and size of restriction.',
      grade: 'B',
      gradeReason:
        'It is a well-run 2-year randomised trial with consistent cardiometabolic and bone findings; the ageing-clock result is a single post hoc analysis.',
      status: 'established',
      caveats:
        'The pace-of-ageing result is post hoc from a single trial, and two other epigenetic clocks showed no effect. The result is not attributable to autophagy.',
      referenceIds: [
        'ravussin2015',
        'kraus2019',
        'fontana2016',
        'villareal2016',
        'das2023',
        'redman2018',
        'waziry2023',
        'spadaro2022',
        'romashkan2016',
        'civitarese2007',
      ],
      relatedMetricIds: [],
    },
    {
      id: '08-fasting-mimicking-diet',
      title: 'Five-day low-energy, low-protein cycles',
      category: 'energy',
      summary:
        'In a randomised trial of 100 people, three monthly 5-day cycles of about 4,600 kJ on day 1 and about 3,000 kJ on days 2–5, low in protein, lowered weight, absolute lean mass and IGF-1 (by about 13 %). Fasting glucose and CRP did not change overall. A follow-up analysis said biological age fell by 2.5 years, but it had serious limitations, so Vitals treats it as a hypothesis.',
      howModelled:
        'Used as a validation target only. IGF-1 should sit at about 0.87 ± 0.08 of its usual level 5–7 days after the third cycle. Vitals makes no age-reversal claim from it.',
      keyNumbers: [
        {
          label: 'The cycle (often called a fasting-mimicking diet)',
          value: '≈ 4,600 kJ on day 1 (11 % protein); ≈ 3,000 kJ on days 2–5 (9 % protein)',
          note: 'Roughly 1,100 then 720 kcal/d. A separate 30-person pilot used 1,100 kcal on day 1 and 700–800 kcal on days 2–5.',
          referenceIds: ['wei2017', 'espinoza2026'],
        },
        {
          label: 'Randomised trial (52 fasting-mimicking, 48 control), 3 monthly cycles',
          value:
            'Weight −2.6 ± 2.5 kg; absolute lean mass down (p = 0.004); IGF-1 −21.7 ng/mL vs +8.7 (≈ −13 %)',
          note: 'Fasting glucose and CRP not significant overall (lower only in at-risk subgroups). Dropouts 25 % vs 10 %.',
          referenceIds: ['wei2017'],
        },
        {
          label: '“Reduced biological age by 2.5 years” (secondary analysis)',
          value: 'Median 2.5 years; mean ≈ 1.5 years; 31 % of participants had an increase',
          note: 'A within-person before-and-after change in the diet arms (n = 52, plus an uncontrolled second trial of n = 34), not a randomised comparison. The contributing control arm had n = 16–19.',
          referenceIds: ['brandhorst2024'],
        },
        {
          label: 'For comparison: CALERIE randomised DunedinPACE effect',
          value: '≈ 2–3 % slower pace of ageing',
          referenceIds: ['waziry2023'],
        },
      ],
      timeCourse:
        'Measured 5–7 days after the third cycle. In the 30-person pilot, IGF-1 at day 6 was lower by 23 ng/mL (not significant against −5 in control).',
      moderators:
        'Number of cycles and baseline risk profile (glucose and CRP fell only in at-risk subgroups).',
      grade: 'C',
      gradeReason:
        'It is a single sponsored randomised trial, and the biological-age claim comes from a secondary analysis.',
      status: 'contested',
      caveats:
        'Limits of the 2.5-year claim: it is exploratory; the composite (albumin, alkaline phosphatase, creatinine, CRP, HbA1c, systolic blood pressure, total cholesterol) moves mechanically with short-term weight loss, blood pressure and glucose changes and is not validated as a stand-in for mortality; the headline is a median; the diet was supplied by its maker, the university licensed the IP with royalty potential, and two authors hold equity; and the same programme lowered absolute lean mass.',
      referenceIds: ['wei2017', 'brandhorst2024', 'espinoza2026', 'waziry2023'],
      relatedMetricIds: [],
    },
    {
      id: '08-autophagy-compounds',
      title: 'Foods and supplements said to induce autophagy',
      category: 'cellular',
      summary:
        'Spermidine, coffee, urolithin A, NAD+ precursors and various plant compounds are often said to trigger autophagy. In people, none of them has had autophagy itself measured. The evidence is from mice (coffee), yeast, worms and cells (spermidine), or effects on other things such as NAD+ levels and muscle endurance.',
      howModelled:
        'No compound raises the autophagy signal. Coffee or tea without milk or sugar do not reset the fasting clock, because their energy is below the thresholds and fasting studies allowed them. Drugs such as rapamycin, metformin and aspirin are outside the scope of a lifestyle planner and are not modelled or suggested. The supplement catalogue is in the other-levers topic.',
      keyNumbers: [
        {
          label: 'Spermidine, 12-month trial (n = 100, ages 60–90, 0.9 mg/d)',
          value: 'No effect on memory (−0.03; 95 % CI −0.11 to 0.05) or biomarkers',
          note: 'Plasma spermidine rises with fasting or calorie restriction in humans. Blocking its synthesis blunted fasting autophagy in yeast, worms and human cells.',
          referenceIds: ['schwarz2022', 'hofer2024'],
        },
        {
          label: 'Coffee (caffeinated or decaf), mice',
          value: 'LC3B lipidation up and p62 down 1–4 h after coffee in liver, muscle and heart',
          note: 'No human autophagy data.',
          referenceIds: ['pietrocola2014'],
        },
        {
          label: 'Urolithin A, 66 older adults, 1 g/d for 4 months',
          value:
            'Primary end-points (6-minute walk, ATP_max) not met; endurance contractions up; acylcarnitines and CRP down',
          note: 'Industry-sponsored. Only mitophagy-related proteins were measured.',
          referenceIds: ['liu2022'],
        },
        {
          label: 'Urolithin A, middle-aged adults, 4 months',
          value:
            'Strength about +12 %; peak-power primary end-point not met; muscle mitophagy-related proteins up',
          referenceIds: ['singh2022'],
        },
        {
          label: 'Nicotinamide riboside and other NAD+ precursors',
          value: 'Raise the NAD+ metabolome; no change in muscle bioenergetics',
          referenceIds: ['elhassan2019', 'martens2018'],
        },
        {
          label: 'Resveratrol, EGCG, curcumin and other polyphenols',
          value: 'No human autophagy-flux data located',
        },
        {
          label: 'Ketone-ester drink after exercise',
          value: 'Raised muscle mTORC1 signalling, the opposite direction',
          referenceIds: ['vandoorne2017'],
        },
        {
          label: 'Coffee and fasting studies',
          value: 'Zero-calorie fasts in human blood studies allowed water, tea and coffee',
          referenceIds: ['pietrocola2017'],
        },
      ],
      grade: 'D',
      gradeReason: 'For autophagy itself there are only animal, cell or indirect human data.',
      status: 'contested',
      caveats:
        "Autophagy (the cell's recycling process) cannot be measured in your organs by any routine test. This line is a relative model signal that shows when the conditions linked to autophagy in animal and a few small human studies are present — no recent protein or sugar, low insulin, depleted liver glycogen, rising ketones, recent hard exercise. It does not tell you how much autophagy is happening, in which tissue, or whether it improves your health; human studies measuring autophagy directly have mostly found small or no effects of fasting, protein timing or calorie restriction. Evidence grade: C–D (low). The shaded band shows how uncertain the timing is: the fasting length at which the signal reaches its midpoint could be anywhere from about 1 to 4 days. NAD+ levels and mitochondrial markers are not autophagy flux. Where Vitals' evidence review grades the human evidence for a compound's other effects, it is C for NAD+ and for urolithin A, and D for autophagy.",
      referenceIds: [
        'schwarz2022',
        'hofer2024',
        'pietrocola2014',
        'liu2022',
        'singh2022',
        'elhassan2019',
        'martens2018',
        'vandoorne2017',
        'pietrocola2017',
      ],
      relatedMetricIds: ['autophagyIdx'],
    },
  ],
  myths: [
    {
      id: '08-myth-autophagy-starts-at-16h',
      claim: 'Autophagy switches on after 16 hours of fasting.',
      verdict: 'oversimplified',
      explanation:
        "Autophagy runs all the time at a low level, so there is no on switch. No human study has found an onset time. The only data near 16–18 h are gene-activity readings: a fast of about 18 h instead of 12 h raised LC3A mRNA in blood by 22 %. No one has measured recycling in solid tissue between 12 and 72 h. Vitals' signal rises smoothly instead, from 25 at 12 h to about 28 at 16 h.",
      referenceIds: ['jamshed2019'],
    },
    {
      id: '08-myth-autophagy-peaks-24-48-72h',
      claim: 'Autophagy peaks at 24, 48 or 72 hours.',
      verdict: 'not-supported',
      explanation:
        'The 24 h peak was found in mouse liver. Mice burn energy about 7 times faster per gram and lose about 20 % of their weight in 48 h, so mouse hours do not map onto human hours. In human muscle, static markers changed at 72 h (LC3B-II +30 %) and only modestly at 36 h. No human peak has been measured.',
      referenceIds: ['mizushima2004', 'pietrocola2017', 'kleiber1947', 'vendelbo2014', 'dethlefsen2018'],
    },
    {
      id: '08-myth-protein-threshold-breaks-fast',
      claim: 'More than a certain number of grams of protein breaks the fast and stops autophagy.',
      verdict: 'not-supported',
      explanation:
        'No threshold has been found. 35 g of whey did not change blood-cell flux at 1 h, and 4 weeks of halved protein did not raise it. In muscle, insulin and amino acids with carbohydrate do lower LC3-II. Protein suppresses mTORC1-linked signalling for a while, about 2–4 h, and then it eases.',
      referenceIds: ['singh2025', 'singh2026', 'fritzen2016', 'glynn2010', 'atherton2010'],
    },
    {
      id: '08-myth-coffee-and-fasting',
      claim: "Black coffee doesn't break a fast, and coffee boosts autophagy.",
      verdict: 'unproven',
      explanation:
        'Black coffee has negligible energy, and fasting studies allowed it. The boost claim comes from mice, 1–4 h after coffee. There are no human autophagy data.',
      referenceIds: ['pietrocola2017', 'pietrocola2014'],
    },
    {
      id: '08-myth-exogenous-ketones',
      claim: 'Ketone drinks or MCT oil give you the benefits of fasting.',
      verdict: 'not-supported',
      explanation:
        "A ketone-ester drink raised mTORC1 signalling in human muscle, the opposite of the fasting direction, and BHB infusion slowed protein breakdown. The autophagy signal ignores ketones that do not come from the body's own production.",
      referenceIds: ['vandoorne2017', 'nair1988'],
    },
    {
      id: '08-myth-fasting-activates-ampk',
      claim: 'Fasting activates AMPK.',
      verdict: 'not-supported',
      explanation:
        'In human muscle a 48 h fast lowered AMPK activity in lean men. Exercise intensity activates AMPK (3–4-fold at 75 % of maximal oxygen uptake) and so does glycogen depletion.',
      referenceIds: ['wijngaarden2013', 'wojtaszewski2000', 'wojtaszewski2003'],
    },
    {
      id: '08-myth-fasted-training-maximises-autophagy',
      claim: 'Training fasted maximises autophagy.',
      verdict: 'not-supported',
      explanation:
        'Exercise-induced autophagy markers in muscle were not increased by fasting. Intensity mattered more than whether people were fed.',
      referenceIds: ['moller2015', 'schwalm2015'],
    },
    {
      id: '08-myth-autophagy-declines-with-age',
      claim: 'Autophagy declines with age in humans, so older people need more fasting.',
      verdict: 'oversimplified',
      explanation:
        'Basal blood-cell flux rose with age, older monocytes responded more to amino-acid starvation, and older men lacked the resistance-exercise rise in LC3-II. The picture is mixed. Older adults also need more protein, not less.',
      referenceIds: ['bensalem2023', 'dang2025', 'hentila2018', 'bauer2013', 'houston2008'],
    },
    {
      id: '08-myth-intermittent-fasting-proven',
      claim: 'Intermittent fasting is proven to increase autophagy in humans.',
      verdict: 'unproven',
      explanation:
        'The best trial found a difference between intermittent fasting with an early eating window and standard care at 6 months (P = 0.04, post hoc), with no rise within the group. Calorie restriction gave no detectable change. A 5-day fasting-mimicking pilot was borderline and industry-funded.',
      referenceIds: ['bensalem2025', 'espinoza2026'],
    },
    {
      id: '08-myth-calorie-restriction-lowers-igf1',
      claim: 'Calorie restriction lowers IGF-1 in humans as it does in rodents.',
      verdict: 'not-supported',
      explanation:
        'Not unless protein is restricted too. Severe restriction for 1–6 years and 2 years of CALERIE both left IGF-1 unchanged.',
      referenceIds: ['fontana2008', 'fontana2016'],
    },
    {
      id: '08-myth-lower-igf1-always-better',
      claim: 'Lower IGF-1 is always better for longevity.',
      verdict: 'not-supported',
      explanation:
        'Mortality risk is U-shaped, higher at both low and high IGF-1. The link between protein and mortality reverses after 65. People with a growth-hormone-receptor deficiency had less cancer and diabetes, but longer life was not shown.',
      referenceIds: ['burgers2011', 'levine2014', 'guevaraaguirre2011'],
    },
    {
      id: '08-myth-fmd-reverses-age-2-5-years',
      claim: 'A fasting-mimicking diet reverses biological age by 2.5 years.',
      verdict: 'unproven',
      explanation:
        "The 2.5 years is the median of a within-person change in a secondary analysis, based on a composite of routine blood tests. The mean was about 1.5 years, 31 % of participants got worse, the diet's maker had commercial interests, and lean mass fell.",
      referenceIds: ['wei2017', 'brandhorst2024'],
    },
    {
      id: '08-myth-serum-lc3-shows-autophagy',
      claim: 'Blood LC3 or Beclin levels, or ATG gene activity, show how much autophagy you have.',
      verdict: 'not-supported',
      explanation:
        'These are not valid measures of flux. LC3 is a protein inside cells, and gene activity is not the same as recycling activity.',
      referenceIds: ['klionsky2021'],
    },
    {
      id: '08-myth-longer-fast-better',
      claim: 'The longer the fast, the better.',
      verdict: 'not-supported',
      explanation:
        'A 10-day fast lost about 3.5 kg of lean soft tissue, net muscle protein loss doubled by 72 h, and calorie restriction cost bone. In mice, health gains and lifespan diverged, and 40 % restriction cost lean mass and immune function.',
      referenceIds: ['laurens2021', 'vendelbo2014', 'villareal2016', 'difrancesco2024'],
    },
  ],
  openQuestions: [
    'The whole autophagy index is a construct. No human dataset links any eating schedule to autophagy flux in a solid organ, and the weights are expert-set (grade D). The Planner treats gains in the signal as low-confidence.',
    'The clock midpoint (48 h, range 24–96 h) is the most influential parameter. A human time-course of blood-cell flux every 12 h over a 5-day fast would replace it. None has been published: the planned study NCT04842864 was withdrawn and NCT04739852 has no posted results.',
    'Fed-state suppression is taken from muscle, where insulin and amino acids lower LC3-II, but it is contradicted in blood cells at 1 h. Tissue-specific weights may be needed.',
    'Static markers are ambiguous. A rise in LC3-II could mean blocked degradation, so the 72 h anchor could be wrong in direction for flux.',
    'The exercise weight is uncertain. PBMC and muscle LC3-II rose about 1.7-fold in untrained men after one vigorous bout, a larger change than any fasting study in blood, but with n = 12 and static markers. The direction after resistance exercise is inconsistent.',
    'It is unknown whether the signal keeps rising, plateaus or declines in prolonged fasting. Mouse liver autophagy returns toward baseline by 48 h and human protein breakdown falls after about 5 days. The model plateaus; a decline term may be needed.',
    "Ketones are treated as a marker of fasting depth, yet human data show ketone drinks can raise muscle mTORC1. If the body's own and drink-derived ketones cannot be separated, the ketone weight is set to 0.",
    "Whether age should shift the index is unresolved: insulin's effect on protein breakdown is dulled in older adults, and basal blood-cell flux rises with age.",
    'The IGF-1 model mixes normal-weight (5 d) and obese (10 d) fasting data from small studies (5–14 people each), and its protein time constant is a compromise between refeeding and fasting-mimicking data, with errors up to ±0.09.',
    'It is not known whether more autophagy in any tissue improves human health outcomes. The slower DunedinPACE pace of ageing with calorie restriction cannot be attributed to autophagy.',
  ],
  references: [
    {
      id: 'vendelbo2014',
      authors: 'Vendelbo MH, Møller AB, Christensen B, et al.',
      year: 2014,
      title:
        'Fasting increases human skeletal muscle net phenylalanine release and this is associated with decreased mTOR signaling',
      journal: 'PLoS One',
      pmid: '25020061',
      doi: '10.1371/journal.pone.0102031',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4096723/',
    },
    {
      id: 'dethlefsen2018',
      authors: 'Dethlefsen MM, Bertholdt L, Gudiksen A, et al.',
      year: 2018,
      title: 'Training state and skeletal muscle autophagy in response to 36 h of fasting',
      journal: 'J Appl Physiol',
      pmid: '30161009',
      doi: '10.1152/japplphysiol.01146.2017',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30161009/',
    },
    {
      id: 'moller2015',
      authors: 'Møller AB, Vendelbo MH, Christensen B, et al.',
      year: 2015,
      title: 'Physical exercise increases autophagic signaling through ULK1 in human skeletal muscle',
      journal: 'J Appl Physiol',
      pmid: '25678702',
      doi: '10.1152/japplphysiol.01116.2014',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25678702/',
    },
    {
      id: 'wijngaarden2013',
      authors: 'Wijngaarden MA, van der Zon GC, van Dijk KW, Pijl H, Guigas B.',
      year: 2013,
      title:
        'Effects of prolonged fasting on AMPK signaling, gene expression, and mitochondrial respiratory chain content in skeletal muscle from lean and obese individuals',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '23512807',
      doi: '10.1152/ajpendo.00008.2013',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23512807/',
    },
    {
      id: 'pietrocola2017',
      authors: 'Pietrocola F, Demont Y, Castoldi F, et al.',
      year: 2017,
      title: 'Metabolic effects of fasting on human and mouse blood in vivo',
      journal: 'Autophagy',
      pmid: '28059587',
      doi: '10.1080/15548627.2016.1271513',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5361613/',
    },
    {
      id: 'jamshed2019',
      authors: 'Jamshed H, Beyl RA, Della Manna DL, Yang ES, Ravussin E, Peterson CM.',
      year: 2019,
      title:
        'Early time-restricted feeding improves 24-hour glucose levels and affects markers of the circadian clock, aging, and autophagy in humans',
      journal: 'Nutrients',
      pmid: '31151228',
      doi: '10.3390/nu11061234',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6627766/',
    },
    {
      id: 'erlangga2023',
      authors: 'Erlangga Z, et al.',
      year: 2023,
      title:
        'The effect of prolonged intermittent fasting on autophagy, inflammasome and senescence genes expressions: an exploratory study in healthy young males',
      journal: 'Hum Nutr Metab',
      url: 'https://lifespan.io/news/intermittent-fasting-induces-changes-in-multiple-biomarkers/',
      verification: 'unverified',
    },
    {
      id: 'dastghaib2025',
      authors: 'Dastghaib S, Siri M, Rahmani-Kukia N, et al.',
      year: 2025,
      title:
        'Effect of 30-day Ramadan fasting on autophagy pathway and metabolic health outcome in healthy individuals',
      journal: 'Mol Biol Res Commun',
      pmid: '40028479',
      doi: '10.22099/mbrc.2024.50105.1978',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11865935/',
    },
    {
      id: 'bensalem2023',
      authors: 'Bensalem J, Teong XT, Hattersley KJ, et al.',
      year: 2023,
      title:
        'Basal autophagic flux measured in blood correlates positively with age in adults at increased risk of type 2 diabetes',
      journal: 'GeroScience',
      pmid: '37498479',
      doi: '10.1007/s11357-023-00884-5',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10643809/',
    },
    {
      id: 'singh2025',
      authors: 'Singh S, Fourrier C, Hattersley KJ, et al.',
      year: 2025,
      title: 'High protein does not change autophagy in human PBMCs after 1 hour',
      journal: 'JCI Insight',
      pmid: '40663500',
      doi: '10.1172/jci.insight.188845',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12406713/',
    },
    {
      id: 'bensalem2025',
      authors: 'Bensalem J, Teong XT, Hattersley KJ, et al.',
      year: 2025,
      title:
        'Intermittent time-restricted eating may increase autophagic flux in humans: an exploratory analysis',
      journal: 'J Physiol',
      pmid: '40345145',
      doi: '10.1113/JP287938',
      url: 'https://pubmed.ncbi.nlm.nih.gov/40345145/',
    },
    {
      id: 'singh2026',
      authors: 'Singh S, Fourrier C, Hein LK, et al.',
      year: 2026,
      title:
        'Reduced dietary protein intake does not alter autophagy in human blood: a randomized crossover study in healthy adults',
      journal: 'Clin Nutr',
      pmid: '42721581',
      doi: '10.1016/j.clnu.2026.106778',
    },
    {
      id: 'dang2025',
      authors: 'Dang LVP, Sargeant TJ.',
      year: 2025,
      title:
        'Cell type-specific autophagy in human leukocytes: signatures of aging, sex, and nutrient restriction',
      journal: 'Autophagy Rep',
      pmid: '40843146',
      doi: '10.1080/27694127.2025.2543560',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12366816/',
    },
    {
      id: 'espinoza2026',
      authors: 'Espinoza SE, Park S, Connolly G, et al.',
      year: 2026,
      title:
        'Effect of fasting-mimicking diet on markers of autophagy and metabolic health in human subjects',
      journal: 'GeroScience',
      pmid: '41372565',
      doi: '10.1007/s11357-025-02035-4',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC13601415/',
    },
    {
      id: 'kumar2025',
      authors: 'Kumar GVN, Wang RS, Sharma AX, et al.',
      year: 2025,
      title:
        'Non-canonical lysosomal lipolysis drives mobilization of adipose tissue energy stores with fasting',
      journal: 'Nat Commun',
      pmid: '39900947',
      doi: '10.1038/s41467-025-56613-3',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11790841/',
    },
    {
      id: 'yang2016',
      authors: 'Yang L, Licastro D, Cava E, et al.',
      year: 2016,
      title:
        'Long-term calorie restriction enhances cellular quality-control processes in human skeletal muscle',
      journal: 'Cell Rep',
      pmid: '26774472',
      doi: '10.1016/j.celrep.2015.12.042',
    },
    {
      id: 'das2023',
      authors: 'Das JK, Banskota N, Candia J, et al.',
      year: 2023,
      title:
        'Calorie restriction modulates the transcription of genes related to stress response and longevity in human muscle: the CALERIE study',
      journal: 'Aging Cell',
      pmid: '37823711',
      doi: '10.1111/acel.13963',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10726900/',
    },
    {
      id: 'klionsky2021',
      authors: 'Klionsky DJ, et al.',
      year: 2021,
      title: 'Guidelines for the use and interpretation of assays for monitoring autophagy (4th edition)',
      journal: 'Autophagy',
      pmid: '33634751',
      doi: '10.1080/15548627.2020.1797280',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7996087/',
    },
    {
      id: 'mizushima2004',
      authors: 'Mizushima N, Yamamoto A, Matsui M, Yoshimori T, Ohsumi Y.',
      year: 2004,
      title:
        'In vivo analysis of autophagy in response to nutrient starvation using transgenic mice expressing a fluorescent autophagosome marker',
      journal: 'Mol Biol Cell',
      pmid: '14699058',
      doi: '10.1091/mbc.e03-09-0704',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC363084/',
    },
    {
      id: 'alirezaei2010',
      authors: 'Alirezaei M, Kemball CC, Flynn CT, et al.',
      year: 2010,
      title: 'Short-term fasting induces profound neuronal autophagy',
      journal: 'Autophagy',
      pmid: '20534972',
      doi: '10.4161/auto.6.6.12376',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3106288/',
    },
    {
      id: 'jensen2013',
      authors: 'Jensen TL, Kiersgaard MK, Sørensen DB, Mikkelsen LF.',
      year: 2013,
      title: 'Fasting of mice: a review',
      journal: 'Lab Anim',
      pmid: '24025567',
      doi: '10.1177/0023677213501659',
    },
    {
      id: 'kleiber1947',
      authors: 'Kleiber M.',
      year: 1947,
      title: 'Body size and metabolic rate',
      journal: 'Physiol Rev',
      pmid: '20267758',
      doi: '10.1152/physrev.1947.27.4.511',
    },
    {
      id: 'schwalm2015',
      authors: 'Schwalm C, Jamart C, Benoit N, et al.',
      year: 2015,
      title:
        'Activation of autophagy in human skeletal muscle is dependent on exercise intensity and AMPK activation',
      journal: 'FASEB J',
      pmid: '25957282',
      doi: '10.1096/fj.14-267187',
    },
    {
      id: 'fritzen2016',
      authors: 'Fritzen AM, Madsen AB, Kleinert M, et al.',
      year: 2016,
      title:
        'Regulation of autophagy in human skeletal muscle: effects of exercise, exercise training and insulin stimulation',
      journal: 'J Physiol',
      pmid: '26614120',
      doi: '10.1113/JP271405',
    },
    {
      id: 'brandt2018',
      authors: 'Brandt N, Gunnarsson TP, Bangsbo J, Pilegaard H.',
      year: 2018,
      title: 'Exercise and exercise training-induced increase in autophagy markers in human skeletal muscle',
      journal: 'Physiol Rep',
      pmid: '29626392',
      doi: '10.14814/phy2.13651',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5889490/',
    },
    {
      id: 'jamart2012',
      authors: 'Jamart C, Francaux M, Millet GY, et al.',
      year: 2012,
      title: 'Modulation of autophagy and ubiquitin-proteasome pathways during ultra-endurance running',
      journal: 'J Appl Physiol',
      pmid: '22345427',
      doi: '10.1152/japplphysiol.00952.2011',
    },
    {
      id: 'specht2026',
      authors: 'Specht JW, Ducharme JB, Bailly AR, Deyhle MR.',
      year: 2026,
      title:
        'Autophagic responses to vigorous endurance exercise in men vary by training status but are similar in PBMCs and skeletal muscle: a pilot study',
      journal: 'Physiol Rep',
      pmid: '42615877',
      doi: '10.14814/phy2.71064',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC13488457/',
    },
    {
      id: 'fry2013',
      authors: 'Fry CS, Drummond MJ, Glynn EL, et al.',
      year: 2013,
      title:
        'Skeletal muscle autophagy and protein breakdown following resistance exercise are similar in younger and older adults',
      journal: 'J Gerontol A',
      pmid: '23089333',
      doi: '10.1093/gerona/gls209',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3623482/',
    },
    {
      id: 'hentila2018',
      authors: 'Hentilä J, Ahtiainen JP, Paulsen G, et al.',
      year: 2018,
      title:
        'Autophagy is induced by resistance exercise in young men, but unfolded protein response is induced regardless of age',
      journal: 'Acta Physiol',
      pmid: '29608242',
      doi: '10.1111/apha.13069',
    },
    {
      id: 'glynn2010',
      authors: 'Glynn EL, Fry CS, Drummond MJ, et al.',
      year: 2010,
      title:
        'Muscle protein breakdown has a minor role in the protein anabolic response to essential amino acid and carbohydrate intake following resistance exercise',
      journal: 'Am J Physiol Regul Integr Comp Physiol',
      pmid: '20519362',
      doi: '10.1152/ajpregu.00077.2010',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2928613/',
    },
    {
      id: 'wojtaszewski2000',
      authors: 'Wojtaszewski JF, Nielsen P, Hansen BF, Richter EA, Kiens B.',
      year: 2000,
      title:
        "Isoform-specific and exercise intensity-dependent activation of 5'-AMP-activated protein kinase in human skeletal muscle",
      journal: 'J Physiol',
      pmid: '11018120',
      doi: '10.1111/j.1469-7793.2000.t01-1-00221.x',
    },
    {
      id: 'wojtaszewski2003',
      authors: 'Wojtaszewski JF, MacDonald C, Nielsen JN, et al.',
      year: 2003,
      title:
        "Regulation of 5'AMP-activated protein kinase activity and substrate utilization in exercising human skeletal muscle",
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '12488245',
      doi: '10.1152/ajpendo.00436.2002',
    },
    {
      id: 'he2012',
      authors: 'He C, Bassik MC, Moresi V, et al.',
      year: 2012,
      title: 'Exercise-induced BCL2-regulated autophagy is required for muscle glucose homeostasis',
      journal: 'Nature',
      pmid: '22258505',
      doi: '10.1038/nature10758',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3518436/',
    },
    {
      id: 'atherton2010',
      authors: 'Atherton PJ, Etheridge T, Watt PW, et al.',
      year: 2010,
      title:
        'Muscle full effect after oral protein: time-dependent concordance and discordance between human muscle protein synthesis and mTORC1 signaling',
      journal: 'Am J Clin Nutr',
      pmid: '20844073',
      doi: '10.3945/ajcn.2010.29819',
    },
    {
      id: 'greenhaff2008',
      authors: 'Greenhaff PL, Karagounis LG, Peirce N, et al.',
      year: 2008,
      title:
        'Disassociation between the effects of amino acids and insulin on signaling, ubiquitin ligases, and protein turnover in human muscle',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '18577697',
      doi: '10.1152/ajpendo.90411.2008',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2536736/',
    },
    {
      id: 'wilkes2009',
      authors: 'Wilkes EA, Selby AL, Atherton PJ, et al.',
      year: 2009,
      title:
        'Blunting of insulin inhibition of proteolysis in legs of older subjects may contribute to age-related sarcopenia',
      journal: 'Am J Clin Nutr',
      pmid: '19740975',
      doi: '10.3945/ajcn.2009.27543',
    },
    {
      id: 'mortimore1989',
      authors: 'Mortimore GE, Pösö AR, Lardeux BR.',
      year: 1989,
      title: 'Mechanism and regulation of protein degradation in liver',
      journal: 'Diabetes Metab Rev',
      pmid: '2649336',
      doi: '10.1002/dmr.5610050105',
    },
    {
      id: 'poso1987',
      authors: 'Pösö AR, Surmacz CA, Mortimore GE.',
      year: 1987,
      title: 'Inhibition of intracellular protein degradation by ethanol in perfused rat liver',
      journal: 'Biochem J',
      pmid: '3496083',
      doi: '10.1042/bj2420459',
    },
    {
      id: 'nair1988',
      authors: 'Nair KS, Welle SL, Halliday D, Campbell RG.',
      year: 1988,
      title:
        'Effect of beta-hydroxybutyrate on whole-body leucine kinetics and fractional mixed skeletal muscle protein synthesis in humans',
      journal: 'J Clin Invest',
      pmid: '3392207',
      doi: '10.1172/JCI113570',
    },
    {
      id: 'vandoorne2017',
      authors: 'Vandoorne T, De Smet S, Ramaekers M, et al.',
      year: 2017,
      title:
        'Intake of a ketone ester drink during recovery from exercise promotes mTORC1 signaling but not glycogen resynthesis in human muscle',
      journal: 'Front Physiol',
      pmid: '28588499',
      doi: '10.3389/fphys.2017.00310',
    },
    {
      id: 'shimazu2013',
      authors: 'Shimazu T, Hirschey MD, Newman J, et al.',
      year: 2013,
      title:
        'Suppression of oxidative stress by β-hydroxybutyrate, an endogenous histone deacetylase inhibitor',
      journal: 'Science',
      pmid: '23223453',
      doi: '10.1126/science.1227166',
    },
    {
      id: 'rothman1991',
      authors: 'Rothman DL, Magnusson I, Katz LD, Shulman RG, Shulman GI.',
      year: 1991,
      title: 'Quantitation of hepatic glycogenolysis and gluconeogenesis in fasting humans with 13C NMR',
      journal: 'Science',
      pmid: '1948033',
      doi: '10.1126/science.1948033',
    },
    {
      id: 'costford2010',
      authors: 'Costford SR, Bajpeyi S, Pasarica M, et al.',
      year: 2010,
      title: 'Skeletal muscle NAMPT is induced by exercise in humans',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '19887595',
      doi: '10.1152/ajpendo.00318.2009',
    },
    {
      id: 'elhassan2019',
      authors: 'Elhassan YS, Kluckova K, Fletcher RS, et al.',
      year: 2019,
      title:
        'Nicotinamide riboside augments the aged human skeletal muscle NAD+ metabolome and induces transcriptomic and anti-inflammatory signatures',
      journal: 'Cell Rep',
      pmid: '31412242',
      doi: '10.1016/j.celrep.2019.07.043',
    },
    {
      id: 'martens2018',
      authors: 'Martens CR, Denman BA, Mazzo MR, et al.',
      year: 2018,
      title:
        'Chronic nicotinamide riboside supplementation is well-tolerated and elevates NAD+ in healthy middle-aged and older adults',
      journal: 'Nat Commun',
      pmid: '29599478',
      doi: '10.1038/s41467-018-03421-7',
    },
    {
      id: 'civitarese2007',
      authors: 'Civitarese AE, Carling S, Heilbronn LK, et al.',
      year: 2007,
      title: 'Calorie restriction increases muscle mitochondrial biogenesis in healthy humans',
      journal: 'PLoS Med',
      pmid: '17341128',
      doi: '10.1371/journal.pmed.0040076',
    },
    {
      id: 'masiero2009',
      authors: 'Masiero E, Agatea L, Mammucari C, et al.',
      year: 2009,
      title: 'Autophagy is required to maintain muscle mass',
      journal: 'Cell Metab',
      pmid: '19945408',
      doi: '10.1016/j.cmet.2009.10.008',
    },
    {
      id: 'mammucari2007',
      authors: 'Mammucari C, Milan G, Romanello V, et al.',
      year: 2007,
      title: 'FoxO3 controls autophagy in skeletal muscle in vivo',
      journal: 'Cell Metab',
      pmid: '18054315',
      doi: '10.1016/j.cmet.2007.11.001',
    },
    {
      id: 'pyo2013',
      authors: 'Pyo JO, Yoo SM, Ahn HH, et al.',
      year: 2013,
      title: 'Overexpression of Atg5 in mice activates autophagy and extends lifespan',
      journal: 'Nat Commun',
      pmid: '23939249',
      doi: '10.1038/ncomms3300',
    },
    {
      id: 'difrancesco2024',
      authors: 'Di Francesco A, Deighan AG, Litichevskiy L, et al.',
      year: 2024,
      title: 'Dietary restriction impacts health and lifespan of genetically diverse mice',
      journal: 'Nature',
      pmid: '39385029',
      doi: '10.1038/s41586-024-08026-3',
    },
    {
      id: 'levine2014',
      authors: 'Levine ME, Suarez JA, Brandhorst S, et al.',
      year: 2014,
      title:
        'Low protein intake is associated with a major reduction in IGF-1, cancer, and overall mortality in the 65 and younger but not older population',
      journal: 'Cell Metab',
      pmid: '24606898',
      doi: '10.1016/j.cmet.2014.02.006',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3988204/',
    },
    {
      id: 'fontana2008',
      authors: 'Fontana L, Weiss EP, Villareal DT, Klein S, Holloszy JO.',
      year: 2008,
      title:
        'Long-term effects of calorie or protein restriction on serum IGF-1 and IGFBP-3 concentration in humans',
      journal: 'Aging Cell',
      pmid: '18843793',
      doi: '10.1111/j.1474-9726.2008.00417.x',
    },
    {
      id: 'fontana2016',
      authors: 'Fontana L, Villareal DT, Das SK, et al.',
      year: 2016,
      title:
        'Effects of 2-year calorie restriction on circulating levels of IGF-1, IGF-binding proteins and cortisol in nonobese men and women: a randomized clinical trial',
      journal: 'Aging Cell',
      pmid: '26443692',
      doi: '10.1111/acel.12400',
    },
    {
      id: 'burgers2011',
      authors: 'Burgers AM, Biermasz NR, Schoones JW, et al.',
      year: 2011,
      title:
        'Meta-analysis and dose-response metaregression: circulating insulin-like growth factor I (IGF-I) and mortality',
      journal: 'J Clin Endocrinol Metab',
      pmid: '21795450',
      doi: '10.1210/jc.2011-1377',
    },
    {
      id: 'guevaraaguirre2011',
      authors: 'Guevara-Aguirre J, Balasubramanian P, Guevara-Aguirre M, et al.',
      year: 2011,
      title:
        'Growth hormone receptor deficiency is associated with a major reduction in pro-aging signaling, cancer, and diabetes in humans',
      journal: 'Sci Transl Med',
      pmid: '21325617',
      doi: '10.1126/scitranslmed.3001845',
    },
    {
      id: 'bauer2013',
      authors: 'Bauer J, Biolo G, Cederholm T, et al.',
      year: 2013,
      title:
        'Evidence-based recommendations for optimal dietary protein intake in older people: a position paper from the PROT-AGE Study Group',
      journal: 'J Am Med Dir Assoc',
      pmid: '23867520',
      doi: '10.1016/j.jamda.2013.05.021',
    },
    {
      id: 'houston2008',
      authors: 'Houston DK, Nicklas BJ, Ding J, et al.',
      year: 2008,
      title:
        'Dietary protein intake is associated with lean mass change in older, community-dwelling adults: the Health ABC Study',
      journal: 'Am J Clin Nutr',
      pmid: '18175749',
      doi: '10.1093/ajcn/87.1.150',
    },
    {
      id: 'morton2018',
      authors: 'Morton RW, Murphy KT, McKellar SR, et al.',
      year: 2018,
      title:
        'A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults',
      journal: 'Br J Sports Med',
      pmid: '28698222',
      doi: '10.1136/bjsports-2017-097608',
    },
    {
      id: 'plaisance2011',
      authors: 'Plaisance EP, Greenway FL, Boudreau A, et al.',
      year: 2011,
      title: 'Dietary methionine restriction increases fat oxidation in obese adults with metabolic syndrome',
      journal: 'J Clin Endocrinol Metab',
      pmid: '21346062',
      doi: '10.1210/jc.2010-2493',
    },
    {
      id: 'hernandezarciga2025',
      authors: 'Hernández-Arciga U, Stamenkovic C, Yadav S, et al.',
      year: 2025,
      title:
        'Dietary methionine restriction started late in life promotes healthy aging in a sex-specific manner',
      journal: 'Sci Adv',
      pmid: '40238871',
      doi: '10.1126/sciadv.ads1532',
    },
    {
      id: 'ravussin2015',
      authors: 'Ravussin E, Redman LM, Rochon J, et al.',
      year: 2015,
      title:
        'A 2-year randomized controlled trial of human caloric restriction: feasibility and effects on predictors of health span and longevity',
      journal: 'J Gerontol A',
      pmid: '26187233',
      doi: '10.1093/gerona/glv057',
    },
    {
      id: 'kraus2019',
      authors: 'Kraus WE, Bhapkar M, Huffman KM, et al.',
      year: 2019,
      title:
        '2 years of calorie restriction and cardiometabolic risk (CALERIE): exploratory outcomes of a multicentre, phase 2, randomised controlled trial',
      journal: 'Lancet Diabetes Endocrinol',
      pmid: '31303390',
      doi: '10.1016/S2213-8587(19)30151-2',
    },
    {
      id: 'villareal2016',
      authors: 'Villareal DT, Fontana L, Das SK, et al.',
      year: 2016,
      title:
        'Effect of two-year caloric restriction on bone metabolism and bone mineral density in non-obese younger adults: a randomized clinical trial',
      journal: 'J Bone Miner Res',
      pmid: '26332798',
      doi: '10.1002/jbmr.2701',
    },
    {
      id: 'redman2018',
      authors: 'Redman LM, Smith SR, Burton JH, et al.',
      year: 2018,
      title:
        'Metabolic slowing and reduced oxidative damage with sustained caloric restriction support the rate of living and oxidative damage theories of aging',
      journal: 'Cell Metab',
      pmid: '29576535',
      doi: '10.1016/j.cmet.2018.02.019',
    },
    {
      id: 'waziry2023',
      authors: 'Waziry R, Ryan CP, Corcoran DL, et al.',
      year: 2023,
      title:
        'Effect of long-term caloric restriction on DNA methylation measures of biological aging in healthy adults from the CALERIE trial',
      journal: 'Nat Aging',
      pmid: '37118425',
      doi: '10.1038/s43587-022-00357-y',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10148951/',
    },
    {
      id: 'spadaro2022',
      authors: 'Spadaro O, Youm Y, Shchukina I, et al.',
      year: 2022,
      title: 'Caloric restriction in humans reveals immunometabolic regulators of health span',
      journal: 'Science',
      pmid: '35143297',
      doi: '10.1126/science.abg7292',
    },
    {
      id: 'romashkan2016',
      authors: 'Romashkan SV, Das SK, Villareal DT, et al.',
      year: 2016,
      title: 'Safety of two-year caloric restriction in non-obese healthy individuals',
      journal: 'Oncotarget',
      pmid: '26992237',
      doi: '10.18632/oncotarget.8093',
    },
    {
      id: 'wei2017',
      authors: 'Wei M, Brandhorst S, Shelehchi M, et al.',
      year: 2017,
      title:
        'Fasting-mimicking diet and markers/risk factors for aging, diabetes, cancer, and cardiovascular disease',
      journal: 'Sci Transl Med',
      pmid: '28202779',
      doi: '10.1126/scitranslmed.aai8700',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6816332/',
    },
    {
      id: 'brandhorst2024',
      authors: 'Brandhorst S, Levine ME, Wei M, et al.',
      year: 2024,
      title:
        'Fasting-mimicking diet causes hepatic and blood markers changes indicating reduced biological age and disease risk',
      journal: 'Nat Commun',
      pmid: '38378685',
      doi: '10.1038/s41467-024-45260-9',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10879164/',
    },
    {
      id: 'hofer2024',
      authors: 'Hofer SJ, Daskalaki I, Bergmann M, et al.',
      year: 2024,
      title: 'Spermidine is essential for fasting-mediated autophagy and longevity',
      journal: 'Nat Cell Biol',
      pmid: '39117797',
      doi: '10.1038/s41556-024-01468-x',
    },
    {
      id: 'schwarz2022',
      authors: 'Schwarz C, Benson GS, Horn N, et al.',
      year: 2022,
      title:
        'Effects of spermidine supplementation on cognition and biomarkers in older adults with subjective cognitive decline: a randomized clinical trial',
      journal: 'JAMA Netw Open',
      pmid: '35616942',
      doi: '10.1001/jamanetworkopen.2022.13875',
    },
    {
      id: 'pietrocola2014',
      authors: 'Pietrocola F, Malik SA, Mariño G, et al.',
      year: 2014,
      title: 'Coffee induces autophagy in vivo',
      journal: 'Cell Cycle',
      pmid: '24769862',
      doi: '10.4161/cc.28929',
    },
    {
      id: 'liu2022',
      authors: "Liu S, D'Amico D, Shankland E, et al.",
      year: 2022,
      title:
        'Effect of urolithin A supplementation on muscle endurance and mitochondrial health in older adults: a randomized clinical trial',
      journal: 'JAMA Netw Open',
      pmid: '35050355',
      doi: '10.1001/jamanetworkopen.2021.44279',
    },
    {
      id: 'singh2022',
      authors: "Singh A, D'Amico D, Andreux PA, et al.",
      year: 2022,
      title:
        'Urolithin A improves muscle strength, exercise performance, and biomarkers of mitochondrial health in a randomized trial in middle-aged adults',
      journal: 'Cell Rep Med',
      pmid: '35584623',
      doi: '10.1016/j.xcrm.2022.100633',
    },
    {
      id: 'isley1983',
      authors: 'Isley WL, Underwood LE, Clemmons DR.',
      year: 1983,
      title: 'Dietary components that regulate serum somatomedin-C concentrations in humans',
      journal: 'J Clin Invest',
      pmid: '6681614',
      doi: '10.1172/JCI110757',
    },
    {
      id: 'clemmons1981',
      authors: 'Clemmons DR, Klibanski A, Underwood LE, et al.',
      year: 1981,
      title: 'Reduction of plasma immunoreactive somatomedin C during fasting in humans',
      journal: 'J Clin Endocrinol Metab',
      pmid: '7197688',
      doi: '10.1210/jcem-53-6-1247',
    },
    {
      id: 'hollstein2022',
      authors: 'Hollstein T, Basolo A, Unlu Y, et al.',
      year: 2022,
      title:
        'Effects of short-term fasting on ghrelin/GH/IGF-1 axis in healthy humans: the role of ghrelin in the thrifty phenotype',
      journal: 'J Clin Endocrinol Metab',
      pmid: '35678263',
      doi: '10.1210/clinem/dgac353',
    },
    {
      id: 'chan2008',
      authors: 'Chan JL, Williams CJ, Raciti P, et al.',
      year: 2008,
      title:
        'Leptin does not mediate short-term fasting-induced changes in growth hormone pulsatility but increases IGF-I in leptin deficiency states',
      journal: 'J Clin Endocrinol Metab',
      pmid: '18445667',
      doi: '10.1210/jc.2008-0056',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2453057/',
    },
    {
      id: 'galman2008',
      authors: 'Gälman C, Lundåsen T, Kharitonenkov A, et al.',
      year: 2008,
      title:
        'The circulating metabolic regulator FGF21 is induced by prolonged fasting and PPARα activation in man',
      journal: 'Cell Metab',
      pmid: '18680716',
      doi: '10.1016/j.cmet.2008.06.014',
    },
    {
      id: 'laeger2014',
      authors: 'Laeger T, Henagan TM, Albarado DC, et al.',
      year: 2014,
      title: 'FGF21 is an endocrine signal of protein restriction',
      journal: 'J Clin Invest',
      pmid: '25133427',
      doi: '10.1172/JCI74915',
    },
    {
      id: 'dushay2015',
      authors: 'Dushay JR, Toschi E, Mitten EK, et al.',
      year: 2015,
      title: 'Fructose ingestion acutely stimulates circulating FGF21 levels in humans',
      journal: 'Mol Metab',
      pmid: '25685689',
      doi: '10.1016/j.molmet.2014.09.008',
    },
    {
      id: 'soberg2017',
      authors: 'Søberg S, Sandholt CH, Jespersen NZ, et al.',
      year: 2017,
      title: 'FGF21 is a sugar-induced hormone associated with sweet intake and preference in humans',
      journal: 'Cell Metab',
      pmid: '28467924',
      doi: '10.1016/j.cmet.2017.04.009',
    },
    {
      id: 'peterson2025',
      authors: 'Peterson M, Richardson KA, Funderburk L.',
      year: 2025,
      title: 'Effect of exercise on fibroblast growth factor 21 levels in healthy males and females',
      journal: 'PLoS One',
      pmid: '40440637',
      doi: '10.1371/journal.pone.0321738',
    },
    {
      id: 'tinsley2019',
      authors: 'Tinsley GM, Moore ML, Graybeal AJ, et al.',
      year: 2019,
      title: 'Time-restricted feeding plus resistance training in active females: a randomized trial',
      journal: 'Am J Clin Nutr',
      pmid: '31268131',
      doi: '10.1093/ajcn/nqz126',
    },
    {
      id: 'moro2016',
      authors: 'Moro T, Tinsley G, Bianco A, et al.',
      year: 2016,
      title:
        'Effects of eight weeks of time-restricted feeding (16/8) on basal metabolism, maximal strength, body composition, inflammation, and cardiovascular risk factors in resistance-trained males',
      journal: 'J Transl Med',
      pmid: '27737674',
      doi: '10.1186/s12967-016-1044-0',
    },
    {
      id: 'lowe2020',
      authors: 'Lowe DA, Wu N, Rohdin-Bibby L, et al.',
      year: 2020,
      title:
        'Effects of time-restricted eating on weight loss and other metabolic parameters in women and men with overweight and obesity: the TREAT randomized clinical trial',
      journal: 'JAMA Intern Med',
      pmid: '32986097',
      doi: '10.1001/jamainternmed.2020.4153',
    },
    {
      id: 'areta2013',
      authors: 'Areta JL, Burke LM, Ross ML, et al.',
      year: 2013,
      title:
        'Timing and distribution of protein ingestion during prolonged recovery from resistance exercise alters myofibrillar protein synthesis',
      journal: 'J Physiol',
      pmid: '23459753',
      doi: '10.1113/jphysiol.2012.244897',
    },
    {
      id: 'laurens2021',
      authors: 'Laurens C, Grundler F, Damiot A, et al.',
      year: 2021,
      title:
        'Is muscle and protein loss relevant in long-term fasting in healthy men? A prospective trial on physiological adaptations',
      journal: 'J Cachexia Sarcopenia Muscle',
      pmid: '34668663',
      doi: '10.1002/jcsm.12766',
    },
  ],
};

export default topic;
