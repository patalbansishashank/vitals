import { ChevronDown, ChevronUp } from 'lucide-react';
import { Faceplate, Field, InlineWarning, Key, KeyBank, ScaleSlider, Section, Switch, formatNumber } from '@/components';
import { FAT_ANCHORS, type KnownBodyFatSource } from '@/engine/body';
import { sendCommand } from '@/features/lib/sendCommand';
import '@/commands/defs/profile'; // registers the commands dispatched here
import { BODY_RANGES, type BodyProfileValues, type ShapeKey } from '@/state/profileStore';
import { patchProfile } from '../commands';
import type { UnitSystem } from '@/state/settingsStore';
import { DRAWING, SHAPE, fatDescriptor } from '../copy';
import type { FigureView } from '../figure';
import type { BodySummary } from '../model';
import { formatMass, lengthScale, roundTo, waistRange } from '../units';
import { OptionalLength, OptionalNumber, wrapOptions } from './fields';
import { FrameSlider } from './FrameSlider';

/** Shape › Adjust the drawing: drawing-only controls (body-figure-v2.md §5.4). */
export interface DrawingControls {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Frame shown (draft while dragging), the "match my basics" position, and whether it is stored as null. */
  frame: number;
  basicsFrame: number;
  matchesBasics: boolean;
  onFrameDraft: (frame: number | null) => void;
  twoLayer: boolean;
  onTwoLayerChange: (on: boolean) => void;
}

export interface ShapeFaceProps {
  v: BodyProfileValues;
  view: FigureView;
  summary: BodySummary;
  units: UnitSystem;
  onLive: () => void;
  onCommit: () => void;
  intro?: string;
  id?: string;
  waistId?: string;
  /** The "Adjust the drawing" disclosure; omitted = not shown. */
  drawing?: DrawingControls;
  drawingId?: string;
}

const pctText = (x: number) => formatNumber(x, 1);

/** Nearest engine fat anchor (dossier 14 T2) to a body-fat value. */
function nearestAnchor(anchors: readonly number[], bf: number): number {
  let best = 0;
  anchors.forEach((a, i) => {
    if (Math.abs(a - bf) < Math.abs((anchors[best] ?? 0) - bf)) best = i;
  });
  return best;
}


