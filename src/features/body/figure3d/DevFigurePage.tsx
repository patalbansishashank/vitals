// /dev/figure: the 3D figure and the visceral view side by side with the SVG figure, live fit errors, and an fps
// benchmark (continuous morph between two bodies: CPU morph + normals + upload + draw every frame).

import { useMemo, useRef, useState } from 'react';
import {
  allocateRegional,
  liveEstimate,
  stateToAvatarParams,
  type AvatarParams,
  type BodyEstimate,
  type BodyInputs,
  type BodyState,
} from '@/engine/body';
import { BodyAvatar } from '@/features/body/avatar';
import { Figure3D } from './Figure3D';
import type { FitResult } from './fit';
import { RING_IDS } from './manifest';
import { VisceralView } from './visceral';
import './dev.css';

const SPECIMENS: { id: string; label: string; inputs: BodyInputs }[] = [
  { id: 'a', label: '185 cm · 64 kg (lean)', inputs: { sex: 'male', ageYears: 25, heightCm: 185, weightKg: 64 } },
  { id: 'b', label: '178 cm · 88 kg (muscular)', inputs: { sex: 'male', ageYears: 30, heightCm: 178, weightKg: 88, sliders: { muscularity: 0.92, adiposity: 0.12 } } },
  { id: 'c', label: '178 cm · 84 kg', inputs: { sex: 'male', ageYears: 45, heightCm: 178, weightKg: 84 } },
  { id: 'd', label: '175 cm · 128 kg', inputs: { sex: 'male', ageYears: 55, heightCm: 175, weightKg: 128 } },
  { id: 'e', label: '170 cm · 50 kg (lean)', inputs: { sex: 'female', ageYears: 24, heightCm: 170, weightKg: 50 } },
  { id: 'f', label: '168 cm · 66 kg (muscular)', inputs: { sex: 'female', ageYears: 30, heightCm: 168, weightKg: 66, sliders: { muscularity: 0.92, adiposity: 0.12 } } },
  { id: 'g', label: '164 cm · 66 kg', inputs: { sex: 'female', ageYears: 40, heightCm: 164, weightKg: 66 } },
  { id: 'h', label: '162 cm · 118 kg', inputs: { sex: 'female', ageYears: 50, heightCm: 162, weightKg: 118 } },
];

function changedState(s: BodyEstimate, dFatKg: number, dFfmKg: number): BodyState {
  const fm = Math.max(s.fatMassKg + dFatKg, 0.03 * s.weightKg);
  const ffm = s.fatFreeMassKg + dFfmKg;
  const sm = s.skeletalMuscleKg + 0.9 * dFfmKg;
  const r = allocateRegional({ fat: s.fat, muscle: s.muscle }, { fatMassKg: fm, skeletalMuscleKg: sm });
  return { ...s, fatMassKg: fm, fatFreeMassKg: ffm, weightKg: fm + ffm, skeletalMuscleKg: sm, fat: r.fat, muscle: r.muscle, measuredCircumferences: undefined };
}

interface Bench {
  fps: number;
  frameMs: number;
  frames: number;
  renderer: string;
}

