// Small atlas-derived anatomical surfaces. The gzip pack is baked by scripts/figure/bake-anatomy.py.
// 8-byte header: ASCII ANAT, uint32 JSON byte length; 4-byte padded JSON; planar int16 xyz in
// centimetres/100; interleaved uint16 triangle indices. All arrays are little-endian.

import { netFetch } from '@/net/net';
import { inflate } from './asset';

export const ANATOMY_URL = `${import.meta.env.BASE_URL}figure/anatomy-v1.bin`;

export type AnatomyKind = 'bone' | 'muscle';
export type AnatomyRegion = 'head' | 'trunk' | 'arms' | 'legs';

export interface AnatomyGroup {
  kind: AnatomyKind;
  region: AnatomyRegion;
  /** Offset and length within the triangle index array. */
  start: number;
  count: number;
  /** Centre used by the renderer for the group's regional morph. */
  anchor: [number, number, number];
  /** Positive lateral centre of paired limbs, used to thicken each side locally. */
  sideAnchorX: number;
  meshes: number;
}

export interface AnatomyManifest {
  format: 'vitals-anatomy';
  version: 1;
  heightCm: number;
  positionStepCm: number;
  vertexCount: number;
  triangleCount: number;
  groups: AnatomyGroup[];
  source: {
    name: string;
    url: string;
    sha256: string;
    licence: string;
    selected: Array<{
      id: string;
      name: string;
      kind: AnatomyKind;
      region: AnatomyRegion;
      vertexStart: number;
      vertexCount: number;
      indexStart: number;
      indexCount: number;
    }>;
  };
}

export interface AnatomyAsset {
  positions: Float32Array;
  indices: Uint16Array;
  groups: AnatomyGroup[];
  heightCm: number;
  manifest: AnatomyManifest;
}

export function decodeAnatomy(bytes: Uint8Array): AnatomyAsset {
  if (bytes.byteLength < 8 || new TextDecoder().decode(bytes.subarray(0, 4)) !== 'ANAT') {
    throw new Error('anatomy: bad magic');
  }
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = data.getUint32(4, true);
  if (length > bytes.byteLength - 8) throw new Error('anatomy: truncated manifest');
  const manifest = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length))) as AnatomyManifest;
  if (manifest.format !== 'vitals-anatomy' || manifest.version !== 1) throw new Error('anatomy: unsupported version');
  const start = (8 + length + 3) & ~3;
  const positionBytes = manifest.vertexCount * 3 * 2;
  const indexBytes = manifest.triangleCount * 3 * 2;
  if (start + positionBytes + indexBytes !== bytes.byteLength) throw new Error('anatomy: wrong byte length');
  const positions = new Float32Array(manifest.vertexCount * 3);
  const q = new DataView(bytes.buffer, bytes.byteOffset + start, positionBytes);
  for (let i = 0; i < manifest.vertexCount; i++) {
    positions[3 * i] = q.getInt16(2 * i, true) * manifest.positionStepCm;
    positions[3 * i + 1] = q.getInt16(2 * (manifest.vertexCount + i), true) * manifest.positionStepCm;
    positions[3 * i + 2] = q.getInt16(2 * (2 * manifest.vertexCount + i), true) * manifest.positionStepCm;
  }
  const indices = new Uint16Array(manifest.triangleCount * 3);
  const ix = new DataView(bytes.buffer, bytes.byteOffset + start + positionBytes, indexBytes);
  for (let i = 0; i < indices.length; i++) indices[i] = ix.getUint16(2 * i, true);
  return { positions, indices, groups: manifest.groups, heightCm: manifest.heightCm, manifest };
}

let cached: Promise<AnatomyAsset> | null = null;

export function loadAnatomy(url = ANATOMY_URL): Promise<AnatomyAsset> {
  if (!cached) {
    cached = (async () => {
      const response = await netFetch(url);
      if (!response.ok) throw new Error(`anatomy: ${response.status}`);
      return decodeAnatomy(await inflate(new Uint8Array(await response.arrayBuffer())));
    })();
    cached.catch(() => { cached = null; });
  }
  return cached;
}
