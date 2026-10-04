/** Name matching helpers shared by the catalogues (pure). */

/** Lower-case, strip diacritics and punctuation, collapse spaces. */
export function normName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Tokens of a normalised name, with a light plural strip ("curls" → "curl"). */
export function tokens(s: string): string[] {
  return normName(s)
    .split(' ')
    .filter((t) => t.length > 0)
    .map((t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
}

/**
 * Match score of a query against a name and its aliases, 0..1: 1 exact (normalised), 0.9 prefix, else token overlap
 * (Jaccard of token sets, scaled to 0.85).
 */
export function matchScore(query: string, names: readonly string[]): number {
  const q = normName(query);
  if (!q) return 0;
  const qt = new Set(tokens(query));
  let best = 0;
  for (const n of names) {
    const nn = normName(n);
    if (!nn) continue;
    if (nn === q) return 1;
    if (nn.startsWith(q) || q.startsWith(nn)) best = Math.max(best, 0.9);
    const nt = new Set(tokens(n));
    let inter = 0;
    for (const t of qt) if (nt.has(t)) inter++;
    const union = qt.size + nt.size - inter;
    if (union > 0) best = Math.max(best, (0.85 * inter) / union);
  }
  return best;
}

/** An energy amount for a sentence, kJ beside kcal: "120 kcal (500 kJ)"; kJ to the nearest 10. */
export function energyText(kcal: number): string {
  const k = Math.round(kcal);
  return `${k} kcal (${Math.round((k * 4.184) / 10) * 10} kJ)`;
}
