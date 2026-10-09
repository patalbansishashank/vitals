import { AnatomyPlacement, type AnatomyReply, type AnatomyRequest } from './anatomyPlacement';

const scope = self as DedicatedWorkerGlobalScope;
let placement: AnatomyPlacement | null = null;
let previous: {
  key: string;
  skin: Float32Array;
  inner: Float32Array | null;
  positions: Float32Array;
  room?: Float32Array;
} | null = null;
const same = (a: Float32Array | null | undefined, b: Float32Array | null | undefined) => {
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
scope.onmessage = ({ data }: MessageEvent<AnatomyRequest>) => {
  if (data.type === 'init') {
    placement = new AnatomyPlacement(data.asset, data.skinLength);
    previous = null;
    return;
  }
  const { skin, inner, id } = data;
  const buffers = [skin.buffer, ...(inner ? [inner.buffer] : [])];
  try {
    if (!placement) throw new Error('Anatomy worker is not initialized');
    const start = performance.now();
    const key = JSON.stringify([data.heightCm, data.frame, data.composition]);
    const cached = previous?.key === key && same(previous.skin, skin) && same(previous.inner, inner);
    const { positions, room } = cached
      ? { positions: previous!.positions.slice(), room: previous!.room?.slice() }
      : placement.place(data);
    if (!cached)
      previous = {
        key,
        skin: skin.slice(),
        inner: inner?.slice() ?? null,
        positions: positions.slice(),
        ...(room ? { room: room.slice() } : {}),
      };
    scope.postMessage(
      { id, positions, room, skin, inner, processingMs: performance.now() - start } satisfies AnatomyReply,
      [positions.buffer, ...(room ? [room.buffer] : []), ...buffers],
    );
  } catch (error) {
    scope.postMessage(
      {
        id,
        skin,
        inner,
        error: error instanceof Error ? error.message : String(error),
      } satisfies AnatomyReply,
      buffers,
    );
  }
};
