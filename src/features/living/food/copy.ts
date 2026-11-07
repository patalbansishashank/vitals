/**
 * User-facing copy for the Food screen (design/screens/living-mode.md, Food). Plain, specific, second person; never
 * moralising (a gap is "not logged", never "failed"); no streaks, no exclamation marks, no internal references.
 * `src/features/living/__tests__/copy.test.ts` scans this module.
 */

import type { InfoEntry } from '../components/info';

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const FOOD_COPY = {
  title: 'Food',
  /** The page's own items in the header ⋯ (the global items follow after a divider). */
  menuItems: {
    kitchen: 'Use what’s in my kitchen',
    pantry: 'Pantry',
    noBenefit: 'Things that won’t help',
  },
  /** Header status icon's name while the plan is paused (it opens Plan details). */
  paused: 'Plan paused',
  noPlanDay: 'No plan for this day',
  showNumbers: 'show numbers',
  hideNumbers: 'hide numbers',

  targets: {
    title: 'Targets',
    /** The day report row's label (r068 F1). */
    report: 'Food today',
    /** A day ahead's status (r068 F3). */
    planned: 'Planned',
    kcal: (v: string) => `${v} kcal`,
    protein: (v: string) => `protein ${v} g`,
    carbs: (v: string) => `carbs ${v} g`,
    fat: (v: string) => `fat ${v} g`,
    fibre: (v: string) => `fibre ${v} g`,
    eaten: 'eaten',
    nothingYet: 'nothing logged yet',
    quietEaten: (word: string) => `eaten: ${word}`,
    bars: { energy: 'Energy', protein: 'Protein', carbs: 'Carbs', fat: 'Fat', fibre: 'Fibre' },
    of: 'of',
    left: (n: string, unit: string) => `${n} ${unit} left`,
    over: (n: string, unit: string) => `+${n} ${unit} over`,
    barLabel: (what: string, eaten: string, target: string, unit: string, range: string | null) =>
      `${what}: eaten about ${eaten} of ${target} ${unit}${range ? ` (likely ${range})` : ''}`,
    barNone: (what: string, target: string, unit: string) => `${what}: nothing logged yet of ${target} ${unit}`,
    ofTarget: (target: string) => `of ${target}`,
    /** The strip's target tick and the macro share bar (A.3.3). */
    targetWord: 'Target',
    macros: 'Macros',
    shareOf: 'of target',
    ofValue: (eaten: string, target: string, unit: string) => `${eaten} of ${target} ${unit}`,
    partialName: (what: string) => `${what} · partial`,
    range: (range: string, unit: string) => `range ${range} ${unit}`,
    spokenEaten: (eaten: string, target: string, unit: string, range: string | null) =>
      range ? `eaten about ${eaten} of ${target} ${unit} (range ${range})` : `eaten ${eaten} of ${target} ${unit}`,
    spokenNone: (target: string, unit: string) => `nothing logged yet, target ${target} ${unit}`,
  },

  meals: {
    title: 'Meals',
    planDay: 'Plan my day',
    planAgain: 'Plan again',
    running: 'Planning recipes for the open meals…',
    progress: { waiting: 'waiting', working: 'planning…', done: 'ready', error: 'no recipe' },
    progressLabel: 'Recipe progress',
    /** No AI provider: one quiet line and one key at the foot of the Meals card (no disabled controls). */
    noProvider: 'Recipes need an AI provider',
    setUpProvider: 'Set up a provider',
    noDiet: 'Tell us what you eat to get recipes',
    noDietReason: 'Tell us what you eat to get recipes.',
    noDietLink: 'Tell us what you eat',
    nothingOpen: 'Every meal here is planned or logged.',
    fastDay: 'Fast day · water, tea, coffee; electrolytes if over 24 h',
    hiddenByFast: (n: number) => `${plural(n, 'meal', 'meals')} outside the eating window`,
    other: 'Other food',
    /** r068 L24: on a fast day, on the row of a meal eaten outside the eating window. */
    outsideWindow: 'outside the eating window',
    addFood: 'Add food',
  },

  slot: {
    numbers: (kcal: string, protein: string) => `${kcal} kcal · ${protein} g protein`,
    carbsFat: (carbs: string, fat: string) => `${carbs} g carbs · ${fat} g fat`,
    openItem: 'Recipe and targets',
    plain: (p: string, c: string, f: string) => `about ${p} g protein, ${c} g carbs, ${f} g fat`,
    example: (ex: string) => `for example ${ex}`,
    plainQuiet: (ex: string) => `For example ${ex}.`,
    accepted: 'accepted',
    suggested: 'suggested',
    accept: 'Accept',
    acceptName: (dish: string, slot: string) => `Accept ${dish} for ${slot}`,
    swap: 'Swap',
    swapName: (slot: string) => `Swap the ${slot} recipe`,
    ateThis: 'As planned',
    ateThisName: (slot: string) => `I ate this: ${slot} as planned`,
    ateElse: 'I ate something else',
    ateElseName: (slot: string) => `I ate something else: ${slot}`,
    addMore: 'Add more',
    addMoreName: (slot: string) => `Add more food to ${slot}`,
    markedAsPlanned: 'marked as planned',
    coachEstimate: 'Coach estimate',
    open: (slot: string) => `Open ${slot} details`,
    failed: 'Couldn’t make a recipe this time.',
    tryAgain: 'Try again',
    tryAgainName: (slot: string) => `Try again: ${slot} recipe`,
    dontSuggest: (dish: string) => `Don’t suggest ${dish} again?`,
    dontSuggestKey: 'Don’t suggest',
    itsFine: 'It’s fine',
    closestSide: 'Add a protein-rich side, such as 150 g curd?',
    closestQuiet: 'closest fit',
    minutes: (n: number) => `${n} min`,
    notEstimated: 'amount not estimated yet',
    estimated: 'estimated composition',
    familyEat: (portions: string) => `Eat ${portions}`,
  },

  toasts: {
    loggedAsPlanned: (slot: string) => `${cap(slot)} logged as planned`,
    /** The meal sheet's other answers: "Lunch: partly", "Dinner: skipped". */
    answered: (slot: string, word: string) => `${cap(slot)}: ${word}`,
    logged: (slot: string) => `${cap(slot)} logged`,
    loggedOther: 'Food logged',
    accepted: (slot: string) => `${cap(slot)} planned · groceries updated`,
    unplanned: (slot: string) => `${cap(slot)} recipe removed from the plan`,
    taken: (name: string) => `${cap(name)} marked as taken`,
    copied: 'Grocery list copied',
    copyFailed: 'Couldn’t copy the list here. Use Print instead.',
    undo: 'Undo',
    notSaved: 'That wasn’t saved. Try again.',
  },

  recipe: {
    servings: (n: number) => plural(n, 'serving', 'servings'),
    servingsLabel: 'Makes',
    active: (n: number) => `${n} min active`,
    passive: (n: number) => `${n} min waiting`,
    cuisine: 'Cuisine',
    time: 'Time',
    equipment: 'Equipment',
    ingredients: 'Ingredients',
    steps: 'Steps',
    perServing: 'Per serving',
    why: 'Why this fits',
    energy: 'Energy',
    protein: 'Protein',
    carbs: 'Carbs',
    fat: 'Fat',
    fibre: 'Fibre',
    numbersHidden: 'Amounts hidden in quiet mode',
    remove: 'Remove from the plan',
    slotTitle: (slot: string) => `${cap(slot)} targets`,
    noRecipe: 'No recipe yet',
    targetRows: { energy: 'Energy', protein: 'Protein', carbs: 'Carbs', fat: 'Fat' },
  },

  logger: {
    title: (slot: string | null) => (slot ? `What did you eat for ${slot}?` : 'What did you eat?'),
    time: 'Time',
    search: 'Search foods',
    searchPlaceholder: 'dal, paneer, rice…',
    /** r068 L10: one field that searches the food table and, if nothing is picked, is logged as the description. */
    searchOrDescribe: 'Search or describe',
    searchOrDescribePlaceholder: 'dal, or 2 idlis with sambar',
    /** The disclosure over the energy and protein fields. */
    enterNumbers: 'Enter numbers',
    noResults: 'Nothing found',
    add: (name: string) => `Add ${name}`,
    remove: (name: string) => `Remove ${name}`,
    picked: 'What you ate',
    unit: (name: string) => `Unit for ${name}`,
    grams: 'grams',
    howMany: (name: string) => `How many for ${name}`,
    gramsOf: (name: string) => `Grams of ${name}`,
    describe: 'Or describe it',
    describePlaceholder: '2 idlis with sambar',
    kcal: 'Energy',
    protein: 'Protein',
    /** The one-tap recents' label (r068 F9). */
    recent: 'Again',
    sameAs: (slot: string) => `Same as yesterday’s ${slot}`,
    yesterday: (label: string) => `${cap(label)} · yesterday`,
    /** The header verb; the title already names the meal. */
    logKey: 'Log',
    needSomething: 'Pick a food or describe what you ate.',
    coach: 'Tell the Coach instead',
    estimated: 'estimated composition',
    about: (kcal: string) => `≈ ${kcal} kcal`,
    portion: (count: string, label: string) => `${count} × ${label}`,
  },

  groceries: {
    title: 'Groceries',
    horizon: { today: 'Today', '3days': '3 days', week: 'Week' },
    horizonLabel: 'Groceries for',
    /** The selected horizon holds nothing (a wider one does: the card stays for its switch). */
    nothing: 'Nothing to buy',
    aisles: { vegetables: 'Vegetables', dairy: 'Dairy', staples: 'Staples', protein: 'Protein', spices: 'Spices' },
    have: 'Have it',
    atHome: 'At home',
    toBuy: (n: number) => (n === 0 ? 'nothing left to buy' : `${n} to buy`),
    atHomeCount: (n: number) => `${n} at home`,
    boughtCount: (n: number) => `${n} bought`,
    haveName: (name: string) => `Already have ${name}`,
    share: 'Share',
    print: 'Print',
    budgetQ: 'Roughly what’s your food budget?',
    budget: { tight: 'Tight', normal: 'Normal', flexible: 'Flexible' },
    later: 'Ask me later',
    budgetSet: (tier: string) => `Budget ${tier.toLowerCase()}`,
    shareTitle: 'Groceries',
    shareHeader: (range: string) => `Groceries · ${range}`,
    shareHave: 'already have',
  },

  supplements: {
    title: 'Supplements',
    taken: 'taken',
    takenName: (name: string) => `Mark ${name} as taken`,
    undoTakenName: (name: string) => `Undo ${name} taken`,
    anyTime: 'any time',
    at: (time: string) => `at ${time}`,
    youTake: (dose: string) => `you take ${dose}`,
    planSuggests: (dose: string) => `plan suggests ${dose}`,
    yours: 'Yours',
    /** The stance, as the card's fact line. */
    foodFirst: 'Food first',
    /** Food first: the one key, to the supplements question of the setup. */
    stanceLink: 'Show supplement options',
    /** The label over the options (open stance), each listed by name. */
    options: 'Options',
    b12: 'Vegetarian diets are often low in vitamin B12 — consider a test; ask a doctor.',
    foodFirstLines: {
      protein: 'Short of protein at a meal? Add 200 g curd or 100 g paneer.',
      fibre: 'Fibre: dal, chana, rajma, oats or vegetables at each meal.',
    },
    hiddenForSafety: (n: number) => `${plural(n, 'option', 'options')} not shown because of your safety answers · ask your doctor`,
    dose: 'Dose',
    when: 'When',
    why: 'Why',
    caution: 'Good to know',
    foodFirstAlt: 'Food first',
    buying: 'Buying',
    /** Each option's buying row (the catalogue can't vouch for brands). */
    thirdParty: 'pick a product with third-party batch testing, such as Informed Sport or NSF',
  },

  /** Plain-language cards (the catalogue keeps the evidence and sources). Keyed by catalogue id. */
  supplementCards: {
    creatine_monohydrate: {
      name: 'creatine',
      dose: '3–5 g a day',
      when: 'any time, every day, with a meal',
      why: 'does help muscle with training',
      caution: 'adds 0.5–1.5 kg of water on the scale — your trend accounts for it',
      foodFirst: 'Food can’t practically supply this amount.',
    },
    whey_protein: {
      name: 'whey protein',
      dose: '20–40 g protein when a meal is short',
      when: 'with the meal that is short of protein',
      why: 'does help keep muscle while you lose fat, when your protein would otherwise fall short',
      caution: 'only useful to close a gap to your protein target',
      foodFirst: 'Curd, paneer, eggs, or dal with soy chunks.',
      foodFirstNoEggs: 'Curd, paneer, or dal with soy chunks.',
    },
    plant_protein: {
      name: 'plant protein powder',
      dose: '25–40 g protein when a meal is short',
      when: 'with the meal that is short of protein',
      why: 'works like whey when the serving is a little larger',
      caution: 'only useful to close a gap to your protein target',
      foodFirst: 'Soy chunks, tofu, dal with grains.',
    },
    psyllium: {
      name: 'psyllium husk (isabgol)',
      dose: '5 g, 1–3 times a day',
      when: 'with a large glass of water, before or with a meal',
      why: 'helps you reach your fibre target and stay full',
      caution: 'start low and add slowly to avoid bloating; always with enough water',
      foodFirst: 'Oats, dal, chana, rajma, vegetables and fruit.',
    },
    caffeine: {
      name: 'caffeine',
      dose: 'about 3 mg per kg before training, at most 400 mg a day',
      when: '30–60 minutes before training, not late in the day',
      why: 'does help training performance; it is not a fat-loss aid',
      caution: 'late doses shorten sleep',
      foodFirst: 'A cup of brewed coffee has roughly 80–110 mg.',
    },
    vitamin_b12: {
      name: 'vitamin B12',
      dose: 'a low daily dose, or one or two higher doses a week',
      when: 'any time',
      why: 'prevents a shortfall that is common without meat or fish',
      caution: 'get tested if you have symptoms; ask a doctor',
      foodFirst: 'Milk, curd, paneer, eggs, fish, fortified foods.',
    },
  } as Record<string, { name: string; dose: string; when: string; why: string; caution: string; foodFirst: string }>,

  noBenefit: {
    title: 'Things that won’t help your goals',
  },

  /** Plain reasons per catalogue id (the catalogue keeps the evidence and sources). */
  noBenefitReasons: {
    bcaa: 'No extra muscle benefit once your daily protein is enough.',
    hmb: 'No gain in muscle or strength with training in younger adults.',
    green_tea_extract: 'Fat loss too small to matter, and high doses can harm the liver.',
    garcinia: 'Fat loss too small to matter, with more stomach upset.',
    cla_chitosan_glucomannan: 'None reached a meaningful amount of weight loss as pills.',
    l_carnitine: 'A small effect that shrinks in longer trials.',
    fat_burners: 'Mostly less than 2 kg, with stimulant side effects.',
    exogenous_ketones: 'No fat-loss benefit, and they can make endurance a little worse.',
    collagen_for_muscle: 'An incomplete protein: it doesn’t replace whey or soy for muscle.',
    nmn_nr: 'No effect on blood sugar, cholesterol or muscle overall.',
    resveratrol: 'Can blunt fitness gains from training.',
    antioxidant_megadoses: 'High doses around training can blunt how you adapt to it.',
  } as Record<string, string>,

  kitchen: {
    title: 'Use what’s in my kitchen',
    /** The one pantry (the document /food/pantry edits), as a row that opens it. */
    pantryRow: (n: number) => `Pantry · ${plural(n, 'item', 'items')}`,
    needPantry: 'Mark what you have in your pantry first.',
    run: 'Plan from my kitchen',
    impossible: 'Your kitchen doesn’t cover today’s protein. Add 2 items from the shop?',
    notToday: 'This works for today and the days ahead.',
  },


  /** Example foods for plain targets, picked by the slot's macro balance. */
  examples: {
    snack: 'roasted chana and a katori of curd',
    protein: 'paneer bhurji, a roti and salad',
    carbs: 'dal, rice and curd',
    fat: 'eggs or paneer with vegetables',
    balanced: 'two rotis, dal and a katori of sabzi',
  },
  /** The same examples where the person's diet rules out what the defaults name (no eggs; no dairy). */
  examplesByDiet: {
    vegetarian: { fat: 'paneer or nuts with vegetables' },
    vegan: {
      snack: 'roasted chana and a handful of peanuts',
      protein: 'tofu bhurji, a roti and salad',
      carbs: 'dal, rice and sabzi',
      fat: 'tofu or nuts with vegetables',
    },
  },

  provider: {
    none: 'Connect an AI provider to get recipes.',
    failed: 'Couldn’t make a recipe this time.',
  },
} as const;

