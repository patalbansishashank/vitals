// Test helper: reads and decodes the committed figure pack from public/ (Node only, via getBuiltinModule so the app
// tsconfig needs no Node types).
import { decodeFigure, type FigureAsset } from '../asset';
import { FigureModel } from '../model';

interface NodeMods {
  fs: { readFileSync(p: string): Uint8Array };
  zlib: { gunzipSync(b: Uint8Array): Uint8Array };
  path: { resolve(...p: string[]): string };
}

function node(): NodeMods {
  const get = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process?.getBuiltinModule;
  if (!get) throw new Error('needs Node');
  return { fs: get('node:fs') as NodeMods['fs'], zlib: get('node:zlib') as NodeMods['zlib'], path: get('node:path') as NodeMods['path'] };
}

export const FIGURE_FILE = 'public/figure/figure-v1.bin';

export function readPackGz(): Uint8Array {
  const { fs, path } = node();
  return fs.readFileSync(path.resolve(FIGURE_FILE));
}

let asset: FigureAsset | null = null;
export function loadTestAsset(): FigureAsset {
  if (!asset) asset = decodeFigure(node().zlib.gunzipSync(readPackGz()));
  return asset;
}

export const loadTestModel = (): FigureModel => new FigureModel(loadTestAsset());
