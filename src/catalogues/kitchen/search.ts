/**
 * One search index over the four kitchen catalogues (R12 §6 "Free text"): labels, aliases (Hindi and regional names:
 * bhindi = okra, pyaz = onion) and the words in a label's brackets ("Whole-wheat flour (atta)" → atta). Pure.
 *
 * Score per item, best name wins: 1 the whole name (plurals folded) · 0.92 the name starts with the query · 0.85 a
 * word of the name starts with the query · 0.86 every word of a several-word query is in the name · token overlap (`matchScore`, ≤ 0.85) · 0.6 the query appears inside a
 * word (≥ 3 letters). The picker shows matches ≥ `SHOW_AT`; the free-text resolver accepts ≥ `ACCEPT_AT` only.
 */
import { matchScore, normName, tokens } from '../text';
import type { KitchenCatalogue } from './catalogue';
import { KITCHEN_KINDS, type KitchenItem, type KitchenKind } from './types';

export const SHOW_AT = 0.5;
export const ACCEPT_AT = 0.8;

interface Entry {
  item: KitchenItem;
  kind: KitchenKind;
  /** Raw names (label first) for `matchScore`. */
  names: string[];
  /** Normalised names with plurals folded. */
  keys: string[];
  /** Words of every name. */
  words: string[];
  /** Normalised label length (shorter wins ties: "milk" → "Milk", not "Milk powder"). */
  len: number;
}

export interface KitchenIndex {
  readonly entries: readonly Entry[];
  readonly byKind: ReadonlyMap<KitchenKind, readonly Entry[]>;
}

export interface KitchenHit {
  item: KitchenItem;
  kind: KitchenKind;
  score: number;
  /** The label or alias that matched best (shown as "matched: okra (bhindi)"). */
  matched: string;
}

const fold = (s: string): string => tokens(s).join(' ');

/** Names of an item: label, the label without brackets, the words in brackets, aliases (without "(W)" style notes). */
export function namesOf(item: KitchenItem): string[] {
  const out = [item.label];
  const bare = item.label.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  if (bare && bare !== item.label) out.push(bare);
  for (const m of item.label.matchAll(/\(([^)]+)\)/g)) for (const part of m[1]!.split(/[,/]/)) if (part.trim()) out.push(part.trim());
  for (const a of item.aliases) {
    out.push(a);
    const b = a.replace(/\s*\(.*?\)\s*/g, ' ').trim();
    if (b && b !== a) out.push(b);
  }
  return [...new Set(out)];
}

export function buildKitchenIndex(cat: KitchenCatalogue): KitchenIndex {
  const entries: Entry[] = [];
  const byKind = new Map<KitchenKind, Entry[]>();
  for (const kind of KITCHEN_KINDS) {
    const list: Entry[] = [];
    for (const item of cat.list(kind)) {
      const names = namesOf(item);
      const e: Entry = { item, kind, names, keys: names.map(fold), words: [...new Set(names.flatMap((n) => tokens(n)))], len: normName(item.label).length };
      list.push(e);
      entries.push(e);
    }
    byKind.set(kind, list);
  }
  return { entries, byKind };
}

function scoreEntry(e: Entry, q: string, qFold: string): { score: number; matched: string } {
  let best = 0;
  let matched = e.item.label;
  const take = (s: number, name: string) => {
    if (s > best) {
      best = s;
      matched = name;
    }
  };
  for (let i = 0; i < e.keys.length; i++) {
    const k = e.keys[i]!;
    if (!k) continue;
    if (k === qFold) return { score: 1, matched: e.names[i]! };
    if (k.startsWith(qFold)) take(0.92, e.names[i]!);
  }
  if (best < 0.85 && qFold.length >= 2 && !qFold.includes(' ')) {
    for (const w of e.words) if (w.startsWith(qFold)) take(0.85, e.names.find((n) => tokens(n).includes(w)) ?? e.item.label);
  }
  if (best < 0.86 && qFold.includes(' ')) {
    const qt = qFold.split(' ');
    for (const n of e.names) {
      const nt = new Set(tokens(n));
      if (qt.every((t) => nt.has(t))) take(0.86, n);
    }
  }
  if (best < 0.85) {
    const s = matchScore(q, e.names);
    if (s > best) take(s, e.names.find((n) => matchScore(q, [n]) === s) ?? e.item.label);
  }
  if (best < 0.6 && qFold.length >= 3) {
    for (const w of e.words) if (w.length > qFold.length && w.includes(qFold)) take(0.6, e.item.label);
  }
  return { score: best, matched };
}

/** Best matches first (ties: shorter label, then seed order). */
export function searchKitchen(index: KitchenIndex, query: string, opts: { kinds?: readonly KitchenKind[]; limit?: number; min?: number } = {}): KitchenHit[] {
  const q = query.trim();
  const qFold = fold(q);
  if (!qFold) return [];
  const kinds = opts.kinds ?? KITCHEN_KINDS;
  const min = opts.min ?? SHOW_AT;
  const hits: Array<KitchenHit & { len: number; order: number }> = [];
  let order = 0;
  for (const kind of kinds) {
    for (const e of index.byKind.get(kind) ?? []) {
      order++;
      const { score, matched } = scoreEntry(e, q, qFold);
      if (score >= min) hits.push({ item: e.item, kind, score, matched, len: e.len, order });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.len - b.len || a.order - b.order);
  return hits.slice(0, opts.limit ?? 50).map(({ item, kind, score, matched }) => ({ item, kind, score, matched }));
}

/** Ids of a kind matching the query (the picker's filter; empty query = every id). */
export function filterIds(index: KitchenIndex, kind: KitchenKind, query: string): Set<string> {
  if (!query.trim()) return new Set((index.byKind.get(kind) ?? []).map((e) => e.item.id));
  return new Set(searchKitchen(index, query, { kinds: [kind], limit: 1000 }).map((h) => h.item.id));
}
