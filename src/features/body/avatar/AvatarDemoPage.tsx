// /dev/avatar - avatar lab: every body input and engine slider -> liveEstimate -> stateToAvatarParams -> figure,
// with live readouts, direct manipulation, a before/after morph and a specimen matrix for visual QA.

import { useMemo, useState } from 'react';
import {
  FAT_ANCHORS,
  FFMI_ANCHOR_DESCRIPTORS,
  allocateRegional,
  bodyFatToSlider,
  frameForSex,
  liveEstimate,
  sliderToBodyFat,
  slidersFromEstimate,
  stateToAvatarParams,
  type BodyEstimate,
  type BodyInputs,
  type BodySliders,
  type BodyState,
  type Sex,
} from '@/engine/body';
import {
  Engraved,
  Faceplate,
  Field,
  KeyBank,
  MeasureStepper,
  Page,
  Readout,
  ScaleSlider,
  Section,
  Stepper,
  Switch,
  formatNumber,
  formatSigned,
  Key,
} from '@/components';
import { useSettingsStore } from '@/state/settingsStore';
import { AvatarMorph } from './AvatarMorph';
import { BodyAvatar, type AvatarInteraction, type AvatarView, type DragChannel, type DragRegion, type RegionDragDelta } from './BodyAvatar';
import { frameSliderWords } from './describe';
import './demo.css';

type SliderKey = keyof BodySliders;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const signed = (v: number) => formatSigned(v, 2);

function lengthText(cm: number, units: 'metric' | 'imperial'): string {
  return units === 'metric' ? `${formatNumber(cm, 1)} cm` : `${formatNumber(cm / 2.54, 1)} in`;
}

function muscleWords(s: number): string {
  const i = Math.round(clamp(s, 0, 1) * (FFMI_ANCHOR_DESCRIPTORS.length - 1));
  return (FFMI_ANCHOR_DESCRIPTORS[i] ?? '').toLowerCase();
}

/** A simulated state with changed fat and fat-free mass (regional allocation by the engine, M7). */
function changedState(s: BodyEstimate, dFatKg: number, dFfmKg: number): BodyState {
  const fm = Math.max(s.fatMassKg + dFatKg, 0.03 * s.weightKg);
  const ffm = s.fatFreeMassKg + dFfmKg;
  const sm = s.skeletalMuscleKg + 0.9 * dFfmKg;
  const r = allocateRegional({ fat: s.fat, muscle: s.muscle }, { fatMassKg: fm, skeletalMuscleKg: sm });
  return { ...s, fatMassKg: fm, fatFreeMassKg: ffm, weightKg: fm + ffm, skeletalMuscleKg: sm, fat: r.fat, muscle: r.muscle };
}

const SCENARIOS = {
  loss: { label: 'fat loss', weeks: 16, dFat: -8, dFfm: -0.8 },
  recomp: { label: 'recomposition', weeks: 20, dFat: -4, dFfm: 2.5 },
  gain: { label: 'muscle gain', weeks: 24, dFat: 1.5, dFfm: 4.5 },
} as const;
type ScenarioId = keyof typeof SCENARIOS;

const SPECIMENS: { id: string; label: string; inputs: BodyInputs }[] = [
  { id: 'm-lean', label: 'male · 185 cm · 64 kg', inputs: { sex: 'male', ageYears: 25, heightCm: 185, weightKg: 64 } },
  { id: 'm-musc', label: 'male · muscular · lean', inputs: { sex: 'male', ageYears: 30, heightCm: 178, weightKg: 88, sliders: { muscularity: 0.92, adiposity: 0.12 } } },
  { id: 'm-avg', label: 'male · 178 cm · 84 kg', inputs: { sex: 'male', ageYears: 45, heightCm: 178, weightKg: 84 } },
  { id: 'm-high', label: 'male · 175 cm · 128 kg', inputs: { sex: 'male', ageYears: 55, heightCm: 175, weightKg: 128 } },
  { id: 'f-lean', label: 'female · 170 cm · 50 kg', inputs: { sex: 'female', ageYears: 24, heightCm: 170, weightKg: 50 } },
  { id: 'f-musc', label: 'female · muscular · lean', inputs: { sex: 'female', ageYears: 30, heightCm: 168, weightKg: 66, sliders: { muscularity: 0.92, adiposity: 0.12 } } },
  { id: 'f-avg', label: 'female · 164 cm · 66 kg', inputs: { sex: 'female', ageYears: 40, heightCm: 164, weightKg: 66 } },
  { id: 'f-high', label: 'female · 162 cm · 118 kg', inputs: { sex: 'female', ageYears: 50, heightCm: 162, weightKg: 118 } },
];

