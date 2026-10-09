import type { AnatomyAsset } from './anatomyAsset';
import { fatRoom, placeAnatomy } from './anatomyPose';
import type { BodyComposition } from './composition';

export interface AnatomyInput {
  skin: Float32Array;
  /** Inner boundary of the fat under the skin (same topology): the anatomy stays under it. */
  inner?: Float32Array | null;
  heightCm: number;
  frame: number;
  composition: BodyComposition;
}

export type AnatomyRequest =
  { type: 'init'; asset: AnatomyAsset; skinLength: number } | ({ type: 'place'; id: number } & AnatomyInput);

export interface AnatomyReply {
  id: number;
  skin: Float32Array;
  inner?: Float32Array | null;
  positions?: Float32Array;
  /** Per skin vertex, how deep the fat may reach above the placed anatomy (with `inner`). */
  room?: Float32Array;
  processingMs?: number;
  error?: string;
}

/** Keep the skin buffer/BVH in the worker across transferred input buffers. */
export class AnatomyPlacement {
  private readonly skin: Float32Array;
  private readonly inner: Float32Array;

  constructor(
    private readonly asset: AnatomyAsset,
    skinLength: number,
  ) {
    this.skin = new Float32Array(skinLength);
    this.inner = new Float32Array(skinLength);
  }

  place(input: AnatomyInput): { positions: Float32Array; room?: Float32Array } {
    if (input.skin.length !== this.skin.length) throw new Error('Anatomy skin topology changed');
    this.skin.set(input.skin);
    if (!input.inner) return { positions: placeAnatomy(this.asset, this.skin, input.heightCm, input.frame, input.composition) };
    if (input.inner.length !== this.inner.length) throw new Error('Anatomy skin topology changed');
    this.inner.set(input.inner);
    const positions = placeAnatomy(this.asset, this.skin, input.heightCm, input.frame, input.composition, this.inner);
    return { positions, room: fatRoom(this.asset, this.skin, this.inner, positions, input.heightCm) };
  }
}
