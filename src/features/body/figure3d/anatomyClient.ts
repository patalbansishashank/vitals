import type { AnatomyAsset } from './anatomyAsset';
import type { AnatomyInput, AnatomyReply, AnatomyRequest } from './anatomyPlacement';

export interface AnatomyPort {
  postMessage(message: AnatomyRequest, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<AnatomyReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  terminate(): void;
}

interface Pending {
  id: number;
  generation: number;
  input: AnatomyInput;
  done: (reply: AnatomyReply & { positions: Float32Array }) => void;
}

/** One in-flight placement and one latest request; every completed placement is delivered. */
export class AnatomyClient {
  private id = 0;
  private generation = 0;
  private active: Pending | null = null;
  private latest: Pending | null = null;
  private spareSkin: Float32Array | null = null;
  private spareInner: Float32Array | null = null;
  private disposed = false;

  constructor(
    asset: AnatomyAsset,
    skinLength: number,
    private readonly fail: (reason: string) => void,
    private readonly worker: AnatomyPort = new Worker(new URL('./anatomy.worker.ts', import.meta.url), {
      type: 'module',
      name: 'vitals-figure-anatomy',
    }),
  ) {
    worker.onmessage = ({ data }) => {
      if (this.disposed || !this.active || data.id !== this.active.id) return;
      const active = this.active;
      this.spareSkin = data.skin;
      if (data.inner) this.spareInner = data.inner;
      if (data.error || !data.positions) {
        this.failure(data.error ?? 'Anatomy worker returned no geometry');
        return;
      }
      // Keep the active slot occupied during the callback: a reentrant request
      // replaces the pending request rather than starting a second worker job.
      try {
        if (active.generation === this.generation) active.done({ ...data, positions: data.positions });
      } catch (error) {
        this.failure(error instanceof Error ? error.message : String(error));
        return;
      }
      if (this.disposed) return;
      this.active = null;
      const next = this.latest;
      this.latest = null;
      if (next) this.send(next);
    };
    worker.onerror = (event) => {
      if (this.disposed) return;
      this.failure(event.message || 'Anatomy worker failed');
    };
    worker.onmessageerror = () => this.failure('Anatomy worker could not transfer geometry');
    // The renderer keeps its original asset. Clone only this one initialization;
    // every morph transfers skin/output buffers instead of cloning geometry.
    try {
      worker.postMessage({ type: 'init', asset, skinLength });
    } catch (error) {
      this.failure(error instanceof Error ? error.message : String(error));
    }
  }

  /** The caller keeps each input skin immutable until it is superseded/completed. */
  place(input: AnatomyInput, done: Pending['done']): void {
    if (this.disposed) return;
    const pending = { id: ++this.id, generation: this.generation, input, done };
    if (this.active) this.latest = pending;
    else this.send(pending);
  }

  private send(pending: Pending): void {
    const { input } = pending;
    const skin = this.spareSkin ?? new Float32Array(input.skin.length);
    this.spareSkin = null;
    skin.set(input.skin);
    let inner: Float32Array | null = null;
    if (input.inner) {
      inner =
        this.spareInner?.length === input.inner.length
          ? this.spareInner
          : new Float32Array(input.inner.length);
      this.spareInner = null;
      inner.set(input.inner);
    }
    this.active = pending;
    try {
      this.worker.postMessage(
        { ...input, skin, inner, id: pending.id, type: 'place' },
        inner ? [skin.buffer, inner.buffer] : [skin.buffer],
      );
    } catch (error) {
      this.failure(error instanceof Error ? error.message : String(error));
    }
  }

  /** Invalidate work when its anatomy layer/frame is no longer needed. */
  cancel(): void {
    this.generation++;
    this.latest = null;
  }

  private failure(reason: string): void {
    if (this.disposed) return;
    this.dispose();
    this.fail(reason);
  }

  dispose(): void {
    this.disposed = true;
    this.active = this.latest = null;
    this.spareSkin = this.spareInner = null;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.onmessageerror = null;
    this.worker.terminate();
  }
}