export default function DevFigurePage() {
  const [specimen, setSpecimen] = useState('c');
  const [frameOverride, setFrameOverride] = useState<number | null>(null);
  const [layers, setLayers] = useState<'envelope' | 'two-layer'>('envelope');
  const [visceral, setVisceral] = useState(true);
  const [compare, setCompare] = useState(false);
  const [dFat, setDFat] = useState(0);
  const [fit, setFit] = useState<FitResult | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [bench, setBench] = useState<Bench | null>(null);
  const [benching, setBenching] = useState(false);
  const benchCanvas = useRef<HTMLCanvasElement>(null);

  const spec = SPECIMENS.find((s) => s.id === specimen)!;
  const estimate = useMemo(() => liveEstimate(spec.inputs), [spec]);
  const start = useMemo(() => stateToAvatarParams(estimate), [estimate]);
  const params: AvatarParams = useMemo(
    () => (dFat === 0 ? start : stateToAvatarParams(changedState(estimate, dFat, 0), { baseline: estimate })),
    [estimate, start, dFat],
  );
  const frame = frameOverride ?? params.figure.frame;

  const runBench = async () => {
    const canvas = benchCanvas.current;
    if (!canvas) return;
    setBenching(true);
    try {
      const [{ loadScene }, { FigureRenderer, readColours }, { lerpState }] = await Promise.all([
        import('./Figure3DCanvas'),
        import('./renderer'),
        import('./scene'),
      ]);
      const scene = await loadScene();
      canvas.width = 640;
      canvas.height = 400;
      const r = new FigureRenderer(canvas, scene.model.indices, scene.model.vertexCount);
      const gl = canvas.getContext('webgl2');
      const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
      const rendererName = gl ? String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'none';
      const a = scene.fit(stateToAvatarParams(liveEstimate(SPECIMENS[0]!.inputs)), 1);
      const b = scene.fit(stateToAvatarParams(liveEstimate(SPECIMENS[3]!.inputs)), 1);
      const colours = readColours(canvas);
      let frames = 0;
      let cpu = 0;
      const t0 = performance.now();
      await new Promise<void>((done) => {
        const tick = (now: number) => {
          const t = 0.5 - 0.5 * Math.cos((now - t0) / 400);
          const c0 = performance.now();
          const placed = scene.place(lerpState(a.state, b.state, t), 178);
          r.draw({ positions: placed.positions, views: ['front', 'side'], stageCm: 190, centre: placed.centre, colours });
          gl?.finish();
          cpu += performance.now() - c0;
          frames++;
          if (now - t0 < 3000) requestAnimationFrame(tick);
          else done();
        };
        requestAnimationFrame(tick);
      });
      const secs = (performance.now() - t0) / 1000;
      r.dispose();
      setBench({ fps: frames / secs, frameMs: cpu / frames, frames, renderer: rendererName });
    } finally {
      setBenching(false);
    }
  };

  return (
    <main className="lm-devfig">
      <h1>Figure 3D · dev</h1>
      <p className="lm-devfig__note">
        MakeHuman hm08 mesh (CC0) fitted to the engine&apos;s girths at runtime. The SVG figure is the fallback and is shown on the right for
        comparison.
      </p>
      <section className="lm-devfig__controls" aria-label="Controls">
        <label>
          Body
          <select value={specimen} onChange={(e) => setSpecimen(e.target.value)}>
            {SPECIMENS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Frame (hips-led ↔ shoulders-led): {frame.toFixed(2)}
          <input type="range" min={0} max={1} step={0.05} value={frame} onChange={(e) => setFrameOverride(Number(e.target.value))} />
        </label>
        <button type="button" onClick={() => setFrameOverride(null)}>
          Match my basics
        </button>
        <label>
          Fat change: {dFat} kg
          <input type="range" min={-15} max={15} step={1} value={dFat} onChange={(e) => setDFat(Number(e.target.value))} />
        </label>
        <label>
          <input type="checkbox" checked={layers === 'two-layer'} onChange={(e) => setLayers(e.target.checked ? 'two-layer' : 'envelope')} /> lean core +
          fat envelope
        </label>
        <label>
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> ghost of start
        </label>
        <label>
          <input type="checkbox" checked={visceral} onChange={(e) => setVisceral(e.target.checked)} /> visceral view
        </label>
      </section>

      <section className="lm-devfig__stage">
        <Figure3D
          params={params}
          frame={frame}
          layers={layers}
          visceral={visceral}
          compareTo={compare ? start : undefined}
          onFit={setFit}
          onFallback={setFallback}
          className="lm-devfig__fig"
        />
        <div className="lm-devfig__svg">
          <BodyAvatar params={params} frame={frame} compareTo={compare ? start : undefined} size="fill" caption={false} />
        </div>
      </section>

      <section className="lm-devfig__stats" aria-label="Fit">
        <h2>Fit</h2>
        {fallback ? <p>SVG fallback: {fallback}</p> : null}
        {fit ? (
          <table>
            <tbody>
              {RING_IDS.map((id) => (
                <tr key={id}>
                  <th scope="row">{id}</th>
                  <td>{fit.errors.girths[id].toFixed(2)} cm</td>
                </tr>
              ))}
              <tr>
                <th scope="row">waist depth</th>
                <td>{fit.errors.waistDepth.toFixed(2)} cm</td>
              </tr>
              <tr>
                <th scope="row">chest depth</th>
                <td>{fit.errors.chestDepth.toFixed(2)} cm</td>
              </tr>
              <tr>
                <th scope="row">bideltoid</th>
                <td>{fit.errors.bideltoid.toFixed(2)} cm</td>
              </tr>
              <tr>
                <th scope="row">fit</th>
                <td>
                  {fit.ms.toFixed(1)} ms · {fit.iterations} it · muscle {fit.state.muscle.toFixed(2)} · weight {fit.state.weight.toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p>loading…</p>
        )}
      </section>

      <section className="lm-devfig__bench" aria-label="Benchmark">
        <h2>Morph benchmark</h2>
        <button type="button" onClick={runBench} disabled={benching}>
          {benching ? 'running 3 s…' : 'Run 3 s morph benchmark'}
        </button>
        {bench ? (
          <p data-testid="bench">
            {bench.fps.toFixed(1)} fps · {bench.frameMs.toFixed(2)} ms CPU+GPU per frame · {bench.frames} frames · {bench.renderer}
          </p>
        ) : null}
        <canvas ref={benchCanvas} className="lm-devfig__benchcanvas" aria-hidden="true" />
      </section>

      <section aria-label="Visceral view, start state">
        <h2>Visceral view (start → now)</h2>
        <VisceralView params={params} compareTo={start} />
      </section>
    </main>
  );
}
