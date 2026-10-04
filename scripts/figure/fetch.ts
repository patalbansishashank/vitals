// Downloads the CC0 MakeHuman assets the figure is baked from into scripts/figure/.cache (git-ignored).
// Pinned to one commit of github.com/makehumancommunity/makehuman so the bake is reproducible.
// Run: node scripts/figure/fetch.ts   (Node >= 22.18 runs TypeScript directly)

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCE_COMMIT, SOURCE_REPO, allSourceFiles } from './lib/sources.ts';

const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, '.cache');

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const files = allSourceFiles();
  let fetched = 0;
  for (const rel of files) {
    const out = join(cache, rel);
    if (await exists(out)) continue;
    const url = `https://raw.githubusercontent.com/${SOURCE_REPO}/${SOURCE_COMMIT}/${rel}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const body = Buffer.from(await res.arrayBuffer());
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, body);
    fetched++;
  }
  console.log(`figure assets: ${files.length} files (${fetched} downloaded) in ${cache}`);
}

await main();
