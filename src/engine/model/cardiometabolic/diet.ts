/**
 * Daily dietary feature vector of the cardiometabolic module (06 §4.18 step 1-2): everything the lipid, BP, urate,
 * liver-fat and insulin-sensitivity equations need from one `DayInput`, expressed the way the dossiers express it
 * (energy shares, g/d, mmol/d). One instance is filled per day with `readDiet` (no allocation); the module keeps three:
 * the habitual reference (`k.hab`, from the burn-in day), today's reading and the held snapshot (composition-driven
 * targets hold on zero-intake days, see index.ts).
 */
import type { DayInput } from '../../types/inputs';

const MMOL_PER_MG_K = 1 / 39.098;

export class Diet {
  /** Energy of the day, kcal. */
  energyKcal = 0;
  /** Total saturated fat and saturated fat net of MCT (12:0-18:0 classes only, 06 §4.2.2), % of energy. */
  sfaTotPct = 0;
  sfaEffPct = 0;
  /** cis-MUFA and cis-PUFA, % of energy (fat-class shares × 9 kcal/g). */
  mufaPct = 0;
  pufaPct = 0;
  /** Total fat, % of energy (9 kcal/g; validity domain of the Mensink exchange terms, 06 §4.5 component 1). */
  fatPct = 0;
  /** Protein, % of energy (4 kcal/g). */
  protPct = 0;
  /** Total sugars and fructose (free + ½ sucrose), % of energy (4 kcal/g). */
  sugarPct = 0;
  fructosePct = 0;
  /** Net carbohydrate, g/d. */
  carbG = 0;
  /** Sugars as a share of net carbohydrate (for the 04 §4.13b DNL biomarker). */
  sugarShareOfCarb = 0;
  /** Viscous fibre, g/d; tree nuts in servings (28.4 g) per day. */
  viscousG = 0;
  nutServings = 0;
  /** EPA + DHA, g/d. */
  omega3G = 0;
  /** Sodium g/d; potassium mmol/d; DASH-like fraction 0..1; dietary cholesterol mg/d (NaN = not given). */
  sodiumG = 0;
  potassiumMmol = 0;
  dash = 0;
  cholesterolMg = Number.NaN;

  copyFrom(o: Diet): void {
    this.energyKcal = o.energyKcal;
    this.sfaTotPct = o.sfaTotPct;
    this.sfaEffPct = o.sfaEffPct;
    this.mufaPct = o.mufaPct;
    this.pufaPct = o.pufaPct;
    this.fatPct = o.fatPct;
    this.protPct = o.protPct;
    this.sugarPct = o.sugarPct;
    this.fructosePct = o.fructosePct;
    this.carbG = o.carbG;
    this.sugarShareOfCarb = o.sugarShareOfCarb;
    this.viscousG = o.viscousG;
    this.nutServings = o.nutServings;
    this.omega3G = o.omega3G;
    this.sodiumG = o.sodiumG;
    this.potassiumMmol = o.potassiumMmol;
    this.dash = o.dash;
    this.cholesterolMg = o.cholesterolMg;
  }
}

/**
 * Fill `d` from one resolved day. `nutServingG` = 28.4 g, `dashQ3` = fraction credited at food quality 3.
 * `DayInput.dashFraction` (0..1) overrides the food-quality derivation when finite; `DayInput.cholesterolMg` undefined or
 * NaN = not given (habitual intake, no cholesterol effect).
 */
export function readDiet(d: Diet, day: DayInput, nutServingG: number, dashQ3: number): void {
  const e = day.energyKcal;
  const inv = e > 0 ? 100 / e : 0;
  d.energyKcal = e;
  d.sfaTotPct = 9 * day.satFatG * inv;
  const sfaEff = day.satFatG - day.mctG;
  d.sfaEffPct = 9 * (sfaEff > 0 ? sfaEff : 0) * inv;
  d.mufaPct = 9 * day.mufaG * inv;
  d.pufaPct = 9 * day.pufaG * inv;
  d.fatPct = 9 * day.fatG * inv;
  d.protPct = 4 * day.proteinG * inv;
  d.sugarPct = 4 * day.sugarsG * inv;
  d.fructosePct = 4 * day.fructoseG * inv;
  d.carbG = day.carbG;
  d.sugarShareOfCarb = day.carbG > 0 ? day.sugarsG / day.carbG : 0;
  d.viscousG = day.viscousFibreG;
  d.nutServings = day.nutsG / nutServingG;
  d.omega3G = day.omega3G;
  d.sodiumG = day.sodiumMg / 1000;
  d.potassiumMmol = day.potassiumMg * MMOL_PER_MG_K;
  const df = day.dashFraction;
  if (df !== undefined && Number.isFinite(df)) d.dash = df < 0 ? 0 : df > 1 ? 1 : df;
  else {
    const q = day.foodQuality - 2;
    d.dash = dashQ3 * (q < 0 ? 0 : q > 1 ? 1 : q);
  }
  const chol = day.cholesterolMg;
  d.cholesterolMg = chol === undefined ? Number.NaN : chol;
}
