/**
 * Free text → kitchen items (pure): the "I also have…" field, the paste-a-list box and the Coach's "I have these at
 * home" all go through `parseKitchenList`. Lines, commas, semicolons and bullets split items; quantities are removed
 * from the name and kept as written (`qty`); a line is matched against labels and aliases (`searchKitchen`) and kept
 * as the person's own words when nothing matches well enough. Nothing is ever rejected.
 */
import { normName } from '../text';
import { ACCEPT_AT, searchKitchen, type KitchenIndex } from './search';
import type { KitchenKind, ParsedItem } from './types';

const MAX_ITEMS = 200;
const MAX_LABEL = 80;

const UNIT =
  'kgs?|kilos?|kilograms?|g|gm|gms|grams?|mg|l|ltrs?|litres?|liters?|ml|lbs?|oz|pcs?|pieces?|nos?|packets?|packs?|pkts?|bottles?|cans?|tins?|jars?|bunch(?:es)?|dozens?|box(?:es)?|bags?|cups?|tbsps?|tsps?|loaf|loaves|sachets?|cartons?|trays?|heads?|cloves?|sticks?|blocks?|slabs?|katoris?|bowls?';
const NUM = '(?:\\d+(?:[.,]\\d+)?(?:\\s*/\\s*\\d+)?|[½¼¾⅓⅔]|\\d+\\s*[½¼¾])';
/** "2 kg", "500g", "1/2 kg", "x3", "3x", "2 packets of", "half a kg of", "(2 kg)". */
const QTY_PATTERNS: RegExp[] = [
  /^(?:x\s*\d+|\d+\s*x)(?=\s|$)/i,
  new RegExp(`\\(\\s*(?:${NUM}\\s*(?:${UNIT})?|(?:${UNIT}))\\s*\\)`, 'i'),
  new RegExp(`^(?:about|around|approx\\.?|~)?\\s*${NUM}\\s*(?:-\\s*${NUM}\\s*)?(?:${UNIT})?\\.?(?:\\s+of)?\\b`, 'i'),
  new RegExp(`[-–:,]?\\s*(?:about|around|approx\\.?|~)?\\s*${NUM}\\s*(?:-\\s*${NUM}\\s*)?(?:${UNIT})\\.?$`, 'i'),
  /\s*(?:x\s*\d+|\d+\s*x)$/i,
  /^(?:half|quarter|one|two|three|four|five|six|a|an)\s+(?:dozen|kg|kilo|litre|liter|packet|pack|bag|bottle|jar|tin|can|bunch|box|loaf)s?(?:\s+of)?\b/i,
  /^(?:a\s+few|a\s+little|a\s+bit\s+of|some|lots\s+of|plenty\s+of|a\s+lot\s+of|a\s+bunch\s+of|leftover|fresh)\s+/i,
  /\s+[-–]\s*\d+\s*$/,
  /\s*\d+$/,
];

/** Split a pasted list into raw lines (newlines, commas, semicolons, bullets, tabs). */
export function splitList(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/[\n,;\t•·|]+/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** One raw line → label without bullets and quantities, and the quantity text. */
export function cleanLine(line: string): { label: string; qty?: string } {
  let s = line
    .replace(/^\s*(?:[-*+–—>]+|\d{1,3}[.)]|\[[ xX✓]?\]|[✓✔☐☑])\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const qty: string[] = [];
  for (let pass = 0; pass < 3; pass++) {
    for (const re of QTY_PATTERNS) {
      const m = s.match(re);
      if (m && m[0].trim() && m[0].trim().length < s.length) {
        qty.push(m[0].replace(/^[\s\-–:,(]+|[\s)]+$/g, '').replace(/\s+of$/i, '').trim());
        s = (s.slice(0, m.index) + ' ' + s.slice(m.index! + m[0].length)).replace(/\s+/g, ' ').trim();
      }
    }
  }
  s = s.replace(/^(?:of|and|&)\s+/i, '').replace(/[.!?:]+$/, '').trim();
  const q = qty.filter((x) => x && !/^(?:a few|a little|a bit of|some|lots of|plenty of|a lot of|a bunch of|leftover|fresh)$/i.test(x)).join(' ');
  return { label: s.slice(0, MAX_LABEL), ...(q ? { qty: q } : {}) };
}

/** Best catalogue match for one cleaned label (the first kind in `kinds` wins ties). */
export function resolveFreeText(index: KitchenIndex, label: string, kinds: readonly KitchenKind[]): ParsedItem {
  const hits = searchKitchen(index, label, { kinds, limit: 20, min: 0.3 });
  const best = hits[0]?.score ?? 0;
  const top = hits.filter((h) => h.score === best).sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind))[0];
  if (top && top.score >= ACCEPT_AT) return { label, id: top.item.id, confidence: round(top.score) };
  return { label, id: null, confidence: top ? round(Math.min(top.score, ACCEPT_AT - 0.01)) : 0 };
}

const round = (x: number): number => Math.round(x * 100) / 100;

/** Pasted or typed text → items in order, de-duplicated by id (matched) or by name (kept as written). */
export function parseKitchenList(index: KitchenIndex, text: string, kinds: readonly KitchenKind[]): ParsedItem[] {
  const out: ParsedItem[] = [];
  const seen = new Set<string>();
  for (const raw of splitList(text)) {
    const { label, qty } = cleanLine(raw);
    if (!label || !/[\p{L}]/u.test(label)) continue;
    const item = resolveFreeText(index, label, kinds);
    const key = item.id ?? `text:${normName(label)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(qty ? { ...item, qty } : item);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/** `custom:<slug>` for an item the catalogue does not have ("custom:waffle-maker"). */
export function customId(label: string): string {
  const slug = normName(label).replace(/\s+/g, '-').slice(0, 48);
  return `custom:${slug || 'item'}`;
}

export const isCustomId = (id: string): boolean => id.startsWith('custom:');
