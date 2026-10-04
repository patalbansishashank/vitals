/**
 * Shared file walk for the public-hygiene guards (ringBrand.test.ts, privateNames.test.ts). Same approach as the V0789
 * passcode guard: every tracked and untracked-not-ignored file, binaries and files over 8 MB skipped, read as latin1.
 * Also the matcher for scripts/publish/exclude.txt, so the guard checks exactly the tree publish-public.sh ships.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const REPO = join(__dirname, '../..');
export const BINARY = /\.(png|jpe?g|webp|gif|avif|ico|woff2?|ttf|otf|wasm|zip|gz|br|pdf|mp4|webm|db|sqlite)$/i;

/** Every tracked and untracked-not-ignored path (deleted files included; `readText` skips them). */
export function listPaths(): string[] {
  return execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\0')
    .filter((f) => f && !f.startsWith('node_modules/') && !f.includes('/node_modules/'));
}

/** The text of a scannable file, or null for binaries, files over 8 MB and files deleted in the working tree. */
export function readText(f: string): string | null {
  if (BINARY.test(f)) return null;
  const p = join(REPO, f);
  try {
    if (statSync(p).size > 8 << 20) return null;
    return readFileSync(p, 'latin1');
  } catch {
    return null;
  }
}

/**
 * A matcher for the gitignore-style lines of exclude.txt, kept to the forms the file uses: `dir/` is a directory
 * prefix, a pattern with `*` matches from the path start with `*` = one path segment's characters, anything else is
 * an exact path. Blank lines and `#` comments are ignored.
 */
export function excludeMatcher(lines: string): (path: string) => boolean {
  const tests = lines
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((p): ((f: string) => boolean) => {
      if (p.endsWith('/')) return (f) => f.startsWith(p);
      if (p.includes('*')) {
        const re = new RegExp(`^${p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);
        return (f) => re.test(f);
      }
      return (f) => f === p;
    });
  return (f) => tests.some((t) => t(f));
}

/** The public-snapshot exclusions (exclude.txt ships with the public tree, where its paths simply do not exist); an absent file excludes nothing. */
export function publishExcluded(): (path: string) => boolean {
  const p = join(REPO, 'scripts/publish/exclude.txt');
  return excludeMatcher(existsSync(p) ? readFileSync(p, 'utf8') : '');
}
