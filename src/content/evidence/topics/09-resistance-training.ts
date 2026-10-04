import type { EvidenceTopic } from '../schema';

const topic: EvidenceTopic = {
  dossier: '09',
  slug: 'resistance-training',
  title: 'Resistance training and muscle',
  scope:
    'How lifting weights changes muscle: what counts as a hard set, how weekly volume and frequency shape growth and strength, and why early gains include swelling. It also covers how fast muscle can be gained and where a natural ceiling sits, how energy balance and protein change gains and lean-mass retention, and what happens during breaks. Finally it covers the energy cost of a session.',
  mechanisms: [
    {
      id: '09-effective-set-stimulus',
      title: 'What counts as a hard set',
      category: 'body',
      summary:
        'Muscle growth is driven mainly by the number of hard sets per muscle each week. A hard set is one taken close to failure. Vitals folds the set-level details (how close to failure, load, rest, range of motion) into one number called an effective set. Loads from about 30 % to about 90 % of your one-repetition maximum (1RM, the heaviest weight you can lift once) gave similar growth when sets were taken close to failure.',
      howModelled:
        'Each set is multiplied by several factors. A direct set counts 1.0 and an indirect set counts 0.5 (for example triceps in a bench press). There is a discount for each repetition left in reserve, a discount for very light loads, a small discount for very short rest, a range-of-motion factor, and a small discount for late sets in a fasted, high-volume session. The rolling 7-day total of effective sets per muscle region is the training dose.',
      equation:
        'e_set = w_dir · f_RIR(RIR, L) · f_load(L) · f_rest(t_rest) · f_ROM(ROM) · f_fastHV\nV_r(t) = Σ over the last 7 days of e_set for sets hitting region r\nw_dir = 1.0 direct set, 0.5 indirect set\nf_RIR = clamp(1 − k_RIR(L) · RIR, 0, 1)\nf_load = 1.0 if L ≥ 35 %1RM; 0.45 at 20 %1RM, linear between 20 and 35 %; 0.35 below 20 %\nf_rest = 0.88 if rest ≤ 60 s; 0.95 if 60–90 s; 1.0 if ≥ 90 s\nf_ROM = 1.0 full range; 1.0 partial at long muscle length; 0.75 partial at short muscle length; ×1.2 for a two-joint muscle head trained at long length',
      keyNumbers: [
        {
          label: 'w_dir, indirect sets',
          value: '0.5',
          note: '“Fractional” counting beat “total” and “direct” counting (2·logBF 9.5–10.8).',
          referenceIds: ['pelland2026'],
        },
        {
          label: 'k_RIR (loss per repetition left in reserve)',
          value: '0.059 per RIR (uncertainty 0.02–0.09)',
          note: 'Proposed for other loads: 0.045 if L ≥ 80 %1RM and 0.075 if L < 60 %; the source reports only that the slope is shallower with heavier loads.',
          referenceIds: ['robinson2024'],
        },
        {
          label: 'Hypertrophy by repetitions in reserve (26 studies, 140 effects, mean 8.3 wk)',
          value: '0 RIR 8.77 %; 1: 8.25; 2: 7.73; 3: 7.22; 5: 6.19; 10: 3.67; 17: ≈ 0.24 %',
          note: 'Linear slope 0.516 %/RIR. Direct trials show 1–2 RIR ≈ failure.',
          referenceIds: ['robinson2024', 'refalo2023', 'refalo2024'],
        },
        {
          label: 'f_load at 20 %1RM',
          value: '0.45 (uncertainty 0.4–0.6)',
          note: 'Volume-matched, 12 wk: thigh muscle area +8.9 % at 20 %1RM vs +20.5 / 20.4 / 19.5 % at 40 / 60 / 80 %; elbow flexors +11.4 % vs +25.3 / 25.1 / 25.0 %. The value below 20 %1RM (0.35) is an unverified extrapolation.',
          referenceIds: ['lasevicius2018'],
        },
        {
          label: 'Low vs moderate vs high load, network meta-analysis (28 studies, 747 adults)',
          value: 'No difference in hypertrophy',
          referenceIds: ['lopez2021', 'schoenfeld2017b'],
        },
        {
          label: 'f_rest for rest ≤ 60 s',
          value: '0.88 (uncertainty 0.8–1.0)',
          note: 'Bayesian meta-analysis of 9 studies: within-group SMD 0.48 for short rest vs 0.56 for longer (ratio 0.86). Controlled contrasts favoured longer rest by 0.13 (arm) and 0.17 (thigh) SMD. No further benefit beyond about 90 s.',
          referenceIds: ['singer2024'],
        },
        {
          label: 'f_ROM for partial range at short muscle length',
          value: '0.75 (uncertainty 0.6–1.0)',
          note: 'Proposed. Full range beat partial range for lower-limb hypertrophy (ES 0.88). A later meta-analysis found a trivial SMD of 0.12 favouring full range, with partial range at long muscle lengths trending better (−0.28, 95 % CI −0.81 to 0.16).',
          referenceIds: ['pallares2021', 'wolf2023'],
        },
        {
          label: 'Long vs short muscle length',
          value:
            'Seated vs prone leg curl, whole hamstrings +14 % vs +9 %; overhead vs neutral elbow extension, long head +28.5 % vs +19.6 % (1.5×)',
          note: 'Knee-extension partial range at long lengths beat partial range at short lengths.',
          referenceIds: ['maeo2021', 'maeo2023', 'pedrosa2022'],
        },
        {
          label: 'f_fastHV',
          value: '0.95 for sets beyond the 10th per region in one session when fasted or glycogen-depleted',
          note: 'Proposed.',
          referenceIds: ['henselmans2022'],
        },
        {
          label: 'Presets when the user does not enter sets (effective sets per region per week)',
          value: 'None 0; minimal 2.5; light 5; moderate (literature median) 11; high 18; very high 27',
          note: 'Proposed mapping of typical programmes to the dose axis of the meta-regression.',
          referenceIds: ['pelland2026'],
        },
      ],
      timeCourse: 'Instantaneous for each set. The dose itself is a rolling 7-day total.',
      moderators:
        'Training status does not change the load independence. Very light loads, very short rest and short-length partial range each reduce the stimulus per set.',
      grade: 'B',
      gradeReason:
        'Volume counting and load independence are grade A (several meta-analyses), the effort and rest terms are B, and range of motion is C, so the mechanism is graded B overall.',
      status: 'proposed-fit',
      caveats:
        'The repetitions-in-reserve slope comes from one exploratory meta-regression with estimated, not measured, repetitions in reserve, and people tend to under-estimate how many they have left. Range-of-motion effects rest on few trials whose intervals cross zero.',
      referenceIds: [
        'pelland2026',
        'robinson2024',
        'refalo2023',
        'refalo2024',
        'lasevicius2018',
        'lopez2021',
        'schoenfeld2017b',
        'singer2024',
        'pallares2021',
        'wolf2023',
        'maeo2021',
        'maeo2023',
        'pedrosa2022',
        'henselmans2022',
        'morton2016',
      ],
      relatedMetricIds: ['rtMuscleGain'],
    },
    {
      id: '09-weekly-volume-dose-response',
      title: 'More weekly sets, more growth, with diminishing returns',
      category: 'body',
      summary:
        'Across studies, more hard sets per muscle per week meant more growth, but each extra set added less. A fitted curve from a large meta-regression gives about 4.18 % muscle-size gain over roughly 10 weeks at 10 sets a week and about 8.41 % at 30. No clear plateau appeared up to about 40 sets. Strength saturates at far lower volumes.',
      howModelled:
        'A square-root curve turns weekly effective sets into percent growth. The engine then expresses it relative to the typical study dose of 12 sets a week, which gives a multiplier of 1.00, and caps it at 40 sets. Strength uses a separate saturating curve.',
      equation:
        'G(V) = exp( β · (√(V + 1) − 1) ) − 1, β = 0.01768\n%Δ muscle size over ~10.4 wk vs non-training control = 100 · G(V)\nf_V(V) = G(min(V, V_cap)) / G(12), V_cap = 40\n%Δ 1RM-type strength over ~10.4 wk = 100 · (exp(0.14635 · V / (V + 1)) − 1)',
      keyNumbers: [
        {
          label: 'Muscle-size gain by weekly effective sets, ~10.4 wk',
          value: 'V = 1: 0.74 %; 4: 2.21 %; 10: 4.18 %; 20: 6.54 %; 30: 8.41 %; 40: 10.03 %; 45: 10.77 %',
          note: "The 95 % credible interval at 20 sets is 3.87–9.12 %. The curve is our fit to the authors' published table (35 studies, 220 effects, 1 032 participants; mean duration 10.4 wk), with a maximum error of 0.005 percentage points.",
          referenceIds: ['pelland2026'],
        },
        {
          label: 'Engine multiplier f_V by weekly effective sets',
          value:
            '0 → 0; 1 → 0.16; 2 → 0.28; 4 → 0.47; 6 → 0.63; 8 → 0.76; 10 → 0.89; 12 → 1.00; 15 → 1.16; 20 → 1.39; 25 → 1.59; 30 → 1.78; 35 → 1.96; 40 → 2.13',
          referenceIds: ['pelland2026'],
        },
        {
          label: 'Efficiency tiers published with the model',
          value:
            'Minimum effective dose 4 sets/wk; 5–10 sets: ~6 extra sets per detectable step; 11–18: ~8.5; 19–29: ~10.75; 30–42: ~12.5; ≥ 43: insufficient data',
          note: 'Smallest detectable effect 2.05 %.',
          referenceIds: ['pelland2026'],
        },
        {
          label: 'Earlier meta-regression (15 studies, 34 groups)',
          value:
            'Each extra weekly set +0.023 ES ≈ +0.37 % hypertrophy; higher vs lower volume ES difference 0.241 (≈ 3.9 %)',
          note: "The newer model's marginal slope at the mean (12.25 sets) is 0.24 %/set (95 % CrI 0.15–0.33).",
          referenceIds: ['schoenfeld2017a', 'pelland2026'],
        },
        {
          label: 'Trained young men, 12–20 vs more than 20 sets a week (6 studies)',
          value:
            'No difference for quadriceps (p = 0.19) or biceps (p = 0.59); more than 20 better for triceps (p = 0.01)',
          referenceIds: ['bazvalle2022'],
        },
        {
          label: 'Novice elbow flexors, growth per day',
          value:
            '+0.17 / 0.24 / 0.18 % per day for 3–3.5 / 4–6 / ≥ 9 sets per session, about +12–17 % in 10 wk',
          note: 'The order of magnitude the regional growth must reach in novices.',
          referenceIds: ['wernbom2007'],
        },
        {
          label: 'Trained men, 8 wk, 1 / 3 / 5 sets per exercise, 3 × a week',
          value:
            'Elbow-extensor thickness +1.1 % (6 sets/wk) vs +5.5 % (30); mid-thigh +3.4 % (9) vs +12.5 % (45); lateral thigh +5.0 % vs +13.7 %',
          referenceIds: ['schoenfeld2019b'],
        },
        {
          label: 'Squatting-trained lifters, 8 wk, 12 vs 18 vs 24 lower-body sets a week',
          value: 'Summed thickness +7.7 / 6.7 / 6.1 %; no group difference',
          referenceIds: ['aube2022'],
        },
        {
          label: 'Overview of 137 systematic reviews (ACSM 2026)',
          value: 'Hypertrophy enhanced by ≥ 10 sets/wk and eccentric overload',
          note: 'Training to failure, periodisation and equipment were not consistently influential.',
          referenceIds: ['currier2026'],
        },
        {
          label: 'Strength gain by weekly effective sets, ~10.4 wk',
          value: 'V = 1: 7.6 %; 2: 10.3; 4: 12.4; 6: 13.4; 10: 14.2; 20: 15.0; 30: 15.2',
          note: 'Minimum effective dose is 1 set; no detectable gains beyond about 4–5 fractional sets a week.',
          referenceIds: ['pelland2026'],
        },
      ],
      timeCourse: 'Volume acts through the 7-day window, and the effect accrues day by day.',
      moderators:
        'Nothing reliably moderated the volume slope in exploratory analyses. In older adults, higher-volume programmes were associated with larger lean-body-mass gains (β = 0.05).',
      grade: 'A',
      gradeReason:
        'Several meta-analyses agree on a positive, diminishing dose-response up to about 20–25 sets a week; beyond about 30 sets it is grade C.',
      status: 'established',
      caveats:
        "Above about 30 sets a week there are few studies, and the data fit a plateau or an inverted U as well as continued growth. Individual trials in trained people disagree with each other. The constants in the equation are our fit to a published table, not the authors' own.",
      referenceIds: [
        'pelland2026',
        'schoenfeld2017a',
        'bazvalle2022',
        'wernbom2007',
        'schoenfeld2019b',
        'aube2022',
        'currier2026',
        'peterson2011',
      ],
      relatedMetricIds: ['rtMuscleGain', 'skeletalMuscle'],
    },
    {
      id: '09-training-frequency',
      title: 'How often to train a muscle',
      category: 'body',
      summary:
        'When weekly volume is equal, splitting it into more sessions has little effect on muscle growth. Frequency matters more for strength, probably through practice. One meta-regression that adjusted for volume found hypertrophy of +1.61 % at one session a week and +2.77 % at six. Even so, the probability that frequency helps growth at all was only 91.3 %.',
      howModelled:
        'Growth is multiplied by a factor based on how many days in the last 7 included a set for the muscle: 0.90 for one, 1.00 for two and 1.05 for three or more. A separate strength practice factor rises with frequency.',
      equation:
        'f_F(F_r) = 0 (F = 0), 0.90 (F = 1), 1.00 (F = 2), 1.05 (F ≥ 3)\nf_FS(F) = (exp(0.2395 · F / (F + 1)) − 1) / (exp(0.2395 · 2/3) − 1)',
      keyNumbers: [
        {
          label: 'Two vs one session a week, volume not equated',
          value: 'ES 0.49 vs 0.30',
          note: 'When volume was equated there was no significant difference.',
          referenceIds: ['schoenfeld2016', 'schoenfeld2019a'],
        },
        {
          label: 'Hypertrophy by sessions a week, adjusted for volume',
          value: '+1.61 % (1 session), +2.15 % (2), +2.42 % (3), +2.77 % (6) vs 0',
          note: 'Posterior probability of a positive slope 91.3 %, described as compatible with negligible.',
          referenceIds: ['pelland2026'],
        },
        {
          label: 'Strength by sessions a week, adjusted for volume',
          value: '+12.7 % (1), +17.3 % (2), +19.7 % (3), +22.8 % (6)',
          note: 'Probability of a positive slope 100 %.',
          referenceIds: ['pelland2026'],
        },
        {
          label: 'f_F for hypertrophy',
          value: '0 (F = 0), 0.90 (F = 1), 1.00 (F = 2), 1.05 (F ≥ 3)',
          note: 'Proposed from the meta-regression: relative to 2 sessions at 12 sets, going from 1 to 2 sessions is −0.54 % and from 2 to 3 is +0.27 %, against 4.72 % at 12 sets.',
          referenceIds: ['pelland2026'],
        },
        {
          label: 'f_FS strength practice factor',
          value: 'F = 1: 0.73; 2: 1.00; 3: 1.14; 4: 1.22; 6: 1.32',
          referenceIds: ['pelland2026'],
        },
      ],
      timeCourse: 'Frequency is counted over the last 7 days.',
      moderators: 'Total weekly volume, which matters far more for growth than how it is split.',
      grade: 'B',
      gradeReason:
        'Hypertrophy shows no meaningful frequency effect once volume is matched, and the strength effect is consistent across analyses.',
      status: 'proposed-fit',
      caveats:
        'The frequency multipliers are proposed from a meta-regression whose evidence for a growth effect is weak.',
      referenceIds: ['pelland2026', 'schoenfeld2016', 'schoenfeld2019a'],
      relatedMetricIds: ['rtMuscleGain', 'strength'],
    },
    {
      id: '09-post-exercise-mps-window',
      title: 'How long muscle protein synthesis stays raised after lifting',
      category: 'body',
      summary:
        'A training session raises the rate of muscle protein synthesis (MPS, how fast new muscle protein is made) for hours. In untrained muscle it stays up for about 36–48 h. In trained muscle it peaks higher and earlier and is back to baseline by about 28 h, so the total is smaller. Vitals draws this as a curve, but the curve does not drive growth in the model.',
      howModelled:
        'Each session adds a pulse that rises for 3 h and then decays. Its peak is about +100 % in untrained muscle and about +160 % in habituated muscle, and the decay time is 30 h for untrained and 10 h for habituated muscle. Bigger sessions add more, with saturation. The pulse is used to draw an MPS curve and to hand a sensitivity window to the protein module. Growth itself comes from the weekly-volume mapping, because acute MPS does not predict growth in untrained muscle.',
      equation:
        'S_mps,r(t) = Σ_sessions A(H_r) · a(s) · φ(t − t_s; τ(H_r))\nφ(Δ) = Δ / 3 h for 0 ≤ Δ < 3 h; φ(Δ) = exp(−(Δ − 3 h) / τ) for Δ ≥ 3 h\nA(H) = 1.0 + 0.6 · H\nτ(H) = 30 h − 20 h · H\na(s) = 1 − exp(−s / 4)',
      keyNumbers: [
        {
          label: 'Untrained young men, biceps',
          value: 'MPS +50 % at 4 h; +109 % at 24 h',
          referenceIds: ['chesley1992'],
        },
        {
          label: '6 young men, 12 sets of elbow flexion',
          value: '+14 % at 36 h (not significant), described as almost back to baseline',
          referenceIds: ['macdougall1995'],
        },
        {
          label: '8 untrained people, fasted, 8 × 8 at 80 %',
          value: 'MPS +112 % at 3 h; +65 % at 24 h; +34 % at 48 h',
          note: 'Fractional breakdown rate +31 % at 3 h and +18 % at 24 h, back to baseline at 48 h.',
          referenceIds: ['phillips1997'],
        },
        {
          label: '10 young men, fed, after 8 wk of one-leg training',
          value:
            'At 4 h: trained leg +162 %, untrained leg +108 %; at 28 h: trained leg back to rest, untrained leg +70 %',
          referenceIds: ['tang2008'],
        },
        {
          label: '10 untrained men, weeks 1, 3 and 10',
          value:
            'Total MPS response in week 1 > week 3 = week 10; only weeks 3 and 10 correlated with growth (r ≈ 0.9)',
          referenceIds: ['damas2016b'],
        },
        {
          label: 'Peak elevation A(H) and decay time τ(H)',
          value:
            'A = 1.0 + 0.6·H (about +100 % untrained, +160 % habituated); τ = 30 h − 20 h·H (30 h untrained, 10 h habituated)',
          note: 'Proposed fit. The session-size saturation a(s) = 1 − exp(−s/4) is proposed and grade D.',
        },
        {
          label: 'Model check against the data',
          value:
            'Untrained: 24 h 0.50 of peak (data 0.58), 48 h 0.23 (0.30); habituated: 28 h 0.08 (data about 0)',
          note: 'Total area is about 31.5 h untrained vs 18.4 h habituated, roughly 40 % smaller in the trained state.',
        },
      ],
      timeCourse:
        'Untrained muscle stays raised for about 36–48 h. Trained muscle peaks higher and earlier and is back to baseline by about 28 h.',
      moderators:
        'Training status (repeated training dampens the response) and feeding: fasted net balance stays negative without protein.',
      grade: 'B',
      gradeReason: 'Several tracer studies agree, but each is small and the curve shape is a fit.',
      status: 'proposed-fit',
      caveats:
        'The kernel comes from four small tracer studies. It is not integrated to predict growth, because acute MPS did not predict hypertrophy in untrained muscle.',
      referenceIds: ['chesley1992', 'macdougall1995', 'phillips1997', 'tang2008', 'damas2016b', 'damas2015'],
      relatedMetricIds: ['mps', 'mtorIdx'],
    },
    {
      id: '09-early-gains-swelling',
      title: 'Early gains: repair, swelling and true growth',
      category: 'body',
      summary:
        "In the first weeks of unaccustomed lifting, much of the muscle's protein-building effort goes into repairing damage, and part of the early size gain is swelling. In one study whole-muscle cross-sectional area rose about 2.7 % by week 3, but echo-intensity, an ultrasound sign of swelling, rose 17 %. Other studies did detect true gains from about 3 weeks. Strength rises before size does.",
      howModelled:
        'Two states per muscle region. Habituation runs from 0 to 1 and climbs with a time constant of 14 days when the region is trained; it fades with a time constant of 60 days when it is not. Growth efficiency equals habituation. Swelling can reach up to 5 % of muscle volume. It builds when habituation is low and volume is high, and it fades over about a week. Apparent size is muscle mass times one plus swelling.',
      equation:
        'dH_r/dt = (1 − H_r) / τ_H,up if a session hit region r in the last 7 days; otherwise dH_r/dt = −H_r / τ_H,down\nτ_H,up = 14 d; τ_H,down = 60 d\ndW_r/dt = ( a_sw · (1 − H_r) · min(1, V_r / 10) − W_r ) / τ_sw, a_sw = 0.05, τ_sw = 7 d\nApparent regional muscle size = M_r · (1 + W_r)',
      keyNumbers: [
        {
          label: 'Muscle damage and fibre growth, 10 wk',
          value:
            'Damage highest in week 1, lower in week 3, minimal in week 10; fibre area only increased by week 10',
          referenceIds: ['damas2016b'],
        },
        {
          label: 'Whole-muscle area at week 3',
          value: '+~2.7 % with a 17 % rise in echo-intensity',
          note: 'Model target: about +2.7 % apparent area at week 3, most of it swelling, and about +10 % at week 10.',
          referenceIds: ['damas2016a'],
        },
        {
          label: 'Quadriceps area in another study',
          value: '+3.5 % / +5.2 % at day 20; +6.5 % / +7.4 % at day 35',
          note: 'Architecture changes were seen from day 10.',
          referenceIds: ['seynnes2007'],
        },
        {
          label: 'Previously trained muscle after a novel eccentric bout',
          value: 'T2 signal +4–6 % vs +52 % in controls',
          referenceIds: ['maeo2021'],
        },
        {
          label: 'τ_H,up / τ_H,down',
          value: '14 d / 60 d',
          note: 'The 14 d value is proposed from “refined by 3 wk”. The 60 d value is unverified; protection from repeated bouts persists for weeks to months.',
          referenceIds: ['damas2016b'],
        },
        {
          label: 'a_sw / τ_sw',
          value: '0.05 / 7 d',
          note: 'Proposed.',
        },
        {
          label: 'Simulated novice at 10 effective sets a week',
          value:
            'Habituation 0.40 / 0.65 / 0.79 / 0.96 at day 7 / 14 / 21 / 42; swelling 2.4 % / 2.2 % / 1.6 % / 0.4 %',
        },
        {
          label: 'Early strength',
          value: '1RM rises by week 2–4 before measurable growth; MVC +38.9 % and EMG +34.8 % by day 35',
          note: 'In men, knee extension rose by week 2 and chest press by week 6, with chest and triceps thickness significant by week 6.',
          referenceIds: ['abe2000', 'seynnes2007'],
        },
      ],
      timeCourse:
        'Habituation is about 40 % after a week and 96 % after six weeks in the simulated novice. Swelling peaks early and is nearly gone by week 6–8.',
      moderators: 'Prior training (trained muscle shows little damage from a novel bout).',
      grade: 'B',
      gradeReason: 'Two independent human studies show the phenomenon; the time constants are grade C.',
      status: 'proposed-fit',
      caveats:
        'Studies disagree on how early true growth appears. Some found true gains from about week 3, and others found early gains largely swelling.',
      referenceIds: ['damas2016a', 'damas2016b', 'seynnes2007', 'maeo2021', 'abe2000'],
      relatedMetricIds: ['rtMuscleGain', 'leanTissue'],
    },
    {
      id: '09-max-gain-rate',
      title: 'How fast muscle can be gained',
      category: 'body',
      summary:
        "Muscle gain is fastest in beginners and slows as a person nears their genetic ceiling. In 111 studies of healthy young men not in a deficit, fat-free mass rose by about 1.56 kg over roughly 10 weeks. Untrained men gained 1.54 kg and men with more than a year of training gained 0.98 kg. Vitals models this so that each day's gain is a fixed fraction of the room left to grow.",
      howModelled:
        'Each day, the possible gain in a region is a rate constant (0.55 per year) times the trainable muscle still to gain, times an age factor. Dose, frequency, protein, energy balance, habituation and individual response then scale it. Training status is the share of the trainable potential already realised. It starts from your years of consistent training or your fat-free mass index (FFMI, fat-free mass divided by height squared).',
      equation:
        'TS_r = M_acc,r / G_pot,r\nmaxGainRate_r (kg/day) = k_g · G_pot,r · (1 − TS_r) · f_age(age)\nk_g = 0.55 yr⁻¹ = 0.001507 d⁻¹\nTS₀ = max( 1 − exp(−0.47 · Y_eff), clamp((FFMI_user − FFMI_untrained_ref) / ΔFFMI_pot, 0, 0.95) )',
      keyNumbers: [
        {
          label: 'k_g, the rate constant',
          value: '0.55 yr⁻¹ (0.001507 d⁻¹)',
          note: 'Proposed fit to the average trial results below, at 12 effective sets a week, protein of about 1.4 g/kg, energy balance about zero.',
        },
        {
          label: 'Healthy men 18–40 y, not in deficit, 111 studies, 1 927 men, ~10.4 wk',
          value:
            'Fat-free mass +1.56 kg overall; untrained +1.54 kg (95 % CI 1.12–1.96); trained (> 1 y) +0.98 kg (0.17–1.79)',
          note: 'Model: untrained +1.49 kg; training status 0.45: +0.99 kg.',
          referenceIds: ['benito2020'],
        },
        {
          label: 'Resistance training alone, 49 trials, 1 863 adults, 13 ± 8 wk',
          value: 'Fat-free mass +1.1 ± 1.2 kg; protein supplementation added +0.30 kg (0.09–0.52)',
          note: 'The model predicts 1.6 kg for young men, higher than this mixed-age, mixed-sex average.',
          referenceIds: ['morton2018'],
        },
        {
          label: 'Adults 50 and over, 49 studies, 1 328 people, 20.5 ± 9.1 wk',
          value: 'Lean body mass +1.1 kg (0.9–1.2)',
          note: 'Model about +1.15 kg.',
          referenceIds: ['peterson2011'],
        },
        {
          label: 'Man, 1.78 m (75 kg), age 25, trainable potential 19.0 kg: typical vs optimal kg a month',
          value:
            'Training status 0: 0.75 / 1.39; 0.25: 0.56 / 1.01; 0.50: 0.37 / 0.65; 0.75: 0.19 / 0.31; 0.90: 0.07 / 0.12',
          note: 'Typical means 12 sets and 1.4 g/kg protein. Optimal means 20 sets, protein ≥ 1.6 g/kg and a +10 % surplus, which is 1.85 % of body weight a month at status 0. Typical rates are about 50–55 % of optimal.',
        },
        {
          label: 'Woman, 1.65 m (60 kg), age 25, trainable potential 11.7 kg: typical vs optimal kg a month',
          value: 'Training status 0: 0.46 / 0.86; 0.25: 0.35 / 0.62; 0.5: 0.23 / 0.40; 0.75: 0.12 / 0.19',
          note: "Relative rates come out about 0.87 × men's (grade C). Trials show similar relative hypertrophy in women and men.",
          referenceIds: ['roberts2020'],
        },
        {
          label: 'Simulated years at optimal (man, 1.78 m)',
          value: 'Year 1 ≈ +10.8–11.2 kg; year 2 ≈ +4.5; year 3 ≈ +1.9; year 4 ≈ +0.8 kg',
          note: 'Lean mass including water and glycogen associated with muscle.',
        },
        {
          label: 'Starting training status from years of training',
          value: '1 y: 0.37; 2 y: 0.61; 4 y: 0.85; 10 y: 0.99',
          note: 'Proposed. Labels: novice < 0.30, intermediate 0.30–0.65, advanced 0.65–0.90, near-ceiling > 0.90.',
        },
      ],
      timeCourse:
        'Gain rates fall year on year as the room left to grow shrinks: in the simulation about +11 kg in year 1 and less than 1 kg by year 4 at optimal conditions.',
      moderators:
        'Training status, dose, protein, energy balance, sex (through the ceiling), age and body size.',
      grade: 'C',
      gradeReason:
        'Absolute rates are grade B, the first-order approach to a ceiling is C and the ceiling size is D/C, so the model as a whole is graded C.',
      status: 'proposed-fit',
      caveats:
        "DXA and four-compartment lean mass includes water and glycogen, so trial gains are not all muscle. Programmes differed between studies. No multi-year trial follows natural lean gain up to a ceiling. Popular rules of thumb for gain rates are expert opinion, not data (grade D), and the model's typical and optimal columns are set to reconcile them with average trial results.",
      referenceIds: ['benito2020', 'morton2018', 'peterson2011', 'roberts2020'],
      relatedMetricIds: ['rtMuscleGain', 'trainingStatus'],
    },
    {
      id: '09-natural-muscle-ceiling',
      title: 'Is there a natural ceiling on lean mass?',
      category: 'body',
      summary:
        'Everyone has a limit to how much muscle training can add, set partly by genes. Vitals uses a proposed ceiling of 6.0 kg/m² of fat-free mass index above the untrained level for men (range 5–7) and 4.3 for women (range 3.3–5.3). Surveys suggest an index of about 25 is a soft ceiling for lean, drug-free men, but many athletes exceed it, especially with more body fat, so it is not a hard limit.',
      howModelled:
        "The trainable potential in kilograms is the ceiling index times height squared, shared across nine muscle regions. If someone's measured index is above the untrained reference plus the ceiling, the ceiling is raised so they count as an above-average responder.",
      equation:
        'G_pot = ΔFFMI_pot · h²  (kg of trainable lean mass above the untrained set-point)\nG_pot,r = w_r · G_pot\nFFMI = FFM / h² + 6.3 · (1.80 − h)  (height-normalised)',
      keyNumbers: [
        {
          label: 'ΔFFMI_pot, men',
          value: '6.0 kg/m² (range 5–7)',
          note: 'Proposed, grade D. It matches an untrained-to-ceiling span of about 19 → 25.',
        },
        {
          label: 'ΔFFMI_pot, women',
          value: '4.3 kg/m² (range 3.3–5.3)',
          note: 'Proposed, grade D.',
        },
        {
          label: '157 male athletes',
          value:
            'Non-users reached a “well-defined limit” of 25.0; 20 pre-steroid title winners averaged 25.4; many users exceeded 25 and some 30',
          referenceIds: ['kouri1995'],
        },
        {
          label: '235 NCAA football players (DXA)',
          value: '26.4 % exceeded 25; mean 23.7 ± 2.1; 97.5th percentile 28.1; maximum 31.7',
          referenceIds: ['trexler2017'],
        },
        {
          label: 'NCAA athletes (air displacement)',
          value: 'Throwers mean 25.7; overall men 21.5 ± 1.9, women 17.9 ± 1.8',
          referenceIds: ['magee2024'],
        },
        {
          label: 'Female athletes',
          value: '16.9 ± 1.7 (range 13.3–25.5)',
          referenceIds: ['blue2019'],
        },
      ],
      timeCourse: 'Not applicable; the ceiling is a fixed size for each person.',
      moderators:
        'Sex, height, body fat (the index rises with fat mass) and measurement method. Individual genetics dominate: the responder coefficient of variation is about 0.5.',
      grade: 'D',
      gradeReason:
        "Vitals' evidence review rates the ceiling magnitude D/C: it rests on surveys of athletes and expert rules of thumb rather than any trial that followed people to their limit.",
      status: 'proposed-fit',
      caveats:
        'An index of 25 is a soft, lean-state ceiling, not a hard cutoff (grade C), because the index rises with fat mass and differs by method.',
      referenceIds: ['kouri1995', 'trexler2017', 'magee2024', 'blue2019', 'forbes2000'],
      relatedMetricIds: ['trainingStatus', 'skeletalMuscle'],
    },
    {
      id: '09-sex-age-cycle',
      title: 'Sex, age and the menstrual cycle',
      category: 'body',
      summary:
        "Relative muscle growth is similar in women and men. Across 10 studies the difference was small (ES 0.07 ± 0.06, p = 0.31). Women's absolute gains are smaller because they start with less muscle. Older adults gain somewhat less. Menstrual phase and oral contraceptives have not been shown to change muscle adaptations.",
      howModelled:
        'There is no sex multiplier on the relative growth rate. Sex enters through the size of the ceiling and the smaller fat-free mass. Women get a ×1.1 boost to relative upper-body strength gain. The age factor is 1 up to age 40, then falls 0.86 % a year, with a floor of 0.6 (0.74 at 70). The menstrual-cycle and contraceptive factors are both 1.0.',
      equation: 'f_age = 1 for age ≤ 40\nf_age = max(0.6, 1 − 0.0086 · (age − 40)) for age > 40',
      keyNumbers: [
        {
          label: 'Sex, relative hypertrophy (10 studies)',
          value: 'ES 0.07 ± 0.06, p = 0.31',
          note: 'Upper-body relative strength favoured women (ES −0.60).',
          referenceIds: ['roberts2020'],
        },
        {
          label: '585 people, 12 wk, elbow flexors',
          value:
            'Muscle-area change −2 to +59 %; men +2.5 percentage points more area; women larger relative strength gains',
          referenceIds: ['hubal2005'],
        },
        {
          label: 'Adults 50 and over',
          value: 'Lean body mass +1.1 kg over 20.5 wk; age β = −0.03 (older gain less)',
          referenceIds: ['peterson2011'],
        },
        {
          label: '16 wk, 3 days a week',
          value:
            'Type II fibre growth +23 % in older vs +32 % in young adults; type I growth only in the young (+18 %)',
          referenceIds: ['kosek2006'],
        },
        {
          label: '287 untrained people aged 19–78',
          value: 'Size +4.8 ± 6.1 %; no age or sex effect on the relative response',
          referenceIds: ['ahtiainen2016'],
        },
        {
          label: 'Protein efficacy and age',
          value: 'Declines by −0.01 kg per year of age',
          referenceIds: ['morton2018'],
        },
        {
          label: 'Older-adult dose (9 studies)',
          value:
            'Best growth with 2–3 sets per exercise, 3 × a week, 7–9 reps, 51–69 %1RM; size SMD 0.42 vs strength 1.57',
          referenceIds: ['borde2015'],
        },
        {
          label: 'Oral contraceptives (8 studies, 325 women)',
          value: 'Hypertrophy 0.01 (−0.11, 0.13); strength 0.10 (−0.08, 0.28)',
          referenceIds: ['nolan2024'],
        },
        {
          label: 'f_age',
          value: '1 up to 40 y; 1 − 0.0086 × (age − 40) above 40; floor 0.6',
          note: 'Proposed from the older-to-young fibre-growth ratio of 0.72 and the lean-mass data.',
          referenceIds: ['kosek2006', 'peterson2011'],
        },
      ],
      timeCourse: 'Not applicable.',
      moderators:
        'Sex, age, training dose. Vitals keeps the sex, age and cycle effects in this module so that the sleep and age module does not apply them again.',
      grade: 'B',
      gradeReason:
        'Sex is grade A/B, age is B for direction and C for the functional form, and cycle and contraceptive effects are B (null).',
      status: 'proposed-fit',
      caveats:
        'One umbrella review judged it premature to conclude that menstrual phase changes strength or growth. A narrative review argued that follicular-phase-based training may be better, but it rests on few small trials. The age function is linear from 40, and the data are mostly 60–75 y against 20–35 y. Women are under-represented in most datasets.',
      referenceIds: [
        'roberts2020',
        'hubal2005',
        'peterson2011',
        'kosek2006',
        'ahtiainen2016',
        'morton2018',
        'borde2015',
        'colensosemple2023',
        'kissow2022',
        'nolan2024',
      ],
      relatedMetricIds: ['rtMuscleGain', 'strength'],
    },
    {
      id: '09-energy-balance-protein',
      title: 'Energy balance and protein change how much muscle you gain',
      category: 'body',
      summary:
        'An energy deficit impairs the lean-mass gains from training but not the strength gains. A meta-regression found that a deficit of about 500 kcal/day removes the average lean gain. In trained lifters a surplus helped little: energy beyond about +10 % went mainly to fat. More protein helps, with gains plateauing near 1.6 g/kg/day, and in trials higher protein during a deficit gave more lean-mass gain.',
      howModelled:
        'In a deficit, the gain multiplier falls linearly to zero at 30 % below maintenance, and protein rescues part of the loss. In a surplus, the boost is up to +15 % in less-trained people and saturates at +10 % extra energy. The protein multiplier is 0.44 at 0.8 g/kg and reaches 1.00 at 1.6 g/kg.',
      equation:
        'e = (EI − TDEE) / TDEE\nDeficit (e < 0): f_E = max(0, 1 + e / d0); f_EP = f_E + (1 − f_E) · ρ(P); ρ(P) = ρ_max · clamp((P − 1.2) / (2.2 − 1.2), 0, 1)\nSurplus (e ≥ 0): f_EP = 1 + b_s · (1 − TS_r) · min(e, e_sat) / e_sat\nProtein (all e): f_P(P) = 0.44 + 0.56 · clamp((P − 0.8) / (1.6 − 0.8), 0, 1)',
      keyNumbers: [
        {
          label: 'Deficit vs no deficit, meta-regression (52 matched studies)',
          value: 'Lean-mass gain impaired, ES −0.57 (p = 0.02); strength not (ES −0.31, p = 0.28)',
          note: 'Training plus deficit ES −0.11 vs training plus control +0.20. A deficit of about 500 kcal/d gives ES 0 (from the abstract). The slope of 0.031 ES per 100 kcal/d comes from a secondary summary because the full text was not accessed.',
          referenceIds: ['murphy2022'],
        },
        {
          label: 'Young men, 4 wk, −40 % energy, lifting plus HIIT 6 days a week, protein 2.4 vs 1.2 g/kg',
          value: 'Lean mass +1.2 ± 1.0 vs +0.1 ± 1.0 kg; fat −4.8 ± 1.6 vs −3.5 ± 1.4 kg',
          note: 'Group size 40 in total; baseline adiposity not verified.',
          referenceIds: ['longland2016'],
        },
        {
          label: 'Elite athletes, −0.7 %/wk (−19 % energy, 8.5 wk) vs −1.4 %/wk (−30 % energy, 5.3 wk)',
          value: 'Lean mass +2.1 ± 0.4 % vs −0.2 ± 0.7 %; both lost 5.5 % body weight',
          referenceIds: ['garthe2011'],
        },
        {
          label: 'Overweight women, 16 wk, protein 30 % vs 15 % of energy',
          value: 'High-protein, dairy group gained lean mass; low-dairy group lost lean mass',
          referenceIds: ['josse2011'],
        },
        {
          label: '17 trained lifters, 8 wk, maintenance vs +5 % vs +15 % intended surplus',
          value: 'Body mass +0.4 / +3.3 / +3.3 kg; no group effect on muscle thickness or squat',
          note: 'Larger body-mass gain meant larger skinfold gain (R² 0.49); weak link to biceps thickness (R² 0.24).',
          referenceIds: ['helms2023'],
        },
        {
          label: '39 elite athletes, 8–12 wk, counselled surplus (3 585 vs 2 964 kcal)',
          value: 'Body weight +3.9 vs +1.5 %; fat +15 vs +3 %; lean-mass gain not different',
          referenceIds: ['garthe2013'],
        },
        {
          label: '73 untrained men, 8 wk, +2 010 kcal/d supplement',
          value: 'Body mass +3.1 kg; fat-free mass +2.9–3.4 kg vs control',
          referenceIds: ['rozenek2002'],
        },
        {
          label: '21 trained men, 6 wk, overfeeding (target ≥ 0.45 kg/wk)',
          value: 'Fat-free mass +4.8 ± 2.6 %; about 0.55 % of body weight per week',
          note: 'All gain as fat-free mass on average, with wide scatter.',
          referenceIds: ['smith2021'],
        },
        {
          label: '11 bodybuilders, 4 wk, 67.5 vs 50.1 kcal/kg',
          value: 'Muscle +2.7 vs +1.1 %; fat +7.4 vs +0.8 %',
          referenceIds: ['ribeiro2019'],
        },
        {
          label: 'Off-season natural bodybuilders (review)',
          value:
            'Surplus about 10–20 %; gain 0.25–0.5 % of body weight per week (novice and intermediate), smaller for advanced',
          referenceIds: ['iraki2019'],
        },
        {
          label: 'Basal muscle protein synthesis in a deficit',
          value:
            '−27 % after 5 d at 30 kcal/kg fat-free mass; a lifting bout restores it; protein after lifting adds +16 % / +34 % with 15 / 30 g',
          referenceIds: ['areta2014'],
        },
        {
          label: 'Protein and lean gain, 49 trials',
          value:
            'Breakpoint 1.62 g/kg (95 % CI 1.03–2.20); +~0.3 g/kg/d (from ~1.3–1.4 to ~1.8) raised gain from 1.1 to 1.4 kg (+27 %)',
          referenceIds: ['morton2018'],
        },
        {
          label: 'd0 / ρ_max / b_s / e_sat',
          value: '0.30 (range 0.20–0.45) / 0.8 (0.5–1.0) / 0.15 / 0.10',
          note: 'Proposed fit. Chosen so the zero crossing sits near 500 kcal/d: simulated net lean change over 12 wk is about +0.2 kg at 500 kcal/d, −0.4 at 750 and −0.6 at 1 000.',
        },
        {
          label: 'f_P by protein intake',
          value: '0.8 g/kg: 0.44; 1.2: 0.72; 1.4: 0.86; ≥ 1.6: 1.00',
          note: 'The protein module may replace this function but should keep the plateau near 1.6 g/kg.',
          referenceIds: ['morton2018'],
        },
      ],
      timeCourse: 'Applied every day as multipliers on the gain rate.',
      moderators:
        'Training status (novices gain even at maintenance), protein intake, size of the deficit or surplus and body fat.',
      grade: 'B',
      gradeReason:
        'A deficit impairing lean gain but sparing strength is grade A, while the linear kcal dose-response, the protein rescue and the retention term are B and surplus effects are C.',
      status: 'proposed-fit',
      caveats:
        'The model under-predicts two trials: Longland (by about 0.7–1.0 kg, within 1 SD) and the slower loss rate in Garthe. The protein rescue may be stronger than assumed, or may partly reflect water shifts in the body-composition measures. Surplus effects rest on small studies and are grade C.',
      referenceIds: [
        'murphy2022',
        'longland2016',
        'garthe2011',
        'josse2011',
        'helms2023',
        'garthe2013',
        'rozenek2002',
        'smith2021',
        'ribeiro2019',
        'iraki2019',
        'areta2014',
        'morton2018',
      ],
      relatedMetricIds: ['rtMuscleGain', 'leanTissue'],
    },
    {
      id: '09-lean-retention-in-deficit',
      title: 'Lifting protects lean mass during weight loss',
      category: 'body',
      summary:
        'When people lose weight, some of what goes is lean tissue. Adding resistance training sharply cuts that share. In six trials of obese older adults, resistance training prevented 93.5 % of the lean-mass loss caused by calorie restriction. In another study, lean mass fell 2 % with resistance training against 5 % with aerobic exercise. Losing fat while gaining muscle is most likely in beginners, people returning to training, people with more body fat and high-protein conditions.',
      howModelled:
        'The body-weight model works out how much lean mass would be lost from the deficit alone. Lifting scales that loss down by a retention fraction of up to 0.75 (range 0.5–0.95), reached when weekly effective sets hit 6 (age 50 or under), rising to 10 (age 70 or over). Muscle gained through training is added on top.',
      equation:
        'ΔFFM_total/day = ΔFFM_nonRT · (1 − R_RT) [only when ΔFFM_nonRT < 0] + Σ_r A_r − Σ_r D_r\nR_RT = R_max · clamp(V_wb / V_R(age), 0, 1)\nR_max = 0.75\nV_R = 6 effective sets/wk (age ≤ 50) rising linearly to 10 (age ≥ 70)',
      keyNumbers: [
        {
          label: 'Diet only vs diet plus exercise, about −10 kg',
          value: 'Share lost as fat-free mass: men 28 ± 4 % vs 13 ± 6 %; women 24 ± 2 % vs 11 ± 3 %',
          note: 'This gives a retention fraction of about 0.54.',
          referenceIds: ['ballor1994'],
        },
        {
          label: '52 studies in adults 50 and over, mostly aerobic exercise',
          value:
            'At least 15 % of the loss was fat-free mass in 81 % of diet-only groups vs 39 % of diet-plus-exercise groups',
          referenceIds: ['weinheimer2010'],
        },
        {
          label: '6 trials, obese older adults, lifting 3 × a week for 12–24 wk',
          value:
            'Resistance training prevented 93.5 % of the restriction-induced lean loss (0.82 kg, 0.36–1.27)',
          note: 'A retention fraction of about 0.9.',
          referenceIds: ['sardeli2018'],
        },
        {
          label: '160 obese older adults, 6 months, −9 % body weight',
          value:
            'Lean mass −2 % (58.1 → 57.1 kg) with resistance training vs −5 % (55.0 → 52.3) with aerobic exercise',
          referenceIds: ['villareal2017'],
        },
        {
          label: '50–60 y, 12 months, restriction vs exercise-induced weight loss',
          value:
            'Lean −3.5 % vs −2.2 % (not significant); thigh muscle −6.9 % and knee strength −7.2 % in restriction only',
          referenceIds: ['weiss2007'],
        },
        {
          label: '66 studies in overfat adults',
          value: 'Diet plus lifting was best for fat-free mass retention (ES 0.40)',
          note: 'Compared with endurance or combined training.',
          referenceIds: ['clark2015'],
        },
        {
          label: 'R_max and V_R',
          value: 'R_max 0.75 (range 0.5–0.95); V_R 6 → 10 effective sets a week',
          note: 'V_R is proposed.',
        },
        {
          label: 'Model check',
          value:
            'R_RT 0.75 gives fat-free share × 0.25–0.5 (published range 24–28 % vs 11–13 %); resistance vs aerobic lean loss ratio 0.3 (observed 0.37)',
          referenceIds: ['ballor1994', 'villareal2017'],
        },
      ],
      timeCourse: 'Applied daily while a deficit is running.',
      moderators:
        'Body fat: leaner people lose a larger fraction of fat-free mass. Age sets the weekly dose needed for full retention. Recomposition is most likely in novices, detrained, higher-fat and high-protein conditions.',
      grade: 'B',
      gradeReason:
        'Several meta-analyses and randomised trials agree that adding lifting preserves lean mass, though the size varies by study.',
      status: 'proposed-fit',
      caveats:
        'A narrative review concludes recomposition is also possible in trained lifters with adequate protein and progressive training, but more slowly. The common “one quarter of weight loss is fat-free mass” rule has been critiqued.',
      referenceIds: [
        'ballor1994',
        'weinheimer2010',
        'sardeli2018',
        'villareal2017',
        'weiss2007',
        'clark2015',
        'cava2017',
        'heymsfield2014',
        'forbes2000',
        'hall2007',
        'longland2016',
        'barakat2020',
        'garthe2011',
        'josse2011',
      ],
      relatedMetricIds: ['leanTissue', 'skeletalMuscle'],
    },
    {
      id: '09-daily-accretion-update',
      title: 'The daily update: putting the factors together',
      category: 'body',
      summary:
        'Each day, for each muscle region, gain equals the maximum gain rate times a set of multipliers for weekly volume, frequency, protein, energy balance, age, habituation, muscle memory, regional responsiveness and individual response. Detraining loss is subtracted. The result is in kilograms of lean tissue, including the water and glycogen that come with new muscle.',
      howModelled:
        'The multipliers are described in the other articles in this topic. The sum across regions is handed to the body-weight model as the training gain. Skeletal muscle alone is estimated as about 0.7 times the fat-free mass change.',
      equation:
        'A_r = k_g · G_pot,r · (1 − TS_r) · f_V(V_r) · f_F(F_r) · f_P(P) · f_EP(e, P, TS_r) · f_age(age) · H_r · κ_mem,r · ρ_reg,r · f_sleep · f_alcohol · f_illness\ndM_acc,r/dt = A_r − D_r\nM_peak,r = max(M_peak,r, M_acc,r)\nTS_r = M_acc,r / G_pot,r (clamped 0 to 0.98)',
      keyNumbers: [
        {
          label:
            'Reference simulation, man 1.78 m, age 25, 10.4 wk at 12 sets, protein 1.4 g/kg, energy balance 0',
          value: 'Untrained +1.49 kg; training status 0.45: +0.99 kg',
          note: 'Proposed fit outputs.',
        },
        {
          label: 'Skeletal muscle vs fat-free mass',
          value: '≈ 0.7 × the fat-free mass change',
          note: 'Grade C. One meta-analysis found fat-free mass +1.56 kg and skeletal muscle +1.11 kg, from different sets of studies.',
          referenceIds: ['benito2020'],
        },
        {
          label: 'Validation: untrained and trained men, published vs model',
          value: 'Published +1.54 and +0.98 kg; model +1.49 and +0.99 kg (tolerance ±0.4 kg)',
          referenceIds: ['benito2020'],
        },
        {
          label: 'Validation: adults 50 and over',
          value: 'Published +1.1 kg; model +1.16 kg',
          referenceIds: ['peterson2011'],
        },
        {
          label: 'Validation: deficit and lean gain',
          value:
            'Model net lean change over 12 wk: 0 kcal/d +1.44 kg; 250 +0.83; 500 +0.22; 750 −0.41; 1 000 −0.58',
          note: "Published zero crossing at about 500 kcal/d; the model's is 500–700.",
          referenceIds: ['murphy2022'],
        },
        {
          label: 'Validation: weakest target, high vs low protein in a deficit',
          value: 'Published lean +1.2 vs +0.1 kg; model +0.2 to +0.6 vs −0.25 kg',
          note: 'Direction passes. Magnitude is under-predicted by about 0.7–1.0 kg, within 1 SD. The model assumed 25 kg starting fat mass, which is unverified.',
          referenceIds: ['longland2016'],
        },
        {
          label: 'Validation: slow vs fast weight loss in elite athletes',
          value: 'Published lean +2.1 % vs −0.2 %; model +0.7 % vs −0.2 %',
          referenceIds: ['garthe2011'],
        },
        {
          label: 'Validation: trained lifters, three surplus levels',
          value: 'Model fat-free mass +0.81 / 0.83 / 0.86 kg (at most 6 % difference)',
          referenceIds: ['helms2023'],
        },
        {
          label: 'Validation: high vs low weekly sets in trained men',
          value: 'Published high-to-low ratios 5.0 / 3.7 / 2.7; model 2.7 (arms) and 2.4 (legs)',
          note: 'A partial pass: the model follows a meta-regression that already includes this trial.',
          referenceIds: ['schoenfeld2019b'],
        },
        {
          label: 'Validation: novice swelling and growth',
          value: 'Published area +2.7 % at week 3 with swelling, +10.4 % at week 10',
          note: 'Qualitative pass.',
          referenceIds: ['damas2016a', 'seynnes2007'],
        },
      ],
      timeCourse:
        'Updated once per simulated day. Habituation, detraining and muscle memory carry over between days.',
      moderators: 'All of the factors in the equation, each described in its own article.',
      grade: 'C',
      gradeReason:
        'The integrated model is only as good as its parts, several of which are proposed fits, though it reproduces most published targets.',
      status: 'proposed-fit',
      caveats:
        'The regional and individual pieces are placeholders (grade D) until better body-shape data is built in. The integrated model reproduces most validation targets but is weakest for protein in a deficit.',
      referenceIds: [
        'benito2020',
        'peterson2011',
        'murphy2022',
        'longland2016',
        'garthe2011',
        'helms2023',
        'schoenfeld2019b',
        'damas2016a',
        'seynnes2007',
      ],
      relatedMetricIds: ['rtMuscleGain', 'skeletalMuscle', 'leanTissue'],
    },
    {
      id: '09-detraining-muscle-memory',
      title: 'Breaks, maintenance dose and muscle memory',
      category: 'body',
      summary:
        'A break of a few weeks costs little. In studies, 3-week breaks caused no significant loss of muscle size or 1RM, and after retraining the results matched continuous training. After 20 weeks off, muscle size had returned to baseline while strength stayed partly elevated. One third or one ninth of the original training dose kept the muscle gains in young adults for 32 weeks, but not in older adults. The evidence for lasting “muscle memory” is mixed.',
      howModelled:
        'Each region counts the consecutive days its weekly effective sets stay below a maintenance dose: 3 sets a week up to age 50, rising to 9 at age 70 and 10 above 75. There is no loss for about 2 weeks and the full loss rate applies after about 4 weeks. The trained-up muscle then decays with a time constant of 70 days (range 42–140). A regain boost of 1.3 × applies whenever muscle is below its previous peak.',
      equation:
        'V_maint(age) = 3 effective sets/wk for age ≤ 50; linear to 9 at age 70; 10 above 75\nT_low,r = consecutive days with V_r < V_maint(age); reset to 0 when V_r ≥ V_maint\nλ(T) = clamp((T − 14) / 14, 0, 1)\nD_r = λ(T_low,r) · (1 − min(1, V_r / V_maint)) · M_acc,r / τ_d\nτ_d = 70 d\nκ_mem,r = 1 + 0.3 · [M_acc,r < 0.95 · M_peak,r]',
      keyNumbers: [
        {
          label: '3-week breaks between training blocks',
          value:
            'No significant loss of area or 1RM; the 15- or 24-week outcomes equalled continuous training',
          note: 'Trained men who took 2 weeks off retained strength and lean mass.',
          referenceIds: ['ogasawara2013', 'ogasawara2011', 'hwang2017'],
        },
        {
          label: '10 wk one-leg training (area +17 %, thickness +10 %, strength +20 %) then 20 wk without',
          value: 'Thickness and area back to baseline; strength stayed partly elevated',
          note: 'The retraining response was no different from the untrained leg.',
          referenceIds: ['psilander2019'],
        },
        {
          label: '60 d of training (+8.5 % area) then 40 d without',
          value: 'Loss followed a time course similar to the gain',
          referenceIds: ['narici1989'],
        },
        {
          label: 'Older adults (6 studies)',
          value: 'Training d = +0.99; 12–24 wk detraining d = −0.60 (not significant); 31–52 wk d = −1.11',
          referenceIds: ['grgic2022'],
        },
        {
          label: 'Older men, 12 wk detraining',
          value:
            'Strength and power −5 to −15 %; type II fibre area −17 % (trend); less than 8 wk to regain 1RM',
          referenceIds: ['blocquiaux2020'],
        },
        {
          label: 'Strength loss with training cessation',
          value: 'Larger in older and inactive people; it grows with duration',
          referenceIds: ['bosquet2013'],
        },
        {
          label: 'Maintenance dose, 16 wk training then 32 wk at 1/3 or 1/9 of the dose',
          value:
            'Fibre growth kept in young (20–35 y) but not older (60–75 y) adults; 1/3 dose gave further growth in the young',
          note: 'The absolute weekly sets (roughly 3 for the knee extensors at 1/9 dose) are our reading of the protocol and are unverified.',
          referenceIds: ['bickel2011'],
        },
        {
          label: 'Myonuclei after 16 wk detraining',
          value: 'Retained (+33 % vs control in type 2 fibres) with no clear advantage on retraining',
          note: 'A meta-analysis found myonuclei not permanent in humans with atrophy; an epigenetic memory was also reported.',
          referenceIds: ['cumming2024', 'rahmati2022', 'seaborne2018', 'snijders2020'],
        },
        {
          label: 'τ_d and κ_mem',
          value: 'τ_d 70 d (range 42–140); κ_mem 1.3 (set to 1.0 for conservative runs)',
          note: 'Proposed fit. Model check: after 20 wk without training about 18 % of the training-attributable lean mass remains (target: back to baseline), and after 3 wk about 99 %.',
        },
      ],
      timeCourse:
        'No loss for about 2 weeks, the full loss rate from about 4 weeks, and a time constant of about 70 days after that. Regain is fast because lost muscle is easier to rebuild and because of the regain boost.',
      moderators:
        'Age (older adults need a higher maintenance dose and lose more), inactivity and length of break. Age-related loss of untrained muscle belongs to the sleep and age module.',
      grade: 'C',
      gradeReason:
        'The 3-week no-loss finding is grade B, but the loss time constant and the memory boost are C and rest on few small trials with conflicting results.',
      status: 'proposed-fit',
      caveats:
        'Human data on muscle memory conflict: one study kept myonuclei and no retraining advantage was clear, another meta-analysis found them not permanent. The time constant for older adults uses the same default because the data conflict.',
      referenceIds: [
        'ogasawara2013',
        'ogasawara2011',
        'hwang2017',
        'psilander2019',
        'narici1989',
        'grgic2022',
        'blocquiaux2020',
        'bosquet2013',
        'bickel2011',
        'cumming2024',
        'rahmati2022',
        'seaborne2018',
        'snijders2020',
      ],
      relatedMetricIds: ['rtMuscleGain', 'trainingStatus', 'strength'],
    },
    {
      id: '09-recovery-fatigue-deloads',
      title: 'Recovery, fatigue and deloads',
      category: 'recovery',
      summary:
        'Training to failure slows the recovery of jump height, bar speed and a muscle-damage marker (creatine kinase) by 24–48 h compared with stopping at half the possible repetitions, even at the same volume. Stopping 1–2 repetitions short of failure gave similar growth with less acute fatigue. A one-week break (a deload) in the middle of nine weeks of high-volume training did not change growth but slightly reduced strength gains.',
      howModelled:
        'A fatigue score per muscle region is used for the strength output only. Each effective set adds 0.02, times 1.5 if any set went to failure. Fatigue decays with a 2-day time constant (1.5 days if no set went to failure). Performance falls by the fatigue value, up to 30 %. Growth does not use this term.',
      equation:
        'Fat_r(t+1) = Fat_r(t) · exp(−1 / τ_fat) + c_fat · e_sets_r,today · (1 + 0.5 · [any set to failure])\nc_fat = 0.02 per effective set; τ_fat = 2 d (1.5 d if no failure sets)\nperformance multiplier for region r = 1 − min(0.3, Fat_r)',
      keyNumbers: [
        {
          label: 'Training to failure vs stopping at half the possible repetitions',
          value: 'Slower recovery of velocity, jump height and CK by 24–48 h, at matched volume',
          referenceIds: ['morannavarro2017'],
        },
        {
          label: '1–2 repetitions in reserve',
          value: 'Similar hypertrophy with less acute fatigue',
          referenceIds: ['refalo2024'],
        },
        {
          label: '1-week deload in the middle of 9 weeks of high-volume training',
          value: 'No change in hypertrophy; slightly reduced strength gains',
          referenceIds: ['coleman2024'],
        },
        {
          label: 'Sets per workout, meta-regression',
          value: '−0.03 kg per additional set per workout',
          note: 'A small negative moderator. The top volume tier (≥ 43 sets a week) is described as unclear.',
          referenceIds: ['benito2020', 'pelland2026'],
        },
        {
          label: 'c_fat and τ_fat',
          value: '0.02 per effective set; 2 d (1.5 d if no failure sets)',
          note: 'Proposed, grade D.',
        },
        {
          label: 'Planner rules',
          value:
            '≤ 10–12 effective sets per region per session for novices; weekly volume increases ≤ ~20 %/wk; 48 h between failure sessions for the same region',
          note: 'Proposed, grade C/D. Deloads are optional because they had no hypertrophy cost.',
          referenceIds: ['coleman2024'],
        },
      ],
      timeCourse:
        'Fatigue from a session fades over about 1.5–2 days in the model; failure sets slow recovery by 24–48 h in the data.',
      moderators: 'Whether sets go to failure, and volume per session.',
      grade: 'D',
      gradeReason:
        'The fatigue equation is a proposed grade D engine, and the planner rules are C/D, resting on a few single studies.',
      status: 'proposed-fit',
      caveats:
        'This term is used only for performance outputs. Recovery limits at very high volumes are not modelled beyond this fatigue proxy.',
      referenceIds: ['morannavarro2017', 'refalo2024', 'coleman2024', 'benito2020', 'pelland2026'],
      relatedMetricIds: ['strength'],
    },
    {
      id: '09-carbs-low-carb-cardio',
      title: 'Carbohydrate, very-low-carbohydrate diets and concurrent cardio',
      category: 'fuel',
      summary:
        'Higher carbohydrate did not improve strength performance in 13 of 19 acute studies, and had no long-term effect in 15 of 17 training studies. Benefits appeared mainly against fasted controls and in sessions above 10 sets per muscle group. In 13 trials of lifting on very-low-carbohydrate diets that raise blood ketones (often called ketogenic diets), fat-free mass ended 1.26 kg lower than on other diets. Adding aerobic training had no average effect on growth or maximal strength.',
      howModelled:
        'There is no direct low-carbohydrate multiplier on true hypertrophy (it is 1.0). Low carbohydrate acts through three routes: a 0.95 factor on late sets of high-volume fasted sessions, its effect on energy intake, and glycogen-bound water in reported lean mass. Concurrent cardio has a multiplier of 1.0 on hypertrophy. Protein timing has no multiplier once total protein is controlled.',
      keyNumbers: [
        {
          label: 'Systematic review of carbohydrate and strength training (49 studies)',
          value:
            'No strength benefit in 13 of 19 acute studies; no long-term effect in 15 of 17 training studies',
          note: 'Benefits were mainly against fasted controls and in sessions above 10 sets per muscle group.',
          referenceIds: ['henselmans2022'],
        },
        {
          label: 'Lifting plus very-low-carbohydrate diet, 13 trials, 244 people',
          value: 'Body mass −3.67 kg; fat −2.21 kg; fat-free mass −1.26 kg (−1.82 to −0.70) vs other diets',
          note: 'The fat-free mass difference plausibly includes glycogen-bound water and lower energy intake.',
          referenceIds: ['ashtarylarky2022'],
        },
        {
          label: 'Trained men, 8 wk, surplus',
          value: 'Lean mass −0.1 kg on the very-low-carbohydrate diet vs +1.3 kg on the comparison diet',
          referenceIds: ['vargas2018'],
        },
        {
          label: 'Natural bodybuilders, 2 months',
          value: 'Lean mass rose only on the comparison (mixed) diet; strength rose similarly',
          referenceIds: ['paoli2021'],
        },
        {
          label: 'Glycogen use per session',
          value:
            '6 sets of leg extension used 47 mmol/kg wet weight regardless of load when work was matched; a ~45 min session lowered fibre glycogen 23 % (type I) to 44 % (type IIx)',
          note: 'That is about 7.6 g glucose-equivalent per kg muscle, or ≈ 1.3 g/kg of trained muscle per set. The per-set hand-off is proposed.',
          referenceIds: ['robergs1991', 'koopman2006'],
        },
        {
          label: 'Concurrent aerobic plus strength training (43 studies)',
          value: 'Hypertrophy SMD −0.01 (−0.16, 0.18); maximal strength −0.06; explosive strength −0.28',
          note: 'Explosive strength was worse when both were done in the same session.',
          referenceIds: ['schumann2022'],
        },
        {
          label: 'Protein timing meta-analysis',
          value: 'No effect once total protein is controlled',
          referenceIds: ['schoenfeld2013'],
        },
      ],
      timeCourse: 'Not modelled as a time course; the effects are multipliers on daily gain.',
      moderators:
        'Session volume (benefits of carbohydrate show mainly above 10 sets), fasting status and energy intake.',
      grade: 'C',
      gradeReason:
        'The engine sets no low-carbohydrate multiplier because the data are mixed. The concurrent-training null is grade A, while the low-carbohydrate findings are C.',
      status: 'contested',
      caveats:
        'Lean gain may be blunted on very-low-carbohydrate diets in two small trials, but part of the fat-free mass difference is water and lower energy intake. The explosive-strength penalty of concurrent cardio is handled in the performance topic.',
      referenceIds: [
        'henselmans2022',
        'ashtarylarky2022',
        'vargas2018',
        'paoli2021',
        'robergs1991',
        'koopman2006',
        'schumann2022',
        'schoenfeld2013',
      ],
      relatedMetricIds: ['rtMuscleGain'],
    },
    {
      id: '09-session-energy-cost',
      title: 'Energy cost of a lifting session',
      category: 'energy',
      summary:
        'A lifting session burns roughly 3.5 to 6 times resting energy use, depending on style, with rest periods included. That multiple is called a MET. For an 80 kg person, a 60-minute session at 3.5 METs costs about 200 kcal above rest, and at 6.0 METs about 400 kcal. Resting energy use stayed about 5 % higher for up to 72 h in small studies of novices.',
      howModelled:
        'Net energy is (MET − 1) × body mass × hours. If only sets are given, each set is assumed to take 2.5 minutes including rest. A post-exercise lift of 5 % in resting energy use applies for up to 72 h after a session, scaled down in trained people, and does not add up across sessions.',
      equation:
        'EE_session,net (kcal) = (MET − 1) · BM(kg) · duration(h)\nDefault duration if only sets are given: 2.5 min per set including rest\nΔREE = 0.05 · REE · (1 − 0.5 · H_wb) while a session occurred in the last 72 h (not additive across sessions)',
      keyNumbers: [
        {
          label: 'Resistance training, multiple exercises, 8–15 reps at varied resistance',
          value: '3.5 METs',
          referenceIds: ['herrmann2024'],
        },
        {
          label: 'Squats, deadlift, slow or explosive effort',
          value: '5.0 METs',
          referenceIds: ['herrmann2024'],
        },
        {
          label: 'Power lifting or body building, vigorous',
          value: '6.0 METs',
          referenceIds: ['herrmann2024'],
        },
        {
          label: 'Circuit, reciprocal supersets',
          value: '5.8 METs',
          referenceIds: ['herrmann2024'],
        },
        {
          label: 'Body-weight resistance exercises, general / high intensity',
          value: '3.0 / 6.5 METs',
          referenceIds: ['herrmann2024'],
        },
        {
          label: 'Worked example, 80 kg, 60 min',
          value: '3.5 METs → 200 kcal net; 6.0 METs → 400 kcal net',
        },
        {
          label: 'Single exercises',
          value:
            'About 3–10 kcal/min at low intensity and more than 20 kcal/min for 80 %1RM leg work; reported range 3–30 (up to 40) kcal/min during exercise itself',
          referenceIds: ['reis2017', 'reis2011'],
        },
        {
          label: 'Post-exercise resting energy use',
          value:
            '+~5 % (~400 kJ ≈ 96 kcal/d) at 24, 48 and 72 h after a one-set (≈ 15 min) or three-set (≈ 35 min) whole-body session',
          note: 'In overweight young adults. Extra oxygen use was measurable up to 38 h after a heavy 31-minute circuit.',
          referenceIds: ['heden2011', 'schuenke2002'],
        },
      ],
      timeCourse:
        'The raised resting energy use lasts up to 72 h after a session and does not stack across sessions.',
      moderators:
        'Style of training, body mass, and training status (the post-exercise lift is scaled down in trained people).',
      grade: 'B',
      gradeReason:
        'MET values are grade A/B because they come from a compendium; the post-exercise resting energy effect is C, from small studies in novices.',
      status: 'established',
      caveats:
        'The 2.5 minutes per set default and the post-exercise rise scaling are proposed (grade D and C). The post-exercise effect in trained people is poorly quantified, and there is a risk of double counting with the energy-expenditure module.',
      referenceIds: ['herrmann2024', 'reis2017', 'reis2011', 'heden2011', 'schuenke2002'],
      relatedMetricIds: ['exerciseEE', 'tdee'],
    },
    {
      id: '09-strength-neural-drive',
      title: 'Strength: neural drive and muscle size',
      category: 'performance',
      summary:
        'Strength rises before muscle size does, because the nervous system learns to recruit the muscle better. In one study, agonist neural drive (30.6 %), quadriceps volume (18.7 %) and starting strength (10.6 %) together explained about 60 % of the variance in individual strength gains. Strength gains are specific to the load used, saturate at low volume, rise with frequency, are kept in a deficit and are largely retained during breaks.',
      howModelled:
        'Strength equals baseline times (1 + a neural share) times the muscle-size ratio times (1 − fatigue). The neural share rises toward a maximum (0.25 in novices, about 0.10 in advanced trainees) with a 21-day time constant while training, and decays with a 280-day time constant otherwise. Heavier loads give a bigger neural gain.',
      equation:
        'Str_r / Str_r0 = (1 + N) · (M_r / M_r0)^α · (1 − Fat_acute), α = 1.0\ndN/dt = (N_max · h_S(V_S) · f_loadS · f_FS(F) − N) / τ_N,up if trained this week; otherwise dN/dt = −N / τ_N,off\nN_max = 0.05 + 0.20 · (1 − TS)\nh_S(V) = (exp(0.14635 · V / (V + 1)) − 1) / (exp(0.14635 · 12/13) − 1)\nf_loadS = 1.0 (≥ 80 %1RM), 0.85 (60–80 %), 0.65 (< 60 %)\nτ_N,up = 21 d; τ_N,off = 280 d',
      keyNumbers: [
        {
          label: 'Sources of individual strength gain',
          value:
            'Neural drive 30.6 %, quadriceps volume 18.7 %, baseline strength 10.6 % of variance (about 60 % together)',
          referenceIds: ['balshaw2017'],
        },
        {
          label: '9 wk of training',
          value:
            'Maximal voluntary contraction +26 ± 11 %; muscle cross-section +6 ± 4 %; specific tension +17 ± 11 %',
          referenceIds: ['erskine2010'],
        },
        {
          label: 'Load specificity',
          value: 'High and moderate loads beat low load: SMD 0.60–0.63 and 0.34–0.35',
          referenceIds: ['lopez2021'],
        },
        {
          label: 'Untrained people, typical programmes',
          value: '+21.1 ± 11.5 %',
          referenceIds: ['ahtiainen2016'],
        },
        {
          label: 'Early neural change (35 d)',
          value: 'MVC +38.9 %; EMG +34.8 %',
          referenceIds: ['seynnes2007'],
        },
        {
          label: 'N_max',
          value: '0.05 + 0.20 × (1 − TS): novice 0.25; advanced about 0.10',
          note: 'Proposed.',
        },
        {
          label: 'τ_N,up / τ_N,off',
          value: '21 d / 280 d',
          note: 'Proposed from the early-strength, detraining and time-course studies.',
          referenceIds: ['seynnes2007', 'psilander2019', 'abe2000'],
        },
        {
          label: 'Model check, novice, 12 wk, 12 sets, heavy loads',
          value: 'N ≈ 0.245, muscle +5 % → strength +31 %',
          note: 'Data: 19–27 % gain in 1RM at 12 wk and MVC +26 % at 9 wk, so the model overshoots.',
          referenceIds: ['abe2000', 'erskine2010'],
        },
      ],
      timeCourse:
        'Neural gains build with a 21-day time constant and fade with a 280-day one, so most of the strength gain is retained through breaks.',
      moderators: 'Load, volume, frequency, training status, and acute fatigue.',
      grade: 'B',
      gradeReason: 'The direction and the retention are grade B, and the parameters are grade C.',
      status: 'proposed-fit',
      caveats:
        'The exponent α = 1.0 (force proportional to area) is unverified. One paper argues that muscle-size change contributes little to strength change. The model check gives +31 % against published gains of 19–27 %.',
      referenceIds: [
        'balshaw2017',
        'erskine2010',
        'loenneke2019',
        'lopez2021',
        'ahtiainen2016',
        'abe2000',
        'seynnes2007',
        'psilander2019',
      ],
      relatedMetricIds: ['strength'],
    },
    {
      id: '09-regional-hypertrophy',
      title: 'Where muscle grows first',
      category: 'body',
      summary:
        'Upper-body muscle grows faster and earlier than lower-body muscle in beginners. Over 12 weeks men gained +12–21 % in upper-body muscle thickness against +7–9 % in the lower body. Growth is also uneven along a muscle. Vitals splits trainable muscle into nine regions to drive the avatar, using placeholder weights.',
      howModelled:
        'Each of nine regions has a share of trainable muscle and a novice responsiveness, up to 1.3 for chest, shoulders and arms and 0.8 for calves. The advantage fades to 1.0 as training status rises. Limb girth change scales with the square root of area.',
      equation:
        'ρ_reg,r(TS_r) = 1 + (ρ_reg,r,novice − 1) · (1 − TS_r)\nΔC / C ≈ 0.5 · φ_m · ΔM_r / M_r  (φ_m = muscle fraction of the limb cross-section)',
      keyNumbers: [
        {
          label: 'Novices, 12 wk, muscle thickness',
          value: 'Men +12–21 % upper vs +7–9 % lower; women +10–31 % vs +7–8 %',
          note: 'Chest and triceps were significant by week 6.',
          referenceIds: ['abe2000'],
        },
        {
          label: 'Quadriceps',
          value: 'Growth greatest distally at 2/10 femur length (+12 %) vs +3.5 % proximally',
          referenceIds: ['narici1989'],
        },
        {
          label: 'Growth along a muscle',
          value: 'Non-uniform and related to region-specific activation',
          referenceIds: ['wakahara2013'],
        },
        {
          label: 'Men vs women, skeletal muscle',
          value:
            'Men have 40 % more upper-body and 33 % more lower-body muscle; ageing losses are mainly lower-body after the fifth decade',
          referenceIds: ['janssen2000'],
        },
        {
          label: 'Region shares (w_r) and novice responsiveness',
          value:
            'Chest 0.08 / 1.3; upper back and erectors 0.17 / 1.2; shoulders 0.07 / 1.3; arms 0.10 / 1.3; core 0.06 / 1.0; glutes 0.12 / 1.0; quadriceps 0.20 / 1.0; hamstrings and adductors 0.14 / 1.0; calves 0.06 / 0.8',
          note: 'Proposed, grade D. The calf value is unverified. These are due to be replaced by a reference body-shape distribution.',
        },
      ],
      timeCourse: 'Upper-body responsiveness fades as training status rises.',
      moderators: 'Training status, sex and age.',
      grade: 'B',
      gradeReason:
        'The faster early upper-body response is grade B; the region weights and girth mapping are grade D placeholders.',
      status: 'proposed-fit',
      caveats: 'The region weights and the girth mapping are placeholders, not measured values.',
      referenceIds: ['abe2000', 'narici1989', 'wakahara2013', 'janssen2000'],
      relatedMetricIds: ['rtMuscleGain', 'skeletalMuscle'],
    },
    {
      id: '09-individual-variability',
      title: 'How much people differ',
      category: 'body',
      summary:
        'Two people on the same programme can get very different results. In 585 adults after 12 weeks, muscle cross-sectional area changed from −2 % to +59 %, and 1RM from 0 to +250 %. In another study 29 % were low responders for size. Vitals shows this as a likely range around each projection.',
      howModelled:
        'Each simulated person gets a multiplier on their gain rate, drawn from a log-normal distribution with σ = 0.45. The 10th to 90th percentile band spans ×0.56 to ×1.78.',
      equation: 'u ~ LogNormal(0, σ = 0.45), applied to A_r',
      keyNumbers: [
        {
          label: '585 adults, 12 wk',
          value:
            'Muscle area −2 to +59 %; 1RM 0 to +250 %; coefficient of variation of area change 0.48 (men) / 0.51 (women)',
          referenceIds: ['hubal2005'],
        },
        {
          label: '287 untrained people aged 19–78',
          value:
            'Size +4.8 ± 6.1 % (range −11 to +30 %); strength +21.1 ± 11.5 %; 29 % low responders for size vs controls',
          referenceIds: ['ahtiainen2016'],
        },
        {
          label: '66 adults, 16 wk',
          value:
            'Extreme / modest / non-responders +2 475 / +1 111 / −16 µm² of fibre growth (17 / 32 / 17 people)',
          referenceIds: ['bamman2007'],
        },
        {
          label: 'σ for the individual multiplier',
          value: '0.45 (band ×0.56 to ×1.78)',
          note: 'Proposed from a coefficient of variation of about 0.5.',
        },
      ],
      timeCourse: 'Not applicable.',
      moderators: 'Individual genetics dominate; sex and age are handled elsewhere.',
      grade: 'B',
      gradeReason:
        'Three human cohorts and trials agree on wide variation, and the band width follows from their spread.',
      status: 'proposed-fit',
      caveats:
        'The multiplier is proposed from a coefficient of variation of about 0.5, and applied per simulated person. Responder groups depend on how they are defined.',
      referenceIds: ['hubal2005', 'ahtiainen2016', 'bamman2007'],
      relatedMetricIds: ['rtMuscleGain'],
    },
  ],
  myths: [
    {
      id: '09-myth-surplus-needed',
      claim: 'You must eat in a surplus to build muscle.',
      verdict: 'oversimplified',
      explanation:
        'Beginners gain muscle at maintenance: in a meta-analysis of men not in a deficit, fat-free mass rose about 1.5 kg in 10 weeks. Trained lifters showed no muscle-thickness benefit from +5–15 % surpluses over 8 weeks, only more fat. Small surpluses may help advanced lifters a little.',
      referenceIds: ['benito2020', 'helms2023', 'garthe2013', 'slater2019', 'iraki2019'],
    },
    {
      id: '09-myth-no-gain-in-deficit',
      claim: 'You cannot gain muscle in a calorie deficit.',
      verdict: 'oversimplified',
      explanation:
        'On average deficits impair gains, and about 500 kcal a day removes them. But beginners, people with more body fat and high-protein conditions can gain lean mass while losing fat.',
      referenceIds: ['murphy2022', 'longland2016', 'barakat2020', 'garthe2011', 'josse2011'],
    },
    {
      id: '09-myth-more-volume-always-better',
      claim: 'More volume is always better, or there is a hard optimum of 10–20 sets.',
      verdict: 'oversimplified',
      explanation:
        'In pooled data returns diminish with no clear plateau up to about 40 sets a week. Individual trials in trained people disagree: one found 30–45 sets better than fewer, another found 12 and 24 sets equal. About 12–20 sets is a reasonable default.',
      referenceIds: ['pelland2026', 'schoenfeld2019b', 'aube2022', 'bazvalle2022'],
    },
    {
      id: '09-myth-every-set-to-failure',
      claim: 'Every set must go to failure.',
      verdict: 'not-supported',
      explanation:
        'Failure versus non-failure training had a trivial effect (ES 0.19 for any definition, 0.12 not significant for momentary failure). In trained people, 1–2 repetitions in reserve gave similar quadriceps growth, and failure slows recovery. Stopping very far from failure, 5–10 repetitions or more, does reduce growth.',
      referenceIds: ['refalo2023', 'refalo2024', 'morannavarro2017', 'robinson2024'],
    },
    {
      id: '09-myth-heavy-for-size-light-for-tone',
      claim: 'Heavy weights build size and light weights give tone.',
      verdict: 'oversimplified',
      explanation:
        'Growth was similar from about 30 % to about 90 % of 1RM when sets were hard. Very light loads at 20 % were sub-optimal. Heavy loads matter for maximal strength.',
      referenceIds: ['schoenfeld2017b', 'lopez2021', 'morton2016', 'lasevicius2018'],
    },
    {
      id: '09-myth-train-each-muscle-2-3-times',
      claim: 'Train each muscle 2–3 times a week for growth.',
      verdict: 'oversimplified',
      explanation:
        'When weekly volume is equal, frequency has little or no effect on growth. Frequency helps strength.',
      referenceIds: ['pelland2026', 'schoenfeld2019a'],
    },
    {
      id: '09-myth-post-workout-hormone-spikes',
      claim: 'Post-workout hormone spikes drive growth.',
      verdict: 'not-supported',
      explanation:
        'Short-lived rises in hormones in the blood after training were unrelated to growth or strength gains in trained men.',
      referenceIds: ['morton2016'],
    },
    {
      id: '09-myth-anabolic-window',
      claim: 'The anabolic window closes 30–60 minutes after training.',
      verdict: 'not-supported',
      explanation:
        'The effect of protein timing disappears once total protein is taken into account. Muscle protein synthesis also stays raised for 24–48 h in untrained muscle.',
      referenceIds: ['schoenfeld2013', 'macdougall1995', 'chesley1992', 'phillips1997'],
    },
    {
      id: '09-myth-early-gains-are-muscle',
      claim: 'Early size gains in beginners are muscle.',
      verdict: 'oversimplified',
      explanation:
        'The first 3–4 weeks include a substantial amount of swelling. Fibre growth appeared later in one study.',
      referenceIds: ['damas2016a', 'damas2016b'],
    },
    {
      id: '09-myth-muscle-memory-permanent-nuclei',
      claim: 'Muscle memory means the muscle keeps its extra nuclei for good.',
      verdict: 'unproven',
      explanation:
        'One study found the extra nuclei retained after 16 weeks of detraining, but a meta-analysis found they were not permanent in human atrophy studies. A retraining advantage is unclear in humans, though epigenetic evidence exists.',
      referenceIds: ['cumming2024', 'rahmati2022', 'psilander2019', 'seaborne2018'],
    },
    {
      id: '09-myth-ffmi-25-hard-limit',
      claim: 'A fat-free mass index of 25 is a hard natural limit.',
      verdict: 'not-supported',
      explanation:
        'It is a soft ceiling for lean, drug-free physique athletes. Heavier athletes with more fat exceed it: 26.4 % of college football players were above 25, with a maximum of 31.7.',
      referenceIds: ['kouri1995', 'trexler2017'],
    },
    {
      id: '09-myth-women-bulky-respond-differently',
      claim: 'Women get bulky, or respond to training very differently from men.',
      verdict: 'not-supported',
      explanation:
        'Relative hypertrophy is similar (ES 0.07), absolute gains are smaller because women have less muscle to start, and relative strength gains are similar or larger. Menstrual phase and oral contraceptives have no demonstrated effect on adaptations.',
      referenceIds: ['roberts2020', 'hubal2005', 'colensosemple2023', 'nolan2024'],
    },
    {
      id: '09-myth-ketogenic-destroys-muscle',
      claim: 'Very-low-carbohydrate (ketogenic) diets destroy muscle.',
      verdict: 'oversimplified',
      explanation:
        'Fat-free mass was 1.26 kg lower than on other diets when lifting, but part of that is glycogen-bound water and lower energy intake, and strength gains were similar. Lean gain may be blunted in some trials (grade C).',
      referenceIds: ['ashtarylarky2022', 'paoli2021', 'vargas2018'],
    },
    {
      id: '09-myth-cardio-kills-gains',
      claim: 'Cardio kills gains.',
      verdict: 'oversimplified',
      explanation:
        'On average there was no interference with growth or maximal strength. Explosive strength was slightly impaired, more so when both are done in the same session.',
      referenceIds: ['schumann2022'],
    },
    {
      id: '09-myth-muscle-turns-to-fat',
      claim: 'Muscle turns into fat when you stop training.',
      verdict: 'not-supported',
      explanation:
        'They are different tissues. Training-attributable muscle is kept for about 2–3 weeks, then decays toward baseline over months, while fat changes with energy balance.',
      referenceIds: ['ogasawara2013', 'ogasawara2011', 'hwang2017', 'psilander2019', 'grgic2022'],
    },
  ],
  openQuestions: [
    'How large is the natural ceiling? The proposed 6.0 kg/m² for men and 4.3 for women rests on surveys and rules of thumb, and individual genetics dominate (responder variation about 0.5). This is grade D.',
    'Does gain really approach the ceiling as a single smooth rate (0.55 per year)? That is a fit to trial averages of 10–20 weeks and to multi-year rules of thumb. No multi-year trial tracks natural lean gain up to the ceiling.',
    'What happens above 25–30 sets a week? The square-root curve is extrapolated there with wide intervals, and recovery limits are modelled only by a fatigue proxy.',
    'How strong is the protein rescue in a deficit? Two trials (Longland and Garthe) are under-predicted, and the true effect may be stronger or may partly reflect water shifts in the body-composition measures.',
    'How much of a change in fat-free mass is muscle? DXA and four-compartment lean mass includes water and glycogen, so trial gains, and losses on very-low-carbohydrate diets, are partly fluid. The 0.7 skeletal-muscle fraction is weakly supported.',
    'How accurate is self-reported effort? Repetitions in reserve were estimated, not measured, in the meta-regression, and people under-estimate how many they have left.',
    'How fast is detraining and how big is any muscle-memory boost? The 70-day time constant and the 1.3× boost rest on a few small trials with conflicting results.',
    'Is the age effect linear from 40? Most data compare people aged 60–75 with people aged 20–35.',
    'What about women? They are under-represented in most datasets (20.9 % of the main meta-regression), so ceilings and rates for women are the least certain.',
    'Does the post-exercise MPS curve matter for growth? It comes from four small tracer studies and does not integrate to predict growth, so it is used only for display and for the link to the protein module.',
    'How should regional muscle shares be set? The regional weights and responsiveness for the avatar are placeholders until better body-shape data is built in.',
    'How large is the post-exercise rise in resting energy use in trained people? It is poorly quantified, with a risk of double counting with the energy-expenditure module.',
  ],
  references: [
    {
      id: 'schoenfeld2017a',
      authors: 'Schoenfeld BJ, Ogborn D, Krieger JW.',
      year: 2017,
      title:
        'Dose-response relationship between weekly resistance training volume and increases in muscle mass: a systematic review and meta-analysis',
      journal: 'J Sports Sci',
      pmid: '27433992',
      doi: '10.1080/02640414.2016.1210197',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27433992/',
    },
    {
      id: 'bazvalle2022',
      authors: 'Baz-Valle E, Balsalobre-Fernández C, Alix-Fages C, Santos-Concejero J.',
      year: 2022,
      title:
        'A systematic review of the effects of different resistance training volumes on muscle hypertrophy',
      journal: 'J Hum Kinet',
      pmid: '35291645',
      doi: '10.2478/hukin-2022-0017',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35291645/',
    },
    {
      id: 'pelland2026',
      authors: 'Pelland JC, Remmert JF, Robinson ZP, Hinson SR, Zourdos MC.',
      year: 2026,
      title:
        'The resistance training dose response: meta-regressions exploring the effects of weekly volume and frequency on muscle hypertrophy and strength gains',
      journal: 'Sports Med',
      pmid: '41343037',
      doi: '10.1007/s40279-025-02344-w',
      url: 'https://pubmed.ncbi.nlm.nih.gov/41343037/',
    },
    {
      id: 'bickel2011',
      authors: 'Bickel CS, Cross JM, Bamman MM.',
      year: 2011,
      title: 'Exercise dosing to retain resistance training adaptations in young and older adults',
      journal: 'Med Sci Sports Exerc',
      pmid: '21131862',
      doi: '10.1249/MSS.0b013e318207c15d',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21131862/',
    },
    {
      id: 'schoenfeld2016',
      authors: 'Schoenfeld BJ, Ogborn D, Krieger JW.',
      year: 2016,
      title:
        'Effects of resistance training frequency on measures of muscle hypertrophy: a systematic review and meta-analysis',
      journal: 'Sports Med',
      pmid: '27102172',
      doi: '10.1007/s40279-016-0543-8',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27102172/',
    },
    {
      id: 'schoenfeld2019a',
      authors: 'Schoenfeld BJ, Grgic J, Krieger J.',
      year: 2019,
      title: 'How many times per week should a muscle be trained to maximize muscle hypertrophy?',
      journal: 'J Sports Sci',
      pmid: '30558493',
      doi: '10.1080/02640414.2018.1555906',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30558493/',
    },
    {
      id: 'schoenfeld2017b',
      authors: 'Schoenfeld BJ, Grgic J, Ogborn D, Krieger JW.',
      year: 2017,
      title:
        'Strength and hypertrophy adaptations between low- vs. high-load resistance training: a systematic review and meta-analysis',
      journal: 'J Strength Cond Res',
      pmid: '28834797',
      doi: '10.1519/JSC.0000000000002200',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28834797/',
    },
    {
      id: 'lopez2021',
      authors: 'Lopez P, Radaelli R, Taaffe DR, et al.',
      year: 2021,
      title:
        'Resistance training load effects on muscle hypertrophy and strength gain: systematic review and network meta-analysis',
      journal: 'Med Sci Sports Exerc',
      pmid: '33433148',
      doi: '10.1249/MSS.0000000000002585',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33433148/',
    },
    {
      id: 'robinson2024',
      authors: 'Robinson ZP, Pelland JC, Remmert JF, et al.',
      year: 2024,
      title:
        'Exploring the dose-response relationship between estimated resistance training proximity to failure, strength gain, and muscle hypertrophy: a series of meta-regressions',
      journal: 'Sports Med',
      pmid: '38970765',
      doi: '10.1007/s40279-024-02069-2',
      url: 'https://pubmed.ncbi.nlm.nih.gov/38970765/',
    },
    {
      id: 'refalo2023',
      authors: 'Refalo MC, Helms ER, Trexler ET, Hamilton DL, Fyfe JJ.',
      year: 2023,
      title:
        'Influence of resistance training proximity-to-failure on skeletal muscle hypertrophy: a systematic review with meta-analysis',
      journal: 'Sports Med',
      pmid: '36334240',
      doi: '10.1007/s40279-022-01784-y',
      url: 'https://pubmed.ncbi.nlm.nih.gov/36334240/',
    },
    {
      id: 'refalo2024',
      authors: 'Refalo MC, Helms ER, Robinson ZP, Hamilton DL, Fyfe JJ.',
      year: 2024,
      title:
        'Similar muscle hypertrophy following eight weeks of resistance training to momentary muscular failure or with repetitions-in-reserve in resistance-trained individuals',
      journal: 'J Sports Sci',
      pmid: '38393985',
      doi: '10.1080/02640414.2024.2321021',
      url: 'https://pubmed.ncbi.nlm.nih.gov/38393985/',
    },
    {
      id: 'singer2024',
      authors: 'Singer A, Wolf M, Generoso L, et al.',
      year: 2024,
      title:
        'Give it a rest: a systematic review with Bayesian meta-analysis on the effect of inter-set rest interval duration on muscle hypertrophy',
      journal: 'Front Sports Act Living',
      pmid: '39205815',
      doi: '10.3389/fspor.2024.1429789',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39205815/',
    },
    {
      id: 'currier2026',
      authors: "Currier BS, D'Souza AC, Singh MAF, et al.",
      year: 2026,
      title:
        'American College of Sports Medicine Position Stand. Resistance training prescription for muscle function, hypertrophy, and physical performance in healthy adults: an overview of reviews',
      journal: 'Med Sci Sports Exerc',
      pmid: '41843416',
      doi: '10.1249/MSS.0000000000003897',
      url: 'https://pubmed.ncbi.nlm.nih.gov/41843416/',
    },
    {
      id: 'pallares2021',
      authors: 'Pallarés JG, Hernández-Belmonte A, Martínez-Cava A, et al.',
      year: 2021,
      title:
        'Effects of range of motion on resistance training adaptations: a systematic review and meta-analysis',
      journal: 'Scand J Med Sci Sports',
      pmid: '34170576',
      doi: '10.1111/sms.14006',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34170576/',
    },
    {
      id: 'wolf2023',
      authors: 'Wolf M, Androulakis-Korakakis P, Fisher J, Schoenfeld B, et al.',
      year: 2023,
      title: 'Partial vs full range of motion resistance training: a systematic review and meta-analysis',
      journal: 'Int J Strength Cond',
      doi: '10.47206/ijsc.v3i1.182',
      url: 'https://journal.iusca.org/index.php/Journal/article/view/182',
    },
    {
      id: 'maeo2021',
      authors: 'Maeo S, Huang M, Wu Y, et al.',
      year: 2021,
      title:
        'Greater hamstrings muscle hypertrophy but similar damage protection after training at long versus short muscle lengths',
      journal: 'Med Sci Sports Exerc',
      pmid: '33009197',
      doi: '10.1249/MSS.0000000000002523',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33009197/',
    },
    {
      id: 'maeo2023',
      authors: 'Maeo S, Wu Y, Huang M, et al.',
      year: 2023,
      title:
        'Triceps brachii hypertrophy is substantially greater after elbow extension training performed in the overhead versus neutral arm position',
      journal: 'Eur J Sport Sci',
      pmid: '35819335',
      doi: '10.1080/17461391.2022.2100279',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35819335/',
    },
    {
      id: 'pedrosa2022',
      authors: 'Pedrosa GF, Lima FV, Schoenfeld BJ, et al.',
      year: 2022,
      title:
        'Partial range of motion training elicits favorable improvements in muscular adaptations when carried out at long muscle lengths',
      journal: 'Eur J Sport Sci',
      pmid: '33977835',
      doi: '10.1080/17461391.2021.1927199',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33977835/',
    },
    {
      id: 'lasevicius2018',
      authors: 'Lasevicius T, Ugrinowitsch C, Schoenfeld BJ, et al.',
      year: 2018,
      title:
        'Effects of different intensities of resistance training with equated volume load on muscle strength and hypertrophy',
      journal: 'Eur J Sport Sci',
      pmid: '29564973',
      doi: '10.1080/17461391.2018.1450898',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29564973/',
    },
    {
      id: 'benito2020',
      authors: 'Benito PJ, Cupeiro R, Ramos-Campo DJ, Alcaraz PE, Rubio-Arias JÁ.',
      year: 2020,
      title:
        'A systematic review with meta-analysis of the effect of resistance training on whole-body muscle growth in healthy adult males',
      journal: 'Int J Environ Res Public Health',
      pmid: '32079265',
      doi: '10.3390/ijerph17041285',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7068252/',
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
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5867436/',
    },
    {
      id: 'roberts2020',
      authors: 'Roberts BM, Nuckols G, Krieger JW.',
      year: 2020,
      title: 'Sex differences in resistance training: a systematic review and meta-analysis',
      journal: 'J Strength Cond Res',
      pmid: '32218059',
      doi: '10.1519/JSC.0000000000003521',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32218059/',
    },
    {
      id: 'peterson2011',
      authors: 'Peterson MD, Sen A, Gordon PM.',
      year: 2011,
      title: 'Influence of resistance exercise on lean body mass in aging adults: a meta-analysis',
      journal: 'Med Sci Sports Exerc',
      pmid: '20543750',
      doi: '10.1249/MSS.0b013e3181eb6265',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2995836/',
    },
    {
      id: 'hubal2005',
      authors: 'Hubal MJ, Gordish-Dressman H, Thompson PD, et al.',
      year: 2005,
      title: 'Variability in muscle size and strength gain after unilateral resistance training',
      journal: 'Med Sci Sports Exerc',
      pmid: '15947721',
      url: 'https://pubmed.ncbi.nlm.nih.gov/15947721/',
    },
    {
      id: 'ahtiainen2016',
      authors: 'Ahtiainen JP, Walker S, Peltonen H, et al.',
      year: 2016,
      title:
        'Heterogeneity in resistance training-induced muscle strength and mass responses in men and women of different ages',
      journal: 'Age (Dordr)',
      pmid: '26767377',
      doi: '10.1007/s11357-015-9870-1',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26767377/',
    },
    {
      id: 'kosek2006',
      authors: 'Kosek DJ, Kim JS, Petrella JK, Cross JM, Bamman MM.',
      year: 2006,
      title:
        'Efficacy of 3 days/wk resistance training on myofiber hypertrophy and myogenic mechanisms in young vs. older adults',
      journal: 'J Appl Physiol',
      pmid: '16614355',
      doi: '10.1152/japplphysiol.01474.2005',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16614355/',
    },
    {
      id: 'kouri1995',
      authors: 'Kouri EM, Pope HG Jr, Katz DL, Oliva P.',
      year: 1995,
      title: 'Fat-free mass index in users and nonusers of anabolic-androgenic steroids',
      journal: 'Clin J Sport Med',
      pmid: '7496846',
      doi: '10.1097/00042752-199510000-00003',
      url: 'https://pubmed.ncbi.nlm.nih.gov/7496846/',
    },
    {
      id: 'trexler2017',
      authors: 'Trexler ET, Smith-Ryan AE, Blue MNM, et al.',
      year: 2017,
      title: 'Fat-free mass index in NCAA Division I and II collegiate American football players',
      journal: 'J Strength Cond Res',
      pmid: '27930454',
      doi: '10.1519/JSC.0000000000001737',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27930454/',
    },
    {
      id: 'magee2024',
      authors: 'Magee MK, Fields JB, Jagim AR, Jones MT.',
      year: 2024,
      title: 'Fat-free mass index in a large sample of NCAA men and women athletes from a variety of sports',
      journal: 'J Strength Cond Res',
      pmid: '37815277',
      doi: '10.1519/JSC.0000000000004621',
      url: 'https://pubmed.ncbi.nlm.nih.gov/37815277/',
    },
    {
      id: 'blue2019',
      authors: 'Blue MNM, Hirsch KR, Pihoker AA, Trexler ET, Smith-Ryan AE.',
      year: 2019,
      title: 'Normative fat-free mass index values for a diverse sample of collegiate female athletes',
      journal: 'J Sports Sci',
      pmid: '30893018',
      doi: '10.1080/02640414.2019.1591575',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30893018/',
    },
    {
      id: 'damas2016a',
      authors: 'Damas F, Phillips SM, Lixandrão ME, et al.',
      year: 2016,
      title:
        'Early resistance training-induced increases in muscle cross-sectional area are concomitant with edema-induced muscle swelling',
      journal: 'Eur J Appl Physiol',
      pmid: '26280652',
      doi: '10.1007/s00421-015-3243-4',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26280652/',
    },
    {
      id: 'damas2016b',
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
      id: 'seynnes2007',
      authors: 'Seynnes OR, de Boer M, Narici MV.',
      year: 2007,
      title:
        'Early skeletal muscle hypertrophy and architectural changes in response to high-intensity resistance training',
      journal: 'J Appl Physiol',
      pmid: '17053104',
      doi: '10.1152/japplphysiol.00789.2006',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17053104/',
    },
    {
      id: 'damas2015',
      authors: 'Damas F, Phillips S, Vechin FC, Ugrinowitsch C.',
      year: 2015,
      title:
        'A review of resistance training-induced changes in skeletal muscle protein synthesis and their contribution to hypertrophy',
      journal: 'Sports Med',
      pmid: '25739559',
      doi: '10.1007/s40279-015-0320-0',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25739559/',
    },
    {
      id: 'macdougall1995',
      authors: 'MacDougall JD, Gibala MJ, Tarnopolsky MA, et al.',
      year: 1995,
      title: 'The time course for elevated muscle protein synthesis following heavy resistance exercise',
      journal: 'Can J Appl Physiol',
      pmid: '8563679',
      doi: '10.1139/h95-038',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8563679/',
    },
    {
      id: 'chesley1992',
      authors: 'Chesley A, MacDougall JD, Tarnopolsky MA, Atkinson SA, Smith K.',
      year: 1992,
      title: 'Changes in human muscle protein synthesis after resistance exercise',
      journal: 'J Appl Physiol',
      pmid: '1280254',
      doi: '10.1152/jappl.1992.73.4.1383',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1280254/',
    },
    {
      id: 'phillips1997',
      authors: 'Phillips SM, Tipton KD, Aarsland A, Wolf SE, Wolfe RR.',
      year: 1997,
      title: 'Mixed muscle protein synthesis and breakdown after resistance exercise in humans',
      journal: 'Am J Physiol',
      pmid: '9252485',
      doi: '10.1152/ajpendo.1997.273.1.E99',
      url: 'https://pubmed.ncbi.nlm.nih.gov/9252485/',
    },
    {
      id: 'tang2008',
      authors: 'Tang JE, Perco JG, Moore DR, Wilkinson SB, Phillips SM.',
      year: 2008,
      title:
        'Resistance training alters the response of fed state mixed muscle protein synthesis in young men',
      journal: 'Am J Physiol Regul Integr Comp Physiol',
      pmid: '18032468',
      doi: '10.1152/ajpregu.00636.2007',
      url: 'https://pubmed.ncbi.nlm.nih.gov/18032468/',
    },
    {
      id: 'murphy2022',
      authors: 'Murphy C, Koehler K.',
      year: 2022,
      title:
        'Energy deficiency impairs resistance training gains in lean mass but not strength: a meta-analysis and meta-regression',
      journal: 'Scand J Med Sci Sports',
      pmid: '34623696',
      doi: '10.1111/sms.14075',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34623696/',
      verification: 'abstract',
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
      id: 'barakat2020',
      authors: 'Barakat C, Pearson J, Escalante G, Campbell B, et al.',
      year: 2020,
      title: 'Body recomposition: can trained individuals build muscle and lose fat at the same time?',
      journal: 'Strength Cond J',
      doi: '10.1519/SSC.0000000000000584',
    },
    {
      id: 'slater2019',
      authors: 'Slater GJ, Dieter BP, Marsh DJ, et al.',
      year: 2019,
      title:
        'Is an energy surplus required to maximize skeletal muscle hypertrophy associated with resistance training',
      journal: 'Front Nutr',
      pmid: '31482093',
      doi: '10.3389/fnut.2019.00131',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31482093/',
    },
    {
      id: 'helms2023',
      authors: 'Helms ER, Spence AJ, Sousa C, et al.',
      year: 2023,
      title:
        'Effect of small and large energy surpluses on strength, muscle, and skinfold thickness in resistance-trained individuals: a parallel groups design',
      journal: 'Sports Med Open',
      pmid: '37914977',
      doi: '10.1186/s40798-023-00651-y',
      url: 'https://pubmed.ncbi.nlm.nih.gov/37914977/',
    },
    {
      id: 'ribeiro2019',
      authors: 'Ribeiro AS, Nunes JP, Schoenfeld BJ, Aguiar AF, Cyrino ES.',
      year: 2019,
      title:
        'Effects of different dietary energy intake following resistance training on muscle mass and body fat in bodybuilders: a pilot study',
      journal: 'J Hum Kinet',
      pmid: '31915482',
      doi: '10.2478/hukin-2019-0038',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31915482/',
    },
    {
      id: 'garthe2013',
      authors: 'Garthe I, Raastad T, Refsnes PE, Sundgot-Borgen J.',
      year: 2013,
      title: 'Effect of nutritional intervention on body composition and performance in elite athletes',
      journal: 'Eur J Sport Sci',
      pmid: '23679146',
      doi: '10.1080/17461391.2011.643923',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23679146/',
    },
    {
      id: 'rozenek2002',
      authors: 'Rozenek R, Ward P, Long S, Garhammer J.',
      year: 2002,
      title:
        'Effects of high-calorie supplements on body composition and muscular strength following resistance training',
      journal: 'J Sports Med Phys Fitness',
      pmid: '12094125',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12094125/',
    },
    {
      id: 'smith2021',
      authors: 'Smith RW, Harty PS, Stratton MT, et al.',
      year: 2021,
      title:
        'Predicting adaptations to resistance training plus overfeeding using Bayesian regression: a preliminary investigation',
      journal: 'J Funct Morphol Kinesiol',
      pmid: '33919267',
      doi: '10.3390/jfmk6020036',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33919267/',
    },
    {
      id: 'iraki2019',
      authors: 'Iraki J, Fitschen P, Espinar S, Helms E.',
      year: 2019,
      title: 'Nutrition recommendations for bodybuilders in the off-season: a narrative review',
      journal: 'Sports (Basel)',
      pmid: '31247944',
      doi: '10.3390/sports7070154',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31247944/',
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
      id: 'cava2017',
      authors: 'Cava E, Yeat NC, Mittendorfer B.',
      year: 2017,
      title: 'Preserving healthy muscle during weight loss',
      journal: 'Adv Nutr',
      pmid: '28507015',
      doi: '10.3945/an.116.014506',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28507015/',
    },
    {
      id: 'clark2015',
      authors: 'Clark JE.',
      year: 2015,
      title:
        'Diet, exercise or diet with exercise: comparing the effectiveness of treatment options for weight-loss and changes in fitness for adults (18-65 years old) who are overfat, or obese; systematic review and meta-analysis',
      journal: 'J Diabetes Metab Disord',
      pmid: '25973403',
      doi: '10.1186/s40200-015-0154-1',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25973403/',
    },
    {
      id: 'weiss2007',
      authors: 'Weiss EP, Racette SB, Villareal DT, et al.',
      year: 2007,
      title:
        'Lower extremity muscle size and strength and aerobic capacity decrease with caloric restriction but not with exercise-induced weight loss',
      journal: 'J Appl Physiol',
      pmid: '17095635',
      doi: '10.1152/japplphysiol.00853.2006',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17095635/',
    },
    {
      id: 'sardeli2018',
      authors: 'Sardeli AV, Komatsu TR, Mori MA, Gáspari AF, Chacon-Mikahil MPT.',
      year: 2018,
      title:
        'Resistance training prevents muscle loss induced by caloric restriction in obese elderly individuals: a systematic review and meta-analysis',
      journal: 'Nutrients',
      pmid: '29596307',
      doi: '10.3390/nu10040423',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29596307/',
    },
    {
      id: 'weinheimer2010',
      authors: 'Weinheimer EM, Sands LP, Campbell WW.',
      year: 2010,
      title:
        'A systematic review of the separate and combined effects of energy restriction and exercise on fat-free mass in middle-aged and older adults: implications for sarcopenic obesity',
      journal: 'Nutr Rev',
      pmid: '20591106',
      doi: '10.1111/j.1753-4887.2010.00298.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20591106/',
    },
    {
      id: 'ballor1994',
      authors: 'Ballor DL, Poehlman ET.',
      year: 1994,
      title:
        'Exercise-training enhances fat-free mass preservation during diet-induced weight loss: a meta-analytical finding',
      journal: 'Int J Obes Relat Metab Disord',
      pmid: '8130813',
      url: 'https://pubmed.ncbi.nlm.nih.gov/8130813/',
    },
    {
      id: 'villareal2017',
      authors: 'Villareal DT, Aguirre L, Gurney AB, et al.',
      year: 2017,
      title: 'Aerobic or resistance exercise, or both, in dieting obese older adults',
      journal: 'N Engl J Med',
      pmid: '28514618',
      doi: '10.1056/NEJMoa1616338',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28514618/',
    },
    {
      id: 'heymsfield2014',
      authors: 'Heymsfield SB, Gonzalez MC, Shen W, Redman L, Thomas D.',
      year: 2014,
      title:
        'Weight loss composition is one-fourth fat-free mass: a critical review and critique of this widely cited rule',
      journal: 'Obes Rev',
      pmid: '24447775',
      doi: '10.1111/obr.12143',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24447775/',
    },
    {
      id: 'forbes2000',
      authors: 'Forbes GB.',
      year: 2000,
      title: 'Body fat content influences the body composition response to nutrition and exercise',
      journal: 'Ann N Y Acad Sci',
      pmid: '10865771',
      doi: '10.1111/j.1749-6632.2000.tb06482.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10865771/',
    },
    {
      id: 'hall2007',
      authors: 'Hall KD.',
      year: 2007,
      title: "Body fat and fat-free mass inter-relationships: Forbes's theory revisited",
      journal: 'Br J Nutr',
      pmid: '17367567',
      doi: '10.1017/S0007114507691946',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17367567/',
    },
    {
      id: 'josse2011',
      authors: 'Josse AR, Atkinson SA, Tarnopolsky MA, Phillips SM.',
      year: 2011,
      title:
        'Increased consumption of dairy foods and protein during diet- and exercise-induced weight loss promotes fat mass loss and lean mass gain in overweight and obese premenopausal women',
      journal: 'J Nutr',
      pmid: '21775530',
      doi: '10.3945/jn.111.141028',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21775530/',
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
      id: 'ogasawara2013',
      authors: 'Ogasawara R, Yasuda T, Ishii N, Abe T.',
      year: 2013,
      title:
        'Comparison of muscle hypertrophy following 6-month of continuous and periodic strength training',
      journal: 'Eur J Appl Physiol',
      pmid: '23053130',
      doi: '10.1007/s00421-012-2511-9',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23053130/',
    },
    {
      id: 'ogasawara2011',
      authors: 'Ogasawara R, Yasuda T, Sakamaki M, Ozaki H, Abe T.',
      year: 2011,
      title:
        'Effects of periodic and continued resistance training on muscle CSA and strength in previously untrained men',
      journal: 'Clin Physiol Funct Imaging',
      pmid: '21771261',
      doi: '10.1111/j.1475-097X.2011.01031.x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/21771261/',
    },
    {
      id: 'psilander2019',
      authors: 'Psilander N, Eftestøl E, Cumming KT, et al.',
      year: 2019,
      title:
        'Effects of training, detraining, and retraining on strength, hypertrophy, and myonuclear number in human skeletal muscle',
      journal: 'J Appl Physiol',
      pmid: '30991013',
      doi: '10.1152/japplphysiol.00917.2018',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30991013/',
    },
    {
      id: 'cumming2024',
      authors: 'Cumming KT, Reitzner SM, Hanslien M, et al.',
      year: 2024,
      title:
        'Muscle memory in humans: evidence for myonuclear permanence and long-term transcriptional regulation after strength training',
      journal: 'J Physiol',
      pmid: '39159314',
      doi: '10.1113/JP285675',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39159314/',
    },
    {
      id: 'rahmati2022',
      authors: 'Rahmati M, McCarthy JJ, Malakoutinia F.',
      year: 2022,
      title:
        'Myonuclear permanence in skeletal muscle memory: a systematic review and meta-analysis of human and animal studies',
      journal: 'J Cachexia Sarcopenia Muscle',
      pmid: '35961635',
      doi: '10.1002/jcsm.13043',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35961635/',
    },
    {
      id: 'seaborne2018',
      authors: 'Seaborne RA, Strauss J, Cocks M, et al.',
      year: 2018,
      title: 'Human skeletal muscle possesses an epigenetic memory of hypertrophy',
      journal: 'Sci Rep',
      pmid: '29382913',
      doi: '10.1038/s41598-018-20287-3',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29382913/',
    },
    {
      id: 'snijders2020',
      authors: 'Snijders T, Aussieker T, Holwerda A, et al.',
      year: 2020,
      title: 'The concept of skeletal muscle memory: evidence from animal and human studies',
      journal: 'Acta Physiol (Oxf)',
      pmid: '32175681',
      doi: '10.1111/apha.13465',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32175681/',
    },
    {
      id: 'bosquet2013',
      authors: 'Bosquet L, Berryman N, Dupuy O, et al.',
      year: 2013,
      title: 'Effect of training cessation on muscular performance: a meta-analysis',
      journal: 'Scand J Med Sci Sports',
      pmid: '23347054',
      doi: '10.1111/sms.12047',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23347054/',
    },
    {
      id: 'grgic2022',
      authors: 'Grgic J.',
      year: 2022,
      title:
        'Use it or lose it? A meta-analysis on the effects of resistance training cessation (detraining) on muscle size in older adults',
      journal: 'Int J Environ Res Public Health',
      pmid: '36360927',
      doi: '10.3390/ijerph192114048',
      url: 'https://pubmed.ncbi.nlm.nih.gov/36360927/',
    },
    {
      id: 'blocquiaux2020',
      authors: 'Blocquiaux S, Gorski T, Van Roie E, et al.',
      year: 2020,
      title:
        'The effect of resistance training, detraining and retraining on muscle strength and power, myofibre size, satellite cells and myonuclei in older men',
      journal: 'Exp Gerontol',
      pmid: '32017951',
      doi: '10.1016/j.exger.2020.110860',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32017951/',
    },
    {
      id: 'hwang2017',
      authors: 'Hwang PS, Andre TL, McKinley-Barnard SK, et al.',
      year: 2017,
      title:
        'Resistance training-induced elevations in muscular strength in trained men are maintained after 2 weeks of detraining and not differentially affected by whey protein supplementation',
      journal: 'J Strength Cond Res',
      pmid: '28328712',
      doi: '10.1519/JSC.0000000000001807',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28328712/',
    },
    {
      id: 'narici1989',
      authors: 'Narici MV, Roi GS, Landoni L, Minetti AE, Cerretelli P.',
      year: 1989,
      title:
        'Changes in force, cross-sectional area and neural activation during strength training and detraining of the human quadriceps',
      journal: 'Eur J Appl Physiol Occup Physiol',
      pmid: '2583179',
      doi: '10.1007/BF02388334',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2583179/',
    },
    {
      id: 'coleman2024',
      authors: 'Coleman M, Burke R, Augustin F, et al.',
      year: 2024,
      title:
        'Gaining more from doing less? The effects of a one-week deload period during supervised resistance training on muscular adaptations',
      journal: 'PeerJ',
      pmid: '38274324',
      doi: '10.7717/peerj.16777',
      url: 'https://pubmed.ncbi.nlm.nih.gov/38274324/',
    },
    {
      id: 'morannavarro2017',
      authors: 'Morán-Navarro R, Pérez CE, Mora-Rodríguez R, et al.',
      year: 2017,
      title: 'Time course of recovery following resistance training leading or not to failure',
      journal: 'Eur J Appl Physiol',
      pmid: '28965198',
      doi: '10.1007/s00421-017-3725-7',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28965198/',
    },
    {
      id: 'vargas2018',
      authors: 'Vargas S, Romance R, Petro JL, et al.',
      year: 2018,
      title:
        'Efficacy of ketogenic diet on body composition during resistance training in trained men: a randomized controlled trial',
      journal: 'J Int Soc Sports Nutr',
      pmid: '29986720',
      doi: '10.1186/s12970-018-0236-9',
      url: 'https://pubmed.ncbi.nlm.nih.gov/29986720/',
    },
    {
      id: 'paoli2021',
      authors: 'Paoli A, Cenci L, Pompei P, et al.',
      year: 2021,
      title:
        'Effects of two months of very low carbohydrate ketogenic diet on body composition, muscle strength, muscle area, and blood parameters in competitive natural body builders',
      journal: 'Nutrients',
      pmid: '33530512',
      doi: '10.3390/nu13020374',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33530512/',
    },
    {
      id: 'henselmans2022',
      authors: 'Henselmans M, Bjørnsen T, Hedderman R, Vårvik FT.',
      year: 2022,
      title:
        'The effect of carbohydrate intake on strength and resistance training performance: a systematic review',
      journal: 'Nutrients',
      pmid: '35215506',
      doi: '10.3390/nu14040856',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35215506/',
    },
    {
      id: 'ashtarylarky2022',
      authors: 'Ashtary-Larky D, Bagheri R, Asbaghi O, et al.',
      year: 2022,
      title:
        'Effects of resistance training combined with a ketogenic diet on body composition: a systematic review and meta-analysis',
      journal: 'Crit Rev Food Sci Nutr',
      pmid: '33624538',
      doi: '10.1080/10408398.2021.1890689',
      url: 'https://pubmed.ncbi.nlm.nih.gov/33624538/',
    },
    {
      id: 'robergs1991',
      authors: 'Robergs RA, Pearson DR, Costill DL, et al.',
      year: 1991,
      title: 'Muscle glycogenolysis during differing intensities of weight-resistance exercise',
      journal: 'J Appl Physiol',
      pmid: '2055849',
      doi: '10.1152/jappl.1991.70.4.1700',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2055849/',
    },
    {
      id: 'koopman2006',
      authors: 'Koopman R, Manders RJ, Jonkers RA, et al.',
      year: 2006,
      title:
        'Intramyocellular lipid and glycogen content are reduced following resistance exercise in untrained healthy males',
      journal: 'Eur J Appl Physiol',
      pmid: '16369816',
      doi: '10.1007/s00421-005-0118-0',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16369816/',
    },
    {
      id: 'herrmann2024',
      authors: 'Herrmann SD, Willis EA, Ainsworth BE, et al.',
      year: 2024,
      title:
        '2024 Adult Compendium of Physical Activities: a third update of the energy costs of human activities',
      journal: 'J Sport Health Sci',
      pmid: '38242596',
      doi: '10.1016/j.jshs.2023.10.010',
      url: 'https://pacompendium.com/conditioning-exercise/',
    },
    {
      id: 'schuenke2002',
      authors: 'Schuenke MD, Mikat RP, McBride JM.',
      year: 2002,
      title:
        'Effect of an acute period of resistance exercise on excess post-exercise oxygen consumption: implications for body mass management',
      journal: 'Eur J Appl Physiol',
      pmid: '11882927',
      doi: '10.1007/s00421-001-0568-y',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11882927/',
    },
    {
      id: 'heden2011',
      authors: 'Heden T, Lox C, Rose P, Reid S, Kirk EP.',
      year: 2011,
      title: 'One-set resistance training elevates energy expenditure for 72 h similar to three sets',
      journal: 'Eur J Appl Physiol',
      pmid: '20886227',
      doi: '10.1007/s00421-010-1666-5',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20886227/',
    },
    {
      id: 'reis2017',
      authors: 'Reis VM, Garrido ND, Vianna J, et al.',
      year: 2017,
      title: 'Energy cost of isolated resistance exercises across low- to high-intensities',
      journal: 'PLoS One',
      pmid: '28742112',
      doi: '10.1371/journal.pone.0181311',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28742112/',
    },
    {
      id: 'reis2011',
      authors: 'Reis VM, Júnior RS, Zajac A, Oliveira DR.',
      year: 2011,
      title: 'Energy cost of resistance exercises: an uptade',
      journal: 'J Hum Kinet',
      pmid: '23487150',
      doi: '10.2478/v10078-011-0056-3',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23487150/',
    },
    {
      id: 'loenneke2019',
      authors: 'Loenneke JP, Buckner SL, Dankel SJ, Abe T.',
      year: 2019,
      title:
        'Exercise-induced changes in muscle size do not contribute to exercise-induced changes in muscle strength',
      journal: 'Sports Med',
      pmid: '31020548',
      doi: '10.1007/s40279-019-01106-9',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31020548/',
    },
    {
      id: 'balshaw2017',
      authors: 'Balshaw TG, Massey GJ, Maden-Wilkinson TM, et al.',
      year: 2017,
      title:
        'Changes in agonist neural drive, hypertrophy and pre-training strength all contribute to the individual strength gains after resistance training',
      journal: 'Eur J Appl Physiol',
      pmid: '28239775',
      doi: '10.1007/s00421-017-3560-x',
      url: 'https://pubmed.ncbi.nlm.nih.gov/28239775/',
    },
    {
      id: 'erskine2010',
      authors: 'Erskine RM, Jones DA, Williams AG, Stewart CE, Degens H.',
      year: 2010,
      title:
        'Inter-individual variability in the adaptation of human muscle specific tension to progressive resistance training',
      journal: 'Eur J Appl Physiol',
      pmid: '20703498',
      doi: '10.1007/s00421-010-1601-9',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20703498/',
    },
    {
      id: 'abe2000',
      authors: 'Abe T, DeHoyos DV, Pollock ML, Garzarella L.',
      year: 2000,
      title:
        'Time course for strength and muscle thickness changes following upper and lower body resistance training in men and women',
      journal: 'Eur J Appl Physiol',
      pmid: '10638374',
      doi: '10.1007/s004210050027',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10638374/',
    },
    {
      id: 'wakahara2013',
      authors: 'Wakahara T, Fukutani A, Kawakami Y, Yanai T.',
      year: 2013,
      title: 'Nonuniform muscle hypertrophy: its relation to muscle activation in training session',
      journal: 'Med Sci Sports Exerc',
      pmid: '23657165',
      doi: '10.1249/MSS.0b013e3182995349',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23657165/',
    },
    {
      id: 'janssen2000',
      authors: 'Janssen I, Heymsfield SB, Wang ZM, Ross R.',
      year: 2000,
      title: 'Skeletal muscle mass and distribution in 468 men and women aged 18-88 yr',
      journal: 'J Appl Physiol',
      pmid: '10904038',
      doi: '10.1152/jappl.2000.89.1.81',
      url: 'https://pubmed.ncbi.nlm.nih.gov/10904038/',
    },
    {
      id: 'colensosemple2023',
      authors: "Colenso-Semple LM, D'Souza AC, Elliott-Sale KJ, Phillips SM.",
      year: 2023,
      title:
        "Current evidence shows no influence of women's menstrual cycle phase on acute strength performance or adaptations to resistance exercise training",
      journal: 'Front Sports Act Living',
      pmid: '37033884',
      doi: '10.3389/fspor.2023.1054542',
      url: 'https://pubmed.ncbi.nlm.nih.gov/37033884/',
    },
    {
      id: 'kissow2022',
      authors: 'Kissow J, Jacobsen KJ, Gunnarsson TP, Jessen S, Hostrup M.',
      year: 2022,
      title:
        'Effects of follicular and luteal phase-based menstrual cycle resistance training on muscle strength and mass',
      journal: 'Sports Med',
      pmid: '35471634',
      doi: '10.1007/s40279-022-01679-y',
      url: 'https://pubmed.ncbi.nlm.nih.gov/35471634/',
    },
    {
      id: 'nolan2024',
      authors: 'Nolan D, McNulty KL, Manninen M, Egan B.',
      year: 2024,
      title:
        'The effect of hormonal contraceptive use on skeletal muscle hypertrophy, power and strength adaptations to resistance exercise training: a systematic review and multilevel meta-analysis',
      journal: 'Sports Med',
      pmid: '37755666',
      doi: '10.1007/s40279-023-01911-3',
      url: 'https://pubmed.ncbi.nlm.nih.gov/37755666/',
    },
    {
      id: 'borde2015',
      authors: 'Borde R, Hortobágyi T, Granacher U.',
      year: 2015,
      title:
        'Dose-response relationships of resistance training in healthy old adults: a systematic review and meta-analysis',
      journal: 'Sports Med',
      pmid: '26420238',
      doi: '10.1007/s40279-015-0385-9',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26420238/',
    },
    {
      id: 'schoenfeld2019b',
      authors: 'Schoenfeld BJ, Contreras B, Krieger J, et al.',
      year: 2019,
      title: 'Resistance training volume enhances muscle hypertrophy but not strength in trained men',
      journal: 'Med Sci Sports Exerc',
      pmid: '30153194',
      doi: '10.1249/MSS.0000000000001764',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6303131/',
    },
    {
      id: 'aube2022',
      authors: 'Aube D, Wadhi T, Rauch J, et al.',
      year: 2022,
      title:
        'Progressive resistance training volume: effects on muscle thickness, mass, and strength adaptations in resistance-trained individuals',
      journal: 'J Strength Cond Res',
      pmid: '32058362',
      doi: '10.1519/JSC.0000000000003524',
      url: 'https://pubmed.ncbi.nlm.nih.gov/32058362/',
    },
    {
      id: 'morton2016',
      authors: 'Morton RW, Oikawa SY, Wavell CG, et al.',
      year: 2016,
      title:
        'Neither load nor systemic hormones determine resistance training-mediated hypertrophy or strength gains in resistance-trained young men',
      journal: 'J Appl Physiol',
      pmid: '27174923',
      doi: '10.1152/japplphysiol.00154.2016',
      url: 'https://pubmed.ncbi.nlm.nih.gov/27174923/',
    },
    {
      id: 'schumann2022',
      authors: 'Schumann M, Feuerbacher JF, Sünkeler M, et al.',
      year: 2022,
      title:
        'Compatibility of concurrent aerobic and strength training for skeletal muscle size and function: an updated systematic review and meta-analysis',
      journal: 'Sports Med',
      pmid: '34757594',
      doi: '10.1007/s40279-021-01587-7',
      url: 'https://pubmed.ncbi.nlm.nih.gov/34757594/',
    },
    {
      id: 'schoenfeld2013',
      authors: 'Schoenfeld BJ, Aragon AA, Krieger JW.',
      year: 2013,
      title: 'The effect of protein timing on muscle strength and hypertrophy: a meta-analysis',
      journal: 'J Int Soc Sports Nutr',
      pmid: '24299050',
      doi: '10.1186/1550-2783-10-53',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24299050/',
    },
    {
      id: 'bamman2007',
      authors: 'Bamman MM, Petrella JK, Kim JS, Mayhew DL, Cross JM.',
      year: 2007,
      title:
        'Cluster analysis tests the importance of myogenic gene expression during myofiber hypertrophy in humans',
      journal: 'J Appl Physiol',
      pmid: '17395765',
      doi: '10.1152/japplphysiol.00024.2007',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17395765/',
    },
    {
      id: 'wernbom2007',
      authors: 'Wernbom M, Augustsson J, Thomeé R.',
      year: 2007,
      title:
        'The influence of frequency, intensity, volume and mode of strength training on whole muscle cross-sectional area in humans',
      journal: 'Sports Med',
      pmid: '17326698',
      doi: '10.2165/00007256-200737030-00004',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17326698/',
    },
  ],
};

export default topic;
