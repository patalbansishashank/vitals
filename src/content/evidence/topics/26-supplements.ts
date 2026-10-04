import type { EvidenceTopic } from '../schema';

const topic: EvidenceTopic = {
  dossier: '26',
  slug: 'supplements',
  title: 'Supplements',
  scope:
    'This topic covers the 23 supplements in the Vitals catalogue: for each, how it is thought to work, the usual adult dose and timing, who should avoid it, what trials found (benefit, no effect or harm), and whether the simulator uses it. A further entry lists twelve popular products with no expected benefit. Supplements are opt-in only. Doses are adult defaults from the cited reviews, not personal advice, and anyone with a medical condition or on medicines should ask a clinician first.',
  mechanisms: [
    {
      id: '26-whey-protein',
      title: 'Whey protein: a fast, leucine-rich way to close a protein gap',
      category: 'body',
      summary:
        'Whey is a quickly digested complete protein with about 11 % leucine, an amino acid that switches on muscle building. It is useful only to close the gap between what you eat and your daily protein target. Taken with resistance training it adds a small amount of lean mass.',
      howModelled:
        "It is modelled through the protein it provides: grams counted in the day's protein, tagged as whey so its digestion quality and leucine content are used. It is a source of protein, not a separate boost.",
      keyNumbers: [
        {
          label: 'Dose per serving',
          value:
            '25 g protein (range 20–40 g); about 0.3 g/kg for young adults and 0.4 g/kg for older adults',
          referenceIds: ['jager2017'],
        },
        {
          label: 'Daily protein target it supports',
          value: '1.6 g/kg/day (range 1.2–2.2); no further lean-mass gain above about 1.62 g/kg/day',
          referenceIds: ['morton2018'],
        },
        {
          label: 'Timing',
          value:
            'any meal short of about 0.3 g/kg protein; around training if convenient; secondary to the daily total',
        },
        {
          label: 'Lean mass with resistance training (49 trials)',
          value: '+0.30 kg (95 % CI 0.09–0.52); strength 1RM +2.49 kg',
          referenceIds: ['morton2018'],
        },
        {
          label: 'Muscle building during an energy deficit',
          value: 'whey at 1.3 g/kg limited the fall to −9 % versus −28 % soy and −31 % control',
        },
        {
          label: 'Avoid or ask first',
          value: 'milk allergy; chronic kidney disease only with a clinician-set protein cap',
        },
        {
          label: 'Product quality in India (36 products)',
          value: 'about 70 % mis-stated protein content; 14 % contained aflatoxins',
          referenceIds: ['medicine2024'],
        },
      ],
      timeCourse: 'Lean-mass gains accrue over weeks of training.',
      moderators: 'Total daily protein, training, age (older adults need larger servings), diet pattern.',
      grade: 'A',
      gradeReason:
        'A meta-analysis of randomised trials agrees; the energy-deficit finding rests on one study (grade B).',
      status: 'established',
      caveats:
        'The benefit is small and vanishes when diet protein is already adequate. Choose third-party tested products, because labels are unreliable.',
      referenceIds: ['jager2017', 'morton2018', 'medicine2024'],
      relatedMetricIds: ['rtMuscleGain', 'inProtein', 'mps'],
    },
    {
      id: '26-plant-protein',
      title: 'Plant protein powder: as good as whey when the serving is matched',
      category: 'body',
      summary:
        'Soy or pea-and-rice powders have less leucine per gram than whey, so a slightly larger serving restores the same signal. In trials with resistance training, soy and whey gave the same lean mass and strength.',
      howModelled:
        'Counted as protein with the plant-blend source tag, which carries a lower digestibility and leucine score than whey. Aim is about 2.5–3 g leucine a serving.',
      keyNumbers: [
        {
          label: 'Dose per serving',
          value: '30 g protein (range 25–40 g)',
          note: 'Aim for about 2.5–3 g leucine.',
          referenceIds: ['jager2017'],
        },
        { label: 'Leucine content', value: 'soy about 6.9 %; pea about 7.2 %' },
        { label: 'Timing', value: 'as for whey' },
        {
          label: 'Lean mass and strength versus whey with resistance training',
          value: 'no difference in 9 trials of soy versus whey',
          referenceIds: ['heviaLarrain2021'],
        },
        {
          label: 'Habitual vegans on soy versus omnivores on whey at 1.6 g/kg',
          value: 'leg lean mass +1.2 kg in both',
          referenceIds: ['heviaLarrain2021'],
        },
        { label: 'Avoid or ask first', value: 'soy allergy (for the soy form)' },
      ],
      timeCourse: 'Weeks of training.',
      moderators: 'Leucine matching, total protein, product quality.',
      grade: 'A',
      gradeReason:
        'Randomised trials and a controlled comparison agree that matched plant and whey protein perform similarly.',
      status: 'established',
      caveats:
        'Pea has a lower digestibility score than soy; match the serving rather than assume parity. Quality varies between brands.',
      referenceIds: ['jager2017', 'heviaLarrain2021'],
      relatedMetricIds: ['rtMuscleGain', 'inProtein'],
    },
    {
      id: '26-casein-presleep',
      title: 'Casein before sleep: keeps muscle building overnight',
      category: 'body',
      summary:
        'Casein digests slowly and keeps amino acids in the blood for hours, which raises overnight muscle protein synthesis. Whether that turns into extra muscle over months is less clear.',
      howModelled:
        'Counted as protein in the meal that sits before sleep, tagged as casein so the slower release is represented.',
      keyNumbers: [
        { label: 'Dose', value: '35 g protein a night (range 30–40 g)' },
        { label: 'Timing', value: '30–60 min before sleep' },
        {
          label: 'Overnight muscle building',
          value: 'higher with 40 g casein',
          referenceIds: ['snijders2019'],
        },
        {
          label: 'Long-term muscle growth',
          value: 'possible in young adults; not shown in older men',
          referenceIds: ['snijders2019'],
        },
        { label: 'Avoid or ask first', value: 'milk allergy' },
        { label: 'Caution', value: 'adds to daily energy and conflicts with an overnight-fasting window' },
      ],
      timeCourse: 'Overnight acute effect; chronic benefit uncertain.',
      moderators: 'Age, daily protein, whether the eating window allows a late meal.',
      grade: 'B',
      gradeReason: 'The acute overnight effect is shown; the chronic hypertrophy benefit is only grade C.',
      status: 'established',
      caveats: 'A review only; the long-term benefit is not established.',
      referenceIds: ['snijders2019'],
      relatedMetricIds: ['mps', 'inProtein'],
    },
    {
      id: '26-creatine-monohydrate',
      title: 'Creatine monohydrate: more training volume, a little lean mass, about a kilo of water',
      category: 'performance',
      summary:
        'Creatine raises the muscle store of phosphocreatine by 20–40 %, which supports short, hard efforts. With resistance training it adds about 1.1 kg of measured lean mass, partly water held inside muscle cells. Scale weight rises by about 0.5–1.5 kg, which is not fat.',
      howModelled:
        'A creatine load state fills over days to weeks while it is taken and drains over about 30 days once stopped. Its size sets the extra body water and a small boost to training gains. The full model is in the topic on other levers.',
      keyNumbers: [
        {
          label: 'Dose',
          value: '3 g a day (range 3–5 g); optional loading of 0.3 g/kg/day for 5–7 days in 4 split doses',
          referenceIds: ['kreider2017'],
        },
        { label: 'Timing', value: 'any time, daily, with a meal; consistency matters, not timing' },
        {
          label: 'Lean mass with resistance training',
          value: '+1.10 kg (0.56–1.65); older adults +1.37 kg',
          note: 'Meta-analytic figures as reported in the other-levers topic.',
        },
        {
          label: 'Time course',
          value: '20 g/d for 6 days or 3 g/d for 28 days raised muscle creatine by about 20 %',
          referenceIds: ['kreider2017'],
        },
        {
          label: 'Scale water',
          value:
            '+0.5–1.5 kg within a week of loading or about 4 weeks at 3 g/d; gone about 30 days after stopping',
        },
        { label: 'Avoid or ask first', value: 'kidney disease (clinician)' },
        {
          label: 'Caution',
          value:
            'raises blood creatinine without changing kidney filtration, which can confuse a test (could not be confirmed against the original paper); 20–30 % of people respond little',
        },
      ],
      timeCourse:
        'Stores fill in about a week with loading or about four weeks on 3 g/d, and empty over about 30 days.',
      moderators: 'Resistance training, age and sex, dose, starting muscle creatine.',
      grade: 'A',
      gradeReason:
        'Meta-analyses of randomised trials agree on lean mass and strength; the kinetics rest on smaller studies.',
      status: 'established',
      caveats: 'Consistent with the other-levers topic. Kinetics for 5 g/d without loading are interpolated.',
      referenceIds: ['kreider2017'],
      relatedMetricIds: ['scaleWeight', 'rtMuscleGain'],
      relatedParamIds: ['water.creatineWaterKg'],
    },
    {
      id: '26-caffeine',
      title: 'Caffeine: helps endurance and power, costs sleep, is not a fat burner',
      category: 'performance',
      summary:
        "Caffeine blocks the brain's adenosine receptors, which improves endurance, strength and power. Its half-life is about five hours, so a late dose cuts sleep. It burns less than 60 kcal a day.",
      howModelled:
        'A body-pool state tracks caffeine on board. A performance effect applies to sessions after a 3–6 mg/kg dose, and a sleep penalty applies if the last dose is closer to bedtime than a cut-off that grows with dose. No fat-loss credit is given.',
      keyNumbers: [
        {
          label: 'Dose',
          value:
            '3 mg/kg before exercise (range 2–6 mg/kg); at most 400 mg a day and 200 mg in a single dose',
          referenceIds: ['guest2021', 'efsa2015'],
        },
        {
          label: 'Timing',
          value:
            '30–60 min before exercise; finish a 100 mg coffee at least 8.8 h and a 220 mg pre-workout at least 13.2 h before bed',
          referenceIds: ['gardiner2023'],
        },
        {
          label: 'Endurance time trial',
          value: 'time −2.2 %, power +3.0 % at 3–6 mg/kg',
          referenceIds: ['guest2021'],
        },
        { label: 'Sleep', value: 'total sleep time −45 min (pooled)', referenceIds: ['gardiner2023'] },
        { label: 'Fat loss', value: 'about 60 kcal a day or less; null for practical purposes' },
        {
          label: 'Avoid or ask first',
          value:
            'pregnancy above 200 mg a day; arrhythmia; anxiety disorder; uncontrolled high blood pressure',
          referenceIds: ['efsa2015'],
        },
        {
          label: 'Caution',
          value: 'tolerance to the performance effect after about 4 weeks of daily use in low users',
        },
      ],
      timeCourse: 'Effect within an hour; half-life about 5 h.',
      moderators: 'Habitual intake, body mass, smoking, oral contraceptives, genetics.',
      grade: 'A',
      gradeReason: 'Meta-analyses of trials cover performance and sleep; fat loss is graded B.',
      status: 'established',
      caveats:
        'Consistent with the other-levers topic. The bedtime cut-offs are anchored to two doses (107 mg and 217.5 mg).',
      referenceIds: ['guest2021', 'gardiner2023', 'efsa2015'],
      relatedMetricIds: ['sleepQuality', 'enduranceCapacity'],
      relatedParamIds: ['moderators.caffeineTHalfH', 'moderators.caffeineRStarMg'],
    },
    {
      id: '26-electrolytes-fasting',
      title: 'Sodium and magnesium on long fasts: replacing what the body dumps',
      category: 'fuel',
      summary:
        'In the first days of a fast, low insulin and ketone excretion make the kidneys shed sodium and water. Replacing sodium eases dizziness on standing, while drinking lots of plain water without any salt can cause dangerously low blood sodium.',
      howModelled:
        'Sodium and magnesium intake enter the hydration model, which tracks how much salt and water are lost and kept. The card appears automatically for fasts of 36 hours or more.',
      keyNumbers: [
        { label: 'Sodium', value: '1.5–2.5 g a day for fasts of 36–48 h; 2–3 g a day for 48 h or more' },
        { label: 'Magnesium', value: '100–300 mg a day from 72 h' },
        {
          label: 'Potassium',
          value:
            'none routinely up to 72 h; at most 1–2 g a day only in supervised fasts over 3 days without potassium or kidney flags',
        },
        {
          label: 'Timing',
          value:
            'from day 2 of a fast of 36 h or more, split across the day in water or broth; one teaspoon of salt is about 2.3 g sodium (spoon mass unverified)',
        },
        {
          label: 'Avoid or ask first',
          value:
            'high blood pressure (clinician); heart failure; chronic kidney disease; potassium with ACE-inhibitor, ARB or potassium-sparing medicines',
        },
        {
          label: 'Caution',
          value:
            'never salt-load; more than 3 L a day of plain water without salt triggers a low-sodium warning',
        },
      ],
      timeCourse: 'Sodium loss is largest in days 1–4 of a fast.',
      moderators: 'Fast length, sweat, medicines, kidney and heart health.',
      grade: 'C',
      gradeReason: 'The physiology is graded B, but the dose recommendation is only grade C.',
      status: 'proposed-fit',
      caveats:
        'Doses come from the fasting and safety research of the project, not from a single guideline. This is guidance for adults without conditions, and conditions listed above change it.',
      referenceIds: [],
      relatedMetricIds: ['ecfShift', 'waterWeight'],
    },
    {
      id: '26-electrolytes-sweat-lowcarb',
      title: 'Extra sodium for the first weeks of low-carb eating or heavy sweating',
      category: 'fuel',
      summary:
        'Cutting carbohydrate lowers insulin, and the kidneys then lose sodium. Sweat also carries 0.23–1.6 g sodium a litre. The mechanism is clear, but there are few trials of whether extra salt prevents the "low-carb flu".',
      howModelled: 'Added sodium enters the hydration model as extra intake for the period it is taken.',
      keyNumbers: [
        { label: 'Dose', value: '1.5 g extra sodium a day (range 1–2 g)' },
        {
          label: 'Timing',
          value: 'first 1–2 weeks of under 50 g a day of carbohydrate; during and after long sweaty sessions',
        },
        {
          label: 'Sweat replacement (rule of thumb, unverified)',
          value: 'about 0.5–1 g sodium per litre of sweat for sessions over 2 h',
        },
        { label: 'Prevention of low-carb flu', value: 'mechanism clear, trials sparse' },
        { label: 'Avoid or ask first', value: 'high blood pressure; heart failure; chronic kidney disease' },
      ],
      timeCourse: 'Needed mainly in the first one to two weeks.',
      moderators: 'Carbohydrate intake, sweat rate, blood pressure and kidney status.',
      grade: 'D',
      gradeReason: 'The mechanism is clear but trials are sparse, so the benefit is graded C to D.',
      status: 'proposed-fit',
      caveats: 'The sweat rule of thumb is unverified. Anyone told to limit salt should not add it.',
      referenceIds: [],
      relatedMetricIds: ['ecfShift'],
    },
    {
      id: '26-potassium-salt-substitute',
      title: 'Potassium-enriched salt: less sodium, more potassium, lower blood pressure',
      category: 'cardio',
      summary:
        'Swapping part of the table salt for potassium chloride lowers sodium and raises potassium intake, and both help blood pressure. A large trial in people at high stroke risk found fewer strokes and cardiovascular events.',
      howModelled:
        'Enters the hydration and blood-pressure model as lower sodium and higher potassium intake.',
      keyNumbers: [
        { label: 'Dose', value: 'replace 25–75 % of cooking and table salt with a potassium blend' },
        { label: 'Timing', value: 'daily, in cooking' },
        {
          label: 'Blood pressure and stroke',
          value:
            'a large trial lowered stroke and cardiovascular events; the size of the effect was not extracted',
          referenceIds: ['neal2021'],
        },
        {
          label: 'Avoid or ask first',
          value:
            'chronic kidney disease; ACE-inhibitor, ARB or potassium-sparing medicines; any history of high blood potassium',
        },
        { label: 'Caution', value: 'check that the substitute is iodised' },
      ],
      timeCourse: 'Blood pressure falls within weeks.',
      moderators: 'Kidney function, medicines, baseline blood pressure.',
      grade: 'A',
      gradeReason:
        'A large randomised trial supports blood-pressure and stroke benefit, although the reference could only be checked from memory.',
      status: 'established',
      caveats:
        'The effect sizes and link were not verified. The hyperkalaemia risk is real in kidney disease or with certain medicines.',
      referenceIds: ['neal2021'],
      relatedMetricIds: ['sbp'],
    },
    {
      id: '26-magnesium',
      title: 'Magnesium: a small blood-pressure drop, no help for cramps',
      category: 'cardio',
      summary:
        'Magnesium is a helper in over 300 enzymes and relaxes blood vessels. Trials show a small fall in blood pressure. It did not help ordinary muscle cramps.',
      howModelled: 'Magnesium intake enters the hydration model, which matters most in long fasts.',
      keyNumbers: [
        {
          label: 'Dose',
          value: '250 mg elemental a day (range 200–350 mg); supplemental upper limit 350 mg a day',
          referenceIds: ['nihMagnesium'],
        },
        { label: 'Timing', value: 'evening with food; split the dose if stools loosen' },
        {
          label: 'Blood pressure (34 trials)',
          value: 'systolic −2.00 mmHg and diastolic −1.78 mmHg at a median 368 mg a day',
          referenceIds: ['zhang2016'],
        },
        { label: 'Sleep in older adults', value: 'time to fall asleep −17 min, low quality evidence' },
        { label: 'Idiopathic cramps', value: 'no benefit', referenceIds: ['garrison2020'] },
        { label: 'Avoid or ask first', value: 'chronic kidney disease' },
        {
          label: 'Caution',
          value:
            'diarrhoea above about 350 mg supplemental; spacing from some antibiotics and bisphosphonates by 2 h (unverified)',
        },
      ],
      timeCourse: 'Weeks for blood pressure.',
      moderators: 'Baseline intake, kidney function, form (oxide is poorly absorbed).',
      grade: 'A',
      gradeReason:
        'A meta-analysis of 34 trials supports the blood-pressure effect and a Cochrane review the null for cramps.',
      status: 'established',
      caveats: 'The effect is small. The sleep finding is low quality.',
      referenceIds: ['zhang2016', 'garrison2020', 'nihMagnesium'],
      relatedMetricIds: ['sbp', 'sleepQuality'],
    },
    {
      id: '26-vitamin-d3',
      title: 'Vitamin D3: matters when you are low, does nothing for weight',
      category: 'body',
      summary:
        'Vitamin D helps absorb calcium and mineralise bone. Benefits show mainly when levels start low. It does not change body weight or fat, and it did not reduce fractures in general adults.',
      howModelled: 'Not simulated. It appears as an information card and a micronutrient flag.',
      keyNumbers: [
        {
          label: 'Dose',
          value:
            '600 IU a day (range 600–2000 IU); 800 IU for age 70 or more; upper limit 4000 IU a day without supervision',
          referenceIds: ['demay2024', 'nihVitaminD'],
        },
        {
          label: 'Timing',
          value: 'with a fat-containing meal; daily rather than large intermittent doses',
          referenceIds: ['demay2024'],
        },
        { label: 'Weight and fat', value: 'null; BMI SMD −0.10, not significant' },
        { label: 'Muscle strength', value: 'SMD 0.17, larger if 25(OH)D under 30 nmol/L or age 65 or more' },
        { label: 'Fractures in general adults', value: 'null; RR 1.00' },
        {
          label: 'Avoid or ask first',
          value:
            'high blood calcium; sarcoidosis or granulomatous disease (unverified); kidney stones (with calcium)',
        },
        {
          label: 'Guideline stance',
          value:
            'no routine blood testing; no above-recommended dosing for healthy adults under 75; empiric supplementation suggested at 75 or more, in pregnancy and in high-risk prediabetes',
          referenceIds: ['demay2024'],
        },
      ],
      timeCourse: 'Levels rise over weeks.',
      moderators: 'Baseline level, age, sun exposure, skin tone, body size.',
      grade: 'A',
      gradeReason:
        'Large trials and meta-analyses establish the null on weight and fractures; the strength finding is grade B.',
      status: 'established',
      caveats: 'Recommended intake figures from the Indian national guideline were not re-read.',
      referenceIds: ['demay2024', 'nihVitaminD'],
      relatedMetricIds: ['hipBmdChange', 'micronutrientScore'],
    },
    {
      id: '26-omega-3',
      title: 'Omega-3 EPA and DHA: lowers triglycerides and blood pressure, not weight',
      category: 'cardio',
      summary:
        "Fish or algal oil lowers the liver's output of triglyceride-rich particles and trims blood pressure a little. It does not change weight. Higher doses are linked with more atrial fibrillation.",
      howModelled:
        'Daily EPA plus DHA enters the blood-lipid and blood-pressure model as a lever, with the blood-pressure effect plateauing at 2–3 g a day.',
      keyNumbers: [
        {
          label: 'Dose',
          value:
            '1 g EPA plus DHA a day if no oily fish; 2–3 g a day for blood pressure; 4 g a day (prescription) for triglycerides of 500 mg/dL or more',
          referenceIds: ['skulasRay2019', 'zhang2022'],
        },
        { label: 'Timing', value: 'with meals, which reduces reflux' },
        {
          label: 'Triglycerides',
          value: '30 % or more lower at 4 g a day when triglycerides are 500 mg/dL or higher',
          referenceIds: ['skulasRay2019'],
        },
        {
          label: 'Blood pressure',
          value: 'about −2.6 mmHg systolic and −1.7 mmHg diastolic at 2–3 g a day',
          referenceIds: ['zhang2022'],
        },
        { label: 'Weight', value: 'null; 0.00 kg' },
        {
          label: 'Atrial fibrillation',
          value: 'hazard ratio 1.25 overall and 1.49 above 1 g a day',
          referenceIds: ['gencer2021'],
        },
        {
          label: 'Avoid or ask first',
          value: 'history of atrial fibrillation; anticoagulant medicines (clinician)',
        },
        {
          label: 'Caution',
          value: 'EPA plus DHA can raise LDL cholesterol at 4 g a day in very high triglycerides',
        },
      ],
      timeCourse: 'Weeks.',
      moderators: 'Baseline triglycerides, dose, background fish intake.',
      grade: 'A',
      gradeReason:
        'Consistent trial evidence for triglycerides and blood pressure; the atrial fibrillation signal is a meta-analysis of trials.',
      status: 'established',
      caveats: 'Consistent with the other-levers topic. Benefit and risk both rise with dose.',
      referenceIds: ['skulasRay2019', 'zhang2022', 'gencer2021'],
      relatedMetricIds: ['triglycerides', 'sbp'],
    },
    {
      id: '26-psyllium',
      title: 'Psyllium husk (isabgol): lowers LDL cholesterol and adds fibre',
      category: 'cardio',
      summary:
        'Psyllium is a sticky soluble fibre that forms a gel, binds bile acids (which lowers LDL cholesterol), slows stomach emptying and adds stool water. It also helps modestly during calorie restriction.',
      howModelled:
        'Counts as fibre intake with a viscous-fibre share, which feeds the LDL and appetite effects.',
      keyNumbers: [
        {
          label: 'Dose',
          value: '5 g one to three times a day; about 10 g a day for lipids',
          referenceIds: ['jovanovski2018'],
        },
        {
          label: 'Timing',
          value:
            'with at least 250 mL of water, before or with meals; separate from medicines by 2 h (rule unverified)',
        },
        { label: 'Ramp-up', value: 'start 3–5 g a day and add no more than 5 g a day each week' },
        {
          label: 'LDL cholesterol (28 trials)',
          value: '−0.33 mmol/L at about 10 g a day',
          referenceIds: ['jovanovski2018'],
        },
        { label: 'Weight during calorie restriction', value: 'about −0.8 kg' },
        {
          label: 'Avoid or ask first',
          value: 'bowel obstruction; swallowing difficulty or oesophageal stricture',
        },
        { label: 'Caution', value: 'bloating if ramped fast; choking risk if taken dry' },
      ],
      timeCourse: 'LDL falls over weeks.',
      moderators: 'Baseline LDL, fluid intake, dose ramp.',
      grade: 'A',
      gradeReason: 'A meta-analysis of 28 randomised trials supports the LDL effect; weight is grade B.',
      status: 'established',
      caveats: 'Medicine spacing rule is unverified.',
      referenceIds: ['jovanovski2018'],
      relatedMetricIds: ['ldl', 'apoB'],
    },
    {
      id: '26-vitamin-b12',
      title: 'Vitamin B12: for vegetarians, vegans, metformin users and older adults',
      category: 'body',
      summary:
        'B12 occurs naturally only in animal foods. People who eat little dairy or meat, take metformin or acid-reducing medicines, or are older may absorb or eat too little. Deficiency causes anaemia and nerve damage.',
      howModelled: 'Not simulated. It raises a micronutrient flag and shows an information card.',
      keyNumbers: [
        {
          label: 'Dose',
          value:
            '10–100 µg a day, or 1,000–2,000 µg once or twice a week; treatment of deficiency is for a clinician',
          note: 'Common practice from absorption data, not a single guideline.',
          referenceIds: ['nihB12'],
        },
        { label: 'Timing', value: 'any time' },
        {
          label: 'Preventing deficiency in at-risk diets',
          value: 'effective (grade B)',
          referenceIds: ['nihB12', 'b12India2020'],
        },
        { label: 'Caution', value: 'get tested if symptoms; high folate can mask B12 anaemia' },
        { label: 'Avoid or ask first', value: 'no specific contraindication listed' },
      ],
      timeCourse: 'Stores last months to years, so deficiency develops slowly.',
      moderators: 'Diet pattern, medicines, age, gut absorption.',
      grade: 'B',
      gradeReason:
        'The need follows from where B12 occurs in food and is well documented, but dose ranges come from common practice.',
      status: 'established',
      caveats:
        'Indian prevalence figures were not extracted. Dose ranges are common practice, not one guideline.',
      referenceIds: ['nihB12', 'b12India2020'],
      relatedMetricIds: ['micronutrientScore'],
    },
    {
      id: '26-iron',
      title: 'Iron: only if diagnosed deficient, best on alternate mornings',
      category: 'body',
      summary:
        'Iron corrects deficiency. Each dose raises a hormone (hepcidin) that blocks absorption for about a day, so dosing on alternate days absorbs a larger fraction.',
      howModelled: 'Not simulated. It is an information card, offered only if a deficiency is diagnosed.',
      keyNumbers: [
        {
          label: 'Dose',
          value: '60 mg elemental on alternate days (range 40–120 mg); upper limit 45 mg a day',
          referenceIds: ['stoffel2017', 'nihIron'],
        },
        {
          label: 'Timing',
          value: 'morning, empty stomach or with vitamin C; 1–2 h away from tea, coffee, calcium and dairy',
        },
        {
          label: 'Absorption, alternate-day versus daily',
          value: 'fractional absorption 21.8 % versus 16.3 %; total 175 mg versus 131 mg',
          referenceIds: ['stoffel2017'],
        },
        {
          label: 'Avoid or ask first',
          value:
            'haemochromatosis; men or post-menopausal women who have not been tested, because it may mask gut blood loss',
        },
        { label: 'Caution', value: 'constipation, nausea; keep away from children' },
      ],
      timeCourse: 'Weeks to months to refill stores.',
      moderators: 'Menstruation, diet, gut conditions, hepcidin.',
      grade: 'B',
      gradeReason:
        'The absorption finding is from a mechanistic randomised trial (graded A for that outcome), but clinical outcomes were not the endpoint.',
      status: 'established',
      caveats: 'Never self-prescribe iron without a test.',
      referenceIds: ['stoffel2017', 'nihIron'],
      relatedMetricIds: ['micronutrientScore'],
    },
    {
      id: '26-calcium',
      title: 'Calcium: fill the dietary gap, not more',
      category: 'body',
      summary:
        'Weight loss lowers hip bone density by about 1–1.5 %. Adequate calcium, protein and resistance training reduce this. A supplement is only for the gap between diet and about 1,000 mg a day.',
      howModelled: 'Not simulated. It is an information card tied to the bone flag.',
      keyNumbers: [
        {
          label: 'Dose',
          value:
            'only the gap to about 1,000 mg a day in total; upper limit 2,500 mg a day; at most 500 mg per dose',
          referenceIds: ['nihCalcium'],
        },
        { label: 'Timing', value: 'carbonate with food; citrate any time; at least 2 h away from iron' },
        {
          label: 'Hip bone density loss during weight loss (context)',
          value: 'about −0.010 to −0.015 g/cm²',
        },
        { label: 'Avoid or ask first', value: 'kidney stones (clinician); high blood calcium' },
      ],
      timeCourse: 'Months.',
      moderators: 'Diet, vitamin D, age, activity.',
      grade: 'B',
      gradeReason:
        'The bone-loss context is well documented; the benefit of a supplement for it is graded B.',
      status: 'established',
      caveats: 'The national recommended intake of 1,000 mg a day was not re-read.',
      referenceIds: ['nihCalcium'],
      relatedMetricIds: ['hipBmdChange'],
    },
    {
      id: '26-multivitamin-low-energy',
      title: 'Multivitamin-mineral when eating under about 1,200 kcal a day',
      category: 'body',
      summary:
        'Below about 1,200 kcal a day (very-low-energy diets, protein-sparing modified fasting, long fasting blocks) there is too little food to meet most micronutrient needs. Liquid very-low-calorie formulas are fortified for this reason.',
      howModelled:
        'Not simulated. A multivitamin card appears and the micronutrient flag turns off while it is taken.',
      keyNumbers: [
        {
          label: 'Dose',
          value:
            '1 tablet a day at no more than 100 % of the recommended intake for each nutrient; no megadoses',
        },
        { label: 'Timing', value: 'with the main meal' },
        {
          label: 'Micronutrient adequacy',
          value: 'supported by the arithmetic of intake; hard outcomes not trialled',
          referenceIds: ['icmrNin2024'],
        },
        {
          label: 'Caution',
          value:
            'iron-containing forms are not for men unless indicated; it does not replace B12 or vitamin D dosing where flagged',
        },
        { label: 'Avoid or ask first', value: 'no specific contraindication listed' },
      ],
      timeCourse: 'While intake stays low.',
      moderators: 'Energy intake, diet pattern, duration.',
      grade: 'C',
      gradeReason: 'It rests on composition arithmetic; no single trial is cited.',
      status: 'proposed-fit',
      caveats: 'A Vitals recommendation from the logic of food composition, not from trials.',
      referenceIds: ['icmrNin2024'],
      relatedMetricIds: ['micronutrientScore'],
    },
    {
      id: '26-iodine-iodised-salt',
      title: 'Iodine through iodised salt',
      category: 'hormones',
      summary:
        'Iodine is needed to make thyroid hormone. Rock salt (sendha namak), pink salt and sea salt used for fasting days or fashion are usually not iodised, so a vegan with no dairy or seafood and no iodised salt can run short.',
      howModelled: 'Not simulated. It is a food-first rule and information card.',
      keyNumbers: [
        {
          label: 'Dose',
          value:
            'use iodised salt for everyday cooking; the national guideline sample menus use 5 g of iodised salt a day',
          referenceIds: ['icmrNin2024'],
        },
        { label: 'Timing', value: 'daily' },
        { label: 'Preventing deficiency', value: 'effective (grade B)' },
        { label: 'Avoid or ask first', value: 'hyperthyroidism (clinician)' },
        { label: 'Caution', value: 'iodine in rock or pink salt varies (unverified)' },
      ],
      timeCourse: 'Months of low intake.',
      moderators: 'Diet pattern, salt type.',
      grade: 'B',
      gradeReason:
        'Salt iodisation as a deficiency measure is well established, though the source here is a guideline rather than a trial.',
      status: 'established',
      caveats: 'Salt guidance conflicts with advice to limit sodium; use the guideline amount, not more.',
      referenceIds: ['icmrNin2024'],
      relatedMetricIds: ['micronutrientScore'],
    },
    {
      id: '26-folic-acid',
      title: 'Folic acid for anyone who could become pregnant',
      category: 'hormones',
      summary:
        'Folic acid taken around conception lowers the risk of neural-tube defects. The tube closes before many people know they are pregnant, so the advice covers anyone who could become pregnant.',
      howModelled: 'Not simulated. Pregnancy is routed to safety mode; this is information only.',
      keyNumbers: [
        { label: 'Dose', value: '400 µg a day (range 400–800 µg)', referenceIds: ['uspstf2023'] },
        { label: 'Timing', value: 'daily, from at least a month before conception' },
        {
          label: 'Neural-tube defect prevention',
          value: 'effective (grade A)',
          referenceIds: ['uspstf2023'],
        },
        { label: 'Avoid or ask first', value: 'no specific contraindication listed' },
      ],
      timeCourse: 'Needs to be in place before and during early pregnancy.',
      moderators: 'Pregnancy plans, diet.',
      grade: 'A',
      gradeReason: 'A national preventive-services recommendation rests on randomised trial evidence.',
      status: 'established',
      caveats: 'Informational only; pregnancy needs clinician-led care.',
      referenceIds: ['uspstf2023'],
      relatedMetricIds: [],
    },
    {
      id: '26-dietary-nitrate',
      title: 'Dietary nitrate (beetroot juice): helps time to exhaustion, not time trials',
      category: 'performance',
      summary:
        'Nitrate is turned by mouth bacteria into nitrite and then nitric oxide, which lowers the oxygen cost of exercise and blood pressure. Trials show longer time to exhaustion, but no clear gain in time trials.',
      howModelled: 'Not simulated. It is an information card for event days.',
      keyNumbers: [
        {
          label: 'Dose',
          value:
            '6.5 mmol nitrate (range 6–8 mmol, about 370–500 mg) on event day, or daily for blood pressure',
        },
        {
          label: 'Timing',
          value:
            '2–3 h before exercise; at least 3–7 days of daily intake for chronic effects; avoid antiseptic mouthwash, which kills the nitrate-reducing bacteria',
        },
        { label: 'Time to exhaustion', value: 'effect size 0.33', referenceIds: ['mcmahon2017'] },
        { label: 'Time trial', value: 'no significant effect', referenceIds: ['mcmahon2017'] },
        { label: 'Blood pressure', value: 'systolic −3.6 mmHg', referenceIds: ['bahadoran2017'] },
        { label: 'Avoid or ask first', value: 'kidney stones, because of oxalate (unverified)' },
        {
          label: 'Caution',
          value: 'red urine and stool are harmless; one meta-analysis saw no benefit in females',
        },
      ],
      timeCourse: 'Peak 2–3 h after a dose.',
      moderators: 'Sex, fitness level, mouthwash use, event type.',
      grade: 'B',
      gradeReason:
        'Meta-analyses agree on exhaustion time and blood pressure, but the time-trial result is null.',
      status: 'contested',
      caveats: 'Results differ between exhaustion tests and time trials, and by sex.',
      referenceIds: ['mcmahon2017', 'bahadoran2017', 'maughan2018'],
      relatedMetricIds: ['enduranceCapacity', 'sbp'],
    },
    {
      id: '26-beta-alanine',
      title: 'Beta-alanine: a slow build-up of muscle buffer for efforts of one to ten minutes',
      category: 'performance',
      summary:
        'Beta-alanine raises muscle carnosine, which buffers acid built up in hard efforts. It works only as a daily course taken for weeks, and the benefit is for efforts lasting about one to ten minutes.',
      howModelled: 'Not simulated. It is an information card.',
      keyNumbers: [
        {
          label: 'Dose',
          value: '4.8 g a day (range 3.2–6.4 g), in doses of at most 1.6 g',
          referenceIds: ['trexler2015'],
        },
        {
          label: 'Timing',
          value: 'split doses with meals; chronic loading for at least 4 weeks, not an acute dose',
        },
        { label: 'Efforts of 4–10 minutes', value: 'effect size 0.55', referenceIds: ['trexler2015'] },
        { label: 'Caution', value: 'tingling (paraesthesia) with larger single doses' },
        { label: 'Avoid or ask first', value: 'no specific contraindication listed' },
      ],
      timeCourse: 'At least 4 weeks to raise carnosine.',
      moderators: 'Dose, event duration, training status.',
      grade: 'B',
      gradeReason: 'A position stand and reviews report a moderate effect for a narrow range of efforts.',
      status: 'established',
      caveats: 'No benefit for short sprints or long endurance is claimed.',
      referenceIds: ['trexler2015', 'maughan2018'],
      relatedMetricIds: ['enduranceCapacity'],
    },
    {
      id: '26-sodium-bicarbonate',
      title: 'Sodium bicarbonate: buffers acid in repeated hard efforts, often upsets the gut',
      category: 'performance',
      summary:
        'Taken before exercise, bicarbonate raises blood bicarbonate and so buffers acid. Gains show in repeated high-intensity efforts. Stomach upset is common and the sodium load is large.',
      howModelled: 'Not simulated. It is an information card.',
      keyNumbers: [
        { label: 'Dose', value: '0.3 g/kg (range 0.2–0.3 g/kg)', referenceIds: ['grgic2021'] },
        {
          label: 'Timing',
          value: '60–180 min before, with a carbohydrate meal and split doses to reduce stomach upset',
        },
        {
          label: 'Wingate and Yo-Yo performance',
          value: 'effect sizes 0.09–1.26 across reviews',
          referenceIds: ['grgic2021', 'grgic2021a'],
        },
        {
          label: 'Sodium load',
          value:
            '0.3 g/kg is about 5.7 g sodium for a 70 kg person (arithmetic assumes 27 % sodium; unverified)',
        },
        { label: 'Avoid or ask first', value: 'high blood pressure; heart failure; chronic kidney disease' },
        { label: 'Caution', value: 'stomach upset is common' },
      ],
      timeCourse: 'Peak within 60–180 min.',
      moderators: 'Event type, stomach tolerance, dose splitting.',
      grade: 'B',
      gradeReason:
        'A position stand and an umbrella review of trials show benefit, with a wide spread of effect sizes.',
      status: 'established',
      caveats: 'The effect range is wide and individual tolerance varies.',
      referenceIds: ['grgic2021', 'grgic2021a'],
      relatedMetricIds: ['enduranceCapacity'],
    },
    {
      id: '26-melatonin',
      title: 'Melatonin: a small effect on how fast you fall asleep',
      category: 'recovery',
      summary:
        'Melatonin is a timing signal for the body clock with a small sleep-inducing effect. In trials it shortens the time to fall asleep by a few minutes.',
      howModelled: 'Not simulated. It is an information card.',
      keyNumbers: [
        { label: 'Dose', value: '1 mg a night (range 0.5–3 mg)' },
        { label: 'Timing', value: '30–60 min before target bedtime' },
        {
          label: 'Sleep latency',
          value: '−7 min; total sleep time +8 min',
          referenceIds: ['ferraciolioda2013'],
        },
        { label: 'Avoid or ask first', value: 'pregnancy; autoimmune disease (unverified)' },
        {
          label: 'Caution',
          value: 'next-day drowsiness; legal status varies, and its status in India is unverified',
        },
      ],
      timeCourse: 'Works the same night.',
      moderators: 'Timing relative to body clock, dose, age.',
      grade: 'A',
      gradeReason: 'A meta-analysis of trials shows a consistent but small effect.',
      status: 'established',
      caveats: 'The effect is small and clinically modest.',
      referenceIds: ['ferraciolioda2013'],
      relatedMetricIds: ['sleepQuality'],
    },
    {
      id: '26-ashwagandha',
      title: 'Ashwagandha: some benefit for sleep and anxiety scores, with a liver-injury signal',
      category: 'recovery',
      summary:
        'Ashwagandha root extract is proposed to act on the stress-hormone axis and calming brain signals, though how is uncertain. Trials show better sleep and anxiety scores, but case reports describe liver injury.',
      howModelled: 'Not simulated. It is an information card with a prominent safety note.',
      keyNumbers: [
        { label: 'Dose', value: '600 mg a day of root extract (range 300–600 mg)' },
        { label: 'Timing', value: 'evening; trials ran at least 8 weeks' },
        { label: 'Sleep', value: 'standardised effect −0.59', referenceIds: ['cheah2021'] },
        { label: 'Anxiety', value: 'standardised effect −1.55' },
        {
          label: 'Liver injury',
          value: 'cases with jaundice 2–12 weeks after starting, resolved in 1–5 months',
          referenceIds: ['bjornsson2020'],
        },
        {
          label: 'Avoid or ask first',
          value: 'pregnancy; liver disease; thyroid disease (unverified); autoimmune disease (unverified)',
        },
      ],
      timeCourse: 'At least 8 weeks in trials; liver injury appeared after 2–12 weeks.',
      moderators: 'Product, dose, liver health.',
      grade: 'B',
      gradeReason:
        'A meta-analysis supports sleep benefit, but safety evidence is only a case series (grade C).',
      status: 'contested',
      caveats: 'Large effect sizes from small trials are likely to be inflated. Product quality varies.',
      referenceIds: ['cheah2021', 'bjornsson2020'],
      relatedMetricIds: ['sleepQuality'],
    },
    {
      id: '26-no-expected-benefit',
      title: 'Twelve popular products with no expected benefit for these goals',
      category: 'body',
      summary:
        'Kept so the app can answer questions with the evidence. For each, trials found no useful effect for muscle or weight loss, or found harm. A low evidence grade alone never leaves a product out; these are left out because the evidence shows no effect or harm.',
      howModelled:
        'Not simulated and not offered. Asked about, they are answered with the null evidence below.',
      keyNumbers: [
        {
          label: 'BCAA',
          value:
            'no gain in muscle building when total protein is adequate; oral BCAA alone does not stimulate it (grade B, null)',
          referenceIds: ['wolfe2017'],
        },
        {
          label: 'HMB',
          value:
            'no lean-mass or strength gain with resistance training in young adults; small functional effect in older adults only (grade B, null)',
          referenceIds: ['jakubowski2020'],
        },
        {
          label: 'Green-tea catechins',
          value: '−0.04 kg outside Japan; liver toxicity at high doses (grade A, null)',
          referenceIds: ['jurgens2012'],
        },
        {
          label: 'Garcinia (HCA)',
          value: '−0.88 kg (CI to 0.00); stomach side effects doubled (grade A, limited)',
          referenceIds: ['onakpoya2011'],
        },
        {
          label: 'CLA, chitosan, glucomannan as weight-loss pills',
          value: 'none met the 2.5 kg clinical threshold (grade A, limited)',
          referenceIds: ['bessell2021'],
        },
        {
          label: 'L-carnitine',
          value: '−1.33 kg, shrinking with longer trials (grade A, limited)',
          referenceIds: ['pooyandjoo2016'],
        },
        {
          label: 'Thermogenic fat burners',
          value: 'most under 2 kg; stimulant side effects (grade B, null or harm)',
        },
        {
          label: 'Exogenous ketones',
          value: 'no fat-loss benefit; a ketone diester worsened a cyclist time trial by 2 % (grade B)',
          referenceIds: ['leckey2017'],
        },
        {
          label: 'Collagen as a muscle protein',
          value:
            'lacks tryptophan, so does not replace whey or soy for muscle building (grade C to D); skin effects are separate',
          referenceIds: ['sun2025'],
        },
        {
          label: 'NMN and NR',
          value: 'no effect on glucose, lipids, muscle mass or function in aggregate (grade B, null)',
          referenceIds: ['prokopidis2025'],
        },
        {
          label: 'Resveratrol',
          value: 'blunted the VO₂max gain by 45 % during training in older men (grade B, harm signal)',
          referenceIds: ['gliemann2013'],
        },
        {
          label: 'Vitamin C (1 g) plus E around training',
          value: 'blunted markers of mitochondrial adaptation (grade B, harm signal)',
          referenceIds: ['paulsen2014'],
        },
      ],
      timeCourse: 'Not applicable.',
      moderators: 'Total diet, training status.',
      grade: 'B',
      gradeReason:
        'Most entries rest on meta-analyses or controlled trials showing no effect; harm signals come from single trials.',
      status: 'established',
      caveats:
        'The collagen finding is lower grade. The harm signals for resveratrol and antioxidants come from single trials in specific groups.',
      referenceIds: [
        'wolfe2017',
        'jakubowski2020',
        'jurgens2012',
        'onakpoya2011',
        'bessell2021',
        'pooyandjoo2016',
        'leckey2017',
        'sun2025',
        'prokopidis2025',
        'gliemann2013',
        'paulsen2014',
      ],
      relatedMetricIds: [],
    },
  ],
  myths: [
    {
      id: '26-myth-fat-burners',
      claim: 'Fat-burner pills, green-tea extract, garcinia or carnitine will melt fat.',
      verdict: 'not-supported',
      explanation:
        'The reviews found tiny changes: −0.04 kg for green tea outside Japan, −0.88 kg for garcinia, −1.33 kg for carnitine, and most thermogenic blends under 2 kg, none reaching a clinical threshold of 2.5 kg, with stimulant side effects.',
      referenceIds: ['jurgens2012', 'onakpoya2011', 'pooyandjoo2016', 'bessell2021'],
    },
    {
      id: '26-myth-bcaa',
      claim: 'You need BCAAs to protect or build muscle.',
      verdict: 'not-supported',
      explanation:
        'When total protein is adequate, BCAA alone gave no gain, and oral BCAA by itself does not stimulate muscle building.',
      referenceIds: ['wolfe2017'],
    },
    {
      id: '26-myth-antioxidants-recovery',
      claim: 'Antioxidant megadoses speed up recovery and improve training.',
      verdict: 'not-supported',
      explanation:
        'Vitamin C at 1 g plus vitamin E around training blunted markers of mitochondrial adaptation, and resveratrol blunted the gain in aerobic fitness in older men.',
      referenceIds: ['paulsen2014', 'gliemann2013'],
    },
    {
      id: '26-myth-creatine-fat',
      claim: 'Creatine makes you fat or is bad for kidneys in healthy people.',
      verdict: 'not-supported',
      explanation:
        'The early rise of about a kilo is water, not fat. Doses up to 30 g a day for five years were safe in healthy people. People with kidney disease should still ask a clinician first.',
      referenceIds: ['kreider2017'],
    },
    {
      id: '26-myth-protein-powder-needed',
      claim: 'You need protein powder to reach your protein target or build muscle.',
      verdict: 'oversimplified',
      explanation:
        'Powder is a convenience that closes a gap. Beyond about 1.6 g/kg/day no further lean-mass gain was seen, and Indian product labels often overstate protein, so food first and tested products are the safer route.',
      referenceIds: ['morton2018', 'medicine2024'],
    },
  ],
  openQuestions: [
    "How large is the effect of sodium replacement on symptoms in fasts and low-carbohydrate transitions? The mechanism is clear but trials are sparse and the doses come from the project's own research.",
    'How common are vitamin B12 and vitamin D deficiency among Indian adults on different diets? A 2020 review was cited but its figures were not extracted.',
    'Does ashwagandha help sleep at doses that avoid the liver-injury signal? Trials are small and product quality varies.',
    'Do nitrate, beta-alanine and bicarbonate help people who are not athletes? Most trials are in trained participants.',
    'What are the effect sizes of the large salt-substitute trial for blood pressure and stroke? The figures were not extracted and the reference could be checked only from memory.',
    'Is the national recommended intake of vitamin D, calcium and B12 in the Indian guidelines in line with the figures quoted here? They were not re-read from the source.',
  ],
  references: [
    {
      id: 'jager2017',
      authors: 'Jäger R, Kerksick CM, Campbell BI, et al.',
      year: 2017,
      title: 'International Society of Sports Nutrition position stand: protein and exercise',
      journal: 'J Int Soc Sports Nutr',
      pmid: '28642676',
      doi: '10.1186/s12970-017-0177-8',
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
      id: 'medicine2024',
      authors: 'Philips CA, Theruvath AH, Ravindran R, Chopra P, et al.',
      year: 2024,
      title:
        'Citizens protein project: a self-funded, transparent, and concerning report on analysis of popular protein supplements sold in the Indian market',
      journal: 'Medicine',
      pmid: '38579036',
      doi: '10.1097/md.0000000000037724',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10994440/',
      verification: 'abstract',
    },
    {
      id: 'heviaLarrain2021',
      authors: 'Hevia-Larraín V, Gualano B, Longobardi I, et al.',
      year: 2021,
      title:
        'High-protein plant-based diet versus a protein-matched omnivorous diet to support resistance training adaptations: a comparison between habitual vegans and omnivores',
      journal: 'Sports Med',
      pmid: '33599941',
      doi: '10.1007/s40279-021-01434-9',
    },
    {
      id: 'snijders2019',
      authors: 'Snijders T, Trommelen J, Kouw IWK, Holwerda AM, Verdijk LB, van Loon LJC.',
      year: 2019,
      title:
        'The impact of pre-sleep protein ingestion on the skeletal muscle adaptive response to exercise in humans: an update',
      journal: 'Front Nutr',
      pmid: '30895177',
      doi: '10.3389/fnut.2019.00017',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30895177/',
      verification: 'abstract',
    },
    {
      id: 'kreider2017',
      authors: 'Kreider RB, Kalman DS, Antonio J, et al.',
      year: 2017,
      title:
        'International Society of Sports Nutrition position stand: safety and efficacy of creatine supplementation in exercise, sport, and medicine',
      journal: 'J Int Soc Sports Nutr',
      pmid: '28615996',
      doi: '10.1186/s12970-017-0173-z',
    },
    {
      id: 'guest2021',
      authors: 'Guest NS, VanDusseldorp TA, Nelson MT, et al.',
      year: 2021,
      title: 'International society of sports nutrition position stand: caffeine and exercise performance',
      journal: 'J Int Soc Sports Nutr',
      pmid: '33388079',
      doi: '10.1186/s12970-020-00383-4',
    },
    {
      id: 'gardiner2023',
      authors: 'Gardiner C, Weakley J, Burke LM, et al.',
      year: 2023,
      title: 'The effect of caffeine on subsequent sleep: A systematic review and meta-analysis',
      journal: 'Sleep Med Rev',
      pmid: '36870101',
      doi: '10.1016/j.smrv.2023.101764',
    },
    {
      id: 'efsa2015',
      authors: 'European Food Safety Authority.',
      year: 2015,
      title: 'Scientific opinion on the safety of caffeine',
      journal: 'EFSA Journal',
      doi: '10.2903/j.efsa.2015.4102',
      url: 'https://www.efsa.europa.eu/en/efsajournal/pub/4102',
    },
    {
      id: 'maughan2018',
      authors: 'Maughan RJ, et al.',
      year: 2018,
      title: 'IOC consensus statement: dietary supplements and the high-performance athlete',
      journal: 'Br J Sports Med 52:439-455',
      pmid: '29540367',
      doi: '10.1136/bjsports-2018-099027',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29540367/',
      verification: 'abstract',
    },
    {
      id: 'neal2021',
      authors: 'Neal B, et al.',
      year: 2021,
      title:
        'Effect of salt substitution on cardiovascular events and death',
      journal: 'N Engl J Med',
      pmid: '34459569',
      doi: '10.1056/NEJMoa2105675',
      url: 'https://www.nejm.org/doi/full/10.1056/NEJMoa2105675',
      verification: 'abstract',
    },
    {
      id: 'zhang2016',
      authors: 'Zhang X, et al.',
      year: 2016,
      title:
        'Effects of Magnesium Supplementation on Blood Pressure: A Meta-Analysis of Randomized Double-Blind Placebo-Controlled Trials',
      journal: 'Hypertension',
      pmid: '27402922',
      doi: '10.1161/hypertensionaha.116.07664',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27402922/',
      verification: 'abstract',
    },
    {
      id: 'garrison2020',
      authors: 'Garrison SR, Korownyk CS, Kolber MR, et al.',
      year: 2020,
      title: 'Magnesium for skeletal muscle cramps',
      journal: 'Cochrane Database Syst Rev',
      pmid: '32956536',
      doi: '10.1002/14651858.cd009402.pub3',
    },
    {
      id: 'nihMagnesium',
      authors: 'US National Institutes of Health, Office of Dietary Supplements.',
      year: 2026,
      title: 'Magnesium fact sheet for health professionals (supplemental upper limit 350 mg), accessed 2026',
      journal: 'Fact sheet',
      url: 'https://ods.od.nih.gov/factsheets/Magnesium-HealthProfessional/',
    },
    {
      id: 'demay2024',
      authors: 'Demay MB, Pittas AG, Bikle DD, et al.',
      year: 2024,
      title: 'Vitamin D for the prevention of disease: an Endocrine Society clinical practice guideline',
      journal: 'J Clin Endocrinol Metab 109:1907-1947',
      pmid: '38828931',
      doi: '10.1210/clinem/dgae290',
      url: 'https://pubmed.ncbi.nlm.nih.gov/38828931/',
      verification: 'abstract',
    },
    {
      id: 'nihVitaminD',
      authors: 'US National Institutes of Health, Office of Dietary Supplements.',
      year: 2026,
      title: 'Vitamin D fact sheet for health professionals (upper limit 100 µg), accessed 2026',
      journal: 'Fact sheet',
      url: 'https://ods.od.nih.gov/factsheets/VitaminD-HealthProfessional/',
    },
    {
      id: 'skulasRay2019',
      authors: 'Skulas-Ray AC, et al.',
      year: 2019,
      title:
        'Omega-3 fatty acids for the management of hypertriglyceridemia: a science advisory from the American Heart Association',
      journal: 'Circulation',
      pmid: '31422671',
      doi: '10.1161/CIR.0000000000000709',
    },
    {
      id: 'zhang2022',
      authors: 'Zhang X, Ritonja JA, Zhou N, et al.',
      year: 2022,
      title:
        'Omega-3 Polyunsaturated Fatty Acids Intake and Blood Pressure: A Dose-Response Meta-Analysis of Randomized Controlled Trials',
      journal: 'J Am Heart Assoc',
      pmid: '35647665',
      doi: '10.1161/jaha.121.025071',
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
    },
    {
      id: 'jovanovski2018',
      authors: 'Jovanovski E, et al.',
      year: 2018,
      title:
        'Effect of psyllium fiber on LDL cholesterol and alternative lipid targets, non-HDL cholesterol and apolipoprotein B: a systematic review and meta-analysis of RCTs',
      journal: 'Am J Clin Nutr',
      pmid: '30239559',
      doi: '10.1093/ajcn/nqy115',
    },
    {
      id: 'nihB12',
      authors: 'US National Institutes of Health, Office of Dietary Supplements.',
      year: 2026,
      title: 'Vitamin B12 fact sheet for health professionals, accessed 2026',
      journal: 'Fact sheet',
      url: 'https://ods.od.nih.gov/factsheets/VitaminB12-HealthProfessional/',
    },
    {
      id: 'b12India2020',
      authors: 'Malik A, Trilok-Kumar G.',
      year: 2020,
      title: 'Status of vitamin B12 among healthy adult and elderly population in India: a review',
      journal: 'J Nutr Sci Vitaminol 66:S361-S368',
      pmid: '33612626',
      doi: '10.3177/jnsv.66.s361',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33612626/',
      verification: 'abstract',
    },
    {
      id: 'stoffel2017',
      authors: 'Stoffel NU, et al.',
      year: 2017,
      title:
        'Iron absorption from oral iron supplements given on consecutive versus alternate days and as single morning doses versus twice-daily split dosing in iron-depleted women: two open-label, randomised controlled trials',
      journal: 'Lancet Haematol',
      pmid: '29032957',
      doi: '10.1016/s2352-3026(17)30182-5',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29032957/',
      verification: 'abstract',
    },
    {
      id: 'nihIron',
      authors: 'US National Institutes of Health, Office of Dietary Supplements.',
      year: 2026,
      title: 'Iron fact sheet for health professionals (upper limit 45 mg), accessed 2026',
      journal: 'Fact sheet',
      url: 'https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/',
    },
    {
      id: 'nihCalcium',
      authors: 'US National Institutes of Health, Office of Dietary Supplements.',
      year: 2026,
      title: 'Calcium fact sheet for health professionals, accessed 2026',
      journal: 'Fact sheet',
      url: 'https://ods.od.nih.gov/factsheets/Calcium-HealthProfessional/',
    },
    {
      id: 'icmrNin2024',
      authors: 'ICMR-National Institute of Nutrition.',
      year: 2024,
      title: 'Dietary Guidelines for Indians 2024',
      journal: 'Guideline',
      url: 'https://nin.res.in/dietaryguidelines/pdfjs/locale/DGI_2024.pdf',
    },
    {
      id: 'uspstf2023',
      authors: 'US Preventive Services Task Force, Barry MJ, Nicholson WK, et al.',
      year: 2023,
      title:
        'Folic Acid Supplementation to Prevent Neural Tube Defects: US Preventive Services Task Force Reaffirmation Recommendation Statement',
      journal: 'JAMA 330:454-459',
      pmid: '37526713',
      doi: '10.1001/jama.2023.12876',
      url: 'https://pubmed.ncbi.nlm.nih.gov/37526713/',
      verification: 'abstract',
    },
    {
      id: 'mcmahon2017',
      authors: 'McMahon NF, Leveritt MD, Pavey TG.',
      year: 2017,
      title:
        'The Effect of Dietary Nitrate Supplementation on Endurance Exercise Performance in Healthy Adults: A Systematic Review and Meta-Analysis',
      journal: 'Sports Med',
      pmid: '27600147',
      doi: '10.1007/s40279-016-0617-7',
    },
    {
      id: 'bahadoran2017',
      authors: 'Bahadoran Z, Mirmiran P, Kabir A, et al.',
      year: 2017,
      title:
        'The Nitrate-Independent Blood Pressure-Lowering Effect of Beetroot Juice: A Systematic Review and Meta-Analysis',
      journal: 'Adv Nutr',
      pmid: '29141968',
      doi: '10.3945/an.117.016717',
    },
    {
      id: 'trexler2015',
      authors: 'Trexler ET, et al.',
      year: 2015,
      title: 'International Society of Sports Nutrition position stand: beta-alanine',
      journal: 'J Int Soc Sports Nutr',
      pmid: '26175657',
      doi: '10.1186/s12970-015-0090-y',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26175657/',
      verification: 'abstract',
    },
    {
      id: 'grgic2021',
      authors: 'Grgic J, et al.',
      year: 2021,
      title:
        'International Society of Sports Nutrition position stand: sodium bicarbonate and exercise performance',
      journal: 'J Int Soc Sports Nutr',
      pmid: '34503527',
      doi: '10.1186/s12970-021-00458-w',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34503527/',
      verification: 'abstract',
    },
    {
      id: 'grgic2021a',
      authors: 'Grgic J, Grgic I, Del Coso J, et al.',
      year: 2021,
      title: 'Effects of sodium bicarbonate supplementation on exercise performance: an umbrella review',
      journal: 'J Int Soc Sports Nutr',
      pmid: '34794476',
      doi: '10.1186/s12970-021-00469-7',
    },
    {
      id: 'ferraciolioda2013',
      authors: 'Ferracioli-Oda E, Qawasmi A, Bloch MH.',
      year: 2013,
      title: 'Meta-analysis: melatonin for the treatment of primary sleep disorders',
      journal: 'PLoS One',
      pmid: '23691095',
      doi: '10.1371/journal.pone.0063773',
    },
    {
      id: 'cheah2021',
      authors: 'Cheah KL, Norhayati MN, Husniati Yaacob L, et al.',
      year: 2021,
      title:
        'Effect of Ashwagandha (Withania somnifera) extract on sleep: A systematic review and meta-analysis',
      journal: 'PLoS One',
      pmid: '34559859',
      doi: '10.1371/journal.pone.0257843',
    },
    {
      id: 'bjornsson2020',
      authors: 'Björnsson HK, Björnsson ES, Avula B, et al.',
      year: 2020,
      title:
        'Ashwagandha-induced liver injury: A case series from Iceland and the US Drug-Induced Liver Injury Network',
      journal: 'Liver Int',
      pmid: '31991029',
      doi: '10.1111/liv.14393',
    },
    {
      id: 'wolfe2017',
      authors: 'Wolfe RR',
      year: 2017,
      title: 'Branched-chain amino acids and muscle protein synthesis in humans: myth or reality?',
      journal: 'J Int Soc Sports Nutr',
      pmid: '28852372',
      doi: '10.1186/s12970-017-0184-9',
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
    },
    {
      id: 'jurgens2012',
      authors: 'Jurgens TM, Whelan AM, Killian L, et al.',
      year: 2012,
      title: 'Green tea for weight loss and weight maintenance in overweight or obese adults',
      journal: 'Cochrane Database Syst Rev',
      pmid: '23235664',
      doi: '10.1002/14651858.cd008650.pub2',
    },
    {
      id: 'onakpoya2011',
      authors: 'Onakpoya I, Hung SK, Perry R, et al.',
      year: 2011,
      title:
        'The Use of Garcinia Extract (Hydroxycitric Acid) as a Weight loss Supplement: A Systematic Review and Meta-Analysis of Randomised Clinical Trials',
      journal: 'J Obes',
      pmid: '21197150',
      doi: '10.1155/2011/509038',
    },
    {
      id: 'bessell2021',
      authors: 'Bessell E, Maunder A, Lauche R, et al.',
      year: 2021,
      title:
        'Efficacy of dietary supplements containing isolated organic compounds for weight loss: a systematic review and meta-analysis of randomised placebo-controlled trials',
      journal: 'Int J Obes',
      pmid: '33976376',
      doi: '10.1038/s41366-021-00839-w',
    },
    {
      id: 'pooyandjoo2016',
      authors: 'Pooyandjoo M, Nouhi M, Shab-Bidar S, et al.',
      year: 2016,
      title:
        'The effect of (L-)carnitine on weight loss in adults: a systematic review and meta-analysis of randomized controlled trials',
      journal: 'Obes Rev',
      pmid: '27335245',
      doi: '10.1111/obr.12436',
    },
    {
      id: 'leckey2017',
      authors: 'Leckey JJ, Ross ML, Quod M, et al.',
      year: 2017,
      title: 'Ketone Diester Ingestion Impairs Time-Trial Performance in Professional Cyclists',
      journal: 'Front Physiol',
      pmid: '29109686',
      doi: '10.3389/fphys.2017.00806',
    },
    {
      id: 'sun2025',
      authors: 'Sun C, Yang A, Teng F, et al.',
      year: 2025,
      title: 'Efficacy of collagen peptide supplementation on bone and muscle health: a meta-analysis',
      journal: 'Front Nutr',
      pmid: '41049371',
      doi: '10.3389/fnut.2025.1646090',
    },
    {
      id: 'prokopidis2025',
      authors: 'Prokopidis K, Moriarty F, Bahat G, et al.',
      year: 2025,
      title:
        'The Effect of Nicotinamide Mononucleotide and Riboside on Skeletal Muscle Mass and Function: A Systematic Review and Meta-Analysis',
      journal: 'J Cachexia Sarcopenia Muscle',
      pmid: '40275690',
      doi: '10.1002/jcsm.13799',
    },
    {
      id: 'gliemann2013',
      authors: 'Gliemann L, Schmidt JF, Olesen J, et al.',
      year: 2013,
      title:
        'Resveratrol blunts the positive effects of exercise training on cardiovascular health in aged men',
      journal: 'J Physiol',
      pmid: '23878368',
      doi: '10.1113/jphysiol.2013.258061',
    },
    {
      id: 'paulsen2014',
      authors: 'Paulsen G, Cumming KT, Holden G, et al.',
      year: 2014,
      title:
        'Vitamin C and E supplementation hampers cellular adaptation to endurance training in humans: a double-blind, randomised, controlled trial',
      journal: 'J Physiol',
      pmid: '24492839',
      doi: '10.1113/jphysiol.2013.267419',
    },
  ],
};

export default topic;
