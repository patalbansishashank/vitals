// Document helpers: the shapes the app writes (src/commands/food/index.ts commitMeal → `dailyLogs`, append, ULID id;
// `settings/me`, per-field LWW, src/store/collections.ts) and the comparison used for convergence (fields only; Evolu
// clocks, revisions and device stamps are ignored).

/** A typed meal entry for `dailyLogs`, as the app's food log writes it (body without `_id`). */
export function mealEntry({ date, tz = 'Asia/Kolkata', text, kcal = 300, at = new Date().toISOString() }) {
  const est = (value) => ({ value, sd: Math.round(value * 0.1 * 10) / 10 });
  const nutrients = { energyKcal: est(kcal), proteinG: est(20), carbG: est(30), fatG: est(10) };
  return {
    date,
    tz,
    at,
    source: { by: 'user', method: 'typed' },
    confidence: 1,
    text,
    kind: 'meal',
    clockH: 12,
    components: [{ name: text, grams: est(150), nutrients, nutrientSource: 'user' }],
    totals: nutrients,
  };
}

/** Today's date in a time zone (YYYY-MM-DD). */
export const todayIn = (tz = 'Asia/Kolkata') => new Date().toLocaleDateString('en-CA', { timeZone: tz });

/** Key-order independent JSON. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}

/** Only the named fields of each document (what a projection like the server's `log_get` can be compared on). */
export function project(docs, fields) {
  if (!fields) return docs;
  return Object.fromEntries(Object.entries(docs).map(([id, d]) => [id, Object.fromEntries(fields.filter((f) => d?.[f] !== undefined).map((f) => [f, d[f]]))]));
}

/**
 * Compares `{ [replica]: { [docId]: fields } }`. Returns `{ ok, diffs }`: every replica must hold the same ids, and the
 * same fields per id (after `project` with `fields`, when given).
 */
export function converged(views, fields = null) {
  const names = Object.keys(views);
  const diffs = [];
  const ref = project(views[names[0]], fields);
  for (const n of names.slice(1)) {
    const v = project(views[n], fields);
    const ids = new Set([...Object.keys(ref), ...Object.keys(v)]);
    for (const id of ids) {
      if (!(id in ref)) diffs.push(`${id}: on ${n}, not on ${names[0]}`);
      else if (!(id in v)) diffs.push(`${id}: on ${names[0]}, not on ${n}`);
      else if (canonical(ref[id]) !== canonical(v[id])) diffs.push(`${id}: fields differ between ${names[0]} and ${n}`);
    }
  }
  return { ok: diffs.length === 0, diffs };
}
