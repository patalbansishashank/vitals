// BodyAvatar / AvatarMorph: mounts across a matrix of bodies without NaN in any path, accessible names, handle
// callbacks (pointer + keyboard), text never inside the scaled figure groups, morph scrubbing and reduced motion.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { liveEstimate, stateToAvatarParams, type AvatarParams, type BodyInputs, type Sex } from '@/engine/body';
import { BodyAvatar, DEFAULT_CAPTION, type AvatarInteraction, type RegionDragDelta } from './BodyAvatar';
import { AvatarMorph } from './AvatarMorph';
import { describeAvatar } from './describe';

vi.setConfig({ testTimeout: 30_000 });

function params(sex: Sex, bmi: number, heightCm = 172, extra: Partial<BodyInputs> = {}): AvatarParams {
  const h = heightCm / 100;
  return stateToAvatarParams(liveEstimate({ sex, ageYears: 40, heightCm, weightKg: bmi * h * h, ...extra }));
}

function numericAttrs(container: HTMLElement): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  container.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      if (['d', 'cx', 'cy', 'rx', 'ry', 'r', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'transform', 'points', 'viewBox', 'style'].includes(a.name)) {
        out.push({ name: `${el.tagName}.${a.name}`, value: a.value });
      }
    }
  });
  return out;
}

