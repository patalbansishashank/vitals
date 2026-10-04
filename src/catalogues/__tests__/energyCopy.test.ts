// @vitest-environment node
/**
 * Review pass 1: text this folder builds for a screen shows kJ wherever it shows kcal (product rule). A static scan of
 * the string and template literals of the non-test sources.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === '__tests__' ? [] : files(p);
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });

describe('energy copy in catalogue code', () => {
  it('every literal that prints kcal also prints kJ', () => {
    const bad: string[] = [];
    for (const file of files(ROOT)) {
      const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (n: ts.Node): void => {
        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) {
          const text = n.getText(sf);
          // prose that names an energy amount ("about 120 kcal"), not keys like 'kcal' or field names
          if (/\d[^`'"]*\bkcal\b|\}\s*kcal\b/.test(text) && !/\bkJ\b/.test(text)) bad.push(`${file.slice(ROOT.length + 1)}: ${text.slice(0, 90)}`);
          return;
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(bad).toEqual([]);
  });
});
