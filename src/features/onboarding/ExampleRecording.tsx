import { useMemo } from 'react';
import { GradeBadge, Swatch } from '@/components';
import { AvatarMorph } from '@/features/body/avatar';
import { allocateRegional, liveEstimate, stateToAvatarParams, type BodyState } from '@/engine/body';
import { WELCOME } from './copy';
import './onboarding.css';

/* ---------------------------------------------------------------------------
   Synthetic example (labelled "example"): 12 weeks at a moderate deficit with
   a 3-day water-only fast in week 5. Shapes only — not a projection.
   --------------------------------------------------------------------------- */

const DAYS = 84;
const FAST = [28, 29, 30];

function series() {
  const fat: number[] = [];
  const band: number[] = [];
  const gly: number[] = [];
  const ket: number[] = [];
  for (let d = 0; d < DAYS; d++) {
    const t = d / (DAYS - 1);
    fat.push(24.1 - 4.3 * (1 - Math.exp(-t * 1.6)) / (1 - Math.exp(-1.6)));
    band.push(0.15 + 0.95 * t);
    const fastDay = FAST.indexOf(d);
    const sinceFast = d - FAST[FAST.length - 1]!;
    let g = 405 + 5 * Math.sin(d * 0.45) + 3 * Math.sin(d * 0.17);
    if (fastDay >= 0) g = [250, 150, 110][fastDay]!;
    else if (sinceFast > 0 && sinceFast < 6) g = 110 + (475 - 110) * (1 - Math.exp(-sinceFast * 1.1)) - (sinceFast > 2 ? (sinceFast - 2) * 18 : 0);
    gly.push(g);
    let k = 0.14 + 0.015 * Math.sin(d * 0.4);
    if (fastDay >= 0) k = [0.45, 1.6, 2.6][fastDay]!;
    else if (sinceFast === 1) k = 0.7;
    else if (sinceFast === 2) k = 0.25;
    ket.push(k);
  }
  return { fat, band, gly, ket };
}

