/**
 * Guard (SUITE_SPEC §14.8): the Companion is no longer something a person installs, so no screen text may name it, and
 * the old local-pairing instructions (the 8-digit code "from your terminal" / the Companion window) are gone. The
 * "local network" explanation stays: it is about the browser's permission for the server.
 *
 * Scanned: every string literal and JSX text of non-test source under `src/features/**`, `src/app/**` and `src/ai/**`
 * (the Coach's error sentences live there; Q8 found one naming the Companion), every value of
 * the copy modules there, and the server error messages. Comments are not scanned. The word may stay only in code
 * identifiers and comments (the command actor kind `companion` is an id, not text).
 */
import ts from 'typescript';
import { SERVER_MESSAGES } from '@/net/server';

const sources = import.meta.glob(
  ['/src/features/**/*.{ts,tsx}', '/src/app/**/*.{ts,tsx}', '/src/ai/**/*.{ts,tsx}', '!/src/**/__tests__/**', '!/src/**/*.test.{ts,tsx}', '!/src/**/testing.ts', '!/src/**/fixtures.ts'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const FORBIDDEN: Array<[RegExp, string]> = [
  [/\bCompanion\b/, 'the word "Companion"'],
  [/vitals-companion/i, 'a Companion command'],
  [/code (shown )?(in|from) (the|your) (terminal|Companion window)/i, 'the old local-pairing instructions'],
];

function literals(file: string, code: string): Array<[number, string]> {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Array<[number, string]> = [];
  const visit = (n: ts.Node): void => {
    let text: string | null = null;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) text = n.text;
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) text = n.text;
    else if (ts.isJsxText(n)) text = n.text;
    // import specifiers are module paths, not text
    if (text !== null && !ts.isImportDeclaration(n.parent) && !ts.isExportDeclaration(n.parent)) out.push([sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, text]);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('no Companion wording on screen', () => {
  it('finds the sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });

  it('screen text in src/features, src/app and src/ai never names the Companion or its pairing', () => {
    const hits: string[] = [];
    for (const [file, code] of Object.entries(sources)) {
      for (const [line, text] of literals(file, code)) {
        for (const [re, what] of FORBIDDEN) if (re.test(text)) hits.push(`${file}:${line} ${what}: ${text.slice(0, 80)}`);
      }
    }
    expect(hits).toEqual([]);
  }, 60_000);

  it('server error messages pass the same scan and name no route, token or proxy', () => {
    for (const m of Object.values(SERVER_MESSAGES)) {
      for (const [re] of FORBIDDEN) expect(m).not.toMatch(re);
      expect(m).not.toMatch(/\bproxy\b|\bpreset\b|\btoken\b|\bMCP\b|\/v1\//);
    }
  });
});
