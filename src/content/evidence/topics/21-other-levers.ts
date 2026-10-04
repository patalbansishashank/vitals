import type { EvidenceTopic } from '../schema';

const topic: EvidenceTopic = {
  dossier: '21',
  slug: 'other-levers',
  title: 'Other levers: what else a person can change',
  scope:
    'Beyond diet composition, training and fasting, this topic covers the other things a person can do on a given day or week: walking and standing, sleep, supplements, heat and cold, meal patterns and behaviour habits. Each is rated for how strong the human evidence is and for what it actually changes. Levers with solid evidence are modelled; the rest are shown as simulator inputs only, folded into the appetite and adherence model, or listed among the claims the evidence does not support. Medicines are recognised but not modelled.',
  mechanisms: [
    {
      id: '21-creatine-load',
      title: 'Creatine fills up muscle over days to weeks, and adds water weight',
      category: 'performance',
      summary:
        'Creatine is stored in muscle and helps fuel short, hard efforts. Taken with resistance training it adds about 1.1 kg of measured lean mass, part of it water held inside muscle cells. Muscle stores fill in about a week on a loading dose, or about four weeks on a small daily dose, and empty within about 30 days of stopping. On the scale it shows as about 0.75–0.9 kg of extra body water.',
      howModelled:
        'Creatine is a state called creatine load, from 0 to 1: the fraction of the maximal rise in muscle creatine. It climbs towards 1 while creatine is taken and drifts back to 0 when it is not. Its size sets the extra scale water and, when resistance training is scheduled, a small boost to muscle gain. Because the trial figure for lean mass already includes water inside muscle cells, the two effects are not both added at face value.',
      equation:
        'dC/dt = k_up(D) × (1 − C) − k_dn × C × max(0, 1 − D/2), with D the daily dose in g\nk_up(D) = 0.5 × (D/20)^0.75 per day (D = 20 g → 0.5; D = 3 g → 0.12); k_dn = 0.10 per day\nscale water = +0.9 × C kg; muscle gain from training × (1 + 0.15 × C)',
      keyNumbers: [
        {
          label: 'Lean mass with resistance training (35 studies, n = 1,192)',
          value: '+1.10 kg (95 % CI 0.56–1.65)',
          note: 'Overall, with or without training, +0.68 kg (0.26–1.11). No significant effect when combined with mixed exercise.',
          referenceIds: ['delpino2022'],
        },
        {
          label: 'Older adults (mean 57–70 y, 22 studies, n = 721)',
          value:
            'Lean tissue +1.37 kg (0.97–1.76); chest-press SMD 0.35 (0.16–0.53); leg-press SMD 0.24 (0.05–0.43)',
          referenceIds: ['chilibeck2017'],
        },
        {
          label: 'Postmenopausal women (7 RCTs, n = 608)',
          value: 'Lean mass +0.37 kg (0.05–0.69); leg press +7.5 kg (2.2–12.8); bone density unchanged',
          note: 'Effect at 5 g/d or more with resistance training; none at 3 g/d or less without it.',
          referenceIds: ['naddafha2026'],
        },
        {
          label: 'Older females (10 RCTs, n = 211)',
          value: 'Upper-body strength up; no overall effect on muscle mass',
          referenceIds: ['dos2021'],
        },
        {
          label: 'Cognition (16 RCTs, n = 492)',
          value: 'Memory SMD 0.31 (0.18–0.44); no effect on overall cognition or executive function',
          referenceIds: ['xu2024'],
        },
        {
          label: 'Loading kinetics (31 men)',
          value:
            '20 g/d for 6 d raised muscle total creatine by about 20 %; 3 g/d reached the same rise over 28 d; 2 g/d held it for 30 d; without any it returned to baseline in 30 d',
          referenceIds: ['hultman1996'],
        },
        {
          label: 'Scale weight (32 resistance-trained adults)',
          value:
            'Body mass +0.75 kg at day 7 of loading (not significant; threshold 0.88 kg) and significantly higher by day 28 on 5 g/d',
          note: 'Total body water rose without a change in fluid distribution. Modelled as +0.9 kg (0.5–1.5) at full loading.',
          referenceIds: ['powers2003'],
        },
        {
          label: 'Rise in muscle creatine and safety',
          value:
            'Muscle creatine and phosphocreatine +20–40 %; up to 30 g/d for 5 years safe in healthy people',
          referenceIds: ['kreider2017'],
        },
        {
          label: 'Time to 95 % of full effect (model)',
          value: '≈ 6 d at 20 g/d; ≈ 25–28 d at 3 g/d; washout ≈ 30 d',
        },
        {
          label: 'Accretion multiplier',
          value: '+15 % of muscle gain at full load (proposed)',
          note: 'Proposed from the 0.2–0.7 kg tissue share of the +1.1 kg after subtracting water.',
        },
      ],
      timeCourse:
        'Onset within about 6 days at 20 g a day and about 28 days at 3 g a day. Scale water tracks the creatine load. Stopping empties the store over about 30 days.',
      moderators:
        'Resistance training (the lean-mass benefit needs it), age and sex (smaller and less consistent in older women), dose, and starting muscle creatine.',
      grade: 'A',
      gradeReason:
        'Meta-analyses of randomised trials agree on lean mass and strength; the kinetics (grade B) rest on smaller studies.',
      status: 'proposed-fit',
      caveats:
        'The kinetics for 5 g a day without loading are interpolated between the 3 g and 20 g points. The 15 % accretion multiplier is a proposal. Most trials were in young and middle-aged, mostly male people. Label practice withholds creatine when kidney disease is present (could not be confirmed against the original paper). The scale gain of about 1 kg is expected and is not a sign of fat gain.',
      referenceIds: [
        'delpino2022',
        'chilibeck2017',
        'naddafha2026',
        'dos2021',
        'xu2024',
        'hultman1996',
        'powers2003',
        'kreider2017',
      ],
      relatedMetricIds: ['scaleWeight', 'rtMuscleGain'],
    },
    {
      id: '21-caffeine',
      title: 'Caffeine helps endurance and costs sleep; it is not a fat burner',
      category: 'performance',
      summary:
        'Caffeine at 3–6 mg per kg before exercise improves endurance time-trial times by about 2 %. Taken late enough that it is still in the body at bedtime it costs about 45 minutes of sleep. Vitals models both sides and gives it no credit for fat loss.',
      howModelled:
        'Caffeine has two effects. The performance effect applies to sessions after a 3–6 mg/kg dose. The sleep effect applies when the last dose is closer to bedtime than a cut-off that grows with dose. That cut-off is 8.8 hours for a coffee-sized dose (107 mg) and 13.2 hours for a pre-workout-sized dose (217.5 mg). A small body-pool state tracks how much caffeine is still on board.',
      equation:
        'cut-off before bed (h) = 8.8 + 6.2 × ln(D / 107), D the last dose in mg (proposed fit through the two anchor points)\nif last dose is later than the cut-off: total sleep time −45 min, sleep efficiency −7 %, time to fall asleep +9 min, wake after sleep onset +12 min, deep sleep −11 min',
      keyNumbers: [
        {
          label: 'Endurance time trials (46 studies), 3–6 mg/kg',
          value: 'Time −2.22 ± 2.59 % (ES 0.41 ± 0.20); mean power +3.03 ± 3.07 % (ES 0.23 ± 0.15)',
          note: 'A few individuals were slower.',
          referenceIds: ['southward2018'],
        },
        {
          label: 'Strength and power',
          value:
            'Strength SMD 0.20 (0.03–0.36); power 0.17 (0.00–0.34); upper-body strength 0.21 (0.02–0.39); lower-body 0.15 (−0.05 to 0.34)',
          referenceIds: ['grgic2018'],
        },
        {
          label: 'Umbrella of 21 meta-analyses',
          value: 'Ergogenic for aerobic endurance, strength, muscle endurance, power, jumping and speed',
          note: 'Moderate-quality evidence, mostly young men.',
          referenceIds: ['grgic2020'],
        },
        {
          label: 'After sleep loss',
          value: 'Attention response time g 0.86; accuracy g 0.68',
          referenceIds: ['irwin2020'],
        },
        {
          label: 'Sleep cost (24 studies)',
          value:
            'Total sleep time −45 min; sleep efficiency −7 %; onset latency +9 min; wake after onset +12 min; N1 +6.1 min; N3/N4 −11.4 min',
          referenceIds: ['gardiner2023'],
        },
        {
          label: 'Cut-off before bed to avoid the sleep loss',
          value: '≥ 8.8 h for a coffee (107 mg/250 mL); ≥ 13.2 h for a pre-workout dose (217.5 mg)',
          referenceIds: ['gardiner2023'],
        },
        {
          label: '400 mg at 0, 3 or 6 h before bed',
          value: 'Each disturbed sleep versus placebo',
          referenceIds: ['drake2013'],
        },
        {
          label: 'Energy expenditure',
          value:
            '100 mg raised resting energy 3–4 % over 150 min; repeated 100 mg every 2 h over a 12 h day raised energy expenditure 8–11 % and daily expenditure by 150 kcal (lean) or 79 kcal (post-obese)',
          note: 'About 600 mg a day (unverified count of doses), above common intake caps. Not credited for fat loss.',
          referenceIds: ['dulloo1989'],
        },
        {
          label: 'Caffeine, weight and fat (13 RCTs)',
          value: 'Dose-response meta-analysis not interpretable (I² 91–94 %)',
          referenceIds: ['tabrizi2019'],
        },
        {
          label: 'Model conversion of effect size to time-trial time',
          value: '% time trial ≈ 5.4 × ES (proposed)',
          referenceIds: ['southward2018'],
        },
      ],
      timeCourse:
        'Performance effect 45–60 minutes after a dose; the sleep effect the same night. The body-pool half-life is about 5 hours (unverified).',
      moderators:
        'Dose, clock time of the last dose, habitual intake (tolerance is not quantified) and sleep history.',
      grade: 'A',
      gradeReason:
        'Meta-analyses of many randomised trials agree on the performance and sleep effects; they are mostly in young men.',
      status: 'established',
      caveats:
        'The energy-expenditure effect is documented but withheld from the model. The dose-response link to weight is not interpretable. Pregnancy, anxiety disorders, arrhythmia and poorly controlled hypertension are listed exclusions, and 400 mg a day is a commonly cited adult limit (unverified).',
      referenceIds: [
        'southward2018',
        'grgic2018',
        'grgic2020',
        'irwin2020',
        'gardiner2023',
        'drake2013',
        'dulloo1989',
        'tabrizi2019',
      ],
      relatedMetricIds: ['sleepQuality'],
    },
    {
      id: '21-omega-3',
      title: 'Omega-3 fats lower triglycerides and blood pressure a little, not body fat',
      category: 'cardio',
      summary:
        'Fish-oil fats (EPA and DHA) at 2–3 g a day lower systolic blood pressure by about 2.6 mmHg, most in people with untreated high pressure. At 4 g a day they cut triglycerides by 30 % or more in people whose levels are very high. They do not change body weight. Above about 1 g a day they raise the risk of atrial fibrillation, an irregular heart rhythm.',
      howModelled:
        'Omega-3 is an opt-in input, in g a day of EPA plus DHA. It lowers blood pressure and triglycerides in the lipid model. An atrial-fibrillation flag switches on above 1 g a day.',
      equation:
        'systolic BP change = −2.6 × min(dose, 2) / 2 mmHg; plateau at 2–3 g/d with no further gain above 3 g/d',
      keyNumbers: [
        {
          label: 'Blood pressure, 70 RCTs',
          value: 'Systolic −1.52 (−2.25 to −0.79); diastolic −0.99 (−1.54 to −0.44) mmHg',
          note: 'Untreated hypertensives −4.51 / −3.05 mmHg; normotensives −1.25 / −0.62 mmHg.',
          referenceIds: ['miller2014'],
        },
        {
          label: 'Dose-response (71 trials, n = 4,973, median 2.8 g/d)',
          value:
            'J-shaped, optimum 2–3 g/d; systolic −2.61 (−3.57 to −1.65) at 2 g and −2.61 (−3.52 to −1.69) at 3 g; diastolic −1.64 / −1.80 mmHg',
          referenceIds: ['zhang2022'],
        },
        {
          label: 'Triglycerides',
          value: '≥ 30 % lower at 4 g/d EPA + DHA when triglycerides are ≥ 500 mg/dL, with LDL-C increases',
          referenceIds: ['skulasray2019'],
        },
        {
          label: 'Body weight (9 studies)',
          value: 'WMD 0.00 kg (−0.42 to +0.43); waist −0.53 cm (−0.90 to −0.16)',
          note: 'In overweight and obese adults, triglycerides standardised MD −0.59 (−0.93 to −0.25).',
          referenceIds: ['zhang2017'],
        },
        {
          label: 'Muscle in older adults',
          value: '+0.33 kg (0.05–0.62); +0.67 kg (0.16–1.18) above 2 g/d; lean-mass ES 0.27 (0.04–0.51)',
          note: 'Small and heterogeneous.',
          referenceIds: ['huang2020', 'bird2021'],
        },
        {
          label: 'Atrial fibrillation (7 trials, n = 81,210)',
          value:
            'HR 1.25 (1.07–1.46); 1.49 (1.04–2.15) above 1 g/d; 1.12 (1.03–1.22) at ≤ 1 g/d; +11 % per 1 g',
          referenceIds: ['gencer2021'],
        },
      ],
      timeCourse:
        'Weeks to judge triglyceride and blood pressure effects; trial durations ranged from 4 weeks to years (unverified per trial).',
      moderators: 'Baseline blood pressure and triglyceride level, and dose.',
      grade: 'A',
      gradeReason:
        'Several meta-analyses of randomised trials agree on the blood pressure and triglyceride effects and on the lack of a weight effect.',
      status: 'established',
      caveats:
        'People with atrial fibrillation or on anticoagulants, and those allergic to fish or shellfish, are excluded from the planner block (general precautions, unverified). The planner offers it only when triglycerides or blood pressure is a stated goal, at 2–3 g a day.',
      referenceIds: [
        'miller2014',
        'zhang2022',
        'skulasray2019',
        'zhang2017',
        'huang2020',
        'bird2021',
        'gencer2021',
      ],
      relatedMetricIds: ['triglycerides', 'sbp'],
    },
    {
      id: '21-viscous-fibre',
      title: 'Viscous fibre lowers LDL cholesterol; its effect on weight is small',
      category: 'cardio',
      summary:
        'Viscous fibre, the gel-forming kind in psyllium husk and oats, lowers LDL cholesterol. About 10 g a day of psyllium lowers it by 0.33 mmol/L, and oat beta-glucan at 3 g a day or more by 0.25 mmol/L. It lowers blood sugar only in people with type 2 diabetes. On weight the best estimate is a loss of 0.3–0.5 kg.',
      howModelled:
        'Viscous fibre is an input in g a day. It lowers LDL by 0.032 mmol/L for each gram of psyllium up to 10.2 g, or a flat 0.25 mmol/L for oat beta-glucan at 3 g or more. It lowers fasting glucose only in treated type 2 diabetes, and adds a small weight reduction. It counts towards the fibre total and is dropped on zero-intake days.',
      equation:
        'LDL change = −0.032 × min(dose, 10.2) mmol/L for psyllium; oat beta-glucan: −0.25 mmol/L at ≥ 3 g/d',
      keyNumbers: [
        {
          label: 'Psyllium, median ≈ 10.2 g/d (28 trials, n = 1,924)',
          value:
            'LDL −0.33 mmol/L (−0.38 to −0.27); non-HDL −0.39 (−0.50 to −0.27); apoB −0.05 g/L (−0.08 to −0.03)',
          referenceIds: ['jovanovski2018'],
        },
        {
          label: 'Oat beta-glucan ≥ 3 g/d',
          value: 'LDL −0.25 mmol/L (−0.30 to −0.20); total cholesterol −0.30 (−0.35 to −0.24)',
          note: 'No dose (3.0–12.4 g/d) or duration (2–12 wk) dependence; larger with higher baseline LDL; HDL and triglycerides unchanged.',
          referenceIds: ['whitehead2014'],
        },
        {
          label: 'Psyllium in type 2 diabetes',
          value: 'Fasting glucose −37.0 mg/dL; HbA1c −0.97 %',
          note: 'Proportional to baseline dysglycaemia; none in people with normal glucose.',
          referenceIds: ['gibb2015'],
        },
        {
          label: 'Viscous fibre with an ad-libitum diet (62 trials, n = 3,877)',
          value: 'Weight −0.33 kg (−0.51 to −0.14); BMI −0.28; waist −0.63 cm',
          referenceIds: ['jovanovski2020'],
        },
        {
          label: 'Isolated soluble fibre in overweight and obese adults (12 RCTs, n = 609)',
          value: 'Weight −2.52 kg (−4.25 to −0.79), with considerable heterogeneity',
          referenceIds: ['thompson2017'],
        },
        {
          label: 'Glucomannan',
          value:
            'Weight −0.79 kg (−1.53 to −0.05) in one meta-analysis; −1.27 kg (−2.45 to −0.09), below the 2.5 kg clinical threshold, in another',
          referenceIds: ['sood2008', 'bessell2021'],
        },
        {
          label: 'Best estimate for planning',
          value: '−0.3 to −0.5 kg',
        },
      ],
      timeCourse:
        'The LDL effect is fully present within trials of 2–12 weeks. Whether it reverses on stopping is assumed, and unverified.',
      moderators:
        'Baseline LDL (larger effect when higher) and glucose status (blood sugar effect only in type 2 diabetes).',
      grade: 'A',
      gradeReason:
        'Meta-analyses of many randomised trials with moderate to high certainty agree on the LDL effect.',
      status: 'established',
      caveats:
        'Swallowing problems, and taking it with too little water, are listed exclusions. Separation from oral medicines is a general precaution (unverified). Fibre gut-mass effects on scale weight are handled elsewhere.',
      referenceIds: [
        'jovanovski2018',
        'whitehead2014',
        'gibb2015',
        'jovanovski2020',
        'thompson2017',
        'sood2008',
        'bessell2021',
      ],
      relatedMetricIds: ['ldl', 'apoB'],
    },
    {
      id: '21-daily-steps',
      title: 'Daily steps: strong health associations, modest effect on weight',
      category: 'energy',
      summary:
        'People who walk more live longer in large cohort studies, with the benefit levelling off around 6,000–8,000 steps a day at age 60 or more and 8,000–10,000 below 60. In trials, pedometer users walked 2,491 more steps a day and lost a little BMI and blood pressure. The cohort figures are associations, not a promise of the same effect from changing your own steps.',
      howModelled:
        'Steps are a core input to energy expenditure (covered in the energy-expenditure topic). This article adds a health-risk proxy shown as an association, never as a causal promise: the mortality ratio falls from 1.00 at 2,000 steps a day to about 0.53 at 7,000 steps and then flattens. The plateau moves to 6,000–8,000 steps at 60 or over and to 8,000–10,000 below 60.',
      equation:
        'risk proxy (hazard ratio vs 2,000 steps/d) = 1 − 0.47 × min(1, (steps − 2000) / 5000), for steps ≥ 2,000',
      keyNumbers: [
        {
          label: 'Pooled cohorts (15 cohorts, n = 47,471, median 7.1 y follow-up)',
          value:
            'All-cause mortality HR 1.00 / 0.60 (0.51–0.71) / 0.55 (0.49–0.62) / 0.47 (0.39–0.57) across quartiles with median 3,553 / 5,801 / 7,842 / 10,901 steps/d',
          note: 'Cadence adds little once steps are adjusted (peak 30-minute cadence HR 0.67).',
          referenceIds: ['paluch2022'],
        },
        {
          label: '7,000 vs 2,000 steps/d (24 cohorts)',
          value:
            'All-cause HR 0.53 (0.46–0.60); cardiovascular disease 0.75 (0.67–0.85); type 2 diabetes 0.86 (0.74–0.99); depressive symptoms 0.78 (0.73–0.83); dementia 0.62 (0.53–0.73); falls 0.72',
          note: 'Inflection points at about 5,000–7,000 steps.',
          referenceIds: ['ding2025'],
        },
        {
          label: 'Pedometer trials',
          value:
            'Users walked +2,491 steps/d (1,098–3,885) more than controls; BMI −0.38 (0.05–0.72); systolic pressure −3.8 mmHg (1.7–5.9)',
          note: 'A step goal (for example 10,000) predicted the effect (P = 0.001). Mean intervention 18 weeks; 85 % women.',
          referenceIds: ['bravata2007'],
        },
        {
          label: 'Behavioural programme, 18 months (observational)',
          value:
            '≥ 10 % weight loss went with about 9,822 steps/d (about 3,500 as bout-length moderate-to-vigorous activity) versus 7,801 in weight gainers',
          referenceIds: ['creasy2018'],
        },
      ],
      timeCourse: 'Pedometer trials ran about 18 weeks. The cohort benefit is long-run.',
      moderators: 'Age (the plateau shifts with age) and how many steps a person starts from.',
      grade: 'B',
      gradeReason:
        'Cohort associations are strong (grade A) but randomised trial effects on BMI and blood pressure are modest (grade B).',
      status: 'proposed-fit',
      caveats:
        'The risk proxy is a proposed fit anchored on two cohort meta-analyses, and is an association only. Acute lower-limb injury is an exclusion; the ramp of +1,000–2,000 steps a week is general practice (unverified).',
      referenceIds: ['paluch2022', 'ding2025', 'bravata2007', 'creasy2018'],
      relatedMetricIds: ['neat', 'tdee'],
    },
    {
      id: '21-post-meal-walk',
      title: 'A short walk after eating lowers the after-meal glucose peak',
      category: 'fuel',
      summary:
        'Light walking soon after a meal lowers the rise in blood glucose that follows it, by about 12 % overall and about 22 % after an evening meal. The effect is real but short-lived. It does not move fat mass.',
      howModelled:
        'The walk is a multiplier on the after-meal glucose and insulin response of the meal-response model. It applies to one meal at a time and has no carry-over and no effect on glycogen storage.',
      keyNumbers: [
        {
          label: 'Type 2 diabetes, randomised crossover: walking after meals vs one daily walk',
          value:
            'Glucose incremental area under the curve ratio 0.88 (0.78–0.99); after the evening meal 0.78 (0.67–0.91)',
          note: 'Trial doses varied. The proposed prescription is 10–15 min of light walking starting within 30 min of a meal.',
          referenceIds: ['reynolds2016'],
        },
        {
          label: 'Meta-analysis of 7 acute one-day crossover trials',
          value:
            'Light walking vs sitting: glucose −0.72 (−1.03 to −0.41), insulin −0.83 (−1.18 to −0.48) standardised; standing vs sitting: glucose −0.31 (−0.60 to −0.03), no insulin or systolic effect; walking beat standing (glucose −0.30, insulin −0.54)',
          note: 'Units as reported, standardised. Mostly overweight and obese adults.',
          referenceIds: ['buffey2022'],
        },
        {
          label: 'Two-minute walking breaks every 20 min after a glucose load',
          value:
            'Glucose area 5.2 / 4.9 vs 6.9 mmol/L·h uninterrupted (−25 % / −29 %); insulin area 634 / 638 vs 829 pmol/L·h (−24 % / −23 %)',
          note: 'Light and moderate walking. Bout timing is unverified in the abstract.',
          referenceIds: ['dunstan2012'],
        },
        {
          label: 'Model factors',
          value:
            'Meal glucose area × 0.88 (0.78–0.99); dinner × 0.78 (0.67–0.91); 2-min breaks × 0.75 (glucose), × 0.76 (insulin)',
        },
      ],
      timeCourse: 'Single meal; no evidence of fat-mass change.',
      grade: 'B',
      gradeReason:
        'A randomised crossover and a meta-analysis agree, although doses varied and all trials were short.',
      status: 'established',
      caveats: 'No fat-loss credit is given.',
      referenceIds: ['reynolds2016', 'buffey2022', 'dunstan2012'],
      relatedMetricIds: ['glucose', 'insulin'],
    },
    {
      id: '21-sleep-extension',
      title: 'More sleep for short sleepers lowers appetite-driven intake',
      category: 'recovery',
      summary:
        'In adults with overweight who slept under 6.5 hours, extending sleep by about 1.2 hours a night lowered daily energy intake by about 270 kcal without changing energy expenditure. Cutting sleep to 5.5 hours during a diet moved more of the weight lost from fat to lean tissue. The effect on hunger, not on burning, is what changes.',
      howModelled:
        'Sleep is an input covered in the sleep topic, and this article supplies the effect sizes. When habitual sleep is under 6.5 hours, each extra hour lowers free-eating intake by about 225 kcal a day. The share of weight lost as lean tissue rises with short sleep, from 52 % at 8.5 hours to 80 % at 5.5 hours.',
      equation:
        'ad-libitum intake change = −225 kcal/d per extra hour of sleep, when habitual sleep < 6.5 h (0 above 7.5 h; linear between 5.5 and 8.5 h)\nlean share of weight lost = 0.52 + 0.28 × (8.5 − sleep hours) / 3, limited to 0.52–0.80',
      keyNumbers: [
        {
          label: 'Sleep extension, 80 adults (21–40 y, BMI 25–29.9, habitual sleep < 6.5 h)',
          value:
            'Sleep +1.2 h/night (1.0–1.4); energy intake −270 kcal/d (−393 to −147); r = −0.41 between change in sleep and change in intake; expenditure unchanged',
          note: 'The intervention phase length could not be confirmed against the original paper; the trial had a 2-week baseline.',
          referenceIds: ['tasali2022'],
        },
        {
          label: 'Sleep restriction during dieting (5.5 vs 8.5 h, 14-day crossover)',
          value:
            'Fat lost 0.6 vs 1.4 kg (−55 %); lean mass lost 2.4 vs 1.5 kg (+60 %); more hunger; less fat oxidation',
          note: 'Lean share of weight loss 80 % at 5.5 h vs 52 % at 8.5 h. The exact deficit is not in the abstract.',
          referenceIds: ['nedeltcheva2010'],
        },
        {
          label: 'Systematic review of 7 extension studies (n = 138)',
          value:
            'Better insulin-sensitivity measures; lower leptin and PYY; lower appetite and desire for sweet and salty food',
          note: 'Extension 21–177 min; 3 days to 6 weeks.',
          referenceIds: ['henst2019'],
        },
        {
          label: 'Athletes (2 studies)',
          value: 'Large effects on 6 of 15 sport measures, at very low to moderate certainty',
          referenceIds: ['silva2021'],
        },
      ],
      grade: 'B',
      gradeReason:
        'One well-controlled trial and one controlled crossover, backed by a systematic review, but small numbers and short follow-up.',
      status: 'proposed-fit',
      caveats:
        'How long the intake effect lasts beyond the trial, and the lean-share formula, rest on a single 14-day crossover in about 10 adults. Extending time in bed can worsen insomnia; untreated sleep apnoea or insomnia are exclusions.',
      referenceIds: ['tasali2022', 'nedeltcheva2010', 'henst2019', 'silva2021'],
      relatedMetricIds: ['hunger'],
    },
    {
      id: '21-interval-training',
      title: 'High-intensity intervals: the same fat loss as steady exercise in less time',
      category: 'cardio',
      summary:
        'High-intensity interval training (HIIT) and sprint-interval training improve fitness about as much as steady moderate exercise, and cause the same fat loss, in about 40 % less time. Sprint intervals also improved insulin sensitivity with about a fifth of the exercise volume. The cardio topic covers the details.',
      howModelled:
        'Interval sessions are modelled in the cardio topic. This article records the comparison numbers it relies on.',
      keyNumbers: [
        {
          label: 'HIIT vs moderate continuous training (13 studies, mean 10 wk × 3/wk)',
          value:
            'No difference in whole-body fat mass, waist or other body-composition measures, with ≈ 40 % less time commitment',
          note: 'Running gave fat-mass SMD −0.82 (HIIT) and −0.85 (steady); cycling gave no fat loss.',
          referenceIds: ['wewege2017'],
        },
        {
          label: 'Sprint-interval vs steady training, 12 weeks, sedentary men',
          value:
            'Peak oxygen uptake +19 % in both; insulin-sensitivity index 4.9 → 7.5 (sprint) vs 5.0 → 6.7 (steady) × 10⁻⁴ min⁻¹/(µU/mL)',
          note: 'With a five-fold lower exercise volume.',
          referenceIds: ['gillen2016'],
        },
      ],
      grade: 'A',
      gradeReason:
        'A meta-analysis of randomised trials agrees with a controlled trial, though the interval doses in the studies vary.',
      status: 'established',
      caveats: 'High-intensity blocks need a cardiac screen and an injury history check.',
      referenceIds: ['wewege2017', 'gillen2016'],
      relatedMetricIds: ['vo2max'],
    },
    {
      id: '21-protein-distribution',
      title: 'Spreading protein across the day: an acute effect that may not build more muscle',
      category: 'body',
      summary:
        'Eating the same daily protein in three or four even feedings raised 24-hour muscle protein synthesis by about a quarter compared with one large evening feeding, in a small crossover of young adults. In healthy adults aged 65–80 the same comparison showed no difference. Whether even spreading builds more muscle over months is still unresolved.',
      howModelled:
        'Distribution is a constraint in the protein model, not a lever: three to four feedings of at least 0.3–0.4 g/kg matter mainly when muscle is a top-two goal. Protein timing around training adds nothing once total protein is controlled.',
      keyNumbers: [
        {
          label: 'Even vs skewed intake, 7-day crossover (n = 8, age 36.9 y, BMI 25.7)',
          value:
            '24-hour mixed-muscle fractional synthesis rate +25 % with even (31.5 / 29.9 / 32.7 g) vs skewed (10.7 / 16.0 / 63.4 g) meals: 0.075 vs 0.056 %/h, P = 0.003',
          referenceIds: ['mamerow2014'],
        },
        {
          label: 'Healthy adults aged 65–80 (n = 24)',
          value: 'No difference in muscle protein synthesis or amino-acid use between even and skewed intake',
          referenceIds: ['justesen2022'],
        },
        {
          label: 'Systematic review of 15 studies',
          value:
            'Even distribution associated with higher muscle mass in 3 of 7 studies, strength in 2 of 7 and protein turnover in 1 of 6',
          referenceIds: ['jespersen2021'],
        },
        {
          label: 'Protein timing around training (23 hypertrophy studies, 525 subjects)',
          value: 'No significant benefit once total protein is controlled',
          referenceIds: ['schoenfeld2013'],
        },
        {
          label: 'Per-meal saturation reasoning',
          value: 'The idea of a fixed 25–30 g ceiling depends on food form and context',
          referenceIds: ['schoenfeld2018'],
        },
      ],
      timeCourse: 'Acute (24 hours).',
      grade: 'C',
      gradeReason:
        'The acute effect (grade B) comes from a very small crossover; the chronic muscle-mass benefit (grade C) is inconsistent.',
      status: 'contested',
      caveats:
        'Short eating windows reduce the number of feedings possible, which is why the planner treats distribution as a rule rather than a lever.',
      referenceIds: ['mamerow2014', 'justesen2022', 'jespersen2021', 'schoenfeld2013', 'schoenfeld2018'],
      relatedMetricIds: ['rtMuscleGain'],
    },
    {
      id: '21-meal-order-and-whey-preload',
      title: 'Vegetables and protein first flattens the glucose peak of a meal',
      category: 'fuel',
      summary:
        'Eating protein and non-starchy vegetables at least 10 minutes before the carbohydrate part of a meal cut the glucose rise by about 39 % in people with prediabetes. A whey drink before a carbohydrate meal slowed stomach emptying and lowered the glucose rise in type 2 diabetes. Both effects last one meal. No study measured fat mass.',
      howModelled:
        'Meal order is a per-meal switch that multiplies the meal glucose response by 0.61. It changes glycaemia only and is never credited for fat loss.',
      keyNumbers: [
        {
          label: 'Prediabetes crossover (n = 15), same meal',
          value:
            'Glucose incremental area −38.8 % with protein and vegetables first vs carbohydrate first; peak more than 40 % lower; insulin excursions lower with vegetables first',
          referenceIds: ['shukla2019'],
        },
        {
          label: 'Type 2 diabetes, whey preload about 30 min before a carbohydrate meal',
          value: 'Slowest stomach emptying and lower glucose area (P < 0.005); higher GLP-1, GIP and insulin',
          referenceIds: ['ma2009'],
        },
        {
          label: '15 g intact whey before breakfast and lunch (men with type 2 diabetes)',
          value: 'Breakfast glycaemic area −13 ± 3 %; satiety up',
          referenceIds: ['king2018'],
        },
        {
          label: 'Model factor',
          value: 'Meal glucose area × 0.61 (range 0.6–0.9)',
        },
      ],
      timeCourse: 'A single meal, with no carry-over.',
      grade: 'C',
      gradeReason:
        'One small crossover in 15 people supports the size, with mechanistic support from other small trials.',
      status: 'proposed-fit',
      caveats: 'No fat-mass outcome exists for this lever.',
      referenceIds: ['shukla2019', 'ma2009', 'king2018'],
      relatedMetricIds: ['glucose'],
    },
    {
      id: '21-standing-and-sit-breaks',
      title: 'Standing and breaking up sitting: real, but only about 10–15 kcal a day',
      category: 'energy',
      summary:
        'Standing instead of sitting burns about 0.15 kcal a minute more, roughly 9 kcal an hour. Real-world sit-stand desks cut sitting by only 57–100 minutes a day, so the realistic gain is 9–15 kcal a day. Short walking breaks lower the after-meal glucose rise. It is a small lever for energy, and Vitals labels it that way.',
      howModelled:
        'Extra standing hours feed the non-exercise activity term at 0.15 kcal a minute. Walking breaks feed the glucose response as a multiplier. The interface states the size as about 10–15 kcal a day so it is not read as a weight-loss tool.',
      keyNumbers: [
        {
          label: 'Standing minus sitting (46 studies, n = 1,184)',
          value: '+0.15 kcal/min (0.12–0.17)',
          note: 'Women 0.10 (0.0–0.21), men 0.19 (0.05–0.33); RCTs 0.20 (0.12–0.28), observational 0.11 (0.08–0.14). Six hours a day standing for a 65 kg person is +54 kcal/d.',
          referenceIds: ['saeidifard2018'],
        },
        {
          label: 'Real-world sit-stand desk dose',
          value:
            'Sitting at work −100 min/d at ≤ 3 months (−116 to −84; 10 studies, low quality); −57 min/d at 3–12 months (−99 to −15); 1–2 minute breaks each half hour −40 min/d',
          note: 'Treadmill and cycle desks: unclear or inconsistent. Realistic gain 57–100 min × 0.15 = 9–15 kcal/d.',
          referenceIds: ['shrestha2018'],
        },
        {
          label: 'Posture allocation, obese vs lean adults (n = 20, 10 days)',
          value: 'Obese adults sat about 2 h/d longer; adopting the lean pattern "might" give +350 kcal/d',
          note: 'A hypothetical maximum, not a trial result.',
          referenceIds: ['levine2005'],
        },
        {
          label: 'Glycaemia, 2-minute walking breaks every 20 minutes over 5 hours',
          value: 'Glucose area −25 % (light) and −29 % (moderate); insulin area −24 % / −23 %',
          referenceIds: ['dunstan2012'],
        },
      ],
      grade: 'A',
      gradeReason:
        'The energy cost of standing is well established by a large meta-analysis; the glycaemia effect (grade B) rests on smaller trials.',
      status: 'established',
      caveats: 'The health benefit of standing (grade C) is less certain than its energy cost.',
      referenceIds: ['saeidifard2018', 'shrestha2018', 'levine2005', 'dunstan2012'],
      relatedMetricIds: [],
    },
    {
      id: '21-exercise-snacks',
      title: 'Exercise snacks: very short hard bursts that raise fitness, not fat loss',
      category: 'cardio',
      summary:
        'Exercise snacks are bouts of five minutes or less of hard effort, such as 20–60 seconds of stair climbing, done at least twice a day. Across trials they raised cardiorespiratory fitness clearly. They did not change strength, body composition, blood pressure or lipids in one review, and adherence was high at 83–91 %.',
      howModelled:
        'Exercise snacks feed the fitness (peak oxygen uptake) signal through the cardio model as an easy-to-keep alternative to longer sessions. They receive no fat-loss credit.',
      keyNumbers: [
        {
          label: 'Cardiorespiratory fitness (6 studies)',
          value: 'g 1.37 (0.58–2.17), I² 71 %, moderate certainty',
          note: 'Muscular endurance in older adults g 0.40 (0.06–0.75; very low certainty). No effect on lower-limb strength, body composition, blood pressure or lipids (11 RCTs, n = 414). Adherence 82.8–91.1 %.',
          referenceIds: ['rodriguez2026'],
        },
        {
          label: 'Second meta-analysis (13 studies, n = 483)',
          value:
            'Total cholesterol SMD −0.65 (−1.18 to −0.11); LDL −0.65 (−1.22 to −0.09); no difference in body weight, body fat, HDL or triglycerides',
          referenceIds: ['wan2025'],
        },
      ],
      grade: 'B',
      gradeReason:
        'Two meta-analyses agree on fitness gains and null body-composition results, with moderate certainty at best.',
      status: 'established',
      caveats: 'Unscreened cardiac disease is an exclusion for high-intensity bursts.',
      referenceIds: ['rodriguez2026', 'wan2025'],
      relatedMetricIds: ['vo2max'],
    },
    {
      id: '21-sauna',
      title: 'Sauna: promising blood-pressure signal, confounded cohort data',
      category: 'cardio',
      summary:
        'Regular sauna use goes with far fewer cardiac deaths in Finnish cohorts, but fitness and healthy-user effects are not resolved. The one small trial found a drop in systolic blood pressure of 8 mmHg when a sauna followed exercise, compared with exercise alone. The growth hormone spike that sauna is known for fades with repeat use and has no body-composition outcome.',
      howModelled:
        'Sauna is an opt-in input that shifts systolic blood pressure by −4 mmHg times min(1, sessions per week ÷ 3) after at least 8 weeks, which is half the trial result. A heat-acclimation state is a minimal placeholder. There is no fat-loss credit and no hormone credit.',
      equation:
        'systolic BP change = −4 mmHg × min(1, sessions per week / 3), after ≥ 8 weeks (proposed: half the trial effect)',
      keyNumbers: [
        {
          label: 'Finnish men, median follow-up 20.7 y (929 all-cause deaths)',
          value:
            'Sudden cardiac death vs 1 session/week: HR 0.78 (0.57–1.07) at 2–3/week and 0.37 (0.18–0.75) at 4–7/week (P trend 0.005); sessions over 19 min vs under 11 min HR 0.48 (0.31–0.75)',
          referenceIds: ['laukkanen2015'],
        },
        {
          label: 'Mixed-sex cohort (15 y, 181 cardiovascular deaths)',
          value: '2–3/week HR 0.75 (0.52–1.08); 4–7/week 0.23 (0.08–0.65), linear, no threshold',
          referenceIds: ['laukkanen2018'],
        },
        {
          label: 'Joint with fitness',
          value:
            'High fitness + high sauna HR 0.42 (0.28–0.62); high fitness + low sauna 0.50 (0.39–0.63); low fitness + high sauna 0.72 (0.54–0.97)',
          note: 'Healthy-user and fitness confounding are unresolved.',
          referenceIds: ['kunutsor2018'],
        },
        {
          label: 'RCT: 47 adults, 8 weeks, exercise + 15-minute post-exercise sauna vs exercise alone',
          value:
            'Extra fitness +2.7 mL/kg/min (0.2–5.3); systolic pressure −8.0 mmHg (−14.6 to −1.4); lower total cholesterol',
          referenceIds: ['lee2022'],
        },
        {
          label: 'Meta-analysis of sauna in mostly cardiac patients',
          value:
            'Acute systolic −5.55 / diastolic −6.50 mmHg, heart rate +17.9 bpm, core temperature +0.94 °C; short-term systolic −5.26 / diastolic −4.14, LVEF +3.27 %, 6-minute walk +48 m, flow-mediated dilation +1.71 %',
          referenceIds: ['li2020'],
        },
        {
          label: 'Systematic review of 40 clinical studies (n = 3,855; 13 RCTs)',
          value:
            'Mostly favourable; the one adverse signal was reversible impairment of spermatogenesis in a small study (n = 10)',
          referenceIds: ['hussain2018'],
        },
        {
          label: 'Performance: 6 runners, 3 weeks of ~31-minute post-run sauna at ~90 °C',
          value: 'Plasma volume +7.1 % (5.6–8.7); time to exhaustion +32 % (≈ +1.9 % time trial)',
          referenceIds: ['scoon2007'],
        },
        {
          label: 'Post-exercise heat exposure (10 studies, n = 199)',
          value:
            'Trivial effect: ratio of means 1.04 (0.94–1.15); prediction interval 0.81–1.33; low to very low certainty',
          referenceIds: ['solomon2025'],
        },
        {
          label: 'Hormones: 7 days of 1 h at 80 °C twice daily (10 men)',
          value:
            'Growth hormone ×16 and prolactin ×2.3, with the growth-hormone response declining after day 3; testosterone, TSH and thyroid hormones unchanged; transient amenorrhoea in 5 of 7 women',
          referenceIds: ['leppaluoto1986'],
        },
        {
          label: 'Heat acclimation for endurance in heat',
          value: 'Own meta-analysis of 35 studies; magnitudes not extracted',
          referenceIds: ['benjamin2019'],
        },
      ],
      timeCourse:
        'Blood pressure effect after at least 8 weeks in the trial; plasma volume after 3 weeks; the acclimation time constant is about 14 days (unverified).',
      grade: 'C',
      gradeReason:
        'Cohort signals are large but confounded; the only trial of sauna plus exercise had 47 people.',
      status: 'contested',
      caveats:
        'The −4 mmHg is a 50 % shrink of a single n = 47 trial, in which sauna was added to exercise. Exclusions listed as general precautions (unverified): pregnancy, unstable cardiovascular disease, severe aortic stenosis, alcohol and dehydration; also men trying to conceive.',
      referenceIds: [
        'laukkanen2015',
        'laukkanen2018',
        'kunutsor2018',
        'lee2022',
        'li2020',
        'hussain2018',
        'scoon2007',
        'solomon2025',
        'leppaluoto1986',
        'benjamin2019',
      ],
      relatedMetricIds: ['sbp'],
    },
    {
      id: '21-cold-exposure-brown-fat',
      title: 'Cold exposure and brown fat: a real effect, far too small to matter for fat loss',
      category: 'energy',
      summary:
        'Cold recruits brown fat, a tissue that burns energy to make heat. In one trial six weeks of two hours a day at 17 °C raised cold-induced heat production and was linked to 0.7 kg of fat loss. But read correctly, the extra energy is only about 9–24 kcal per two-hour session, five to fifteen times too small to explain that fat loss. The fat-loss result is treated as an unreplicated small study.',
      howModelled:
        'Cold exposure is an opt-in input feeding a brown-fat capacity state from 0 to 1. It grows towards 1 with a time constant of 21 days when a person spends 1–2 hours a day at 17–19 °C or below on five or more days a week, and falls back with a time constant of 30 days. The energy per session comes from the difference between low and recruited cold-induced heat rates, divided by 24. Insulin sensitivity gets a small gain. Cold exposure earns no fat-loss credit.',
      equation:
        'dB/dt = (B* − B) / τ; B* = 1 if 1–2 h/day at ≤ 17–19 °C on ≥ 5 days/week, else 0.3; τ_up = 21 d, τ_down = 30 d (proposed)\nenergy per session = [CIT₀ + (CIT₁ − CIT₀) × B] / 24 × hours; CIT₀ ≈ 78–108, CIT₁ ≈ 252–289 (reported units, treated as 24-hour-equivalent rates)\ninsulin sensitivity gain = +10 % × B (proposed shrink of +43 %)',
      keyNumbers: [
        {
          label: 'Brown fat activity in cold',
          value: 'Present in 23 of 24 (96 %) young men; lower with overweight and obesity (P = 0.007)',
          referenceIds: ['van2009'],
        },
        {
          label: 'At 19 °C for 2 h (51 men, BMI 22)',
          value: 'Cold-induced thermogenesis 252 ± 41 vs 78 ± 24 kcal/d in men with vs without brown fat',
          referenceIds: ['yoneshiro2013'],
        },
        {
          label: 'Severe cold (3 h, controlled suit, n = 6)',
          value:
            'Total energy expenditure +80 % = +250 ± 45 kcal over 3 h, with brown fat oxidative metabolism activated',
          note: 'Not a daily-life dose; it needs shivering-level exposure.',
          referenceIds: ['ouellet2012'],
        },
        {
          label: 'Immersion for 1 h at 14 °C',
          value:
            'Metabolic rate +350 %; heart rate +5 %; systolic +7 %; diastolic +8 %; noradrenaline +530 %; dopamine +250 % (at 20 °C: +93 %, no pressure rise)',
          referenceIds: ['sramek2000'],
        },
        {
          label: 'RCT: 2 h/day at 17 °C for 6 weeks (n = 11 vs 11 low-brown-fat young men)',
          value:
            'Cold-induced thermogenesis 108 ± 23 → 289 ± 70 kcal/d (control 108 ± 31); body fat −0.70 ± 0.23 kg (−5.2 ± 1.9 %) vs +0.03 ± 0.21; weight and lean mass unchanged',
          referenceIds: ['yoneshiro2013'],
        },
        {
          label: 'Realistic energy per 2-hour session',
          value:
            '≈ 9 kcal (baseline heat rate 108) to 24 kcal (recruited 289); about 16 kcal for the meta-analytic +188 kcal/d rate; 3–12 kcal/h',
          note: 'Reported heat production in this field is a 24-hour-equivalent rate from a short measurement. The −0.70 kg fat loss (≈ 129 kcal/d over 42 days) is about 5–15 times more than this can explain.',
          referenceIds: ['romu2016', 'huo2022'],
        },
        {
          label: 'Meta-analysis of acute exposure at 16–19 °C vs 24 °C (10 RCTs)',
          value: '+188 kcal/d (139.7–237.1)',
          referenceIds: ['huo2022'],
        },
        {
          label: 'Separate trial (n = 28), 1 h/day for 6 weeks',
          value:
            'Resting metabolic rate fell in controls (1,841 → 1,795 kcal/24 h, p = 0.047); the cold group tended to rise (p = 0.052); between-group p = 0.008; brown fat volume rose 0.0175 → 0.0216 L (p = 0.049)',
          note: 'Plasticity is real but small.',
          referenceIds: ['romu2016'],
        },
        {
          label: '10 days at 14–15 °C in 8 people with type 2 diabetes',
          value: 'Peripheral insulin sensitivity +43 %; GLUT4 translocation up',
          referenceIds: ['hanssen2015'],
        },
        {
          label: 'One month sleeping at 19 °C (5 men)',
          value:
            'Brown fat abundance and activity up at 19 °C and down at 27 °C (reversible); diet-induced thermogenesis and after-meal insulin sensitivity up after cold acclimation; cold-induced thermogenesis unchanged',
          referenceIds: ['lee2014'],
        },
        {
          label: 'Experienced winter swimmers (2–3 dips a week)',
          value: 'Larger cold-induced thermogenesis response, lower core temperature, no brown fat activity',
          referenceIds: ['soberg2021'],
        },
      ],
      timeCourse: 'Recruitment shows at 10 days and 6 weeks; it reverses within about a month.',
      moderators: 'Baseline brown-fat status (lower with overweight), exposure temperature and duration.',
      grade: 'C',
      gradeReason:
        'The direction is consistent, but the trials are tiny and the main fat-loss result is a single unreplicated trial of 11 people.',
      status: 'contested',
      caveats:
        'The reading of the trial units as 24-hour-equivalent rates is very probable but the protocol text was not read (unverified). Rewarming and appetite compensation were not studied. Cardiovascular disease, Raynaud and cold urticaria are exclusions; unaccompanied open-water immersion carries cold-shock risk (general, unverified).',
      referenceIds: [
        'van2009',
        'yoneshiro2013',
        'ouellet2012',
        'sramek2000',
        'romu2016',
        'huo2022',
        'hanssen2015',
        'lee2014',
        'soberg2021',
      ],
      relatedMetricIds: [],
    },
    {
      id: '21-post-exercise-cold-immersion',
      title: 'Ice baths after lifting blunt the gains',
      category: 'recovery',
      summary:
        'Sitting in cold water (15 °C or colder) within about an hour of strength training reduced strength gains in a meta-analysis and blunted muscle growth signals in trials. Limb-only immersion had the larger effect. This is the one thermal lever where Vitals applies a conflict rule: it discounts muscle gain when cold immersion follows resistance training.',
      howModelled:
        'If limb immersion at 15 °C or colder follows resistance training two or more times a week, muscle and strength gains are scaled to 80 % of normal (range 50–100 %). Whole-body immersion is treated as no penalty. The planner avoids scheduling immersion within about 6 hours after resistance training when muscle gain is a top-two goal. Immersion is allowed on non-lifting days and after endurance sessions.',
      equation:
        'accretion factor f_CWI = 0.8 (0.5–1.0) for limb immersion ≤ 15 °C after ≥ 2 training sessions per week; 1.0 for whole-body immersion',
      keyNumbers: [
        {
          label: '12-week RCT, 21 active men, strength training twice a week',
          value:
            'Strength and muscle mass rose more with active recovery than 10-minute cold immersion (P < 0.05); type II fibre area +17 % and myonuclei per fibre +26 % only with active recovery',
          note: 'In a second study cold immersion blunted satellite-cell increases and p70S6K phosphorylation at 2–48 hours.',
          referenceIds: ['roberts2015'],
        },
        {
          label: 'Meta-analysis (10 studies, n = 170, 92 % male)',
          value:
            'Strength gain effect size −0.23 (−0.45 to −0.01); limb-only −0.31 (−0.61 to −0.01); whole-body −0.08 (−0.53 to +0.38, not significant)',
          referenceIds: ['grgic2023'],
        },
        {
          label: 'Review',
          value:
            'Immersion attenuates strength, power and hypertrophy adaptations to resistance training without harming endurance adaptations',
          referenceIds: ['petersen2021'],
        },
        {
          label: 'Recovery benefit for soreness',
          value: 'Cochrane review; numbers not extracted',
          referenceIds: ['bleakley2012'],
        },
        {
          label: 'Model check',
          value: 'Modelled strength-to-accretion ratio 0.65–0.95 of control',
        },
      ],
      timeCourse: 'A chronic effect over a 12-week trial; assumed to lapse when the immersion stops.',
      grade: 'B',
      gradeReason:
        'A randomised trial and a meta-analysis agree on the effect on strength; the effect on muscle size (grade C) is less certain.',
      status: 'proposed-fit',
      caveats: 'The 0.8 factor is proposed. The trials are mostly in men.',
      referenceIds: ['roberts2015', 'grgic2023', 'petersen2021', 'bleakley2012'],
      relatedMetricIds: ['rtMuscleGain', 'strength'],
    },
    {
      id: '21-late-eating',
      title: 'Eating the same meals four hours later raises hunger and lowers energy use',
      category: 'hormones',
      summary:
        'In a controlled study, delaying identical meals by about four hours raised hunger, raised the ratio of the hunger hormone ghrelin to leptin, and lowered daytime energy expenditure by about 59 kcal, roughly 5 %. It also shifted gene activity in fat tissue towards less fat release. It is one controlled crossover, so it is used as a check rather than a lever.',
      howModelled:
        'Late eating is a simulator input in the meal-timing model: a four-hour delay lowers waking energy expenditure by about 59 kcal a day and raises the hunger signal. Timing effects on weight beyond these are not added.',
      keyNumbers: [
        {
          label:
            'Overweight and obese adults, identical meals delayed by 250 min (sleep, light and activity controlled)',
          value:
            'Waking energy expenditure −59.4 ± 13.9 kcal per waking day (−5.03 %); hunger up (P < 0.0001); 24-h ghrelin-to-leptin ratio up (P = 0.006); 24-h core temperature down',
          note: 'Fat-tissue gene activity shifted towards lower fat release.',
          referenceIds: ['vujovic2022'],
        },
      ],
      grade: 'B',
      gradeReason: 'A well-controlled crossover with objective measures, but a single small trial.',
      status: 'proposed-fit',
      caveats:
        'Shift workers are exempt from the related planner rule. This rule is set out in the fasting and meal-timing topic; this article gives the cross-check.',
      referenceIds: ['vujovic2022'],
      relatedMetricIds: [],
    },
    {
      id: '21-alcohol-after-training',
      title: 'Alcohol after training lowers muscle protein synthesis',
      category: 'recovery',
      summary:
        'After a hard training session, a large alcohol dose (1.5 g per kg, about 12 standard drinks) lowered muscle protein synthesis by 24 % when taken with whey protein and by 37 % when taken with carbohydrate, compared with whey alone. Smaller doses were not measured, so no straight-line estimate is made below about 1 g per kg.',
      howModelled:
        'Alcohol after resistance training is a simulator input that scales post-training muscle protein synthesis down by the measured amounts. The planner never proposes alcohol within the recovery window.',
      keyNumbers: [
        {
          label: 'After concurrent training, 1.5 g/kg alcohol (≈ 12 ± 2 standard drinks)',
          value:
            'Muscle protein synthesis −24 % (with 25 g whey) and −37 % (with carbohydrate) vs whey alone; mTOR and p70S6K signalling lower',
          note: 'Lower doses were not measured. Extrapolating linearly below about 1 g/kg is not supported.',
          referenceIds: ['parr2014'],
        },
      ],
      grade: 'B',
      gradeReason: 'A well-controlled biopsy study, but at a single large dose.',
      status: 'established',
      referenceIds: ['parr2014'],
      relatedMetricIds: ['rtMuscleGain'],
    },
    {
      id: '21-dietary-nitrate',
      title: 'Beetroot and dietary nitrate: a small endurance and blood-pressure effect',
      category: 'performance',
      summary:
        'Nitrate, found in beetroot juice, slightly lengthens the time an athlete can keep going at a fixed effort. It does not clearly improve time-trial results. Beetroot juice also lowers blood pressure by about 3.6 mmHg systolic. Vitals treats it as an opt-in, event-day performance flag only.',
      howModelled:
        'Nitrate is an event-day input that adds a small performance multiplier to endurance sessions, using effect sizes from the trials. It plays no part in fat loss or body composition.',
      keyNumbers: [
        {
          label: 'Endurance, time to exhaustion',
          value:
            'ES 0.33 (0.15–0.50); time-trial and graded-test effects not significant (pooled −0.10, −0.27 to 0.06)',
          referenceIds: ['mcmahon2017'],
        },
        {
          label: 'Earlier meta-analysis',
          value: 'Time to exhaustion ES 0.79 (0.23–1.35); time trial 0.11 (−0.16 to 0.37)',
          referenceIds: ['hoon2013'],
        },
        {
          label: 'Nitrate- and polyphenol-rich foods',
          value: 'SMD 0.15 (trivial); no effect in females',
          referenceIds: ['dunienville2021'],
        },
        {
          label: 'Beetroot juice and blood pressure (22 trials)',
          value:
            'Systolic −3.55 (−4.55 to −2.54), diastolic −1.32 (−1.97 to −0.68) mmHg; 14 days or more −5.11 vs under 14 days −2.67 mmHg',
          referenceIds: ['bahadoran2017'],
        },
      ],
      grade: 'B',
      gradeReason:
        'Meta-analyses agree on a small time-to-exhaustion effect, though the time-trial effect is not significant.',
      status: 'established',
      referenceIds: ['mcmahon2017', 'hoon2013', 'dunienville2021', 'bahadoran2017'],
      relatedMetricIds: [],
    },
    {
      id: '21-beta-alanine',
      title: 'Beta-alanine helps efforts lasting 4–10 minutes',
      category: 'performance',
      summary:
        'Beta-alanine is a supplement taken for high-intensity performance. In trained young men it helped most on efforts lasting four to ten minutes. Evidence in women and older adults is weaker. It is an event-day performance input only.',
      howModelled:
        'Beta-alanine is an event-day performance multiplier. It has no effect on body composition.',
      keyNumbers: [
        {
          label: 'Trained young men',
          value:
            'ES 0.34 (0.02–0.67) at 4 weeks; efforts of 4–10 min ES 0.55 (0.07–1.04); 5.6–6.4 g/d ES 0.35 (0.09–0.62)',
          referenceIds: ['georgiou2024'],
        },
        {
          label: 'Women',
          value:
            'Time to exhaustion SMD 0.49 (0.20–0.79; k = 8); other outcomes imprecise; certainty very low',
          referenceIds: ['gu2026'],
        },
        {
          label: 'Older adults',
          value: 'Exercise capacity may improve; strength and function do not',
          referenceIds: ['de2025'],
        },
      ],
      grade: 'B',
      gradeReason:
        'A meta-analysis of trials in trained men agrees on a moderate effect for mid-length efforts, with weaker evidence in other groups.',
      status: 'established',
      referenceIds: ['georgiou2024', 'gu2026', 'de2025'],
      relatedMetricIds: [],
    },
    {
      id: '21-citrulline',
      title: 'Citrulline malate: a small gain in high-intensity strength work',
      category: 'performance',
      summary:
        'Citrulline malate slightly improved high-intensity strength and power work in a small meta-analysis and lowered perceived exertion and soreness afterwards. Citrulline-rich foods showed no endurance effect. It is an event-day performance input only.',
      howModelled: 'Citrulline is an event-day performance multiplier with no body-composition effect.',
      keyNumbers: [
        {
          label: 'High-intensity strength and power (12 studies, n = 198, I² 0 %)',
          value: 'SMD 0.20 (0.01–0.39)',
          referenceIds: ['trexler2019'],
        },
        {
          label: 'Citrulline-rich foods',
          value: 'Endurance SMD −0.03 (not significant)',
          referenceIds: ['dunienville2021'],
        },
        {
          label: 'Perceived exertion and soreness (13 studies)',
          value: 'Lower rating of perceived exertion and 24–48 h muscle soreness',
          referenceIds: ['rhim2020'],
        },
      ],
      grade: 'B',
      gradeReason: 'Consistent but small meta-analytic effects with low heterogeneity.',
      status: 'established',
      referenceIds: ['trexler2019', 'dunienville2021', 'rhim2020'],
      relatedMetricIds: [],
    },
    {
      id: '21-sodium-bicarbonate',
      title: 'Sodium bicarbonate: helps short, very hard efforts',
      category: 'performance',
      summary:
        'Sodium bicarbonate is a supplement taken for high-intensity performance. An umbrella review found moderate-quality evidence for better peak and mean power in the Wingate all-out cycling test and better Yo-Yo test results, and low-quality evidence for efforts of about 45 seconds to 8 minutes. Stomach upset is the usual cost. It is an event-day performance input only.',
      howModelled:
        'Bicarbonate is an event-day performance multiplier. It has no effect on body composition, and stomach tolerance should be tested in training first.',
      keyNumbers: [
        {
          label: 'Umbrella of 8 reviews',
          value:
            'Moderate-quality evidence for Wingate peak and mean power and for the Yo-Yo test; low-quality for efforts of about 45 s to 8 min, muscle endurance and 2,000 m rowing; effect sizes 0.09–1.26',
          referenceIds: ['grgic2021'],
        },
        {
          label: 'Team-sport high-intensity intermittent exercise',
          value: 'g 0.23 (0.07–0.39); 95 % prediction interval −0.22 to 0.68; low certainty',
          referenceIds: ['ge2026'],
        },
      ],
      grade: 'B',
      gradeReason:
        'An umbrella review of several meta-analyses agrees on moderate evidence for the shortest, hardest efforts.',
      status: 'established',
      caveats:
        'Gastrointestinal distress is the usual cost (could not be confirmed against the original paper).',
      referenceIds: ['grgic2021', 'ge2026'],
      relatedMetricIds: [],
    },
    {
      id: '21-mct-oil',
      title: 'MCT oil: a small weight difference and a mild ketone rise, not a fat burner',
      category: 'fuel',
      summary:
        'Medium-chain triglyceride (MCT) oil is a fat supplement. Replacing ordinary long-chain fats with it was associated with a loss of about 0.5–0.7 kg in trials, some with commercial bias. Its ketone effect goes into the ketone model as an ingested input. It gets no fat-burning credit.',
      howModelled:
        'MCT raises blood ketones as an ingested input in the ketone model. It carries no fat-loss credit.',
      keyNumbers: [
        {
          label: 'MCT replacing long-chain fat (13 trials, n = 749; commercial bias flagged)',
          value:
            'Weight −0.51 kg (−0.80 to −0.23); waist −1.46 cm; total body fat SMD −0.39; visceral fat SMD −0.55',
          referenceIds: ['mumme2015'],
        },
        {
          label: 'Second meta-analysis (11 trials, low to moderate quality)',
          value: 'Weight −0.69 kg (−1.1 to −0.28); body fat −0.89 kg (−1.27 to −0.51)',
          referenceIds: ['bueno2015'],
        },
      ],
      grade: 'C',
      gradeReason: 'Small effects with low to moderate quality trials and a commercial-bias flag.',
      status: 'contested',
      caveats: 'The ketone contribution is handled by the ketosis model.',
      referenceIds: ['mumme2015', 'bueno2015'],
      relatedMetricIds: ['bhb'],
    },
    {
      id: '21-exogenous-ketones',
      title: 'Ketone drinks raise blood ketones but not performance',
      category: 'fuel',
      summary:
        'Ketone esters and salts raise blood ketones as an ingested input and lower blood glucose acutely. In a trial of professional cyclists a ketone diester made a 31 km time trial about 2 % slower, with stomach discomfort and higher perceived effort. The ketone level goes into the model as an ingested input, with no credit for autophagy.',
      howModelled:
        "Exogenous ketones raise blood ketones as an ingested input, which does not feed the body's own ketone production. The autophagy signal ignores them. They carry energy, so they technically end a zero-energy fast.",
      keyNumbers: [
        {
          label: 'Acute glucose effect (43 trials)',
          value: 'Glucose-lowering; pooled magnitude not extracted',
          referenceIds: ['falkenhain2022'],
        },
        {
          label: 'Ketone diester before a ≈ 31 km time trial (10 professional cyclists)',
          value: '2 ± 1 % impairment, with gut discomfort and higher perceived exertion',
          referenceIds: ['leckey2017'],
        },
        {
          label: 'Blood pressure (10 studies, n = 187)',
          value: 'Systolic SMD −0.14 (−0.40 to 0.11); heart rate tendency up',
          referenceIds: ['marcottechenard2024'],
        },
        {
          label: 'Cognition (29 protocols, n = 1,117)',
          value: 'SMD 0.29 (0.16–0.41)',
          referenceIds: ['bonnechere2026'],
        },
        {
          label: 'Muscle signalling',
          value:
            'Ketone esters raise post-exercise muscle mTORC1 signalling, the opposite direction to autophagy',
          note: 'From the autophagy topic.',
        },
      ],
      grade: 'B',
      gradeReason:
        'Randomised trials and meta-analyses agree on the acute effects; the performance result comes from a small trial.',
      status: 'established',
      referenceIds: ['falkenhain2022', 'leckey2017', 'marcottechenard2024', 'bonnechere2026'],
      relatedMetricIds: ['bhb'],
    },
    {
      id: '21-ad-lib-intake-environment',
      title: 'What you eat and how it is served changes free-eating intake',
      category: 'hormones',
      summary:
        'When people eat freely, how food is served changes how much they eat. Lower energy density (more water and vegetables per bite), a smaller plate, fewer ultra-processed foods and solid instead of liquid calories all lowered intake in controlled studies. These effects work only when intake is not prescribed. In a fixed-calorie plan they change hunger, not energy.',
      howModelled:
        'These are inputs used only in the free-eating mode of the simulator. Energy density, the share of ultra-processed energy, liquid calories and portion size each shift intake by the amounts below. Liquid calories count at about 100 % because people barely compensate for them. Intake set by the user is never silently overridden.',
      equation:
        'ultra-processed effect on intake = +6.4 kcal/d per percentage point of ultra-processed energy share (proposed linear fit)',
      keyNumbers: [
        {
          label: 'Lower energy density (38 RCTs, 15 single-meal; contrast median 1.1 vs 1.5 kcal/g)',
          value:
            '−223 kcal per tested intake period (95 % CI −259.7 to −186.0), with the amount of food unchanged',
          note: 'Daily level: SMD −1.002 (−1.266 to −0.745) with minimal compensation at other meals (31 studies, 90 effects); weight −0.7 kg (−1.34 to +0.04, not significant; 5 studies).',
          referenceIds: ['klos2023', 'robinson2022'],
        },
        {
          label: 'Water inside food vs as a drink',
          value:
            'Water baked into the food reduced lunch intake (1,209 vs about 1,650 kJ); the same water as a beverage did not',
          referenceIds: ['rolls1999'],
        },
        {
          label: 'Liquid vs solid calories',
          value:
            'A solid carbohydrate load was compensated at 118 %; liquid (soda) at −17 %; weight and BMI rose only in the liquid period',
          note: 'Period length unverified.',
          referenceIds: ['dimeglio2000'],
        },
        {
          label: 'Sugary drinks swapped for low- or no-calorie drinks (17 RCTs, n = 1,733)',
          value: 'Weight −1.06 kg (−1.71 to −0.41); BMI −0.32; body fat −0.60 %',
          note: 'Water instead of sugary drinks: no significant effect (low certainty).',
          referenceIds: ['mcglynn2022'],
        },
        {
          label:
            'Ultra-processed vs unprocessed diet (20 adults, 14-day inpatient crossover, matched for presented calories, energy density, macronutrients, sugar, sodium and fibre)',
          value:
            'Free-eating intake +508 ± 106 kcal/d (carbohydrate +280 ± 54, fat +230 ± 53, protein −2 ± 12); weight +0.9 ± 0.3 vs −0.9 ± 0.3 kg',
          note: 'The linear model divides 508 kcal by about 80 % ultra-processed share (the 80 % is unverified); intake +459 ± 105 kcal/d in the final week. One trial, two weeks.',
          referenceIds: ['hall2019'],
        },
        {
          label: 'Portion, package or tableware size (58 studies, n = 6,603)',
          value:
            'Larger sizes raised consumption SMD 0.38 (0.29–0.46); adults 0.46 (0.40–0.52), children 0.21 (0.10–0.31)',
          note: 'If sustained across the whole diet, about −144 to −228 kcal/d (8.5–13.5 % of 1,689 kcal).',
          referenceIds: ['hollands2015'],
        },
        {
          label: 'Pre-meal water, 500 mL',
          value:
            '12 weeks on a hypocaloric diet: about 2 kg greater loss; test-meal intake 498 vs 541 kcal at baseline (P = 0.009), 480 vs 506 at week 12 (P = 0.069); primary care: −1.3 kg (−2.4 to −0.1)',
          note: 'Acute intake effect −43 kcal at 500 mL; habituates to about −26 kcal by week 12.',
          referenceIds: ['dennis2010', 'parretti2015'],
        },
        {
          label: 'Eating rate',
          value:
            'Slower eating lowered intake, SMD 0.45 (0.25–0.65; 22 studies), with no effect on hunger up to 3.5 h; fast eaters have higher BMI (+1.78 kg/m²) in observational data only',
          referenceIds: ['robinson2014', 'ohkuma2015'],
        },
      ],
      grade: 'B',
      gradeReason:
        'Meta-analyses agree on the intake effects, but they come from studies lasting one meal to two weeks, and long-term compensation is unknown.',
      status: 'proposed-fit',
      caveats:
        'Compensation over months is unknown. Underweight, frailty and high-energy athletes are exclusions for low-energy-density eating. Fluid restriction, heart or kidney failure and hyponatraemia risk are exclusions for water preloading (general, unverified).',
      referenceIds: [
        'klos2023',
        'robinson2022',
        'rolls1999',
        'dimeglio2000',
        'mcglynn2022',
        'hall2019',
        'hollands2015',
        'dennis2010',
        'parretti2015',
        'robinson2014',
        'ohkuma2015',
      ],
      relatedMetricIds: [],
    },
    {
      id: '21-adherence-shift',
      title: 'Habits that make a plan easier to keep',
      category: 'hormones',
      summary:
        'Self-weighing, food logging, meal replacements and flexible rules improve weight loss mainly by making a plan easier to stick to, not by changing physiology. Vitals turns them into a small shift in the chance that each day follows the plan, capped so that habits together cannot promise more than a modest gain. The mapping from kilograms to a daily chance of sticking to the plan is a rough proposal.',
      howModelled:
        "The engine draws each day's intake as the prescription with a probability p (monthly adherence) and a random deviation otherwise, so long-run loss is roughly proportional to p. Each habit adds a small shift to p. The total shift is capped at +0.15.",
      keyNumbers: [
        {
          label: 'Self-monitoring package (daily weighing plus food logging on at least 5 days a week)',
          value:
            'Shift in adherence +0.10 (0.05–0.15); anchors −1.7 to −2.9 kg and −0.52 kg per weekly food record',
          note: 'Proposed, grade D for the mapping. Summed shifts from all habits are capped at +0.15.',
          referenceIds: ['madigan2015', 'berry2021', 'hollis2008'],
        },
        {
          label: 'Self-weighing as a single strategy',
          value:
            '−0.5 kg (−1.3 to +0.3; one study, not significant); added to multi-component programmes −1.7 kg (−2.6 to −0.8; 4 trials); programmes containing self-weighing vs minimal control −3.4 kg (−4.2 to −2.6; 15 trials)',
          note: 'Daily vs weekly weighing no difference. No association with affect or disordered eating on average; a small negative association with psychological functioning.',
          referenceIds: ['madigan2015', 'benn2016'],
        },
        {
          label: 'Food logging in a behavioural trial (n = 1,685, 6 months, mean −5.8 kg)',
          value:
            'Each additional weekly food record −0.52 kg (−0.67 to −0.37); each session attended −0.29 kg; each 100 min/week of moderate activity −0.76 kg',
          note: 'Regression within an RCT (observational).',
          referenceIds: ['hollis2008'],
        },
        {
          label: 'Digital self-monitoring of diet and activity (12 RCTs)',
          value:
            'Weight −2.87 kg (−3.78 to −1.96); calorie intake −182 kcal/d (−305 to −59); moderate activity SMD 0.44',
          referenceIds: ['berry2021'],
        },
        {
          label: 'Meal replacement of at least one meal a day',
          value:
            'Hedges g 0.261 (0.156–0.365; 22 studies, n = 1,982) vs food-based low-energy diets; at least 60 % of energy from replacements g 0.545 (0.260–0.830); shift +0.05 (0–0.10)',
          note: 'Long-term benefit is inconclusive (7 studies, 4 with larger loss). The mechanism is menu structure and fewer decisions.',
          referenceIds: ['min2021', 'lopez2011'],
        },
        {
          label: 'Flexible vs rigid restraint',
          value:
            'Flexible control linked to lower disinhibition, lower BMI and a higher chance of successful weight reduction over a year; shift +0.03 (0–0.05; grade D)',
          note: 'Validation and cohort data; no randomised trial.',
          referenceIds: ['westenhoefer1999'],
        },
        {
          label: 'Pre-meal water',
          value: 'Shift +0.03 (0–0.05), from −1.3 to −2 kg over about 12 weeks',
          referenceIds: ['dennis2010', 'parretti2015'],
        },
        {
          label: 'Not modelled',
          value: 'Financial incentives (SMD 0.18 during, 0.03 after) and social support (inconsistent)',
          referenceIds: ['hondmann2026', 'jensen2024'],
        },
      ],
      grade: 'D',
      gradeReason:
        'The individual studies are mostly randomised trials, but converting kilograms into a daily adherence probability is a coarse assumption of our own.',
      status: 'proposed-fit',
      caveats:
        'People with an eating-disorder history are offered an opt-out from self-weighing and logging (general, unverified).',
      referenceIds: [
        'madigan2015',
        'berry2021',
        'hollis2008',
        'benn2016',
        'min2021',
        'lopez2011',
        'westenhoefer1999',
        'dennis2010',
        'parretti2015',
        'hondmann2026',
        'jensen2024',
      ],
      relatedMetricIds: ['adherence'],
    },
    {
      id: '21-lever-conflicts-and-synergies',
      title: 'How the levers combine: conflicts and synergies',
      category: 'performance',
      summary:
        'Some levers work against each other, and the Planner has to know which. Late caffeine cancels the benefit of extra sleep. Cold immersion after lifting blunts muscle gain. Alcohol after training lowers recovery. Creatine adds scale weight that is not fat. A few pairs have never been tested together, and Vitals treats them as independent.',
      howModelled:
        'The Planner checks these pairs when it builds a schedule. Sleep is evaluated first, because it changes free-eating intake and the lean share of loss. The caffeine cut-off is then checked against the sleep window. Cold immersion is excluded within about 6 hours of resistance training when muscle gain is a top-two goal. No habit block may lift the adherence shift above +0.15.',
      keyNumbers: [
        {
          label: 'Caffeine and sleep extension',
          value: 'A dose inside the cut-off costs about 45 min of total sleep, cancelling a 1.2 h extension',
          referenceIds: ['gardiner2023', 'tasali2022'],
        },
        {
          label: 'Cold-water immersion and resistance training',
          value: 'Strength ES −0.23; fibre-area gain lost in one RCT',
          referenceIds: ['grgic2023', 'roberts2015'],
        },
        {
          label: 'Alcohol and recovery',
          value: 'Muscle protein synthesis −24 to −37 % at 1.5 g/kg',
          referenceIds: ['parr2014'],
        },
        {
          label: 'Creatine and scale weight',
          value: '+0.9 kg water at full loading; shown as expected, not as fat gain',
          referenceIds: ['powers2003'],
        },
        {
          label: 'Creatine and resistance training',
          value: '+1.10 kg with training vs +0.68 kg overall; no effect on mixed exercise',
          referenceIds: ['delpino2022'],
        },
        {
          label: 'Sleep extension and late eating',
          value: 'No trial has combined them; treated as additive with no interaction term',
          referenceIds: ['tasali2022', 'vujovic2022'],
        },
        {
          label: 'Omega-3 and atrial fibrillation or anticoagulants',
          value: 'Atrial fibrillation HR 1.25; excluded',
          referenceIds: ['gencer2021'],
        },
        {
          label: 'SGLT2 inhibitors and zero-intake or ketogenic blocks',
          value: 'Euglycaemic ketoacidosis risk; those blocks are blocked',
          referenceIds: ['confederat2026'],
        },
        {
          label: 'Sauna on fasting days',
          value:
            'Blocked on fast days of 24 h or more and on the first day of very-low-carbohydrate eating (heat load, sweat and sodium losses; general, unverified)',
        },
        {
          label: 'Cold and sauna together',
          value: 'Independent; winter swimmers combine both with no interaction quantified',
          referenceIds: ['soberg2021'],
        },
      ],
      grade: 'C',
      gradeReason:
        'Each conflict rests on graded evidence cited elsewhere in this topic, but several pairs are untested in combination.',
      status: 'proposed-fit',
      caveats: 'Combination rules are Vitals design choices layered on the evidence.',
      referenceIds: [
        'gardiner2023',
        'tasali2022',
        'grgic2023',
        'roberts2015',
        'parr2014',
        'powers2003',
        'delpino2022',
        'vujovic2022',
        'gencer2021',
        'confederat2026',
        'soberg2021',
      ],
      relatedMetricIds: [],
    },
  ],
  myths: [
    {
      id: '21-myth-green-tea',
      claim: 'Green tea extract (EGCG) burns fat.',
      verdict: 'not-supported',
      explanation:
        'A Cochrane review found −0.04 kg (−0.5 to +0.4) outside Japan, in 6 studies with 532 people over 12–13 weeks. Japanese trials showed −0.2 to −3.5 kg but could not be pooled. An older meta-analysis found −1.31 kg, depending on habitual caffeine intake and ethnicity. As an add-on to exercise the effect on weight was small (SMD −0.30).',
      referenceIds: ['jurgens2012', 'hursel2009', 'gholami2024'],
    },
    {
      id: '21-myth-weight-loss-supplements',
      claim: 'Glucomannan, chitosan, CLA, garcinia or carnitine supplements produce meaningful weight loss.',
      verdict: 'not-supported',
      explanation:
        'Chitosan −1.84 kg (−2.79 to −0.88), glucomannan −1.27 kg (−2.45 to −0.09) and CLA −1.08 kg (−1.61 to −0.55): none reached the 2.5 kg clinical threshold. Of 315 trials of 14 supplements and therapies, only 52 (16.5 %) were low-risk and sufficient. Garcinia gave −0.88 kg (−1.75 to 0.00) with twice as many gastrointestinal side effects; L-carnitine −1.33 kg (−2.09 to −0.57), shrinking with duration.',
      referenceIds: ['bessell2021', 'batsis2021', 'onakpoya2011', 'pooyandjoo2016', 'sood2008'],
    },
    {
      id: '21-myth-omega-3-fat-loss',
      claim: 'Omega-3 supplements melt body fat.',
      verdict: 'not-supported',
      explanation:
        'Weight change was 0.00 kg (−0.42 to +0.43). The benefit is in triglycerides and blood pressure, and the risk of atrial fibrillation rises above 1 g a day.',
      referenceIds: ['zhang2017', 'gencer2021'],
    },
    {
      id: '21-myth-vitamin-d',
      claim: 'Vitamin D supplements build muscle or help you lose fat.',
      verdict: 'not-supported',
      explanation:
        'In people who are not deficient there was no effect on body weight, fat mass, percentage fat or lean mass (BMI SMD −0.097, −0.210 to +0.016; 18 trials). Strength gains appeared only when blood levels were low (below about 25–30 nmol/L) and in people aged 65 or over.',
      referenceIds: ['pathak2014', 'beaudart2014', 'stockton2011'],
    },
    {
      id: '21-myth-probiotics',
      claim: 'Probiotics help you lose weight.',
      verdict: 'not-supported',
      explanation:
        'Weight changed by −0.26 kg (−0.75 to +0.23, not significant) across 20 trials in 1,411 people with overweight or obesity and metabolic disease. A 2026 meta-analysis of 12 mostly East-Asian trials found −0.52 kg (−0.90 to −0.13). Effects are strain-specific and small.',
      referenceIds: ['perna2021', 'liu2026'],
    },
    {
      id: '21-myth-berberine',
      claim: 'Berberine is a natural weight-loss drug.',
      verdict: 'not-supported',
      explanation:
        'Body weight changed by −0.11 kg (−0.99 to +0.76, not significant) across 10 studies. Its glucose-lowering effect in type 2 diabetes is real and drug-like (fasting glucose −0.82 mmol/L, HbA1c −0.63 %), which is why it can interact with glucose-lowering medicines.',
      referenceIds: ['xiong2020', 'xie2022'],
    },
    {
      id: '21-myth-hmb',
      claim: 'HMB builds muscle in young, trained lifters.',
      verdict: 'not-supported',
      explanation:
        'In young adults doing resistance training there was no improvement in fat-free mass or strength (11 of 14 eligible studies analysed, n = 302). In older adults it improved function (handgrip SMD 0.24, short physical performance battery 0.54) with no effect on lean mass, fat or weight.',
      referenceIds: ['jakubowski2020', 'garciaalonso2025'],
    },
    {
      id: '21-myth-nad-boosters',
      claim: 'NAD⁺ boosters (NMN or nicotinamide riboside) improve metabolism and slow ageing.',
      verdict: 'not-supported',
      explanation:
        'Eight randomised trials (n = 342) found no significant effect on fasting glucose, insulin, HbA1c, insulin resistance or lipids. In older adults there was no effect on skeletal-muscle index, grip strength or walking speed. One 10-week trial in postmenopausal prediabetic women did raise muscle insulin sensitivity, and has not been replicated.',
      referenceIds: ['chen2024', 'prokopidis2025', 'yoshino2021'],
    },
    {
      id: '21-myth-resveratrol',
      claim: 'Resveratrol improves insulin sensitivity and training results.',
      verdict: 'not-supported',
      explanation:
        'It had no effect on glycaemic measures in people without diabetes, and improved glucose, insulin and HbA1c only in diabetes (11 trials, n = 388). In 27 older men, 250 mg a day during 8 weeks of high-intensity training made the gain in peak oxygen uptake 45 % smaller than placebo.',
      referenceIds: ['liu2014', 'gliemann2013'],
    },
    {
      id: '21-myth-spermidine',
      claim: 'Spermidine switches on autophagy and protects the brain.',
      verdict: 'not-supported',
      explanation:
        'A 12-month trial in 100 older adults with subjective cognitive decline found no effect on mnemonic discrimination (−0.03; −0.11 to 0.05). A 30-person pilot reported better memory (d = 0.77, 0.0–1.53). No study has measured autophagy in people.',
      referenceIds: ['schwarz2022', 'wirth2018'],
    },
    {
      id: '21-myth-antioxidants',
      claim: 'High-dose antioxidants help you recover and adapt to training.',
      verdict: 'not-supported',
      explanation:
        'In 54 adults over 11 weeks of endurance training, 1,000 mg vitamin C plus 235 mg vitamin E left the gain in peak oxygen uptake unchanged (+8 % in both groups) but blunted the rise in mitochondrial markers (COX4 and PGC-1α rose +59 ± 97 % and +19 ± 51 % on placebo).',
      referenceIds: ['paulsen2014'],
    },
    {
      id: '21-myth-ketone-esters-performance',
      claim: 'Ketone esters are a performance hack for endurance athletes.',
      verdict: 'not-supported',
      explanation:
        'In 10 professional cyclists, a ketone diester made a time trial of about 31 km 2 ± 1 % slower, with gut discomfort and higher perceived exertion.',
      referenceIds: ['leckey2017'],
    },
    {
      id: '21-myth-fasted-cardio',
      claim: 'Fasted morning cardio burns more fat over time.',
      verdict: 'not-supported',
      explanation:
        'More fat is oxidised during the session (+3.08 g, 0.79–5.38; 27 studies, n = 273) but blood fatty acids did not differ and no long-term outcome was pooled. In a volume-equated 4-week trial of 20 young women on a low-energy diet, both groups lost fat and did not differ.',
      referenceIds: ['vieira2016', 'schoenfeld2014'],
    },
    {
      id: '21-myth-carb-back-loading',
      claim: 'Eating carbohydrate only after evening training (carb back-loading) changes body composition.',
      verdict: 'unproven',
      explanation:
        'A title search of Europe PMC on 2026-09-30 for carb back-loading returned no records. No randomised trial was located.',
      referenceIds: [],
    },
    {
      id: '21-myth-evening-carbs',
      claim: 'Eating most of your carbohydrate at dinner is metabolically special for fat loss.',
      verdict: 'unproven',
      explanation:
        'One 6-month trial in 78 obese police officers on a low-energy diet found greater loss of weight, waist and fat mass when carbohydrate came mostly at dinner. It was single-centre, the size is not in the abstract, and there is no replication or meta-analysis. Equal-energy, equal-protein comparisons elsewhere show no benefit from the order of eating. The clearer effect is on sleep: a high-glycaemic meal 4 h before bed shortened sleep onset to 9.0 ± 6.2 min versus 17.5 ± 6.2 for a low-glycaemic meal.',
      referenceIds: ['sofer2011', 'afaghi2007'],
    },
    {
      id: '21-myth-protein-breakfast',
      claim: 'A high-protein breakfast helps weight loss.',
      verdict: 'not-supported',
      explanation:
        'In overweight, breakfast-skipping late-adolescent girls a higher-protein breakfast raised fullness, lowered ghrelin, raised PYY and cut evening high-fat snacking, but daily energy intake did not differ. Skipping breakfast three or more days a week goes with a higher chance of overweight or obesity (RR 1.11, 1.04–1.19), in observational data only.',
      referenceIds: ['leidy2013', 'wicherski2021'],
    },
    {
      id: '21-myth-caffeine-fat-burner',
      claim: 'Caffeine is a fat burner.',
      verdict: 'not-supported',
      explanation:
        'A rise of about 150 kcal a day needed about 600 mg of caffeine a day. A dose-response meta-analysis of caffeine and weight or fat could not be interpreted (I² 91–94 %). Late caffeine costs about 45 minutes of sleep.',
      referenceIds: ['dulloo1989', 'tabrizi2019', 'gardiner2023'],
    },
    {
      id: '21-myth-capsaicin',
      claim: 'Chilli (capsaicin) boosts weight loss.',
      verdict: 'not-supported',
      explanation:
        'Weight changed by −0.51 kg (−0.86 to −0.15) and BMI by −0.25 (−0.35 to −0.15) across 15 trials in 762 people. Capsinoids over 6 weeks raised cold-induced heat production to about 200 versus about 81 kcal/d in men with little brown fat, in reported units that carry the same 24-hour-rate caveat as the cold-exposure entry.',
      referenceIds: ['zhang2023', 'yoneshiro2013'],
    },
    {
      id: '21-myth-apple-cider-vinegar',
      claim: 'Apple-cider vinegar helps you lose weight.',
      verdict: 'unproven',
      explanation:
        'A meta-analysis found lower fasting glucose (−7.97 mg/dL), HbA1c (−0.50) and total cholesterol (−6.06 mg/dL) but no effect on LDL, HDL, insulin or insulin resistance, and in healthy people fasting glucose and HDL rose. One Japanese trial in obese adults reported lower weight and waist at 15 or 30 mL a day, with magnitudes unverified in the abstract. A systematic review called the evidence insufficient.',
      referenceIds: ['hadi2021', 'kondo2009', 'launholt2020'],
    },
    {
      id: '21-myth-collagen-muscle',
      claim: 'Collagen peptides are enough protein to build muscle.',
      verdict: 'unproven',
      explanation:
        'The muscle-performance signal is weak and inconsistent (SMD 0.60, 0.05–1.15; bone density gains with I² 80 %). The replicated benefit is for skin: 19 trials (n = 1,125) and 26 trials (n = 1,721) found better hydration and elasticity.',
      referenceIds: ['sun2025', 'de2021', 'pu2023'],
    },
    {
      id: '21-myth-mct-fat-burner',
      claim: 'MCT oil burns fat.',
      verdict: 'unproven',
      explanation:
        'Replacing long-chain fat with MCT oil was linked to −0.5 to −0.7 kg in trials of low to moderate quality, with a commercial-bias flag. The ketone rise is handled as an ingested input, with no fat-burning credit.',
      referenceIds: ['mumme2015', 'bueno2015'],
    },
    {
      id: '21-myth-standing-desks',
      claim: 'Standing or walking desks help you lose weight.',
      verdict: 'not-supported',
      explanation:
        'Standing burns about 0.15 kcal a minute more than sitting. Real-world desks cut sitting by 57–100 minutes a day, worth 9–15 kcal a day. Treadmill desks had unclear or inconsistent effects on sitting.',
      referenceIds: ['saeidifard2018', 'shrestha2018'],
    },
    {
      id: '21-myth-sauna-growth-hormone',
      claim: 'Sauna spikes growth hormone, so it builds muscle or burns fat.',
      verdict: 'not-supported',
      explanation:
        'Growth hormone rose ×16 with twice-daily 80 °C sauna, but the response declined after day 3, and testosterone, TSH and thyroid hormones did not change. There is no body-composition outcome.',
      referenceIds: ['leppaluoto1986'],
    },
    {
      id: '21-myth-sauna-heart',
      claim: 'Sauna prevents heart attacks and adds years to life.',
      verdict: 'unproven',
      explanation:
        'Cohorts show sudden cardiac death HR 0.37 for 4–7 versus 1 sessions a week, but they are confounded by fitness and healthy-user effects, and joint models show fitness carries most of the signal. The one trial found systolic pressure −8 mmHg against exercise alone in 47 people.',
      referenceIds: ['laukkanen2015', 'kunutsor2018', 'lee2022'],
    },
    {
      id: '21-myth-cold-fat-burn',
      claim: 'Cold showers and ice baths burn fat through brown fat.',
      verdict: 'not-supported',
      explanation:
        'Recruited brown fat raised cold-induced heat by the equivalent of about 9–24 kcal per two-hour session when read as a 24-hour rate. The reported 0.7 kg fat loss is five to fifteen times more than that supports, and it rests on one trial of 11 people. Severe cold (+250 kcal in 3 hours) needs shivering-level exposure.',
      referenceIds: ['yoneshiro2013', 'ouellet2012', 'romu2016', 'huo2022'],
    },
    {
      id: '21-myth-ice-bath-after-lifting',
      claim: 'Ice baths after lifting help muscles grow.',
      verdict: 'not-supported',
      explanation:
        'Cold immersion attenuated strength gains (effect size −0.23, −0.45 to −0.01). In one trial type II fibre area rose 17 % with active recovery and not with cold immersion.',
      referenceIds: ['roberts2015', 'grgic2023'],
    },
    {
      id: '21-myth-protein-cycling',
      claim: 'Protein cycling or fat-fast days switch on autophagy.',
      verdict: 'unproven',
      explanation:
        'A Europe PMC search for protein cycling on 2026-09-30 found 4 hits and none was a human dietary study (yeast and receptor biology). No human evidence was located.',
      referenceIds: [],
    },
    {
      id: '21-myth-meal-prep',
      claim: 'Meal prepping or a consistent weekday-weekend routine improves weight loss.',
      verdict: 'unproven',
      explanation:
        'Europe PMC title searches on 2026-09-30 for weekend or consistency dieting and weight change returned no records, and no randomised trial or meta-analysis quantifying meal prepping was located.',
      referenceIds: [],
    },
    {
      id: '21-myth-exercise-snacks-fat',
      claim: 'Exercise snacks burn fat or lower blood pressure.',
      verdict: 'not-supported',
      explanation:
        'Meta-analyses found gains in fitness but no effect on body composition or blood pressure in one review; a second found lower total and LDL cholesterol but no change in body weight, body fat, HDL or triglycerides.',
      referenceIds: ['rodriguez2026', 'wan2025'],
    },
    {
      id: '21-myth-melatonin-body',
      claim: 'Melatonin improves body composition.',
      verdict: 'unproven',
      explanation:
        'Melatonin shortened sleep onset by 7.06 minutes (−9.75 to −4.37) and lengthened sleep by 8.25 minutes (1.74–14.75) across 19 studies (n = 1,683). There are no body-composition data.',
      referenceIds: ['ferraciolioda2013'],
    },
    {
      id: '21-myth-money-and-support',
      claim: 'Money or social support guarantee weight-loss results.',
      verdict: 'not-supported',
      explanation:
        'Social-support programmes gave inconsistent effects with low certainty (24 trials, n = 4,919). Financial incentives cut weight by 2.36 kg (1.80–2.93) in adults with chronic conditions, but the effect size fell from SMD 0.18 during the incentive to 0.03 (not significant) after it ended.',
      referenceIds: ['jensen2024', 'hondmann2026', 'gong2018'],
    },
    {
      id: '21-myth-ashwagandha',
      claim: 'Ashwagandha builds muscle and balances hormones.',
      verdict: 'unproven',
      explanation:
        'A Bayesian meta-analysis of 13 studies favoured ashwagandha for performance but the evidence is low quality and the size was not extracted. Sleep and anxiety benefits are documented (sleep SMD −0.59, −0.75 to −0.42; anxiety SMD −1.55, −2.37 to −0.74). A case series describes liver injury with jaundice after 2–12 weeks, resolving in 1–5 months.',
      referenceIds: ['bonilla2021', 'cheah2021', 'akhgarjand2022', 'bjornsson2020'],
    },
    {
      id: '21-myth-ramadan-dry-fasting',
      claim: 'Ramadan-style dry fasting produces lasting weight loss.',
      verdict: 'not-supported',
      explanation:
        'Across 85 studies (n = 4,176) weight fell by 1.02 kg (1.16 to 0.88), and body fat percentage fell 1.46 points (2.57 to 0.35) in overweight and obese people, with none in people of normal weight. Values returned towards baseline 2–5 weeks after Ramadan. Dry fasting is excluded from Vitals; only the water-allowed eating-window version is modelled.',
      referenceIds: ['jahrami2020', 'fernando2019', 'kul2014'],
    },
    {
      id: '21-myth-10000-steps',
      claim: '10,000 steps a day is the magic number.',
      verdict: 'oversimplified',
      explanation:
        'The mortality benefit levels off at 6,000–8,000 steps a day at age 60 or over and 8,000–10,000 below 60, and 7,000 versus 2,000 steps gives HR 0.53. The 10,000-step goal did predict the effects in pedometer trials, but the curve is not a threshold.',
      referenceIds: ['paluch2022', 'ding2025', 'bravata2007'],
    },
    {
      id: '21-myth-25-30g-protein',
      claim: 'The body can only use 25–30 g of protein at a time.',
      verdict: 'oversimplified',
      explanation:
        'The ceiling depends on the food form and context. Even distribution raised muscle protein synthesis in a short crossover but not consistently in muscle mass, and showed no difference in healthy older adults.',
      referenceIds: ['mamerow2014', 'justesen2022', 'jespersen2021', 'schoenfeld2013', 'schoenfeld2018'],
    },
    {
      id: '21-myth-meal-replacements-magic',
      claim: 'Meal replacements are a magic bullet for weight loss.',
      verdict: 'oversimplified',
      explanation:
        'Compared with food-based diets the effect was Hedges g 0.26, or 0.545 when at least 60 % of energy came from replacements. Long-term benefit beyond a year was inconclusive.',
      referenceIds: ['min2021', 'lopez2011'],
    },
    {
      id: '21-myth-medicines-can-be-modelled',
      claim:
        'A lifestyle plan can match the weight loss of modern medicines, so Vitals can simulate them like any other lever.',
      verdict: 'not-supported',
      explanation:
        'Medical treatments produce effects far outside any lifestyle lever: semaglutide 2.4 mg a week −14.9 % against −2.4 % at 68 weeks; tirzepatide 15 mg −20.9 % at 72 weeks; retatrutide phase 2 12 mg −24.2 % at 48 weeks; gastric bypass −25 % at 10 years. The lean-mass share of loss ranged from about 0 % to 40 % across semaglutide trials. SGLT2 inhibitors add a risk of euglycaemic ketoacidosis that matters for fasting, very-low-energy and ketogenic regimens. Smaller-effect medicines still matter: metformin −2.06 % against −0.02 % at 2 years, SGLT2 inhibitors about −1.2 to −2.4 kg, orlistat −5.8 against −3.0 kg at 4 years, and testosterone in men raising fat-free mass by 1.6 kg (fat mass −1.6 kg). Thyroid hormone has no consistent weight-loss effect. Vitals is built for an average person not on such treatments, so it does not simulate them. It recognises a medication flag, shows that medication is not modelled, disables planner weight-loss goals, and blocks fasting and very-low-carbohydrate blocks for SGLT2 inhibitor users.',
      referenceIds: [
        'wilding2021',
        'jastreboff2022',
        'jastreboff2023',
        'sjostrom2007',
        'bikou2024',
        'confederat2026',
        'knowler2002',
        'diabetes2012',
        'torgerson2004',
        'cai2018',
        'isidori2005',
        'bhasin1996',
        'kaptein2009',
      ],
    },
  ],
  openQuestions: [
    'The cold-exposure energy figures are very probably 24-hour-equivalent rates, but the protocol text of the key trial was not read. Its fat-loss effect comes from 11 people and has not been replicated. How the effect depends on temperature, duration and frequency is unknown.',
    'The sauna blood-pressure shift of −4 mmHg is half of a single 47-person trial that added sauna to exercise. Cohort confounding is unresolved, and no trial of sauna alone tests mortality proxies.',
    "How long the sleep-extension effect on intake lasts is unclear: the trial's intervention length was not read, and the lean-share formula rests on one 14-day crossover in about 10 adults.",
    'Turning weight-loss differences in kilograms into a daily adherence probability is a coarse linear assumption (grade D), and the slope of −0.52 kg per weekly food record is observational within a trial.',
    'The +1.1 kg lean-mass gain with creatine includes water inside muscle cells, and the 15 % accretion multiplier is a proposal. Kinetics at 5 g a day (without loading) are interpolated between the 3 g and 20 g points.',
    "The caffeine energy-expenditure schedule and habitual users' tolerance were not fully verified, so no energy credit is given.",
    'Free-eating effects of energy density, ultra-processed share, liquids, portion size and water preloading come from studies lasting one meal to two weeks. Compensation over months is unknown.',
    'Several entries rely on abstracts only (the Cochrane cold-immersion review, ketone glucose magnitude, heat-acclimation magnitudes, ashwagandha performance). Magnitudes are omitted rather than guessed.',
    'Not evaluated: sport and play, zone-2 dose–response, electrolytes on low-carbohydrate or fasting regimes, fat-source swaps, dry-fasting physiology beyond Ramadan cohorts, resistance-training variables, and menstrual-cycle timing of levers. No high-quality source was retrieved for carbohydrate cycling to training.',
    'Most trials are in young or middle-aged people, mostly men. Women, older adults and people with obesity are under-represented for creatine kinetics, cold, sauna and supplements.',
  ],
  references: [
    {
      id: 'tasali2022',
      authors: 'Tasali E, Wroblewski K, Kahn E, et al.',
      year: 2022,
      title:
        'Effect of Sleep Extension on Objectively Assessed Energy Intake Among Adults With Overweight in Real-life Settings: A Randomized Clinical Trial',
      journal: 'JAMA internal medicine',
      pmid: '35129580',
      doi: '10.1001/jamainternmed.2021.8098',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35129580/',
    },
    {
      id: 'nedeltcheva2010',
      authors: 'Nedeltcheva AV, Kilkus JM, Imperial J, et al.',
      year: 2010,
      title: 'Insufficient sleep undermines dietary efforts to reduce adiposity',
      journal: 'Annals of internal medicine',
      pmid: '20921542',
      doi: '10.7326/0003-4819-153-7-201010050-00006',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20921542/',
    },
    {
      id: 'henst2019',
      authors: 'Henst RHP, Pienaar PR, Roden LC, et al.',
      year: 2019,
      title: 'The effects of sleep extension on cardiometabolic risk factors: A systematic review',
      journal: 'Journal of sleep research',
      pmid: '31166059',
      doi: '10.1111/jsr.12865',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31166059/',
    },
    {
      id: 'gardiner2023',
      authors: 'Gardiner C, Weakley J, Burke LM, et al.',
      year: 2023,
      title: 'The effect of caffeine on subsequent sleep: A systematic review and meta-analysis',
      journal: 'Sleep medicine reviews',
      pmid: '36870101',
      doi: '10.1016/j.smrv.2023.101764',
      url: 'https://pubmed.ncbi.nlm.nih.gov/36870101/',
    },
    {
      id: 'drake2013',
      authors: 'Drake C, Roehrs T, Shambroom J, et al.',
      year: 2013,
      title: 'Caffeine effects on sleep taken 0, 3, or 6 hours before going to bed',
      journal:
        'Journal of clinical sleep medicine : JCSM : official publication of the American Academy of Sleep Medicine',
      pmid: '24235903',
      doi: '10.5664/jcsm.3170',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24235903/',
    },
    {
      id: 'ferraciolioda2013',
      authors: 'Ferracioli-Oda E, Qawasmi A, Bloch MH.',
      year: 2013,
      title: 'Meta-analysis: melatonin for the treatment of primary sleep disorders',
      journal: 'PloS one',
      pmid: '23691095',
      doi: '10.1371/journal.pone.0063773',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23691095/',
    },
    {
      id: 'lee2014',
      authors: 'Lee P, Smith S, Linderman J, et al.',
      year: 2014,
      title: 'Temperature-acclimated brown adipose tissue modulates insulin sensitivity in humans',
      journal: 'Diabetes',
      pmid: '24954193',
      doi: '10.2337/db14-0513',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24954193/',
    },
    {
      id: 'silva2021',
      authors: 'Silva AC, Silva A, Edwards BJ, et al.',
      year: 2021,
      title: 'Sleep extension in athletes: what we know so far - A systematic review',
      journal: 'Sleep medicine',
      pmid: '33352457',
      doi: '10.1016/j.sleep.2020.11.028',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33352457/',
    },
    {
      id: 'afaghi2007',
      authors: "Afaghi A, O'Connor H, Chow CM.",
      year: 2007,
      title: 'High-glycemic-index carbohydrate meals shorten sleep onset',
      journal: 'The American journal of clinical nutrition',
      pmid: '17284739',
      doi: '10.1093/ajcn/85.2.426',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17284739/',
    },
    {
      id: 'cheah2021',
      authors: 'Cheah KL, Norhayati MN, Husniati Yaacob L, et al.',
      year: 2021,
      title:
        'Effect of Ashwagandha (Withania somnifera) extract on sleep: A systematic review and meta-analysis',
      journal: 'PloS one',
      pmid: '34559859',
      doi: '10.1371/journal.pone.0257843',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34559859/',
    },
    {
      id: 'saeidifard2018',
      authors: 'Saeidifard F, Medina-Inojosa JR, Supervia M, et al.',
      year: 2018,
      title:
        'Differences of energy expenditure while sitting versus standing: A systematic review and meta-analysis',
      journal: 'European journal of preventive cardiology',
      pmid: '29385357',
      doi: '10.1177/2047487317752186',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29385357/',
    },
    {
      id: 'shrestha2018',
      authors: 'Shrestha N, Kukkonen-Harjula KT, Verbeek JH, et al.',
      year: 2018,
      title: 'Workplace interventions for reducing sitting at work',
      journal: 'The Cochrane database of systematic reviews',
      pmid: '30556590',
      doi: '10.1002/14651858.cd010912.pub5',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30556590/',
    },
    {
      id: 'levine2005',
      authors: 'Levine JA, Lanningham-Foster LM, McCrady SK, et al.',
      year: 2005,
      title: 'Interindividual variation in posture allocation: possible role in human obesity',
      journal: 'Science (New York, N.Y.)',
      pmid: '15681386',
      doi: '10.1126/science.1106561',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15681386/',
    },
    {
      id: 'buffey2022',
      authors: 'Buffey AJ, Herring MP, Langley CK, et al.',
      year: 2022,
      title:
        'The Acute Effects of Interrupting Prolonged Sitting Time in Adults with Standing and Light-Intensity Walking on Biomarkers of Cardiometabolic Health in Adults: A Systematic Review and Meta-analysis',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '35147898',
      doi: '10.1007/s40279-022-01649-4',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35147898/',
    },
    {
      id: 'reynolds2016',
      authors: 'Reynolds AN, Mann JI, Williams S, et al.',
      year: 2016,
      title:
        'Advice to walk after meals is more effective for lowering postprandial glycaemia in type 2 diabetes mellitus than advice that does not specify timing: a randomised crossover study',
      journal: 'Diabetologia',
      pmid: '27747394',
      doi: '10.1007/s00125-016-4085-2',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27747394/',
    },
    {
      id: 'dunstan2012',
      authors: 'Dunstan DW, Kingwell BA, Larsen R, et al.',
      year: 2012,
      title: 'Breaking up prolonged sitting reduces postprandial glucose and insulin responses',
      journal: 'Diabetes care',
      pmid: '22374636',
      doi: '10.2337/dc11-1931',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22374636/',
    },
    {
      id: 'paluch2022',
      authors: 'Paluch AE, Bajpai S, Bassett DR, et al.',
      year: 2022,
      title: 'Daily steps and all-cause mortality: a meta-analysis of 15 international cohorts',
      journal: 'The Lancet. Public health',
      pmid: '35247352',
      doi: '10.1016/s2468-2667(21)00302-9',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35247352/',
    },
    {
      id: 'ding2025',
      authors: 'Ding D, Nguyen B, Nau T, et al.',
      year: 2025,
      title: 'Daily steps and health outcomes in adults: a systematic review and dose-response meta-analysis',
      journal: 'The Lancet. Public health',
      pmid: '40713949',
      doi: '10.1016/s2468-2667(25)00164-1',
      url: 'https://pubmed.ncbi.nlm.nih.gov/40713949/',
    },
    {
      id: 'bravata2007',
      authors: 'Bravata DM, Smith-Spangler C, Sundaram V, et al.',
      year: 2007,
      title: 'Using pedometers to increase physical activity and improve health: a systematic review',
      journal: 'JAMA',
      pmid: '18029834',
      doi: '10.1001/jama.298.19.2296',
      url: 'https://pubmed.ncbi.nlm.nih.gov/18029834/',
    },
    {
      id: 'creasy2018',
      authors: 'Creasy SA, Lang W, Tate DF, et al.',
      year: 2018,
      title:
        'Pattern of Daily Steps is Associated with Weight Loss: Secondary Analysis from the Step-Up Randomized Trial',
      journal: 'Obesity (Silver Spring, Md.)',
      pmid: '29633583',
      doi: '10.1002/oby.22171',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29633583/',
    },
    {
      id: 'rodriguez2026',
      authors: 'Rodríguez MÁ, Quintana-Cepedal M, Cheval B, et al.',
      year: 2026,
      title:
        'Effect of exercise snacks on fitness and cardiometabolic health in physically inactive individuals: systematic review and meta-analysis',
      journal: 'British journal of sports medicine',
      pmid: '41057224',
      doi: '10.1136/bjsports-2025-110027',
      url: 'https://pubmed.ncbi.nlm.nih.gov/41057224/',
    },
    {
      id: 'wan2025',
      authors: 'Wan KW, Dai ZH, Wong PS, et al.',
      year: 2025,
      title:
        'Effects of Exercise Snacks on Cardiometabolic Health and Body Composition in Adults: A Systematic Review and Meta-Analysis',
      journal: 'Scandinavian journal of medicine & science in sports',
      pmid: '40814152',
      doi: '10.1111/sms.70114',
      url: 'https://pubmed.ncbi.nlm.nih.gov/40814152/',
    },
    {
      id: 'wewege2017',
      authors: 'Wewege M, van den Berg R, Ward RE, et al.',
      year: 2017,
      title:
        'The effects of high-intensity interval training vs. moderate-intensity continuous training on body composition in overweight and obese adults: a systematic review and meta-analysis',
      journal:
        'Obesity reviews : an official journal of the International Association for the Study of Obesity',
      pmid: '28401638',
      doi: '10.1111/obr.12532',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28401638/',
    },
    {
      id: 'gillen2016',
      authors: 'Gillen JB, Martin BJ, MacInnis MJ, et al.',
      year: 2016,
      title:
        'Twelve Weeks of Sprint Interval Training Improves Indices of Cardiometabolic Health Similar to Traditional Endurance Training despite a Five-Fold Lower Exercise Volume and Time Commitment',
      journal: 'PloS one',
      pmid: '27115137',
      doi: '10.1371/journal.pone.0154075',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27115137/',
    },
    {
      id: 'vieira2016',
      authors: 'Vieira AF, Costa RR, Macedo RC, et al.',
      year: 2016,
      title:
        'Effects of aerobic exercise performed in fasted v. fed state on fat and carbohydrate metabolism in adults: a systematic review and meta-analysis',
      journal: 'The British journal of nutrition',
      pmid: '27609363',
      doi: '10.1017/s0007114516003160',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27609363/',
    },
    {
      id: 'schoenfeld2014',
      authors: 'Schoenfeld BJ, Aragon AA, Wilborn CD, et al.',
      year: 2014,
      title: 'Body composition changes associated with fasted versus non-fasted aerobic exercise',
      journal: 'Journal of the International Society of Sports Nutrition',
      pmid: '25429252',
      doi: '10.1186/s12970-014-0054-7',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25429252/',
    },
    {
      id: 'laukkanen2015',
      authors: 'Laukkanen T, Khan H, Zaccardi F, et al.',
      year: 2015,
      title: 'Association between sauna bathing and fatal cardiovascular and all-cause mortality events',
      journal: 'JAMA internal medicine',
      pmid: '25705824',
      doi: '10.1001/jamainternmed.2014.8187',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25705824/',
    },
    {
      id: 'laukkanen2018',
      authors: 'Laukkanen T, Kunutsor SK, Khan H, et al.',
      year: 2018,
      title:
        'Sauna bathing is associated with reduced cardiovascular mortality and improves risk prediction in men and women: a prospective cohort study',
      journal: 'BMC medicine',
      pmid: '30486813',
      doi: '10.1186/s12916-018-1198-0',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30486813/',
    },
    {
      id: 'hussain2018',
      authors: 'Hussain J, Cohen M.',
      year: 2018,
      title: 'Clinical Effects of Regular Dry Sauna Bathing: A Systematic Review',
      journal: 'Evidence-based complementary and alternative medicine : eCAM',
      pmid: '29849692',
      doi: '10.1155/2018/1857413',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29849692/',
    },
    {
      id: 'lee2022',
      authors: 'Lee E, Kolunsarka I, Kostensalo J, et al.',
      year: 2022,
      title:
        'Effects of regular sauna bathing in conjunction with exercise on cardiovascular function: a multi-arm, randomized controlled trial',
      journal: 'American journal of physiology. Regulatory, integrative and comparative physiology',
      pmid: '35785965',
      doi: '10.1152/ajpregu.00076.2022',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35785965/',
    },
    {
      id: 'li2020',
      authors: 'Li Z, Jiang W, Chen Y, et al.',
      year: 2020,
      title: 'Acute and short-term efficacy of sauna treatment on cardiovascular function: A meta-analysis',
      journal: 'European journal of cardiovascular nursing',
      pmid: '32814462',
      doi: '10.1177/1474515120944584',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32814462/',
    },
    {
      id: 'scoon2007',
      authors: 'Scoon GS, Hopkins WG, Mayhew S, et al.',
      year: 2007,
      title: 'Effect of post-exercise sauna bathing on the endurance performance of competitive male runners',
      journal: 'Journal of science and medicine in sport',
      pmid: '16877041',
      doi: '10.1016/j.jsams.2006.06.009',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16877041/',
    },
    {
      id: 'solomon2025',
      authors: 'Solomon TPJ, Laye MJ.',
      year: 2025,
      title:
        'The effect of post-exercise heat exposure (passive heat acclimation) on endurance exercise performance: a systematic review and meta-analysis',
      journal: 'BMC sports science, medicine & rehabilitation',
      pmid: '39762944',
      doi: '10.1186/s13102-024-01038-6',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39762944/',
    },
    {
      id: 'leppaluoto1986',
      authors: 'Leppäluoto J, Huttunen P, Hirvonen J, et al.',
      year: 1986,
      title: 'Endocrine effects of repeated sauna bathing',
      journal: 'Acta physiologica Scandinavica',
      pmid: '3788622',
      doi: '10.1111/j.1748-1716.1986.tb08000.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3788622/',
    },
    {
      id: 'benjamin2019',
      authors: 'Benjamin CL, Sekiguchi Y, Fry LA, et al.',
      year: 2019,
      title:
        'Performance Changes Following Heat Acclimation and the Factors That Influence These Changes: Meta-Analysis and Meta-Regression',
      journal: 'Frontiers in physiology',
      pmid: '31827444',
      doi: '10.3389/fphys.2019.01448',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31827444/',
    },
    {
      id: 'van2009',
      authors: 'van Marken Lichtenbelt WD, Vanhommerig JW, Smulders NM, et al.',
      year: 2009,
      title: 'Cold-activated brown adipose tissue in healthy men',
      journal: 'The New England journal of medicine',
      pmid: '19357405',
      doi: '10.1056/nejmoa0808718',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19357405/',
    },
    {
      id: 'yoneshiro2013',
      authors: 'Yoneshiro T, Aita S, Matsushita M, et al.',
      year: 2013,
      title: 'Recruited brown adipose tissue as an antiobesity agent in humans',
      journal: 'The Journal of clinical investigation',
      pmid: '23867622',
      doi: '10.1172/jci67803',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23867622/',
    },
    {
      id: 'ouellet2012',
      authors: 'Ouellet V, Labbé SM, Blondin DP, et al.',
      year: 2012,
      title:
        'Brown adipose tissue oxidative metabolism contributes to energy expenditure during acute cold exposure in humans',
      journal: 'The Journal of clinical investigation',
      pmid: '22269323',
      doi: '10.1172/jci60433',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22269323/',
    },
    {
      id: 'sramek2000',
      authors: 'Srámek P, Simecková M, Janský L, et al.',
      year: 2000,
      title: 'Human physiological responses to immersion into water of different temperatures',
      journal: 'European journal of applied physiology',
      pmid: '10751106',
      doi: '10.1007/s004210050065',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10751106/',
    },
    {
      id: 'hanssen2015',
      authors: 'Hanssen MJ, Hoeks J, Brans B, et al.',
      year: 2015,
      title:
        'Short-term cold acclimation improves insulin sensitivity in patients with type 2 diabetes mellitus',
      journal: 'Nature medicine',
      pmid: '26147760',
      doi: '10.1038/nm.3891',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26147760/',
    },
    {
      id: 'soberg2021',
      authors: 'Søberg S, Löfgren J, Philipsen FE, et al.',
      year: 2021,
      title:
        'Altered brown fat thermoregulation and enhanced cold-induced thermogenesis in young, healthy, winter-swimming men',
      journal: 'Cell reports. Medicine',
      pmid: '34755128',
      doi: '10.1016/j.xcrm.2021.100408',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34755128/',
    },
    {
      id: 'roberts2015',
      authors: 'Roberts LA, Raastad T, Markworth JF, et al.',
      year: 2015,
      title:
        'Post-exercise cold water immersion attenuates acute anabolic signalling and long-term adaptations in muscle to strength training',
      journal: 'The Journal of physiology',
      pmid: '26174323',
      doi: '10.1113/jp270570',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26174323/',
    },
    {
      id: 'grgic2023',
      authors: 'Grgic J.',
      year: 2023,
      title:
        'Effects of post-exercise cold-water immersion on resistance training-induced gains in muscular strength: a meta-analysis',
      journal: 'European journal of sport science',
      pmid: '35068365',
      doi: '10.1080/17461391.2022.2033851',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35068365/',
    },
    {
      id: 'petersen2021',
      authors: 'Petersen AC, Fyfe JJ.',
      year: 2021,
      title:
        'Post-exercise Cold Water Immersion Effects on Physiological Adaptations to Resistance Training and the Underlying Mechanisms in Skeletal Muscle: A Narrative Review',
      journal: 'Frontiers in sports and active living',
      pmid: '33898988',
      doi: '10.3389/fspor.2021.660291',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33898988/',
    },
    {
      id: 'bleakley2012',
      authors: 'Bleakley C, McDonough S, Gardner E, et al.',
      year: 2012,
      title: 'Cold-water immersion (cryotherapy) for preventing and treating muscle soreness after exercise',
      journal: 'The Cochrane database of systematic reviews',
      pmid: '22336838',
      doi: '10.1002/14651858.cd008262.pub2',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22336838/',
    },
    {
      id: 'chilibeck2017',
      authors: 'Chilibeck PD, Kaviani M, Candow DG, et al.',
      year: 2017,
      title:
        'Effect of creatine supplementation during resistance training on lean tissue mass and muscular strength in older adults: a meta-analysis',
      journal: 'Open access journal of sports medicine',
      pmid: '29138605',
      doi: '10.2147/oajsm.s123529',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29138605/',
    },
    {
      id: 'delpino2022',
      authors: 'Delpino FM, Figueiredo LM, Forbes SC, et al.',
      year: 2022,
      title:
        'Influence of age, sex, and type of exercise on the efficacy of creatine supplementation on lean body mass: A systematic review and meta-analysis of randomized clinical trials',
      journal: 'Nutrition (Burbank, Los Angeles County, Calif.)',
      pmid: '35986981',
      doi: '10.1016/j.nut.2022.111791',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35986981/',
    },
    {
      id: 'naddafha2026',
      authors: 'Naddafha S, Antonio J, Kreider RB, et al.',
      year: 2026,
      title:
        'Creatine monohydrate for lean mass, strength, and bone density in postmenopausal women: a systematic review and meta-analysis',
      journal: 'Journal of the International Society of Sports Nutrition',
      pmid: '42141930',
      doi: '10.1080/15502783.2026.2668435',
      url: 'https://pubmed.ncbi.nlm.nih.gov/42141930/',
    },
    {
      id: 'xu2024',
      authors: 'Xu C, Bi S, Zhang W, et al.',
      year: 2024,
      title:
        'The effects of creatine supplementation on cognitive function in adults: a systematic review and meta-analysis',
      journal: 'Frontiers in nutrition',
      pmid: '39070254',
      doi: '10.3389/fnut.2024.1424972',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39070254/',
    },
    {
      id: 'hultman1996',
      authors: 'Hultman E, Söderlund K, Timmons JA, et al.',
      year: 1996,
      title: 'Muscle creatine loading in men',
      journal: 'Journal of applied physiology (Bethesda, Md. : 1985)',
      pmid: '8828669',
      doi: '10.1152/jappl.1996.81.1.232',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8828669/',
    },
    {
      id: 'powers2003',
      authors: 'Powers ME, Arnold BL, Weltman AL, et al.',
      year: 2003,
      title: 'Creatine Supplementation Increases Total Body Water Without Altering Fluid Distribution',
      journal: 'Journal of athletic training',
      pmid: '12937471',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12937471/',
    },
    {
      id: 'kreider2017',
      authors: 'Kreider RB, Kalman DS, Antonio J, et al.',
      year: 2017,
      title:
        'International Society of Sports Nutrition position stand: safety and efficacy of creatine supplementation in exercise, sport, and medicine',
      journal: 'Journal of the International Society of Sports Nutrition',
      pmid: '28615996',
      doi: '10.1186/s12970-017-0173-z',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28615996/',
    },
    {
      id: 'grgic2018',
      authors: 'Grgic J, Trexler ET, Lazinica B, et al.',
      year: 2018,
      title: 'Effects of caffeine intake on muscle strength and power: a systematic review and meta-analysis',
      journal: 'Journal of the International Society of Sports Nutrition',
      pmid: '29527137',
      doi: '10.1186/s12970-018-0216-0',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29527137/',
    },
    {
      id: 'grgic2020',
      authors: 'Grgic J, Grgic I, Pickering C, et al.',
      year: 2020,
      title:
        'Wake up and smell the coffee: caffeine supplementation and exercise performance-an umbrella review of 21 published meta-analyses',
      journal: 'British journal of sports medicine',
      pmid: '30926628',
      doi: '10.1136/bjsports-2018-100278',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30926628/',
    },
    {
      id: 'southward2018',
      authors: 'Southward K, Rutherfurd-Markwick KJ, Ali A.',
      year: 2018,
      title:
        'The Effect of Acute Caffeine Ingestion on Endurance Performance: A Systematic Review and Meta-Analysis',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '29876876',
      doi: '10.1007/s40279-018-0939-8',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29876876/',
    },
    {
      id: 'dulloo1989',
      authors: 'Dulloo AG, Geissler CA, Horton T, et al.',
      year: 1989,
      title:
        'Normal caffeine consumption: influence on thermogenesis and daily energy expenditure in lean and postobese human volunteers',
      journal: 'The American journal of clinical nutrition',
      pmid: '2912010',
      doi: '10.1093/ajcn/49.1.44',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2912010/',
    },
    {
      id: 'tabrizi2019',
      authors: 'Tabrizi R, Saneei P, Lankarani KB, et al.',
      year: 2019,
      title:
        'The effects of caffeine intake on weight loss: a systematic review and dos-response meta-analysis of randomized controlled trials',
      journal: 'Critical reviews in food science and nutrition',
      pmid: '30335479',
      doi: '10.1080/10408398.2018.1507996',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30335479/',
    },
    {
      id: 'miller2014',
      authors: 'Miller PE, Van Elswyk M, Alexander DD.',
      year: 2014,
      title:
        'Long-chain omega-3 fatty acids eicosapentaenoic acid and docosahexaenoic acid and blood pressure: a meta-analysis of randomized controlled trials',
      journal: 'American journal of hypertension',
      pmid: '24610882',
      doi: '10.1093/ajh/hpu024',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24610882/',
    },
    {
      id: 'zhang2022',
      authors: 'Zhang X, Ritonja JA, Zhou N, et al.',
      year: 2022,
      title:
        'Omega-3 Polyunsaturated Fatty Acids Intake and Blood Pressure: A Dose-Response Meta-Analysis of Randomized Controlled Trials',
      journal: 'Journal of the American Heart Association',
      pmid: '35647665',
      doi: '10.1161/jaha.121.025071',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35647665/',
    },
    {
      id: 'skulasray2019',
      authors: 'Skulas-Ray AC, Wilson PWF, Harris WS, et al.',
      year: 2019,
      title:
        'Omega-3 Fatty Acids for the Management of Hypertriglyceridemia: A Science Advisory From the American Heart Association',
      journal: 'Circulation',
      pmid: '31422671',
      doi: '10.1161/cir.0000000000000709',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31422671/',
    },
    {
      id: 'zhang2017',
      authors: 'Zhang YY, Liu W, Zhao TY, et al.',
      year: 2017,
      title:
        'Efficacy of Omega-3 Polyunsaturated Fatty Acids Supplementation in Managing Overweight and Obesity: A Meta-Analysis of Randomized Clinical Trials',
      journal: 'The journal of nutrition, health & aging',
      pmid: '28112774',
      doi: '10.1007/s12603-016-0755-5',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28112774/',
    },
    {
      id: 'gencer2021',
      authors: 'Gencer B, Djousse L, Al-Ramady OT, et al.',
      year: 2021,
      title:
        'Effect of Long-Term Marine ɷ-3 Fatty Acids Supplementation on the Risk of Atrial Fibrillation in Randomized Controlled Trials of Cardiovascular Outcomes: A Systematic Review and Meta-Analysis',
      journal: 'Circulation',
      pmid: '34612056',
      doi: '10.1161/circulationaha.121.055654',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34612056/',
    },
    {
      id: 'huang2020',
      authors: 'Huang YH, Chiu WC, Hsu YP, et al.',
      year: 2020,
      title:
        'Effects of Omega-3 Fatty Acids on Muscle Mass, Muscle Strength and Muscle Performance among the Elderly: A Meta-Analysis',
      journal: 'Nutrients',
      pmid: '33291698',
      doi: '10.3390/nu12123739',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33291698/',
    },
    {
      id: 'pathak2014',
      authors: 'Pathak K, Soares MJ, Calton EK, et al.',
      year: 2014,
      title:
        'Vitamin D supplementation and body weight status: a systematic review and meta-analysis of randomized controlled trials',
      journal:
        'Obesity reviews : an official journal of the International Association for the Study of Obesity',
      pmid: '24528624',
      doi: '10.1111/obr.12162',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24528624/',
    },
    {
      id: 'beaudart2014',
      authors: 'Beaudart C, Buckinx F, Rabenda V, et al.',
      year: 2014,
      title:
        'The effects of vitamin D on skeletal muscle strength, muscle mass, and muscle power: a systematic review and meta-analysis of randomized controlled trials',
      journal: 'The Journal of clinical endocrinology and metabolism',
      pmid: '25033068',
      doi: '10.1210/jc.2014-1742',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25033068/',
    },
    {
      id: 'stockton2011',
      authors: 'Stockton KA, Mengersen K, Paratz JD, et al.',
      year: 2011,
      title: 'Effect of vitamin D supplementation on muscle strength: a systematic review and meta-analysis',
      journal:
        'Osteoporosis international : a journal established as result of cooperation between the European Foundation for Osteoporosis and the National Osteoporosis Foundation of the USA',
      pmid: '20924748',
      doi: '10.1007/s00198-010-1407-y',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20924748/',
    },
    {
      id: 'mcmahon2017',
      authors: 'McMahon NF, Leveritt MD, Pavey TG.',
      year: 2017,
      title:
        'The Effect of Dietary Nitrate Supplementation on Endurance Exercise Performance in Healthy Adults: A Systematic Review and Meta-Analysis',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '27600147',
      doi: '10.1007/s40279-016-0617-7',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27600147/',
    },
    {
      id: 'bahadoran2017',
      authors: 'Bahadoran Z, Mirmiran P, Kabir A, et al.',
      year: 2017,
      title:
        'The Nitrate-Independent Blood Pressure-Lowering Effect of Beetroot Juice: A Systematic Review and Meta-Analysis',
      journal: 'Advances in nutrition (Bethesda, Md.)',
      pmid: '29141968',
      doi: '10.3945/an.117.016717',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29141968/',
    },
    {
      id: 'georgiou2024',
      authors: 'Georgiou GD, Antoniou K, Antoniou S, et al.',
      year: 2024,
      title:
        'Effect of Beta-Alanine Supplementation on Maximal Intensity Exercise in Trained Young Male Individuals: A Systematic Review and Meta-Analysis',
      journal: 'International journal of sport nutrition and exercise metabolism',
      pmid: '39032921',
      doi: '10.1123/ijsnem.2024-0027',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39032921/',
    },
    {
      id: 'trexler2019',
      authors: 'Trexler ET, Persky AM, Ryan ED, et al.',
      year: 2019,
      title:
        'Acute Effects of Citrulline Supplementation on High-Intensity Strength and Power Performance: A Systematic Review and Meta-Analysis',
      journal: 'Sports medicine (Auckland, N.Z.)',
      pmid: '30895562',
      doi: '10.1007/s40279-019-01091-z',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30895562/',
    },
    {
      id: 'dunienville2021',
      authors: "d'Unienville NMA, Blake HT, Coates AM, et al.",
      year: 2021,
      title:
        'Effect of food sources of nitrate, polyphenols, L-arginine and L-citrulline on endurance exercise performance: a systematic review and meta-analysis of randomised controlled trials',
      journal: 'Journal of the International Society of Sports Nutrition',
      pmid: '34965876',
      doi: '10.1186/s12970-021-00472-y',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34965876/',
    },
    {
      id: 'grgic2021',
      authors: 'Grgic J, Grgic I, Del Coso J, et al.',
      year: 2021,
      title: 'Effects of sodium bicarbonate supplementation on exercise performance: an umbrella review',
      journal: 'Journal of the International Society of Sports Nutrition',
      pmid: '34794476',
      doi: '10.1186/s12970-021-00469-7',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34794476/',
    },
    {
      id: 'mumme2015',
      authors: 'Mumme K, Stonehouse W.',
      year: 2015,
      title:
        'Effects of medium-chain triglycerides on weight loss and body composition: a meta-analysis of randomized controlled trials',
      journal: 'Journal of the Academy of Nutrition and Dietetics',
      pmid: '25636220',
      doi: '10.1016/j.jand.2014.10.022',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25636220/',
    },
    {
      id: 'bueno2015',
      authors: 'Bueno NB, de Melo IV, Florêncio TT, et al.',
      year: 2015,
      title:
        'Dietary medium-chain triacylglycerols versus long-chain triacylglycerols for body composition in adults: systematic review and meta-analysis of randomized controlled trials',
      journal: 'Journal of the American College of Nutrition',
      pmid: '25651239',
      doi: '10.1080/07315724.2013.879844',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25651239/',
    },
    {
      id: 'leckey2017',
      authors: 'Leckey JJ, Ross ML, Quod M, et al.',
      year: 2017,
      title: 'Ketone Diester Ingestion Impairs Time-Trial Performance in Professional Cyclists',
      journal: 'Frontiers in physiology',
      pmid: '29109686',
      doi: '10.3389/fphys.2017.00806',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29109686/',
    },
    {
      id: 'falkenhain2022',
      authors: 'Falkenhain K, Daraei A, Forbes SC, et al.',
      year: 2022,
      title:
        'Effects of Exogenous Ketone Supplementation on Blood Glucose: A Systematic Review and Meta-analysis',
      journal: 'Advances in nutrition (Bethesda, Md.)',
      pmid: '35380602',
      doi: '10.1093/advances/nmac036',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35380602/',
    },
    {
      id: 'jurgens2012',
      authors: 'Jurgens TM, Whelan AM, Killian L, et al.',
      year: 2012,
      title: 'Green tea for weight loss and weight maintenance in overweight or obese adults',
      journal: 'The Cochrane database of systematic reviews',
      pmid: '23235664',
      doi: '10.1002/14651858.cd008650.pub2',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23235664/',
    },
    {
      id: 'hursel2009',
      authors: 'Hursel R, Viechtbauer W, Westerterp-Plantenga MS.',
      year: 2009,
      title: 'The effects of green tea on weight loss and weight maintenance: a meta-analysis',
      journal: 'International journal of obesity (2005)',
      pmid: '19597519',
      doi: '10.1038/ijo.2009.135',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19597519/',
    },
    {
      id: 'zhang2023',
      authors: 'Zhang W, Zhang Q, Wang L, et al.',
      year: 2023,
      title:
        'The effects of capsaicin intake on weight loss among overweight and obese subjects: a systematic review and meta-analysis of randomised controlled trials',
      journal: 'The British journal of nutrition',
      pmid: '36938807',
      doi: '10.1017/s0007114523000697',
      url: 'https://pubmed.ncbi.nlm.nih.gov/36938807/',
    },
    {
      id: 'xiong2020',
      authors: 'Xiong P, Niu L, Talaei S, et al.',
      year: 2020,
      title:
        'The effect of berberine supplementation on obesity indices: A dose- response meta-analysis and systematic review of randomized controlled trials',
      journal: 'Complementary therapies in clinical practice',
      pmid: '32379652',
      doi: '10.1016/j.ctcp.2020.101113',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32379652/',
    },
    {
      id: 'xie2022',
      authors: 'Xie W, Su F, Wang G, et al.',
      year: 2022,
      title: 'Glucose-lowering effect of berberine on type 2 diabetes: A systematic review and meta-analysis',
      journal: 'Frontiers in pharmacology',
      pmid: '36467075',
      doi: '10.3389/fphar.2022.1015045',
      url: 'https://pubmed.ncbi.nlm.nih.gov/36467075/',
    },
    {
      id: 'hadi2021',
      authors: 'Hadi A, Pourmasoumi M, Najafgholizadeh A, et al.',
      year: 2021,
      title:
        'The effect of apple cider vinegar on lipid profiles and glycemic parameters: a systematic review and meta-analysis of randomized clinical trials',
      journal: 'BMC complementary medicine and therapies',
      pmid: '34187442',
      doi: '10.1186/s12906-021-03351-w',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34187442/',
    },
    {
      id: 'kondo2009',
      authors: 'Kondo T, Kishi M, Fushimi T, et al.',
      year: 2009,
      title:
        'Vinegar intake reduces body weight, body fat mass, and serum triglyceride levels in obese Japanese subjects',
      journal: 'Bioscience, biotechnology, and biochemistry',
      pmid: '19661687',
      doi: '10.1271/bbb.90231',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19661687/',
    },
    {
      id: 'perna2021',
      authors: 'Perna S, Ilyas Z, Giacosa A, et al.',
      year: 2021,
      title:
        'Is Probiotic Supplementation Useful for the Management of Body Weight and Other Anthropometric Measures in Adults Affected by Overweight and Obesity with Metabolic Related Diseases? A Systematic Review and Meta-Analysis',
      journal: 'Nutrients',
      pmid: '33669580',
      doi: '10.3390/nu13020666',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33669580/',
    },
    {
      id: 'prokopidis2025',
      authors: 'Prokopidis K, Moriarty F, Bahat G, et al.',
      year: 2025,
      title:
        'The Effect of Nicotinamide Mononucleotide and Riboside on Skeletal Muscle Mass and Function: A Systematic Review and Meta-Analysis',
      journal: 'Journal of cachexia, sarcopenia and muscle',
      pmid: '40275690',
      doi: '10.1002/jcsm.13799',
      url: 'https://pubmed.ncbi.nlm.nih.gov/40275690/',
    },
    {
      id: 'chen2024',
      authors: 'Chen F, Zhou D, Kong AP, et al.',
      year: 2024,
      title:
        'Effects of Nicotinamide Mononucleotide on Glucose and Lipid Metabolism in Adults: A Systematic Review and Meta-analysis of Randomised Controlled Trials',
      journal: 'Current diabetes reports',
      pmid: '39531138',
      doi: '10.1007/s11892-024-01557-z',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39531138/',
    },
    {
      id: 'yoshino2021',
      authors: 'Yoshino M, Yoshino J, Kayser BD, et al.',
      year: 2021,
      title: 'Nicotinamide mononucleotide increases muscle insulin sensitivity in prediabetic women',
      journal: 'Science (New York, N.Y.)',
      pmid: '33888596',
      doi: '10.1126/science.abe9985',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33888596/',
    },
    {
      id: 'liu2014',
      authors: 'Liu K, Zhou R, Wang B, et al.',
      year: 2014,
      title:
        'Effect of resveratrol on glucose control and insulin sensitivity: a meta-analysis of 11 randomized controlled trials',
      journal: 'The American journal of clinical nutrition',
      pmid: '24695890',
      doi: '10.3945/ajcn.113.082024',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24695890/',
    },
    {
      id: 'gliemann2013',
      authors: 'Gliemann L, Schmidt JF, Olesen J, et al.',
      year: 2013,
      title:
        'Resveratrol blunts the positive effects of exercise training on cardiovascular health in aged men',
      journal: 'The Journal of physiology',
      pmid: '23878368',
      doi: '10.1113/jphysiol.2013.258061',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23878368/',
    },
    {
      id: 'schwarz2022',
      authors: 'Schwarz C, Benson GS, Horn N, et al.',
      year: 2022,
      title:
        'Effects of Spermidine Supplementation on Cognition and Biomarkers in Older Adults With Subjective Cognitive Decline: A Randomized Clinical Trial',
      journal: 'JAMA network open',
      pmid: '35616942',
      doi: '10.1001/jamanetworkopen.2022.13875',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35616942/',
    },
    {
      id: 'sun2025',
      authors: 'Sun C, Yang A, Teng F, et al.',
      year: 2025,
      title: 'Efficacy of collagen peptide supplementation on bone and muscle health: a meta-analysis',
      journal: 'Frontiers in nutrition',
      pmid: '41049371',
      doi: '10.3389/fnut.2025.1646090',
      url: 'https://pubmed.ncbi.nlm.nih.gov/41049371/',
    },
    {
      id: 'de2021',
      authors: 'de Miranda RB, Weimer P, Rossi RC.',
      year: 2021,
      title:
        'Effects of hydrolyzed collagen supplementation on skin aging: a systematic review and meta-analysis',
      journal: 'International journal of dermatology',
      pmid: '33742704',
      doi: '10.1111/ijd.15518',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33742704/',
    },
    {
      id: 'akhgarjand2022',
      authors: 'Akhgarjand C, Asoudeh F, Bagheri A, et al.',
      year: 2022,
      title:
        'Does Ashwagandha supplementation have a beneficial effect on the management of anxiety and stress? A systematic review and meta-analysis of randomized controlled trials',
      journal: 'Phytotherapy research : PTR',
      pmid: '36017529',
      doi: '10.1002/ptr.7598',
      url: 'https://pubmed.ncbi.nlm.nih.gov/36017529/',
    },
    {
      id: 'bonilla2021',
      authors: 'Bonilla DA, Moreno Y, Gho C, et al.',
      year: 2021,
      title:
        'Effects of Ashwagandha (Withania somnifera) on Physical Performance: Systematic Review and Bayesian Meta-Analysis',
      journal: 'Journal of functional morphology and kinesiology',
      pmid: '33670194',
      doi: '10.3390/jfmk6010020',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33670194/',
    },
    {
      id: 'bjornsson2020',
      authors: 'Björnsson HK, Björnsson ES, Avula B, et al.',
      year: 2020,
      title:
        'Ashwagandha-induced liver injury: A case series from Iceland and the US Drug-Induced Liver Injury Network',
      journal:
        'Liver international : official journal of the International Association for the Study of the Liver',
      pmid: '31991029',
      doi: '10.1111/liv.14393',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31991029/',
    },
    {
      id: 'bessell2021',
      authors: 'Bessell E, Maunder A, Lauche R, et al.',
      year: 2021,
      title:
        'Efficacy of dietary supplements containing isolated organic compounds for weight loss: a systematic review and meta-analysis of randomised placebo-controlled trials',
      journal: 'International journal of obesity (2005)',
      pmid: '33976376',
      doi: '10.1038/s41366-021-00839-w',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33976376/',
    },
    {
      id: 'batsis2021',
      authors: 'Batsis JA, Apolzan JW, Bagley PJ, et al.',
      year: 2021,
      title: 'A Systematic Review of Dietary Supplements and Alternative Therapies for Weight Loss',
      journal: 'Obesity (Silver Spring, Md.)',
      pmid: '34159755',
      doi: '10.1002/oby.23110',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34159755/',
    },
    {
      id: 'onakpoya2011',
      authors: 'Onakpoya I, Hung SK, Perry R, et al.',
      year: 2011,
      title:
        'The Use of Garcinia Extract (Hydroxycitric Acid) as a Weight loss Supplement: A Systematic Review and Meta-Analysis of Randomised Clinical Trials',
      journal: 'Journal of obesity',
      pmid: '21197150',
      doi: '10.1155/2011/509038',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21197150/',
    },
    {
      id: 'pooyandjoo2016',
      authors: 'Pooyandjoo M, Nouhi M, Shab-Bidar S, et al.',
      year: 2016,
      title:
        'The effect of (L-)carnitine on weight loss in adults: a systematic review and meta-analysis of randomized controlled trials',
      journal:
        'Obesity reviews : an official journal of the International Association for the Study of Obesity',
      pmid: '27335245',
      doi: '10.1111/obr.12436',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27335245/',
    },
    {
      id: 'jakubowski2020',
      authors: 'Jakubowski JS, Nunes EA, Teixeira FJ, et al.',
      year: 2020,
      title:
        'Supplementation with the Leucine Metabolite β-hydroxy-β-methylbutyrate (HMB) does not Improve Resistance Exercise-Induced Changes in Body Composition or Strength in Young Subjects: A Systematic Review and Meta-Analysis',
      journal: 'Nutrients',
      pmid: '32456217',
      doi: '10.3390/nu12051523',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32456217/',
    },
    {
      id: 'paulsen2014',
      authors: 'Paulsen G, Cumming KT, Holden G, et al.',
      year: 2014,
      title:
        'Vitamin C and E supplementation hampers cellular adaptation to endurance training in humans: a double-blind, randomised, controlled trial',
      journal: 'The Journal of physiology',
      pmid: '24492839',
      doi: '10.1113/jphysiol.2013.267419',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24492839/',
    },
    {
      id: 'jovanovski2018',
      authors: 'Jovanovski E, Yashpal S, Komishon A, et al.',
      year: 2018,
      title:
        'Effect of psyllium (Plantago ovata) fiber on LDL cholesterol and alternative lipid targets, non-HDL cholesterol and apolipoprotein B: a systematic review and meta-analysis of randomized controlled trials',
      journal: 'The American journal of clinical nutrition',
      pmid: '30239559',
      doi: '10.1093/ajcn/nqy115',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30239559/',
    },
    {
      id: 'gibb2015',
      authors: 'Gibb RD, McRorie JW, Russell DA, et al.',
      year: 2015,
      title:
        'Psyllium fiber improves glycemic control proportional to loss of glycemic control: a meta-analysis of data in euglycemic subjects, patients at risk of type 2 diabetes mellitus, and patients being treated for type 2 diabetes mellitus',
      journal: 'The American journal of clinical nutrition',
      pmid: '26561625',
      doi: '10.3945/ajcn.115.106989',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26561625/',
    },
    {
      id: 'whitehead2014',
      authors: 'Whitehead A, Beck EJ, Tosh S, et al.',
      year: 2014,
      title: 'Cholesterol-lowering effects of oat β-glucan: a meta-analysis of randomized controlled trials',
      journal: 'The American journal of clinical nutrition',
      pmid: '25411276',
      doi: '10.3945/ajcn.114.086108',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25411276/',
    },
    {
      id: 'jovanovski2020',
      authors: 'Jovanovski E, Mazhar N, Komishon A, et al.',
      year: 2020,
      title:
        'Can dietary viscous fiber affect body weight independently of an energy-restrictive diet? A systematic review and meta-analysis of randomized controlled trials',
      journal: 'The American journal of clinical nutrition',
      pmid: '31897475',
      doi: '10.1093/ajcn/nqz292',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31897475/',
    },
    {
      id: 'thompson2017',
      authors: 'Thompson SV, Hannon BA, An R, et al.',
      year: 2017,
      title:
        'Effects of isolated soluble fiber supplementation on body weight, glycemia, and insulinemia in adults with overweight and obesity: a systematic review and meta-analysis of randomized controlled trials',
      journal: 'The American journal of clinical nutrition',
      pmid: '29092878',
      doi: '10.3945/ajcn.117.163246',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29092878/',
    },
    {
      id: 'sood2008',
      authors: 'Sood N, Baker WL, Coleman CI.',
      year: 2008,
      title:
        'Effect of glucomannan on plasma lipid and glucose concentrations, body weight, and blood pressure: systematic review and meta-analysis',
      journal: 'The American journal of clinical nutrition',
      pmid: '18842808',
      doi: '10.1093/ajcn/88.4.1167',
      url: 'https://pubmed.ncbi.nlm.nih.gov/18842808/',
    },
    {
      id: 'mamerow2014',
      authors: 'Mamerow MM, Mettler JA, English KL, et al.',
      year: 2014,
      title:
        'Dietary protein distribution positively influences 24-h muscle protein synthesis in healthy adults',
      journal: 'The Journal of nutrition',
      pmid: '24477298',
      doi: '10.3945/jn.113.185280',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24477298/',
    },
    {
      id: 'justesen2022',
      authors: 'Justesen TEH, Jespersen SE, Tagmose Thomsen T, et al.',
      year: 2022,
      title:
        'Comparing Even with Skewed Dietary Protein Distribution Shows No Difference in Muscle Protein Synthesis or Amino Acid Utilization in Healthy Older Individuals: A Randomized Controlled Trial',
      journal: 'Nutrients',
      pmid: '36364705',
      doi: '10.3390/nu14214442',
      url: 'https://pubmed.ncbi.nlm.nih.gov/36364705/',
    },
    {
      id: 'jespersen2021',
      authors: 'Jespersen SE, Agergaard J.',
      year: 2021,
      title:
        'Evenness of dietary protein distribution is associated with higher muscle mass but not muscle strength or protein turnover in healthy adults: a systematic review',
      journal: 'European journal of nutrition',
      pmid: '33550490',
      doi: '10.1007/s00394-021-02487-2',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33550490/',
    },
    {
      id: 'schoenfeld2013',
      authors: 'Schoenfeld BJ, Aragon AA, Krieger JW.',
      year: 2013,
      title: 'The effect of protein timing on muscle strength and hypertrophy: a meta-analysis',
      journal: 'Journal of the International Society of Sports Nutrition',
      pmid: '24299050',
      doi: '10.1186/1550-2783-10-53',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24299050/',
    },
    {
      id: 'shukla2019',
      authors: 'Shukla AP, Dickison M, Coughlin N, et al.',
      year: 2019,
      title: 'The impact of food order on postprandial glycaemic excursions in prediabetes',
      journal: 'Diabetes, obesity & metabolism',
      pmid: '30101510',
      doi: '10.1111/dom.13503',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30101510/',
    },
    {
      id: 'sofer2011',
      authors: 'Sofer S, Eliraz A, Kaplan S, et al.',
      year: 2011,
      title:
        'Greater weight loss and hormonal changes after 6 months diet with carbohydrates eaten mostly at dinner',
      journal: 'Obesity (Silver Spring, Md.)',
      pmid: '21475137',
      doi: '10.1038/oby.2011.48',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21475137/',
    },
    {
      id: 'klos2023',
      authors: 'Klos B, Cook J, Crepaz L, et al.',
      year: 2023,
      title:
        'Impact of energy density on energy intake in children and adults: a systematic review and meta-analysis of randomized controlled trials',
      journal: 'European journal of nutrition',
      pmid: '36460778',
      doi: '10.1007/s00394-022-03054-z',
      url: 'https://pubmed.ncbi.nlm.nih.gov/36460778/',
    },
    {
      id: 'robinson2022',
      authors: 'Robinson E, Khuttan M, McFarland-Lesser I, et al.',
      year: 2022,
      title:
        'Calorie reformulation: a systematic review and meta-analysis examining the effect of manipulating food energy density on daily energy intake',
      journal: 'The international journal of behavioral nutrition and physical activity',
      pmid: '35459185',
      doi: '10.1186/s12966-022-01287-z',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35459185/',
    },
    {
      id: 'dimeglio2000',
      authors: 'DiMeglio DP, Mattes RD.',
      year: 2000,
      title: 'Liquid versus solid carbohydrate: effects on food intake and body weight',
      journal:
        'International journal of obesity and related metabolic disorders : journal of the International Association for the Study of Obesity',
      pmid: '10878689',
      doi: '10.1038/sj.ijo.0801229',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10878689/',
    },
    {
      id: 'mcglynn2022',
      authors: 'McGlynn ND, Khan TA, Wang L, et al.',
      year: 2022,
      title:
        'Association of Low- and No-Calorie Sweetened Beverages as a Replacement for Sugar-Sweetened Beverages With Body Weight and Cardiometabolic Risk: A Systematic Review and Meta-analysis',
      journal: 'JAMA network open',
      pmid: '35285920',
      doi: '10.1001/jamanetworkopen.2022.2092',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35285920/',
    },
    {
      id: 'min2021',
      authors: 'Min J, Kim SY, Shin IS, et al.',
      year: 2021,
      title:
        'The Effect of Meal Replacement on Weight Loss According to Calorie-Restriction Type and Proportion of Energy Intake: A Systematic Review and Meta-Analysis of Randomized Controlled Trials',
      journal: 'Journal of the Academy of Nutrition and Dietetics',
      pmid: '34144920',
      doi: '10.1016/j.jand.2021.05.001',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34144920/',
    },
    {
      id: 'dennis2010',
      authors: 'Dennis EA, Dengo AL, Comber DL, et al.',
      year: 2010,
      title:
        'Water consumption increases weight loss during a hypocaloric diet intervention in middle-aged and older adults',
      journal: 'Obesity (Silver Spring, Md.)',
      pmid: '19661958',
      doi: '10.1038/oby.2009.235',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19661958/',
    },
    {
      id: 'parretti2015',
      authors: 'Parretti HM, Aveyard P, Blannin A, et al.',
      year: 2015,
      title:
        'Efficacy of water preloading before main meals as a strategy for weight loss in primary care patients with obesity: RCT',
      journal: 'Obesity (Silver Spring, Md.)',
      pmid: '26237305',
      doi: '10.1002/oby.21167',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26237305/',
    },
    {
      id: 'robinson2014',
      authors: 'Robinson E, Almiron-Roig E, Rutters F, et al.',
      year: 2014,
      title:
        'A systematic review and meta-analysis examining the effect of eating rate on energy intake and hunger',
      journal: 'The American journal of clinical nutrition',
      pmid: '24847856',
      doi: '10.3945/ajcn.113.081745',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24847856/',
    },
    {
      id: 'ohkuma2015',
      authors: 'Ohkuma T, Hirakawa Y, Nakamura U, et al.',
      year: 2015,
      title: 'Association between eating rate and obesity: a systematic review and meta-analysis',
      journal: 'International journal of obesity (2005)',
      pmid: '26100137',
      doi: '10.1038/ijo.2015.96',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26100137/',
    },
    {
      id: 'leidy2013',
      authors: 'Leidy HJ, Ortinau LC, Douglas SM, et al.',
      year: 2013,
      title:
        'Beneficial effects of a higher-protein breakfast on the appetitive, hormonal, and neural signals controlling energy intake regulation in overweight/obese, "breakfast-skipping," late-adolescent girls',
      journal: 'The American journal of clinical nutrition',
      pmid: '23446906',
      doi: '10.3945/ajcn.112.053116',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23446906/',
    },
    {
      id: 'vujovic2022',
      authors: 'Vujović N, Piron MJ, Qian J, et al.',
      year: 2022,
      title:
        'Late isocaloric eating increases hunger, decreases energy expenditure, and modifies metabolic pathways in adults with overweight and obesity',
      journal: 'Cell metabolism',
      pmid: '36198293',
      doi: '10.1016/j.cmet.2022.09.007',
      url: 'https://pubmed.ncbi.nlm.nih.gov/36198293/',
    },
    {
      id: 'rolls1999',
      authors: 'Rolls BJ, Bell EA, Thorwart ML.',
      year: 1999,
      title:
        'Water incorporated into a food but not served with a food decreases energy intake in lean women',
      journal: 'The American journal of clinical nutrition',
      pmid: '10500012',
      doi: '10.1093/ajcn/70.4.448',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10500012/',
    },
    {
      id: 'wicherski2021',
      authors: 'Wicherski J, Schlesinger S, Fischer F.',
      year: 2021,
      title:
        'Association between Breakfast Skipping and Body Weight-A Systematic Review and Meta-Analysis of Observational Longitudinal Studies',
      journal: 'Nutrients',
      pmid: '33477881',
      doi: '10.3390/nu13010272',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33477881/',
    },
    {
      id: 'hollands2015',
      authors: 'Hollands GJ, Shemilt I, Marteau TM, et al.',
      year: 2015,
      title:
        'Portion, package or tableware size for changing selection and consumption of food, alcohol and tobacco',
      journal: 'The Cochrane database of systematic reviews',
      pmid: '26368271',
      doi: '10.1002/14651858.cd011045.pub2',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26368271/',
    },
    {
      id: 'hall2019',
      authors: 'Hall KD, Ayuketah A, Brychta R, et al.',
      year: 2019,
      title:
        'Ultra-Processed Diets Cause Excess Calorie Intake and Weight Gain: An Inpatient Randomized Controlled Trial of Ad Libitum Food Intake',
      journal: 'Cell metabolism',
      pmid: '31105044',
      doi: '10.1016/j.cmet.2019.05.008',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31105044/',
    },
    {
      id: 'madigan2015',
      authors: 'Madigan CD, Daley AJ, Lewis AL, et al.',
      year: 2015,
      title:
        'Is self-weighing an effective tool for weight loss: a systematic literature review and meta-analysis',
      journal: 'The international journal of behavioral nutrition and physical activity',
      pmid: '26293454',
      doi: '10.1186/s12966-015-0267-4',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26293454/',
    },
    {
      id: 'benn2016',
      authors: 'Benn Y, Webb TL, Chang BP, et al.',
      year: 2016,
      title: 'What is the psychological impact of self-weighing? A meta-analysis',
      journal: 'Health psychology review',
      pmid: '26742706',
      doi: '10.1080/17437199.2016.1138871',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26742706/',
    },
    {
      id: 'hollis2008',
      authors: 'Hollis JF, Gullion CM, Stevens VJ, et al.',
      year: 2008,
      title: 'Weight loss during the intensive intervention phase of the weight-loss maintenance trial',
      journal: 'American journal of preventive medicine',
      pmid: '18617080',
      doi: '10.1016/j.amepre.2008.04.013',
      url: 'https://pubmed.ncbi.nlm.nih.gov/18617080/',
    },
    {
      id: 'berry2021',
      authors: 'Berry R, Kassavou A, Sutton S.',
      year: 2021,
      title:
        'Does self-monitoring diet and physical activity behaviors using digital technology support adults with obesity or overweight to lose weight? A systematic literature review with meta-analysis',
      journal:
        'Obesity reviews : an official journal of the International Association for the Study of Obesity',
      pmid: '34192411',
      doi: '10.1111/obr.13306',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34192411/',
    },
    {
      id: 'westenhoefer1999',
      authors: 'Westenhoefer J, Stunkard AJ, Pudel V.',
      year: 1999,
      title: 'Validation of the flexible and rigid control dimensions of dietary restraint',
      journal: 'The International journal of eating disorders',
      pmid: '10349584',
      doi: '10.1002/(sici)1098-108x(199907)26:1<53::aid-eat7>3.0.co;2-n',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10349584/',
    },
    {
      id: 'jensen2024',
      authors: 'Jensen MT, Nielsen SS, Jessen-Winge C, et al.',
      year: 2024,
      title:
        'The effectiveness of social-support-based weight-loss interventions-a systematic review and meta-analysis',
      journal: 'International journal of obesity (2005)',
      pmid: '38332127',
      doi: '10.1038/s41366-024-01468-9',
      url: 'https://pubmed.ncbi.nlm.nih.gov/38332127/',
    },
    {
      id: 'gong2018',
      authors: 'Gong Y, Trentadue TP, Shrestha S, et al.',
      year: 2018,
      title:
        'Financial incentives for objectively-measured physical activity or weight loss in adults with chronic health conditions: A meta-analysis',
      journal: 'PloS one',
      pmid: '30252864',
      doi: '10.1371/journal.pone.0203939',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30252864/',
    },
    {
      id: 'hondmann2026',
      authors: 'Hondmann SM, van Vliet MHM, van Eersel RA, et al.',
      year: 2026,
      title:
        'Enhancing Weight Loss Programs: A Meta-Analysis of Financial Incentives and Behavior Change Techniques',
      journal:
        'Obesity reviews : an official journal of the International Association for the Study of Obesity',
      pmid: '41846433',
      doi: '10.1111/obr.70124',
      url: 'https://pubmed.ncbi.nlm.nih.gov/41846433/',
    },
    {
      id: 'jahrami2020',
      authors: 'Jahrami HA, Alsibai J, Clark CCT, et al.',
      year: 2020,
      title:
        'A systematic review, meta-analysis, and meta-regression of the impact of diurnal intermittent fasting during Ramadan on body weight in healthy subjects aged 16 years and above',
      journal: 'European journal of nutrition',
      pmid: '32157368',
      doi: '10.1007/s00394-020-02216-1',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32157368/',
    },
    {
      id: 'fernando2019',
      authors: 'Fernando HA, Zibellini J, Harris RA, et al.',
      year: 2019,
      title:
        'Effect of Ramadan Fasting on Weight and Body Composition in Healthy Non-Athlete Adults: A Systematic Review and Meta-Analysis',
      journal: 'Nutrients',
      pmid: '30813495',
      doi: '10.3390/nu11020478',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30813495/',
    },
    {
      id: 'kul2014',
      authors: 'Kul S, Savaş E, Öztürk ZA, et al.',
      year: 2014,
      title:
        'Does Ramadan fasting alter body weight and blood lipids and fasting blood glucose in a healthy population? A meta-analysis',
      journal: 'Journal of religion and health',
      pmid: '23423818',
      doi: '10.1007/s10943-013-9687-0',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23423818/',
    },
    {
      id: 'parr2014',
      authors: 'Parr EB, Camera DM, Areta JL, et al.',
      year: 2014,
      title:
        'Alcohol ingestion impairs maximal post-exercise rates of myofibrillar protein synthesis following a single bout of concurrent training',
      journal: 'PloS one',
      pmid: '24533082',
      doi: '10.1371/journal.pone.0088384',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24533082/',
    },
    {
      id: 'wilding2021',
      authors: 'Wilding JPH, Batterham RL, Calanna S, et al.',
      year: 2021,
      title: 'Once-Weekly Semaglutide in Adults with Overweight or Obesity',
      journal: 'The New England journal of medicine',
      pmid: '33567185',
      doi: '10.1056/nejmoa2032183',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33567185/',
    },
    {
      id: 'jastreboff2022',
      authors: 'Jastreboff AM, Aronne LJ, Ahmad NN, et al.',
      year: 2022,
      title: 'Tirzepatide Once Weekly for the Treatment of Obesity',
      journal: 'The New England journal of medicine',
      pmid: '35658024',
      doi: '10.1056/nejmoa2206038',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35658024/',
    },
    {
      id: 'jastreboff2023',
      authors: 'Jastreboff AM, Kaplan LM, Frías JP, et al.',
      year: 2023,
      title: 'Triple-Hormone-Receptor Agonist Retatrutide for Obesity - A Phase 2 Trial',
      journal: 'The New England journal of medicine',
      pmid: '37366315',
      doi: '10.1056/nejmoa2301972',
      url: 'https://pubmed.ncbi.nlm.nih.gov/37366315/',
    },
    {
      id: 'bikou2024',
      authors: 'Bikou A, Dermiki-Gkana F, Penteris M, et al.',
      year: 2024,
      title: 'A systematic review of the effect of semaglutide on lean mass: insights from clinical trials',
      journal: 'Expert opinion on pharmacotherapy',
      pmid: '38629387',
      doi: '10.1080/14656566.2024.2343092',
      url: 'https://pubmed.ncbi.nlm.nih.gov/38629387/',
    },
    {
      id: 'knowler2002',
      authors: 'Knowler WC, Barrett-Connor E, Fowler SE, et al.',
      year: 2002,
      title: 'Reduction in the incidence of type 2 diabetes with lifestyle intervention or metformin',
      journal: 'The New England journal of medicine',
      pmid: '11832527',
      doi: '10.1056/nejmoa012512',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11832527/',
    },
    {
      id: 'diabetes2012',
      authors: 'Diabetes Prevention Program Research Group.',
      year: 2012,
      title:
        'Long-term safety, tolerability, and weight loss associated with metformin in the Diabetes Prevention Program Outcomes Study',
      journal: 'Diabetes care',
      pmid: '22442396',
      doi: '10.2337/dc11-1299',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22442396/',
    },
    {
      id: 'torgerson2004',
      authors: 'Torgerson JS, Hauptman J, Boldrin MN, et al.',
      year: 2004,
      title:
        'XENical in the prevention of diabetes in obese subjects (XENDOS) study: a randomized study of orlistat as an adjunct to lifestyle changes for the prevention of type 2 diabetes in obese patients',
      journal: 'Diabetes care',
      pmid: '14693982',
      doi: '10.2337/diacare.27.1.155',
      url: 'https://pubmed.ncbi.nlm.nih.gov/14693982/',
    },
    {
      id: 'sjostrom2007',
      authors: 'Sjöström L, Narbro K, Sjöström CD, et al.',
      year: 2007,
      title: 'Effects of bariatric surgery on mortality in Swedish obese subjects',
      journal: 'The New England journal of medicine',
      pmid: '17715408',
      doi: '10.1056/nejmoa066254',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17715408/',
    },
    {
      id: 'cai2018',
      authors: 'Cai X, Yang W, Gao X, et al.',
      year: 2018,
      title:
        'The Association Between the Dosage of SGLT2 Inhibitor and Weight Reduction in Type 2 Diabetes Patients: A Meta-Analysis',
      journal: 'Obesity (Silver Spring, Md.)',
      pmid: '29165885',
      doi: '10.1002/oby.22066',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29165885/',
    },
    {
      id: 'confederat2026',
      authors: 'Confederat LG, Pînzariu AC, Serban IL, et al.',
      year: 2026,
      title: 'SGLT2 Inhibitors Between Benefits and Euglycemic Ketoacidosis: A Concise Review',
      journal: 'International journal of molecular sciences',
      pmid: '42352947',
      doi: '10.3390/ijms27125224',
      url: 'https://pubmed.ncbi.nlm.nih.gov/42352947/',
    },
    {
      id: 'isidori2005',
      authors: 'Isidori AM, Giannetta E, Greco EA, et al.',
      year: 2005,
      title:
        'Effects of testosterone on body composition, bone metabolism and serum lipid profile in middle-aged men: a meta-analysis',
      journal: 'Clinical endocrinology',
      pmid: '16117815',
      doi: '10.1111/j.1365-2265.2005.02339.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16117815/',
    },
    {
      id: 'bhasin1996',
      authors: 'Bhasin S, Storer TW, Berman N, et al.',
      year: 1996,
      title:
        'The effects of supraphysiologic doses of testosterone on muscle size and strength in normal men',
      journal: 'The New England journal of medicine',
      pmid: '8637535',
      doi: '10.1056/nejm199607043350101',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8637535/',
    },
    {
      id: 'kaptein2009',
      authors: 'Kaptein EM, Beale E, Chan LS.',
      year: 2009,
      title: 'Thyroid hormone therapy for obesity and nonthyroidal illnesses: a systematic review',
      journal: 'The Journal of clinical endocrinology and metabolism',
      pmid: '19737920',
      doi: '10.1210/jc.2009-0899',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19737920/',
    },
    {
      id: 'schoenfeld2018',
      authors: 'Schoenfeld BJ, Aragon AA.',
      year: 2018,
      title:
        'How much protein can the body use in a single meal for muscle-building? Implications for daily protein distribution',
      journal: 'Journal of the International Society of Sports Nutrition',
      pmid: '29497353',
      doi: '10.1186/s12970-018-0215-1',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29497353/',
    },
    {
      id: 'ma2009',
      authors: 'Ma J, Stevens JE, Cukier K, et al.',
      year: 2009,
      title:
        'Effects of a protein preload on gastric emptying, glycemia, and gut hormones after a carbohydrate meal in diet-controlled type 2 diabetes',
      journal: 'Diabetes care',
      pmid: '19542012',
      doi: '10.2337/dc09-0723',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19542012/',
    },
    {
      id: 'king2018',
      authors: 'King DG, Walker M, Campbell MD, et al.',
      year: 2018,
      title:
        'A small dose of whey protein co-ingested with mixed-macronutrient breakfast and lunch meals improves postprandial glycemia and suppresses appetite in men with type 2 diabetes: a randomized controlled trial',
      journal: 'The American journal of clinical nutrition',
      pmid: '29635505',
      doi: '10.1093/ajcn/nqy019',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29635505/',
    },
    {
      id: 'lopez2011',
      authors: 'López Barrón G, Bacardí Gascón M, De Lira García C, et al.',
      year: 2011,
      title: '[Meal replacement efficacy on long-term weight loss: a systematic review]',
      journal: 'Nutricion hospitalaria',
      pmid: '22411370',
      doi: '10.1590/s0212-16112011000600011',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22411370/',
    },
    {
      id: 'kunutsor2018',
      authors: 'Kunutsor SK, Khan H, Laukkanen T, et al.',
      year: 2018,
      title:
        'Joint associations of sauna bathing and cardiorespiratory fitness on cardiovascular and all-cause mortality risk: a long-term prospective cohort study',
      journal: 'Annals of medicine',
      pmid: '28972808',
      doi: '10.1080/07853890.2017.1387927',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28972808/',
    },
    {
      id: 'dos2021',
      authors: 'Dos Santos EEP, de Araújo RC, Candow DG, et al.',
      year: 2021,
      title:
        'Efficacy of Creatine Supplementation Combined with Resistance Training on Muscle Strength and Muscle Mass in Older Females: A Systematic Review and Meta-Analysis',
      journal: 'Nutrients',
      pmid: '34836013',
      doi: '10.3390/nu13113757',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34836013/',
    },
    {
      id: 'irwin2020',
      authors: 'Irwin C, Khalesi S, Desbrow B, et al.',
      year: 2020,
      title:
        'Effects of acute caffeine consumption following sleep loss on cognitive, physical, occupational and driving performance: A systematic review and meta-analysis',
      journal: 'Neuroscience and biobehavioral reviews',
      pmid: '31837359',
      doi: '10.1016/j.neubiorev.2019.12.008',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31837359/',
    },
    {
      id: 'bird2021',
      authors: 'Bird JK, Troesch B, Warnke I, et al.',
      year: 2021,
      title:
        'The effect of long chain omega-3 polyunsaturated fatty acids on muscle mass and function in sarcopenia: A scoping systematic review and meta-analysis',
      journal: 'Clinical nutrition ESPEN',
      pmid: '34857251',
      doi: '10.1016/j.clnesp.2021.10.011',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34857251/',
    },
    {
      id: 'hoon2013',
      authors: 'Hoon MW, Johnson NA, Chapman PG, et al.',
      year: 2013,
      title:
        'The effect of nitrate supplementation on exercise performance in healthy individuals: a systematic review and meta-analysis',
      journal: 'International journal of sport nutrition and exercise metabolism',
      pmid: '23580439',
      doi: '10.1123/ijsnem.23.5.522',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23580439/',
    },
    {
      id: 'gu2026',
      authors: 'Gu J, Wei Y, Huang J, et al.',
      year: 2026,
      title:
        'Effects of beta-alanine supplementation on exercise performance and related physiological outcomes in women: a systematic review and meta-analysis',
      journal: 'Frontiers in nutrition',
      pmid: '42370349',
      doi: '10.3389/fnut.2026.1857513',
      url: 'https://pubmed.ncbi.nlm.nih.gov/42370349/',
    },
    {
      id: 'de2025',
      authors: 'de Camargo JBB, Brigatto FA.',
      year: 2025,
      title:
        'Beta-Alanine for Improving Exercise Capacity, Muscle Strength, and Functional Performance of Older Adults: A Systematic Review',
      journal: 'Journal of aging and physical activity',
      pmid: '39724872',
      doi: '10.1123/japa.2024-0118',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39724872/',
    },
    {
      id: 'rhim2020',
      authors: 'Rhim HC, Kim SJ, Park J, et al.',
      year: 2020,
      title:
        'Effect of citrulline on post-exercise rating of perceived exertion, muscle soreness, and blood lactate levels: A systematic review and meta-analysis',
      journal: 'Journal of sport and health science',
      pmid: '33308806',
      doi: '10.1016/j.jshs.2020.02.003',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33308806/',
    },
    {
      id: 'ge2026',
      authors: 'Ge X, Sun H, Wu C, et al.',
      year: 2026,
      title:
        'Effects of acute or short-term oral sodium bicarbonate supplementation on high-intensity intermittent exercise performance and physiological responses in team-sport athletes: a systematic review and meta-analysis',
      journal: 'Frontiers in nutrition',
      pmid: '42781544',
      doi: '10.3389/fnut.2026.1936178',
      url: 'https://pubmed.ncbi.nlm.nih.gov/42781544/',
    },
    {
      id: 'marcottechenard2024',
      authors: 'Marcotte-Chénard A, Tremblay R, Falkenhain K, et al.',
      year: 2024,
      title:
        'Effect of Acute and Chronic Ingestion of Exogenous Ketone Supplements on Blood Pressure: A Systematic Review and Meta-Analysis',
      journal: 'Journal of dietary supplements',
      pmid: '38145410',
      doi: '10.1080/19390211.2023.2289961',
      url: 'https://pubmed.ncbi.nlm.nih.gov/38145410/',
    },
    {
      id: 'bonnechere2026',
      authors: 'Bonnechère B, Stephens EB, Boileau AC, et al.',
      year: 2026,
      title:
        'The effect of exogenous ketone bodies on cognition across health and disease: a systematic review and meta-analysis',
      journal: 'Frontiers in nutrition',
      pmid: '42063954',
      doi: '10.3389/fnut.2026.1802531',
      url: 'https://pubmed.ncbi.nlm.nih.gov/42063954/',
    },
    {
      id: 'gholami2024',
      authors: 'Gholami F, Antonio J, Iranpour M, et al.',
      year: 2024,
      title:
        'Does green tea catechin enhance weight-loss effect of exercise training in overweight and obese individuals? a systematic review and meta-analysis of randomized trials',
      journal: 'Journal of the International Society of Sports Nutrition',
      pmid: '39350601',
      doi: '10.1080/15502783.2024.2411029',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39350601/',
    },
    {
      id: 'launholt2020',
      authors: 'Launholt TL, Kristiansen CB, Hjorth P.',
      year: 2020,
      title:
        'Safety and side effects of apple vinegar intake and its effect on metabolic parameters and body weight: a systematic review',
      journal: 'European journal of nutrition',
      pmid: '32170375',
      doi: '10.1007/s00394-020-02214-3',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32170375/',
    },
    {
      id: 'liu2026',
      authors: 'Liu S, Ouyang K, Fang X, et al.',
      year: 2026,
      title:
        'Efficacy of probiotic supplementation for body weight management in overweight and obese adults: a meta-analysis of randomized controlled trials predominantly from East Asia',
      journal: 'Frontiers in public health',
      pmid: '41938967',
      doi: '10.3389/fpubh.2026.1767108',
      url: 'https://pubmed.ncbi.nlm.nih.gov/41938967/',
    },
    {
      id: 'wirth2018',
      authors: 'Wirth M, Benson G, Schwarz C, et al.',
      year: 2018,
      title:
        'The effect of spermidine on memory performance in older adults at risk for dementia: A randomized controlled trial',
      journal: 'Cortex; a journal devoted to the study of the nervous system and behavior',
      pmid: '30388439',
      doi: '10.1016/j.cortex.2018.09.014',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30388439/',
    },
    {
      id: 'pu2023',
      authors: 'Pu SY, Huang YL, Pu CM, et al.',
      year: 2023,
      title: 'Effects of Oral Collagen for Skin Anti-Aging: A Systematic Review and Meta-Analysis',
      journal: 'Nutrients',
      pmid: '37432180',
      doi: '10.3390/nu15092080',
      url: 'https://pubmed.ncbi.nlm.nih.gov/37432180/',
    },
    {
      id: 'garciaalonso2025',
      authors: 'García-Alonso A, Sánchez-González JL, Navarro-López V, et al.',
      year: 2025,
      title:
        'The Role of HMB Supplementation in Enhancing the Effects of Resistance Training in Older Adults: A Systematic Review and Meta-Analysis on Muscle Quality, Body Composition, and Physical Function',
      journal: 'Nutrients',
      pmid: '41305674',
      doi: '10.3390/nu17223624',
      url: 'https://pubmed.ncbi.nlm.nih.gov/41305674/',
    },
    {
      id: 'romu2016',
      authors: 'Romu T, Vavruch C, Dahlqvist-Leinhard O, et al.',
      year: 2016,
      title:
        'A randomized trial of cold-exposure on energy expenditure and supraclavicular brown adipose tissue volume in humans',
      journal: 'Metabolism: clinical and experimental',
      pmid: '27173471',
      doi: '10.1016/j.metabol.2016.03.012',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27173471/',
    },
    {
      id: 'huo2022',
      authors: 'Huo C, Song Z, Yin J, et al.',
      year: 2022,
      title:
        'Effect of Acute Cold Exposure on Energy Metabolism and Activity of Brown Adipose Tissue in Humans: A Systematic Review and Meta-Analysis',
      journal: 'Frontiers in physiology',
      pmid: '35837014',
      doi: '10.3389/fphys.2022.917084',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35837014/',
    },
  ],
};

export default topic;