describe('BodyAvatar', () => {
  const matrix: { sex: Sex; bmi: number; heightCm: number }[] = [];
  for (const sex of ['male', 'female'] as Sex[]) for (const bmi of [16, 25, 50]) for (const heightCm of [150, 200]) matrix.push({ sex, bmi, heightCm });

  it('mounts a matrix of bodies, views and sizes without NaN or Infinity in any attribute', () => {
    for (const { sex, bmi, heightCm } of matrix)
      for (const view of ['front', 'side', 'both'] as const)
        for (const size of ['lg', 'md', 'sm', 'xs', 300] as const) {
          const p = params(sex, bmi, heightCm);
          const { container, unmount } = render(
            <BodyAvatar
              params={p}
              compareTo={params(sex, 25, heightCm)}
              view={view}
              size={size}
              showVisceral
              showMeasures={{ chest: '100.2 cm', waist: '90.0 cm', hip: '101.5 cm' }}
            />,
          );
          const attrs = numericAttrs(container);
          expect(attrs.length).toBeGreaterThan(5);
          for (const a of attrs) expect(a.value, `${sex} BMI ${bmi} ${heightCm} ${view} ${size} ${a.name}`).not.toMatch(/NaN|Infinity/);
          const ds = Array.from(container.querySelectorAll('path')).map((e) => e.getAttribute('d') ?? '');
          expect(ds.every((d) => d.startsWith('M'))).toBe(true);
          unmount();
        }
  });

  it('is an image with a generated accessible name and the illustrative caption', () => {
    const p = params('female', 24);
    render(<BodyAvatar params={p} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAccessibleName(describeAvatar(p, { frame: 0, heightText: '172 cm' }));
    expect(img).toHaveAccessibleName(/^Figure, 172 cm, (hips|shoulders)[a-z ]+\. Estimated body fat \d+ percent/);
    expect(img).toHaveAccessibleDescription(/Inner shape: lean tissue\. Outer layer: fat\./);
    expect(screen.getByText(DEFAULT_CAPTION)).toBeInTheDocument();
  });

  it('uses the given label, and imperial height text', () => {
    render(<BodyAvatar params={params('male', 26, 180)} label="Your figure" units="imperial" />);
    expect(screen.getByRole('img', { name: 'Your figure' })).toBeInTheDocument();
    expect(screen.getByText('5 ft 11 in')).toBeInTheDocument();
  });

  it('keeps every text element out of the scaled figure groups (text renders at real px)', () => {
    const { container } = render(<BodyAvatar params={params('male', 30)} showMeasures={{ waist: '101.0 cm', hip: '104.0 cm' }} />);
    const texts = container.querySelectorAll('svg text');
    expect(texts.length).toBeGreaterThan(4);
    texts.forEach((t) => expect(t.closest('.lm-avatar__fig')).toBeNull());
    expect(container.querySelector('svg')!.getAttribute('viewBox')).toMatch(/^0 0 \d+ \d+$/);
    expect(screen.getByText('101.0 cm')).toBeInTheDocument();
  });

  it('draws a ghost outline for compareTo and none without it', () => {
    const { container, rerender } = render(<BodyAvatar params={params('male', 24)} compareTo={params('male', 30)} />);
    // front body + 2 arms + head, side body + head; each masked by the other parts
    expect(container.querySelectorAll('.lm-avatar__ghost')).toHaveLength(6);
    container.querySelectorAll('.lm-avatar__ghost').forEach((g) => {
      const id = /url\(#(.+)\)/.exec(g.getAttribute('mask') ?? '')?.[1];
      expect(id && container.querySelector(`mask[id="${id}"]`)).toBeTruthy();
    });
    rerender(<BodyAvatar params={params('male', 24)} />);
    expect(container.querySelectorAll('.lm-avatar__ghost')).toHaveLength(0);
  });

  it('silhouette appearance draws the envelope only', () => {
    const { container } = render(<BodyAvatar params={params('female', 30)} size="xs" view="front" appearance="silhouette" caption={false} />);
    expect(container.querySelectorAll('.lm-avatar__core')).toHaveLength(0);
    expect(container.querySelectorAll('.lm-avatar__env').length).toBeGreaterThan(0);
    expect(container.querySelector('figcaption')).toBeNull();
  });
});

describe('BodyAvatar motion', () => {
  const lean = params('male', 22);
  const heavy = params('male', 34);
  const envD = (c: HTMLElement) => c.querySelector('.lm-avatar__env')!.getAttribute('d');

  it('settles a discrete jump with the needle tween (from the old shape to the new)', async () => {
    const target = render(<BodyAvatar params={heavy} />);
    const targetD = envD(target.container);
    target.unmount();
    const { container, rerender } = render(<BodyAvatar params={lean} />);
    const startD = envD(container);
    rerender(<BodyAvatar params={heavy} />);
    expect(envD(container)).toBe(startD); // first frame still shows the old shape
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    expect(envD(container)).toBe(targetD);
  });

  it('snaps under reduced motion and when tween is off', () => {
    const { container, rerender } = render(<BodyAvatar params={lean} tween={false} />);
    rerender(<BodyAvatar params={heavy} tween={false} />);
    const solo = render(<BodyAvatar params={heavy} />);
    expect(envD(container)).toBe(envD(solo.container));
    document.documentElement.setAttribute('data-motion', 'reduce');
    try {
      const r = render(<BodyAvatar params={lean} />);
      r.rerender(<BodyAvatar params={heavy} />);
      expect(envD(r.container)).toBe(envD(solo.container));
    } finally {
      document.documentElement.removeAttribute('data-motion');
    }
  });
});

describe('BodyAvatar handles', () => {
  function setup(extra: Partial<AvatarInteraction> = {}) {
    const calls: [string, RegionDragDelta][] = [];
    const interactive: AvatarInteraction = {
      onRegionDrag: (r, d) => calls.push([r, d]),
      values: {
        waist: { value: 0.2, min: -1, max: 1, text: 'belly and waist plus 0.2' },
        hips: { value: -0.2, min: -1, max: 1, text: 'hips minus 0.2' },
        chest: { value: 0, min: -1, max: 1, text: 'chest typical' },
        arms: { value: 0, min: -1, max: 1, text: 'arms typical' },
      },
      ...extra,
    };
    const utils = render(<BodyAvatar params={params('male', 27)} interactive={interactive} />);
    return { ...utils, calls };
  }

  it('renders four named, focusable, keyboard-operable handles', () => {
    setup();
    const sliders = screen.getAllByRole('slider');
    expect(sliders).toHaveLength(4);
    for (const name of ['chest fat, on the figure', 'belly and waist fat, on the figure', 'hips and thighs fat, on the figure', 'arms fat, on the figure'])
      expect(screen.getByRole('slider', { name })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('slider', { name: /belly and waist/ })).toHaveAttribute('aria-valuetext', 'belly and waist plus 0.2');
    expect(screen.getByRole('slider', { name: /hips and thighs/ })).toHaveAccessibleDescription(/Hold Shift/);
  });

  it('falls back to buttons when the parent gives no values', () => {
    render(<BodyAvatar params={params('male', 27)} interactive={{ onRegionDrag: () => {} }} />);
    expect(screen.queryAllByRole('slider')).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: /on the figure/ })).toHaveLength(4);
  });

  it('emits start / move / end with outward units (60 px = 1) on a pointer drag', () => {
    const { calls } = setup();
    const waist = screen.getByRole('slider', { name: /belly and waist/ });
    fireEvent.pointerDown(waist, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(waist, { pointerId: 1, clientX: 130, clientY: 100 });
    fireEvent.pointerMove(waist, { pointerId: 1, clientX: 160, clientY: 100 });
    fireEvent.pointerUp(waist, { pointerId: 1, clientX: 160, clientY: 100 });
    expect(calls.map(([r, d]) => [r, d.phase])).toEqual([
      ['waist', 'start'],
      ['waist', 'move'],
      ['waist', 'move'],
      ['waist', 'end'],
    ]);
    expect(calls[1]![1].amount).toBeCloseTo(0.5, 9);
    expect(calls[2]![1].total).toBeCloseTo(1, 9);
    expect(calls[3]![1]).toMatchObject({ channel: 'fat', amount: 0, source: 'pointer' });
  });

  it('left-side handles count leftward drags as outward; Shift switches to the muscle channel (120 px = 1)', () => {
    const { calls } = setup();
    const hips = screen.getByRole('slider', { name: /hips and thighs/ });
    fireEvent.pointerDown(hips, { pointerId: 2, button: 0, clientX: 100, clientY: 100, shiftKey: true });
    fireEvent.pointerMove(hips, { pointerId: 2, clientX: 40, clientY: 100 });
    fireEvent.pointerUp(hips, { pointerId: 2 });
    const move = calls.find(([, d]) => d.phase === 'move')!;
    expect(move[0]).toBe('hips');
    expect(move[1].channel).toBe('muscle');
    expect(move[1].amount).toBeCloseTo(0.5, 9);
  });

  it('shows a floating caption while dragging', () => {
    setup({ describe: (r, ch) => `${r} ${ch} caption` });
    const arm = screen.getByRole('slider', { name: /arms fat/ });
    fireEvent.pointerDown(arm, { pointerId: 3, button: 0, clientX: 10, clientY: 10 });
    expect(screen.getByText('arms fat caption')).toBeInTheDocument();
    fireEvent.pointerUp(arm, { pointerId: 3 });
    expect(screen.queryByText('arms fat caption')).toBeNull();
  });

  it('keyboard: arrows step the fat channel, Shift+arrows the muscle channel, PgUp/PgDn a quarter', () => {
    const { calls } = setup();
    const chest = screen.getByRole('slider', { name: /chest/ });
    fireEvent.keyDown(chest, { key: 'ArrowRight' });
    fireEvent.keyDown(chest, { key: 'ArrowLeft', shiftKey: true });
    fireEvent.keyDown(chest, { key: 'PageUp' });
    fireEvent.keyDown(chest, { key: 'Tab' });
    expect(calls.map(([r, d]) => [r, d.channel, d.amount, d.phase, d.source])).toEqual([
      ['chest', 'fat', 0.05, 'end', 'keyboard'],
      ['chest', 'muscle', -0.05, 'end', 'keyboard'],
      ['chest', 'fat', 0.25, 'end', 'keyboard'],
    ]);
  });

  it('the waist has no muscle channel: Shift keeps it on fat', () => {
    const { calls } = setup();
    fireEvent.keyDown(screen.getByRole('slider', { name: /belly and waist/ }), { key: 'ArrowUp', shiftKey: true });
    expect(calls[0]![1].channel).toBe('fat');
  });

  it('a vertical drag on the figure changes body fat (10 points per 100 px upward)', () => {
    const { calls, container } = setup();
    const fig = container.querySelector('.lm-avatar__fig')!;
    fireEvent.pointerDown(fig, { pointerId: 4, button: 0, clientX: 50, clientY: 300 });
    fireEvent.pointerMove(fig, { pointerId: 4, clientX: 50, clientY: 250 });
    fireEvent.pointerUp(fig, { pointerId: 4 });
    const move = calls.find(([r, d]) => r === 'body' && d.phase === 'move')!;
    expect(move[1].amount).toBeCloseTo(5, 9);
  });

  it('disabled regions ignore input and say why', () => {
    const { calls } = setup({ disabled: { waist: 'set by your waist measurement', body: true } });
    const waist = screen.getByRole('slider', { name: /belly and waist/ });
    expect(waist).toHaveAttribute('aria-disabled', 'true');
    expect(waist).toHaveAttribute('title', 'set by your waist measurement');
    fireEvent.keyDown(waist, { key: 'ArrowRight' });
    fireEvent.pointerDown(waist, { pointerId: 5, button: 0, clientX: 0, clientY: 0 });
    expect(calls).toHaveLength(0);
  });
});

