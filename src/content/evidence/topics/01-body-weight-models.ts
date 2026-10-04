import type { EvidenceTopic } from '../schema';

/** Evidence topic for research/01-computational-body-weight-models.md (pure data). */
const topic: EvidenceTopic = {
  dossier: '01',
  slug: 'body-weight-models',
  title: 'Body-weight and body-composition models',
  scope:
    "The published mathematical models that predict how body weight, fat, lean tissue, glycogen and body water respond to what a person eats and how they move. These models are the backbone of Vitals' daily engine. This topic explains how each one works, how well it has been tested against real studies, and what it leaves out.",
  mechanisms: [
    {
      id: '01-macronutrient-flux-model',
      title: 'Three energy stores: fat, protein and glycogen',
      category: 'body',
      summary:
        "This daily model keeps a running account of three energy stores: fat, protein and glycogen (the body's stored carbohydrate). Each store changes by what is eaten, minus what is burned, plus small conversions between stores, such as sugar turned into fat. Body weight is then fat plus fat-free mass, and the water that travels with glycogen and protein is counted too. This is the published Hall 2010 model, built from eight linked equations.",
      howModelled:
        "Vitals does not run this daily model directly. Its engine keeps the same stores (fat, lean tissue and glycogen) but updates them hour by hour, taking each flow from the topic that studies it: fuel use from the carbohydrate topic, fat release and ketones from the ketosis topic, and lean tissue from the protein and resistance-training topics. The published model is a design reference, and the engine's weight is checked against its simpler successor (see the fast-track weight model entry). Protein's 1.6 g of bound water per gram is kept, but glycogen water uses the carbohydrate topic's 3 g per gram; the 2.7 g figure appears only inside that check. The starting split of the body comes from the body-composition estimation topic, based on the person's weight and body-fat estimate.",
      equation: `ρ_C · dG/dt = CI − DNL + GNG_P + GNG_F − G3P − CarbOx
ρ_F · dF/dt = (3·M_FFA/M_TG)·FI + ε_d·DNL − KU_excr − (1 − ε_k)·KTG − FatOx
ρ_P · dP/dt = PI − GNG_P − ProtOx
FFM = BM + ECF + ECP + ICW^ + P·(1 + h_P) + G·(1 + h_G) + ICS,   BW = FFM + F`,
      keyNumbers: [
        {
          label: 'Energy density of stored carbohydrate, fat and protein',
          value: 'ρ_C = 4.18, ρ_F = 9.44, ρ_P = 4.7 kcal/g',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Water carried with each store',
          value: 'h_G = 2.7 g water per g glycogen; h_P = 1.6 g water per g protein',
          note: 'So 1 g of glycogen lost removes 3.7 g of body mass, and 1 g of protein lost removes 2.6 g. The protein-water figure is a best estimate within a range of 1.1–2.2.',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Share of dietary fat energy that reaches the fat store',
          value: '0.952 (= 3 × 273 / 860)',
          note: 'The other 4.7% is glycerol, which the liver turns into glucose. Uses M_TG = 860 g/mol and M_FFA = 273 g/mol.',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Energy retained when converting between stores',
          value: 'ε_d = 0.835 (glucose to fat); ε_k = 0.81 (fatty acids to ketones)',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Starting composition rules',
          value:
            'Bone mineral = 4% of initial body weight; protein = 0.25 of lean cell mass; glycogen = 500 g',
          note: 'ICW/LCM = 0.70 at the start. The 2006 version used different water and protein constants (P/CM = 0.2, h_P = 2).',
          referenceIds: ['hall2010a', 'hall2006'],
        },
      ],
      timeCourse:
        'Built for day-to-day change. It averages each day and does not resolve swings within a day. The published version was integrated in steps of 0.1 day.',
      moderators:
        'Captured: starting body fat, the mix of macronutrients eaten, protein intake, sodium and activity level. Not captured: sex (except through starting composition), age, training status, resistance exercise, meal timing, hormones as explicit variables, alcohol, fibre and appetite.',
      grade: 'A',
      gradeReason:
        'Fitted to the Minnesota semistarvation study, then checked without refitting against several other ward and free-living studies.',
      status: 'established',
      caveats:
        'The paper presents the model as daily averages only. A few printed equations had to be re-derived because of transcription problems (see the lipolysis and initialisation notes), and the original model code could not be retrieved.',
      referenceIds: ['hall2010a', 'hall2006'],
      relatedMetricIds: ['fatMass', 'leanTissue', 'glycogenTotal'],
    },
    {
      id: '01-ecf-sodium-carbohydrate',
      title: 'Carbohydrate, sodium and the fluid outside cells',
      category: 'body',
      summary:
        "When carbohydrate intake falls, the kidneys excrete more sodium, and water leaves with it. The fluid outside the body's cells (extracellular fluid, or ECF) therefore shrinks within a day or two. This is a large part of why the scale drops quickly when carbohydrate is cut, and why it climbs back when carbohydrate returns.",
      howModelled:
        "Vitals does not use this equation; it appears only inside the reference model the engine is checked against. Body water comes from the transitions topic's terms instead: a carbohydrate-sensitive water term, a sodium term that follows salt intake, gut content and a few smaller shifts, each moving towards its own target over a day or two.",
      equation: `dECF/dt = (1/[Na]) · ( ΔNa_diet − ξ_Na·(ECF − ECF_init) − ξ_CI·(1 − CI/CI_b) ) + dECF_slow
τ_BW · d(dECF_slow)/dt = ξ_BW·(BW − BW_init) − dECF_slow`,
      keyNumbers: [
        {
          label: 'Sodium concentration used',
          value: '[Na] = 3.22 mg/ml',
          referenceIds: ['hall2010a', 'hall2011a'],
        },
        {
          label: 'Sodium excretion coefficient',
          value: 'ξ_Na = 3 mg/ml/d (= 3000 mg/L/d in the Lancet model)',
          referenceIds: ['hall2010a', 'hall2011a'],
        },
        {
          label: 'Extra sodium loss when carbohydrate is removed',
          value: 'ξ_CI = 4000 mg/d',
          referenceIds: ['hall2010a', 'hall2011a'],
        },
        {
          label: 'Slow coupling to body weight',
          value: 'ξ_BW = 0.16 ml/kg/d; τ_BW = 1000 d',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Sodium time constant (derived)',
          value: '[Na]/ξ_Na = 3.22 / 3 = 1.07 d',
          note: 'Derived by Vitals from the published equations.',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Steady-state fluid change for a carbohydrate cut (derived)',
          value: '−1.33 L × the fractional cut: −0.53 L for a 40% cut, −1.33 L for zero carbohydrate',
          note: 'Assumes no change in dietary sodium. Derived by Vitals.',
          referenceIds: ['hall2010a', 'hall2011a'],
        },
      ],
      timeCourse:
        'Sodium-driven changes settle with a time constant of about 1.07 days. The slower drift that tracks body weight has a time constant of 1000 days.',
      moderators:
        'Carbohydrate intake relative to the usual level, any change in dietary sodium, and change in body weight since the start.',
      grade: 'C',
      gradeReason:
        'Two small, older studies set the sodium coefficients; the mechanism (insulin holds on to sodium) is proposed in the model papers rather than tested here.',
      status: 'established',
      caveats:
        'Water handling is the weakest part of these models. In a later ward study, a fat-restricted diet lost more body water than the model predicted, and the study authors attributed this to water mechanisms the model does not contain.',
      referenceIds: ['hall2010a', 'hall2011a', 'hall2015'],
      relatedMetricIds: ['ecfShift', 'scaleWeight'],
    },
    {
      id: '01-energy-expenditure-adaptation',
      title: 'Energy expenditure and adaptation in the daily model',
      category: 'energy',
      summary:
        'Total energy expenditure is the sum of three parts: the heat of digesting food, the energy of physical activity, and resting metabolism (what the body burns at rest, including the cost of every internal conversion). When intake falls below the usual level, both resting metabolism and activity drift below what body size alone would predict. This drift is called adaptive thermogenesis. In overfeeding the model shows almost none.',
      howModelled:
        "Vitals does not use this adaptation variable. Adaptive thermogenesis comes from the energy-expenditure topic's model instead: a lagged response to the change in intake, split between resting metabolism and everyday movement, which builds over one to two weeks and fades over about two weeks once intake returns to normal. Expenditure is added up hour by hour, so no special solving step is needed.",
      equation: `TEE = TEF + PAE + RMR
TEF = α_F·FI + α_P·PI + α_C·CI
τ_T · dT/dt = λ₁·(ΔEI/EI_b) − T   if EI < EI_b;   λ₂·(ΔEI/EI_b) − T   otherwise
PAE = δ·(1 + σ·T)·BW + υ·BW
RMR = E_c + γ_B·M_B + γ_FFM·(FFM excluding brain, glycogen water and extra ECF) + γ_F·F + costs of conversions and tissue turnover
γ_FFM = γ^_FFM · [1 + (1 − σ)·T]`,
      keyNumbers: [
        {
          label: 'Thermic effect of food, by macronutrient',
          value: 'α_F = 0.025 (fat), α_P = 0.25 (protein), α_C = 0.075 (carbohydrate)',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Adaptation gain and lag',
          value: 'λ₁ = 0.74 (intake below baseline), λ₂ = 0.02 (above), τ_T = 7 d, σ = 0.52',
          note: 'Fitted to the Minnesota semistarvation data. λ₂ = 0.02 means essentially no adaptive thermogenesis in overfeeding.',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Steady-state adaptation for a 50% intake cut (derived)',
          value: 'T = −0.37: fat-free-mass metabolic rate −17.8%, activity coefficient −19%',
          note: 'Derived by Vitals from the equations above.',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Average metabolic rate of fat-free mass',
          value:
            'γ^_FFM = 19 kcal/kg/d; adipose γ_F = 4.5 kcal/kg/d; brain γ_B = 240 kcal/kg/d at M_B = 1.4 kg',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Organ rates behind the fat-free-mass figure (kcal/kg/d at mass)',
          value:
            'Skeletal muscle 13 (28 kg); liver 200 (1.8 kg); kidney 440 (0.31 kg); heart 440 (0.33 kg); residual lean 12 (23.2 kg)',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Energy cost of turnover and conversions',
          value:
            'η_F = 0.18, η_G = 0.21, η_P = 0.86, ε_P = 0.17 kcal/g; η_N = 5.4 kcal/g N; gluconeogenesis efficiency ε_g = 0.8',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Fixed offset for the average Minnesota subject',
          value: 'E_c = −435 kcal/d',
          note: 'Solved so that the baseline diet is in the stated balance.',
          referenceIds: ['hall2010a'],
        },
      ],
      timeCourse:
        'Adaptation builds with a time constant of 7 days when intake is cut. In this model it returns to zero once intake returns to baseline.',
      moderators:
        'Size of the intake change relative to baseline, body composition (fat-free mass and fat mass set resting rate) and activity level. Direction matters: adaptation is strong when eating less and almost absent when eating more.',
      grade: 'B',
      gradeReason:
        'The overall structure has been validated (grade A), but the individual coefficients, such as ATP costs and organ rates, are grade B, so we show the lower grade.',
      status: 'established',
      caveats:
        'The size of adaptation, its speed (7 days here, 14 days in the Lancet model) and the asymmetry between eating less and more are all uncertain. Some studies suggest adaptation lingers after intake normalises; this model does not.',
      referenceIds: ['hall2010a'],
      relatedMetricIds: [],
    },
    {
      id: '01-lipolysis-carbohydrate-adaptation',
      title: 'Fat release from fat cells and its response to carbohydrate',
      category: 'fuel',
      summary:
        'Lipolysis is the release of fatty acids from fat cells into the blood. In the model it scales with the surface of the fat stores, rises over about a day or two when carbohydrate intake drops, and is blunted at high body fat. Eating less carbohydrate raises fat release and fat burning, but the model shows this does not by itself mean faster fat loss when total calories are the same.',
      howModelled:
        "Vitals does not run this lipolysis equation. Fat release comes from the ketosis topic's fatty-acid model, which responds within hours to insulin, the energy deficit, exercise and ketone levels. The multi-day shift towards burning more fat after carbohydrate is cut emerges from the carbohydrate topic's glycogen stores rather than from a separate lag.",
      equation: `D_F = D^_F · (F/F_Keys)^(2/3) · [L_diet + L_PA]
τ_L · dL_diet/dt = 1 + (K_L)^(S_L) · [ (A_L − B_L)·exp(−k_L·CI/CI_b) + B_L − 1 ] / ( (K_L)^(S_L) + MAX{0, F/F_Keys − 1}^(S_L) ) − L_diet
k_L = ln( (A_L − B_L)/(1 − B_L) )
L_PA = ψ · ( (δ + υ)/(δ_init + υ_init) − 1 )`,
      keyNumbers: [
        {
          label: 'Baseline fat release',
          value: 'D^_F = 140 g/d',
          note: 'Defined as two-thirds fed plus one-third overnight-fasted lipolysis.',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Amplitude and floor of the carbohydrate effect',
          value: 'A_L = 3.8, B_L = 0.9, k_L = 3.37',
          referenceIds: ['hall2010a'],
        },
        { label: 'Lag', value: 'τ_L = 1/ln 2 = 1.44 d', referenceIds: ['hall2010a'] },
        {
          label: 'Obesity attenuation constants',
          value: 'K_L = 4, S_L = 2; activity gain ψ = 0.4',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Behaviour at the extremes (derived)',
          value: 'Zero carbohydrate: L_diet → 3.8. Half the carbohydrate: L_diet = 1.44',
          note: 'The paper describes the halving case as a factor of 1.4.',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Attenuation at high fat (derived)',
          value: '0.94 at 2 × F_Keys, 0.80 at 3 ×, 0.50 at 5 ×',
          note: 'F_Keys is the initial fat mass of the average Minnesota subject, about 9 kg; the exact value used in the code is unverified.',
          referenceIds: ['hall2010a', 'hall2006'],
        },
      ],
      timeCourse:
        'A first-order lag: the half-time is ln 2 × τ_L = 1 day, and the paper describes lipolysis reaching half its maximum after about 2 days of fasting.',
      moderators:
        'Carbohydrate intake relative to baseline, fat mass (release scales with F^(2/3) and is damped at high fat) and physical activity.',
      grade: 'B',
      gradeReason: 'Based on human tracer measurements, but each anchor comes from a single study.',
      status: 'established',
      caveats:
        "The lag equation as printed in the paper looks mis-transcribed: it would give L_diet = 2 on the baseline diet. The form shown here is Vitals' reading, consistent with the paper's text, the 2006 model and the baseline constraint. The exact F_Keys value is unverified.",
      referenceIds: ['hall2010a', 'hall2006'],
      relatedMetricIds: [],
    },
    {
      id: '01-ketogenesis-flux',
      title: 'Ketone production as a daily flux',
      category: 'fuel',
      summary:
        'The liver turns some of the fatty acids released from fat cells into ketones, an alternative fuel for the brain and muscles. In the model, production rises when a lot of fat is being released, and is held down by protein in the diet and by full glycogen stores. Above a threshold, ketones spill into the urine.',
      howModelled:
        "Vitals does not use this daily flux. Ketones come from the ketosis topic's hourly model, which gates production by liver glycogen, tracks the blood level as a pool and includes the weeks-long adaptation.",
      equation: `KTG = ρ_K · D_F · [ A_K · x/(K_K + x) · exp(−k_P·PI/PI_b) · exp(−k_G·G/G_init) ],   x = D_F/D^_F
KU_excr = 0   if KTG/ρ_K < KTG_thresh
        = ρ_K · KU_max · (KTG/ρ_K − KTG_thresh)/(KTG_max − KTG_thresh)   otherwise
KetOx = KTG − KU_excr`,
      keyNumbers: [
        { label: 'Energy density of ketones', value: 'ρ_K = 4.45 kcal/g', referenceIds: ['hall2010a'] },
        {
          label: 'Maximum share of released fatty acids turned into ketones',
          value: 'A_K = 0.8 when protein intake and glycogen are both zero',
          referenceIds: ['hall2010a', 'balasse1989'],
        },
        {
          label: 'Protein and glycogen damping',
          value: 'k_P = 0.69 = ln(0.8/0.4); k_G = 0.69 = ln(0.4/0.2); K_K = 1',
          note: 'A protein-modified fast halves ketones relative to fasting, and normal glycogen halves them again.',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Renal threshold, maximum urinary loss, maximum production',
          value: '70 / 20 / 400 g/d (KTG_thresh / KU_max / KTG_max)',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Baseline production (derived)',
          value: '4.45 × 140 × 0.1 = 62 kcal/d (about 14 g/d)',
          referenceIds: ['hall2010a'],
        },
      ],
      timeCourse: "The model has no multi-week keto-adaptation; it responds to each day's conditions.",
      moderators: 'Fat release rate, dietary protein relative to baseline, and glycogen level.',
      grade: 'C',
      gradeReason:
        'The anchors are qualitative ratios (for example, a protein-modified fast halves ketones), not measured curves.',
      status: 'established',
      caveats:
        'Blood ketone concentration and the weeks-long adaptation must come from the ketosis topic. The published equation uses whole-body glycogen, but liver glycogen probably gates ketone production; using it instead is a proposed change (grade C).',
      referenceIds: ['hall2010a', 'balasse1989'],
      relatedMetricIds: [],
    },
    {
      id: '01-protein-glycogen-turnover-gluconeogenesis',
      title: 'Protein and glycogen turnover, and new glucose from glycerol and amino acids',
      category: 'fuel',
      summary:
        'Every day the body breaks down and rebuilds protein and glycogen, and the liver makes new glucose (gluconeogenesis) from glycerol, the backbone of fat, and from amino acids. These flows set how fast each store responds to a change and how much energy the turnover itself costs.',
      howModelled:
        "Vitals does not run these turnover equations. New glucose is worked out hour by hour by the carbohydrate topic's model: it fills whatever part of the body's glucose need that liver glycogen and recycled lactate do not cover, up to a limit set by the protein and fat being burned (amino acids and glycerol).",
      equation: `D_P = D^_P · [ P/P_Keys + χ·(ΔPI/PI_b) ]
D_G = D^_G · (G/G_init)
Synth_X = D_X + dX/dt   for X in {F, P, G}
G3P = ρ_C · Synth_F · (M_G/M_TG)
GNG_F = FI·(ρ_C·M_G)/(ρ_F·M_TG) + D_F·ρ_C·(M_G/M_TG)
GNG_P = GNG^_P · [ P/P_Keys − Γ_C·(ΔCI/CI_b) + (Γ_P + χ)·(ΔPI/PI_b) ]`,
      keyNumbers: [
        {
          label: 'Protein breakdown at baseline',
          value: 'D^_P = 300 g/d (χ = 0, kept as a placeholder)',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Glycogen breakdown at baseline',
          value: 'D^_G = 180 g/d (70% liver, 30% muscle)',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Net glucose from amino acids at baseline',
          value: 'GNG^_P = 300 kcal/d',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Response of amino-acid glucose production',
          value:
            'Γ_C = 0.39 (nitrogen balance −4 g/d on removing carbohydrate); Γ_P = 0.32 (+56% with 2.5 × protein and −20% carbohydrate)',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Energy cost of glucose made from glycerol at baseline',
          value: '25 kcal/d',
          referenceIds: ['hall2010a'],
        },
      ],
      timeCourse:
        'Daily averages that scale with store size; no separate time constants beyond those in the fuel-oxidation entry.',
      moderators: 'Store sizes, carbohydrate and protein intake relative to baseline.',
      grade: 'B',
      gradeReason:
        'Turnover rates are whole-body tracer averages (grade B); the glucose-from-amino-acids terms rest on single studies (grade B/C).',
      status: 'established',
      caveats:
        'The amino-acid glucose terms are calibrated to one study each and are the least certain part of this entry.',
      referenceIds: ['hall2010a'],
      relatedMetricIds: [],
    },
    {
      id: '01-de-novo-lipogenesis',
      title: 'Turning carbohydrate into fat (de novo lipogenesis)',
      category: 'fuel',
      summary:
        'De novo lipogenesis (DNL) is the liver and fat tissue building new fat from carbohydrate. In the model it is small when glycogen stores are low and switches on strongly as they fill. On a normal diet it is a small flow; it becomes large only when carbohydrate intake is very high and glycogen is already full.',
      howModelled:
        "Vitals does not use this formula. DNL comes from the carbohydrate topic's model: carbohydrate becomes fat only when glycogen stores are nearly full and more keeps arriving, at about 3.2 g of carbohydrate per g of fat, with about 28% of the energy lost as heat. That cost replaces the 0.835 retained-energy factor used here.",
      equation: 'DNL = CI · (G/G_init)^d / ( (G/G_init)^d + K_DNL^d ),   K_DNL = 2, d = 4',
      keyNumbers: [
        { label: 'Shape constants', value: 'K_DNL = 2, d = 4', referenceIds: ['hall2010a'] },
        {
          label: 'DNL at baseline glycogen (derived)',
          value:
            'CI/17: about 107 kcal/d on the 1826 kcal/d carbohydrate intake of the Minnesota baseline diet',
          note: 'Consistent with basal DNL of about 100 kcal/d.',
          referenceIds: ['hall2010a', 'hall2006'],
        },
        {
          label: 'Simulated DNL in the Minnesota study',
          value:
            'About 100 kcal/d at baseline, 24 kcal/d in week 1 of semistarvation, 600–700 kcal/d during refeeding',
          referenceIds: ['hall2006'],
        },
        {
          label: 'Human capacity data',
          value:
            'Glycogen capacity about 15 g/kg body weight; about 500 g can be added before net lipogenesis dominates; saturated stores plus massive carbohydrate gave about 150 g/d of fat from about 475 g/d of carbohydrate',
          note: 'Three subjects.',
          referenceIds: ['acheson1988'],
        },
      ],
      timeCourse:
        'DNL follows the state of glycogen, so it falls within days of depletion and rises during refeeding, when stores are being refilled and then overflow.',
      moderators: 'Carbohydrate intake and glycogen fullness.',
      grade: 'B',
      gradeReason:
        'The curve is calibrated to several human lipogenesis measurements, but they are small studies.',
      status: 'established',
      caveats:
        'Differences between fructose and glucose, and between processed and unprocessed foods, are not represented.',
      referenceIds: ['hall2010a', 'hall2006', 'acheson1988'],
      relatedMetricIds: [],
    },
    {
      id: '01-fuel-oxidation-partition',
      title: 'Which fuel is burned: carbohydrate, fat or protein',
      category: 'fuel',
      summary:
        "Each day the model splits the body's energy use between carbohydrate, fat and protein. Fat burning follows how much fat is being released. Carbohydrate burning follows carbohydrate intake and glycogen. Protein burning follows protein intake, with a lag of about a day. Eating fat does not raise fat burning, and more physical activity lowers the protein share.",
      howModelled:
        "Vitals does not use these weighted fractions. Fuel use is worked out hour by hour by the carbohydrate topic's rules: the share of energy burned as carbohydrate depends on glycogen level and insulin, protein burned is what is absorbed but not built into tissue, and fat oxidation is whatever energy need is left. The respiratory quotient (the ratio of carbon dioxide breathed out to oxygen breathed in) and nitrogen balance are derived from those amounts.",
      equation: `CarbOx = GNG_F + GNG_P − G3P + f_C·TEE~
FatOx = KetOx + f_F·TEE~
ProtOx = f_P·TEE~
f_C = [ w_G·(D_G/D^_G) + w_C·MAX{0, 1 + S_C·ΔCI/CI_b}·G/(G_min + G) ] / Z
f_F = [ w_F·(D_F/D^_F) ] / Z
f_P = [ w_P·MAX{0, 1 + P_sig} + (D_P/D^_P)·S_A·exp(−k_A·(δ+υ)/(δ_b+υ_b)) ] / Z
τ_PI · dP_sig/dt = S_P·ΔPI/PI_b − P_sig
RQ = VCO2/VO2,   N_excr = (ProtOx + GNG_P)/(6.25·ρ_P)`,
      keyNumbers: [
        { label: 'Protein-oxidation lag', value: 'τ_PI = 1.1 d', referenceIds: ['hall2010a'] },
        { label: 'Minimum glycogen term', value: 'G_min = 10 g', referenceIds: ['hall2010a'] },
        {
          label: 'Weights fitted to the Minnesota data',
          value: 'w_P = 1.1, w_CG = 0.93, S_P− = 1.7',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Constants from perturbation constraints',
          value: 'S_P+ = 3.8, S_C = 0.85; for the Minnesota subject w_G = 9.4, w_F = 14.8',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Carbohydrate oxidation catching up with intake',
          value: 'About 5 d to near balance (12-day chamber study)',
          referenceIds: ['jebb1996'],
        },
      ],
      timeCourse:
        'Carbohydrate oxidation reaches near balance with intake in about 5 days; protein oxidation follows intake changes with a lag of 1.1 days; fat oxidation adjusts over the days it takes lipolysis to change.',
      moderators:
        'Carbohydrate and protein intake relative to baseline, glycogen level, fat release and activity level.',
      grade: 'B',
      gradeReason:
        'The partition reproduces measured respiratory-quotient time courses (grade A), but several weights are single-study constraints (grade B).',
      status: 'established',
      caveats:
        'Several weights are solved for each new user from baseline assumptions, and the printed equation for those weights was garbled and had to be re-derived.',
      referenceIds: ['hall2010a', 'jebb1996'],
      relatedMetricIds: [],
    },
    {
      id: '01-two-compartment-model-lancet',
      title: 'The fast-track weight model (Hall 2011, Body Weight Planner)',
      category: 'body',
      summary:
        'A simpler model with only fat, lean tissue, glycogen (with its water) and extracellular fluid. Any energy imbalance, after what goes into glycogen, is split between fat and lean tissue by a rule that gives lean tissue a bigger share when a person is leaner. It is the model behind the NIDDK Body Weight Planner and it has been tested against two years of real-world data.',
      howModelled:
        "Vitals does not run this model in the Simulator or the Planner; the Planner scores every candidate plan with the full engine. It serves as a reference instead: in macronutrient-neutral scenarios without resistance training, the full engine's weight must stay close to this model's prediction, both at 6 months and at the long-run plateau.",
      equation: `ρ_G · dG/dt = CI − k_G·G²,   k_G = CI_b / G_init²
ρ_F · dF/dt = (1 − p)·(EI − EE − ρ_G·dG/dt)
ρ_L · dL/dt =       p·(EI − EE − ρ_G·dG/dt)
p = C/(C + F),   C = 10.4 kg · ρ_L/ρ_F = 2.0 kg
EE = K + γ_F·F + γ_L·L + δ·BW + TEF + AT + η_L·dL/dt + η_F·dF/dt
TEF = β_TEF·ΔEI,   τ_AT · dAT/dt = β_AT·ΔEI − AT`,
      keyNumbers: [
        {
          label: 'Tissue energy densities',
          value: 'ρ_F = 39.5 MJ/kg, ρ_L = 7.6 MJ/kg, ρ_G = 17.6 MJ/kg',
          referenceIds: ['hall2011a'],
        },
        {
          label: 'Thermic and adaptive terms',
          value: 'β_TEF = 0.1; β_AT = 0.14 with τ_AT = 14 d',
          note: 'β_AT came from a review of eight weight-loss studies (157 subjects, stable losses of 7–54 kg).',
          referenceIds: ['hall2011a', 'hall2008b'],
        },
        {
          label: 'Metabolic rate per kg and tissue-deposition costs',
          value: 'γ_F = 13 kJ/kg/d, γ_L = 92 kJ/kg/d; η_F = 750 kJ/kg, η_L = 960 kJ/kg',
          referenceIds: ['hall2011a', 'hall2010b'],
        },
        {
          label: 'Glycogen response (derived)',
          value: 'G_ss = G_init × √(CI/CI_b); time constant 0.70 d for CI_b = 6.3 MJ/d',
          note: 'A 3-fold rise in carbohydrate raises glycogen about 1.8-fold.',
          referenceIds: ['hall2011a'],
        },
        {
          label: 'Time constant of body weight by starting fat (derived, sedentary)',
          value:
            '196 d at 5 kg fat; 289 d at 10 kg; 420 d at 20 kg; 507 d at 30 kg; 568 d at 40 kg; 651 d at 60 kg',
          note: 'Half-lives run from 136 d to 451 d over the same range.',
          referenceIds: ['hall2011a'],
        },
        {
          label: 'Rule of thumb from the paper',
          value: '100 kJ/d (24 kcal/d) sustained change in intake gives about 1 kg eventual weight change',
          note: 'Half of it in about 1 year and 95% in about 3 years, for an overweight adult.',
          referenceIds: ['hall2011a'],
        },
        {
          label: 'Fitted linear parameters in 2-year data',
          value:
            'CALERIE-2 (n = 140): ρ = 8840 ± 450 kcal/kg, ε = 25.8 ± 1.0 kcal/kg/d. Women 9916 kcal/kg, 24 kcal/kg/d, τ 414 d; men 9383, 28, 340 d',
          referenceIds: ['sanghvi2015', 'guo2018'],
        },
      ],
      timeCourse:
        'Glycogen and fluid settle within about 2–3 days. Adaptive thermogenesis follows intake with a lag of 14 days. Body weight approaches its new steady state with a time constant of roughly 200–650 days depending on starting fat, so the half-life is about a year for an overweight adult.',
      moderators:
        'Starting fat mass (leaner people lose a larger share as lean tissue and settle faster), activity level (more activity shortens the time constant), and sex and age through starting composition and resting rate.',
      grade: 'A',
      gradeReason:
        'Validated against controlled feeding studies and two years of free-living data, without refitting.',
      status: 'established',
      caveats:
        "Vitals' own re-implementation matched the paper's worked example (a 100 kg man losing 20 kg in 6 months), but its long-run plateau for a permanent 2 MJ/d cut was about 3 kg higher than the paper's 'about 75 kg' (78.1 kg at 10 years). Use a tolerance of ±3 kg. The model has no exercise effect on body composition and ignores protein.",
      referenceIds: ['hall2011a', 'hall2008b', 'hall2010b', 'sanghvi2015', 'guo2018'],
      relatedMetricIds: [],
    },
    {
      id: '01-forbes-partition-p-ratio',
      title: 'How much of a weight change is fat and how much is lean tissue',
      category: 'body',
      summary:
        'When body weight changes, some of the change is fat and some is fat-free tissue. Forbes found that the fatter a person is, the more of any change is fat. Hall extended this to larger changes, where a bigger loss takes a bigger lean share. The P-ratio says the same thing in energy terms: the fraction of an energy imbalance that comes from protein.',
      howModelled:
        "Vitals does not use this curve on its own. In a deficit, the protein topic's partition starts from the same Forbes curve (lean share falls as fat mass rises) and adjusts it for protein intake, deficit size, leanness, aerobic activity and age; resistance training then protects part of the lean share. In a surplus, the energy-surplus topic's partition is used.",
      equation: `FFM = 10.4 · ln(FM) + 14.2   (women of similar stature, kg)
dFFM/dBW = 10.4 / (10.4 + FM)
FM_f = 10.4 · W( (1/10.4) · exp(ΔBW/10.4) · FM_i · exp(FM_i/10.4) )   (W = Lambert-W function)
dE/dBW = ρ_F + (ρ_L − ρ_F) · dFFM/dBW
P-ratio = (dFFM/dBW) / [ dFFM/dBW + a·(1 − dFFM/dBW) ],   a = 9.05
p = 1/(1 + α),   α = (ρ_F/ρ_L)·(F/10.4)`,
      keyNumbers: [
        {
          label: 'Forbes constant',
          value: '10.4 kg',
          note: 'For men, FFM = 13.8 · ln(F/S) with S about 0.29; for women, FFM = 10.4 · ln(F/D) with D about 2.55.',
          referenceIds: ['forbes1987', 'hall2007'],
        },
        {
          label: 'Lean share of weight gained in overfeeding of 3 weeks or more',
          value: '60–70% in thin people, 30–40% in obese people',
          referenceIds: ['forbes2000'],
        },
        {
          label: 'Lean share in weight differences between twins',
          value: 'About one-half in thin pairs and about one-quarter in obese pairs',
          referenceIds: ['forbes2000'],
        },
        {
          label: 'Larger losses take more lean tissue',
          value:
            'After bariatric surgery: measured FFM loss 11.3 kg, Forbes prediction 6.7 kg, Hall 2007 prediction 9.9 kg',
          referenceIds: ['hall2007'],
        },
        {
          label: 'Energy density of weight loss, starting fat 20 kg (derived)',
          value: '28.0 / 26.5 / 24.7 MJ/kg for losses of 5 / 15 / 25 kg',
          note: 'Other starting fat masses (5 / 15 / 25 kg losses): 10 kg fat 22.2 / 20.0 / 17.9; 30 kg 30.9 / 30.0 / 28.8; 40 kg 32.6 / 32.0 / 31.2; 60 kg 34.6 / 34.3 / 33.9 MJ/kg.',
          referenceIds: ['hall2008a'],
        },
        {
          label: 'Energy content of loss, women vs men',
          value: '6804 ± 226 kcal/kg (women) vs 6119 ± 240 kcal/kg (men)',
          referenceIds: ['heymsfield2012'],
        },
        {
          label: 'Protein and training in a large deficit (4 weeks, young men, 40% deficit, training 6 d/wk)',
          value:
            '2.4 vs 1.2 g/kg/d protein: lean mass +1.2 ± 1.0 vs +0.1 ± 1.0 kg; fat mass −4.8 ± 1.6 vs −3.5 ± 1.4 kg',
          referenceIds: ['longland2016'],
        },
        {
          label: 'Energy deficit and resistance-training gains',
          value:
            'A deficit of about 500 kcal/d removes lean-mass gains (effect size −0.57 vs no deficit) but strength gains are preserved',
          referenceIds: ['murphy2022'],
        },
        {
          label: 'Rate of loss in athletes',
          value: 'Losing 0.7% per week gave +2.1% lean body mass; 1.4% per week gave −0.2%',
          referenceIds: ['garthe2011'],
        },
      ],
      timeCourse:
        'Not a time-dependent process in itself: it sets the split at each step of a weight change.',
      moderators:
        'Starting fatness (more fat, smaller lean share), size of the loss (bigger loss, larger lean share), protein intake, resistance training and slower rates of loss (all keep more lean tissue in the studies above, but are not in the Forbes/Hall partition), and sex.',
      grade: 'B',
      gradeReason:
        'Group averages for overweight people are well supported (grade A), but individuals who are lean are less well described (grade B), and the theory analysis is grade B.',
      status: 'established',
      caveats:
        'Partition models like this have no restoring force for body composition: a lean-tissue gain from resistance training would persist indefinitely unless another term removes it (the invariant-manifold result of Chow and Hall). Between-person variation in the P-ratio at the same deficit is large.',
      referenceIds: [
        'forbes1987',
        'forbes2000',
        'hall2007',
        'hall2008a',
        'dugdale1977',
        'chow2008',
        'dulloo1996',
        'heymsfield2012',
        'longland2016',
        'murphy2022',
        'garthe2011',
      ],
      relatedMetricIds: ['fatMass', 'leanTissue'],
    },
    {
      id: '01-thomas-pennington-model',
      title: 'The Pennington weight-change model (Thomas and colleagues)',
      category: 'body',
      summary:
        "An independent model from the Pennington Biomedical group. It tracks fat and fat-free mass using population body-composition curves, and models energy expenditure as digestion, activity, resting metabolism and spontaneous activity. It is the model behind the PBRC Weight Loss Predictor, and it fitted a six-month study well. In a two-year comparison it over-predicted final weight compared with Hall's model.",
      howModelled:
        "Not modelled; shown for context (it was biased in two-year data). It assumes two-thirds of the change in energy expenditure is spontaneous activity, which drives most of the difference from Hall's model.",
      equation: `R = I − E = c_l · dFFM/dt + c_f · dF/dt,   c_l = 1100 kcal/kg, c_f = 9500 kcal/kg
E = DIT + PA + RMR + SPA
DIT = β·I,   β = 0.075 at baseline
PA = m·W,   m = PA(0)/W(0)`,
      keyNumbers: [
        {
          label: 'Diet-induced thermogenesis and adaptation',
          value:
            'β = 0.075 baseline (range 0.075–0.086; multiplier 1.19 in overfeeding); metabolic adaptation a = 0.02 in restriction',
          referenceIds: ['thomas2011'],
        },
        {
          label: 'Spontaneous physical activity share',
          value: 's = 0.67 underfeeding, 0.56 overfeeding; SPA(0) = 0.326 × E(0)',
          referenceIds: ['thomas2011'],
        },
        {
          label: 'Six-month study (predicted vs observed mean weight)',
          value: '73.9 vs 72.6 kg; individual mean absolute error 1.8 ± 1.3 kg (max 4.3)',
          note: 'A simpler one-dimensional model had 4.5 ± 3.3 kg (max 12).',
          referenceIds: ['thomas2011'],
        },
        {
          label: 'Two-year comparison, bias in body weight change (model minus measured)',
          value: "Hall's model −0.47 (−0.92, −0.015) kg; Pennington model +3.8 (3.5, 4.2) kg",
          note: 'Fat mass: +0.78 (0.48, 1.1) vs +3.0 (2.7, 3.3) kg. Energy expenditure: −14 (−28, 0.03) vs −45 (−60, −31) kcal/d. 78 women, 35 men.',
          referenceIds: ['guo2018'],
        },
        {
          label: 'Plateau with realistic adherence',
          value:
            'Adding 5–10% extra expenditure suppression raises plateau weight (10% gives +11%) but does not bring it earlier (still 1–2 y)',
          referenceIds: ['thomas2014'],
        },
        {
          label: 'Adherence model fit',
          value:
            'Six-month study (n = 23): R² 0.96, bias 2.2 kg (−2.4, 6.8). Twin overfeeding: R² 0.93, bias 0.9 kg (−3.7, 5.5)',
          referenceIds: ['thomas2014'],
        },
        {
          label: 'Seven supervised studies (103 adults, 64.8 ± 23.6 d, deficit 1439 ± 784 kcal/d)',
          value: 'Actual loss 20.1 ± 11.3 lb vs 27.6 ± 16.0 lb from the 3500-kcal rule',
          note: 'In the 5 simulable studies the dynamic model gave 18.4 ± 13.8 lb against 17.0 ± 11.0 lb actual.',
          referenceIds: ['thomas2013'],
        },
      ],
      timeCourse:
        'Weight-loss plateaus appear only after 1–2 years in this model; an earlier plateau needs waning adherence.',
      moderators:
        'Age and sex (through the resting-rate equation and body-composition curves), starting fat, activity level and how consistently the prescribed intake is followed.',
      grade: 'B',
      gradeReason:
        "It fitted six-month data well, but it was biased in two-year data, unlike Hall's model (grade A).",
      status: 'established',
      caveats:
        'The model is only valid if intake exceeds expenditure at zero fat, and fails below roughly 1000 kcal/d. Measurement error explains roughly 55–58% of the individual variation in weight change in the two-year study.',
      referenceIds: ['thomas2011', 'thomas2013', 'thomas2014', 'guo2018'],
      relatedMetricIds: [],
    },
    {
      id: '01-fat-supply-limit-alpert',
      title: 'A proposed limit on how fast fat can be used (Alpert)',
      category: 'body',
      summary:
        'Alpert proposed that the fat store can only supply energy at a limited rate per kilogram of fat, and that any deficit beyond this rate is made up from lean tissue. It was derived from young, lean men in one starvation study. Vitals does not use it as a hard rule. It uses it only as a warning that a deficit may cost extra lean tissue.',
      howModelled:
        'The engine does not cap fat use. It compares the 7-day deficit with the estimated fat-supply rate and shows a caution when the deficit passes three-quarters of it. The partition model (see the Forbes entry) still does the actual splitting.',
      equation: `FatSupplyMax = 290 kJ/kg/d × F      (kJ/d)
Deficit D = EE − EI
if D ≤ FatSupplyMax:  dF/dt = −D/ρ_F
otherwise:  dF/dt = −FatSupplyMax/ρ_F,   dFFM/dt = −(D − FatSupplyMax)/ρ_FFM   (ρ_FFM about 8.5 MJ/kg)`,
      keyNumbers: [
        {
          label: 'Proposed cap',
          value: '290 ± 25 kJ per kg fat mass per day (= 69.3 kcal/kg/d = 31.4 kcal/lb/d)',
          note: 'The kcal conversions are derived by Vitals.',
          referenceIds: ['alpert2005'],
        },
        {
          label: 'Resting-rate slope reported alongside it',
          value: '249 ± 25 kJ per kg fat-free mass per day',
          note: 'This disagrees with cross-sectional slopes.',
          referenceIds: ['alpert2005'],
        },
        {
          label: 'Obese adults on a large deficit (derived)',
          value: '89 g fat/d = 840 kcal/d = 20 kcal/kg fat mass/d, 29% of the cap',
          note: 'Subjects had 42 kg of fat mass.',
          referenceIds: ['hall2015'],
        },
        {
          label: 'Minnesota men (derived, approximate)',
          value: 'About 55 kcal/kg fat mass/d, roughly 80% of the cap',
          note: 'Consistent with the cap, but not an independent test, since the cap came from the same study.',
          referenceIds: ['hall2006'],
        },
        {
          label: 'Later expenditure claim',
          value: 'By day 40 of severe restriction, basal expenditure was only 66% of the expected level',
          note: 'As summarised by Speakman and Westerterp.',
          referenceIds: ['alpert2007', 'speakman2013'],
        },
      ],
      timeCourse:
        'Alpert describes an early steady phase, a slow moderated decline of fat-free mass, then a final rapid unprotected decline.',
      moderators:
        'Fat mass sets the cap (a bigger fat store can supply more per day) and the size of the deficit sets whether it is exceeded.',
      grade: 'C',
      gradeReason:
        'It comes from one derivation in lean young men, and no later controlled human study tested it directly.',
      status: 'contested',
      caveats:
        "It fits the Minnesota data by construction and contradicts the smooth pattern that lean share rises gradually with deficit size and falls gradually with fatness. Speakman and Westerterp assume no limit and still predict hunger-strike and therapeutic-fast outcomes reasonably. Hall's model has no hard ceiling, and fat release is far above net fat burning, so release capacity is not what limits fat use.",
      referenceIds: ['alpert2005', 'alpert2007', 'speakman2013', 'hall2015', 'hall2006'],
      relatedMetricIds: [],
    },
    {
      id: '01-energy-density-of-weight-change',
      title: 'How many calories a kilogram of weight change is worth',
      category: 'body',
      summary:
        'A kilogram of lost weight is not a kilogram of pure fat. It is a mix of fat, lean tissue with its water, and glycogen with its water, and the mix changes over time and between people. So the energy content of a kilogram lost is not a constant. Early weight loss is worth far fewer calories per kilogram than later weight loss.',
      howModelled:
        'The engine never converts weight to calories with a fixed number. It tracks fat, lean tissue and glycogen separately, each with its own energy density, so the calories per kilogram of weight change come out of the model.',
      keyNumbers: [
        {
          label: 'Energy density of tissues',
          value:
            'Fat 39.5 MJ/kg (9.44 kcal/g); protein 19.7 MJ/kg (4.7 kcal/g); glycogen 17.6 MJ/kg (4.18 kcal/g)',
          referenceIds: ['hall2008a'],
        },
        {
          label: 'Lean tissue including its water',
          value: '7.6 MJ/kg (1820 kcal/kg)',
          referenceIds: ['hall2008a'],
        },
        {
          label: 'Where the 3500 kcal per pound rule comes from',
          value:
            '3500 kcal/lb = 7716 kcal/kg = 32.3 MJ/kg, from assuming lost adipose tissue is about 87% fat',
          referenceIds: ['hall2008a', 'wishnofsky1958'],
        },
        {
          label: 'Energy content of loss over time (CALERIE-1)',
          value: '4858 ± 388 kcal/kg at week 4, rising to 6041 ± 376 kcal/kg at week 6, flat afterwards',
          referenceIds: ['heymsfield2012'],
        },
        {
          label: 'Fat share of early weight loss in a ward study (6 days)',
          value:
            'Carbohydrate-restricted: −1.85 ± 0.15 kg with 245 ± 21 g fat. Fat-restricted: −1.30 ± 0.16 kg with 463 ± 37 g fat, so 13–36% of early loss is fat',
          referenceIds: ['hall2015'],
        },
        {
          label: 'Twelve-day chamber study',
          value:
            'At 67% less intake (3.5 MJ/d): −3.18 kg, and fat balance accounted for 84.0% of the energy deficit; at 33% more intake (+2.90 kg), 74.1% of the surplus',
          referenceIds: ['jebb1996'],
        },
        {
          label: 'Cost of putting weight on (42 days at +50% intake)',
          value: '28.7 ± 4.4 MJ per kg gained (theoretical 26.0); gain 7.6 ± 1.6 kg, of which 58 ± 18% fat',
          referenceIds: ['diaz1992'],
        },
        {
          label: 'What the rule predicts for a 100 kg man at −2 MJ/d over a year',
          value: '22 kg lost, about 100% greater than the dynamic model',
          referenceIds: ['hall2011a'],
        },
      ],
      timeCourse:
        'Early ("phase I") weight loss has a half-life under a week and lasts about 4–6 weeks. Its size depends on sex, activity, starting weight and diet, especially carbohydrate and sodium.',
      moderators:
        'Starting fat (leaner people lose a larger lean share, so each kilogram is worth fewer calories), size of the loss, sex, and carbohydrate and sodium intake in the first weeks.',
      grade: 'A',
      gradeReason: 'Well established by several controlled studies and by re-analysis of the original rule.',
      status: 'established',
      caveats:
        "Replacing the rule with a corrected fixed energy density does not fix it unless the falling energy deficit is also modelled. Diaz and Jebb's overfeeding figures come from small studies.",
      referenceIds: [
        'hall2008a',
        'hall2013',
        'wishnofsky1958',
        'heymsfield2011',
        'heymsfield2012',
        'hall2015',
        'jebb1996',
        'diaz1992',
        'hall2011a',
      ],
      relatedMetricIds: ['fatMass', 'leanTissue', 'scaleWeight'],
    },
    {
      id: '01-glycogen-water-early-weight-change',
      title: 'Glycogen, its water and fluid shifts in early weight change',
      category: 'fuel',
      summary:
        'The body holds about half a kilogram of glycogen, and each gram is stored with a few grams of water. When carbohydrate falls, glycogen and its water are lost within days, along with some extracellular fluid. These fast, water-heavy changes explain much of the early drop on the scale, and they come back when carbohydrate returns.',
      howModelled:
        "The engine tracks liver and muscle glycogen separately (from the carbohydrate topic) and counts their water at 3 g per gram rather than 2.7 g. It does not use this model's extracellular-fluid equation: “water weight” is glycogen and its water plus the transitions topic's water terms (carbohydrate-sensitive water, sodium-linked water, gut content and a few smaller shifts).",
      keyNumbers: [
        {
          label: 'Whole-body glycogen at baseline',
          value: 'About 500 g (model default)',
          referenceIds: ['hall2010a', 'hall2011a'],
        },
        {
          label: 'Glycogen storage capacity',
          value: 'About 15 g/kg body weight; about 500 g can be added before net lipogenesis dominates',
          note: 'Three subjects.',
          referenceIds: ['acheson1988'],
        },
        {
          label: 'Body-size formula for glycogen',
          value: '0.01355 × BW^0.76 + 0.002437 × BW^0.62 kg (muscle plus liver); about 0.38 kg at 70 kg',
          referenceIds: ['speakman2013'],
        },
        {
          label: 'Water stored per gram of glycogen',
          value:
            '2.7 g (liver measurements, used by Hall); "3 to 4 parts water" with 0.45 mmol potassium per g; at least 3 g/g in muscle biopsies, up to 17 g/g when excess water is given',
          note: 'Muscle biopsy result from 9 trained men.',
          referenceIds: ['mcbride1941', 'kreitzman1992', 'fernandezelias2015', 'olsson1970'],
        },
        {
          label: 'Glycogen time constant (derived)',
          value: 'About 0.7 d',
          referenceIds: ['hall2011a'],
        },
        {
          label: 'A 40% carbohydrate cut, within 2–3 days (derived)',
          value: '0.11 kg glycogen, 0.31 kg glycogen water and 0.53 L extracellular fluid',
          referenceIds: ['hall2011a'],
        },
        {
          label: 'First week at −5 MJ/d in the reference example (derived)',
          value:
            '1.83 kg lost, of which 0.11 kg glycogen, 0.30 kg glycogen water and 0.53 L extracellular fluid',
          referenceIds: ['hall2011a'],
        },
        {
          label: 'Water bound to protein',
          value: 'h_P = 1.6 g/g (range 1.1–2.2)',
          referenceIds: ['hall2010a', 'hall2008a'],
        },
      ],
      timeCourse:
        'Glycogen settles in about 0.7 days and extracellular fluid in about 1.07 days, so most of the fast change is done within 2–3 days. Overall early ("phase I") weight loss has a half-life under one week.',
      moderators:
        'Carbohydrate intake, muscle mass (more muscle stores more) and exercise (which depletes worked muscle). Liver glycogen probably empties within about 1–2 days of fasting, but this was not verified.',
      grade: 'B',
      gradeReason:
        'Several human studies support the glycogen and water figures (grade B), while capacity, the body-size formula and the fluid numbers are grade C.',
      status: 'established',
      caveats:
        'Water handling is the weakest part of these models: early-phase predictions carry ±0.5–1 kg of uncertainty, and the reported water per gram of glycogen ranges widely, from 2.7 g/g to 17 g/g depending on hydration. A later ward study lost more water on a fat-restricted diet than the model predicted.',
      referenceIds: [
        'hall2010a',
        'hall2011a',
        'acheson1988',
        'speakman2013',
        'mcbride1941',
        'kreitzman1992',
        'fernandezelias2015',
        'olsson1970',
        'hall2008a',
      ],
      relatedMetricIds: ['scaleWeight', 'glycogenWater', 'glycogenTotal'],
    },
    {
      id: '01-hourly-glucose-insulin-layer',
      title: 'Meal-by-meal glucose and insulin (hourly layer)',
      category: 'fuel',
      summary:
        "Hall's models average each day, which hides meals, eating windows and fasting hours. To see these, Vitals follows glucose and insulin hour by hour and feeds that insulin signal to the rest of the engine. Its structure comes from decades of glucose-tolerance research. Using it to predict body weight has never been tested.",
      howModelled:
        "Vitals runs this layer hour by hour without smaller steps: each meal's glucose and insulin rise follows a smooth curve from the carbohydrate topic, calculated exactly for each hour, and meal carbohydrate enters through a gut-absorption model. The ±5% consistency rule is kept as a test: for steady menus, a day of hourly fuel use must match the carbohydrate topic's daily form within ±5%. Meals suppress fat release through insulin in the ketosis topic's fatty-acid model; there is no separate multi-day lipolysis term.",
      equation: `dGp/dt = −(S_G + X)·Gp + S_G·G_b + Ra(t)/V
dX/dt = −p2·X + p3·(I − I_b),   S_I = p3/p2
Ra(t): oral glucose appearance (piecewise-linear, or a stomach-and-gut model with glucose-dependent emptying)`,
      keyNumbers: [
        {
          label: 'Typical volume and glucose effectiveness',
          value: 'V about 1.45 dl/kg, S_G about 0.025 1/min',
          note: 'Could not be confirmed against the original paper; checked values and normal insulin sensitivity come from the carbohydrate topic.',
          referenceIds: ['cobelli2014'],
        },
        {
          label: 'Integration sub-steps',
          value: '1–5 min inside each hourly step',
          referenceIds: ['bergman1979', 'bergman1981'],
        },
        {
          label: 'Consistency rule with the daily model',
          value: '24-h integral of hourly terms must match Hall 2010 daily fluxes within ±5%',
          note: 'This rule is our proposal.',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Fast meal-related lipolysis suppression',
          value: 'Time constant about 1–2 h, calibrated so the daily mean equals D^_F = 140 g/d',
          note: 'Proposed by Vitals.',
          referenceIds: ['hall2010a'],
        },
      ],
      timeCourse:
        'Plasma glucose and insulin regulation acts over minutes; the post-meal suppression of fat release acts over about 1–2 hours.',
      moderators: 'Insulin sensitivity, meal size and composition, and the timing of meals.',
      grade: 'D',
      gradeReason:
        'The glucose-and-insulin structure is well validated for tolerance tests (grade A), but using it to predict body weight has never been validated, so we grade that use D.',
      status: 'proposed-fit',
      caveats:
        "Downscaling daily-validated fluxes to hourly is untested, and the consistency rule is our proposal. Insulin effects are only implicit in Hall's daily model.",
      referenceIds: [
        'bergman1979',
        'bergman1981',
        'dallaman2007a',
        'dallaman2002',
        'cobelli2014',
        'dallaman2007b',
        'hall2010a',
      ],
      relatedMetricIds: [],
    },
    {
      id: '01-ketone-concentration-pool',
      title: 'Blood ketone level as a pool (proposed)',
      category: 'fuel',
      summary:
        "Hall's model gives ketone production in grams per day but not the level in the blood. To show a blood ketone level, Vitals adds a pool that fills with production and drains by burning and, above a limit, through the kidneys. The structure is proposed here, and the ketosis topic will fit its parameters to fasting and low-carbohydrate data.",
      howModelled:
        "This is how the engine works, through the ketosis topic's model: production is computed from fat release, dietary protein and liver glycogen, and feeds a blood pool that is emptied by a saturating burn rate and by urine loss above a threshold. The pool is updated four times an hour, with parameters fitted by the ketosis topic.",
      equation: 'V_K · dBHB/dt = KTG(t)/ρ_K_molar − V_max·BHB/(K_m + BHB) − renal(BHB)',
      keyNumbers: [
        {
          label: 'Overnight-fasted ketones on a 50% carbohydrate diet',
          value: '0.068 ± 0.009 mM',
          referenceIds: ['hall2015'],
        },
        {
          label: 'After 6 days of a 30%-restricted diet with about 140 g/d carbohydrate',
          value: '+0.088 mM (no nutritional ketosis)',
          referenceIds: ['hall2015'],
        },
        {
          label: 'Renal excretion begins',
          value: 'Above ketone production of about 70 g/d',
          note: 'The daily model caps production at 400 g/d and excretion at 20 g/d.',
          referenceIds: ['hall2010a'],
        },
        {
          label: 'Modelled range and starting value',
          value: '0.05–7 mmol/L; starts at 0.07 mM',
          referenceIds: ['hall2015'],
        },
      ],
      timeCourse: 'Hours to days for entry and exit; the multi-week adaptation belongs to the ketosis topic.',
      moderators: 'Fat release, protein intake, liver glycogen and the state of keto-adaptation.',
      grade: 'D',
      gradeReason:
        'The pool structure and all its parameters are expert judgement; only the anchor values are measured.',
      status: 'proposed-fit',
      caveats:
        'Using liver glycogen rather than whole-body glycogen to gate production is biological reasoning (grade C). The pool parameters are still to be fitted by the ketosis topic.',
      referenceIds: ['hall2015', 'hall2010a'],
      relatedMetricIds: [],
    },
    {
      id: '01-post-exercise-mps-signal',
      title: 'Muscle protein synthesis after training and after a protein meal (proposed)',
      category: 'recovery',
      summary:
        'Muscle protein synthesis (MPS) is the rate at which muscle builds new protein. After hard resistance training it stays raised for a day or two, and after a protein meal it rises briefly and returns to baseline within a few hours even when amino acids stay high. Vitals shows both signals in a display of muscle protein synthesis.',
      howModelled:
        "Vitals shows muscle protein synthesis as a display built from the protein topic's meal-by-meal model, with a boost after training; that display does not change muscle mass. Muscle gain comes from the resistance-training model, which works from weekly training and average daily protein, and lean loss from the partition model.",
      equation: 'MPS_RT(t) = A · exp(−(t − t_RT)/τ_RT),   A = 1.22 (122% above rest), τ_RT = 37.7 h',
      keyNumbers: [
        {
          label: 'Elevation after resistance exercise (untrained, fasted)',
          value: '+112% at 3 h, +65% at 24 h, +34% at 48 h',
          note: 'A second measure (fractional breakdown rate) rose by 31%, 18% and 0% at the same times.',
          referenceIds: ['phillips1997'],
        },
        {
          label: 'Different time course in a second study',
          value: '+50% at 4 h, +109% at 24 h, within 14% (not significant) of control at 36 h',
          referenceIds: ['macdougall1995'],
        },
        {
          label: 'Fit to the first study (proposed)',
          value: 'A = 1.22, τ_RT = 37.7 h; reproduces 112%, 64% and 34%',
          note: 'Our fit to three data points, not a published equation.',
          referenceIds: ['phillips1997'],
        },
        {
          label: 'Response to 48 g of whey protein',
          value:
            'Fractional synthesis rate 0.03 → 0.10 %/h at 45–90 min; back to baseline by about 2–3 h despite high amino acids',
          referenceIds: ['atherton2010'],
        },
        {
          label: 'Daily model protein costs and muscle share',
          value:
            'D_P = 300 g/d × P/P_Keys; synthesis costs 0.86 kcal/g, breakdown 0.17 kcal/g; muscle share of a change in fat-free mass 0.59',
          referenceIds: ['hall2010a'],
        },
      ],
      timeCourse:
        'Resistance-exercise signal: elevated about 3 hours after training, still raised at 24 hours and roughly back to baseline by 36–48 hours. Meal pulse: peaks at 45–90 minutes and ends by about 2–3 hours.',
      moderators:
        'Training status, dose and distribution of protein, and age. These are handled in the protein and resistance-training topics.',
      grade: 'B',
      gradeReason:
        'Two small human studies measured the time course directly, but they disagree on its shape, and the equation is our own fit.',
      status: 'proposed-fit',
      caveats:
        'The two studies bracket the uncertainty: one peaks early, the other peaks at 24 hours and fades sooner. A gamma-shaped curve could be used instead. Dose-response and per-meal limits are for the protein topic.',
      referenceIds: ['phillips1997', 'macdougall1995', 'atherton2010', 'hall2010a'],
      relatedMetricIds: [],
    },
  ],
  myths: [
    {
      id: '01-myth-3500-kcal-rule',
      claim:
        'A deficit of 3500 kcal equals one pound lost, so a 500 kcal per day deficit loses a pound a week indefinitely.',
      verdict: 'not-supported',
      explanation:
        'The rule is wrong in two ways. First, the calories in a kilogram of lost weight depend on how much fat a person starts with and how much they lose, ranging from 4,300 to 8,300 kcal/kg. Second, energy expenditure falls as weight falls, so the deficit shrinks and weight approaches a new level gradually, with a half-life of about a year. In seven supervised studies, the rule predicted 27.6 lb lost on average; the actual loss was 20.1 lb.',
      referenceIds: ['hall2011a', 'hall2008a', 'thomas2013', 'hall2013'],
    },
    {
      id: '01-myth-plateau-metabolism-shutdown',
      claim: 'A weight-loss plateau at about six months shows that your metabolism has shut down.',
      verdict: 'not-supported',
      explanation:
        'In controlled feeding, weight loss is nearly linear for six months, and model plateaus appear only after one to two years or more. A plateau at six months is better explained by falling adherence. In one outpatient dataset, the estimated intake drop of about 800 kcal/d lasted only about 6 weeks and was back to baseline by about 10 months. Metabolic adaptation changes the level of the plateau, not when it happens.',
      referenceIds: ['hall2010a', 'hall2011a', 'thomas2014'],
    },
    {
      id: '01-myth-calorie-macronutrient-debate',
      claim:
        'Either "a calorie is a calorie, so macronutrients never matter", or "carbohydrate restriction uniquely burns fat through insulin".',
      verdict: 'oversimplified',
      explanation:
        'In a six-day ward study, removing carbohydrate raised fat burning but produced less body-fat loss than removing the same calories from fat (245 g against 463 g). In another study, a very-low-carbohydrate diet (often called ketogenic) with the same calories slowed fat loss and increased protein loss. Models predict that body fat is fairly insensitive to the carbohydrate-to-fat ratio at fixed calories and protein, while weight (water and glycogen) is not. Macronutrients do matter for protein balance, water and appetite.',
      referenceIds: ['hall2015', 'hall2016'],
    },
    {
      id: '01-myth-quarter-of-loss-is-lean',
      claim: 'One quarter of any weight lost is fat-free mass.',
      verdict: 'oversimplified',
      explanation:
        'A quarter is only a rough average. The lean share depends on starting fatness, the size of the loss, exercise, age and how it is measured. For a 5 kg loss it works out at about 15% for someone with 60 kg of fat and about 54% for someone with 10 kg of fat (derived by Vitals).',
      referenceIds: ['heymsfield2014', 'hall2007'],
    },
    {
      id: '01-myth-fat-release-cap',
      claim:
        'You can lose at most a fixed number of calories of fat per day, and the rest of a bigger deficit comes from muscle.',
      verdict: 'unproven',
      explanation:
        'This idea comes from one analysis of lean young men in one starvation study, and no later controlled study has tested it directly. Obese adults on a large deficit reach only about 29% of the proposed cap. Vitals treats it as a warning, not as a physiological law.',
      referenceIds: ['alpert2005', 'speakman2013', 'hall2015'],
    },
    {
      id: '01-myth-diet-exercise-interchangeable',
      claim: 'Exercise and diet deficits of the same size are interchangeable.',
      verdict: 'oversimplified',
      explanation:
        'Activity expenditure scales with body weight, so an energy-equivalent activity change and diet change follow different paths. For small changes activity produces slightly more loss, and for large changes diet produces more. Real-life compensation in intake and spontaneous activity lies outside the model.',
      referenceIds: ['hall2011a'],
    },
    {
      id: '01-myth-early-lowcarb-loss-is-fat',
      claim: 'The rapid early loss on a low-carbohydrate diet is fat.',
      verdict: 'not-supported',
      explanation:
        'Early ("phase I") loss has a half-life of under a week and lasts 4–6 weeks. It is disproportionately glycogen, water and sodium-driven fluid. In a six-day ward study only 13–36% of early weight loss was fat. The energy content of the loss rises from about 4,900 to about 6,000 kcal/kg over weeks 4–6 as more of it becomes fat.',
      referenceIds: ['heymsfield2011', 'heymsfield2012', 'hall2015'],
    },
    {
      id: '01-myth-adaptive-thermogenesis-persists',
      claim:
        'After weight loss, metabolism stays suppressed for years, beyond what your smaller body explains.',
      verdict: 'unproven',
      explanation:
        "This is contested. Some studies show persistent reductions after weight loss, including in a two-year enclosed-habitat experiment and the Minnesota study. But the NIH Body Weight Planner with no extra adaptation term fitted two-year weight-loss data better than a model with explicit extra adaptation. Vitals' best estimate is an adaptation of 0.14 of the intake change with a 14-day time constant, and the energy-expenditure topic decides how much persists.",
      referenceIds: ['leibel1995', 'weyer2000', 'dulloo1998', 'guo2018', 'hall2011a'],
    },
  ],
  openQuestions: [
    'Resistance training and protein dose are absent from every validated whole-body model. The only extension found was fitted, not validated, so the training and protein parts of the engine will be its least-tested section.',
    'Water is uncertain: how much water each gram of glycogen holds (2.7 g versus 3–4 g), the sodium coefficients, which rest on two small studies, and the water loss on a fat-restricted diet that the model missed. Early-phase weight predictions carry ±0.5–1 kg of uncertainty.',
    "Adaptive thermogenesis is uncertain in size (β_AT = 0.14 came from steady-state data), in speed (7 days versus 14 days), in asymmetry (λ₁ = 0.74 versus λ₂ = 0.02), and in whether it lingers after intake returns to normal. Hall's adaptation returns to zero, while some studies suggest a composition-linked effect that persists.",
    'People differ. Baseline energy expenditure is known only to about 5% without special testing, which gives a spread of ±4 kg after years for a −2 MJ/d change. Measurement error explains about half of the observed variation between individuals, so Vitals shows ranges, not single values.',
    'Validation is thin for lean, trained, older and female people. The main datasets are lean young men (Minnesota) and mostly overweight adults (CALERIE).',
    'Several details of the 2010 model are ambiguous: the lipolysis equation normalisation, a garbled weights equation that was re-derived, the glycogen normalisation, and the unreported Minnesota reference masses (F_Keys is about 9 kg; P_Keys and G_Keys are not tabulated). Getting the original model code would remove them.',
    'Scaling daily-validated flows down to hours has not been validated. The ±5% consistency rule is our own proposal.',
    "Alpert's limit on fat use has no independent test.",
    'Forbes-type partition gives no restoring force for body composition. Whether the body defends lean mass after a training-induced gain has to come from the resistance-training evidence.',
    'Appetite is not modelled: intake is an input. In reality, about 100 kcal/d of extra intake per kg lost is three times the energy-expenditure adaptation. This matters for how feasible a plan is, not for the physics of the simulator.',
  ],
  references: [
    {
      id: 'hall2010a',
      authors: 'Hall KD',
      year: 2010,
      title: 'Predicting metabolic adaptation, body weight change, and energy intake in humans',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '19934407',
      doi: '10.1152/ajpendo.00559.2009',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2838532/',
    },
    {
      id: 'hall2006',
      authors: 'Hall KD',
      year: 2006,
      title: 'Computational model of in vivo human energy metabolism during semistarvation and refeeding',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '16449298',
      doi: '10.1152/ajpendo.00523.2005',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2377067/',
    },
    {
      id: 'hall2011a',
      authors: 'Hall KD, Sacks G, Chandramohan D, Chow CC, Wang YC, Gortmaker SL, Swinburn BA',
      year: 2011,
      title: 'Quantification of the effect of energy imbalance on bodyweight',
      journal: 'Lancet',
      pmid: '21872751',
      doi: '10.1016/S0140-6736(11)60812-X',
      url: 'https://www.niddk.nih.gov/-/media/Files/BWP/Hall_Lancet_Web_Appendix.pdf',
    },
    {
      id: 'chow2008',
      authors: 'Chow CC, Hall KD',
      year: 2008,
      title: 'The dynamics of human body weight change',
      journal: 'PLoS Comput Biol',
      pmid: '18369435',
      doi: '10.1371/journal.pcbi.1000045',
      url: 'https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1000045',
    },
    {
      id: 'hall2007',
      authors: 'Hall KD',
      year: 2007,
      title: "Body fat and fat-free mass inter-relationships: Forbes's theory revisited",
      journal: 'Br J Nutr',
      pmid: '17367567',
      doi: '10.1017/S0007114507691946',
    },
    {
      id: 'hall2008a',
      authors: 'Hall KD',
      year: 2008,
      title: 'What is the required energy deficit per unit weight loss?',
      journal: 'Int J Obes (Lond)',
      pmid: '17848938',
      doi: '10.1038/sj.ijo.0803720',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2376744/',
    },
    {
      id: 'forbes1987',
      authors: 'Forbes GB',
      year: 1987,
      title: 'Lean body mass-body fat interrelationships in humans',
      journal: 'Nutr Rev',
      pmid: '3306482',
      doi: '10.1111/j.1753-4887.1987.tb02684.x',
    },
    {
      id: 'forbes2000',
      authors: 'Forbes GB',
      year: 2000,
      title: 'Body fat content influences the body composition response to nutrition and exercise',
      journal: 'Ann N Y Acad Sci',
      pmid: '10865771',
      doi: '10.1111/j.1749-6632.2000.tb06482.x',
    },
    {
      id: 'dugdale1977',
      authors: 'Dugdale AE, Payne PR',
      year: 1977,
      title: 'Pattern of lean and fat deposition in adults',
      journal: 'Nature',
      pmid: '859600',
      doi: '10.1038/266349a0',
    },
    {
      id: 'thomas2011',
      authors: 'Thomas DM, Martin CK, Heymsfield S, Redman LM, Schoeller DA, Levine JA',
      year: 2011,
      title: 'A simple model predicting individual weight change in humans',
      journal: 'J Biol Dyn',
      pmid: '24707319',
      doi: '10.1080/17513758.2010.508541',
    },
    {
      id: 'thomas2013',
      authors: 'Thomas DM, Martin CK, Lettieri S, Bredlau C, Kaiser K, Church T, Bouchard C, Heymsfield SB',
      year: 2013,
      title: 'Can a weight loss of one pound a week be achieved with a 3500-kcal deficit?',
      journal: 'Int J Obes (Lond)',
      pmid: '23628852',
      doi: '10.1038/ijo.2013.51',
    },
    {
      id: 'hall2013',
      authors: 'Hall KD, Chow CC',
      year: 2013,
      title: 'Why is the 3500 kcal per pound weight loss rule wrong?',
      journal: 'Int J Obes (Lond)',
      pmid: '23774459',
      doi: '10.1038/ijo.2013.112',
    },
    {
      id: 'thomas2014',
      authors:
        'Thomas DM, Martin CK, Redman LM, Heymsfield SB, Lettieri S, Levine JA, Bouchard C, Schoeller DA',
      year: 2014,
      title:
        'Effect of dietary adherence on the body weight plateau: a mathematical model incorporating intermittent compliance with energy intake prescription',
      journal: 'Am J Clin Nutr',
      pmid: '25080458',
      doi: '10.3945/ajcn.113.079822',
    },
    {
      id: 'guo2018',
      authors: 'Guo J, Brager DC, Hall KD',
      year: 2018,
      title: 'Simulating long-term human weight-loss dynamics in response to calorie restriction',
      journal: 'Am J Clin Nutr',
      pmid: '29635495',
      doi: '10.1093/ajcn/nqx080',
    },
    {
      id: 'sanghvi2015',
      authors: 'Sanghvi A, Redman LM, Martin CK, Ravussin E, Hall KD',
      year: 2015,
      title:
        'Validation of an inexpensive and accurate mathematical method to measure long-term changes in free-living energy intake',
      journal: 'Am J Clin Nutr',
      pmid: '26040640',
      doi: '10.3945/ajcn.115.111070',
    },
    {
      id: 'hall2008b',
      authors: 'Hall KD, Jordan PN',
      year: 2008,
      title: 'Modeling weight-loss maintenance to help prevent body weight regain',
      journal: 'Am J Clin Nutr',
      pmid: '19064508',
      doi: '10.3945/ajcn.2008.26333',
    },
    {
      id: 'hall2010b',
      authors: 'Hall KD',
      year: 2010,
      title: 'Mathematical modelling of energy expenditure during tissue deposition',
      journal: 'Br J Nutr',
      pmid: '20132585',
      doi: '10.1017/S0007114510000206',
    },
    {
      id: 'alpert2005',
      authors: 'Alpert SS',
      year: 2005,
      title: 'A limit on the energy transfer rate from the human fat store in hypophagia',
      journal: 'J Theor Biol',
      pmid: '15615615',
      doi: '10.1016/j.jtbi.2004.08.029',
      verification: 'abstract',
    },
    {
      id: 'alpert2007',
      authors: 'Alpert SS',
      year: 2007,
      title:
        'The cross-sectional and longitudinal dependence of the resting metabolic rate on the fat-free mass',
      journal: 'Metabolism',
      pmid: '17292725',
      doi: '10.1016/j.metabol.2006.10.018',
      verification: 'unverified',
    },
    {
      id: 'speakman2013',
      authors: 'Speakman JR, Westerterp KR',
      year: 2013,
      title:
        'A mathematical model of weight loss under total starvation: evidence against the thrifty-gene hypothesis',
      journal: 'Dis Model Mech',
      pmid: '22864023',
      doi: '10.1242/dmm.010009',
    },
    {
      id: 'heymsfield2011',
      authors: 'Heymsfield SB, Thomas D, Nguyen AM, et al.',
      year: 2011,
      title: 'Voluntary weight loss: systematic review of early phase body composition changes',
      journal: 'Obes Rev',
      pmid: '20524998',
      doi: '10.1111/j.1467-789X.2010.00767.x',
    },
    {
      id: 'heymsfield2012',
      authors: 'Heymsfield SB, Thomas D, Martin CK, et al.',
      year: 2012,
      title: 'Energy content of weight loss: kinetic features during voluntary caloric restriction',
      journal: 'Metabolism',
      pmid: '22257646',
      doi: '10.1016/j.metabol.2011.11.012',
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
    },
    {
      id: 'wishnofsky1958',
      authors: 'Wishnofsky M',
      year: 1958,
      title: 'Caloric equivalents of gained or lost weight',
      journal: 'Am J Clin Nutr',
      pmid: '13594881',
      doi: '10.1093/ajcn/6.5.542',
    },
    {
      id: 'kreitzman1992',
      authors: 'Kreitzman SN, Coxon AY, Szaz KF',
      year: 1992,
      title:
        'Glycogen storage: illusions of easy weight loss, excessive weight regain, and distortions in estimates of body composition',
      journal: 'Am J Clin Nutr',
      pmid: '1615908',
      doi: '10.1093/ajcn/56.1.292S',
    },
    {
      id: 'fernandezelias2015',
      authors: 'Fernandez-Elias VE, Ortega JF, Nelson RK, Mora-Rodriguez R',
      year: 2015,
      title:
        'Relationship between muscle water and glycogen recovery after prolonged exercise in the heat in humans',
      journal: 'Eur J Appl Physiol',
      pmid: '25911631',
      doi: '10.1007/s00421-015-3175-z',
    },
    {
      id: 'acheson1988',
      authors: 'Acheson KJ, Schutz Y, Bessard T, Anantharaman K, Flatt JP, Jequier E',
      year: 1988,
      title:
        'Glycogen storage capacity and de novo lipogenesis during massive carbohydrate overfeeding in man',
      journal: 'Am J Clin Nutr',
      pmid: '3165600',
      doi: '10.1093/ajcn/48.2.240',
    },
    {
      id: 'olsson1970',
      authors: 'Olsson KE, Saltin B',
      year: 1970,
      title: 'Variation in total body water with muscle glycogen changes in man',
      journal: 'Acta Physiol Scand',
      pmid: '5475323',
      doi: '10.1111/j.1748-1716.1970.tb04764.x',
      verification: 'unverified',
    },
    {
      id: 'mcbride1941',
      authors: 'McBride J, Guest M, Scott E',
      year: 1941,
      title:
        'The storage of the major liver components; emphasizing the relationship of glycogen to water in the liver and the hydration of glycogen',
      journal: 'J Biol Chem',
      verification: 'unverified',
    },
    {
      id: 'hall2015',
      authors: 'Hall KD, Bemis T, Brychta R, et al.',
      year: 2015,
      title:
        'Calorie for calorie, dietary fat restriction results in more body fat loss than carbohydrate restriction in people with obesity',
      journal: 'Cell Metab',
      pmid: '26278052',
      doi: '10.1016/j.cmet.2015.07.021',
    },
    {
      id: 'hall2016',
      authors: 'Hall KD, Chen KY, Guo J, et al.',
      year: 2016,
      title:
        'Energy expenditure and body composition changes after an isocaloric ketogenic diet in overweight and obese men',
      journal: 'Am J Clin Nutr',
      pmid: '27385608',
      doi: '10.3945/ajcn.116.133561',
      verification: 'abstract',
    },
    {
      id: 'dulloo1996',
      authors: 'Dulloo AG, Jacquet J, Girardier L',
      year: 1996,
      title:
        'Autoregulation of body composition during weight recovery in human: the Minnesota Experiment revisited',
      journal: 'Int J Obes Relat Metab Disord',
      pmid: '8696417',
    },
    {
      id: 'dulloo1998',
      authors: 'Dulloo AG, Jacquet J',
      year: 1998,
      title:
        'Adaptive reduction in basal metabolic rate in response to food deprivation in humans: a role for feedback signals from fat stores',
      journal: 'Am J Clin Nutr',
      pmid: '9734736',
      doi: '10.1093/ajcn/68.3.599',
    },
    {
      id: 'weyer2000',
      authors: 'Weyer C, Walford RL, Harper IT, Milner M, MacCallum T, Tataranni PA, Ravussin E',
      year: 2000,
      title: 'Energy metabolism after 2 y of energy restriction: the Biosphere 2 experiment',
      journal: 'Am J Clin Nutr',
      pmid: '11010936',
      doi: '10.1093/ajcn/72.4.946',
    },
    {
      id: 'diaz1992',
      authors: 'Diaz EO, Prentice AM, Goldberg GR, Murgatroyd PR, Coward WA',
      year: 1992,
      title: 'Metabolic response to experimental overfeeding in lean and overweight healthy volunteers',
      journal: 'Am J Clin Nutr',
      pmid: '1414963',
      doi: '10.1093/ajcn/56.4.641',
    },
    {
      id: 'jebb1996',
      authors: 'Jebb SA, Prentice AM, Goldberg GR, Murgatroyd PR, Black AE, Coward WA',
      year: 1996,
      title:
        'Changes in macronutrient balance during over- and underfeeding assessed by 12-d continuous whole-body calorimetry',
      journal: 'Am J Clin Nutr',
      pmid: '8780332',
      doi: '10.1093/ajcn/64.3.259',
    },
    {
      id: 'leibel1995',
      authors: 'Leibel RL, Rosenbaum M, Hirsch J',
      year: 1995,
      title: 'Changes in energy expenditure resulting from altered body weight',
      journal: 'N Engl J Med',
      pmid: '7632212',
      doi: '10.1056/NEJM199503093321001',
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
    },
    {
      id: 'phillips1997',
      authors: 'Phillips SM, Tipton KD, Aarsland A, Wolf SE, Wolfe RR',
      year: 1997,
      title: 'Mixed muscle protein synthesis and breakdown after resistance exercise in humans',
      journal: 'Am J Physiol',
      pmid: '9252485',
      doi: '10.1152/ajpendo.1997.273.1.E99',
    },
    {
      id: 'macdougall1995',
      authors: 'MacDougall JD, Gibala MJ, Tarnopolsky MA, MacDonald JR, Interisano SA, Yarasheski KE',
      year: 1995,
      title: 'The time course for elevated muscle protein synthesis following heavy resistance exercise',
      journal: 'Can J Appl Physiol',
      pmid: '8563679',
      doi: '10.1139/h95-038',
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
      id: 'bergman1981',
      authors: 'Bergman RN, Phillips LS, Cobelli C',
      year: 1981,
      title: 'Physiologic evaluation of factors controlling glucose tolerance in man',
      journal: 'J Clin Invest',
      pmid: '7033284',
      doi: '10.1172/JCI110398',
    },
    {
      id: 'bergman1979',
      authors: 'Bergman RN, Ider YZ, Bowden CR, Cobelli C',
      year: 1979,
      title: 'Quantitative estimation of insulin sensitivity',
      journal: 'Am J Physiol',
      pmid: '443421',
      doi: '10.1152/ajpendo.1979.236.6.E667',
    },
    {
      id: 'dallaman2007a',
      authors: 'Dalla Man C, Rizza RA, Cobelli C',
      year: 2007,
      title: 'Meal simulation model of the glucose-insulin system',
      journal: 'IEEE Trans Biomed Eng',
      pmid: '17926672',
      doi: '10.1109/TBME.2007.893506',
      verification: 'unverified',
    },
    {
      id: 'dallaman2002',
      authors: 'Dalla Man C, Caumo A, Cobelli C',
      year: 2002,
      title: 'The oral glucose minimal model: estimation of insulin sensitivity from a meal test',
      journal: 'IEEE Trans Biomed Eng',
      pmid: '12002173',
      doi: '10.1109/10.995680',
    },
    {
      id: 'cobelli2014',
      authors: 'Cobelli C, Dalla Man C, Toffolo G, Basu R, Vella A, Rizza R',
      year: 2014,
      title: 'The oral minimal model method',
      journal: 'Diabetes',
      pmid: '24651807',
      doi: '10.2337/db13-1198',
    },
    {
      id: 'dallaman2007b',
      authors: 'Dalla Man C, Raimondo DM, Rizza RA, Cobelli C',
      year: 2007,
      title: 'GIM, simulation software of meal glucose-insulin model',
      journal: 'J Diabetes Sci Technol',
      pmid: '19885087',
      doi: '10.1177/193229680700100303',
    },
    {
      id: 'balasse1989',
      authors: 'Balasse EO, Fery F',
      year: 1989,
      title: 'Ketone body production and disposal: effects of fasting, diabetes, and exercise',
      journal: 'Diabetes Metab Rev',
      verification: 'unverified',
    },
  ],
};

export default topic;