/** Path in a 0–100 × 0–40 box (the SVG stretches; strokes do not). */
function toPath(values: readonly number[], lo: number, hi: number): string {
  const n = values.length;
  return values.map((v, i) => `${i ? 'L' : 'M'}${((i / (n - 1)) * 100).toFixed(2)},${(40 - ((v - lo) / (hi - lo)) * 40).toFixed(2)}`).join('');
}
function toBand(mid: readonly number[], half: readonly number[], lo: number, hi: number): string {
  const n = mid.length;
  const x = (i: number) => ((i / (n - 1)) * 100).toFixed(2);
  const y = (v: number) => (40 - ((v - lo) / (hi - lo)) * 40).toFixed(2);
  const top = mid.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v + half[i]!)}`).join('');
  const bottom = mid
    .map((v, i) => ({ v, i }))
    .reverse()
    .map(({ v, i }) => `L${x(i)},${y(v - half[i]!)}`)
    .join('');
  return `${top}${bottom}Z`;
}

function changedState(s: BodyState, dFatKg: number): BodyState {
  const fm = Math.max(s.fatMassKg + dFatKg, 0.05 * s.weightKg);
  const r = allocateRegional({ fat: s.fat, muscle: s.muscle }, { fatMassKg: fm, skeletalMuscleKg: s.skeletalMuscleKg });
  return { ...s, fatMassKg: fm, weightKg: fm + s.fatFreeMassKg, fat: r.fat, muscle: r.muscle };
}

interface Lane {
  id: string;
  name: string;
  value: string;
  unit: string;
  category: 'body' | 'fuel';
  grade: 'A' | 'B' | 'C';
  path: string;
  band?: string;
  threshold?: { y: number; label: string };
}

/**
 * The welcome illustration (design §4): a 3-lane channel recording that draws itself once (1.2 s, with
 * the playhead sweep) beside the two-layer figure slimming slightly. Decorative — `aria-hidden`, with the
 * text alternative in WELCOME.illustrationAlt. Under reduced motion everything is simply drawn.
 */
export function ExampleRecording() {
  const lanes = useMemo<Lane[]>(() => {
    const s = series();
    const fatLo = 18.4;
    const fatHi = 25.4;
    const kHi = 3;
    return [
      {
        id: 'fat',
        name: WELCOME.lanes.fat,
        value: s.fat[DAYS - 1]!.toFixed(1),
        unit: 'kg',
        category: 'body',
        grade: 'A',
        path: toPath(s.fat, fatLo, fatHi),
        band: toBand(s.fat, s.band, fatLo, fatHi),
      },
      { id: 'glycogen', name: WELCOME.lanes.glycogen, value: String(Math.round(s.gly[DAYS - 1]!)), unit: 'g', category: 'fuel', grade: 'B', path: toPath(s.gly, 60, 520) },
      {
        id: 'ketones',
        name: WELCOME.lanes.ketones,
        value: s.ket[DAYS - 1]!.toFixed(1),
        unit: 'mmol/L',
        category: 'fuel',
        grade: 'B',
        path: toPath(s.ket, 0, kHi),
        threshold: { y: 40 - (0.5 / kHi) * 40, label: WELCOME.ketosisThreshold },
      },
    ];
  }, []);

  const avatar = useMemo(() => {
    const est = liveEstimate({ sex: 'female', ageYears: 38, heightCm: 168, weightKg: 74 });
    const after = changedState(est, -4.3);
    return { from: stateToAvatarParams(est), to: stateToAvatarParams(after, { baseline: est }) };
  }, []);

  return (
    <div className="lm-onb-stage lm-stage" aria-hidden="true">
      <div className="lm-onb-rec">
        <div className="lm-onb-rec__head">
          <span className="lm-eng">{WELCOME.exampleLabel}</span>
          <span className="lm-eng">12 wk</span>
        </div>
        <div className="lm-onb-rec__body">
          {lanes.map((l) => (
            <div className="lm-onb-rec__lane" key={l.id}>
              <div className="lm-onb-rec__label">
                <span className="lm-onb-rec__name">
                  <Swatch category={l.category} />
                  {l.name}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="lm-onb-rec__value">
                    {l.value}
                    <span className="lm-unit">{' '}{l.unit}</span>
                  </span>
                  <GradeBadge grade={l.grade} size="sm" tooltip={false} className="lm-onb-rec__grade" />
                </span>
              </div>
              <div className="lm-onb-rec__plot">
                <div className="lm-onb-rec__inner">
                  <svg viewBox="0 0 100 40" preserveAspectRatio="none" focusable="false">
                    {l.threshold ? (
                      <line x1="0" x2="100" y1={l.threshold.y} y2={l.threshold.y} stroke="var(--lm-ink-3)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                    ) : null}
                    <g className="lm-onb-rec__draw">
                      {l.band ? <path d={l.band} fill={`var(--lm-cat-${l.category})`} style={{ fillOpacity: 'var(--lm-chart-band-alpha)' }} /> : null}
                      <path d={l.path} fill="none" stroke={`var(--lm-cat-${l.category})`} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                    </g>
                  </svg>
                  {l.threshold ? (
                    <span className="lm-onb-rec__threshold" style={{ top: `${(l.threshold.y / 40) * 100}%` }}>
                      {l.threshold.label}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
          <div className="lm-onb-rec__sweep" />
        </div>
        <div className="lm-onb-rec__axis">
          <span />
          <span className="lm-onb-rec__ticks">
            <span>wk 1</span>
            <span>wk 4</span>
            <span>wk 8</span>
            <span>wk 12</span>
          </span>
        </div>
      </div>
      <div className="lm-onb-stage__figure">
        <AvatarMorph from={avatar.from} to={avatar.to} autoPlay durationMs={1200} size="fill" view="front" ruler={false} caption={false} ghost label={WELCOME.exampleLabel} />
      </div>
    </div>
  );
}
