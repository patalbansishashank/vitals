import { estimateInitialState, stateToAvatarParams } from '@/engine/body';
import { decodeAnatomy } from '../anatomyAsset';
import { AnatomyClient, type AnatomyPort } from '../anatomyClient';
import {
  AnatomyPlacement,
  type AnatomyInput,
  type AnatomyReply,
  type AnatomyRequest,
} from '../anatomyPlacement';
import { fatRoom, placeAnatomy } from '../anatomyPose';
import { compositionFromParams } from '../composition';
import { FigureScene } from '../scene';
import { Surface } from '../surface';
import { loadTestAsset } from './loadAsset';

const get = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process!
  .getBuiltinModule!;
const fs = get('node:fs') as { readFileSync(path: string): Uint8Array };
const zlib = get('node:zlib') as { gunzipSync(bytes: Uint8Array): Uint8Array };
const asset = decodeAnatomy(zlib.gunzipSync(fs.readFileSync('public/figure/anatomy-v1.bin')));
const scene = new FigureScene(loadTestAsset());

function input(frame = 0.5, heavy = false): AnatomyInput {
  const params = stateToAvatarParams(
    estimateInitialState({
      sex: 'male',
      ageYears: 40,
      heightCm: 178,
      weightKg: heavy ? 115 : 82,
      ...(heavy ? { sliders: { muscularity: 1, adiposity: 1, muscleArms: 1 } } : {}),
    }),
    { frame },
  );
  const fit = scene.fit(params, frame);
  return {
    skin: scene.place(fit.state, params.heightCm).positions,
    heightCm: params.heightCm,
    frame,
    composition: compositionFromParams(params, frame),
  };
}

/** Use real structured clones/transfers, with replies controlled independently of requests. */
class Port implements AnatomyPort {
  onmessage: AnatomyPort['onmessage'] = null;
  onerror: AnatomyPort['onerror'] = null;
  onmessageerror: AnatomyPort['onmessageerror'] = null;
  messages: AnatomyRequest[] = [];
  terminated = false;
  postMessage(message: AnatomyRequest, transfer: Transferable[] = []) {
    this.messages.push(structuredClone(message, { transfer }));
  }
  terminate() {
    this.terminated = true;
  }
  reply(message: AnatomyReply) {
    const transfer = [message.skin.buffer, ...(message.positions ? [message.positions.buffer] : [])];
    this.onmessage?.({ data: structuredClone(message, { transfer }) } as MessageEvent<AnatomyReply>);
  }
  request() {
    return this.messages.at(-1)! as Extract<AnatomyRequest, { type: 'place' }>;
  }
  finish() {
    const request = this.request();
    this.reply({
      id: request.id,
      skin: request.skin,
      positions: new Float32Array(asset.positions.length),
      processingMs: 100,
    });
  }
}

