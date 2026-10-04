import type { EvidenceTopic } from '../schema';

/** Evidence topic for research/07-fasting-meal-timing-circadian.md (pure data). */
const topic: EvidenceTopic = {
  dossier: '07',
  slug: 'fasting-meal-timing',
  title: 'Fasting, meal timing and eating windows',
  scope:
    'What the body does hour by hour from the last meal through several weeks of zero intake, and which effects of meal timing survive once energy and protein are matched. The topic covers gastric emptying, the glycogen and ketone timeline, the hormone and protein-loss changes of fasting, eating-window and meal-frequency trials, alternate-day fasting, and time-of-day effects. At the same energy and protein, timing changes body fat and lean mass by at most about 0–1 kg over months. Its real effects run through appetite, intake, glucose after meals and lean-tissue loss in long fasts.',
  mechanisms: [
    {
      id: '07-gastric-emptying-and-absorption',
      title: 'How long a meal keeps you in the fed state',
      category: 'fuel',
      summary:
        'Food leaves the stomach at a limited speed, so a meal is absorbed over hours, not minutes. A normal 600–800 kcal mixed meal keeps the body in the fed state for about 4–5 hours. Bigger meals last longer rather than being absorbed faster. That is why eating once a day still leaves only about 14–16 hours a day in the post-absorptive state, not 23.',
      howModelled:
        "Each meal joins a stomach pool after a lag of 0.5 hours (none for liquids). The pool empties at a saturating rate, with a ceiling of 270 kcal/h. The body counts as fed while absorption is at least 30 kcal/h. Protein absorption uses the protein topic's saturating digestion rate rather than a 10 g/h cap, with a similar result: a very large protein dose keeps amino acids high for many hours.",
      equation: `dGutE/dt = −kGE · gutE / (gutE + KGE)      (after the lag)
absFlux = kGE · gutE / (gutE + KGE)       (kcal/h)
FED = absFlux ≥ 30 kcal/h
protein absorption capped at Pmax = 10 g/h`,
      keyNumbers: [
        {
          label: 'Scintigraphy norms for a 255 kcal low-fat egg meal',
          value:
            'Median retention in the stomach 69 % at 1 h, 24 % at 2 h and 1.2 % at 4 h (95th percentiles 90 / 60 / 10 %)',
          note: 'Model: 69 / 24 / 0.9 %.',
          referenceIds: ['tougas2000', 'abell2008'],
        },
        {
          label: 'Glucose drinks',
          value: 'Empty at a near-constant rate of about 2.1 kcal/min',
          referenceIds: ['brener1983'],
        },
        {
          label: 'What slows emptying (33 studies)',
          value:
            'Emptying slows with nutritive density; per kcal, fat, protein and carbohydrate slow it equally (4 g fat ≈ 9 g carbohydrate)',
          referenceIds: ['hunt1975'],
        },
        {
          label: 'Liver glycogen after meals',
          value:
            'Peaks about 5 h after a mixed meal; with meals 5 h apart it keeps rising until just before the next meal',
          referenceIds: ['taylor1996', 'roden2001', 'hwang1995'],
        },
        {
          label: 'Very large protein doses',
          value:
            '100 g of protein produced an anabolic response lasting more than 12 h, against a shorter one for 25 g',
          referenceIds: ['trommelen2023'],
        },
        {
          label: 'Model parameters (proposed fit)',
          value:
            'kGE 270 kcal/h (range 130–300); KGE 150 kcal (100–250); lag 0.5 h (0.25–0.75); fed threshold 30 kcal/h (15–60); protein cap 10 g/h (6–12)',
          note: 'Fitted to the scintigraphy medians and constrained by the glucose-emptying and energy-density data.',
        },
        {
          label: 'Time to 95 % emptied (model, mixed meals)',
          value:
            '100 kcal 2.5 h; 255 kcal 3.1 h; 500 kcal 3.9 h; 700 kcal 4.6 h; 1000 kcal 5.7 h; 1500 kcal 7.4 h; 2000 kcal 9.2 h',
          note: 'One meal of 2000 kcal or more keeps the body absorptive for about 8–10 hours.',
        },
      ],
      timeCourse:
        'Onset is 0.5 hours after a solid meal. Absorption saturates at large contents, so big meals prolong rather than intensify it. There is no hysteresis.',
      moderators:
        'Gastroparesis and diabetes slow emptying. GLP-1 drugs slow it too (out of scope here). Exercise slows it briefly. Women empty solids somewhat slower (magnitude unverified, not modelled). High viscous fibre slows emptying (magnitude unverified).',
      grade: 'B',
      gradeReason:
        'Consensus scintigraphy norms and classic physiology support it; scaling to large mixed meals is an extrapolation.',
      status: 'proposed-fit',
      caveats: 'Emptying of very large or high-fat meals is extrapolated from moderate test meals.',
      referenceIds: [
        'tougas2000',
        'abell2008',
        'brener1983',
        'hunt1975',
        'taylor1996',
        'roden2001',
        'hwang1995',
        'trommelen2023',
      ],
      relatedMetricIds: ['glucose', 'insulin', 'tef'],
    },
    {
      id: '07-fasting-clocks-and-memory',
      title: 'Fasting clocks: time since the last meal, and slow memory',
      category: 'fuel',
      summary:
        'Most fasting data are indexed to hours since the last meal. The engine keeps a clock that starts only when absorption ends. It also keeps separate memory clocks for slow hormones, so a small snack does not reset everything. A second fast that starts soon after a first therefore reaches the deep state faster for the slow variables.',
      howModelled:
        'Meal-equivalent fasting time is the hours since the last fed hour plus 4.5 hours, the absorption time of a reference 700 kcal meal; the engine uses it for the fasting insulin and glucose curves. It does not keep a separate memory clock for each slow variable: hormones, ketones and other slow quantities carry their own states with their own time constants, so a small snack moves them only a little.',
      equation: `each hour:
  if FED: tPA = 0, otherwise tPA += 1
  τ = FED ? 0 : tPA + 4.5
  φ = clamp(1 − absFlux/100, 0, 1)
  for each slow variable i:
    if not FED and τ ≥ 12: ζ_i += 1
    else if FED: ζ_i *= exp(−(1 − φ) · 1 h / Toff_i)
  X_i = Xref_i(12 + ζ_i)`,
      keyNumbers: [
        {
          label: 'Recovery time after refeeding, Toff (hours)',
          value:
            'Leptin 8 (B); GH 6 (C); cortisol 12 (D); noradrenaline 12 (D); T3 36 (C); IGF-1 48 (D); testosterone in men 24 (D); adaptive part of resting energy use 72 (D); nitrogen sparing 120 (D)',
          note: "The grades are from Vitals' evidence review for each recovery time. Leptin was back to baseline 24 h after refeeding a 36 h fast, and T3 and reverse T3 returned to control during 5 days of refeeding. Prior protein depletion blunted later fasting nitrogen loss by 17 %. Growth hormone is low in the fed state and its pulses are augmented within day 1 of fasting. There are no direct data for cortisol, noradrenaline, IGF-1 or testosterone.",
          referenceIds: ['kolaczynski1996', 'vagenakis1975', 'lariviere1990', 'ho1988', 'hartman1992'],
        },
        {
          label: 'Low-energy fast days',
          value:
            'With 200–250 kcal/day of juice or broth (25–35 g carbohydrate), ketonuria appears in more than 95 % by day 4 and blood ketones reach about 4 mM by day 12',
          note: "Cutting carbohydrate from 56.5 to 15.6 g/day intensifies ketosis. So small intakes do not reset the fasting state. In the model a 100 kcal item rewinds leptin's clock by about 10–15 % and T3's by about 3 %.",
          referenceIds: ['wilhelmidetoledo2019', 'grundler2024'],
        },
        {
          label: '5:2 fast days (500–650 kcal eaten as one meal)',
          value: 'About 19 h non-fed per day in the model',
          note: 'No human data map fast-day energy to the depth of the fasting hormone response.',
        },
      ],
      timeCourse: 'The clocks run hour by hour; each memory clock recovers with its own Toff after food.',
      moderators:
        'Meal size (bigger meals decay the memory faster) and how much food is eaten during a fast.',
      grade: 'C',
      gradeReason:
        'The structure is a modelling choice; the anchor points from refeeding studies are human data but sparse.',
      status: 'proposed-fit',
      caveats:
        'Recovery times for IGF-1, cortisol, noradrenaline, testosterone, resting energy use and nitrogen sparing are proposals (grade D). They govern the carry-over between repeated fasts.',
      referenceIds: [
        'kolaczynski1996',
        'vagenakis1975',
        'lariviere1990',
        'ho1988',
        'hartman1992',
        'wilhelmidetoledo2019',
        'grundler2024',
      ],
      relatedMetricIds: ['hoursFasted', 'autophagyIdx', 'igf1'],
    },
    {
      id: '07-liver-glycogen-and-metabolic-switch',
      title: 'Liver glycogen, gluconeogenesis and the metabolic switch',
      category: 'fuel',
      summary:
        "Liver glycogen, the liver's store of carbohydrate, falls steadily through a fast. The liver also makes a growing share of its glucose from other sources (gluconeogenesis), from about half at 12 hours to about 96 % after 36 hours. Nothing switches at a single hour. The move from glucose to ketones is gradual and is centred around 24–36 hours.",
      howModelled:
        "Vitals does not run this reduced version. Liver glycogen comes from the carbohydrate topic's liver store, and no switch index is computed; the ketosis state and the hours spent in ketosis play that role in the display.",
      equation: `dL_liv/dt = −Vgly · L_liv³ / (Kgly³ + L_liv³)     (g/h)
fGNG(τ) = 0.40 + 0.58 / (1 + exp(−(τ − 24)/7))
Ra_glucose(τ) = 7.9 + 3.1 · exp(−max(0, τ − 12)/25)     (µmol/kg/min, τ ≥ 12)
Sw = 1 / (1 + (L_liv/L50)⁴)`,
      keyNumbers: [
        {
          label: 'Liver glycogen by NMR after a 650 kcal meal',
          value:
            '396 ± 29 mM at 4 h → 251 ± 30 mM at 15 h; near-linear for 22 h; −83 % and liver volume −23 % after 64 h',
          note: 'Net glycogen breakdown 4.3 µmol/kg/min (0–22 h), 1.7 (22–46 h), 0.3 (46–64 h). Overnight-fasted values were 207–274 mM, with a peak of about 420 mM 4 h after dinner on a 3-meal day.',
          referenceIds: ['rothman1991', 'roden2001', 'taylor1996', 'hwang1995'],
        },
        {
          label: 'Conversion to grams',
          value:
            'Liver volume about 1.47 L, so 1 mM ≈ 0.24 g glycogen (396 mM ≈ 94 g; 420 mM ≈ 100 g; 251 mM ≈ 60 g)',
          referenceIds: ['petersen1996'],
        },
        {
          label: 'Gluconeogenesis share of glucose production',
          value:
            'About 55 % at 6–12 h after a 1000 kcal meal; 47 % at 14 h, 67 % at 22 h, 93 % at 42 h; 64 % (0–22 h), 82 % (22–36 h), 96 % (36–64 h)',
          referenceIds: ['petersen1996', 'landau1996', 'rothman1991'],
        },
        {
          label: 'Glucose appearance',
          value: '11.0 µmol/kg/min at 12 h → 8.3 at 72 h; about 86 g/day at 5–6 weeks, half from the kidney',
          referenceIds: ['klein1993', 'owen1969'],
        },
        {
          label: 'Parameters (proposed fit for a 70 kg adult)',
          value:
            'Vgly 3.5 g/h (±25 %); Kgly 40 g (30–50); L50 30 g (about 125 mM; range 20–40); fGNG constants 0.40 / 0.58 / 24 h / 7 h (±0.1)',
          note: 'L50 places the switch index at 0.5 near 32 h, matching blood BHB of 0.3–0.4 mM at 24 h and 1.2–1.9 mM at 48 h. The gluconeogenesis fit has an error under 0.05 at every point.',
          referenceIds: ['browning2012'],
        },
        {
          label: 'Fit output for liver glycogen',
          value:
            '69 g at 12 h; 60 g at 15 h (observed 60); 40 g at 24 h; 26 g at 36 h; 20 g at 48 h; 15 g at 64 h (observed 16); 10 g at 5 days',
          note: 'Net glycogen breakdown 2.8 / 1.0 / 0.28 g/h across the three Rothman intervals (observed 3.3 / 1.3 / 0.23).',
        },
        {
          label: 'Exercise and the switch',
          value: 'Ketones first detectable at 17.5 h with exercise against 21.1 h without (water-only fast)',
          note: 'Cited through a later review; the primary source was not retrieved. The switch is said to occur typically between 12 and 36 hours after the last food, depending on liver glycogen at the start and on exercise.',
          referenceIds: ['grundler2024', 'anton2018'],
        },
      ],
      timeCourse:
        'Liver glycogen falls near-linearly for about 22 hours, then more slowly. The switch index is centred at about 32 hours.',
      moderators:
        'Liver size, body mass, exercise (which depletes glycogen and advances the switch), low-carbohydrate eating beforehand.',
      grade: 'A',
      gradeReason:
        'Multiple isotope and NMR studies agree on the glycogen and gluconeogenesis timeline; the exact switch threshold is graded C.',
      status: 'proposed-fit',
      caveats:
        'The switch threshold is a proposal. The carbohydrate and ketone topics hold the full versions of these models. Muscle glycogen use during a rest fast (30 g/day for 3 days) is unverified.',
      referenceIds: [
        'rothman1991',
        'roden2001',
        'taylor1996',
        'hwang1995',
        'petersen1996',
        'landau1996',
        'klein1993',
        'owen1969',
        'browning2012',
        'grundler2024',
        'anton2018',
      ],
      relatedMetricIds: [],
    },
    {
      id: '07-fasting-glucose-insulin-lipolysis',
      title: 'Glucose, insulin and fat release during a fast',
      category: 'fuel',
      summary:
        'Insulin falls and fat release rises early in a fast. About 70 % of the fall in insulin between 12 and 72 hours is done by 24 hours, and about 60 % of the rise in fat release. Blood glucose slips only modestly, from about 5 mmol/L to about 3.5 mmol/L by day 4, while free fatty acids climb to about 1.5 mmol/L over days.',
      howModelled:
        "Two of these curves are used directly, running smoothly from 12 hours to weeks with no jump at 72 hours: fasting glucose follows this topic's curve, and basal insulin (relative to the overnight value of 1.00 at 12 hours) follows this topic's fasting decline or the ketosis topic's liver-glycogen factor, whichever is lower. Fat release comes from the ketosis topic's fatty-acid model instead of a curve.",
      equation: `Glucose (mM) = 3.5 + 1.4 / (1 + exp((τ − 48)/12))                (men)
Insulin (relative) = 0.45 + 0.55 · exp(−p(τ − 12)/10)
Glycerol release (µmol/kg/min) = 2.1 · (1 + 1.10 · (1 − exp(−p(τ − 12)/13)))
FFA (mM) = 0.45 + 1.15 · (1 − exp(−p(τ − 12)/50))
p(x) = max(0, x)`,
      keyNumbers: [
        {
          label: 'Six young men, 12 → 72 h',
          value:
            'Glucose 5.58 → 4.14 mM; insulin 64.6 → 30.1 pmol/L; glycerol release 2.08 → 4.36 and palmitate release 1.63 → 3.26 µmol/kg/min',
          note: 'About 60 % of the rise in fat release and 70 % of the fall in insulin were done by 24 h.',
          referenceIds: ['klein1993'],
        },
        {
          label: 'Model insulin, relative to 12 h',
          value: '0.82 at 16 h; 0.62 at 24 h; 0.50 at 36 h; 0.47 at 48 h; 0.45 from 72 h',
          note: 'The 70-%-by-24-h target is matched exactly.',
        },
        {
          label: 'Model and observed glucose',
          value:
            '24 h 4.7 (observed 4.8–5.0); 48 h 4.2 (men 4.05, women 4.4); 72 h 3.7 (observed 3.5–4.1); 96 h 3.5; 120 h 3.5 (observed 3.2); day 10 3.5',
          note: 'Studies at 72–120 h differ by 3.2–4.1 mM, so the fit error is about ±0.4 mM. Day 4 observed 4.9 → 3.5 mM in one study. Day 5: glucose 3.2, FFA 1.55 mM, AcAc 0.51 mM.',
          referenceIds: ['browning2012', 'zauner2000', 'ho1988'],
        },
        {
          label: 'Model FFA and glycerol release',
          value:
            'FFA 0.45 at 12 h, 0.70 at 24 h, 1.04 at 48 h, 1.25 at 72 h, 1.47 at 120 h, 1.60 at 2–3 weeks; glycerol release 2.1 at 12 h, 3.5 at 24 h, 4.3 at 48 h, 4.4 from 72 h',
          note: 'Observed at 24 h: FFA 0.71 (women) and 0.56 (men). In a 10-day modified fast, glucose fell 4.7 → 4.0 mM, insulin −59 % and NEFA rose 2.5-fold. Free fatty acids and ketones plateau only after about 17 days.',
          referenceIds: ['browning2012', 'laurens2021', 'owen1969'],
        },
        {
          label: 'Respiratory exchange ratio (fat versus carbohydrate burning)',
          value: '0.80 at 12 h; 0.76 at 36 h; 0.72 at 72 h',
          referenceIds: ['webber1994'],
        },
      ],
      timeCourse:
        'Most of the insulin fall and rise in fat release happen in the first 24 hours after the 12-hour reference, then flatten over days.',
      moderators: 'Sex (see the sex-differences entry), obesity, and how much is eaten during the fast.',
      grade: 'B',
      gradeReason:
        'Insulin and the direction of glucose are well supported, but the values rest on a handful of small studies; lipolysis rests on six men.',
      status: 'proposed-fit',
      caveats:
        'All curves are proposed fits. Glucose has a spread of 3.2–4.1 mM across studies at 72–120 hours.',
      referenceIds: [
        'klein1993',
        'browning2012',
        'zauner2000',
        'ho1988',
        'laurens2021',
        'owen1969',
        'webber1994',
      ],
      relatedMetricIds: ['glucose'],
    },
    {
      id: '07-fasting-ketone-timeline',
      title: 'Blood ketones from 12 hours to 3 weeks',
      category: 'fuel',
      summary:
        'Blood ketones stay near 0.1–0.2 mmol/L through the first 18 hours of a fast, cross 0.5 mmol/L around 30 hours in this reference curve, reach about 1.8 by 48 hours and about 2.6 by 72 hours. They then creep up to about 4.4 over 2–3 weeks. A daily 16- to 18-hour fast produces only a mild, non-ketotic state.',
      howModelled:
        "Superseded by the extended water-only fasting topic: Vitals does not use this curve. Blood ketones come from the ketosis topic's model, which is checked against the extended-fasting reference curve; this curve sits too low for water-only fasts beyond the first few days.",
      equation: `BHB (mM) = 0.10 + 2.2 / (1 + exp(−(τ − 40)/7)) + 2.5 · (1 − exp(−p(τ − 48)/168))`,
      keyNumbers: [
        {
          label: 'Model BHB by time since the last meal',
          value:
            '12 h 0.1–0.14; 16 h 0.17; 18 h 0.19; 20 h 0.22; 24 h 0.30; 36 h 0.9; 48 h 1.8; 72 h 2.6; 96 h 2.9; 120 h 3.2; 7 d 3.6; 10 d 4.0; 2–3 weeks 4.4–4.6',
          note: 'The 72 h value is interpolated: no direct 72 h mean was retrieved (unverified).',
        },
        {
          label: 'Observed at 24 h and 48 h (9 women and 9 men)',
          value: 'BHB 0.33 (women) and 0.41 (men) at 24 h; 1.22 and 1.94 mM at 48 h',
          note: 'Model: 0.30 at 24 h; 1.8 at 48 h.',
          referenceIds: ['browning2012'],
        },
        {
          label: 'After an 18 h daily fast (early time-restricted eating)',
          value: 'Morning BHB 0.15 mM, only +0.03 above the 12 h value',
          referenceIds: ['jamshed2019'],
        },
        {
          label: 'Longer fasts',
          value:
            'At 52 h, glucose fell 4.9 → 3.5 mM and BHB rose 0.2 → 1.8 mM; free fatty acids, BHB and AcAc plateau only after about 17 days',
          referenceIds: ['boden1996', 'owen1969'],
        },
        {
          label: 'Interpretation for the interface',
          value:
            'BHB crosses 0.5 mM around 30 h and 1 mM around 36–40 h; ketones are detectable at about 21 h (17.5 h with exercise)',
          note: 'The exercise timing is cited through a later cohort report.',
          referenceIds: ['grundler2024'],
        },
        {
          label: 'Low-energy fast days (200–250 kcal/day)',
          value: 'Ketones about 4 mM by day 12',
          referenceIds: ['grundler2024'],
        },
      ],
      timeCourse:
        'A steep rise between about 30 and 48 hours, then a slow climb over 2–3 weeks. Fit error at 24 h is 0.30 versus 0.33–0.41 observed, and at 48 h 1.8 versus 1.2–1.9.',
      moderators: 'Exercise, prior low-carbohydrate eating, sex (results conflict) and fast-day energy.',
      grade: 'B',
      gradeReason:
        'Reasonable agreement with human data to 48 hours (B); beyond 72 hours the curve rests on sparse data (C).',
      status: 'proposed-fit',
      caveats:
        'The 72-hour value is interpolated. The sex difference in the ketone rise is contradictory across studies, so the engine uses no default sex term and an uncertainty of ±40 %. The ketone topic reports a different, earlier timing for the first 0.5 mM, so the two references are not yet aligned.',
      referenceIds: ['browning2012', 'jamshed2019', 'boden1996', 'owen1969', 'grundler2024'],
      relatedMetricIds: [],
    },
    {
      id: '07-fasting-growth-hormone-igf1',
      title: 'Growth hormone and IGF-1 in fasting',
      category: 'hormones',
      summary:
        'Fasting makes the pituitary release growth hormone in bigger and more frequent bursts, roughly three to five times as much overall. IGF-1, a growth signal made mainly by the liver, falls by 40–60 %. The data come almost entirely from men.',
      howModelled:
        "Not run as written. Growth hormone is not modelled. IGF-1 comes from the autophagy topic's model instead: it starts to fall about a day after the last meal with protein or carbohydrate and recovers more slowly after refeeding.",
      equation: `GH multiple = 1 + 3.0 · (1 − exp(−p(τ − 12)/14))
IGF-1 relative = 1 − 0.60 · (1 − exp(−p(τ − 12)/40))`,
      keyNumbers: [
        {
          label: 'Day 1 of fasting',
          value: 'Growth hormone rhythms are enhanced',
          referenceIds: ['ho1988'],
        },
        {
          label: 'Two-day fast in normal men',
          value: 'GH production ×4.8 (78 → 371 µg/L·v/24 h); bursts 14 → 32 per 24 h',
          referenceIds: ['hartman1992'],
        },
        {
          label: 'Five-day fast',
          value: 'Integrated GH ×3.1; pulses 5.8 → 9.9 per 24 h; IGF-1 −41 % (day 1 → 5)',
          referenceIds: ['ho1988'],
        },
        {
          label: '72 h fast in lean men',
          value: 'Total IGF-1 −50 %, free IGF-1 −75 %',
          referenceIds: ['chan2003'],
        },
        {
          label: 'Model growth hormone (multiple of overnight)',
          value: '1.8 at 16 h; 2.7 at 24 h; 3.5 at 36 h; 3.8 at 48 h; 4.0 from 72 h',
          note: 'The plateau is bracketed by the day-2 production rise (×4.8) and the day-5 concentration rise (×3.1). Values beyond day 5 are extrapolated (unverified).',
        },
        {
          label: 'Model IGF-1 (relative)',
          value:
            '0.94 at 16 h; 0.84 at 24 h; 0.73 at 36 h; 0.64 at 48 h; 0.53 at 72 h; 0.47 at 96 h; 0.44 at 120 h; 0.40 at 10 days and after',
        },
      ],
      timeCourse:
        'Growth hormone reaches most of its rise within about 2 days. IGF-1 falls with a time constant of 40 hours.',
      moderators: 'Sex (data almost entirely in men) and fasting duration.',
      grade: 'B',
      gradeReason:
        'Several controlled studies agree, but only in men, and the values beyond day 5 are extrapolated.',
      status: 'proposed-fit',
      caveats:
        'Curves are male-derived, and their use for women is unverified. Beyond 5 days, growth hormone is an extrapolated plateau.',
      referenceIds: ['ho1988', 'hartman1992', 'chan2003'],
      relatedMetricIds: [],
    },
    {
      id: '07-fasting-cortisol-and-noradrenaline',
      title: 'Cortisol and noradrenaline in fasting',
      category: 'hormones',
      summary:
        'Fasting is a mild stress. Cortisol secretion rises by about 60–70 % by day 3 and its daily peak shifts later. Noradrenaline, the alertness and heart-rate hormone, is unchanged at 36 hours and more than doubles by about day 4. These rises help explain the slight rise in resting energy use in the first days.',
      howModelled:
        "Not run as written. Cortisol comes from the hormones topic's model, which responds to the energy deficit, very low carbohydrate and sleep debt, so it rises during a fast; it is shown for context and drives nothing else. Noradrenaline is not tracked; its effect appears only as the small early rise in resting metabolism in the extended-fasting model.",
      equation: `Cortisol (relative) = 1 + 0.70 · (1 − exp(−p(τ − 12)/36))
Noradrenaline (relative) = 1 + 1.2 / (1 + exp(−(τ − 60)/12))`,
      keyNumbers: [
        {
          label: 'Cortisol, 72 h fast in lean men',
          value: '24-hour cortisol 4.84 → 7.84 µg/dL (+62 %)',
          referenceIds: ['chan2003'],
        },
        {
          label: 'Cortisol pattern',
          value:
            'Fasting amplifies the mass of cortisol bursts and delays the daily peak; production ×1.8 by day 5 with the peak moving to early afternoon',
          referenceIds: ['bergendahl1996'],
        },
        {
          label: 'Model cortisol (relative)',
          value:
            '1.07 at 16 h; 1.20 at 24 h; 1.34 at 36 h; 1.44 at 48 h; 1.57 at 72 h; 1.63 at 96 h; 1.67 at 120 h; 1.70 plateau',
          note: 'At 72 h the model gives +57 % against +62 % observed.',
        },
        {
          label: 'Noradrenaline in a 4-day fast (11 lean people)',
          value:
            '1716 → 3728 pmol/L from day 1 to day 4; resting energy 3.97 → 4.53 kJ/min from day 1 to day 3',
          referenceIds: ['zauner2000'],
        },
        {
          label: 'Noradrenaline and adrenaline in a 36 h and 72 h fast',
          value: 'Unchanged at 36 h; up at 72 h',
          referenceIds: ['webber1994'],
        },
        {
          label: 'Model noradrenaline (relative)',
          value:
            '1.03 at 16 h; 1.06 at 24 h; 1.14 at 36 h; 1.32 at 48 h; 1.88 at 72 h; 2.14 at 96 h (observed ×2.17 on day 4); 2.2 plateau',
          note: 'The plateau beyond day 4 is unverified.',
        },
      ],
      timeCourse:
        'Cortisol rises with a 36-hour time constant. Noradrenaline is flat until about 36 hours and then climbs.',
      moderators: 'Sex (data are almost entirely in men) and fasting duration.',
      grade: 'B',
      gradeReason:
        'Several controlled human studies agree, though in men only and with plateaus extrapolated beyond day 4–5.',
      status: 'proposed-fit',
      caveats:
        'Both curves are proposed fits, and the plateaus beyond day 4–5 are unverified. Their use for women is unverified.',
      referenceIds: ['chan2003', 'bergendahl1996', 'zauner2000', 'webber1994'],
      relatedMetricIds: [],
    },
    {
      id: '07-fasting-leptin-thyroid-testosterone',
      title: 'Leptin, thyroid hormone and testosterone in fasting',
      category: 'hormones',
      summary:
        'Leptin, the fat-derived signal of energy stores, falls fast in a fast: to about a tenth of its fed level by 72 hours. The active thyroid hormone T3 falls by about 30 %, and testosterone in men by about 40 %. Leptin comes back within about a day of refeeding and T3 within about 5 days.',
      howModelled:
        "Not run as written. Leptin, T3 and testosterone come from the hormones topic's models, which treat a fast as a full energy deficit with no carbohydrate, so all three fall; each recovers at its own rate after refeeding.",
      equation: `Leptin (relative) = 0.15 + 0.85 · exp(−p(τ − 12)/20)
T3 (relative) = 1 − 0.35 · (1 − exp(−p(τ − 12)/40))
Testosterone (men, relative) = 1 − 0.40 · (1 − exp(−p(τ − 12)/24))`,
      keyNumbers: [
        {
          label: 'Leptin',
          value:
            'Falls steadily from 12 h; nadir in a 36 h fast; about 10 % of fed level after 72 h in lean men',
          note: 'Model: 0.85 at 16 h; 0.62 at 24 h; 0.41 at 36 h; 0.29 at 48 h; 0.19 at 72 h (observed 0.10–0.30); 0.15 plateau. At 52 h the model gives 0.27 against 0.28–0.36 observed. Leptin was still low 3 months after a 10-day fast.',
          referenceIds: ['boden1996', 'kolaczynski1996', 'chan2003', 'laurens2021'],
        },
        {
          label: 'Thyroid hormone',
          value:
            'Total T3 and T4 fall from 12–14 h; T3 −30 % and TSH area −70 % at 72 h; T3 and reverse T3 return to control during 5 days of refeeding',
          note: 'Model T3: 0.91 at 24 h; 0.84 at 36 h; 0.79 at 48 h; 0.73 at 72 h (−27 % against −30 %); 0.65 plateau. T3 stays low and reverse T3 high over 4 weeks.',
          referenceIds: ['spencer1983', 'chan2003', 'vagenakis1975'],
        },
        {
          label: 'Testosterone in men',
          value: '−40 % in a 72 h fast; LH −25 %',
          note: 'Model: 0.84 at 24 h; 0.75 at 36 h; 0.69 at 48 h; 0.63 at 72 h; 0.60 plateau. Six to eight men only. In women, a 3-day fast changed neither LH nor estradiol.',
          referenceIds: ['chan2003', 'olson1995'],
        },
      ],
      timeCourse:
        'Leptin has a 20-hour time constant, T3 40 hours and testosterone 24 hours. Recovery after refeeding is about 24 hours for leptin and about 5 days for T3.',
      moderators:
        'Sex (testosterone applies to men only), fasting duration and energy eaten during the fast.',
      grade: 'B',
      gradeReason:
        'Leptin and T3 are well characterised in several human studies (B); testosterone rests on six to eight men (C).',
      status: 'proposed-fit',
      caveats: 'The curves are proposed fits. The testosterone curve rests on very small samples.',
      referenceIds: [
        'boden1996',
        'kolaczynski1996',
        'chan2003',
        'laurens2021',
        'spencer1983',
        'vagenakis1975',
        'olson1995',
      ],
      relatedMetricIds: [],
    },
    {
      id: '07-fasting-energy-expenditure',
      title: 'Resting energy use during fasting',
      category: 'energy',
      summary:
        'Fasting does not slow metabolism in the first day or two. Resting energy use rises by about 4–6 % at 36–72 hours, then falls by roughly 5–12 % by days 5–10. Short-term studies disagree, from +14 % to −8 % at 3 days. The idea that a one-day fast puts the body in "starvation mode" has no support here.',
      howModelled:
        "Superseded by the extended water-only fasting topic: the engine applies that topic's fasting multiplier to the mass-based resting rate, a small early rise followed by an adaptive decline whose size depends on body fat. The 0.08 and 0.15 shares described here are not used.",
      equation: `REE (relative) = 1 + 0.07 · (p(τ − 12)/36) · exp(1 − p(τ − 12)/36) − A · (1 − exp(−p(τ − 12)/150))
A = 0.15 if the engine does not recompute RMR from fat-free mass; A = 0.08 (adaptive-only) if it does`,
      keyNumbers: [
        {
          label: '36 h and 72 h in 29 adults',
          value:
            'RMR +6 % at 36 h (4.60 → 4.88 kJ/min), heart rate 62.5 → 68.0; +2.6 % (not significant) at 72 h',
          note: 'Noradrenaline and adrenaline were unchanged at 36 h.',
          referenceIds: ['webber1994'],
        },
        {
          label: 'Short-term starvation, 11 lean people',
          value: '+14 % from day 1 to day 3, with noradrenaline ×2.2 by day 4',
          referenceIds: ['zauner2000'],
        },
        {
          label: '3 days in 6 men',
          value: '−8 %',
          referenceIds: ['nair1987'],
        },
        {
          label: '10-day modified fast (200–250 kcal/day)',
          value: 'Basal metabolic rate −12 %, still lower after adjusting for lean soft tissue',
          referenceIds: ['laurens2021'],
        },
        {
          label: '21-day fasts in obese people',
          value:
            'Resting energy per unit of mass stayed constant while fat and fat-free mass fell in parallel',
          referenceIds: ['owen1998'],
        },
        {
          label: 'Model REE, total / adaptive-only',
          value:
            '16 h 1.015 / 1.017; 24 h 1.034 / 1.039; 36 h 1.043 / 1.053; 48 h 1.038 / 1.053; 72 h 1.010 / 1.034; 96 h 0.979 / 1.009; 120 h 0.951 / 0.987; 7 d 0.914 / 0.959; 10 d 0.885 / 0.940; 2 weeks 0.868 / 0.929; 3 weeks 0.856 / 0.923',
        },
      ],
      timeCourse:
        'A small rise peaking at 36–48 hours, then a fall that reaches about −5 to −12 % by days 5–10.',
      moderators: 'Noradrenaline level, fat-free mass loss, and whether the engine already recomputes RMR.',
      grade: 'C',
      gradeReason:
        'Short-term studies conflict (+14 % against −8 % at 3 days), so the model takes a middle path.',
      status: 'proposed-fit',
      caveats:
        'Studies disagree in the first four days, and the model takes a middle path. The adaptive share should be coordinated with the energy-expenditure topic.',
      referenceIds: ['webber1994', 'zauner2000', 'nair1987', 'laurens2021', 'owen1998'],
      relatedMetricIds: [],
    },
    {
      id: '07-fasting-nitrogen-and-protein-loss',
      title: 'Protein loss during a fast, and when protein sparing begins',
      category: 'body',
      summary:
        'When no protein is eaten, the body breaks down some of its own protein for glucose. Loss peaks in days 1–3, at about 12 g of nitrogen a day (about 75 g of protein), and then falls with a time constant of about 6 days as ketones take over. So the first days of a fast are the most muscle-expensive, and repeated short fasts keep paying that cost.',
      howModelled:
        "Superseded by the extended water-only fasting topic: during a water-only or modified fast, protein loss follows that topic's nitrogen curve, which peaks over the first days, scales with lean mass and body fat, eases as ketones rise, and is reduced by carbohydrate or a ketone drink taken during the fast. The rules described here are not used.",
      equation: `Urinary N (g/day) = d ≤ 1 ? min(priorIntakeN, 10 + 2d) : d ≤ 3 ? Npk : Nlate + (Npk − Nlate) · exp(−(d − 3)/6)
d = τ/24;  Npk = 0.20 g N per kg fat-free mass per day (= 12 g at 60 kg);  Nlate = 3.5 g/day
protein oxidised (g/h) = urinary N · 6.25/24;  lean tissue lost (kg/h) = urinary N/33/24
women ×0.8 (magnitude unverified);  modified fast with 25–60 g/day carbohydrate ×0.6 (proposed)`,
      keyNumbers: [
        {
          label: 'Nitrogen loss in total fasts',
          value: 'Peak in days 1–3; up to 14.5 g/day in men; 3.0 g/day in obese women in week 4',
          note: 'Protein supplied about 15 % of energy in normal men after 6 days and about 5 % in obese women in the fourth week. Obese and lean people lose similar absolute nitrogen.',
          referenceIds: ['goschke1975'],
        },
        {
          label: 'Nitrogen per kg of weight lost in long fasts',
          value: 'About 20 g N/kg in non-obese people; about 10 g N/kg when body fat is 50 kg or more',
          note: 'Total body nitrogen falls in two phases: a fast component with a half-life of a few days and a slow one over many months. Lean people therefore lose proportionally more lean mass.',
          referenceIds: ['forbes1979'],
        },
        {
          label: 'Effect of prior protein depletion',
          value: 'Blunted later fasting nitrogen loss by 17 %',
          referenceIds: ['lariviere1990'],
        },
        {
          label: '10-day modified fast (200–250 kcal/day)',
          value: 'Urinary N −41 % by day 5, then stable',
          note: 'The model reproduces it with the ×0.6 modifier.',
          referenceIds: ['laurens2021'],
        },
        {
          label: 'Leucine turnover after 3 days of fasting',
          value: 'Leucine flux +31 %, oxidation +46 %',
          referenceIds: ['nair1987'],
        },
        {
          label: 'Model urinary N, water-only fast (g/day)',
          value:
            'Days 1–3 12.0; day 4 10.7; day 5 9.6; day 6 8.7; day 7 7.9; day 8 7.2; day 9 6.6; day 10 6.1; day 14 4.9; day 21 3.9',
        },
        {
          label: 'Late starvation',
          value:
            'Minimal amino-acid oxidation 0.27 g and fat oxidation 1.53 g per kg body weight per day (0.52 and 2.98 per kg fat-free mass); protein about 7 % of energy',
          referenceIds: ['owen1998'],
        },
      ],
      timeCourse:
        'Peak in days 1–3, then a fall with a time constant of about 6 days towards a floor of 3.5 g/day.',
      moderators:
        'Fat-free mass, sex (women lose less at equal weight, magnitude unverified), obesity, prior protein depletion, and carbohydrate eaten during the fast.',
      grade: 'B',
      gradeReason:
        'Several classic nitrogen studies and one modern trial agree; the day-by-day shape is a fit.',
      status: 'proposed-fit',
      caveats:
        "The women's modifier is unverified. The ×0.6 factor for modified fasts is proposed from a single trial.",
      referenceIds: ['goschke1975', 'forbes1979', 'lariviere1990', 'laurens2021', 'nair1987', 'owen1998'],
      relatedMetricIds: [],
    },
    {
      id: '07-weight-and-composition-during-fasts',
      title: 'What the weight lost in a fast is made of',
      category: 'body',
      summary:
        'Weight lost in a fast is glycogen and its water (days 1–3), extracellular water from fasting natriuresis (days 1–5, reversible), lean tissue (highest in days 1–3) and fat at a steady rate of about 0.2 kg a day. In a 10-day modified fast, only about 40 % of the weight lost was fat. Lean and reversible components together made up most of the rest.',
      howModelled:
        "The engine accounts for energy hour by hour: fat burned is whatever energy need is left after intake, glycogen and protein. Lean tissue lost comes from the extended-fasting model's protein loss. Extracellular water loss comes from the transitions topic's carbohydrate-sensitive water term, which deepens during a fast, rather than from an exponential to 1.6 kg. Glycogen carries 3 g of water per gram.",
      equation: `fat (g/h) = max(0, EE_h − intake_h − 4.0·glycogen_h − 4.0·protein_h) / 9.4
ecwLoss(d) = 1.6 kg · (1 − exp(−d/3)),  scaled by body mass/80 kg
water with glycogen = 3 g per g;  lean tissue = 33 g N per kg`,
      keyNumbers: [
        {
          label: '10-day modified fast, 16 men (BMI 26), 200–250 kcal/day',
          value:
            'Weight −5.9 kg (−7 %): fat 2.3 kg (40 %) and lean soft tissue 3.5 kg (60 %) — extracellular water 1.6 kg (44 %), glycogen plus water 0.5 kg (14 %) and metabolically active tissue 1.5 kg (42 %, about 25 % of the weight lost)',
          note: 'Strength was maintained or improved with about 3 h/day of walking. The muscle-breakdown marker 3-methylhistidine rose until day 5 then fell.',
          referenceIds: ['laurens2021'],
        },
        {
          label: 'Cohort of 1422 fasters (58–65 % women, mean age about 55)',
          value: 'Weight −3.2 kg in 5.4 days and −8.6 kg in 20.1 days; men lost more than women',
          referenceIds: ['wilhelmidetoledo2019'],
        },
        {
          label: 'Nitrogen loss per kg of weight lost',
          value: 'About 20 g N/kg in non-obese people against about 10 g N/kg with 50 kg or more of body fat',
          note: 'Obese and lean people lose similar absolute nitrogen, so lean people lose proportionally more lean mass.',
          referenceIds: ['forbes1979', 'goschke1975'],
        },
        {
          label:
            'Model, water-only fast, 80 kg man: cumulative weight loss (kg), split into fat / lean tissue / glycogen and water / extracellular water',
          value:
            'Day 1 1.3 (0.20 / 0.36 / 0.30 / 0.45); day 3 3.3 (0.62 / 1.08 / 0.59 / 1.01); day 5 4.7 (1.06 / 1.69 / 0.63 / 1.30); day 7 5.8 (1.50 / 2.20 / 0.66 / 1.44); day 10 7.2 (2.15 / 2.80 / 0.70 / 1.54)',
          note: 'Assumes resting metabolism of 1750 kcal/day and activity of 650 kcal/day.',
        },
        {
          label: 'Model, modified fast at 250 kcal/day (nitrogen ×0.6), day 10',
          value: 'Weight 5.90 kg (observed 5.9); fat 1.98 (observed 2.3); lean tissue 1.68 (observed 1.5)',
          note: 'At day 1, 3, 5 and 7: cumulative weight 1.15, 2.83, 3.93 and 4.81 kg.',
          referenceIds: ['laurens2021'],
        },
        {
          label: 'Fasting natriuresis',
          value:
            'The kidneys excrete sodium during fasting, driving the early extracellular water loss (about 1.6 kg by day 10)',
          note: 'The daily volumes were not retrieved, so the 3-day time constant is unverified. It is a proposed fit to the 10-day end-point.',
          referenceIds: ['boulter1973', 'spark1975', 'laurens2021'],
        },
      ],
      timeCourse:
        'Glycogen and its water go in the first 2–3 days, extracellular water over the first week or so, lean tissue fastest in days 1–3, and fat at a steady rate throughout. Water and glycogen return over 3–7 days of carbohydrate refeeding, and lean tissue does not.',
      moderators:
        'Sex (women: scale lean loss by 0.8 at equal body mass, magnitude unverified, and about 20–30 % lower daily loss because of lower RMR), obesity (the fat share of loss is larger), and carbohydrate eaten during the fast.',
      grade: 'B',
      gradeReason:
        'Totals and partition at 10 days rest on one well-characterised trial, a large cohort and classic nitrogen data; the day-by-day split is a proposed accounting (C).',
      status: 'proposed-fit',
      caveats:
        'Part of the "lean" loss measured by DXA on a fast-day protocol is glycogen and water, which depends on the day of measurement. The extracellular water time constant is fitted to a single end-point.',
      referenceIds: [
        'laurens2021',
        'wilhelmidetoledo2019',
        'forbes1979',
        'goschke1975',
        'boulter1973',
        'spark1975',
      ],
      relatedMetricIds: [],
    },
    {
      id: '07-tre-spontaneous-intake',
      title: 'Shorter eating windows and how much people eat',
      category: 'energy',
      summary:
        'When people restrict eating to a window and eat freely inside it, they usually eat less, and the shorter the window, the bigger the drop. Windows of 4–6 hours cut intake by about 30 % in trials of adults with obesity. One large trial of an 8-hour window found no difference in intake. So the effect works through appetite, not through a special metabolic effect of the window.',
      howModelled:
        'Not modelled: Vitals always simulates the intake you enter, so a shorter eating window lowers intake only if you enter less food. The free-eating mode that would apply this S-shaped reduction is not built.',
      equation: `dEI_frac(W) = (W ≥ W0) ? 0 : −Dmax / (1 + exp((W − W50)/s))
W0 = user's habitual window (default 14 h);  Dmax = 0.31, W50 = 9.0 h, s = 1.5 h
→ W = 12 h: −4 %;  10.8 h: −7 %;  10 h: −10 %;  8 h: −20 %;  6 h: −28 %;  4 h: −30 %`,
      keyNumbers: [
        {
          label: '4 h window (15:00–19:00), 8 weeks, obese (n = 16)',
          value:
            'Intake −528 ± 102 kcal/day (−30 %; control −105); weight −3.2 %; fat mass −2.8 kg, lean −0.8 kg',
          referenceIds: ['cienfuegos2020'],
        },
        {
          label: '6 h window (13:00–19:00), 8 weeks, obese (n = 19)',
          value: 'Intake −566 ± 142 kcal/day (−29 %); weight −3.2 %; fat mass −1.4 kg, lean −1.5 kg',
          note: 'More lean loss than the 4 h group.',
          referenceIds: ['cienfuegos2020'],
        },
        {
          label: '4 h window on 4 days a week in young men doing resistance training, 8 weeks',
          value:
            'About −650 kcal on window days; no significant body-composition change; gains from training preserved',
          referenceIds: ['tinsley2017'],
        },
        {
          label: '8 h window (10:00–18:00), 12 weeks, obese (n = 23, against historical data)',
          value: 'Intake −341 ± 53 kcal/day; weight −2.6 %; SBP −7 mmHg',
          referenceIds: ['gabel2018'],
        },
        {
          label: '8 h window (12:00–20:00), 12 months, 90 people with obesity',
          value:
            'Intake −425 (SD 531) kcal/day, calorie-restriction arm −405; weight −4.61 kg against control; no difference from calorie restriction (0.81 kg, CI −3.07 to 4.69)',
          note: 'No fading of the effect was detected over 12 months.',
          referenceIds: ['lin2023'],
        },
        {
          label: '8 h window (12:00–20:00), 12 weeks, 116 people (BMI 27–43) — the null trial',
          value:
            'No difference in estimated intake; weight −0.94 versus −0.68 kg (difference −0.26, CI −1.30 to 0.78)',
          note: 'About 65 % of weight lost was lean in the in-person subset.',
          referenceIds: ['lowe2020'],
        },
        {
          label: '8 h window (08:00–16:00), 2 weeks, 16 lean men',
          value: 'Intake about −400 kcal/day; weight −1.04 kg',
          referenceIds: ['jones2020'],
        },
        {
          label: 'Self-selected window of about 10 h, 12 weeks, 19 people with metabolic syndrome',
          value: 'Window 15.1 → 10.8 h; intake −8.6 % (1991 → 1792 kcal/day); weight −3.3 kg (−3 %)',
          note: 'Single arm.',
          referenceIds: ['wilkinson2020'],
        },
        {
          label: '8 h window (7.5 h achieved), 8 weeks, resistance-trained women',
          value:
            'No difference in intake with protein matched at 1.6 g/kg; fat-free mass +2–3 % in all groups',
          referenceIds: ['tinsley2019'],
        },
        {
          label: 'Usual eating window in free-living adults',
          value: 'Median about 14.75 h',
          referenceIds: ['gill2015'],
        },
      ],
      timeCourse:
        'Onset over about 1–2 weeks (unverified). No attenuation was detected to 12 months in one trial.',
      moderators:
        'Habitual window, body weight, and how much freedom the person has over food. The between-person spread of the response is about ±15 percentage points.',
      grade: 'B',
      gradeReason:
        "Several randomised trials agree, but intake was self-reported, controls varied and one large trial found no difference (graded B− in Vitals' evidence review).",
      status: 'proposed-fit',
      caveats:
        'The S-shaped curve is a proposed fit. Between-person variation is large. It would apply only when the person is eating ad libitum, which Vitals does not simulate.',
      referenceIds: [
        'cienfuegos2020',
        'tinsley2017',
        'gabel2018',
        'lin2023',
        'lowe2020',
        'jones2020',
        'wilkinson2020',
        'tinsley2019',
        'gill2015',
      ],
      relatedMetricIds: [],
    },
    {
      id: '07-tre-at-matched-energy',
      title: 'Eating windows at matched energy: is there any extra benefit?',
      category: 'energy',
      summary:
        'When energy is held equal, restricting eating to a window does not change weight or fat, or 24-hour energy use. A shift towards earlier eating may modestly help insulin and blood pressure, but that rests on very small trials. Lean mass falls more in trials without resistance training or protein control. With resistance training and adequate protein there is no fat-free mass penalty.',
      howModelled:
        'At fixed calories and protein, the engine applies only what follows from meal timing itself: the glucose effect of the clock position of meals and a small hunger effect of the number of meals. The insulin and blood-pressure gains proposed for windows ending by 15:00 (SBP −3, DBP −3 mmHg, fasting insulin −10 %) are not applied, and there is no lean-mass penalty for long daily fasts; the only eating-window warning is for very short windows.',
      keyNumbers: [
        {
          label: 'Weight and fat at matched energy',
          value:
            'TRE plus calorie restriction against calorie restriction alone: −1.8 kg (CI −4.0 to 0.4) at 12 months, not significant',
          note: 'Also not significant: early TRE (10 h) plus daily restriction against restriction alone (−6.2 versus −5.1 kg), TRF plus a 25 % deficit against the deficit alone (no fat-mass or fat-free-mass difference), and TRE against calorie restriction at 12 months. Early TRE (7–15) plus restriction against 12 h or more plus restriction: −2.3 kg (CI −3.7 to −0.9) with fat −1.4 kg not significant, equivalent to about 214 kcal/day of extra restriction.',
          referenceIds: ['liu2022', 'thomas2022', 'stratton2020', 'lin2023', 'jamshed2022'],
        },
        {
          label: '24-hour energy expenditure (early TRF against a later window, 4 days, chamber)',
          value: '+10 ± 16 kcal/day',
          referenceIds: ['ravussin2019'],
        },
        {
          label: 'Fat oxidation',
          value:
            '24-hour non-protein respiratory quotient −0.021 ± 0.010 with early TRF; respiratory exchange ratio 0.83 → 0.81 with 16:8',
          note: 'A shift in which fuel is used, not extra fat loss.',
          referenceIds: ['ravussin2019', 'moro2016'],
        },
        {
          label: 'Lean mass without resistance training or protein control',
          value:
            'In a large trial, appendicular lean mass index −0.16 kg/m² against control (CI −0.27 to −0.05), with about 65 % of weight lost being lean; in another, lean −3.0 % against fat −4 %; with a 6 h window lean −1.5 kg',
          referenceIds: ['lowe2020', 'chow2020', 'cienfuegos2020'],
        },
        {
          label: 'Lean mass with resistance training and adequate protein',
          value:
            'Fat-free mass +2–3 % in all groups at 1.6 g/kg/day; pooled fat-free mass +0.27 kg (CI −0.80 to 1.34) in resistance-trained groups',
          note: 'Fat-free mass was also maintained in other trials, and time-restricted eating with exercise showed no significant fat-free-mass change in a review.',
          referenceIds: ['tinsley2019', 'moro2016', 'moro2020', 'stratton2020', 'ali2026', 'hays2025'],
        },
        {
          label: 'Insulin sensitivity',
          value:
            '8 men with prediabetes, isocaloric early window ending 15:00, 5 weeks: mean insulin −26 ± 9 mU/L, insulinogenic index +14 U/mg. A 9-hour window improved glucose iAUC regardless of early or late clock.',
          note: 'Against weight-matched restriction, whole-body insulin sensitivity and muscle glucose and amino-acid uptake were higher. A network meta-analysis found early against late TRE gave fasting insulin −3.32 µIU/mL, but intake was not matched.',
          referenceIds: ['sutton2018', 'jones2020', 'hutchison2019', 'chen2026'],
        },
        {
          label: 'Blood pressure',
          value:
            'Isocaloric early window: SBP −11 ± 4 and DBP −10 ± 4 mmHg (n = 8); early TRE with restriction: DBP −4 (CI −8 to 0); TREAT: no effect; TRE against usual eating (not energy-matched): SBP −3.07 (CI −5.76 to −0.37)',
          referenceIds: ['sutton2018', 'jamshed2022', 'lowe2020', 'moon2020'],
        },
        {
          label: 'Continuous glucose monitoring (early TRF, 4 days)',
          value: 'Mean 24-hour glucose −4 ± 1 mg/dL; excursions −12 ± 3 mg/dL',
          referenceIds: ['jamshed2019'],
        },
        {
          label: 'Oxidative stress',
          value: '8-isoprostane −11 ± 5 pg/mL (−14 %) at matched energy; −34 to −37 % with weight loss',
          referenceIds: ['sutton2018', 'cienfuegos2020'],
        },
        {
          label: 'Lipids',
          value: 'Morning fasting TG +57 mg/dL after the longer pre-test fast on early TRF',
          note: 'A measurement artefact of fast length. A network meta-analysis found a small LDL increase with TRE against whole-day fasting.',
          referenceIds: ['sutton2018', 'semnaniazad2025'],
        },
        {
          label: 'Hormones in lean, resistance-trained men (8 weeks)',
          value:
            'Testosterone −21 % (21.3 → 16.9 nmol/L), IGF-1 −13 %, T3 −11 %; strength and fat-free mass unchanged',
          note: 'Free testosterone and IGF-1 were also lower in cyclists.',
          referenceIds: ['moro2016', 'moro2020', 'cienfuegos2022'],
        },
        {
          label: 'Appetite (early TRF)',
          value:
            'Evening desire to eat −22 ± 7 mm, capacity to eat −23 ± 6 mm, fullness +31 ± 6 mm; ghrelin −32 ± 10 pg/mL',
          referenceIds: ['sutton2018', 'ravussin2019'],
        },
        {
          label: 'Overall reading of the meta-analyses',
          value:
            'Benefits of time-restricted eating are "primarily due to energy deficit, followed by alignment with eating time of day"; intermittent fasting was no better than regular advice at 6–12 months (percentage weight difference −0.33, CI −0.92 to 0.26)',
          referenceIds: ['chang2024', 'garegnani2026', 'semnaniazad2025', 'elorteguipascual2023'],
        },
      ],
      timeCourse:
        'Trials run from 4 days to 12 months. The equal-energy null for weight is seen at 12 months.',
      moderators:
        'Whether energy is matched, resistance training, protein intake (heterogeneity between trials is probably driven by it), and whether the window ends early in the day.',
      grade: 'A',
      gradeReason:
        'The null effect on weight and fat at matched energy is supported by several randomised trials and meta-analyses; the insulin and blood-pressure gains rest on very small trials (C).',
      status: 'established',
      caveats:
        'The isocaloric blood-pressure and insulin effects rest on n = 8 and n = 16 studies, with larger trials finding weaker or weight-mediated effects, so the research proposes shrinking them to −3/−3 mmHg (grade C); the engine does not apply them. The lean-mass cost of daily 16–20 h fasts in older adults and without resistance training is uncertain.',
      referenceIds: [
        'liu2022',
        'thomas2022',
        'stratton2020',
        'lin2023',
        'jamshed2022',
        'ravussin2019',
        'moro2016',
        'lowe2020',
        'chow2020',
        'cienfuegos2020',
        'tinsley2019',
        'moro2020',
        'ali2026',
        'hays2025',
        'sutton2018',
        'jones2020',
        'hutchison2019',
        'chen2026',
        'moon2020',
        'jamshed2019',
        'semnaniazad2025',
        'cienfuegos2022',
        'chang2024',
        'garegnani2026',
        'elorteguipascual2023',
      ],
      relatedMetricIds: ['glucose'],
    },
    {
      id: '07-clock-time-glucose-tolerance',
      title: 'Glucose after the same meal is higher in the evening',
      category: 'fuel',
      summary:
        'The same meal gives a higher blood glucose in the evening than in the morning, even when behaviour is held constant. In lab studies, glucose after an identical meal was 17 % higher at 20:00 than at 08:00, with a 27 % lower early insulin response. A late dinner close to bedtime made this worse.',
      howModelled:
        'The engine multiplies the glucose excursion from the carbohydrate topic by a factor that rises with clock hour, counted from about an hour after habitual waking. The sleep-overlap factor for meals close to bed and the shift-work factor are not modelled.',
      equation: `m_clock(t) = 1 + 0.0142 · clamp(t − 8, 0, 14)         (08:00 → 1.00, 13:00 → 1.07, 20:00 → 1.17, 22:00 → 1.20)
m_sleep = 1 + 0.15 · overlapFrac        (overlapFrac = share of the 4 h after the meal that overlaps sleep)
m_misalign = 1.06 for a shift worker eating in the biological night, otherwise 1
excursion multiplier = m_clock · m_sleep · m_misalign
check: 22:00 dinner, sleep 23:00: 1.20 × 1.11 = 1.33 against 1.14 for 18:00, ratio 1.17 (observed +18 %)`,
      keyNumbers: [
        {
          label: 'Identical meals at 08:00 and 20:00, with the circadian system separated from behaviour',
          value:
            'Glucose 17 % higher at 20:00, early-phase insulin 27 % lower; circadian misalignment (12 h inverted behaviour) adds +6 %',
          referenceIds: ['morris2015a'],
        },
        {
          label: 'Identical meals at 07:00, 13:00 and 19:00',
          value:
            'Glucose excursion lowest at breakfast; beta-cell responsivity and disposition index highest at breakfast; hepatic insulin extraction lowest at breakfast',
          referenceIds: ['saad2012'],
        },
        {
          label: 'Same meal at 08:00 and 20:00',
          value: 'Evening glucose and insulin responses larger and delayed',
          referenceIds: ['bo2015'],
        },
        {
          label: 'Dinner at 22:00 against 18:00 (sleep 23:00–07:00)',
          value:
            '4-hour glucose area +18 % (522 versus 443 mg/dL·h); peak 150 versus 127 mg/dL; mean 20-hour glucose 105.8 versus 99.8 mg/dL; dietary fat oxidised 74.5 % versus 84.5 % of the tracer dose',
          note: 'Cortisol was higher and sleep architecture unchanged. Effects were larger in habitually earlier sleepers (+6.8 % glucose intolerance per hour earlier bedtime). The fat-oxidation factor of 0.88 for a late meal (grade C) goes to the ketone topic.',
          referenceIds: ['gu2020'],
        },
        {
          label: 'Review of circadian glucose regulation',
          value: 'Glucose regulation follows a circadian and sleep-dependent rhythm',
          referenceIds: ['vancauter1997'],
        },
      ],
      timeCourse: 'The effect is present at each meal; the clock factor rises smoothly across the day.',
      moderators:
        'Clock hour of the meal, closeness to bedtime, chronotype (habitual bedtime), and shift work.',
      grade: 'A',
      gradeReason: 'Direction is seen in at least four controlled laboratory studies; magnitude is graded B.',
      status: 'proposed-fit',
      caveats: 'The linear clock factor is a proposed fit to two studies.',
      referenceIds: ['morris2015a', 'saad2012', 'bo2015', 'gu2020', 'vancauter1997'],
      relatedMetricIds: ['glucose'],
    },
    {
      id: '07-post-fast-insulin-resistance',
      title: 'Insulin sensitivity right after a long fast',
      category: 'fuel',
      summary:
        'After a day or more without food, the first meal meets a temporary resistance to insulin. Glucose and insulin excursions are larger, and the body burns more fat and less carbohydrate. It reverses within hours of a carbohydrate meal. It also explains why morning blood tests after a long overnight fast can look worse, which is not evidence of harm.',
      howModelled:
        "Not modelled as a separate factor. During a fast the carbohydrate topic's glucose-tolerance states drift down with the lack of carbohydrate, so the first carbohydrate meal afterwards gives a larger glucose rise, which settles over the following days as carbohydrate returns.",
      equation: `SI_nextMeal(τ) = 1 − 0.60 · (1 − exp(−p(τ − 12)/6))         (24 h → 0.48, observed 0.46)
recovers with Toff = 12 h after the first carbohydrate meal (proposed, grade D)`,
      keyNumbers: [
        {
          label: 'A 24 h fast (next morning)',
          value:
            'Insulin sensitivity 5.7 → 2.6 ×10⁻⁴ per min per mU/L (−54 %); acute insulin response −22 %; overnight fatty-acid area ×2.8',
          note: 'Lowering fatty acids with acipimox raised the disposition index by 31 %.',
          referenceIds: ['salgin2009'],
        },
        {
          label: '72 h against 13 h fast, then a normal mixed meal',
          value:
            'Larger glucose and insulin excursions; lower carbohydrate oxidation and higher fat oxidation; 12-hour carbohydrate balance +24 versus −57 g',
          referenceIds: ['horton2001'],
        },
        {
          label: 'One meal a day (eaten 16–20 h)',
          value:
            'Higher morning fasting glucose and an impaired morning glucose tolerance test with delayed insulin response, reversible',
          referenceIds: ['carlson2007'],
        },
        {
          label: 'Morning triglycerides on early time-restricted eating',
          value: 'Fasting TG +57 mg/dL after the longer pre-test fast',
          note: 'A measurement-timing artefact that the app should not report as harm.',
          referenceIds: ['sutton2018'],
        },
      ],
      timeCourse:
        'Sensitivity falls with a 6-hour time constant after the 12-hour mark, plateauing near −60 %, and recovers over roughly 12 hours after carbohydrate.',
      moderators: 'Length of the preceding fast and how long ago the last carbohydrate was eaten.',
      grade: 'B',
      gradeReason:
        'The direction is supported by several controlled studies (B); the shape and recovery time are proposals (C, D).',
      status: 'proposed-fit',
      caveats: 'The recovery time constant of 12 hours is a proposal.',
      referenceIds: ['salgin2009', 'horton2001', 'carlson2007', 'sutton2018'],
      relatedMetricIds: [],
    },
    {
      id: '07-thermic-effect-by-clock-time',
      title: 'Does the same meal burn more energy in the morning?',
      category: 'energy',
      summary:
        'The rise in energy use after a meal (the thermic effect of food) is lower for an evening meal than a morning one, in the hours just after eating. But over the whole day, energy expenditure is the same. The morning advantage is displaced, not lost, so the engine only reshapes the hourly pattern.',
      howModelled:
        "Total thermic effect does not depend on clock time: each day's thermic effect is spread over the hours in step with absorbed energy, so later meals simply produce it later. The flatter, longer evening curve and the optional evening reduction described here are not modelled.",
      equation: `TEF_total(meal) = TEF from the energy-expenditure topic, unchanged by clock time
evening or night meal: same area, peak × 0.6, duration × 1.4   (proposed)
optional sensitivity: −0.10 × TEF of meals eaten after 18:00 (≤ about 10 kcal/day)`,
      keyNumbers: [
        {
          label: 'Identical meals at 08:00 and 20:00, early thermic effect (up to 114 minutes)',
          value:
            '44 % lower after the 20:00 meal; 50 % lower in the biological evening; independent of behaviour; misalignment had no effect',
          referenceIds: ['morris2015b'],
        },
        {
          label: 'Morning against afternoon and night (3 h after the meal)',
          value: 'Morning > afternoon > night',
          referenceIds: ['romon1993'],
        },
        {
          label: 'Same meal at 08:00 and 20:00',
          value:
            'Post-meal RMR 1916 versus 1756 kcal/day, a morning excess of 90.5 kcal/day (CI 40.4–140.6) in the rate measured 2–3 h after the meal',
          referenceIds: ['bo2015'],
        },
        {
          label:
            'A study claiming 2.5 times higher thermic effect after breakfast than dinner, and a critique',
          value:
            'Critique: pre-dinner baseline measured only 4.5 h after lunch; measurement lasted 3.5 h (a 4 h measure underestimates the 6 h effect by 10–20 %); the effect after the low-calorie dinner was negative; absolute difference only about 55 versus 30 kcal',
          referenceIds: ['richter2020', 'melanson2020'],
        },
        {
          label: 'Energy displaced, not lost',
          value:
            '2 versus 6 meals gave equal 24-hour energy use (9.96 versus 10.00 MJ) but higher night-time use after the late large meal',
          referenceIds: ['taylor2001'],
        },
        {
          label: 'Whole-day measurements',
          value:
            'Morning- against evening-loaded diets for 4 weeks: total energy use by doubly labelled water 2871 versus 2846 kcal/day (p = 0.18), RMR 1675 versus 1690 kcal/day; early TRF 24-hour energy use +10 ± 16 kcal/day',
          referenceIds: ['ruddickcollins2022', 'ravussin2019'],
        },
      ],
      timeCourse:
        'The thermic effect peaks within the first hours after a meal and lasts at least 6 hours. Evening meals have a flatter, longer curve in the proposed model (not used by Vitals).',
      moderators: "Time of day of the meal and the body's circadian phase.",
      grade: 'B',
      gradeReason:
        'That the acute effect is lower in the evening is graded B; that total daily energy use is unchanged rests on doubly labelled water and chamber studies (A−/B).',
      status: 'established',
      caveats:
        'A study claiming a much larger morning effect is contested on baseline and duration grounds. The net penalty for evening meals is offered only as a sensitivity setting.',
      referenceIds: [
        'morris2015b',
        'romon1993',
        'bo2015',
        'richter2020',
        'melanson2020',
        'taylor2001',
        'ruddickcollins2022',
        'ravussin2019',
      ],
      relatedMetricIds: [],
    },
    {
      id: '07-late-eating-hunger-and-energy',
      title: 'Late meals, hunger and energy use',
      category: 'hormones',
      summary:
        'In a tightly controlled study, delaying meals by about four hours, with the same food, made people hungrier. Waketime leptin fell and energy use dipped by about 59 kcal a day. Another study using doubly labelled water found no difference in total energy use when calories were loaded in the evening. So late eating acts mostly through hunger.',
      howModelled:
        'Neither effect is modelled: the proposed hunger offset (7 points on a 100-point scale for a last meal 4 hours closer to bedtime) is not applied, and late meals change no energy use (the default here was zero, with a sensitivity range of 0 to −60 kcal a day).',
      equation: `lateness L_h = max(0, 4 − lastMealToSleep_h)
Hshift += 7 mm · (L_h/4)     (VAS 0–100; proposed)
EE_late = 0 by default; sensitivity band [−60, 0] kcal/day for a 4 h delay`,
      keyNumbers: [
        {
          label:
            'Meals delayed by 4 h 10 min under strict control of intake, sleep, activity and light (n = 16, BMI 28.7)',
          value:
            'Hunger odds ratio 2.02; strong desire to eat 1.73; desire for starchy foods 2.24; waketime leptin −16 %; 24-hour ghrelin:leptin +12 %; waketime energy use −59.4 ± 13.9 kcal/day (−5.0 %); 24-hour core temperature −0.19 °C',
          note: 'No change in carbohydrate or fat oxidation. Adipose gene expression shifted towards fat storage. The last meal was 2.5 versus 6.7 hours before bed.',
          referenceIds: ['vujovic2022'],
        },
        {
          label: 'Contrast: evening-loaded against morning-loaded intake for 4 weeks',
          value: 'No difference in total energy use by doubly labelled water',
          referenceIds: ['ruddickcollins2022'],
        },
      ],
      timeCourse:
        'Measured across a full day of controlled feeding in the first study and over 4 weeks in the second.',
      moderators: 'How close the last meal is to bedtime.',
      grade: 'B',
      gradeReason:
        'The hunger effect comes from a controlled study (B); the energy effect conflicts with a doubly labelled water study (C).',
      status: 'contested',
      caveats:
        'The −59 kcal/day dip conflicts with the doubly labelled water null, so the default is zero. The hunger mapping of an odds ratio of about 2 to +7 mm on the scale is proposed (grade D to C).',
      referenceIds: ['vujovic2022', 'ruddickcollins2022'],
      relatedMetricIds: [],
    },
    {
      id: '07-morning-vs-evening-loading',
      title: 'Big breakfast or big dinner at equal calories',
      category: 'energy',
      summary:
        'In free-living trials, people who ate more of their calories earlier lost about 1–1.5 kg more over about 3 months. When all food was provided and energy use measured, weight change was identical, and morning loading only made people less hungry. So the benefit appears to work through appetite and adherence.',
      howModelled:
        'Not modelled: Vitals simulates the intake you enter (there is no free-eating mode), and the hunger score has no term for the share of energy eaten early. Moving energy earlier changes only the timing of the glucose and insulin curves.',
      equation: `ad libitum: dEI_frac = −0.05 · clamp((fracEnergyBefore14 − 0.4)/0.3, −1, 1)      (proposed, grade C)
specified intake: no energy effect; Hshift = −5 mm when ≥ 45 % of energy is before 14:00 (magnitude D)`,
      keyNumbers: [
        {
          label:
            '12 weeks, overweight women with metabolic syndrome, about 1400 kcal (700/500/200 versus 200/500/700)',
          value:
            'Weight −8.7 ± 1.4 versus −3.6 ± 1.5 kg; TG −33.6 % versus +14.6 %; lower hunger, glucose and insulin with the big breakfast',
          note: 'Free-living, with self-reported adherence. The weight figures are quoted through a later paper.',
          referenceIds: ['jakubowicz2013', 'shaw2019'],
        },
        {
          label:
            'All food provided at 1.0 × RMR, 2 × 4 weeks crossover, 30 adults (BMI 32.5), 45/35/20 versus 20/35/45',
          value:
            'Weight −3.33 versus −3.38 kg (p = 0.85); no difference in total energy use, RMR or activity; breakfast thermic effect 147 versus 98 kcal; lower hunger and desire to eat with morning loading',
          note: 'Continuous glucose was higher from 20:00 to 24:00 with evening loading.',
          referenceIds: ['ruddickcollins2022'],
        },
        {
          label: 'Observational, 420 adults, 20-week programme',
          value:
            'A late lunch (after 15:00): −7.7 versus −9.9 kg; similar reported intake (1388 versus 1426 kcal/day)',
          referenceIds: ['garaulet2013'],
        },
        {
          label: 'Meta-analysis of 9 trials of energy-reduced diets',
          value: 'Earlier distribution of energy −1.23 kg (CI −2.40 to −0.06)',
          referenceIds: ['young2023'],
        },
        {
          label: 'Meta-analysis of trials of 12 weeks or more',
          value:
            'Earlier calorie distribution −1.75 kg (CI −2.37 to −1.13); TRE −1.37 kg; lower meal frequency −1.85 kg (not energy-matched)',
          referenceIds: ['liu2024'],
        },
        {
          label: 'Network meta-analysis of 41 TRE trials',
          value:
            'Early against late TRE −1.15 kg (CI −1.86 to −0.45); fasting insulin −3.32 µIU/mL; high certainty, intake not matched',
          referenceIds: ['chen2026'],
        },
      ],
      timeCourse: 'Effects appear over about 12 weeks in free-living trials.',
      moderators: 'Whether intake is free or fixed, and the share of energy eaten before 14:00.',
      grade: 'B',
      gradeReason:
        'Free-living trials and meta-analyses agree on about 1–1.5 kg, but a controlled crossover found no metabolic difference, so it acts through appetite.',
      status: 'contested',
      caveats:
        'The −8.7 versus −3.6 kg result was not reproduced when food was provided. The ad libitum coefficient is proposed (grade C) and the hunger magnitude is grade D.',
      referenceIds: [
        'jakubowicz2013',
        'shaw2019',
        'ruddickcollins2022',
        'garaulet2013',
        'young2023',
        'liu2024',
        'chen2026',
      ],
      relatedMetricIds: [],
    },
    {
      id: '07-breakfast-skipping',
      title: 'Skipping breakfast',
      category: 'energy',
      summary:
        'Skipping breakfast does not slow resting metabolism. In trials, eating breakfast added about 260 kcal a day and 0.44 kg over time. In lean adults, more of that energy was offset by more physical activity. Afternoon and evening glucose swings were somewhat larger on the days without breakfast.',
      howModelled:
        'Not modelled as an intake change: Vitals simulates the intake you enter, so skipping breakfast lowers intake only if you enter less food, and there is no drop in non-exercise activity. Skipping a meal changes only the meal-count hunger term and the timing of glucose and insulin. Resting metabolism is unchanged.',
      equation: `ad libitum, skip breakfast: dEI = −260 kcal/day (SD about 300)
lean users, optional: dNEAT = −0.5 · dEI      (obese: 0)
RMR change = 0`,
      keyNumbers: [
        {
          label:
            'Lean adults, 6 weeks, breakfast of 700 kcal or more before 11:00 against nothing until 12:00',
          value:
            'RMR stable within 11 kcal/day; intake +539 kcal/day (CI 157–920) with breakfast; physical-activity energy +442 kcal/day (CI 34–851); no difference in body mass; afternoon and evening glucose variability higher when fasting (CV +3.9 %)',
          referenceIds: ['betts2014'],
        },
        {
          label: 'Obese adults',
          value:
            'Morning activity energy +188 kcal/day (CI 40–335); 24-hour activity energy +272 (CI −254 to 798); intake +338 (CI −313 to 988); RMR within 8 kcal/day; insulin response to a glucose test better with breakfast (p = 0.05)',
          referenceIds: ['chowdhury2016'],
        },
        {
          label: 'Meta-analysis of 13 randomised trials',
          value: 'Breakfast adds +260 kcal/day (CI 79–441) and +0.44 kg (CI 0.07–0.82)',
          referenceIds: ['sievert2019'],
        },
        {
          label: 'Obese women in a whole-room calorimeter',
          value: 'A morning fast did not change 24-hour energy balance',
          referenceIds: ['taylor2001'],
        },
      ],
      timeCourse: 'The trials ran for 6 weeks or more.',
      moderators: 'Leanness (the activity offset was seen in lean adults, not significant in obese adults).',
      grade: 'B',
      gradeReason:
        'A meta-analysis of 13 trials and two controlled trials agree on the intake and weight effect.',
      status: 'established',
      caveats: 'The offset in activity for lean people is proposed from one trial (grade C).',
      referenceIds: ['betts2014', 'chowdhury2016', 'sievert2019', 'taylor2001'],
      relatedMetricIds: [],
    },
    {
      id: '07-meal-frequency',
      title: 'How many meals a day: no effect on energy use',
      category: 'energy',
      summary:
        'At equal calories, the number of meals a day, from 1 to 17, does not change 24-hour energy use, fat burned, or weight loss on a reduced-calorie diet. Hunger is lowest at about three meals. Very small trials of one meal a day found slightly better fat loss but worse blood pressure, LDL and hunger.',
      howModelled:
        'The engine adds no meal-count effect on thermic effect or energy use. It applies only a small hunger offset by number of meals; there is no lipid term for grazing.',
      equation: `Hunger offset (VAS mm): Hshift_meals(n) = +8·(n = 1) + 3·(n = 2) + 0·(n = 3) + 3·(n in 4–6) + 6·(n ≥ 7)
(direction from the trials; magnitudes proposed, grade C/D)`,
      keyNumbers: [
        {
          label: '24-hour energy use and thermic effect',
          value:
            '2 versus 6 meals: 9.96 versus 10.00 MJ/day (p = 0.88); 3 versus 6: 8.7 versus 8.6 MJ/day; 3 versus 14: total 12.3 versus 12.1 MJ/day (p = 0.12), but RMR including thermic effect 8.5 versus 8.0 MJ/day (p = 0.006)',
          note: '3 versus 2 meals also showed no effect on 24-hour energy use. Whole-body calorimetry and doubly labelled water find no difference between nibbling and gorging.',
          referenceIds: ['taylor2001', 'smeets2008', 'ohkawara2013', 'munsters2012', 'bellisle1997'],
        },
        {
          label: 'Fat oxidation',
          value:
            '3 versus 6 meals: 82 versus 80 g/day, respiratory quotient 0.85 in both; 3 versus 14: no difference',
          note: '3 versus 2: 24-hour fat oxidation higher with 3. Protein oxidation was higher with 3 large than 14 small meals.',
          referenceIds: ['ohkawara2013', 'munsters2012', 'smeets2008'],
        },
        {
          label: 'Body composition on a reduced-calorie diet',
          value:
            '3 versus 6 eating occasions, −2931 kJ/day for 8 weeks: no difference in weight, fat, lean mass, appetite, PYY or ghrelin',
          note: 'A meta-analysis of 15 studies found the apparent benefit of more meals vanished when one study was removed.',
          referenceIds: ['cameron2010', 'schoenfeld2015', 'bellisle1997'],
        },
        {
          label:
            'One meal a day against three at equal calories (15 normal-weight adults, 8 weeks, crossover; 17:00–21:00)',
          value:
            'Fat mass −2.1 kg, weight −1.4 kg, fat-free mass not significant; SBP 116.1 versus 109.5 and DBP 69.8 versus 66.0 mmHg; TC 216.5 versus 191.0, LDL 136.2 versus 113.3, HDL 61.9 versus 56.7 mg/dL; morning cortisol 7.2 versus 14.1 µg/dL; intake 2364 versus 2429 kcal/day; hunger higher',
          note: 'Another trial (11 lean people, one meal a day at 17–19 h, 11 days) found weight −1.4 versus −0.5 kg, fat −0.7 versus −0.1 kg, with exercise fat oxidation up and performance unchanged. These small trials probably reflect a residual energy deficit and water.',
          referenceIds: ['stote2007', 'meessen2022'],
        },
        {
          label: 'Hunger and fullness',
          value:
            '1 versus 3 meals: hunger, desire to eat higher; 3 versus 6: hunger and desire-to-eat area about 14 % higher with 6; 3 versus 14: 3 meals raised satiety',
          note: '2 versus 3: 3 meals raised 24-hour satiety. On an energy-restricted diet, 3 versus 6 gave no difference.',
          referenceIds: ['stote2007', 'smeets2008', 'ohkawara2013', 'munsters2012', 'leidy2011'],
        },
        {
          label: 'Glucose and insulin',
          value:
            'Fewer, larger meals give larger excursions but a lower 24-hour glucose area (3 versus 14); one meal a day gave higher fasting glucose and an impaired morning glucose test; 17 snacks against 3 meals for 2 weeks in 7 men: mean insulin −27.9 %, 24-hour C-peptide −20.2 %, glucose unchanged',
          referenceIds: ['munsters2012', 'carlson2007', 'jenkins1989'],
        },
        {
          label: 'Lipids',
          value:
            '17 snacks against 3 meals: TC −8.5 %, LDL −13.5 %, ApoB −15.1 %; 1 against 3 meals: LDL +23 mg/dL',
          referenceIds: ['jenkins1989', 'stote2007'],
        },
      ],
      timeCourse: 'Trials range from 2 weeks to 8 weeks.',
      moderators: 'Calorie matching, protein intake and whether weight is being lost.',
      grade: 'A',
      gradeReason:
        'Multiple controlled trials and meta-analyses agree on the null for energy use and body composition at matched energy.',
      status: 'established',
      caveats:
        'The hunger offsets are proposals. The one-meal-a-day results are small trials in which residual energy deficit is likely (grade C).',
      referenceIds: [
        'taylor2001',
        'smeets2008',
        'ohkawara2013',
        'munsters2012',
        'bellisle1997',
        'cameron2010',
        'schoenfeld2015',
        'stote2007',
        'meessen2022',
        'leidy2011',
        'carlson2007',
        'jenkins1989',
      ],
      relatedMetricIds: ['hunger'],
    },
    {
      id: '07-protein-distribution-across-meals',
      title: 'Spreading protein across meals',
      category: 'body',
      summary:
        'In the hours after a single session, muscle protein synthesis was greater when protein was spread in moderate doses of about 20 g than in very small or very large ones. Over weeks, though, total daily protein, not its pattern, predicts muscle gain. Eating within a window of about 7.5 hours gave the same fat-free mass gain as a window of about 13 hours.',
      howModelled:
        "Per-meal muscle protein synthesis appears in the protein topic's display. For lean mass, the engine applies the protein topic's daily distribution factor to training-driven muscle gain only: spreading protein unevenly across the day trims that gain a little, and it has no effect on lean loss in a deficit.",
      keyNumbers: [
        {
          label: '80 g of whey over 12 h after resistance exercise',
          value: '4 × 20 g gave 31–48 % greater myofibrillar protein synthesis than 8 × 10 g or 2 × 40 g',
          referenceIds: ['areta2013'],
        },
        {
          label: '24-hour muscle protein synthesis',
          value: '+25 % with an even distribution (30/30/33 g) compared with a skewed one (11/16/63 g)',
          referenceIds: ['mamerow2014'],
        },
        {
          label: 'Whole-body net protein balance in older adults',
          value: 'Depended on the quantity of protein, not the pattern',
          referenceIds: ['kim2015'],
        },
        {
          label: 'Protein retention in elderly women',
          value: 'Pulse feeding (80 % of protein at noon) retained more nitrogen than a spread pattern',
          referenceIds: ['arnal1999'],
        },
        {
          label: 'A single 100 g dose against 25 g',
          value:
            'A larger anabolic response lasting more than 12 hours; no upper limit in magnitude or duration was found',
          referenceIds: ['trommelen2023'],
        },
        {
          label: 'Chronic effect on lean mass',
          value:
            'The timing effect vanishes when total protein is matched; total intake was the strongest predictor. A window of about 7.5 h against about 13 h at 1.6 g/kg/day gave equal fat-free mass gain and muscle growth',
          referenceIds: ['schoenfeld2013', 'tinsley2019'],
        },
      ],
      timeCourse: 'Acute effects last from hours to more than 12 hours; chronic effects show over weeks.',
      moderators: 'Total protein, per-meal dose, age, and presence of resistance training.',
      grade: 'B',
      gradeReason:
        'Acute differences are supported by controlled studies and the chronic null by a meta-analysis and a trial.',
      status: 'established',
      caveats:
        'Acute synthesis differences do not translate into a chronic penalty when total protein is matched.',
      referenceIds: [
        'areta2013',
        'mamerow2014',
        'kim2015',
        'arnal1999',
        'trommelen2023',
        'schoenfeld2013',
        'tinsley2019',
      ],
      relatedMetricIds: [],
    },
    {
      id: '07-alternate-day-and-5-2-fasting',
      title: 'Alternate-day fasting and 5:2 against steady restriction',
      category: 'body',
      summary:
        'At the same energy deficit, alternating fast days with normal days gives about the same weight loss as eating a little less every day. The small edge seen in short trials is consistent with a larger achieved deficit. In lean adults, alternate 24-hour fasts lost about half of the weight as non-fat tissue. In people with obesity, the split was similar to steady restriction or better.',
      howModelled:
        'Weight and fat follow the daily energy balance, with no fasting bonus. The extended-fasting model charges extra protein loss during each fast of 24 hours or longer and restores part of it on refeeding. Together they reproduce the lean-versus-obese difference in fat share.',
      keyNumbers: [
        {
          label: '22 days of 36 h fasts on alternate days, 16 non-obese adults',
          value:
            'Weight −2.5 ± 0.5 %; fat mass −4 ± 1 %; fasting insulin −57 %; RMR and respiratory quotient unchanged at day 21',
          note: 'Hunger rose on fast days and did not habituate. At the end of a 36 h fast the respiratory quotient fell (at least 15 g/day more fat oxidised).',
          referenceIds: ['heilbronn2005a'],
        },
        {
          label: 'Meal test after a 36 h fast in the same people',
          value:
            'Glucose response slightly impaired in women (p < 0.01); in men unchanged glucose and lower insulin response',
          referenceIds: ['heilbronn2005b'],
        },
        {
          label:
            'Lean adults, 3 weeks: 24 h fast then 150 % (0:150), steady 75:75, and 0:200 (fasting without a deficit)',
          value:
            'Body mass −1.60 versus −1.91 kg (p = 0.46); fat −0.74 ± 1.32 versus −1.75 ± 0.79 kg (p = 0.01); 0:200 gave −0.52 kg mass and −0.12 kg fat',
          note: 'Fat was 46 % of the loss with alternate fasting against 92 % with steady restriction. There was no fasting-specific effect on postprandial metabolism, gut hormones or adipose genes.',
          referenceIds: ['templeman2021'],
        },
        {
          label:
            'Zero-calorie alternate-day fasting against −400 kcal/day, obese, 8 weeks plus 24 weeks of follow-up',
          value: 'Alternate-day deficit 376 kcal/day larger; weight −8.2 versus −7.1 kg (not significant)',
          note: 'No difference in body composition at 8 weeks; lean and fat changes were more favourable with fasting at the 24-week follow-up.',
          referenceIds: ['catenacci2016'],
        },
        {
          label: '12 months, 100 obese adults, alternate-day 25 % / 125 % against steady 75 %',
          value:
            'Weight −6.8 % versus −6.8 % (6 months); −6.0 versus −5.3 % (12 months); dropout 38 % versus 29 %; LDL +11.5 mg/dL (CI 1.9–21.1) against steady restriction at 12 months',
          note: 'The alternate-day group ate more than prescribed on fast days and less on feast days.',
          referenceIds: ['trepanowski2017'],
        },
        {
          label:
            '107 premenopausal overweight women, 2 days a week (about 2710 kJ) against steady (about 6276 kJ/day), 6 months',
          value:
            'Weight −6.4 versus −5.6 kg (p = 0.4); fasting insulin −1.2 µU/mL and HOMA −1.2 more with intermittent restriction',
          referenceIds: ['harvie2011'],
        },
        {
          label:
            '115 women, 2 days a week with under 40 g carbohydrate against a 25 % daily deficit, 3 months',
          value:
            'Body fat −3.7 versus −2.0 kg; HOMA-IR fell more with intermittent energy and carbohydrate restriction',
          referenceIds: ['harvie2013'],
        },
        {
          label: 'Strict alternate-day fasting in healthy non-obese adults, 4 weeks',
          value:
            'Spontaneous 37 % calorie reduction; trunk fat down; BHB up even on non-fasting days; LDL, sICAM-1 and T3 lower',
          referenceIds: ['stekovic2019'],
        },
        {
          label: 'Meta-analyses of intermittent against continuous restriction',
          value:
            '11 trials (8–24 weeks): weight −0.61 kg (CI −1.70 to 0.47), fasting insulin −0.89 µU/mL (CI −1.56 to −0.22). 24 trials: +0.26 kg (CI −0.31 to 0.84). 10 trials in obese adults: weight −0.94 kg, fat −1.08 kg short term, lean mass similar, fasting insulin −7.46 pmol/L',
          referenceIds: ['cioffi2018', 'elorteguipascual2023', 'silesguerrero2024'],
        },
        {
          label: 'Network meta-analysis of 99 trials (6582 adults)',
          value:
            'Alternate-day fasting against steady restriction −1.29 kg (CI −1.99 to −0.59, moderate certainty, mostly under 24 weeks); against TRE −1.69 kg; against whole-day fasting −1.05 kg; no differences at 24 weeks or more',
          note: 'It also found alternate-day fasting lowered TC, TG and non-HDL cholesterol against TRE.',
          referenceIds: ['semnaniazad2025'],
        },
        {
          label: 'Fat-free mass in matched comparisons',
          value:
            'Alternate-day fasting against very-low-calorie diet: weight −4.30 versus −6.28 kg, fat −4.06 versus −4.22 kg, fat-free mass −0.72 versus −2.24 kg (about 17 % versus 36 % of the loss). A review found similar weight and fat loss with less fat-free mass lost on intermittent restriction',
          referenceIds: ['alhamdan2016', 'varady2011'],
        },
      ],
      timeCourse:
        'Trials range from 3 weeks to 12 months; differences seen in short trials disappear at 24 weeks or more.',
      moderators:
        'Leanness (lean people lose more of the weight as lean tissue), achieved deficit, and sex (see the sex-differences entry).',
      grade: 'A',
      gradeReason:
        'Multiple meta-analyses agree that weight loss equals energy balance; the lean-versus-obese split is graded B/C.',
      status: 'established',
      caveats:
        'Part of the DXA "lean" loss on a fast-day protocol is glycogen and water, which depends on the day of measurement. The adherence penalty (dropout of 38 % versus 29 %) is a planner cost, not a physiological effect.',
      referenceIds: [
        'heilbronn2005a',
        'heilbronn2005b',
        'templeman2021',
        'catenacci2016',
        'trepanowski2017',
        'harvie2011',
        'harvie2013',
        'stekovic2019',
        'cioffi2018',
        'elorteguipascual2023',
        'silesguerrero2024',
        'semnaniazad2025',
        'alhamdan2016',
        'varady2011',
      ],
      relatedMetricIds: [],
    },
    {
      id: '07-hunger-on-fast-days-and-compensation',
      title: 'Hunger on fast days and eating afterwards',
      category: 'hormones',
      summary:
        'Hunger rises on fast days and does not fade over three weeks. After a 36-hour fast, people ate about 17 % of the missing energy back the next day. In a year-long study of alternate-day fasting, people ate more than prescribed on fast days and less on feast days. In supervised modified fasts, most people reported no hunger.',
      howModelled:
        'Vitals simulates the intake you enter, so there is no automatic extra eating the next day (the research suggests 15 % of maintenance, range 0–20 %) and no fast-day overshoot. A fasting hunger factor rises in a hump-shaped curve, peaking near 30 hours, about +5 mm by day 3 and about zero by day 5, on top of the usual hunger drives.',
      equation: `feedDayEI = maintenance · (1 + 0.15)   after a fast of 24 h or more (proposed; range 0–0.2)
Hfast(τ) = +15 mm · (x · exp(1 − x)),   x = p(τ − 12)/18     (peaks about 30 h, +5 mm by day 3, about 0 by day 5)
fast-day slippage: 25 % of maintenance prescribed → about 35 % achieved (magnitude unverified, direction from the 12-month trial)`,
      keyNumbers: [
        {
          label: '46 women, alternate-day 25 % against steady 75 % until 5 % weight loss',
          value:
            'Both lost 4.7 kg; feed-day intake was not above baseline; fast-day hunger +15 mm (CI 10–21) against feed days; light activity −18 min/day on fast days',
          referenceIds: ['beaulieu2021'],
        },
        {
          label: 'Lean adults after a 36 h fast (about 12 MJ deficit)',
          value: 'Next-day free intake 12.2 versus 10.2 MJ (+2.0 MJ, about 17 % of the deficit)',
          referenceIds: ['johnstone2002'],
        },
        {
          label: 'Alternate-day fasting for 22 days',
          value: 'Hunger rose on fast days and did not habituate',
          referenceIds: ['heilbronn2005a'],
        },
        {
          label: '12-month trial of alternate-day fasting',
          value:
            'Fast-day intake overshot and feast-day intake undershot the prescription; dropout 38 % against 29 % for steady restriction',
          referenceIds: ['trepanowski2017'],
        },
        {
          label: 'Ghrelin during a 24 h fast',
          value:
            'Keeps pulsing at habitual meal times, about 8 pulses per 24 h, with a slight overall decline',
          note: 'So hunger follows the usual meal clock.',
          referenceIds: ['natalucci2005'],
        },
        {
          label: 'Supervised modified fasts of 4–21 days',
          value: '93.2 % reported no hunger; mild symptoms clustered in the first days',
          referenceIds: ['wilhelmidetoledo2019'],
        },
      ],
      timeCourse:
        'Hunger peaks around 30 hours, falls to about +5 mm by day 3 and near zero by day 5. Fast-day hunger did not habituate over 22 days of alternate-day fasting.',
      moderators:
        'Whether the fast is water-only or low-energy, how long it is, and the habitual meal clock.',
      grade: 'C',
      gradeReason:
        'The compensation and hunger data come from a few small trials, and the curve for the hunger offset is proposed.',
      status: 'proposed-fit',
      caveats: 'The 15 % compensation and the fast-day slippage are proposals. The hunger curve is grade C.',
      referenceIds: [
        'beaulieu2021',
        'johnstone2002',
        'heilbronn2005a',
        'trepanowski2017',
        'natalucci2005',
        'wilhelmidetoledo2019',
      ],
      relatedMetricIds: [],
    },
    {
      id: '07-extended-fast-blood-pressure-and-labs',
      title: 'Blood pressure and lab changes in supervised 4–21-day fasts',
      category: 'cardio',
      summary:
        'In a clinic cohort of 1422 people fasting for 4–21 days on a modified fast, blood pressure fell by about 11/6 mmHg and uric acid rose by 46 %. Blood sodium dipped slightly, and a few people had mild low sodium. Serious problems were under 1 %.',
      howModelled:
        "These cohort changes are checks for the engine rather than inputs. Uric acid rises with ketone level, and blood pressure falls with lower sodium intake and weight loss, through the cardiometabolic-markers topic's models.",
      keyNumbers: [
        {
          label: 'Blood pressure',
          value: 'SBP 131.6 → 120.7 mmHg; DBP 83.7 → 77.9 mmHg',
          referenceIds: ['wilhelmidetoledo2019'],
        },
        {
          label: 'Blood chemistry',
          value:
            'Uric acid 338 → 495 µmol/L (+46 %); urea 4.7 → 3.1 mmol/L; sodium 140.1 → 138.7 mmol/L; potassium unchanged (4.4); glucose to the low-normal range; ketones up',
          note: 'Six cases of mild low sodium (hyponatraemia), lowest 127 mmol/L.',
          referenceIds: ['wilhelmidetoledo2019'],
        },
        {
          label: 'Symptoms and adverse events',
          value:
            '93.2 % reported no hunger; most frequent mild symptom sleep disturbance 14.9 %; adverse events under 1 % (arrhythmia 0.21 %, hyponatraemia 0.21 %, hypoglycaemia 0.14 %, hospitalisation 0.14 %); one gout attack in a known gout patient',
          referenceIds: ['wilhelmidetoledo2019'],
        },
        {
          label: 'Who had more ketones',
          value:
            'Higher ketonuria in men, younger and heavier people, and it was linked to a larger uric-acid rise',
          referenceIds: ['grundler2024'],
        },
        {
          label: 'Early time-restricted feeding side effects',
          value: 'Dizziness, nausea and headache in weeks 1–2 of 4–6 h windows',
          referenceIds: ['cienfuegos2020'],
        },
      ],
      timeCourse: 'Measured over 4–21 days of supervised fasting on 200–250 kcal a day.',
      moderators: 'Sex, age, body weight and ketosis depth; medication use (antihypertensives or diuretics).',
      grade: 'B',
      gradeReason:
        'A large observational cohort and mechanistic data; for water-only fasts over 7 days in non-obese people the data are weak (C).',
      status: 'established',
      caveats:
        'Observational data from a clinic setting with supervision and a small daily energy intake, not water-only fasting.',
      referenceIds: ['wilhelmidetoledo2019', 'grundler2024', 'cienfuegos2020'],
      relatedMetricIds: [],
    },
    {
      id: '07-extended-fast-muscle-function',
      title: 'Muscle function and muscle protein during a multi-day fast',
      category: 'body',
      summary:
        'In a 10-day modified fast with about 3 hours of walking a day, strength was maintained or improved, but lean soft tissue was still 2.3–3.2 % lower after three months. In a 72-hour fast, muscle released more of the amino acid phenylalanine, and the growth-signalling pathway mTOR was about half as active.',
      howModelled:
        'The engine takes lean tissue lost from the extended-fasting model. There is no fasting-specific strength term; strength falls only through the general low-energy-availability effect from the performance topic, mainly in lean people.',
      keyNumbers: [
        {
          label: '10-day modified fast with about 3 h/day of walking',
          value:
            'Strength maintained (non-weight-bearing) or +33 % (weight-bearing); 3-methylhistidine peaked on day 5; lean soft tissue still −2.3 to −3.2 % at 3 months',
          referenceIds: ['laurens2021'],
        },
        {
          label: '72 h fast, muscle biopsies',
          value: 'Muscle net phenylalanine release up; mTOR phosphorylation about −50 %; LC3B-II +30 %',
          note: 'LC3B-II is a marker of the cell recycling process called autophagy.',
          referenceIds: ['vendelbo2014'],
        },
        {
          label: 'Leucine turnover after 3 days',
          value: 'Leucine flux +31 %; oxidation +46 %',
          referenceIds: ['nair1987'],
        },
      ],
      timeCourse:
        'Muscle breakdown markers peak around day 5 in the modified fast; lean tissue remains lower at 3 months.',
      moderators:
        'Walking or other activity during the fast, weight-bearing versus non-weight-bearing muscles, and the energy taken.',
      grade: 'B',
      gradeReason:
        'A mechanistic trial and controlled studies agree for 5–10-day modified fasting; water-only fasts beyond 7 days in non-obese people are graded C.',
      status: 'established',
      caveats: 'The trial studied 16 men on a modified fast with some energy intake.',
      referenceIds: ['laurens2021', 'vendelbo2014', 'nair1987'],
      relatedMetricIds: [],
    },
    {
      id: '07-fasting-natriuresis-and-electrolytes',
      title: 'Sodium, water and minerals during a fast',
      category: 'body',
      summary:
        'Fasting makes the kidneys excrete more sodium and water, linked to falling insulin and to hormones such as renin, aldosterone and glucagon. This drives the early loss of extracellular water. Blood magnesium falls in week-long modified fasts. In very long starvation, control of body salts can break down.',
      howModelled:
        "Extracellular water loss comes from the transitions topic's carbohydrate-sensitive water term, which deepens during a fast, rather than from an exponential to 1.6 kg over 10 days. The water and mineral shifts are reversible over 3–7 days of carbohydrate refeeding.",
      keyNumbers: [
        {
          label: 'Sodium excretion in starvation',
          value: 'Fasting natriuresis linked to renin, aldosterone and glucagon',
          referenceIds: ['boulter1973', 'spark1975'],
        },
        {
          label: 'Extracellular water loss in a 10-day modified fast',
          value: 'About 1.6 kg by day 10',
          referenceIds: ['laurens2021'],
        },
        {
          label: 'Magnesium',
          value: 'Serum magnesium falls in 1-week modified fasts',
          referenceIds: ['michalsen2003'],
        },
        {
          label: '60-day therapeutic starvation in 18 obese patients',
          value:
            'Judged in general safe but with significant hazards, particularly a breakdown in electrolyte homeostasis',
          referenceIds: ['runcie1970'],
        },
        {
          label: 'Supervised 4–21 day modified fasts',
          value:
            'Sodium 140.1 → 138.7 mmol/L; six cases of mild hyponatraemia (lowest 127 mmol/L); potassium unchanged at 4.4',
          referenceIds: ['wilhelmidetoledo2019'],
        },
      ],
      timeCourse:
        'Extracellular water is lost mostly in the first days and returns over 3–7 days of refeeding.',
      moderators: 'Insulin level, salt intake and supplementation during the fast, and carbohydrate eaten.',
      grade: 'C',
      gradeReason:
        'Day-by-day volumes were not retrieved and the main data are older studies and one clinic cohort.',
      status: 'established',
      caveats:
        'The natriuresis time constant is unverified. The effect of electrolyte supplements has an unverified magnitude.',
      referenceIds: [
        'boulter1973',
        'spark1975',
        'laurens2021',
        'michalsen2003',
        'runcie1970',
        'wilhelmidetoledo2019',
      ],
      relatedMetricIds: ['ecfShift', 'scaleWeight'],
    },
    {
      id: '07-refeeding-after-long-fasts',
      title: 'Refeeding after a long fast',
      category: 'recovery',
      summary:
        'Restarting food after a long fast can bring dangerous shifts in phosphate, potassium and magnesium. UK national guidance lists who is at high risk and how slowly to restart. Meanwhile, ordinary refeeding after a 72-hour fast brings bigger glucose and insulin swings, and leptin and thyroid hormone recover within about 1 and 5 days.',
      howModelled:
        "After a fast of more than 3 days, the simulator warns that food should be restarted gradually; it does not check the guideline's individual high-risk criteria. Water and glycogen return over 3–7 days of carbohydrate refeeding. With enough energy and protein, the extended-fasting model also rebuilds a labile protein pool, so part of the lean tissue lost early in a fast returns; fat lost does not.",
      keyNumbers: [
        {
          label: 'High-risk criteria in the NICE guideline (any one of)',
          value:
            'BMI under 16; unintentional weight loss over 15 % in 3–6 months; little or no intake for over 10 days; low potassium, phosphate or magnesium before feeding',
          referenceIds: ['nice2006'],
        },
        {
          label: 'High-risk criteria (any two of)',
          value:
            'BMI under 18.5; weight loss over 10 %; little or no intake for over 5 days; a history of alcohol or drugs (insulin, chemotherapy, antacids, diuretics)',
          referenceIds: ['nice2006'],
        },
        {
          label: 'Restart plan in the NICE guidance for high-risk people',
          value:
            'Start at 10 kcal/kg/day or less (5 kcal/kg/day if BMI is under 14 or intake was negligible for over 15 days), rising to full needs over 4–7 days, with thiamine 200–300 mg/day and B-vitamins for the first 10 days',
          note: 'A consensus statement from a US society also exists.',
          referenceIds: ['nice2006', 'dasilva2020'],
        },
        {
          label: 'A normal meal after a 72 h fast',
          value:
            'Larger glucose and insulin excursions; carbohydrate balance over 12 hours +24 g (glycogen refill)',
          referenceIds: ['horton2001'],
        },
        {
          label: 'Hormone recovery',
          value: 'Leptin recovers within about 24 h; T3 and reverse T3 within about 5 days',
          referenceIds: ['kolaczynski1996', 'vagenakis1975'],
        },
      ],
      timeCourse: 'Leptin recovers in about a day, T3 in about 5 days, water and glycogen in 3–7 days.',
      moderators: 'BMI, recent weight loss, length of fast, alcohol or drug history, and medication use.',
      grade: 'B',
      gradeReason:
        "Vitals' evidence review grades the refeeding-risk flag A because it rests on national guidance; those criteria are consensus recommendations rather than trial results.",
      status: 'established',
      caveats:
        'Guidance-based criteria may not match every individual. The engine warns and does not decide medical care.',
      referenceIds: ['nice2006', 'dasilva2020', 'horton2001', 'kolaczynski1996', 'vagenakis1975'],
      relatedMetricIds: [],
    },
    {
      id: '07-late-starvation-fuel-mix',
      title: 'Fuel use after weeks without food',
      category: 'fuel',
      summary:
        'After weeks of starvation, the body leans on stored fat and ketones. Protein supplies only about 5–7 % of energy. The brain uses ketones as its main fuel after 5–6 weeks, and the liver and kidney each make about half of the roughly 86 g of glucose produced daily. Most data come from obese people studied in the 1960s and 70s.',
      howModelled:
        'These are targets for the long-fast tail, now run by the extended water-only fasting model. Its nitrogen and ketone curves reach their floors and plateaus by about 2–3 weeks.',
      keyNumbers: [
        {
          label: 'Minimal fuel use in late starvation',
          value:
            'Amino-acid oxidation 0.27 g and fat oxidation 1.53 g per kg body weight per day (0.52 and 2.98 g per kg fat-free mass); amino acids about 7 % of energy',
          referenceIds: ['owen1998'],
        },
        {
          label: 'Nitrogen loss and protein share of energy',
          value:
            'Urinary nitrogen from 14.5 g/day (men, early) to 3.0 g/day (obese women, week 4); protein about 15 % of energy in normal men after 6 days and about 5 % in obese women in the fourth week',
          referenceIds: ['goschke1975'],
        },
        {
          label: 'Brain fuel',
          value: 'The brain switches predominantly to β-hydroxybutyrate and acetoacetate after 5–6 weeks',
          referenceIds: ['owen1967'],
        },
        {
          label: 'Glucose production and plateaus',
          value:
            'About 86 g/day at 5–6 weeks, liver and kidney about half each; free fatty acids and ketones plateau only after about 17 days',
          referenceIds: ['owen1969'],
        },
        {
          label: 'Classic overview',
          value:
            'Fuel hierarchy, ketone-driven protein sparing and brain ketone use are reviewed in a classic paper; the quantitative anchors used here are the primary data',
          referenceIds: ['cahill2006'],
        },
      ],
      timeCourse:
        'Ketones and free fatty acids plateau after about 17 days; the brain shifts to ketones over 5–6 weeks.',
      moderators: 'Obesity (obese people lose less protein per kg), fast length and sex.',
      grade: 'C',
      gradeReason:
        'Water-only fasts beyond 7 days in non-obese people are mostly historical data from obese cohorts.',
      status: 'established',
      caveats:
        'Modern controlled data for water-only fasting beyond 7 days in normal-weight people are lacking.',
      referenceIds: ['owen1998', 'goschke1975', 'owen1967', 'owen1969', 'cahill2006'],
      relatedMetricIds: [],
    },
    {
      id: '07-fasted-vs-fed-aerobic-exercise',
      title: 'Aerobic exercise fasted or fed',
      category: 'performance',
      summary:
        'Exercising after an overnight fast burns a little more fat during the session, about 3 g more. It makes no difference to body fat or weight over weeks when calories are matched. So the engine changes only the fuel mix during the session.',
      howModelled:
        "Fasting state shifts substrate use in the session, through the carbohydrate and ketosis topics' models. There is no chronic fat-mass term.",
      keyNumbers: [
        {
          label: 'Meta-analysis of aerobic exercise fasted against fed',
          value:
            'Fat oxidised +3.08 g per session (CI 0.79–5.38) more when fasted; the fed state had higher glucose (+0.78 mmol/L) and insulin (+104.5 pmol/L)',
          referenceIds: ['vieira2016'],
        },
        {
          label: '4 weeks of 1 h cardio, 3 times a week, in women on a reduced-calorie diet',
          value: 'Fasted and fed gave equal weight and fat loss',
          referenceIds: ['schoenfeld2014'],
        },
      ],
      timeCourse: 'The difference applies within the session; no chronic difference over 4 weeks.',
      moderators: 'Time since last meal, intensity and duration.',
      grade: 'B',
      gradeReason: 'A meta-analysis and a controlled trial agree.',
      status: 'established',
      caveats: 'The trial was in women on a reduced-calorie diet over 4 weeks.',
      referenceIds: ['vieira2016', 'schoenfeld2014'],
      relatedMetricIds: ['fatOxidation'],
    },
    {
      id: '07-resistance-training-with-tre',
      title: 'Strength training inside or outside an eating window',
      category: 'performance',
      summary:
        'With protein matched, people who lift weights gain or keep the same fat-free mass whether they eat inside a window of about 8 hours or over a longer day. Protein timing around the session does not matter once total protein is matched. A 12-month study combining time-restricted eating and lifting found lower body mass and fat, but also lower IGF-1 and testosterone.',
      howModelled:
        "The exercise-sensitised muscle-building window lasts at least 24 hours, so any protein-containing meal in that window counts. The engine's muscle gain uses average daily protein over the week, so meal timing around a session does not change it, and no flag is raised for a long gap without protein after training.",
      keyNumbers: [
        {
          label: 'Equal fat-free-mass gains or maintenance',
          value:
            '8 h windows with protein matched at 1.6 g/kg/day; isocaloric 16:8 with training inside the window; a 25 % deficit with 1.8 g/kg/day protein',
          referenceIds: ['tinsley2019', 'moro2016', 'stratton2020'],
        },
        {
          label: 'Meta-analysis in resistance-training populations',
          value: 'Fat-free mass +0.27 kg (CI −0.80 to 1.34); fat mass −1.25 kg (CI −1.95 to −0.54)',
          referenceIds: ['ali2026'],
        },
        {
          label: '12 months of TRE plus resistance training against a normal diet',
          value: 'Lower body mass, fat mass, IGF-1 and testosterone, with spontaneous intake reduction',
          referenceIds: ['moro2021'],
        },
        {
          label: 'Protein timing around the session',
          value: 'Does not matter once total protein is matched',
          referenceIds: ['schoenfeld2013'],
        },
      ],
      timeCourse:
        'The sensitised muscle-building window lasts 24 hours or more; trials run 4 weeks to 12 months.',
      moderators:
        'Total daily protein, energy deficit and the length of the fasting period after the session.',
      grade: 'B',
      gradeReason: 'Several controlled trials and a meta-analysis agree.',
      status: 'established',
      caveats: 'The flag for 16 or more hours without protein after a session is a proposal (grade D).',
      referenceIds: ['tinsley2019', 'moro2016', 'stratton2020', 'ali2026', 'moro2021', 'schoenfeld2013'],
      relatedMetricIds: [],
    },
    {
      id: '07-metabolic-switch-claims',
      title: 'The "metabolic switch": what is substantiated in humans',
      category: 'fuel',
      summary:
        'The change from glucose to fat and ketones as the main fuel is real and gradual, centred around 24–36 hours. A daily 16- to 18-hour fast produces only a mild state. There is little evidence that switching itself brings health benefits beyond the calorie deficit that usually comes with it. Protein sparing needs several days of fasting.',
      howModelled:
        "The app shows hours in ketosis descriptively and gives no health credit for them. Protein sparing appears only after several days of fasting, in the extended-fasting model's protein loss.",
      keyNumbers: [
        {
          label: 'Claim: the switch occurs beyond 12 hours, between 12 and 36 hours',
          value:
            'Gluconeogenesis 64–67 % by 22 h; fat release rise mostly 18–24 h; BHB 0.15 mM at 18 h, about 0.3–0.4 mM at 24 h, 1.2–1.9 mM at 48 h; ketones detectable at about 21 h (17.5 h with exercise)',
          note: 'Substantiated as a graded transition centred around 24–36 hours; exercise or low-carbohydrate eating advance it (grade A).',
          referenceIds: [
            'anton2018',
            'rothman1991',
            'landau1996',
            'klein1993',
            'jamshed2019',
            'browning2012',
            'grundler2024',
          ],
        },
        {
          label: 'Claim: 16:8 or 18:6 flips the switch daily',
          value: 'BHB only 0.15 mM after an 18 h fast on early TRF',
          note: 'Mostly not: daily time-restricted eating produces a mild, not ketotic, state (grade B).',
          referenceIds: ['jamshed2019'],
        },
        {
          label: 'Claim: switching gives benefits independent of weight loss',
          value:
            'Alternate-day fasting without a deficit (0:200) gave no fat loss and no change in postprandial metabolism, gut hormones or adipose genes; TRE benefits are "primarily due to energy deficit"; intermittent fasting matches continuous restriction in a network meta-analysis',
          note: 'Isolated positives: early TRF insulin and blood pressure (n = 8) and early TRF muscle insulin sensitivity. Weak or unsubstantiated beyond the deficit (grade C). The planner must not award health points for switch hours as such.',
          referenceIds: ['templeman2021', 'chang2024', 'semnaniazad2025', 'sutton2018', 'jones2020'],
        },
        {
          label: 'Claim: ketones preserve muscle once the switch occurs',
          value:
            'Nitrogen excretion falls with a time constant of about 6 days as ketosis deepens, but early fasting days are protein-expensive (nitrogen peak days 1–3)',
          note: 'Protein sparing is real only after several days; short repeated fasts repeatedly incur the expensive phase (grade B).',
          referenceIds: ['goschke1975', 'laurens2021'],
        },
        {
          label: 'Claim: brain and cognition benefits of switching',
          value:
            'Mostly animal data and reviews; in humans, well-being up and hunger absent in 93 % on long modified fasts (uncontrolled)',
          note: 'Grade D/C; the autophagy and cognition topics own this.',
          referenceIds: ['decabo2019', 'mattson2018', 'longo2014', 'wilhelmidetoledo2019'],
        },
      ],
      timeCourse: 'A graded transition centred around 24–36 hours after the last meal.',
      moderators: 'Exercise and low-carbohydrate eating beforehand, which advance the switch.',
      grade: 'B',
      gradeReason:
        'The timeline is well supported (A), but the claimed benefits beyond the calorie deficit are weakly supported (C).',
      status: 'contested',
      caveats:
        'Reviews advocating the switch rely partly on animal data. In humans, benefit beyond the energy deficit is unsubstantiated.',
      referenceIds: [
        'anton2018',
        'rothman1991',
        'landau1996',
        'klein1993',
        'jamshed2019',
        'browning2012',
        'grundler2024',
        'templeman2021',
        'chang2024',
        'semnaniazad2025',
        'sutton2018',
        'jones2020',
        'goschke1975',
        'laurens2021',
        'decabo2019',
        'mattson2018',
        'longo2014',
        'wilhelmidetoledo2019',
      ],
      relatedMetricIds: [],
    },
    {
      id: '07-sleep-and-meal-timing',
      title: 'Meal timing and sleep',
      category: 'recovery',
      summary:
        'A late dinner one hour before bed did not change sleep length, efficiency or stages in a controlled study, though it raised night-time glucose and cortisol. Across trials, intermittent fasting had no overall effect on sleep. During extended fasts, sleep disturbance is the most common mild symptom, mostly in the first days.',
      howModelled:
        'Meal timing has no effect on sleep in the engine. The sleep-quality score uses only caffeine and alcohol, so a large meal close to bed and the first days of an extended fast change nothing.',
      keyNumbers: [
        {
          label: 'Dinner at 22:00 (1 h before bed) against 18:00',
          value:
            'No change in total sleep time, efficiency, latency or stages by polysomnography; nocturnal glucose intolerance and higher cortisol',
          referenceIds: ['gu2020'],
        },
        {
          label: 'Night-time energy and fat intake (cross-sectional)',
          value: 'Correlated with worse sleep latency and efficiency, mainly in women',
          referenceIds: ['crispim2011'],
        },
        {
          label: 'Meta-analysis of 18 intermittent-fasting trials (15 of TRE)',
          value: 'No overall effect of intermittent fasting on sleep against free eating',
          note: 'Early TRE showed no sleep difference at 14 weeks. In a single-arm 10 h TRE study, participants felt rested on 88 % versus 70 % of days.',
          referenceIds: ['yong2025', 'jamshed2022', 'wilkinson2020'],
        },
        {
          label: 'Extended fasting',
          value:
            'Sleep disturbance the most frequent mild symptom (14.9 %), mainly in the first days; in a 1-week modified fast (n = 13, uncontrolled), fewer arousals and periodic leg movements and better subjective sleep',
          referenceIds: ['wilhelmidetoledo2019', 'michalsen2003'],
        },
      ],
      timeCourse:
        'Late-dinner effects occur overnight; extended-fast sleep disturbance is concentrated in the first days.',
      moderators:
        'Time of the last meal relative to bed, sex (the intake association was mainly in women), and fasting duration.',
      grade: 'C',
      gradeReason:
        'A single controlled crossover, a cross-sectional study and a meta-analysis point to no large effect.',
      status: 'established',
      caveats:
        'The extended-fast sleep term is a proposal (grade D). The sleep topic owns the wider picture.',
      referenceIds: [
        'gu2020',
        'crispim2011',
        'yong2025',
        'jamshed2022',
        'wilkinson2020',
        'wilhelmidetoledo2019',
        'michalsen2003',
      ],
      relatedMetricIds: [],
    },
    {
      id: '07-sex-differences-in-fasting',
      title: 'Do women and men fast differently?',
      category: 'hormones',
      summary:
        "Women have somewhat higher baseline fat release but a smaller relative rise over 24 hours. Some studies find women's fatty acids and ketones rise faster in a long fast, and others find the opposite for ketones. Women's glucose tends to fall lower in a long fast. A 3-day fast did not disrupt ovulation or cycle length in 10 women. Most hormone data in fasting come from men.",
      howModelled:
        "Not modelled as sex terms: the engine's fasting models use the same rules for women and men, so fat release, the fasting glucose floor (3.5 mM for everyone, not 3.2 for women) and nitrogen loss differ only through body size and body fat, and there is no earlier hypoglycaemia flag for women. There is no sex term for ketones either, where studies conflict.",
      keyNumbers: [
        {
          label: 'Fat release and free fatty acids',
          value:
            "Women's basal glycerol release 2.1 versus 1.5 µmol/kg/min at 14 h, with a smaller relative rise by 22 h (+40 % versus +80 %); women's free fatty acids and ketones rose faster over 72 h in one study",
          note: 'Model: glycerol release ×1.3 at 12 h and amplitude ×0.6 through 24 h; FFA +0.1 mM (grade B). Postabsorptive FFA was higher in women, with a faster rise in men early.',
          referenceIds: ['mittendorfer2001', 'browning2012', 'merimee1978'],
        },
        {
          label: 'Glucose during fasting',
          value:
            'Women had lower glucose after 38 h (with higher FFA) and lower again over 72 h; in one study at 48 h women were higher (4.4 versus 4.05 mM)',
          note: 'In 72 h fasts (60 women and 20 men of normal weight, plus 16 obese), glucose under 55 mg/dL (3.05 mM) never occurred in the obese of either sex, implying that such values occur in normal-weight fasters. Grade B/C.',
          referenceIds: ['soeters2007', 'merimee1978', 'browning2012', 'merimee1977'],
        },
        {
          label: 'Ketones',
          value:
            '48 h BHB 1.22 (women) versus 1.94 mM (men) in one study; women rose faster in another; higher ketonuria in men in long fasts',
          note: 'Conflicting, so no default sex term (grade C).',
          referenceIds: ['browning2012', 'merimee1978', 'grundler2024'],
        },
        {
          label: 'Protein loss and weight loss in long fasts',
          value: 'At equal weight men lose more nitrogen; men lose more weight and waist',
          note: "Model: women's nitrogen peak ×0.8 (magnitude unverified).",
          referenceIds: ['goschke1975', 'wilhelmidetoledo2019'],
        },
        {
          label: 'Glucose tolerance after alternate-day fasting',
          value:
            'Women showed slightly impaired meal glucose response after 22 days; men showed lower insulin response',
          note: 'Model: women on alternate-day fasting, meal glucose ×1.05 (proposed; grade C).',
          referenceIds: ['heilbronn2005b'],
        },
        {
          label: 'Reproductive axis',
          value:
            'A 3-day mid-follicular fast: fewer LH pulses on day 3, but normal follicle development, ovulation and cycle length (n = 10). In men, a 72 h fast lowered testosterone by 40 % and LH by 25 %, and time-restricted eating in lean active men lowered testosterone by 21 %',
          note: 'Intermittent fasting lowered androgens and raised SHBG in premenopausal women with obesity, especially with eating before 16:00, with no change in estrogen, gonadotropins or prolactin. No cycle disruption is modelled for fasts of 3 days or less; repeated long fasts with low energy availability raise a flag.',
          referenceIds: ['olson1995', 'cienfuegos2022', 'chan2003', 'moro2016'],
        },
        {
          label: 'Growth hormone, cortisol and noradrenaline',
          value: 'Data almost entirely in men; one study found a similar pattern in both sexes',
          note: 'The engine applies the same curves to women (unverified).',
          referenceIds: ['webber1994'],
        },
      ],
      timeCourse:
        'Sex differences show in the first 24 hours of fat release and in long-fast glucose and ketones.',
      moderators: 'Sex, body mass, obesity and menstrual phase.',
      grade: 'C',
      gradeReason:
        'Fat-release differences are graded B, but data on ketones, glucose and hormones are conflicting or sparse.',
      status: 'contested',
      caveats:
        'Female data for growth hormone, cortisol, noradrenaline, resting energy and nitrogen loss are sparse, and sex differences in ketone rise are contradictory.',
      referenceIds: [
        'mittendorfer2001',
        'browning2012',
        'merimee1978',
        'soeters2007',
        'merimee1977',
        'grundler2024',
        'goschke1975',
        'wilhelmidetoledo2019',
        'heilbronn2005b',
        'olson1995',
        'cienfuegos2022',
        'chan2003',
        'moro2016',
        'webber1994',
      ],
      relatedMetricIds: [],
    },
  ],
  myths: [
    {
      id: '07-myth-five-small-meals',
      claim: 'Eating five or six small meals a day stokes your metabolism.',
      verdict: 'not-supported',
      explanation:
        'Energy use over 24 hours was the same from 1–2 meals up to 14 meals a day in controlled trials. Body composition was not affected either, once one outlier trial was removed from a meta-analysis.',
      referenceIds: [
        'taylor2001',
        'smeets2008',
        'munsters2012',
        'ohkawara2013',
        'bellisle1997',
        'schoenfeld2015',
      ],
    },
    {
      id: '07-myth-skipping-breakfast-slows-metabolism',
      claim: 'Skipping breakfast slows your metabolism or makes you gain weight.',
      verdict: 'not-supported',
      explanation:
        'Resting metabolism stayed within 11 kcal a day of the breakfast group. Eating breakfast added about 260 kcal a day and 0.44 kg of weight in a meta-analysis, so breakfast is neutral to slightly positive for weight.',
      referenceIds: ['betts2014', 'sievert2019'],
    },
    {
      id: '07-myth-16-8-burns-more-fat',
      claim: 'A 16:8 eating window burns more fat at the same calories.',
      verdict: 'not-supported',
      explanation:
        'Time-restricted eating plus calorie restriction did the same as calorie restriction alone at 12 months. There was no fat-mass or fat-free-mass difference with a matched deficit, and 24-hour energy use was unchanged. It works by lowering intake.',
      referenceIds: ['liu2022', 'lin2023', 'stratton2020', 'ravussin2019'],
    },
    {
      id: '07-myth-starvation-mode-in-a-day',
      claim: 'Fasting puts you in "starvation mode" within a day.',
      verdict: 'not-supported',
      explanation:
        'In two studies, resting energy use rose in the first 36–72 hours, by 6 % at 36 h and by 14 % over 3 days. Another found −8 % after 3 days. Any decline comes only after several days: −12 % by day 10 of a low-energy fast. So it is false for fasts under 3 days.',
      referenceIds: ['zauner2000', 'webber1994', 'nair1987', 'laurens2021'],
    },
    {
      id: '07-myth-16-18-hours-ketosis',
      claim: 'A 16–18 hour fast puts you in ketosis and flips the metabolic switch.',
      verdict: 'oversimplified',
      explanation:
        'Blood BHB was only 0.15 mM after an 18-hour fast and about 0.3–0.4 mM at 24 hours. The change is gradual, and daily time-restricted eating gives a mild, not a ketotic, state.',
      referenceIds: ['jamshed2019', 'browning2012'],
    },
    {
      id: '07-myth-gh-preserves-muscle',
      claim: 'Fasting preserves muscle because growth hormone rises five-fold.',
      verdict: 'not-supported',
      explanation:
        'Growth hormone rises 3–5-fold, yet nitrogen loss peaks on days 1–3. In a 10-day modified fast, about 60 % of weight lost was lean soft tissue, of which about 25 % of the total loss was metabolically active tissue. Lean adults lost more lean tissue with alternate-day fasting than with steady restriction, and in one trial about 65 % of weight lost was lean. Protein sparing sets in only after several days.',
      referenceIds: ['ho1988', 'hartman1992', 'goschke1975', 'laurens2021', 'templeman2021', 'lowe2020'],
    },
    {
      id: '07-myth-eating-late-makes-you-fat',
      claim: 'Eating late makes you fat regardless of calories.',
      verdict: 'oversimplified',
      explanation:
        'In a tightly controlled study, late eating roughly doubled hunger and lowered waketime energy use by about 59 kcal a day. But total energy use by doubly labelled water and weight were equal with evening-loaded and morning-loaded eating at fixed intake. So at fixed calories the effect is mostly through appetite and after-meal glucose.',
      referenceIds: ['vujovic2022', 'ruddickcollins2022'],
    },
    {
      id: '07-myth-big-breakfast-weight-loss',
      claim: 'A big breakfast gives more than twice the weight loss of a big dinner.',
      verdict: 'unproven',
      explanation:
        'One free-living trial found −8.7 versus −3.6 kg over 12 weeks. That result was not reproduced in a crossover in which all food was provided; there, weight change was the same. The benefit therefore appears to work through appetite and adherence.',
      referenceIds: ['jakubowicz2013', 'shaw2019', 'ruddickcollins2022'],
    },
    {
      id: '07-myth-twice-the-thermic-effect-at-breakfast',
      claim: 'You burn twice as much energy digesting breakfast as dinner.',
      verdict: 'oversimplified',
      explanation:
        'The claim comes from a study with baseline and measurement-length problems. The absolute difference was only about 25 kcal (about 55 versus 30). Total daily energy use was unchanged in a doubly labelled water trial.',
      referenceIds: ['richter2020', 'melanson2020', 'ruddickcollins2022'],
    },
    {
      id: '07-myth-protein-every-three-hours',
      claim: 'You must eat protein every 3 hours or you will lose muscle.',
      verdict: 'not-supported',
      explanation:
        'Fat-free mass gains were equal with a 7.5-hour and a 13-hour eating window at 1.6 g/kg of protein. Timing did not matter once total protein was matched. Acute muscle-building differences between patterns do exist.',
      referenceIds: ['tinsley2019', 'schoenfeld2013', 'areta2013', 'mamerow2014'],
    },
    {
      id: '07-myth-switch-makes-fasting-healthy',
      claim: 'The metabolic switch itself is what makes intermittent fasting healthy.',
      verdict: 'unproven',
      explanation:
        'Alternate-day fasting without a calorie deficit gave no metabolic benefit, and the benefits of time-restricted eating are mainly due to the energy deficit. The switch has not been shown to help in humans beyond that.',
      referenceIds: ['templeman2021', 'chang2024'],
    },
    {
      id: '07-myth-women-and-fasting',
      claim: 'Women should not fast at all, or fasting is identical for both sexes.',
      verdict: 'oversimplified',
      explanation:
        "A 3-day fast did not disrupt ovulation or cycle length in 10 women. Women's glucose falls more in some long fasts, and alternate-day fasting may slightly impair their glucose tolerance. Both statements overstate the evidence, and the engine uses sex-specific modifiers.",
      referenceIds: ['olson1995', 'merimee1978', 'soeters2007', 'heilbronn2005b'],
    },
  ],
  openQuestions: [
    'Female data for growth hormone, cortisol, noradrenaline, resting energy use and nitrogen loss during fasting are sparse, so the curves are derived from men. Sex differences in the ketone rise are contradictory.',
    'Beyond 5 days, the growth hormone, noradrenaline and cortisol trajectories are extrapolated. The 72-hour BHB mean is interpolated because no direct healthy-cohort mean was retrieved.',
    'Resting energy use on days 1–4 is disputed: +14 % in one study and −8 % in another. The model takes a middle path.',
    'The recovery constants after refeeding for IGF-1, cortisol, noradrenaline, testosterone, resting energy use and nitrogen sparing are proposals (grade D). They govern the carry-over between repeated fasts and deserve priority data-mining.',
    'For partial-intake fast days (500–650 kcal on 5:2, 25 % on alternate days), the link from fast-day energy and carbohydrate to the depth of the fasting hormone response is unknown.',
    'The lean-mass cost of daily 16–20 hour fasts in older adults and without resistance training is uncertain. One large trial found about 65 % of weight lost was lean, whereas resistance-training trials found none. The difference is probably driven by protein intake, which few trials controlled.',
    'It is unclear whether the isocaloric blood-pressure and insulin benefit of an early eating window is real. It rests on 8 and 16 people; larger trials found weaker or weight-mediated effects. The engine shrinks it to −3/−3 mmHg (grade C).',
    'The late-eating energy penalty (−59 kcal/day in a controlled study against no difference by doubly labelled water) is unresolved, so the default is zero.',
    'Gastric emptying of very large or high-fat meals is extrapolated from moderate test meals.',
    'The time constant of extracellular water loss during fasting (3 days) is a proposal fitted to a single 10-day end-point.',
    'Muscle glycogen use during a resting fast (30 g/day for 3 days) is unverified and should be replaced by the carbohydrate topic.',
    'Water-only fasting beyond 7 days in normal-weight people lacks modern controlled data. Most data are from obese cohorts in the 1960s–70s or from supplemented modified fasts.',
  ],
  references: [
    {
      id: 'tougas2000',
      authors: 'Tougas G, et al.',
      year: 2000,
      title:
        'Assessment of gastric emptying using a low fat meal: establishment of international control values',
      journal: 'Am J Gastroenterol',
      pmid: '10894578',
      doi: '10.1111/j.1572-0241.2000.02076.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10894578/',
    },
    {
      id: 'abell2008',
      authors: 'Abell TL, et al.',
      year: 2008,
      title: 'Consensus recommendations for gastric emptying scintigraphy (ANMS/SNM)',
      journal: 'Am J Gastroenterol',
      pmid: '18028513',
      doi: '10.1111/j.1572-0241.2007.01636.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/18028513/',
    },
    {
      id: 'hunt1975',
      authors: 'Hunt JN, Stubbs DF',
      year: 1975,
      title: 'The volume and energy content of meals as determinants of gastric emptying',
      journal: 'J Physiol',
      pmid: '1127608',
      doi: '10.1113/jphysiol.1975.sp010841',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1127608/',
    },
    {
      id: 'brener1983',
      authors: 'Brener W, Hendrix TR, McHugh PR',
      year: 1983,
      title: 'Regulation of the gastric emptying of glucose',
      journal: 'Gastroenterology',
      pmid: '6852464',
      url: 'https://pubmed.ncbi.nlm.nih.gov/6852464/',
    },
    {
      id: 'trommelen2023',
      authors: 'Trommelen J, et al.',
      year: 2023,
      title:
        'The anabolic response to protein ingestion during recovery from exercise has no upper limit in magnitude and duration in vivo in humans',
      journal: 'Cell Rep Med',
      pmid: '38118410',
      doi: '10.1016/j.xcrm.2023.101324',
      url: 'https://pubmed.ncbi.nlm.nih.gov/38118410/',
    },
    {
      id: 'rothman1991',
      authors: 'Rothman DL, Magnusson I, Katz LD, Shulman RG, Shulman GI',
      year: 1991,
      title: 'Quantitation of hepatic glycogenolysis and gluconeogenesis in fasting humans with 13C NMR',
      journal: 'Science',
      pmid: '1948033',
      doi: '10.1126/science.1948033',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1948033/',
    },
    {
      id: 'landau1996',
      authors: 'Landau BR, et al.',
      year: 1996,
      title: 'Contributions of gluconeogenesis to glucose production in the fasted state',
      journal: 'J Clin Invest',
      pmid: '8755648',
      doi: '10.1172/JCI118803',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8755648/',
    },
    {
      id: 'petersen1996',
      authors: 'Petersen KF, Price T, Cline GW, Rothman DL, Shulman GI',
      year: 1996,
      title:
        'Contribution of net hepatic glycogenolysis to glucose production during the early postprandial period',
      journal: 'Am J Physiol',
      pmid: '8772491',
      doi: '10.1152/ajpendo.1996.270.1.E186',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8772491/',
    },
    {
      id: 'roden2001',
      authors: 'Roden M, Petersen KF, Shulman GI',
      year: 2001,
      title: 'Nuclear magnetic resonance studies of hepatic glucose metabolism in humans',
      journal: 'Recent Prog Horm Res',
      pmid: '11237214',
      doi: '10.1210/rp.56.1.219',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11237214/',
    },
    {
      id: 'taylor1996',
      authors: 'Taylor R, et al.',
      year: 1996,
      title:
        'Direct assessment of liver glycogen storage by 13C NMR spectroscopy and regulation of glucose homeostasis after a mixed meal in normal subjects',
      journal: 'J Clin Invest',
      pmid: '8550823',
      doi: '10.1172/JCI118379',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8550823/',
    },
    {
      id: 'hwang1995',
      authors: 'Hwang JH, et al.',
      year: 1995,
      title:
        'Impaired net hepatic glycogen synthesis in insulin-dependent diabetic subjects during mixed meal ingestion: a 13C NMR spectroscopy study',
      journal: 'J Clin Invest',
      pmid: '7860761',
      doi: '10.1172/JCI117727',
      url: 'https://pubmed.ncbi.nlm.nih.gov/7860761/',
    },
    {
      id: 'klein1993',
      authors: 'Klein S, Sakurai Y, Romijn JA, Carroll RM',
      year: 1993,
      title:
        'Progressive alterations in lipid and glucose metabolism during short-term fasting in young adult men',
      journal: 'Am J Physiol',
      pmid: '8238506',
      doi: '10.1152/ajpendo.1993.265.5.E801',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8238506/',
    },
    {
      id: 'browning2012',
      authors: 'Browning JD, Baxter J, Satapati S, Burgess SC',
      year: 2012,
      title:
        'The effect of short-term fasting on liver and skeletal muscle lipid, glucose, and energy metabolism in healthy women and men',
      journal: 'J Lipid Res',
      pmid: '22140269',
      doi: '10.1194/jlr.P020867',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22140269/',
    },
    {
      id: 'ho1988',
      authors: 'Ho KY, et al.',
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
      authors: 'Hartman ML, et al.',
      year: 1992,
      title:
        'Augmented growth hormone (GH) secretory burst frequency and amplitude mediate enhanced GH secretion during a two-day fast in normal men',
      journal: 'J Clin Endocrinol Metab',
      pmid: '1548337',
      doi: '10.1210/jcem.74.4.1548337',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1548337/',
    },
    {
      id: 'bergendahl1996',
      authors: 'Bergendahl M, et al.',
      year: 1996,
      title:
        'Fasting as a metabolic stress paradigm selectively amplifies cortisol secretory burst mass and delays the time of maximal nyctohemeral cortisol concentrations in healthy men',
      journal: 'J Clin Endocrinol Metab',
      pmid: '8636290',
      doi: '10.1210/jcem.81.2.8636290',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8636290/',
    },
    {
      id: 'zauner2000',
      authors: 'Zauner C, et al.',
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
      authors: 'Webber J, Macdonald IA',
      year: 1994,
      title:
        'The cardiovascular, metabolic and hormonal changes accompanying acute starvation in men and women',
      journal: 'Br J Nutr',
      pmid: '8172872',
      doi: '10.1079/bjn19940150',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8172872/',
    },
    {
      id: 'nair1987',
      authors: 'Nair KS, Woolf PD, Welle SL, Matthews DE',
      year: 1987,
      title: 'Leucine, glucose, and energy metabolism after 3 days of fasting in healthy human subjects',
      journal: 'Am J Clin Nutr',
      pmid: '3661473',
      doi: '10.1093/ajcn/46.4.557',
      url: 'https://pubmed.ncbi.nlm.nih.gov/3661473/',
    },
    {
      id: 'vendelbo2014',
      authors: 'Vendelbo MH, et al.',
      year: 2014,
      title:
        'Fasting increases human skeletal muscle net phenylalanine release and this is associated with decreased mTOR signaling',
      journal: 'PLoS One',
      pmid: '25020061',
      doi: '10.1371/journal.pone.0102031',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25020061/',
    },
    {
      id: 'boden1996',
      authors: 'Boden G, Chen X, Mozzoli M, Ryan I',
      year: 1996,
      title: 'Effect of fasting on serum leptin in normal human subjects',
      journal: 'J Clin Endocrinol Metab',
      pmid: '8784108',
      doi: '10.1210/jcem.81.9.8784108',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8784108/',
    },
    {
      id: 'kolaczynski1996',
      authors: 'Kolaczynski JW, et al.',
      year: 1996,
      title:
        'Responses of leptin to short-term fasting and refeeding in humans: a link with ketogenesis but not ketones themselves',
      journal: 'Diabetes',
      pmid: '8866554',
      doi: '10.2337/diab.45.11.1511',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8866554/',
    },
    {
      id: 'chan2003',
      authors: 'Chan JL, Heist K, DePaoli AM, Veldhuis JD, Mantzoros CS',
      year: 2003,
      title:
        'The role of falling leptin levels in the neuroendocrine and metabolic adaptation to short-term starvation in healthy men',
      journal: 'J Clin Invest',
      pmid: '12727933',
      doi: '10.1172/JCI17490',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12727933/',
    },
    {
      id: 'spencer1983',
      authors: 'Spencer CA, et al.',
      year: 1983,
      title: 'Dynamics of serum thyrotropin and thyroid hormone changes in fasting',
      journal: 'J Clin Endocrinol Metab',
      pmid: '6403568',
      doi: '10.1210/jcem-56-5-883',
      url: 'https://pubmed.ncbi.nlm.nih.gov/6403568/',
    },
    {
      id: 'vagenakis1975',
      authors: 'Vagenakis AG, et al.',
      year: 1975,
      title:
        'Diversion of peripheral thyroxine metabolism from activating to inactivating pathways during complete fasting',
      journal: 'J Clin Endocrinol Metab',
      pmid: '1150863',
      doi: '10.1210/jcem-41-1-191',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1150863/',
    },
    {
      id: 'salgin2009',
      authors: 'Salgin B, et al.',
      year: 2009,
      title:
        'Effects of prolonged fasting and sustained lipolysis on insulin secretion and insulin sensitivity in normal subjects',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '19106250',
      doi: '10.1152/ajpendo.90613.2008',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19106250/',
    },
    {
      id: 'horton2001',
      authors: 'Horton TJ, Hill JO',
      year: 2001,
      title:
        'Prolonged fasting significantly changes nutrient oxidation and glucose tolerance after a normal mixed meal',
      journal: 'J Appl Physiol',
      pmid: '11133906',
      doi: '10.1152/jappl.2001.90.1.155',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11133906/',
    },
    {
      id: 'natalucci2005',
      authors: 'Natalucci G, et al.',
      year: 2005,
      title:
        'Spontaneous 24-h ghrelin secretion pattern in fasting subjects: maintenance of a meal-related pattern',
      journal: 'Eur J Endocrinol',
      pmid: '15941923',
      doi: '10.1530/eje.1.01919',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15941923/',
    },
    {
      id: 'goschke1975',
      authors: 'Göschke H, Stahl M, Thölen H',
      year: 1975,
      title: 'Nitrogen loss in normal and obese subjects during total fast',
      journal: 'Klin Wochenschr',
      pmid: '1177405',
      doi: '10.1007/BF01469679',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1177405/',
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
      id: 'owen1967',
      authors: 'Owen OE, et al.',
      year: 1967,
      title: 'Brain metabolism during fasting',
      journal: 'J Clin Invest',
      pmid: '6061736',
      doi: '10.1172/JCI105650',
      url: 'https://pubmed.ncbi.nlm.nih.gov/6061736/',
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
      id: 'owen1998',
      authors: 'Owen OE, et al.',
      year: 1998,
      title: 'Protein, fat, and carbohydrate requirements during starvation: anaplerosis and cataplerosis',
      journal: 'Am J Clin Nutr',
      pmid: '9665093',
      doi: '10.1093/ajcn/68.1.12',
      url: 'https://pubmed.ncbi.nlm.nih.gov/9665093/',
    },
    {
      id: 'cahill2006',
      authors: 'Cahill GF Jr',
      year: 2006,
      title: 'Fuel metabolism in starvation',
      journal: 'Annu Rev Nutr',
      pmid: '16848698',
      doi: '10.1146/annurev.nutr.26.061505.111258',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16848698/',
    },
    {
      id: 'lariviere1990',
      authors: 'Larivière F, et al.',
      year: 1990,
      title:
        'Prolonged fasting as conditioned by prior protein depletion: effect on urinary nitrogen excretion and whole-body protein turnover',
      journal: 'Metabolism',
      pmid: '2246967',
      doi: '10.1016/0026-0495(90)90183-d',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2246967/',
    },
    {
      id: 'laurens2021',
      authors: 'Laurens C, et al.',
      year: 2021,
      title:
        'Is muscle and protein loss relevant in long-term fasting in healthy men? A prospective trial on physiological adaptations',
      journal: 'J Cachexia Sarcopenia Muscle',
      pmid: '34668663',
      doi: '10.1002/jcsm.12766',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34668663/',
    },
    {
      id: 'wilhelmidetoledo2019',
      authors: 'Wilhelmi de Toledo F, Grundler F, Bergouignan A, Drinda S, Michalsen A',
      year: 2019,
      title:
        'Safety, health improvement and well-being during a 4 to 21-day fasting period in an observational study including 1422 subjects',
      journal: 'PLoS One',
      pmid: '30601864',
      doi: '10.1371/journal.pone.0209353',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30601864/',
    },
    {
      id: 'grundler2024',
      authors: 'Grundler F, Mesnage R, Ruppert PMM, Kouretas D, Wilhelmi de Toledo F',
      year: 2024,
      title: 'Long-term fasting-induced ketosis in 1610 subjects: metabolic regulation and safety',
      journal: 'Nutrients',
      pmid: '38931204',
      doi: '10.3390/nu16121849',
      url: 'https://pubmed.ncbi.nlm.nih.gov/38931204/',
    },
    {
      id: 'michalsen2003',
      authors: 'Michalsen A, et al.',
      year: 2003,
      title:
        'Effects of short-term modified fasting on sleep patterns and daytime vigilance in non-obese subjects: results of a pilot study',
      journal: 'Ann Nutr Metab',
      pmid: '12748412',
      doi: '10.1159/000070485',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12748412/',
    },
    {
      id: 'runcie1970',
      authors: 'Runcie J, Thomson TJ',
      year: 1970,
      title: 'Prolonged starvation — a dangerous procedure?',
      journal: 'BMJ',
      pmid: '5454322',
      doi: '10.1136/bmj.3.5720.432',
      url: 'https://pubmed.ncbi.nlm.nih.gov/5454322/',
    },
    {
      id: 'boulter1973',
      authors: 'Boulter PR, Hoffman RS, Arky RA',
      year: 1973,
      title: 'Pattern of sodium excretion accompanying starvation',
      journal: 'Metabolism',
      pmid: '4704714',
      doi: '10.1016/0026-0495(73)90239-4',
      url: 'https://pubmed.ncbi.nlm.nih.gov/4704714/',
    },
    {
      id: 'spark1975',
      authors: 'Spark RF, et al.',
      year: 1975,
      title: 'Renin, aldosterone and glucagon in the natriuresis of fasting',
      journal: 'N Engl J Med',
      pmid: '165411',
      doi: '10.1056/NEJM197506192922506',
      url: 'https://pubmed.ncbi.nlm.nih.gov/165411/',
    },
    {
      id: 'nice2006',
      authors: 'National Institute for Health and Care Excellence',
      year: 2006,
      title:
        'Nutrition support for adults: oral nutrition support, enteral tube feeding and parenteral nutrition (CG32), recommendations 1.4.6-1.4.8',
      journal: 'NICE guideline CG32 (updated 2017)',
      url: 'https://www.nice.org.uk/guidance/cg32/chapter/Recommendations',
    },
    {
      id: 'dasilva2020',
      authors: 'da Silva JSV, et al.',
      year: 2020,
      title: 'ASPEN consensus recommendations for refeeding syndrome',
      journal: 'Nutr Clin Pract',
      pmid: '32115791',
      doi: '10.1002/ncp.10474',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32115791/',
    },
    {
      id: 'merimee1978',
      authors: 'Merimee TJ, Misbin RI, Pulkkinen AJ',
      year: 1978,
      title: 'Sex variations in free fatty acids and ketones during fasting: evidence for a role of glucagon',
      journal: 'J Clin Endocrinol Metab',
      pmid: '752030',
      doi: '10.1210/jcem-46-3-414',
      url: 'https://pubmed.ncbi.nlm.nih.gov/752030/',
    },
    {
      id: 'merimee1977',
      authors: 'Merimee TJ, Tyson JE',
      year: 1977,
      title: 'Hypoglycemia in man: pathologic and physiologic variants',
      journal: 'Diabetes',
      pmid: '190073',
      doi: '10.2337/diab.26.3.161',
      url: 'https://pubmed.ncbi.nlm.nih.gov/190073/',
    },
    {
      id: 'soeters2007',
      authors: 'Soeters MR, et al.',
      year: 2007,
      title: 'Gender-related differences in the metabolic response to fasting',
      journal: 'J Clin Endocrinol Metab',
      pmid: '17566089',
      doi: '10.1210/jc.2007-0552',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17566089/',
    },
    {
      id: 'mittendorfer2001',
      authors: 'Mittendorfer B, Horowitz JF, Klein S',
      year: 2001,
      title: 'Gender differences in lipid and glucose kinetics during short-term fasting',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '11701450',
      doi: '10.1152/ajpendo.2001.281.6.E1333',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11701450/',
    },
    {
      id: 'olson1995',
      authors: 'Olson BR, et al.',
      year: 1995,
      title:
        'Short-term fasting affects luteinizing hormone secretory dynamics but not reproductive function in normal-weight sedentary women',
      journal: 'J Clin Endocrinol Metab',
      pmid: '7714088',
      doi: '10.1210/jcem.80.4.7714088',
      url: 'https://pubmed.ncbi.nlm.nih.gov/7714088/',
    },
    {
      id: 'cienfuegos2022',
      authors: 'Cienfuegos S, et al.',
      year: 2022,
      title:
        'Effect of intermittent fasting on reproductive hormone levels in females and males: a review of human trials',
      journal: 'Nutrients',
      pmid: '35684143',
      doi: '10.3390/nu14112343',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35684143/',
    },
    {
      id: 'anton2018',
      authors: 'Anton SD, et al.',
      year: 2018,
      title: 'Flipping the metabolic switch: understanding and applying the health benefits of fasting',
      journal: 'Obesity',
      pmid: '29086496',
      doi: '10.1002/oby.22065',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29086496/',
    },
    {
      id: 'decabo2019',
      authors: 'de Cabo R, Mattson MP',
      year: 2019,
      title: 'Effects of intermittent fasting on health, aging, and disease',
      journal: 'N Engl J Med',
      pmid: '31881139',
      doi: '10.1056/NEJMra1905136',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31881139/',
    },
    {
      id: 'mattson2018',
      authors: 'Mattson MP, et al.',
      year: 2018,
      title: 'Intermittent metabolic switching, neuroplasticity and brain health',
      journal: 'Nat Rev Neurosci',
      pmid: '29321682',
      doi: '10.1038/nrn.2017.156',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29321682/',
    },
    {
      id: 'longo2014',
      authors: 'Longo VD, Mattson MP',
      year: 2014,
      title: 'Fasting: molecular mechanisms and clinical applications',
      journal: 'Cell Metab',
      pmid: '24440038',
      doi: '10.1016/j.cmet.2013.12.008',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24440038/',
    },
    {
      id: 'lowe2020',
      authors: 'Lowe DA, et al.',
      year: 2020,
      title:
        'Effects of time-restricted eating on weight loss and other metabolic parameters in women and men with overweight and obesity: the TREAT randomized clinical trial',
      journal: 'JAMA Intern Med',
      pmid: '32986097',
      doi: '10.1001/jamainternmed.2020.4153',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32986097/',
    },
    {
      id: 'liu2022',
      authors: 'Liu D, et al.',
      year: 2022,
      title: 'Calorie restriction with or without time-restricted eating in weight loss',
      journal: 'N Engl J Med',
      pmid: '35443107',
      doi: '10.1056/NEJMoa2114833',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35443107/',
    },
    {
      id: 'cienfuegos2020',
      authors: 'Cienfuegos S, et al.',
      year: 2020,
      title:
        'Effects of 4- and 6-h time-restricted feeding on weight and cardiometabolic health: a randomized controlled trial in adults with obesity',
      journal: 'Cell Metab',
      pmid: '32673591',
      doi: '10.1016/j.cmet.2020.06.018',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32673591/',
    },
    {
      id: 'gabel2018',
      authors: 'Gabel K, et al.',
      year: 2018,
      title:
        'Effects of 8-hour time restricted feeding on body weight and metabolic disease risk factors in obese adults: a pilot study',
      journal: 'Nutr Healthy Aging',
      pmid: '29951594',
      doi: '10.3233/NHA-170036',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29951594/',
    },
    {
      id: 'moro2016',
      authors: 'Moro T, et al.',
      year: 2016,
      title:
        'Effects of eight weeks of time-restricted feeding (16/8) on basal metabolism, maximal strength, body composition, inflammation, and cardiovascular risk factors in resistance-trained males',
      journal: 'J Transl Med',
      pmid: '27737674',
      doi: '10.1186/s12967-016-1044-0',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27737674/',
    },
    {
      id: 'moro2020',
      authors: 'Moro T, et al.',
      year: 2020,
      title:
        'Time-restricted eating effects on performance, immune function, and body composition in elite cyclists: a randomized controlled trial',
      journal: 'J Int Soc Sports Nutr',
      pmid: '33308259',
      doi: '10.1186/s12970-020-00396-z',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33308259/',
    },
    {
      id: 'moro2021',
      authors: 'Moro T, et al.',
      year: 2021,
      title:
        'Twelve months of time-restricted eating and resistance training improves inflammatory markers and cardiometabolic risk factors',
      journal: 'Med Sci Sports Exerc',
      pmid: '34649266',
      doi: '10.1249/MSS.0000000000002738',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34649266/',
    },
    {
      id: 'tinsley2017',
      authors: 'Tinsley GM, et al.',
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
      authors: 'Tinsley GM, et al.',
      year: 2019,
      title: 'Time-restricted feeding plus resistance training in active females: a randomized trial',
      journal: 'Am J Clin Nutr',
      pmid: '31268131',
      doi: '10.1093/ajcn/nqz126',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31268131/',
    },
    {
      id: 'stratton2020',
      authors: 'Stratton MT, et al.',
      year: 2020,
      title:
        'Four weeks of time-restricted feeding combined with resistance training does not differentially influence measures of body composition, muscle performance, resting energy expenditure, and blood biomarkers',
      journal: 'Nutrients',
      pmid: '32316561',
      doi: '10.3390/nu12041126',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32316561/',
    },
    {
      id: 'jamshed2022',
      authors: 'Jamshed H, et al.',
      year: 2022,
      title:
        'Effectiveness of early time-restricted eating for weight loss, fat loss, and cardiometabolic health in adults with obesity: a randomized clinical trial',
      journal: 'JAMA Intern Med',
      pmid: '35939311',
      doi: '10.1001/jamainternmed.2022.3050',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35939311/',
    },
    {
      id: 'sutton2018',
      authors: 'Sutton EF, et al.',
      year: 2018,
      title:
        'Early time-restricted feeding improves insulin sensitivity, blood pressure, and oxidative stress even without weight loss in men with prediabetes',
      journal: 'Cell Metab',
      pmid: '29754952',
      doi: '10.1016/j.cmet.2018.04.010',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29754952/',
    },
    {
      id: 'ravussin2019',
      authors: 'Ravussin E, Beyl RA, Poggiogalle E, Hsia DS, Peterson CM',
      year: 2019,
      title:
        'Early time-restricted feeding reduces appetite and increases fat oxidation but does not affect energy expenditure in humans',
      journal: 'Obesity',
      pmid: '31339000',
      doi: '10.1002/oby.22518',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31339000/',
    },
    {
      id: 'jamshed2019',
      authors: 'Jamshed H, et al.',
      year: 2019,
      title:
        'Early time-restricted feeding improves 24-hour glucose levels and affects markers of the circadian clock, aging, and autophagy in humans',
      journal: 'Nutrients',
      pmid: '31151228',
      doi: '10.3390/nu11061234',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31151228/',
    },
    {
      id: 'jones2020',
      authors: 'Jones R, et al.',
      year: 2020,
      title:
        'Two weeks of early time-restricted feeding (eTRF) improves skeletal muscle insulin and anabolic sensitivity in healthy men',
      journal: 'Am J Clin Nutr',
      pmid: '32729615',
      doi: '10.1093/ajcn/nqaa192',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32729615/',
    },
    {
      id: 'hutchison2019',
      authors: 'Hutchison AT, et al.',
      year: 2019,
      title:
        'Time-restricted feeding improves glucose tolerance in men at risk for type 2 diabetes: a randomized crossover trial',
      journal: 'Obesity',
      pmid: '31002478',
      doi: '10.1002/oby.22449',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31002478/',
    },
    {
      id: 'lin2023',
      authors: 'Lin S, et al.',
      year: 2023,
      title:
        'Time-restricted eating without calorie counting for weight loss in a racially diverse population: a randomized controlled trial',
      journal: 'Ann Intern Med',
      pmid: '37364268',
      doi: '10.7326/M23-0052',
      url: 'https://pubmed.ncbi.nlm.nih.gov/37364268/',
    },
    {
      id: 'thomas2022',
      authors: 'Thomas EA, et al.',
      year: 2022,
      title:
        'Early time-restricted eating compared with daily caloric restriction: a randomized trial in adults with obesity',
      journal: 'Obesity',
      pmid: '35470974',
      doi: '10.1002/oby.23420',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35470974/',
    },
    {
      id: 'chow2020',
      authors: 'Chow LS, et al.',
      year: 2020,
      title:
        'Time-restricted eating effects on body composition and metabolic measures in humans who are overweight: a feasibility study',
      journal: 'Obesity',
      pmid: '32270927',
      doi: '10.1002/oby.22756',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32270927/',
    },
    {
      id: 'wilkinson2020',
      authors: 'Wilkinson MJ, et al.',
      year: 2020,
      title:
        'Ten-hour time-restricted eating reduces weight, blood pressure, and atherogenic lipids in patients with metabolic syndrome',
      journal: 'Cell Metab',
      pmid: '31813824',
      doi: '10.1016/j.cmet.2019.11.004',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31813824/',
    },
    {
      id: 'gill2015',
      authors: 'Gill S, Panda S',
      year: 2015,
      title:
        'A smartphone app reveals erratic diurnal eating patterns in humans that can be modulated for health benefits',
      journal: 'Cell Metab',
      pmid: '26411343',
      doi: '10.1016/j.cmet.2015.09.005',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26411343/',
    },
    {
      id: 'moon2020',
      authors: 'Moon S, et al.',
      year: 2020,
      title:
        'Beneficial effects of time-restricted eating on metabolic diseases: a systemic review and meta-analysis',
      journal: 'Nutrients',
      pmid: '32365676',
      doi: '10.3390/nu12051267',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32365676/',
    },
    {
      id: 'chen2026',
      authors: 'Chen YE, Tsai HL, Tu YK, Chen LW',
      year: 2026,
      title:
        'Effects of timing and eating duration of time restricted eating on metabolic outcomes: systematic review and network meta-analysis',
      journal: 'BMJ Med',
      pmid: '41586347',
      doi: '10.1136/bmjmed-2024-001071',
      url: 'https://pubmed.ncbi.nlm.nih.gov/41586347/',
    },
    {
      id: 'semnaniazad2025',
      authors: 'Semnani-Azad Z, et al.',
      year: 2025,
      title:
        'Intermittent fasting strategies and their effects on body weight and other cardiometabolic risk factors: systematic review and network meta-analysis of randomised clinical trials',
      journal: 'BMJ',
      pmid: '40533200',
      doi: '10.1136/bmj-2024-082007',
      url: 'https://pubmed.ncbi.nlm.nih.gov/40533200/',
    },
    {
      id: 'elorteguipascual2023',
      authors: 'Elortegui Pascual P, et al.',
      year: 2023,
      title:
        'A meta-analysis comparing the effectiveness of alternate day fasting, the 5:2 diet, and time-restricted eating for weight loss',
      journal: 'Obesity',
      pmid: '36349432',
      doi: '10.1002/oby.23568',
      url: 'https://pubmed.ncbi.nlm.nih.gov/36349432/',
    },
    {
      id: 'liu2024',
      authors: "Liu HY, Eso AA, Cook N, O'Neill HM, Albarqouni L",
      year: 2024,
      title: 'Meal timing and anthropometric and metabolic outcomes: a systematic review and meta-analysis',
      journal: 'JAMA Netw Open',
      pmid: '39485353',
      doi: '10.1001/jamanetworkopen.2024.42163',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39485353/',
    },
    {
      id: 'chang2024',
      authors: 'Chang Y, Du T, Zhuang X, Ma G',
      year: 2024,
      title:
        'Time-restricted eating improves health because of energy deficit and circadian rhythm: a systematic review and meta-analysis',
      journal: 'iScience',
      pmid: '38357669',
      doi: '10.1016/j.isci.2024.109000',
      url: 'https://pubmed.ncbi.nlm.nih.gov/38357669/',
    },
    {
      id: 'hays2025',
      authors: 'Hays HM, et al.',
      year: 2025,
      title:
        'Effects of time-restricted eating with exercise on body composition in adults: a systematic review and meta-analysis',
      journal: 'Int J Obes',
      pmid: '39794384',
      doi: '10.1038/s41366-024-01704-2',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39794384/',
    },
    {
      id: 'ali2026',
      authors: 'Ali AM, et al.',
      year: 2026,
      title:
        'Time-restricted eating shows a modest reduction in fat mass in resistance-trained individuals: a systematic review and meta-analysis',
      journal: 'Nutr Res',
      pmid: '41687432',
      doi: '10.1016/j.nutres.2026.01.001',
      url: 'https://pubmed.ncbi.nlm.nih.gov/41687432/',
    },
    {
      id: 'silesguerrero2024',
      authors: 'Siles-Guerrero V, et al.',
      year: 2024,
      title:
        'Is fasting superior to continuous caloric restriction for weight loss and metabolic outcomes in obese adults? A systematic review and meta-analysis of randomized clinical trials',
      journal: 'Nutrients',
      pmid: '39458528',
      doi: '10.3390/nu16203533',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39458528/',
    },
    {
      id: 'garegnani2026',
      authors: 'Garegnani LI, et al.',
      year: 2026,
      title: 'Intermittent fasting for adults with overweight or obesity',
      journal: 'Cochrane Database Syst Rev',
      pmid: '41692034',
      doi: '10.1002/14651858.CD015610.pub2',
      url: 'https://pubmed.ncbi.nlm.nih.gov/41692034/',
    },
    {
      id: 'yong2025',
      authors: "Yong YN, McCubbin AJ, O'Driscoll DM, St-Onge MP, Bonham MP",
      year: 2025,
      title:
        'The effects of intermittent fasting on sleep quality and cardiometabolic health outcomes in adults with overweight/obesity status: a systematic review and meta-analysis of randomized controlled trials',
      journal: 'Sleep Med Rev',
      pmid: '41202521',
      doi: '10.1016/j.smrv.2025.102193',
      url: 'https://pubmed.ncbi.nlm.nih.gov/41202521/',
    },
    {
      id: 'morris2015a',
      authors: 'Morris CJ, et al.',
      year: 2015,
      title:
        'Endogenous circadian system and circadian misalignment impact glucose tolerance via separate mechanisms in humans',
      journal: 'Proc Natl Acad Sci USA',
      pmid: '25870289',
      doi: '10.1073/pnas.1418955112',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25870289/',
    },
    {
      id: 'morris2015b',
      authors: 'Morris CJ, et al.',
      year: 2015,
      title:
        'The human circadian system has a dominating role in causing the morning/evening difference in diet-induced thermogenesis',
      journal: 'Obesity',
      pmid: '26414564',
      doi: '10.1002/oby.21189',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26414564/',
    },
    {
      id: 'bo2015',
      authors: 'Bo S, et al.',
      year: 2015,
      title:
        'Is the timing of caloric intake associated with variation in diet-induced thermogenesis and in the metabolic pattern? A randomized cross-over study',
      journal: 'Int J Obes',
      pmid: '26219416',
      doi: '10.1038/ijo.2015.138',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26219416/',
    },
    {
      id: 'romon1993',
      authors: 'Romon M, et al.',
      year: 1993,
      title: 'Circadian variation of diet-induced thermogenesis',
      journal: 'Am J Clin Nutr',
      pmid: '8460600',
      doi: '10.1093/ajcn/57.4.476',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8460600/',
    },
    {
      id: 'richter2020',
      authors: 'Richter J, et al.',
      year: 2020,
      title:
        'Twice as high diet-induced thermogenesis after breakfast vs dinner on high-calorie as well as low-calorie meals',
      journal: 'J Clin Endocrinol Metab',
      pmid: '32073608',
      doi: '10.1210/clinem/dgz311',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32073608/',
    },
    {
      id: 'melanson2020',
      authors: 'Melanson EL, Chen KY',
      year: 2020,
      title:
        'Letter to the Editor: "Twice as high diet-induced thermogenesis after breakfast vs dinner on high-calorie as well as low-calorie meals"',
      journal: 'J Clin Endocrinol Metab',
      doi: '10.1210/clinem/dgaa208',
      url: 'https://academic.oup.com/jcem/article/105/7/e2673/5821101',
    },
    {
      id: 'saad2012',
      authors: 'Saad A, et al.',
      year: 2012,
      title: 'Diurnal pattern to insulin secretion and insulin action in healthy individuals',
      journal: 'Diabetes',
      pmid: '22751690',
      doi: '10.2337/db11-1478',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22751690/',
    },
    {
      id: 'vancauter1997',
      authors: 'Van Cauter E, Polonsky KS, Scheen AJ',
      year: 1997,
      title: 'Roles of circadian rhythmicity and sleep in human glucose regulation',
      journal: 'Endocr Rev',
      pmid: '9331550',
      doi: '10.1210/edrv.18.5.0317',
      url: 'https://pubmed.ncbi.nlm.nih.gov/9331550/',
    },
    {
      id: 'vujovic2022',
      authors: 'Vujović N, et al.',
      year: 2022,
      title:
        'Late isocaloric eating increases hunger, decreases energy expenditure, and modifies metabolic pathways in adults with overweight and obesity',
      journal: 'Cell Metab',
      pmid: '36198293',
      doi: '10.1016/j.cmet.2022.09.007',
      url: 'https://pubmed.ncbi.nlm.nih.gov/36198293/',
    },
    {
      id: 'ruddickcollins2022',
      authors: 'Ruddick-Collins LC, et al.',
      year: 2022,
      title:
        'Timing of daily calorie loading affects appetite and hunger responses without changes in energy metabolism in healthy subjects with obesity',
      journal: 'Cell Metab',
      pmid: '36087576',
      doi: '10.1016/j.cmet.2022.08.001',
      url: 'https://pubmed.ncbi.nlm.nih.gov/36087576/',
    },
    {
      id: 'jakubowicz2013',
      authors: 'Jakubowicz D, Barnea M, Wainstein J, Froy O',
      year: 2013,
      title:
        'High caloric intake at breakfast vs. dinner differentially influences weight loss of overweight and obese women',
      journal: 'Obesity',
      pmid: '23512957',
      doi: '10.1002/oby.20460',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23512957/',
    },
    {
      id: 'shaw2019',
      authors: 'Shaw E, Leung GKW, Jong J, Coates AM, et al.',
      year: 2019,
      title: 'The impact of time of day on energy expenditure: implications for long-term energy balance',
      journal: 'Nutrients',
      pmid: '31590425',
      doi: '10.3390/nu11102383',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31590425/',
    },
    {
      id: 'garaulet2013',
      authors: 'Garaulet M, et al.',
      year: 2013,
      title: 'Timing of food intake predicts weight loss effectiveness',
      journal: 'Int J Obes',
      pmid: '23357955',
      doi: '10.1038/ijo.2012.229',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23357955/',
    },
    {
      id: 'gu2020',
      authors: 'Gu C, et al.',
      year: 2020,
      title: 'Metabolic effects of late dinner in healthy volunteers — a randomized crossover clinical trial',
      journal: 'J Clin Endocrinol Metab',
      pmid: '32525525',
      doi: '10.1210/clinem/dgaa354',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32525525/',
    },
    {
      id: 'betts2014',
      authors: 'Betts JA, et al.',
      year: 2014,
      title:
        'The causal role of breakfast in energy balance and health: a randomized controlled trial in lean adults',
      journal: 'Am J Clin Nutr',
      pmid: '24898233',
      doi: '10.3945/ajcn.114.083402',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24898233/',
    },
    {
      id: 'chowdhury2016',
      authors: 'Chowdhury EA, et al.',
      year: 2016,
      title:
        'The causal role of breakfast in energy balance and health: a randomized controlled trial in obese adults',
      journal: 'Am J Clin Nutr',
      pmid: '26864365',
      doi: '10.3945/ajcn.115.122044',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26864365/',
    },
    {
      id: 'sievert2019',
      authors: 'Sievert K, et al.',
      year: 2019,
      title:
        'Effect of breakfast on weight and energy intake: systematic review and meta-analysis of randomised controlled trials',
      journal: 'BMJ',
      pmid: '30700403',
      doi: '10.1136/bmj.l42',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30700403/',
    },
    {
      id: 'young2023',
      authors: "Young IE, Poobalan A, Steinbeck K, O'Connor HT, Parker HM",
      year: 2023,
      title:
        'Distribution of energy intake across the day and weight loss: a systematic review and meta-analysis',
      journal: 'Obes Rev',
      pmid: '36530130',
      doi: '10.1111/obr.13537',
      url: 'https://pubmed.ncbi.nlm.nih.gov/36530130/',
    },
    {
      id: 'crispim2011',
      authors: 'Crispim CA, et al.',
      year: 2011,
      title: 'Relationship between food intake and sleep pattern in healthy individuals',
      journal: 'J Clin Sleep Med',
      pmid: '22171206',
      doi: '10.5664/jcsm.1476',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22171206/',
    },
    {
      id: 'schoenfeld2015',
      authors: 'Schoenfeld BJ, Aragon AA, Krieger JW',
      year: 2015,
      title: 'Effects of meal frequency on weight loss and body composition: a meta-analysis',
      journal: 'Nutr Rev',
      pmid: '26024494',
      doi: '10.1093/nutrit/nuu017',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26024494/',
    },
    {
      id: 'taylor2001',
      authors: 'Taylor MA, Garrow JS',
      year: 2001,
      title:
        'Compared with nibbling, neither gorging nor a morning fast affect short-term energy balance in obese patients in a chamber calorimeter',
      journal: 'Int J Obes Relat Metab Disord',
      pmid: '11319656',
      doi: '10.1038/sj.ijo.0801572',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11319656/',
    },
    {
      id: 'bellisle1997',
      authors: 'Bellisle F, McDevitt R, Prentice AM',
      year: 1997,
      title: 'Meal frequency and energy balance',
      journal: 'Br J Nutr',
      pmid: '9155494',
      doi: '10.1079/bjn19970104',
      url: 'https://pubmed.ncbi.nlm.nih.gov/9155494/',
    },
    {
      id: 'smeets2008',
      authors: 'Smeets AJ, Westerterp-Plantenga MS',
      year: 2008,
      title:
        'Acute effects on metabolism and appetite profile of one meal difference in the lower range of meal frequency',
      journal: 'Br J Nutr',
      pmid: '18053311',
      doi: '10.1017/S0007114507877646',
      url: 'https://pubmed.ncbi.nlm.nih.gov/18053311/',
    },
    {
      id: 'munsters2012',
      authors: 'Munsters MJ, Saris WH',
      year: 2012,
      title:
        'Effects of meal frequency on metabolic profiles and substrate partitioning in lean healthy males',
      journal: 'PLoS One',
      pmid: '22719910',
      doi: '10.1371/journal.pone.0038632',
      url: 'https://pubmed.ncbi.nlm.nih.gov/22719910/',
    },
    {
      id: 'ohkawara2013',
      authors: 'Ohkawara K, Cornier MA, Kohrt WM, Melanson EL',
      year: 2013,
      title: 'Effects of increased meal frequency on fat oxidation and perceived hunger',
      journal: 'Obesity',
      pmid: '23404961',
      doi: '10.1002/oby.20032',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23404961/',
    },
    {
      id: 'cameron2010',
      authors: 'Cameron JD, Cyr MJ, Doucet E',
      year: 2010,
      title:
        'Increased meal frequency does not promote greater weight loss in subjects who were prescribed an 8-week equi-energetic energy-restricted diet',
      journal: 'Br J Nutr',
      pmid: '19943985',
      doi: '10.1017/S0007114509992984',
      url: 'https://pubmed.ncbi.nlm.nih.gov/19943985/',
    },
    {
      id: 'leidy2011',
      authors: 'Leidy HJ, et al.',
      year: 2011,
      title:
        'The effects of consuming frequent, higher protein meals on appetite and satiety during weight loss in overweight/obese men',
      journal: 'Obesity',
      pmid: '20847729',
      doi: '10.1038/oby.2010.203',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20847729/',
    },
    {
      id: 'stote2007',
      authors: 'Stote KS, et al.',
      year: 2007,
      title:
        'A controlled trial of reduced meal frequency without caloric restriction in healthy, normal-weight, middle-aged adults',
      journal: 'Am J Clin Nutr',
      pmid: '17413096',
      doi: '10.1093/ajcn/85.4.981',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17413096/',
    },
    {
      id: 'carlson2007',
      authors: 'Carlson O, et al.',
      year: 2007,
      title:
        'Impact of reduced meal frequency without caloric restriction on glucose regulation in healthy, normal-weight middle-aged men and women',
      journal: 'Metabolism',
      pmid: '17998028',
      doi: '10.1016/j.metabol.2007.07.018',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17998028/',
    },
    {
      id: 'meessen2022',
      authors: 'Meessen ECE, et al.',
      year: 2022,
      title:
        'Differential effects of one meal per day in the evening on metabolic health and physical performance in lean individuals',
      journal: 'Front Physiol',
      pmid: '35087416',
      doi: '10.3389/fphys.2021.771944',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35087416/',
    },
    {
      id: 'jenkins1989',
      authors: 'Jenkins DJ, et al.',
      year: 1989,
      title: 'Nibbling versus gorging: metabolic advantages of increased meal frequency',
      journal: 'N Engl J Med',
      pmid: '2674713',
      doi: '10.1056/NEJM198910053211403',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2674713/',
    },
    {
      id: 'areta2013',
      authors: 'Areta JL, et al.',
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
      authors: 'Mamerow MM, et al.',
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
      authors: 'Kim IY, et al.',
      year: 2015,
      title:
        'Quantity of dietary protein intake, but not pattern of intake, affects net protein balance primarily through differences in protein synthesis in older adults',
      journal: 'Am J Physiol Endocrinol Metab',
      pmid: '25352437',
      doi: '10.1152/ajpendo.00382.2014',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25352437/',
    },
    {
      id: 'arnal1999',
      authors: 'Arnal MA, et al.',
      year: 1999,
      title: 'Protein pulse feeding improves protein retention in elderly women',
      journal: 'Am J Clin Nutr',
      pmid: '10357740',
      doi: '10.1093/ajcn/69.6.1202',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10357740/',
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
      id: 'trepanowski2017',
      authors: 'Trepanowski JF, et al.',
      year: 2017,
      title:
        'Effect of alternate-day fasting on weight loss, weight maintenance, and cardioprotection among metabolically healthy obese adults: a randomized clinical trial',
      journal: 'JAMA Intern Med',
      pmid: '28459931',
      doi: '10.1001/jamainternmed.2017.0936',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28459931/',
    },
    {
      id: 'templeman2021',
      authors: 'Templeman I, et al.',
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
      authors: 'Catenacci VA, et al.',
      year: 2016,
      title:
        'A randomized pilot study comparing zero-calorie alternate-day fasting to daily caloric restriction in adults with obesity',
      journal: 'Obesity',
      pmid: '27569118',
      doi: '10.1002/oby.21581',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27569118/',
    },
    {
      id: 'harvie2011',
      authors: 'Harvie MN, et al.',
      year: 2011,
      title:
        'The effects of intermittent or continuous energy restriction on weight loss and metabolic disease risk markers: a randomized trial in young overweight women',
      journal: 'Int J Obes',
      pmid: '20921964',
      doi: '10.1038/ijo.2010.171',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20921964/',
    },
    {
      id: 'harvie2013',
      authors: 'Harvie M, et al.',
      year: 2013,
      title:
        'The effect of intermittent energy and carbohydrate restriction v. daily energy restriction on weight loss and metabolic disease risk markers in overweight women',
      journal: 'Br J Nutr',
      pmid: '23591120',
      doi: '10.1017/S0007114513000792',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23591120/',
    },
    {
      id: 'heilbronn2005a',
      authors: 'Heilbronn LK, Smith SR, Martin CK, Anton SD, Ravussin E',
      year: 2005,
      title:
        'Alternate-day fasting in nonobese subjects: effects on body weight, body composition, and energy metabolism',
      journal: 'Am J Clin Nutr',
      pmid: '15640462',
      doi: '10.1093/ajcn/81.1.69',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15640462/',
    },
    {
      id: 'heilbronn2005b',
      authors: 'Heilbronn LK, et al.',
      year: 2005,
      title: 'Glucose tolerance and skeletal muscle gene expression in response to alternate day fasting',
      journal: 'Obes Res',
      pmid: '15833943',
      doi: '10.1038/oby.2005.61',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15833943/',
    },
    {
      id: 'stekovic2019',
      authors: 'Stekovic S, et al.',
      year: 2019,
      title:
        'Alternate day fasting improves physiological and molecular markers of aging in healthy, non-obese humans',
      journal: 'Cell Metab',
      pmid: '31471173',
      doi: '10.1016/j.cmet.2019.07.016',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31471173/',
    },
    {
      id: 'varady2011',
      authors: 'Varady KA',
      year: 2011,
      title:
        'Intermittent versus daily calorie restriction: which diet regimen is more effective for weight loss?',
      journal: 'Obes Rev',
      pmid: '21410865',
      doi: '10.1111/j.1467-789X.2011.00873.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21410865/',
    },
    {
      id: 'cioffi2018',
      authors: 'Cioffi I, et al.',
      year: 2018,
      title:
        'Intermittent versus continuous energy restriction on weight loss and cardiometabolic outcomes: a systematic review and meta-analysis of randomized controlled trials',
      journal: 'J Transl Med',
      pmid: '30583725',
      doi: '10.1186/s12967-018-1748-4',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30583725/',
    },
    {
      id: 'alhamdan2016',
      authors: 'Alhamdan BA, et al.',
      year: 2016,
      title:
        'Alternate-day versus daily energy restriction diets: which is more effective for weight loss? A systematic review and meta-analysis',
      journal: 'Obes Sci Pract',
      pmid: '27708846',
      doi: '10.1002/osp4.52',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27708846/',
    },
    {
      id: 'beaulieu2021',
      authors: 'Beaulieu K, et al.',
      year: 2021,
      title:
        "An exploratory investigation of the impact of 'fast' and 'feed' days during intermittent energy restriction on free-living energy balance behaviours and subjective states in women with overweight/obesity",
      journal: 'Eur J Clin Nutr',
      pmid: '32873926',
      doi: '10.1038/s41430-020-00740-1',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32873926/',
    },
    {
      id: 'johnstone2002',
      authors: 'Johnstone AM, et al.',
      year: 2002,
      title: 'Effect of an acute fast on energy compensation and feeding behaviour in lean men and women',
      journal: 'Int J Obes Relat Metab Disord',
      pmid: '12461679',
      doi: '10.1038/sj.ijo.0802151',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12461679/',
    },
    {
      id: 'schoenfeld2014',
      authors: 'Schoenfeld BJ, Aragon AA, Wilborn CD, Krieger JW, Sonmez GT',
      year: 2014,
      title: 'Body composition changes associated with fasted versus non-fasted aerobic exercise',
      journal: 'J Int Soc Sports Nutr',
      pmid: '25429252',
      doi: '10.1186/s12970-014-0054-7',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25429252/',
    },
    {
      id: 'vieira2016',
      authors: 'Vieira AF, et al.',
      year: 2016,
      title:
        'Effects of aerobic exercise performed in fasted v. fed state on fat and carbohydrate metabolism in adults: a systematic review and meta-analysis',
      journal: 'Br J Nutr',
      pmid: '27609363',
      doi: '10.1017/S0007114516003160',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27609363/',
    },
  ],
};

export default topic;