export default function AvatarDemoPage() {
  const units = useSettingsStore((s) => s.units);
  const [sex, setSex] = useState<Sex>('male');
  const [frameChoice, setFrameChoice] = useState<number | null>(null);
  const [age, setAge] = useState(38);
  const [height, setHeight] = useState(178);
  const [weight, setWeight] = useState(84);
  const [waistOn, setWaistOn] = useState(false);
  const [waist, setWaist] = useState(94);
  const [touched, setTouched] = useState<BodySliders>({});
  const [view, setView] = useState<AvatarView>('both');
  const [visceral, setVisceral] = useState(false);
  const [measuresOn, setMeasuresOn] = useState(true);
  const [scenario, setScenario] = useState<ScenarioId>('loss');
  const [weekly, setWeekly] = useState(false);
  const [morphT, setMorphT] = useState(1);

  const frame = frameChoice ?? frameForSex(sex);
  const inputs: BodyInputs = useMemo(
    () => ({ sex, ageYears: age, heightCm: height, weightKg: weight, waistCm: waistOn ? waist : undefined, sliders: touched }),
    [sex, age, height, weight, waistOn, waist, touched],
  );
  const estimate = useMemo(() => liveEstimate(inputs), [inputs]);
  const params = useMemo(() => stateToAvatarParams(estimate), [estimate]);
  // untouched sliders display the estimate (never fed back: the engine's unused-slider rule)
  const shown = useMemo(() => ({ ...slidersFromEstimate(estimate, inputs), ...touched }), [estimate, inputs, touched]);

  const setSlider = (key: SliderKey, v: number) => setTouched((prev) => ({ ...prev, [key]: v }));
  const nudge = (key: SliderKey, delta: number, lo: number, hi: number) =>
    setTouched((prev) => ({ ...prev, [key]: clamp((prev[key] ?? shown[key]) + delta, lo, hi) }));

  const onRegionDrag = (region: DragRegion, d: RegionDragDelta) => {
    if (d.amount === 0) return;
    if (region === 'body') {
      setTouched((prev) => {
        const bf = sliderToBodyFat(sex, prev.adiposity ?? shown.adiposity) + d.amount;
        return { ...prev, adiposity: bodyFatToSlider(sex, bf) };
      });
      return;
    }
    if (d.channel === 'muscle') {
      // muscle units are 0..1 per 120 px; the engine's regional muscle sliders span -1..1
      const key: SliderKey = region === 'hips' ? 'muscleLegs' : region === 'chest' ? 'muscleTorso' : 'muscleArms';
      nudge(key, 2 * d.amount, -1, 1);
      return;
    }
    if (region === 'waist') nudge('bellyVsHips', d.amount, -1, 1);
    else if (region === 'hips') nudge('bellyVsHips', -d.amount, -1, 1);
    else nudge(region === 'chest' ? 'chest' : 'arms', d.amount, -1, 1);
  };

  const describe = (region: DragRegion, channel: DragChannel): string => {
    if (region === 'body') return `body fat · ${formatNumber(estimate.bodyFatPct, 1)} %`;
    if (channel === 'muscle') {
      const key: SliderKey = region === 'hips' ? 'muscleLegs' : region === 'chest' ? 'muscleTorso' : 'muscleArms';
      return `${region === 'hips' ? 'leg' : region === 'chest' ? 'torso' : 'arm'} muscle · ${signed(shown[key])}`;
    }
    if (region === 'waist') return `belly vs hips · ${signed(shown.bellyVsHips)}`;
    if (region === 'hips') return `hips vs belly · ${signed(-shown.bellyVsHips)}`;
    return `${region} (drawing only) · ${signed(region === 'chest' ? shown.chest : shown.arms)}`;
  };

  const waistLock = waistOn ? 'set by your waist measurement' : undefined;
  const interaction: AvatarInteraction = {
    onRegionDrag,
    describe,
    handles: 'always',
    disabled: { waist: waistLock, hips: waistLock },
    values: {
      waist: { value: shown.bellyVsHips, min: -1, max: 1, text: `belly versus hips ${signed(shown.bellyVsHips)}` },
      hips: { value: -shown.bellyVsHips, min: -1, max: 1, text: `hips versus belly ${signed(-shown.bellyVsHips)}` },
      chest: { value: shown.chest, min: -1, max: 1, text: `chest fat ${signed(shown.chest)}, drawing only` },
      arms: { value: shown.arms, min: -1, max: 1, text: `arm fat ${signed(shown.arms)}, drawing only` },
    },
  };

  const measures = measuresOn
    ? {
        chest: lengthText(estimate.circumferences.chestCm, units),
        waist: lengthText(estimate.circumferences.waistCm, units),
        hip: lengthText(estimate.circumferences.hipCm, units),
      }
    : undefined;

  const bfBand = estimate.uncertainty.bodyFatBand80;
  const z80 = 1.2816;
  const ffmSd = estimate.uncertainty.fatFreeMassSdKg;
  const waistSd = estimate.uncertainty.waistSdCm;
  const toLen = (cm: number) => (units === 'metric' ? cm : cm / 2.54);

  // before / after
  const sc = SCENARIOS[scenario];
  const after = useMemo(() => changedState(estimate, sc.dFat, sc.dFfm), [estimate, sc]);
  const fromParams = params;
  const toParams = useMemo(() => stateToAvatarParams(after, { baseline: estimate }), [after, estimate]);
  const days = sc.weeks * 7;
  const fatAt = estimate.fatMassKg + (after.fatMassKg - estimate.fatMassKg) * morphT;
  const leanAt = estimate.fatFreeMassKg + (after.fatFreeMassKg - estimate.fatFreeMassKg) * morphT;

  const specimens = useMemo(() => SPECIMENS.map((s) => ({ ...s, params: stateToAvatarParams(liveEstimate(s.inputs)) })), []);

  const fatLabels = FAT_ANCHORS[sex];

  return (
    <Page className="lm-avatar-demo">
      <header className="lm-avatar-demo__head">
        <h1 className="lm-title">Avatar lab</h1>
        <Engraved>engine-driven figure · every control below feeds liveEstimate → stateToAvatarParams</Engraved>
      </header>

      <div className="lm-avatar-demo__grid">
        <div className="lm-avatar-demo__col">
          <Faceplate title="Basics">
            <div className="lm-avatar-demo__fields">
              <Field label="sex for the physiology equations">
                <KeyBank<Sex>
                  block
                  value={sex}
                  onChange={setSex}
                  options={[
                    { value: 'female', label: 'female' },
                    { value: 'male', label: 'male' },
                  ]}
                />
              </Field>
              <Field label="age">
                <Stepper name="age" value={age} onChange={setAge} min={18} max={90} step={1} unit="yrs" />
              </Field>
              <Field label="height">
                <MeasureStepper quantity="height" name="height" value={height} onChange={setHeight} min={140} max={210} unitToggle />
              </Field>
              <Field label="weight">
                <MeasureStepper quantity="mass" name="weight" value={weight} onChange={setWeight} min={35} max={250} />
              </Field>
              <ScaleSlider
                label="frame · drawing only"
                size="sm"
                value={frame}
                min={0}
                max={1}
                step={0.01}
                minorStep={0.05}
                majorStep={0.25}
                labels={[
                  { value: 0, label: 'hips-led' },
                  { value: 1, label: 'shoulders-led' },
                ]}
                format={(x) => frameSliderWords(params, x)}
                valueText={(x) => frameSliderWords(params, x)}
                editable={false}
                onChange={setFrameChoice}
              />
            </div>
          </Faceplate>
        </div>

        <div className="lm-avatar-demo__col">
          <Faceplate
            variant="flush"
            title="Figure"
            caption="front · side · drag the figure’s edges to adjust"
          >
            <div className="lm-avatar-demo__toolbar">
              <KeyBank<AvatarView>
                size="sm"
                label="view"
                value={view}
                onChange={setView}
                options={[
                  { value: 'front', label: 'front' },
                  { value: 'side', label: 'side' },
                  { value: 'both', label: 'both' },
                ]}
              />
              <Switch label="visceral" checked={visceral} onChange={setVisceral} />
              <Switch label="measures" checked={measuresOn} onChange={setMeasuresOn} />
            </div>
            <div className="lm-avatar-demo__stage">
              <BodyAvatar
                params={params}
                view={view}
                frame={frame}
                size="fill"
                units={units}
                showVisceral={visceral}
                showMeasures={measures}
                interactive={interaction}
              />
            </div>
          </Faceplate>
          <Faceplate title="Estimates" caption="live · likely range = 80 % of people like you">
            <div className="lm-avatar-demo__readouts" aria-live="polite">
              <Readout
                label="body fat"
                value={estimate.bodyFatPct}
                unit="%"
                range={bfBand}
                caption={`± ${formatNumber(estimate.bodyFatSdPct, 1)} points (1 SD). ${waistOn ? 'From your figure, weight and waist.' : 'Add a waist measurement to narrow the range.'}`}
                animate
              />
              <Readout
                label="lean mass"
                value={estimate.fatFreeMassKg}
                unit="kg"
                range={[estimate.fatFreeMassKg - z80 * ffmSd, estimate.fatFreeMassKg + z80 * ffmSd]}
                caption="Everything that isn’t fat: muscle, organs, bone, water, glycogen."
                animate
              />
              <Readout label="FFMI" value={estimate.ffmi} unit="kg/m²" caption={`Lean mass per height². ${muscleWords(shown.muscularity)}.`} animate />
              <Readout
                label="waist"
                value={toLen(estimate.circumferences.waistCm)}
                unit={units === 'metric' ? 'cm' : 'in'}
                range={[toLen(estimate.circumferences.waistCm - z80 * waistSd), toLen(estimate.circumferences.waistCm + z80 * waistSd)]}
                caption={waistOn ? 'Measured.' : 'Predicted from your body.'}
                animate
              />
            </div>
          </Faceplate>
        </div>

        <div className="lm-avatar-demo__col">
          <Faceplate title="Shape" actions={<Key variant="quiet" size="sm" onClick={() => setTouched({})}>Reset to estimate</Key>}>
            <Section label="Fat">
              <ScaleSlider
                label="body fat"
                value={shown.adiposity}
                min={0}
                max={1}
                step={0.005}
                minorStep={1 / 28}
                majorStep={1 / 7}
                labels={[
                  { value: 0, label: `${fatLabels[0]} %` },
                  { value: 3 / 7, label: `${fatLabels[3]} %` },
                  { value: 1, label: `${fatLabels[7]} %` },
                ]}
                format={(v) => formatNumber(sliderToBodyFat(sex, v), 1)}
                unit="%"
                valueText={(v) => `${formatNumber(sliderToBodyFat(sex, v), 1)} percent body fat on the figure`}
                likelyRange={[bodyFatToSlider(sex, bfBand[0]), bodyFatToSlider(sex, bfBand[1])]}
                editable={false}
                onChange={(v) => setSlider('adiposity', v)}
                note={touched.adiposity === undefined ? 'Start from our estimate, then match the figure to how you look.' : undefined}
              />
            </Section>
            <Section label="Where it sits">
              <ScaleSlider
                label="belly & waist vs hips & thighs"
                value={shown.bellyVsHips}
                min={-1}
                max={1}
                step={0.01}
                minorStep={0.1}
                majorStep={0.5}
                labels={[
                  { value: -1, label: 'hips' },
                  { value: 0, label: 'typical' },
                  { value: 1, label: 'belly' },
                ]}
                format={signed}
                locked={waistOn}
                lockedReason="set by your waist measurement"
                editable={false}
                onChange={(v) => setSlider('bellyVsHips', v)}
              />
              <ScaleSlider label="chest · drawing only" size="sm" value={shown.chest} min={-1} max={1} step={0.01} majorStep={0.5} format={signed} editable={false} onChange={(v) => setSlider('chest', v)} />
              <ScaleSlider label="arms · drawing only" size="sm" value={shown.arms} min={-1} max={1} step={0.01} majorStep={0.5} format={signed} editable={false} onChange={(v) => setSlider('arms', v)} />
              <ScaleSlider label="face · drawing only" size="sm" value={shown.face} min={-1} max={1} step={0.01} majorStep={0.5} format={signed} editable={false} onChange={(v) => setSlider('face', v)} />
            </Section>
            <Section label="Muscle">
              <ScaleSlider
                label="muscularity"
                value={shown.muscularity}
                min={0}
                max={1}
                step={0.005}
                minorStep={1 / 28}
                majorStep={1 / 7}
                labels={[
                  { value: 0, label: 'slight' },
                  { value: 2 / 7, label: 'average' },
                  { value: 1, label: 'enhanced' },
                ]}
                format={(v) => muscleWords(v)}
                editable={false}
                onChange={(v) => setSlider('muscularity', v)}
              />
              <ScaleSlider label="arms" size="sm" value={shown.muscleArms} min={-1} max={1} step={0.01} majorStep={0.5} format={signed} editable={false} onChange={(v) => setSlider('muscleArms', v)} />
              <ScaleSlider label="legs" size="sm" value={shown.muscleLegs} min={-1} max={1} step={0.01} majorStep={0.5} format={signed} editable={false} onChange={(v) => setSlider('muscleLegs', v)} />
              <ScaleSlider label="torso" size="sm" value={shown.muscleTorso} min={-1} max={1} step={0.01} majorStep={0.5} format={signed} editable={false} onChange={(v) => setSlider('muscleTorso', v)} />
            </Section>
            <Section label="Waist" aside={<Switch label="use measurement" checked={waistOn} onChange={setWaistOn} />}>
              <ScaleSlider
                label="waist at the navel"
                value={waist}
                min={55}
                max={160}
                step={0.5}
                minorStep={1}
                majorStep={5}
                unit="cm"
                locked={!waistOn}
                lockedReason="turn on “use measurement”"
                onChange={setWaist}
                note="Optional. A tape measure at the navel narrows the body-fat range and sets where fat sits."
              />
            </Section>
          </Faceplate>
        </div>
      </div>

      <Faceplate
        title="Figure over time"
        caption={`${sc.weeks} weeks · ${formatSigned(sc.dFat, 1)} kg fat · ${formatSigned(sc.dFfm, 1)} kg lean`}
      >
        <div className="lm-avatar-demo__toolbar lm-avatar-demo__toolbar--inset">
          <KeyBank<ScenarioId>
            size="sm"
            label="scenario"
            value={scenario}
            onChange={(v) => {
              setScenario(v);
              setMorphT(1);
            }}
            options={(Object.keys(SCENARIOS) as ScenarioId[]).map((k) => ({ value: k, label: SCENARIOS[k].label }))}
          />
          <Switch label="weekly steps" checked={weekly} onChange={setWeekly} />
        </div>
        <div className="lm-avatar-demo__morph">
          <AvatarMorph
            from={fromParams}
            to={toParams}
            t={morphT}
            onTChange={setMorphT}
            frame={frame}
            size={360}
            units={units}
            controls
            steps={weekly ? sc.weeks : undefined}
            formatT={(t) => `day ${Math.round(t * days)}`}
            scrubberLabel="day"
            summary={
              <>
                start {formatNumber(estimate.fatMassKg, 1)} kg fat · {formatNumber(estimate.fatFreeMassKg, 1)} kg lean → day {Math.round(morphT * days)}{' '}
                <b>{formatNumber(fatAt, 1)}</b> · <b>{formatNumber(leanAt, 1)}</b> ({formatSigned(fatAt - estimate.fatMassKg, 1)} kg fat,{' '}
                {formatSigned(leanAt - estimate.fatFreeMassKg, 1)} kg lean)
              </>
            }
          />
        </div>
      </Faceplate>

      <Faceplate title="Specimens" caption="the same model across the input space · visual QA">
        <div className="lm-avatar-demo__specimens">
          {specimens.map((s) => (
            <div key={s.id} className="lm-avatar-demo__specimen">
              <BodyAvatar params={s.params} size={240} view="both" caption={false} ruler={false} units={units} />
              <Engraved as="p">{s.label}</Engraved>
            </div>
          ))}
        </div>
        <div className="lm-avatar-demo__cards" aria-label="Plan-card silhouettes">
          {specimens.map((s) => (
            <BodyAvatar key={s.id} params={s.params} size="xs" view="front" appearance="silhouette" caption={false} label={`End-state silhouette, ${s.label}`} />
          ))}
        </div>
      </Faceplate>
    </Page>
  );
}