describe('asynchronous anatomy placement', () => {
  it('preserves exact placement while refitting one persistent skin buffer', () => {
    const host = new AnatomyPlacement(asset, scene.model.vertexCount * 3);
    for (const sample of [input(0), input(1, true), input(0.5)]) {
      const expected = placeAnatomy(asset, sample.skin, sample.heightCm, sample.frame, sample.composition);
      const actual = host.place(structuredClone(sample));
      expect(actual.positions).toEqual(expected);
    }
    expect(() => host.place({ ...input(), skin: new Float32Array(3) })).toThrow('topology');
  });

  it('places under the fat boundary and reports the room above, without detaching it', () => {
    const host = new AnatomyPlacement(asset, scene.model.vertexCount * 3);
    const sample = input(1, true);
    // A boundary 1 cm in from the skin, toward its centre line, as a stand-in for the fat layer.
    const inner = sample.skin.map((v, i) => (i % 3 === 1 ? v : v * 0.9));
    const kept = inner.slice();
    const placed = host.place(structuredClone({ ...sample, inner }));
    expect(placed.positions).toEqual(
      placeAnatomy(asset, sample.skin, sample.heightCm, sample.frame, sample.composition, inner),
    );
    expect(placed.room).toEqual(fatRoom(asset, sample.skin, inner, placed.positions, sample.heightCm));
    expect(placed.room!.length).toBe(scene.model.vertexCount);
    const port = new Port();
    const client = new AnatomyClient(asset, scene.model.vertexCount * 3, vi.fn(), port);
    client.place({ ...sample, inner }, vi.fn());
    expect(inner).toEqual(kept);
    expect(Array.from(port.request().inner!)).toEqual(Array.from(kept));
    client.dispose();
  });

  it('transfers copies without detaching the displayed skin or original atlas', () => {
    const port = new Port();
    const client = new AnatomyClient(asset, scene.model.vertexCount * 3, vi.fn(), port);
    const sample = input();
    const skin = sample.skin.slice();
    const done = vi.fn();
    client.place(sample, done);
    expect(port.messages[0]!.type).toBe('init');
    expect(sample.skin).toEqual(skin);
    expect(asset.positions.byteLength).toBeGreaterThan(0);
    expect(Array.from(port.request().skin)).toEqual(Array.from(skin));
    port.finish();
    expect(done).toHaveBeenCalledOnce();
    expect(done.mock.calls[0]![0].positions.byteLength).toBe(asset.positions.byteLength);
    client.dispose();
    expect(port.terminated).toBe(true);
  });

  it('coalesces a burst while delivering the newest completed frame immediately', () => {
    const port = new Port();
    const client = new AnatomyClient(asset, scene.model.vertexCount * 3, vi.fn(), port);
    const sample = input();
    const old = vi.fn(),
      latest = vi.fn();
    client.place(sample, old);
    for (let i = 0; i < 100; i++) client.place({ ...sample, frame: i / 100 }, i === 99 ? latest : old);
    expect(port.messages).toHaveLength(2); // initialization and one in-flight morph
    port.finish();
    expect(old).toHaveBeenCalledOnce();
    expect(port.messages).toHaveLength(3);
    expect(port.request().frame).toBe(0.99);
    port.finish();
    expect(latest).toHaveBeenCalledOnce();
    client.dispose();
  });

  it('never starves completed placements during a continuous stream of newer requests', () => {
    const port = new Port(),
      done = vi.fn();
    const client = new AnatomyClient(asset, scene.model.vertexCount * 3, vi.fn(), port);
    const sample = input();
    client.place(sample, done);
    for (let batch = 0; batch < 12; batch++) {
      for (let move = 0; move < 5; move++) client.place({ ...sample, frame: move / 5 }, done);
      port.finish();
      expect(done).toHaveBeenCalledTimes(batch + 1);
    }
    client.dispose();
  });

  it('handles a callback that queues another morph without starting two worker jobs', () => {
    const port = new Port();
    const client = new AnatomyClient(asset, scene.model.vertexCount * 3, vi.fn(), port);
    const sample = input(),
      last = vi.fn();
    client.place(sample, () => client.place({ ...sample, frame: 0.8 }, last));
    client.place({ ...sample, frame: 0.2 }, last);
    port.finish();
    expect(port.messages).toHaveLength(3);
    expect(port.request().frame).toBe(0.8);
    port.finish();
    expect(last).toHaveBeenCalledOnce();
    client.dispose();
  });

  it('fails through the existing fallback and ignores replies after disposal', () => {
    const port = new Port(),
      fail = vi.fn(),
      done = vi.fn();
    const client = new AnatomyClient(asset, scene.model.vertexCount * 3, fail, port);
    client.place(input(), done);
    const request = port.request();
    port.reply({ id: request.id, skin: request.skin, error: 'worker failure' });
    expect(fail).toHaveBeenCalledWith('worker failure');
    expect(done).not.toHaveBeenCalled();
    expect(port.terminated).toBe(true);
    client.place(input(), done);
    expect(port.messages).toHaveLength(2);
  });

  it('fails safely if committing a completed placement throws', () => {
    const port = new Port(),
      fail = vi.fn();
    const client = new AnatomyClient(asset, scene.model.vertexCount * 3, fail, port);
    client.place(input(), () => {
      throw new Error('commit failed');
    });
    port.finish();
    expect(fail).toHaveBeenCalledWith('commit failed');
    expect(port.terminated).toBe(true);
  });

  it('invalidates an obsolete frame even when no replacement placement is requested', () => {
    const port = new Port(),
      done = vi.fn();
    const client = new AnatomyClient(asset, scene.model.vertexCount * 3, vi.fn(), port);
    client.place(input(), done);
    client.cancel();
    port.finish();
    expect(done).not.toHaveBeenCalled();
    client.place(input(), done);
    port.finish();
    expect(done).toHaveBeenCalledOnce();
    client.dispose();
  });

  it.each(['error', 'messageerror', 'send', 'queued send', 'init'])(
    'falls back on a worker %s failure',
    (kind) => {
      const port = new Port(),
        fail = vi.fn(),
        done = vi.fn();
      const send = port.postMessage.bind(port);
      if (kind === 'init')
        port.postMessage = () => {
          throw new Error('init failure');
        };
      const client = new AnatomyClient(asset, scene.model.vertexCount * 3, fail, port);
      if (kind !== 'init') {
        if (kind === 'send')
          port.postMessage = () => {
            throw new Error('send failure');
          };
        client.place(input(), done);
        if (kind === 'error') port.onerror?.({ message: 'worker error' } as ErrorEvent);
        if (kind === 'messageerror') port.onmessageerror?.({} as MessageEvent);
        if (kind === 'queued send') {
          client.place(input(), done);
          port.postMessage = () => {
            throw new Error('queued send failure');
          };
          port.finish();
        }
      }
      expect(fail).toHaveBeenCalledOnce();
      expect(port.terminated).toBe(true);
      expect(done).toHaveBeenCalledTimes(kind === 'queued send' ? 1 : 0);
      port.postMessage = send;
    },
  );

  it('keeps warmed main-thread transfer/commit work below a frame without any skin rays', () => {
    const port = new Port();
    const client = new AnatomyClient(asset, scene.model.vertexCount * 3, vi.fn(), port);
    const sample = input();
    const ray = vi.spyOn(Surface.prototype, 'distance');
    const run = () => {
      client.place(sample, () => {});
      port.finish();
    };
    for (let i = 0; i < 20; i++) run();
    // Several batches tolerate shared-machine scheduling/GC. The fastest warmed
    // batch is the guard; real browser 1x/4x CPU measurements live in the QA runner.
    const timings = Array.from({ length: 7 }, () => {
      const start = performance.now();
      for (let i = 0; i < 30; i++) run();
      return (performance.now() - start) / 30;
    });
    expect(ray).not.toHaveBeenCalled();
    expect(Math.min(...timings)).toBeLessThan(16);
    ray.mockRestore();
    client.dispose();
  });
});
