/**
 * TEST FIXTURE, not the food reference. A dozen common foods with per-100 g values written from memory of USDA SR Legacy
 * rows (rounded; `verified: false`) so the `FoodTable` contract, meal arithmetic and meal equivalence can be tested.
 * The bundled table (≈ 2,000 USDA FoodData Central foods plus Indian staples from IFCT 2017 once NIN grants permission,
 * R4 §2) is a later data task; see docs/CATALOGUES.md. Do not show these numbers to users.
 */
import type { FoodRecord } from '@/catalogues/types';

const SR = ['FDC-SR'];

export const FOOD_FIXTURE: readonly FoodRecord[] = [
  { id: 'egg_whole_raw', name: 'Egg, whole, raw', aliases: ['egg', 'anda'], group: 'eggs', tags: ['egg', 'animal'], source: 'fixture', verified: false, state: 'raw', portions: [{ label: '1 large egg', g: 50 }], per100g: { energyKcal: 143, proteinG: 12.6, fatG: 9.5, carbG: 0.7, fibreG: 0, satFatG: 3.1, cholesterolMg: 372, sodiumMg: 142 }, proteinSource: 'egg', sources: SR },
  { id: 'rice_white_cooked', name: 'Rice, white, cooked', aliases: ['chawal', 'bhaat', 'rice'], group: 'cereals', tags: ['veg', 'vegan', 'jain'], source: 'fixture', verified: false, state: 'cooked', portions: [{ label: '1 katori (155 mL)', g: 120 }], per100g: { energyKcal: 130, proteinG: 2.7, fatG: 0.3, carbG: 28.2, fibreG: 0.4, satFatG: 0.1 }, proteinSource: 'rice', sources: SR },
  { id: 'wheat_flour_wholegrain', name: 'Wheat flour, whole-grain (atta)', aliases: ['atta', 'whole wheat flour'], group: 'cereals', tags: ['veg', 'vegan', 'jain', 'gluten'], source: 'fixture', verified: false, state: 'raw', portions: [{ label: '1 roti worth of flour', g: 25 }], per100g: { energyKcal: 340, proteinG: 13.2, fatG: 2.5, carbG: 72.0, fibreG: 10.7, satFatG: 0.4 }, proteinSource: 'wheat', sources: SR },
  { id: 'lentils_cooked', name: 'Lentils, boiled', aliases: ['dal', 'masoor dal'], group: 'pulses', tags: ['veg', 'vegan', 'jain'], source: 'fixture', verified: false, state: 'cooked', portions: [{ label: '1 katori (155 mL)', g: 150 }], per100g: { energyKcal: 116, proteinG: 9.0, fatG: 0.4, carbG: 20.1, fibreG: 7.9, satFatG: 0.1 }, proteinSource: 'pea', sources: SR },
  { id: 'chickpeas_cooked', name: 'Chickpeas, boiled', aliases: ['chana', 'chole'], group: 'pulses', tags: ['veg', 'vegan', 'jain'], source: 'fixture', verified: false, state: 'cooked', portions: [{ label: '1 katori (155 mL)', g: 150 }], per100g: { energyKcal: 164, proteinG: 8.9, fatG: 2.6, carbG: 27.4, fibreG: 7.6, satFatG: 0.3 }, proteinSource: 'pea', sources: SR },
  { id: 'chicken_breast_raw', name: 'Chicken breast, skinless, raw', aliases: ['chicken'], group: 'poultry', tags: ['meat', 'chicken', 'animal'], source: 'fixture', verified: false, state: 'raw', portions: [{ label: '1 breast', g: 170 }], per100g: { energyKcal: 120, proteinG: 22.5, fatG: 2.6, carbG: 0, fibreG: 0, satFatG: 0.6 }, proteinSource: 'meat', sources: SR },
  { id: 'milk_whole', name: 'Milk, whole', aliases: ['doodh', 'milk'], group: 'dairy', tags: ['veg', 'dairy', 'jain'], source: 'fixture', verified: false, state: 'as-eaten', portions: [{ label: '1 glass (200 mL)', g: 206 }], per100g: { energyKcal: 61, proteinG: 3.2, fatG: 3.3, carbG: 4.8, fibreG: 0, satFatG: 1.9 }, proteinSource: 'milk', sources: SR },
  { id: 'yogurt_whole', name: 'Yogurt, plain, whole milk', aliases: ['curd', 'dahi'], group: 'dairy', tags: ['veg', 'dairy', 'jain'], source: 'fixture', verified: false, state: 'as-eaten', portions: [{ label: '1 katori (155 mL)', g: 150 }], per100g: { energyKcal: 61, proteinG: 3.5, fatG: 3.3, carbG: 4.7, fibreG: 0, satFatG: 2.1 }, proteinSource: 'milk', sources: SR },
  { id: 'ghee', name: 'Ghee (butter oil, anhydrous)', aliases: ['ghee', 'clarified butter'], group: 'fats', tags: ['veg', 'dairy', 'jain'], source: 'fixture', verified: false, state: 'as-eaten', portions: [{ label: '1 tsp', g: 5 }], per100g: { energyKcal: 876, proteinG: 0.3, fatG: 99.5, carbG: 0, fibreG: 0, satFatG: 61.9 }, sources: SR },
  { id: 'banana_raw', name: 'Banana, raw', aliases: ['kela'], group: 'fruit', tags: ['veg', 'vegan', 'jain'], source: 'fixture', verified: false, state: 'raw', edibleFraction: 0.64, portions: [{ label: '1 medium', g: 118 }], per100g: { energyKcal: 89, proteinG: 1.1, fatG: 0.3, carbG: 22.8, fibreG: 2.6, satFatG: 0.1 }, sources: SR },
  { id: 'spinach_raw', name: 'Spinach, raw', aliases: ['palak'], group: 'vegetables', tags: ['veg', 'vegan'], source: 'fixture', verified: false, state: 'raw', portions: [{ label: '1 cup', g: 30 }], per100g: { energyKcal: 23, proteinG: 2.9, fatG: 0.4, carbG: 3.6, fibreG: 2.2, satFatG: 0.1 }, sources: SR },
  { id: 'paneer', name: 'Paneer (estimated from whole-milk cheese)', aliases: ['paneer', 'cottage cheese (Indian)'], group: 'dairy', tags: ['veg', 'dairy', 'jain'], source: 'derived', verified: false, state: 'as-eaten', portions: [{ label: '1 cube 25 g', g: 25 }], per100g: { energyKcal: 290, proteinG: 18.0, fatG: 22.0, carbG: 3.0, fibreG: 0, satFatG: 14.0 }, proteinSource: 'milk', sources: ['R4-PANEER'] },
];

/** Source keys of the fixture (not part of the catalogue source table). */
export const FOOD_FIXTURE_SOURCES = {
  'FDC-SR': { key: 'FDC-SR', cite: 'USDA FoodData Central, SR Legacy (2018), CC0; values rounded from memory for a test fixture', url: 'https://fdc.nal.usda.gov/download-datasets/', accessed: '2026-10-01', internal: false },
  'R4-PANEER': { key: 'R4-PANEER', cite: 'Paneer approximated from whole-milk cheese (unverified estimate)', url: null, accessed: '2026-10-01', internal: false },
} as const;
