/**
 * Image parts → wire payloads. Always data URLs or base64 (Ollama rejects remote URLs; the photo lives on the device).
 * Downscaling to 1568 px long edge, JPEG q≈0.85 (R8 §1.4) needs a canvas and is done by the UI layer before the part
 * is built; this module only encodes.
 */
import type { ImageSource, Part } from './types';

export type ImagePart = Extract<Part, { type: 'image' }>;

/** Long edge and JPEG quality the UI downscales to before sending (R8 §1.4). */
export const IMAGE_SEND_LONG_EDGE_PX = 1568;
export const IMAGE_SEND_JPEG_QUALITY = 0.85;

export interface ResolvedImage {
  mime: string;
  base64: string;
  dataUrl: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function parseDataUrl(url: string): { mime: string; base64: string } | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  const mime = m[1] ?? 'application/octet-stream';
  const payload = m[3] ?? '';
  return { mime, base64: m[2] ? payload : btoa(decodeURIComponent(payload)) };
}

async function sourceToBase64(source: ImageSource, fallbackMime: string): Promise<{ mime: string; base64: string }> {
  switch (source.kind) {
    case 'base64':
      return { mime: fallbackMime, base64: source.data };
    case 'dataUrl': {
      const p = parseDataUrl(source.url);
      if (!p) throw new TypeError('Image data URL is malformed');
      return p;
    }
    case 'blob':
      return { mime: source.blob.type || fallbackMime, base64: bytesToBase64(new Uint8Array(await source.blob.arrayBuffer())) };
  }
}

export async function resolveImage(part: ImagePart): Promise<ResolvedImage> {
  const { mime, base64 } = await sourceToBase64(part.source, part.mime);
  return { mime, base64, dataUrl: `data:${mime};base64,${base64}` };
}

/** Resolves every image in a message list once, keyed by part object, so adapters can stay synchronous. */
export async function resolveAllImages(messages: ReadonlyArray<{ parts: Part[] }>): Promise<Map<ImagePart, ResolvedImage>> {
  const out = new Map<ImagePart, ResolvedImage>();
  for (const m of messages) {
    for (const p of m.parts) if (p.type === 'image' && !out.has(p)) out.set(p, await resolveImage(p));
  }
  return out;
}

/** Image token estimate: Anthropic's `⌈w/28⌉·⌈h/28⌉`, used for every provider as a planning number (R8 §1.4). */
export function imageTokens(width = IMAGE_SEND_LONG_EDGE_PX, height = IMAGE_SEND_LONG_EDGE_PX): number {
  return Math.ceil(width / 28) * Math.ceil(height / 28);
}
