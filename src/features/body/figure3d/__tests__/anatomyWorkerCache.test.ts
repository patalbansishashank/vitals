import type { AnatomyInput, AnatomyRequest } from '../anatomyPlacement';

const rig = vi.hoisted(() => ({ place: vi.fn() }));
vi.mock('../anatomyPlacement', () => ({
  AnatomyPlacement: class {
    place(input: AnatomyInput) {
      return rig.place(input);
    }
  },
}));
import '../anatomy.worker';

const input = () =>
  ({
    type: 'place' as const,
    id: 1,
    skin: Float32Array.of(1, 2, 3),
    inner: Float32Array.of(0.9, 2, 2.7),
    heightCm: 170,
    frame: 0.5,
    composition: { muscle: { arms: { transverseScale: 1 } } },
  }) as Extract<AnatomyRequest, { type: 'place' }>;
const send = (data: AnatomyRequest) => self.onmessage!.call(self, new MessageEvent('message', { data }));

describe('worker duplicate placement cache', () => {
  beforeEach(() => {
    rig.place
      .mockReset()
      .mockImplementation(() => ({ positions: Float32Array.of(4, 5, 6), room: Float32Array.of(2) }));
    vi.spyOn(self, 'postMessage').mockImplementation(() => {});
    send({ type: 'init', asset: {} as never, skinLength: 3 });
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns exact copies for identical inputs without repeating placement maths', () => {
    send(input());
    send({ ...input(), id: 2 });
    expect(rig.place).toHaveBeenCalledOnce();
    const replies = vi
      .mocked(self.postMessage)
      .mock.calls.map(([reply]) => reply as { positions: Float32Array; room: Float32Array });
    expect(replies[1]!.positions).toEqual(replies[0]!.positions);
    expect(replies[1]!.room).toEqual(replies[0]!.room);
    expect(replies[1]!.positions).not.toBe(replies[0]!.positions);
  });

  it.each(['skin', 'inner', 'height', 'frame', 'composition'])(
    'invalidates the cache for changed %s',
    (field) => {
      send(input());
      const next = input();
      if (next.type !== 'place') throw new Error('needs placement');
      if (field === 'skin') next.skin[0] = 2;
      if (field === 'inner') next.inner![0] = 0.8;
      if (field === 'height') next.heightCm = 171;
      if (field === 'frame') next.frame = 0.6;
      if (field === 'composition') next.composition = { ...next.composition, totalKg: 80 } as never;
      send(next);
      expect(rig.place).toHaveBeenCalledTimes(2);
    },
  );
});