describe('AvatarMorph', () => {
  const from = params('male', 31);
  const to = params('male', 26);

  it('shows the start at t = 0 and the end at t = 1, with the start as a ghost', () => {
    const { container, rerender } = render(<AvatarMorph from={from} to={to} t={0} view="front" />);
    const env0 = container.querySelector('.lm-avatar__env')!.getAttribute('d');
    const ghost = container.querySelector('.lm-avatar__ghost')!.getAttribute('d'); // the front body outline
    expect(env0).toBe(ghost);
    rerender(<AvatarMorph from={from} to={to} t={1} view="front" />);
    const env1 = container.querySelector('.lm-avatar__env')!.getAttribute('d');
    expect(env1).not.toBe(env0);
    const solo = render(<BodyAvatar params={to} view="front" />);
    expect(solo.container.querySelector('.lm-avatar__env')!.getAttribute('d')).toBe(env1);
  });

  it('renders Play and a labelled scrubber; scrubbing reports t', () => {
    const onT = vi.fn();
    render(<AvatarMorph from={from} to={to} defaultT={0.5} onTChange={onT} controls formatT={(t) => `day ${Math.round(t * 84)}`} scrubberLabel="day" />);
    const scrub = screen.getByRole('slider', { name: 'day' });
    expect(scrub).toHaveAttribute('aria-valuetext', 'day 42');
    fireEvent.keyDown(scrub, { key: 'End' });
    expect(onT).toHaveBeenLastCalledWith(1);
    expect(screen.getByRole('button', { name: 'Replay from the start' })).toBeInTheDocument();
  });

  it('under reduced motion, Play snaps straight to the end', () => {
    document.documentElement.setAttribute('data-motion', 'reduce');
    try {
      const onT = vi.fn();
      render(<AvatarMorph from={from} to={to} defaultT={0} onTChange={onT} controls />);
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Play to the end' }));
      });
      expect(onT).toHaveBeenCalledWith(1);
      expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    } finally {
      document.documentElement.removeAttribute('data-motion');
    }
  });

  it('weekly steps play in whole steps', async () => {
    const onT = vi.fn();
    render(<AvatarMorph from={from} to={to} defaultT={0} onTChange={onT} controls steps={4} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play to the end' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    const values = onT.mock.calls.map((c) => c[0] as number);
    expect(values.at(-1)).toBe(1);
    for (const v of values) expect(Math.abs(v * 4 - Math.round(v * 4))).toBeLessThan(1e-9);
  });

  it('animates with requestAnimationFrame when motion is allowed and reports progress', async () => {
    const onT = vi.fn();
    render(<AvatarMorph from={from} to={to} defaultT={0} onTChange={onT} controls durationMs={30} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play to the end' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });
    expect(onT).toHaveBeenLastCalledWith(1);
    expect(screen.getByRole('button', { name: 'Replay from the start' })).toBeInTheDocument();
  });
});
