// @vitest-environment node
/**
 * Guard for the owner's ring: it is a "J-Style 2301" everywhere, and its retail brand must appear in no file and no
 * file name, public or private (exclude.txt does not apply here). The needle is built from char codes so this file
 * never holds it. Two unit words contain its five letters (mega/giga + bit) and are blanked first; a left word
 * boundary would do that too, but would also let identifier forms (`myX`, `ringX`) through. Failures name files only.
 */
import { listPaths, readText } from './scan';

const NEEDLE = String.fromCharCode(71, 97, 98, 105, 116).toLowerCase();
const UNITS = new RegExp(`(me|gi)${NEEDLE}`, 'g');

const hit = (s: string) => s.toLowerCase().replace(UNITS, '').includes(NEEDLE);

describe('ring retail brand', () => {
  it('is blanked out of the unit words only', () => {
    expect(hit('a 1 megabit / 10 Gigabit link')).toBe(false);
    expect(hit(`my${NEEDLE.toUpperCase()} ring`)).toBe(true);
    expect(hit(`x-${NEEDLE}`)).toBe(true);
  });

  it('appears in no file name', () => {
    expect(listPaths().filter(hit), 'say "J-Style 2301" instead of the retail brand').toEqual([]);
  });

  it('appears in no file', () => {
    const hits = listPaths().filter((f) => {
      const text = readText(f);
      return text !== null && hit(text);
    });
    expect(hits, 'say "J-Style 2301" instead of the retail brand').toEqual([]);
  }, 60_000);
});