export { cap as capitalise };

/**
 * What each card's (i) says (r071, AUDIT §1.2). The text that used to sit under a number or a picture lives here; a card
 * keeps the figure, the picture and mono facts. `infoProblems` (components/info.ts) guards length, evidence slugs and tone.
 */
export const INFO = {
  targets: {
    title: 'Today’s targets',
    body: 'Every target comes from your plan for today. What you ate adds up from what you logged: typed amounts are exact; photo and Coach entries are estimates with a likely range. Protein is a floor, so more is fine. Partial means some food has no figure for that nutrient yet. Fibre counts only foods with a fibre value.',
    source: { kind: 'logged', words: 'Your plan sets the targets and your meals add up against them.' },
    evidence: ['protein-muscle', 'fibre-hydration-substances'],
  },
  meals: {
    title: 'Your meals',
    body: 'Each meal shows what your plan asks for. Tick a meal to log it exactly as planned, or open it to say partly, skipped or something else. An accepted recipe replaces the plain target and feeds your groceries. Food you log outside the meals sits on the same line at the time you ate it.',
    source: { kind: 'plan', words: 'Each meal’s target is your plan’s; what you log takes its place.' },
    evidence: 'fasting-meal-timing',
  },
  pantry: {
    title: 'Your pantry',
    body: 'What you tick here is what recipes use first and what drops off your grocery list. Vitals keeps names only and never reads nutrients from it. Anything you have not confirmed for two weeks comes back as “Still have these?”; nothing is removed on its own.',
    source: { kind: 'logged', words: 'Only what you tick or type: names, never nutrients.' },
    evidence: 'kitchen-pantry-recipes',
  },
  pantryPage: {
    title: 'Your pantry',
    body: 'What you tick here is what recipes use first and what drops off your grocery list. Pick what you have; search finds the rest; add anything else in your own words. Vitals keeps names only and never reads nutrients from it. Anything you have not confirmed for two weeks comes back as “Still have these?”; nothing is removed on its own.',
    source: { kind: 'logged', words: 'Only what you tick or type: names, never nutrients.' },
    evidence: 'kitchen-pantry-recipes',
  },
  supplements: {
    title: 'Supplements, food first',
    body: 'The plan lists a supplement only when it helps your goals; “Food first” means the card names foods before any product. Tick one when you take it so it counts for today. “Unchecked” means a safety answer it depends on is missing. Vegetarian diets are often low in vitamin B12: consider a test and ask a doctor.',
    source: { kind: 'plan', words: 'Doses are the plan’s; a tick is what you took.' },
    evidence: 'supplements',
  },
  groceries: {
    title: 'Your grocery list',
    body: 'The list adds up the ingredients of the recipes you accepted, for the days you choose, in pack sizes. Tick a row once you have bought it. “Have it” marks something already at home and saves it to your pantry, so it drops off the list. Share or print the list for the shop.',
    source: { kind: 'plan', words: 'The recipes you accepted, for the days you choose.' },
    evidence: 'kitchen-pantry-recipes',
  },
} satisfies Record<string, InfoEntry>;
