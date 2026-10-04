/** Guard: screens send commands through sendCommand (src/features/lib/sendCommand.ts), never `void dispatch(…)`, which drops a refusal silently. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '../../..'); // src
const SCANNED = ['features', 'app', 'components', 'state'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('no fire-and-forget command sends', () => {
  it('no `void dispatch(` under src/features, src/app, src/components or src/state', () => {
    const hits: string[] = [];
    for (const area of SCANNED) {
      for (const file of walk(join(ROOT, area))) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (/\bvoid\s+dispatch\s*\(/.test(line)) hits.push(`${relative(ROOT, file)}:${i + 1}`);
          });
      }
    }
    expect(hits, 'use sendCommand() from src/features/lib/sendCommand.ts: it shows a refusal to the person').toEqual([]);
  });
});
