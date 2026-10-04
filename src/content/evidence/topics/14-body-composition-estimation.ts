import type { EvidenceTopic } from '../schema';

const topic: EvidenceTopic = {
  dossier: '14',
  slug: 'body-composition-estimation',
  title: 'Estimating body composition and fat distribution',
  scope:
    'How Vitals turns cheap inputs (sex, age, height, weight, an optional waist, training history and a few body-shape sliders) into a starting estimate of fat, muscle, water, glycogen and where fat sits, with an honest uncertainty. It also covers how fat is lost and gained by region, how those changes show up on a tape measure, how a body avatar is drawn, and how much the uncertainty matters for projections. Body fat percentage here always means DXA-equivalent fat mass divided by body mass.',
  mechanisms: [
    {
      id: '14-population-body-fat-estimators',
      title: 'Estimating body fat from simple measurements',
      category: 'body',
      summary:
        'Fat-free mass scales with height and only weakly with fat mass, so body fat percentage can be predicted from BMI (weight in kg divided by height in metres squared), age and sex to within about ±4–5 %BF (1 SD), and slightly better with waist and height. What remains is mostly muscularity, body build and ethnicity, plus differences between reference methods. Vitals uses two published equations, one from BMI, age and sex (CUN-BAE) and one from waist and height (relative fat mass, RFM).',
      howModelled:
        'CUN-BAE gets an age-dependent offset so that it reads in the DXA frame, because DXA fat in a national survey reads higher than densitometry-based equations in young adults. RFM gives a second estimate if a waist is entered. Population biases are added as offsets (East Asian +3.5, South-East Asian +4.0, South Asian +5.0, Black adults −2.0 with low confidence), and muscular or lean people get a wider error band.',
      equation:
        'CUN-BAE: BF = −44.988 + 0.503·age + 10.689·sexF + 3.172·BMI − 0.026·BMI² + 0.181·BMI·sexF − 0.02·BMI·age − 0.005·BMI²·sexF + 0.00021·BMI²·age\nRFM: BF = 64 − 20·(height / waist) + 12·sexF\nDeurenberg 1991 (adult): BF = 1.20·BMI + 0.23·age − 10.8·sexM − 5.4\nUS Navy, metric, men: BF = 495 / (1.0324 − 0.19077·log10(waist − neck) + 0.15456·log10(height)) − 450\nUS Navy, metric, women: BF = 495 / (1.29579 − 0.35004·log10(waist + hip − neck) + 0.22100·log10(height)) − 450\nsexF = 1 for female; sexM = 1 for male',
      keyNumbers: [
        {
          label: 'Deurenberg 1991, adults (n = 1229, 7–83 y, BMI 13.9–40.9)',
          value: 'R² .79, SEE 4.1 %BF',
          note: 'Slight over-estimate in obese people.',
          referenceIds: ['deurenberg1991'],
        },
        {
          label: 'CUN-BAE (6510 white Spanish adults, mean body fat 39.9 %)',
          value: 'SEE 4.66, r .89',
          note: 'Against DXA in another cohort: r .77 (men) and .82 (women); bias +1.52 (men) and −0.24 (women). It over-estimates lean people and under-estimates the highest body-fat decile by 5.8.',
          referenceIds: ['gomezambrosi2012', 'vinknes2017'],
        },
        {
          label: 'RFM (NHANES 1999–2004 derivation n = 12,581; 2005–06 validation n = 3,456 vs DXA)',
          value:
            'R² .69 (women) and .75 (men); bias +0.9 (women) and +0.5 (men); precision (IQR of error) 4.9 and 4.2',
          note: 'Age and ethnicity did not improve R². It is better for trunk than total fat and its ability declines with age.',
          referenceIds: ['woolcott2018'],
        },
        {
          label: 'US Navy circumference formula',
          value:
            'Women: n = 202, R .856, SEE 3.61; in 609 fit Marines vs DXA, men −2.6 ± 3.7 (≤ 30 y) and −2.5 ± 3.7 (> 30 y), women +2.3 ± 4.3 and +1.3 ± 4.8',
          note: "Lean people are over-estimated and high-body-fat people under-estimated. The women's fit statistics come from a secondary summary.",
          referenceIds: ['hodgdon1984', 'potter2022'],
        },
        {
          label: 'Jackson–Pollock 3-site skinfolds',
          value: 'SEE 0.0055–0.0060 g/mL (about 2.5–2.8 %BF) vs underwater weighing',
          note: 'It needs calipers, so it is not an app input; it is listed for validation only.',
          referenceIds: ['jackson1978', 'jackson1980', 'siri1993'],
        },
        {
          label: 'NHANES 2005–06 vs DXA, women: bias / IQR / SD (approx.)',
          value:
            'Raw BMI read as %BF −10.9 / 5.8 / 4.3; RFM +0.9 / 4.9 / 3.6; CUN-BAE −0.2 / 6.0 / 4.4; Gallagher −2.8 / 5.2 / 3.9; Deurenberg (1.294 form) −2.3 / 7.5 / 5.6; Kagawa +1.9 / 7.3 / 5.4',
          referenceIds: ['woolcott2018', 'gallagher2000'],
        },
        {
          label: 'NHANES 2005–06 vs DXA, men: bias / IQR / SD (approx.)',
          value:
            'Raw BMI +0.7 / 5.1 / 3.8; RFM +0.5 / 4.2 / 3.1; CUN-BAE −0.1 / 5.7 / 4.2; Gallagher −3.7 / 5.0 / 3.7; Deurenberg (1.294 form) −1.9 / 6.2 / 4.6; Kagawa +2.3 / 5.0 / 3.7',
          note: 'These are in-population results (RFM was fitted on the same survey), so independent data are worse.',
          referenceIds: ['woolcott2018'],
        },
        {
          label: 'Independent checks of RFM',
          value:
            'In 61 young Mexican adults R² .84 vs DXA, but intercepts of −10 to −14 %BF against other methods because DXA read far higher in that sample',
          note: 'RFM assigns 24–26 %BF to a lean woman with a waist-to-height ratio of 0.40 (own calculation).',
          referenceIds: ['guzmanleon2019'],
        },
        {
          label: 'DXA-frame offset added to CUN-BAE, by age 20 / 30 / 40 / 50 / 60+ (% points)',
          value: 'Men +2.8 / +1.5 / +0.3 / 0 / 0; women +3.8 / +2.2 / +1.2 / +0.7 / +0.4',
          note: "Proposed fit from Kelly's median values and CUN-BAE: it under-predicts the DXA median by 2.8 (men) and 3.8 (women) at age 20, and 1.5 and 2.2 at 30. Disagreements of about ±3 %BF between methods remain; the UI says “DXA-equivalent”.",
          referenceIds: ['kelly2009', 'gomezambrosi2012'],
        },
        {
          label: 'Muscular and athletic people',
          value:
            'Optimal BMI cut for 20 %BF is 27.9 (male athletes) and 34.1 (linemen) vs 26.5 (male non-athletes); women 27.7 vs 24.0',
          note: 'BMI 30 or more has a sensitivity of 36 % (men) and 49 % (women) for obesity defined by body fat. Male bodybuilders have a fat-free mass index of 25.1 ± 1.8.',
          referenceIds: ['ode2007', 'romerocorral2008', 'graybeal2020'],
        },
        {
          label: 'East, South-East and South Asian adults',
          value:
            'Same BMI → 3–5 %BF higher; a Caucasian equation under-predicts Chinese, Malay and Indian adults by 2.7–5.6 %BF; offsets +3.5, +4.0, +5.0',
          note: 'BMI is lower at the same body fat: Chinese −1.9, Thai −2.9, Indonesian −3.2 vs Caucasian.',
          referenceIds: ['deurenberg2002', 'deurenbergyap2000', 'deurenberg1998'],
        },
        {
          label: 'Black adults',
          value:
            'In the DXA frame CUN-BAE over-estimates by +2.0 (offset −2.0); a four-compartment meta-analysis finds a BMI 1.3 units lower at the same body fat (opposite sign)',
          note: 'Flagged low-confidence, with the error band widened ×1.2.',
          referenceIds: ['woolcott2018', 'deurenberg1998'],
        },
        {
          label: 'Obesity',
          value: 'RFM misclassifies obesity less than BMI: 12.7 vs 56.5 % in women, 9.4 vs 13.0 % in men',
          referenceIds: ['woolcott2018'],
        },
        {
          label: 'Best combination from sex, age, height, weight and waist',
          value:
            'RFM has the smallest NHANES error (SD ≈ 3.1–3.6); CUN-BAE is the best weight-only estimator (SD ≈ 4.2–4.7); averaging both with error correlation 0.6 gives SD ≈ 3.8',
        },
        {
          label: 'Golden test values',
          value:
            'CUN-BAE: men, 30 y, BMI 25 → 22.09; women 34.18; men 60 y, BMI 30 → 32.29; women 43.91. RFM: man 175 cm, waist 90 → 25.11; woman 165 cm, waist 80 → 34.75. Deurenberg 1991 (30 y, BMI 25): men 20.70, women 31.50. Navy (inches / metric): man 178 cm, waist 90, neck 38 → 20.27 / 20.15; woman 165 cm, waist 75, hip 100, neck 33 → 29.74 / 29.43',
        },
      ],
      timeCourse: 'Static: an estimate at the start only.',
      moderators: 'Sex, age, ethnicity, muscularity and leanness (see the bias notes above).',
      grade: 'B',
      gradeReason:
        'Population-level accuracy is grade A (large DXA and plethysmography cohorts and several independent checks); use for one person is B, with an error of 4–5 %BF and heavy tails in athletes, lean people and some ethnic groups.',
      status: 'established',
      caveats:
        'The Gallagher and Kagawa equations and one form of the Deurenberg equation are known only as printed in a footnote of one paper, and the Navy equations come partly from secondary summaries. The DXA-frame offsets are an empirical patch. The essential-fat percentages (2–5 % men, 10–13 % women) are a textbook convention and unverified.',
      referenceIds: [
        'deurenberg1991',
        'deurenberg1998',
        'deurenberg2002',
        'deurenbergyap2000',
        'gallagher2000',
        'gomezambrosi2012',
        'vinknes2017',
        'woolcott2018',
        'guzmanleon2019',
        'hodgdon1984',
        'potter2022',
        'jackson1978',
        'jackson1980',
        'siri1993',
        'romerocorral2008',
        'ode2007',
        'graybeal2020',
        'kelly2009',
      ],
      relatedMetricIds: ['bodyFatPct'],
    },
    {
      id: '14-visual-body-fat-rating',
      title: 'How well can people judge body fat from a picture?',
      category: 'body',
      summary:
        'People match a picture to themselves. Repeatability is fair, but accuracy is limited: one-dimensional pictures fix muscularity, low BMI tends to be over-estimated and high BMI under-estimated, and body-image distortion adds error. A silhouette number correlated with BMI at r = 0.76 in men and 0.80 in women, and even a full 3D body scan predicts DXA fat mass only to about 2.4 kg. So Vitals treats the fat and muscle sliders as noisy readings, with a realistic error of about 5.5 %BF.',
      howModelled:
        'The two sliders are stored as points in a plane of fat mass index (FMI) and fat-free mass index (FFMI), each labelled with anchors: eight adiposity stops and eight muscularity stops. The weight implied by the two sliders is compared with actual weight and the difference is shown, not forced to agree.',
      equation: 'W_vis = h² · (FMI_vis + FFMI_vis)',
      keyNumbers: [
        {
          label: 'Stunkard figure-rating scale, silhouette number vs measured BMI (n = 1128, BMI 17.6–45.4)',
          value: 'r = 0.76 (men) and 0.80 (women); R² .55 and .64',
          note: 'Norms exist for 16,728 women and 11,366 men.',
          referenceIds: ['parzer2021', 'bulik2001'],
        },
        {
          label: 'A 15-silhouette scale against DXA (n = 514, Brazil)',
          value: 'Explains under 5 % (women) and about 22 % (men) of the error in perceived-minus-real BMI',
          note: '58.6 % of men and 82.6 % of women over-estimated their size, and 74.3 % and 86.8 % were dissatisfied because of excess weight; among the dissatisfied, 32.6 % (women) and 30.8 % (men) had no excess adiposity.',
          referenceIds: ['cabral2024'],
        },
        {
          label: 'Muscularity confound',
          value:
            'Men with the same BMI but different composition differ by 5–7 BMI units in self-estimates; muscle mass or tone in the picture alone shifts estimates by up to 2.5 BMI units',
          note: 'Whole-body MRI shows skeletal muscle exceeds adipose tissue at every BMI in men and below BMI ~26 (White) or ~28 (Black) in women. Estimates also show contraction bias.',
          referenceIds: ['heymsfield2009', 'groves2019'],
        },
        {
          label: 'Somatomorphic matrix (independent fat and muscle axes)',
          value: 'Test-retest r = .64 (current fat) and .78 (current muscularity)',
          note: 'Perceived versus measured composition was judged incomparable, and further development was recommended before multi-ethnic use.',
          referenceIds: ['cafri2004', 'kagawa2006', 'ralphnearman2018'],
        },
        {
          label: 'Calibrated two-axis avatars (397 scans: 176 men, 221 women)',
          value:
            'Leave-one-out torso error 1.71 cm (men) and 1.59 cm (women) vs 1.83 and 1.71 cm for a BMI-only model (d = .44, .35)',
          note: 'A separate study had 258 men choose current and ideal bodies, with the ideal anchored on the perceived current body. Body-line judgements had an SD under 6 % of the scale and were biased towards the previously seen body. A scoping review found 177 studies and 80 subjective female fat-distribution tools, with sparse validation.',
          referenceIds: ['maalin2021', 'groves2023', 'alexi2018', 'lennie2026'],
        },
        {
          label: 'Ceiling for shape → composition',
          value:
            '3D whole-body scans predict DXA fat mass to RMSE 2.4 kg (R² .95), fat-free mass 2.2 kg, visceral fat R² .75',
          note: 'So a person matching one avatar to their body cannot beat about 3 %BF; the realistic visual error is 5.5 %BF (proposed).',
          referenceIds: ['ng2016', 'heymsfield2018', 'tinsley2020'],
        },
        {
          label: 'Adiposity anchors, body fat % at stops 0–7',
          value: 'Men 6 / 10 / 15 / 20 / 25 / 30 / 35 / 42; women 14 / 18 / 22 / 27 / 32 / 38 / 45 / 52',
          note: 'Percentile of body fat in NHANES DXA (White, age 30): men 20 % = P16, 25 % = P46, 30 % = P74, 35 % = P91, 42 % = P99; women 27 % = P8, 32 % = P24, 38 % = P55, 45 % = P86, 52 % = P98. Men under 15 % and women under 22 % are below P2.',
          referenceIds: ['kelly2009'],
        },
        {
          label: 'Muscularity anchors, fat-free mass index at stops 0–7',
          value:
            'Men 16.5 (P8) / 18.0 (P25) / 19.5 (P48) / 21.0 (P70) / 22.5 (P84) / 24.0 (P92) / 25.0 (P95, the natural limit in one 1995 sample) / 27.0 (P98); women 13.5 (P8) / 14.5 (P22) / 16.0 (P49) / 17.3 (P70) / 18.5 (P83) / 19.5 (P90) / 20.5 (P94) / 22.0 (P97)',
          note: 'The NHANES distribution includes heavier people whose fat-free mass rises with fat, so P95 at an index of 25 is not a statement about lean athletes.',
          referenceIds: ['kelly2009', 'kouri1995'],
        },
        {
          label: 'Reading of the anchor table',
          value:
            'For population-typical muscle, RFM and CUN-BAE over-estimate body fat by about 3–6 points in men below 15 %BF and 5–10 points in women below 25 %BF; for athletic muscle, CUN-BAE evaluated at the athletic BMI gives 18.7 / 21.1 / 24.5 / 28.2 / 32.5 for men labelled 6 / 10 / 15 / 20 / 25 % and 29.1 / 31.3 for women labelled 14 / 18 %',
          note: "That is an over-estimate of 7.5–15 points (own calculation), which is why lean or muscular people's sliders or known body fat must dominate.",
        },
      ],
      timeCourse:
        'Judgements drift with recent exposure. A re-rating after a simulated change is a new noisy observation, not a measurement of change.',
      moderators:
        'Sex (male pictures need muscle variation), BMI (contraction bias), and body concerns (the ideal body is anchored on the perceived current body).',
      grade: 'C',
      gradeReason:
        'Several human studies agree on limited accuracy and on the biases, but no validated body-fat mapping exists for avatars.',
      status: 'proposed-fit',
      caveats:
        'No peer-reviewed validation of popular body-fat photo charts was found, and none for the “Body Volume Index”, so the descriptions of what each stop looks like are expert convention (grade D). Body-size over-estimation is a hallmark of eating disorders, so the sliders are optional and never prompt an “ideal body”. Entering a measured body fat is offered first.',
      referenceIds: [
        'parzer2021',
        'bulik2001',
        'cabral2024',
        'heymsfield2009',
        'groves2019',
        'cafri2004',
        'kagawa2006',
        'ralphnearman2018',
        'maalin2021',
        'groves2023',
        'alexi2018',
        'lennie2026',
        'ng2016',
        'heymsfield2018',
        'tinsley2020',
        'kelly2009',
        'kouri1995',
      ],
      relatedMetricIds: ['bodyFatPct'],
    },
    {
      id: '14-body-fat-fusion',
      title: 'Combining the inputs into one body-fat estimate',
      category: 'body',
      summary:
        'Body fat percentage is a single hidden number, with weight fixing fat plus fat-free mass. Each input (a BMI equation, a waist equation, the fat slider, the muscle slider, a known measurement) gives a noisy reading. Vitals combines them with weights based on how much each is trusted and how their errors correlate. The result is a best estimate and a spread: about 3.3–3.8 %BF with a visual estimate and a waist, and 4.2–4.7 with weight alone.',
      howModelled:
        'A constrained generalised least-squares fusion. The BMI reading carries a spread of 4.7 %BF, the waist reading 4.0, the fat slider 5.5, the muscle slider about 6–7, and a known measurement 2.5 (DXA), 3.5 (BIA) or 4.0 (skinfold or Navy), which overrides the rest. Spreads widen ×1.4 for athletes and ×1.3 for lean people. People with lifting history get a fat-free-mass offset. The result is clamped to 3–60 % for men and 8–60 % for women.',
      equation:
        "BF_hat = (1' Σ⁻¹ y) / (1' Σ⁻¹ 1); sd = (1' Σ⁻¹ 1)^(−1/2); Σ_ij = ρ_ij · σ_i · σ_j\ndF = 100 · dFFMI_train · h² / W; dFFMI_train = dmax · (1 − exp(−T_eff / 3)); dmax = 3.6 (men), 2.5 (women) kg/m²\nT_eff = years × {casual 0.4, regular 1.0, serious 1.5}",
      keyNumbers: [
        {
          label: 'Spread (σ, %BF) per reading',
          value:
            'BMI equation 4.7; waist (RFM) 4.0; Navy 4.5 (optional); fat slider 5.5; muscle slider about 6–7; known 2.5 (DXA), 3.5 (BIA), 4.0 (skinfold or Navy)',
          note: "The BMI and waist spreads are inflated for external populations. Marines' BIA-versus-DXA SD was 3.1–3.5. The muscle-slider spread assumes a slider-to-FFMI error of 1.6 kg/m² (proposed).",
          referenceIds: ['gomezambrosi2012', 'woolcott2018', 'potter2022'],
        },
        {
          label: 'Error correlations',
          value:
            'BMI and waist 0.6; fat and muscle sliders 0.3; anthropometric and visual 0.2; known measurement 0',
          note: 'If Navy is added: 0.5 with RFM and 0.3 with the BMI equation (proposed).',
        },
        {
          label: 'Athlete flag',
          value:
            'Two or more effective years of lifting, or a muscle slider at or above an FFMI of 21.6 (men) / 17.8 (women), about P75–P80',
        },
        {
          label: 'Training offset dmax and time constant',
          value: '3.6 (men) and 2.5 (women) kg/m²; 3 years',
          note: "Proposed fit to three anchor points: first-year novice gain of about 3 kg (+1.0 FFMI); the natural limit of 25 and bodybuilders at 25.1 imply +5.4 at the extreme; college male athletes' overfat BMI cut is +1.4 above non-athletes.",
          referenceIds: ['kouri1995', 'graybeal2020', 'ode2007'],
        },
        {
          label: 'Behaviour',
          value:
            'Typical adult with visual estimate and waist: sd 3.3–3.8; BMI only: 4.7; muscular lean man with training history and waist: sd 4.3, BF 11.5 (assumed true value 10–12); same man with no training or waist: BF 15.4 (sd 4.2)',
          note: 'So the algorithm asks for training history and waist because they repair the muscular and lean failure mode.',
        },
        {
          label:
            'Golden result 1: man 35 y, 178 cm, 88 kg, waist 96, fat slider 27 %, muscle FFMI 19.8, no lifting',
          value: 'BF 27.4 (sd 3.3); fat / fat-free mass 24.1 / 63.9 kg',
        },
        {
          label:
            'Golden result 2: man 30 y, 176 cm, 80 kg, waist 76, fat slider 12 %, muscle FFMI 23.0, 8 y regular lifting',
          value:
            'BF 11.5 (sd 4.3); 9.2 / 70.8 kg. Without waist and lifting history: BF 15.4 (sd 4.2); 12.3 / 67.7 kg',
        },
        {
          label: 'Golden results 4 and 5: two women',
          value:
            '42 y, 165 cm, 72 kg, waist 86, fat slider 36 %, FFMI 15.8: BF 37.9 (sd 3.3), 27.3 / 44.7 kg. 28 y, 168 cm, 60 kg, no waist, fat slider 24 %, FFMI 17.5, belly −0.5, 3 y lifting: BF 22.4 (sd 4.7), 13.4 / 46.6 kg',
        },
        {
          label: 'Golden result 6: man 45 y, 180 cm, 95 kg, nothing else',
          value: 'BF 30.2 (sd 4.7); 28.7 / 66.3 kg',
        },
        {
          label: 'Self-reported height and weight',
          value:
            'Height over-reported and weight under-reported on average; sigma_W = 2 kg, sigma_h = 1.5 cm',
          note: 'Proposed. The fusion treats weight as exact; for sensitivity add 100 × σ_W / W in quadrature to the muscle-slider term.',
          referenceIds: ['connor2007', 'flegal2019'],
        },
      ],
      timeCourse: 'Static: an estimate at the start only.',
      moderators: 'Athlete and lean flags, ethnicity, training years, and which optional inputs exist.',
      grade: 'C',
      gradeReason:
        'The components are grade A/B individually, but the combination weights, visual spread, training offsets and correlations are proposed.',
      status: 'proposed-fit',
      caveats:
        'The combination weights must be revisited with real user-versus-DXA data when available. The Navy option is not part of the prototype behind the golden tests.',
      referenceIds: [
        'gomezambrosi2012',
        'woolcott2018',
        'potter2022',
        'kouri1995',
        'graybeal2020',
        'ode2007',
        'connor2007',
        'flegal2019',
      ],
      relatedMetricIds: ['bodyFatPct', 'fatMass'],
    },
    {
      id: '14-nhanes-reference-distributions',
      title: 'How your body fat compares with US adults',
      category: 'body',
      summary:
        "Reference curves from a national DXA scan survey (NHANES 1999–2004) give the typical, low and high body fat percentage, fat mass index and fat-free mass index for each age and sex. For White adults aged 30 the median body fat is 25.7 % in men and 37.0 % in women. Percentiles are against adults of the early 2000s, who were about 1.5–2 BMI units leaner than today's.",
      howModelled:
        'Vitals stores the published LMS curves (a way to describe a skewed distribution by its median, spread and skew) and uses them to give percentiles and z-scores. They are used for starting expectations, not for dynamics.',
      equation: 'x(z) = M · (1 + L · S · z)^(1/L), with S = σ / M\nz = ((x / M)^L − 1) / (L · S); P = Φ(z)',
      keyNumbers: [
        {
          label: 'Medians at age 30 (White adults): body fat %, FMI, FFMI',
          value: 'Men 25.7 %, 6.78, 19.6 kg/m²; women 37.0 %, 9.35, 16.03 kg/m²',
          referenceIds: ['kelly2009'],
        },
        {
          label: 'Body fat % percentiles P5 / P25 / P50 / P75 / P95, men',
          value:
            'Age 20: 14.3 / 19.2 / 23.4 / 28.3 / 36.6; 30: 16.6 / 21.7 / 25.7 / 30.1 / 37.2; 50: 20.5 / 25.5 / 29.0 / 32.6 / 37.9; 70: 22.7 / 27.9 / 31.4 / 34.8 / 39.6',
          referenceIds: ['kelly2009'],
        },
        {
          label: 'Body fat % percentiles P5 / P25 / P50 / P75 / P95, women',
          value:
            'Age 20: 24.5 / 30.4 / 35.1 / 40.2 / 48.3; 30: 25.6 / 32.2 / 37.0 / 41.9 / 49.2; 50: 29.1 / 36.3 / 40.8 / 45.0 / 50.7; 70: 32.3 / 39.1 / 43.0 / 46.4 / 50.8',
          referenceIds: ['kelly2009'],
        },
        {
          label: 'Ethnic medians at age 30 (White / Black / Mexican-American)',
          value:
            'Body fat % men 25.7 / 23.1 / 27.2, women 37.0 / 39.2 / 40.0; FFMI men 19.6 / 20.3 / 19.8, women 16.0 / 17.9 / 16.6; trunk-to-limb fat ratio men 1.06 / 0.90 / 1.19, women 0.84 / 0.82 / 0.98',
          note: 'Bone mineral content men 2755 / 3005 / 2474 g, women 2177 / 2390 / 2065 g.',
          referenceIds: ['kelly2009'],
        },
        {
          label: 'Fat mass index classes, men (kg/m²)',
          value:
            'Severe deficit < 2; moderate 2 to < 2.3; mild 2.3 to < 3; normal 3–6; excess > 6–9; obese I > 9–12; obese II > 12–15; obese III > 15',
          note: 'Matched to the prevalence of the WHO BMI cut-offs at age 25.',
          referenceIds: ['kelly2009'],
        },
        {
          label: 'Fat mass index classes, women (kg/m²)',
          value:
            'Severe deficit < 3.5; moderate 3.5 to < 4; mild 4 to < 5; normal 5–9; excess > 9–13; obese I > 13–17; obese II > 17–21; obese III > 21',
          referenceIds: ['kelly2009'],
        },
        {
          label: 'Internal check',
          value: 'The White male median at 25 y (24.6 %) sits at P25.0 at age 45 and P9.9 at age 69',
          note: "Matching the authors' own text.",
          referenceIds: ['kelly2009'],
        },
        {
          label: 'Swiss BIA sample (n = 5,635 Caucasians, 24–98 y), 18–34 y',
          value:
            'Median FFMI 18.9 (men) and 15.4 (women); FMI 4.0 and 5.5. From young to elderly FMI rises 55 % (men) and 62 % (women) vs BMI +9 % and +19 %',
          referenceIds: ['schutz2002'],
        },
        {
          label: 'MRI skeletal muscle (n = 468, 18–88 y)',
          value: '33.0 kg men vs 21.0 kg women, 38.4 % vs 30.6 % of body mass',
          note: 'Relative muscle declines from the third decade, absolute muscle from the end of the fifth, mostly in the lower body.',
          referenceIds: ['janssen2000'],
        },
        {
          label: 'NHANES 2015–18 (secular trend)',
          value:
            'Mean waist 102.9 (men) and 98.4 cm (women); BMI 29.4 and 29.8; mid-upper-arm circumference 34.7 and 32.3 cm',
          note: 'The DXA reference is about 1.5–2 BMI units leaner than the present population (men aged 20–29: median BMI 26.5 in 2015–18 vs 24.9 implied by the DXA medians).',
          referenceIds: ['fryar2021'],
        },
        {
          label: 'Natural male bodybuilder at contest, case study',
          value: '14.8 → 4.5 → 14.6 % body fat',
          referenceIds: ['rossow2013'],
        },
        {
          label: 'Female fitness competitors, DXA',
          value: '22.7 → 12.6 % (fat 14.6 → 7.1 kg; 6 of 27 below 10 %); 15–20 % common after recovery',
          referenceIds: ['hulmi2016'],
        },
        {
          label: 'Competitive bodybuilders, four-compartment model',
          value: 'Men 11.8 ± 4.4 % (n = 17), FFMI 25.1 ± 1.8; women 19.7 ± 4.9 % (n = 10), FFMI 18.3 ± 1.4',
          referenceIds: ['graybeal2020'],
        },
        {
          label: 'Minimum for health',
          value: 'No accepted optimum for athletes; 12–14 % is suggested as a practical floor for women',
          referenceIds: ['sundgotborgen2013', 'hulmi2016'],
        },
      ],
      timeCourse:
        'Cross-sectional age curves used for initial expectations only. Population fat has drifted up by about 1.5–2 BMI units since 2000.',
      moderators: 'Sex, age and ethnicity.',
      grade: 'A',
      gradeReason:
        'The NHANES-based distributions come from more than 12,000 people, fitted with LMS curves and internally validated; use across ethnic groups is B and extrapolation of 1999–2004 percentiles to 2026 is C.',
      status: 'established',
      caveats:
        'Percentile labels should be dated: they compare you with adults of the 2000s. The essential-fat percentages (2–5 % men, 10–13 % women) are a textbook convention and unverified.',
      referenceIds: [
        'kelly2009',
        'schutz2002',
        'janssen2000',
        'fryar2021',
        'rossow2013',
        'hulmi2016',
        'graybeal2020',
        'sundgotborgen2013',
      ],
      relatedMetricIds: [],
    },
    {
      id: '14-lean-compartment-initial-state',
      title: 'Muscle, bone, water, glycogen and energy: the starting state',
      category: 'body',
      summary:
        'Fat-free mass is skeletal muscle plus bone mineral, organs and the water in them. Between people of the same height, differences are mostly muscle, while organ mass is nearly constant. Vitals splits fat-free mass into muscle and other tissue, then sets starting body water (73 % of fat-free mass), muscle and liver glycogen, and resting energy use from it. For a median man of 1.77 m, muscle is about 32.0 kg, 52 % of fat-free mass and 39 % of body mass.',
      howModelled:
        'Skeletal muscle is fat-free mass minus a non-muscle share that scales with height squared, plus a small correction for fat-free mass above the age-30 median. Bone mineral is a fixed fraction of fat-free mass that falls with age. Water is 0.73 times fat-free mass, and extracellular water is 38 % of it. Glycogen depends on muscle mass and habitual carbohydrate. Resting energy use is 370 + 21.6 kcal per kg of fat-free mass, times a physical activity level of 1.5 by default.',
      equation:
        'SM = FFM − Rn · h² − 0.1 · (FFM − FFMI0 · h²), with Rn = 9.4 (men) / 8.4 (women) and FFMI0 = 19.6 / 16.0\nBMC = f_bmc · FFM, with f_bmc = 0.045 · (1 − 0.001 · max(0, age − 40)) (men) and 0.051 · (1 − 0.0025 · max(0, age − 45)) (women)\nTBW = 0.73 · FFM; ECW = 0.38 · TBW\nRMR = 370 + 21.6 · FFM (kcal/d); TDEE0 = PAL · RMR, default PAL 1.5',
      keyNumbers: [
        {
          label: 'Alternative muscle route: SM = 1.19 · ALM − 1.65',
          value: 'R² .96, SEE 1.63 kg vs whole-body MRI (321 adults at Tanner stage 5)',
          note: 'ALM is appendicular lean mass. The equation reaches this paper through a secondary summary. The ratio ALMI/FFMI is .46 (men) and .43 (women) at 30 y, and .44 and .42 at 60 y.',
          referenceIds: ['kim2002'],
        },
        {
          label: 'Checks against MRI',
          value:
            'Median man (1.77 m): ALM 28.3, muscle 32.0 kg = 52 % of fat-free mass and 39 % of body mass; median woman (1.63 m): ALM 18.3, muscle 20.1 kg = 47 % and 31 % (MRI 38.4 % and 30.6 %)',
          referenceIds: ['kelly2009', 'janssen2000'],
        },
        {
          label: 'Anthropometric alternatives, if measurements are ever collected',
          value:
            'Lee 2000 (skinfold-corrected girths): R² .91, SEE 2.2 kg; mid-arm: AMA = (MAC − π · TSF)² / (4π) − 10 (men) or − 6.5 (women), SM = height_cm · (0.0264 + 0.0029 · AMA)',
          note: 'Typed as printed. The Lee equation comes from a search summary.',
          referenceIds: ['lee2000', 'heymsfield1982'],
        },
        {
          label: 'Regional muscle shares (arms / legs / trunk)',
          value: 'Men .115 / .56 / .325; women .105 / .58 / .315',
          note: 'Unverified, from typical DXA and MRI proportions. Regional muscularity sliders shift the shares by ±20 %.',
        },
        {
          label: 'Bone mineral',
          value:
            "Men 2755 g of 61.4 kg fat-free mass = 4.5 %; women 2177 g of 42.6 kg = 5.1 % at 30 y; women's bone falls 2198 → 1703 g from 40 to 80 y",
          note: 'A frame factor scales bone by 1 + z × 0.15 (men) or 0.13 (women).',
          referenceIds: ['kelly2009'],
        },
        {
          label: 'Height normalisation',
          value:
            'Weight, fat mass, fat-free mass and bone scale to height with powers of about 1.85–2.48, “frequently round to 2”',
          note: 'For comparing muscularity across heights: FFMI_norm = FFMI + 6.3 × (1.80 − h); the constant is 6.3, not 6.1.',
          referenceIds: ['heymsfield2011', 'kouri1995'],
        },
        {
          label: 'Body water',
          value:
            'Fat-free mass hydration “remarkably stable at approximately 0.73”; individual total-body-water error 3.3–5.0 L (RMSE, n = 1,695)',
          note: 'Cross-check with the Watson equations: men 2.447 − 0.09516 · age + 0.1074 · height_cm + 0.3362 · weight; women −2.097 + 0.1069 · height_cm + 0.2466 · weight. They come from secondary sources, and one source prints 0.09156, likely a typo.',
          referenceIds: ['watson1980', 'wang1999', 'chumlea2001'],
        },
        {
          label: 'Extracellular water share of body water',
          value:
            '0.38; BIA medians 0.373 / 0.378 / 0.390 in men aged 20–39 / 40–64 / ≥ 65 and 0.384 / 0.385 / 0.394 in women',
          note: 'Isotope-dilution values are higher (unverified).',
          referenceIds: ['hioka2026'],
        },
        {
          label: 'Muscle glycogen at rest (males with normal carbohydrate availability, VO₂max 53)',
          value:
            '462 ± 132 mmol/kg dry mass; high carbohydrate (≥ 6 g/kg/d for ≥ 3 d) +102; low or depleted −253; +67 per +10 mL/kg/min VO₂max',
          note: 'Converted to about 16 g/kg of muscle (proposed fit), × 0.45 when habitual carbohydrate is under 0.75 g/kg/d, × 1.22 when 5.5 g/kg/d or more. The dry-fraction of 0.23 is unverified.',
          referenceIds: ['areta2018'],
        },
        {
          label: 'Glycogen capacity',
          value:
            'About 15 g/kg body weight; about 500 g can be added before net de novo fat synthesis contributes (3 men)',
          note: 'Liver 90 g fed (unverified). Median man: 32 kg × 16 + 90 ≈ 600 g; median woman: 20 kg × 16 + 90 ≈ 410 g.',
          referenceIds: ['acheson1988'],
        },
        {
          label: 'Resting energy',
          value:
            'RMR = 370 + 21.6 × FFM (65–90 % of variance; fat adds nothing in non-obese people); athletes: RMR_kJ = 95.272 × FFM + 2026.161',
          referenceIds: ['cunningham1991', 'tenhaaf2014'],
        },
      ],
      timeCourse: 'Static initial values; they become dynamic states in other topics.',
      moderators:
        'Sex, age (FFMI peaks at about 50 y then declines), training (muscle share of fat-free mass rises) and ethnicity (Black FFMI is +0.7 in men and +1.9 in women at 30 y).',
      grade: 'B',
      gradeReason:
        'Muscle from DXA and MRI equations is A/B; the glycogen values and regional shares are C/D.',
      status: 'proposed-fit',
      caveats:
        'The regional shares, the muscle dry fraction and the liver glycogen value are unverified. Traditional frame-size charts were not validated, so the frame factor stays 0 unless a measured breadth is available.',
      referenceIds: [
        'kim2002',
        'kelly2009',
        'janssen2000',
        'lee2000',
        'heymsfield1982',
        'heymsfield2011',
        'kouri1995',
        'watson1980',
        'wang1999',
        'chumlea2001',
        'hioka2026',
        'areta2018',
        'acheson1988',
        'cunningham1991',
        'tenhaaf2014',
      ],
      relatedMetricIds: ['skeletalMuscle', 'leanMass'],
    },
    {
      id: '14-fat-depots-and-visceral-fat',
      title: 'Where fat is stored: belly, hips and visceral fat',
      category: 'body',
      summary:
        'Women store proportionally more fat gluteofemorally (hips and thighs), men more centrally. The central share and visceral fat (VAT, the fat around the organs in the abdomen) rise with age in both sexes, and VAT grows faster than total fat, with an exponent of about 1.3. Vitals splits fat mass into head, arms, legs, trunk under the skin and visceral fat, with a belly-versus-hips slider setting the trunk-to-limb ratio.',
      howModelled:
        "Head fat is 4.5 % of fat mass. The trunk-to-limb ratio comes from the survey's age and sex curve and the belly slider (a z-score of twice the slider). Trunk fat is split into visceral and subcutaneous parts using a visceral fraction that rises with fat mass (power 0.3), age and the trunk-to-limb ratio, with separate constants for men and women. Limbs are split into arms and legs by fixed shares.",
      equation:
        'head = 0.045 · FM\nR = LMS_trunkLimb(sex, age, z), z = 2 · s_b\ntrunk = (FM − head) · R / (1 + R); limbs = FM − head − trunk; arms = limbs · armShare (men 0.22, women 0.19); legs = limbs − arms\nVAT = trunk · vFrac; SAT_trunk = trunk − VAT\nvFrac = clamp( v0 · (FM / FMref)^0.3 · ageTerm · (R / Rref(sex, age))^0.5, 0.04, 0.60 )\nMen: v0 = 0.24, FMref = 20.5 kg, ageTerm = exp(0.018 · (age − 42))\nWomen: v0 = 0.13, FMref = 28.0 kg, ageTerm = exp(0.010 · (min(age, 48) − 48) + 0.030 · max(0, age − 48))',
      keyNumbers: [
        {
          label: 'VAT in MRI, Shen 2004: 121 men (41.9 y, BMI 26.0) and 198 women (48.1 y, BMI 27.0)',
          value: '2.7 ± 1.8 L and 1.7 ± 1.2 L, about 2.5 and 1.6 kg at 0.92 kg/L',
          note: "The constants were fitted to these means (men's fat mass 20.5 kg, women's 28.1 kg from CUN-BAE).",
          referenceIds: ['shen2004'],
        },
        {
          label: 'Whole-body MRI (n = 419): women BMI 24.5 (43 y) and men 25.1 (37 y)',
          value:
            'Median VAT 985 g of 21.9 kg adipose tissue (4.5 %) and 1679 g of 17.1 kg (9.8 %); VAT/SAT 4.8 % and 11.1 %',
          note: 'Model gives 0.89 kg and 1.44 kg (−10 % and −14 %).',
          referenceIds: ['scafoglieri2022'],
        },
        {
          label: 'UK Biobank MRI (n = 6021, age about 63): men BMI 26.8, women BMI 25.4',
          value:
            'VAT 4.62 L (IQR 3.25–6.38) and 2.33 L (1.46–3.51); abdominal SAT 5.50 and 7.50 L (VAT/ASAT .84 and .31)',
          note: 'Model gives 4.5 L (men) and 2.8 L (women).',
          referenceIds: ['linge2018'],
        },
        {
          label: 'Framingham CT slab volumes, age 52 (1,737 men, 1,611 women)',
          value: 'VAT 2,243 ± 1,023 and 1,365 ± 832 cm³; SAT 2,640 and 3,148 cm³',
          note: 'The men-to-women VAT ratio is 1.6 (model 1.7–2.0 at equal fat).',
          referenceIds: ['pou2009'],
        },
        {
          label: 'Sex and age',
          value:
            'At equal total fat, men have more VAT, and VAT rises more steeply with fat in men (constants v0 men/women = 1.85); with age VAT rises 2.6 times more in men than in premenopausal women, and postmenopausal women match men',
          note: 'Studied in 89 men and 75 women, and in 66 men and 96 women with BMI over 25 by whole-body CT.',
          referenceIds: ['lemieux1993', 'kotani1994'],
        },
        {
          label:
            'Menopause meta-analysis (201 cross-sectional studies, n ≈ 1.05 million; 11 longitudinal, n = 2,472)',
          value:
            'Post- vs pre-menopause: BMI +1.14, body fat % +2.88, waist +4.63 cm, hip +2.01 cm, WHR +0.04, VAT +26.9 cm² (CI 13–41), trunk fat % +5.49, leg fat % −3.19',
          note: 'The authors conclude the changes are predominantly due to age, with no additional influence of menopause.',
          referenceIds: ['ambikairajah2019'],
        },
        {
          label: '4-year longitudinal DXA and CT, 156 initially premenopausal women',
          value:
            'Only women who became postmenopausal gained VAT significantly; SAT rose in all; 24-h and sleeping energy expenditure fell more (−7.9 vs −5.3 %)',
          note: 'This conflicts with the meta-analysis on attribution.',
          referenceIds: ['lovejoy2008'],
        },
        {
          label:
            'Belly slider at fixed fat, man 40 y, 176 cm, 86 kg, fat mass 22.8 kg (z = −2 / −1 / 0 / +1 / +2)',
          value:
            'Trunk-to-limb ratio 0.77 / 0.96 / 1.18 / 1.44 / 1.74; VAT 1.81 / 2.29 / 2.82 / 3.39 / 4.00 kg; waist/hip 91/106 → 101/101 cm; WHR .86 → .99',
          note: 'Own calculation.',
        },
        {
          label:
            'Belly slider at fixed fat, woman 40 y, 164 cm, 70 kg, fat mass 26.1 kg (z = −2 / −1 / 0 / +1 / +2)',
          value:
            'Ratio 0.52 / 0.69 / 0.90 / 1.16 / 1.48; VAT 0.76 / 1.04 / 1.39 / 1.79 / 2.25 kg; waist/hip 81/107 → 96/99 cm; WHR .75 → .96',
          note: "Median WHR is .78 (women) and .87 (men) in the MRI cohort. z = ±2 spans the 2.3rd to 97.7th percentile of the survey's trunk-to-limb ratio.",
          referenceIds: ['scafoglieri2022', 'kelly2009'],
        },
        {
          label: 'Ethnic differences',
          value:
            'At the same BMI East Asians accumulate the most VAT and the least deep subcutaneous fat, and liver fat did not differ; White adults have more VAT than African-American adults at higher BMI or waist',
          note: 'Optional multipliers on the visceral fraction (unverified): East or South Asian ×1.25, Black ×0.85. Waist thresholds for a VAT area of 100 cm² differ: Japan 85 (men) and 90 (women) cm.',
          referenceIds: ['nazare2012', 'kuk2005', 'kelly2009', 'ross2020'],
        },
        {
          label: 'Published VAT equations (cross-checks)',
          value:
            'Samouda 2013 (253 adults, CT): women R² .836, men R² .803; So 2017 (Japanese men with waist > 85 cm, validation r = .74); Song 2022 (515 adults, DXA VAT from BMI, triglycerides, HDL and steatosis grade: R² .70–.74, validation r .87)',
          note: 'Worked check of the Samouda equations: a man with waist 96, thigh 58, age 40 gives a VAT area of 154 cm²; a woman with waist 86, thigh 57, age 40, BMI 26 gives 105 cm². None is adopted as primary.',
          referenceIds: ['samouda2013', 'so2017', 'song2022'],
        },
      ],
      timeCourse: 'Static at the start; the depots then change over time in the regional-allocation model.',
      moderators:
        'Sex, age (VAT share rises with age, and after about 48 y in women), the trunk-to-limb ratio, fat mass and ethnicity.',
      grade: 'C',
      gradeReason:
        'It rests on imaging cohorts (cross-sectional), and the age and level constants are fitted to a handful of means.',
      status: 'proposed-fit',
      caveats:
        'The menopause attribution is contested. The depot shares (head 4.5 %, arms 22 % or 19 % of limb fat) are unverified. VAT is not shown as a diagnosis: outputs are labelled “modelled”.',
      referenceIds: [
        'shen2004',
        'scafoglieri2022',
        'linge2018',
        'pou2009',
        'lemieux1993',
        'kotani1994',
        'ambikairajah2019',
        'lovejoy2008',
        'nazare2012',
        'kuk2005',
        'kelly2009',
        'ross2020',
        'samouda2013',
        'so2017',
        'song2022',
      ],
      relatedMetricIds: ['visceralFat', 'waist'],
    },
    {
      id: '14-regional-fat-allocation',
      title: 'Where fat is lost and gained first',
      category: 'body',
      summary:
        'In an energy deficit, visceral and trunk fat lose proportionally more than limb fat, and in overfeeding fat gain tilts towards the lower body. The tilt is modest, about 10–20 %, not an order. Visceral fat changes about 1.3 times as fast as total fat in proportion. After 2 years of about 12 % restriction, men lost 3.24 kg of trunk fat and women 2.81 kg.',
      howModelled:
        'Each day the fat change is shared across five depots (head, arms, legs, trunk under the skin, visceral) in proportion to how much fat each holds times a weight. In loss, visceral fat has the largest weight (1.30) and the limbs the smallest (0.84). In gain, legs get 1.15 and visceral fat 1.30. An optional local-training bias of up to 0.10 is off by default.',
      equation:
        'For each day with total fat change dFM: w_i = F_i · K_i; dF_i = dFM · w_i / Σ_j w_j; F_i = max(F_i + dF_i, 0)\nK_LOSS = { head 1.00, arms 0.84, legs 0.84, SAT 1.10, VAT 1.30 }\nK_GAIN = { head 1.00, arms 1.00, legs 1.15, SAT 0.95, VAT 1.30 }',
      keyNumbers: [
        {
          label: 'Visceral fat allometry, 37 studies (1,407 men and women)',
          value: 'dVAT/VAT = k · dFM/FM with k = 1.3 ± 0.1, R² .73, sex-independent',
          note: 'Includes bariatric surgery. The preference for visceral loss fades with cumulative loss: the log of the ratio of percent change in visceral to subcutaneous fat starts at about 0.3 and falls about 0.01 per kg of fat lost.',
          referenceIds: ['hallgreen2008', 'hall2008'],
        },
        {
          label:
            'Only weight loss predicted the visceral-to-subcutaneous change (61 studies, 98 cohort points)',
          value: 'r = −.29: preferential visceral loss with modest loss, attenuated with more',
          referenceIds: ['chaston2008'],
        },
        {
          label:
            'CALERIE-2: 218 non-obese adults (BMI 21.9–28), 25 % restriction (11.9 % achieved), 2 years, DXA',
          value:
            'Weight −7.6 kg, waist −6.2 cm, fat −5.4 kg, fat-free mass −2.0 kg; trunk fat −3.24 (men) and −2.81 (women) kg; limb fat −2.4 and −2.5 kg',
          note: 'Fat-free mass was 34 % (men) and 23 % (women) of weight lost, and men lost more trunk fat (p = .03). The trunk share of loss was 57 % and 53 % (model 58 % and 51 %).',
          referenceIds: ['das2017'],
        },
        {
          label: '180 overweight or obese adults, 22 weeks of diet plus exercise',
          value:
            'Trunk lost the most fat, then legs, then arms (per total fat lost); men lost the highest percentage from the trunk; limbs lost most in obese people',
          referenceIds: ['benito2017'],
        },
        {
          label: '33 obese men, about 10 % weight loss, whole-body MRI',
          value:
            'Visceral fat −35 %, subcutaneous fat −25 %; abdominal subcutaneous −27 % vs gluteal-femoral −20 % with exercise',
          note: 'Model (fat 33 → 25 kg): visceral −28 to −32 %, trunk subcutaneous −24 to −28 %, legs −19 to −22 %.',
          referenceIds: ['ross1996'],
        },
        {
          label: '27 women, 4-month contest diet (−11.9 % weight, fat −50 %)',
          value: 'Android fat −68 % (0.92 → 0.25 kg) for a total fat fall of 50 %; lean mass unchanged',
          note: 'The model gives trunk fat −57 % and visceral −62 % and under-predicts loss at extreme leanness.',
          referenceIds: ['hulmi2016'],
        },
        {
          label: '8 weeks of overfeeding, 28 adults (15 men)',
          value: 'Upper-body fat +1.9 kg, lower-body +1.6 kg',
          note: 'The model gives an upper share of 60 % (men) and 53 % (women) vs 54 % observed. The visceral weight of 1.3 in gain is unverified (assumed symmetric).',
          referenceIds: ['tchoukalova2010'],
        },
        {
          label: 'Fat-cell biology',
          value:
            "Abdominal fat cells have about 2 × the beta-adrenoceptor density and 4–5 × the noradrenaline-induced lipolysis of gluteal cells; gluteal cells' antilipolytic alpha-2 sensitivity is about 40 × higher in women",
          note: 'Lower-body fat expands by cell number (hyperplasia) in overfeeding and upper-body fat by cell size (r = .74). Adult fat-cell number is set in childhood and adolescence and does not fall after marked weight loss; about 10 % of cells turn over each year.',
          referenceIds: [
            'wahrenberg1989',
            'karpe2015',
            'manolopoulos2010',
            'karastergiou2012',
            'tchoukalova2010',
            'spalding2008',
          ],
        },
      ],
      timeCourse:
        'Visceral fat depletes faster than subcutaneous fat at the start of a large deficit, and the preference fades with cumulative loss. Regained fat returns to the same cells.',
      moderators:
        'Sex (baseline shares and trunk susceptibility), age, BMI (limbs lose more in obesity) and menopause (mostly an ageing effect).',
      grade: 'C',
      gradeReason:
        'The visceral-fat allometry is grade B (a meta-regression), the limb and trunk exponents and the gain allocation rest on 2–3 studies each (C), and the exact weights are D.',
      status: 'proposed-fit',
      caveats:
        'No separate redistribution after weight regain was modelled, which is an open question. Extreme-leanness android loss exceeds the model.',
      referenceIds: [
        'hallgreen2008',
        'hall2008',
        'chaston2008',
        'das2017',
        'benito2017',
        'ross1996',
        'hulmi2016',
        'tchoukalova2010',
        'wahrenberg1989',
        'karpe2015',
        'manolopoulos2010',
        'karastergiou2012',
        'spalding2008',
      ],
      relatedMetricIds: ['visceralFat', 'waist'],
    },
    {
      id: '14-spot-reduction',
      title: 'Can you lose fat from one place by training it?',
      category: 'body',
      summary:
        'The larger, better-measured trials say no. With MRI in 104 people, 12 weeks of arm training did not reduce fat locally, and calorie-matched trials of 11–24 people found no local loss either. Blood flow and fat breakdown are higher next to a contracting muscle, but the fat released is used elsewhere. A few small DXA or skinfold trials report local effects of a few percentage points that are within measurement noise or unreplicated.',
      howModelled:
        'The local-training bias is 0 by default. It can be raised to at most 0.10 as an exploratory option that is off by default and labelled grade C–D.',
      keyNumbers: [
        {
          label: '24 people, 6 weeks of abdominal exercise, calorie-matched',
          value: 'No effect on abdominal circumference, skinfolds or android fat',
          referenceIds: ['vispute2011'],
        },
        {
          label: '11 people, 12 weeks of one-leg high-volume training',
          value: 'Fat fell in the arms (−10.2 %) and trunk (−6.9 %) but not in the trained leg',
          referenceIds: ['ramirezcampillo2013'],
        },
        {
          label: '104 people (45 men), 12 weeks of one-arm resistance training, MRI plus skinfolds',
          value: 'Skinfolds suggested local loss in men, but MRI showed generalised loss',
          referenceIds: ['kostek2007'],
        },
        {
          label: '10 men, one-leg knee extension',
          value:
            'Blood flow in thigh fat (6.6 vs 3.9 mL/100 g/min at 25 % of maximal workload) and lipolysis (102 vs 55 nmol/100 g/min) were higher next to the contracting muscle',
          note: 'That is local fat breakdown, but not net local loss.',
          referenceIds: ['stallknecht2007'],
        },
        {
          label: '16 women, 8 weeks',
          value:
            'Upper-body resistance group: upper-limb fat −12.1 % vs lower limb −4.0 %; lower-body group −2.3 % vs −11.5 %',
          note: 'This supports a local effect.',
          referenceIds: ['scotto2017'],
        },
        {
          label: '14 people, 8 weeks of circuit training',
          value: 'Abdominal subcutaneous thickness fell more than with resistance training alone',
          referenceIds: ['paoli2021'],
        },
        {
          label: '16 overweight men (43 y), 10 weeks: abdominal exercise plus running vs running only',
          value: 'Trunk fat −1,170 g (7 %) vs no change; total fat −6 % vs −5 %',
          note: 'The authors conclude spot reduction exists. Weaknesses: 8 per arm, DXA trunk noise of the same order as the effect (SD about 1.1 kg), the control group lost more weight, and it was not replicated.',
          referenceIds: ['brobakken2023'],
        },
      ],
      timeCourse: 'Trials lasted 6–12 weeks.',
      moderators: 'Total fat loss and measurement method.',
      grade: 'B',
      gradeReason:
        'The null result is consistent in the largest trials, which used MRI and calorie-matched controls.',
      status: 'contested',
      caveats:
        'Three small trials (14–16 people) report local effects, one as recently as 2023. The conclusion is “unproven, at most a few percentage points”.',
      referenceIds: [
        'vispute2011',
        'ramirezcampillo2013',
        'kostek2007',
        'stallknecht2007',
        'scotto2017',
        'paoli2021',
        'brobakken2023',
      ],
      relatedMetricIds: [],
    },
    {
      id: '14-circumferences-from-state',
      title: 'From fat and muscle mass to tape-measure sizes',
      category: 'body',
      summary:
        'A body section is a lean core wrapped in fat. Adding fat area thickens the shell, and the circumference rises by 2π times the extra thickness. On this geometry each kg of trunk fat adds about 2.2 cm to a waist of 95 cm. On weight loss the waist falls about 17 % less than geometry predicts, because skin and the abdominal wall are slack. Across people, waist rises 2.6 cm (men) or 2.2 cm (women) per BMI unit, matching the 0.82 cm per kg of weight lost in CALERIE.',
      howModelled:
        'Each measured level (waist, hip, arm) treats fat mass as a shell of a certain length around a lean core that scales with fat-free mass. Waist reduction on loss is multiplied by 0.83. Other regions (chest, neck, thigh, calf) use height-proportional defaults that are unverified.',
      equation:
        'C_j = √(4π · (A_core_j + A_fat_j)); A_fat_j = F_j · KV · 1000 / L_j; KV = 1.28 L of adipose tissue per kg of DXA fat\nWaist: F = SAT_trunk + VAT, L = 38 cm, A_core = a_w · (FFMI0 · h² + κ · (FFM − FFMI0 · h²)) / h, a_w = 9.7 (men) / 8.65 (women) cm²·m/kg, κ = 0.5\nHip: F = 0.55 · legFat, L = 30 cm; Arm: F = armFat / 2, L = 48 (men) / 46 (women) cm\nLoss hysteresis (waist only): dC_loss = ψ · dC_geometric, ψ = 0.83\nMuscle change: dA = dSM_j · 1000 / (1.06 · L_m,j); dC = 2π · dA / C',
      keyNumbers: [
        {
          label: 'Waist per kg of trunk fat (dC/dF = 211.6 / C)',
          value:
            '2.65 cm (waist 80 cm), 2.23 (95), 1.92 (110), 1.63 (130); with ψ on loss 2.2 / 1.85 / 1.6 / 1.35',
          note: 'Equivalent per kg of body weight in CALERIE-like loss: 0.8–1.0 cm.',
        },
        {
          label: 'Waist by BMI and age, NHANES 2015–18 (fit; rmse 1.4 and 1.6 cm)',
          value:
            'Men WC = 24.81 + 2.612 · BMI + 0.179 · (age − 40); women WC = 30.46 + 2.235 · BMI + 0.113 · (age − 40)',
          note: 'Model rmse 1.4 (men) and 1.1 (women) cm, maximum 3.5 and 3.0.',
          referenceIds: ['fryar2021'],
        },
        {
          label: 'Independent age check (not fitted): waist at BMI 27, ages 25 → 65',
          value:
            'Men: population 92.6 → 99.8, model 93.5 → 99.3; women: population 89.1 → 93.6, model 89.1 → 94.2 cm',
          referenceIds: ['fryar2021'],
        },
        {
          label: 'CALERIE-2 within-person change',
          value:
            'Fat −5.4 kg, fat-free mass −2.0 kg, trunk fat −3.2 (men) and −2.8 (women) kg, waist −6.2 cm: 2.1 cm per kg trunk fat and 0.82 cm per kg weight',
          note: 'The geometric model predicts −7.6 (men) and −7.4 (women) cm, so ψ = 0.83 (proposed fit).',
          referenceIds: ['das2017'],
        },
        {
          label: 'Cross-sectional slope',
          value:
            '2.6 (men) and 2.2 (women) cm per BMI unit = 0.84 and 0.90 cm per kg for a person of 1.76 and 1.63 m',
          note: 'This equals the longitudinal 0.82 cm/kg, so one number serves both.',
          referenceIds: ['fryar2021', 'das2017'],
        },
        {
          label: 'Mid-upper-arm circumference by BMI and age (rmse 0.45 cm)',
          value:
            'Men 12.53 + 0.762 · BMI − 0.040 · (age − 40); women 11.25 + 0.712 · BMI − 0.014 · (age − 40)',
          note: 'Model rmse 0.45 (men) and 0.37 (women) cm.',
          referenceIds: ['fryar2021'],
        },
        {
          label: 'Hip (anchor only)',
          value:
            'MRI cohort WHR .87 (men) and .78 (women) with waist 87.6 and 78.0 cm → hip about 100.7 and 100 cm at BMI 25.1 and 24.5',
          referenceIds: ['scafoglieri2022'],
        },
        {
          label: 'Geometric law check with a device study',
          value:
            'Lateral-thigh fat layer −18 ± 5.5 mm (MRI), thigh circumference −2.3 cm mean; fat loss confined to about a quarter to a third of the perimeter → 6.3 × 1.8 × 0.25 = 2.8 cm',
          note: 'Consistent, although it is a device study, not exercise.',
          referenceIds: ['palm2023'],
        },
        {
          label: 'Lean, muscular sanity checks (unverified targets)',
          value:
            'Man 1.76 m, 80 kg, 11.5 % fat, belly z −0.5 → waist 79.9 cm; man 1.80 m, 95 kg, 9 % → 82.3 cm; woman 1.65 m, 62 kg, 16 % → 69.7 cm',
        },
        {
          label: 'Weight loss and waist reduction (110 women, BMI ≥ 25, 6-month diet)',
          value:
            '% weight loss = 0.85 × waist reduction (cm) − 2.09 (r = .79); 0.73 cm per 1 % weight loss (about 0.8 cm/kg at 85–95 kg)',
          note: 'The model gives 0.67–0.68 cm per 1 % (0.75 cm/kg) for a woman of 90 kg, 165 cm and 45 % fat, and 0.79 for a man of 100 kg and 33 % fat (tolerance ±20 %).',
          referenceIds: ['han1997'],
        },
        {
          label: 'Other regions (chest, neck, thigh, calf, bideltoid breadth)',
          value:
            'Height-proportional defaults at reference composition: neck .222 H (men) / .192 H (women); chest .555 H / bust .525 H; proximal thigh .31 H / .34 H; calf .207 H / .21 H; bideltoid .259 H',
          note: 'Unverified. No verified population regression exists for them here; an offline fit to a public military measurement dataset is recommended.',
        },
      ],
      timeCourse:
        'Circumferences follow tissue mass with no lag. Water and glycogen shifts change scale weight in days with negligible effect on circumferences.',
      moderators:
        'Sex and age (through the constants and depot shares) and muscularity (through κ). Ethnic body build is not modelled.',
      grade: 'B',
      gradeReason:
        'Waist and mid-arm are grade B (calibrated on nationally representative data, with independent age and CALERIE checks); hip is C and chest, thigh, calf and neck are D.',
      status: 'proposed-fit',
      caveats:
        'Whether visceral fat loss reduces waist less than subcutaneous loss is not modelled separately. The NHANES protocol measures at the iliac crest, and a navel-level waist can differ by several cm in obesity (unverified).',
      referenceIds: ['fryar2021', 'das2017', 'scafoglieri2022', 'palm2023', 'han1997'],
      relatedMetricIds: ['waist'],
    },
    {
      id: '14-training-status-ffmi',
      title: 'Muscle-gain potential from FFMI and training history',
      category: 'body',
      summary:
        "Comparing someone's fat-free mass index with what an untrained person of their build would have, and with a natural ceiling, indicates how much of their muscle-building potential is already used. Vitals uses a ceiling of 25.0 for men (the edge of a 1995 sample of 74 non-user athletes, which its authors called preliminary) and 20.6 for women (proposed; no dedicated natural-athlete study). The mapping is grade D.",
      howModelled:
        "The fraction of potential used is the gap between the observed and untrained-expected index, divided by the gap between the ceiling and untrained-expected index. Classes run from untrained to near ceiling. A consistency flag appears when the fraction is 0.30 above what the person's training years predict. The other topic (resistance training) owns the dynamics; this one supplies its inputs.",
      equation:
        'FFMI_norm = FFMI + 6.3 · (1.80 − h)\nFFMI_exp = BMI · (1 − (CUNBAE + offsetDXA + offsetEth) / 100)\nFFMI_lim = 25.0 (men) | 20.6 (women)\nfPot = clamp( (FFMI_norm − FFMI_exp) / (FFMI_lim − FFMI_exp), 0, 1 )\nexpected fPot(T) = dFFMI_train(T_eff) / (FFMI_lim − FFMI_exp)\nremaining potential dFFM_rem = (FFMI_lim − FFMI_norm) · h²  (kg of fat-free mass)',
      keyNumbers: [
        {
          label: 'Classes by fraction of potential used',
          value:
            '< .15 untrained or novice; .15–.40 novice-trained; .40–.70 intermediate; .70–.90 advanced; > .90 near ceiling',
        },
        {
          label: 'Ceiling for women',
          value: '20.6 (proposed: the same z, +2.13 SD above the age-30 NHANES median, 16.03 + 2.13 × 2.18)',
          referenceIds: ['kelly2009'],
        },
        {
          label: 'Anabolic-steroid non-users (74 athletes) vs users',
          value:
            'Non-users reached but did not exceed a normalised FFMI of 25.0 (pre-steroid-era Mr America mean 25.4); users exceeded 25 and some 30',
          referenceIds: ['kouri1995'],
        },
        {
          label: 'Competitive bodybuilders, four-compartment model',
          value: '25.1 ± 1.8 (men, n = 17) and 18.3 ± 1.4 (women, n = 10)',
          note: 'Drug status was not stated.',
          referenceIds: ['graybeal2020'],
        },
        {
          label: 'Women fitness competitors before dieting',
          value: '18.4 (DXA lean plus bone)',
          referenceIds: ['hulmi2016'],
        },
        {
          label: 'NHANES 95th percentile of FFMI at age 30',
          value: '24.9 (men) and 20.9 (women)',
          referenceIds: ['kelly2009'],
        },
        {
          label: 'First-year novice gain used in the prior',
          value: 'About +1.0 FFMI unit (about 3 kg) for men',
          note: 'Proposed, grade D.',
        },
        {
          label: 'Reconciliation with the resistance-training topic',
          value:
            'The two topics agree on the span from untrained to ceiling (5.1–5.4 FFMI units here for men vs 6.0 there) but not on speed: 6.0 × 0.37 implies +2.2 FFMI after one year, against +1.0 here',
          note: 'The smaller value is kept only as a prior shift inside the body-fat estimate (a conservative shift). The discrepancy between the two topics is flagged and not yet reconciled.',
        },
      ],
      timeCourse:
        "Static at the start. The fraction of potential used equals the resistance-training topic's training status at time 0 if that topic's initialisation is used.",
      moderators: 'Sex, height, body fat, and training years and quality.',
      grade: 'D',
      gradeReason:
        'The mapping uses two ceilings from small athlete samples and an expected-gain curve fitted to three anchor points; the ceiling of 25 in lean men alone is grade C.',
      status: 'proposed-fit',
      caveats:
        'The ceiling is a sample edge, not a physical law, and its authors called the result preliminary. There is no dedicated natural-athlete study for women.',
      referenceIds: ['kelly2009', 'kouri1995', 'graybeal2020', 'hulmi2016'],
      relatedMetricIds: ['trainingStatus'],
    },
    {
      id: '14-avatar-parameters',
      title: 'From body state to avatar shape',
      category: 'body',
      summary:
        'Vitals draws the body as its own parametric front-and-side silhouette whose widths follow the estimated circumferences. It needs no image assets and does not claim more detail than the state can support, since circumferences are predicted to about ±1–2 cm at best. The ratios and landmarks used for the outline are conventions, not measured values.',
      howModelled:
        'A circumference at each body level becomes an ellipse using a depth-to-width ratio (the waist ratio depends on circumference and visceral fat fraction). Outlines are smoothed with a monotone curve so no fake bumps appear. Appearance drivers (abdominal definition, vascularity, muscle definition, face fullness) are conventions based on body fat. The animation between start and end states interpolates the parameters.',
      equation:
        'k(ρ) = 3 · (1 + ρ) − √((3 + ρ) · (1 + 3ρ)); a = C / (π · k(ρ)); b = ρ · a\nρ_waist = clamp(0.66 + 0.005 · (C_w − 82) + 0.35 · (vFrac − vRef), 0.60, 0.92), with vRef 0.20 (men) / 0.10 (women); φ_waist = 0.58 + 0.10 · (vFrac − vRef)\nbideltoid = 0.259 · H + 0.29 · (MUAC − MUAC_ref)\nfatCover_trunk = smoothstep(BFeff, lo, hi), (lo, hi) = (10, 17) men | (17, 25) women\nvascularity = smoothstep(BFeff, 11, 15) men | (17, 22) women\nBFeff = BF + 6 · z_belly for the abdomen',
      keyNumbers: [
        {
          label: 'Waist depth-to-width ratio',
          value:
            '0.65–0.69 at BMI 23: caliper transverse 30.7 cm and sagittal 20.1 (women) / 21.3 (men) cm in 288 Chinese patients with type 2 diabetes',
          note: 'The ellipse formula gives a waist of 81–83 cm. The slope and the visceral term in the ratio are unverified.',
          referenceIds: ['li2024'],
        },
        {
          label: 'Depth-to-width ratio ρ by level',
          value: 'Neck, thigh, calf, upper arm 0.95; chest 0.70 (men) / 0.72 (women); hip 0.70',
          note: 'Proposed. The anchors for the neck, chest and hip are unverified.',
        },
        {
          label: 'Example half-widths (front width = 2a; depth 2b)',
          value:
            "Waist C 80, ρ .68 → a 15.0 (depth 20.4 cm); C 96, ρ .75 → 17.4 (26.1); C 120, ρ .85 → 20.6 (35.0); women's waist C 86, ρ .72 → 15.8 (22.8); women's hip C 106 → 19.5 (28.1); men's chest C 100, ρ .70 → 18.6 (26.0)",
        },
        {
          label: 'Landmark heights (fraction of stature, Drillis–Contini proportions, unverified)',
          value:
            'Head top 1.000; chin .870; neck .855; acromion .818; chest .720; waist .610; hip .520; crotch .470; mid-thigh .380; knee .285; calf .200; ankle .039; elbow .630; wrist .485',
        },
        {
          label: 'Calibrated avatars',
          value: 'Torso error 1.71 cm (men) and 1.59 cm (women) with fat and muscle as the two axes',
          referenceIds: ['maalin2021'],
        },
        {
          label: 'Trunk fat partition for the avatar extras',
          value:
            'Abdominal .55; chest .15 (men) or .25 (women, including breast); back and flank .30; sliders scale a share by 1 + 0.4 × slider',
          note: 'Grade D convention.',
        },
      ],
      timeCourse:
        'Morphing to the projected body interpolates the parameters between the start and end states, with the start silhouette shown as a ghost.',
      moderators: 'The estimated circumferences, sex and visceral fat fraction.',
      grade: 'D',
      gradeReason:
        'This is a design: the ellipse mathematics is verified, but the ratios and landmarks are flagged unverified and only the circumference model is calibrated.',
      status: 'proposed-fit',
      caveats:
        'Visual avatars can stress people with body-image disorders, so the sliders are optional and the avatar is described as modelled, not a diagnosis. A more detailed 3D mesh would over-claim what the state can predict.',
      referenceIds: ['li2024', 'maalin2021'],
      relatedMetricIds: [],
    },
    {
      id: '14-body-composition-uncertainty',
      title: 'How uncertain is the starting body?',
      category: 'body',
      summary:
        'The realistic total uncertainty in body fat is ±4–6 %BF (1 SD), and ±6–10 for athletes, lean people or Asian adults without adjustment. Its consequences differ by outcome: a ±5 %BF error changes 12-week absolute fat loss by only about 0.2 kg, but changes fat-free-mass loss by ±0.75 kg (27 %), weight loss by ±0.8 kg, maintenance energy by about ±150 kcal a day (±5 %) and any percent-of-fat metric by ±5 percentage points.',
      howModelled:
        "Body fat is drawn from a truncated normal around the estimate; 16–32 Latin-hypercube samples per candidate plan feed the Planner's robust objectives and the 10–90 % bands. Absolute kg outcomes are shown with narrow bands, and fat-free mass, FFMI and percent-fat outcomes with wide bands.",
      keyNumbers: [
        {
          label: 'Sources of error (1 SD, %BF)',
          value:
            'BMI + age + sex equation 4.2–4.7; with waist (RFM) 3.1–3.6 in NHANES (4.0 used externally); visual slider 5.5; 3D scan ceiling 2.4 kg fat (about 3 %BF); reference-method frame ±2–3',
          referenceIds: [
            'gomezambrosi2012',
            'woolcott2018',
            'guzmanleon2019',
            'ng2016',
            'alexi2018',
            'groves2019',
            'potter2022',
          ],
        },
        {
          label: 'Fusion output',
          value:
            '3.3–3.8 with visual estimate and waist; 4.2–4.7 otherwise; 4.3 for muscular people with history',
        },
        {
          label: 'Realistic total including model misspecification',
          value: '±4–6 %BF (1 SD); athletes, lean people and Asian adults without adjustment ±6–10',
        },
        {
          label: 'Other state errors',
          value:
            'Fat-free mass inherits σ_BF/100 × weight (±3.3 kg per 4 %BF at 82 kg); muscle ±2–3 kg; visceral fat ±30–40 %; waist if not supplied SD about 5.5 (men) and 6.5 (women) cm; supplied waist 0.5–1 cm',
          note: "The model's visceral fat is 10–14 % low against medians, while population SDs are 46–70 % of the mean. The unsupplied-waist figure is unverified.",
          referenceIds: ['shen2004', 'pou2009'],
        },
        {
          label: 'Self-reported height and weight',
          value: 'σ_W = 2 kg and σ_h = 1.5 cm (proposed)',
          note: 'Height is over-reported and weight under-reported on average, with large individual SD.',
          referenceIds: ['connor2007', 'flegal2019'],
        },
        {
          label: '12-week deficit at 75 % of maintenance, man 90 kg, 1.78 m (fat 20 / 25 / 30 %)',
          value:
            'Maintenance 2,984 / 2,833 / 2,683 kcal; fat −5.4 / −5.4 / −5.2 kg; fat-free mass −3.7 / −2.8 / −2.2 kg; weight −9.1 / −8.2 / −7.5 kg; fat-free share of loss 41 / 35 / 30 %; fat change −30 / −24 / −19 % of initial fat',
          note: 'Own calculation with the Forbes partition dFFM/dBW = 10.4/(10.4 + FM), lean and fat energy densities implied by the body-weight topic, Cunningham resting metabolic rate and PAL 1.55.',
          referenceIds: ['cunningham1991', 'hall2011', 'thomas2011', 'forbes1987'],
        },
        {
          label: 'Same deficit, woman 68 kg, 1.65 m (fat 28 / 33 / 38 %)',
          value:
            'Maintenance 2,213 / 2,099 / 1,985 kcal; fat −4.1 / −4.0 / −3.9 kg; fat-free mass −2.5 / −2.0 / −1.7 kg; weight −6.6 / −6.0 / −5.5 kg; fat-free share 38 / 34 / 30 %; fat change −21 / −18 / −15 %',
          referenceIds: ['cunningham1991', 'hall2011', 'forbes1987'],
        },
        {
          label: '+10 % surplus, man 90 kg, sedentary partition (fat 20 / 25 / 30 %)',
          value: 'Fat +2.24 / +2.20 / +2.13 kg; fat-free mass +1.22 / +0.97 / +0.79 kg',
        },
      ],
      timeCourse: 'Uncertainty is set at the start and propagates through the projection.',
      moderators: 'Which optional inputs were entered, athlete and lean flags, and ethnicity.',
      grade: 'B',
      gradeReason:
        'The sensitivity magnitudes are a deterministic consequence of published partition rules (B); the input spreads themselves are C.',
      status: 'proposed-fit',
      caveats:
        'The partition rule and energy densities are owned by the body-weight topic. Reporting outcomes as kg with narrow bands and percent-fat outcomes with wide bands follows from these sensitivities.',
      referenceIds: [
        'gomezambrosi2012',
        'woolcott2018',
        'guzmanleon2019',
        'ng2016',
        'alexi2018',
        'groves2019',
        'potter2022',
        'shen2004',
        'pou2009',
        'connor2007',
        'flegal2019',
        'cunningham1991',
        'hall2011',
        'thomas2011',
        'forbes1987',
      ],
      relatedMetricIds: ['bodyFatPct', 'fatMass'],
    },
  ],
  myths: [
    {
      id: '14-myth-spot-reduction',
      claim: 'Spot reduction works if you train the area.',
      verdict: 'unproven',
      explanation:
        'The largest MRI trial (n = 104) and the calorie-matched trials (n = 11–24) were null. Local fat breakdown is real but is not net local loss. Three small DXA or skinfold trials (n = 14–16) report local effects, one in 2023, so at most a few percentage points are possible.',
      referenceIds: [
        'kostek2007',
        'vispute2011',
        'ramirezcampillo2013',
        'stallknecht2007',
        'scotto2017',
        'paoli2021',
        'brobakken2023',
      ],
    },
    {
      id: '14-myth-first-on-last-off',
      claim: 'First on, last off: fat leaves the places it arrived last.',
      verdict: 'oversimplified',
      explanation:
        'It is partly true, modestly. Visceral and trunk fat lose relatively more (visceral k = 1.3; trunk-to-limb susceptibility ×1.3) and gain goes slightly more to the legs (1.15 vs 0.84 for loss). It is a tilt of about 10–20 %, not an order.',
      referenceIds: [
        'hallgreen2008',
        'hall2008',
        'chaston2008',
        'das2017',
        'benito2017',
        'ross1996',
        'tchoukalova2010',
      ],
    },
    {
      id: '14-myth-bmi-tells-body-fat',
      claim: 'BMI tells you how much body fat you have.',
      verdict: 'oversimplified',
      explanation:
        "BMI of 30 or more had a sensitivity of 36 % (men) and 49 % (women) for obesity defined by body fat in NHANES III. Athletes' BMI cut-offs were 1.4–7.6 units higher, and RFM and CUN-BAE over-estimate lean and muscular people by about 3–15 points.",
      referenceIds: ['romerocorral2008', 'ode2007', 'vinknes2017', 'woolcott2018'],
    },
    {
      id: '14-myth-menopause-belly-fat',
      claim: 'Menopause itself causes belly fat.',
      verdict: 'unproven',
      explanation:
        'A meta-analysis of 201 cross-sectional and 11 longitudinal studies attributed the changes mainly to age, with no additional menopause effect. A longitudinal DXA and CT study (n = 156) saw visceral fat gain only in women who became postmenopausal. So it is contested, and the model uses an age slope that steepens after 48.',
      referenceIds: ['ambikairajah2019', 'lovejoy2008'],
    },
    {
      id: '14-myth-visual-charts-accurate',
      claim: 'Visual body-fat charts and silhouettes are accurate.',
      verdict: 'not-supported',
      explanation:
        'Silhouette numbers correlate about .76–.80 with BMI, anthropometry and DXA explain under 5 % (women) to 22 % (men) of perception error, muscularity confounds estimates by 5–7 BMI units, and the somatomorphic matrix showed poor test-retest for some scores.',
      referenceIds: ['parzer2021', 'cabral2024', 'groves2019', 'cafri2004'],
    },
    {
      id: '14-myth-ffmi-25-exactly',
      claim: 'The natural limit of fat-free mass index is exactly 25.',
      verdict: 'not-supported',
      explanation:
        'It is the edge of a 1995 sample of 74 non-user athletes, described as preliminary. The 95th percentile of NHANES FFMI at 30 years is 24.9 but includes heavier people. The resistance-training topic cites data with 26.4 % of 235 college football players above 25 (not re-checked here).',
      referenceIds: ['kouri1995', 'kelly2009'],
    },
    {
      id: '14-myth-fat-cell-number',
      claim: 'You cannot change your fat-cell number.',
      verdict: 'oversimplified',
      explanation:
        'Adult fat-cell number is stable across weight change, but about 10 % of cells are replaced each year, and lower-body cell number grew (hyperplasia) with 8 weeks of overfeeding in 28 adults.',
      referenceIds: ['spalding2008', 'tchoukalova2010'],
    },
    {
      id: '14-myth-waist-scales-same-both-ways',
      claim: 'Waist size scales the same way for gain and loss.',
      verdict: 'oversimplified',
      explanation:
        'The cross-sectional slope of 0.84–0.9 cm per kg equals the slope seen in weight loss only after applying a laxity factor of 0.83 to the geometric prediction.',
      referenceIds: ['das2017', 'fryar2021'],
    },
  ],
  openQuestions: [
    'How big is the error of the visual sliders? The 5.5 %BF spread, the slider-to-FFMI spread of 1.6 and the error correlations (0.6, 0.3, 0.2) are proposed, and no dataset of avatar picks against DXA exists. An opt-in dataset should be collected to refit them.',
    "How does lifting history change the body-fat estimate, and what is the ceiling for women? The training-offset curve (3.6 and 2.5 kg/m², 3 years) and the women's ceiling of 20.6 are grade D, resting on one 1995 male sample and two athlete cohorts.",
    'How should the DXA-frame gap be handled? NHANES DXA medians exceed densitometry equations by 3–4 points in the young, and the offsets are an empirical patch. The Black-adult offset has opposite signs in DXA and in the water-dilution and four-compartment literature.',
    'How good is the visceral fat model? It is fitted to about six means or medians from populations of different ages, no age-specific VAT distribution was available, and menopause attribution is unresolved.',
    'What are the true depot shares? Head 4.5 %, arms 22 % and 19 % of limb fat, the regional muscle shares, the leg share of hip fat (55 %) and all chest, thigh, calf and neck constants are unverified. An offline calibration on a public measurement dataset plus a DXA-labelled scan set would replace them.',
    'Is the loss-and-gain asymmetry right? The K tables, the visceral exponent during gain and any redistribution after weight regain are weakly supported, and android fat loss at extreme leanness exceeds the model.',
    'Does the waist protocol matter? The waist model uses the NHANES iliac-crest protocol, and a navel-level waist can differ by several cm in obesity (unverified).',
    'How well are other groups handled? South Asian and Black phenotypes, sarcopenic obesity and adults over 65 are handled only through offsets and the survey medians.',
    'How dated is the reference? The NHANES 1999–2004 reference is a generation old, and present-day fat mass index is higher, so percentile labels should be dated.',
    'Could a full 3D avatar be built? It would need joint scan-and-composition data that are not openly available, so the SVG version avoids it.',
    "Several sources were not opened: Gallagher's tables with ethnic terms, a regional-muscle table from Janssen 2000, the original men's SEE from the Navy formula, the Framingham age-percentile supplement, and some full texts that were blocked.",
  ],
  references: [
    {
      id: 'deurenberg1991',
      authors: 'Deurenberg P, Weststrate JA, Seidell JC.',
      year: 1991,
      title: 'Body mass index as a measure of body fatness: age- and sex-specific prediction formulas',
      journal: 'Br J Nutr',
      pmid: '2043597',
      doi: '10.1079/bjn19910073',
      verification: 'abstract',
    },
    {
      id: 'deurenberg1998',
      authors: 'Deurenberg P, Yap M, van Staveren WA.',
      year: 1998,
      title: 'Body mass index and percent body fat: a meta-analysis among different ethnic groups',
      journal: 'Int J Obes',
      pmid: '9877251',
      doi: '10.1038/sj.ijo.0800741',
      verification: 'abstract',
    },
    {
      id: 'deurenberg2002',
      authors: 'Deurenberg P, Deurenberg-Yap M, Guricci S.',
      year: 2002,
      title:
        'Asians are different from Caucasians and from each other in their BMI/body fat per cent relationship',
      journal: 'Obes Rev',
      pmid: '12164465',
      verification: 'abstract',
    },
    {
      id: 'deurenbergyap2000',
      authors: 'Deurenberg-Yap M, Schmidt G, van Staveren WA, Deurenberg P.',
      year: 2000,
      title:
        'The paradox of low BMI and high body fat percentage among Chinese, Malays and Indians in Singapore',
      journal: 'Int J Obes',
      pmid: '10951540',
      verification: 'abstract',
    },
    {
      id: 'gallagher2000',
      authors: 'Gallagher D, Heymsfield SB, Heo M, et al.',
      year: 2000,
      title: 'Healthy percentage body fat ranges: an approach for developing guidelines based on BMI',
      journal: 'Am J Clin Nutr',
      pmid: '10966886',
      doi: '10.1093/ajcn/72.3.694',
      verification: 'abstract',
    },
    {
      id: 'gomezambrosi2012',
      authors: 'Gomez-Ambrosi J, Silva C, Catalan V, et al.',
      year: 2012,
      title: 'Clinical usefulness of a new equation for estimating body fat (CUN-BAE)',
      journal: 'Diabetes Care',
      pmid: '22179957',
      doi: '10.2337/dc11-1334',
    },
    {
      id: 'vinknes2017',
      authors: 'Vinknes KJ, Nurk E, Tell GS, et al.',
      year: 2017,
      title:
        'The relation of CUN-BAE index and BMI with body fat, cardiovascular events and diabetes during a 6-year follow-up: the Hordaland Health Study',
      journal: 'Clin Epidemiol',
      pmid: '29184445',
      doi: '10.2147/CLEP.S145130',
    },
    {
      id: 'woolcott2018',
      authors: 'Woolcott OO, Bergman RN.',
      year: 2018,
      title:
        'Relative fat mass (RFM) as a new estimator of whole-body fat percentage - a cross-sectional study in American adult individuals',
      journal: 'Sci Rep',
      pmid: '30030479',
      doi: '10.1038/s41598-018-29362-1',
      verification: 'full-text',
    },
    {
      id: 'guzmanleon2019',
      authors: 'Guzman-Leon AE, Velarde AG, Vidal-Salas M, et al.',
      year: 2019,
      title: 'External validation of the relative fat mass (RFM) index in adults from north-west Mexico',
      journal: 'PLoS One',
      pmid: '31891616',
      verification: 'abstract',
    },
    {
      id: 'hodgdon1984',
      authors: 'Hodgdon JA, Beckett MB.',
      year: 1984,
      title: 'Prediction of percent body fat for U.S. Navy men/women from body circumferences and height',
      journal: 'Naval Health Research Center reports',
      verification: 'unverified',
    },
    {
      id: 'potter2022',
      authors: 'Potter AW, Tharion WJ, Holden LD, et al.',
      year: 2022,
      title:
        'Circumference-based predictions of body fat revisited: preliminary results from a US Marine Corps body composition survey',
      journal: 'Front Physiol',
      pmid: '35432005',
      verification: 'abstract',
    },
    {
      id: 'jackson1978',
      authors: 'Jackson AS, Pollock ML.',
      year: 1978,
      title: 'Generalized equations for predicting body density of men',
      journal: 'Br J Nutr',
      pmid: '718832',
      doi: '10.1079/bjn19780152',
      verification: 'unverified',
    },
    {
      id: 'jackson1980',
      authors: 'Jackson AS, Pollock ML, Ward A.',
      year: 1980,
      title: 'Generalized equations for predicting body density of women',
      journal: 'Med Sci Sports Exerc',
      pmid: '7402053',
      verification: 'unverified',
    },
    {
      id: 'siri1993',
      authors: 'Siri WE.',
      year: 1993,
      title: 'Body composition from fluid spaces and density: analysis of methods',
      journal: 'Nutrition',
      pmid: '8286893',
    },
    {
      id: 'romerocorral2008',
      authors: 'Romero-Corral A, Somers VK, Sierra-Johnson J, et al.',
      year: 2008,
      title: 'Accuracy of body mass index in diagnosing obesity in the adult general population',
      journal: 'Int J Obes',
      pmid: '18283284',
      verification: 'abstract',
    },
    {
      id: 'ode2007',
      authors: 'Ode JJ, Pivarnik JM, Reeves MJ, Knous JL.',
      year: 2007,
      title: 'Body mass index as a predictor of percent fat in college athletes and nonathletes',
      journal: 'Med Sci Sports Exerc',
      pmid: '17473765',
      verification: 'abstract',
    },
    {
      id: 'heymsfield2009',
      authors: 'Heymsfield SB, Scherzer R, Pietrobelli A, Lewis CE, Grunfeld C.',
      year: 2009,
      title:
        'Body mass index as a phenotypic expression of adiposity: quantitative contribution of muscularity',
      journal: 'Int J Obes',
      pmid: '19773739',
      verification: 'abstract',
    },
    {
      id: 'heymsfield2011',
      authors: 'Heymsfield SB, Heo M, Thomas D, Pietrobelli A.',
      year: 2011,
      title: 'Scaling of body composition to height: relevance to height-normalized indexes',
      journal: 'Am J Clin Nutr',
      pmid: '21248190',
      verification: 'abstract',
    },
    {
      id: 'parzer2021',
      authors: 'Parzer V, Sjoholm K, Brix JM, et al.',
      year: 2021,
      title: 'Development of a BMI-assigned Stunkard scale ... SOS reference study',
      journal: 'Obes Facts',
      pmid: '34284407',
      doi: '10.1159/000516991',
      verification: 'abstract',
    },
    {
      id: 'bulik2001',
      authors: 'Bulik CM, Wade TD, Heath AC, Martin NG, Stunkard AJ, Eaves LJ.',
      year: 2001,
      title: 'Relating body mass index to figural stimuli: population-based normative data for Caucasians',
      journal: 'Int J Obes',
      pmid: '11673775',
      doi: '10.1038/sj.ijo.0801742',
      verification: 'abstract',
    },
    {
      id: 'cabral2024',
      authors: 'Cabral MC, Coelho GMO, Oliveira N, et al.',
      year: 2024,
      title:
        'Association of body image perception and (dis)satisfaction with adiposity in adults: the Pro-Saude study',
      journal: 'PLoS One',
      pmid: '38857269',
      verification: 'abstract',
    },
    {
      id: 'groves2019',
      authors: 'Groves V, Cornelissen P, McCarty K, et al.',
      year: 2019,
      title:
        "How does variation in the body composition of both stimuli and participant modulate self-estimates of men's body size?",
      journal: 'Front Psychiatry',
      pmid: '31649565',
      verification: 'full-text',
    },
    {
      id: 'groves2023',
      authors: 'Groves V, Ridley BJ, Cornelissen PL, et al.',
      year: 2023,
      title:
        "Men's perception of current and ideal body composition and the influence of media internalization on body judgments",
      journal: 'Front Psychol',
      pmid: '37205060',
      verification: 'abstract',
    },
    {
      id: 'maalin2021',
      authors: 'Maalin N, Mohamed S, Kramer RSS, Cornelissen PL, Martin D, Tovee MJ.',
      year: 2021,
      title:
        'Beyond BMI for self-estimates of body size and shape: a new method for developing stimuli correctly calibrated for body composition',
      journal: 'Behav Res Methods',
      pmid: '33051818',
      verification: 'full-text',
    },
    {
      id: 'alexi2018',
      authors: 'Alexi J, Cleary D, Dommisse K, et al.',
      year: 2018,
      title: 'Past visual experiences weigh in on body size estimation',
      journal: 'Sci Rep',
      pmid: '29317693',
      verification: 'abstract',
    },
    {
      id: 'cafri2004',
      authors: 'Cafri G, Roehrig M, Thompson JK.',
      year: 2004,
      title: 'Reliability assessment of the somatomorphic matrix',
      journal: 'Int J Eat Disord',
      pmid: '15101075',
      verification: 'abstract',
    },
    {
      id: 'kagawa2006',
      authors: 'Kagawa M, Kerr D, Dhaliwal S, Hills AP, Binns CW.',
      year: 2006,
      title:
        'Applicability of the Somatomorphic Matrix computer program in Japanese and Australian Caucasian males in relation to measured body composition',
      journal: 'Body Image',
      pmid: '18089242',
      verification: 'abstract',
    },
    {
      id: 'ralphnearman2018',
      authors: 'Ralph-Nearman C, Filik R.',
      year: 2018,
      title: 'New body scales reveal body dissatisfaction, thin-ideal, and muscularity-ideal in males',
      journal: 'Am J Mens Health',
      pmid: '29557236',
      verification: 'full-text',
    },
    {
      id: 'ng2016',
      authors: 'Ng BK, Hinton BJ, Fan B, Kanaya AM, Shepherd JA.',
      year: 2016,
      title: 'Clinical anthropometrics and body composition from 3D whole-body surface scans',
      journal: 'Eur J Clin Nutr',
      pmid: '27329614',
    },
    {
      id: 'heymsfield2018',
      authors: 'Heymsfield SB et al.',
      year: 2018,
      title: 'Digital anthropometry: a critical review',
      journal: 'Eur J Clin Nutr',
      pmid: '29748657',
    },
    {
      id: 'tinsley2020',
      authors: 'Tinsley GM et al.',
      year: 2020,
      title: 'Digital anthropometry via 3D optical scanning: evaluation of four commercial systems',
      journal: 'Eur J Clin Nutr',
      pmid: '31685968',
    },
    {
      id: 'lennie2026',
      authors: 'Lennie SC, Hall A, Nguyen G, et al.',
      year: 2026,
      title: 'Subjective evaluation of female adult body fat distribution: a scoping review',
      journal: 'Obes Rev',
      pmid: '41401969',
      doi: '10.1111/obr.70068',
      verification: 'abstract',
    },
    {
      id: 'kelly2009',
      authors: 'Kelly TL, Wilson KE, Heymsfield SB.',
      year: 2009,
      title: 'Dual energy X-ray absorptiometry body composition reference values from NHANES',
      journal: 'PLoS One',
      pmid: '19753111',
      doi: '10.1371/journal.pone.0007038',
      verification: 'full-text',
    },
    {
      id: 'schutz2002',
      authors: 'Schutz Y, Kyle UU, Pichard C.',
      year: 2002,
      title: 'Fat-free mass index and fat mass index percentiles in Caucasians aged 18-98 y',
      journal: 'Int J Obes',
      pmid: '12080449',
      doi: '10.1038/sj.ijo.0802037',
      verification: 'abstract',
    },
    {
      id: 'janssen2000',
      authors: 'Janssen I, Heymsfield SB, Wang ZM, Ross R.',
      year: 2000,
      title: 'Skeletal muscle mass and distribution in 468 men and women aged 18-88 yr',
      journal: 'J Appl Physiol',
      pmid: '10904038',
      doi: '10.1152/jappl.2000.89.1.81',
      verification: 'abstract',
    },
    {
      id: 'kim2002',
      authors: 'Kim J, Wang Z, Heymsfield SB, Baumgartner RN, Gallagher D.',
      year: 2002,
      title: 'Total-body skeletal muscle mass: estimation by a new DXA method',
      journal: 'Am J Clin Nutr',
      pmid: '12145010',
      verification: 'abstract',
    },
    {
      id: 'lee2000',
      authors: 'Lee RC, Wang Z, Heo M, Ross R, Janssen I, Heymsfield SB.',
      year: 2000,
      title:
        'Total-body skeletal muscle mass: development and cross-validation of anthropometric prediction models',
      journal: 'Am J Clin Nutr',
      pmid: '10966902',
      verification: 'unverified',
    },
    {
      id: 'heymsfield1982',
      authors: 'Heymsfield SB, McManus C, Smith J, Stevens V, Nixon DW.',
      year: 1982,
      title:
        'Anthropometric measurement of muscle mass: revised equations for calculating bone-free arm muscle area',
      journal: 'Am J Clin Nutr',
      pmid: '7124671',
      verification: 'abstract',
    },
    {
      id: 'kouri1995',
      authors: 'Kouri EM, Pope HG Jr, Katz DL, Oliva P.',
      year: 1995,
      title: 'Fat-free mass index in users and nonusers of anabolic-androgenic steroids',
      journal: 'Clin J Sport Med',
      pmid: '7496846',
      verification: 'abstract',
    },
    {
      id: 'graybeal2020',
      authors: 'Graybeal AJ, Moore ML, Cruz MR, Tinsley GM.',
      year: 2020,
      title:
        'Body composition assessment in male and female bodybuilders: a 4-compartment model comparison of DXA and impedance-based devices',
      journal: 'J Strength Cond Res',
      pmid: '30161092',
      verification: 'abstract',
    },
    {
      id: 'hulmi2016',
      authors: 'Hulmi JJ, Isola V, Suonpaa M, et al.',
      year: 2016,
      title:
        'The effects of intensive weight reduction on body composition and serum hormones in female fitness competitors',
      journal: 'Front Physiol',
      pmid: '28119632',
      verification: 'full-text',
    },
    {
      id: 'rossow2013',
      authors: 'Rossow LM, Fukuda DH, Fahs CA, Loenneke JP, Stout JR.',
      year: 2013,
      title: 'Natural bodybuilding competition preparation and recovery: a 12-month case study',
      journal: 'Int J Sports Physiol Perform',
      pmid: '23412685',
      verification: 'abstract',
    },
    {
      id: 'sundgotborgen2013',
      authors: 'Sundgot-Borgen J, Meyer NL, Lohman TG, et al.',
      year: 2013,
      title:
        'How to minimise the health risks to athletes who compete in weight-sensitive sports: review and position statement on behalf of the IOC Medical Commission',
      journal: 'Br J Sports Med',
      pmid: '24115480',
      verification: 'abstract',
    },
    {
      id: 'fryar2021',
      authors: 'Fryar CD, Carroll MD, Gu Q, Afful J, Ogden CL.',
      year: 2021,
      title: 'Anthropometric reference data for children and adults: United States, 2015-2018',
      journal: 'Vital Health Stat 3(46)',
      pmid: '33541517',
    },
    {
      id: 'shen2004',
      authors: 'Shen W, Punyanitya M, Wang Z, et al.',
      year: 2004,
      title: 'Visceral adipose tissue: relations between single-slice areas and total volume',
      journal: 'Am J Clin Nutr',
      pmid: '15277145',
      verification: 'abstract',
    },
    {
      id: 'scafoglieri2022',
      authors: 'Scafoglieri A, Van den Broeck J, Cattrysse E, Bautmans I, Heymsfield SB.',
      year: 2022,
      title:
        'Non-linear associations between visceral adipose tissue distribution and anthropometry-based estimates of visceral adiposity',
      journal: 'Front Nutr',
      pmid: '35399665',
      verification: 'full-text',
    },
    {
      id: 'linge2018',
      authors: 'Linge J, Borga M, West J, et al.',
      year: 2018,
      title: 'Body composition profiling in the UK Biobank Imaging Study',
      journal: 'Obesity',
      pmid: '29785727',
      verification: 'full-text',
    },
    {
      id: 'pou2009',
      authors: 'Pou KM, Massaro JM, Hoffmann U, et al.',
      year: 2009,
      title: 'Patterns of abdominal fat distribution: the Framingham Heart Study',
      journal: 'Diabetes Care',
      pmid: '19074995',
      verification: 'full-text',
    },
    {
      id: 'kuk2005',
      authors: 'Kuk JL, Lee S, Heymsfield SB, Ross R.',
      year: 2005,
      title: 'Waist circumference and abdominal adipose tissue distribution: influence of age and sex',
      journal: 'Am J Clin Nutr',
      pmid: '15941883',
      verification: 'abstract',
    },
    {
      id: 'nazare2012',
      authors: 'Nazare JA et al.',
      year: 2012,
      title:
        'Ethnic influences on the relations between abdominal subcutaneous and visceral adiposity, liver fat, and cardiometabolic risk profile: INSPIRE ME IAA',
      journal: 'Am J Clin Nutr',
      pmid: '22932278',
      verification: 'abstract',
    },
    {
      id: 'lemieux1993',
      authors: 'Lemieux S et al.',
      year: 1993,
      title: 'Sex differences in the relation of visceral adipose tissue accumulation to total body fatness',
      journal: 'Am J Clin Nutr',
      pmid: '8379501',
      verification: 'abstract',
    },
    {
      id: 'kotani1994',
      authors: 'Kotani K et al.',
      year: 1994,
      title: 'Sexual dimorphism of age-related changes in whole-body fat distribution in the obese',
      journal: 'Int J Obes Relat Metab Disord',
      pmid: '8044194',
      verification: 'abstract',
    },
    {
      id: 'lovejoy2008',
      authors: 'Lovejoy JC et al.',
      year: 2008,
      title: 'Increased visceral fat and decreased energy expenditure during the menopausal transition',
      journal: 'Int J Obes',
      pmid: '18332882',
      verification: 'abstract',
    },
    {
      id: 'ambikairajah2019',
      authors: 'Ambikairajah A et al.',
      year: 2019,
      title: 'Fat mass changes during menopause: a metaanalysis',
      journal: 'Am J Obstet Gynecol',
      pmid: '31034807',
      verification: 'abstract',
    },
    {
      id: 'hallgreen2008',
      authors: 'Hallgreen CE, Hall KD.',
      year: 2008,
      title: 'Allometric relationship between changes of visceral fat and total fat mass',
      journal: 'Int J Obes',
      pmid: '18087265',
      verification: 'abstract',
    },
    {
      id: 'hall2008',
      authors: 'Hall KD, Hallgreen CE.',
      year: 2008,
      title:
        'Increasing weight loss attenuates the preferential loss of visceral compared with subcutaneous fat: a predicted result of an allometric model',
      journal: 'Int J Obes',
      pmid: '18301391',
    },
    {
      id: 'chaston2008',
      authors: 'Chaston TB, Dixon JB.',
      year: 2008,
      title:
        'Factors associated with percent change in visceral versus subcutaneous abdominal fat during weight loss: findings from a systematic review',
      journal: 'Int J Obes',
      pmid: '18180786',
    },
    {
      id: 'das2017',
      authors: 'Das SK, Roberts SB, Bhapkar MV, et al.',
      year: 2017,
      title:
        'Body-composition changes in the CALERIE-2 study: a 2-y randomized controlled trial of 25 % calorie restriction in nonobese humans',
      journal: 'Am J Clin Nutr',
      doi: '10.3945/ajcn.116.137232',
    },
    {
      id: 'benito2017',
      authors: 'Benito PJ, Cupeiro R, Peinado AB, et al.',
      year: 2017,
      title:
        'Influence of previous body mass index and sex on regional fat changes in a weight loss intervention',
      journal: 'Phys Sportsmed',
      pmid: '28914104',
      doi: '10.1080/00913847.2017.1380500',
      verification: 'abstract',
    },
    {
      id: 'ross1996',
      authors: 'Ross R, Rissanen J, Pedwell H, Clifford J, Shragge P.',
      year: 1996,
      title: 'Influence of diet and exercise on skeletal muscle and visceral adipose tissue in men',
      journal: 'J Appl Physiol',
      pmid: '9018491',
      verification: 'abstract',
    },
    {
      id: 'tchoukalova2010',
      authors: 'Tchoukalova YD, Votruba SB, Tchkonia T, et al.',
      year: 2010,
      title: 'Regional differences in cellular mechanisms of adipose tissue gain with overfeeding',
      journal: 'PNAS',
      pmid: '20921416',
      verification: 'abstract',
    },
    {
      id: 'spalding2008',
      authors: 'Spalding KL et al.',
      year: 2008,
      title: 'Dynamics of fat cell turnover in humans',
      journal: 'Nature',
      pmid: '18454136',
      verification: 'abstract',
    },
    {
      id: 'wahrenberg1989',
      authors: 'Wahrenberg H, Lonnqvist F, Arner P.',
      year: 1989,
      title: 'Mechanisms underlying regional differences in lipolysis in human adipose tissue',
      journal: 'J Clin Invest',
      pmid: '2503539',
      verification: 'abstract',
    },
    {
      id: 'karpe2015',
      authors: 'Karpe F, Pinnick KE.',
      year: 2015,
      title: 'Biology of upper-body and lower-body adipose tissue',
      journal: 'Nat Rev Endocrinol',
      pmid: '25365922',
      verification: 'abstract',
    },
    {
      id: 'manolopoulos2010',
      authors: 'Manolopoulos KN, Karpe F, Frayn KN.',
      year: 2010,
      title: 'Gluteofemoral body fat as a determinant of metabolic health',
      journal: 'Int J Obes',
      pmid: '20065965',
      verification: 'abstract',
    },
    {
      id: 'karastergiou2012',
      authors: 'Karastergiou K et al.',
      year: 2012,
      title: 'Sex differences in human adipose tissues - the biology of pear shape',
      journal: 'Biol Sex Differ',
      pmid: '22651247',
      verification: 'abstract',
    },
    {
      id: 'vispute2011',
      authors: 'Vispute SS et al.',
      year: 2011,
      title: 'The effect of abdominal exercise on abdominal fat',
      journal: 'J Strength Cond Res',
      pmid: '21804427',
      verification: 'abstract',
    },
    {
      id: 'ramirezcampillo2013',
      authors: 'Ramirez-Campillo R et al.',
      year: 2013,
      title: 'Regional fat changes induced by localized muscle endurance resistance training',
      journal: 'J Strength Cond Res',
      pmid: '23222084',
      verification: 'abstract',
    },
    {
      id: 'kostek2007',
      authors: 'Kostek MA et al.',
      year: 2007,
      title: 'Subcutaneous fat alterations resulting from an upper-body resistance training program',
      journal: 'Med Sci Sports Exerc',
      pmid: '17596787',
      verification: 'abstract',
    },
    {
      id: 'stallknecht2007',
      authors: 'Stallknecht B, Dela F, Helge JW.',
      year: 2007,
      title:
        'Are blood flow and lipolysis in subcutaneous adipose tissue influenced by contractions in adjacent muscles in humans?',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '16985258',
      verification: 'abstract',
    },
    {
      id: 'scotto2017',
      authors: 'Scotto di Palumbo A et al.',
      year: 2017,
      title: 'Effect of combined resistance and endurance exercise training on regional fat loss',
      journal: 'J Sports Med Phys Fitness',
      pmid: '28497942',
      verification: 'abstract',
    },
    {
      id: 'paoli2021',
      authors: 'Paoli A et al.',
      year: 2021,
      title:
        'Effect of an endurance and strength mixed circuit training on regional fat thickness: the quest for the "spot reduction"',
      journal: 'Int J Environ Res Public Health',
      pmid: '33917584',
      verification: 'abstract',
    },
    {
      id: 'brobakken2023',
      authors: 'Brobakken MF et al.',
      year: 2023,
      title:
        'Abdominal aerobic endurance exercise reveals spot reduction exists: a randomized controlled trial',
      journal: 'Physiol Rep',
      pmid: '38010201',
      verification: 'abstract',
    },
    {
      id: 'areta2018',
      authors: 'Areta JL, Hopkins WG.',
      year: 2018,
      title:
        'Skeletal muscle glycogen content at rest and during endurance exercise in humans: a meta-analysis',
      journal: 'Sports Med',
      pmid: '29923148',
      verification: 'abstract',
    },
    {
      id: 'acheson1988',
      authors: 'Acheson KJ, Schutz Y, Bessard T, et al.',
      year: 1988,
      title:
        'Glycogen storage capacity and de novo lipogenesis during massive carbohydrate overfeeding in man',
      journal: 'Am J Clin Nutr',
      pmid: '3165600',
      verification: 'abstract',
    },
    {
      id: 'watson1980',
      authors: 'Watson PE, Watson ID, Batt RD.',
      year: 1980,
      title:
        'Total body water volumes for adult males and females estimated from simple anthropometric measurements',
      journal: 'Am J Clin Nutr',
      pmid: '6986753',
      verification: 'unverified',
    },
    {
      id: 'wang1999',
      authors: 'Wang Z, Deurenberg P, Wang W, et al.',
      year: 1999,
      title: 'Hydration of fat-free body mass: new physiological modeling approach',
      journal: 'Am J Physiol',
      pmid: '10362610',
    },
    {
      id: 'chumlea2001',
      authors: 'Chumlea WC et al.',
      year: 2001,
      title: 'Total body water reference values and prediction equations for adults',
      journal: 'Kidney Int',
      pmid: '11380828',
    },
    {
      id: 'hioka2026',
      authors: 'Hioka A, Akazawa N, Okawa N, Nagahiro S.',
      year: 2026,
      title:
        'Sex differences in age-related changes in the extracellular water-to-total body water ratio among community-dwelling individuals',
      journal: 'JMA J',
      pmid: '41958617',
      verification: 'full-text',
    },
    {
      id: 'cunningham1991',
      authors: 'Cunningham JJ.',
      year: 1991,
      title:
        'Body composition as a determinant of energy expenditure: a synthetic review and a proposed general prediction equation',
      journal: 'Am J Clin Nutr',
      pmid: '1957828',
      verification: 'abstract',
    },
    {
      id: 'tenhaaf2014',
      authors: 'ten Haaf T, Weijs PJ.',
      year: 2014,
      title: 'Resting energy expenditure prediction in recreational athletes of 18-35 years',
      journal: 'PLoS One',
      pmid: '25275434',
      verification: 'abstract',
    },
    {
      id: 'hall2011',
      authors: 'Hall KD, Sacks G, Chandramohan D, et al.',
      year: 2011,
      title: 'Quantification of the effect of energy imbalance on bodyweight',
      journal: 'Lancet',
      pmid: '21872751',
      verification: 'abstract',
    },
    {
      id: 'thomas2011',
      authors: 'Thomas DM et al.',
      year: 2011,
      title: 'A simple model predicting individual weight change in humans',
      journal: 'J Biol Dyn',
      pmid: '24707319',
      verification: 'abstract',
    },
    {
      id: 'forbes1987',
      authors: 'Forbes GB.',
      year: 1987,
      title: 'Lean body mass-body fat interrelationships in humans',
      journal: 'Nutr Rev',
      pmid: '3306482',
      verification: 'abstract',
    },
    {
      id: 'connor2007',
      authors: 'Connor Gorber S, Tremblay M, Moher D, Gorber B.',
      year: 2007,
      title:
        'A comparison of direct vs. self-report measures for assessing height, weight and BMI: a systematic review',
      journal: 'Obes Rev',
      pmid: '17578381',
      verification: 'abstract',
    },
    {
      id: 'flegal2019',
      authors: 'Flegal KM et al.',
      year: 2019,
      title:
        'Comparisons of self-reported and measured height and weight, BMI, and obesity prevalence from national surveys: 1999-2016',
      journal: 'Obesity',
      pmid: '31544344',
      verification: 'abstract',
    },
    {
      id: 'li2024',
      authors: 'Li C, Zeng L, Li M, et al.',
      year: 2024,
      title:
        'New sagittal abdominal diameter and transverse abdominal diameter based equations to estimate visceral fat area in type 2 diabetes patients',
      journal: 'BMC Public Health',
      pmid: '38773444',
      doi: '10.1186/s12889-024-18659-8',
      verification: 'full-text',
    },
    {
      id: 'han1997',
      authors: 'Han TS, Richmond P, Avenell A, Lean ME.',
      year: 1997,
      title: 'Waist circumference reduction and cardiovascular benefits during weight loss in women',
      journal: 'Int J Obes',
      pmid: '9043967',
      verification: 'abstract',
    },
    {
      id: 'ross2020',
      authors: 'Ross R, Neeland IJ, Yamashita S, et al.',
      year: 2020,
      title:
        'Waist circumference as a vital sign in clinical practice: a Consensus Statement from the IAS and ICCR Working Group on Visceral Obesity',
      journal: 'Nat Rev Endocrinol',
      pmid: '32020062',
      verification: 'full-text',
    },
    {
      id: 'samouda2013',
      authors: 'Samouda H, Dutour A, Chaumoitre K, et al.',
      year: 2013,
      title:
        'VAT = TAAT - SAAT: innovative anthropometric model to predict visceral adipose tissue without resort to CT-scan or DXA',
      journal: 'Obesity',
      pmid: '23404678',
      verification: 'abstract',
    },
    {
      id: 'so2017',
      authors: 'So R, Matsuo T, Saotome K, Tanaka K.',
      year: 2017,
      title:
        'Equation to estimate visceral adipose tissue volume based on anthropometry for workplace health checkup in Japanese abdominally obese men',
      journal: 'Ind Health',
      pmid: '28701657',
    },
    {
      id: 'song2022',
      authors: 'Song X, Wu H, Zhang W, Wang B, Sun H.',
      year: 2022,
      title:
        'Equations for predicting DXA-measured visceral adipose tissue mass based on BMI or weight in adults',
      journal: 'Lipids Health Dis',
      pmid: '35578238',
      verification: 'abstract',
    },
    {
      id: 'palm2023',
      authors: 'Palm MD, Halaas Y, Kinney BM, Goldfarb R.',
      year: 2023,
      title:
        'Spot reduction of localized fat deposits on the lateral thighs by simultaneous emission of synchronized radiofrequency and high-intensity focused electromagnetic energy',
      journal: 'Dermatol Surg',
      pmid: '36533796',
      verification: 'abstract',
    },
  ],
};

export default topic;