/** Shape (your-body.md §6): body fat, where it sits, muscle, measured waist and body fat. */
export function ShapeFace({ v, view, summary, units, onLive, onCommit, intro, id, waistId, drawing, drawingId }: ShapeFaceProps) {
  const s = view.shown;
  const set = (key: ShapeKey) => (x: number) => {
    onLive();
    patchProfile({ shape: { [key]: x } });
  };
  const sex = summary.equationSex;
  const anchors = FAT_ANCHORS[sex];
  const bfTouched = v.shape.bodyFatPct !== undefined;
  const anchorIdx = nearestAnchor(anchors, s.bodyFatPct);
  const [lo, hi] = summary.bodyFatBand80;
  const waistOn = v.waist.use;
  const waistMeasured = waistOn && v.waist.cm !== null;
  const lockReason = waistMeasured ? SHAPE.bellyLocked : undefined;
  const scale = lengthScale(units);
  const [wMin, wMax] = waistRange(units);
  const codes = new Set(summary.warnings.map((w) => w.code));
  const muscleTouched = v.shape.muscleUpper !== undefined || v.shape.muscleLower !== undefined;
  const rfm = summary.estimate.fusion.observations.find((o) => o.id === 'rfm');
  const implied = summary.estimate.visualWeightKg;
  const impliedText = implied !== undefined ? formatMass(implied, units, 0) : null;

  const distSlider = (key: 'belly' | 'hips' | 'chest' | 'arms', label: string, drawingOnly: boolean) => (
    <ScaleSlider
      label={label}
      size="sm"
      value={s[key]}
      min={-1}
      max={1}
      step={0.01}
      minorStep={0.1}
      majorStep={0.5}
      labels={SHAPE.distLabels}
      format={() => String(Math.round(view.shares[key]))}
      unit={SHAPE.shareUnit}
      valueText={() => `${label.replace('&', 'and')}: ${Math.round(view.shares[key])} percent of your body fat${drawingOnly ? ', changes the drawing only' : ''}`}
      locked={(key === 'belly' || key === 'hips') && waistMeasured}
      lockedReason={lockReason}
      editable={false}
      note={
        drawingOnly ? (
          SHAPE.drawingOnly
        ) : key === 'belly' && waistMeasured ? (
          <>
            {SHAPE.bellyLocked} ·{' '}
            <button type="button" className="lm-link lm-body-linkbtn" onClick={() => patchProfile({ waist: { use: false } })}>
              {SHAPE.unlock}
            </button>
          </>
        ) : undefined
      }
      onChange={set(key)}
      onCommit={onCommit}
    />
  );

  const muscleSlider = (key: 'muscleUpper' | 'muscleLower', label: string) => (
    <ScaleSlider
      label={label}
      size="sm"
      value={s[key]}
      min={0}
      max={1}
      step={0.005}
      minorStep={1 / 28}
      majorStep={1 / 7}
      labels={[]}
      reference={{ value: view.muscle.expected, label: SHAPE.expectedRef }}
      format={(x) => view.muscle.words(x)}
      valueText={(x) => `${label} muscle: ${view.muscle.words(x)} for your size and training`}
      editable={false}
      onChange={set(key)}
      onCommit={onCommit}
    />
  );

  return (
    <Faceplate
      id={id}
      className="lm-body-shape"
      title={SHAPE.title}
      actions={
        <Key variant="quiet" size="sm" disabledReason={Object.keys(v.shape).length ? undefined : 'Already at the estimate'} onClick={() => void sendCommand('profile.resetShape', {})}>
          {SHAPE.reset}
        </Key>
      }
    >
      <div className="lm-body-shape__body">
        {intro ? <p className="lm-body-lead">{intro}</p> : null}
        <ScaleSlider
          label={SHAPE.bodyFat}
          value={s.bodyFatPct}
          min={4}
          max={60}
          step={0.1}
          minorStep={1}
          majorStep={5}
          labels={anchors.map((a) => ({ value: a, label: String(a) }))}
          format={pctText}
          unit="%"
          likelyRange={summary.bodyFatBand80}
          reference={view.diverges ? { value: summary.bodyFatPct } : undefined}
          valueText={(x) =>
            `body fat on the figure ${pctText(x)} percent. Estimate ${pctText(summary.bodyFatPct)} percent, likely ${pctText(lo)} to ${pctText(hi)}.`
          }
          note={bfTouched ? SHAPE.nearest(String(anchors[anchorIdx]), fatDescriptor(sex, anchorIdx)) : SHAPE.bodyFatHelp}
          onChange={set('bodyFatPct')}
          onCommit={onCommit}
        />

        <Section label={SHAPE.whereTitle}>
          {distSlider('belly', SHAPE.belly, false)}
          {distSlider('hips', SHAPE.hips, false)}
          {drawing ? null : distSlider('chest', SHAPE.chest, true)}
          {drawing ? null : distSlider('arms', SHAPE.arms, true)}
        </Section>

        <Section label={SHAPE.muscleTitle}>
          {muscleSlider('muscleUpper', SHAPE.upper)}
          {muscleSlider('muscleLower', SHAPE.lower)}
          <p className="lm-body-hint">{SHAPE.muscleHelp}</p>
          {muscleTouched && bfTouched && codes.has('visualWeightMismatch') && impliedText ? (
            <InlineWarning severity="info">{SHAPE.mismatch(`${formatNumber(impliedText.value, 0)} ${impliedText.unit}`)}</InlineWarning>
          ) : null}
          {muscleTouched && codes.has('trainingConsistency') ? <InlineWarning severity="info">{SHAPE.consistency}</InlineWarning> : null}
        </Section>

        <Section
          id={waistId}
          label={SHAPE.measuredTitle}
          aside={
            <Switch
              label={SHAPE.waistSwitch}
              checked={waistOn}
              onChange={(on) => {
                const cm = v.waist.cm ?? roundTo(view.waistCm, 0.5);
                patchProfile({ waist: { use: on, cm } });
                onCommit();
              }}
            />
          }
        >
          <ScaleSlider
            label={SHAPE.waist}
            value={scale.toDisplay(waistOn && v.waist.cm !== null ? v.waist.cm : view.waistCm)}
            min={wMin}
            max={wMax}
            step={0.5}
            minorStep={units === 'metric' ? 1 : 0.5}
            majorStep={units === 'metric' ? 5 : 2}
            labels={units === 'metric' ? [55, 80, 105, 130, 155] : [22, 32, 42, 52, 62]}
            unit={scale.unit}
            format={(x) => formatNumber(x, 1)}
            locked={!waistOn}
            lockedReason={SHAPE.waistLocked}
            note={
              waistOn ? SHAPE.waistHelp : `${SHAPE.waistPredicted} ${SHAPE.waistHelp}`
            }
            onChange={(x) => {
              onLive();
              patchProfile({ waist: { cm: scale.toMetric(x) } });
            }}
            onCommit={onCommit}
          />
          {waistMeasured && (codes.has('waistTrunkFatAtBound') || codes.has('trunkLimbZAtBound')) && rfm ? (
            <InlineWarning severity="info">{SHAPE.waistPin(formatNumber(rfm.valuePct, 0))}</InlineWarning>
          ) : null}
          {waistOn ? (
            <div className="lm-body-pair">
              <Field label={SHAPE.neck} help={SHAPE.neckHelp}>
                <OptionalLength units={units} name="neck" value={v.waist.neckCm} min={BODY_RANGES.neckCm[0]} max={BODY_RANGES.neckCm[1]} onChange={(cm) => patchProfile({ waist: { neckCm: cm } })} />
              </Field>
              {v.sex === 'female' ? (
                <Field label={SHAPE.hip}>
                  <OptionalLength units={units} name="hips" value={v.waist.hipCm} min={BODY_RANGES.hipCm[0]} max={BODY_RANGES.hipCm[1]} onChange={(cm) => patchProfile({ waist: { hipCm: cm } })} />
                </Field>
              ) : null}
            </div>
          ) : null}
        </Section>

        <Section
          label={SHAPE.knownTitle}
          aside={<Switch label={SHAPE.knownSwitch} checked={v.knownBodyFat.use} onChange={(on) => patchProfile({ knownBodyFat: { use: on } })} />}
        >
          {v.knownBodyFat.use ? (
            <div className="lm-body-form">
              <Field label={SHAPE.knownValue} help={SHAPE.knownHelp}>
                <OptionalNumber
                  name="measured body fat"
                  unit="%"
                  step={0.1}
                  value={v.knownBodyFat.pct}
                  min={BODY_RANGES.knownBodyFatPct[0]}
                  max={BODY_RANGES.knownBodyFatPct[1]}
                  onChange={(pct) => patchProfile({ knownBodyFat: { pct } })}
                />
              </Field>
              <Field label={SHAPE.knownMethod}>
                <KeyBank<KnownBodyFatSource> block value={v.knownBodyFat.source} onChange={(src) => patchProfile({ knownBodyFat: { source: src } })} options={wrapOptions(SHAPE.methods)} />
              </Field>
            </div>
          ) : (
            <p className="lm-body-hint">{SHAPE.knownHelp}</p>
          )}
        </Section>

        {drawing ? (
          <div id={drawingId} className="lm-body-drawing">
            <Key
              variant="quiet"
              size="sm"
              trailingIcon={drawing.open ? ChevronUp : ChevronDown}
              aria-expanded={drawing.open}
              aria-controls={drawingId ? `${drawingId}-panel` : undefined}
              onClick={() => drawing.onOpenChange(!drawing.open)}
            >
              {DRAWING.title}
            </Key>
            {drawing.open ? (
              <div id={drawingId ? `${drawingId}-panel` : undefined} className="lm-body-drawing__panel">
                <FrameSlider
                  params={view.params}
                  value={drawing.frame}
                  basics={drawing.basicsFrame}
                  matchesBasics={drawing.matchesBasics}
                  onDraft={(x) => {
                    if (x !== null) onLive();
                    drawing.onFrameDraft(x);
                  }}
                  onCommit={onCommit}
                />
                {distSlider('chest', SHAPE.chest, true)}
                {distSlider('arms', SHAPE.arms, true)}
                <Switch label={DRAWING.layers} checked={drawing.twoLayer} onChange={drawing.onTwoLayerChange} />
                <p className="lm-body-hint">{DRAWING.layersHelp}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Faceplate>
  );
}
