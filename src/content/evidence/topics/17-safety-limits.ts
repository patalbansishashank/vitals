import type { EvidenceTopic } from '../schema';

const topic: EvidenceTopic = {
  dossier: '17',
  slug: 'safety-limits',
  title: 'Safety limits: what the Planner will not do, and why',
  scope:
    'This topic explains the safety limits built into Vitals: the bounds the Planner will never cross, and the warnings the Simulator shows when a regime goes beyond them. For each family of limits (energy floors, rate of loss, energy availability, protein and fat floors, fasting length, refeeding, electrolytes, gallstones and who is excluded) it says what the limit is, why it exists and how strong the evidence is. Many limits are conventions or proposals rather than measured thresholds, and the text says so.',
  mechanisms: [
    {
      id: '17-energy-floors',
      title: 'Energy floors: 1,200 kcal for women, 1,500 kcal for men',
      category: 'energy',
      summary:
        "When a deficit is planned, Vitals' Planner will not let the 7-day average intake fall below 1,200 kcal a day for women or 1,500 kcal for men. These numbers come from the lower end of typical guideline prescriptions. They are conventions, not measured physiological thresholds. Below them, guidelines place dieting under professional support, and below 800 kcal a day in a medical setting.",
      howModelled:
        'The Planner checks the trailing 7-day mean intake. If a candidate plan is below the floor, intake is raised or the plan is discarded. The Simulator still runs such a plan and shows a caution below the floor, and a danger message for under 800 kcal a day on 3 or more days (deliberate fasts are handled by the fasting tiers). Days of the 5:2 kind have their own limit. The floor is paired with a deficit cap and an energy-availability rule, because a fixed number ignores body size.',
      keyNumbers: [
        {
          label: 'Floor on the 7-day mean intake',
          value: '1,200 kcal/d (women); 1,500 kcal/d (men)',
        },
        {
          label: 'AHA/ACC/TOS guideline',
          value:
            'Typical prescription 1,200–1,500 kcal/d (women), 1,500–1,800 kcal/d (men), or a 500–750 kcal/d deficit, or a 30 % deficit; initial goal 5–10 % loss in 6 months',
          note: 'Under 800 kcal a day only in limited circumstances by trained practitioners in a medical setting (Class IIa, level of evidence A).',
          referenceIds: ['jensen2014'],
        },
        {
          label: 'NICE guideline NG246 (2025)',
          value:
            'Low-energy diets of 800–1,200 kcal only within a specialist service for BMI 30 or above (or overweight with type 2 diabetes); very-low-energy diets under 800 kcal only for a clinically assessed need to lose weight rapidly',
          note: 'Both must be nutritionally complete, last no more than 12 weeks, be supervised and give access to a dietitian. Risks include constipation, fatigue and hair loss.',
          referenceIds: ['nice2025'],
        },
        {
          label: 'Restricted days of the 5:2 kind',
          value:
            'At least 500 kcal (women) or 600 kcal (men); at most 2 such days in any 7; never consecutive',
          note: 'A 5:2 arm eating about 2710 kJ (about 650 kcal) on 2 days a week for 6 months matched continuous restriction in 107 overweight women (weekly mean 25 % deficit; −6.4 vs −5.6 kg).',
          referenceIds: ['harvie2011'],
        },
        {
          label: 'Very-low-calorie vs low-calorie diets (meta-analysis of 6 RCTs)',
          value: 'Short-term loss 16.1 % vs 9.7 %; long-term 6.3 % vs 5.0 % (not significant)',
          referenceIds: ['tsai2006'],
        },
      ],
      timeCourse: 'The floor applies to the 7-day mean, so single low days are allowed within that average.',
      moderators:
        'The floor does not change with body size, which is why it is combined with the deficit cap and the energy-availability limit.',
      grade: 'B',
      gradeReason:
        'Guideline bounds are well supported by consensus, but they are prescription conventions that no trial has tested for unsupervised users.',
      status: 'established',
      caveats:
        'A floor of 1,200 kcal is a convention, not a physiological safe minimum: it is the lower bound of typical guideline ranges, and NICE places even 800–1,200 kcal inside specialist services. No randomised trial tests it for unsupervised people. The way limits scale with body size is a design choice.',
      referenceIds: ['jensen2014', 'nice2025', 'harvie2011', 'tsai2006'],
      relatedMetricIds: [],
    },
    {
      id: '17-deficit-cap',
      title: 'How big a deficit is too big',
      category: 'energy',
      summary:
        "Vitals caps the deficit as a share of the person's maintenance energy: 25 % by default, 30 % if BMI is 30 or above, 20 % if BMI is under 25, 15 % from age 65, and 10 % when body fat is within 4 points of its floor. The shape is Vitals' own design. It is anchored to trials in which deficits of about 25–30 % or more led to more muscle or bone loss.",
      howModelled:
        'The cap is a hard filter on the modelled 7-day deficit. If a plan exceeds it, the Planner reduces the deficit. In the Simulator, going over the cap shows a caution, and a deficit above 40 % (a proposed threshold) shows a danger message. Because energy expenditure falls as adaptation builds, the deficit is checked on the modelled maintenance value, not on a fixed calorie target.',
      equation:
        'cap = 25 %\nif BMI ≥ 30: cap = 30 %;  if BMI < 25: cap = 20 %\nif age ≥ 65: cap = min(cap, 15 %)\nif body fat ≤ body-fat floor + 4 points: cap = min(cap, 10 %)',
      keyNumbers: [
        {
          label: 'AHA/ACC/TOS guideline',
          value: 'Lists a 30 % energy deficit as one option',
          referenceIds: ['jensen2014'],
        },
        {
          label: 'CALERIE trial: 25 % restriction target for 2 years (BMI 25.1)',
          value:
            'Bone loss: lumbar −0.013, hip −0.017, femoral neck −0.015 g/cm² against control (n = 218, −7.5 kg)',
          referenceIds: ['villareal2016'],
        },
        {
          label: 'Lean athletes: slow arm 19 % vs fast arm 30 % deficit',
          value: 'The 19 % arm preserved lean body mass; the 30 % arm did not',
          referenceIds: ['garthe2011'],
        },
        {
          label: 'MATADOR: 33 % deficit in 2-week blocks (BMI about 34)',
          value: 'Anchor for the upper end of what was studied',
          referenceIds: ['byrne2018'],
        },
        {
          label: 'Young trained men, about 40 % deficit for 4 weeks',
          value: 'Not adopted as an anchor: short and supervised',
          referenceIds: ['longland2016'],
        },
        {
          label: '5:2 weekly mean deficit',
          value: '25 %',
          referenceIds: ['harvie2011'],
        },
        {
          label: 'Simulator thresholds',
          value: 'Caution above the cap and up to 40 %; danger above 40 % (proposed)',
        },
      ],
      grade: 'C',
      gradeReason:
        'The cap shape is an engineering proposal anchored on a few trials with different populations and designs.',
      status: 'proposed-fit',
      caveats:
        'The size-scaling of the cap is a design choice, graded D. The trial anchors span very different populations, from lean athletes to men with obesity.',
      referenceIds: ['jensen2014', 'villareal2016', 'garthe2011', 'byrne2018', 'longland2016', 'harvie2011'],
      relatedMetricIds: [],
    },
    {
      id: '17-rate-of-loss-cap',
      title: 'How fast is too fast: weekly and total weight loss',
      category: 'body',
      summary:
        'Vitals limits weight loss to 0.75 % of body weight a week by default, 0.5 % for lean people, 1.0 % for people with more body fat, and never more than 1.5 kg a week. It also limits the total loss in one plan to 20 % of starting weight. The reasons are gallstones, faster muscle loss and hormone changes. Fast loss does not, in a randomised trial, mean more regain.',
      howModelled:
        'The rule uses tissue mass, which leaves out glycogen, its water and gut contents, so a big first-day water drop does not trip it. The rate is the slope over the trailing 14 days. If a plan exceeds the cap, the Planner slows it, and the Simulator shows a caution above the cap and a danger message above 1.5 kg a week.',
      equation:
        'cap (% of body weight per week) = 0.75 by default\n  0.5 if body fat ≤ floor + 6 points (men ≤ 16 %, women ≤ 24 %)\n  1.0 if BMI ≥ 30 or body fat ≥ 30 % (men) / 40 % (women)\n  no more than 0.5 for ages 65–74\nalways ≤ 1.5 kg per week; total loss in one plan ≤ 20 % of starting weight',
      keyNumbers: [
        {
          label: 'Gallstone incidence against weekly loss',
          value: 'Rises exponentially above 1.5 kg/week',
          note: 'Curve r² 0.98 across 9 groups.',
          referenceIds: ['weinsier1995'],
        },
        {
          label: 'Recommended pace to protect lean mass',
          value: '0.5–1 % of body weight per week; leaner people slower',
          referenceIds: ['helms2014'],
        },
        {
          label: 'Elite athletes: 0.7 vs 1.4 % per week',
          value: 'Lean body mass +2.1 % vs −0.2 %',
          referenceIds: ['garthe2011'],
        },
        {
          label: 'Rapid vs gradual loss (RCT, BMI 30–45): 12 vs 36 weeks',
          value: 'Regain at 144 weeks 70.5 % vs 71.2 %',
          note: 'The cap is about harms, not regain. The rapid arm aimed at 15 % in 12 weeks (about 1.25 % a week) under supervision and is not adopted.',
          referenceIds: ['purcell2014'],
        },
        {
          label: 'Total loss above 24 % of initial weight',
          value: 'A gallstone risk factor',
          referenceIds: ['erlinger2000'],
        },
        {
          label: 'Minnesota semi-starvation study',
          value:
            'More than 25 % weight loss with anaemia, fatigue, apathy, weakness, irritability and oedema',
          referenceIds: ['kalm2005'],
        },
        {
          label: 'Simulator thresholds',
          value:
            'Caution above the cap; danger above 1.5 kg/week; caution at a cumulative loss over 20 %; danger over 24 %',
        },
      ],
      moderators: 'Body fat and BMI (leaner means a slower cap), age (65–74 means 0.5 % at most).',
      grade: 'C',
      gradeReason:
        'Gallstone data are good (B) but the lean-mass and total-loss limits rest on small trials and case data (C/D).',
      status: 'proposed-fit',
      caveats:
        'The shape of the rate cap is a proposal anchored to the cited trials. The total-loss limit rests on gallstone risk factors and one historical study.',
      referenceIds: ['weinsier1995', 'helms2014', 'garthe2011', 'purcell2014', 'erlinger2000', 'kalm2005'],
      relatedMetricIds: [],
    },
    {
      id: '17-energy-availability',
      title: 'Energy availability: 30 kcal per kg of lean mass as a lower bound',
      category: 'hormones',
      summary:
        "Energy availability is the energy left for the body's basic functions after exercise: intake minus exercise energy, per kg of lean mass. In short laboratory studies in women, reproductive hormones were disrupted below about 30 kcal/kg/day. Vitals uses 30 as a conservative lower bound for everyone. It is debated, and men appear to tolerate lower values.",
      howModelled:
        'The limit is checked on the 7-day mean. Below 30, the Planner raises intake or cuts exercise, and the Simulator shows a danger message. Values of 30–45 count as reduced and are acceptable for a short fat-loss phase, and 45 or more as adequate. Exercise energy is counted net of resting energy.',
      equation:
        'energy availability = (energy intake − exercise energy expenditure) / fat-free mass, in kcal per kg per day',
      keyNumbers: [
        {
          label: 'Zones',
          value: '≥ 45 adequate; 30–45 reduced; < 30 problematic',
          referenceIds: ['mountjoy2023'],
        },
        {
          label: 'Reproductive hormones (29 sedentary women, 5 days)',
          value:
            'Pulsing of luteinising hormone intact at 30 kcal/kg/d and disrupted below (arms at 45, 30, 20 and 10 with exercise of 15 kcal/kg lean mass/d)',
          referenceIds: ['loucks2003'],
        },
        {
          label: 'Bone turnover in exercising women',
          value: 'Bone-formation markers suppressed at 30 and at all restricted levels; resorption up at 10',
          referenceIds: ['ihle2004'],
        },
        {
          label: 'Men',
          value: 'Appear to tolerate lower values (about 9–25 kcal/kg/d)',
          referenceIds: ['mountjoy2023'],
        },
        {
          label: 'Other indicators in the 2023 consensus',
          value:
            'Resting metabolic rate under 30 kcal/kg lean mass/d or a ratio under 0.90; eating-disorder questionnaire global score above 2.30 (women) or 1.68 (men)',
          note: 'Adaptable low energy availability is described as typically a short-term experience.',
          referenceIds: ['mountjoy2023'],
        },
        {
          label: 'Simulator thresholds',
          value: 'Info at 35–45; caution at 30–35 for over 14 days; danger below 30',
        },
      ],
      timeCourse:
        'Judged over a week or more; the laboratory studies were 5 days long, and the Simulator cautions at more than 14 days near 30.',
      moderators:
        'Sex (the threshold is best supported in women), training load and how lean mass is estimated.',
      grade: 'B',
      gradeReason:
        'Short laboratory studies in women agree (grade B), but there is little support for men or free-living use (grade D).',
      status: 'contested',
      caveats:
        'The 2023 consensus says a universal 30 is debated and carries risks as a definitive threshold. Vitals uses it as a conservative bound. Estimating lean mass from sliders makes the calculation uncertain.',
      referenceIds: ['mountjoy2023', 'loucks2003', 'ihle2004'],
      relatedMetricIds: ['energyAvailability'],
    },
    {
      id: '17-body-size-floors',
      title: 'BMI and body-fat floors',
      category: 'body',
      summary:
        'Vitals will not start a deficit at a BMI under 20 or plan below a BMI of 19, and it will not plan below body-fat floors of 10 % for men and 18 % for women. There is no accepted health-based optimum for body fat, so the floors are placed a few points above the case-study minimums to allow for estimation error. The evidence is case series and one historical study.',
      howModelled:
        'The Planner clips or rejects plans that would cross a floor. The Simulator shows a caution for BMI under 20 and body fat under 12 % (men) or 20 % (women), and a danger message for BMI under 18.5 and body fat under 8 % (men) or 15 % (women). The margins allow for a body-fat estimate that can be off by about 4 points.',
      keyNumbers: [
        {
          label: 'BMI limits',
          value:
            'Start a deficit only at BMI ≥ 20.0; projected BMI ≥ 19.0 on every day; underweight is below 18.5',
          note: 'The margins of 1.5 and 0.5 BMI points cover a ±3 kg error in the body-fat slider (proposed).',
          referenceIds: ['nice2025'],
        },
        {
          label: 'Body-fat floors',
          value: '10 % (men); 18 % (women); no new deficit block when within 2 points of the floor',
          note: 'Proposed: a physiological minimum plus about 4–5 points for estimation error.',
        },
        {
          label: 'Accuracy of body-fat estimates from sliders and BMI',
          value: 'Standard error of estimate 2.8–5.4 percentage points',
          referenceIds: ['gallagher2000'],
        },
        {
          label: 'Man, body fat 14.8 → 4.5 % over 6 months (case)',
          value:
            'Heart rate 53 → 27; blood pressure 132/69 → 104/56; testosterone 9.22 → 2.27 ng/mL; mood disturbance score 6 → 43',
          note: 'Recovered within 6 months, except strength.',
          referenceIds: ['rossow2013'],
        },
        {
          label: 'Women, −12 % body weight and −35–50 % fat mass over 4 months',
          value:
            'Leptin, T3, testosterone and oestradiol fell; menstrual irregularity rose; recovery took 3–4 months (T3 and testosterone not fully)',
          note: '6 of 27 fell below 10 % body fat; lowest BMI 18.7–19.0.',
          referenceIds: ['hulmi2016'],
        },
        {
          label: 'Body-fat optimum',
          value: 'No accepted health-based optimum exists',
          referenceIds: ['sundgotborgen2013'],
        },
        {
          label: 'Weight-management apps (audit of top 100)',
          value:
            'About 1 in 5 allowed underweight goal-setting; the authors recommend blocking goals implying a BMI under 18.5',
          referenceIds: ['honary2019'],
        },
        {
          label: 'Minnesota semi-starvation',
          value:
            'More than 25 % weight loss with anaemia, fatigue, apathy, weakness, irritability and oedema',
          referenceIds: ['kalm2005'],
        },
      ],
      grade: 'D',
      gradeReason:
        'The numeric floors rest on case series and a statement that no optimum exists, not on controlled trials.',
      status: 'proposed-fit',
      caveats:
        'Commonly quoted essential-fat ranges (about 2–5 % for men and 10–13 % for women) could not be confirmed against the original paper. The floors need review by a clinical panel and adjustment for ethnicity and age.',
      referenceIds: [
        'nice2025',
        'gallagher2000',
        'rossow2013',
        'hulmi2016',
        'sundgotborgen2013',
        'honary2019',
        'kalm2005',
      ],
      relatedMetricIds: [],
    },
    {
      id: '17-protein-floor-and-cap',
      title: 'Protein: a floor of 0.8 to 1.2 g/kg and a ceiling',
      category: 'body',
      summary:
        'Vitals requires at least 0.8 g of protein per kg (the adult minimum), rising to 1.2 g/kg in a deficit or from age 65. It also caps protein at 35 % of energy or 3.1 g per kg of lean mass, whichever is lower. The floor exists because muscle loss is likely below it during a deficit. The ceiling exists because very high intakes cause nausea and crowd out other nutrients. Healthy kidneys showed no harm from high protein.',
      howModelled:
        'Protein is checked on the 7-day mean against a reference weight of the smaller of body weight and 27.5 × height² (a proposal). Below the floor the Planner raises protein; above the ceiling it lowers it. The Simulator shows an info or caution below the floor and above the ceiling, and a danger message above 35 % of energy or above 1.3 g/kg with kidney disease.',
      keyNumbers: [
        {
          label: 'Floor',
          value:
            '≥ 0.8 g/kg always; ≥ 1.2 g/kg if the deficit is over 10 %, age is 65 or over, or resistance training is done in a deficit; ≥ 1.0 g/kg at maintenance from 65',
          referenceIds: ['wolfe2017', 'bauer2013'],
        },
        {
          label: 'Ceiling',
          value:
            '≤ min(35 % of energy, 3.1 g/kg lean mass); soft target ≤ 2.2 g/kg; ≤ 1.3 g/kg with a kidney-disease flag',
        },
        {
          label: '40 % deficit with exercise: 2.4 vs 1.2 g/kg',
          value: 'Lean mass +1.2 vs +0.1 kg; fat −4.8 vs −3.5 kg',
          referenceIds: ['longland2016'],
        },
        {
          label: 'Older adults',
          value: '≥ 1.0–1.2 g/kg, ≥ 1.2 with exercise, 1.2–1.5 with disease',
          referenceIds: ['bauer2013'],
        },
        {
          label: 'Lean dieting athletes',
          value: '2.3–3.1 g/kg of lean mass, scaled to deficit and leanness',
          referenceIds: ['helms2014a', 'jager2017', 'hector2018'],
        },
        {
          label: 'Upper end',
          value:
            'Above 35 % of energy risks hyperammonaemia and nausea; suggested ceiling about 25 % of energy or 2–2.5 g/kg',
          referenceIds: ['bilsborough2006'],
        },
        {
          label: 'Kidney disease (CKD stages G3–G5)',
          value: 'About 0.8 g/kg and avoid above 1.3 g/kg',
          referenceIds: ['kdigo2024'],
        },
        {
          label: 'Healthy adults',
          value: 'No harm to kidney filtration in 28 RCTs (n = 1,358) at 1.5 g/kg or more',
          referenceIds: ['devries2018'],
        },
      ],
      grade: 'B',
      gradeReason:
        'Trials and consensus statements support the floors (A/B); the caps rest on weaker and older sources (B/C).',
      status: 'established',
      caveats:
        'The reference weight is a proposal aligned with the protein topic. The minimum of 0.8 g/kg is the amount to avoid nitrogen loss, not a target for muscle retention in a deficit.',
      referenceIds: [
        'wolfe2017',
        'bauer2013',
        'longland2016',
        'helms2014a',
        'jager2017',
        'hector2018',
        'bilsborough2006',
        'kdigo2024',
        'devries2018',
      ],
      relatedMetricIds: [],
    },
    {
      id: '17-fat-floor',
      title: 'Fat: a floor of 15 % of energy or 30 g a day',
      category: 'fuel',
      summary:
        'Vitals requires at least the larger of 15 % of energy or 30 g of fat a day, with one meal of at least 10 g, when weight loss is fast. The main reason is gallstones: with very little fat the gallbladder does not empty, and stones formed in small trials. Essential fatty acids and testosterone in men are the other reasons.',
      howModelled:
        'The Planner raises fat to the floor. The extra requirement of a meal with at least 10 g of fat applies when the deficit is 20 % or more or weight loss is 0.75 % a week or more. If fatty acids are tracked, linoleic acid must be at least 2 % of energy and alpha-linolenic acid at least 0.25 %. The Simulator shows a caution below the floor and a danger message below 10 g a day for 7 days or more.',
      keyNumbers: [
        {
          label: 'Gallstones in rapid loss',
          value:
            'On 520 kcal with less than 2 g fat, stones formed in 4 of 6 people; on 900 kcal with 30 g of fat including one 10 g fat meal, in 0 of 7',
          referenceIds: ['gebhard1996'],
        },
        {
          label: 'Higher-fat diets and gallstones',
          value: 'Relative risk 0.09',
          note: 'Ursodeoxycholic acid gave RR 0.33 (number needed to treat 9), but sequential analysis did not confirm it.',
          referenceIds: ['stokes2014'],
        },
        {
          label: 'Essential fatty acids',
          value:
            'Adult deficiency below about 1–2 % of energy as linoleic acid; targets 2–4 % and 0.25–0.5 %',
          referenceIds: ['wolff2025'],
        },
        {
          label: 'Low-fat diets and testosterone (6 studies, n = 206)',
          value: 'Total testosterone SMD −0.38 (−0.75 to −0.01)',
          referenceIds: ['whittaker2021'],
        },
        {
          label: 'Contest-preparation practice',
          value: 'Fat 15–30 % of energy; 15–20 % is the lower end',
          referenceIds: ['helms2014'],
        },
        {
          label: 'Risk factors for gallstones',
          value:
            'Weight loss over 1.5 kg/week, loss over 24 % of body weight, no-fat very-low-calorie diets, long overnight fasts, high triglycerides',
          referenceIds: ['erlinger2000'],
        },
      ],
      grade: 'C',
      gradeReason:
        'Small trials support the gallstone link (B), while the percentage floors are mostly convention (C).',
      status: 'proposed-fit',
      referenceIds: ['gebhard1996', 'stokes2014', 'wolff2025', 'whittaker2021', 'helms2014', 'erlinger2000'],
      relatedMetricIds: [],
    },
    {
      id: '17-low-carbohydrate-limits',
      title: 'Very-low-carbohydrate eating: no floor, but conditions',
      category: 'fuel',
      summary:
        'There is no carbohydrate floor for eligible adults. Below about 50 g of net carbohydrate a day the body enters ketosis, and Vitals allows this only for people with no relevant condition, for up to 12 weeks at a time, then asks for a re-assessment. The reasons include an initial adjustment period, higher LDL cholesterol in some people, and dangerous interactions with certain medicines and conditions.',
      howModelled:
        'Net carbohydrate under 50 g a day is treated as the ketogenic range. The Planner offers it only in standard mode without a contraindication, with a sodium and fluid plan, and asks for a review after 12 weeks. The Simulator shows an information message on entering the range, a caution after 4 weeks, and a danger message with any of the conditions below.',
      keyNumbers: [
        {
          label: 'Carbohydrate reference',
          value:
            'IOM recommended intake 130 g/d, a reference for brain glucose; ketones replace glucose as brain fuel in fasting',
          referenceIds: ['pavlidou2023'],
        },
        {
          label: 'Adjustment period',
          value: '2–4 weeks of keto-flu symptoms (tiredness, headache), more urination and salt loss',
          referenceIds: ['skartun2025', 'dynka2026'],
        },
        {
          label: 'LDL cholesterol after 4 weeks of very-low-carbohydrate eating',
          value: '+1.82 mM in all 17 healthy women in one trial',
          referenceIds: ['buren2021'],
        },
        {
          label: 'Adult ketogenic-diet side effects',
          value: 'Halitosis 38 %; liver-test changes 24 %; dizziness 15–21 %; headache 8–25 %',
          referenceIds: ['dynka2026'],
        },
        {
          label: 'Contraindications',
          value:
            'Absolute: primary carnitine deficiency, CPT I/II, translocase and beta-oxidation defects, pyruvate carboxylase deficiency, porphyria. Relative: acute pancreatitis, acute liver failure, advanced liver or renal disease, familial hypercholesterolaemia',
          note: 'Caution: type 1 or 2 diabetes on specific therapies, treated hypertension, gallbladder disease, electrolyte disturbance, arrhythmia, pregnancy and lactation, underweight, intense exercise.',
          referenceIds: ['kossoff2018', 'dynka2026'],
        },
        {
          label: 'Kidney stones on medical ketogenic diets',
          value: 'About 2.5–4 % of children',
          referenceIds: ['kossoff2018', 'dynka2026'],
        },
        {
          label: 'Ketoacidosis',
          value:
            'Precipitated by low-carbohydrate diets with SGLT2 inhibitors; lactation ketoacidosis with pH 7.20 after 10 days of low-carbohydrate high-fat eating',
          referenceIds: ['goldenberg2016', 'vongeijer2015'],
        },
      ],
      grade: 'C',
      gradeReason:
        'Contraindications come from consensus and case reports; the trial evidence on safety is short and small.',
      status: 'proposed-fit',
      caveats:
        'Electrolyte supplementation for keto-flu is mechanistically plausible but no clinical study documents its effect.',
      referenceIds: [
        'pavlidou2023',
        'skartun2025',
        'dynka2026',
        'buren2021',
        'kossoff2018',
        'goldenberg2016',
        'vongeijer2015',
      ],
      relatedMetricIds: [],
    },
    {
      id: '17-fasting-duration-tiers',
      title: 'Fasting tiers: who may fast, for how long and how often',
      category: 'energy',
      summary:
        'Water-only fasting is supported in both features, but Vitals groups it into tiers by length. Up to 24 hours is allowed by default. Longer fasts are opt-in with acknowledgement and stricter eligibility. Fasts of 3–7 days are behind an expert mode that needs a clinician-supervision attestation. Fasts over 7 days are never prescribed by the Planner. No guideline endorses unsupervised fasting beyond about 72 hours.',
      howModelled:
        "A fast is counted as time with 50 kcal or less. Each tier sets who may use it, how often, and how much recovery must sit between fasts. A fast that breaks the spacing rules is simulated but flagged as less reliable, because the model's recovery assumptions no longer hold. A fast in the last tier can be simulated for up to 42 days with a persistent banner but is never proposed.",
      keyNumbers: [
        {
          label: 'T0: up to 20 h (daily eating window)',
          value: 'Allowed by default for windows of 6 h or more',
        },
        {
          label: 'T1: 20–24 h',
          value:
            'Default; up to 3 non-consecutive a week, at least 24 h of eating between; ≤ 108 fasted hours in any 7 days',
          note: 'Age 65–74: T1 is the maximum tier.',
        },
        {
          label: 'T2: 24–48 h',
          value:
            'Opt-in with acknowledgement; BMI ≥ 20; up to 3 a week if 36 h or less, up to 2 a week if 36–48 h; at least 24 h of normal eating between',
        },
        {
          label: 'T3: 48–72 h',
          value:
            'Opt-in with upgraded eligibility; BMI ≥ 22; body fat ≥ 15 % (men) / 25 % (women); at least 7 days apart; at most 2 in 30 days',
        },
        {
          label: 'T4: 3–7 days',
          value:
            'Expert mode only, with a clinician-supervision attestation; BMI ≥ 25; at least 28 days apart; at most 1 in 12 weeks and 4 a year',
        },
        {
          label: 'T5: over 7 days',
          value: 'Never proposed by the Planner; simulated up to 42 days with a persistent danger banner',
        },
        {
          label: 'Adverse events in supervised water-only fasts (768 visits)',
          value:
            'Any grade ≥ 3 adverse event 20 % by day 5, 28 % by day 10 and 32 % by day 15; serious adverse events 2 of 768 visits (0.26 %), in men aged 73 and 70',
          note: 'These first three figures are grade ≥ 3 adverse events, not serious adverse events.',
          referenceIds: ['finnell2018'],
        },
        {
          label: 'Guidance on supervision',
          value:
            'A European expert panel says all interventions during fasting should be guided by physicians or therapists trained and certified in fasting therapy',
          referenceIds: ['wilhelmi2013', 'michalsen2013'],
        },
      ],
      grade: 'C',
      gradeReason:
        'The tiers rest on supervised, screened cohorts and consensus statements; there are no data for unsupervised fasts beyond a day or so.',
      status: 'proposed-fit',
      caveats:
        'The warning text for tier T4 was corrected: it had said serious events were about 20 % by day 5. The correct statistic is that grade ≥ 3 adverse events reached 20 %, while serious adverse events were 2 of 768 visits (0.26 %). The largest supervised series was pooled over all stay lengths. T4 and the very-low-energy tier stay behind a feature flag until a clinician reviews the wording.',
      referenceIds: ['finnell2018', 'wilhelmi2013', 'michalsen2013'],
      relatedMetricIds: ['hoursFasted'],
    },
    {
      id: '17-fasting-evidence-by-tier',
      title: 'What the evidence says at each fasting length',
      category: 'recovery',
      summary:
        'Fasts of up to 24 hours were well tolerated in trials of healthy adults. Alternate-day fasting with long fast days was tried for 4 weeks. From 48 hours the data come from supervised, screened stays, where near-fainting, headaches and fatigue are common and serious events are rare. Beyond a week only historical series and small supervised cohorts exist, and the hazards there are real but mixed up with poor management.',
      howModelled:
        'This article records the numbers the tier rules rest on. Fasting physiology (nitrogen, ketones, sodium) is in the extended-fasting topic, and the safety rules draw only on the adverse-event and tolerance data.',
      keyNumbers: [
        {
          label: 'Up to 24 h: 15 RCTs (n = 1,365, overweight or obesity)',
          value:
            'Fatigue risk difference 0 % (−1 to 2); headache 0 % (−1 to 2); dropout 1 % (−2 to 4); dizziness +3 % (−0 to 6) outside early time-restricted eating',
          referenceIds: ['zhong2024'],
        },
        {
          label: 'Up to 24 h: cost to hard exercise',
          value:
            'A 24 h fast shortened time to fatigue at 79–86 % of maximal oxygen uptake (42 vs 115 min at 86 %), with hypoglycaemia implicated late',
          referenceIds: ['loy1986'],
        },
        {
          label: '24–48 h: strict alternate-day fasting, 4 weeks (healthy, non-obese, middle-aged)',
          value:
            'About 37 % calorie reduction; no adverse effects even after more than 6 months, per the abstract',
          note: 'The fast-day length (recalled as 36 h) is unverified; abstract only.',
          referenceIds: ['stekovic2019'],
        },
        {
          label: '48–72 h: 3.5-day fast (n = 8)',
          value:
            'Isokinetic strength −10 %; exercise heart rate up; aerobic endurance at 45 % of maximal oxygen uptake unchanged',
          referenceIds: ['knapik1987'],
        },
        {
          label: 'Sodium loss',
          value:
            'Peaks on days 3–4 at 100–150 mEq/d (2.3–3.4 g); cumulative 200–350 mEq (4.6–8.0 g) in week 1; weight loss ≈ 0.9 kg/d, mostly salt and water',
          referenceIds: ['kerndt1982', 'skartun2025'],
        },
        {
          label: 'Supervised stays of 2–7 days (446 of 768)',
          value:
            'Cumulative incidence by day 5: any adverse event 0.90; grade ≥ 2 0.54; grade ≥ 3 0.20 (Kaplan–Meier, pooled over all stay lengths)',
          referenceIds: ['finnell2018'],
        },
        {
          label: 'Frequency per stay (all lengths)',
          value:
            'Fatigue 48 %; insomnia 34 %; nausea 32 %; headache 30 %; raised blood pressure 29 %; near-fainting 28 %; dyspepsia 26 %; palpitations 12 %',
          referenceIds: ['finnell2018'],
        },
        {
          label:
            '3–7 days: Buchinger modified fasting (1,422 supervised adults, mean age 55, BMI 28.2), 5-day group n = 659',
          value:
            'Adverse events under 1 % (arrhythmia 3, hyponatraemia 3, hypoglycaemia 2, hypokalaemia 1, gout 1, tetany 1); no deaths; 2 hospitalisations (a 75-year-old man with coronary disease, NSTEMI on day 9; a 67-year-old woman with vomiting, dizziness and diarrhoea on day 4); uric acid +46 % (338 → 495 µmol/L)',
          referenceIds: ['wilhelmi2019'],
        },
        {
          label: '3–7 days: refeeding guidance',
          value:
            'NICE: little or no intake for over 5 days means starting at 50 % of requirements or less for 2 days; ASPEN: negligible intake for over 7 days is a single-criterion significant risk for refeeding syndrome',
          referenceIds: ['nice2006', 'solar2026'],
        },
        {
          label: 'Over 7 days: supervised stays of 8–14 d (n = 238), 15–21 d (n = 64) and 22+ d (n = 20)',
          value:
            'Grade ≥ 3 adverse events 0.32 by day 15; serious adverse events 2 of 768 stays (0.26 %; the paper prints 0.002 %): grade-3 dehydration on day 3 (man aged 73) and grade-4 hyponatraemia on day 9 (man aged 70, distilled-water-only protocol)',
          referenceIds: ['finnell2018'],
        },
        {
          label: 'Historical hazards of prolonged fasting',
          value:
            'Gout and urate stones; postural hypotension (incapacitating in 3 of 11 obese subjects at 25–62 days); arrhythmias; deaths in 1960s–70s programmes and hunger strikes at 45–76 days',
          note: 'The chart review notes that early programmes often lacked screening, stopping rules and proper refeeding, so inherent danger cannot be separated from mismanagement.',
          referenceIds: ['kerndt1982', 'finnell2018'],
        },
        {
          label: 'Modified fasts under supervision',
          value: '200–500 kcal/d for 7–21 days is described in the medically supervised evidence review',
          referenceIds: ['michalsen2013'],
        },
        {
          label: '5:2 vs continuous restriction',
          value:
            'About 650 kcal on 2 days a week for 6 months = continuous restriction for weight loss (−6.4 vs −5.6 kg, n = 107)',
          referenceIds: ['harvie2011'],
        },
      ],
      grade: 'C',
      gradeReason:
        'The strongest data (up to 24 h) are randomised trials, but longer fasts rest on selected, supervised cohorts pooled over stay lengths.',
      status: 'established',
      caveats:
        'There are no data on unsupervised fasts beyond about a day. Adverse events are pooled across durations. The original text of one safety wording, that serious events were about 20 % by day 5, refers to grade ≥ 3 events.',
      referenceIds: [
        'zhong2024',
        'loy1986',
        'stekovic2019',
        'knapik1987',
        'kerndt1982',
        'skartun2025',
        'finnell2018',
        'wilhelmi2019',
        'nice2006',
        'solar2026',
        'michalsen2013',
        'harvie2011',
      ],
      relatedMetricIds: [],
    },
    {
      id: '17-refeeding-limits',
      title: 'Refeeding after long fasts: the ramp and who is excluded',
      category: 'recovery',
      summary:
        'Eating normally straight after a long fast or a period of very little intake can cause refeeding syndrome, in which blood phosphate, potassium and magnesium fall sharply. Clinical guidance limits energy on the first days and gives thiamine. Vitals excludes anyone meeting a clinical risk criterion from fasts of 48 hours or more and builds a refeeding ramp into longer fasts.',
      howModelled:
        'For fasts of 48 hours or more, the Planner inserts a ramp. After a 48–72 h fast it is 2 days, at about 50 % and then 80–100 % of maintenance. After a 3–7 day fast it is at least the longer of 4 days or half the fast, at 50, 50, 75 and 100 % of maintenance, with thiamine. Anyone meeting any NICE or ASPEN risk criterion is excluded from fasts of 72 hours or more. Carbohydrate refeeding also makes the body hold sodium and water, which shows as a weight rebound.',
      keyNumbers: [
        {
          label: 'NICE guidance after more than 5 days of little or no intake',
          value:
            'Feed at ≤ 50 % of requirements for the first 2 days, then to full needs if monitoring shows no problems',
          referenceIds: ['nice2006'],
        },
        {
          label: 'NICE, high-risk people',
          value:
            'Start at ≤ 10 kcal/kg/d (5 if BMI under 14 or negligible intake over 15 days); build to full needs over 4–7 days; thiamine 200–300 mg/d plus vitamin B and multivitamin for 10 days',
          note: 'Replace potassium 2–4 mmol/kg/d, phosphate 0.3–0.6 mmol/kg/d and magnesium 0.2 (intravenous) or 0.4 (oral) mmol/kg/d.',
          referenceIds: ['nice2006'],
        },
        {
          label: 'NICE risk criteria',
          value:
            'One of: BMI under 16, unintentional loss over 15 % in 3–6 months, little or no intake over 10 days, low potassium, phosphate or magnesium; or two of: BMI under 18.5, loss over 10 % in 3–6 months, little or no intake over 5 days, alcohol misuse or insulin, chemotherapy, antacids or diuretics',
          referenceIds: ['nice2006'],
        },
        {
          label: 'ASPEN definition',
          value:
            'A fall of 10–20 % (mild), 20–30 % (moderate) or over 30 % or organ dysfunction (severe) in phosphate, potassium or magnesium within 5 days of restarting calories',
          referenceIds: ['dasilva2020'],
        },
        {
          label: 'Ramps used by supervised programmes',
          value: 'Refeeding for half the length of the fast',
          referenceIds: ['finnell2018'],
        },
        {
          label: 'Vitals ramp: 48–72 h fast',
          value:
            '2 days: about 50 % then 80–100 % of maintenance; no large sugar loads or alcohol; expect 1–2 kg of water rebound',
        },
        {
          label: 'Vitals ramp: 3–7 day fast',
          value:
            'At least the longer of 4 days or half the fast, at 50 / 50 / 75 / 100 % of maintenance; thiamine ≥ 200 mg/d for 5 days plus a multivitamin',
        },
        {
          label: 'Symptoms listed to users',
          value: 'Swelling of legs or face, palpitations, breathlessness, weakness, confusion',
        },
      ],
      grade: 'C',
      gradeReason:
        'The clinical criteria come from guidelines, but the ramps for healthy short fasters are proposals with no incidence data.',
      status: 'proposed-fit',
      caveats:
        'No incidence data exist for refeeding after fasts of 7 days or less in people with a BMI of 25 or more. The ASPEN energy-advancement details were not accessible and are unverified.',
      referenceIds: ['nice2006', 'dasilva2020', 'finnell2018'],
      relatedMetricIds: [],
    },
    {
      id: '17-fasting-fluids-and-electrolytes',
      title: 'Sodium, potassium, magnesium and fluid limits',
      category: 'recovery',
      summary:
        'Vitals keeps planned sodium between 1.5 and 2.3 g a day, allows up to 4.0 g only during 3–7 day fasts and the first 14 days of very-low-carbohydrate eating, and never plans below 1.0 g. Supplement limits are 1.0 g potassium and 350 mg magnesium a day. Fluids are held between 1.5 and 4.0 litres a day. The sodium doses replace measured fasting losses; the potassium and magnesium doses are conservative expert opinion.',
      howModelled:
        'The Planner clips sodium, supplement and fluid amounts to these bounds. The Simulator warns on sodium under 1.5 g a day during a fast or very-low-carbohydrate eating, on fluids under 1.5 or over 4 litres a day or over 1 litre an hour, and on potassium supplements above 1 g a day.',
      keyNumbers: [
        {
          label: 'Sodium, usual planning range',
          value: '1.5–2.3 g/d (adequate intake to chronic disease risk reduction level); never below 1.0 g/d',
          referenceIds: ['nasem2019'],
        },
        {
          label: 'Sodium in fasting tiers T3–T4 and the first 14 days under 50 g carbohydrate',
          value:
            'Up to 4.0 g/d; T2 (36 h or more) 1.5–2.5 g/d; T3 2.0–3.0 g/d from day 2 (5–7.6 g salt); T4 2.0–3.0 g/d, up to 4.0 if lightheaded with low blood pressure',
          note: 'The doses replace the measured peak loss of 2.3–3.4 g/d (100–150 mEq/d) on days 1–4.',
          referenceIds: ['kerndt1982', 'skartun2025'],
        },
        {
          label: 'Potassium supplements',
          value:
            '≤ 1.0 g/d; ≤ 2.0 g/d only in T4 opt-in; none with kidney disease or ACE-inhibitor, ARB or potassium-sparing diuretic flags',
          note: 'No upper level is set for normal kidneys, but there are case reports of cardiac abnormalities and death at very large doses. Adequate intake is 2.6 g (women) and 3.4 g (men).',
          referenceIds: ['nasem2019'],
        },
        {
          label: 'Magnesium supplements',
          value: '≤ 350 mg/d elemental (the upper level for supplements, set by diarrhoea)',
          referenceIds: ['costello2023'],
        },
        {
          label: 'Fluids',
          value:
            'Beverages 1.5–4.0 L/d; ≤ 1 L/h; fasting tiers 2.0–4.0 L/d (T2–T4 2.0–3.0); exercise fluid to thirst',
          note: 'EFSA total water adequate intake is 2.5 L (men) and 2.0 L (women) including food.',
          referenceIds: ['efsa2017'],
        },
        {
          label: 'Clinical fluid anchors',
          value:
            'NICE nutrition support 30–35 mL/kg; drinking to thirst is safe and effective and deficits of 3 % of body mass or less are tolerated',
          referenceIds: ['nice2006', 'hewbutler2017'],
        },
        {
          label: 'Hyponatraemia in a supervised water-only fast',
          value: 'A serious adverse event on day 9 in a protocol with distilled water only',
          referenceIds: ['finnell2018'],
        },
        {
          label: 'Electrolyte supplementation as such',
          value: 'No clinical study documents its effects; the rationale is the measured losses',
          referenceIds: ['skartun2025'],
        },
      ],
      grade: 'C',
      gradeReason:
        'Reference intakes are well founded (B), but the fasting doses are derived from measured losses and expert opinion (D).',
      status: 'proposed-fit',
      caveats:
        'Potassium and magnesium doses in fasting are expert opinion. Electrolyte supplementation has no trial evidence.',
      referenceIds: [
        'nasem2019',
        'kerndt1982',
        'skartun2025',
        'costello2023',
        'efsa2017',
        'nice2006',
        'hewbutler2017',
        'finnell2018',
      ],
      relatedMetricIds: [],
    },
    {
      id: '17-fasting-day-exercise-and-stop-signs',
      title: 'Exercise on fasting days, and the signs that end a fast',
      category: 'performance',
      summary:
        'Hard exercise gets harder on a fast: a 24-hour fast shortened high-intensity cycling to exhaustion, and a 3.5-day fast cut arm strength by about 10 %. Vitals caps exercise on fasting days by tier. It also lists warning signs that should end a fast, drawn from the adverse events seen in supervised fasting.',
      howModelled:
        'Exercise caps apply per tier: none maximal in the last 4 hours at T1, light-to-moderate at T2, and light walking up to 60 minutes at T3 and T4. Hard exercise on a fast day of 24 hours or more triggers a caution. The signs below are shown as a daily check-in for tiers T2 and above, and ending the fast starts the refeeding ramp for the tier already completed.',
      keyNumbers: [
        {
          label: 'Fasting-day exercise caps',
          value:
            'T1: no maximal efforts in the last 4 h; T2: light–moderate (effort 5/10 or less), no HIIT, no heavy resistance training; T3–T4: light walking up to 60 min (about 45 % of maximal oxygen uptake or less), no resistance training',
        },
        {
          label: '24 h fast, time to fatigue at 79–86 % of maximal oxygen uptake',
          value: 'Cut, for example 42 vs 115 min at 86 %',
          referenceIds: ['loy1986'],
        },
        {
          label: '3.5-day fast',
          value: 'Strength −10 %; heart rate higher at 45 % of maximal oxygen uptake',
          referenceIds: ['knapik1987'],
        },
        {
          label: 'Signs that end a fast (proposed)',
          value:
            'Fainting or near-fainting that does not settle after 10 min lying down; chest pain or an irregular or racing heartbeat; new confusion or slurred or difficult speech; severe or persistent headache; vomiting or diarrhoea for over 6 h; muscle cramps, tremor or tingling; severe abdominal or flank pain; a hot swollen joint',
          note: 'The hyponatraemia serious adverse event presented as difficulty speaking; the dehydration one followed vomiting or diarrhoea. Proposed from the adverse-event profiles.',
          referenceIds: ['wilhelmi2019', 'finnell2018', 'kerndt1982'],
        },
      ],
      grade: 'C',
      gradeReason:
        'Two small physiology studies support the exercise limits, and the stop signs are inferred from adverse-event profiles.',
      status: 'proposed-fit',
      referenceIds: ['loy1986', 'knapik1987', 'wilhelmi2019', 'finnell2018', 'kerndt1982'],
      relatedMetricIds: [],
    },
    {
      id: '17-very-low-energy-diets',
      title: 'Very-low-energy and protein-sparing diets',
      category: 'energy',
      summary:
        'Diets under 800 kcal a day, including protein-sparing modified fasts, are handled as a separate expert-only tier. Guidelines say they belong in supervised programmes for at most 12 weeks. The historical warning is the liquid-protein diets of the 1970s, linked to 17 sudden deaths from heart-rhythm failure after months on about 300–400 kcal a day. Vitals never proposes them and warns when a simulation includes one.',
      howModelled:
        'The very-low-energy tier (V) is limited to expert mode with a clinician-supervision attestation, BMI of 30 or more, blocks of up to 14 days, at least 14 days at or above the energy floor between blocks, and at most 12 weeks in total. Protein is 1.2–1.5 g/kg of ideal weight, carbohydrate under 30 g and fat 10–20 g a day, with a multivitamin and mineral and at least 2 litres of water. The Simulator shows a danger message for under 800 kcal a day.',
      keyNumbers: [
        {
          label: 'Guideline stance',
          value:
            'Very-low-energy diets are nutritionally complete, last up to 12 weeks, are supervised and have dietitian access',
          referenceIds: ['nice2025', 'jensen2014'],
        },
        {
          label: 'Protein-sparing modified fast, one supervised programme',
          value:
            'Protein 1.2–1.5 g/kg ideal weight; carbohydrate under 20–30 g; fat 10–20 g; over 2 L water; vitamin and mineral supplements; cycle of 10 days of the fast then 20 days of a balanced low-calorie diet in BMI over 34.9; 12 of 44 discontinued for intolerance',
          referenceIds: ['formisano2023'],
        },
        {
          label: 'Liquid-protein deaths of the 1970s',
          value:
            '17 sudden deaths, mostly from ventricular arrhythmia, after prolonged (median 5 months) regimens of about 300–400 kcal/d',
          note: 'Deaths were independent of supervision, potassium dose and protein quality. Common factors were marked obesity, prolonged extreme restriction and rapid loss; ECG and pathology resembled starvation, with QT prolongation.',
          referenceIds: ['sours1981', 'isner1979', 'lantigua1980'],
        },
        {
          label: 'Very-low-energy vs low-energy diets (6 RCTs)',
          value: 'Short-term loss 16.1 % vs 9.7 %; long-term 6.3 % vs 5.0 % (not significant)',
          referenceIds: ['tsai2006'],
        },
        {
          label: 'Simulator danger message threshold',
          value: 'Under 800 kcal/d for 3 days or more, when it is not a tier T1–T4 fast',
        },
      ],
      grade: 'C',
      gradeReason:
        'Guidelines are consistent, but the specific unsupervised limits (such as 14-day blocks) are judgement.',
      status: 'proposed-fit',
      caveats:
        'The 14-day block length is judgement; the 12-week cap in guidelines is for supervised programmes.',
      referenceIds: [
        'nice2025',
        'jensen2014',
        'formisano2023',
        'sours1981',
        'isner1979',
        'lantigua1980',
        'tsai2006',
      ],
      relatedMetricIds: [],
    },
    {
      id: '17-daily-eating-window',
      title: 'How short an eating window Vitals will propose',
      category: 'energy',
      summary:
        'Vitals proposes eating windows of 6 hours or more by default and windows of 4 to under 6 hours only as an opt-in. It never proposes a window under 4 hours, including a single meal a day. The reason is practical: meeting protein, fibre and micronutrient needs gets hard, and very short windows may worsen dizziness or binge urges. The evidence is mostly indirect.',
      howModelled:
        'The energy floor and protein floor must be met inside the window. For people flagged for eating-disorder risk, the window must be at least 12 hours. The Simulator shows a caution below 4 hours.',
      keyNumbers: [
        {
          label: 'Window limits',
          value:
            '≥ 6 h default; 4 to under 6 h opt-in; under 4 h never proposed; ≥ 12 h in the eating-disorder-risk mode',
        },
        {
          label: 'Studied daily fasting ranges',
          value: '18–20 h a day of fasting exists in the diabetes and intermittent-fasting literature',
          note: 'The safety of very short windows is not sourced.',
          referenceIds: ['evert2019', 'zhong2024'],
        },
      ],
      grade: 'D',
      gradeReason:
        'No direct evidence bears on the safety of very short windows; the limits are expert judgement.',
      status: 'proposed-fit',
      caveats: 'This is a proposed limit for a clinician to review.',
      referenceIds: ['evert2019', 'zhong2024'],
      relatedMetricIds: [],
    },
    {
      id: '17-gallstones',
      title: 'Gallstones and rapid weight loss',
      category: 'recovery',
      summary:
        'Rapid weight loss is a well-known cause of gallstones. New stones appear in 10–12 % of people after 8–16 weeks on a low-calorie diet, and about a third of those cause symptoms. The risk climbs steeply above 1.5 kg of loss a week and is higher with no-fat diets, long overnight fasts and very-low-calorie diets. A little fat at meals seems to protect.',
      howModelled:
        'Gallstone risk is not simulated as an outcome. It is the main reason behind the 1.5 kg a week cap, the fat floor and the warning for people with a gallstone or gallbladder history, who are limited to 0.5 % of body weight a week, at least 30 g of fat a day and no very-low-energy diets.',
      keyNumbers: [
        {
          label: 'Weekly loss and gallstone incidence',
          value: 'Rises exponentially above 1.5 kg/week (r² 0.98 across 9 groups)',
          referenceIds: ['weinsier1995'],
        },
        {
          label: 'Low-calorie diets, 8–16 weeks',
          value: 'New stones 10–12 %; about one third symptomatic',
          referenceIds: ['erlinger2000'],
        },
        {
          label: 'Risk factors',
          value:
            'Loss over 1.5 kg/week; loss over 24 % of body weight; no-fat very-low-calorie diets; long overnight fast; high triglycerides',
          referenceIds: ['erlinger2000'],
        },
        {
          label: 'Very-low-calorie diets',
          value:
            '25.5 % gallstones at 8 weeks on about 500 kcal/d; gallstone risk 15–25 times higher on very-low-energy diets',
          referenceIds: ['liddle1989', 'weinsier1993'],
        },
        {
          label: 'A little fat',
          value: '30 g of fat a day with one 10 g fat meal prevented stones (0 of 7 vs 4 of 6)',
          referenceIds: ['gebhard1996'],
        },
        {
          label: 'Higher-fat diets and ursodeoxycholic acid',
          value:
            'Relative risk 0.09 and 0.33 (number needed to treat 9), but sequential analysis did not confirm the latter',
          referenceIds: ['stokes2014'],
        },
      ],
      grade: 'B',
      gradeReason:
        'Several independent studies and reviews agree on the rate-of-loss relationship and the protective effect of some fat.',
      status: 'established',
      caveats:
        'The incidence curve at moderate rates is not available, so gallstones are shown as a flag, not a projected outcome.',
      referenceIds: [
        'weinsier1995',
        'erlinger2000',
        'liddle1989',
        'weinsier1993',
        'gebhard1996',
        'stokes2014',
      ],
      relatedMetricIds: [],
    },
    {
      id: '17-deficit-duration-and-breaks',
      title: 'How long a deficit can run before a break',
      category: 'energy',
      summary:
        'Vitals limits a continuous deficit of 15 % or more to 12 weeks, then requires at least a week (by default two) at maintenance. A deficit of 5–15 % may run up to 26 weeks with at least a two-week break. The evidence for breaks is small: they did not reduce fat loss and lowered hunger. The bone-loss evidence for long deficits is stronger.',
      howModelled:
        'The Planner inserts a maintenance break when a deficit block reaches its limit. The Simulator shows a caution after 12 weeks at a deficit of 15 % or more and an information message on bone loss for long deficits.',
      keyNumbers: [
        {
          label: 'Limits',
          value:
            'Deficit ≥ 15 %: up to 12 weeks then ≥ 1 week (default 2) at maintenance; deficit 5–15 %: up to 26 weeks then ≥ 2 weeks',
          referenceIds: ['nice2025'],
        },
        {
          label: 'MATADOR (n = 47 men, BMI about 34)',
          value:
            '8 × 2 weeks at 67 % of maintenance alternating with 2 weeks of balance: 14.1 vs 9.1 kg loss, weight stable in balance blocks',
          referenceIds: ['byrne2018'],
        },
        {
          label: 'ICECAP (n = 61 resistance-trained)',
          value:
            '4 × 3 weeks of deficit plus 3 × 1 week of balance equalled continuous 12 weeks for fat and lean mass, with less hunger and no difference in eating-disorder behaviours',
          referenceIds: ['peos2021'],
        },
        {
          label: 'CALERIE (n = 218, BMI 25.1, 25 % restriction, 2 years, −7.5 kg)',
          value: 'Lumbar −0.013, hip −0.017 and femoral neck −0.015 g/cm² against control',
          referenceIds: ['villareal2016'],
        },
        {
          label: 'Meta-analysis of bone',
          value:
            'Hip bone density −0.010 to −0.015 g/cm² at 6–24 months; bone-resorption markers up at 2–3 months',
          referenceIds: ['zibellini2015'],
        },
        {
          label: 'NICE cap on low-energy and very-low-energy diets',
          value: '12 weeks',
          referenceIds: ['nice2025'],
        },
      ],
      grade: 'C',
      gradeReason:
        'Two small trials support breaks and the bone data are strong, but the specific limits are proposals.',
      status: 'proposed-fit',
      referenceIds: ['nice2025', 'byrne2018', 'peos2021', 'villareal2016', 'zibellini2015'],
      relatedMetricIds: [],
    },
    {
      id: '17-surplus-limits',
      title: 'Limits on eating above maintenance',
      category: 'body',
      summary:
        'Vitals limits a planned surplus to 120 % of maintenance and weight gain to 0.5 % of body weight a week (0.25 % when waist-to-height is 0.5–0.59). It plans no weight gain at all if the waist is over 102 cm (men) or 88 cm (women), waist-to-height is 0.6 or more, or BMI is 30 or more. Beyond about a 20 % surplus the extra is mostly fat, not muscle.',
      howModelled:
        'The Planner clips or rejects plans over the surplus and gain-rate limits. The Simulator shows a caution for gain over 0.5 % a week, an information message for a surplus over 20 % for more than 12 weeks, and a caution for a waist over the cut-points with a planned gain.',
      keyNumbers: [
        {
          label: 'Off-season guidance',
          value:
            'About a 10–20 % surplus and gain of 0.25–0.5 % of body weight a week; protein 1.6–2.2 g/kg; fat 20–35 % of energy',
          referenceIds: ['iraki2019'],
        },
        {
          label: 'Waist cut-points',
          value: 'Over 102 cm (men) or 88 cm (women)',
          referenceIds: ['jensen2014'],
        },
        {
          label: 'Waist-to-height bands',
          value: '0.4–0.49 healthy; 0.5–0.59 increased risk; 0.6 or more high risk',
          referenceIds: ['nice2025'],
        },
      ],
      grade: 'C',
      gradeReason: 'The limits combine practitioner guidance with guideline risk bands; no trial tests them.',
      status: 'proposed-fit',
      referenceIds: ['iraki2019', 'jensen2014', 'nice2025'],
      relatedMetricIds: [],
    },
    {
      id: '17-hair-bone-menstrual-immune-flags',
      title: 'Slower harms shown as flags: hair, bone, periods, illness',
      category: 'recovery',
      summary:
        'Some harms of long or fast dieting develop slowly and cannot be predicted for an individual. Vitals shows them as flags, not projections: temporary hair shedding a few months after fast weight loss, a small loss of bone density with long calorie restriction, lighter or missing periods when energy is too low for the activity, and more illness and lost training days in athletes with low energy availability.',
      howModelled:
        'Each flag has a trigger rule, and the message tells the user what the model cannot assess. The flags are information only. They do not change the projection.',
      keyNumbers: [
        {
          label: 'Hair shedding (telogen effluvium)',
          value:
            'In a 140-patient clinic series, at a mean loss of 15 % and about 3.5 kg a month; women and older adults more vulnerable',
          note: 'It usually grows back. Shown at 0.75 % a week or more for 8 weeks or more.',
          referenceIds: ['kang2024', 'guo2017'],
        },
        {
          label: 'Bone density with prolonged restriction',
          value: 'Hip −0.01 to −0.015 g/cm² in trials; exercise limits the loss',
          note: 'Shown for a deficit of 15 % or more beyond 26 weeks or low energy availability beyond 12 weeks.',
          referenceIds: ['zibellini2015', 'villareal2016', 'villareal2011'],
        },
        {
          label: 'Menstrual disturbance',
          value:
            'An early sign that intake is too low for the activity; flagged when energy availability is under 45 for 4 weeks or body fat under 20 % in women',
          referenceIds: ['loucks2003', 'hulmi2016', 'mountjoy2023'],
        },
        {
          label: 'Illness',
          value:
            'Low energy availability has been linked with more illness and lost training days in athletes; flagged below 30 for over 14 days',
          referenceIds: ['mountjoy2023'],
        },
      ],
      grade: 'C',
      gradeReason:
        'The associations are documented in clinic series, trials and consensus statements, but individual risk cannot be predicted.',
      status: 'established',
      caveats:
        'The incidence curves at moderate rates were not available, which is why these harms are flags only.',
      referenceIds: [
        'kang2024',
        'guo2017',
        'zibellini2015',
        'villareal2016',
        'villareal2011',
        'loucks2003',
        'hulmi2016',
        'mountjoy2023',
      ],
      relatedMetricIds: [],
    },
    {
      id: '17-exercise-progression-limits',
      title: 'How fast training may ramp up, and who needs clearance',
      category: 'performance',
      summary:
        "For running, Vitals caps novices' weekly distance increase at 30 %. For strength training it starts beginners at 2–3 days a week with 8–12 repetition-maximum loads. Sedentary starters begin at up to 150 minutes a week of moderate exercise and increase by no more than 30 % a week. Anyone whose screening flags a risk gets light-to-moderate exercise only. The evidence is limited.",
      howModelled:
        'The Planner clips weekly increases to these caps. The Simulator shows a caution for a novice running increase above 30 %, information for large jumps in strength-training sets or no rest day for 14 days, and a caution for hot conditions.',
      keyNumbers: [
        {
          label: 'Weekly running distance, novices',
          value:
            'Increase of ≤ 30 % a week; above that, injury hazard ratio 1.59 (0.96–2.66) for distance-related injuries',
          referenceIds: ['nielsen2014'],
        },
        {
          label: 'The "10 % rule"',
          value: 'A graded programme did not reduce running injuries in an RCT (n = 532)',
          referenceIds: ['buist2008', 'damsted2018'],
        },
        {
          label: 'Novice resistance training',
          value:
            '2–3 days a week; 8–12 repetition maximum; load steps of 2–10 %; ≤ 10 hard sets per muscle a week at the start and ≤ +2 sets a week (proposed)',
          referenceIds: ['acsm2009'],
        },
        {
          label: 'Volume ramp from sedentary',
          value:
            'Start at ≤ 150 min/week of moderate-equivalent exercise; increase ≤ 30 % a week; at least 1 full rest day a week (proposed)',
          referenceIds: ['who2026'],
        },
        {
          label: 'Clearance',
          value:
            'Any positive screening answer means light–moderate exercise only; vigorous exercise needs a clinician-cleared attestation',
          referenceIds: ['parq2025', 'riebe2015', 'bredin2013'],
        },
        {
          label: 'Heat',
          value: 'In a hot-climate flag, no vigorous outdoor sessions; drink to thirst',
          referenceIds: ['armstrong2007', 'hewbutler2017'],
        },
      ],
      grade: 'C',
      gradeReason:
        'The running data are one cohort and one trial; the rest are position stands and proposals.',
      status: 'proposed-fit',
      referenceIds: [
        'nielsen2014',
        'buist2008',
        'damsted2018',
        'acsm2009',
        'who2026',
        'parq2025',
        'riebe2015',
        'bredin2013',
        'armstrong2007',
        'hewbutler2017',
      ],
      relatedMetricIds: [],
    },
    {
      id: '17-substance-limits',
      title: 'Caffeine, creatine and alcohol limits',
      category: 'performance',
      summary:
        "Vitals caps caffeine at 400 mg a day and 200 mg per dose, caps creatine at 5 g a day for maintenance, and never prescribes alcohol. The caffeine figures are the European and US regulators' safe limits for most adults. Creatine at 3–5 g a day is safe in healthy people for years. There is no level of alcohol that WHO calls safe.",
      howModelled:
        'The Planner clips caffeine and creatine to their limits and disables alcohol as an input. The Simulator warns above 400 mg of caffeine a day or 200 mg at once, on 100 mg or more within 6 hours of bedtime, and on more than 14 units of alcohol a week or more than 2 drinks at one time. Alcohol on a fasting day of tier T2 or above, on a very-low-energy day or within 24 hours of a T3 fast raises a danger message.',
      keyNumbers: [
        {
          label: 'Caffeine',
          value:
            '≤ 400 mg/d and ≤ 200 mg per dose (about 3 mg/kg); ≤ 200 mg/d in pregnancy and lactation; 100 mg near bedtime may disturb sleep',
          referenceIds: ['efsa2015', 'fda2026'],
        },
        {
          label: 'Creatine',
          value:
            'Maintenance 3–5 g/d; loading 0.3 g/kg/d for 5–7 days; up to 30 g/d for 5 years safe in healthy people',
          referenceIds: ['kreider2017'],
        },
        {
          label: 'Alcohol, UK guidance',
          value: 'No more than 14 units a week',
          referenceIds: ['nhs2026'],
        },
        {
          label: 'Alcohol, Canada 2023',
          value: 'Lowest risk at 2 drinks a week or fewer and no more than 2 on one occasion',
          referenceIds: ['ccsa2023'],
        },
        {
          label: 'Alcohol, WHO',
          value: 'No level of alcohol consumption is safe for health',
          referenceIds: ['whoeurope2023'],
        },
        {
          label: 'Alcohol and other rules',
          value: 'A precipitant of ketoacidosis with SGLT2 inhibitors and a refeeding-risk factor',
          referenceIds: ['goldenberg2016', 'nice2006'],
        },
      ],
      grade: 'B',
      gradeReason:
        'The limits come from regulators, position statements and guidance, though the underlying trials vary in size.',
      status: 'established',
      referenceIds: [
        'efsa2015',
        'fda2026',
        'kreider2017',
        'nhs2026',
        'ccsa2023',
        'whoeurope2023',
        'goldenberg2016',
        'nice2006',
      ],
      relatedMetricIds: [],
    },
    {
      id: '17-age-limits',
      title: 'Age limits: under 18 and 65 and over',
      category: 'body',
      summary:
        'Vitals is blocked for people under 18, because dieting in adolescence is the strongest known predictor of new eating disorders. For people aged 65–74 the Planner uses gentler limits: a deficit of 15 % at most, weight loss of 0.5 % of body weight a week at most, more protein, and fasts no longer than 24 hours. From 75, or with a low muscle-function score, it plans no deficit.',
      howModelled:
        'Age is a profile gate. Under 18 turns the app off. At 65–74 the Planner restricts its search space and shows a caution for faster loss or longer fasts. From 75, or with a SARC-F score of 4 or more, it offers only maintenance, protein and resistance training.',
      keyNumbers: [
        {
          label: 'Dieting in adolescents',
          value:
            'Severe dieters ×18 and moderate dieters ×5 in risk of a new eating disorder (14–15-year-old girls)',
          referenceIds: ['patton1999', 'neumarksztainer2011'],
        },
        {
          label: 'Professional guidance for under-18s',
          value:
            'The AAP advises focusing on a healthy lifestyle, not weight; the IOC advises body-composition work under 18 only for medical purposes',
          referenceIds: ['golden2016', 'mountjoy2023'],
        },
        {
          label: 'Ages 65–74',
          value:
            'Deficit ≤ 15 %; rate ≤ 0.5 % of body weight a week; protein ≥ 1.2 g/kg of reference weight; fasting up to T1; resistance training encouraged',
          referenceIds: ['bauer2013'],
        },
        {
          label: 'Diet-only loss of 10 % in older adults',
          value: 'Cost −5 % lean mass and −3 % hip bone density (−3 % and −1 % with exercise)',
          referenceIds: ['villareal2011'],
        },
        {
          label: 'Age 75 or over, or SARC-F ≥ 4',
          value: 'No deficit; maintenance, protein and resistance training only',
          note: 'A SARC-F score of 4 or more predicts sarcopenia-related disability, hospitalisation and mortality.',
          referenceIds: ['malmstrom2016', 'bauer2013'],
        },
        {
          label: 'Supervised water-only fasting',
          value: 'Both serious adverse events were in men aged 70 and 73',
          referenceIds: ['finnell2018'],
        },
      ],
      grade: 'B',
      gradeReason:
        'Cohort studies and a trial support the age-related risks, though the specific limits are proposals.',
      status: 'established',
      referenceIds: [
        'patton1999',
        'neumarksztainer2011',
        'golden2016',
        'mountjoy2023',
        'bauer2013',
        'villareal2011',
        'malmstrom2016',
        'finnell2018',
      ],
      relatedMetricIds: [],
    },
    {
      id: '17-pregnancy-and-breastfeeding',
      title: 'Pregnancy and breastfeeding',
      category: 'recovery',
      summary:
        'The Planner is blocked for pregnancy and breastfeeding, and the Simulator shows a danger message. Restrictive low-energy diets are not recommended in pregnancy or lactation, the safety of fasting and ketogenic patterns has not been studied there, and weight-gain targets in pregnancy are a clinical matter. People trying to conceive get no deficit and no fasting beyond 24 hours.',
      howModelled:
        'The pregnancy and breastfeeding answer is a profile gate. Pregnant or breastfeeding stops the Planner. Trying to conceive puts the person in the restricted mode with no deficit and no fasting above T1, because reproductive hormones are disrupted below 30 kcal per kg of lean mass.',
      keyNumbers: [
        {
          label: 'Pregnancy weight-gain targets (IOM 2009, normal BMI)',
          value: '11.5–16 kg',
          referenceIds: ['iom2009'],
        },
        {
          label: 'Lactation ketoacidosis',
          value: 'Case with pH 7.20 after 10 days of low-carbohydrate high-fat eating',
          referenceIds: ['vongeijer2015'],
        },
        {
          label: 'Supervised trial in breastfeeding women',
          value:
            'Loss of 0.5 kg/week in 40 overweight, exclusively breastfeeding women (weeks 4–14 postpartum) did not change infant growth',
          note: 'Still outside the remit of an unsupervised app.',
          referenceIds: ['lovelady2000'],
        },
        {
          label: 'Trying to conceive',
          value: 'Reproductive-hormone pulsing is disrupted below 30 kcal/kg lean mass',
          referenceIds: ['loucks2003'],
        },
      ],
      grade: 'C',
      gradeReason:
        'The exclusion rests on clinical guidance and case reports, not on trials of restriction in pregnancy.',
      status: 'established',
      referenceIds: ['iom2009', 'vongeijer2015', 'lovelady2000', 'loucks2003'],
      relatedMetricIds: [],
    },
    {
      id: '17-diabetes-medicine-gate',
      title: 'Diabetes medicines: why the Planner is switched off',
      category: 'fuel',
      summary:
        'People with type 1 diabetes, or taking insulin, sulfonylureas, meglitinides or SGLT2 inhibitors, are blocked from the Planner. The reasons are low blood sugar with any restriction, and a form of ketoacidosis that can occur even with normal glucose, set off by low-carbohydrate diets, fasting, heavy exercise, dehydration and alcohol. Other diabetes treatments get a restricted mode.',
      howModelled:
        'The medication answer is a profile gate. For blocked groups the Planner is off and the Simulator shows a danger message. For metformin-only, GLP-1-type agents and diet-only diabetes, the restricted mode applies and the floors still bind.',
      keyNumbers: [
        {
          label: 'Insulin, sulfonylureas and meglitinides',
          value: 'Risk of hypoglycaemia with any restriction, fasting or exercise change',
          referenceIds: ['evert2019', 'goldenberg2016'],
        },
        {
          label: 'SGLT2 inhibitors',
          value:
            'Euglycaemic ketoacidosis precipitated by low-carbohydrate diets, fasting, extensive exercise, dehydration and excess alcohol; one case after 1 week of a ketogenic diet on an SGLT2 inhibitor',
          note: 'Glucose can be below 14 mmol/L.',
          referenceIds: ['goldenberg2016', 'dynka2026'],
        },
        {
          label: 'Professional guidance',
          value: 'A very-low-carbohydrate diet needs a practitioner to cut insulin or glucose-lowering drugs',
          referenceIds: ['evert2019'],
        },
        {
          label: 'Metformin, GLP-1-type agents and other treatments',
          value:
            'Diuresis or hypoglycaemia with very-low-carbohydrate eating; appetite suppression can push intake below the floors',
          referenceIds: ['evert2019', 'dynka2026'],
        },
      ],
      grade: 'B',
      gradeReason: 'Case reports, reviews and professional guidance agree on the hazard.',
      status: 'established',
      referenceIds: ['evert2019', 'goldenberg2016', 'dynka2026'],
      relatedMetricIds: [],
    },
    {
      id: '17-other-medication-interactions',
      title: 'Other medicines that change how restriction and fasting behave',
      category: 'recovery',
      summary:
        "Several common medicines interact with fasting, dehydration and salt shifts: water tablets, blood-pressure drugs, lithium, some seizure drugs, steroids and drugs that lengthen the heart's QT interval. Vitals puts users of these in the restricted mode, with no fasting beyond 24 hours. The evidence is mostly mechanistic, and warfarin and thyroid medicines were not researched.",
      howModelled:
        'A medication class picker sets the restricted mode and the rules below. Restrictions are the same for the whole class. Chemotherapy, chronic antacids and insulin are also refeeding-risk factors, so fasts of 72 hours or more are blocked.',
      keyNumbers: [
        {
          label: 'Diuretics, ACE inhibitors, ARBs, spironolactone, beta-blockers, other blood-pressure drugs',
          value:
            'Dehydration, electrolyte disturbance, orthostatic hypotension and high potassium with potassium supplements; a ketogenic diet with blood-pressure drugs may significantly lower blood pressure',
          referenceIds: ['dynka2026', 'marinescu2024', 'nice2006', 'nasem2019'],
        },
        {
          label: 'Lithium',
          value: 'Narrow therapeutic range (0.6–1.25 mEq/L); salt and fluid shifts alter levels',
          note: 'Ramadan dawn-to-dusk fasting with hydration did not change levels in 250 patients; that says nothing about multi-day fasts. The lithium reference could not be retrieved and is unverified.',
          referenceIds: ['abouzed2025', 'timmer1999'],
        },
        {
          label: 'Seizure drugs (topiramate, zonisamide)',
          value: 'Metabolic acidosis; stone risk with ketogenic diets',
          referenceIds: ['kossoff2018', 'dynka2026'],
        },
        {
          label: 'Corticosteroids',
          value: 'Hyperglycaemia and bone loss',
          referenceIds: ['dynka2026'],
        },
        {
          label: 'Drugs that prolong the QT interval',
          value:
            'Starvation prolongs QT; deaths from ventricular arrhythmia on prolonged very-low-energy diets',
          note: 'Mechanistic, grade D.',
          referenceIds: ['kerndt1982', 'sours1981', 'isner1979'],
        },
        {
          label: 'Chemotherapy, chronic antacids, insulin',
          value: 'Refeeding-risk factors',
          referenceIds: ['nice2006'],
        },
        {
          label: 'Warfarin, anticoagulants and thyroid hormone',
          value:
            'Dose adjustment during fasting or weight loss; a supervised programme continued thyroid medication at a reduced dose',
          note: 'Unverified: not researched beyond that programme.',
          referenceIds: ['finnell2018'],
        },
      ],
      grade: 'D',
      gradeReason:
        'The interactions are mechanistic and drawn from reviews and case reports rather than trials.',
      status: 'proposed-fit',
      caveats: 'The lithium citation could not be retrieved, so its specific content is unverified.',
      referenceIds: [
        'dynka2026',
        'marinescu2024',
        'nice2006',
        'nasem2019',
        'abouzed2025',
        'timmer1999',
        'kossoff2018',
        'kerndt1982',
        'sours1981',
        'isner1979',
        'finnell2018',
      ],
      relatedMetricIds: [],
    },
    {
      id: '17-medical-condition-limits',
      title: 'Medical conditions that restrict fasting, low-carbohydrate eating or fast loss',
      category: 'recovery',
      summary:
        'Kidney, heart, liver, gout, stone, gallbladder and pancreas conditions each change which regimens Vitals will plan. Kidney disease caps protein and bans potassium supplements. Heart conditions and blood-pressure drugs rule out fasting beyond 24 hours and cap the deficit at 15 %. Gout rules out fasts of 24 hours or more, because uric acid rises. Rare fat-metabolism disorders rule out ketogenic eating.',
      howModelled:
        'Conditions from the onboarding questions put the person in the restricted mode, and the Simulator shows a caution or danger message for the matching rule. Simulated regimens are not blocked, but the rule that applies is shown.',
      keyNumbers: [
        {
          label: 'Kidney disease (any diagnosis or eGFR under 60)',
          value:
            'Protein ≤ 1.3 g/kg reference weight; no potassium supplements; no fasting beyond T1; no ketogenic eating',
          referenceIds: ['kdigo2024', 'dynka2026'],
        },
        {
          label:
            'Heart disease, arrhythmia, heart failure, stroke, blood pressure ≥ 160/90 or on blood-pressure drugs',
          value: 'No fasting beyond T1; deficit ≤ 15 %; no vigorous exercise without clearance',
          note: 'A 75-year-old man with coronary disease had an NSTEMI on fasting day 9; starvation prolongs QT; arrhythmia adverse events 0.21 %.',
          referenceIds: ['wilhelmi2019', 'kerndt1982', 'isner1979', 'riebe2015'],
        },
        {
          label: 'Gout',
          value: 'No fasting of T2 or longer; no ketogenic eating; loss ≤ 0.5 % a week',
          note: 'Fasting uric acid rises by about 46 %; acute gout has been reported.',
          referenceIds: ['wilhelmi2019', 'kerndt1982'],
        },
        {
          label: 'Kidney stones',
          value: 'No fasting of T3 or longer; ketogenic eating needs 2.5 L of fluid or more (proposed)',
          note: 'Urate stones with fasting; ketogenic-diet stones 2.5–4 % (children).',
          referenceIds: ['kerndt1982', 'dynka2026', 'kossoff2018'],
        },
        {
          label: 'Gallstones, gallbladder disease, cholecystectomy',
          value: 'Loss ≤ 0.5 % a week; fat ≥ 30 g a day; no very-low-energy diets',
          referenceIds: ['weinsier1995', 'weinsier1993', 'dynka2026'],
        },
        {
          label:
            'Acute pancreatitis; fat-oxidation or carnitine disorders; pyruvate carboxylase deficiency; porphyria',
          value: 'No ketogenic eating; the last three also no fasting of T2 or longer',
          note: 'A fat load worsens pancreatitis; the others risk a catabolic crisis with fasting or ketogenic eating.',
          referenceIds: ['dynka2026', 'kossoff2018'],
        },
        {
          label: 'Liver disease',
          value:
            'Restricted mode; no ketogenic eating (acute failure contraindicated; advanced disease relative)',
          referenceIds: ['dynka2026', 'wilhelmi2019'],
        },
        {
          label: 'Heavy alcohol use; acute illness, vomiting, diarrhoea or surgery in the last 4 weeks',
          value:
            'No fasting beyond T1 (temporary in the acute-illness case); a refeeding-risk factor; a dehydration serious adverse event occurred on day 3',
          referenceIds: ['nice2006', 'finnell2018'],
        },
      ],
      grade: 'C',
      gradeReason:
        'The hazards come from reviews, guidelines and case reports, and the specific limits are proposals.',
      status: 'established',
      referenceIds: [
        'kdigo2024',
        'dynka2026',
        'wilhelmi2019',
        'kerndt1982',
        'isner1979',
        'riebe2015',
        'kossoff2018',
        'weinsier1995',
        'weinsier1993',
        'nice2006',
        'finnell2018',
      ],
      relatedMetricIds: [],
    },
    {
      id: '17-eating-disorder-safeguards',
      title: 'Eating-disorder risk and how the app is designed around it',
      category: 'recovery',
      summary:
        'Calorie-tracking apps are used by many people with eating disorders, and use is associated with more restraint and eating concern. Vitals therefore applies safeguards to everyone (no underweight targets, no calorie-compensation arithmetic, no punishing notifications) and gentler defaults for people flagged by a short screening check. The screening check is a safety filter, not a diagnosis, and it misses about one in seven true cases.',
      howModelled:
        'A history question and a five-item check adapted from a published screening tool set a restricted mode. In that mode the Planner offers only maintenance or surplus energy, no fasting beyond 12 hours, no carbohydrate under 100 g, and no numeric weight-loss goal. Only the mode flag is stored, never the answers. Universal safeguards apply to all users because many people do not disclose.',
      keyNumbers: [
        {
          label: 'Calorie-tracker use and eating-disorder symptoms',
          value:
            'In 493 college students, tracker users had higher eating concern and dietary restraint after controlling for BMI',
          note: 'Associations, not causation.',
          referenceIds: ['simpson2017'],
        },
        {
          label: 'People with eating disorders (n = 105)',
          value:
            'About 75 % had used a calorie-tracking app and 73 % of users felt it contributed to their disorder',
          referenceIds: ['levinson2017'],
        },
        {
          label: 'Men (n = 122)',
          value:
            '56 % had used it; about 40 % felt it contributed; users scored higher on eating-disorder symptoms with large effect sizes',
          referenceIds: ['linardon2019'],
        },
        {
          label: 'App design study',
          value:
            'Guilt from persuasive design; appearance goals in about two thirds of top apps; about one fifth allowed underweight goals; one user held 1,200 kcal/day for 7 months with no prompt to re-evaluate',
          referenceIds: ['honary2019'],
        },
        {
          label: 'Screening tool (original validation)',
          value: 'Sensitivity 100 %, specificity 87.5 % with 2 or more yes answers',
          referenceIds: ['morgan1999'],
        },
        {
          label: 'Screening tool (meta-analysis, 25 studies)',
          value:
            'Pooled sensitivity 0.86 (0.78–0.91); specificity 0.83 (0.77–0.88); lower in men and in binge-eating disorder',
          note: 'The authors say there is not enough evidence to use it to screen the full range of eating disorders in community settings. Adapting one item means the validation figures do not transfer.',
          referenceIds: ['kutz2020'],
        },
        {
          label: 'A longer questionnaire (EDE-Q)',
          value: 'Sensitivity 0.80 and specificity 0.80 at a global score of 2.8 or more',
          referenceIds: ['mond2008'],
        },
        {
          label: 'Guideline stance',
          value:
            'People can have an eating disorder at any weight; use non-stigmatising language; offer assessment or counselling before restrictive diets if an eating disorder is possible',
          referenceIds: ['nice2025'],
        },
      ],
      grade: 'C',
      gradeReason:
        'The evidence is observational and design-oriented; there is no evidence that well-designed apps reduce eating-disorder risk (grade D).',
      status: 'established',
      caveats:
        "The design rules are risk-minimisation, not proven prevention. The adapted screening items and the '6 kg' item wording are unvalidated.",
      referenceIds: [
        'simpson2017',
        'levinson2017',
        'linardon2019',
        'honary2019',
        'morgan1999',
        'kutz2020',
        'mond2008',
        'nice2025',
      ],
      relatedMetricIds: [],
    },
  ],
  myths: [
    {
      id: '17-myth-1200-kcal-safe-minimum',
      claim: '1,200 kcal a day is the physiological safe minimum.',
      verdict: 'oversimplified',
      explanation:
        'It is a prescription convention: the lower bound of the typical guideline ranges, not a measured threshold. NICE places even 800–1,200 kcal inside specialist services. A fixed number also ignores body size, which is why Vitals pairs it with a deficit cap and an energy-availability limit.',
      referenceIds: ['jensen2014', 'nice2025'],
    },
    {
      id: '17-myth-liquid-protein-deaths',
      claim: 'The 1970s liquid-protein diet deaths were just caused by poor-quality (collagen) protein.',
      verdict: 'not-supported',
      explanation:
        'There were 17 sudden deaths, mostly from ventricular arrhythmia, after prolonged (median 5 months) regimens of about 300–400 kcal a day. The deaths were independent of supervision, potassium dose and protein quality. The common factors were marked obesity, prolonged extreme restriction and rapid loss, and the ECG and pathology resembled starvation.',
      referenceIds: ['sours1981', 'isner1979', 'lantigua1980'],
    },
    {
      id: '17-myth-30-kcal-cliff',
      claim: '30 kcal per kg of lean mass a day is a universal cliff for health.',
      verdict: 'oversimplified',
      explanation:
        'It comes from 5-day laboratory studies in 29 sedentary women. The 2023 consensus calls a universal threshold debated, and men appear to tolerate lower values (about 9–25). Vitals uses 30 as a conservative bound.',
      referenceIds: ['loucks2003', 'mountjoy2023'],
    },
    {
      id: '17-myth-fast-loss-rebounds',
      claim: 'Fast weight loss always rebounds more.',
      verdict: 'not-supported',
      explanation:
        'In a randomised trial (BMI 30–45), 12 weeks of rapid loss and 36 weeks of gradual loss gave 70.5 % vs 71.2 % regain at 144 weeks. The reasons to cap the rate are gallstones, lean-mass loss and hormones.',
      referenceIds: ['purcell2014'],
    },
    {
      id: '17-myth-fasting-safe-or-dangerous',
      claim: 'Fasting is inherently dangerous, or inherently safe.',
      verdict: 'oversimplified',
      explanation:
        'In supervised water-only stays most events were mild, but grade ≥ 3 adverse events reached 20 % by day 5 and both serious events were in men aged 70 and 73. Historical deaths occurred in unscreened, poorly refed programmes. Neither slogan is supported.',
      referenceIds: ['finnell2018', 'kerndt1982'],
    },
    {
      id: '17-myth-keto-flu-electrolytes',
      claim: 'Keto flu is solved by electrolytes.',
      verdict: 'unproven',
      explanation:
        'The physiological rationale is strong, because sodium loss peaks on days 1–4. But no clinical study documents the effect of supplementation.',
      referenceIds: ['skartun2025'],
    },
    {
      id: '17-myth-high-protein-kidneys',
      claim: 'High protein harms healthy kidneys.',
      verdict: 'not-supported',
      explanation:
        'In 28 randomised trials of 1,358 healthy adults there was no adverse effect on kidney filtration at 1.5 g/kg or more. Kidney disease is different: guidelines advise about 0.8 g/kg and avoiding more than 1.3 g/kg.',
      referenceIds: ['devries2018', 'kdigo2024'],
    },
    {
      id: '17-myth-screening-diagnoses',
      claim: 'A short questionnaire like SCOFF can diagnose an eating disorder.',
      verdict: 'not-supported',
      explanation:
        'It is a screening flag with pooled sensitivity 0.86 and specificity 0.83. It has not been validated for the full range of eating disorders in community settings, and about one in seven true cases screen negative.',
      referenceIds: ['kutz2020'],
    },
    {
      id: '17-myth-ten-percent-rule',
      claim: 'The 10 % rule (raise weekly running distance by 10 % at most) prevents running injuries.',
      verdict: 'not-supported',
      explanation:
        'A randomised trial of 532 people found no reduction in injuries. In an exploratory cohort a progression above 30 % had a hazard ratio of 1.59 (0.96–2.66), and the evidence base is very limited.',
      referenceIds: ['buist2008', 'nielsen2014', 'damsted2018'],
    },
    {
      id: '17-myth-ramadan-multiday-safe',
      claim: 'Ramadan-type fasting data show multi-day fasts are safe.',
      verdict: 'not-supported',
      explanation:
        'Dawn-to-dusk fasting with nightly eating says nothing about zero-energy fasts longer than 24 hours. For example, lithium levels were stable in 250 patients who kept hydrated.',
      referenceIds: ['abouzed2025'],
    },
    {
      id: '17-myth-serious-events-20-percent',
      claim: 'About 20 % of people fasting under supervision have a serious adverse event by day 5.',
      verdict: 'not-supported',
      explanation:
        'The figure is the cumulative incidence of adverse events of grade 3 or higher (20 % by day 5, 28 % by day 10, 32 % by day 15), pooled over all stay lengths. Serious adverse events were 2 of 768 visits (0.26 %; the paper prints 0.002 %): dehydration on day 3 and hyponatraemia on day 9, in men aged 73 and 70.',
      referenceIds: ['finnell2018'],
    },
  ],
  openQuestions: [
    'The energy floors of 1,200 and 1,500 kcal are conventions, not physiological thresholds. No randomised trial tests them for unsupervised users, and the way limits scale for small and large bodies is a design choice.',
    'The body-fat floors (10 % and 18 %) and BMI limits (20 and 19) rest on case series and a statement that no accepted optimum exists. They need review by a clinician and sports-dietitian panel, and an ethnicity and age review.',
    'The energy-availability bound of 30 kcal per kg of lean mass comes from 5-day laboratory studies in sedentary women. Men and free-living use are uncertain, and it is hard to estimate with slider-derived lean mass.',
    'For fasts of 48 hours or more there are no data on unsupervised fasting. Supervised cohorts are screened and adverse events are pooled across durations. The sodium dose replaces measured urinary loss, potassium and magnesium doses are expert opinion, and electrolyte supplementation has no trial evidence. The length of the 36-hour fast days in the alternate-day trial is unverified.',
    'The unsupervised limits for very-low-energy and protein-sparing diets (such as 14-day blocks) are judgement. The 12-week cap in guidelines is for supervised programmes.',
    'The adapted screening items are unvalidated, and there is no evidence that app-based gating reduces harm. Men, binge-eating disorder, avoidant/restrictive food intake disorder and athletes are under-detected. An evaluation should be planned.',
    'Gallstones, hair, menstrual, bone and immune effects are flags only, because incidence curves at moderate rates were not available.',
    'For refeeding in healthy short fasters there are no incidence data at BMI 25 or more for fasts up to 7 days. The ramps rest on clinical guidance and programmes that refeed for half the fast length, and ASPEN energy-advancement details were not accessible (unverified).',
    'Not covered: adolescents (blocked by design), menopause and perimenopause, aesthetic-sport athletes, medication interactions beyond the medication gate (warfarin and thyroid are unverified), ethnicity-specific body-fat cut-offs and pregnancy-planning guidance.',
    'Several sources were not accessible during the research (NCBI Bookshelf, some journals and ASPEN full texts), so the policies of commercial apps could not be checked and some guideline documents were read only through reprints or abstracts.',
  ],
  references: [
    {
      id: 'mountjoy2023',
      authors: 'Mountjoy M, Ackerman KE, Bailey DM, et al.',
      year: 2023,
      title:
        "2023 International Olympic Committee's (IOC) consensus statement on Relative Energy Deficiency in Sport (REDs)",
      journal: 'Br J Sports Med',
      pmid: '37752011',
      doi: '10.1136/bjsports-2023-106994',
      url: 'https://pubmed.ncbi.nlm.nih.gov/37752011/',
    },
    {
      id: 'loucks2003',
      authors: 'Loucks AB, Thuma JR.',
      year: 2003,
      title:
        'Luteinizing hormone pulsatility is disrupted at a threshold of energy availability in regularly menstruating women',
      journal: 'J Clin Endocrinol Metab',
      pmid: '12519869',
      doi: '10.1210/jc.2002-020369',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12519869/',
    },
    {
      id: 'ihle2004',
      authors: 'Ihle R, Loucks AB.',
      year: 2004,
      title:
        'Dose-response relationships between energy availability and bone turnover in young exercising women',
      journal: 'J Bone Miner Res',
      pmid: '15231009',
      doi: '10.1359/JBMR.040410',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15231009/',
    },
    {
      id: 'garthe2011',
      authors: 'Garthe I, Raastad T, Refsnes PE, Koivisto A, Sundgot-Borgen J.',
      year: 2011,
      title:
        'Effect of two different weight-loss rates on body composition and strength and power-related performance in elite athletes',
      journal: 'Int J Sport Nutr Exerc Metab',
      pmid: '21558571',
      doi: '10.1123/ijsnem.21.2.97',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21558571/',
    },
    {
      id: 'helms2014',
      authors: 'Helms ER, Aragon AA, Fitschen PJ.',
      year: 2014,
      title:
        'Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation',
      journal: 'J Int Soc Sports Nutr',
      pmid: '24864135',
      doi: '10.1186/1550-2783-11-20',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24864135/',
    },
    {
      id: 'jensen2014',
      authors: 'Jensen MD, Ryan DH, Apovian CM, et al.',
      year: 2014,
      title: '2013 AHA/ACC/TOS guideline for the management of overweight and obesity in adults',
      journal: 'Circulation',
      pmid: '24222017',
      doi: '10.1161/01.cir.0000437739.71477.ee',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24222017/',
    },
    {
      id: 'nice2025',
      authors: 'National Institute for Health and Care Excellence.',
      year: 2025,
      title: 'Overweight and obesity management (NG246)',
      journal: 'NICE guideline NG246',
      url: 'https://www.nice.org.uk/guidance/ng246',
    },
    {
      id: 'nice2006',
      authors: 'National Institute for Health and Care Excellence.',
      year: 2006,
      title:
        'Nutrition support for adults: oral nutrition support, enteral tube feeding and parenteral nutrition (CG32), 2006, updated 2017',
      journal: 'NICE guideline CG32',
      url: 'https://www.nice.org.uk/guidance/cg32/chapter/Recommendations',
    },
    {
      id: 'dasilva2020',
      authors: 'da Silva JSV, Seres DS, Sabino K, et al.',
      year: 2020,
      title: 'ASPEN consensus recommendations for refeeding syndrome',
      journal: 'Nutr Clin Pract',
      pmid: '32115791',
      doi: '10.1002/ncp.10474',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32115791/',
      verification: 'abstract',
    },
    {
      id: 'solar2026',
      authors: 'Solar H, Ortega ML, Blengini L, et al.',
      year: 2026,
      title: 'Refeeding syndrome: applicability of ASPEN criteria in patients with intestinal failure',
      journal: 'Intest Fail',
      pmid: '42453759',
      doi: '10.1016/j.intf.2025.100341',
      url: 'https://pubmed.ncbi.nlm.nih.gov/42453759/',
    },
    {
      id: 'wilhelmi2019',
      authors: 'Wilhelmi de Toledo F, et al.',
      year: 2019,
      title:
        'Safety, health improvement and well-being during a 4 to 21-day fasting period in an observational study including 1422 subjects',
      journal: 'PLoS One',
      pmid: '30601864',
      doi: '10.1371/journal.pone.0209353',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30601864/',
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
      url: 'https://pubmed.ncbi.nlm.nih.gov/29458369/',
    },
    {
      id: 'kerndt1982',
      authors: 'Kerndt PR, Naughton JL, Driscoll CE, Loxterkamp DA.',
      year: 1982,
      title: 'Fasting: the history, pathophysiology and complications',
      journal: 'West J Med',
      pmid: '6758355',
      url: 'https://pubmed.ncbi.nlm.nih.gov/6758355/',
    },
    {
      id: 'wilhelmi2013',
      authors: 'Wilhelmi de Toledo F, Buchinger A, Burggrabe H, et al.',
      year: 2013,
      title: 'Fasting therapy – an expert panel update of the 2002 consensus guidelines',
      journal: 'Forsch Komplementmed',
      pmid: '24434758',
      doi: '10.1159/000357602',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24434758/',
      verification: 'abstract',
    },
    {
      id: 'michalsen2013',
      authors: 'Michalsen A, Li C.',
      year: 2013,
      title: 'Fasting therapy for treating and preventing disease – current state of evidence',
      journal: 'Forsch Komplementmed',
      pmid: '24434759',
      doi: '10.1159/000357765',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24434759/',
      verification: 'abstract',
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
      verification: 'abstract',
    },
    {
      id: 'zhong2024',
      authors: 'Zhong F, et al.',
      year: 2024,
      title:
        'Adverse events profile associated with intermittent fasting in adults with overweight or obesity: a systematic review and meta-analysis of RCTs',
      journal: 'Nutr J',
      pmid: '38987755',
      doi: '10.1186/s12937-024-00975-9',
      url: 'https://pubmed.ncbi.nlm.nih.gov/38987755/',
    },
    {
      id: 'harvie2011',
      authors: 'Harvie MN, Pegington M, Mattson MP, et al.',
      year: 2011,
      title:
        'The effects of intermittent or continuous energy restriction on weight loss and metabolic disease risk markers: a randomized trial in young overweight women',
      journal: 'Int J Obes',
      pmid: '20921964',
      doi: '10.1038/ijo.2010.171',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20921964/',
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
      id: 'loy1986',
      authors: 'Loy SF, Conlee RK, Winder WW, et al.',
      year: 1986,
      title: 'Effects of 24-hour fast on cycling endurance time at two different intensities',
      journal: 'J Appl Physiol',
      pmid: '3745057',
      doi: '10.1152/jappl.1986.61.2.654',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3745057/',
    },
    {
      id: 'skartun2025',
      authors: 'Skartun O, et al.',
      year: 2025,
      title:
        'Symptoms during initiation of a ketogenic diet: a scoping review of occurrence rates, mechanisms and relief strategies',
      journal: 'Front Nutr',
      pmid: '40206956',
      doi: '10.3389/fnut.2025.1538266',
      url: 'https://pubmed.ncbi.nlm.nih.gov/40206956/',
    },
    {
      id: 'abouzed2025',
      authors: 'Abouzed M, et al.',
      year: 2025,
      title:
        'Short-term and long-term effects of Muslim fasting on lithium pharmacokinetics and renal function in bipolar disorder',
      journal: 'Int J Bipolar Disord',
      pmid: '40366534',
      doi: '10.1186/s40345-025-00378-7',
      url: 'https://pubmed.ncbi.nlm.nih.gov/40366534/',
    },
    {
      id: 'timmer1999',
      authors: 'Timmer RT, Sands JM.',
      year: 1999,
      title: 'Lithium intoxication',
      journal: 'J Am Soc Nephrol',
      pmid: '10073618',
      doi: '10.1681/ASN.V103666',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10073618/',
      verification: 'unverified',
    },
    {
      id: 'byrne2018',
      authors: 'Byrne NM, Sainsbury A, King NA, Hills AP, Wood RE.',
      year: 2018,
      title:
        'Intermittent energy restriction improves weight loss efficiency in obese men: the MATADOR study',
      journal: 'Int J Obes',
      pmid: '28925405',
      doi: '10.1038/ijo.2017.206',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28925405/',
    },
    {
      id: 'peos2021',
      authors: 'Peos JJ, Helms ER, Fournier PA, et al.',
      year: 2021,
      title:
        'Continuous versus intermittent dieting for fat loss and fat-free mass retention in resistance-trained adults: the ICECAP trial',
      journal: 'Med Sci Sports Exerc',
      pmid: '33587549',
      doi: '10.1249/MSS.0000000000002636',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33587549/',
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
      url: 'https://pubmed.ncbi.nlm.nih.gov/26332798/',
    },
    {
      id: 'zibellini2015',
      authors: 'Zibellini J, Seimon RV, Lee CM, et al.',
      year: 2015,
      title:
        'Does diet-induced weight loss lead to bone loss in overweight or obese adults? A systematic review and meta-analysis of clinical trials',
      journal: 'J Bone Miner Res',
      pmid: '26012544',
      doi: '10.1002/jbmr.2564',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26012544/',
    },
    {
      id: 'purcell2014',
      authors: 'Purcell K, Sumithran P, Prendergast LA, Bouniu CJ, Delbridge E, Proietto J.',
      year: 2014,
      title:
        'The effect of rate of weight loss on long-term weight management: a randomised controlled trial',
      journal: 'Lancet Diabetes Endocrinol',
      pmid: '25459211',
      doi: '10.1016/S2213-8587(14)70200-1',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25459211/',
    },
    {
      id: 'weinsier1995',
      authors: 'Weinsier RL, Wilson LJ, Lee J.',
      year: 1995,
      title:
        'Medically safe rate of weight loss for the treatment of obesity: a guideline based on risk of gallstone formation',
      journal: 'Am J Med',
      pmid: '7847427',
      doi: '10.1016/S0002-9343(99)80394-5',
      url: 'https://pubmed.ncbi.nlm.nih.gov/7847427/',
    },
    {
      id: 'weinsier1993',
      authors: 'Weinsier RL, Ullmann DO.',
      year: 1993,
      title: 'Gallstone formation and weight loss',
      journal: 'Obes Res',
      pmid: '16350561',
      doi: '10.1002/j.1550-8528.1993.tb00008.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16350561/',
    },
    {
      id: 'erlinger2000',
      authors: 'Erlinger S.',
      year: 2000,
      title: 'Gallstones in obesity and weight loss',
      journal: 'Eur J Gastroenterol Hepatol',
      pmid: '11192327',
      doi: '10.1097/00042737-200012120-00015',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11192327/',
    },
    {
      id: 'liddle1989',
      authors: 'Liddle RA, Goldstein RB, Saxton J.',
      year: 1989,
      title: 'Gallstone formation during weight-reduction dieting',
      journal: 'Arch Intern Med',
      pmid: '2669662',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2669662/',
    },
    {
      id: 'gebhard1996',
      authors: 'Gebhard RL, Prigge WF, Ansel HJ, et al.',
      year: 1996,
      title: 'The role of gallbladder emptying in gallstone formation during diet-induced rapid weight loss',
      journal: 'Hepatology',
      pmid: '8781321',
      doi: '10.1002/hep.510240313',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8781321/',
    },
    {
      id: 'stokes2014',
      authors: 'Stokes CS, Gluud LL, Casper M, Lammert F.',
      year: 2014,
      title:
        'Ursodeoxycholic acid and diets higher in fat prevent gallbladder stones during weight loss: a meta-analysis of randomized controlled trials',
      journal: 'Clin Gastroenterol Hepatol',
      pmid: '24321208',
      doi: '10.1016/j.cgh.2013.11.031',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24321208/',
    },
    {
      id: 'kang2024',
      authors: 'Kang DH, Kwon SH, Sim WY, Lew BL.',
      year: 2024,
      title: 'Telogen effluvium associated with weight loss: a single center retrospective study',
      journal: 'Ann Dermatol',
      pmid: '39623615',
      doi: '10.5021/ad.24.043',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39623615/',
    },
    {
      id: 'guo2017',
      authors: 'Guo EL, Katta R.',
      year: 2017,
      title: 'Diet and hair loss: effects of nutrient deficiency and supplement use',
      journal: 'Dermatol Pract Concept',
      pmid: '28243487',
      doi: '10.5826/dpc.0701a01',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28243487/',
    },
    {
      id: 'tsai2006',
      authors: 'Tsai AG, Wadden TA.',
      year: 2006,
      title: 'The evolution of very-low-calorie diets: an update and meta-analysis',
      journal: 'Obesity',
      pmid: '16988070',
      doi: '10.1038/oby.2006.146',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16988070/',
    },
    {
      id: 'sours1981',
      authors: 'Sours HE, Frattali VP, Brand CD, et al.',
      year: 1981,
      title: 'Sudden death associated with very low calorie weight reduction regimens',
      journal: 'Am J Clin Nutr',
      pmid: '7223697',
      doi: '10.1093/ajcn/34.4.453',
      url: 'https://pubmed.ncbi.nlm.nih.gov/7223697/',
    },
    {
      id: 'isner1979',
      authors: 'Isner JM, Sours HE, Paris AL, Ferrans VJ, Roberts WC.',
      year: 1979,
      title:
        'Sudden, unexpected death in avid dieters using the liquid-protein-modified-fast diet: observations in 17 patients and the role of the prolonged QT interval',
      journal: 'Circulation',
      pmid: '498466',
      doi: '10.1161/01.cir.60.6.1401',
      url: 'https://pubmed.ncbi.nlm.nih.gov/498466/',
      verification: 'abstract',
    },
    {
      id: 'lantigua1980',
      authors: 'Lantigua RA, Amatruda JM, Biddle TL, Forbes GB, Lockwood DH.',
      year: 1980,
      title: 'Cardiac arrhythmias associated with a liquid protein diet for the treatment of obesity',
      journal: 'N Engl J Med',
      pmid: '7402271',
      doi: '10.1056/NEJM198009253031305',
      url: 'https://pubmed.ncbi.nlm.nih.gov/7402271/',
      verification: 'abstract',
    },
    {
      id: 'formisano2023',
      authors: 'Formisano E, Schiavetti I, Gradaschi R, et al.',
      year: 2023,
      title:
        'The real-life use of a protein-sparing modified fast diet by nasogastric tube (ProMoFasT) in adults with obesity: an open-label randomized controlled trial',
      journal: 'Nutrients',
      pmid: '38004217',
      doi: '10.3390/nu15224822',
      url: 'https://pubmed.ncbi.nlm.nih.gov/38004217/',
    },
    {
      id: 'kossoff2018',
      authors: 'Kossoff EH, Zupec-Kania BA, Auvin S, et al.',
      year: 2018,
      title:
        'Optimal clinical management of children receiving dietary therapies for epilepsy: updated recommendations of the International Ketogenic Diet Study Group',
      journal: 'Epilepsia Open',
      pmid: '29881797',
      doi: '10.1002/epi4.12225',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29881797/',
    },
    {
      id: 'dynka2026',
      authors: 'Dyńka D, Rodzeń Ł, Rodzeń M, et al.',
      year: 2026,
      title: 'The ketogenic diet is not for everyone: contraindications, side effects, and drug interactions',
      journal: 'Ann Med',
      pmid: '41486865',
      doi: '10.1080/07853890.2025.2603016',
      url: 'https://pubmed.ncbi.nlm.nih.gov/41486865/',
    },
    {
      id: 'goldenberg2016',
      authors: 'Goldenberg RM, Berard LD, Cheng AYY, et al.',
      year: 2016,
      title:
        'SGLT2 inhibitor-associated diabetic ketoacidosis: clinical review and recommendations for prevention and diagnosis',
      journal: 'Clin Ther',
      pmid: '28003053',
      doi: '10.1016/j.clinthera.2016.11.002',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28003053/',
    },
    {
      id: 'vongeijer2015',
      authors: 'von Geijer L, Ekelund M.',
      year: 2015,
      title:
        'Ketoacidosis associated with low-carbohydrate diet in a non-diabetic lactating woman: a case report',
      journal: 'J Med Case Rep',
      pmid: '26428083',
      doi: '10.1186/s13256-015-0709-2',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26428083/',
    },
    {
      id: 'buren2021',
      authors: 'Burén J, Ericsson M, Damasceno NRT, Sjödin A.',
      year: 2021,
      title:
        'A ketogenic low-carbohydrate high-fat diet increases LDL cholesterol in healthy, young, normal-weight women: a randomized controlled feeding trial',
      journal: 'Nutrients',
      pmid: '33801247',
      doi: '10.3390/nu13030814',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33801247/',
    },
    {
      id: 'evert2019',
      authors: 'Evert AB, Dennison M, Gardner CD, et al.',
      year: 2019,
      title: 'Nutrition therapy for adults with diabetes or prediabetes: a consensus report',
      journal: 'Diabetes Care',
      pmid: '31000505',
      doi: '10.2337/dci19-0014',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31000505/',
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
      url: 'https://pubmed.ncbi.nlm.nih.gov/23867520/',
    },
    {
      id: 'villareal2011',
      authors: 'Villareal DT, Chode S, Parimi N, et al.',
      year: 2011,
      title: 'Weight loss, exercise, or both and physical function in obese older adults',
      journal: 'N Engl J Med',
      pmid: '21449785',
      doi: '10.1056/NEJMoa1008234',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21449785/',
    },
    {
      id: 'malmstrom2016',
      authors: 'Malmstrom TK, Miller DK, Simonsick EM, Ferrucci L, Morley JE.',
      year: 2016,
      title:
        'SARC-F: a symptom score to predict persons with sarcopenia at risk for poor functional outcomes',
      journal: 'J Cachexia Sarcopenia Muscle',
      pmid: '27066316',
      doi: '10.1002/jcsm.12048',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27066316/',
    },
    {
      id: 'kdigo2024',
      authors: 'KDIGO CKD Work Group.',
      year: 2024,
      title:
        'KDIGO 2024 clinical practice guideline for the evaluation and management of chronic kidney disease',
      journal: 'Kidney Int',
      pmid: '38490803',
      doi: '10.1016/j.kint.2023.10.018',
      url: 'https://pubmed.ncbi.nlm.nih.gov/38490803/',
    },
    {
      id: 'devries2018',
      authors: 'Devries MC, Sithamparapillai A, Brimble KS, Banfield L, Morton RW, Phillips SM.',
      year: 2018,
      title:
        'Changes in kidney function do not differ between healthy adults consuming higher- compared with lower- or normal-protein diets: a systematic review and meta-analysis',
      journal: 'J Nutr',
      pmid: '30383278',
      doi: '10.1093/jn/nxy197',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30383278/',
    },
    {
      id: 'wolfe2017',
      authors: 'Wolfe RR, Cifelli AM, Kostas G, Kim IY.',
      year: 2017,
      title:
        'Optimizing protein intake in adults: interpretation and application of the Recommended Dietary Allowance compared with the Acceptable Macronutrient Distribution Range',
      journal: 'Adv Nutr',
      pmid: '28298271',
      doi: '10.3945/an.116.013821',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28298271/',
    },
    {
      id: 'longland2016',
      authors: 'Longland TM, Oikawa SY, Mitchell CJ, Devries MC, Phillips SM.',
      year: 2016,
      title:
        'Higher compared with lower dietary protein during an energy deficit combined with intense exercise promotes greater lean mass gain and fat mass loss: a randomized trial',
      journal: 'Am J Clin Nutr',
      pmid: '26817506',
      doi: '10.3945/ajcn.115.119339',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26817506/',
    },
    {
      id: 'helms2014a',
      authors: 'Helms ER, Zinn C, Rowlands DS, Brown SR.',
      year: 2014,
      title:
        'A systematic review of dietary protein during caloric restriction in resistance trained lean athletes: a case for higher intakes',
      journal: 'Int J Sport Nutr Exerc Metab',
      pmid: '24092765',
      doi: '10.1123/ijsnem.2013-0054',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24092765/',
    },
    {
      id: 'hector2018',
      authors: 'Hector AJ, Phillips SM.',
      year: 2018,
      title:
        'Protein recommendations for weight loss in elite athletes: a focus on body composition and performance',
      journal: 'Int J Sport Nutr Exerc Metab',
      pmid: '29182451',
      doi: '10.1123/ijsnem.2017-0273',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29182451/',
      verification: 'abstract',
    },
    {
      id: 'jager2017',
      authors: 'Jäger R, Kerksick CM, Campbell BI, et al.',
      year: 2017,
      title: 'International Society of Sports Nutrition position stand: protein and exercise',
      journal: 'J Int Soc Sports Nutr',
      pmid: '28642676',
      doi: '10.1186/s12970-017-0177-8',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28642676/',
    },
    {
      id: 'bilsborough2006',
      authors: 'Bilsborough S, Mann N.',
      year: 2006,
      title: 'A review of issues of dietary protein intake in humans',
      journal: 'Int J Sport Nutr Exerc Metab',
      pmid: '16779921',
      doi: '10.1123/ijsnem.16.2.129',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16779921/',
    },
    {
      id: 'efsa2017',
      authors: 'European Food Safety Authority.',
      year: 2017,
      title:
        'Overview on Dietary Reference Values for the EU population as derived by the EFSA NDA Panel (summary tables, version 4, Sept 2017)',
      journal: 'EFSA',
      url: 'https://www.efsa.europa.eu/sites/default/files/assets/DRV_Summary_tables_jan_17.pdf',
    },
    {
      id: 'nasem2019',
      authors: 'National Academies of Sciences, Engineering, and Medicine.',
      year: 2019,
      title: 'Dietary Reference Intakes for Sodium and Potassium',
      journal: 'Washington DC: National Academies Press',
      doi: '10.17226/25353',
      url: 'https://nap.nationalacademies.org/read/25353/chapter/2',
    },
    {
      id: 'costello2023',
      authors: 'Costello R, Rosanoff A, Nielsen F, et al.',
      year: 2023,
      title:
        'Perspective: call for re-evaluation of the tolerable upper intake level for magnesium supplementation in adults',
      journal: 'Adv Nutr',
      pmid: '37487817',
      doi: '10.1016/j.advnut.2023.06.008',
      url: 'https://pubmed.ncbi.nlm.nih.gov/37487817/',
    },
    {
      id: 'wolff2025',
      authors: 'Wolff J, Cober MP, Huff KA.',
      year: 2025,
      title:
        'Essential fatty acid deficiency in parenteral nutrition: historical perspective and modern solutions, a narrative review',
      journal: 'Nutr Clin Pract',
      pmid: '39961748',
      doi: '10.1002/ncp.11278',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39961748/',
    },
    {
      id: 'whittaker2021',
      authors: 'Whittaker J, Wu K.',
      year: 2021,
      title:
        'Low-fat diets and testosterone in men: systematic review and meta-analysis of intervention studies',
      journal: 'J Steroid Biochem Mol Biol',
      pmid: '33741447',
      doi: '10.1016/j.jsbmb.2021.105878',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33741447/',
    },
    {
      id: 'iraki2019',
      authors: 'Iraki J, Fitschen P, Espinar S, Helms E.',
      year: 2019,
      title: 'Nutrition recommendations for bodybuilders in the off-season: a narrative review',
      journal: 'Sports',
      pmid: '31247944',
      doi: '10.3390/sports7070154',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31247944/',
    },
    {
      id: 'hewbutler2017',
      authors: 'Hew-Butler T, Loi V, Pani A, Rosner MH.',
      year: 2017,
      title: 'Exercise-associated hyponatremia: 2017 update',
      journal: 'Front Med',
      pmid: '28316971',
      doi: '10.3389/fmed.2017.00021',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28316971/',
    },
    {
      id: 'rossow2013',
      authors: 'Rossow LM, Fukuda DH, Fahs CA, Loenneke JP, Stout JR.',
      year: 2013,
      title: 'Natural bodybuilding competition preparation and recovery: a 12-month case study',
      journal: 'Int J Sports Physiol Perform',
      pmid: '23412685',
      doi: '10.1123/ijspp.8.5.582',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23412685/',
    },
    {
      id: 'hulmi2016',
      authors: 'Hulmi JJ, Isola V, Suonpää M, et al.',
      year: 2016,
      title:
        'The effects of intensive weight reduction on body composition and serum hormones in female fitness competitors',
      journal: 'Front Physiol',
      pmid: '28119632',
      doi: '10.3389/fphys.2016.00689',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28119632/',
    },
    {
      id: 'sundgotborgen2013',
      authors: 'Sundgot-Borgen J, Meyer NL, Lohman TG, et al.',
      year: 2013,
      title:
        'How to minimise the health risks to athletes who compete in weight-sensitive sports: review and position statement on behalf of the Ad Hoc Research Working Group on Body Composition, Health and Performance, under the auspices of the IOC Medical Commission',
      journal: 'Br J Sports Med',
      pmid: '24115480',
      doi: '10.1136/bjsports-2013-092966',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24115480/',
      verification: 'abstract',
    },
    {
      id: 'gallagher2000',
      authors: 'Gallagher D, Heymsfield SB, Heo M, Jebb SA, Murgatroyd PR, Sakamoto Y.',
      year: 2000,
      title:
        'Healthy percentage body fat ranges: an approach for developing guidelines based on body mass index',
      journal: 'Am J Clin Nutr',
      pmid: '10966886',
      doi: '10.1093/ajcn/72.3.694',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10966886/',
      verification: 'abstract',
    },
    {
      id: 'kalm2005',
      authors: 'Kalm LM, Semba RD.',
      year: 2005,
      title: 'They starved so that others be better fed: remembering Ancel Keys and the Minnesota experiment',
      journal: 'J Nutr',
      pmid: '15930436',
      doi: '10.1093/jn/135.6.1347',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15930436/',
    },
    {
      id: 'patton1999',
      authors: 'Patton GC, Selzer R, Coffey C, Carlin JB, Wolfe R.',
      year: 1999,
      title: 'Onset of adolescent eating disorders: population based cohort study over 3 years',
      journal: 'BMJ',
      pmid: '10082698',
      doi: '10.1136/bmj.318.7186.765',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10082698/',
    },
    {
      id: 'neumarksztainer2011',
      authors: 'Neumark-Sztainer D, Wall M, Larson NI, Eisenberg ME, Loth K.',
      year: 2011,
      title:
        'Dieting and disordered eating behaviors from adolescence to young adulthood: findings from a 10-year longitudinal study',
      journal: 'J Am Diet Assoc',
      pmid: '21703378',
      doi: '10.1016/j.jada.2011.04.012',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21703378/',
    },
    {
      id: 'golden2016',
      authors:
        'Golden NH, Schneider M, Wood C; AAP Committee on Nutrition, Committee on Adolescence, Section on Obesity.',
      year: 2016,
      title: 'Preventing obesity and eating disorders in adolescents',
      journal: 'Pediatrics',
      pmid: '27550979',
      doi: '10.1542/peds.2016-1649',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27550979/',
    },
    {
      id: 'simpson2017',
      authors: 'Simpson CC, Mazzeo SE.',
      year: 2017,
      title:
        'Calorie counting and fitness tracking technology: associations with eating disorder symptomatology',
      journal: 'Eat Behav',
      pmid: '28214452',
      doi: '10.1016/j.eatbeh.2017.02.002',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28214452/',
    },
    {
      id: 'levinson2017',
      authors: 'Levinson CA, Fewell L, Brosof LC.',
      year: 2017,
      title: 'My Fitness Pal calorie tracker usage in the eating disorders',
      journal: 'Eat Behav',
      pmid: '28843591',
      doi: '10.1016/j.eatbeh.2017.08.003',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28843591/',
    },
    {
      id: 'linardon2019',
      authors: 'Linardon J, Messer M.',
      year: 2019,
      title:
        'My fitness pal usage in men: associations with eating disorder symptoms and psychosocial impairment',
      journal: 'Eat Behav',
      pmid: '30772765',
      doi: '10.1016/j.eatbeh.2019.02.003',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30772765/',
    },
    {
      id: 'honary2019',
      authors: 'Honary M, Bell BT, Clinch S, Wild SE, McNaney R.',
      year: 2019,
      title:
        'Understanding the role of healthy eating and fitness mobile apps in the formation of maladaptive eating and exercise behaviors in young people',
      journal: 'JMIR Mhealth Uhealth',
      pmid: '31215514',
      doi: '10.2196/14239',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31215514/',
    },
    {
      id: 'morgan1999',
      authors: 'Morgan JF, Reid F, Lacey JH.',
      year: 1999,
      title: 'The SCOFF questionnaire: assessment of a new screening tool for eating disorders',
      journal: 'BMJ',
      pmid: '10582927',
      doi: '10.1136/bmj.319.7223.1467',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10582927/',
    },
    {
      id: 'kutz2020',
      authors: 'Kutz AM, Marsh AG, Gunderson CG, Maguen S, Masheb RM.',
      year: 2020,
      title:
        'Eating disorder screening: a systematic review and meta-analysis of diagnostic test characteristics of the SCOFF',
      journal: 'J Gen Intern Med',
      pmid: '31705473',
      doi: '10.1007/s11606-019-05478-6',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31705473/',
    },
    {
      id: 'mond2008',
      authors: 'Mond JM, Myers TC, Crosby RD, et al.',
      year: 2008,
      title: 'Screening for eating disorders in primary care: EDE-Q versus SCOFF',
      journal: 'Behav Res Ther',
      pmid: '18359005',
      doi: '10.1016/j.brat.2008.02.003',
      url: 'https://pubmed.ncbi.nlm.nih.gov/18359005/',
    },
    {
      id: 'bredin2013',
      authors: 'Bredin SSD, et al.',
      year: 2013,
      title:
        'PAR-Q+ and ePARmed-X+: new risk stratification and physical activity clearance strategy for physicians and patients alike',
      journal: 'Can Fam Physician',
      pmid: '23486800',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23486800/',
      verification: 'abstract',
    },
    {
      id: 'parq2025',
      authors: 'PAR-Q+ Collaboration.',
      year: 2025,
      title: 'PAR-Q+ — The Physical Activity Readiness Questionnaire for Everyone (2025 form)',
      journal: 'PAR-Q+ Collaboration',
      url: 'https://eparmedx.com/wp-content/uploads/2025/01/PARQPlus2025Fillable.pdf',
    },
    {
      id: 'riebe2015',
      authors: 'Riebe D, Franklin BA, Thompson PD, et al.',
      year: 2015,
      title: "Updating ACSM's recommendations for exercise preparticipation health screening",
      journal: 'Med Sci Sports Exerc',
      pmid: '26473759',
      doi: '10.1249/MSS.0000000000000664',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26473759/',
    },
    {
      id: 'acsm2009',
      authors: 'American College of Sports Medicine.',
      year: 2009,
      title: 'Position stand: progression models in resistance training for healthy adults',
      journal: 'Med Sci Sports Exerc',
      pmid: '19204579',
      doi: '10.1249/MSS.0b013e3181915670',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19204579/',
    },
    {
      id: 'nielsen2014',
      authors: 'Nielsen RØ, Parner ET, Nohr EA, et al.',
      year: 2014,
      title:
        'Excessive progression in weekly running distance and risk of running-related injuries: an association which varies according to type of injury',
      journal: 'J Orthop Sports Phys Ther',
      pmid: '25155475',
      doi: '10.2519/jospt.2014.5164',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25155475/',
    },
    {
      id: 'buist2008',
      authors: 'Buist I, Bredeweg SW, van Mechelen W, et al.',
      year: 2008,
      title:
        'No effect of a graded training program on the number of running-related injuries in novice runners: a randomized controlled trial',
      journal: 'Am J Sports Med',
      pmid: '17940147',
      doi: '10.1177/0363546507307505',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17940147/',
    },
    {
      id: 'damsted2018',
      authors: 'Damsted C, Glad S, Nielsen RO, Sørensen H, Malisoux L.',
      year: 2018,
      title:
        'Is there evidence for an association between changes in training load and running-related injuries? A systematic review',
      journal: 'Int J Sports Phys Ther',
      pmid: '30534459',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30534459/',
    },
    {
      id: 'armstrong2007',
      authors: 'Armstrong LE, Casa DJ, Millard-Stafford M, et al.',
      year: 2007,
      title:
        'American College of Sports Medicine position stand: exertional heat illness during training and competition',
      journal: 'Med Sci Sports Exerc',
      pmid: '17473783',
      doi: '10.1249/MSS.0b013e31802fa199',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17473783/',
    },
    {
      id: 'who2026',
      authors: 'World Health Organization.',
      year: 2026,
      title: 'Physical activity fact sheet',
      journal: 'Web page (accessed 2026-09-30)',
      url: 'https://www.who.int/news-room/fact-sheets/detail/physical-activity',
    },
    {
      id: 'efsa2015',
      authors: 'European Food Safety Authority.',
      year: 2015,
      title: 'Caffeine (topic page summarising the Scientific Opinion on the safety of caffeine)',
      journal: 'EFSA J 2015;13(5):4102',
      url: 'https://www.efsa.europa.eu/en/topics/topic/caffeine',
    },
    {
      id: 'fda2026',
      authors: 'US Food and Drug Administration.',
      year: 2026,
      title: 'Spilling the beans: how much caffeine is too much? (consumer update)',
      journal: 'Web page (accessed 2026-09-30)',
      url: 'https://www.fda.gov/consumers/consumer-updates/spilling-beans-how-much-caffeine-too-much',
    },
    {
      id: 'kreider2017',
      authors: 'Kreider RB, Kalman DS, Antonio J, et al.',
      year: 2017,
      title:
        'International Society of Sports Nutrition position stand: safety and efficacy of creatine supplementation in exercise, sport, and medicine',
      journal: 'J Int Soc Sports Nutr',
      pmid: '28615996',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28615996/',
    },
    {
      id: 'nhs2026',
      authors: 'NHS (UK).',
      year: 2026,
      title: 'Calculating alcohol units',
      journal: 'Web page (accessed 2026-09-30)',
      url: 'https://www.nhs.uk/live-well/alcohol-advice/calculating-alcohol-units/',
    },
    {
      id: 'ccsa2023',
      authors: 'Canadian Centre on Substance Use and Addiction.',
      year: 2023,
      title: "Canada's Guidance on Alcohol and Health",
      journal: 'CCSA',
      url: 'https://www.ccsa.ca/canadas-guidance-alcohol-and-health',
    },
    {
      id: 'whoeurope2023',
      authors: 'WHO Regional Office for Europe.',
      year: 2023,
      title: 'No level of alcohol consumption is safe for our health (news release, 4 Jan 2023)',
      journal: 'WHO news release',
      url: 'https://www.who.int/europe/news/item/04-01-2023-no-level-of-alcohol-consumption-is-safe-for-our-health',
    },
    {
      id: 'iom2009',
      authors: 'Institute of Medicine.',
      year: 2009,
      title: 'Weight Gain During Pregnancy: Reexamining the Guidelines',
      journal: 'Washington DC: National Academies Press',
      url: 'https://nap.nationalacademies.org/read/12584/chapter/2',
    },
    {
      id: 'lovelady2000',
      authors: 'Lovelady CA, Garner KE, Moreno KL, Williams JP.',
      year: 2000,
      title: 'The effect of weight loss in overweight, lactating women on the growth of their infants',
      journal: 'N Engl J Med',
      pmid: '10675424',
      doi: '10.1056/NEJM200002173420701',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10675424/',
    },
    {
      id: 'pavlidou2023',
      authors: 'Pavlidou E, et al.',
      year: 2023,
      title: 'Clinical evidence of low-carbohydrate diets against obesity and diabetes mellitus',
      journal: 'Metabolites',
      pmid: '36837859',
      url: 'https://pubmed.ncbi.nlm.nih.gov/36837859/',
    },
    {
      id: 'marinescu2024',
      authors: 'Marinescu SCN, Apetroaei MM, et al.',
      year: 2024,
      title:
        'Dietary influence on drug efficacy: a comprehensive review of ketogenic diet–pharmacotherapy interactions',
      journal: 'Nutrients',
      pmid: '38674903',
      doi: '10.3390/nu16081213',
      url: 'https://pubmed.ncbi.nlm.nih.gov/38674903/',
    },
  ],
};

export default topic;
