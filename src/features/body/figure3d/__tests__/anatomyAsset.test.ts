import { describe, expect, it } from 'vitest';
import { decodeAnatomy } from '../anatomyAsset';

interface NodeMods {
  fs: { readFileSync(p: string): Uint8Array };
  zlib: { gunzipSync(b: Uint8Array): Uint8Array };
  path: { resolve(...p: string[]): string };
}

const get = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process?.getBuiltinModule;
if (!get) throw new Error('needs Node');
const fs = get('node:fs') as NodeMods['fs'];
const zlib = get('node:zlib') as NodeMods['zlib'];
const path = get('node:path') as NodeMods['path'];
const compressed = fs.readFileSync(path.resolve('public/figure/anatomy-v1.bin'));
const asset = decodeAnatomy(zlib.gunzipSync(compressed));

describe('atlas anatomy pack', () => {
  it('is compact, attributed, and contains detailed major bones and muscles', () => {
    expect(compressed.byteLength).toBeLessThan(1.8 * 1024 * 1024);
    expect(asset.manifest.source.licence).toContain('CC BY 4.0');
    expect(asset.manifest.source.selected.length).toBeGreaterThan(500);
    const names = asset.manifest.source.selected.map((entry) => entry.name.toLowerCase());
    for (const name of ['right femur', 'right humerus', 'right scapula', 'first rib', 'right gluteus maximus', 'right rectus femoris', 'right pectoralis']) {
      expect(names.some((value) => value.includes(name)), name).toBe(true);
    }
  });

  it('decodes into finite, indexed geometry with eight bounded draw groups', () => {
    expect(asset.heightCm).toBeCloseTo(165.9, 1);
    expect(asset.groups).toHaveLength(8);
    expect(asset.positions.length).toBe(asset.manifest.vertexCount * 3);
    expect(asset.indices.length).toBe(asset.manifest.triangleCount * 3);
    expect(asset.positions.every(Number.isFinite)).toBe(true);
    expect(asset.indices.every((index) => index < asset.manifest.vertexCount)).toBe(true);
    let cursor = 0;
    for (const group of asset.groups) {
      expect(group.start).toBe(cursor);
      expect(group.count).toBeGreaterThan(0);
      expect(group.count % 3).toBe(0);
      expect(group.meshes).toBeGreaterThan(0);
      for (const coordinate of group.anchor) expect(Number.isFinite(coordinate)).toBe(true);
      cursor += group.count;
    }
    expect(cursor).toBe(asset.indices.length);
    const armBones = asset.groups.find((group) => group.kind === 'bone' && group.region === 'arms');
    expect(armBones).toBeDefined();
    let minArmY = Infinity;
    for (const index of asset.indices.subarray(armBones!.start, armBones!.start + armBones!.count)) {
      minArmY = Math.min(minArmY, asset.positions[3 * index + 1]!);
    }
    expect(minArmY).toBeGreaterThan(68);
    expect(minArmY).toBeLessThan(76); // joint-registered reference finger tips
  });

  it('rejects truncated and wrong-format packs', () => {
    expect(() => decodeAnatomy(new Uint8Array(4))).toThrow('bad magic');
    const raw = zlib.gunzipSync(compressed);
    expect(() => decodeAnatomy(raw.subarray(0, raw.length - 1))).toThrow('wrong byte length');
  });
});
