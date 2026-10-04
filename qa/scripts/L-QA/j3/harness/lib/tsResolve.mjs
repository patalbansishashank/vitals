// Lets plain Node (type stripping, Node >= 22.18) import the app's TypeScript sources, which use extensionless relative
// imports (`'../crypto'`) and the `@/` alias for `src/` because Vite and Vitest resolve them. Relative and `@/`
// specifiers without an extension try `.ts`, `.tsx` and `/index.ts`. A file Node's type stripping refuses (parameter
// properties, enums: ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX) is transpiled with the repo's own `typescript` package instead.
// Import this module first (before any `src/**` import).
import { createRequire, registerHooks, stripTypeScriptTypes } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CAND_ROOT = pathToFileURL(fileURLToPath(new URL('../../../../../../', import.meta.url))).href;
const SRC = `${CAND_ROOT}src/`;

let ts = null;
const transpile = (url, code) => {
  ts ??= createRequire(`${CAND_ROOT}package.json`)('typescript');
  const out = ts.transpileModule(code, {
    fileName: fileURLToPath(url),
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false, useDefineForClassFields: true, sourceMap: false },
  });
  return { format: 'module', source: out.outputText, shortCircuit: true };
};

const isFile = (u) => {
  try {
    const p = fileURLToPath(u);
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
};

registerHooks({
  resolve(specifier, context, next) {
    let spec = specifier;
    let parent = context.parentURL;
    if (spec.startsWith('@/')) {
      spec = `./${spec.slice(2)}`;
      parent = SRC;
    }
    if ((spec.startsWith('./') || spec.startsWith('../')) && parent?.startsWith('file:')) {
      const u0 = new URL(spec, parent);
      if (/\.[cm]?[jt]sx?$|\.json$/.test(spec)) return spec === specifier ? next(specifier, context) : next(u0.href, context);
      for (const ext of ['.ts', '.tsx', '/index.ts']) {
        const u = new URL(spec + ext, parent);
        if (isFile(u)) return next(u.href, context);
      }
    }
    try {
      return next(specifier, context);
    } catch (e) {
      // J3: a bare package name the L-QA tree lacks resolves from the candidate tree's dependencies
      if (/^[@a-z]/.test(specifier) && !specifier.startsWith('node:')) return next(specifier, { ...context, parentURL: `${CAND_ROOT}package.json` });
      throw e;
    }
  },
  load(url, context, next) {
    const r = next(url, context);
    if (r.format !== 'module-typescript' || !url.startsWith('file:')) return r;
    const code = typeof r.source === 'string' ? r.source : readFileSync(fileURLToPath(url), 'utf8');
    try {
      return { ...r, format: 'module', source: stripTypeScriptTypes(code) };
    } catch (e) {
      if (e?.code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') return transpile(url, code);
      throw e;
    }
  },
});
