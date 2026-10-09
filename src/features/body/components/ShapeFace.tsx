import { useEffect, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Faceplate, Field, InlineWarning, Key, KeyBank, ScaleSlider, Section, Switch, formatNumber, type ScaleSliderProps } from '@/components';
import { FAT_ANCHORS, type KnownBodyFatSource } from '@/engine/body';
import { sendCommand } from '@/features/lib/sendCommand';
import '@/commands/defs/profile'; // registers the commands dispatched here
import { BODY_RANGES, type BodyProfileValues, type ShapeKey } from '@/state/profileStore';
import { patchProfile } from '../commands';
import type { UnitSystem } from '@/state/settingsStore';
import { DRAWING, FIGURE, SHAPE, fatDescriptor } from '../copy';
import type { FigureView } from '../figure';
import type { BodySummary } from '../model';
import { formatMass, lengthScale, roundTo, waistRange } from '../units';
import { OptionalLength, OptionalNumber, wrapOptions } from './fields';
import { FrameSlider } from './FrameSlider';
import { commitShape, dragShape, flushShapeCommits, resetShapeDraft, useDraftView, useLiveShape } from '../shapeDraft';

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


type ShapeScaleProps = Omit<ScaleSliderProps, 'onChange' | 'onCommit' | 'note'> & {
  shapeKey: ShapeKey;
  /** Help line; a function gets the value under the thumb while one is being moved (else undefined). */
  note?: ReactNode | ((live: number | undefined) => ReactNode);
  /** First input of a gesture (freeze the screen-reader snapshot). */
  onLive: () => void;
  /** After the profile write that ends a gesture (release the snapshot). */
  onCommit: () => void;
};

/**
 * One shape slider. While it is moved only this component renders: the thumb and readout follow the live value; the
 * profile is written once at the end of the gesture and the figure is fed at most once per frame (`../shapeDraft`).
 */
function ShapeScale({ shapeKey, value, note, onLive, onCommit, ...rest }: ShapeScaleProps) {
  const live = useLiveShape(shapeKey);
  return (
    <ScaleSlider
      {...rest}
      value={live ?? value}
      note={typeof note === 'function' ? note(live) : note}
      onChange={(x) => {
        if (live === undefined) onLive();
        dragShape(shapeKey, x);
      }}
      onCommit={(x, via) => commitShape(shapeKey, x, via, onCommit)}
    />
  );
}

/** A share-of-fat slider: its readout follows the drawing as it is being moved (the share needs the engine). */
function ShareScale({
  v,
  view,
  region,
  label,
  drawingOnly,
  ...rest
}: Omit<ShapeScaleProps, 'format' | 'valueText' | 'value' | 'shapeKey'> & {
  v: BodyProfileValues;
  view: FigureView;
  region: 'belly' | 'hips' | 'chest' | 'arms';
  label: string;
  drawingOnly: boolean;
}) {
  const shown = useDraftView(v, view);
  const share = Math.round(shown.shares[region]);
  return (
    <ShapeScale
      {...rest}
      label={label}
      shapeKey={region}
      value={view.shown[region]}
      format={() => String(share)}
      valueText={() => `${label.replace('&', 'and')}: ${share} percent of your body fat${drawingOnly ? ', changes the drawing only' : ''}`}
    />
  );
}

/** Shape (your-body.md §6): body fat, where it sits, muscle, measured waist and body fat. */
export function ShapeFace({ v, view, summary, units, onLive, onCommit, intro, id, waistId, drawing, drawingId }: ShapeFaceProps) {
  const s = view.shown;
  // a key step still waiting for its 150 ms is written when the card goes (Next, Back, another page)
  useEffect(() => flushShapeCommits, []);
  const sex = summary.equationSex;
  const anchors = FAT_ANCHORS[sex];
  const bfTouched = v.shape.bodyFatPct !== undefined;
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
    <ShareScale
      v={v}
      view={view}
      region={key}
      label={label}
      drawingOnly={drawingOnly}
      size="sm"
      min={-1}
      max={1}
      step={0.01}
      minorStep={0.1}
      majorStep={0.5}
      labels={SHAPE.distLabels}
      unit={SHAPE.shareUnit}
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
      onLive={onLive}
      onCommit={onCommit}
    />
  );

  const muscleSlider = (key: 'muscleUpper' | 'muscleLower', label: string) => (
    <ShapeScale
      shapeKey={key}
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
      onLive={onLive}
      onCommit={onCommit}
    />
  );

  /** Under the body-fat slider: the reference nearest the thumb while it moves; after release, the hint or the figure-vs-estimate note. */
  const bodyFatNote = (liveValue: number | undefined): ReactNode => {
    const near = (x: number) => SHAPE.nearest(String(anchors[nearestAnchor(anchors, x)]), fatDescriptor(sex, nearestAnchor(anchors, x)));
    return (
      <>
        {liveValue !== undefined ? near(liveValue) : view.diverges ? null : bfTouched ? near(s.bodyFatPct) : SHAPE.bodyFatHelp}
        {/* the one note for this slider while the figure and the estimate differ, shown once the gesture has ended; the
            live region stays mounted so a screen reader hears it appear and change */}
        <span aria-live="polite" aria-atomic="true">
          {liveValue === undefined && view.diverges
            ? FIGURE.diverges(formatNumber(view.bodyFatPct, 1), formatNumber(summary.bodyFatPct, 1))
            : null}
        </span>
      </>
    );
  };

  return (
    <Faceplate
      id={id}
      className="lm-body-shape"
      title={SHAPE.title}
      actions={
        <Key variant="quiet" size="sm" disabledReason={Object.keys(v.shape).length ? undefined : 'Already at the estimate'} onClick={() => {
            resetShapeDraft();
            void sendCommand('profile.resetShape', {});
          }}>
          {SHAPE.reset}
        </Key>
      }
    >
      <div className="lm-body-shape__body">
        {intro ? <p className="lm-body-lead">{intro}</p> : null}
        <ShapeScale
          shapeKey="bodyFatPct"
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
          note={bodyFatNote}
          onLive={onLive}
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
