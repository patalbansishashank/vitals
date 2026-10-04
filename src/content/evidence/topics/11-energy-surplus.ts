import type { EvidenceTopic } from '../schema';

/** Evidence topic for research/11-overfeeding-surplus-partitioning.md (pure data). */
const topic: EvidenceTopic = {
  dossier: '11',
  slug: 'energy-surplus',
  title: 'Energy surplus: where the extra energy goes',
  scope:
    'What happens to energy eaten above what the body burns: how much is lost as heat, how the rest is split between glycogen, fat and lean tissue, and how that depends on the food eaten, the size and length of the surplus, protein, training and body fatness. It also covers short surpluses such as cheat days and refeeds inside a diet, where the new fat is deposited, and the extra fat that can build up after a big diet.',
  mechanisms: [
    {
      id: '11-energy-accounting-overfeeding-studies',
      title: 'Energy accounting for a surplus, and the classic overfeeding studies',
      category: 'body',
      summary:
        'Energy eaten above expenditure cannot disappear. It is either lost as heat (digestion, the cost of building tissue, the higher upkeep of a bigger body and adaptive heat production, including fidgeting) or stored as glycogen, fat or lean tissue. In well-controlled studies the heat-lost part is modest on average, about 10–40%, but it differs several-fold between people. About 60–90% of the excess is stored across controlled studies.',
      howModelled:
        'The engine writes one balance: intake minus the sum of body-size expenditure, digestion, extra carbohydrate heat, adaptive heat and the cost of converting carbohydrate to fat equals the energy going into glycogen, fat and lean tissue, each with its own energy density and building cost.',
      equation: `EI − [EE_base(FM, LT, BW) + TEF + TH_C + AT_OF + C_DNL] = ρG·dG/dt + (ρF + ηF)·dFM/dt + (ρL + ηL)·dLT/dt
EE_base = K + γF·FM + γL·LT + δ·BW (+ exercise expenditure)`,
      keyNumbers: [
        {
          label: 'Tissue energy densities and building costs',
          value:
            'Fat 39.5 MJ/kg = 9 441 kcal/kg (cost 750 kJ/kg = 179 kcal/kg); lean tissue 7.6 MJ/kg = 1 816 kcal/kg (cost 960 kJ/kg = 229 kcal/kg); glycogen 17.6 MJ/kg = 4 207 kcal/kg',
          note: 'Bouchard used 9 300 kcal/kg for fat and 1 020 kcal/kg for lean tissue. The building cost of fat is about 2% of its energy.',
          referenceIds: ['hall2011a', 'hall2010b'],
        },
        {
          label: 'Upkeep of body tissue and activity',
          value:
            'Resting rate 13 and 92 kJ/kg/d (3.1 and 22 kcal/kg/d) per kg of fat and lean tissue; activity about 30 kJ/kg/d (about 7 kcal/kg/d) when sedentary',
          referenceIds: ['hall2011a'],
        },
        {
          label: 'Pooled results',
          value:
            '60–90% of the excess stored; weight gained is 60–67% fat and 33–40% fat-free mass (Forbes pooled: 38–44% lean); excess of 8.05 kcal/g (33.7 kJ/g) gained, pooled n = 48',
          referenceIds: ['joosen2006', 'forbes1986'],
        },
        {
          label:
            'Bouchard, 24 lean young men (12 identical twin pairs), +1000 kcal/d on 84 of 100 days (84 000 kcal)',
          value:
            'Weight +8.1 ± 2.4 kg (range 4.3–13.3), fat +5.4 kg, fat-free +2.7 kg; 63% stored (body energy 497 → 719 MJ of 353 MJ excess), about 40–100% between individuals; 10 370 kcal per kg gained',
          referenceIds: ['bouchard1990'],
        },
        {
          label: 'Levine, 16 non-obese adults, +1000 kcal/d for 56 days',
          value: 'Weight +4.7 ± 1.8 kg; 45% stored (432 kcal/d stored vs 531 dissipated); 11 900 kcal per kg',
          referenceIds: ['levine1999a', 'joosen2006'],
        },
        {
          label: 'Diaz, 9 men, +50% (6.2 ± 1.9 MJ/d) for 42 days, total 265 ± 45 MJ',
          value:
            'Weight +7.6 ± 1.6 kg; fat about 4.4 kg (58 ± 18% of gain); fat-free about 3.2 kg; 75% stored (derived); 8 340 kcal per kg',
          referenceIds: ['diaz1992'],
        },
        {
          label: 'Johannsen, 35 adults, +1158 ± 205 kcal/d (+40%) for 56 days',
          value:
            'Weight +7.5 ± 1.9 kg; fat +4.2 ± 1.4 kg; fat-free about 3.3 kg; about 70% stored (derived); 8 650 kcal per kg',
          referenceIds: ['johannsen2019'],
        },
        {
          label: 'Bray, +954 kcal/d for 56 days on 5% / 15% / 25% protein',
          value:
            'Weight +3.16 / +6.05 / +6.51 kg; fat +3.66 / +3.45 / +3.44 kg; lean body mass −0.70 / +2.87 / +3.18 kg; about 71% and 72% stored at 15% and 25%; 16 900 / 8 830 / 8 210 kcal per kg',
          referenceIds: ['bray2012'],
        },
        {
          label: 'Shorter studies',
          value:
            'Roberts: +1011 kcal/d for 21 days, +2.5 kg, 85–90% stored (87% of stored energy as fat). Ravussin: ×1.6 for 9 days, +3.2 kg, 75% stored, about 5 380 kcal per kg. Jebb: +33% for 12 days, +2.90 kg. Siervo: +20/+40/+60% for 3 weeks each, +5.98 kg, 11.6–13.1% unaccounted',
          referenceIds: ['roberts1990', 'ravussin1985', 'jebb1996', 'siervo2008'],
        },
        {
          label: 'Carbohydrate vs fat surplus',
          value:
            'Horton: +50% as pure carbohydrate or pure fat for 14 days, about +2.7 kg, 75–85% vs 90–95% stored. Lammert: +5 MJ/d for 21 days, +1.5 kg (fat +0.9, fat-free +0.6), no carbohydrate-versus-fat difference in fat gain',
          referenceIds: ['horton1995', 'lammert2000'],
        },
        {
          label: 'Other populations',
          value:
            'Forbes: own data about +4.4 ± 0.6 kg over about 3 weeks, fat-free about 50% of gain, 6 700 kcal per kg; pooled 8 050 kcal per kg. Guru Walla (9 lean Cameroonian men): 17 ± 4 kg over 61–65 days, 64–75% of it fat, total expenditure unchanged because activity fell. Ad libitum snacks for 8 weeks: +4.6 ± 2.2 kg, fat +3.8 ± 1.7 kg',
          referenceIds: ['forbes1986', 'pasquet1992', 'tchoukalova2010', 'votruba2012'],
        },
        {
          label: 'Regularities used for calibration',
          value:
            'Mean fraction stored in long (6 weeks or more) mixed-diet studies about 0.70 (range of study means 0.45–0.75); shorter studies store 75–90%; excess per kg gained about 6.7 kcal/g at 3 weeks and 8–12 kcal/g at 6–14 weeks; weight-gain CV between people 20–40%',
          note: 'The 3 500 kcal per pound rule (7 700 kcal/kg) under-states the excess needed for chronic gain. Identical twins: within-pair correlation about 0.5 for weight and fat gain (about 0.4 for fat-free mass) and about 0.7 for visceral fat after adjusting for fat gain.',
          referenceIds: ['joosen2006', 'forbes1986', 'bouchard1990'],
        },
      ],
      timeCourse:
        'Shorter studies store more of the excess (75–90%) because the tissue-driven rise in expenditure is still small.',
      moderators:
        'Duration, the macronutrient supplying the surplus, initial fatness, and individual differences in adaptive heat production.',
      grade: 'A',
      gradeReason:
        'Several metabolic-ward overfeeding studies, a systematic review and a validated model agree; predicting one individual is much less certain (grade C).',
      status: 'established',
      caveats:
        'Most cohorts are young men. Individual-level prediction is poor, so ranges are shown rather than single values. Bouchard and Levine used different energy densities for the tissues gained.',
      referenceIds: [
        'hall2011a',
        'hall2010b',
        'joosen2006',
        'forbes1986',
        'bouchard1990',
        'levine1999a',
        'diaz1992',
        'johannsen2019',
        'bray2012',
        'roberts1990',
        'ravussin1985',
        'jebb1996',
        'siervo2008',
        'horton1995',
        'lammert2000',
        'pasquet1992',
        'tchoukalova2010',
        'votruba2012',
      ],
      relatedMetricIds: ['energyBalance', 'fatMass', 'leanTissue'],
    },
    {
      id: '11-oxidative-hierarchy',
      title: 'Which fuel is burned first in a surplus',
      category: 'fuel',
      summary:
        'The body burns first what it stores poorly: alcohol, then protein, then carbohydrate, and last fat, which it can store almost without limit. Extra carbohydrate or protein raises its own burning within days and displaces fat burning. Extra fat does not raise fat burning. So whatever food supplies the surplus, the day-to-day surplus ends up as positive fat balance once the glycogen buffer fills, mainly by sparing fat burning rather than by making new fat from carbohydrate.',
      howModelled:
        'Alcohol and protein burning are set first, then carbohydrate burning (intake minus what goes into glycogen or fat), and fat burning is the leftover of total expenditure. Fat burning is not a function of fat intake.',
      equation: `A_ox = 7.0·A
P_ox = 4·(P − 1000·f_prot·dLT/dt)        (f_prot about 0.20 kg protein per kg lean tissue, unverified)
C_ox = 4·C − ρG·dG/dt − 4·C_over
F_ox = max(0, EE_total − A_ox − P_ox − C_ox)      (residual, not a function of fat intake)
fat balance (g/d) = F + DNL_net − F_ox/9.44`,
      keyNumbers: [
        {
          label: 'Extra fat for 36 hours (+106 ± 6 g/d, 987 ± 55 kcal)',
          value:
            '24-h expenditure 2 783 vs 2 820 kcal (not significant); fat oxidation 1 032 vs 1 042 kcal/d; fat balance tracked energy balance (r = 0.96) while carbohydrate balance did not (r = −0.12)',
          referenceIds: ['schutz1989'],
        },
        {
          label: '+33% mixed diet, 12-day calorimeter',
          value:
            'Carbohydrate 540 g/d intake vs 551 g/d oxidised by day 12, close to balance by day 5; fat oxidation 59 g/d despite 150 g/d intake; fat balance was 74.1% of the energy imbalance',
          referenceIds: ['jebb1996'],
        },
        {
          label: '5-day phases from −50% to +50% carbohydrate energy',
          value:
            'Whole-body carbohydrate oxidation rose about six-fold and fat oxidation fell by more than 90% on surplus carbohydrate; +50% fat had no effect on glucose production, DNL or fuel selection',
          referenceIds: ['schwarz1995'],
        },
        {
          label: '+50% mixed diet for 42 days',
          value: 'Fat oxidation suppressed 37% in lean people vs 64% in people with overweight',
          referenceIds: ['diaz1992', 'joosen2006'],
        },
        {
          label: '3 days at 1.4 × basal (mixed)',
          value:
            '24-h RER 0.857 → 0.893 (obesity-prone) and 0.852 → 0.886 (obesity-resistant); protein oxidation rose in both',
          referenceIds: ['schmidt2013'],
        },
        {
          label: 'Carbohydrate at about 2.5 × expenditure',
          value: 'RER 0.81 → 0.99 (day 1) → 1.15 (day 4)',
          referenceIds: ['aarsland1997'],
        },
        {
          label: 'Alcohol at +25% of energy (96 ± 4 g/d)',
          value:
            '24-h lipid oxidation −49.4 ± 6.7 g/d (−36%); carbohydrate and protein oxidation unchanged; 24-h expenditure +7 ± 1%',
          referenceIds: ['suter1992'],
        },
      ],
      timeCourse:
        'Carbohydrate oxidation converges to intake with a time constant of about 1–1.7 days (about 95% by day 3–5); protein oxidation adjusts within about 1–3 days; fat oxidation responds only indirectly, as the residual; the alcohol effect lasts only for the drinking period.',
      moderators:
        'Obesity-prone or overweight people suppress fat oxidation more; protein and carbohydrate intake.',
      grade: 'A',
      gradeReason: 'Multiple whole-room calorimetry studies agree.',
      status: 'established',
      caveats:
        'The protein-content-of-lean-tissue factor is unverified here and belongs to the protein topic.',
      referenceIds: [
        'schutz1989',
        'jebb1996',
        'schwarz1995',
        'diaz1992',
        'joosen2006',
        'schmidt2013',
        'aarsland1997',
        'suter1992',
      ],
      relatedMetricIds: [],
    },
    {
      id: '11-glycogen-buffer-overflow',
      title: 'The glycogen buffer and carbohydrate overflow',
      category: 'fuel',
      summary:
        'The first few hundred grams of surplus carbohydrate go into glycogen, stored with about 3 g of water per gram. That is why the scale jumps after a high-carbohydrate day. Glycogen can expand to about 15 g per kilogram of body weight before the body has to either burn the rest (respiratory quotient towards 1) or convert it to fat (respiratory quotient above 1).',
      howModelled:
        'Glycogen fills with carbohydrate intake, slowed by a saturation term that only bites near the maximum, and drains at a rate that rises with the square of the store. Carbohydrate that cannot be burned or stored is the overflow that goes to fat synthesis.',
      equation: `ρG·dG/dt = 4·C·(1 − (G/G_max)^8) − kG·G²,   kG = 4·C_b/G₀²
G_max = 0.015 kg/kg · BW
W_G = w_G · G,   w_G = 2.7
C_room = (EE_total − A_ox − P_ox)/4               (most carbohydrate that can be burned at RQ about 1, g/d)
C_over = max(0, C − C_room − ρG·(dG/dt)/4)         (g/d that must go to fat synthesis)`,
      keyNumbers: [
        {
          label: 'Baseline store',
          value: 'G₀ = 0.5 kg on a mixed diet (0.3–0.6)',
          referenceIds: ['hall2011a'],
        },
        {
          label: 'Capacity',
          value: 'G_max = 15 g per kg body weight; about 500 g can be added before net fat synthesis (3 men)',
          referenceIds: ['acheson1988'],
        },
        {
          label: 'One 479 g starch meal (6 men)',
          value:
            'Glycogen +408 ± 19 g at 5 h and +346 ± 12 g at 10 h; no net fat synthesis; thermic effect 5.9%',
          referenceIds: ['acheson1982'],
        },
        {
          label:
            'Glycogen stored from 500 g of carbohydrate after 3–6 days of a high-fat / mixed / high-carbohydrate diet',
          value:
            '278 ± 6 / 197 ± 11 / 170 ± 2 g; net fat synthesis 0.8 / 3.4 / 9 g; thermic effect 5.2 / 6.5 / 8.6%',
          referenceIds: ['acheson1984'],
        },
        {
          label: 'Water per gram of glycogen',
          value: '2.7 g/g (3–4 in another source)',
          referenceIds: ['hall2011a', 'kreitzman1992'],
        },
        {
          label: 'Time constant (derived)',
          value:
            'About 0.9 d for G₀ = 0.5 kg and carbohydrate 300 g/d; the observed approach to carbohydrate balance is slower (3–5 days)',
          note: "Hall's quadratic alone reproduces three times the carbohydrate intake giving about 1.8 times the glycogen.",
          referenceIds: ['hall2011a', 'jebb1996'],
        },
      ],
      timeCourse:
        'Glycogen refills over a few days, more slowly than the quadratic law implies. Integrate in steps of 2 hours or less, because a one-day step overshoots.',
      moderators:
        'Prior low-carbohydrate eating or a deficit (low glycogen means more room and less overflow), and overweight (less whole-body DNL and more glycogen synthesis after carbohydrate overfeeding).',
      grade: 'B',
      gradeReason: 'A few small but precise balance studies agree, and the mechanism is uncontested.',
      status: 'proposed-fit',
      caveats:
        'The saturation term (exponent 8) is a proposed addition, chosen so storage is unimpeded below about 75% of the maximum and stops at the maximum. The glycogen topic should calibrate the kinetics.',
      referenceIds: [
        'hall2011a',
        'acheson1988',
        'acheson1982',
        'acheson1984',
        'kreitzman1992',
        'jebb1996',
        'minehira2004',
      ],
      relatedMetricIds: [],
    },
    {
      id: '11-de-novo-lipogenesis-surplus',
      title: 'Making fat from carbohydrate in a surplus (de novo lipogenesis)',
      category: 'fuel',
      summary:
        'De novo lipogenesis (DNL) is the making of fat from carbohydrate, at a large energy cost of about a quarter. In people it is not the pathway of first resort: until carbohydrate intake exceeds total expenditure, surplus carbohydrate is simply burned in place of fat. DNL matters for whole-body fat only in massive carbohydrate overfeeding with full glycogen stores, but it does matter for liver fat and blood fats after sugar surpluses even when its mass is small.',
      howModelled:
        'Net fat made is 0.32 g per gram of overflow carbohydrate. About 24.5% of the overflow energy is lost as heat. A separate liver-DNL signal rises with the carbohydrate surplus and the fructose share and feeds the liver-fat estimate, but it is not added to fat mass, because it is already inside the energy balance.',
      equation: `DNL_net = y_DNL · C_over        (g fat/d, y_DNL = 0.32)
C_DNL = 4·C_over − 9.44·DNL_net   (heat, about 0.98 kcal per g of overflow carbohydrate, about 24.5%)
x_C = max(0, 4·(C − CHO_ref))/EI_ref
DNL_hep = DNL_hep0 · (1 + 3·x_C) · m_fruc      (g fatty acid/d; DNL_hep0 about 1–2 g/d; m_fruc = 1 + 1.0 × fructose share of the carbohydrate surplus)`,
      keyNumbers: [
        {
          label:
            'Massive carbohydrate overfeeding after depletion (3 men, 7 days, 11/3/86% protein/fat/carbohydrate, 3 642 → 4 930 kcal/d)',
          value:
            'Once stores saturated, about 150 g of fat a day was made from about 475 g of carbohydrate a day: 0.32 g fat per g carbohydrate, an energy efficiency of about 0.75 (cost about 25%)',
          referenceIds: ['acheson1988'],
        },
        {
          label: 'Carbohydrate at about 2.5 × expenditure, day 4',
          value:
            'Large whole-body net fat synthesis; hepatic secretion of new fat rose about 35-fold but was a small share, so adipose tissue is the main site',
          note: 'The abstract printed day-4 net synthesis as 2 243 ± 253 in per-minute units; only a per-day unit is plausible (about 157 g/d at 70 kg), and this unit is unverified.',
          referenceIds: ['aarsland1997'],
        },
        {
          label: '+50% carbohydrate for 5 days',
          value:
            'Fractional liver DNL more than 10-fold higher, but absolute liver DNL under 5 g of fatty acid a day',
          referenceIds: ['schwarz1995'],
        },
        {
          label: '+50% as sucrose or glucose for 96 hours',
          value:
            'DNL 2–3-fold higher; VLDL DNL 2 → at most 10 g/d, against a fat balance of about 275 g over 96 h; sucrose the same as glucose',
          referenceIds: ['mcdevitt2001'],
        },
        {
          label: '+5 MJ/d carbohydrate-rich for 21 days',
          value:
            'Fractional liver DNL 0.20 (vs 0.03 fat-rich); absolute liver DNL 211 g per 21 days (about 10 g/d); whole-body DNL 332 (SEM 191) g per 21 days (about 16 g/d), positive in 6 of 10; fat gain not different from fat-rich overfeeding',
          referenceIds: ['lammert2000'],
        },
        {
          label: '4 days at 175% of energy, 71% carbohydrate',
          value:
            'Glucose-stimulated net DNL 35 → 156 mg/kg fat-free mass per 5 h (lean) vs 49 → 64 (overweight)',
          referenceIds: ['minehira2004'],
        },
        {
          label: 'Sugar and fructose surpluses',
          value:
            '+1000 kcal/d sugar for 3 weeks: DNL +98%, liver fat +33%. Fructose 4 g/kg/d for 6 days (143% of energy): liver fat +102 ± 36%, glucose production +16%, fasting fat oxidation −100%',
          referenceIds: ['luukkonen2018', 'lecoultre2014'],
        },
        {
          label: 'Fit for the liver signal (proposed)',
          value:
            'About ×2–3 at +50% sugar (x_C about 0.5 gives ×2.5); ×2 (+98%) at +1000 kcal sugar (x_C about 0.4 gives ×2.2); about 10 g/d at +5 MJ/d carbohydrate',
          referenceIds: ['mcdevitt2001', 'luukkonen2018', 'lammert2000'],
        },
      ],
      timeCourse:
        'Net fat synthesis starts once glycogen is saturated, a few days into a massive carbohydrate surplus.',
      moderators: 'Glycogen fullness, fructose share, obesity and insulin resistance.',
      grade: 'B',
      gradeReason:
        'Tracer studies agree, but the whole-body magnitude comes only from small balance studies.',
      status: 'proposed-fit',
      caveats: 'The liver-DNL signal is a proposed fit (grade C) and must not be double-counted in fat mass.',
      referenceIds: [
        'acheson1988',
        'aarsland1997',
        'schwarz1995',
        'mcdevitt2001',
        'lammert2000',
        'minehira2004',
        'luukkonen2018',
        'lecoultre2014',
        'hellerstein1999',
      ],
      relatedMetricIds: [],
    },
    {
      id: '11-storage-efficiency-dissipation',
      title: 'Storage efficiency and heat loss by macronutrient',
      category: 'energy',
      summary:
        'Storing dietary fat as body fat costs about 2% of its energy, storing glucose as glycogen about 5–7%, and converting carbohydrate or protein to fat about 25%. Digestion costs 0–3% of fat energy, 5–10% of carbohydrate, 20–30% of protein and 10–30% of alcohol. A carbohydrate surplus also raises expenditure beyond digestion, a fat surplus does not, and a protein surplus raises resting expenditure.',
      howModelled:
        'Digestion is a fixed fraction of each macronutrient. A carbohydrate-specific extra heat term applies to the carbohydrate above the habitual amount when intake is above the reference, and an optional protein term raises resting expenditure with protein above the habitual amount.',
      equation: `TEF = 0.25·(4P) + 0.075·(4C) + 0.025·(9F) + 0.20·(7A)                   kcal/d
TH_C = φ_C · max(0, 4·(C − CHO_ref)) · 1[EI > EI_ref]                       kcal/d
ΔREE_P (optional) = k_P · max(0, P − P_ref)                                  kcal/d`,
      keyNumbers: [
        {
          label: 'Digestion (thermic effect) by macronutrient',
          value:
            'Protein 0.25 (0.20–0.30), carbohydrate 0.075 (0.05–0.10), fat 0.025 (0–0.03), alcohol 0.20 (0.10–0.30)',
          referenceIds: ['westerterp2004', 'tappy1996'],
        },
        {
          label: 'Cost of storage',
          value:
            'Fat to fat about 2%; glucose to glycogen about 5–7%; carbohydrate or protein to fat about 25% (empirical 0.245 in one study, theoretical about 0.25)',
          referenceIds: ['joosen2006', 'tappy1996', 'acheson1988'],
        },
        {
          label: 'Isoenergetic +50% carbohydrate vs +50% fat for 14 days',
          value:
            '75–85% stored with carbohydrate, with a progressive rise in carbohydrate oxidation and total expenditure; 90–95% stored with fat, with minimal change; the difference was largest early',
          note: 'A 21-day study at +5 MJ/d found no difference in fat gain and unchanged sleeping heat production, so the gap in fat gained is small beyond about 2 weeks.',
          referenceIds: ['horton1995', 'lammert2000'],
        },
        {
          label: '3 days at +40% as carbohydrate (10 lean women)',
          value: '24-hour expenditure +7% and leptin +28%; +40% as fat: no change',
          referenceIds: ['dirlewanger2000', 'mendozaherrera2021'],
        },
        {
          label: '1-day overfeeding at 200% of needs',
          value:
            '24-h expenditure +10.7 ± 5.7% (range 2.9–18.8%) and sleeping expenditure +14.4 ± 11.3% with 20% protein whatever the carbohydrate-fat split; attenuated with 3% protein; thermic effect inversely related to body fat (r = −0.53)',
          referenceIds: ['thearle2013'],
        },
        {
          label: '8 weeks at +954 kcal/d, protein 5% / 15% / 25%',
          value:
            'Resting expenditure −86 / +160 / +227 kcal/d; total expenditure (doubly labelled water, weeks 7–8) +176 / +2 186 / +1 898 kJ/d as extracted (about +42 / +522 / +454 kcal/d)',
          note: "The units of the total-expenditure figures are as reported in the paper's table and should be verified before use.",
          referenceIds: ['bray2012'],
        },
        {
          label: 'Fitted extra carbohydrate heat',
          value: 'φ_C = 0.10 (0.05–0.15) of carbohydrate energy above habitual',
          note: 'Derived from +7% expenditure on +40% carbohydrate being about 17% of the carbohydrate excess, minus a carbohydrate thermic effect of 7.5%; it reproduces the roughly 10-point storage gap between carbohydrate and fat surpluses.',
          referenceIds: ['dirlewanger2000', 'horton1995'],
        },
        {
          label: 'Protein term (proposed)',
          value: 'k_P 0.7–1.8 (default 1.0) kcal/d per g/d of protein above reference',
          note: 'From the resting-expenditure differences in the overfeeding trial after removing the effect of lean mass (22 kcal/kg): (160 + 86 − 79)/92 g = 1.8 and (227 − 160 − 7)/89 g = 0.67.',
          referenceIds: ['bray2012'],
        },
      ],
      timeCourse:
        'Digestion cost is same-day. The extra carbohydrate heat appears within 1–3 days of a carbohydrate surplus and stops when intake returns to habitual. The carbohydrate-versus-fat difference is largest in week 1, while glycogen fills.',
      moderators:
        'Macronutrient mix, habitual carbohydrate and protein, body fat, and protein content of the surplus.',
      grade: 'B',
      gradeReason:
        'The direction is robust, but the size of the extra carbohydrate heat comes from two small studies and one 21-day study disagrees on fat gain.',
      status: 'proposed-fit',
      caveats: 'φ_C and k_P are fits by Vitals to small studies (grade C).',
      referenceIds: [
        'westerterp2004',
        'tappy1996',
        'joosen2006',
        'acheson1988',
        'horton1995',
        'lammert2000',
        'dirlewanger2000',
        'mendozaherrera2021',
        'thearle2013',
        'bray2012',
      ],
      relatedMetricIds: ['tdee', 'tef'],
    },
    {
      id: '11-expenditure-response-sustained-surplus',
      title: 'How expenditure responds to a sustained surplus, and why people differ',
      category: 'energy',
      summary:
        'Expenditure rises in a surplus because of digestion, the cost of building tissue, the upkeep of extra tissue and the cost of moving a heavier body. On top of that there is a variable adaptive part, from fidgeting and nervous-system-driven heat production. On average the adaptive part is small, but between people it ranges from about zero to more than 60% of the surplus. This is why the same surplus adds very different amounts of fat in different people.',
      howModelled:
        'A single adaptive term follows the surplus with a 14-day lag, with a gain that is drawn once per simulated person from a wide distribution. The population default is 0.12. If the energy-expenditure topic uses a symmetric adaptation term for both directions, this term is not added on top.',
      equation: `dAT_OF/dt = ( β_OF,i · max(0, EI − EI_ref) − AT_OF ) / τ_OF
β_OF,i ~ Normal(0.12, 0.15²) truncated to [−0.10, 0.70],   τ_OF = 14 d`,
      keyNumbers: [
        {
          label: 'Obligatory terms explain the rise',
          value:
            'Diaz: basal rate +0.9 ± 0.4 MJ/d, calorimeter expenditure +1.8 ± 0.5 MJ/d, no active dissipation. Ravussin: basal +622 kJ/d, one-third of the +2 038 kJ/d rise in 24-h expenditure. Siervo: calorimeter +11.4%, total +16.2%, only 11.6–13.1% unaccounted. Roberts: no rise in activity or thermoregulation',
          referenceIds: ['diaz1992', 'ravussin1985', 'siervo2008', 'roberts1990'],
        },
        {
          label: 'Johannsen, 8 weeks at +40%',
          value:
            'After adjusting for changes in fat-free and fat mass, sleeping metabolic rate +43 ± 123 kcal/d (P = 0.05) and 24-h expenditure +23 ± 139 kcal/d (P = 0.34) above prediction; steps 9 601 → 9 081/d (not significant); total expenditure +280 ± 495 kcal/d',
          referenceIds: ['johannsen2019'],
        },
        {
          label: 'Levine, 8 weeks at +1000 kcal/d, free-living',
          value:
            'Basal +0.33 ± 0.53, digestion +0.58 ± 0.35, everyday movement (NEAT) +1.38 ± 1.08 MJ/d (about +79, +139, +330 kcal/d); NEAT changed from −98 to +692 kcal/d; change in NEAT vs fat gain r = 0.77',
          referenceIds: ['levine1999a', 'joosen2006'],
        },
        {
          label: 'Reviews',
          value:
            'Of 16 controlled studies, 5 claimed adaptive thermogenesis and 11 did not. In 14 trials, expenditure parameters rose 7–50% while activity parameters increased, decreased or stayed unchanged inconsistently. Obesity-prone adults reduced walking time (−2.0% of time) after 3 days. In Guru Walla, total expenditure did not rise because spontaneous activity fell 40–59%',
          referenceIds: ['joosen2006', 'giroux2018', 'schmidt2012', 'pasquet1992'],
        },
        {
          label: '"Thrifty" phenotype',
          value:
            'A larger fall in expenditure with fasting went with a smaller rise with 200% overfeeding (r = 0.27); lower-than-predicted sleeping metabolic rate after overfeeding predicted more fat retained 6 months later',
          referenceIds: ['reinhardt2016', 'johannsen2019'],
        },
        {
          label: 'Fitted constants (proposed)',
          value:
            'β_OF = 0.12 and τ_OF = 14 d reproduce the stored fractions of Bouchard (63%), Johannsen (about 70%), Diaz (about 75%), Ravussin (75%) and Roberts (85–90%)',
          note: "They are close to Hall's symmetric β_AT = 0.14, τ = 14 d. Levine's cohort needs β about 0.35–0.40 (NEAT responders), and a low-NEAT person is about −0.05. An SD of 0.15 reproduces the observed 20–40% coefficient of variation in weight gain.",
          referenceIds: [
            'bouchard1990',
            'johannsen2019',
            'diaz1992',
            'ravussin1985',
            'roberts1990',
            'hall2011a',
            'levine1999a',
          ],
        },
        {
          label: 'Leptin and everyday movement',
          value: 'Leptin tracked the fat gained, not the change in NEAT',
          referenceIds: ['levine1999b'],
        },
        {
          label: 'Predicted stored fraction by duration (prototype)',
          value: 'About 80% at 1 week, 77% at 3 weeks, 71% at 8 weeks, 65% at 14 weeks',
          note: 'It falls because tissue-driven expenditure grows.',
        },
        {
          label: 'Compensation after the surplus ends',
          value:
            "Young men spontaneously reduced intake by 1 991 ± 824 kJ/d after 21 days of overfeeding and lost the gain; older men did not (+1.55 ± 2.11 vs −2.11 ± 2.18 MJ/d, P = 0.006). Twins lost about 7 of 8 kg by 4 months; Johannsen's subjects kept 43 ± 63% of the gain at 6 months",
          note: 'Inactive men given about 14 500 kcal of doughnuts over 4 weeks did not gain weight or fat, partly because their self-reported habitual intake fell by 239 kcal/d. NEAT is the leading candidate for the regulatory response, but its determinants are unknown.',
          referenceIds: [
            'roberts1990',
            'roberts1994',
            'bouchard1996',
            'johannsen2019',
            'tucker2021',
            'tappy2004',
          ],
        },
      ],
      timeCourse:
        'The adaptive term builds with a 14-day time constant; stored fraction falls over weeks as tissue-driven expenditure grows.',
      moderators:
        "Individual NEAT response, body size, duration, and the person's age (older men do not compensate afterwards).",
      grade: 'B',
      gradeReason:
        'The small average adaptive part is well supported (grade A) and the variance model is grade B, though predicting any individual is grade C.',
      status: 'proposed-fit',
      caveats:
        'The gain and time constant are a proposed fit by Vitals. Which individuals are NEAT responders cannot be predicted from simple inputs (twin correlation about 0.5), so a band should be shown.',
      referenceIds: [
        'diaz1992',
        'ravussin1985',
        'siervo2008',
        'roberts1990',
        'johannsen2019',
        'levine1999a',
        'levine1999b',
        'joosen2006',
        'giroux2018',
        'schmidt2012',
        'pasquet1992',
        'reinhardt2016',
        'bouchard1990',
        'hall2011a',
        'roberts1994',
        'bouchard1996',
        'tucker2021',
        'tappy2004',
      ],
      relatedMetricIds: ['metabolicAdaptation', 'tdee', 'neat'],
    },
    {
      id: '11-lean-fat-partition-without-training',
      title: 'How much of a surplus becomes lean tissue when not training',
      category: 'body',
      summary:
        'Even without training, a surplus adds some lean tissue: the non-fat matrix of new fat tissue, larger organs and blood volume, some weight-bearing muscle growth, and protein balance when protein is adequate. The lean share of weight gained is roughly one-third to 0.45 across studies. It falls when protein is low and is lower in fatter people, though this fatness effect is weaker in overfeeding than in weight loss.',
      howModelled:
        'Lean tissue gained per kilogram of fat gained is a baseline for the fat tissue matrix plus a term that depends on protein intake (a saturating curve), body fat (a Forbes-shaped cap) and fat type, and is reduced by training, which takes over lean gain in the next entry. Lean gain is applied to a 7-day average to avoid day-to-day noise.',
      equation: `r_L = r_AT + r_S · m_P(p) · φ_F(FM) · (1 − s_RT) · m_FA          (kg lean tissue per kg fat deposited)
m_P(p) = clamp( (1 − exp(−(p − 0.75)/0.35))/0.95, −0.3, 1.05 ),   p = protein in g/kg body weight/d
φ_F = min( 1, [10.4/(10.4 + FM)]/0.45 )
dFM/dt = S_sed/(ρF + ηF + r_L·(ρL + ηL));   dLT_sed/dt = r_L · dFM/dt`,
      keyNumbers: [
        {
          label: 'Lean share of weight gained in sedentary overfeeding',
          value:
            'Bouchard 2.7/8.1 = 0.33; Diaz 0.42; Ravussin 0.44; Johannsen about 0.44; Siervo 0.45; Bray −0.22 / 0.47 / 0.49 at 5 / 15 / 25% protein; Pasquet 0.25–0.36; ad libitum snacks about 0.17',
          note: 'Forbes: own data about 0.50 (3 weeks), pooled 0.436 (means) or 0.384 (regression), not explained by sex, initial weight or fat, duration or food type. In the twin study, CT scans showed skeletal muscle and adipose tissue rose but non-muscle lean mass did not.',
          referenceIds: [
            'bouchard1990',
            'deriaz1992',
            'forbes1986',
            'diaz1992',
            'ravussin1985',
            'johannsen2019',
            'siervo2008',
            'bray2012',
            'pasquet1992',
            'tchoukalova2010',
          ],
        },
        {
          label: 'Protein share of stored energy',
          value: 'In Roberts, 13% of stored energy was protein (about 0.4 of mass)',
          referenceIds: ['roberts1990'],
        },
        {
          label: 'Pooled lean share',
          value:
            'About 0.40 ± 0.09 including glycogen and fluids; after removing about 0.3–0.8 kg of glycogen water and extracellular fluid, lean tissue share is about 0.30–0.38',
          referenceIds: ['bray2012', 'forbes1986'],
        },
        {
          label: 'Fat type of the surplus (lean young adults, MRI)',
          value:
            'Saturated fat: 0.32 L lean tissue of 1.5 kg gained; polyunsaturated: 0.80 L of 1.2 kg (about 2.5 times more lean tissue)',
          referenceIds: ['rosqvist2014', 'elmsjo2015'],
        },
        {
          label: 'Fitted constants',
          value:
            'r_AT = 0.20 (0.15–0.25, unverified); r_S = 0.45 (0.35–0.55); protein curve shape (0.75, 0.35); fat cap 0.45; fat-type multiplier 1.0 default, 1.5 polyunsaturated-rich, 0.7 saturated-rich',
          note: 'The protein curve reproduces lean mass changes of −0.71 / +3.04 / +3.19 kg at 0.68 / 1.79 / 3.0 g/kg against observed −0.70 / +2.87 / +3.18. r_S = 0.45 fits several cohorts within about 1 kg but over-predicts Bouchard by about 1 kg; 0.35 does the reverse (mean absolute error 0.75 vs 0.89 kg across 5 cohorts).',
          referenceIds: ['bray2012', 'rosqvist2014', 'hall2011a', 'hall2008a'],
        },
        {
          label: 'Age and sex',
          value:
            'No sex effect on the composition of gain in the pooled data; no age effect on composition change with 21 days of overfeeding (young vs older men)',
          referenceIds: ['forbes1986', 'roberts1994'],
        },
      ],
      timeCourse:
        'Fat deposition tracks the daily surplus; lean accretion lags because protein synthesis responds over days.',
      moderators: 'Protein intake, body fat, fat type of the surplus, and training (next entry).',
      grade: 'C',
      gradeReason:
        'The average lean share is well supported (grade B), but the protein effect rests mainly on one inpatient trial and the fat-type effect on one trial (grade C).',
      status: 'proposed-fit',
      caveats:
        "A net lean loss like the 5%-protein arm needs the protein topic's protein-deficiency catabolism as well. The adipose matrix factor (0.20) is unverified.",
      referenceIds: [
        'bouchard1990',
        'deriaz1992',
        'forbes1986',
        'diaz1992',
        'ravussin1985',
        'roberts1990',
        'johannsen2019',
        'siervo2008',
        'bray2012',
        'tchoukalova2010',
        'rosqvist2014',
        'elmsjo2015',
        'pasquet1992',
        'roberts1994',
        'hall2011a',
        'hall2008a',
      ],
      relatedMetricIds: ['leanTissue', 'fatMass'],
    },
    {
      id: '11-partition-with-training-surplus-size',
      title: 'Surplus size, training and lean gain',
      category: 'body',
      summary:
        'Resistance training sets a ceiling on how fast muscle can grow. Energy availability decides how much of that ceiling is used: a deficit of about 500 kcal a day abolishes lean gain on average, maintenance supports most of it, and a surplus adds only a small extra. Beyond what building the new lean tissue needs, extra energy is stored as fat, so larger surpluses mainly add fat, especially in trained lifters.',
      howModelled:
        'The training topic gives the maximum lean-gain rate; this entry scales it by an energy-availability factor that rises a little with a surplus and falls to zero at a deficit of about 500 kcal a day. The energy needed for that lean gain is taken out of the surplus first, and the rest goes to fat and the usual matrix.',
      equation: `EB7 = 7-day EMA of (EI − EE_pre)
h(EB) = 1 + h_s · (1 − exp(−EB7/E_half))        if EB7 ≥ 0
      = max(0, 1 + EB7/500)                        if EB7 < 0
L_RT = G_RT(status, stimulus, protein, sex, age) · s_RT · h(EB)              (kg lean tissue per day)
e_RT = L_RT · (ρL + ηL);  if e_RT > S then L_RT = S/(ρL + ηL);   S_sed = S − e_RT`,
      keyNumbers: [
        {
          label:
            '17 trained lifters, 8 weeks, at maintenance / +5% / +15% (reported +169 / +489 / +719 kcal/d)',
          value:
            'Muscle thickness no group effect (biceps +0.25 / +0.19 / +0.34 cm); body mass +0.4 / +3.3 / +3.3 kg; sum of 8 skinfolds −1.4 / +10.0 / +12.4 mm; bench 1RM +5.7 / +7.3 / +13.4 kg',
          referenceIds: ['helms2023'],
        },
        {
          label:
            '39 elite athletes, 8–12 weeks: guided surplus (3 585 ± 601 kcal/d) vs ad libitum (2 964 ± 884)',
          value:
            'Lean gain not different; body weight +3.9 ± 0.6% vs +1.5 ± 0.4%; fat mass +15 ± 4% vs +3 ± 3%',
          referenceIds: ['garthe2013'],
        },
        {
          label: '11 male bodybuilders, 4 weeks, 67.5 vs 50.1 kcal/kg/d',
          value: 'Muscle mass (equation) +1.0 kg (+2.7%) vs +0.4 kg (+1.1%); body fat +7.4% vs +0.8%',
          referenceIds: ['ribeiro2019'],
        },
        {
          label: 'Time-restricted eating in surplus (trained people)',
          value:
            '12 weeks: fat-free mass +1.34 vs +1.38 kg, fat mass +2.00 vs +4.36 kg (the time-restricted group under-ate: 31.9 vs 37.5 kcal/kg). 8 weeks at +10%: fat-free mass +2.67 vs +1.82 kg, with 1.4 ± 0.6 kg more fat in the normal-eating group',
          referenceIds: ['gavanda2026', 'blake2025'],
        },
        {
          label: 'Carbohydrate supplements in trained men',
          value:
            '+54 g carbohydrate (+485 kcal/d) vs protein only, 8 weeks each way: no difference in lean mass, muscle thickness, area or strength. Another 8-week trial (21 men): lean mass not significantly raised (P = 0.068), fat up in both groups',
          referenceIds: ['henselmans2026', 'spillane2016'],
        },
        {
          label: 'Four-compartment study in 21 trained men, 6 weeks',
          value:
            'Fat-free mass +4.8 ± 2.6%; weight gain of about 0.55%/wk was compatible with "all gain as fat-free mass", with large individual variability',
          referenceIds: ['smith2021'],
        },
        {
          label: 'Untrained men with a large supplement (73 men, +2 010 kcal/d, 8 weeks)',
          value: 'Fat-free mass +2.9 ± 3.4 and +3.4 ± 2.5 kg; body mass +3.1 kg, about all fat-free',
          note: 'That would predict about 10–12 kg, so intake or compensation cannot be verified; the result is weak.',
          referenceIds: ['rozenek2002'],
        },
        {
          label: 'Deficit',
          value:
            'Lean gain effect size −0.57 vs energy-sufficient control; about −500 kcal/d prevents lean gain; strength is unaffected',
          referenceIds: ['murphy2022'],
        },
        {
          label: 'Guidelines quoted',
          value:
            'Surplus of about 1 500–2 000 kJ/d (about 360–480 kcal/d); +10–20% of energy for about 0.25–0.5% of body weight per week in novice and intermediate natural bodybuilders, less for advanced',
          referenceIds: ['slater2019', 'iraki2019'],
        },
        {
          label: 'Fitted constants',
          value:
            'h_s = 0.20 (0–0.5); E_half = 300 kcal/d (200–500); zero lean gain at −500 kcal/d (±200); placeholder lean-gain rates novice 0.25, intermediate 0.10, advanced 0.05 kg per week (unverified)',
          referenceIds: ['helms2023', 'garthe2013', 'gavanda2026', 'henselmans2026', 'murphy2022'],
        },
        {
          label: 'Model outcomes over 8 weeks at +500 kcal/d (fat-free / fat, kg)',
          value:
            'Novice +2.8 / +1.4; intermediate +1.5 / +1.8; advanced +1.1 / +1.9 (the intermediate case matches the +3.3 kg of the trained-lifter trial)',
          note: 'Energy in the lean tissue itself is small: 0.25 kg/wk × 2 045 kcal/kg is about 73 kcal/d (novice), down to about 15 kcal/d (advanced). Going from +250 to +500 kcal/d buys about 0.04 kg more lean tissue per 8 weeks (intermediate), while every extra 100 kcal/d adds about 0.4 kg of fat.',
          referenceIds: ['helms2023'],
        },
      ],
      timeCourse:
        'Weekly averages of energy balance drive the factor, with a benefit that saturates by about +500 kcal/d.',
      moderators:
        'Training status (novices have a higher ceiling), protein below about 1.6 g/kg, energy deficit, sex and age. Novices with high body fat can gain lean tissue even in a deficit.',
      grade: 'C',
      gradeReason:
        'Small, heterogeneous trials with body-composition methods of varying validity; the direction (larger surplus mostly adds fat in trained lifters) is consistent, but the size of any lean bonus is not.',
      status: 'proposed-fit',
      caveats:
        'The lean-gain rates for each training level are unverified placeholders until the resistance-training topic supplies them. Four-compartment data disagree in part with skinfold and bioimpedance trials. Free-living surplus studies rely on self-reported intake.',
      referenceIds: [
        'helms2023',
        'garthe2013',
        'ribeiro2019',
        'gavanda2026',
        'blake2025',
        'henselmans2026',
        'spillane2016',
        'smith2021',
        'rozenek2002',
        'murphy2022',
        'slater2019',
        'iraki2019',
      ],
      relatedMetricIds: [],
    },
    {
      id: '11-where-fat-goes-regional-liver',
      title: 'Where new fat goes: under the skin, around organs and in the liver',
      category: 'body',
      summary:
        'In lean adults, new fat goes mostly under the skin: upper-body depots grow by cells getting bigger, and lower-body depots by cells multiplying. About 10% of fat gained goes to visceral fat on average, but this varies from about zero to more than 200% between people, largely by genetics. Liver fat rises proportionally far more than body weight, and depends on the food: saturated fat and sugars raise it, while omega-6 polyunsaturated fat prevented the rise.',
      howModelled:
        "Each day's fat gain is divided into visceral, upper-body and lower-body shares, adjusted for sex, macronutrient of the surplus and individual variation. Liver fat changes by a relative amount per per cent of body-weight gain, with a coefficient set by the mix of fats and sugars in the surplus.",
      equation: `v = v0 · m_VAT_macro · m_VAT_sex · m_VAT_i               (visceral share)
u = 0.50·(1 − v)/0.90;   l = 0.40·(1 − v)/0.90                     (upper- and lower-body subcutaneous shares)
women: shift 0.05 from u to l
d ln(IHTG)/dt = (k_liver(mix)/100) · max(0, d(BW%)/dt)`,
      keyNumbers: [
        {
          label: '8-week overfeeding in 28 normal-weight adults (fat +3.8 ± 1.7 kg)',
          value:
            'Upper-body subcutaneous +1.9 ± 1.0, lower-body subcutaneous +1.6 ± 0.8, visceral +0.4 ± 0.3 kg (shares 0.50 / 0.42 / 0.10); no significant sex difference in proportional regional gains',
          referenceIds: ['tchoukalova2010', 'votruba2012'],
        },
        {
          label: 'CT with about 4–5 kg weight gain',
          value:
            'Covassin +3.7 kg: visceral +13.8, subcutaneous +32.4 cm² (visceral 30% of the abdominal area gain). Gentile +4.9 kg: visceral 63 → 79, subcutaneous 158 → 187 cm² (36%). Orr +5.1 kg: visceral +15, subcutaneous +30 cm² (33%). Siervo: relative visceral increase 32.6% vs 13.3% abdominal subcutaneous',
          referenceIds: ['covassin2018', 'gentile2007', 'orr2008', 'siervo2008'],
        },
        {
          label: 'Identical twins',
          value:
            'After adjusting for fat gained, visceral fat gain had a correlation of about 0.7 (about 6 times more variance between than within pairs); trunk skinfolds +85% vs limbs +50%',
          referenceIds: ['bouchard1990'],
        },
        {
          label:
            'Saturated vs omega-6 polyunsaturated fat surplus, 7 weeks, lean young adults (about 750 kcal/d added, n = 35)',
          value:
            'Weight +1.5 vs +1.2 kg; liver fat +0.5 vs +0.03 percentage points; visceral fat +0.21 vs +0.09 L; total body fat +1.43 vs +0.72 L; lean tissue +0.32 vs +0.80 L',
          referenceIds: ['rosqvist2014', 'elmsjo2015', 'hydes2021'],
        },
        {
          label: 'Same design in overweight adults, 8 weeks',
          value:
            'Weight +2.31 vs +2.01 kg; liver fat +53% (+1.54 percentage points, +30 mL) with saturated fat vs −2% with polyunsaturated fat; no difference in visceral, pancreatic or total fat',
          referenceIds: ['rosqvist2019'],
        },
        {
          label: '+1000 kcal/d for 3 weeks in overweight adults',
          value:
            'Liver fat +55% (saturated fat), +15% (unsaturated fat), +33% (simple sugars, with DNL +98%); weight +1.4 / +0.9 / +1.4 kg; HOMA-IR +23% and ceramides +49% with saturated fat only',
          referenceIds: ['luukkonen2018'],
        },
        {
          label: 'Sugar surpluses',
          value:
            'More than 1000 kcal/d of simple sugars for 3 weeks: weight +1.8 kg (+2%), liver fat 9.2 → 11.7% (+27%). 1 L/d of sucrose cola for 6 months vs isocaloric milk, diet cola or water: liver fat +132–143%, muscle fat +117–221%, visceral fat +24–31%, triglyceride +32%, total cholesterol +11%; total fat mass not different',
          referenceIds: ['sevastianova2012', 'maersk2012'],
        },
        {
          label: 'Fructose vs glucose',
          value:
            '25% of energy for 10 weeks: similar weight gain; visceral fat increased only with fructose (subcutaneous only with glucose), with higher DNL, apoB, small dense LDL and postprandial triglyceride with fructose. At +25% energy for 2 weeks: weight +1.0 vs +0.6 kg, liver triglyceride +1.70 vs +2.05 percentage points (not significant), so energy-mediated',
          note: 'A meta-analysis found fructose raises liver fat (standardised difference 0.45) and ALT (+4.94 U/L) only in hypercaloric trials, not isocaloric.',
          referenceIds: ['stanhope2009', 'johnston2013', 'chiu2014'],
        },
        {
          label: 'Sex',
          value:
            "Fraction of a meal's fat stored in subcutaneous fat at 24 h: women 38 ± 3% vs men 24 ± 3%; women increase leg uptake with a high-fat meal. Men gained relatively more fat (37.6 ± 5.7% vs 20.9 ± 1.8% of baseline fat mass) in one cohort; higher baseline oestradiol/SHBG predicted less upper-body gain",
          referenceIds: ['romanski2000', 'votruba2006', 'tchoukalova2010', 'singh2021'],
        },
        {
          label: 'Fitted constants (proposed)',
          value:
            'v0 = 0.10 (SD about 0.05, range 0–0.25); sex multiplier men 1.2, women 0.8 (grade D); macronutrient multiplier saturated-rich 1.5 (lean young) or 1.0 (overweight), polyunsaturated-rich 0.75, sugary drinks or fructose 25% of energy or more 1.3; liver coefficients (relative % per % body-weight gain): saturated about 20–37, unsaturated about 15, omega-6 about 0, sugars about 13–22, mixed default 15',
          referenceIds: [
            'tchoukalova2010',
            'rosqvist2014',
            'rosqvist2019',
            'luukkonen2018',
            'sevastianova2012',
          ],
        },
      ],
      timeCourse:
        'Liver fat responds within 1–3 weeks and reverses with energy restriction (the saturated-fat rise reversed after 4 weeks at about 800 kcal/d restriction; −25% after 6 months of a hypocaloric diet). Visceral fat changes over weeks, and adipocyte number in lower-body fat rises after only 8 weeks, which may be long-lasting.',
      moderators:
        'Sex (weak), fat type and sugar in the surplus, genetics, and initial fatness. How far a person\'s fat tissue can expand (a "personal fat threshold") may also matter.',
      grade: 'C',
      gradeReason:
        'Regional shares and the direction of liver-fat effects by fat type and sugar are grade B, but magnitudes and sex modifiers are grade C.',
      status: 'proposed-fit',
      caveats:
        'The coefficients differ between lean young and overweight middle-aged cohorts, and there are few trials of short duration. The sex-specific regional modifiers are grade D.',
      referenceIds: [
        'tchoukalova2010',
        'votruba2012',
        'covassin2018',
        'gentile2007',
        'orr2008',
        'siervo2008',
        'bouchard1990',
        'rosqvist2014',
        'elmsjo2015',
        'rosqvist2019',
        'luukkonen2018',
        'sevastianova2012',
        'maersk2012',
        'stanhope2009',
        'johnston2013',
        'chiu2014',
        'romanski2000',
        'votruba2006',
        'singh2021',
        'hydes2021',
        'cuthbertson2017',
      ],
      relatedMetricIds: ['visceralFat', 'liverFat', 'waist'],
    },
    {
      id: '11-short-term-overfeeding-cheat-days',
      title: 'One to seven days of overeating: cheat days, holidays and the scale',
      category: 'body',
      summary:
        'After one or a few days of big overeating, most of the rise on the scale is glycogen with its water, extra food in the gut and extra fluid from sodium. The real fat gain is roughly the surplus minus digestion, the extra heat and the energy parked in glycogen, divided by about 10 000 kcal per kilogram. The non-fat parts fade over days once eating normalises; the fat part stays unless a later deficit removes it. Insulin sensitivity falls within 2–3 days of a large surplus, and vigorous exercise largely prevents this.',
      howModelled:
        'Scale weight is the sum of glycogen and its water, fluid, gut content, fat and lean tissue. Each part decays with its own time constant except fat and lean tissue. A separate acute insulin-sensitivity index falls with the size of the surplus and with inactivity, and is protected by exercise.',
      equation: `ΔBW_scale = ΔG·(1 + w_G) + ΔECF_x + ΔGUT + ΔFM + ΔLT
x_S = max(0, EI − EI_ref)/EI_ref
IS_target = 1 − k_IS · x_S · m_SFA · (1 − e_ex) − k_inact · 1[steps < 4 000]
dIS_rel/dt = (IS_target − IS_rel)/τ_IS      (τ_IS = 2 d when falling, 5 d when recovering)`,
      keyNumbers: [
        {
          label: '3 days at +1 500 kcal/d (10 young men)',
          value:
            'Body weight +0.7 ± 0.5 kg, total body water +0.7 ± 0.4 kg, fat mass not significantly changed; weight returned to baseline within 5.0 ± 4.9 days (at most about 2 weeks)',
          referenceIds: ['sagayama2014'],
        },
        {
          label: 'About 6 000 kcal/d for 1 week in healthy men',
          value:
            'Body weight +3.5 kg; systemic and adipose insulin resistance after 2–3 days; oxidative stress; no inflammation or ER stress',
          referenceIds: ['boden2015'],
        },
        {
          label: 'Other short surpluses',
          value:
            '+50% for 1 week in 32 men: +1.8 kg. +50% for 9 days: +3.2 kg, 56% fat. A holiday period (mid-November to early January): +0.37 ± 1.52 kg, net +0.48 ± 2.22 kg by February or March and not reversed by the next autumn (n = 195 and 165)',
          referenceIds: ['muller2015', 'ravussin1985', 'yanovski2000'],
        },
        {
          label: 'Maximal single meal',
          value:
            '3 113 kcal (13 024 kJ) of pizza vs 1 584 kcal ad libitum: glycaemia well regulated, larger insulin, GLP-1, GIP and PYY responses, and prolonged lethargy',
          referenceIds: ['hengist2020'],
        },
        {
          label: 'Insulin sensitivity: step reduction plus overfeeding',
          value:
            '14 days of steps cut from 10 000 to 1 500/d plus +50%: Matsuda index down at day 3 and 7, clamp glucose infusion −44% at day 14, visceral fat up; at day 30 (16 days after stopping) sensitivity was back to baseline while weight was still raised',
          referenceIds: ['knudsen2012'],
        },
        {
          label: 'Insulin sensitivity: exercise protection and fat content',
          value:
            '7 days of +50% with under 4 000 steps/d doubled the OGTT insulin response (+17 ± 16 nmol·120 min/L); the same surplus plus 45 min a day of running at 70% of VO2max gave no change (+1 ± 6). 5 days of +50% at 60% fat: hepatic insulin resistance, peripheral insulin action unchanged. 28 days of +1 040 kcal/d (46% fat): clamp glucose infusion rate 54.8 → 50.3 µmol/min/kg FFM (−8%); weight +0.6 kg at day 3, +2.7 kg at day 28',
          referenceIds: ['walhin2013', 'brons2009', 'samochabonet2012'],
        },
        {
          label:
            'Worked example (model): 80 kg man, maintenance 2 500 kcal, cheat day 5 470 kcal (surplus about +2 970)',
          value:
            'Extra digestion 202 kcal; carbohydrate heat 160; adaptive term about 25; glycogen +300 g (about 1 260 kcal) with about 0.81 kg water; the remaining about 1 320 kcal gives about +0.12 kg fat and +0.07 kg lean tissue; gut content and fluid about +0.3–1.0 and +0.3–0.9 kg (unverified). Total about +1.9 to +3.2 kg on the scale, of which about 0.12 kg (about 5%) is fat',
          note: 'The same arithmetic for a +6 000 kcal day (glycogen room about 400 g) gives about 0.3–0.4 kg of fat. The prototype gives 3.9 kg for a 7-day study that observed +3.5 kg, 1.0 kg for one that observed +0.7 kg (excluding gut and fluid), and 1.5 kg for one that observed +1.8 kg.',
          referenceIds: ['acheson1982', 'boden2015', 'sagayama2014', 'muller2015'],
        },
        {
          label: 'Decay after intake returns to maintenance',
          value:
            'Glycogen and its water about 1–2 days; sodium-driven fluid about 1–3 days; gut content about 1–2 days (unverified); fat and lean tissue do not decay',
          referenceIds: ['acheson1982'],
        },
        {
          label: 'Fitted constants for the acute insulin-sensitivity index (proposed)',
          value:
            'k_IS = 0.20 per unit of surplus fraction (0.1–0.4); k_inact = 0.30 (0.2–0.4); exercise protection 0.9 for at least 45 min/d at about 70% of VO2max; saturated-fat multiplier 1.5; time constants 2 d falling and 5 d recovering',
          referenceIds: ['samochabonet2012', 'knudsen2012', 'walhin2013', 'luukkonen2018'],
        },
      ],
      timeCourse:
        'Scale weight jumps within a day; glycogen, fluid and gut parts fade over 1–3 days. Insulin sensitivity falls within 2–3 days of a large surplus and recovers over about 5 days.',
      moderators:
        'Carbohydrate and sodium content of the surplus, glycogen room (larger after a deficit), steps and exercise, and fat type.',
      grade: 'C',
      gradeReason:
        'The scale decomposition is grade B, but the fat gain of a single day is model-derived with no direct one-day body-composition study, so we show the lower grade.',
      status: 'proposed-fit',
      caveats:
        'Gut and fluid magnitudes after large meals are unverified. The insulin-sensitivity constants are fits by Vitals.',
      referenceIds: [
        'sagayama2014',
        'boden2015',
        'muller2015',
        'ravussin1985',
        'yanovski2000',
        'hengist2020',
        'knudsen2012',
        'walhin2013',
        'brons2009',
        'samochabonet2012',
        'acheson1982',
        'luukkonen2018',
      ],
      relatedMetricIds: ['scaleWeight', 'waterWeight', 'gutContent'],
    },
    {
      id: '11-refeeds-diet-breaks-cheat-meals',
      title: 'Refeeds, diet breaks and cheat meals inside a diet',
      category: 'hormones',
      summary:
        'A refeed raises intake, usually carbohydrate, to about or above maintenance for 1–3 days, and a diet break does so for 1–2 weeks. It refills depleted glycogen (the scale rises without fat), raises leptin for a while, may partly relieve adaptive slowing if long enough, and restores training glycogen. Whether it improves fat loss or lean retention beyond what its effect on average weekly energy balance predicts is unproven in trained people.',
      howModelled:
        'A refeed day is just a day with its own intake, and weekly fat change follows weekly energy balance. There is no special fat-loss bonus. Glycogen and water follow the glycogen rule. A short-term leptin signal follows the 3-day cumulative energy balance, with fat surplus weighted zero, and is handed to the hunger model.',
      equation: `leptin_ST = 1 + κ · CEB3_w/EI_ref
(CEB3_w = 3-day cumulative energy balance; surplus energy as fat weighted 0, as carbohydrate or protein 1; deficits unweighted)
κ = 0.30 for CEB3_w > 0 (range 0.2–0.6);   κ = 0.13 for deficits`,
      keyNumbers: [
        {
          label: 'Glycogen and prior diet',
          value:
            'After a high-fat diet, 278 ± 6 g of a 500 g carbohydrate load was stored as glycogen, vs 170 ± 2 g after a high-carbohydrate diet; net fat synthesis 0.8 vs 9 g',
          referenceIds: ['acheson1984'],
        },
        {
          label: 'Leptin and overfeeding',
          value:
            '+40% carbohydrate for 3 days: fasting leptin +28%, 24-h expenditure +7%; +40% fat: no change (10 lean women). 12 hours of massive overfeeding (120 kcal/kg): leptin +40%, persisting to the next morning',
          referenceIds: ['dirlewanger2000', 'mendozaherrera2021', 'kolaczynski1996'],
        },
        {
          label: 'Leptin tracks cumulative 3-day energy balance (n = 6)',
          value:
            '135 ± 22% of baseline after 3 days at 130% of expenditure and 88 ± 16% after 3 days at 70%; it returned to baseline only when cumulative balance was restored',
          note: 'Low-fat high-carbohydrate vs high-fat low-carbohydrate isoenergetic days: 24-h leptin area 38 ± 12% higher with low-fat high-carbohydrate. 2 days at −62% lowered leptin by 27.2%, then +37.6% on day 5 after returning to free eating (as summarised in a review).',
          referenceIds: ['chinchance2000', 'havel1999', 'mendozaherrera2021'],
        },
        {
          label:
            '27 resistance-trained adults, 7 weeks: 5 days at −35% plus 2 carbohydrate refeed days at maintenance vs −25% every day',
          value:
            'Fat mass −2.8 vs −2.3 kg; fat-free mass −0.4 vs −1.3 kg; dry fat-free mass −0.2 vs −1.9 kg; resting metabolic rate −38 vs −78 kcal/d; only dry fat-free mass differed significantly',
          note: 'An independent reanalysis concluded only dry fat-free mass differed. Pooled leptin (n = 8) went 3.9 → 1.6 ng/mL.',
          referenceIds: ['campbell2020', 'peos2020'],
        },
        {
          label:
            'ICECAP: 61 resistance-trained adults, 4 × 3 weeks restriction with 3 × 1 week at balance vs 12 weeks continuous',
          value:
            'End fat mass 15.3 vs 18.0 kg (P = 0.32), fat-free mass 56.7 vs 56.7 kg; no difference in resting expenditure, leptin, testosterone, IGF-1 or free T3; lower hunger, higher PYY and more satisfaction with breaks',
          referenceIds: ['peos2021'],
        },
        {
          label:
            'MATADOR: 51 men with obesity, 8 × 2 weeks at 67% alternating with 7 × 2 weeks at balance vs 16 weeks continuous',
          value:
            'Weight loss 14.1 ± 5.6 vs 9.1 ± 2.9 kg; fat loss 12.3 ± 4.8 vs 8.0 ± 4.2 kg; fat-free mass loss similar; adjusted resting-expenditure fall −360 ± 502 vs −749 ± 498 kJ/d; weight change during balance blocks 0.0 ± 0.3 kg',
          referenceIds: ['byrne2018'],
        },
        {
          label: 'Cheat meals (scoping review of 8 articles)',
          value:
            'Compatible with weight loss; mixed for lean retention, metabolic adaptation and performance; better hunger and satisfaction when framed as goal-directed; a "cheating" framing was associated with eating-disorder behaviours',
          referenceIds: ['tsang2025'],
        },
        {
          label: 'Engine rules and constants',
          value:
            'Glycogen room after deficit or low-carbohydrate days: 0.3–0.5 kg glycogen plus 0.8–1.5 kg water. κ anchors: carbohydrate-only +28% at 1.2 × reference gives 0.23; mixed +35% at 0.9 × reference gives about 0.4 unweighted or about 0.6 fat-weighted; deficits −12% at −0.9 × reference gives 0.13',
          note: 'An optional lean-retention flag (grade C) reduces deficit-driven fat-free mass loss by up to 50% with 2 or more carbohydrate refeed days a week in trained dieters.',
          referenceIds: ['dirlewanger2000', 'chinchance2000', 'campbell2020', 'peos2020'],
        },
      ],
      timeCourse:
        'Leptin rises within days of a carbohydrate surplus and falls again; the benefit for adaptive slowing needs weeks (2-week balance blocks helped in men with obesity, 1-week breaks in trained adults did not).',
      moderators:
        'Whether the surplus is carbohydrate or fat, cumulative energy balance, training status and leanness.',
      grade: 'C',
      gradeReason:
        'Few, small trials with different designs; benefits are mostly psychological or about adherence.',
      status: 'contested',
      caveats:
        'The leptin constants are proposed fits. The trials conflict: a 2-week-block design helped men with obesity but 1-week breaks did not in trained adults, and an independent reanalysis of the 2-day refeed study concluded only dry fat-free mass differed.',
      referenceIds: [
        'acheson1984',
        'dirlewanger2000',
        'mendozaherrera2021',
        'kolaczynski1996',
        'chinchance2000',
        'havel1999',
        'campbell2020',
        'peos2020',
        'peos2021',
        'byrne2018',
        'tsang2025',
      ],
      relatedMetricIds: ['leptin', 'hunger'],
    },
    {
      id: '11-post-diet-fat-overshoot',
      title: 'Post-diet fat overshoot',
      category: 'body',
      summary:
        'After a large weight loss in lean people, fat comes back faster than lean tissue during refeeding, and hunger driven by the lean-mass deficit persists until lean mass is fully restored. So fat can overshoot its pre-diet level. The leaner the person, the larger the lean share of the loss and the larger the overshoot. It appears only when fat depletion is large, more than about a third of initial fat, and was not seen after mild restriction (about 6% fat depletion).',
      howModelled:
        'On entering a deficit the engine remembers starting fat, lean mass and body-fat percentage and the lean share of the loss. On later surplus days with lean mass still below the starting value, it blends the generic lean-per-fat rule with a regain rule that gives fat a larger share, using a ramp on how much fat has been lost.',
      equation: `Pm_SS = (100 − %FAT0)/100 · exp(−0.015 · %FAT0)              (mass fraction of loss as fat-free mass)
γ = 1 + a · exp(−b · %FAT0),   a = 0.92, b = 0.11
Pm_RF = Pm_SS/γ                                                (mass fraction of regain as fat-free mass)
FAT_overshoot (when fat-free mass is fully restored) = (γ − 1) · ΔW_SS
engine: r = clamp((D_F − 0.10)/0.20, 0, 1);  γ_eff = 1 + 0.92·exp(−0.11·pctFat_pre)·r;  P_RF = Pm_SS/γ_eff
r_L,RF = P_RF/(1 − P_RF);   r_L = (1 − r)·r_L,generic + r·r_L,RF`,
      keyNumbers: [
        {
          label: 'Minnesota experiment (32 men, 24 weeks of semistarvation)',
          value:
            'About −25% body weight, −70% fat, −27% fat-free mass (hydration-corrected). After 12 weeks of restricted then 8 weeks of ad libitum refeeding, more weight and fat were regained than lost; in the 12 men who completed all phases the fat overshoot was about 4 kg (range 0–9 kg) while fat-free mass was still −5 to 0 kg below baseline',
          referenceIds: ['keys1950', 'dulloo1996', 'dulloo1997', 'dulloo2018', 'jacquet2020'],
        },
        {
          label: 'Appetite and metabolism during regain',
          value:
            'Hyperphagia during refeeding correlated inversely with fat recovery (r = −0.6) and fat-free mass recovery (r = −0.5), with the fat-free mass effect independent of fat. The lean–fat partition during loss carries over to regain and is predicted by initial percent body fat; fat-free-mass-adjusted basal rate was still reduced at 12 weeks of refeeding, in proportion to fat (not lean) recovery',
          referenceIds: ['dulloo1997', 'dulloo1996'],
        },
        {
          label: 'US Army Rangers (8-week course, about 1 000 kcal/d deficit, −12% body mass)',
          value:
            '5 weeks later fat-free mass and performance had recovered, and fat mass was above the initial value in all 10 men, an overshoot of about 4–5 kg on average',
          referenceIds: ['nindl1997', 'dulloo2018'],
        },
        {
          label: 'No overshoot after mild restriction',
          value: 'No preferential catch-up fat after 3 weeks at −50% (about 6% fat depletion)',
          referenceIds: ['muller2015', 'dulloo2018'],
        },
        {
          label: 'Post-menopausal women',
          value:
            'Regaining 2 kg or more over 12 months after a 5-month diet regained more than two-thirds of the fat lost but only about 25% of the lean lost',
          referenceIds: ['beavers2011'],
        },
        {
          label: 'Published model examples (70 kg, 5 kg lost and regained)',
          value:
            '10% starting fat gives an overshoot of about 1.5 kg; 20% about 0.5 kg; 30% about 0.17 kg. For a Minnesota-like regain (14% starting fat, 17 kg lost, lean fully restored) the model gives about 3.4 kg of overshoot (observed mean about 4 kg, range 0–9)',
          referenceIds: ['jacquet2020', 'dulloo2018'],
        },
        {
          label: 'Related published model',
          value:
            "Hall's 2006 model of semistarvation and refeeding already contains glycogen-dependent DNL and reproduces the Minnesota refeeding; the overflow and overshoot rules here are simplified, data-anchored stand-ins compatible with the Lancet model",
          referenceIds: ['hall2006', 'hall2011a'],
        },
        {
          label: 'Engine threshold (proposed)',
          value:
            'Ramp from 10% to 30% fat depletion; for age 60 or more the regain lean share is halved (optional)',
          referenceIds: ['dulloo2018', 'muller2015', 'beavers2011'],
        },
      ],
      timeCourse: 'The rule stays on until lean mass is restored or 26 weeks after the deficit ended.',
      moderators:
        'Starting body fat (leaner people have a bigger overshoot), how much fat was lost, age, and training.',
      grade: 'C',
      gradeReason:
        'It rests on a re-analysis of one historical experiment and one small military cohort; the mechanism is plausible.',
      status: 'proposed-fit',
      caveats:
        'The depletion threshold and its transfer from starvation and military data to modest dieting are uncertain, and the model constants come from 12 men. The Minnesota data were reached through secondary sources.',
      referenceIds: [
        'keys1950',
        'dulloo1996',
        'dulloo1997',
        'dulloo2018',
        'jacquet2020',
        'nindl1997',
        'muller2015',
        'beavers2011',
        'hall2006',
        'hall2011a',
      ],
      relatedMetricIds: ['fatMass', 'leanTissue', 'bodyFatPct'],
    },
    {
      id: '11-chronic-surplus-cardiometabolic',
      title: 'Blood pressure, insulin and blood fats after weight gain',
      category: 'cardio',
      summary:
        "Experimental weight gain of a few kilograms raised blood pressure and arterial stiffness, and changed insulin and blood fats, in ways that depended on how much visceral fat was gained and on the fat type. Adverse effects of a saturated-fat surplus reversed after 4 weeks of energy restriction, and twins' blood values normalised by 4 months.",
      howModelled:
        'This entry gives the lipids and blood-pressure topic its anchors. The proposed slope is about +1.1 mmHg of systolic blood pressure per kilogram gained, adjusted by the visceral share of the gain.',
      keyNumbers: [
        {
          label: 'Blood pressure with +3.7 kg over 8 weeks',
          value:
            '24-hour systolic +4 mmHg (95% CI 1.6–6.3); mean blood-pressure change correlated with visceral fat change (ρ = 0.45)',
          referenceIds: ['covassin2018'],
        },
        {
          label: 'Sympathetic activity with +4.9 kg (42 days)',
          value: 'Muscle sympathetic nerve activity 32 → 38 bursts/min; systolic pressure rose',
          referenceIds: ['gentile2007'],
        },
        {
          label: 'Arterial stiffness with +5.1 kg',
          value: 'Stiffness +13 ± 6%, compliance −21 ± 4%; it tracked visceral fat gain',
          referenceIds: ['orr2008'],
        },
        {
          label: 'Insulin',
          value:
            'BMI 21.8 → 23.8 over 4.5 months: basal and stimulated hyperinsulinaemia (mainly lower insulin clearance); clamp insulin sensitivity −8% after 28 days at +1 040 kcal/d',
          referenceIds: ['erdmann2008', 'samochabonet2012'],
        },
        {
          label: 'Lipids with a mixed surplus (+1 250 kcal/d for 28 days)',
          value:
            'HDL +11 ± 2%; LDL, triglyceride and fatty acids unchanged; CRP, liver fat and ceramides rose',
          referenceIds: ['heilbronn2013'],
        },
        {
          label: 'Lipids with a saturated-fat surplus (+1000 kcal/d for 3 weeks)',
          value:
            'HDL +17%, LDL +10% (+0.3 ± 0.4 mmol/L), triglyceride unchanged; unchanged with unsaturated fat or sugars',
          referenceIds: ['luukkonen2018'],
        },
        {
          label: 'Sugary drinks (1 L/d cola for 6 months)',
          value: 'Triglyceride +32% and total cholesterol +11% vs controls',
          referenceIds: ['maersk2012'],
        },
        {
          label: 'Reversal',
          value:
            "The adverse effects of a saturated-fat surplus reversed after 4 weeks of energy restriction; twins' blood values normalised by 4 months",
          referenceIds: ['rosqvist2019', 'bouchard1996'],
        },
      ],
      timeCourse: 'Effects appear over weeks and reverse over weeks to months with energy restriction.',
      moderators: 'Visceral fat share, fat type and sugar in the surplus.',
      grade: 'B',
      gradeReason:
        'Several experimental weight-gain studies agree; the proposed blood-pressure slope is grade B−.',
      status: 'established',
      caveats: 'Studies are short and mostly in young or middle-aged adults.',
      referenceIds: [
        'covassin2018',
        'gentile2007',
        'orr2008',
        'erdmann2008',
        'samochabonet2012',
        'heilbronn2013',
        'luukkonen2018',
        'maersk2012',
        'rosqvist2019',
        'bouchard1996',
      ],
      relatedMetricIds: ['sbp'],
    },
    {
      id: '11-alcohol-surplus',
      title: 'Alcohol as surplus energy',
      category: 'fuel',
      summary:
        'Alcohol is burned first and cannot be stored. It adds to body fat indirectly, by suppressing fat burning. In one study, alcohol at a quarter of energy cut fat oxidation by more than a third while leaving carbohydrate and protein oxidation unchanged.',
      howModelled:
        "Alcohol counts at 7 kcal per gram with a digestion cost of 20%. All of the day's alcohol is burned (up to the liver's clearance limit), and the surplus is stored through spared fat burning, with no direct fat synthesis from alcohol.",
      keyNumbers: [
        {
          label: 'Alcohol at +25% of energy (96 g/d)',
          value:
            '24-h lipid oxidation −49.4 g/d (−36%); carbohydrate and protein oxidation unchanged; 24-h expenditure +7% (about 28% of the alcohol energy dissipated)',
          referenceIds: ['suter1992'],
        },
        {
          label: '24 g of alcohol',
          value:
            'Fractional liver DNL rose 2 → 30% but absolute DNL was 0.8 g per 6 h (under 5% of the dose); 77 ± 13% of the alcohol became plasma acetate; fat-tissue fatty-acid release −53% and whole-body lipid oxidation −73%',
          referenceIds: ['siler1999'],
        },
      ],
      timeCourse: 'The effect is confined to the drinking period.',
      moderators: "Dose and the liver's clearance limit (covered in the substances topic).",
      grade: 'B',
      gradeReason: 'Two human tracer and calorimetry studies agree.',
      status: 'established',
      caveats: 'The 7 kcal per gram factor may be adjusted by the substances topic.',
      referenceIds: ['suter1992', 'siler1999'],
      relatedMetricIds: ['fatOxidation', 'fatMass'],
    },
    {
      id: '11-integrated-surplus-rule-set',
      title: 'The daily surplus-partitioning rule set',
      category: 'body',
      summary:
        "This entry ties the surplus mechanisms into one daily rule. Whenever a day's stored energy is positive, it replaces the default partition of the body-weight model with rules for heat loss by macronutrient, the glycogen overflow to fat, training-driven lean gain, and the split of new fat between depots. It closes the energy balance each day, and is checked against 14 published scenarios.",
      howModelled:
        "Each day the engine computes expenditure before tissue change, solves glycogen in steps of 2 hours or less, finds the carbohydrate overflow, and then splits the remaining energy into training-driven lean gain, sedentary lean gain and fat. Deficit days use the other topics' rules unchanged.",
      equation: `EE_pre = EE_base + TEF + TH_C + AT_OF + ΔREE_P + C_DNL
S = EI − EE_pre − ρG·dG
if S > 0:  L_RT = s_RT · G_RT · h(EB) (capped by S/(ρL + ηL));   S_sed = S − L_RT·(ρL + ηL)
           dFM = S_sed/(ρF + ηF + r_L·(ρL + ηL));   dLT = L_RT + r_L · dFM
energy closure: EI − EE_pre − ρG·dG − (ρF + ηF)·dFM − (ρL + ηL)·dLT = 0
substrate split: A_ox = E_A;  P_ox = E_P − 4000·f_prot·dLT;  C_ox = E_C − ρG·dG − 4·C_over;  F_ox = max(0, EE_pre − A_ox − P_ox − C_ox)`,
      keyNumbers: [
        {
          label:
            'Prototype check: long mixed surplus (model vs observed: weight / fat / fat-free, kg, and % stored)',
          value:
            'Bouchard 8.9 / 5.2 / 3.7, 65% vs 8.1 / 5.4 / 2.7, 63%. Johannsen 7.1 / 4.4 / 2.7, 72% vs 7.5 / 4.2 / about 3.3, about 70%. Diaz 7.4 / 4.3 / 3.1, 73% vs 7.6 / about 4.4 / about 3.2',
          referenceIds: ['bouchard1990', 'johannsen2019', 'diaz1992'],
        },
        {
          label: 'Prototype check: protein content (model vs observed)',
          value:
            '15% protein 6.0 / 3.8 / 2.1, 75% vs 6.05 / 3.45 / 2.87 (DXA lean); 25% protein 5.5 / 3.6 / 1.9, 71% vs 6.51 / 3.44 / 3.18. The 5% arm (model 5.2 / 4.4 / 0.8 vs observed 3.16 / 3.66 / −0.70) is not reproduced',
          referenceIds: ['bray2012'],
        },
        {
          label: 'Prototype check: carbohydrate vs fat, and individual variability',
          value:
            'Horton: stored 74% vs 89% (observed 75–85% vs 90–95%). Levine at β 0.12 or 0.35: 6.3 or 4.9 kg, stored 70% or 54% (observed 4.7 ± 1.8 kg, 45%)',
          referenceIds: ['horton1995', 'levine1999a'],
        },
        {
          label: 'Prototype check: short studies',
          value:
            'Ravussin: 2.7 kg, 80% (observed 3.2 kg, 75%). Roberts: 2.7 kg, 77% (observed 2.5 kg, 85–90%). Boden: 3.9 kg (observed 3.5). Sagayama: 1.0 kg with fat +0.3 (observed 0.7). Müller: 1.5 kg (observed 1.8)',
          referenceIds: ['ravussin1985', 'roberts1990', 'boden2015', 'sagayama2014', 'muller2015'],
        },
        {
          label: 'Prototype check: training with surplus',
          value: 'Intermediate lifter, +500 kcal/d for 8 weeks: 3.3 / 1.8 / 1.5 kg vs +3.3 kg in the trial',
          referenceIds: ['helms2023'],
        },
        {
          label: 'Known under-prediction',
          value:
            'The model omits gut content and sodium-driven fluid, which explains most short-study under-predictions (Jebb 12 days: model 1.7 kg vs 2.90 kg observed)',
          referenceIds: ['jebb1996'],
        },
        {
          label: 'Master parameters',
          value:
            'Fat 9 441 kcal/kg (cost 179), lean 1 816 (229), glycogen 4 207; digestion 0.25 / 0.075 / 0.025 / 0.20; carbohydrate heat 0.10; adaptive gain 0.12 with time constant 14 d; glycogen maximum 0.015 × body weight; fat yield 0.32 g per g of carbohydrate; adipose matrix 0.20; lean rate 0.45; visceral share 0.10; liver coefficients (mixed / saturated / unsaturated / omega-6 / sugars) 15 / 28 / 15 / 0 / 18; insulin constants 0.20, 0.30, 2 d and 5 d; leptin 0.30 and 0.13; overshoot constants 0.92, 0.11, 0.015',
          referenceIds: ['hall2011a', 'hall2010b'],
        },
      ],
      timeCourse: 'A daily rule with sub-daily glycogen steps; lean gain is applied to a 7-day average.',
      moderators:
        'All the moderators in the individual entries: macronutrients, protein, training, body fat, sex, age and prior dieting.',
      grade: 'C',
      gradeReason:
        'It is assembled by Vitals from grade A–D parts and reproduces most, but not all, checked scenarios.',
      status: 'proposed-fit',
      caveats:
        'It does not reproduce the low-protein group (protein-deficiency catabolism and blunted expenditure are missing), and the individual-level predictions need a band, not a point. Energy closure must be unit-tested every day.',
      referenceIds: [
        'bouchard1990',
        'johannsen2019',
        'diaz1992',
        'bray2012',
        'horton1995',
        'levine1999a',
        'ravussin1985',
        'roberts1990',
        'boden2015',
        'sagayama2014',
        'muller2015',
        'helms2023',
        'jebb1996',
        'hall2011a',
        'hall2010b',
      ],
      relatedMetricIds: ['fatMass', 'leanTissue', 'energyBalance'],
    },
  ],
  myths: [
    {
      id: '11-myth-excess-protein-not-fat',
      claim: "Excess protein can't be stored as fat, so protein overfeeding doesn't make you fatter.",
      verdict: 'not-supported',
      explanation:
        'In an inpatient trial, fat gain was identical (3.44–3.66 kg) at 5%, 15% and 25% protein during +954 kcal/d. Trials in trained lifters found no fat gain despite an apparent +800 kcal/d, but intake was self-reported and free-living; a true +800 kcal/d for 8 weeks would store about 3 kg, so under-reporting or compensation is the likely explanation. Protein changes lean gain and expenditure, not fat gain, when energy is truly in surplus.',
      referenceIds: ['bray2012', 'antonio2014', 'antonio2015', 'antonio2016', 'leaf2017'],
    },
    {
      id: '11-myth-carbs-uniquely-fattening-dnl',
      claim: 'Carbs are uniquely fattening because they turn into fat.',
      verdict: 'not-supported',
      explanation:
        'Fat synthesis from carbohydrate is under 5–10 g a day unless carbohydrate energy exceeds expenditure. A carbohydrate surplus is, if anything, stored less efficiently than a fat surplus, and fat gain from carbohydrate surplus happens by sparing fat burning. The exception is extreme carbohydrate excess with full glycogen stores.',
      referenceIds: [
        'hellerstein1999',
        'schwarz1995',
        'mcdevitt2001',
        'horton1995',
        'jebb1996',
        'schutz1989',
        'acheson1988',
      ],
    },
    {
      id: '11-myth-6000-kcal-cheat-day',
      claim: 'A 6 000 kcal cheat day adds 2–3 kg of fat.',
      verdict: 'not-supported',
      explanation:
        'The scale gain is mostly glycogen, water, gut content and fluid. The fat is about (surplus − digestion − glycogen) divided by about 10 000 kcal per kilogram, roughly 0.3–0.4 kg. Three days at +1 500 kcal/d showed no measurable fat change and weight normalised in about 5 days. The fat part is real and cumulative, though.',
      referenceIds: ['sagayama2014', 'acheson1982'],
    },
    {
      id: '11-myth-metabolism-burns-off-excess',
      claim: 'Metabolism speeds up to burn off excess calories.',
      verdict: 'oversimplified',
      explanation:
        'The average unexplained rise in expenditure is small (+23–43 kcal/d in one trial, none in another, 12% unaccounted in a third). It is large in some people through everyday movement. So it is mostly a myth for the average person and real for "NEAT responders".',
      referenceIds: ['johannsen2019', 'diaz1992', 'siervo2008', 'levine1999a'],
    },
    {
      id: '11-myth-bigger-surplus-more-muscle',
      claim: 'A bigger surplus means more muscle.',
      verdict: 'oversimplified',
      explanation:
        'In trained lifters, a larger surplus mainly adds fat. One pilot in bodybuilders suggests more muscle with a much higher intake, and a four-compartment study found gain of about 0.55% a week compatible with mostly fat-free mass but poorly predictable. It is largely a myth beyond a modest surplus and possibly less true for novices.',
      referenceIds: ['helms2023', 'garthe2013', 'gavanda2026', 'henselmans2026', 'ribeiro2019', 'smith2021'],
    },
    {
      id: '11-myth-must-surplus-to-build-muscle',
      claim: 'You must eat in a surplus to build muscle.',
      verdict: 'oversimplified',
      explanation:
        'Maintenance energy supports most training gains, and a deficit of about 500 kcal a day abolishes them on average. So it is partly true in the sense that large deficits should be avoided, while a surplus helps little.',
      referenceIds: ['murphy2022'],
    },
    {
      id: '11-myth-3500-kcal-gained',
      claim: '3 500 kcal equals one pound of weight gained.',
      verdict: 'not-supported',
      explanation:
        'Pooled overfeeding studies needed 8.05 kcal per gram (about 3 650 kcal per pound), and long studies 8–12 kcal per gram; short studies are lower because of water. The excess needed depends on duration and composition.',
      referenceIds: ['forbes1986', 'bouchard1990', 'johannsen2019'],
    },
    {
      id: '11-myth-refeeds-reset-leptin',
      claim: 'Refeeds and cheat days reset leptin and metabolism and speed up fat loss.',
      verdict: 'unproven',
      explanation:
        'Leptin rises briefly with a carbohydrate surplus (+28% after 3 days) and falls again. One-week breaks gave no fat-loss advantage in trained adults, 2-day refeeds helped only dry fat-free mass (contested), and 2-week balance blocks helped men with obesity. They may help adherence and hunger.',
      referenceIds: [
        'dirlewanger2000',
        'chinchance2000',
        'peos2021',
        'campbell2020',
        'peos2020',
        'byrne2018',
      ],
    },
    {
      id: '11-myth-fructose-uniquely-fattening',
      claim: 'Fructose is uniquely fattening regardless of calories.',
      verdict: 'oversimplified',
      explanation:
        'Swapping fructose for other carbohydrate at equal calories does not change liver fat or ALT, while hypercaloric fructose raises them. Free-living 10-week trials found fructose, not glucose, raised visceral fat, DNL and atherogenic blood fats. The main driver is excess energy, and fructose adds a liver and visceral-fat specificity.',
      referenceIds: ['chiu2014', 'johnston2013', 'stanhope2009'],
    },
    {
      id: '11-myth-regain-same-composition',
      claim: 'Weight regained after a diet has the same composition as the weight lost.',
      verdict: 'oversimplified',
      explanation:
        'In lean people after large losses, fat recovers first and overshoots, and older women regain mostly fat. It is a myth for large losses in lean people but of minor importance after mild diets.',
      referenceIds: ['dulloo1996', 'jacquet2020', 'nindl1997', 'beavers2011', 'muller2015', 'dulloo2018'],
    },
  ],
  openQuestions: [
    'Which individual is a "NEAT responder" cannot be predicted from simple inputs (twin correlation about 0.5), so results need a band rather than a point.',
    'The lean bonus of a surplus during resistance training rests on small trials that used skinfolds, bioimpedance or anthropometric equations, and four-compartment data disagree in part.',
    'The lean-gain rates for novice, intermediate and advanced lifters are unverified placeholders until the resistance-training topic supplies them.',
    'The amount of non-fat matrix per kilogram of fat gained (0.20) is unverified, and it affects the fat-free share of sedentary gain.',
    'The low-protein group in the overfeeding trial (−0.70 kg lean mass, no expenditure rise, 3.16 kg gain) is not reproduced: the energy accounting with standard densities does not close for that group, and protein-deficiency catabolism belongs to the protein topic.',
    "Hall's quadratic glycogen law implies a time constant of about a day, while calorimetry shows carbohydrate balance only by day 3–5. The saturation exponent in the overflow rule is a proposed form.",
    'The size of gut content and fluid after large meals is unverified.',
    'The fat-depletion threshold for post-diet overshoot (about 10–30%), and how far starvation and military data apply to modest dieting, are uncertain, and the model constants come from 12 men.',
    'Liver-fat coefficients differ between lean young and overweight middle-aged cohorts, and there are few trials of short duration.',
    'Women and older adults are under-represented in overfeeding studies, which mostly used young men, and the sex-specific regional modifiers are grade D.',
    'Whether carbohydrate and fat surpluses produce different fat gains beyond 2 weeks is unresolved: the model produces a storage difference of about 10 points driven by the extra carbohydrate heat, but one 21-day study found none.',
    'Overfeeding-induced growth in the number of fat cells in the lower body may make gains harder to reverse, although a 5-year follow-up of twins found no persistent effect beyond age-related gain.',
    'Self-reported intake in free-living surplus studies undermines their surplus-size estimates, so inpatient data are preferred for calibration.',
  ],
  references: [
    {
      id: 'bouchard1990',
      authors: 'Bouchard C, Tremblay A, Després JP, Nadeau A, Lupien PJ, Thériault G, et al.',
      year: 1990,
      title: 'The response to long-term overfeeding in identical twins',
      journal: 'N Engl J Med',
      pmid: '2336074',
      doi: '10.1056/NEJM199005243222101',
    },
    {
      id: 'bouchard1996',
      authors: 'Bouchard C, Tremblay A, Després JP, Nadeau A, Lupien PJ, Moorjani S, et al.',
      year: 1996,
      title: 'Overfeeding in identical twins: 5-year postoverfeeding results',
      journal: 'Metabolism',
      pmid: '8769366',
      doi: '10.1016/s0026-0495(96)90277-2',
    },
    {
      id: 'deriaz1992',
      authors: 'Dériaz O, Fournier G, Tremblay A, Després JP, Bouchard C',
      year: 1992,
      title:
        'Lean-body-mass composition and resting energy expenditure before and after long-term overfeeding',
      journal: 'Am J Clin Nutr',
      pmid: '1415002',
      doi: '10.1093/ajcn/56.5.840',
    },
    {
      id: 'horton1995',
      authors: 'Horton TJ, Drougas H, Brachey A, Reed GW, Peters JC, Hill JO',
      year: 1995,
      title: 'Fat and carbohydrate overfeeding in humans: different effects on energy storage',
      journal: 'Am J Clin Nutr',
      pmid: '7598063',
      doi: '10.1093/ajcn/62.1.19',
    },
    {
      id: 'acheson1988',
      authors: 'Acheson KJ, Schutz Y, Bessard T, Anantharaman K, Flatt JP, Jéquier E',
      year: 1988,
      title:
        'Glycogen storage capacity and de novo lipogenesis during massive carbohydrate overfeeding in man',
      journal: 'Am J Clin Nutr',
      pmid: '3165600',
      doi: '10.1093/ajcn/48.2.240',
    },
    {
      id: 'acheson1982',
      authors: 'Acheson KJ, Flatt JP, Jéquier E',
      year: 1982,
      title: 'Glycogen synthesis versus lipogenesis after a 500 gram carbohydrate meal in man',
      journal: 'Metabolism',
      pmid: '6755166',
      doi: '10.1016/0026-0495(82)90010-5',
    },
    {
      id: 'acheson1984',
      authors: 'Acheson KJ, Schutz Y, Bessard T, Ravussin E, Jéquier E, Flatt JP',
      year: 1984,
      title: 'Nutritional influences on lipogenesis and thermogenesis after a carbohydrate meal',
      journal: 'Am J Physiol',
      pmid: '6696064',
      doi: '10.1152/ajpendo.1984.246.1.E62',
    },
    {
      id: 'bray2012',
      authors: 'Bray GA, Smith SR, de Jonge L, Xie H, Rood J, Martin CK, et al.',
      year: 2012,
      title:
        'Effect of dietary protein content on weight gain, energy expenditure, and body composition during overeating: a randomized controlled trial',
      journal: 'JAMA',
      pmid: '22215165',
      doi: '10.1001/jama.2011.1918',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3777747/',
    },
    {
      id: 'levine1999a',
      authors: 'Levine JA, Eberhardt NL, Jensen MD',
      year: 1999,
      title: 'Role of nonexercise activity thermogenesis in resistance to fat gain in humans',
      journal: 'Science',
      pmid: '9880251',
      doi: '10.1126/science.283.5399.212',
    },
    {
      id: 'levine1999b',
      authors: 'Levine JA, Eberhardt NL, Jensen MD',
      year: 1999,
      title:
        'Leptin responses to overfeeding: relationship with body fat and nonexercise activity thermogenesis',
      journal: 'J Clin Endocrinol Metab',
      pmid: '10443673',
      doi: '10.1210/jcem.84.8.5910',
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
      id: 'lammert2000',
      authors: 'Lammert O, Grunnet N, Faber P, Bjørnsbo KS, Dich J, Larsen LO, et al.',
      year: 2000,
      title: 'Effects of isoenergetic overfeeding of either carbohydrate or fat in young men',
      journal: 'Br J Nutr',
      pmid: '11029975',
    },
    {
      id: 'johannsen2019',
      authors: 'Johannsen DL, Marlatt KL, Conley KE, Smith SR, Ravussin E',
      year: 2019,
      title:
        'Metabolic adaptation is not observed after 8 weeks of overfeeding but energy expenditure variability is associated with weight recovery',
      journal: 'Am J Clin Nutr',
      pmid: '31204775',
      doi: '10.1093/ajcn/nqz108',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6766445/',
    },
    {
      id: 'forbes1986',
      authors: 'Forbes GB, Brown MR, Welle SL, Lipinski BA',
      year: 1986,
      title: 'Deliberate overfeeding in women and men: energy cost and composition of the weight gain',
      journal: 'Br J Nutr',
      pmid: '3479191',
      doi: '10.1079/bjn19860080',
    },
    {
      id: 'joosen2006',
      authors: 'Joosen AM, Westerterp KR',
      year: 2006,
      title: 'Energy expenditure during overfeeding',
      journal: 'Nutr Metab (Lond)',
      pmid: '16836744',
      doi: '10.1186/1743-7075-3-25',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC1543621/',
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
      id: 'schutz1989',
      authors: 'Schutz Y, Flatt JP, Jéquier E',
      year: 1989,
      title:
        'Failure of dietary fat intake to promote fat oxidation: a factor favoring the development of obesity',
      journal: 'Am J Clin Nutr',
      pmid: '2756918',
      doi: '10.1093/ajcn/50.2.307',
    },
    {
      id: 'ravussin1985',
      authors: 'Ravussin E, Schutz Y, Acheson KJ, Dusmet M, Bourquin L, Jéquier E',
      year: 1985,
      title: 'Short-term, mixed-diet overfeeding in man: no evidence for "luxuskonsumption"',
      journal: 'Am J Physiol',
      pmid: '4061637',
      doi: '10.1152/ajpendo.1985.249.5.E470',
    },
    {
      id: 'roberts1990',
      authors: 'Roberts SB, Young VR, Fuss P, Fiatarone MA, Richard B, Rasmussen H, et al.',
      year: 1990,
      title: 'Energy expenditure and subsequent nutrient intakes in overfed young men',
      journal: 'Am J Physiol',
      pmid: '2396704',
      doi: '10.1152/ajpregu.1990.259.3.R461',
    },
    {
      id: 'roberts1994',
      authors: 'Roberts SB, Fuss P, Heyman MB, Evans WJ, Tsay R, Rasmussen H, et al.',
      year: 1994,
      title: 'Control of food intake in older men',
      journal: 'JAMA',
      pmid: '7966871',
      doi: '10.1001/jama.1994.03520200057036',
    },
    {
      id: 'siervo2008',
      authors: 'Siervo M, Frühbeck G, Dixon A, Goldberg GR, Coward WA, Murgatroyd PR, et al.',
      year: 2008,
      title: 'Efficiency of autoregulatory homeostatic responses to imposed caloric excess in lean men',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '18042669',
      doi: '10.1152/ajpendo.00573.2007',
    },
    {
      id: 'pasquet1992',
      authors: 'Pasquet P, Brigant L, Froment A, Koppert GA, Bard D, de Garine I, et al.',
      year: 1992,
      title: 'Massive overfeeding and energy balance in men: the Guru Walla model',
      journal: 'Am J Clin Nutr',
      pmid: '1503058',
      doi: '10.1093/ajcn/56.3.483',
    },
    {
      id: 'thearle2013',
      authors: 'Thearle MS, Pannacciulli N, Bonfiglio S, Pacak K, Krakoff J',
      year: 2013,
      title:
        'Extent and determinants of thermogenic responses to 24 hours of fasting, energy balance, and five different overfeeding diets in humans',
      journal: 'J Clin Endocrinol Metab',
      pmid: '23666976',
      doi: '10.1210/jc.2013-1289',
    },
    {
      id: 'reinhardt2016',
      authors: 'Reinhardt M, Schlögl M, Bonfiglio S, Votruba SB, Krakoff J, Thearle MS',
      year: 2016,
      title: 'Lower core body temperature and greater body fat are components of a human thrifty phenotype',
      journal: 'Int J Obes (Lond)',
      pmid: '26499440',
      doi: '10.1038/ijo.2015.229',
    },
    {
      id: 'schmidt2013',
      authors: 'Schmidt SL, Kealey EH, Horton TJ, VonKaenel S, Bessesen DH',
      year: 2013,
      title:
        'The effects of short-term overfeeding on energy expenditure and nutrient oxidation in obesity-prone and obesity-resistant individuals',
      journal: 'Int J Obes (Lond)',
      pmid: '23229737',
      doi: '10.1038/ijo.2012.202',
    },
    {
      id: 'schmidt2012',
      authors: 'Schmidt SL, Harmon KA, Sharp TA, Kealey EH, Bessesen DH',
      year: 2012,
      title:
        'The effects of overfeeding on spontaneous physical activity in obesity prone and obesity resistant humans',
      journal: 'Obesity (Silver Spring)',
      pmid: '22522883',
      doi: '10.1038/oby.2012.103',
    },
    {
      id: 'giroux2018',
      authors: 'Giroux V, Saidj S, Simon C, Laville M, Segrestin B, Mathieu ME',
      year: 2018,
      title:
        'Physical activity, energy expenditure and sedentary parameters in overfeeding studies – a systematic review',
      journal: 'BMC Public Health',
      pmid: '30031374',
      doi: '10.1186/s12889-018-5801-2',
    },
    {
      id: 'westerterp2004',
      authors: 'Westerterp KR',
      year: 2004,
      title: 'Diet induced thermogenesis',
      journal: 'Nutr Metab (Lond)',
      pmid: '15507147',
      doi: '10.1186/1743-7075-1-5',
    },
    {
      id: 'tappy1996',
      authors: 'Tappy L',
      year: 1996,
      title: 'Thermic effect of food and sympathetic nervous system activity in humans',
      journal: 'Reprod Nutr Dev',
      pmid: '8878356',
      doi: '10.1051/rnd:19960405',
    },
    {
      id: 'hall2011a',
      authors: 'Hall KD, Sacks G, Chandramohan D, et al.',
      year: 2011,
      title: 'Quantification of the effect of energy imbalance on bodyweight',
      journal: 'Lancet',
      pmid: '21872751',
      doi: '10.1016/S0140-6736(11)60812-X',
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
      id: 'hall2008a',
      authors: 'Hall KD',
      year: 2008,
      title: 'What is the required energy deficit per unit weight loss?',
      journal: 'Int J Obes (Lond)',
      pmid: '17848938',
      doi: '10.1038/sj.ijo.0803720',
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
      id: 'hellerstein1999',
      authors: 'Hellerstein MK',
      year: 1999,
      title: 'De novo lipogenesis in humans: metabolic and regulatory aspects',
      journal: 'Eur J Clin Nutr',
      pmid: '10365981',
      doi: '10.1038/sj.ejcn.1600744',
    },
    {
      id: 'schwarz1995',
      authors: 'Schwarz JM, Neese RA, Turner S, Dare D, Hellerstein MK',
      year: 1995,
      title:
        'Short-term alterations in carbohydrate energy intake in humans. Striking effects on hepatic glucose production, de novo lipogenesis, lipolysis, and whole-body fuel selection',
      journal: 'J Clin Invest',
      pmid: '8675642',
      doi: '10.1172/JCI118342',
    },
    {
      id: 'aarsland1997',
      authors: 'Aarsland A, Chinkes D, Wolfe RR',
      year: 1997,
      title: 'Hepatic and whole-body fat synthesis in humans during carbohydrate overfeeding',
      journal: 'Am J Clin Nutr',
      pmid: '9174472',
      doi: '10.1093/ajcn/65.6.1774',
      verification: 'abstract',
    },
    {
      id: 'mcdevitt2001',
      authors: 'McDevitt RM, Bott SJ, Harding M, Coward WA, Bluck LJ, Prentice AM',
      year: 2001,
      title:
        'De novo lipogenesis during controlled overfeeding with sucrose or glucose in lean and obese women',
      journal: 'Am J Clin Nutr',
      pmid: '11722954',
      doi: '10.1093/ajcn/74.6.737',
    },
    {
      id: 'minehira2004',
      authors: 'Minehira K, Vega N, Vidal H, Acheson K, Tappy L',
      year: 2004,
      title:
        'Effect of carbohydrate overfeeding on whole body macronutrient metabolism and expression of lipogenic enzymes in adipose tissue of lean and overweight humans',
      journal: 'Int J Obes Relat Metab Disord',
      pmid: '15303106',
      doi: '10.1038/sj.ijo.0802760',
    },
    {
      id: 'dirlewanger2000',
      authors: 'Dirlewanger M, di Vetta V, Guenat E, Battilana P, Seematter G, Schneiter P, et al.',
      year: 2000,
      title:
        'Effects of short-term carbohydrate or fat overfeeding on energy expenditure and plasma leptin concentrations in healthy female subjects',
      journal: 'Int J Obes Relat Metab Disord',
      pmid: '11126336',
      doi: '10.1038/sj.ijo.0801395',
    },
    {
      id: 'kolaczynski1996',
      authors: 'Kolaczynski JW, Ohannesian JP, Considine RV, Marco CC, Caro JF',
      year: 1996,
      title: 'Response of leptin to short-term and prolonged overfeeding in humans',
      journal: 'J Clin Endocrinol Metab',
      pmid: '8923877',
      doi: '10.1210/jcem.81.11.8923877',
    },
    {
      id: 'chinchance2000',
      authors: 'Chin-Chance C, Polonsky KS, Schoeller DA',
      year: 2000,
      title:
        'Twenty-four-hour leptin levels respond to cumulative short-term energy imbalance and predict subsequent intake',
      journal: 'J Clin Endocrinol Metab',
      pmid: '10946866',
      doi: '10.1210/jcem.85.8.6755',
    },
    {
      id: 'havel1999',
      authors: 'Havel PJ, Townsend R, Chaump L, Teff K',
      year: 1999,
      title: 'High-fat meals reduce 24-h circulating leptin concentrations in women',
      journal: 'Diabetes',
      pmid: '10334310',
      doi: '10.2337/diabetes.48.2.334',
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
    },
    {
      id: 'antonio2015',
      authors: 'Antonio J, Ellerbroek A, Silver T, Orris S, Scheiner M, Gonzalez A, Peacock CA',
      year: 2015,
      title:
        'A high protein diet (3.4 g/kg/d) combined with a heavy resistance training program improves body composition in healthy trained men and women – a follow-up investigation',
      journal: 'J Int Soc Sports Nutr',
      pmid: '26500462',
      doi: '10.1186/s12970-015-0100-0',
    },
    {
      id: 'antonio2016',
      authors: 'Antonio J, Ellerbroek A, Silver T, Vargas L, Tamayo A, Buehn R, Peacock CA',
      year: 2016,
      title:
        'A high protein diet has no harmful effects: a one-year crossover study in resistance-trained males',
      journal: 'J Nutr Metab',
      pmid: '27807480',
      doi: '10.1155/2016/9104792',
    },
    {
      id: 'leaf2017',
      authors: 'Leaf A, Antonio J',
      year: 2017,
      title:
        'The effects of overfeeding on body composition: the role of macronutrient composition – a narrative review',
      journal: 'Int J Exerc Sci',
      pmid: '29399253',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5786199/',
    },
    {
      id: 'helms2023',
      authors: 'Helms ER, Spence AJ, Sousa C, Kreiger J, Taylor S, Oranchuk DJ, et al.',
      year: 2023,
      title:
        'Effect of small and large energy surpluses on strength, muscle, and skinfold thickness in resistance-trained individuals: a parallel groups design',
      journal: 'Sports Med Open',
      pmid: '37914977',
      doi: '10.1186/s40798-023-00651-y',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10620361/',
    },
    {
      id: 'ribeiro2019',
      authors: 'Ribeiro AS, Nunes JP, Schoenfeld BJ, Aguiar AF, Cyrino ES',
      year: 2019,
      title:
        'Effects of different dietary energy intake following resistance training on muscle mass and body fat in bodybuilders: a pilot study',
      journal: 'J Hum Kinet',
      pmid: '31915482',
      doi: '10.2478/hukin-2019-0038',
    },
    {
      id: 'garthe2013',
      authors: 'Garthe I, Raastad T, Refsnes PE, Sundgot-Borgen J',
      year: 2013,
      title: 'Effect of nutritional intervention on body composition and performance in elite athletes',
      journal: 'Eur J Sport Sci',
      pmid: '23679146',
      doi: '10.1080/17461391.2011.643923',
    },
    {
      id: 'rozenek2002',
      authors: 'Rozenek R, Ward P, Long S, Garhammer J',
      year: 2002,
      title:
        'Effects of high-calorie supplements on body composition and muscular strength following resistance training',
      journal: 'J Sports Med Phys Fitness',
      pmid: '12094125',
    },
    {
      id: 'slater2019',
      authors: 'Slater GJ, Dieter BP, Marsh DJ, Helms ER, Shaw G, Iraki J',
      year: 2019,
      title:
        'Is an energy surplus required to maximize skeletal muscle hypertrophy associated with resistance training?',
      journal: 'Front Nutr',
      pmid: '31482093',
      doi: '10.3389/fnut.2019.00131',
    },
    {
      id: 'smith2021',
      authors: 'Smith RW, Harty PS, Stratton MT, Rafi Z, Rodriguez C, Dellinger JR, et al.',
      year: 2021,
      title:
        'Predicting adaptations to resistance training plus overfeeding using Bayesian regression: a preliminary investigation',
      journal: 'J Funct Morphol Kinesiol',
      pmid: '33919267',
      doi: '10.3390/jfmk6020036',
    },
    {
      id: 'iraki2019',
      authors: 'Iraki J, Fitschen P, Espinar S, Helms E',
      year: 2019,
      title: 'Nutrition recommendations for bodybuilders in the off-season: a narrative review',
      journal: 'Sports (Basel)',
      pmid: '31247944',
      doi: '10.3390/sports7070154',
    },
    {
      id: 'spillane2016',
      authors: 'Spillane M, Willoughby DS',
      year: 2016,
      title:
        'Daily overfeeding from protein and/or carbohydrate supplementation for eight weeks in conjunction with resistance training does not improve body composition and muscle strength or increase markers indicative of muscle protein synthesis and myogenesis in resistance-trained males',
      journal: 'J Sports Sci Med',
      pmid: '26957922',
    },
    {
      id: 'gavanda2026',
      authors: 'Gavanda S, Arnet L, Löffler D, Dissemond J, Havers T, Wiewelhove T, et al.',
      year: 2026,
      title:
        'Time-restricted eating during a bulking phase is associated with reduced fat accumulation, while muscle and strength gains are maintained: a 12-wk randomized controlled trial',
      journal: 'J Nutr',
      pmid: '42442697',
      doi: '10.1016/j.tjnut.2026.101722',
    },
    {
      id: 'blake2025',
      authors: 'Blake DT, Hamane C, Pacheco C, Henselmans M, Tinsley GM, Costa P, et al.',
      year: 2025,
      title:
        'Hypercaloric 16:8 time-restricted eating during 8 weeks of resistance exercise in well-trained men and women',
      journal: 'J Int Soc Sports Nutr',
      pmid: '40241374',
      doi: '10.1080/15502783.2025.2492184',
    },
    {
      id: 'henselmans2026',
      authors: 'Henselmans M, Tiede DR, Plotkin DL, Mattingly ML, Harbour ER, Anglin DA, et al.',
      year: 2026,
      title:
        'Effects of modest carbohydrate-energy supplementation on resistance training adaptations in trained men: a crossover trial',
      journal: 'Nutrients',
      pmid: '42356347',
      doi: '10.3390/nu18121961',
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
      id: 'rosqvist2014',
      authors: 'Rosqvist F, Iggman D, Kullberg J, Cedernaes J, Johansson HE, Larsson A, et al.',
      year: 2014,
      title:
        'Overfeeding polyunsaturated and saturated fat causes distinct effects on liver and visceral fat accumulation in humans',
      journal: 'Diabetes',
      pmid: '24550191',
      doi: '10.2337/db13-1622',
    },
    {
      id: 'elmsjo2015',
      authors: 'Elmsjö A, Rosqvist F, Engskog MK, Haglöf J, Kullberg J, Iggman D, et al.',
      year: 2015,
      title:
        'NMR-based metabolic profiling in healthy individuals overfed different types of fat: links to changes in liver fat accumulation and lean tissue mass',
      journal: 'Nutr Diabetes',
      pmid: '26479316',
      doi: '10.1038/nutd.2015.31',
    },
    {
      id: 'rosqvist2019',
      authors: 'Rosqvist F, Kullberg J, Ståhlman M, Cedernaes J, Heurling K, Johansson HE, et al.',
      year: 2019,
      title:
        'Overeating saturated fat promotes fatty liver and ceramides compared with polyunsaturated fat: a randomized trial',
      journal: 'J Clin Endocrinol Metab',
      pmid: '31369090',
      doi: '10.1210/jc.2019-00160',
    },
    {
      id: 'luukkonen2018',
      authors: 'Luukkonen PK, Sädevirta S, Zhou Y, Kayser B, Ali A, Ahonen L, et al.',
      year: 2018,
      title:
        'Saturated fat is more metabolically harmful for the human liver than unsaturated fat or simple sugars',
      journal: 'Diabetes Care',
      pmid: '29844096',
      doi: '10.2337/dc18-0071',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7082640/',
    },
    {
      id: 'maersk2012',
      authors: 'Maersk M, Belza A, Stødkilde-Jørgensen H, Ringgaard S, Chabanova E, Thomsen H, et al.',
      year: 2012,
      title:
        'Sucrose-sweetened beverages increase fat storage in the liver, muscle, and visceral fat depot: a 6-mo randomized intervention study',
      journal: 'Am J Clin Nutr',
      pmid: '22205311',
      doi: '10.3945/ajcn.111.022533',
    },
    {
      id: 'stanhope2009',
      authors: 'Stanhope KL, Schwarz JM, Keim NL, Griffen SC, Bremer AA, Graham JL, et al.',
      year: 2009,
      title:
        'Consuming fructose-sweetened, not glucose-sweetened, beverages increases visceral adiposity and lipids and decreases insulin sensitivity in overweight/obese humans',
      journal: 'J Clin Invest',
      pmid: '19381015',
      doi: '10.1172/JCI37385',
    },
    {
      id: 'johnston2013',
      authors: 'Johnston RD, Stephenson MC, Crossland H, Cordon SM, Palcidi E, Cox EF, et al.',
      year: 2013,
      title:
        'No difference between high-fructose and high-glucose diets on liver triacylglycerol or biochemistry in healthy overweight men',
      journal: 'Gastroenterology',
      pmid: '23872500',
      doi: '10.1053/j.gastro.2013.07.012',
    },
    {
      id: 'chiu2014',
      authors: 'Chiu S, Sievenpiper JL, de Souza RJ, Cozma AI, Mirrahimi A, Carleton AJ, et al.',
      year: 2014,
      title:
        'Effect of fructose on markers of non-alcoholic fatty liver disease (NAFLD): a systematic review and meta-analysis of controlled feeding trials',
      journal: 'Eur J Clin Nutr',
      pmid: '24569542',
      doi: '10.1038/ejcn.2014.8',
    },
    {
      id: 'sevastianova2012',
      authors: 'Sevastianova K, Santos A, Kotronen A, Hakkarainen A, Makkonen J, Silander K, et al.',
      year: 2012,
      title:
        'Effect of short-term carbohydrate overfeeding and long-term weight loss on liver fat in overweight humans',
      journal: 'Am J Clin Nutr',
      pmid: '22952180',
      doi: '10.3945/ajcn.112.038695',
    },
    {
      id: 'lecoultre2014',
      authors: 'Lecoultre V, Carrel G, Egli L, Binnert C, Boss A, MacMillan EL, et al.',
      year: 2014,
      title:
        'Coffee consumption attenuates short-term fructose-induced liver insulin resistance in healthy men',
      journal: 'Am J Clin Nutr',
      pmid: '24257718',
      doi: '10.3945/ajcn.113.069526',
    },
    {
      id: 'tchoukalova2010',
      authors: 'Tchoukalova YD, Votruba SB, Tchkonia T, Giorgadze N, Kirkland JL, Jensen MD',
      year: 2010,
      title: 'Regional differences in cellular mechanisms of adipose tissue gain with overfeeding',
      journal: 'Proc Natl Acad Sci U S A',
      pmid: '20921416',
      doi: '10.1073/pnas.1005259107',
    },
    {
      id: 'votruba2012',
      authors: 'Votruba SB, Jensen MD',
      year: 2012,
      title:
        'Short-term regional meal fat storage in nonobese humans is not a predictor of long-term regional fat gain',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '22338076',
      doi: '10.1152/ajpendo.00414.2011',
    },
    {
      id: 'votruba2006',
      authors: 'Votruba SB, Jensen MD',
      year: 2006,
      title: 'Sex-specific differences in leg fat uptake are revealed with a high-fat meal',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '16803856',
      doi: '10.1152/ajpendo.00196.2006',
    },
    {
      id: 'romanski2000',
      authors: 'Romanski SA, Nelson RM, Jensen MD',
      year: 2000,
      title: 'Meal fatty acid uptake in adipose tissue: gender effects in nonobese humans',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '10913047',
      doi: '10.1152/ajpendo.2000.279.2.E455',
    },
    {
      id: 'covassin2018',
      authors: 'Covassin N, Sert-Kuniyoshi FH, Singh P, Romero-Corral A, Davison DE, Lopez-Jimenez F, et al.',
      year: 2018,
      title:
        'Experimental weight gain increases ambulatory blood pressure in healthy subjects: implications of visceral fat accumulation',
      journal: 'Mayo Clin Proc',
      pmid: '29728201',
      doi: '10.1016/j.mayocp.2017.12.012',
    },
    {
      id: 'gentile2007',
      authors: 'Gentile CL, Orr JS, Davy BM, Davy KP',
      year: 2007,
      title: 'Modest weight gain is associated with sympathetic neural activation in nonobese humans',
      journal: 'Am J Physiol Regul Integr Comp Physiol',
      pmid: '17218435',
      doi: '10.1152/ajpregu.00876.2006',
    },
    {
      id: 'orr2008',
      authors: 'Orr JS, Gentile CL, Davy BM, Davy KP',
      year: 2008,
      title: 'Large artery stiffening with weight gain in humans: role of visceral fat accumulation',
      journal: 'Hypertension',
      pmid: '18458161',
      doi: '10.1161/HYPERTENSIONAHA.108.112946',
    },
    {
      id: 'singh2021',
      authors: 'Singh P, Covassin N, Sert-Kuniyoshi FH, Marlatt KL, Romero-Corral A, Davison DE, et al.',
      year: 2021,
      title:
        'Overfeeding-induced weight gain elicits decreases in sex hormone-binding globulin in healthy males – implications for body fat distribution',
      journal: 'Physiol Rep',
      pmid: '34877821',
      doi: '10.14814/phy2.15127',
    },
    {
      id: 'boden2015',
      authors: 'Boden G, Homko C, Barrero CA, Stein TP, Chen X, Cheung P, et al.',
      year: 2015,
      title:
        'Excessive caloric intake acutely causes oxidative stress, GLUT4 carbonylation, and insulin resistance in healthy men',
      journal: 'Sci Transl Med',
      pmid: '26355033',
      doi: '10.1126/scitranslmed.aac4765',
    },
    {
      id: 'walhin2013',
      authors: 'Walhin JP, Richardson JD, Betts JA, Thompson D',
      year: 2013,
      title:
        'Exercise counteracts the effects of short-term overfeeding and reduced physical activity independent of energy imbalance in healthy young men',
      journal: 'J Physiol',
      pmid: '24167223',
      doi: '10.1113/jphysiol.2013.262709',
    },
    {
      id: 'knudsen2012',
      authors: 'Knudsen SH, Hansen LS, Pedersen M, Dejgaard T, Hansen J, van Hall G, et al.',
      year: 2012,
      title:
        'Changes in insulin sensitivity precede changes in body composition during 14 days of step reduction combined with overfeeding in healthy young men',
      journal: 'J Appl Physiol (1985)',
      pmid: '22556394',
      doi: '10.1152/japplphysiol.00189.2011',
    },
    {
      id: 'brons2009',
      authors: 'Brøns C, Jensen CB, Storgaard H, Hiscock NJ, White A, Appel JS, et al.',
      year: 2009,
      title: 'Impact of short-term high-fat feeding on glucose and insulin metabolism in young healthy men',
      journal: 'J Physiol',
      pmid: '19332493',
      doi: '10.1113/jphysiol.2009.169078',
    },
    {
      id: 'samochabonet2012',
      authors: 'Samocha-Bonet D, Campbell LV, Mori TA, Croft KD, Greenfield JR, Turner N, Heilbronn LK',
      year: 2012,
      title:
        'Overfeeding reduces insulin sensitivity and increases oxidative stress, without altering markers of mitochondrial content and function in humans',
      journal: 'PLoS One',
      pmid: '22586466',
      doi: '10.1371/journal.pone.0036320',
    },
    {
      id: 'heilbronn2013',
      authors: 'Heilbronn LK, Coster AC, Campbell LV, Greenfield JR, Lange K, Christopher MJ, et al.',
      year: 2013,
      title: 'The effect of short-term overfeeding on serum lipids in healthy humans',
      journal: 'Obesity (Silver Spring)',
      pmid: '23640727',
      doi: '10.1002/oby.20508',
    },
    {
      id: 'erdmann2008',
      authors: 'Erdmann J, Kallabis B, Oppel U, Sypchenko O, Wagenpfeil S, Schusdziarra V',
      year: 2008,
      title: 'Development of hyperinsulinemia and insulin resistance during the early stage of weight gain',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '18171910',
      doi: '10.1152/ajpendo.00560.2007',
    },
    {
      id: 'sagayama2014',
      authors: 'Sagayama H, Jikumaru Y, Hirata A, Yamada Y, Yoshimura E, Ichikawa M, et al.',
      year: 2014,
      title: 'Measurement of body composition in response to a short period of overfeeding',
      journal: 'J Physiol Anthropol',
      pmid: '25208693',
      doi: '10.1186/1880-6805-33-29',
    },
    {
      id: 'yanovski2000',
      authors: "Yanovski JA, Yanovski SZ, Sovik KN, Nguyen TT, O'Neil PM, Sebring NG",
      year: 2000,
      title: 'A prospective study of holiday weight gain',
      journal: 'N Engl J Med',
      pmid: '10727591',
      doi: '10.1056/NEJM200003233421206',
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
      id: 'campbell2020',
      authors: 'Campbell BI, Aguilar D, Colenso-Semple LM, Hartke K, Fleming AR, Fox CD, et al.',
      year: 2020,
      title:
        'Intermittent energy restriction attenuates the loss of fat free mass in resistance trained individuals. A randomized controlled trial',
      journal: 'J Funct Morphol Kinesiol',
      pmid: '33467235',
      doi: '10.3390/jfmk5010019',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7739314/',
    },
    {
      id: 'peos2020',
      authors: 'Peos J, Brown AW, Vorland CJ, Allison DB, Sainsbury A',
      year: 2020,
      title:
        'Contrary to the conclusions stated in the paper, only dry fat-free mass was different between groups upon reanalysis (comment on Campbell et al. 2020)',
      journal: 'J Funct Morphol Kinesiol',
      pmid: '33467300',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7739336/',
    },
    {
      id: 'peos2021',
      authors: 'Peos JJ, Helms ER, Fournier PA, Ong J, Hall C, Krieger J, Sainsbury A',
      year: 2021,
      title:
        'Continuous versus intermittent dieting for fat loss and fat-free mass retention in resistance-trained adults: the ICECAP trial',
      journal: 'Med Sci Sports Exerc',
      pmid: '33587549',
      doi: '10.1249/MSS.0000000000002636',
    },
    {
      id: 'byrne2018',
      authors: 'Byrne NM, Sainsbury A, King NA, Hills AP, Wood RE',
      year: 2018,
      title:
        'Intermittent energy restriction improves weight loss efficiency in obese men: the MATADOR study',
      journal: 'Int J Obes (Lond)',
      pmid: '28925405',
      doi: '10.1038/ijo.2017.206',
    },
    {
      id: 'tsang2025',
      authors: 'Tsang JH, Poon ET, Trexler ET, Wong SH, Zheng C, Sun F',
      year: 2025,
      title:
        'The role of cheat meals in dieting: a scoping review of physiological and psychological responses',
      journal: 'Nutr Rev',
      pmid: '40517327',
      doi: '10.1093/nutrit/nuaf077',
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
      id: 'dulloo1997',
      authors: 'Dulloo AG, Jacquet J, Girardier L',
      year: 1997,
      title:
        'Poststarvation hyperphagia and body fat overshooting in humans: a role for feedback signals from lean and fat tissues',
      journal: 'Am J Clin Nutr',
      pmid: '9062520',
      doi: '10.1093/ajcn/65.3.717',
    },
    {
      id: 'dulloo2018',
      authors: 'Dulloo AG, Miles-Chan JL, Schutz Y',
      year: 2018,
      title:
        'Collateral fattening in body composition autoregulation: its determinants and significance for obesity predisposition',
      journal: 'Eur J Clin Nutr',
      pmid: '29559726',
      doi: '10.1038/s41430-018-0138-6',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5945583/',
    },
    {
      id: 'jacquet2020',
      authors: 'Jacquet P, Schutz Y, Montani JP, Dulloo A',
      year: 2020,
      title:
        'How dieting might make some fatter: modeling weight cycling toward obesity from a perspective of body composition autoregulation',
      journal: 'Int J Obes (Lond)',
      pmid: '32099104',
      doi: '10.1038/s41366-020-0547-1',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7260129/',
    },
    {
      id: 'nindl1997',
      authors: 'Nindl BC, Friedl KE, Frykman PN, et al.',
      year: 1997,
      title:
        'Physical performance and metabolic recovery among lean, healthy men following a prolonged energy deficit',
      journal: 'Int J Sports Med',
      pmid: '9298770',
      doi: '10.1055/s-2007-972640',
    },
    {
      id: 'muller2015',
      authors: 'Müller MJ, Enderle J, Pourhassan M, Braun W, Eggeling B, Lagerpusch M, et al.',
      year: 2015,
      title:
        'Metabolic adaptation to caloric restriction and subsequent refeeding: the Minnesota Starvation Experiment revisited',
      journal: 'Am J Clin Nutr',
      pmid: '26399868',
      doi: '10.3945/ajcn.115.109173',
    },
    {
      id: 'beavers2011',
      authors: 'Beavers KM, Lyles MF, Davis CC, Wang X, Beavers DP, Nicklas BJ',
      year: 2011,
      title:
        'Is lost lean mass from intentional weight loss recovered during weight regain in postmenopausal women?',
      journal: 'Am J Clin Nutr',
      pmid: '21795437',
      doi: '10.3945/ajcn.110.004895',
    },
    {
      id: 'keys1950',
      authors: 'Keys A, Brožek J, Henschel A, Mickelsen O, Taylor HL',
      year: 1950,
      title: 'The Biology of Human Starvation',
      journal: 'Minneapolis: University of Minnesota Press (2 vols)',
      verification: 'unverified',
    },
    {
      id: 'suter1992',
      authors: 'Suter PM, Schutz Y, Jéquier E',
      year: 1992,
      title: 'The effect of ethanol on fat storage in healthy subjects',
      journal: 'N Engl J Med',
      pmid: '1545851',
      doi: '10.1056/NEJM199204093261503',
    },
    {
      id: 'siler1999',
      authors: 'Siler SQ, Neese RA, Hellerstein MK',
      year: 1999,
      title:
        'De novo lipogenesis, lipid kinetics, and whole-body lipid balances in humans after acute alcohol consumption',
      journal: 'Am J Clin Nutr',
      pmid: '10539756',
      doi: '10.1093/ajcn/70.5.928',
    },
    {
      id: 'tucker2021',
      authors: "Tucker WJ, Jarrett CL, D'Lugos AC, Angadi SS, Gaesser GA",
      year: 2021,
      title:
        'Effects of indulgent food snacking, with and without exercise training, on body weight, fat mass, and cardiometabolic risk markers in overweight and obese men',
      journal: 'Physiol Rep',
      pmid: '34816612',
      doi: '10.14814/phy2.15118',
    },
    {
      id: 'cuthbertson2017',
      authors: 'Cuthbertson DJ, Steele T, Wilding JP, Halford JC, Harrold JA, Hamer M, Karpe F',
      year: 2017,
      title:
        'What have human experimental overfeeding studies taught us about adipose tissue expansion and susceptibility to obesity and metabolic complications?',
      journal: 'Int J Obes (Lond)',
      pmid: '28077863',
      doi: '10.1038/ijo.2017.4',
    },
    {
      id: 'hengist2020',
      authors: 'Hengist A, Edinburgh RM, Davies RG, Walhin JP, Buniam J, et al.',
      year: 2020,
      title: 'Physiological responses to maximal eating in men',
      journal: 'Br J Nutr',
      pmid: '32248846',
      doi: '10.1017/S0007114520001270',
    },
    {
      id: 'hydes2021',
      authors: 'Hydes T, Alam U, Cuthbertson DJ',
      year: 2021,
      title:
        'The impact of macronutrient intake on non-alcoholic fatty liver disease (NAFLD): too much fat, too much carbohydrate, or just too many calories?',
      journal: 'Front Nutr',
      pmid: '33665203',
      doi: '10.3389/fnut.2021.640557',
    },
    {
      id: 'tappy2004',
      authors: 'Tappy L',
      year: 2004,
      title: 'Metabolic consequences of overfeeding in humans',
      journal: 'Curr Opin Clin Nutr Metab Care',
      pmid: '15534429',
      doi: '10.1097/00075197-200411000-00006',
    },
    {
      id: 'mendozaherrera2021',
      authors: 'Mendoza-Herrera K, Florio AA, Moore M, Marrero A, et al.',
      year: 2021,
      title: 'The leptin system and diet: a mini review of the current evidence',
      journal: 'Front Endocrinol (Lausanne)',
      pmid: '34899599',
      doi: '10.3389/fendo.2021.749050',
    },
  ],
};

export default topic;
