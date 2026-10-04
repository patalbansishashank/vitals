import type { EvidenceTopic } from '../schema';

/** Evidence topic for research/03-protein-mps-muscle-retention.md (pure data). */
const topic: EvidenceTopic = {
  dossier: '03',
  slug: 'protein-muscle',
  title: 'Protein, muscle protein synthesis and lean-mass retention',
  scope:
    'How the protein a person eats, in total and meal by meal, along with their energy balance, training, fasting and age, changes how fast muscle builds and breaks down protein, and so how much lean tissue is gained or kept. It covers dose-response for training gains, keeping lean mass in a calorie deficit, the size and spacing of meals, protein quality, fasting protein loss, and the anabolic resistance that comes with age and inactivity. The training programme itself belongs to the resistance-training topic.',
  mechanisms: [
    {
      id: '03-protein-units-and-lean-tissue',
      title: 'Protein per kilogram of body or of lean mass, and what lean tissue is made of',
      category: 'body',
      summary:
        "The body's demand for amino acids follows its active lean tissue, not its fat. Studies report protein per kilogram of body mass or per kilogram of fat-free mass, and the two only line up in lean people. Vitals writes every protein dose-response per kilogram of fat-free mass, and converts published cut-points using each study's body-fat level. It also needs a few facts about what lean tissue contains, to turn protein balance into kilograms.",
      howModelled:
        "The engine converts between the two bases with the person's body-fat fraction. For a user with no lean-mass estimate, it falls back to a body-fat estimate from BMI equations. Skeletal muscle, its protein content and its turnover rates are set from the values below.",
      equation: `q_FFM = q_BM / (1 − BF)
q_BM = q_FFM × (1 − BF)`,
      keyNumbers: [
        {
          label: 'Recommended intake from nitrogen balance',
          value: 'RDA 0.83 g/kg/d (EAR 0.65), which is ≈ 1.0 (EAR ≈ 0.8) g/kg FFM/d in the engine',
          referenceIds: ['rand2003'],
        },
        {
          label: 'Estimate from amino-acid oxidation in young men',
          value: 'EAR 0.93 / RDA 1.2 g/kg/d, which is ≈ 1.1 / 1.4 g/kg FFM/d',
          referenceIds: ['humayun2007'],
        },
        {
          label: 'Plateau of training-induced fat-free-mass gain',
          value: '1.62 (95% CI 1.03–2.20) g/kg/d, which is ≈ 1.95 (CI 1.25–2.65) g/kg FFM/d',
          note: 'Assumes 15–20% body fat in young, non-obese training samples; the assumption is unverified for each study.',
          referenceIds: ['morton2018'],
        },
        {
          label: 'Deficit, lean and training',
          value: '2.3–3.1 g/kg FFM/d',
          referenceIds: ['helms2014'],
        },
        {
          label: 'Per-meal plateau, young and older',
          value:
            'Young 0.24 ± 0.06 g/kg BM (0.25 ± 0.13 g/kg LBM), ≈ 0.28 g/kg FFM; older 0.40 ± 0.19 g/kg BM (0.60 ± 0.29 g/kg LBM), ≈ 0.50–0.60 g/kg FFM',
          referenceIds: ['moore2015'],
        },
        {
          label: 'Skeletal muscle mass (MRI, n = 468)',
          value: 'Men 33.0 kg (38.4% of body mass); women 21.0 kg (30.6%)',
          note: 'Muscle as a fraction of fat-free mass is about 0.45–0.50 (derived).',
          referenceIds: ['janssen2000'],
        },
        {
          label: 'Water and protein in lean tissue',
          value:
            'Water about 0.73 of fat-free mass; metabolically active lean tissue holds 33 g N/kg, about 0.206 kg protein/kg',
          note: 'Lean tissue excluding glycogen water is taken as about 73% water and 20.6% protein (a proposed composite). 1 g N = 6.25 g protein.',
          referenceIds: ['wang1999', 'laurens2021'],
        },
        {
          label: 'Share of lean-tissue change that is muscle (proposed)',
          value: '0.5 of loss in an energy deficit; 0.8–0.9 of training-driven gain',
          note: 'Non-muscle organs also shrink in a deficit. One example: 1.7 kg of skeletal muscle in 7.8 kg of weight lost in diet-only men.',
          referenceIds: ['heymsfield2014'],
        },
        {
          label: 'Energy density of lean-tissue change',
          value:
            '1000–1020 kcal/kg (hydrated tissue) or 7.6 MJ/kg = 1816 kcal/kg (Hall; assumes 1.6 g water per g protein); fat 39.5 MJ/kg (9440 kcal/kg)',
          note: 'Heymsfield: energy content of weight change = 1020·f + 9500·(1 − f) kcal/kg, where f = ΔFFM/ΔW.',
          referenceIds: ['bray2012', 'heymsfield2014', 'hall2008a'],
        },
        {
          label: 'Muscle protein turnover rates',
          value:
            'Basal synthesis 0.036–0.045 %/h (≈ 0.9–1.1 %/d); fed synthesis 0.06–0.10 %/h; basal breakdown 0.076–0.080 %/h',
          referenceIds: ['phillips1999', 'witard2014', 'atherton2010', 'hector2018b'],
        },
        {
          label: 'Insulin and muscle breakdown',
          value:
            'Leg protein breakdown is halved at 30 mU/L insulin, with no further suppression at 72–167 mU/L. In a meta-analysis insulin reduced breakdown (weighted mean difference −15.5, CI −19.7 to −11.2) and did not raise synthesis unless amino acids rose',
          referenceIds: ['greenhaff2008', 'abdulla2016'],
        },
        {
          label: 'Whole-body protein turnover',
          value: 'About 250–350 g/d (about 4 g/kg/d)',
          note: 'A textbook figure that was not verified.',
          referenceIds: ['waterlow1995'],
        },
      ],
      timeCourse: 'These are fixed conversions and constants rather than time-dependent processes.',
      moderators: 'Body fat (the two bases diverge as fat rises), age and sex through lean-mass fraction.',
      grade: 'B',
      gradeReason:
        'The physiological rationale is sound and the two bases agree in non-obese samples, where the dose-response data come from; the MRI and hydration figures come from large or precise studies.',
      status: 'established',
      caveats:
        'The engine assumes each study group had 15–20% body fat, which could not be verified. The energy density of lean-tissue change (1000 vs 1816 kcal/kg) is unresolved between topics, and it changes predicted weight-loss speed when the lean share is large.',
      referenceIds: [
        'rand2003',
        'humayun2007',
        'morton2018',
        'helms2014',
        'moore2015',
        'janssen2000',
        'wang1999',
        'laurens2021',
        'heymsfield2014',
        'bray2012',
        'hall2008a',
        'phillips1999',
        'witard2014',
        'atherton2010',
        'hector2018b',
        'greenhaff2008',
        'abdulla2016',
        'waterlow1995',
      ],
      relatedMetricIds: ['leanTissue'],
    },
    {
      id: '03-protein-dose-response-training-gain',
      title: 'How much protein supports training-driven lean gain',
      category: 'body',
      summary:
        'Resistance training creates the demand for muscle growth, and dietary protein supports it. Extra protein adds a modest increment on top of training, and the benefit levels off at around 1.6 g per kilogram of body weight per day. In energy balance or surplus, going beyond that adds little on average.',
      howModelled:
        'Protein efficacy is a saturating curve of the effective protein intake per kilogram of fat-free mass. It multiplies the training-driven gain. The effective intake is a 7-day rolling mean of quality-weighted protein. Trained people have the curve shifted to higher intakes, and older adults have a reduced anabolic response.',
      equation: `f_Pgain(q) = clamp( 1 − exp( −(q − q0)/λ ), 0, 1 )      q in g/kg FFM/d
q0 = 0.49 g/kg FFM/d (= 0.40 g/kg BM at 18% BF),   λ = 0.61 g/kg FFM/d (= 0.50 g/kg BM); trained: λ = 0.75
AR_age = 1 − 0.25 × clamp((age − 30)/40, 0, 1)`,
      keyNumbers: [
        {
          label: 'Meta-analysis, 49 trials with training of 6 weeks or more (n = 1863)',
          value:
            'Protein supplementation added +0.30 kg (95% CI 0.09–0.52) fat-free mass, +2.49 kg (0.64–4.33) 1RM strength and +310 µm² (51–570) fibre area',
          note: 'The effect was smaller with age (−0.01 kg per year, −0.02 to −0.00) and larger in resistance-trained people (+0.75 kg, 0.09–1.40). Mean supplement 36 ± 30 g/d; intake in the protein groups rose from 1.4 to 1.8 g/kg/d.',
          referenceIds: ['morton2018'],
        },
        {
          label: 'Breakpoint from the same analysis (42 arms, 723 people, intakes 0.9–2.4 g/kg/d)',
          value:
            '1.62 (1.03–2.20) g/kg/d; slope below it 1.75 kg per g/kg/d; R² = 0.19, p = 0.079 (not significant)',
          note: 'The authors suggested about 2.2 g/kg/d to be safe given the wide interval. Studies were at or above energy requirement.',
          referenceIds: ['morton2018'],
        },
        {
          label: 'Second meta-analysis, 74 trials',
          value:
            'Lean body mass standardised difference 0.22 (0.14–0.30), 62 studies, moderate certainty; significant at 1.2–1.59 g/kg/d in people 65 and over, and at 1.6 g/kg/d or more in younger people; lower-body strength 0.40 at 1.6 or more (low certainty)',
          referenceIds: ['nunes2022'],
        },
        {
          label: 'Third meta-analysis, 105 articles (5402 participants, with and without training)',
          value:
            'Each +0.1 g/kg/d was linked to +0.39 kg lean mass (0.36–0.41) below 1.3 g/kg/d and +0.12 kg (0.11–0.14) above it, across 0.5–3.5 g/kg/d',
          note: 'These per-step slopes are much larger than the first analysis implies and pool very different studies, so only the shape is used: a knee near 1.3 with a smaller benefit above.',
          referenceIds: ['tagawa2021'],
        },
        {
          label: 'Protein-timing meta-analysis (23 studies, 525 subjects)',
          value:
            'Total protein intake was the strongest predictor of hypertrophy: about +0.2 effect size per +0.5 g/kg/d (0.39 ± 0.15 per unit)',
          referenceIds: ['schoenfeld2013'],
        },
        {
          label: 'Above vs at the RDA during training (18 trials of 6 weeks or more)',
          value:
            '+0.77 kg (0.23–1.31, 3 comparisons) lean mass with training, but +0.08 kg (−0.59 to 0.75) in non-stressed states',
          referenceIds: ['hudson2020a'],
        },
        {
          label: 'Amino-acid oxidation (indicator) studies',
          value:
            'Trained men on a training day: breakpoint 2.00 (1.62–2.38) g/kg/d. Bodybuilders on a non-training day: EAR 1.7, RDA 2.2 g/kg/d',
          referenceIds: ['mazzulla2020', 'bandegan2017'],
        },
        {
          label: 'Fitted curve (body-mass basis, 18% body fat)',
          value:
            'f(0.6) = 0.33, f(0.8) = 0.55, f(1.0) = 0.70, f(1.2) = 0.80, f(1.4) = 0.86, f(1.62) = 0.91, f(2.0) = 0.96, f(2.2) = 0.97, f(3.0) = 0.99',
          referenceIds: ['morton2018'],
        },
      ],
      timeCourse:
        'A daily rate multiplier. The effective intake is a 7-day rolling mean of quality-weighted protein, because training adaptation builds up over days (proposed).',
      moderators:
        'Age (Morton found −0.01 kg per year in the supplement effect), training status (trained people benefit more, so the curve shifts right), and energy status. No sex term is used because there was no apparent sex difference, though there were fewer data in women.',
      grade: 'C',
      gradeReason:
        'The plateau near 1.6 g/kg/d is well supported by meta-analyses (grade A), but the exact curve is our own fit (grade C) and the meta-regression breakpoint was not statistically significant.',
      status: 'proposed-fit',
      caveats:
        'The curve is a fit by Vitals to the data points above. The wide confidence interval on the plateau (up to 2.2 g/kg/d) and the very different slopes of the third meta-analysis mean the exact numbers are uncertain.',
      referenceIds: [
        'morton2018',
        'nunes2022',
        'tagawa2021',
        'schoenfeld2013',
        'hudson2020a',
        'mazzulla2020',
        'bandegan2017',
      ],
      relatedMetricIds: ['rtMuscleGain', 'leanTissue'],
    },
    {
      id: '03-protein-requirement-nitrogen-balance',
      title: 'Protein requirement, nitrogen balance and the protein limit on lean gain',
      category: 'body',
      summary:
        "Below a person's protein requirement, whole-body protein balance is negative whatever the energy intake. Above it, extra protein is mostly burned unless something drives growth, such as training or a calorie surplus. In a surplus without training, protein, not energy, set how much lean mass was gained, while energy set how much fat was gained.",
      howModelled:
        'The engine compares effective protein (quality-weighted) with a requirement of 1.1 g per kg of fat-free mass. A fraction of the gap is retained or lost as lean tissue, and this caps lean accretion in a surplus and only lets a shortfall cause loss at maintenance. In a deficit, the lean-fraction entry covers it.',
      equation: `P_eff = Σ_meals P_i × Q_i                      (g/d, quality-weighted)
P_need = 1.1 g/kg FFM/d × FFM
η = 0.30                                        (fraction of the gap retained or lost)
c_P = 0.206 kg protein per kg lean tissue
ΔL_cap = η × (P_eff − P_need) / (1000 × c_P)    (kg lean tissue per day)`,
      keyNumbers: [
        {
          label: 'Nitrogen-balance meta-analysis (19 studies, 235 subjects)',
          value:
            'EAR 105 mg N/kg/d = 0.65 g protein/kg/d; RDA 132 mg N = 0.83 g/kg/d; individual requirements are log-normal',
          referenceIds: ['rand2003'],
        },
        {
          label: 'Amino-acid oxidation in young men',
          value: 'EAR 0.93, RDA 1.2 g/kg/d',
          referenceIds: ['humayun2007'],
        },
        {
          label: 'Older people (expert consensus)',
          value: '1.0–1.2 g/kg/d or more; 1.2 or more if active or ill; 1.2–1.5 with chronic disease',
          referenceIds: ['bauer2013'],
        },
        {
          label:
            'Overfeeding by 954 kcal/d (about +40%) for 8 weeks, no training, protein 5% / 15% / 25% of energy (about 47 / 140 / 228 g/d)',
          value:
            'Lean body mass −0.70 kg (−1.50 to 0.10) / +2.87 kg (2.11–3.62) / +3.18 kg (2.37–3.98); fat gain the same in all (+3.51 kg, 3.06–3.96)',
          note: 'Resting expenditure rose 160 and 227 kcal/d with normal and high protein, and did not change with low protein.',
          referenceIds: ['bray2012'],
        },
        {
          label: 'Origin of η = 0.30',
          value:
            'On a 500 kcal diet, raising protein from 0.8 to 1.5 g/kg ideal weight (about +42 g/d) moved nitrogen balance from −2 g N/d to 0: 2 g N (12.5 g protein) retained per 42 g extra',
          referenceIds: ['hoffer1984'],
        },
        {
          label: 'Check against the low-protein arm of the overfeeding study',
          value:
            'Fat-free mass about 53 kg gives P_need about 58 g; intake of 47 g gives −16 g lean/d, or −0.9 kg in 8 weeks (observed −0.70, CI −1.50 to 0.10)',
          referenceIds: ['bray2012'],
        },
      ],
      timeCourse:
        'A daily ceiling on lean accretion. In a surplus ΔL_tis is the smaller of the partition and this cap, plus any training credit; at maintenance only a shortfall causes loss.',
      moderators: 'Protein quality, fat-free mass, and energy status.',
      grade: 'C',
      gradeReason:
        'Requirement values are well established (grade A) and the two anchor studies are grade B, but the single-parameter linear form is grade C.',
      status: 'proposed-fit',
      caveats:
        'The single retention fraction (η = 0.30) comes from one small feeding study and is an assumption for other people.',
      referenceIds: ['rand2003', 'humayun2007', 'bauer2013', 'bray2012', 'hoffer1984'],
      relatedMetricIds: ['leanTissue', 'nitrogenBalance'],
    },
    {
      id: '03-lean-fraction-of-loss',
      title: 'How much of the weight lost in a deficit is lean tissue',
      category: 'body',
      summary:
        'In an energy deficit the body burns fat and some protein. The share of the weight lost that is lean tissue falls when body fat is high and when protein intake is high, and it rises with bigger deficits. Resistance training reduces it further, and can even produce a net lean gain while fat is lost (recomposition). Vitals combines a catabolic partition with an anabolic training credit, so the lean fraction can go negative.',
      howModelled:
        'The function starts from a Forbes-type partition and adjusts it for protein adequacy, deficit size, training, aerobic activity and age. It then subtracts a training credit that shrinks as the deficit grows and grows with protein. This is the same partition as the daily update: quality-weighted protein, distribution efficiency, the partition or fasting branch, then extras for long fasts, ageing and disuse, and finally the muscle share.',
      equation: `p0 = 10.4/(10.4 + FM)
L = clamp((0.30 − bf_maleEq)/0.20, 0, 1)                    (leanness index; bf_maleEq = bf for men, bf − 0.10 for women)
q_sat = 1.2 + min(d, 0.45)·(2.0 + 3.0·L),   x_P = clamp((q − 0.8)/max(q_sat − 0.8, 0.3), 0, 1)
M_min = (0.60 − 0.25·RT)·(1 − 0.5·clamp((d − 0.25)/0.5, 0, 1)),   d_crit = 0.45 + 0.35·(1 − L)
M_P = 1 − (1 − M_min)·effD·x_P,   effD = clamp(1 − (d − d_crit)/0.30, 0, 1)
M_D = clamp(1 + 0.65·(d − 0.25), 0.85, 1.5),   M_RT = 1 − 0.30·RT,   M_act = 1 − 0.30·activity
M_age = clamp(1 + 0.01·max(0, age − 40), 1, 1.4)
p_cat = clamp(p0 · M_P · M_D · M_RT · M_act · M_age, 0, 0.9)
credit = G_RT · RT · fP · fE · AR,   fE = clamp(1 − d/(0.30 + 0.40·x_P), 0, 1)
lean change = −(lean lost to the deficit − credit)`,
      keyNumbers: [
        {
          label: 'Baseline partition (Forbes curve)',
          value: 'dFFM/dW = 10.4/(10.4 + FM), with an uncertainty of about ±0.10 absolute between studies',
          referenceIds: ['hall2007', 'heymsfield2014', 'hall2008a'],
        },
        {
          label: '20 young trained athletes, 60% of usual energy for 2 weeks (protein ≈ 1.0 vs ≈ 2.3 g/kg)',
          value:
            'Weight −3.0 ± 0.4 vs −1.5 ± 0.3 kg; lean body mass −1.6 ± 0.3 vs −0.3 ± 0.3 kg (lean shares 0.53 vs 0.20, DXA)',
          referenceIds: ['mettler2010'],
        },
        {
          label:
            '39 adults, 21 days at a 40% deficit (30% diet, 10% exercise), no training (0.8 / 1.6 / 2.4 g/kg)',
          value:
            'Weight −3.2 ± 0.2 kg in all groups; the lean share of the loss was lower and the fat loss higher at 1.6 and 2.4 than at 0.8, and 2.4 was about the same as 1.6',
          note: 'Exact kilogram values are unverified because the full text was not accessible.',
          referenceIds: ['pasiakos2013'],
        },
        {
          label: '40 young men, about 40% deficit for 4 weeks, training and HIIT 6 d/wk (1.2 vs 2.4 g/kg)',
          value: 'Lean mass +0.1 ± 1.0 vs +1.2 ± 1.0 kg; fat mass −3.5 ± 1.4 vs −4.8 ± 1.6 kg',
          referenceIds: ['longland2016'],
        },
        {
          label: 'Systematic review, 6 studies (13 groups) of lean trained people',
          value:
            'Fat-free mass fell 0.3–2.7 kg in 9 of 13 groups. The one lean, large-deficit group with no loss ate 2.5–2.6 g/kg, which is 2.3–3.1 g/kg FFM, scaled up with deficit and leanness',
          note: 'A review of athletes recommends 1.6–2.4 g/kg/d during weight loss, with the higher end for a larger deficit or harder training.',
          referenceIds: ['helms2014', 'hector2018a'],
        },
        {
          label:
            '24 elite athletes: 19% deficit (0.7% of body weight per week, 8.5 weeks) vs 30% (1.4% per week, 5.3 weeks)',
          value: 'Weight −5.6 vs −5.5%; lean body mass +2.1 ± 0.4% vs −0.2 ± 0.7%; fat mass −31 vs −21%',
          referenceIds: ['garthe2011'],
        },
        {
          label: 'Meta-analyses of high vs standard protein in energy restriction',
          value:
            'Krieger (87 studies, 165 groups): +0.60 kg fat-free mass retained above 1.05 g/kg, +1.21 kg in studies over 12 weeks. Wycherley (24 trials, n = 1063): fat-free mass +0.43 kg (0.09, 0.78) retained, fat mass −0.87 kg (−1.26, −0.48). Adults over 50, no training: lean +0.45 kg (0.20–0.71) or +0.83 kg (0.47–1.19). Hudson: +0.36 kg (0.06–0.67), 14 comparisons',
          referenceIds: ['krieger2006', 'wycherley2012', 'kim2016a', 'hudson2020a'],
        },
        {
          label:
            'Fat-free-mass share of weight lost by type of exercise (26 diet cohorts, more than 10 kg lost)',
          value:
            'ΔFFM/ΔW 0.27 ± 0.06 (sedentary) vs 0.13 ± 0.04 (aerobic) vs 0.17 ± 0.14 (resistance training); men 27 ± 7% vs women 20 ± 7%; the share correlated with degree of restriction (r² = 0.31)',
          note: 'In a review of middle-aged and older adults, 81% of restriction-only groups vs 39% of restriction-plus-exercise groups lost at least 15% of their weight loss as fat-free mass.',
          referenceIds: ['chaston2007', 'weinheimer2010'],
        },
        {
          label: 'Meta-regression of training in a deficit',
          value:
            'Lean-mass gain impaired (effect size −0.57, p = 0.02), strength not (−0.31, not significant); a deficit of about 500 kcal/d prevented lean-mass gains',
          referenceIds: ['murphy2022'],
        },
        {
          label: 'Very-low-energy vs low-energy diet with the same total loss (57 adults, BMI 28–35)',
          value:
            '500 kcal for 5 weeks (−9.0 kg) vs 1250 kcal for 12 weeks (−8.2 kg): percentage of fat-free mass lost 8.8% vs 1.3%',
          note: "The authors' metric was not fully defined in the abstract.",
          referenceIds: ['vink2016'],
        },
        {
          label: 'Protein and very large deficits',
          value:
            'Protein above the RDA protected at deficits up to about 40%; a plateau may exist above about 40%. 2.0 vs 1.0 g/kg did not protect fat-free mass at a deficit of about 70% at altitude',
          referenceIds: ['carbone2019'],
        },
        {
          label: 'Extreme deficit plus exercise (50 normal-weight men, 15% fat, 8 weeks, −10 kg)',
          value:
            'ΔFFM/ΔW 0.40; the share correlated with baseline percent fat (n = 105, R² = 0.42), so leaner people lose more lean tissue',
          note: 'Early weight lost is mostly water: fat : water : protein of 25 : 70 : 5 at day 3 (fat-free mass 75%) vs 85 : 0 : 15 at days 21–24 (fat-free mass 15%), with an early-phase half-life under a week.',
          referenceIds: ['heymsfield2014'],
        },
      ],
      timeCourse:
        'The function gives the tissue partition for the slow phase. The early phase, driven by glycogen and water, comes from other topics. A training credit builds with a lag of 1–2 weeks in novices, as credit × (1 − exp(−t_RT/10 d)) (proposed), because early muscle protein synthesis goes to damage repair rather than growth.',
      moderators:
        'Body fat (strong), deficit size, protein intake (direction is well supported, size less so), resistance training, aerobic activity, age and sex (mostly through fat mass). The person-to-person SD of ΔFFM/ΔW is about 0.07 in obese groups and about 0.1–0.15 in lean people measured by DXA.',
      grade: 'C',
      gradeReason:
        'The components (Forbes partition, protein and training effects) are grade B, but the combined function is our own parameterisation (grade C).',
      status: 'proposed-fit',
      caveats:
        'The function is built by Vitals and only semi-quantitatively checked (some inputs were assumed). Known misses: it predicts a lean share of about 0.4 for lean adults where a well-controlled 3-week study found about 0.08, and it under-predicts the lean gain in the high-protein Longland arm (+0.3 vs +1.2 kg). Short DXA studies also include glycogen and water, so they overstate tissue loss.',
      referenceIds: [
        'mettler2010',
        'pasiakos2013',
        'longland2016',
        'helms2014',
        'hector2018a',
        'garthe2011',
        'krieger2006',
        'wycherley2012',
        'kim2016a',
        'hudson2020a',
        'chaston2007',
        'weinheimer2010',
        'murphy2022',
        'vink2016',
        'carbone2019',
        'heymsfield2014',
        'hall2007',
        'hall2008a',
        'damas2016',
      ],
      relatedMetricIds: ['leanTissue', 'fatMass'],
    },
    {
      id: '03-mps-suppression-energy-deficit',
      title: 'Muscle protein synthesis falls in an energy deficit',
      category: 'cellular',
      summary:
        'An energy deficit lowers muscle protein synthesis (MPS), the rate at which muscle builds new protein, both when fasted and after a meal. Muscle protein breakdown (MPB) is largely unchanged, so lower synthesis is the main driver of early lean loss. Higher protein and resistance exercise restore synthesis.',
      howModelled:
        'The engine multiplies basal and meal-stimulated MPS by a factor that falls with deficit size and rises with protein adequacy. It has no deficit term for breakdown. A single resistance session adds MPS back through the training terms.',
      equation: 'f_E,MPS(d, x_P) = max(0.5, 1 − 0.9 · d · (1 − 0.5 · x_P))',
      keyNumbers: [
        {
          label: '12 active adults, 10 days at about 80% of energy needs, 1.5 g/kg protein',
          value: 'Mixed-muscle synthesis rate 0.074 → 0.060 %/h (−19%)',
          referenceIds: ['pasiakos2010'],
        },
        {
          label: '15 young adults, 5 days at 30 vs 45 kcal/kg FFM (about −33%)',
          value:
            'Postabsorptive MPS −27%; one resistance bout restored MPS to energy-balance values, and with 15 g or 30 g whey went +16% or +34% above rested energy balance',
          referenceIds: ['areta2014'],
        },
        {
          label: '40 adults with overweight or obesity, 14 days at −750 kcal/d',
          value:
            'Postprandial MPS −9 ± 1% with whey (1.3 g/kg/d) vs −28 ± 5% with soy and −31 ± 5% with a carbohydrate control (0.7 g/kg/d)',
          referenceIds: ['hector2015'],
        },
        {
          label: '24 young men with overweight, 10 days at −40%, one leg trained',
          value:
            'Postabsorptive MPS at 2.4 g/kg: 0.059 → 0.051 %/h; at 1.2 g/kg: 0.061 → 0.045; exercised leg 0.067 and 0.061. Breakdown unchanged (about 0.080 %/h)',
          referenceIds: ['hector2018b'],
        },
        {
          label: 'Older men with overweight (1.3 g/kg protein), balanced vs skewed distribution',
          value:
            'Fed MPS was lower in restriction in both; adding training restored it to the energy-balance level only with the balanced (4 × 25%) pattern',
          referenceIds: ['murphy2015'],
        },
        {
          label: '40% deficit at different protein intakes',
          value:
            'The anabolic response to a protein-rich meal was preserved at 1.6 and 2.4 g/kg but reduced at 0.8 g/kg',
          referenceIds: ['pasiakos2013'],
        },
        {
          label: 'How well the equation matches the anchors',
          value: 'Mean absolute error about 7 percentage points across six comparisons',
          note: 'Range of observed falls 9–31%. Example anchors: Pasiakos 2010 model −10% vs −19% observed; Hector 2018 at 1.2 g/kg −26% vs −26%; at 2.4 g/kg −18% vs −14%.',
          referenceIds: ['pasiakos2010', 'hector2018b'],
        },
      ],
      timeCourse:
        'The fall is evident by day 5–10 of a deficit. The engine assumes a first-order onset with a 2-day time constant, and a 2-day offset after return to energy balance; both are unverified, and no human data on the offset were found.',
      moderators: 'Deficit size, protein adequacy, and training (one bout restores synthesis).',
      grade: 'B',
      gradeReason:
        'Several tracer trials agree on the direction, but the size of the fall varies from 9% to 31%.',
      status: 'proposed-fit',
      caveats: 'The equation is fitted by Vitals to these studies, and the time constants are unverified.',
      referenceIds: ['pasiakos2010', 'areta2014', 'hector2015', 'hector2018b', 'murphy2015', 'pasiakos2013'],
      relatedMetricIds: ['mps'],
    },
    {
      id: '03-per-meal-mps-dose-response',
      title: 'How muscle responds to the size of a protein meal',
      category: 'cellular',
      summary:
        'After a protein meal, muscle protein synthesis rises roughly in step with the dose up to about 0.24 g per kilogram of body mass in young people (0.40 in older people), then flattens without a hard limit. Larger meals mostly make the response last longer. Burning of large doses is small, and whole-body protein balance keeps improving with dose, largely because breakdown is suppressed.',
      howModelled:
        'The engine treats the peak response to a meal as saturating at the age-dependent per-meal amount, but lets larger doses extend the duration through slower digestion. It counts leucine as a signal that is necessary but not sufficient, since total essential amino acid supply sustains the response.',
      keyNumbers: [
        {
          label: 'Per-meal plateau in pooled tracer studies (isolated high-quality protein)',
          value:
            'Young (about 22 y) 0.24 ± 0.06 g/kg BM vs older (about 71 y) 0.40 ± 0.19 (p = 0.055); per lean mass 0.25 ± 0.13 vs 0.60 ± 0.29 g/kg LBM (p < 0.01)',
          note: 'Basal synthesis did not differ, and the first-segment slope was lower in older men.',
          referenceIds: ['moore2015'],
        },
        {
          label: '48 resistance-trained men (about 80 kg) after leg exercise',
          value:
            'Synthesis with no whey 0.041 ± 0.015 %/h; +49% with 20 g, +56% with 40 g; 10 g had no significant effect; 40 g raised phenylalanine oxidation and urea production',
          referenceIds: ['witard2014'],
        },
        {
          label: 'Whole-body exercise, trained men',
          value:
            '20 g: 0.048–0.051 %/h vs 40 g: 0.059 %/h (about +20%); body weight (65 kg or less vs 70 kg or more) did not change the response',
          referenceIds: ['macnaughton2016'],
        },
        {
          label: '36 young men, whole-body exercise, 0 / 25 / 100 g of labelled milk protein over 12 hours',
          value:
            'Muscle protein synthesis 100 > 25 > 0 g; about +20% (0–4 h) and about +40% (4–12 h) for 100 vs 25 g',
          note: 'Dietary amino acids reaching the blood: 25 g gave 51/62/66% at 4/8/12 h (16 ± 1 g); 100 g gave 26/44/53% (53 ± 7 g), not plateaued by 12 h. Incorporation into muscle: 25 g about 12/15/18%; 100 g about 13 g (13%), rising linearly. Oxidation was under 15% of the increment. Muscle signalling returned to baseline within 4 hours while synthesis stayed raised.',
          referenceIds: ['trommelen2023'],
        },
        {
          label: 'Whole-body balance with larger mixed meals',
          value:
            '70 g vs 40 g of protein gave greater net balance, mostly through greater suppression of breakdown',
          referenceIds: ['kim2016b'],
        },
        {
          label: '48 older men (66 y) after exercise, 0 / 15 / 30 / 45 g milk protein',
          value:
            'Whole-body net balance 0.015 / 0.108 / 0.162 / 0.215 µmol Phe/kg/min (linear); muscle synthesis 0.0746 (0 g), 0.0951 (30 g), 0.0970 (45 g) %/h',
          referenceIds: ['holwerda2019'],
        },
        {
          label: '"Muscle-full" effect',
          value:
            'With a steady amino-acid infusion, no rise in the first 0.5 h, a peak of about 2.8 × basal at 2 h, then a return to basal despite continued high amino acids (basal 0.076 %/h). After 48 g whey, synthesis went 0.03 → 0.10 %/h at 45–90 min, then back to baseline although blood essential amino acids were still +130% at 120 min and +80% at 180 min',
          note: 'Signalling stayed elevated after synthesis returned to baseline.',
          referenceIds: ['bohe2001', 'atherton2010'],
        },
        {
          label: 'Leucine',
          value:
            '25 g whey (3.0 g leucine) vs 6.25 g whey plus leucine: with 5.0 g total leucine the low-protein drink was similar to 25 g whey at 1.5–4.5 h (about +220% vs +267%); with 3.0 g less effective. With 6.25 g whey plus leucine or essential amino acids, early synthesis matched 25 g whey, but only whey sustained it at 3–5 h after exercise (184% vs 55% and 35%)',
          note: '20–25 g of whey supplies about 2.2–2.7 g of leucine.',
          referenceIds: ['churchwardvenne2014', 'churchwardvenne2012', 'pinckaers2021'],
        },
      ],
      timeCourse:
        'Synthesis starts to rise after a latency of about 0.5 hours, peaks at 45–120 minutes with fast protein, and can stay raised for more than 12 hours after very large slowly digested meals.',
      moderators:
        'Age (a higher per-meal amount in older people), protein speed and quality, leucine content, and prior exercise.',
      grade: 'B',
      gradeReason:
        'Several human tracer studies agree on the shape, though each covers a limited range of doses and populations.',
      status: 'established',
      caveats:
        "Whether there is a per-meal ceiling is debated. Across 1, 2, 3 or 4 or more meals the 24-hour synthesis total differed by about 35% or less at 1.6–2.2 g/kg/d in Vitals' model, and chronic lean-mass differences are small when total protein is adequate.",
      referenceIds: [
        'moore2015',
        'witard2014',
        'macnaughton2016',
        'trommelen2023',
        'kim2016b',
        'holwerda2019',
        'bohe2001',
        'atherton2010',
        'churchwardvenne2014',
        'churchwardvenne2012',
        'pinckaers2021',
      ],
      relatedMetricIds: ['mps', 'autophagyIdx'],
    },
    {
      id: '03-hourly-muscle-protein-balance',
      title: 'Hour-by-hour muscle protein balance model (proposed)',
      category: 'cellular',
      summary:
        'To show how meals, training and energy status play out within a day, Vitals adds an hourly model of muscle protein synthesis, breakdown and net balance. Meals feed a digestion model, amino acids appear in the blood with a lag, and synthesis responds to them with a saturating curve and a refractory (muscle-full) state. Training raises sensitivity for 12–48 hours. Its results are re-scaled each day to match the daily model.',
      howModelled:
        "The hourly layer is driven by meal protein, digestion speed, quality, energy status and training state. Its 24-hour net balance is re-normalised each day so that it equals the daily layer's change in muscle protein. Otherwise every extra gram of protein would turn into muscle, because acute synthesis differences do not predict chronic growth well.",
      equation: `dG_i/dt = −V_i,   V_i = Vmax · s_i · G_i/(Km + G_i),   G_i(t_i) = P_i
Ra_q = Σ Q_i · F_sys · V_i,   dA_lag/dt = (Ra_q − A_lag)/τ_lag
S(t) = x^n/(K_age^n + x^n),   x = A_lag/FFM,   K_age = K · (1 + 0.67·clamp((age − 30)/40, 0, 1))
dR/dt = k_R · S^m · (1 − R) − R/τ_R
MPS = s0·f_E,MPS·AR_basal·(1 + a_X·X_RT) + s0·f_E,MPS·AR_fed·A·S·(1 − R)·(1 + b_X·X_RT)
MPB = b0·(1 − supp_ins − 0.10·S)·(1 + c_X·X_RT,b)·F_fast(t_fast)·(1 − 0.25·min(BHB,3)/3)
supp_ins = 0.5·clamp((Ins − 5)/25, 0, 1),   F_fast = 1 + 0.5·clamp((t_fast − 16)/44, 0, 1)
NET = MPS − MPB;   E_dist,hourly = clamp((AI_day/AI_ref)^γ, 0.85, 1.05),   γ = 0.3`,
      keyNumbers: [
        {
          label: 'Digestion model',
          value:
            'Vmax 11 g/h, Km 20 g, F_sys 0.66, latency τ_lag 0.5 h; speed factors whey 1.6, milk and most mixed meals 1.0, casein and fibre- or fat-rich meals 0.8, free amino acids 2.0',
          note: 'The speed factors are assumptions with unverified magnitudes. The fit predicts 48/63/66% of 25 g appearing at 4/8/12 h (observed 51/62/66%) and 23/44/58% for 100 g (observed 26/44/53%).',
          referenceIds: ['trommelen2023'],
        },
        {
          label: 'Synthesis parameters',
          value:
            's0 = 0.045 %/h; K = 0.07 g/kg FFM/h; n = 4; A = 2.0 (× basal); k_R = 2.0 /h, m = 4, τ_R = 4.5 h',
          note: 'Peak fed synthesis is about three times basal. Basal rates come from human data (0.036–0.045, 0.041 %/h).',
          referenceIds: ['phillips1999', 'witard2014', 'atherton2010', 'bohe2001'],
        },
        {
          label: 'Breakdown parameters',
          value:
            'b0 about 0.080 %/h (solved so the reference day balances); insulin suppression up to half at 30 mU/L or more',
          note: "Breakdown is less dynamic than synthesis and is mainly modulated by insulin, amino acids and exercise. Muscle is the body's principal amino-acid reservoir in fasting.",
          referenceIds: ['phillips1999', 'hector2018b', 'greenhaff2008', 'tipton2018', 'wolfe2006'],
        },
        {
          label: 'Training sensitisation',
          value:
            'a_X = 1.1, b_X = 1.5, τ_on = 1 h; τ_X = 36 h untrained and 12 h trained; c_X = 0.3 with 24 h untrained, 0 trained',
          note: 'Based on +112% at 3 h, +65% at 24 h, +34% at 48 h (untrained); +109% at 24 h and about +14% (not significant) at 36 h in another study; a trained leg back to rest by 28 h; and fed synthesis 3.1× vs 2.3× for 3 sets vs 1 set.',
          referenceIds: ['phillips1997', 'macdougall1995', 'tang2008', 'burd2010', 'burd2011'],
        },
        {
          label: 'Grid-fit targets and model result (young, whey)',
          value:
            '10 g vs 0 g: observed ≈ 1.1, model 1.09; 20 g: 1.49 vs 1.54; 40 g: 1.56 vs 1.63; 100 g vs 25 g, 0–4 h: ≈ 1.20 vs 1.23; 4–12 h: ≈ 1.40 vs 1.41; 48 g whey at rest: ≈ 1 vs 1.28',
          note: 'Misses: 4 × 20 g vs 8 × 10 g over 12 h, observed 1.31 vs model 0.93; 4 × 20 g vs 2 × 40 g, 1.48 vs 1.18; a 24-hour even-vs-skewed comparison, 1.25 vs about 1.08.',
          referenceIds: ['witard2014', 'trommelen2023', 'atherton2010', 'areta2013', 'mamerow2014'],
        },
        {
          label: 'Model output for a 24-hour fast',
          value:
            'NET ≈ −0.85 %/d of muscle protein (≈ −50 g muscle protein/d for 6 kg), or ≈ −0.53 %/d with BHB 2 mM',
          note: "The reference day balances by construction. This is the model's own output, not a measurement.",
        },
        {
          label: 'Absorption range check',
          value:
            '100 g gives about 4–7 g/h reaching the blood for over 12 h, inside the reported 1.3–10 g/h intestinal absorption range',
          referenceIds: ['bilsborough2006'],
        },
      ],
      timeCourse:
        'Time steps are 0.05–0.25 h inside the model. Feeding stimulus lags by about 0.5 h, the refractory state recovers with a 4.5 h time constant, and training sensitisation decays with 36 h (untrained) or 12 h (trained).',
      moderators:
        'Age (per-meal amount), energy status, insulin, ketones, training state and time since the last protein-containing meal.',
      grade: 'C',
      gradeReason:
        'The structure is based on grade-B tracer physiology, but the parameters are our own fits.',
      status: 'proposed-fit',
      caveats:
        'The model reproduces dose-response, the long response to large slow meals and part of the muscle-full effect, but not the penalty for frequent 10 g doses or the full effect of skewed intake. The refractory constants are poorly identified. Acute synthesis correlates with hypertrophy only after about 3 weeks of training.',
      referenceIds: [
        'trommelen2023',
        'phillips1999',
        'witard2014',
        'atherton2010',
        'bohe2001',
        'hector2018b',
        'greenhaff2008',
        'phillips1997',
        'macdougall1995',
        'tang2008',
        'burd2010',
        'burd2011',
        'areta2013',
        'mamerow2014',
        'bilsborough2006',
        'tipton2018',
        'wolfe2006',
      ],
      relatedMetricIds: ['mps'],
    },
    {
      id: '03-resistance-exercise-turnover',
      title: 'How resistance exercise changes muscle protein turnover',
      category: 'recovery',
      summary:
        'A bout of resistance exercise raises muscle protein synthesis for about a day or two. In untrained people, it stays raised for longer and breakdown rises too. In trained people the response is shorter and breakdown does not rise. More sets give a larger and longer response, and one bout makes muscle more sensitive to protein for at least a day.',
      howModelled:
        'The hourly model uses these data for its exercise-sensitisation term: a rapid onset, then a decay over 36 hours in untrained and 12 hours in trained people. Early in a new programme, muscle protein synthesis is directed to repair rather than growth.',
      keyNumbers: [
        {
          label: 'Untrained, fasted (after exercise)',
          value:
            'Synthesis +112% at 3 h, +65% at 24 h, +34% at 48 h; breakdown +31%, +18%, baseline by 48 h; net balance improved but stayed negative without food (rest −0.0573, 3 h −0.0298, 24 h −0.0413, 48 h −0.0440 %/h)',
          referenceIds: ['phillips1997'],
        },
        {
          label: 'Elbow flexors, another study',
          value: 'Synthesis +50% at 4 h, +109% at 24 h, back within 14% of control by about 36 h',
          referenceIds: ['macdougall1995'],
        },
        {
          label: 'Effect of training status',
          value:
            'After 8 weeks of training, synthesis +162% at 4 h but at resting level by 28 h in the trained leg; the untrained leg was still +70% at 28 h. Trained people show a smaller rise (0.045 → 0.067 vs 0.036 → 0.080 %/h) and no rise in breakdown',
          referenceIds: ['tang2008', 'phillips1999'],
        },
        {
          label: 'Volume',
          value: '3 sets vs 1 set: fed synthesis 3.1× vs 2.3× at 5 h; 2.3× vs baseline at 29 h',
          referenceIds: ['burd2010'],
        },
        {
          label: 'Sensitisation to protein',
          value:
            'Exercise to failure sensitised muscle to 15 g whey 24 h later (fed increment 0.016 → 0.038–0.041 %/h)',
          referenceIds: ['burd2011'],
        },
        {
          label: 'Early training',
          value:
            'Muscle protein synthesis in early training goes to damage repair; it correlated with hypertrophy (r ≈ 0.9) only at weeks 3 and 10',
          referenceIds: ['damas2016'],
        },
        {
          label: 'Energy deficit',
          value: 'A single bout restored muscle protein synthesis to energy-balance values',
          referenceIds: ['areta2014'],
        },
      ],
      timeCourse:
        'Rise within hours, still raised at 24 hours, and near baseline by 36–48 hours in untrained people; shorter in trained people.',
      moderators: 'Training status, number of sets, and whether the person is fed.',
      grade: 'B',
      gradeReason:
        'Several human tracer studies agree on the time course, though they differ in size and shape.',
      status: 'established',
      caveats:
        'The hypertrophy dose-response itself belongs to the resistance-training topic; this entry only covers turnover kinetics.',
      referenceIds: [
        'phillips1997',
        'macdougall1995',
        'tang2008',
        'phillips1999',
        'burd2010',
        'burd2011',
        'damas2016',
        'areta2014',
      ],
      relatedMetricIds: ['mps', 'mtorIdx'],
    },
    {
      id: '03-protein-distribution-timing',
      title: 'Protein spacing, meal frequency, eating windows and timing',
      category: 'body',
      summary:
        'Acute studies show that the pattern of protein across the day changes muscle protein synthesis by a few tens of per cent. Long trials mostly find little or no difference in lean mass when total protein is adequate. So total daily protein dominates, and spacing or timing matters more when total protein is marginal, when fasts are long, or in older adults.',
      howModelled:
        'A distribution-efficiency factor counts how many meals reach the per-meal threshold and how long the eating window is. It multiplies only the training-driven gain. There is no bonus for timing around a workout or bedtime beyond what total protein provides. Long daily fasts add a small extra loss of lean tissue.',
      equation: `n_eff = number of meals with quality-weighted protein ≥ max(0.28 g/kg FFM × (1 + 0.8·clamp((age − 30)/40, 0, 1)) × FFM, 15 g), at least 3 h apart; capped at 3
E_dist = 1 − 0.06·(3 − n_eff) − 0.05·clamp((8 − W)/4, 0, 1)      (range 0.83–1.0; W = eating window in hours)
ΔL_fastExtra (kg/d) = −k_f · max(0, t_fast,max − 16 h) · (p0/0.4) · (1 − 0.6·x_P) · M_RT,   k_f = 1.0 g lean per hour beyond 16 h (range 0–3)`,
      keyNumbers: [
        {
          label: '24 trained men, 80 g whey over 12 h after exercise (8 × 10 g / 4 × 20 g / 2 × 40 g)',
          value: 'Mean synthesis rate 0.060 / 0.079 / 0.053 %/h; the 4 × 20 g pattern was 31–48% higher',
          referenceIds: ['areta2013'],
        },
        {
          label: '8 adults, 7 days, 90 g/d evenly (31.5/29.9/32.7 g) vs skewed (10.7/16.0/63.4 g)',
          value: '24-hour mixed synthesis 0.075 vs 0.056 %/h (+25%), still present on day 7 (0.077 vs 0.056)',
          referenceIds: ['mamerow2014'],
        },
        {
          label: 'Older adults',
          value:
            'At 0.8 vs 1.5 g/kg with uneven 15/20/65% vs even 33/33/33% intake, net balance 94.8 vs 58.9 g/750 min (dose effect) with no distribution effect (20 adults, 52–75 y). In 14 older adults over 8 weeks at 1.1 g/kg, even vs uneven made no difference to lean mass, strength or function',
          referenceIds: ['kim2015', 'kim2018'],
        },
        {
          label: '26 young men, 12 weeks of training at 1.30 g/kg/d, breakfast protein 0.33 vs 0.12 g/kg',
          value:
            'Lean tissue mass +2.5 ± 0.3 vs +1.8 ± 0.3 kg (p = 0.06, d = 0.80), favouring the more even pattern',
          referenceIds: ['yasuda2020'],
        },
        {
          label: 'Time-restricted eating with training (34 men, 8 weeks, 16/8, about 1.9 g/kg)',
          value:
            'Fat-free mass +0.64 vs +0.48 kg (not significant); fat mass −1.62 vs −0.30 kg. In 40 trained women (8 weeks, 12:00–20:00, 1.6 g/kg) fat-free mass rose 2–3% in all groups, no difference',
          referenceIds: ['moro2016', 'tinsley2019'],
        },
        {
          label: 'Other compressed-window studies',
          value:
            'One meal a day vs 3 (8-week crossover, 14.5% protein): fat-free mass 50.9 vs 49.4 kg (not significant). 16:8 without a protein target, 12 weeks: lean −1.10 kg, about 65% of −1.70 kg lost in the in-person group',
          referenceIds: ['stote2007', 'lowe2020', 'tinsley2017'],
        },
        {
          label: 'Alternate-day fasting vs daily restriction in lean adults, 3 weeks',
          value:
            '75% daily: weight −1.91 ± 0.99 kg, fat −1.75 ± 0.79 (non-fat ≈ −0.16). Alternate 0/150%: weight −1.60 ± 1.06, fat −0.74 ± 1.32 (non-fat ≈ −0.86)',
          referenceIds: ['templeman2021'],
        },
        {
          label: 'Meta-analysis of 28 trials, intermittent vs continuous restriction',
          value:
            'Fat-free mass −0.20 kg (−0.39, −0.01) more with intermittent restriction; time-restricted eating reduced it more than continuous restriction',
          referenceIds: ['schroor2024'],
        },
        {
          label: 'Protein-timing meta-analysis (hypertrophy effect size)',
          value:
            'Unadjusted difference 0.24 ± 0.10 (95% CI 0.04–0.44) favouring timed protein; after adjustment 0.16 ± 0.11 (−0.07, 0.38), not significant; fat-free mass only 0.08 ± 0.07, not significant',
          note: 'Total protein intake explained the apparent timing effect. 25 g just before vs just after training in 21 trained men over 10 weeks made no difference.',
          referenceIds: ['schoenfeld2013', 'schoenfeld2017'],
        },
        {
          label: 'Pre-sleep protein (acute)',
          value:
            '40 g casein before sleep raised overnight protein synthesis (311 ± 8 vs 246 ± 9 µmol/kg per 7.5 h), net balance (61 ± 5 vs −11 ± 6) and mixed muscle synthesis by about 22% (0.059 vs 0.048 %/h, p = 0.05). In older men 40 g, not 20 g nor 20 g plus 1.5 g leucine, raised overnight synthesis (0.044 vs 0.033 %/h)',
          referenceIds: ['res2012', 'kouw2017'],
        },
        {
          label: 'Pre-sleep protein (12 weeks of training)',
          value: '27.5 g pre-sleep: strength +164 vs +130 kg, quadriceps area +8.4 vs +4.8 cm²',
          note: 'Total daily protein was higher in the protein group, and a review concluded chronic benefits are confounded by unequal total protein.',
          referenceIds: ['snijders2015', 'reis2021'],
        },
        {
          label: 'Review of the distribution evidence',
          value:
            'Described as limited and inconsistent; at 0.8–1.3 g/kg, having at least one meal that reaches the per-meal threshold matters more than how evenly protein is spread',
          referenceIds: ['hudson2020b'],
        },
        {
          label: 'Distribution efficiency from the hourly model (80 / 128 / 176 g per day)',
          value:
            'One meal 0.94 / 0.88 / 0.86; two meals 6 h apart 1.00 / 0.94 / 0.95; three even meals 1.00 (reference); three meals in a 6-hour window 0.96 / 0.88 / 0.90; six meals 1.02 / 0.98 / 0.95',
          referenceIds: ['trommelen2023'],
        },
      ],
      timeCourse:
        'Distribution penalties act on the daily training credit. The extra loss from long fasts applies to time-restricted or one-meal schedules at unchanged daily energy.',
      moderators:
        'Total protein (dominant), age (a higher per-meal threshold), length of fasts, and whether at least one meal reaches the per-meal threshold when total protein is marginal (0.8–1.3 g/kg).',
      grade: 'C',
      gradeReason:
        'The conclusion that total daily protein dominates is grade B, but the distribution penalty and the extra fasting loss are grade C, our own judgement.',
      status: 'contested',
      caveats:
        "Acute synthesis differences (+25% and +31–48%) are much larger than the mostly null 8–12 week trials. The shrinkage (γ = 0.3) and the E_dist formula are judgement, with an uncertainty of 0 to 2 times the default penalty. Hudson's review calls the evidence limited and inconsistent.",
      referenceIds: [
        'areta2013',
        'mamerow2014',
        'kim2015',
        'kim2018',
        'yasuda2020',
        'moro2016',
        'tinsley2019',
        'stote2007',
        'lowe2020',
        'tinsley2017',
        'templeman2021',
        'schroor2024',
        'schoenfeld2013',
        'schoenfeld2017',
        'res2012',
        'kouw2017',
        'snijders2015',
        'reis2021',
        'hudson2020b',
        'trommelen2023',
      ],
      relatedMetricIds: ['rtMuscleGain'],
    },
    {
      id: '03-protein-quality-diaas',
      title: 'Protein quality: amino acids, leucine, plant and animal sources',
      category: 'body',
      summary:
        'Muscle needs a leucine signal and a complete set of essential amino acids. How much of a protein is usable depends on how well it is digested and on its scarcest essential amino acid (measured as DIAAS). Quality matters acutely and at marginal intakes. At 1.6 g per kilogram a day or more from mixed sources, trials find little difference between plant and animal protein for lean mass and strength.',
      howModelled:
        'Each protein source has a daily quality multiplier used for the requirement and the training curve, and a meal multiplier used in the hourly model, built from its digestibility score and leucine content. Free essential amino acids count as roughly twice their weight in high-quality protein for the meal signal, branched-chain amino acids as a partial signal, and collagen as a low-value source.',
      equation: `Q_meal = sqrt(min(1, DIAAS_adult)) · min(1.15, sqrt(Leu%/8.0))       (proposed)
P_eff = Σ P_i · Q_daily,i`,
      keyNumbers: [
        {
          label: 'DIAAS (0.5–3 y pattern, limiting amino acid) → adult value (derived)',
          value:
            'Whey 85 (His) → ≈ 106; casein 117 → ≈ 137; egg 101 → ≈ 111; pork 117 → ≈ 126; soy 91 (SAA) → ≈ 102; potato 100 → ≈ 125; pea 70 (SAA) → ≈ 82; oat 57 (Lys) → ≈ 68; wheat 48 (Lys) → ≈ 57; rice 47 (Lys) → ≈ 56; corn 36 (Lys) → ≈ 43',
          note: 'The adult values are derived by Vitals by rescaling with amino-acid scoring patterns that were quoted from memory and are unverified.',
          referenceIds: ['herreman2020', 'mathai2017'],
        },
        {
          label: 'Leucine as a percentage of protein',
          value:
            'Whey 11.0; milk 9.0; casein 8.0; egg 7.0; pork muscle 7.6; soy 6.9; potato 8.3; pea 7.2; oat 5.9; wheat 6.1; rice 7.4; corn 13.5',
          referenceIds: ['pinckaers2021', 'gorissen2018'],
        },
        {
          label: 'Daily quality multiplier / meal multiplier (proposed)',
          value:
            'Whey 1.00 / 1.15; milk protein 1.00 / 1.06; egg 1.00 / 0.94; soy 1.00 / 0.93; pea 0.82 / 0.86; oat 0.68 / 0.71; wheat 0.57 / 0.66; rice 0.56 / 0.72; corn 0.43 / 0.75; pea-rice blend 0.95 / 0.93; mixed whole-food plant-only diet 0.90 / 0.85; collagen 0.3 / 0.25',
          note: 'The pea-rice blend adult score of about 95 is unverified. Consequence: a plant-only diet at 1.0 g/kg gives about 9% less training-driven gain than an omnivore diet, and about 2% less at 1.6 g/kg.',
          referenceIds: ['herreman2020'],
        },
        {
          label: 'Amount of protein needed for 2.7 g leucine',
          value:
            'About 20 g corn, 25 g whey, 33 g potato, 37 g brown rice, 38 g pea, 40 g soy, 45 g wheat, 71 g quinoa protein',
          note: 'Plant proteins are lower in essential amino acids (oat 21%, lupin 21%, wheat 22% vs whey 43%, milk 39%, casein 34%, egg 32%, muscle 38%), methionine (1.0 ± 0.3% vs 2.5 ± 0.1%) and lysine (3.6 ± 0.6% vs 7.0 ± 0.6%).',
          referenceIds: ['pinckaers2021', 'gorissen2018'],
        },
        {
          label: 'Soy vs animal protein in trials with training (9 trials, n = 266)',
          value: 'No difference in lean mass or strength',
          note: 'A meta-analysis of 16 trials found no difference in absolute lean mass or strength overall, and +0.41 kg (0.08–0.74) in people under 50 favouring animal protein. In 12 weeks at 1.6 g/kg/d, people who habitually eat no animal foods (soy) and omnivores (whey) both gained about +1.2 kg of leg lean mass (+1.2 ± 1.0 vs +1.2 ± 0.8).',
          referenceIds: ['messina2018', 'lim2021', 'hevialarrain2021'],
        },
        {
          label: 'In energy restriction',
          value: 'Whey preserved postprandial muscle synthesis better than soy (−9% vs −28%)',
          referenceIds: ['hector2015'],
        },
        {
          label: 'Branched-chain amino acids alone',
          value:
            '5.6 g raised muscle protein synthesis by 22% (0.110 vs 0.090 %/h), about half the response to 20–25 g of whey',
          note: 'They cannot sustain synthesis without the other essential amino acids. The engine counts them as a partial signal with a daily quality of about 0.4 for nitrogen (proposed).',
          referenceIds: [
            'jackman2017',
            'wolfe2017',
            'churchwardvenne2012',
            'churchwardvenne2014',
            'kouw2017',
          ],
        },
        {
          label: 'Collagen',
          value:
            'Lactalbumin raised muscle synthesis 13 ± 5% more than collagen with the same nitrogen; whey and collagen (2 × 30 g/d) protected leg lean mass equally during restriction with reduced steps in older adults, but only whey restored lean mass and synthesis on recovery; 15 g/d of collagen peptides with training in 53 sarcopenic men: fat-free mass +4.2 ± 2.3 vs +2.9 ± 1.8 kg (the placebo group had no supplemental protein, so total protein differed)',
          note: 'Muscle connective-protein synthesis rose after 25 and 100 g of milk protein with no rise in plasma glycine, so glycine-rich collagen is not required.',
          referenceIds: ['oikawa2020', 'oikawa2018', 'zdzieblik2015', 'trommelen2023'],
        },
        {
          label: 'Free essential amino acids',
          value:
            'For the per-meal signal, 1 g of free essential amino acids counts as about 2 g of high-quality intact protein (Q_meal about 2.0); for daily nitrogen adequacy, 1 g counts as 1 g of protein (proposed)',
          referenceIds: ['gorissen2018'],
        },
      ],
      timeCourse:
        'Meal quality acts on the hourly response, and daily quality acts on the requirement and the training curve.',
      moderators:
        'Total protein (quality matters most at marginal intakes), protein source mix, digestion speed, and energy restriction.',
      grade: 'C',
      gradeReason:
        'Quality effects are well shown acutely (grade B), but the chronic effects are grade C and the adult-pattern scores and multipliers are derived or proposed.',
      status: 'proposed-fit',
      caveats:
        'The adult DIAAS values and the meal multipliers are derived by Vitals, with unverified pattern constants. Whole-food matrix effects are ignored. Some positive collagen data are confounded by total protein.',
      referenceIds: [
        'herreman2020',
        'mathai2017',
        'pinckaers2021',
        'gorissen2018',
        'messina2018',
        'lim2021',
        'hevialarrain2021',
        'hector2015',
        'jackman2017',
        'wolfe2017',
        'churchwardvenne2012',
        'churchwardvenne2014',
        'kouw2017',
        'oikawa2018',
        'oikawa2020',
        'zdzieblik2015',
        'trommelen2023',
      ],
      relatedMetricIds: ['mps', 'rtMuscleGain'],
    },
    {
      id: '03-fasting-protein-loss-sparing',
      title: 'Protein loss and protein sparing during fasting',
      category: 'fuel',
      summary:
        'In the first days of a fast, falling insulin and rising stress hormones send amino acids out of muscle to feed glucose production. As ketones rise over days 3–17, the brain needs less glucose, and protein burning falls to a low obligatory minimum. Ketones themselves reduce protein breakdown. Fasting still costs some lean tissue, and early carbohydrate spared protein more than early ketosis did.',
      howModelled:
        'When intake is under 30% of expenditure and protein is very low, the engine uses a fasting branch: protein oxidation starts high and falls exponentially towards a minimum, faster with more ketones and lower with some carbohydrate. Lean tissue loss follows from oxidation minus any dietary protein. Early loss is split between muscle and other lean tissue.',
      equation: `Pox_min = 0.52 · (1 + 0.5·L)          g/kg FFM/d
Pox_0 = 0.90                           g/kg FFM/d at fast onset (range 0.7–1.2; unverified)
Pox(t) = Pox_min + (Pox_0 − Pox_min)·exp(−t_f/τ_N),   τ_N = 3 d
τ_N,eff = τ_N · 2/(1 + clamp(BHB/2 mM, 0, 1))
Pox × (1 − 0.3·clamp(CHO_g/100, 0, 1))   for t_f < 7 d   (carbohydrate sparing)
ΔL_tis (kg/d) = −(Pox·FFM − 0.3·P_eff_diet)/(1000·c_P);   N loss (g/d) = Pox·FFM/6.25`,
      keyNumbers: [
        {
          label: '60-hour fast (15 postabsorptive vs 7 fasted non-obese subjects)',
          value: 'Forearm muscle amino-acid release +69%, alanine +59%; insulin 11.3 → 7.5 µU/mL',
          referenceIds: ['pozefsky1976'],
        },
        {
          label: '72-hour fast (8 men)',
          value:
            'Increased forearm net phenylalanine release; mTOR phosphorylation −50%; LC3B-II +30%; MAFbx/MuRF1 unchanged; insulin-stimulated mTOR signalling blunted',
          referenceIds: ['vendelbo2014'],
        },
        {
          label: 'Prolonged fasting (obese)',
          value:
            'Glucose production about 86 g/d (half liver, half kidney) over 5–6 weeks; alanine falls most in week 1, reducing glucose substrate and protein breakdown',
          referenceIds: ['owen1969', 'felig1969'],
        },
        {
          label: '21-day fast in 5 obese subjects',
          value:
            'Fat-free mass and fat lost in parallel; late amino-acid oxidation about 7% of energy; minimum obligatory oxidation 0.27 ± 0.08 g/kg body weight/d = 0.52 ± 0.10 g/kg FFM/d',
          referenceIds: ['owen1998'],
        },
        {
          label: 'Nitrogen loss in total fasting',
          value:
            'Biexponential, with a fast component of a few days and a slow component of many months. Nitrogen lost per kg weight lost about 20 g (non-obese) vs about 10 g (fat mass 50 kg or more); lean-tissue fraction about 0.61 vs about 0.30',
          referenceIds: ['forbes1979'],
        },
        {
          label: '16 men, 10 days at 200–250 kcal/d',
          value:
            'Weight −5.9 kg: fat −2.34 kg (40%), lean soft tissue −3.53 kg (60%) = extracellular water −1.6 kg (44%), glycogen plus water −0.50 kg (14%), metabolically active tissue −1.5 kg (25% of weight loss). Nitrogen excretion fell 41 ± 7% by day 5 then stayed stable',
          referenceIds: ['laurens2021'],
        },
        {
          label: 'Ketone infusions',
          value:
            'Sodium β-hydroxybutyrate (1.1–1.2 mM) lowered alanine 21% (3 h) and 37% (6 h); in subjects fasted 5–10 weeks, 12-hour infusions reduced urinary nitrogen by 30%. β-hydroxybutyrate reduced leucine oxidation by 30% (18–41%) and raised muscle protein synthesis by 10% (5–17%). During inflammation 3.5 mM cut net forearm phenylalanine release by more than 70%',
          referenceIds: ['sherwin1975', 'nair1988', 'thomsen2018'],
        },
        {
          label: '500 kcal diets for 5–8 weeks in obese women',
          value:
            '1.5 g/kg ideal weight protein: nitrogen balance 0 after 3 weeks; 0.8 g/kg plus 0.7 g/kg carbohydrate: −2 g N/d',
          referenceIds: ['hoffer1984'],
        },
        {
          label:
            'Very-low-carbohydrate diet with vs without ketosis (600 kcal, 8 g N/d, 4 weeks, morbidly obese women)',
          value:
            'Cumulative nitrogen balance −50.4 ± 4.4 vs −18.8 ± 5.7 g N (worse with ketosis); leucine oxidation higher on the diet that produced ketosis; breakdown markers similar',
          note: 'So early carbohydrate spares protein more than early ketosis does.',
          referenceIds: ['vazquez1992'],
        },
        {
          label: 'Cross-check, 70 kg non-obese man (FFM 57 kg)',
          value:
            'Day-1 nitrogen loss about 8.2 g and day-10 about 6.2 g N/d; lean-tissue loss about 0.25 → 0.19 kg/d',
          note: 'Early loss is allocated 60% muscle / 40% non-muscle lean tissue in the first 3 days and 80 / 20 after that (proposed, grade D; no direct human data). The first week of any very-low-energy diet is expected to run at −2 to −4 g N/d regardless.',
          referenceIds: ['forbes1979', 'hoffer1984'],
        },
      ],
      timeCourse:
        "Nitrogen loss falls by about 41% by day 5 and then plateaus; the model uses a time constant of 3 days, faster with higher ketones. The model's early muscle-only allocation probably overestimates muscle loss, because splanchnic and visceral protein also contribute early.",
      moderators:
        'Leanness (leaner people have a higher minimum), ketone level, dietary carbohydrate in the first week, and dietary protein.',
      grade: 'C',
      gradeReason:
        'Fasting physiology and ketone sparing are grade B, but the parameterisation (starting oxidation and the lean-versus-obese scaling) is weakly sourced, grade C.',
      status: 'proposed-fit',
      caveats:
        'The size of the ketone effect comes from infusion studies, some supraphysiological or in inflammation, so how much protein sparing nutritional ketosis gives by itself is uncertain. The muscle-versus-organ split of early loss is grade D.',
      referenceIds: [
        'pozefsky1976',
        'vendelbo2014',
        'owen1969',
        'felig1969',
        'owen1998',
        'forbes1979',
        'laurens2021',
        'sherwin1975',
        'nair1988',
        'thomsen2018',
        'hoffer1984',
        'vazquez1992',
      ],
      relatedMetricIds: ['leanTissue', 'nitrogenBalance'],
    },
    {
      id: '03-anabolic-resistance',
      title: 'Anabolic resistance: ageing, inactivity and obesity',
      category: 'body',
      summary:
        'Muscle responds less to protein and to exercise in older age, after periods of inactivity or immobilisation, and in obesity. Older people need more protein per meal to reach the same response. A few days of little movement or a cast cost a measurable share of muscle, and the response to a meal is lower.',
      howModelled:
        'Multipliers reduce the response of muscle to a meal and to training for older age, very low step counts, immobilisation and obesity. Age also raises the per-meal threshold, and a small age-related background loss of lean tissue is added, which training mostly offsets.',
      equation: `K_age = K·(1 + 0.67·clamp((age − 30)/40, 0, 1))
AR_age = 1 − 0.25·clamp((age − 30)/40, 0, 1)
AR_fed = 0.74 while steps < 1500 per day (older);  AR_basal = 0.59 and AR_fed = 0.47 for an immobilised muscle
AR_fed,obesity = 0.63 at BMI ≥ 30, linear from 1.0 at BMI 25
ΔL_age = −0.4 g lean/d × clamp((age − 45)/20, 0, 1.5) × (1 − 0.8·RT)`,
      keyNumbers: [
        {
          label: 'Ageing',
          value:
            'Per-meal breakpoint 0.24 → 0.40 g/kg BM (young vs about 71 y), basal synthesis unchanged; 40 g (not 20 g) casein pre-sleep raises overnight synthesis in 72-year-old men; 30 g or more after exercise is needed in 66-year-old men; the protein-supplement effect on fat-free mass is −0.01 kg per year',
          note: 'The per-meal threshold in the daily layer moves from 0.28 to 0.50 g/kg FFM. An expert consensus suggests 1.0–1.2 g/kg/d or more for older people.',
          referenceIds: ['moore2015', 'kouw2017', 'holwerda2019', 'morton2018', 'bauer2013'],
        },
        {
          label: 'Step reduction (10 older adults, 72 y, 14 days at 1413 ± 110 steps/d, −76%)',
          value:
            'Leg fat-free mass −3.9%, postprandial synthesis −26%, postabsorptive unchanged, insulin sensitivity −43%',
          note: 'The engine uses an onset time constant of 5 days and a recovery time constant of 7 days (both unverified), and a disuse loss of 0.28 %/d of leg lean mass.',
          referenceIds: ['breen2013'],
        },
        {
          label: 'Limb immobilisation in a cast',
          value:
            '5 days: quadriceps area −3.5 ± 0.5%; 14 days: −8.4 ± 2.8%; strength −9% and −23%. After 5 days, postabsorptive synthesis −41% (0.015 vs 0.032 %/h) and postprandial −53% (0.020 vs 0.044 %/h)',
          note: 'Mass loss is about 0.6–0.7 %/d of that muscle in the first 2 weeks.',
          referenceIds: ['wall2014', 'wall2016'],
        },
        {
          label: 'Bed rest (11 healthy 67-year-olds eating the RDA, 10 days)',
          value: 'Knee-extensor strength −13.2 ± 4.1%; maximal oxygen uptake −12%',
          note: 'A companion research letter gave about −1 kg leg lean mass and about −30% synthesis, but its numbers are unverified. Whole-body muscle loss is set at twice the step-reduction value (proposed).',
          referenceIds: ['kortebein2008', 'kortebein2007'],
        },
        {
          label: 'Obesity',
          value:
            'After 36 g pork protein, synthesis over 0–300 min was 1.6-fold greater in healthy-weight people than in people with overweight or obesity; after exercise plus 36 g protein, the change was 0.10 (normal weight) vs 0.06 %/h (obese) in the exercised leg',
          referenceIds: ['beals2016', 'beals2018'],
        },
        {
          label: 'Insulin resistance and type 2 diabetes',
          value:
            'Insulin lowers breakdown (weighted mean difference −15.5) and permits synthesis only when amino acids rise; in diabetes with maintained amino acids, insulin lowered synthesis (−6.7)',
          referenceIds: ['abdulla2016'],
        },
        {
          label: 'Background loss with age',
          value:
            'About 1.5 kg of fat-free mass per decade at stable weight; skeletal muscle declines noticeably after the fifth decade',
          referenceIds: ['heymsfield2014', 'janssen2000'],
        },
      ],
      timeCourse:
        'Onset over days (5 days for step reduction) and recovery over about 7 days; the constants are unverified.',
      moderators: 'Age, activity or immobilisation, BMI and insulin resistance.',
      grade: 'C',
      gradeReason:
        'The acute anabolic resistance is grade B, but the multipliers and time constants are proposed and partly unverified, grade C.',
      status: 'proposed-fit',
      caveats:
        'The time constants for onset and recovery after reduced steps or bed rest are unverified. The obesity term is grade B/C.',
      referenceIds: [
        'moore2015',
        'kouw2017',
        'holwerda2019',
        'morton2018',
        'bauer2013',
        'breen2013',
        'wall2014',
        'wall2016',
        'kortebein2008',
        'kortebein2007',
        'beals2016',
        'beals2018',
        'abdulla2016',
        'heymsfield2014',
        'janssen2000',
      ],
      relatedMetricIds: ['mps', 'leanTissue'],
    },
    {
      id: '03-surplus-protein-lean-gain',
      title: 'Protein and lean gain when eating in surplus',
      category: 'body',
      summary:
        'With about 40% extra energy and no training, gaining lean mass needed protein at 15% of energy or more. Going from 15% to 25% added little, and 5% led to lean loss despite the surplus. Fat gain did not depend on protein. In trained people, protein at 3.4–4.4 g per kilogram a day for weeks to a year did not raise fat mass in the studies below.',
      howModelled:
        'In a surplus, lean accretion is the smaller of the partition of the surplus and the protein cap, plus the training credit (with no energy penalty). Protein above about 2.0–2.2 g per kilogram a day adds no lean mass, and most of the extra protein energy is dissipated as heat.',
      keyNumbers: [
        {
          label: 'Overfeeding by 40% without training (25 adults, 8 weeks)',
          value: '5% protein: lean loss; 15%: +2.87 kg; 25%: +3.18 kg; fat gain independent of protein',
          referenceIds: ['bray2012'],
        },
        {
          label: 'Trained people, 4.4 g/kg/d (307 ± 69 g/d) for 8 weeks with unchanged training',
          value: 'No change in body weight, fat mass or fat-free mass (Bod Pod)',
          referenceIds: ['antonio2014'],
        },
        {
          label: '3.4 vs 2.3 g/kg/d plus periodised heavy training, 8 weeks',
          value:
            'Body weight −0.1 vs +1.3 kg; fat mass −1.7 vs −0.3 kg; fat-free mass +1.5 vs +1.5 kg despite higher energy intake in the high-protein group',
          referenceIds: ['antonio2015'],
        },
        {
          label: '1-year crossover, 2.51 vs 3.32 g/kg/d (34.4 vs 29.9 kcal/kg/d)',
          value: 'No fat-mass gain and no adverse lipid, liver or kidney markers',
          referenceIds: ['antonio2016'],
        },
      ],
      timeCourse:
        'The cap applies each day; it is a ceiling on lean accretion rather than a time-dependent process.',
      moderators: 'Protein intake, energy surplus, training and body composition.',
      grade: 'B',
      gradeReason: 'A controlled ward trial and three trained-population studies agree on the direction.',
      status: 'established',
      caveats:
        'Surplus protein energy is probably less fattening than surplus carbohydrate or fat (grade C). Bray found identical fat gain at 15% and 25% protein, and the trained-population studies were free-living.',
      referenceIds: ['bray2012', 'antonio2014', 'antonio2015', 'antonio2016'],
      relatedMetricIds: ['leanTissue', 'fatMass'],
    },
    {
      id: '03-protein-other-effects',
      title: 'Other effects of protein: appetite, kidneys, bone and limits',
      category: 'body',
      summary:
        'Higher protein intake also changes appetite, energy expenditure, and possibly kidney and bone outcomes. In controlled studies, raising protein reduced free-choice energy intake, and lowering it raised intake. In healthy adults, higher protein did not change kidney filtration and did not harm bone. Very high intakes have theoretical limits in amino-acid absorption and liver urea synthesis.',
      howModelled:
        'These are interface effects handed to other topics: appetite effects go to the hunger model, digestion and glucose-production costs to energy expenditure, and safety limits to the safety topic.',
      keyNumbers: [
        {
          label: 'Satiety: 15% → 30% protein with constant carbohydrate (12 weeks, ad libitum)',
          value: 'Intake −441 ± 63 kcal/d; weight −4.9 ± 0.5 kg; fat mass −3.7 ± 0.4 kg',
          referenceIds: ['weigle2005'],
        },
        {
          label: 'Protein leverage: 15% → 10% protein over 4 days',
          value: 'Energy intake +12 ± 4.5%, mostly savoury snacks between meals; 15% → 25% made no change',
          referenceIds: ['gosby2011'],
        },
        {
          label: 'Digestion cost',
          value: 'Thermic effect 20–30% of protein energy vs 5–10% for carbohydrate and 0–3% for fat',
          referenceIds: ['westerterp2004'],
        },
        {
          label: 'Glucose-production cost',
          value:
            '30% protein and 0% carbohydrate: fractional glucose production 0.95 vs 0.64; absolute 171 vs 145 g/d (p = 0.06); resting metabolic rate 8.46 vs 8.12 MJ/d; the energy cost of glucose production is about 33% of glucose energy',
          referenceIds: ['veldhorst2009'],
        },
        {
          label: 'Kidneys in healthy people (28 trials, n = 1358)',
          value:
            'Higher protein (1.5 g/kg or more, or 20% of energy or more, or 100 g/d or more): change in filtration rate standardised difference 0.11 (−0.05, 0.27), not significant',
          note: 'Chronic kidney disease is a separate case, not covered here.',
          referenceIds: ['devries2018'],
        },
        {
          label: 'Bone',
          value:
            'Higher protein: lumbar spine bone mineral density +0.52% (0.06–0.97); no adverse effect at any site',
          referenceIds: ['shamswhite2017'],
        },
        {
          label: 'Upper limits',
          value:
            'Intestinal amino-acid absorption 1.3–10 g/h; suggested long-term maximum about 25% of energy (about 2–2.5 g/kg/d); a theoretical safe maximum of 285–365 g/d for 80 kg (liver urea synthesis); risk of hyperammonaemia or "rabbit starvation" when protein is above 35% of energy with too little fat and carbohydrate',
          note: 'In trained young adults, 3.3–4.4 g/kg/d was tolerated for 8 weeks to 1 year.',
          referenceIds: ['bilsborough2006', 'antonio2014', 'antonio2015', 'antonio2016'],
        },
      ],
      timeCourse: 'Not a single process; the appetite studies ran for 4 days to 12 weeks.',
      moderators: 'Protein share of energy, and kidney health for the safety data.',
      grade: 'B',
      gradeReason:
        'No single grade was given for this section. Each effect rests on a controlled trial or meta-analysis, so we show B.',
      status: 'established',
      caveats:
        'Each effect comes from a small number of studies. Kidney safety data do not apply to people with chronic kidney disease.',
      referenceIds: [
        'weigle2005',
        'gosby2011',
        'westerterp2004',
        'veldhorst2009',
        'devries2018',
        'shamswhite2017',
        'bilsborough2006',
        'antonio2014',
        'antonio2015',
        'antonio2016',
      ],
      relatedMetricIds: ['hunger', 'tdee'],
    },
    {
      id: '03-protein-and-ketosis',
      title: 'Does protein knock you out of ketosis?',
      category: 'fuel',
      summary:
        'Protein can be turned into glucose, but only a little is at typical intakes. In one study only about 4 g of glucose came from 23 g of egg protein over 8 hours. High-protein, very-low-carbohydrate diets still produced clear ketosis. Protein is not equivalent to carbohydrate gram for gram.',
      howModelled:
        'Protein intake does not prevent ketosis at typical high-protein intakes (up to about 2 g per kg a day and 30% of energy) when net carbohydrate is low. The ketosis topic may apply a small ketone-suppression term per gram of protein.',
      keyNumbers: [
        {
          label: 'Glucose from a protein meal after an overnight fast',
          value:
            'About 4 g of glucose from 23 g of egg protein over 8 h (total glucose production 50.4 g); 18% of the dietary amino acids were deaminated',
          note: 'That is a glucose yield of about 0.17 g per g of protein.',
          referenceIds: ['fromentin2013'],
        },
        {
          label: '30% protein, 4% carbohydrate ad libitum diet for 4 weeks (obese men)',
          value: 'Plasma β-hydroxybutyrate 1.52 mM (urine 2.99 mM)',
          referenceIds: ['johnstone2008'],
        },
        {
          label: 'Carbohydrate-free 30% protein diet',
          value:
            'Fractional glucose production 0.95, but absolute production only +26 g/d (not significant) vs a normal diet',
          referenceIds: ['veldhorst2009'],
        },
      ],
      timeCourse: 'The glucose from a protein meal appears over hours (the study measured 8 hours).',
      moderators: 'Net carbohydrate intake and protein dose.',
      grade: 'B',
      gradeReason: 'Three human studies agree, but each is small.',
      status: 'established',
      caveats:
        'The rule applies at typical high-protein intakes; effects at extreme intakes and the insulin response to protein are handled by the ketosis topic.',
      referenceIds: ['fromentin2013', 'johnstone2008', 'veldhorst2009'],
      relatedMetricIds: ['bhb'],
    },
  ],
  myths: [
    {
      id: '03-myth-per-meal-limit',
      claim: 'The body can only use 20–30 g of protein per meal, and the rest is burned or wasted.',
      verdict: 'oversimplified',
      explanation:
        'A 100 g dose produced a greater and longer muscle response than 25 g, lasting more than 12 hours, with less than 15% of the increment oxidised, and whole-body net balance kept rising with dose. The 20–25 g figure applies to fast, isolated protein measured over 4–6 hours or less. The peak response saturates near 0.24–0.40 g/kg, but the duration does not.',
      referenceIds: ['trommelen2023', 'kim2016b', 'witard2014', 'moore2015'],
    },
    {
      id: '03-myth-anabolic-window',
      claim: 'You must eat protein within 30–60 minutes after training.',
      verdict: 'not-supported',
      explanation:
        'After adjusting for total protein, the timing effect on hypertrophy was small and not significant (0.16). Protein just before or just after training gave identical results in a 10-week trial. Muscle stays sensitised for 24–48 hours after exercise.',
      referenceIds: ['schoenfeld2013', 'schoenfeld2017', 'phillips1997', 'burd2011'],
    },
    {
      id: '03-myth-eat-every-2-3-hours',
      claim: 'Eat every 2–3 hours or you go catabolic.',
      verdict: 'not-supported',
      explanation:
        'A 16:8 pattern with adequate protein preserved fat-free mass in trained people, one meal a day did not lower it in a crossover trial, and most distribution trials found no difference. Small penalties are plausible with marginal protein or long fasts.',
      referenceIds: ['moro2016', 'tinsley2019', 'stote2007', 'kim2018'],
    },
    {
      id: '03-myth-more-than-1-6-wasted',
      claim: 'More than about 1.6 g of protein per kilogram is always wasted.',
      verdict: 'oversimplified',
      explanation:
        'The plateau for training gains in energy balance is 1.62 g/kg/d, but its confidence interval reaches 2.2. In a deficit, needs rise to 1.6–2.4 g/kg in athletes, or 2.3–3.1 g/kg of fat-free mass in lean people with large deficits, and one amino-acid-oxidation study in trained men found about 2.0 g/kg. So it depends on context.',
      referenceIds: ['morton2018', 'helms2014', 'hector2018a', 'mazzulla2020'],
    },
    {
      id: '03-myth-high-protein-kidneys',
      claim: 'High protein damages healthy kidneys.',
      verdict: 'not-supported',
      explanation:
        'A meta-analysis of 28 trials found no significant change in kidney filtration rate with higher protein (standardised difference 0.11, not significant), and a one-year trial at 2.5–3.3 g/kg/d showed no adverse kidney markers. Chronic kidney disease is a separate case.',
      referenceIds: ['devries2018', 'antonio2016'],
    },
    {
      id: '03-myth-high-protein-bone',
      claim: 'High protein is bad for bone.',
      verdict: 'not-supported',
      explanation:
        'Higher protein intakes were linked to +0.52% lumbar spine bone density and no harm at any site.',
      referenceIds: ['shamswhite2017'],
    },
    {
      id: '03-myth-protein-kicks-out-ketosis',
      claim: 'Excess protein turns into sugar and kicks you out of ketosis.',
      verdict: 'not-supported',
      explanation:
        'In one study 23 g of protein gave about 4 g of glucose over 8 hours, and a 30% protein, very-low-carbohydrate diet produced blood β-hydroxybutyrate of about 1.5 mM. This is mostly false at typical intakes.',
      referenceIds: ['fromentin2013', 'johnstone2008'],
    },
    {
      id: '03-myth-plant-protein-cant-build-muscle',
      claim: 'Plant protein cannot build muscle.',
      verdict: 'not-supported',
      explanation:
        'Soy matched whey and animal protein for lean mass and strength, and people eating no animal foods at 1.6 g/kg matched omnivores. There was a small animal advantage of +0.41 kg in people under 50. Quality matters more at marginal intakes.',
      referenceIds: ['messina2018', 'hevialarrain2021', 'lim2021'],
    },
    {
      id: '03-myth-bcaa-build-muscle',
      claim: 'BCAA supplements build muscle.',
      verdict: 'oversimplified',
      explanation:
        'A dose of 5.6 g of branched-chain amino acids raised muscle synthesis by 22% acutely, about half the effect of whey, and it cannot be sustained without the other essential amino acids. They are a partial signal at best.',
      referenceIds: ['jackman2017', 'wolfe2017'],
    },
    {
      id: '03-myth-collagen-complete-protein',
      claim: 'Collagen is a complete protein.',
      verdict: 'not-supported',
      explanation:
        'Collagen has a DIAAS of about 0 because it lacks tryptophan, and lactalbumin raised muscle synthesis more than collagen. Some chronic collagen data are positive, but confounded by unequal total protein.',
      referenceIds: ['herreman2020', 'oikawa2020', 'zdzieblik2015'],
    },
    {
      id: '03-myth-fasting-protects-muscle-gh',
      claim: 'Fasting protects muscle because growth hormone rises.',
      verdict: 'not-supported',
      explanation:
        'Alternate-day fasting lost more non-fat mass than matched daily restriction (about 0.86 vs 0.16 kg over 3 weeks), and intermittent restriction lost 0.20 kg more fat-free mass in a meta-analysis. In a 10-day fast, metabolically active tissue made up 25% of weight loss. Protein sparing does develop with ketosis over days.',
      referenceIds: ['templeman2021', 'schroor2024', 'laurens2021', 'sherwin1975'],
    },
    {
      id: '03-myth-75-25-rule',
      claim: 'Weight lost is always 75% fat and 25% lean.',
      verdict: 'oversimplified',
      explanation:
        'The fraction varies with starting fat, deficit size, protein, exercise and time, and early losses are mostly water.',
      referenceIds: ['heymsfield2014'],
    },
    {
      id: '03-myth-surplus-protein-stored-as-fat',
      claim: 'Protein in a surplus is stored as fat just like other calories.',
      verdict: 'oversimplified',
      explanation:
        'In a ward trial, fat gain was identical at 15% and 25% protein, while protein raised lean mass and resting expenditure. Trained people ate 3.4–4.4 g/kg without gaining fat. So a protein surplus goes more to lean tissue and heat, though not entirely.',
      referenceIds: ['bray2012', 'antonio2014', 'antonio2015', 'antonio2016'],
    },
    {
      id: '03-myth-pre-sleep-casein',
      claim: 'Pre-sleep casein is uniquely anabolic.',
      verdict: 'unproven',
      explanation:
        'It raises overnight muscle synthesis acutely, but chronic benefits are confounded by extra total protein, so it is unproven beyond total protein.',
      referenceIds: ['res2012', 'kouw2017', 'snijders2015', 'reis2021'],
    },
  ],
  openQuestions: [
    'The baseline lean share of weight loss in lean adults is uncertain. The Forbes partition predicts about 0.4 for lean adults at moderate deficits, but a well-controlled 3-week study found about 0.08. A better baseline is needed by sex, age and fitness.',
    'The size of the protein effect at a 40% deficit without training is under-constrained, because the exact fat-free-mass figures of one key study were not accessible (abstract only).',
    'The chronic value of protein spacing and timing is unclear: acute synthesis differences of +25% and +31–48% contrast with mostly null 8–12 week trials. The shrinkage factor (γ = 0.3) and the distribution formula are judgement.',
    'Whether muscle has a per-meal ceiling is unsettled. The hourly model reproduces the large-dose and dose-response studies, but not the penalty for frequent 10 g doses. The refractory constants are poorly identified and compressed-window penalties depend on the model.',
    'The energy density of lean tissue (1000 vs 1816 kcal/kg) changes predicted weight-loss speed when the lean share is large and needs harmonising with the body-weight topic.',
    'Fasting protein oxidation is weakly sourced: the starting value, the lean-versus-obese scaling of the minimum, and the muscle-versus-organ split of early nitrogen loss (no direct human data).',
    "The training credit and the energy-deficit penalty depend on values from the resistance-training topic. The large lean gain in Longland's 40% deficit is under-predicted, and it is unclear whether the cause is training novelty, water in the four-compartment model, or a stronger protein-training synergy.",
    'Women and older adults are under-represented in the dose-response and deficit studies, and no sex term beyond fat mass is used.',
    'The protein-quality multipliers and adult-pattern DIAAS values are derived (the pattern constants are unverified), and food-matrix effects are ignored.',
    'The onset and recovery time constants of anabolic resistance after reduced steps or bed rest are unverified.',
    'The ketone effects come from infusion studies (some supraphysiological or in inflammation), so the protein sparing from nutritional ketosis itself is uncertain. Early ketosis did not spare protein relative to carbohydrate on a very-low-carbohydrate diet.',
    'The whole-body protein turnover figure (about 4 g/kg/d) is quoted from a textbook-level review and was not verified.',
  ],
  references: [
    {
      id: 'morton2018',
      authors: 'Morton RW, Murphy KT, McKellar SR, et al.',
      year: 2018,
      title:
        'A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults',
      journal: 'Br J Sports Med',
      pmid: '28698222',
      doi: '10.1136/bjsports-2017-097608',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28698222/',
    },
    {
      id: 'nunes2022',
      authors: 'Nunes EA, Colenso-Semple L, McKellar SR, et al.',
      year: 2022,
      title:
        'Systematic review and meta-analysis of protein intake to support muscle mass and function in healthy adults',
      journal: 'J Cachexia Sarcopenia Muscle',
      pmid: '35187864',
      doi: '10.1002/jcsm.12922',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35187864/',
    },
    {
      id: 'tagawa2021',
      authors: 'Tagawa R, Watanabe D, Ito K, et al.',
      year: 2021,
      title:
        'Dose-response relationship between protein intake and muscle mass increase: a systematic review and meta-analysis of randomized controlled trials',
      journal: 'Nutr Rev',
      pmid: '33300582',
      doi: '10.1093/nutrit/nuaa104',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33300582/',
    },
    {
      id: 'schoenfeld2013',
      authors: 'Schoenfeld BJ, Aragon AA, Krieger JW',
      year: 2013,
      title: 'The effect of protein timing on muscle strength and hypertrophy: a meta-analysis',
      journal: 'J Int Soc Sports Nutr',
      pmid: '24299050',
      doi: '10.1186/1550-2783-10-53',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24299050/',
    },
    {
      id: 'schoenfeld2017',
      authors: 'Schoenfeld BJ, Aragon A, Wilborn C, Urbina SL, Hayward SE, Krieger J',
      year: 2017,
      title: 'Pre- versus post-exercise protein intake has similar effects on muscular adaptations',
      journal: 'PeerJ',
      pmid: '28070459',
      doi: '10.7717/peerj.2825',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28070459/',
    },
    {
      id: 'helms2014',
      authors: 'Helms ER, Zinn C, Rowlands DS, Brown SR',
      year: 2014,
      title:
        'A systematic review of dietary protein during caloric restriction in resistance trained lean athletes: a case for higher intakes',
      journal: 'Int J Sport Nutr Exerc Metab',
      pmid: '24092765',
      doi: '10.1123/ijsnem.2013-0054',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24092765/',
    },
    {
      id: 'longland2016',
      authors: 'Longland TM, Oikawa SY, Mitchell CJ, Devries MC, Phillips SM',
      year: 2016,
      title:
        'Higher compared with lower dietary protein during an energy deficit combined with intense exercise promotes greater lean mass gain and fat mass loss: a randomized trial',
      journal: 'Am J Clin Nutr',
      pmid: '26817506',
      doi: '10.3945/ajcn.115.119339',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26817506/',
    },
    {
      id: 'pasiakos2013',
      authors: 'Pasiakos SM, Cao JJ, Margolis LM, et al.',
      year: 2013,
      title:
        'Effects of high-protein diets on fat-free mass and muscle protein synthesis following weight loss: a randomized controlled trial',
      journal: 'FASEB J',
      pmid: '23739654',
      doi: '10.1096/fj.13-230227',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23739654/',
      verification: 'abstract',
    },
    {
      id: 'mettler2010',
      authors: 'Mettler S, Mitchell N, Tipton KD',
      year: 2010,
      title: 'Increased protein intake reduces lean body mass loss during weight loss in athletes',
      journal: 'Med Sci Sports Exerc',
      pmid: '19927027',
      doi: '10.1249/MSS.0b013e3181b2ef8e',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19927027/',
    },
    {
      id: 'hector2018a',
      authors: 'Hector AJ, Phillips SM',
      year: 2018,
      title:
        'Protein recommendations for weight loss in elite athletes: a focus on body composition and performance',
      journal: 'Int J Sport Nutr Exerc Metab',
      pmid: '29182451',
      doi: '10.1123/ijsnem.2017-0273',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29182451/',
    },
    {
      id: 'murphy2015',
      authors: 'Murphy CH, Churchward-Venne TA, Mitchell CJ, et al.',
      year: 2015,
      title:
        'Hypoenergetic diet-induced reductions in myofibrillar protein synthesis are restored with resistance training and balanced daily protein ingestion in older men',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '25738784',
      doi: '10.1152/ajpendo.00550.2014',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25738784/',
    },
    {
      id: 'krieger2006',
      authors: 'Krieger JW, Sitren HS, Daniels MJ, Langkamp-Henken B',
      year: 2006,
      title:
        'Effects of variation in protein and carbohydrate intake on body mass and composition during energy restriction: a meta-regression',
      journal: 'Am J Clin Nutr',
      pmid: '16469983',
      doi: '10.1093/ajcn/83.2.260',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16469983/',
    },
    {
      id: 'wycherley2012',
      authors: 'Wycherley TP, Moran LJ, Clifton PM, Noakes M, Brinkworth GD',
      year: 2012,
      title:
        'Effects of energy-restricted high-protein, low-fat compared with standard-protein, low-fat diets: a meta-analysis of randomized controlled trials',
      journal: 'Am J Clin Nutr',
      pmid: '23097268',
      doi: '10.3945/ajcn.112.044321',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23097268/',
    },
    {
      id: 'kim2016a',
      authors: "Kim JE, O'Connor LE, Sands LP, Slebodnik MB, Campbell WW",
      year: 2016,
      title:
        'Effects of dietary protein intake on body composition changes after weight loss in older adults: a systematic review and meta-analysis',
      journal: 'Nutr Rev',
      pmid: '26883880',
      doi: '10.1093/nutrit/nuv065',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26883880/',
    },
    {
      id: 'hudson2020a',
      authors: 'Hudson JL, Wang Y, Bergia RE III, Campbell WW',
      year: 2020,
      title:
        'Protein intake greater than the RDA differentially influences whole-body lean mass responses to purposeful catabolic and anabolic stressors: a systematic review and meta-analysis',
      journal: 'Adv Nutr',
      pmid: '31794597',
      doi: '10.1093/advances/nmz106',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31794597/',
    },
    {
      id: 'weinheimer2010',
      authors: 'Weinheimer EM, Sands LP, Campbell WW',
      year: 2010,
      title:
        'A systematic review of the separate and combined effects of energy restriction and exercise on fat-free mass in middle-aged and older adults: implications for sarcopenic obesity',
      journal: 'Nutr Rev',
      pmid: '20591106',
      doi: '10.1111/j.1753-4887.2010.00298.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20591106/',
    },
    {
      id: 'chaston2007',
      authors: "Chaston TB, Dixon JB, O'Brien PE",
      year: 2007,
      title: 'Changes in fat-free mass during significant weight loss: a systematic review',
      journal: 'Int J Obes (Lond)',
      pmid: '17075583',
      doi: '10.1038/sj.ijo.0803483',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17075583/',
    },
    {
      id: 'heymsfield2014',
      authors: 'Heymsfield SB, Gonzalez MC, Shen W, Redman L, Thomas D',
      year: 2014,
      title:
        'Weight loss composition is one-fourth fat-free mass: a critical review and critique of this widely cited rule',
      journal: 'Obes Rev',
      pmid: '24447775',
      doi: '10.1111/obr.12143',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24447775/',
    },
    {
      id: 'hall2008a',
      authors: 'Hall KD',
      year: 2008,
      title: 'What is the required energy deficit per unit weight loss?',
      journal: 'Int J Obes (Lond)',
      pmid: '17848938',
      doi: '10.1038/sj.ijo.0803720',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17848938/',
    },
    {
      id: 'murphy2022',
      authors: 'Murphy C, Koehler K',
      year: 2022,
      title:
        'Energy deficiency impairs resistance training gains in lean mass but not strength: a meta-analysis and meta-regression',
      journal: 'Scand J Med Sci Sports',
      pmid: '34623696',
      doi: '10.1111/sms.14075',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34623696/',
    },
    {
      id: 'garthe2011',
      authors: 'Garthe I, Raastad T, Refsnes PE, Koivisto A, Sundgot-Borgen J',
      year: 2011,
      title:
        'Effect of two different weight-loss rates on body composition and strength and power-related performance in elite athletes',
      journal: 'Int J Sport Nutr Exerc Metab',
      pmid: '21558571',
      doi: '10.1123/ijsnem.21.2.97',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21558571/',
    },
    {
      id: 'vink2016',
      authors: 'Vink RG, Roumans NJ, Arkenbosch LA, Mariman EC, van Baak MA',
      year: 2016,
      title:
        'The effect of rate of weight loss on long-term weight regain in adults with overweight and obesity',
      journal: 'Obesity (Silver Spring)',
      pmid: '26813524',
      doi: '10.1002/oby.21346',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26813524/',
    },
    {
      id: 'carbone2019',
      authors: 'Carbone JW, McClung JP, Pasiakos SM',
      year: 2019,
      title:
        'Recent advances in the characterization of skeletal muscle and whole-body protein responses to dietary protein and exercise during negative energy balance',
      journal: 'Adv Nutr',
      pmid: '30596808',
      doi: '10.1093/advances/nmy087',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30596808/',
    },
    {
      id: 'pasiakos2010',
      authors: 'Pasiakos SM, Vislocky LM, Carbone JW, et al.',
      year: 2010,
      title:
        'Acute energy deprivation affects skeletal muscle protein synthesis and associated intracellular signaling proteins in physically active adults',
      journal: 'J Nutr',
      pmid: '20164371',
      doi: '10.3945/jn.109.118372',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20164371/',
    },
    {
      id: 'areta2014',
      authors: 'Areta JL, Burke LM, Camera DM, et al.',
      year: 2014,
      title:
        'Reduced resting skeletal muscle protein synthesis is rescued by resistance exercise and protein ingestion following short-term energy deficit',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '24595305',
      doi: '10.1152/ajpendo.00590.2013',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24595305/',
    },
    {
      id: 'hector2015',
      authors: 'Hector AJ, Marcotte GR, Churchward-Venne TA, et al.',
      year: 2015,
      title:
        'Whey protein supplementation preserves postprandial myofibrillar protein synthesis during short-term energy restriction in overweight and obese adults',
      journal: 'J Nutr',
      pmid: '25644344',
      doi: '10.3945/jn.114.200832',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25644344/',
    },
    {
      id: 'hector2018b',
      authors: 'Hector AJ, McGlory C, Damas F, Mazara N, Baker SK, Phillips SM',
      year: 2018,
      title:
        'Pronounced energy restriction with elevated protein intake results in no change in proteolysis and reductions in skeletal muscle protein synthesis that are mitigated by resistance exercise',
      journal: 'FASEB J',
      pmid: '28899879',
      doi: '10.1096/fj.201700158RR',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28899879/',
    },
    {
      id: 'moore2015',
      authors: 'Moore DR, Churchward-Venne TA, Witard O, et al.',
      year: 2015,
      title:
        'Protein ingestion to stimulate myofibrillar protein synthesis requires greater relative protein intakes in healthy older versus younger men',
      journal: 'J Gerontol A Biol Sci Med Sci',
      pmid: '25056502',
      doi: '10.1093/gerona/glu103',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25056502/',
    },
    {
      id: 'witard2014',
      authors: 'Witard OC, Jackman SR, Breen L, Smith K, Selby A, Tipton KD',
      year: 2014,
      title:
        'Myofibrillar muscle protein synthesis rates subsequent to a meal in response to increasing doses of whey protein at rest and after resistance exercise',
      journal: 'Am J Clin Nutr',
      pmid: '24257722',
      doi: '10.3945/ajcn.112.055517',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24257722/',
    },
    {
      id: 'macnaughton2016',
      authors: 'Macnaughton LS, Wardle SL, Witard OC, et al.',
      year: 2016,
      title:
        'The response of muscle protein synthesis following whole-body resistance exercise is greater following 40 g than 20 g of ingested whey protein',
      journal: 'Physiol Rep',
      pmid: '27511985',
      doi: '10.14814/phy2.12893',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27511985/',
    },
    {
      id: 'trommelen2023',
      authors: 'Trommelen J, van Lieshout GAA, Nyakayiru J, et al.',
      year: 2023,
      title:
        'The anabolic response to protein ingestion during recovery from exercise has no upper limit in magnitude and duration in vivo in humans',
      journal: 'Cell Rep Med',
      pmid: '38118410',
      doi: '10.1016/j.xcrm.2023.101324',
      url: 'https://pubmed.ncbi.nlm.nih.gov/38118410/',
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
      url: 'https://pubmed.ncbi.nlm.nih.gov/20844073/',
    },
    {
      id: 'bohe2001',
      authors: 'Bohé J, Low JF, Wolfe RR, Rennie MJ',
      year: 2001,
      title:
        'Latency and duration of stimulation of human muscle protein synthesis during continuous infusion of amino acids',
      journal: 'J Physiol',
      pmid: '11306673',
      doi: '10.1111/j.1469-7793.2001.0575f.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11306673/',
    },
    {
      id: 'churchwardvenne2012',
      authors: 'Churchward-Venne TA, Burd NA, Mitchell CJ, et al.',
      year: 2012,
      title:
        'Supplementation of a suboptimal protein dose with leucine or essential amino acids: effects on myofibrillar protein synthesis at rest and following resistance exercise in men',
      journal: 'J Physiol',
      pmid: '22451437',
      doi: '10.1113/jphysiol.2012.228833',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22451437/',
    },
    {
      id: 'churchwardvenne2014',
      authors: 'Churchward-Venne TA, Breen L, Di Donato DM, et al.',
      year: 2014,
      title:
        'Leucine supplementation of a low-protein mixed macronutrient beverage enhances myofibrillar protein synthesis in young men: a double-blind, randomized trial',
      journal: 'Am J Clin Nutr',
      pmid: '24284442',
      doi: '10.3945/ajcn.113.068775',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24284442/',
    },
    {
      id: 'holwerda2019',
      authors: 'Holwerda AM, Paulussen KJM, Overkamp M, et al.',
      year: 2019,
      title:
        'Dose-dependent increases in whole-body net protein balance and dietary protein-derived amino acid incorporation into myofibrillar protein during recovery from resistance exercise in older men',
      journal: 'J Nutr',
      pmid: '30722014',
      doi: '10.1093/jn/nxy263',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30722014/',
    },
    {
      id: 'kim2016b',
      authors: 'Kim IY, Schutzler S, Schrader A, et al.',
      year: 2016,
      title:
        'The anabolic response to a meal containing different amounts of protein is not limited by the maximal stimulation of protein synthesis in healthy young adults',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '26530155',
      doi: '10.1152/ajpendo.00365.2015',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26530155/',
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
      url: 'https://pubmed.ncbi.nlm.nih.gov/23459753/',
    },
    {
      id: 'mamerow2014',
      authors: 'Mamerow MM, Mettler JA, English KL, et al.',
      year: 2014,
      title:
        'Dietary protein distribution positively influences 24-h muscle protein synthesis in healthy adults',
      journal: 'J Nutr',
      pmid: '24477298',
      doi: '10.3945/jn.113.185280',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24477298/',
    },
    {
      id: 'kim2015',
      authors: 'Kim IY, Schutzler S, Schrader A, et al.',
      year: 2015,
      title:
        'Quantity of dietary protein intake, but not pattern of intake, affects net protein balance primarily through differences in protein synthesis in older adults',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '25352437',
      doi: '10.1152/ajpendo.00382.2014',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25352437/',
    },
    {
      id: 'kim2018',
      authors: 'Kim IY, Schutzler S, Schrader AM, et al.',
      year: 2018,
      title:
        'Protein intake distribution pattern does not affect anabolic response, lean body mass, muscle strength or function over 8 weeks in older adults: a randomized-controlled trial',
      journal: 'Clin Nutr',
      pmid: '28318687',
      doi: '10.1016/j.clnu.2017.02.020',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28318687/',
    },
    {
      id: 'yasuda2020',
      authors: 'Yasuda J, Tomita T, Arimitsu T, Fujita S',
      year: 2020,
      title:
        'Evenly distributed protein intake over 3 meals augments resistance exercise-induced muscle hypertrophy in healthy young men',
      journal: 'J Nutr',
      pmid: '32321161',
      doi: '10.1093/jn/nxaa101',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32321161/',
    },
    {
      id: 'hudson2020b',
      authors: 'Hudson JL, Bergia RE III, Campbell WW',
      year: 2020,
      title: 'Protein distribution and muscle-related outcomes: does the evidence support the concept?',
      journal: 'Nutrients',
      pmid: '32429355',
      doi: '10.3390/nu12051441',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32429355/',
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
      url: 'https://pubmed.ncbi.nlm.nih.gov/27737674/',
    },
    {
      id: 'tinsley2017',
      authors: 'Tinsley GM, Forsse JS, Butler NK, et al.',
      year: 2017,
      title:
        'Time-restricted feeding in young men performing resistance training: a randomized controlled trial',
      journal: 'Eur J Sport Sci',
      pmid: '27550719',
      doi: '10.1080/17461391.2016.1223173',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27550719/',
    },
    {
      id: 'tinsley2019',
      authors: 'Tinsley GM, Moore ML, Graybeal AJ, et al.',
      year: 2019,
      title: 'Time-restricted feeding plus resistance training in active females: a randomized trial',
      journal: 'Am J Clin Nutr',
      pmid: '31268131',
      doi: '10.1093/ajcn/nqz126',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31268131/',
    },
    {
      id: 'stote2007',
      authors: 'Stote KS, Baer DJ, Spears K, et al.',
      year: 2007,
      title:
        'A controlled trial of reduced meal frequency without caloric restriction in healthy, normal-weight, middle-aged adults',
      journal: 'Am J Clin Nutr',
      pmid: '17413096',
      doi: '10.1093/ajcn/85.4.981',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17413096/',
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
      url: 'https://pubmed.ncbi.nlm.nih.gov/32986097/',
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
      id: 'schroor2024',
      authors: 'Schroor MM, Joris PJ, Plat J, Mensink RP',
      year: 2024,
      title:
        'Effects of intermittent energy restriction compared with those of continuous energy restriction on body composition and cardiometabolic risk markers — a systematic review and meta-analysis of randomized controlled trials in adults',
      journal: 'Adv Nutr',
      pmid: '37827491',
      doi: '10.1016/j.advnut.2023.10.003',
      url: 'https://pubmed.ncbi.nlm.nih.gov/37827491/',
    },
    {
      id: 'res2012',
      authors: 'Res PT, Groen B, Pennings B, et al.',
      year: 2012,
      title: 'Protein ingestion before sleep improves postexercise overnight recovery',
      journal: 'Med Sci Sports Exerc',
      pmid: '22330017',
      doi: '10.1249/MSS.0b013e31824cc363',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22330017/',
    },
    {
      id: 'kouw2017',
      authors: 'Kouw IW, Holwerda AM, Trommelen J, et al.',
      year: 2017,
      title:
        'Protein ingestion before sleep increases overnight muscle protein synthesis rates in healthy older men: a randomized controlled trial',
      journal: 'J Nutr',
      pmid: '28855419',
      doi: '10.3945/jn.117.254532',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28855419/',
    },
    {
      id: 'snijders2015',
      authors: 'Snijders T, Res PT, Smeets JS, et al.',
      year: 2015,
      title:
        'Protein ingestion before sleep increases muscle mass and strength gains during prolonged resistance-type exercise training in healthy young men',
      journal: 'J Nutr',
      pmid: '25926415',
      doi: '10.3945/jn.114.208371',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25926415/',
    },
    {
      id: 'reis2021',
      authors: 'Reis CEG, Loureiro LMR, Roschel H, da Costa THM',
      year: 2021,
      title: 'Effects of pre-sleep protein consumption on muscle-related outcomes — a systematic review',
      journal: 'J Sci Med Sport',
      pmid: '32811763',
      doi: '10.1016/j.jsams.2020.07.016',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32811763/',
    },
    {
      id: 'herreman2020',
      authors: 'Herreman L, Nommensen P, Pennings B, Laus MC',
      year: 2020,
      title:
        'Comprehensive overview of the quality of plant- and animal-sourced proteins based on the digestible indispensable amino acid score',
      journal: 'Food Sci Nutr',
      pmid: '33133540',
      doi: '10.1002/fsn3.1809',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33133540/',
    },
    {
      id: 'mathai2017',
      authors: 'Mathai JK, Liu Y, Stein HH',
      year: 2017,
      title:
        'Values for digestible indispensable amino acid scores (DIAAS) for some dairy and plant proteins may better describe protein quality than values calculated using the concept for protein digestibility-corrected amino acid scores (PDCAAS)',
      journal: 'Br J Nutr',
      pmid: '28382889',
      doi: '10.1017/S0007114517000125',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28382889/',
    },
    {
      id: 'gorissen2018',
      authors: 'Gorissen SHM, Crombag JJR, Senden JMG, et al.',
      year: 2018,
      title:
        'Protein content and amino acid composition of commercially available plant-based protein isolates',
      journal: 'Amino Acids',
      pmid: '30167963',
      doi: '10.1007/s00726-018-2640-5',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30167963/',
    },
    {
      id: 'pinckaers2021',
      authors: 'Pinckaers PJM, Trommelen J, Snijders T, van Loon LJC',
      year: 2021,
      title: 'The anabolic response to plant-based protein ingestion',
      journal: 'Sports Med',
      pmid: '34515966',
      doi: '10.1007/s40279-021-01540-8',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34515966/',
    },
    {
      id: 'messina2018',
      authors: 'Messina M, Lynch H, Dickinson JM, Reed KE',
      year: 2018,
      title:
        'No difference between the effects of supplementing with soy protein versus animal protein on gains in muscle mass and strength in response to resistance exercise',
      journal: 'Int J Sport Nutr Exerc Metab',
      pmid: '29722584',
      doi: '10.1123/ijsnem.2018-0071',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29722584/',
    },
    {
      id: 'lim2021',
      authors: 'Lim MT, Pan BJ, Toh DWK, Sutanto CN, Kim JE',
      year: 2021,
      title:
        'Animal protein versus plant protein in supporting lean mass and muscle strength: a systematic review and meta-analysis of randomized controlled trials',
      journal: 'Nutrients',
      pmid: '33670701',
      doi: '10.3390/nu13020661',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33670701/',
    },
    {
      id: 'hevialarrain2021',
      authors: 'Hevia-Larraín V, Gualano B, Longobardi I, et al.',
      year: 2021,
      title:
        'High-protein plant-based diet versus a protein-matched omnivorous diet to support resistance training adaptations: a comparison between habitual vegans and omnivores',
      journal: 'Sports Med',
      pmid: '33599941',
      doi: '10.1007/s40279-021-01434-9',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33599941/',
    },
    {
      id: 'jackman2017',
      authors: 'Jackman SR, Witard OC, Philp A, Wallis GA, Baar K, Tipton KD',
      year: 2017,
      title:
        'Branched-chain amino acid ingestion stimulates muscle myofibrillar protein synthesis following resistance exercise in humans',
      journal: 'Front Physiol',
      pmid: '28638350',
      doi: '10.3389/fphys.2017.00390',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28638350/',
    },
    {
      id: 'wolfe2017',
      authors: 'Wolfe RR',
      year: 2017,
      title: 'Branched-chain amino acids and muscle protein synthesis in humans: myth or reality?',
      journal: 'J Int Soc Sports Nutr',
      pmid: '28852372',
      doi: '10.1186/s12970-017-0184-9',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28852372/',
    },
    {
      id: 'oikawa2018',
      authors: "Oikawa SY, McGlory C, D'Souza LK, et al.",
      year: 2018,
      title:
        'A randomized controlled trial of the impact of protein supplementation on leg lean mass and integrated muscle protein synthesis during inactivity and energy restriction in older persons',
      journal: 'Am J Clin Nutr',
      pmid: '30289425',
      doi: '10.1093/ajcn/nqy193',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30289425/',
    },
    {
      id: 'oikawa2020',
      authors: 'Oikawa SY, Macinnis MJ, Tripp TR, McGlory C, Baker SK, Phillips SM',
      year: 2020,
      title: 'Lactalbumin, not collagen, augments muscle protein synthesis with aerobic exercise',
      journal: 'Med Sci Sports Exerc',
      pmid: '31895298',
      doi: '10.1249/MSS.0000000000002253',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31895298/',
    },
    {
      id: 'zdzieblik2015',
      authors: 'Zdzieblik D, Oesser S, Baumstark MW, Gollhofer A, König D',
      year: 2015,
      title:
        'Collagen peptide supplementation in combination with resistance training improves body composition and increases muscle strength in elderly sarcopenic men: a randomised controlled trial',
      journal: 'Br J Nutr',
      pmid: '26353786',
      doi: '10.1017/S0007114515002810',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26353786/',
    },
    {
      id: 'phillips1997',
      authors: 'Phillips SM, Tipton KD, Aarsland A, Wolf SE, Wolfe RR',
      year: 1997,
      title: 'Mixed muscle protein synthesis and breakdown after resistance exercise in humans',
      journal: 'Am J Physiol',
      pmid: '9252485',
      doi: '10.1152/ajpendo.1997.273.1.E99',
      url: 'https://pubmed.ncbi.nlm.nih.gov/9252485/',
    },
    {
      id: 'phillips1999',
      authors: 'Phillips SM, Tipton KD, Ferrando AA, Wolfe RR',
      year: 1999,
      title: 'Resistance training reduces the acute exercise-induced increase in muscle protein turnover',
      journal: 'Am J Physiol',
      pmid: '9886957',
      doi: '10.1152/ajpendo.1999.276.1.E118',
      url: 'https://pubmed.ncbi.nlm.nih.gov/9886957/',
    },
    {
      id: 'macdougall1995',
      authors: 'MacDougall JD, Gibala MJ, Tarnopolsky MA, MacDonald JR, Interisano SA, Yarasheski KE',
      year: 1995,
      title: 'The time course for elevated muscle protein synthesis following heavy resistance exercise',
      journal: 'Can J Appl Physiol',
      pmid: '8563679',
      doi: '10.1139/h95-038',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8563679/',
    },
    {
      id: 'tang2008',
      authors: 'Tang JE, Perco JG, Moore DR, Wilkinson SB, Phillips SM',
      year: 2008,
      title:
        'Resistance training alters the response of fed state mixed muscle protein synthesis in young men',
      journal: 'Am J Physiol Regul Integr Comp Physiol',
      pmid: '18032468',
      doi: '10.1152/ajpregu.00636.2007',
      url: 'https://pubmed.ncbi.nlm.nih.gov/18032468/',
    },
    {
      id: 'burd2010',
      authors: 'Burd NA, Holwerda AM, Selby KC, et al.',
      year: 2010,
      title:
        'Resistance exercise volume affects myofibrillar protein synthesis and anabolic signalling molecule phosphorylation in young men',
      journal: 'J Physiol',
      pmid: '20581041',
      doi: '10.1113/jphysiol.2010.192856',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20581041/',
    },
    {
      id: 'burd2011',
      authors: 'Burd NA, West DW, Moore DR, et al.',
      year: 2011,
      title:
        'Enhanced amino acid sensitivity of myofibrillar protein synthesis persists for up to 24 h after resistance exercise in young men',
      journal: 'J Nutr',
      pmid: '21289204',
      doi: '10.3945/jn.110.135038',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21289204/',
    },
    {
      id: 'damas2016',
      authors: 'Damas F, Phillips SM, Libardi CA, et al.',
      year: 2016,
      title:
        'Resistance training-induced changes in integrated myofibrillar protein synthesis are related to hypertrophy only after attenuation of muscle damage',
      journal: 'J Physiol',
      pmid: '27219125',
      doi: '10.1113/JP272472',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27219125/',
    },
    {
      id: 'vendelbo2014',
      authors: 'Vendelbo MH, Møller AB, Christensen B, et al.',
      year: 2014,
      title:
        'Fasting increases human skeletal muscle net phenylalanine release and this is associated with decreased mTOR signaling',
      journal: 'PLoS One',
      pmid: '25020061',
      doi: '10.1371/journal.pone.0102031',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25020061/',
    },
    {
      id: 'pozefsky1976',
      authors: 'Pozefsky T, Tancredi RG, Moxley RT, Dupre J, Tobin JD',
      year: 1976,
      title: 'Effects of brief starvation on muscle amino acid metabolism in nonobese man',
      journal: 'J Clin Invest',
      pmid: '1254728',
      doi: '10.1172/JCI108295',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1254728/',
    },
    {
      id: 'forbes1979',
      authors: 'Forbes GB, Drenick EJ',
      year: 1979,
      title: 'Loss of body nitrogen on fasting',
      journal: 'Am J Clin Nutr',
      pmid: '463798',
      doi: '10.1093/ajcn/32.8.1570',
      url: 'https://pubmed.ncbi.nlm.nih.gov/463798/',
    },
    {
      id: 'owen1998',
      authors: "Owen OE, Smalley KJ, D'Alessio DA, Mozzoli MA, Dawson EK",
      year: 1998,
      title: 'Protein, fat, and carbohydrate requirements during starvation: anaplerosis and cataplerosis',
      journal: 'Am J Clin Nutr',
      pmid: '9665093',
      doi: '10.1093/ajcn/68.1.12',
      url: 'https://pubmed.ncbi.nlm.nih.gov/9665093/',
    },
    {
      id: 'owen1969',
      authors: 'Owen OE, Felig P, Morgan AP, Wahren J, Cahill GF Jr',
      year: 1969,
      title: 'Liver and kidney metabolism during prolonged starvation',
      journal: 'J Clin Invest',
      pmid: '5773093',
      doi: '10.1172/JCI106016',
      url: 'https://pubmed.ncbi.nlm.nih.gov/5773093/',
    },
    {
      id: 'felig1969',
      authors: 'Felig P, Owen OE, Wahren J, Cahill GF Jr',
      year: 1969,
      title: 'Amino acid metabolism during prolonged starvation',
      journal: 'J Clin Invest',
      pmid: '5773094',
      doi: '10.1172/JCI106017',
      url: 'https://pubmed.ncbi.nlm.nih.gov/5773094/',
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
      url: 'https://pubmed.ncbi.nlm.nih.gov/34668663/',
    },
    {
      id: 'sherwin1975',
      authors: 'Sherwin RS, Hendler RG, Felig P',
      year: 1975,
      title: 'Effect of ketone infusions on amino acid and nitrogen metabolism in man',
      journal: 'J Clin Invest',
      pmid: '1133179',
      doi: '10.1172/JCI108057',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1133179/',
    },
    {
      id: 'nair1988',
      authors: 'Nair KS, Welle SL, Halliday D, Campbell RG',
      year: 1988,
      title:
        'Effect of beta-hydroxybutyrate on whole-body leucine kinetics and fractional mixed skeletal muscle protein synthesis in humans',
      journal: 'J Clin Invest',
      pmid: '3392207',
      doi: '10.1172/JCI113570',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3392207/',
    },
    {
      id: 'thomsen2018',
      authors: 'Thomsen HH, Rittig N, Johannsen M, et al.',
      year: 2018,
      title:
        'Effects of 3-hydroxybutyrate and free fatty acids on muscle protein kinetics and signaling during LPS-induced inflammation in humans: anticatabolic impact of ketone bodies',
      journal: 'Am J Clin Nutr',
      pmid: '30239561',
      doi: '10.1093/ajcn/nqy170',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30239561/',
    },
    {
      id: 'hoffer1984',
      authors: 'Hoffer LJ, Bistrian BR, Young VR, Blackburn GL, Matthews DE',
      year: 1984,
      title: 'Metabolic effects of very low calorie weight reduction diets',
      journal: 'J Clin Invest',
      pmid: '6707202',
      doi: '10.1172/JCI111268',
      url: 'https://pubmed.ncbi.nlm.nih.gov/6707202/',
    },
    {
      id: 'vazquez1992',
      authors: 'Vazquez JA, Adibi SA',
      year: 1992,
      title:
        'Protein sparing during treatment of obesity: ketogenic versus nonketogenic very low calorie diet',
      journal: 'Metabolism',
      pmid: '1556948',
      doi: '10.1016/0026-0495(92)90076-m',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1556948/',
    },
    {
      id: 'breen2013',
      authors: 'Breen L, Stokes KA, Churchward-Venne TA, et al.',
      year: 2013,
      title:
        'Two weeks of reduced activity decreases leg lean mass and induces "anabolic resistance" of myofibrillar protein synthesis in healthy elderly',
      journal: 'J Clin Endocrinol Metab',
      pmid: '23589526',
      doi: '10.1210/jc.2013-1502',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23589526/',
    },
    {
      id: 'wall2014',
      authors: 'Wall BT, Dirks ML, Snijders T, Senden JM, Dolmans J, van Loon LJ',
      year: 2014,
      title: 'Substantial skeletal muscle loss occurs during only 5 days of disuse',
      journal: 'Acta Physiol (Oxf)',
      pmid: '24168489',
      doi: '10.1111/apha.12190',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24168489/',
    },
    {
      id: 'wall2016',
      authors: 'Wall BT, Dirks ML, Snijders T, et al.',
      year: 2016,
      title:
        'Short-term muscle disuse lowers myofibrillar protein synthesis rates and induces anabolic resistance to protein ingestion',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '26578714',
      doi: '10.1152/ajpendo.00227.2015',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26578714/',
    },
    {
      id: 'beals2016',
      authors: 'Beals JW, Sukiennik RA, Nallabelli J, et al.',
      year: 2016,
      title:
        'Anabolic sensitivity of postprandial muscle protein synthesis to the ingestion of a protein-dense food is reduced in overweight and obese young adults',
      journal: 'Am J Clin Nutr',
      pmid: '27604771',
      doi: '10.3945/ajcn.116.130385',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27604771/',
    },
    {
      id: 'beals2018',
      authors: 'Beals JW, Skinner SK, McKenna CF, et al.',
      year: 2018,
      title:
        'Altered anabolic signalling and reduced stimulation of myofibrillar protein synthesis after feeding and resistance exercise in people with obesity',
      journal: 'J Physiol',
      pmid: '30113718',
      doi: '10.1113/JP276210',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30113718/',
    },
    {
      id: 'kortebein2007',
      authors: 'Kortebein P, Ferrando A, Lombeida J, Wolfe R, Evans WJ',
      year: 2007,
      title: 'Effect of 10 days of bed rest on skeletal muscle in healthy older adults',
      journal: 'JAMA',
      pmid: '17456818',
      doi: '10.1001/jama.297.16.1772-b',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17456818/',
      verification: 'unverified',
    },
    {
      id: 'bray2012',
      authors: 'Bray GA, Smith SR, de Jonge L, et al.',
      year: 2012,
      title:
        'Effect of dietary protein content on weight gain, energy expenditure, and body composition during overeating: a randomized controlled trial',
      journal: 'JAMA',
      pmid: '22215165',
      doi: '10.1001/jama.2011.1918',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22215165/',
    },
    {
      id: 'antonio2014',
      authors: 'Antonio J, Peacock CA, Ellerbroek A, Fromhoff B, Silver T',
      year: 2014,
      title:
        'The effects of consuming a high protein diet (4.4 g/kg/d) on body composition in resistance-trained individuals',
      journal: 'J Int Soc Sports Nutr',
      pmid: '24834017',
      doi: '10.1186/1550-2783-11-19',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24834017/',
    },
    {
      id: 'antonio2015',
      authors: 'Antonio J, Ellerbroek A, Silver T, et al.',
      year: 2015,
      title:
        'A high protein diet (3.4 g/kg/d) combined with a heavy resistance training program improves body composition in healthy trained men and women — a follow-up investigation',
      journal: 'J Int Soc Sports Nutr',
      pmid: '26500462',
      doi: '10.1186/s12970-015-0100-0',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26500462/',
    },
    {
      id: 'antonio2016',
      authors: 'Antonio J, Ellerbroek A, Silver T, et al.',
      year: 2016,
      title:
        'A high protein diet has no harmful effects: a one-year crossover study in resistance-trained males',
      journal: 'J Nutr Metab',
      pmid: '27807480',
      doi: '10.1155/2016/9104792',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27807480/',
    },
    {
      id: 'weigle2005',
      authors: 'Weigle DS, Breen PA, Matthys CC, et al.',
      year: 2005,
      title:
        'A high-protein diet induces sustained reductions in appetite, ad libitum caloric intake, and body weight despite compensatory changes in diurnal plasma leptin and ghrelin concentrations',
      journal: 'Am J Clin Nutr',
      pmid: '16002798',
      doi: '10.1093/ajcn.82.1.41',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16002798/',
    },
    {
      id: 'gosby2011',
      authors: 'Gosby AK, Conigrave AD, Lau NS, et al.',
      year: 2011,
      title: 'Testing protein leverage in lean humans: a randomised controlled experimental study',
      journal: 'PLoS One',
      pmid: '22022472',
      doi: '10.1371/journal.pone.0025929',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22022472/',
    },
    {
      id: 'westerterp2004',
      authors: 'Westerterp KR',
      year: 2004,
      title: 'Diet induced thermogenesis',
      journal: 'Nutr Metab (Lond)',
      pmid: '15507147',
      doi: '10.1186/1743-7075-1-5',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15507147/',
    },
    {
      id: 'veldhorst2009',
      authors: 'Veldhorst MA, Westerterp-Plantenga MS, Westerterp KR',
      year: 2009,
      title: 'Gluconeogenesis and energy expenditure after a high-protein, carbohydrate-free diet',
      journal: 'Am J Clin Nutr',
      pmid: '19640952',
      doi: '10.3945/ajcn.2009.27834',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19640952/',
    },
    {
      id: 'devries2018',
      authors: 'Devries MC, Sithamparapillai A, Brimble KS, Banfield L, Morton RW, Phillips SM',
      year: 2018,
      title:
        'Changes in kidney function do not differ between healthy adults consuming higher- compared with lower- or normal-protein diets: a systematic review and meta-analysis',
      journal: 'J Nutr',
      pmid: '30383278',
      doi: '10.1093/jn/nxy197',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30383278/',
    },
    {
      id: 'shamswhite2017',
      authors: 'Shams-White MM, Chung M, Du M, et al.',
      year: 2017,
      title:
        'Dietary protein and bone health: a systematic review and meta-analysis from the National Osteoporosis Foundation',
      journal: 'Am J Clin Nutr',
      pmid: '28404575',
      doi: '10.3945/ajcn.116.145110',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28404575/',
    },
    {
      id: 'bilsborough2006',
      authors: 'Bilsborough S, Mann N',
      year: 2006,
      title: 'A review of issues of dietary protein intake in humans',
      journal: 'Int J Sport Nutr Exerc Metab',
      pmid: '16779921',
      doi: '10.1123/ijsnem.16.2.129',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16779921/',
    },
    {
      id: 'fromentin2013',
      authors: 'Fromentin C, Tomé D, Nau F, et al.',
      year: 2013,
      title:
        'Dietary proteins contribute little to glucose production, even under optimal gluconeogenic conditions in healthy humans',
      journal: 'Diabetes',
      pmid: '23274906',
      doi: '10.2337/db12-1208',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23274906/',
    },
    {
      id: 'johnstone2008',
      authors: 'Johnstone AM, Horgan GW, Murison SD, Bremner DM, Lobley GE',
      year: 2008,
      title:
        'Effects of a high-protein ketogenic diet on hunger, appetite, and weight loss in obese men feeding ad libitum',
      journal: 'Am J Clin Nutr',
      pmid: '18175736',
      doi: '10.1093/ajcn/87.1.44',
      url: 'https://pubmed.ncbi.nlm.nih.gov/18175736/',
    },
    {
      id: 'rand2003',
      authors: 'Rand WM, Pellett PL, Young VR',
      year: 2003,
      title:
        'Meta-analysis of nitrogen balance studies for estimating protein requirements in healthy adults',
      journal: 'Am J Clin Nutr',
      pmid: '12499330',
      doi: '10.1093/ajcn/77.1.109',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12499330/',
    },
    {
      id: 'humayun2007',
      authors: 'Humayun MA, Elango R, Ball RO, Pencharz PB',
      year: 2007,
      title:
        'Reevaluation of the protein requirement in young men with the indicator amino acid oxidation technique',
      journal: 'Am J Clin Nutr',
      pmid: '17921376',
      doi: '10.1093/ajcn/86.4.995',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17921376/',
    },
    {
      id: 'bandegan2017',
      authors: 'Bandegan A, Courtney-Martin G, Rafii M, Pencharz PB, Lemon PW',
      year: 2017,
      title:
        'Indicator amino acid-derived estimate of dietary protein requirement for male bodybuilders on a nontraining day is several-fold greater than the current Recommended Dietary Allowance',
      journal: 'J Nutr',
      pmid: '28179492',
      doi: '10.3945/jn.116.236331',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28179492/',
    },
    {
      id: 'mazzulla2020',
      authors: 'Mazzulla M, Abou Sawan S, Williamson E, et al.',
      year: 2020,
      title:
        'Protein intake to maximize whole-body anabolism during postexercise recovery in resistance-trained men with high habitual intakes is severalfold greater than the current Recommended Dietary Allowance',
      journal: 'J Nutr',
      pmid: '31618421',
      doi: '10.1093/jn/nxz249',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31618421/',
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
      id: 'janssen2000',
      authors: 'Janssen I, Heymsfield SB, Wang ZM, Ross R',
      year: 2000,
      title: 'Skeletal muscle mass and distribution in 468 men and women aged 18-88 yr',
      journal: 'J Appl Physiol',
      pmid: '10904038',
      doi: '10.1152/jappl.2000.89.1.81',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10904038/',
    },
    {
      id: 'wang1999',
      authors: 'Wang Z, Deurenberg P, Wang W, Pietrobelli A, Baumgartner RN, Heymsfield SB',
      year: 1999,
      title: 'Hydration of fat-free body mass: review and critique of a classic body-composition constant',
      journal: 'Am J Clin Nutr',
      pmid: '10232621',
      doi: '10.1093/ajcn/69.5.833',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10232621/',
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
      url: 'https://pubmed.ncbi.nlm.nih.gov/18577697/',
    },
    {
      id: 'abdulla2016',
      authors: 'Abdulla H, Smith K, Atherton PJ, Idris I',
      year: 2016,
      title:
        'Role of insulin in the regulation of human skeletal muscle protein synthesis and breakdown: a systematic review and meta-analysis',
      journal: 'Diabetologia',
      pmid: '26404065',
      doi: '10.1007/s00125-015-3751-0',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26404065/',
    },
    {
      id: 'tipton2018',
      authors: 'Tipton KD, Hamilton DL, Gallagher IJ',
      year: 2018,
      title: 'Assessing the role of muscle protein breakdown in response to nutrition and exercise in humans',
      journal: 'Sports Med',
      pmid: '29368185',
      doi: '10.1007/s40279-017-0845-5',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29368185/',
    },
    {
      id: 'hall2007',
      authors: 'Hall KD',
      year: 2007,
      title: "Body fat and fat-free mass inter-relationships: Forbes's theory revisited",
      journal: 'Br J Nutr',
      pmid: '17367567',
      doi: '10.1017/S0007114507691946',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17367567/',
    },
    {
      id: 'wolfe2006',
      authors: 'Wolfe RR',
      year: 2006,
      title: 'The underappreciated role of muscle in health and disease',
      journal: 'Am J Clin Nutr',
      pmid: '16960159',
      doi: '10.1093/ajcn/84.3.475',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16960159/',
    },
    {
      id: 'waterlow1995',
      authors: 'Waterlow JC',
      year: 1995,
      title: 'Whole-body protein turnover in humans — past, present, and future',
      journal: 'Annu Rev Nutr',
      pmid: '8527232',
      doi: '10.1146/annurev.nu.15.070195.000421',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8527232/',
    },
    {
      id: 'kortebein2008',
      authors: 'Kortebein P, Symons TB, Ferrando A, et al.',
      year: 2008,
      title: 'Functional impact of 10 days of bed rest in healthy older adults',
      journal: 'J Gerontol A Biol Sci Med Sci',
      pmid: '18948558',
      doi: '10.1093/gerona/63.10.1076',
      url: 'https://pubmed.ncbi.nlm.nih.gov/18948558/',
    },
  ],
};

export default topic;
