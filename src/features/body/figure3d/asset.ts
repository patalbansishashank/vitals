// Decodes the baked figure pack (public/figure/figure-v2.bin, written by scripts/figure/bake.ts).
// File = gzip([u32 magic 'VFIG'][u32 jsonLength][manifest json][pad 4][binary sections]). Positions and deltas are
// planar int16 (all x, all y, all z) times a step in cm; indices uint16.

import { netFetch } from '@/net/net';
import type { FigureManifest, TargetEntry } from './manifest';

export const FIGURE_URL = `${import.meta.env.BASE_URL}figure/figure-v2.bin`;
const MAGIC = 0x47494656;

export interface DecodedTarget {
  id: string;
  /** Vertex list for sparse targets; null = dense (all vertices in order). */
  indices: Uint16Array | null;
  /** Interleaved xyz deltas in cm for the listed vertices. */
  deltas: Float32Array;
}

export interface FigureAsset {
  manifest: FigureManifest;
  /** Interleaved xyz base positions in cm. */
  base: Float32Array;
  indices: Uint16Array;
  targets: Map<string, DecodedTarget>;
  /** Inward skin thickness per vertex in cm at the reference stature (absent in older packs). */
  thickness?: Float32Array;
}

function planarToInterleaved(q: Int16Array, step: number): Float32Array {
  const n = q.length / 3;
  const out = new Float32Array(q.length);
  for (let i = 0; i < n; i++) {
    out[3 * i] = q[i]! * step;
    out[3 * i + 1] = q[n + i]! * step;
    out[3 * i + 2] = q[2 * n + i]! * step;
  }
  return out;
}

/** Decodes an UNcompressed pack. */
export function decodeFigure(bytes: Uint8Array): FigureAsset {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('figure: bad magic');
  const jsonLength = dv.getUint32(4, true);
  const manifest = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + jsonLength))) as FigureManifest;
  if (manifest.format !== 'vitals-figure' || manifest.version !== 1) throw new Error('figure: unsupported version');
  const head = 8 + jsonLength;
  const binStart = head + ((4 - (head % 4)) % 4);
  // copy the binary part so typed views are aligned regardless of the source buffer (explicit copy: Node's
  // Buffer#slice returns a view)
  const copy = new Uint8Array(manifest.bin.byteLength);
  copy.set(bytes.subarray(binStart, binStart + manifest.bin.byteLength));
  const bin = copy.buffer;
  const i16 = (s: { offset: number; byteLength: number }) => new Int16Array(bin, s.offset, s.byteLength / 2);
  const u16 = (s: { offset: number; byteLength: number }) => new Uint16Array(bin, s.offset, s.byteLength / 2);
  const targets = new Map<string, DecodedTarget>();
  for (const t of manifest.targets as TargetEntry[]) {
    targets.set(t.id, { id: t.id, indices: t.indices ? u16(t.indices) : null, deltas: planarToInterleaved(i16(t.deltas), t.step) });
  }
  return {
    manifest,
    base: planarToInterleaved(i16(manifest.positions.section), manifest.positions.step),
    indices: u16(manifest.indices.section),
    targets,
    ...(manifest.shell
      ? {
          thickness: Float32Array.from(
            new Uint8Array(bin, manifest.shell.thickness.offset, manifest.shell.thickness.byteLength),
            (q) => q * manifest.shell!.step,
          ),
        }
      : {}),
  };
}

const isGzip = (b: Uint8Array) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

/** Gunzips with the platform's DecompressionStream (no WebAssembly, CSP-safe). Passes through already-inflated data. */
export async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  if (!isGzip(bytes)) return bytes;
  const stream = new Response(bytes as BodyInit).body!.pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

let cached: Promise<FigureAsset> | null = null;

/** Fetches + decodes the figure once per page (same-origin; allowed by connect-src 'self'). */
export function loadFigure(url = FIGURE_URL): Promise<FigureAsset> {
  if (!cached) {
    cached = (async () => {
      const res = await netFetch(url);
      if (!res.ok) throw new Error(`figure: ${res.status}`);
      return decodeFigure(await inflate(new Uint8Array(await res.arrayBuffer())));
    })();
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}
