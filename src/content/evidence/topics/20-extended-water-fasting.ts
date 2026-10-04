import type { EvidenceTopic } from '../schema';

const topic: EvidenceTopic = {
  dossier: '20',
  slug: 'extended-water-fasting',
  title: 'Extended water-only fasting',
  scope:
    'This topic covers fasts with water and electrolytes only, with no energy and no protein, from 24 hours to about three weeks, and what changes when a fast is repeated. It follows energy use, fuel mix, ketones, protein and water loss, hormones, blood markers, refeeding and what is kept afterwards. It also records what the human data say about safety, and why Vitals treats repeated fasting as a way of delivering an energy deficit, not as a metabolic bonus. Dry fasting is excluded.',
  mechanisms: [
    {
      id: '20-fasting-clock-and-phases',
      title: 'When Vitals treats a stretch of days as a water-only fast',
      category: 'energy',
      summary:
        'Vitals counts the hours since the last real intake and switches to a separate set of rules once the fast is well under way. A water-only fast here means water (plain, mineral, or with electrolytes and essential micronutrients) with no energy and no protein. Black coffee and tea are allowed as a flagged modifier. The phase names shown on screen are labels, not switches inside the model.',
      howModelled:
        'A clock counts hours since the last intake of more than 50 kcal, more than 5 g protein or more than 5 g digestible carbohydrate. The fasting rules switch on once the clock passes 12 hours and the last 24 hours of intake are under 10 % of maintenance energy. For the water-only branch Vitals proposes also requiring protein under 5 g and digestible carbohydrate under 10 g in 24 hours. Modified fasts of the Buchinger type (about 200–250 kcal a day with 25–60 g carbohydrate) run the same branch with carbohydrate adjustments. Protein-sparing modified fasts, with protein of at least 1.2 g/kg ideal body weight, leave the branch and are handled elsewhere.',
      keyNumbers: [
        {
          label: 'What restarts the fasting clock',
          value: '> 50 kcal, or > 5 g protein, or > 5 g digestible carbohydrate',
          note: 'The safety-limits topic counts a fast as intake of 50 kcal or less.',
        },
        {
          label: 'Water-only branch (proposed criteria)',
          value: 'Rolling 24 h intake < 10 % of maintenance, protein < 5 g, digestible carbohydrate < 10 g',
          note: 'Proposed by Vitals.',
        },
        {
          label: 'Modified fasts used as evidence',
          value: '≈ 200–250 kcal/d with 25–60 g carbohydrate',
          note: 'Every use of these studies is flagged, because they are not water-only.',
          referenceIds: ['laurens2021', 'wilhelmi2019', 'grundler2024'],
        },
        {
          label: 'Post-absorptive phase label',
          value: '4–24 h after the last meal',
        },
        {
          label: 'Gluconeogenic and early ketogenic phase label',
          value: '24–72 h (highest nitrogen loss, small energy-expenditure bump)',
        },
        {
          label: 'Ketoadapting phase label',
          value: 'Day 4–17',
          note: 'Ketones plateau after about 17 days in obese subjects.',
          referenceIds: ['owen1969'],
        },
        {
          label: 'Protein-conserving phase label',
          value: 'From about day 17; only reached by people with large fat stores',
        },
        {
          label: 'Fat-depletion phase',
          value: 'Rising nitrogen loss when body fat approaches about 10 %',
          note: 'Treated as a safety boundary, not a normal phase. The figure comes from a summary of older work in Laurens 2021.',
          referenceIds: ['laurens2021'],
        },
      ],
      timeCourse:
        'A fast begins at the end of the absorptive period of the last meal, about 4–6 hours after a mixed meal. Studies usually count day 1 from the last evening meal. The reference tables in this topic count days from the start of zero intake.',
      grade: 'C',
      gradeReason:
        'These are modelling definitions rather than findings: the thresholds are proposed and the phase names are descriptive.',
      status: 'proposed-fit',
      caveats:
        "Where studies count 'day 1' from the last meal and Vitals counts from the start of zero intake, day numbers can differ by part of a day.",
      referenceIds: ['laurens2021', 'wilhelmi2019', 'grundler2024', 'owen1969'],
      relatedMetricIds: ['hoursFasted'],
    },
    {
      id: '20-fasting-overlay-swaps',
      title: 'Why the weight model changes its rules at zero intake',
      category: 'body',
      summary:
        "Vitals' core weight model was built for moderate restriction and semistarvation. Run unchanged at zero intake in a normal-weight person, it would cut resting energy use too early, keep burning protein at a constant high rate, count too little sodium and water loss, and say nothing about ketone concentration. During a fast Vitals replaces those parts and leaves the rest of the model as it is.",
      howModelled:
        'While the fast is active, four parts are swapped. Resting adaptive thermogenesis (the slow fall in energy use with weight loss) is replaced by the fasting curve in the energy-expenditure article. Protein burning is replaced by the nitrogen model. Sodium and water loss use one fasting term, never two stacked on top of each other. Ketone concentration is owned by the ketone model, which is tuned to the water-only targets. Everything else (fat balance by energy closure, glycogen flows, no thermic effect of food at zero intake, synthesis costs) is used unchanged. After the fast, the swapped parts hand back through slowly relaxing states, so repeated fasts carry memory.',
      keyNumbers: [
        {
          label: 'Unmodified model at zero intake: resting metabolic rate',
          value: '≈ −12 % by day 5 (derived)',
          note: 'The adaptive term alone would cut the lean-tissue-linked part of resting energy by 35 % and non-exercise activity by 38 % of their components.',
          referenceIds: ['hall2010'],
        },
        {
          label: 'Measured resting metabolic rate',
          value: '+3 to +14 % on days 2–3; unchanged at day 5; −7.5 % at day 9; −20 % at day 20',
          referenceIds: ['zauner2000', 'mansell1990', 'browning2012', 'dai2022', 'kolnes2025', 'dai2024'],
        },
        {
          label: 'Unmodified model at zero intake: protein burned',
          value: '≈ 90 g protein/d (14 g nitrogen), roughly constant (derived)',
          referenceIds: ['hall2010'],
        },
        {
          label: 'Measured urinary nitrogen',
          value: 'Peaks on days 2–4, then falls 30–70 % depending on adiposity',
        },
        {
          label: 'Unmodified model: water and sodium term',
          value: '−1.33 L, time constant 1.07 d, from carbohydrate withdrawal only',
          note: 'Fasting natriuresis is larger than carbohydrate withdrawal alone, through ketoacid anion excretion and the fall in insulin.',
          referenceIds: ['hall2010', 'sigler1975', 'heyman2020'],
        },
        {
          label: 'Unmodified model: ketones',
          value: 'A flux (up to 0.8 × lipolysis) but no blood concentration',
          referenceIds: ['hall2010'],
        },
        {
          label: 'Range of fasts the core model was validated on',
          value: '30-day fasts in obese adults',
          referenceIds: ['hall2010', 'hall2011'],
        },
      ],
      grade: 'C',
      gradeReason:
        'The mismatch between the unmodified model and the human data is clear in several datasets, but the replacement terms are our own fits.',
      status: 'proposed-fit',
      caveats:
        "The 'derived' numbers are arithmetic on the published model, not measurements. If the separate water-transition model is active, only one sodium and water term may run, to avoid double counting.",
      referenceIds: [
        'hall2010',
        'hall2011',
        'zauner2000',
        'mansell1990',
        'browning2012',
        'dai2022',
        'kolnes2025',
        'dai2024',
        'sigler1975',
        'heyman2020',
      ],
      relatedMetricIds: ['rmr', 'fastProteinCost', 'scaleWeight', 'muscleGlycogen'],
    },
    {
      id: '20-scale-weight-loss-rates',
      title: 'How fast the scale falls in a water-only fast',
      category: 'body',
      summary:
        'In normal-weight adults the scale drops by about a kilogram a day for the first three days, about half a kilogram a day until day 10, and about 0.3 kg a day in the third week. Much of the early drop is not fat. It is stored carbohydrate and its water, sodium-linked water and gut contents, which is why the loss slows once those are used up.',
      howModelled:
        'Scale weight is the sum of five parts that Vitals tracks separately: fat, protein tissue with its water, glycogen with its water, extracellular fluid and gut contents. The rate on any day comes from adding up how each part changes, not from a fitted weight curve.',
      keyNumbers: [
        {
          label: 'Days 1–3',
          value: '≈ 1.0–1.2 kg/d',
          note: '1.12–1.20 kg/d in the two 10-day and 21-day cohorts.',
          referenceIds: ['dai2022', 'dai2024'],
        },
        { label: 'Days 4–10', value: '≈ 0.5 kg/d' },
        {
          label: 'Week 3',
          value: '≈ 0.3 kg/d',
          note: '0.31 ± 0.07 kg/d on days 11–21 in one cohort; another source gives 0.9 kg/d in week 1 falling to 0.3 kg/d by week 3.',
          referenceIds: ['dai2024', 'kerndt1982'],
        },
        {
          label: '7 days, normal-weight adults',
          value: '≈ −5.7 to −5.8 kg',
          note: 'Two Norwegian cohorts, n = 12 and n = 13.',
          referenceIds: ['pietzner2024', 'kolnes2025'],
        },
        {
          label: '10 days, men',
          value: '≈ −7.3 kg (−7.28 ± 1.46 kg, −9.8 %)',
          referenceIds: ['dai2022'],
        },
        {
          label: '21 days',
          value: '≈ −10 kg (−10.0 ± 1.66 kg, −15.0 %)',
          referenceIds: ['dai2024'],
        },
        {
          label: '31 days, one lean man (60.6 kg)',
          value: '−13.25 kg',
          referenceIds: ['benedict1915'],
        },
        {
          label: 'Reviews and observational series, 5–20 days',
          value:
            '−2 % to −10 % (11 trials); −3.2 kg at 5 days to −8.6 ± 0.3 kg at 20 days (1,422 people on modified fasts)',
          referenceIds: ['ezpeleta2024', 'wilhelmi2019'],
        },
        {
          label: 'Uncertainty band shown on screen (proposed)',
          value: 'Weight change ±15 %',
        },
      ],
      timeCourse:
        'The rate is highest on days 1–3, when glycogen, sodium-linked water and gut contents are lost together. It falls to about 0.5 kg a day over days 4–10 and to about 0.3 kg a day in week 3, when mostly fat and protein tissue are being lost.',
      moderators:
        'Body size and leanness. In the reference model a 7-day fast removes 5.7 kg from a lean 75 kg man, 4.2 kg from a lean 60 kg woman and 5.2 kg from an obese 100 kg woman.',
      grade: 'B',
      gradeReason:
        'Several controlled and observational cohorts agree on the rates and totals, although each is small.',
      status: 'established',
      caveats:
        'The reference model reproduces these figures within about ±1.3 kg. It under-predicts the two Chinese cohorts by about 1 kg, possibly because of measurement after defecation or higher activity.',
      referenceIds: [
        'pietzner2024',
        'kolnes2025',
        'dai2022',
        'dai2024',
        'kerndt1982',
        'benedict1915',
        'ezpeleta2024',
        'wilhelmi2019',
      ],
      relatedMetricIds: ['scaleWeight', 'waterWeight'],
    },
    {
      id: '20-composition-of-fast-loss',
      title: 'What the lost weight is made of',
      category: 'body',
      summary:
        'Fat burns at a nearly constant 150–240 g a day however long the fast lasts, so it makes up a small part of the early loss and a growing part of the later loss. In a lean person fat is about 10 % of the loss on day 1, about 23 % by day 7 and about 35–40 % by day 21. The rest is protein tissue and its water, glycogen and its water, and extracellular fluid with gut contents.',
      howModelled:
        "Fat loss is worked out by energy closure. The body's energy needs, minus what glycogen and protein supply, is met by fat, plus a small allowance for ketones lost in urine. Protein comes from the nitrogen model. Glycogen, water and gut contents come from their own terms. Scale weight is then the sum of all the parts.",
      equation:
        'fat oxidised (g/d) = [energy expenditure − 4.18 × glycogen used − 4.7 × protein oxidised − intake] ÷ 9.44 + urinary ketone loss\nscale change = Δfat + Δ(protein tissue + its water) + Δ(glycogen + its water) + Δ(extracellular fluid + gut contents)\nurinary ketone loss ≈ 10 g/d fat-equivalent once blood BHB is at or above 3.5 mM',
      keyNumbers: [
        {
          label: 'Fat oxidised per day, 75 kg lean man',
          value: '≈ 180–195 g/d',
          note: 'Model output.',
        },
        { label: 'Fat oxidised per day, 60 kg lean woman', value: '145–157 g/d', note: 'Model output.' },
        { label: 'Fat oxidised per day, 100 kg obese woman', value: '≈ 195 g/d', note: 'Model output.' },
        { label: 'Fat oxidised per day, 115 kg obese man', value: '225–240 g/d', note: 'Model output.' },
        {
          label: 'Fat share of the weight lost, lean man',
          value: '10 % (1 d), 16 % (3 d), 23 % (7 d), 31 % (14 d), 35 % (21 d)',
          note: 'Model output. For a lean woman the 21-day share is 40 %, for an obese woman 42 %.',
        },
        {
          label: '7-day fast, lean man: parts of a 5.7 kg loss',
          value:
            'Fat 1.31 kg, protein tissue 1.63 kg, glycogen and water 1.15 kg, extracellular fluid and gut 1.59 kg',
          note: 'Model output.',
        },
        {
          label: '21-day fast, lean man: parts of an 11.0 kg loss',
          value:
            'Fat 3.84 kg, protein tissue 4.09 kg, glycogen and water 1.42 kg, extracellular fluid and gut 1.60 kg',
          note: 'Model output.',
        },
        {
          label: 'Measured, 7 days (13 adults)',
          value: 'Weight −5.8 ± 0.3 kg with DXA fat −1.4 ± 0.1 kg',
          note: 'In the other 7-day cohort (12 adults) weight fell 5.7 ± 0.8 kg (SEM) and DXA fat 1.6 ± 1.3 kg.',
          referenceIds: ['kolnes2025', 'pietzner2024'],
        },
        {
          label: 'Measured, 31 days, one lean man: a 13.25 kg loss',
          value: 'Water 7.33 kg, fat 3.65 kg, protein 1.66 kg, carbohydrate 0.20 kg (balance method)',
          referenceIds: ['benedict1915'],
        },
        {
          label: 'Measured, 7-day fat use',
          value: 'DXA fat −1.4 ± 0.1 kg ≈ 1,800 kcal/d, nearly enough for the measured resting energy',
          referenceIds: ['kolnes2025'],
        },
        {
          label: 'Where the lost protein comes from (proposed)',
          value: '60 % muscle and 40 % other lean tissue on days 0–3; 80 % and 20 % after',
          note: 'Grade D allocation. Extremity lean mass fell 1.7 ± 0.5 kg (6 %) of a 4.6 kg DXA-lean loss at 7 days.',
          referenceIds: ['kolnes2025'],
        },
        {
          label: 'Uncertainty bands shown on screen (proposed)',
          value: 'Fat ±25 %, protein ±25 %',
        },
      ],
      timeCourse:
        'Fat oxidation stays close to constant, so the fat share of the total loss rises slowly. Glycogen and water losses are largely finished by about day 7, after which the loss is mostly fat and protein tissue.',
      moderators:
        'Body size, body-fat level and sex. Larger and fatter bodies burn more fat per day (obese man 225–240 g/d against 145–157 g/d for a lean woman).',
      grade: 'B',
      gradeReason:
        'End-of-fast totals come from several cohorts; the day-by-day split is model output that has been checked against them.',
      status: 'proposed-fit',
      caveats:
        "The day-by-day tables are output from Vitals' reference model, not measurements. They were checked against published totals, not fitted to every day.",
      referenceIds: ['hall2010', 'carlson1994', 'kolnes2025', 'pietzner2024', 'benedict1915'],
      relatedMetricIds: ['fatMass', 'leanTissue', 'fastProteinCost'],
    },
    {
      id: '20-fasting-energy-expenditure',
      title: 'Energy use in a fast: a small early rise, then a fall',
      category: 'energy',
      summary:
        'The thermic effect of food (the energy spent digesting a meal) disappears at zero intake. In the first two to four days the stress-hormone response raises resting energy use by a few percent, though studies disagree on the size. From about day 4 thyroid hormone and leptin fall, tissue is lost, and resting energy use declines steadily, more in lean people than in people with obesity.',
      howModelled:
        "Resting energy use starts from the baseline estimate, adjusted for tissue lost. It is then multiplied by an early bump that peaks at about two days and is gone by about day 7, and by a slow adaptation that starts after a two-day lag. The adaptation is larger for leaner people. When intake returns to normal the adaptation fades over about four days. During a fast this curve replaces the model's usual resting adaptive-thermogenesis term (it is not added to it). The activity-related adaptation stays.",
      equation:
        'RMR(t) = [RMR₀ + 19·ΔP + 4.5·ΔF] × (1 + A(t)) × (1 − φ·s(t))\nA(t) = 0.05 · (t / 2.0) · exp(1 − t / 2.0), t in days (early bump)\nds/dt = (1 − s) / 9 d after a 2 d lag; s relaxes to 0 with a time constant of 4 d on refeeding\nφ = clamp(0.25 − 0.004 × body-fat %, 0.05, 0.22)\nTEE = RMR + activity + non-exercise adaptation; thermic effect of food = 0 at zero intake\nΔP = kg of protein tissue lost (negative); ΔF = kg of fat change (negative)',
      keyNumbers: [
        {
          label: 'Early rise, pooled across 7 studies (days 2–3)',
          value: '≈ +4 % (SD ≈ 7 %); range −8 to +14 %',
          note: 'Unweighted mean; the direction is contested.',
          referenceIds: [
            'zauner2000',
            'webber1994',
            'mansell1990',
            'browning2012',
            'dai2022',
            'nair1987',
            'dai2024',
          ],
        },
        {
          label: '84 h fast, 11 lean people',
          value: '+14 % (3.97 → 4.53 kJ/min, day 1 to day 3)',
          note: 'Noradrenaline rose from 1716 to 3728 pmol/L.',
          referenceIds: ['zauner2000'],
        },
        {
          label: '12, 36 and 72 h fasts (17 women, 12 men)',
          value: '+6 % at 36 h; +2.6 % (not significant) at 72 h',
          referenceIds: ['webber1994'],
        },
        {
          label: 'Day 5 of a water fast (13 adults)',
          value: 'No change',
          referenceIds: ['kolnes2025'],
        },
        {
          label: '24 h fast, whole-room chamber, 77 people',
          value: '24 h energy expenditure −177 kcal/d against energy balance (median)',
          note: 'About the thermic effect of food that is no longer there.',
          referenceIds: ['hollstein2021'],
        },
        {
          label: '21-day water fast, resting energy against baseline',
          value: 'Day 3 not significant; day 9 −7.5 %; day 15 −13.7 %; day 20 −20.3 %',
          note: 'The largest individual fall was −53.9 %. Resting energy returned to baseline 3 days after full refeeding.',
          referenceIds: ['dai2024'],
        },
        {
          label: '31-day fast, one lean man',
          value: 'Morning resting heat production 1,615 → 1,109 kcal/d (−31 %)',
          referenceIds: ['benedict1915'],
        },
        {
          label: '10-day modified fast, 16 men',
          value: 'Basal metabolic rate −12 % at day 10',
          referenceIds: ['laurens2021'],
        },
        {
          label: 'Obese adults, 21 days',
          value: 'Resting energy per kg of body mass unchanged',
          note: 'It fell only in proportion to body mass.',
          referenceIds: ['owen1998'],
        },
        {
          label: 'Model fit for a lean man',
          value: '−9 % (day 7), −13 % (day 10), −21 % (day 21)',
          note: 'Model output.',
        },
        {
          label: 'Parameters',
          value:
            'Early bump size 0.05 (range −0.08 to +0.14), peak 2.0 d (1.5–3), lag 2 d (1–4), on-time 9 d (6–14), off-time 4 d (3–7)',
        },
        {
          label: 'Adaptation size φ',
          value: '0.19 at 15 % body fat, 0.15 at 25 %, 0.07 at 45 %',
          note: 'About −19 % of resting energy in lean people and −7 % in obese people (proposed).',
        },
        {
          label: 'Thyroid hormone and leptin',
          value: 'T3 −30 % and leptin to about 10 % at 72 h; T3 −53 % with reverse T3 +58 % at 7–18 days',
          referenceIds: ['chan2003', 'spaulding1976'],
        },
      ],
      timeCourse:
        'A small rise on days 1–3, back to baseline by day 4–5, then a fall of 7.5 % (day 9), 13.7 % (day 15) and 20.3 % (day 20). The adaptation relaxes with a time constant of about 4 days after refeeding, with thyroid hormones back to normal within a week of a mixed diet.',
      moderators:
        'Leanness (a larger adaptation in lean people) and tissue lost. Sex differences disappear when energy use is expressed per kg of lean mass.',
      grade: 'C',
      gradeReason:
        'The early rise is contested and rests on 30 or fewer people per time point; the direction of the late decline is better supported.',
      status: 'proposed-fit',
      caveats:
        'The dependence of the fall on body fat is inferred from three datasets (a lean man, a normal-weight cohort, and per-kg constancy in obesity); no study compared lean and obese people in one protocol. Early rise or no rise matters little for weight (about 50–100 kcal a day for 3–4 days). This curve replaces, and is not added to, the resting adaptive-thermogenesis term of the energy-expenditure topic.',
      referenceIds: [
        'zauner2000',
        'webber1994',
        'mansell1990',
        'browning2012',
        'dai2022',
        'nair1987',
        'dai2024',
        'kolnes2025',
        'hollstein2021',
        'benedict1915',
        'laurens2021',
        'owen1998',
        'chan2003',
        'spaulding1976',
        'mathieson1986',
        'hall2010',
      ],
      relatedMetricIds: ['rmr', 'tdee'],
    },
    {
      id: '20-glycogen-in-a-fast',
      title: 'Glycogen runs down: the liver within a day or two, muscle more slowly',
      category: 'fuel',
      summary:
        "Glycogen is the body's stored carbohydrate. The liver's store is mostly used within 24–36 hours of no food. Resting muscle glycogen barely changes in the first day, is 20–30 % lower after 2–3 days and about half after a week. Each gram of glycogen is stored with water, so this loss shows up on the scale.",
      howModelled:
        'Liver glycogen follows the carbohydrate model. Muscle glycogen falls at a faster fasting-specific rate towards a floor of about 35 % of its starting level. The carbon released goes to lactate and then to new glucose in the liver, so it appears as glucose output, not as muscle carbohydrate burning. Glycogen is stored with about 3 g of water per gram (the base model uses 2.7) and 0.45 mmol of potassium per gram.',
      equation: 'dG_muscle/dt = −k × (G_muscle − 0.35 × G_muscle,start), k = 0.008 per hour (fasting)',
      keyNumbers: [
        {
          label: 'Glucose from gluconeogenesis, liver, first 22 h',
          value: '64 ± 5 % of output',
          note: 'Then 82 ± 5 % over the next 14 h and 96 ± 1 % after that.',
        },
        {
          label: 'Liver glycogen depleted by the carbohydrate model',
          value: '≈ 60–65 % at 24 h; 85–90 % at 48 h',
          note: 'The round-number statement is that liver glycogen is completely used after 24–36 h without food.',
          referenceIds: ['kolnes2025'],
        },
        {
          label: 'Resting muscle glycogen, 24 h fast (cyclists)',
          value: 'No effect',
          referenceIds: ['loy1986'],
        },
        {
          label: 'Muscle glycogen after 2–3 days',
          value: '20–30 % lower',
          referenceIds: ['kolnes2025'],
        },
        {
          label: 'Muscle glycogen after 7 days (vastus lateralis, n = 13)',
          value: 'Halved: 408 ± 34 → 191 ± 13 mmol/kg protein',
          note: 'Glycogen-synthase activity was higher, which primes refilling on refeeding.',
          referenceIds: ['kolnes2025'],
        },
        {
          label: 'Model muscle glycogen loss',
          value: '−29 % at 3 d, −48 % at 7 d, −64 % at 21 d',
          note: 'Model output, against data of −20–30 % at 2–3 d and −53 % at 7 d.',
        },
        {
          label: 'Water bound to glycogen',
          value: '3 g per g (base model uses 2.7); potassium 0.45 mmol per g',
          referenceIds: ['hall2010'],
        },
        {
          label: 'Energy in whole-body glycogen used over a fast',
          value: '≈ 1,300–1,900 kcal',
          note: 'Less than one day of energy expenditure, which is why early weight loss is mostly not fat. Model output for a 75 kg man: about 85 g liver plus about 280 g muscle by day 21.',
        },
        {
          label: 'Assumed depletion in a 10-day modified fast',
          value: 'Liver −90 %, muscle −40 %',
          referenceIds: ['laurens2021'],
        },
      ],
      timeCourse:
        'Liver stores are largely gone within a day or two. The muscle rate constant of 0.008 per hour replaces the slower fed-state rate (0.0035 per hour) while the fast is active. Refilling after a fast has its own primed synthase activity.',
      moderators:
        'Muscle mass (more muscle stores more) and, for the post-fast rebound, refeeding carbohydrate and salt.',
      grade: 'B',
      gradeReason:
        'The liver data are strong (carbon-13 spectroscopy, covered in the carbohydrate topic), but the fasting muscle rate rests on one 7-day biopsy study plus older 2–3 day data.',
      status: 'proposed-fit',
      caveats:
        'The fasting muscle rate is a proposed fit to a few time points. A +10 % glycogen overshoot after refeeding is used but unverified.',
      referenceIds: ['kolnes2025', 'loy1986', 'hall2010', 'laurens2021'],
      relatedMetricIds: ['liverGlycogen', 'muscleGlycogen', 'glycogenTotal'],
    },
    {
      id: '20-glucose-supply-in-a-fast',
      title: 'Glucose is made from scratch and held at a lower level',
      category: 'fuel',
      summary:
        'Once stored glycogen runs low, the liver and kidney make the glucose the body needs from lactate, glycerol and amino acids. Glucose production falls by about a quarter over the first three days and blood glucose settles at a lower level, often below 3.9 mM for much of the day. In a continuous-monitor study the fasters reported no symptoms at these levels.',
      howModelled:
        'Vitals keeps blood glucose at a lower plateau from about day 3–5 and lets it drift slightly upward later, using the studies below as anchors. Amino-acid gluconeogenesis is not modelled separately: the protein used comes from the nitrogen model.',
      keyNumbers: [
        {
          label: 'Glucose production, 12 → 72 h (young men)',
          value: '11.0 → 8.3 µmol/kg/min (−25 %); blood glucose 5.58 → 4.14 mM',
          note: '70 % of the insulin fall had happened within 24 h.',
          referenceIds: ['klein1993'],
        },
        {
          label: 'At 60 h',
          value:
            'Glucose production 11.8 → 8.2 µmol/kg/min (≈ 150 g/d at 70 kg, derived); glucose oxidation −85 %',
          note: 'Lipolysis ×2.5; fat oxidation ≈ 75 % of resting energy; proteolysis and protein oxidation +50 %.',
          referenceIds: ['carlson1994'],
        },
        {
          label: 'After 5–6 weeks of fasting (obese)',
          value: '≈ 86 g/d of glucose, half from the liver and half from the kidney',
          referenceIds: ['owen1969'],
        },
        {
          label: '21 days (obese)',
          value:
            'Glycerol supplies as much gluconeogenic carbon as all amino acids combined; minimal glucose need 0.34 g/kg body weight/d',
          referenceIds: ['owen1998'],
        },
        {
          label: 'Glucose nadir',
          value: '3.3–3.5 mM at days 3–5, then a slight rise to 3.7–3.9 mM',
          referenceIds: ['dai2022', 'dai2024'],
        },
        {
          label: 'Continuous glucose monitor, day 5 of a 7-day fast',
          value: 'Mean 3.7 mM (67 mg/dL); 66 % of the day below 3.9 mM; minimum 2.8 mM; no symptoms',
          referenceIds: ['kolnes2026'],
        },
        {
          label: 'Sex differences',
          value:
            'Glucose production identical in matched-adiposity women and men at 14 and 22 h; women 0.3 to 0.45 mM lower at 30–48 h; CGM 77 vs 83 mg/dL (p = 0.065)',
          referenceIds: ['mittendorfer2001', 'haymond1982', 'kolnes2026'],
        },
        {
          label: 'One 382-day supervised fast (ambulant)',
          value: 'Glucose ≈ 1.7 mM (30 mg/dL) throughout the last 8 months',
          referenceIds: ['stewart1973'],
        },
        {
          label: '72 h fasts in 60 women, 20 men and 16 obese people',
          value: 'The obese group never fell below 55 mg/dL',
          referenceIds: ['merimee1977'],
        },
      ],
      timeCourse:
        'Most of the insulin fall happens in the first 24 hours. Glucose reaches its lowest level around days 3–5 and then rises slightly.',
      moderators: 'Adiposity (people with obesity had a smaller glucose fall) and, less clearly, sex.',
      grade: 'B',
      gradeReason:
        'Tracer and continuous-monitor studies agree on the pattern, although each has only a small number of participants.',
      status: 'established',
      caveats: 'Sex differences in glucose are small and inconsistent between studies.',
      referenceIds: [
        'klein1993',
        'carlson1994',
        'owen1969',
        'owen1998',
        'dai2022',
        'dai2024',
        'kolnes2026',
        'mittendorfer2001',
        'haymond1982',
        'stewart1973',
        'merimee1977',
      ],
      relatedMetricIds: ['glucose'],
    },
    {
      id: '20-fat-as-main-fuel',
      title: 'Fat becomes the main fuel and the respiratory quotient falls',
      category: 'fuel',
      summary:
        'Fat release from fat tissue roughly doubles between 12 and 72 hours of fasting, with most of the rise between 12 and 24 hours. By about 60 hours fat supplies about three quarters of resting energy. The respiratory quotient (the ratio of carbon dioxide produced to oxygen used, which tells you which fuel is burning) falls from about 0.8 towards 0.70. Fat release is never the limiting step in the people studied.',
      howModelled:
        'Vitals does not model fat release as a separate rate. Fat burned per day comes from energy closure (see the composition article): total energy needs minus glycogen and protein supply. The respiratory quotient and fat-release figures below are used to check that the answer is plausible.',
      keyNumbers: [
        {
          label: 'Fat release, 12 → 72 h',
          value: 'Glycerol appearance 2.08 → 4.36 and palmitate appearance 1.63 → 3.26 µmol/kg/min',
          note: '60 % of the rise happens between 12 and 24 h, largest between 18 and 24 h.',
          referenceIds: ['klein1993'],
        },
        {
          label: 'Free fatty acids, day 1 → day 5',
          value: '0.43 → 1.55 mM',
          referenceIds: ['ho1988'],
        },
        {
          label: 'Fat release against fat burning',
          value: 'Fat release far exceeds net fat oxidation (re-esterification ×2.5)',
          referenceIds: ['carlson1994'],
        },
        {
          label: 'Sex differences in fat release',
          value:
            'Women start higher (2.1 vs 1.5 µmol/kg/min) with a blunted rise (+40 vs +80 %), equal by 22 h; free fatty acids at 48 h 0.94 vs 0.71 mM (women vs men)',
          referenceIds: ['mittendorfer2001', 'browning2012'],
        },
        {
          label: 'Fat lost over 7 days',
          value:
            '1.4 ± 0.1 kg DXA fat ≈ 1,800 kcal/d; maximal exercise fat oxidation doubled (≈ 0.4 → ≈ 0.8 g/min) at day 6',
          referenceIds: ['kolnes2025'],
        },
        {
          label: 'Respiratory quotient, 12 → 36 → 72 h',
          value: '0.80 → 0.76 → 0.72',
          referenceIds: ['webber1994'],
        },
        {
          label: 'Respiratory quotient, day 5',
          value: '0.86 → 0.76',
          referenceIds: ['kolnes2025'],
        },
        {
          label: 'Respiratory quotient, day 9 to day 21',
          value: '≈ 0.70 and stable',
          note: 'Some values below 0.70 were attributed to gluconeogenesis and ketone retention.',
          referenceIds: ['dai2024'],
        },
        {
          label: 'Carbohydrate and fat oxidation, 21-day fast',
          value:
            'Carbohydrate oxidation ≈ 1/3 of pre-fast by day 3 and ≈ 10 % by day 9; fat oxidation ×1.8 by day 3',
          referenceIds: ['dai2024'],
        },
      ],
      timeCourse:
        'About 60 % of the rise in fat release happens between 12 and 24 hours. The respiratory quotient reaches its floor of about 0.70 by day 9 and stays there to day 21.',
      moderators:
        'Sex (a different starting level and rise, equal by 22 h) and body size (fat use in g/d scales with energy needs).',
      grade: 'B',
      gradeReason:
        'Tracer and calorimetry studies with 6–18 people each agree, and fat use by energy closure is as good as the energy-expenditure estimate.',
      status: 'established',
      referenceIds: [
        'klein1993',
        'ho1988',
        'carlson1994',
        'mittendorfer2001',
        'browning2012',
        'kolnes2025',
        'webber1994',
        'dai2024',
      ],
      relatedMetricIds: ['fatOxidation', 'fatMass'],
    },
    {
      id: '20-ketones-water-only',
      title: 'Blood ketones in a true water-only fast',
      category: 'fuel',
      summary:
        'Ketones (mainly beta-hydroxybutyrate, or BHB) are fuel molecules the liver makes from fat. In a water-only fast they are about 0.3 mM at 24 hours, 1.4–1.9 mM at 48 hours and 2.3–2.7 mM at 72 hours, and reach about 4 mM by days 6–8. Values keep creeping up to about 6–6.6 mM by day 21. People with obesity make about half as much in the first two days.',
      howModelled:
        'The ketone model owns the concentration; this topic supplies the water-only targets it must reproduce, within about ±30 %. The reference curve rises in an S-shape around 44 hours and then climbs slowly. It is lower for people with more body fat, and lower again if the fast includes some carbohydrate (as modified fasts do).',
      equation:
        'BHB(t) = 0.08 + B1 / (1 + exp(−(t − 44) / 9)) + B2 × (1 − exp(−max(0, t − 48) / τ2)), t in hours, BHB in mM\nB1 = 2.2 × (1 − 0.4 × ob), B2 = 3.7, τ2 = 170 h × (1 + 0.5 × ob)\nob = clamp((body fat % − 25) / 20, 0, 1)\nfor modified fasts: multiply by (1 − 0.4 × clamp(carbohydrate g per day / 60, 0, 1))',
      keyNumbers: [
        {
          label: '24 h, 18 young adults (plasma)',
          value: '0.33 mM (women) / 0.41 mM (men)',
          referenceIds: ['browning2012'],
        },
        {
          label: '30 h, 20 adults',
          value: '0.9 mM (men) / 1.7 mM (women)',
          referenceIds: ['haymond1982'],
        },
        {
          label: '48 h',
          value: '1.22 mM (women) / 1.94 mM (men); capillary: lean 3.7 vs obese 1.9 mM',
          referenceIds: ['browning2012', 'neudorf2025'],
        },
        {
          label: '52 h, normal subjects',
          value: '1.8 ± 0.4 mM',
          referenceIds: ['boden1996'],
        },
        {
          label: '72 h',
          value: '2.3 ± 0.5 mM (6 men, plasma); 2.23 mM (8 obese, whole blood)',
          referenceIds: ['mcdougal2018', 'owen1971'],
        },
        {
          label: 'Day 1 → day 8, capillary strips (13 men)',
          value: '1.31 mM → peak 5.6 mM at day 8, plateau from day 5',
          referenceIds: ['dai2022'],
        },
        {
          label: 'Day 6 and day 8, laboratory plasma',
          value: '4.01 ± 0.30 mM before exercise on day 6; 4.77 ± 0.70 mM on day 8',
          referenceIds: ['kolnes2025', 'oglodek2021'],
        },
        {
          label: 'Days 5–9 / 10–15 / 15–21 / day 21, capillary (13 adults)',
          value: '4.74 / 5.36 / 6.03 / 6.61 ± 1.25 mM',
          referenceIds: ['dai2024'],
        },
        {
          label: 'Day 12 of a Buchinger fast (25–60 g/d carbohydrate)',
          value: '≈ 4 mM',
          referenceIds: ['grundler2024'],
        },
        {
          label: 'Model curve, lean adult',
          value:
            '0.30 (24 h), 0.72 (36 h), 1.42 (48 h), 2.67 (72 h), 3.56 (day 5), 4.15 (day 7), 4.78 (day 10), 5.30 (day 14), 5.73 (day 21) mM',
          note: 'Obese woman: 0.21, 0.46, 0.88, 1.68, 2.31, 2.79, 3.36, 3.90, 4.48 mM.',
        },
        {
          label: 'Exercise',
          value:
            'Starting exercise at the start of a fast brings 0.5 mM forward (17.5 vs 21.1 h); a maximal test late in a fast lowers BHB (4.0 → 2.9 mM)',
          referenceIds: ['deru2021', 'kolnes2025'],
        },
        {
          label: 'After carbohydrate',
          value: 'BHB halves within 1 h of about 110 g of carbohydrate and is back to baseline by 3–4 days',
          referenceIds: ['dai2022', 'dai2024'],
        },
      ],
      timeCourse:
        'A steep rise between roughly 24 and 72 hours, a plateau in the first week, then a slow climb over weeks two and three. Ketones fall quickly when carbohydrate is eaten.',
      moderators:
        'Body fat (obesity halves early ketones; 48 h BHB 1.9 vs 3.7 mM), carbohydrate intake (modified fasts plateau lower), prior low-carbohydrate eating, exercise, caffeine. Sex data conflict (women higher at 30 h, lower at 48 h), so the reference curve has no sex term.',
      grade: 'B',
      gradeReason:
        'Several cohorts agree to 72 hours; beyond that the cohorts are small and strip meters read higher than laboratory assays (B/C).',
      status: 'proposed-fit',
      caveats:
        "The reference curve is proposed. Earlier fasting timelines in the fasting and meal-timing topic are about 0.5–1.3 mM low for true water-only fasts, because they were anchored on modified fasts. The fat-oxidation and ketosis topic's own model gives 2.45 mM at 72 h (lean) and 4.99 mM at day 24 (obese), which fits this curve within its ±30 % tolerance.",
      referenceIds: [
        'browning2012',
        'haymond1982',
        'neudorf2025',
        'boden1996',
        'mcdougal2018',
        'owen1971',
        'dai2022',
        'kolnes2025',
        'oglodek2021',
        'dai2024',
        'grundler2024',
        'deru2021',
      ],
      relatedMetricIds: ['bhb', 'ketosisState', 'hoursInKetosis'],
    },
    {
      id: '20-brain-fuel-switch',
      title: 'The brain switches to ketones',
      category: 'fuel',
      summary:
        'The brain normally runs mostly on glucose. Over days of fasting it takes up more and more ketones, so the body needs less glucose from breaking down protein. This switch is why people with large fat stores can go without food for weeks or months. Only the outline is well documented; the exact share of brain fuel that is ketones is our own display estimate.',
      howModelled:
        "The brain's ketone share is shown as a smooth curve of blood ketones. It is display-only and does not drive any other part of the model. The protein-sparing effect of ketones is handled in the nitrogen model instead.",
      equation: 'brain ketone share = 0.8 × BHB^1.5 / (BHB^1.5 + 3^1.5), BHB in mM',
      keyNumbers: [
        {
          label: 'Catheter studies, 3 obese patients after 5–6 weeks of fasting',
          value: 'Ketones (BHB and acetoacetate) replaced glucose as the predominant brain fuel',
          note: 'The widely quoted ≈ 60 % ketone share comes from the full text and could not be confirmed against the original paper.',
          referenceIds: ['owen1967'],
        },
        {
          label: 'Whole-body glucose production after 5–6 weeks',
          value: '≈ 86 g/d',
          referenceIds: ['owen1969'],
        },
        {
          label: 'Brain ketone influx after 3.5 days',
          value: 'More than 10-fold higher with arterial BHB',
          note: 'Uptake follows concentration.',
          referenceIds: ['hasselbalch1995'],
        },
        {
          label: 'Brain glucose need in early fasting',
          value: '≈ 100 g/d, of which glycerol can supply only ≈ 15–20 g/d',
          note: 'The gap is why protein breakdown and urinary nitrogen peak on days 1–4.',
        },
        {
          label: 'Survival with the switch',
          value: 'A 70 kg man can survive 2–3 months rather than weeks',
          referenceIds: ['cahill2003'],
        },
        {
          label: 'Display estimate of brain ketone share (proposed)',
          value: '13 % at 1 mM, 40 % at 3 mM, 62 % at 6.7 mM',
        },
      ],
      grade: 'C',
      gradeReason:
        'The switch itself is documented in a few small catheter studies; the percentage curve is a proposed display estimate.',
      status: 'proposed-fit',
      caveats: "The display curve is graded C/D in Vitals' evidence review and is only for display.",
      referenceIds: ['owen1967', 'owen1969', 'hasselbalch1995', 'cahill2003'],
      relatedMetricIds: [],
    },
    {
      id: '20-protein-loss-in-a-fast',
      title: 'How much protein a fast costs',
      category: 'body',
      summary:
        'With no protein eaten, the body takes the amino acids it needs to make glucose and repair tissue from its own protein. Loss is highest on days 2–4, at about 14–15 g of nitrogen a day in normal-weight men (nitrogen is how protein loss is measured; 1 g of nitrogen is 6.25 g of protein). It then falls slowly, towards a floor that depends on how much body fat a person has. Total loss in a week is about half a kilogram of protein.',
      howModelled:
        'Vitals starts from an early peak that scales with lean mass and is a little lower in people with more fat. It then blends towards a late floor set by body fat, as ketones rise and the body adapts. The blend takes about 8 days. Carbohydrate, exogenous ketones and exercise nudge the result. Protein burned is 6.25 times the nitrogen lost, and tissue lost is that protein plus its water. This replaces the fasting protein branches in the protein and fasting-timing topics, which under-predict water-only nitrogen loss in lean people by about 1.5–2.5 times.',
      equation:
        'N_early = n_pk × FFM, n_pk = 0.25 − 0.06 × clamp((FM − 10) / 40, 0, 1) g N per kg lean mass per day\nN_late = pr_late × TEE / 29.4, pr_late = 0.04 + 0.22 × exp(−body fat % / 15)\nS* = clamp((BHB − 0.5) / 3.5, 0, 1); dS/dt = (S* − S) / 8 d\nN(t) = [N_early × (1 − S) + N_late × S] × rise × C_carb × K_ketone × K_exercise; rise = 0.8 + 0.2 × min(1, t / 2.5)\nprotein oxidised (g/d) = 6.25 × N; hydrated tissue lost = 6.25 × N × (1 + 1.6) / 1000 kg per day',
      keyNumbers: [
        {
          label: '31-day fast, one lean man (60.6 kg): urinary nitrogen',
          value:
            'Day 1 7.1, day 2 8.4, day 3 11.3, day 4 11.9 g/d (maximum), days 5–14 ≈ 10.2, days 20–31 ≈ 7.7',
          referenceIds: ['benedict1915'],
        },
        {
          label: '7-day fast, 13 adults (79.6 kg, 23 % fat)',
          value: '≈ 15 g/d (day 1) → ≈ 10 g/d (day 7); cumulative 83.9 ± 6.7 g N (= 524 ± 42 g protein)',
          note: 'Nitrogen loss correlated with baseline lean mass (r = 0.85).',
          referenceIds: ['kolnes2025'],
        },
        {
          label: 'Total fasts, normal-weight and obese',
          value: '14.5 g N/d early in normal and obese men; 3.0 g N/d in obese women in week 4',
          note: 'Nitrogen rose from day 1 to day 3 and then fell steadily. Men lost more than women at equal weight.',
          referenceIds: ['goschke1975'],
        },
        {
          label: 'Peak nitrogen loss',
          value: '≈ 0.23–0.25 g N per kg lean mass per day (≈ 14–15 g N/d in normal-weight men)',
          referenceIds: ['goschke1975', 'kolnes2025'],
        },
        {
          label: 'Nitrogen lost per kg of weight lost (pooled fasts)',
          value: '≈ 20 g N/kg (non-obese) vs ≈ 10 g N/kg (fat mass ≥ 50 kg)',
          referenceIds: ['forbes1979'],
        },
        {
          label: 'Parameter n_pk (early peak)',
          value: '0.25 (lean) → 0.19 (fat mass ≥ 50 kg) g N/kg lean mass/d, ±0.03',
        },
        {
          label: 'Parameter pr_late (late protein share of energy)',
          value: '0.19 (8 % body fat), 0.13 (15 %), 0.08 (25 %), 0.05 (45 %), ±0.04',
        },
        {
          label: 'Time constant of adaptation',
          value: '8 d (6–14)',
          note: 'Fitted to a plateau to day 14 then a fall, 15 → 10 g/d over 7 days, and 14.5 → 3 g/d by week 4 in obese women.',
          referenceIds: ['benedict1915', 'kolnes2025', 'goschke1975'],
        },
        {
          label: 'Water carried with protein tissue',
          value: '1.6 g per g of protein (range 1.1–3.0)',
          note: 'A whole-tissue value of about 4 g/g is used in one study; 1.6 fits the post-refeeding scan data better.',
          referenceIds: ['hall2010', 'kolnes2025'],
        },
        {
          label: 'Model protein burned, lean man 75 kg (15 % fat), g/d (urinary N)',
          value:
            'Day 1 86 (13.8); day 3 96 (15.3); day 7 82 (13.1); day 14 66 (10.6); day 21 61 (9.7); 21-day total 1.57 kg',
          note: 'Model output. Lean woman 60 kg (25 %): 21-day total 0.97 kg; obese woman 100 kg (45 %): 1.01 kg; obese man 115 kg (35 %): 1.34 kg.',
        },
        {
          label: 'Model fit',
          value:
            'Kolnes-like cohort 90 g N in 7 d (observed 83.9 ± 6.7); 31-day lean man 289 g N (observed 277)',
          note: 'Lean man over 21 days: 23 g N per kg lost (pooled fasts: ≈ 20).',
        },
        {
          label: 'Earlier protein-timing model for fasting (protein topic)',
          value: '0.9 g protein/kg lean mass/d at onset, time constant 3 d',
          note: 'Under-predicts water-only nitrogen loss by ≈ 1.5–1.8× in week 1. Kept for protein-sparing modified fasts only.',
        },
        {
          label: 'Where the loss shows up in the body',
          value:
            'Calf muscle volume −5.4 % at 12 days; extremity lean mass −1.7 ± 0.5 kg (6 %) of a 4.6 kg DXA-lean loss at 7 days',
          referenceIds: ['naegel2025', 'kolnes2025'],
        },
        {
          label: 'Modified fast (10 days, 200–250 kcal, 16 men)',
          value: 'Total nitrogen −41 ± 7 % by day 5, then stable',
          note: 'Plasma 3-methylhistidine, a breakdown marker, rose to day 4–5 then returned to baseline.',
          referenceIds: ['laurens2021'],
        },
      ],
      timeCourse:
        'Nitrogen loss rises over days 1–3, peaks on days 2–4, and then falls with a time constant of about 8 days. In lean people it stays high for weeks; in people with obesity it falls to a low floor.',
      moderators:
        'Lean mass (the peak scales with it), body fat (sets the late floor), carbohydrate, exogenous ketones and exercise. Sex effects are explained by lean mass and body fat at equal weight, so there is no separate sex term.',
      grade: 'B',
      gradeReason:
        'The size of the loss and the lean-versus-obese contrast are well supported by several studies; the equation shape rests on one lean subject for the late phase and one 13-person cohort for the day-by-day pattern.',
      status: 'proposed-fit',
      caveats:
        'The functional form is graded C. Weeks 2–4 in lean people rest on one 1912 subject. The late-phase protein share (pr_late) is a fit across very different datasets. Pre-fast high-protein eating raises day-1 urinary nitrogen through urea-pool wash-out (17 g N/d in one subject), which is not tissue loss.',
      referenceIds: [
        'benedict1915',
        'kolnes2025',
        'goschke1975',
        'forbes1979',
        'hall2010',
        'naegel2025',
        'laurens2021',
      ],
      relatedMetricIds: ['fastProteinCost', 'nitrogenBalance', 'leanTissue'],
    },
    {
      id: '20-protein-sparing-by-adiposity',
      title: 'Protein sparing is weak in lean people and strong in people with obesity',
      category: 'body',
      summary:
        'Fat tissue is an energy store that lets the body lean on fat instead of protein. People with large fat stores cut their protein loss to a low floor, with protein supplying only about 5–7 % of energy. Lean people keep losing protein at about 15–20 % of energy for weeks. So the same fast costs a lean person proportionally more muscle and other lean tissue.',
      howModelled:
        "The late protein share of energy falls as body fat rises, and the early peak is a little lower in people with more fat. There is no separate switch for 'sparing'. The difference comes from the body-fat terms in the nitrogen model.",
      keyNumbers: [
        {
          label: 'Late protein share of energy, lean vs obese',
          value: '≈ 16–19 % in lean people; 5–7 % in obesity',
          referenceIds: ['benedict1915', 'goschke1975', 'owen1998', 'henry1988'],
        },
        {
          label: 'Obese adults, 21 days',
          value:
            'Aminogenic oxidation 7 % of energy; minimal 0.27 ± 0.08 g amino acid/kg body weight/d = 0.52 ± 0.10 g/kg lean mass/d',
          referenceIds: ['owen1998'],
        },
        {
          label: 'Lean man 60 kg, late fast',
          value: '≈ 7.7 g N/d',
          note: 'Obese women reach about 3 g N/d in week 4.',
          referenceIds: ['benedict1915', 'goschke1975'],
        },
        {
          label: 'Lean vs obese in prolonged starvation (review)',
          value:
            'Protein loss and % energy from protein 2–3× lower in obese; % urinary nitrogen as urea 2× lower; early hyperketonaemia 2× greater in lean',
          referenceIds: ['elia1999'],
        },
        {
          label: 'Protein share of energy over prolonged starvation in normal subjects',
          value: 'Unchanged (falling nitrogen follows falling metabolic rate, not specific sparing)',
          referenceIds: ['henry1988'],
        },
        {
          label: '72 h fast, 9 lean vs 9 obese',
          value:
            'Obese: higher lipolysis, lower urea production and lower forearm muscle protein breakdown, persisting at 72 h',
          note: 'Muscle-breakdown gene activity (MuRF1 mRNA) rose only in lean people.',
          referenceIds: ['bak2016'],
        },
        {
          label: 'Model protein share of energy on day 21',
          value: 'Lean man 16 %; lean woman 10 %; obese woman 7 %; obese man 8 %',
          note: 'Model output.',
        },
      ],
      timeCourse:
        'The contrast builds over weeks. By week 4 obese women lose about 3 g N/d, against about 7.7 g N/d in a lean man at 60 kg.',
      moderators: 'Body fat is the main moderator. Lean mass sets the size of the early peak.',
      grade: 'B',
      gradeReason:
        'Several independent studies and reviews agree on the lean-versus-obese contrast, although the underlying mechanism is debated.',
      status: 'established',
      caveats:
        'One reanalysis of classic fasts argues that lean people do not show specific protein sparing at all: their protein share stays constant and their nitrogen falls only as their metabolic rate falls. The model captures the size of the difference without taking a side on the cause.',
      referenceIds: ['benedict1915', 'goschke1975', 'owen1998', 'elia1999', 'henry1988', 'bak2016'],
      relatedMetricIds: ['fastProteinCost', 'leanTissue'],
    },
    {
      id: '20-protein-loss-modifiers',
      title: 'What raises or lowers protein loss in a fast',
      category: 'body',
      summary:
        "A few things change how much protein a fast costs. Even a little carbohydrate covers part of the brain's glucose need and lowers loss. Ketones held in the blood and the amino acid leucine reduced loss in infusion studies. Light activity seems neutral. Nobody has measured what resistance training does to protein or lean mass during a multi-day water fast.",
      howModelled:
        'Three multipliers scale the nitrogen model: one for carbohydrate (up to −45 % at 100 g a day), one for exogenous ketones (up to −30 % at 1.5 mM), and one for exercise (set to 1, with an allowed range of 0.9–1.0). Protein of 5 g a day or more takes a day out of the water-only branch altogether.',
      equation:
        'C_carb = 1 − 0.45 × clamp(carbohydrate g/d / 100, 0, 1)\nK_ketone = 1 − 0.3 × clamp(exogenous BHB / 1.5 mM, 0, 1)\nK_exercise = 1 (allowed range 0.9–1.0 for daily light activity)',
      keyNumbers: [
        {
          label: 'Carbohydrate, 600 kcal diets',
          value:
            '76–86 g/d vs 10 g/d of carbohydrate halved cumulative nitrogen loss (≈ 51 → 26 g N over 28 d)',
          referenceIds: ['vazquez1995'],
        },
        {
          label: 'Small carbohydrate doses',
          value: '7.5–15 g/d reduced urinary ammonium and ketoacid but not urea nitrogen',
          referenceIds: ['sapir1972'],
        },
        {
          label: 'Base model carbohydrate anchor',
          value: 'Coefficient 0.39 (nitrogen −4 g/d on carbohydrate removal)',
          referenceIds: ['hall2010'],
        },
        {
          label: 'Ketone infusion, people fasted 5–10 weeks',
          value: 'Urinary nitrogen lowered by 30 %',
          referenceIds: ['sherwin1981'],
        },
        {
          label: 'Leucine infusion',
          value: 'Negative nitrogen balance reduced by 25–30 % after 3 days and 4 weeks of fasting',
          referenceIds: ['sherwin1978'],
        },
        {
          label: 'Protein-supplemented very-low-energy diets',
          value:
            'Nitrogen deficit 60 % lower than total fasting; but 0.8 g/kg protein + 0.7 g/kg carbohydrate still gave −3.3 g N/d for 3 weeks',
          referenceIds: ['fisler1982', 'bistrian1981'],
        },
        {
          label: 'Exercise in modified fasts',
          value:
            'Strength kept and leg strength rose in a 10-day modified fast with 3 h/d walking; maximal voluntary contraction preserved in a 12-day modified fast',
          referenceIds: ['laurens2021', 'naegel2025'],
        },
        {
          label: 'Resistance training during a multi-day water fast',
          value: 'No human trial found measuring nitrogen or lean tissue',
          note: 'A search of Europe PMC on 2026-09-30 found none.',
        },
        {
          label: 'High-protein eating before the fast',
          value: 'Raises day-1 urinary nitrogen (17 g N/d after a beef diet) without tissue loss',
          referenceIds: ['benedict1915'],
        },
      ],
      moderators:
        'Prior very-low-carbohydrate eating starts the protein-sparing effect earlier in the model, through higher early ketones (no direct human test found, grade D). Age has no fasting-specific nitrogen data; older adults have less lean mass and slower regain.',
      grade: 'C',
      gradeReason:
        'The multipliers are fitted to a handful of older infusion and diet studies, several in people with obesity.',
      status: 'proposed-fit',
      caveats:
        'The classic statement that 100 g/d of glucose halves fasting nitrogen loss could not be confirmed against the original paper. Exogenous ketone esters and salts carry energy, so they technically end a zero-energy fast. Plasma 3-methylhistidine rose to day 4–5 in a modified fast; it is a display cue for an early catabolic phase, not a measure of muscle loss.',
      referenceIds: [
        'vazquez1995',
        'sapir1972',
        'hall2010',
        'sherwin1981',
        'sherwin1978',
        'fisler1982',
        'bistrian1981',
        'laurens2021',
        'naegel2025',
        'benedict1915',
      ],
      relatedMetricIds: ['fastProteinCost', 'nitrogenBalance'],
    },
    {
      id: '20-fasting-natriuresis-and-water',
      title: 'Sodium, water and gut contents in a fast, and the rebound after eating',
      category: 'body',
      summary:
        'Early in a fast the kidneys lose sodium, and water goes with it. Low insulin, and salts that pair with the ketone acids, drive this. Glycogen also releases its water and the gut empties. When carbohydrate returns, the kidneys hold on to sodium again and the water comes back within days, sometimes overshooting after long fasts.',
      howModelled:
        'One combined term tracks extracellular fluid, with a target of about −1.3 L for an average adult and a time constant of 1.5 days. A second term tracks the gut-content deficit. On refeeding with enough carbohydrate and sodium both return to zero, and after fasts longer than 3 days a short-lived water overshoot is added. Salt-free or low-carbohydrate refeeding slows the return and shrinks the overshoot. Only one such term runs at a time.',
      equation:
        'E* = −1.3 L × (ECF₀ / 17 L); dE/dt = (E* − E) / 1.5 d during the fast\ngut-content deficit → −0.45 kg × (BW₀ / 75)^0.5, time constant 1 d\nrefeeding (carbohydrate ≥ 100 g/d and sodium ≥ 1.5 g/d): E → 0 with a time constant of 0.7 d\novershoot after fasts > 3 d: E_oedema(t) = A × (1 − e^(−t / 2 d)) × e^(−t / 10 d), A = min(2.0 L, 0.08 L × (fast days − 3))\nsalt-free or < 50 g carbohydrate refeeding: return time × 3, overshoot × 0.3',
      keyNumbers: [
        {
          label: 'Early weight loss',
          value: '0.9 kg/d in week 1 → 0.3 kg/d by week 3, described as primarily negative sodium balance',
          referenceIds: ['kerndt1982'],
        },
        {
          label: 'Mechanism of natriuresis',
          value:
            'Urinary sodium, ammonium and potassium matched ketoacid anions and phosphate (r = 0.89); ammonium progressively replaces sodium; glucose refeeding promptly cut sodium loss',
          referenceIds: ['sigler1975'],
        },
        {
          label: 'Kidney ketone conservation',
          value:
            'BHB reabsorption 154 → 419–436 µmol/min from day 3 to days 10–24; conserves 450–500 mmol ketones/d',
          note: 'Preventing large cation losses.',
          referenceIds: ['sapir1975'],
        },
        {
          label: 'Urine and blood at day 8 (12 men, mineral water ad libitum)',
          value:
            'Urinary sodium 190 → 42.5 mmol/24 h; potassium 111 → 34 mmol/24 h; urine volume 2.35 → 1.38 L/d; serum sodium 139.3 → 133.8 mmol/L',
          referenceIds: ['oglodek2021'],
        },
        {
          label: 'Serum sodium in longer fasts',
          value: '−2.5 % by day 5; −4.5 % by day 21; below 137 mmol/L by day 9 (10-day cohort)',
          referenceIds: ['dai2024', 'dai2022'],
        },
        {
          label: 'Body water',
          value:
            'Total body water −2.86 kg (bioimpedance) at day 8; extracellular water −1.6 kg (including faeces emptied by enema) in a 10-day modified fast',
          referenceIds: ['oglodek2021', 'laurens2021'],
        },
        {
          label: 'Refeeding after a 24 h fast',
          value: '≈ +70 mEq sodium retained per day ≈ +0.5 L/d',
          referenceIds: ['heyman2020'],
        },
        {
          label: 'Weight rebound after 7 days, 3 days ad libitum',
          value: '+2.6 kg',
          referenceIds: ['pietzner2024'],
        },
        {
          label: 'Weight rebound after 10 days',
          value: '+3.8 kg in ≈ 8 days (4 days stepped + 4 days full diet)',
          referenceIds: ['dai2022'],
        },
        {
          label: 'Weight rebound after 21 days',
          value: '+5.5 kg in 9 days (1.28 kg/d at the switch to full diet, then 0.6 kg/d)',
          referenceIds: ['dai2024'],
        },
        {
          label: 'Salt-free whole-plant refeeding',
          value: 'Only +1.3 kg over ≈ 6 days after 14 days; +0.5 kg over ≈ 5 days after ≈ 10 days',
          referenceIds: ['gabriel2025', 'commissati2025'],
        },
        {
          label: 'Model check of the rebound',
          value:
            '+3.0 kg after 7 d (observed +2.6 ± 0.6); +3.2 kg after 10 d (observed +3.8); +3.5 kg after 21 d (observed +5.5)',
          note: 'Model output, refeeding at pre-fast maintenance energy with about 50 % carbohydrate.',
        },
      ],
      timeCourse:
        'Sodium loss is largest on days 1–4 and then falls as the kidney conserves ketones and ammonium replaces sodium. On refeeding the fluid return takes about 0.7 days (time constant), with most of the rebound within 2–3 days.',
      moderators:
        'Refeeding carbohydrate and sodium (salt-free, low-glycaemic whole-plant refeeding gave a much smaller early rebound) and fast length.',
      grade: 'C',
      gradeReason:
        'The mechanism is well described, but the magnitudes are fitted to end-points from a few cohorts with different refeeding diets.',
      status: 'proposed-fit',
      caveats:
        'After fasts of two weeks or more, ad libitum refeeding regained about 2 kg more than the fluid and gut terms explain (+5.5 kg observed, +3.5 kg modelled). The likely reason is overeating plus larger swelling, so the engine takes refeeding intake from the appetite model. The −1.3 L figure is fitted to end-points, not to sodium-balance studies.',
      referenceIds: [
        'kerndt1982',
        'sigler1975',
        'sapir1975',
        'oglodek2021',
        'dai2024',
        'dai2022',
        'laurens2021',
        'heyman2020',
        'pietzner2024',
        'gabriel2025',
        'commissati2025',
      ],
      relatedMetricIds: ['ecfShift', 'gutContent', 'scaleWeight'],
    },
    {
      id: '20-dxa-lean-in-a-fast',
      title: 'What a body scan calls lean during a fast',
      category: 'body',
      summary:
        "A body scan (DXA) or bioimpedance device counts as lean everything that is not fat: protein tissue, glycogen and its water, extracellular fluid and gut contents. In a fast most of these shrink for reasons that reverse within days. So the scan's lean loss runs two to three times faster than actual protein tissue, and the fat figure can look wrong while hydration is abnormal.",
      howModelled:
        "Vitals tracks protein tissue and muscle separately from 'DXA-lean equivalent', which is the sum of protein tissue, glycogen with its water, extracellular fluid and gut contents. The engine outputs fat by energy closure and reports the scan-style figure only for display and for checking against published studies.",
      equation:
        'DXA-lean equivalent = Δprotein tissue + Δ(glycogen + its water) + Δextracellular fluid + Δgut contents (+ any refeeding oedema)',
      keyNumbers: [
        {
          label: '7 days: measured DXA-lean loss vs nitrogen',
          value: 'DXA-lean −4.6 ± 0.3 kg; urinary nitrogen ≡ 524 g protein ≈ 2.6 kg tissue at 20 % protein',
          referenceIds: ['kolnes2025'],
        },
        {
          label: '7 days: model accounting',
          value:
            'Protein tissue 1.36 kg + glycogen and water ≈ 1.1 kg + extracellular fluid and gut ≈ 1.7 kg → DXA-lean ≈ 4.2 kg (observed 4.6 ± 0.3)',
          note: 'With a whole-tissue ratio of about 5 g/g the model would over-predict at 5.4 kg.',
          referenceIds: ['kolnes2025'],
        },
        {
          label: 'Share of DXA-lean loss that is protein tissue at 7–10 days',
          value: '≈ 25–35 % (model); 42 % in one partition',
          referenceIds: ['laurens2021'],
        },
        {
          label: '10-day modified fast: lean soft tissue −3.53 kg',
          value:
            'Extracellular water 1.6 kg (44 %); glycogen and water 0.50 kg (14 %); active tissue 1.5 kg (42 %)',
          referenceIds: ['laurens2021'],
        },
        {
          label: 'Median 14-day fast (29 adults, BMI 31)',
          value: 'Fat-free mass −6.7 kg = 74.5 % of the loss; fat −2.0 kg (DXA)',
          referenceIds: ['gabriel2025'],
        },
        {
          label: "Where the review's 'two-thirds lean' comes from",
          value:
            'Two water-only studies: bioimpedance (6 kg lost, 2 kg fat, 4 kg lean) and DXA (7 kg, 3 kg, 4 kg)',
          note: 'Both were measured at the end of the fast, when lean includes glycogen, water and gut contents.',
          referenceIds: ['oglodek2021', 'dai2022', 'ezpeleta2024'],
        },
        {
          label: 'Fat that seems to keep falling on refeeding',
          value:
            'DXA fat −1.6 → −1.85 kg after 3 days of eating; −10.7 % (day 6) → −17.2 % five days after refeeding; −2.0 kg at the end of a 14-day fast then −1.3 kg during 6 days of refeeding',
          referenceIds: ['pietzner2024', 'dai2022', 'gabriel2025'],
        },
        {
          label: 'Calf muscle volume, 12-day modified fast',
          value: '−5.4 %, closely aligned with expected glycogen (1–2 %) and bound water (3–4 %) losses',
          referenceIds: ['naegel2025'],
        },
      ],
      grade: 'B',
      gradeReason:
        'Scan, nitrogen and refeeding data from several cohorts consistently show that the scan-lean compartment mostly refills within days.',
      status: 'established',
      caveats:
        'Validation against energy and nitrogen balance is advised where possible, because DXA misallocates fat and lean while hydration is abnormal.',
      referenceIds: [
        'kolnes2025',
        'laurens2021',
        'gabriel2025',
        'oglodek2021',
        'dai2022',
        'ezpeleta2024',
        'pietzner2024',
        'naegel2025',
      ],
      relatedMetricIds: ['leanMass', 'leanTissue'],
    },
    {
      id: '20-refeeding-rebound-and-kept-loss',
      title: 'What comes back after the fast, and what is kept',
      category: 'body',
      summary:
        'Most of the early scale loss comes back within 2–3 days of eating: glycogen, water, sodium and gut contents refill. Fat loss stays, and protein tissue does not rebuild within days. After a 7-day fast about 45 % of the loss returns in 3 days, and what is kept is roughly the fat lost plus the protein tissue not yet rebuilt.',
      howModelled:
        'After a fast, glycogen, fluid and gut contents refill on their own timescales (see the sodium and water article). Protein tissue rebuilds only through the normal protein-balance model, apart from a small labile pool that is repaid in days. Fat lost stays lost as long as refeeding is at maintenance energy. How much a person actually eats after a long fast is taken from the appetite model, not assumed.',
      keyNumbers: [
        {
          label: '7-day water fast, 12 people, 3 days ad libitum: end of fast',
          value: 'Weight −5.7 ± 0.8 kg; DXA-lean −3.6 ± 0.49 kg; fat −1.6 ± 1.3 kg',
          referenceIds: ['pietzner2024'],
        },
        {
          label: '… after 3 days of eating',
          value: 'Weight −3.1 ± 0.6 kg; DXA-lean −0.69 ± 0.49 kg; fat −1.85 ± 0.34 kg',
          note: 'The rebound is glycogen, water and sodium, not protein rebuilding.',
          referenceIds: ['pietzner2024'],
        },
        {
          label: 'Protein still missing after 3 days (7-day fast)',
          value: '≈ 0.4–0.55 kg protein (≈ 1.0–1.4 kg hydrated tissue)',
          note: 'From nitrogen-balance arithmetic.',
        },
        {
          label: 'Lean man, model: 24 h fast',
          value: 'Weight −1.6 kg at the end; −0.2 kg three days later (about the fat)',
          note: 'Model output.',
        },
        {
          label: 'Lean man, model: 7-day fast',
          value:
            'Weight −5.7 kg at the end; −2.6 kg at +3 d; −2.5 kg at +7 d; −2.6 kg at +14 d; DXA-lean −1.2 kg at +3 d',
          note: 'Model output; refeeding at pre-fast maintenance energy.',
        },
        {
          label: 'Lean man, model: 21-day fast',
          value: 'Weight −11.0 kg at the end; −7.0 kg at +3 d; −6.9 kg at +7 d; −7.1 kg at +14 d',
          note: 'Model output.',
        },
        {
          label: 'Fat retained after refeeding',
          value:
            '≈ 100 % of the fat oxidised if refeeding is not overeating; overeating by 10–20 % for a few days erodes ≈ 0.1–0.3 kg',
        },
        {
          label: 'Fat-free mass over a 14-day fast and 6-week follow-up (structured refeed)',
          value:
            'Fat-free mass −6.7 kg (fast end) → −4.2 kg (end of refeed) → −2.1 kg (6 weeks); fat −2.0 → −3.3 → −5.1 kg',
          referenceIds: ['gabriel2025'],
        },
        {
          label: 'Hyperphagia: 36 h fast in lean adults',
          value: 'About 17 % energy compensation the next day',
          referenceIds: ['johnstone2002'],
        },
        {
          label: 'Hyperphagia: 24 h at 25 % of energy needs',
          value: 'Next-day ad libitum intake 12.62 vs 11.91 MJ (+6 %)',
          referenceIds: ['clayton2020'],
        },
        {
          label: 'After a 21-day fast',
          value: 'Weight rose 1.28 kg/d at the switch to full diet and 0.6 kg/d thereafter',
          note: 'The authors advised strict control of refeeding.',
          referenceIds: ['dai2024'],
        },
      ],
      timeCourse:
        'Glycogen, fluid and gut contents return mostly within 2–3 days. Lean scan values recover in 3–6 days. True protein tissue recovers over weeks and needs both protein and energy.',
      moderators:
        'Refeeding composition and size (salt-free whole-plant refeeding gave a small early rebound), fast length, and appetite.',
      grade: 'C',
      gradeReason:
        'Rebound sizes vary widely between studies with different refeeding diets, from +0.5 kg to +5.5 kg, so the shape is reliable but not the exact number.',
      status: 'proposed-fit',
      caveats:
        'No study measured fat regain in the first weeks after a multi-day fast directly; fat mass kept falling on a structured refeed. Part of the recovery in fat-free mass after 14 days reflects a lower body weight. Refeeding glycogen overshoot of +10 % is used but unverified.',
      referenceIds: ['pietzner2024', 'gabriel2025', 'johnstone2002', 'clayton2020', 'dai2024'],
      relatedMetricIds: ['scaleWeight', 'waterWeight', 'leanMass'],
    },
    {
      id: '20-labile-protein-pool',
      title: 'The small protein debt that eating repays within days',
      category: 'body',
      summary:
        'Early in a fast the body loses some readily replaceable protein, from the internal organs and other quickly turned-over protein (the fast component seen in older nitrogen studies). A small pool of this labile protein is repaid within a couple of days of proper eating. That is why a short fast costs a little protein each time, not zero and not a lot. The size of this pool is a calibration, not a measurement.',
      howModelled:
        'The pool grows with protein lost during the fast, up to a cap of 0.75 g per kg of lean mass. It is repaid with a time constant of about two days, but only when energy is at least 90 % of maintenance and protein at least 1.0 g/kg/day. Protein used for repayment is not counted again by the muscle model. What is not repaid is repaired only through the normal protein-balance dynamics.',
      equation:
        'labile deficit D = min(protein lost during the fast, 0.75 g × lean mass in kg)\nrepayment per day = (D / 2 d) × e^(−t / 2 d), only if energy ≥ 90 % of maintenance and protein ≥ 1.0 g/kg/d',
      keyNumbers: [
        {
          label: 'Pool cap and repayment time',
          value: '0.75 g/kg lean mass (range 0.3–1.5); 2 d (1–4)',
          note: 'Grade D calibration.',
        },
        {
          label: 'Cost of a 24–36 h fast',
          value: '≈ 35–45 g protein net each (≈ 0.1 kg hydrated tissue)',
          note: 'Reproduces the ≈ 0.7 kg extra non-fat loss of alternate-day fasting with compensation over about 10 fasts.',
          referenceIds: ['templeman2021'],
        },
        {
          label: 'Model check after 7 days of fasting and 3 days of eating',
          value: 'DXA-lean −1.0 kg (observed −0.69 ± 0.49)',
          referenceIds: ['pietzner2024'],
        },
        {
          label: 'Body nitrogen loss on fasting',
          value: 'Falls in two parts; the fast component has a half-life of a few days',
          referenceIds: ['forbes1979'],
        },
        {
          label: 'Water carried with protein tissue: why 1.6 g/g',
          value:
            'With 3–4 g/g the model gives −2 kg DXA-lean at +3 d (too negative); with ≈ 5 g/g it over-predicts DXA-lean loss at the end of a 7-day fast (5.4 vs 4.6 kg)',
          referenceIds: ['pietzner2024', 'kolnes2025'],
        },
        {
          label: 'Protein-sparing adaptation on refeeding',
          value: 'Decays with a time constant of 3 d (carbohydrate ≥ 50 g/d) or 7 d (< 50 g/d)',
          note: 'Proposed; ranges 2–5 d and 4–14 d.',
        },
      ],
      grade: 'D',
      gradeReason:
        'The pool is calibrated to two studies; no direct nitrogen-balance study of refeeding after short fasts was found.',
      status: 'proposed-fit',
      caveats:
        'Both the pool cap and the repayment time are calibrations to Templeman and Pietzner, not measured quantities.',
      referenceIds: ['forbes1979', 'templeman2021', 'pietzner2024', 'kolnes2025'],
      relatedMetricIds: ['leanTissue', 'fastProteinCost'],
    },
    {
      id: '20-refeeding-protocols-and-risk',
      title: 'How refeeding was done in the studies, and the refeeding-syndrome limits',
      category: 'recovery',
      summary:
        "Eating again after a long fast has a medical risk called refeeding syndrome, where phosphate, potassium and magnesium in the blood fall quickly (by 10–30 % or more within 5 days). The protocols used in studies step intake up slowly. Clinical guidance for people who have had little or no intake for more than 5 days sets limits on the first days' energy.",
      howModelled:
        "Vitals' safety rules own the ramp and the checks. This article records the protocols that produced the evidence, and the clinical criteria those rules use. Two rules are proposed for those safety rules: after a fast of 3–7 days the refeeding ramp lasts at least the longer of 4 days or half the fast, and a fast of 48 hours or more followed by a day at 120 % of maintenance or more triggers a caution.",
      keyNumbers: [
        {
          label: 'Buchinger protocol (4–21 day modified fasts)',
          value: 'Stepwise over ≈ 4 days, ovo-lacto-vegetarian, 800 → 1,600 kcal/d',
          referenceIds: ['laurens2021', 'wilhelmi2019', 'grundler2024'],
        },
        {
          label: 'Supervised water-only fasting (2–41 days)',
          value:
            'Refeeding for at least half the length of the fast, in 5 phases, with clinician checks twice daily',
          note: 'From juices and broths to whole plant foods without added salt, oil or sugar.',
          referenceIds: ['finnell2018', 'gabriel2025'],
        },
        {
          label: 'Norwegian 7-day cohorts',
          value: 'Glucose test at the end, then ad libitum eating for 3 days',
          referenceIds: ['pietzner2024', 'kolnes2025'],
        },
        {
          label: 'Chinese 10-day and 21-day cohorts',
          value: '4–5 days of graded calorie-restricted refeeding, then 5 days of a normal diet',
          referenceIds: ['dai2022', 'dai2024'],
        },
        {
          label: 'Clinical guidance (NICE / ASPEN), little or no intake for more than 5 days',
          value: '≤ 50 % of requirements for the first 2 days',
        },
        {
          label: 'Clinical guidance, high risk',
          value:
            '≤ 10 kcal/kg/d (≤ 5 if BMI < 14 or negligible intake for more than 15 days); thiamine 200–300 mg/d plus B-complex and multivitamin for 10 days',
        },
        {
          label: 'Definition of refeeding syndrome',
          value: '10–30 % or larger falls in phosphate, potassium or magnesium within 5 days',
        },
        {
          label: 'Potassium and liver enzymes on refeeding after 21 days',
          value:
            'Potassium fell to 3.5 mmol/L on refeeding day 4; 3 of 13 had raised ALT, AST or GGT on full-refeed day 5',
          referenceIds: ['dai2024'],
        },
        {
          label: 'Thiamine',
          value: 'Acute Wernicke encephalopathy was reported during prolonged therapeutic starvation',
          referenceIds: ['drenick1966'],
        },
      ],
      grade: 'B',
      gradeReason:
        'The protocols and the refeeding-syndrome criteria come from clinical guidance and controlled cohorts; the ramp parameters themselves are the safety rules of Vitals.',
      status: 'established',
      caveats:
        "The refeeding energy ramps and the first-day energy limit are decided by Vitals' safety rules (see the safety-limits topic), not by this topic.",
      referenceIds: [
        'laurens2021',
        'wilhelmi2019',
        'grundler2024',
        'finnell2018',
        'gabriel2025',
        'pietzner2024',
        'kolnes2025',
        'dai2022',
        'dai2024',
        'drenick1966',
      ],
      relatedMetricIds: [],
    },
    {
      id: '20-regain-after-a-fast',
      title: 'After the fast, intake decides the outcome',
      category: 'body',
      summary:
        'Once the temporary changes of fasting have relaxed, what happens next is set by what a person eats, not by the fast itself. Long-term follow-up of people who lost weight by prolonged fasting shows regain over the following years, with no protection from the length of the fast. The benefits in blood pressure, lipids and glucose seen after multi-day fasts were gone 3–4 months later, even when weight was held.',
      howModelled:
        'The model has no lasting fasting-specific metabolic effect once the adaptation has relaxed (about four days for energy use). The trajectory after a fast is simply the energy balance from later intake and the appetite model.',
      keyNumbers: [
        {
          label: '7.3-year follow-up, 121 morbidly obese patients after fasting for 1–2 or more months',
          value:
            'Loss held for 12–18 months, then regain regardless of fast length; half back to original weight within 2–3 years; only 7 stayed reduced',
          referenceIds: ['johnson1977'],
        },
        {
          label: '10-day modified fast, 3 months later',
          value: 'Body mass and lean soft tissue still lower; fat mass no longer lower than baseline',
          referenceIds: ['laurens2021'],
        },
        {
          label: '14-day fast plus structured whole-plant refeed, 6 weeks later',
          value: 'Weight −7.2 kg; fat −5.1 kg (fat loss continued)',
          referenceIds: ['gabriel2025'],
        },
        {
          label: 'Prolonged-fasting trials (review, 5–20 days)',
          value:
            'Blood pressure, lipid and glucose benefits gone 3–4 months after, even with weight maintained',
          referenceIds: ['ezpeleta2024'],
        },
        {
          label: 'One 382-day supervised fast (27-year-old man, supplements)',
          value: 'Reported as maintaining a normal weight afterwards',
          note: 'The weights 207 → 82 kg quoted in secondary sources could not be confirmed against the original paper.',
          referenceIds: ['stewart1973'],
        },
      ],
      grade: 'B',
      gradeReason:
        'A long observational follow-up, a trial at 6 weeks and a review agree that later outcomes follow later intake.',
      status: 'established',
      caveats: 'The evidence for fast lengths beyond three weeks is a handful of observational series.',
      referenceIds: ['johnson1977', 'laurens2021', 'gabriel2025', 'ezpeleta2024', 'stewart1973'],
      relatedMetricIds: [],
    },
    {
      id: '20-insulin-and-glucose-tolerance',
      title: 'Insulin falls, and glucose tolerance worsens for a few days after',
      category: 'hormones',
      summary:
        'Most of the fall in insulin happens in the first day. By 72 hours it has roughly halved or more. After a fast, insulin works less well for a while, so a first meal can cause a bigger glucose and insulin swing than usual. This is sometimes called starvation diabetes and it clears within one to three days of carbohydrate.',
      howModelled:
        'Insulin and glucose are covered in the carbohydrate topic. This article gives the water-only reference values they are checked against. The temporary loss of insulin sensitivity on the first carbohydrate meals is applied by the fasting-timing model.',
      keyNumbers: [
        {
          label: 'Share of the 12 → 72 h insulin fall done within 24 h',
          value: '70 %',
          referenceIds: ['klein1993'],
        },
        {
          label: 'Insulin at 72 h',
          value: '64.6 → 30.1 pmol/L (−50 %); more than −70 % in another study',
          referenceIds: ['klein1993', 'chan2003'],
        },
        {
          label: 'Insulin, 10-day fast',
          value: 'Nadir 18.6 pmol/L on day 3, then flat',
          referenceIds: ['dai2022'],
        },
        {
          label: 'Insulin, 10-day modified fast',
          value: '−59 %',
          referenceIds: ['laurens2021'],
        },
        {
          label: 'Glucagon',
          value: 'Peaks on days 1–3, coinciding with the nitrogen peak',
          note: 'The magnitude could not be confirmed against the original paper.',
          referenceIds: ['goschke1975'],
        },
        {
          label: 'Insulin sensitivity after a 24 h fast',
          value: 'Transiently lower on the clamp',
          referenceIds: ['hutchison2019'],
        },
        {
          label: 'After 48 h',
          value: 'Insulin-driven glucose disposal 39.8 → 24.1 µmol/kg/min; glucose oxidation −82 %',
          referenceIds: ['mansell1990a'],
        },
        {
          label: 'After 72 h',
          value: 'Larger glucose and insulin excursions after a mixed meal',
          referenceIds: ['horton2001'],
        },
        {
          label: 'After a 7-day fast',
          value: 'Delayed insulin secretion and post-load hyperglycaemia on a glucose tolerance test',
          referenceIds: ['uluvar2026'],
        },
      ],
      timeCourse:
        'Insulin drops in the first day and stays low. Glucose tolerance recovers within about 1–3 days of carbohydrate, though for fasts longer than 3 days this is unverified.',
      grade: 'B',
      gradeReason:
        'Tracer, clamp and meal-test studies agree, although each is small and only the 7-day result comes from an abstract.',
      status: 'established',
      caveats:
        'The recovery time for fasts longer than 3 days is unverified. The 7-day tolerance result is known from an abstract only.',
      referenceIds: [
        'klein1993',
        'chan2003',
        'dai2022',
        'laurens2021',
        'goschke1975',
        'hutchison2019',
        'mansell1990a',
        'horton2001',
        'uluvar2026',
      ],
      relatedMetricIds: [],
    },
    {
      id: '20-growth-hormone-and-igf1',
      title: 'Growth hormone rises while IGF-1 falls',
      category: 'hormones',
      summary:
        'Growth hormone output roughly triples to quintuples during a fast. Yet IGF-1, the hormone that growth hormone normally raises and that promotes tissue building, falls by half or more. So the growth-hormone rise does not protect muscle. In people with obesity IGF-1 did not fall by 72 hours in one study.',
      howModelled:
        'Vitals takes IGF-1 from the autophagy and nutrient-sensing model. This article supplies water-only checks and one addition: IGF-1 needs an obesity modifier, because it did not fall by 72 hours in obese men.',
      keyNumbers: [
        {
          label: 'Growth hormone, day 2',
          value: '24 h production ×5 (78 → 371 in the source units, µg/Lv)',
          referenceIds: ['hartman1992'],
        },
        {
          label: 'Growth hormone, day 5',
          value: 'Integrated output ×3.1; pulses 5.8 → 9.9 per 24 h',
          referenceIds: ['ho1988'],
        },
        {
          label: 'IGF-1 at 56 h',
          value: 'Unchanged',
          referenceIds: ['hartman1992'],
        },
        {
          label: 'IGF-1 at 72 h',
          value: 'Total −50 %, free −75 %',
          referenceIds: ['chan2003'],
        },
        {
          label: 'IGF-1, day 1 → day 5',
          value: '1.31 → 0.77 U/mL',
          referenceIds: ['ho1988'],
        },
        {
          label: 'IGF-1, 7-day water fast (10 non-obese)',
          value: '246 → 87 µg/L (−65 %)',
          referenceIds: ['savendahl1999'],
        },
        {
          label: 'IGF-1 at 72 h, lean vs obese men',
          value: 'Change −66 µg/L in lean vs +27 µg/L in obese',
          note: 'The rise in growth hormone was blunted in absolute terms in obesity.',
          referenceIds: ['hogild2019'],
        },
        {
          label: 'Fasting-mimicking diet, 5 days a month × 3',
          value: 'IGF-1 ≈ −13 % measured 5–7 days after cycle 3',
          referenceIds: ['wei2017'],
        },
      ],
      timeCourse:
        'IGF-1 starts to fall after about 30 hours; recovery on refeeding is about four times slower than the fall, with a time constant of about 7 days (from the autophagy topic).',
      grade: 'B',
      gradeReason:
        'Several small human studies agree on the direction and rough size; the obesity difference comes from a single study.',
      status: 'established',
      caveats:
        'The obesity modifier is not yet part of the IGF-1 model described in the autophagy topic, so that model does not yet account for it.',
      referenceIds: ['hartman1992', 'ho1988', 'chan2003', 'savendahl1999', 'hogild2019', 'wei2017'],
      relatedMetricIds: [],
    },
    {
      id: '20-leptin-thyroid-cortisol-testosterone',
      title: 'Leptin, thyroid hormone, cortisol and testosterone in a fast',
      category: 'hormones',
      summary:
        'By 72 hours of fasting leptin, the fat-tissue hormone that signals energy stores, has fallen to about a tenth. Thyroid hormone (T3) falls by about a third. Testosterone falls by about 40 % in men, and cortisol rises. In one study, giving back leptin prevented the testosterone fall, which suggests leptin drives it.',
      howModelled:
        'These hormones are covered in the hormones and appetite topic. This article provides water-only values by day for checking, plus the adaptive-energy link: the thyroid fall feeds the fasting energy-expenditure curve.',
      keyNumbers: [
        {
          label: 'Leptin at 52 h',
          value: '−64 % (normal weight) and −72 % (obese)',
          referenceIds: ['boden1996'],
        },
        {
          label: 'Leptin at 72 h',
          value: 'To about 10 % of baseline',
          referenceIds: ['chan2003'],
        },
        {
          label: 'Leptin after a 10-day modified fast',
          value: 'Still low 3 months later',
          referenceIds: ['laurens2021'],
        },
        {
          label: 'T3 at 72 h',
          value: '−30 %; lower at 3 days in another study',
          referenceIds: ['chan2003', 'nair1987'],
        },
        {
          label: 'T3 and reverse T3, 7–18 days',
          value: 'T3 −53 %, reverse T3 +58 %',
          referenceIds: ['spaulding1976'],
        },
        {
          label: 'Cortisol (24 h mean), 72 h',
          value: '4.84 → 7.84 µg/dL',
          referenceIds: ['chan2003'],
        },
        {
          label: 'Cortisol at 3.5 days, young and older men',
          value: '7.2 → 11.6 (young) and 7.7 → 12.6 µg/dL (older)',
          referenceIds: ['bergendahl2000'],
        },
        {
          label: 'Cortisol at 2.5 days, women in the luteal phase',
          value: '8.0 → 12.8 µg/dL',
          referenceIds: ['bergendahl2000a'],
        },
        {
          label: 'Testosterone (men) at 72 h',
          value: '−40 %, prevented by leptin replacement',
          referenceIds: ['chan2003'],
        },
        {
          label: 'Noradrenaline',
          value: 'Unchanged at 36 h; up at 72 h; ×2.2 by day 4',
          referenceIds: ['webber1994', 'zauner2000'],
        },
        {
          label: 'Women, 3-day luteal-phase fast',
          value: 'No change in LH or oestradiol',
          note: 'From the fasting and meal-timing topic.',
        },
      ],
      timeCourse:
        'Thyroid hormone is back to normal within about a week on a mixed diet. Leptin rises again with carbohydrate but can stay low for months after longer fasts.',
      moderators:
        'Age has little effect on the cortisol response in older men. Menstrual-cycle effects on fasting responses are sparsely studied.',
      grade: 'B',
      gradeReason:
        'Controlled experiments in small groups of healthy adults show consistent changes across several studies.',
      status: 'established',
      referenceIds: [
        'boden1996',
        'chan2003',
        'laurens2021',
        'nair1987',
        'spaulding1976',
        'bergendahl2000',
        'bergendahl2000a',
        'webber1994',
        'zauner2000',
      ],
      relatedMetricIds: [],
    },
    {
      id: '20-hunger-and-ghrelin-in-a-fast',
      title: 'Hunger in a fast: worst on day 1–2, then it fades',
      category: 'hormones',
      summary:
        'Hunger usually peaks late on day 1 and on day 2 and then fades over multi-day fasts. Ghrelin, the stomach hormone linked to hunger, keeps its usual meal-time peaks during a 24-hour fast and falls only slightly over 84 hours. With repeated one-day or alternate-day fasts, hunger on fast days does not get easier over three weeks.',
      howModelled:
        'Hunger is a separate output. In multi-day fasts the hunger offset peaks at about 30 hours and is close to zero by day 5. For alternate-day patterns no habituation is assumed.',
      keyNumbers: [
        {
          label: 'Ghrelin in a 24 h fast',
          value: 'Meal-time peaks persist',
          referenceIds: ['natalucci2005'],
        },
        {
          label: 'Ghrelin over 84 h',
          value: '24 h mean falls slightly',
          referenceIds: ['espelund2005'],
        },
        {
          label: 'Hunger in 1,422 modified fasters (4–21 days)',
          value: 'Absent in 93 %; hunger and other symptoms mainly in the first days',
          referenceIds: ['wilhelmi2019'],
        },
        {
          label: '10-day modified fast',
          value:
            'Hunger unchanged or transiently reduced; ghrelin back to baseline on refeeding; higher at 3 months',
          referenceIds: ['laurens2021'],
        },
        {
          label: 'Alternate-day fasting, 3 weeks',
          value: 'Hunger on fast days did not habituate',
          referenceIds: ['heilbronn2005'],
        },
        {
          label: 'Hunger peak in the model',
          value: 'Peak at about 30 h, near 0 by day 5',
          note: 'From the fasting and meal-timing topic; adopted unchanged.',
        },
      ],
      grade: 'C',
      gradeReason:
        'Small studies and one large observational series point the same way, but hunger is self-reported and the fasts differ.',
      status: 'established',
      referenceIds: ['natalucci2005', 'espelund2005', 'wilhelmi2019', 'laurens2021', 'heilbronn2005'],
      relatedMetricIds: [],
    },
    {
      id: '20-lipids-in-a-fast',
      title: 'LDL cholesterol rises during multi-day water fasts',
      category: 'cardio',
      summary:
        'Contrary to what many people expect, LDL cholesterol and apoB (the protein carried on LDL particles) rise during multi-day water-only fasts. The rise builds to about day 10, then eases, and levels fall back after refeeding. Triglycerides fall in fasts up to 3 days and rise in longer ones. HDL falls only in fasts longer than 3 days.',
      howModelled:
        "Vitals shows lipids as relative change from the person's baseline. The rules below are proposed hooks because no other part of the model owns lipids during a fast. LDL rises by up to 45 % over a few days, then partly eases from day 10. With 25 g of carbohydrate a day or more the effect is halved, as modified fasts show. HDL falls by up to 15 % between day 3 and day 10.",
      equation:
        'LDL(t) = 1 + 0.45 × (1 − e^(−t / 3 d)) × (1 − 0.4 × clamp((t − 10) / 10, 0, 1)); × 0.5 if carbohydrate ≥ 25 g/d\nHDL(t) = 1 − 0.15 × clamp((t − 3) / 7, 0, 1)',
      keyNumbers: [
        {
          label: '10-day water fast, 13 men',
          value: 'LDL +23 % (day 3), +45 % (day 6), +44 % (day 9); apoB +42 % (day 9); lipoprotein(a) ×2',
          referenceIds: ['dai2022'],
        },
        {
          label: '7-day water fast, 10 non-obese people',
          value: 'LDL +66 %; apoB +65 %; triglycerides and HDL unchanged',
          referenceIds: ['savendahl1999'],
        },
        {
          label: '≈ 10-day water fast, 20 people',
          value: 'LDL +21 % (not significant); non-HDL +25 %; HDL −16 %',
          referenceIds: ['commissati2025'],
        },
        {
          label: 'Meta-analysis by duration',
          value:
            'LDL effect size g = 0.49, rising to ≈ 10 days then attenuating; HDL falls only beyond 3 days; triglycerides fall up to 3 days and rise in longer fasts',
          referenceIds: ['camli2026'],
        },
        {
          label: 'Triglycerides, ≈ 10 days and after refeeding',
          value: '+22 % (not significant) at ≈ 10 days; +32 % after refeeding',
          referenceIds: ['commissati2025'],
        },
        {
          label: 'After a 5-day refeed',
          value: 'LDL back below baseline (96.7 vs 108 mg/dL)',
          referenceIds: ['commissati2025'],
        },
        {
          label: 'Modified (Buchinger-type) fasts',
          value: 'LDL falls, not rises',
          referenceIds: ['wilhelmi2019', 'grundler2024'],
        },
      ],
      timeCourse:
        'A rise within about 3 days, a peak near day 10, some easing after that, and a return below baseline within days of refeeding.',
      moderators:
        'Carbohydrate intake during the fast (modified fasts with carbohydrate lower LDL) and fast length.',
      grade: 'B',
      gradeReason:
        'A meta-analysis and several small studies agree on the rise, although the exact curve is our own proposed fit.',
      status: 'proposed-fit',
      caveats:
        'The equations are proposed hooks (grade C) where no other part of the model owns lipids during a fast. The results apply to water-only fasts; modified fasts with carbohydrate and activity show falls.',
      referenceIds: [
        'dai2022',
        'savendahl1999',
        'commissati2025',
        'camli2026',
        'wilhelmi2019',
        'grundler2024',
      ],
      relatedMetricIds: [],
    },
    {
      id: '20-uric-acid-in-a-fast',
      title: 'Uric acid roughly doubles in a fast',
      category: 'cardio',
      summary:
        'Uric acid in the blood roughly doubles within about a week of fasting and then plateaus. The reason is that the ketone acids compete with uric acid for removal in the kidney, so less is excreted. It drops back to baseline within about four days of eating.',
      howModelled:
        'Uric acid is shown as a multiple of baseline. It rises with a time constant of about 2.5 days to about 2.2 times baseline and falls back after refeeding with a time constant of about 1.5 days. The hook is proposed and used for display and for safety flags.',
      equation:
        'uric acid (× baseline) = 1 + 1.25 × (1 − e^(−t / 2.5 d)); refeeding: back to 1 with a time constant of 1.5 d',
      keyNumbers: [
        {
          label: '8-day water fast, 12 men',
          value: '0.38 → 0.85 mmol/L; plateau from day 7',
          referenceIds: ['oglodek2021'],
        },
        {
          label: '21-day water fast, 13 adults',
          value: '385 → 866–889 µmol/L (maximum 1188 µmol/L)',
          referenceIds: ['dai2024'],
        },
        {
          label: 'Kidney clearance of uric acid, day 8',
          value: '4.9 → 1.3 mL/min (−74 %)',
          note: 'Competition with ketoacids.',
          referenceIds: ['oglodek2021'],
        },
        {
          label: 'Buchinger modified fasts',
          value: 'Raised in all groups',
          referenceIds: ['wilhelmi2019'],
        },
        {
          label: 'Refeeding',
          value: 'Drops sharply; baseline in about 4 days',
          referenceIds: ['dai2024'],
        },
      ],
      timeCourse:
        'A doubling within about a week, then a plateau; back to baseline in about 4 days of eating.',
      grade: 'B',
      gradeReason:
        'Two separate water-fast cohorts and an observational series of modified fasts show the same rise and mechanism.',
      status: 'established',
      caveats: 'The exponential hook is proposed (grade C); the rise itself is well observed.',
      referenceIds: ['oglodek2021', 'dai2024', 'wilhelmi2019'],
      relatedMetricIds: ['uricAcid'],
    },
    {
      id: '20-blood-pressure-heart-rate-orthostasis',
      title: 'Blood pressure falls, heart rate rises and standing up gets harder',
      category: 'cardio',
      summary:
        'Blood pressure does not change in the first 72 hours, then falls in the second week, most in people who started with high pressure. Resting heart rate rises by about 6–7 beats a minute by day 2–3 and by about a third by day 8. Together with lower fluid volume, this is why light-headedness on standing (orthostatic symptoms) is common in longer fasts.',
      howModelled:
        'Heart rate and systolic blood pressure changes are shown as proposed hooks: heart rate rises by 7 beats/min over 2 days and by a further 20 beats/min between day 3 and day 8. Systolic pressure falls by about 8 mmHg plus 0.15 mmHg for each mmHg above 120, phased in between day 2 and day 8. Together with the fluid deficit and sodium intake these feed an orthostatic-risk index.',
      equation:
        'heart rate change = +7 bpm × clamp(t / 2, 0, 1) + 20 bpm × clamp((t − 3) / 5, 0, 1)\nsystolic BP change = −(8 + 0.15 × (SBP₀ − 120)) × clamp((t − 2) / 6, 0, 1) mmHg',
      keyNumbers: [
        {
          label: 'Blood pressure to 72 h',
          value: 'No change',
          referenceIds: ['webber1994'],
        },
        {
          label: '10-day fast',
          value: 'Systolic pressure −6.4 % at day 7',
          referenceIds: ['dai2022'],
        },
        {
          label: '21-day fast',
          value: 'Systolic 117 → 98 mmHg at day 8; lowest 86 mmHg on refeed day 3',
          referenceIds: ['dai2024'],
        },
        {
          label: 'People with high blood pressure',
          value: 'Large falls in supervised fasts',
          referenceIds: ['finnell2018', 'gabriel2025'],
        },
        {
          label: 'Return of blood pressure',
          value: 'Back by about day 3–5 of a full diet; gone by 3–4 months in follow-up',
          referenceIds: ['dai2022', 'ezpeleta2024'],
        },
        {
          label: 'Heart rate at 36–72 h',
          value: '+6–7 beats per minute',
          referenceIds: ['webber1994'],
        },
        {
          label: 'Heart rate by day 8',
          value: '+35–36 % (≈ 96 beats per minute); back by refeeding day 5',
          referenceIds: ['dai2022', 'dai2024'],
        },
        {
          label: 'Presyncope (near-fainting) in supervised water fasts',
          value: '28 % of visits',
          referenceIds: ['finnell2018'],
        },
      ],
      timeCourse:
        'No change to 72 hours; the pressure fall builds through days 2–8. Heart rate returns by refeeding day 5.',
      grade: 'C',
      gradeReason:
        'Two cohorts and a chart review support the direction and rough size, but the hooks are proposed and the orthostatic index is our own construction.',
      status: 'proposed-fit',
      referenceIds: ['webber1994', 'dai2022', 'dai2024', 'finnell2018', 'gabriel2025', 'ezpeleta2024'],
      relatedMetricIds: [],
    },
    {
      id: '20-inflammation-immune-liver-markers',
      title: 'Inflammation, blood-cell and liver markers in a fast',
      category: 'recovery',
      summary:
        'Prolonged fasting is often called anti-inflammatory. In one water-fast study a marker of inflammation, hsCRP, rose by 129 % and platelets and complement showed signs of activation, mostly reversing within 5 days of refeeding. In a 21-day fast white blood cells fell by about a quarter. Liver enzymes sometimes rise during or after the fast.',
      howModelled:
        'These markers are display-only. There is no infection-risk model. hsCRP is shown with a proposed hook that rises between day 3 and day 10 and relaxes on refeeding with a time constant of about 5 days.',
      equation: 'hsCRP (× baseline) = 1 + 1.3 × clamp((t − 3) / 7, 0, 1); refeeding time constant ≈ 5 d',
      keyNumbers: [
        {
          label: 'hsCRP, ≈ 10-day water fast',
          value: '+129 %',
          note: 'Platelet degranulation and complement rose; most protein changes reversed within 5 days of refeeding.',
          referenceIds: ['commissati2025'],
        },
        {
          label: 'hsCRP in 1,422 modified fasters',
          value: '2.8 → 4.3 mg/L',
          note: 'Measured in modified fasts of 4–21 days, not in water-only fasts.',
          referenceIds: ['commissati2025', 'wilhelmi2019'],
        },
        {
          label: '21-day fast, white blood cells',
          value:
            'WBC −24 %; neutrophils −36 % at day 15 and still low after refeeding; monocyte fraction +36 % at day 21',
          referenceIds: ['dai2024'],
        },
        {
          label: 'Liver enzymes',
          value:
            'ALT and AST rose in a 10-day modified fast and normalised; within the normal range in a 21-day water fast, but 3 of 13 had raised ALT, AST or GGT on full-refeed day 5',
          referenceIds: ['laurens2021', 'dai2024'],
        },
        {
          label: 'Liver fat, 48 h (men)',
          value: 'Liver triglyceride accumulates',
          referenceIds: ['browning2012'],
        },
      ],
      grade: 'C',
      gradeReason:
        'The inflammation result comes from a single 20-person study, and the immune data from one 13-person cohort.',
      status: 'contested',
      caveats:
        'Whether prolonged fasting reduces or raises inflammation is contested. The data here show a rise in hsCRP that mostly reversed on refeeding.',
      referenceIds: ['commissati2025', 'wilhelmi2019', 'dai2024', 'laurens2021', 'browning2012'],
      relatedMetricIds: [],
    },
    {
      id: '20-strength-and-endurance-in-a-fast',
      title: 'Strength holds up; high-intensity and long endurance work do not',
      category: 'performance',
      summary:
        'In fasts of up to 6 days maximal leg strength is unchanged. Peak oxygen uptake falls by about 13 % by day 6, and hard, long efforts are cut short from as early as 24 hours. Low-intensity endurance is unchanged up to 3.5 days.',
      howModelled:
        'Strength is allowed to fall by 0–10 % in fasts up to 7 days, with no credit for strength gains. Peak oxygen uptake falls by about 2 % a day from day 2 to a 13 % fall at day 6 in a water-only fast. High-intensity endurance falls by 30–60 % from 24 hours; low-intensity endurance is unchanged up to 3.5 days.',
      keyNumbers: [
        {
          label: '3.5-day fast',
          value: 'Isometric strength and anaerobic capacity unchanged; isokinetic elbow flexion −10 %',
          referenceIds: ['knapik1987'],
        },
        {
          label: '6-day fast',
          value: 'Leg isometric and isokinetic peak torque and power unchanged',
          referenceIds: ['kolnes2025'],
        },
        {
          label: 'Modified fasts with walking',
          value:
            '10 days: grip unchanged, leg strength up; 12 days: maximal voluntary contraction preserved in both sexes (half over 50)',
          referenceIds: ['laurens2021', 'naegel2025'],
        },
        {
          label: 'Peak oxygen uptake, 6 days',
          value: '−13 % absolute (3.77 → 3.27 L/min); −7 % per kg; peak power −16 %',
          note: 'Exercise RER 1.12 → 0.93; muscle PDK4 gene activity ×13. In a 12-day modified fast peak oxygen uptake was unchanged.',
          referenceIds: ['kolnes2025', 'naegel2025'],
        },
        {
          label: 'Cycling to exhaustion after a 24 h fast',
          value: 'Time to fatigue cut at 79–86 % of maximal oxygen uptake (e.g. 115 → 42 min at 86 %)',
          referenceIds: ['loy1986'],
        },
        {
          label: 'Low-intensity endurance, 3.5 days',
          value: 'Time to exhaustion at 45 % of maximal oxygen uptake unchanged',
          referenceIds: ['knapik1987', 'knapik1988'],
        },
        {
          label: 'Blood sugar and ketones during exercise, day 6',
          value: 'Glucose rose 3.8 → 5.6 mM at peak effort; BHB fell 4.0 → 2.9 mM',
          referenceIds: ['kolnes2025'],
        },
        {
          label: 'Training during a fast',
          value:
            'Strength sessions are possible; no measured protein sparing from exercise; no MPS credit for resistance training on zero-protein days',
          note: 'No trial shows a lean-mass benefit of resistance training during a multi-day water fast.',
        },
      ],
      grade: 'B',
      gradeReason:
        'Several controlled studies in healthy adults show the same pattern, although groups are small.',
      status: 'established',
      referenceIds: ['knapik1987', 'kolnes2025', 'laurens2021', 'naegel2025', 'loy1986', 'knapik1988'],
      relatedMetricIds: [],
    },
    {
      id: '20-cognition-and-mood-in-a-fast',
      title: 'Thinking and mood in a fast',
      category: 'recovery',
      summary:
        'The few studies that looked found no loss of mental sharpness in fasts of up to 21 days, and in some supervised fasts well-being improved. This rests on small samples and one very old single-subject study, so it is graded with caution.',
      howModelled: 'No cognitive decline is modelled up to 21 days and the mood term is set to zero.',
      keyNumbers: [
        {
          label: '31-day fast, one lean man',
          value: 'No loss of argumentative power or lucidity',
          referenceIds: ['benedict1915'],
        },
        {
          label: 'Modified fasts of 4–21 days, 1,422 people',
          value: 'Physical and emotional well-being improved',
          referenceIds: ['wilhelmi2019'],
        },
        {
          label: '8-day water fast',
          value: 'Perceived stress lower',
          referenceIds: ['oglodek2021'],
        },
        {
          label: '21-day water fast',
          value: 'Almost no complaints and negative emotions',
          referenceIds: ['dai2024'],
        },
      ],
      grade: 'C',
      gradeReason: 'The evidence is a mix of small cohorts, self-reports and an old single-subject study.',
      status: 'established',
      referenceIds: ['benedict1915', 'wilhelmi2019', 'oglodek2021', 'dai2024'],
      relatedMetricIds: [],
    },
    {
      id: '20-bone-in-a-fast',
      title: 'Bone in short fasts',
      category: 'recovery',
      summary:
        'Bone mass did not change in fasts of a week or two, and bone-turnover markers did not change in a 24-hour severe restriction. Calcium balance, though, is negative during fasting. Vitals models no bone change for fasts up to 21 days.',
      howModelled:
        'No bone-mass change is applied for fasts of 21 days or less. A concern about cumulative calcium balance is only flagged for repeated long fasts, and is graded D.',
      keyNumbers: [
        {
          label: '24 h at 25 % of energy needs',
          value:
            'Bone-turnover markers (CTX, P1NP) and parathyroid hormone unchanged at rest and on refeeding',
          referenceIds: ['clayton2020'],
        },
        {
          label: '7-day water fast',
          value: 'DXA bone mass unchanged (+0.008 ± 0.014 kg); also unchanged in a second 7-day cohort',
          referenceIds: ['pietzner2024', 'kolnes2025'],
        },
        {
          label: '14-day fast plus 6 weeks',
          value: 'Bone mineral content unchanged',
          referenceIds: ['gabriel2025'],
        },
        {
          label: 'Calcium balance over 40 days of fasting',
          value: 'Negative in all fasting groups: −5.8 to −9.2 g',
          referenceIds: ['fisler1984'],
        },
        {
          label: 'Parathyroid hormone at ≈ 10 days',
          value: 'Plasma level down ×2.1',
          referenceIds: ['commissati2025'],
        },
      ],
      grade: 'C',
      gradeReason:
        'Direct bone data cover only fasts of up to about two weeks, and long-fast calcium balance comes from older studies.',
      status: 'established',
      referenceIds: [
        'clayton2020',
        'pietzner2024',
        'kolnes2025',
        'gabriel2025',
        'fisler1984',
        'commissati2025',
      ],
      relatedMetricIds: [],
    },
    {
      id: '20-adverse-events-supervised-fasts',
      title: 'What went wrong in supervised water-only fasts, and how often',
      category: 'recovery',
      summary:
        'The largest safety dataset is a chart review of 768 supervised water-only fasting visits, with a median stay of 7 days. Most people (72 %) had only mild or moderate events. Events of grade 3 or higher, which are more severe than mild or moderate, reached a cumulative 20 % by day 5, 28 % by day 10 and 32 % by day 15. Serious adverse events were rare: 2 in 768 visits (0.26 %).',
      howModelled:
        'Vitals uses these figures to word its warnings and to set duration tiers, not to predict individual risk. The data come from a clinical population, so they should not be read as the risk for healthy volunteers. The safety rules and warning copy are set out in the safety-limits topic.',
      keyNumbers: [
        {
          label: 'Supervised water-only fasting: visits reviewed',
          value: '768 visits, median stay 7 days',
          note: 'A clinical population.',
          referenceIds: ['finnell2018'],
        },
        {
          label: 'Only grade ≤ 2 adverse events',
          value: '72 %',
          referenceIds: ['finnell2018'],
        },
        {
          label: 'Cumulative incidence of any grade ≥ 3 adverse event',
          value: '20 % by day 5; 28 % by day 10; 32 % by day 15',
          note: 'These are not serious adverse events. The largest category was hypertension in patients admitted for hypertension.',
          referenceIds: ['finnell2018'],
        },
        {
          label: 'Serious adverse events',
          value:
            '2 of 768 visits (0.26 %): dehydration on day 3 and hyponatraemia (low blood sodium) on day 9, in men aged 73 and 70',
          referenceIds: ['finnell2018'],
        },
        {
          label: 'Commonest symptoms (share of visits)',
          value:
            'Fatigue 48 %, insomnia 34 %, nausea 32 %, headache 30 %, presyncope 28 %, dyspepsia 26 %, back pain 26 %',
          referenceIds: ['finnell2018'],
        },
        {
          label: 'Modified fasts of 4–21 days (1,422 people)',
          value: 'Sleep disturbance 15 %; muscle cramp 0.35 %',
          referenceIds: ['wilhelmi2019'],
        },
        {
          label: 'Headaches, weakness, insomnia, dry mouth and orthostatic hypotension',
          value: 'Reported in a ≈ 10-day study; 6 of 20 switched to broth or juice',
          referenceIds: ['commissati2025'],
        },
      ],
      grade: 'B',
      gradeReason:
        'The figures come from one large chart review, supported by other supervised cohorts, but the population was clinical and self-selected.',
      status: 'established',
      caveats:
        "Correction recorded in the project's integration notes: the figure of about 20 % by day 5 refers to adverse events of grade 3 or higher, not to serious adverse events, which occurred in 0.26 % of visits (2 of 768). Safety wording must not describe the 20 % figure as serious events.",
      referenceIds: ['finnell2018', 'wilhelmi2019', 'commissati2025'],
      relatedMetricIds: [],
    },
    {
      id: '20-physiology-by-duration-tier',
      title: 'What the body looks like at each fasting length',
      category: 'recovery',
      summary:
        'Fasts of different lengths differ in kind, not just degree. Under 24 hours very little happens biochemically. From 2–3 days ketones, uric acid and hormone shifts are marked. Beyond a week, resting energy falls and protein loss becomes a real cost. Vitals groups lengths into five tiers, T1 to T5, whose rules are set in the safety-limits topic; this article records the physiology behind each.',
      howModelled:
        'The safety rules own the tier limits (about 24 hours allowed by default, longer fasts opt-in, expert mode for 3–7 days, and over 7 days simulated only, never prescribed by the Planner). This article gives the expected physiology and the specific risks for each tier, so warnings can be based on evidence.',
      keyNumbers: [
        {
          label: 'T1: up to 24 h',
          value: 'Scale −1.3 to −2.0 kg (≈ 10 % fat); BHB ≤ 0.5 mM; glucose ≥ 4.5 mM',
          note: 'Risks: low blood sugar with insulin or sulfonylureas; lower high-intensity performance.',
          referenceIds: ['loy1986'],
        },
        {
          label: 'T2: 24–48 h',
          value: 'BHB 1–2 mM; sodium loss begins; resting energy ≈ +4 %; nitrogen peak starts',
          note: 'Risks: light-headedness, headache, orthostasis; gout flares in people with gout; ketoacidosis with SGLT2 inhibitors.',
        },
        {
          label: 'T3: 48–72 h',
          value:
            'BHB 2–3 mM; glucose 3.6–4.1 mM; uric acid rising; IGF-1 −50 %; testosterone −40 % (men); leptin ≈ 10 %',
          note: 'Presyncope in 28 % of supervised visits; glucose below 3.9 mM for much of the day, usually with no symptoms; insulin resistance on first meals.',
          referenceIds: ['finnell2018', 'kolnes2026', 'horton2001', 'chan2003'],
        },
        {
          label: 'T4: 3–7 days',
          value:
            'BHB 3.5–4.5 mM; glucose nadir 3.3–3.5 mM (day 3–5); nitrogen 12–15 g/d (normal weight); uric acid ×2; LDL +45–66 %; heart rate +20–35 %; systolic −6 to −16 %; peak oxygen uptake −13 %',
          note: 'Risks: grade ≥ 3 adverse events 20 % by day 5 in a clinical population; hyponatraemia (serum sodium −5 mmol/L by day 8); gout and urate stones; arrhythmia risk with electrolyte shifts; refeeding syndrome if BMI < 18.5 and more than 5 days.',
          referenceIds: ['finnell2018', 'oglodek2021', 'dai2022', 'kolnes2025'],
        },
        {
          label: 'T5: more than 7 days',
          value:
            'BHB 4.5–6.6 mM; resting energy −10 to −30 %; 1–2 kg of protein lost by 3 weeks (lean); plasma sodium −4 to −6 %; heart rate up to ≈ 96 bpm; systolic ≈ 86–98 mmHg',
          note: 'Risks: grade ≥ 3 adverse events 28 % by day 10 and 32 % by day 15; hyponatraemia on day 9 in a 70-year-old man on distilled water; Wernicke encephalopathy in historical prolonged fasts; fat-depletion phase with rising nitrogen loss.',
          referenceIds: ['finnell2018', 'drenick1966', 'laurens2021', 'dai2024'],
        },
        {
          label: 'Expected warnings by tier (proposed)',
          value:
            'T2: sodium 1.5–2.5 g/d from day 2 (17) and light exercise only; T3: refeed day 1 ≈ 50 % of maintenance, expect +1–2 kg rebound; T4: expert mode, daily sodium-drift index, thiamine and multivitamin on refeed; T5: simulator only with a persistent danger banner',
        },
      ],
      grade: 'B',
      gradeReason:
        'Each tier row is drawn from supervised cohorts and controlled studies cited elsewhere in this topic.',
      status: 'established',
      caveats:
        'Tier boundaries and rules are set in the safety-limits topic. Numbers for T4 and T5 come from clinical populations and small cohorts.',
      referenceIds: [
        'finnell2018',
        'loy1986',
        'kolnes2026',
        'horton2001',
        'chan2003',
        'oglodek2021',
        'dai2022',
        'kolnes2025',
        'drenick1966',
        'laurens2021',
        'dai2024',
      ],
      relatedMetricIds: [],
    },
    {
      id: '20-fat-depletion-and-hard-stops',
      title: 'Where the fast stops being safe to simulate as normal',
      category: 'recovery',
      summary:
        'Once body fat approaches about 10 % of body weight, protein loss starts to rise again. This fat-depletion phase is a danger sign, not a normal phase of fasting. The thresholds below are proposals for the safety rules and are not established limits.',
      howModelled:
        'The simulator would stop a fast that predicts body fat below 8 % in men or 15 % in women, or BMI below 17.5. Extra rules apply to lean people, repeated fasts and older adults. All of these are proposals, provisional until a clinical review confirms them.',
      keyNumbers: [
        {
          label: 'Fat-depletion phase',
          value: 'Rising nitrogen loss when body fat approaches ≈ 10 % of body weight',
          referenceIds: ['laurens2021'],
        },
        {
          label: 'Death in starvation',
          value: 'Near a BMI of 12–13',
          referenceIds: ['speakman2013'],
        },
        {
          label: 'Hard stop (proposed)',
          value: 'Predicted body fat < 8 % (men) or < 15 % (women), or BMI < 17.5',
        },
        {
          label: 'Lean-user warning (proposed)',
          value: 'From 48 h for people below 12 % body fat (men) or 20 % (women)',
          note: 'Their protein share of energy stays at about 15–20 %.',
        },
        {
          label: 'Repeated fasts (proposed)',
          value:
            'Warn when the cumulative protein cost (model) exceeds 3 % of baseline body protein within 30 days',
        },
        {
          label: 'Older adults (proposed)',
          value: 'Age 65 and over: T1 only',
          note: 'Both serious adverse events in the largest supervised series were in men aged 70 or more.',
          referenceIds: ['finnell2018'],
        },
        {
          label: 'Thiamine',
          value: 'Wernicke encephalopathy occurred in prolonged therapeutic starvation',
          referenceIds: ['drenick1966'],
        },
      ],
      grade: 'D',
      gradeReason:
        'The thresholds are expert-judgement proposals resting on historical case series and a single supervised chart review.',
      status: 'proposed-fit',
      caveats: 'All numbers marked proposed are provisional and still to be confirmed by a clinical review.',
      referenceIds: ['laurens2021', 'speakman2013', 'finnell2018', 'drenick1966'],
      relatedMetricIds: [],
    },
    {
      id: '20-electrolytes-and-micronutrients',
      title: 'Sodium, potassium, magnesium and vitamins in a fast',
      category: 'recovery',
      summary:
        'Blood sodium drifts down by 4–6 mmol/L over 8–21 days of water-only fasting, and one 70-year-old man drinking distilled water developed dangerously low sodium on day 9. Sodium loss is greatest on days 1–4; after that the body conserves it. Calcium, magnesium and phosphate balances are negative during long fasts. Phosphate matters most when eating starts again.',
      howModelled:
        'A plasma-sodium drift index warns when the level may fall low. It drifts down at 0.7 mmol/L a day for days 1–10, less if sodium is supplemented (about 2 g/day removes the drift) and faster if more than 2.5 L of fluid a day is drunk, then at 0.15 mmol/L a day. It is a warning index only.',
      equation:
        'drift (mmol/L per day) = −0.7 × (1 − clamp(sodium supplement g/d / 2.0, 0, 1)) × (1.3 if fluid > 2.5 L/d, else 1) for days 1–10; then −0.15\nwarn below 133 mmol/L; hard warning below 130 mmol/L',
      keyNumbers: [
        {
          label: 'What fasters actually drank in the studies',
          value:
            'Distilled water only (≥ 1.2 L/d, no electrolytes); or mineral water with < 5 mg sodium per 2 L (derived); or juice, broth and honey in Buchinger',
          referenceIds: ['finnell2018', 'gabriel2025', 'dai2024', 'wilhelmi2019'],
        },
        {
          label: 'Serum sodium',
          value: '−5 mmol/L at day 8; −4.5 % at day 21',
          referenceIds: ['oglodek2021', 'dai2024'],
        },
        {
          label: 'Sodium loss',
          value:
            'Largest on days 1–4 (100–150 mEq/d ≈ 2.3–3.4 g per the safety-limits topic), then conserved: 42.5 mmol/d at day 8',
          referenceIds: ['oglodek2021', 'sigler1975'],
        },
        {
          label: 'Model default supply, sodium',
          value: '1.5–2.5 g/d from day 2 for fasts of 36 h or more; 2–3 g/d from 48 h',
          note: 'Never salt-loading. Plain water above 3 L/d without solute triggers a hyponatraemia warning.',
        },
        {
          label: 'Potassium',
          value:
            'Urinary 111 → 34 mmol/d by day 8; serum 3.89 → 4.18 mmol/L; falls late and to 3.5 mmol/L on refeed day 4',
          note: 'Potassium supplements during fasting increased urinary calcium and faecal magnesium losses.',
          referenceIds: ['oglodek2021', 'dai2024', 'fisler1984'],
        },
        {
          label: 'Magnesium',
          value:
            'Serum 0.85 → 0.80 mmol/L at day 8; balance −1.4 g over 40 days; low plasma magnesium from month 1 in a 382-day fast',
          referenceIds: ['oglodek2021', 'fisler1984', 'stewart1973'],
        },
        {
          label: 'Phosphate and calcium over 40 days',
          value: 'Phosphate balance −5.4 g; calcium −5.8 to −9.2 g',
          referenceIds: ['fisler1984'],
        },
        {
          label: 'Fat-soluble vitamins',
          value:
            'Vitamin A +87 %, E +18 %, D3 rising from day 3 (mobilised from fat tissue); water-soluble vitamins with no marked change over 10 days',
          referenceIds: ['dai2022'],
        },
        {
          label: 'Fluids',
          value:
            'Fluid ≥ 2 L/d is the default for uric acid; the simulator refuses fluid inputs below 1.0 L/d during fasts',
        },
      ],
      grade: 'C',
      gradeReason:
        'The losses are documented in small cohorts and old balance studies, and the supply defaults are proposals set out in the safety-limits topic.',
      status: 'proposed-fit',
      caveats:
        'The supplement effect in the drift index is unverified. Thresholds are set in the safety-limits topic and the fibre, hydration and micronutrients topic. Refeeding thiamine and phosphate handling is described in the refeeding article.',
      referenceIds: [
        'finnell2018',
        'gabriel2025',
        'dai2024',
        'wilhelmi2019',
        'oglodek2021',
        'sigler1975',
        'fisler1984',
        'stewart1973',
        'dai2022',
      ],
      relatedMetricIds: [],
    },
    {
      id: '20-caffeine-and-non-caloric-drinks',
      title: 'Black coffee, tea and sweeteners during a fast',
      category: 'fuel',
      summary:
        'Black coffee, plain tea and calorie-free sweeteners do not end a fast in the model. Caffeine raised blood ketones in a fed-state study. Sweeteners taken alone did not cause a glucose or insulin rise. Broth, juice and honey are not water-only.',
      howModelled:
        'Caffeine acts as a small, short modifier: blood ketones are multiplied by up to 1.2 for 4 hours after a dose of 5 mg/kg. The 2–5 kcal in a cup is ignored. Any sweetened drink with maltodextrin or dextrose counts as energy and carbohydrate.',
      equation: 'BHB × (1 + 0.2 × clamp(caffeine mg per kg / 5, 0, 1)) for 4 h',
      keyNumbers: [
        {
          label: 'Caffeine and plasma ketones (fed state)',
          value: '2.5 and 5 mg/kg raised plasma ketones +88 % and +116 % acutely and raised free fatty acids',
          referenceIds: ['vandenberghe2017'],
        },
        {
          label: 'Non-nutritive sweeteners (aspartame, stevia, monk fruit)',
          value:
            'No glucose or insulin excursion versus sucrose when taken alone; later compensation at meals',
          referenceIds: ['tey2017'],
        },
        {
          label: 'Tea in supervised protocols',
          value: 'Herbal and black tea allowed in Buchinger and other supervised protocols',
          referenceIds: ['laurens2021', 'wilhelmi2019'],
        },
        {
          label: 'Bone broth, juice, honey',
          value: 'Not water-only; carbohydrate modifiers apply, and protein of 5 g/d or more ends the branch',
        },
        {
          label: 'Ketone esters and salts',
          value: '≈ 4–6 kcal/g',
          note: 'They technically end a zero-energy fast.',
        },
      ],
      grade: 'C',
      gradeReason:
        'One acute fed-state study supports the caffeine effect, and the sweetener result is from a different setting.',
      status: 'proposed-fit',
      caveats:
        'The ketone multiplier is proposed and drawn from fed-state data; its size in a fast is unknown.',
      referenceIds: ['vandenberghe2017', 'tey2017', 'laurens2021', 'wilhelmi2019'],
      relatedMetricIds: ['hoursFasted'],
    },
    {
      id: '20-repeated-fasting-no-bonus',
      title: 'Repeated fasts: no fat-loss advantage at the same weekly energy',
      category: 'body',
      summary:
        'When the weekly energy deficit is the same, taking it as fasts does not burn more fat than spreading it across the week. In lean adults it costs more lean tissue. In people with obesity outcomes are about equal. Health-marker changes from multi-day fasts fade within 3–4 months. So Vitals treats fasting as one way of delivering a deficit and gives it no metabolic bonus.',
      howModelled:
        'Fast days simply contribute zero intake, no thermic effect of food and the small early energy bump. Fat loss then follows from the weekly energy balance. Nothing in the model rewards a fast for being a fast. The differences that remain are temporary: dips in IGF-1, ketone exposure, an autophagy signal and the scale-weight pattern.',
      keyNumbers: [
        {
          label:
            'Lean adults, 3 weeks: 24 h fasts on alternate days, 150 % on fed days (same net −25 % as 75 % daily)',
          value: 'Weight −1.60 vs −1.91 kg; fat −0.74 vs −1.75 kg',
          note: 'A third arm eating 200 % on fed days (no net deficit) lost −0.12 kg fat. No advantage in postprandial metabolism, gut hormones or fat-tissue genes.',
          referenceIds: ['templeman2021'],
        },
        {
          label:
            'Obesity, 8 weeks: zero-calorie alternate-day fasting vs −400 kcal/d restriction (n = 14 vs 12)',
          value: 'Weight −8.2 vs −7.1 kg; composition, lipids and insulin sensitivity not different',
          note: 'The fasting arm had a 376 kcal/d larger deficit. At 24 weeks regain was similar.',
          referenceIds: ['catenacci2016'],
        },
        {
          label: 'Obesity, 12 months: alternate-day fasting (25 %/125 %) vs restriction',
          value:
            'Weight −6.8 vs −6.8 % at 6 months; −6.0 vs −5.3 % at 12 months; dropout 38 vs 29 %; LDL +11.5 mg/dL at 12 months (fasting arm)',
          referenceIds: ['trepanowski2017'],
        },
        {
          label: 'Non-obese, 22 days: alternate-day 36 h fasts (n = 16)',
          value:
            'Weight −2.5 %, fat −4 %; resting energy unchanged; hunger did not habituate; fasting insulin −57 %',
          note: "Women's meal glucose response was slightly worse after 3 weeks.",
          referenceIds: ['heilbronn2005', 'heilbronn2005a'],
        },
        {
          label: 'Non-obese, 4 weeks: 36:12 alternate-day fasting',
          value:
            'Energy −37 %; trunk fat down; fat-to-lean ratio improved; T3 and LDL down; no adverse events over 6 months',
          referenceIds: ['stekovic2019'],
        },
        {
          label: 'Women with overweight, 8 weeks: 3 × 24 h fasts a week (n = 88)',
          value:
            'Fasting at 70 % lost more weight and fat than daily 70 %; fasting at 100 % (no deficit) raised fasting insulin',
          note: 'A 24 h fast transiently lowered insulin sensitivity.',
          referenceIds: ['hutchison2019'],
        },
        {
          label: 'Meta-analysis of 9 trials (n = 782): intermittent vs continuous dieting',
          value: 'Lean mass −0.86 kg (−1.62, −0.10) worse with intermittent; other outcomes not significant',
          referenceIds: ['roman2019'],
        },
        {
          label: 'Fasting-mimicking diet, 5 days a month × 3 (n = 100)',
          value: '−2.6 kg; trunk and total fat down; absolute lean mass down (p = 0.004)',
          referenceIds: ['wei2017'],
        },
        {
          label: 'Prolonged-fast reviews',
          value: 'Benefits gone 3–4 months later, even when weight was maintained',
          referenceIds: ['ezpeleta2024'],
        },
        {
          label: 'Monthly 48–72 h or quarterly 5–7 day water fasts',
          value: 'No randomised trial found',
          note: 'Europe PMC search, 2026-09-30.',
        },
      ],
      grade: 'B',
      gradeReason:
        'Several randomised trials and a meta-analysis agree on no fat-loss advantage at equal energy, though each trial is small and one favoured 24 h fasts in overweight women.',
      status: 'established',
      caveats:
        'The one trial that favoured fasting (in women with overweight) is plausibly explained by better adherence to the prescribed deficit. No randomised trial of a repeated multi-day water-fast protocol exists.',
      referenceIds: [
        'templeman2021',
        'catenacci2016',
        'trepanowski2017',
        'heilbronn2005',
        'heilbronn2005a',
        'stekovic2019',
        'hutchison2019',
        'roman2019',
        'wei2017',
        'ezpeleta2024',
      ],
      relatedMetricIds: [],
    },
    {
      id: '20-how-repeats-are-modelled',
      title: 'How Vitals carries the effects of one fast into the next',
      category: 'body',
      summary:
        'Several fasting adaptations fade only slowly, so a second fast starts from a different place than the first. Protein-sparing adaptation, thyroid changes and IGF-1 each relax with their own time constants. Shorter, more frequent fasts keep re-entering the high protein-loss phase; longer gaps let everything reset.',
      howModelled:
        'Five rules. First, energy: fast days contribute zero intake and the weekly balance decides fat loss. Second, protein: the protein-sparing state decays with a time constant of 3 days between fasts less than about a week apart, so each fast start re-enters the early high-loss phase, and only the small labile part is repaid. Third, water and glycogen: each fast produces a 1–3 kg scale dip and rebound, so weigh-ins depend on the weekday. Fourth, hormones: IGF-1 and T3 recover with their own time constants, so monthly fasts leave no lasting drop in resting energy. Fifth, appetite is outside physiology: alternate-day fasting has higher dropout and fast-day hunger that does not habituate.',
      keyNumbers: [
        {
          label: 'Protein cost per fast, monthly 72 h fast (lean man)',
          value: '≈ 270 g protein per fast with ≈ 50 g repaid',
          note: 'Model output.',
        },
        {
          label: 'Weekly 24 h fast × 12 weeks (lean man)',
          value:
            'Net protein ≈ 12 × 35–45 g; BHB stays below 0.5 mM so the protein-sparing state stays near 0',
          note: 'Model output.',
        },
        {
          label: 'Monthly 72 h fast × 6',
          value:
            'Fasting adaptation returns to below 0.05 before the next fast; IGF-1 recovers between fasts (97 % recovered after 25 days)',
          note: 'Model output; recovery time constant about 7 days (autophagy topic).',
        },
        {
          label: 'Energy fat per unit deficit',
          value: 'Lower, not higher, with alternate-day fasting in lean adults (fat −0.74 vs −1.75 kg)',
          referenceIds: ['templeman2021'],
        },
        {
          label: 'Test the model must pass (24 h fasts on alternate days, 150 % on fed days vs 75 % daily)',
          value:
            'Fat loss at least 0.5 kg lower and non-fat loss higher with fasting; the 200 % arm loses fat ≈ 0 ± 0.3 kg',
          note: 'Validation target V9.',
          referenceIds: ['templeman2021'],
        },
        {
          label: 'Alternate-day fasting adherence',
          value: 'Dropout 38 vs 29 %; fast-day hunger does not habituate',
          referenceIds: ['trepanowski2017', 'heilbronn2005'],
        },
        {
          label: 'Multi-day fasts and hunger',
          value: 'Hunger falls after day 2–3',
          referenceIds: ['wilhelmi2019', 'benedict1915'],
        },
      ],
      grade: 'C',
      gradeReason:
        'The rules follow from graded physiology but the carry-over parameters are proposed, and no trial tests repeated multi-day fasts.',
      status: 'proposed-fit',
      caveats:
        'The lean-cost per fast start rests on a grade-D labile-pool calibration. Weekly 36–48 h fasts leave only partial carry-over through the non-exercise term.',
      referenceIds: ['templeman2021', 'trepanowski2017', 'heilbronn2005', 'wilhelmi2019', 'benedict1915'],
      relatedMetricIds: ['fastProteinCost'],
    },
    {
      id: '20-repeat-fast-verdicts',
      title: 'How each repeated fasting pattern compares with a steady deficit',
      category: 'body',
      summary:
        'The comparison for every pattern is a steady deficit with the same weekly energy, the same weekly protein and the same training. None of the patterns shows a fat-loss or lean-retention advantage. The slightly worse lean-mass result in lean people shows up with the frequent patterns. Only transient markers, such as IGF-1 dips and ketone exposure, actually differ.',
      howModelled:
        'The Planner treats fasts as delivery patterns of a deficit. It offers a pattern when the user ranks a transient marker, schedule preference or adherence above lean mass, and it shows the lean cost. Muscle-gain goals are excluded from the frequent patterns. Tier rules come from the safety-limits topic.',
      keyNumbers: [
        {
          label: 'Weekly 24 h water fast',
          value:
            'Fat loss no different; small lean cost (≈ 35–45 g protein net per fast); resting energy unchanged; ketosis barely reached (0.3–0.5 mM)',
          note: 'Grade B for alternate-day data, C for weekly. Fast-day 24 h energy expenditure is 177 kcal lower.',
          referenceIds: ['templeman2021', 'hollstein2021', 'browning2012', 'deru2021'],
        },
        {
          label: 'Two 24 h fasts a week, not consecutive',
          value: 'Equal to slightly worse in lean adults; equal or better in women with overweight',
          note: 'Grade A/B. Dropout 38 vs 29 % in alternate-day fasting.',
          referenceIds: ['templeman2021', 'hutchison2019', 'roman2019', 'trepanowski2017'],
        },
        {
          label: 'Alternate-day 36 h fasts',
          value:
            'Equal or worse in lean adults; hunger stays high; LDL down over 4 weeks in non-obese people',
          note: 'Grade B.',
          referenceIds: ['templeman2021', 'heilbronn2005', 'stekovic2019'],
        },
        {
          label: 'Weekly 36–48 h fast',
          value:
            'No advantage over a steady deficit; the early nitrogen peak repeats; 1–2 kg scale swing weekly',
          note: 'Grade C (no randomised trial).',
        },
        {
          label: 'Monthly 72 h fast',
          value:
            'Fat ≈ 0.55 kg per fast (lean man); protein ≈ 270 g per fast; IGF-1 −50 % transiently; hunger falls after day 2',
          note: 'Grade C (physiology B, no trial of the protocol).',
          referenceIds: ['chan2003', 'wilhelmi2019'],
        },
        {
          label: 'Quarterly 5–7 day fast',
          value:
            'Fat ≈ 1.0–1.3 kg per fast; protein ≈ 0.45–0.63 kg per fast (≈ 1–1.6 kg hydrated); LDL +45–66 % during; IGF-1 −65 % at day 7',
          note: 'Simulated only in expert mode. Grade B for the physiology, D as a repeated protocol.',
          referenceIds: ['dai2022', 'savendahl1999'],
        },
        {
          label: '10–21 day supervised fast (annual)',
          value:
            'Resting energy −13 to −21 % during; protein loss 1–1.6 kg; blood-pressure falls in hypertensives gone by 3–4 months',
          note: 'Never prescribed; shown with a persistent banner.',
          referenceIds: ['ezpeleta2024'],
        },
        {
          label: 'Fasting-mimicking diet, 5 days a month × 3 (≈ 720–1,100 kcal/d, 9–11 % protein)',
          value:
            '−2.6 kg over 3 cycles; absolute lean mass down; IGF-1 ≈ −13 % after cycle 3; dropout 25 vs 10 %',
          note: 'Grade B/C.',
          referenceIds: ['wei2017'],
        },
      ],
      grade: 'C',
      gradeReason:
        'The verdicts blend randomised trials of alternate-day fasting with physiology; several of the patterns have never been tested as repeated protocols.',
      status: 'proposed-fit',
      caveats:
        'Verdicts for the planner are Vitals design choices layered on the evidence. Hutchison is the only trial favouring 24 h fasts and is plausibly explained by adherence.',
      referenceIds: [
        'templeman2021',
        'hollstein2021',
        'browning2012',
        'deru2021',
        'hutchison2019',
        'roman2019',
        'trepanowski2017',
        'heilbronn2005',
        'stekovic2019',
        'chan2003',
        'wilhelmi2019',
        'dai2022',
        'savendahl1999',
        'ezpeleta2024',
        'wei2017',
      ],
      relatedMetricIds: [],
    },
    {
      id: '20-adiposity-modifies-fasting',
      title: 'Body fat is the strongest moderator of how a fast goes',
      category: 'body',
      summary:
        'Lean and obese bodies fast differently. Lean people make about twice the ketones early on, lose protein at two to three times the share of their energy, show a bigger fall in resting energy and a bigger fall in glucose, and see IGF-1 drop. People with obesity reach a lower protein floor, start ketosis later, and may not see IGF-1 fall by 72 hours.',
      howModelled:
        "Body fat sets the protein peak, the protein floor, the size of the resting-energy adaptation, the ketone curve and the glucose offset. There is no separate 'obese' branch; the terms vary smoothly with body fat.",
      keyNumbers: [
        {
          label: 'Early ketones at 48 h, lean vs obese (capillary)',
          value: '3.7 vs 1.9 mM',
          referenceIds: ['neudorf2025', 'elia1999'],
        },
        {
          label: 'Protein loss share of energy in prolonged fasting',
          value: '2–3× lower in obesity',
          referenceIds: ['elia1999', 'forbes1979', 'henry1988'],
        },
        {
          label: 'Adaptive fall in resting energy (model)',
          value: '≈ −19 % lean vs ≈ −7 % obese',
          note: 'Proposed; no study compared lean and obese people in the same protocol.',
          referenceIds: ['benedict1915', 'dai2024', 'owen1998'],
        },
        {
          label: 'Glucose in 72 h fasts (obese)',
          value: 'Never below 55 mg/dL in 16 obese people',
          referenceIds: ['merimee1977'],
        },
        {
          label: 'IGF-1 at 72 h',
          value: 'Lean −66 µg/L vs obese +27 µg/L',
          referenceIds: ['hogild2019'],
        },
        {
          label: 'Muscle breakdown signalling at 72 h',
          value: 'MuRF1 gene activity rose only in lean people',
          referenceIds: ['bak2016'],
        },
      ],
      grade: 'B',
      gradeReason:
        'Several studies and reviews agree on the direction of these differences, though no single study compared the trajectories.',
      status: 'established',
      referenceIds: [
        'neudorf2025',
        'elia1999',
        'forbes1979',
        'henry1988',
        'benedict1915',
        'dai2024',
        'owen1998',
        'merimee1977',
        'hogild2019',
        'bak2016',
      ],
      relatedMetricIds: ['fastProteinCost', 'bhb'],
    },
    {
      id: '20-sex-age-training-diet-moderators',
      title: 'Sex, age, training and prior diet',
      category: 'body',
      summary:
        'Most apparent sex differences in fasting shrink once lean mass and body fat are accounted for. Older adults showed similar cortisol responses and preserved strength in short supervised fasts, but both serious adverse events in the largest series were in men aged 70 or more. Little is known about training status and menstrual-cycle phase.',
      howModelled:
        'Sex, age and training status have no separate terms in the fasting overlay. They act through body composition and through the safety limits. Prior low-carbohydrate eating acts through the glycogen and ketone states.',
      keyNumbers: [
        {
          label: 'Women and men: energy and nitrogen',
          value:
            'Explained by lean mass and body fat at equal weight; nitrogen loss correlates with baseline lean mass (r = 0.85)',
          referenceIds: ['kolnes2025', 'goschke1975'],
        },
        {
          label: 'Women: fat release',
          value:
            'Higher at rest with a blunted rise; similar glucose production; glucose −0.3 to −0.45 mM at 30–48 h',
          referenceIds: ['mittendorfer2001', 'browning2012', 'haymond1982'],
        },
        {
          label: 'Ketones by sex',
          value: 'Conflicting: higher in women at 30 h, lower at 48 h',
          referenceIds: ['haymond1982', 'browning2012'],
        },
        {
          label: 'Weight loss in a 10-day fast',
          value: '7.6 % (women) vs 7.8 % (men); women regained weight more slowly on refeeding',
          referenceIds: ['commissati2025', 'dai2024'],
        },
        {
          label: 'Older men',
          value: 'Cortisol response to a 3.5-day fast equal to young men',
          referenceIds: ['bergendahl2000'],
        },
        {
          label: 'Older adults, 12-day modified fast',
          value: 'Strength and peak oxygen uptake preserved with half the group over 50',
          referenceIds: ['naegel2025'],
        },
        {
          label: 'Age and adverse events',
          value: 'Both serious adverse events in 768 visits were in men aged 73 and 70',
          referenceIds: ['finnell2018'],
        },
        {
          label: 'Prior diet',
          value:
            'A low-carbohydrate meal before the fast advances ketosis by about 12 hours in older adults; keto-adapted people have a smaller day-1 water drop',
        },
        {
          label: 'Training status',
          value:
            'Trained and untrained muscle autophagy markers differ in 36 h fasts; peak oxygen uptake loss similar in moderately fit adults (47.9 mL/kg/min)',
          referenceIds: ['kolnes2025'],
        },
      ],
      grade: 'C',
      gradeReason:
        'Most of these moderators have only small or single studies, and the water-only data hardly include people over 65 or the menstrual cycle.',
      status: 'proposed-fit',
      caveats:
        'Menstrual-cycle phase and older adults (over 65) are nearly absent from water-only fasting data. No multi-day fast was powered for sex.',
      referenceIds: [
        'kolnes2025',
        'goschke1975',
        'mittendorfer2001',
        'browning2012',
        'haymond1982',
        'commissati2025',
        'dai2024',
        'bergendahl2000',
        'naegel2025',
        'finnell2018',
      ],
      relatedMetricIds: [],
    },
  ],
  myths: [
    {
      id: '20-myth-fasting-burns-muscle-not-fat',
      claim: 'Fasting burns muscle, not fat. About two-thirds of the weight lost in a fast is lean.',
      verdict: 'oversimplified',
      explanation:
        "At the end of a 7–14 day fast, body scans do show 60–75 % of the loss as lean. But that compartment is mostly glycogen, water, sodium-linked fluid and gut contents, which return within days. Fat is burned at about 150–240 g a day throughout, about three quarters of resting energy by 60 hours. Protein loss is real and larger than on a protein-fed diet, about 0.45–0.6 kg in 7 days in normal-weight adults, so 'mostly water' is also wrong for protein.",
      referenceIds: [
        'pietzner2024',
        'kolnes2025',
        'oglodek2021',
        'ezpeleta2024',
        'gabriel2025',
        'carlson1994',
        'benedict1915',
      ],
    },
    {
      id: '20-myth-lean-mass-comes-back',
      claim: 'The lean mass lost in a fast fully comes back once you eat again.',
      verdict: 'oversimplified',
      explanation:
        'Scan-measured lean mass does recover quickly: about 80 % within 3 days in one study. That recovery is glycogen, water and sodium refilling. Protein tissue does not rebuild within days, and in another study fat-free mass was still 2.1 kg below baseline 6 weeks after a 14-day fast (partly appropriate to the lower body weight).',
      referenceIds: ['pietzner2024', 'gabriel2025', 'dai2022'],
    },
    {
      id: '20-myth-fasting-boosts-metabolism',
      claim: 'Fasting boosts your metabolism.',
      verdict: 'oversimplified',
      explanation:
        'Resting energy use rises a little on days 2–3, by about 4 % on average, but studies range from −8 % to +14 %. By days 9–30 it is 7–31 % lower. Over a whole 24 h fast day, energy expenditure is about 180 kcal lower than on a fed day, because digesting food costs energy.',
      referenceIds: [
        'zauner2000',
        'webber1994',
        'mansell1990',
        'browning2012',
        'dai2022',
        'nair1987',
        'dai2024',
        'benedict1915',
        'hollstein2021',
      ],
    },
    {
      id: '20-myth-starvation-mode',
      claim: "After 3 days of fasting your body goes into 'starvation mode' and stops burning fat.",
      verdict: 'not-supported',
      explanation:
        'Fat burning stays close to constant for weeks. Resting energy falls gradually. Weight loss slows mainly because the early water and glycogen losses are over.',
      referenceIds: ['dai2024', 'kerndt1982', 'carlson1994'],
    },
    {
      id: '20-myth-gh-protects-muscle',
      claim: 'Fasting protects muscle through a surge in growth hormone.',
      verdict: 'not-supported',
      explanation:
        'Growth hormone production does rise 3–5 times. But IGF-1 falls by 50–75 %, testosterone falls by about 40 % in men, and nitrogen loss peaks over the same days.',
      referenceIds: ['ho1988', 'hartman1992', 'chan2003', 'savendahl1999'],
    },
    {
      id: '20-myth-protein-sparing-everyone',
      claim: 'After about 3 days everyone spares protein.',
      verdict: 'oversimplified',
      explanation:
        'Sparing is strong only with large fat stores. Lean people keep losing protein at about 15–20 % of energy for weeks.',
      referenceIds: ['benedict1915', 'goschke1975', 'elia1999', 'henry1988'],
    },
    {
      id: '20-myth-ketones-7-8-mm',
      claim: 'Blood ketones reach 7–8 mM in any long fast.',
      verdict: 'oversimplified',
      explanation:
        'Plateaus of 6–7 mM are reached after 2–3 weeks in obese subjects, and about 6 mM by day 21 in normal-weight adults. Modified fasts with 25–60 g of carbohydrate plateau at about 4 mM.',
      referenceIds: ['owen1971', 'dai2024', 'grundler2024'],
    },
    {
      id: '20-myth-weekly-24h-special',
      claim:
        'A weekly 24-hour fast has special fat-burning or metabolic benefits beyond the calorie deficit.',
      verdict: 'not-supported',
      explanation:
        'At equal energy, trials and a meta-analysis found no fat-loss advantage, and ketosis is barely reached by 24 hours (0.3–0.5 mM).',
      referenceIds: [
        'templeman2021',
        'catenacci2016',
        'trepanowski2017',
        'roman2019',
        'browning2012',
        'deru2021',
      ],
    },
    {
      id: '20-myth-fasting-anti-inflammatory',
      claim: 'Prolonged fasting is anti-inflammatory.',
      verdict: 'unproven',
      explanation:
        'In one water-fast study hsCRP rose by 129 % over about 10 days, with platelet activation and complement changes that mostly reversed after refeeding. The evidence is thin and the claim is contested.',
      referenceIds: ['commissati2025'],
    },
    {
      id: '20-myth-fasting-lowers-cholesterol',
      claim: 'Fasting lowers cholesterol.',
      verdict: 'oversimplified',
      explanation:
        'During multi-day water fasts LDL cholesterol and apoB rise by 23–66 %, and fall back on refeeding. Modified fasts with some carbohydrate and activity show falls.',
      referenceIds: [
        'savendahl1999',
        'dai2022',
        'camli2026',
        'commissati2025',
        'wilhelmi2019',
        'grundler2024',
      ],
    },
    {
      id: '20-myth-fat-loss-continues-after-fasting',
      claim: 'Fat loss continues after you stop fasting.',
      verdict: 'oversimplified',
      explanation:
        'Part of the apparent extra fat loss is a body-scan artefact of rehydration, plus structured low-energy refeeds. With maintenance intake, fat is roughly unchanged after refeeding in the model.',
      referenceIds: ['pietzner2024', 'dai2022', 'gabriel2025'],
    },
    {
      id: '20-myth-serious-events-20-percent',
      claim:
        'About one in five people has a serious adverse event within five days of a supervised water-only fast.',
      verdict: 'not-supported',
      explanation:
        'The 20 % figure (28 % by day 10, 32 % by day 15) is the cumulative incidence of adverse events of grade 3 or higher, in a clinical population. Serious adverse events were 2 of 768 visits (0.26 %).',
      referenceIds: ['finnell2018'],
    },
    {
      id: '20-myth-dry-fasting',
      claim: 'Dry fasting (no water either) is a stronger, faster version of fasting.',
      verdict: 'unproven',
      explanation:
        'Dry fasting adds water deprivation to energy deprivation, so body water falls faster and blood concentration of sodium rises. Kidney handling of uric acid and ketones is already impaired in water fasting (uric-acid clearance −74 % at day 8). There is no supervised human evidence for multi-day dry fasting, so Vitals does not model it, and the simulator refuses fluid inputs below 1.0 L/d during fasts.',
      referenceIds: ['oglodek2021'],
    },
  ],
  openQuestions: [
    'Day-by-day protein loss in lean people rests on one subject fasted in 1912 for weeks 2–4, plus two modern 7-day cohorts. The way the late protein share is calculated is a fit across very different datasets.',
    'The early rise in resting energy is contested (−8 to +14 % at days 2–3). Vitals uses a peak of +5 %. It matters little for weight, about 50–100 kcal a day for 3–4 days.',
    "How much the fall in resting energy depends on body fat is inferred from three datasets. No study compared lean and obese people's trajectories in the same protocol.",
    'The size and repayment time of the labile protein pool are grade-D calibrations to two studies. Direct nitrogen-balance studies of refeeding after short fasts were not found.',
    'The water carried with protein tissue (1.6 g/g in the model, against about 4 g/g for whole tissue) was chosen to match scans after refeeding. It fits the post-fast scan data better but is inconsistent with the 1915 water accounting unless extra labile water is assumed.',
    'The size of the sodium and water loss (about −1.3 L) and of the refeeding swelling are fitted to end-points, not to sodium-balance studies. Two key full texts (Veverbrants & Arky 1969, and Sigler 1975) were not accessed.',
    'No human study has measured lean-mass or nitrogen outcomes for resistance training during a multi-day water fast, so the model gives it no credit.',
    'Sex differences in ketosis and glucose during 24–72 hours conflict between studies. No multi-day fast was large enough to test sex differences.',
    'Menstrual-cycle phase and older adults (over 65) are nearly absent from water-only fasting data.',
    'Repeated monthly or quarterly multi-day water fasts have never been tested in a randomised trial. The verdicts rely on physiology plus trials of alternate-day fasting and fasting-mimicking diets.',
    'Overeating after fasts of two weeks or more (+5.5 kg in 9 days after 21 days) is not captured by the labile compartments. The appetite model has to supply refeeding intake.',
    'Body scans misallocate fat and lean while hydration is abnormal, so validation should prefer energy and nitrogen balance where available.',
    'Full texts of several classic studies (Owen 1967 and 1969, Cahill 1966, Drenick 1964, Yang & Van Itallie 1976 starvation arm, Stewart & Fleming 1973) were not accessible. Their numbers are used only as quoted in abstracts or in other topics.',
  ],
  references: [
    {
      id: 'hall2010',
      authors: 'Hall KD.',
      year: 2010,
      title: 'Predicting metabolic adaptation, body weight change, and energy intake in humans',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '19934407',
      doi: '10.1152/ajpendo.00559.2009',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2838532/',
    },
    {
      id: 'hall2011',
      authors: 'Hall KD, Sacks G, Chandramohan D, et al.',
      year: 2011,
      title: 'Quantification of the effect of energy imbalance on bodyweight',
      journal: 'Lancet',
      pmid: '21872751',
      doi: '10.1016/S0140-6736(11)60812-X',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21872751/',
    },
    {
      id: 'pietzner2024',
      authors: 'Pietzner M, Uluvar B, Kolnes KJ, et al.',
      year: 2024,
      title: 'Systemic proteome adaptions to 7-day complete caloric restriction in humans',
      journal: 'Nat Metab',
      pmid: '38429390',
      doi: '10.1038/s42255-024-01008-9',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7617311/',
    },
    {
      id: 'kolnes2025',
      authors: 'Kolnes KJ, Nilsen ETF, Brufladt S, et al.',
      year: 2025,
      title:
        "Effects of seven days' fasting on physical performance and metabolic adaptation during exercise in humans",
      journal: 'Nat Commun',
      pmid: '39747857',
      doi: '10.1038/s41467-024-55418-0',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11695724/',
    },
    {
      id: 'kolnes2026',
      authors: 'Kolnes KJ, Turner LV, Brufladt S, et al.',
      year: 2026,
      title:
        'Marked increases in continuous glucose monitor-detected hypoglycemia during a seven-day water-only fast in healthy men and women',
      journal: 'J Diabetes Sci Technol',
      pmid: '41724658',
      doi: '10.1177/19322968261421956',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12929083/',
    },
    {
      id: 'uluvar2026',
      authors: 'Uluvar B, Williamson A, Kolnes KJ, et al.',
      year: 2026,
      title: 'Tissue origins of the plasma proteomic response to glucose ingestion in humans',
      journal: 'Diabetologia',
      pmid: '42467085',
      doi: '10.1007/s00125-026-06800-8',
      url: 'https://pubmed.ncbi.nlm.nih.gov/42467085/',
      verification: 'abstract',
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
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8718030/',
    },
    {
      id: 'dai2022',
      authors: 'Dai Z, Zhang H, Wu F, et al.',
      year: 2022,
      title:
        'Effects of 10-day complete fasting on physiological homeostasis, nutrition and health markers in male adults',
      journal: 'Nutrients',
      pmid: '36145236',
      doi: '10.3390/nu14183860',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9503095/',
    },
    {
      id: 'dai2024',
      authors: 'Dai Z, Zhang H, Sui X, et al.',
      year: 2024,
      title:
        'Analysis of physiological and biochemical changes and metabolic shifts during 21-day fasting hypometabolism',
      journal: 'Sci Rep',
      pmid: '39557965',
      doi: '10.1038/s41598-024-80049-2',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11574170/',
    },
    {
      id: 'oglodek2021',
      authors: 'Ogłodek E, Pilis W.',
      year: 2021,
      title: 'Is water-only fasting safe?',
      journal: 'Glob Adv Health Med',
      pmid: '34414015',
      doi: '10.1177/21649561211031178',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8369953/',
    },
    {
      id: 'ezpeleta2024',
      authors: 'Ezpeleta M, Cienfuegos S, Lin S, Pavlou V, Gabel K, Varady KA.',
      year: 2024,
      title: 'Efficacy and safety of prolonged water fasting: a narrative review of human trials',
      journal: 'Nutr Rev',
      pmid: '37377031',
      doi: '10.1093/nutrit/nuad081',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11494232/',
    },
    {
      id: 'wilhelmi2019',
      authors: 'Wilhelmi de Toledo F, Grundler F, Bergouignan A, Drinda S, Michalsen A.',
      year: 2019,
      title:
        'Safety, health improvement and well-being during a 4 to 21-day fasting period in an observational study including 1422 subjects',
      journal: 'PLoS One',
      pmid: '30601864',
      doi: '10.1371/journal.pone.0209353',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6314618/',
    },
    {
      id: 'finnell2018',
      authors: 'Finnell JS, Saul BC, Goldhamer AC, Myers TR.',
      year: 2018,
      title:
        'Is fasting safe? A chart review of adverse events during medically supervised, water-only fasting',
      journal: 'BMC Complement Altern Med',
      pmid: '29458369',
      doi: '10.1186/s12906-018-2136-6',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5819235/',
    },
    {
      id: 'gabriel2025',
      authors: 'Gabriel S, Ncube M, Goldman DM, Scharf E, Goldhamer AC, Myers TR.',
      year: 2025,
      title:
        'Prolonged water-only fasting followed by a whole-plant-food diet promotes fat-free mass recovery and continued fat mass loss in adults with overweight or obesity',
      journal: 'Obes Sci Pract',
      pmid: '40765844',
      doi: '10.1002/osp4.70086',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12322586/',
    },
    {
      id: 'commissati2025',
      authors: 'Commissati S, Cagigas ML, Masedunskas A, et al.',
      year: 2025,
      title:
        'Prolonged fasting promotes systemic inflammation and platelet activation in humans: a medically supervised, water-only fasting and refeeding study',
      journal: 'Mol Metab',
      pmid: '40268190',
      doi: '10.1016/j.molmet.2025.102152',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12088818/',
    },
    {
      id: 'camli2026',
      authors: 'Çamli A, Ülker İ, Terzi M, et al.',
      year: 2026,
      title:
        'Duration-dependent effects of water-only fasting on blood lipids: a systematic review, meta-analysis, and threshold meta-regression',
      journal: 'Front Nutr',
      pmid: '41994097',
      doi: '10.3389/fnut.2026.1772246',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC13079636/',
    },
    {
      id: 'grundler2024',
      authors: 'Grundler F, Mesnage R, Ruppert PMM, Kouretas D, Wilhelmi de Toledo F.',
      year: 2024,
      title: 'Long-term fasting-induced ketosis in 1610 subjects: metabolic regulation and safety',
      journal: 'Nutrients',
      pmid: '38931204',
      doi: '10.3390/nu16121849',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11206495/',
    },
    {
      id: 'naegel2025',
      authors: 'Naëgel A, Viallon M, Ratiney H, et al.',
      year: 2025,
      title:
        'Impact of long-term fasting on skeletal muscle: structure, energy metabolism and function using 31P/1H MRS and MRI',
      journal: 'J Cachexia Sarcopenia Muscle',
      pmid: '40211897',
      doi: '10.1002/jcsm.13773',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11986369/',
    },
    {
      id: 'benedict1915',
      authors: 'Benedict FG.',
      year: 1915,
      title: 'A Study of Prolonged Fasting',
      journal: 'Carnegie Institution of Washington, Publication No. 203 (Washington, DC)',
      url: 'https://archive.org/details/studyofprolonged00beneuoft',
    },
    {
      id: 'zauner2000',
      authors: 'Zauner C, Schneeweiss B, Kranz A, et al.',
      year: 2000,
      title:
        'Resting energy expenditure in short-term starvation is increased as a result of an increase in serum norepinephrine',
      journal: 'Am J Clin Nutr',
      pmid: '10837292',
      doi: '10.1093/ajcn/71.6.1511',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10837292/',
    },
    {
      id: 'webber1994',
      authors: 'Webber J, Macdonald IA.',
      year: 1994,
      title:
        'The cardiovascular, metabolic and hormonal changes accompanying acute starvation in men and women',
      journal: 'Br J Nutr',
      pmid: '8172872',
      doi: '10.1079/bjn19940150',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8172872/',
    },
    {
      id: 'mansell1990',
      authors: 'Mansell PI, Fellows IW, Macdonald IA.',
      year: 1990,
      title: 'Enhanced thermogenic response to epinephrine after 48-h starvation in humans',
      journal: 'Am J Physiol',
      pmid: '2405717',
      doi: '10.1152/ajpregu.1990.258.1.R87',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2405717/',
    },
    {
      id: 'mansell1990a',
      authors: 'Mansell PI, Macdonald IA.',
      year: 1990,
      title: 'The effect of starvation on insulin-induced glucose disposal and thermogenesis in humans',
      journal: 'Metabolism',
      pmid: '2186256',
      doi: '10.1016/0026-0495(90)90009-2',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2186256/',
    },
    {
      id: 'nair1987',
      authors: 'Nair KS, Woolf PD, Welle SL, Matthews DE.',
      year: 1987,
      title: 'Leucine, glucose, and energy metabolism after 3 days of fasting in healthy human subjects',
      journal: 'Am J Clin Nutr',
      pmid: '3661473',
      doi: '10.1093/ajcn/46.4.557',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3661473/',
    },
    {
      id: 'browning2012',
      authors: 'Browning JD, Baxter J, Satapati S, Burgess SC.',
      year: 2012,
      title:
        'The effect of short-term fasting on liver and skeletal muscle lipid, glucose, and energy metabolism in healthy women and men',
      journal: 'J Lipid Res',
      pmid: '22140269',
      doi: '10.1194/jlr.P020867',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3276482/',
    },
    {
      id: 'carlson1994',
      authors: 'Carlson MG, Snead WL, Campbell PJ.',
      year: 1994,
      title: 'Fuel and energy metabolism in fasting humans',
      journal: 'Am J Clin Nutr',
      pmid: '8017334',
      doi: '10.1093/ajcn/60.1.29',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8017334/',
    },
    {
      id: 'klein1993',
      authors: 'Klein S, Sakurai Y, Romijn JA, Carroll RM.',
      year: 1993,
      title:
        'Progressive alterations in lipid and glucose metabolism during short-term fasting in young adult men',
      journal: 'Am J Physiol',
      pmid: '8238506',
      doi: '10.1152/ajpendo.1993.265.5.E801',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8238506/',
    },
    {
      id: 'mittendorfer2001',
      authors: 'Mittendorfer B, Horowitz JF, Klein S.',
      year: 2001,
      title: 'Gender differences in lipid and glucose kinetics during short-term fasting',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '11701450',
      doi: '10.1152/ajpendo.2001.281.6.E1333',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11701450/',
    },
    {
      id: 'owen1967',
      authors: 'Owen OE, Morgan AP, Kemp HG, Sullivan JM, Herrera MG, Cahill GF Jr.',
      year: 1967,
      title: 'Brain metabolism during fasting',
      journal: 'J Clin Invest',
      pmid: '6061736',
      doi: '10.1172/JCI105650',
      url: 'https://pubmed.ncbi.nlm.nih.gov/6061736/',
      verification: 'abstract',
    },
    {
      id: 'owen1969',
      authors: 'Owen OE, Felig P, Morgan AP, Wahren J, Cahill GF Jr.',
      year: 1969,
      title: 'Liver and kidney metabolism during prolonged starvation',
      journal: 'J Clin Invest',
      pmid: '5773093',
      doi: '10.1172/JCI106016',
      url: 'https://pubmed.ncbi.nlm.nih.gov/5773093/',
      verification: 'abstract',
    },
    {
      id: 'owen1998',
      authors: "Owen OE, Smalley KJ, D'Alessio DA, Mozzoli MA, Dawson EK.",
      year: 1998,
      title: 'Protein, fat, and carbohydrate requirements during starvation: anaplerosis and cataplerosis',
      journal: 'Am J Clin Nutr',
      pmid: '9665093',
      doi: '10.1093/ajcn/68.1.12',
      url: 'https://pubmed.ncbi.nlm.nih.gov/9665093/',
      verification: 'abstract',
    },
    {
      id: 'cahill2003',
      authors: 'Cahill GF Jr, Veech RL.',
      year: 2003,
      title: 'Ketoacids? Good medicine?',
      journal: 'Trans Am Clin Climatol Assoc',
      pmid: '12813917',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12813917/',
    },
    {
      id: 'goschke1975',
      authors: 'Göschke H, Stahl M, Thölen H.',
      year: 1975,
      title: 'Nitrogen loss in normal and obese subjects during total fast',
      journal: 'Klin Wochenschr',
      pmid: '1177405',
      doi: '10.1007/BF01469679',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1177405/',
      verification: 'abstract',
    },
    {
      id: 'forbes1979',
      authors: 'Forbes GB, Drenick EJ.',
      year: 1979,
      title: 'Loss of body nitrogen on fasting',
      journal: 'Am J Clin Nutr',
      pmid: '463798',
      doi: '10.1093/ajcn/32.8.1570',
      url: 'https://pubmed.ncbi.nlm.nih.gov/463798/',
      verification: 'abstract',
    },
    {
      id: 'elia1999',
      authors: 'Elia M, Stubbs RJ, Henry CJ.',
      year: 1999,
      title:
        'Differences in fat, carbohydrate, and protein metabolism between lean and obese subjects undergoing total starvation',
      journal: 'Obes Res',
      pmid: '10574520',
      doi: '10.1002/j.1550-8528.1999.tb00720.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10574520/',
      verification: 'abstract',
    },
    {
      id: 'henry1988',
      authors: 'Henry CJ, Rivers JP, Payne PR.',
      year: 1988,
      title: 'Protein and energy metabolism in starvation reconsidered',
      journal: 'Eur J Clin Nutr',
      pmid: '3066619',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3066619/',
      verification: 'abstract',
    },
    {
      id: 'bak2016',
      authors: 'Bak AM, Møller AB, Vendelbo MH, et al.',
      year: 2016,
      title:
        'Differential regulation of lipid and protein metabolism in obese vs. lean subjects before and after a 72-h fast',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '27245338',
      doi: '10.1152/ajpendo.00464.2015',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27245338/',
    },
    {
      id: 'hogild2019',
      authors: 'Høgild ML, Bak AM, Pedersen SB, Rungby J, Frystyk J, Møller N.',
      year: 2019,
      title: 'Growth hormone signaling and action in obese versus lean human subjects',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '30576246',
      doi: '10.1152/ajpendo.00431.2018',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30576246/',
    },
    {
      id: 'fisler1982',
      authors: 'Fisler JS, Drenick EJ, Blumfield DE, Swendseid ME.',
      year: 1982,
      title:
        'Nitrogen economy during very low calorie reducing diets: quality and quantity of dietary protein',
      journal: 'Am J Clin Nutr',
      pmid: '7064898',
      doi: '10.1093/ajcn/35.3.471',
      url: 'https://pubmed.ncbi.nlm.nih.gov/7064898/',
    },
    {
      id: 'fisler1984',
      authors: 'Fisler JS, Drenick EJ.',
      year: 1984,
      title:
        'Calcium, magnesium, and phosphate balances during very low calorie diets of soy or collagen protein in obese men: comparison to total fasting',
      journal: 'Am J Clin Nutr',
      pmid: '6540047',
      doi: '10.1093/ajcn/40.1.14',
      url: 'https://pubmed.ncbi.nlm.nih.gov/6540047/',
    },
    {
      id: 'sherwin1981',
      authors: 'Sherwin RS.',
      year: 1981,
      title: 'The effect of ketone bodies and dietary carbohydrate intake on protein metabolism',
      journal: 'Acta Chir Scand Suppl',
      pmid: '6947662',
      url: 'https://pubmed.ncbi.nlm.nih.gov/6947662/',
    },
    {
      id: 'sherwin1978',
      authors: 'Sherwin RS.',
      year: 1978,
      title: 'Effect of starvation on the turnover and metabolic response to leucine',
      journal: 'J Clin Invest',
      pmid: '659610',
      doi: '10.1172/JCI109067',
      url: 'https://pubmed.ncbi.nlm.nih.gov/659610/',
    },
    {
      id: 'sapir1972',
      authors: 'Sapir DG, Owen OE, Cheng JT, Ginsberg R, Boden G, Walker WG.',
      year: 1972,
      title: 'The effect of carbohydrates on ammonium and ketoacid excretion during starvation',
      journal: 'J Clin Invest',
      pmid: '5054466',
      doi: '10.1172/JCI107016',
      url: 'https://pubmed.ncbi.nlm.nih.gov/5054466/',
    },
    {
      id: 'sapir1975',
      authors: 'Sapir DG, Owen OE.',
      year: 1975,
      title: 'Renal conservation of ketone bodies during starvation',
      journal: 'Metabolism',
      pmid: '234169',
      doi: '10.1016/0026-0495(75)90004-9',
      url: 'https://pubmed.ncbi.nlm.nih.gov/234169/',
    },
    {
      id: 'sigler1975',
      authors: 'Sigler MH.',
      year: 1975,
      title: 'The mechanism of the natriuresis of fasting',
      journal: 'J Clin Invest',
      pmid: '236328',
      doi: '10.1172/JCI107941',
      url: 'https://pubmed.ncbi.nlm.nih.gov/236328/',
    },
    {
      id: 'speakman2013',
      authors: 'Speakman JR, Westerterp KR.',
      year: 2013,
      title:
        'A mathematical model of weight loss under total starvation: evidence against the thrifty-gene hypothesis',
      journal: 'Dis Model Mech',
      pmid: '22864023',
      doi: '10.1242/dmm.010009',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3529354/',
    },
    {
      id: 'kerndt1982',
      authors: 'Kerndt PR, Naughton JL, Driscoll CE, Loxterkamp DA.',
      year: 1982,
      title: 'Fasting: the history, pathophysiology and complications',
      journal: 'West J Med',
      pmid: '6758355',
      url: 'https://pubmed.ncbi.nlm.nih.gov/6758355/',
      verification: 'abstract',
    },
    {
      id: 'johnson1977',
      authors: 'Johnson D, Drenick EJ.',
      year: 1977,
      title: 'Therapeutic fasting in morbid obesity',
      journal: 'Arch Intern Med',
      pmid: '921419',
      url: 'https://pubmed.ncbi.nlm.nih.gov/921419/',
    },
    {
      id: 'stewart1973',
      authors: 'Stewart WK, Fleming LW.',
      year: 1973,
      title: "Features of a successful therapeutic fast of 382 days' duration",
      journal: 'Postgrad Med J',
      pmid: '4803438',
      doi: '10.1136/pgmj.49.569.203',
      url: 'https://pubmed.ncbi.nlm.nih.gov/4803438/',
      verification: 'abstract',
    },
    {
      id: 'drenick1966',
      authors: 'Drenick EJ, Joven CB, Swendseid ME.',
      year: 1966,
      title:
        "Occurrence of acute Wernicke's encephalopathy during prolonged starvation for the treatment of obesity",
      journal: 'N Engl J Med',
      pmid: '5908887',
      doi: '10.1056/NEJM196604282741705',
      url: 'https://pubmed.ncbi.nlm.nih.gov/5908887/',
      verification: 'abstract',
    },
    {
      id: 'ho1988',
      authors: 'Ho KY, Veldhuis JD, Johnson ML, et al.',
      year: 1988,
      title:
        'Fasting enhances growth hormone secretion and amplifies the complex rhythms of growth hormone secretion in man',
      journal: 'J Clin Invest',
      pmid: '3127426',
      doi: '10.1172/JCI113450',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3127426/',
    },
    {
      id: 'hartman1992',
      authors: 'Hartman ML, Veldhuis JD, Johnson ML, et al.',
      year: 1992,
      title:
        'Augmented growth hormone (GH) secretory burst frequency and amplitude mediate enhanced GH secretion during a two-day fast in normal men',
      journal: 'J Clin Endocrinol Metab',
      pmid: '1548337',
      doi: '10.1210/jcem.74.4.1548337',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1548337/',
    },
    {
      id: 'chan2003',
      authors: 'Chan JL, Heist K, DePaoli AM, Veldhuis JD, Mantzoros CS.',
      year: 2003,
      title:
        'The role of falling leptin levels in the neuroendocrine and metabolic adaptation to short-term starvation in healthy men',
      journal: 'J Clin Invest',
      pmid: '12727933',
      doi: '10.1172/JCI17490',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC154448/',
    },
    {
      id: 'bergendahl2000',
      authors: 'Bergendahl M, Iranmanesh A, Mulligan T, Veldhuis JD.',
      year: 2000,
      title:
        'Impact of age on cortisol secretory dynamics basally and as driven by nutrient-withdrawal stress',
      journal: 'J Clin Endocrinol Metab',
      pmid: '10852453',
      doi: '10.1210/jcem.85.6.6628',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10852453/',
    },
    {
      id: 'bergendahl2000a',
      authors: 'Bergendahl M, Iranmanesh A, Pastor C, Evans WS, Veldhuis JD.',
      year: 2000,
      title:
        'Homeostatic joint amplification of pulsatile and 24-hour rhythmic cortisol secretion by fasting stress in midluteal phase women',
      journal: 'J Clin Endocrinol Metab',
      pmid: '11095428',
      doi: '10.1210/jcem.85.11.6945',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11095428/',
    },
    {
      id: 'espelund2005',
      authors: 'Espelund U, Hansen TK, Højlund K, et al.',
      year: 2005,
      title:
        'Fasting unmasks a strong inverse association between ghrelin and cortisol in serum: studies in obese and normal-weight subjects',
      journal: 'J Clin Endocrinol Metab',
      pmid: '15522942',
      doi: '10.1210/jc.2004-0604',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15522942/',
    },
    {
      id: 'natalucci2005',
      authors: 'Natalucci G, Riedl S, Gleiss A, Zidek T, Frisch H.',
      year: 2005,
      title:
        'Spontaneous 24-h ghrelin secretion pattern in fasting subjects: maintenance of a meal-related pattern',
      journal: 'Eur J Endocrinol',
      pmid: '15941923',
      doi: '10.1530/eje.1.01919',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15941923/',
    },
    {
      id: 'spaulding1976',
      authors: 'Spaulding SW, Chopra IJ, Sherwin RS, Lyall SS.',
      year: 1976,
      title: 'Effect of caloric restriction and dietary composition on serum T3 and reverse T3 in man',
      journal: 'J Clin Endocrinol Metab',
      pmid: '1249190',
      doi: '10.1210/jcem-42-1-197',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1249190/',
    },
    {
      id: 'savendahl1999',
      authors: 'Sävendahl L, Underwood LE.',
      year: 1999,
      title:
        'Fasting increases serum total cholesterol, LDL cholesterol and apolipoprotein B in healthy, nonobese humans',
      journal: 'J Nutr',
      pmid: '10539776',
      doi: '10.1093/jn/129.11.2005',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10539776/',
    },
    {
      id: 'horton2001',
      authors: 'Horton TJ, Hill JO.',
      year: 2001,
      title:
        'Prolonged fasting significantly changes nutrient oxidation and glucose tolerance after a normal mixed meal',
      journal: 'J Appl Physiol',
      pmid: '11133906',
      doi: '10.1152/jappl.2001.90.1.155',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11133906/',
    },
    {
      id: 'knapik1987',
      authors: 'Knapik JJ, Jones BH, Meredith C, Evans WJ.',
      year: 1987,
      title: 'Influence of a 3.5 day fast on physical performance',
      journal: 'Eur J Appl Physiol Occup Physiol',
      pmid: '3622486',
      doi: '10.1007/BF00417770',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3622486/',
    },
    {
      id: 'knapik1988',
      authors: 'Knapik JJ, Meredith CN, Jones BH, Suek L, Young VR, Evans WJ.',
      year: 1988,
      title: 'Influence of fasting on carbohydrate and fat metabolism during rest and exercise in men',
      journal: 'J Appl Physiol',
      pmid: '3292504',
      doi: '10.1152/jappl.1988.64.5.1923',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3292504/',
    },
    {
      id: 'loy1986',
      authors: 'Loy SF, Conlee RK, Winder WW, Nelson AG, Arnall DA, Fisher AG.',
      year: 1986,
      title: 'Effects of 24-hour fast on cycling endurance time at two different intensities',
      journal: 'J Appl Physiol',
      pmid: '3745057',
      doi: '10.1152/jappl.1986.61.2.654',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3745057/',
    },
    {
      id: 'hasselbalch1995',
      authors: 'Hasselbalch SG, Knudsen GM, Jakobsen J, et al.',
      year: 1995,
      title:
        'Blood-brain barrier permeability of glucose and ketone bodies during short-term starvation in humans',
      journal: 'Am J Physiol',
      pmid: '7611392',
      doi: '10.1152/ajpendo.1995.268.6.E1161',
      url: 'https://pubmed.ncbi.nlm.nih.gov/7611392/',
    },
    {
      id: 'templeman2021',
      authors: 'Templeman I, Smith HA, Chowdhury E, et al.',
      year: 2021,
      title:
        'A randomized controlled trial to isolate the effects of fasting and energy restriction on weight loss and metabolic health in lean adults',
      journal: 'Sci Transl Med',
      pmid: '34135111',
      doi: '10.1126/scitranslmed.abd8034',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34135111/',
    },
    {
      id: 'catenacci2016',
      authors: 'Catenacci VA, Pan Z, Ostendorf D, et al.',
      year: 2016,
      title:
        'A randomized pilot study comparing zero-calorie alternate-day fasting to daily caloric restriction in adults with obesity',
      journal: 'Obesity (Silver Spring)',
      pmid: '27569118',
      doi: '10.1002/oby.21581',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27569118/',
    },
    {
      id: 'heilbronn2005',
      authors: 'Heilbronn LK, Smith SR, Martin CK, Anton SD, Ravussin E.',
      year: 2005,
      title:
        'Alternate-day fasting in nonobese subjects: effects on body weight, body composition, and energy metabolism',
      journal: 'Am J Clin Nutr',
      pmid: '15640462',
      doi: '10.1093/ajcn/81.1.69',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15640462/',
    },
    {
      id: 'heilbronn2005a',
      authors: 'Heilbronn LK, Civitarese AE, Bogacka I, Smith SR, Hulver M, Ravussin E.',
      year: 2005,
      title: 'Glucose tolerance and skeletal muscle gene expression in response to alternate day fasting',
      journal: 'Obes Res',
      pmid: '15833943',
      doi: '10.1038/oby.2005.61',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15833943/',
    },
    {
      id: 'hutchison2019',
      authors: 'Hutchison AT, Liu B, Wood RE, et al.',
      year: 2019,
      title:
        'Effects of intermittent versus continuous energy intakes on insulin sensitivity and metabolic risk in women with overweight',
      journal: 'Obesity (Silver Spring)',
      pmid: '30569640',
      doi: '10.1002/oby.22345',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30569640/',
    },
    {
      id: 'stekovic2019',
      authors: 'Stekovic S, Hofer SJ, Tripolt N, et al.',
      year: 2019,
      title:
        'Alternate day fasting improves physiological and molecular markers of aging in healthy, non-obese humans',
      journal: 'Cell Metab',
      pmid: '31471173',
      doi: '10.1016/j.cmet.2019.07.016',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31471173/',
    },
    {
      id: 'hollstein2021',
      authors: 'Hollstein T, Basolo A, Ando T, Krakoff J, Piaggi P.',
      year: 2021,
      title:
        'Reduced adaptive thermogenesis during acute protein-imbalanced overfeeding is a metabolic hallmark of the human thrifty phenotype',
      journal: 'Am J Clin Nutr',
      pmid: '34225360',
      doi: '10.1093/ajcn/nqab209',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34225360/',
    },
    {
      id: 'vandenberghe2017',
      authors: 'Vandenberghe C, St-Pierre V, Courchesne-Loyer A, Hennebelle M, Castellano CA, Cunnane SC.',
      year: 2017,
      title: 'Caffeine intake increases plasma ketones: an acute metabolic study in humans',
      journal: 'Can J Physiol Pharmacol',
      pmid: '28177691',
      doi: '10.1139/cjpp-2016-0338',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28177691/',
    },
    {
      id: 'tey2017',
      authors: 'Tey SL, Salleh NB, Henry J, Forde CG.',
      year: 2017,
      title:
        'Effects of aspartame-, monk fruit-, stevia- and sucrose-sweetened beverages on postprandial glucose, insulin and energy intake',
      journal: 'Int J Obes (Lond)',
      pmid: '27956737',
      doi: '10.1038/ijo.2016.225',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27956737/',
    },
    {
      id: 'merimee1977',
      authors: 'Merimee TJ, Tyson JE.',
      year: 1977,
      title: 'Hypoglycemia in man: pathologic and physiologic variants',
      journal: 'Diabetes',
      pmid: '190073',
      doi: '10.2337/diab.26.3.161',
      url: 'https://pubmed.ncbi.nlm.nih.gov/190073/',
    },
    {
      id: 'bistrian1981',
      authors: 'Bistrian BR, Sherman M, Young V.',
      year: 1981,
      title: 'The mechanisms of nitrogen sparing in fasting supplemented by protein and carbohydrate',
      journal: 'J Clin Endocrinol Metab',
      pmid: '7287871',
      doi: '10.1210/jcem-53-4-874',
      url: 'https://pubmed.ncbi.nlm.nih.gov/7287871/',
    },
    {
      id: 'johnstone2002',
      authors: 'Johnstone AM, Faber P, Gibney ER, et al.',
      year: 2002,
      title: 'Effect of an acute fast on energy compensation and feeding behaviour in lean men and women',
      journal: 'Int J Obes Relat Metab Disord',
      pmid: '12461679',
      doi: '10.1038/sj.ijo.0802151',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12461679/',
    },
    {
      id: 'boden1996',
      authors: 'Boden G, Chen X, Mozzoli M, Ryan I.',
      year: 1996,
      title: 'Effect of fasting on serum leptin in normal human subjects',
      journal: 'J Clin Endocrinol Metab',
      pmid: '8784108',
      doi: '10.1210/jcem.81.9.8784108',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8784108/',
    },
    {
      id: 'heyman2020',
      authors: 'Heyman SN, Bursztyn M, Szalat A, et al.',
      year: 2020,
      title: 'Fasting-induced natriuresis and SGLT: a new hypothesis for an old enigma',
      journal: 'Front Endocrinol (Lausanne)',
      pmid: '32457696',
      doi: '10.3389/fendo.2020.00217',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32457696/',
    },
    {
      id: 'vazquez1995',
      authors: 'Vazquez JA, Kazi U, Madani N.',
      year: 1995,
      title:
        'Protein metabolism during weight reduction with very-low-energy diets: evaluation of the independent effects of protein and carbohydrate on protein sparing',
      journal: 'Am J Clin Nutr',
      pmid: '7598072',
      doi: '10.1093/ajcn/62.1.93',
      url: 'https://pubmed.ncbi.nlm.nih.gov/7598072/',
    },
    {
      id: 'trepanowski2017',
      authors: 'Trepanowski JF, Kroeger CM, Barnosky A, et al.',
      year: 2017,
      title:
        'Effect of alternate-day fasting on weight loss, weight maintenance, and cardioprotection among metabolically healthy obese adults: a randomized clinical trial',
      journal: 'JAMA Intern Med',
      pmid: '28459931',
      doi: '10.1001/jamainternmed.2017.0936',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28459931/',
    },
    {
      id: 'roman2019',
      authors: 'Roman YM, Dominguez MC, Easow TM, et al.',
      year: 2019,
      title:
        'Effects of intermittent versus continuous dieting on weight and body composition in obese and overweight people: a systematic review and meta-analysis of randomized controlled trials',
      journal: 'Int J Obes (Lond)',
      pmid: '30206335',
      doi: '10.1038/s41366-018-0204-0',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30206335/',
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
      url: 'https://pubmed.ncbi.nlm.nih.gov/28202779/',
    },
    {
      id: 'mathieson1986',
      authors: 'Mathieson RA, Walberg JL, Gwazdauskas FC, et al.',
      year: 1986,
      title:
        'The effect of varying carbohydrate content of a very-low-caloric diet on resting metabolic rate and thyroid hormones',
      journal: 'Metabolism',
      pmid: '3702673',
      doi: '10.1016/0026-0495(86)90126-5',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3702673/',
    },
    {
      id: 'mcdougal2018',
      authors: 'McDougal DH, Darpolor MM, DuVall MA, et al.',
      year: 2018,
      title:
        'Glial acetate metabolism is increased following a 72-h fast in metabolically healthy men and correlates with susceptibility to hypoglycemia',
      journal: 'Acta Diabetol',
      pmid: '29931424',
      doi: '10.1007/s00592-018-1180-5',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29931424/',
    },
    {
      id: 'haymond1982',
      authors: 'Haymond MW, Karl IE, Clarke WL, Pagliara AS, Santiago JV.',
      year: 1982,
      title:
        'Differences in circulating gluconeogenic substrates during short-term fasting in men, women, and children',
      journal: 'Metabolism',
      pmid: '7043160',
      url: 'https://pubmed.ncbi.nlm.nih.gov/7043160/',
    },
    {
      id: 'neudorf2025',
      authors: 'Neudorf H, Sandilands RE, Ursel S, et al.',
      year: 2025,
      title: 'Altered immunometabolic response to fasting in humans living with obesity',
      journal: 'iScience',
      pmid: '40662191',
      doi: '10.1016/j.isci.2025.112872',
      url: 'https://pubmed.ncbi.nlm.nih.gov/40662191/',
    },
    {
      id: 'owen1971',
      authors: 'Owen OE, Reichard GA Jr.',
      year: 1971,
      title: 'Human forearm metabolism during progressive starvation',
      journal: 'J Clin Invest',
      pmid: '5090067',
      doi: '10.1172/JCI106639',
      url: 'https://pubmed.ncbi.nlm.nih.gov/5090067/',
    },
    {
      id: 'deru2021',
      authors: 'Deru LS, Bikman BT, Davidson LE, et al.',
      year: 2021,
      title:
        'The effects of exercise on β-hydroxybutyrate concentrations over a 36-h fast: a randomized crossover study',
      journal: 'Med Sci Sports Exerc',
      pmid: '33731648',
      doi: '10.1249/MSS.0000000000002655',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33731648/',
    },
    {
      id: 'clayton2020',
      authors: 'Clayton DJ, James LJ, Sale C, Templeman I, Betts JA, Varley I.',
      year: 2020,
      title:
        'Severely restricting energy intake for 24 h does not affect markers of bone metabolism at rest or in response to re-feeding',
      journal: 'Eur J Nutr',
      pmid: '32016644',
      doi: '10.1007/s00394-020-02186-4',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32016644/',
    },
  ],
};

export default topic;
