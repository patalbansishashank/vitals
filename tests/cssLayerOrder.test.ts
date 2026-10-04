// @vitest-environment node
/**
 * The cascade layer order is declared in index.html before any stylesheet (L-QA J5-01): Vite may link a split CSS chunk
 * (the shell's `@layer components{…}`) before the main one, and the first stylesheet to name a layer fixes the order,
 * which once put `components` below Tailwind's `base` and stripped every key's fill and the page gutters.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const ORDER = '@layer properties, theme, base, components, utilities;';
const PACKED = ORDER.replace(/\s+/g, '');

/** Index of the first stylesheet (inline style or linked sheet) in an HTML head. */
function firstStyle(html: string): { at: number; text: string } {
  const m = /<style[^>]*>([\s\S]*?)<\/style>|<link[^>]*rel="stylesheet"[^>]*>/.exec(html);
  // Whitespace dropped: the build minifies the inline style.
  return { at: m?.index ?? -1, text: (m?.[1] ?? m?.[0] ?? '').replace(/\s+/g, '') };
}

describe('cascade layer order', () => {
  it('index.html declares it before any stylesheet', () => {
    expect(firstStyle(readFileSync(join(ROOT, 'index.html'), 'utf8')).text).toBe(PACKED);
  });

  it('the built page keeps it first when a build is present', () => {
    const built = join(ROOT, 'dist/index.html');
    if (!existsSync(built)) return;
    expect(firstStyle(readFileSync(built, 'utf8')).text).toBe(PACKED);
  });

  it('lists every layer the app and Tailwind use, Tailwind first', () => {
    const layers = ORDER.replace(/^@layer |;$/g, '').split(', ');
    expect(layers).toEqual(['properties', 'theme', 'base', 'components', 'utilities']);
    // vite.config.ts fails the build on the same rule
    expect(readFileSync(join(ROOT, 'vite.config.ts'), 'utf8')).toContain(`const LAYER_ORDER = '${layers.join(',')}';`);
  });

  it('flags a stylesheet linked before the declaration', () => {
    expect(firstStyle(`<head><link rel="stylesheet" href="/assets/shell.css"><style>${ORDER}</style></head>`).text).not.toBe(PACKED);
  });
});
