import { useEffect, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { CardFoot, CardHead, Field, GradientCard, InlineWarning, KeyBank, ScaleSlider, Section, Switch, formatNumber } from '@/components';
import { FAT_ANCHORS, type KnownBodyFatSource } from '@/engine/body';
import { sendCommand } from '@/features/lib/sendCommand';
import '@/commands/defs/profile'; // registers the commands dispatched here
import { BODY_RANGES, type BodyProfileValues } from '@/state/profileStore';
import { patchProfile } from '../commands';
import type { UnitSystem } from '@/state/settingsStore';
import { FIGURE, INFO, SHAPE, fatDescriptor } from '../copy';
import type { FigureView } from '../figure';
import type { BodySummary } from '../model';
import { formatMass, lengthScale, roundTo, waistRange } from '../units';
import { DisclosureRow } from './Disclosure';
import { OptionalLength, OptionalNumber, wrapOptions } from './fields';
import { Rail, ShapeScale, ShareScale } from './ShapeScales';
import { flushShapeCommits, resetShapeDraft } from '../shapeDraft';
import { LOW_BODY_GLOW } from './glow';

export interface ShapeFaceProps {
  v: BodyProfileValues;
  view: FigureView;
  summary: BodySummary;
  units: UnitSystem;
  onLive: () => void;
  onCommit: () => void;
  id?: string;
  /** Id of the waist row (deep link `?focus=waist`). */
  waistId?: string;
  /** "Fine-tune shape": everything but the body-fat scale, closed unless opened (or a deep link opens it). */
  fineTune: boolean;
  onFineTuneChange: (open: boolean) => void;
  /** The card's foot: the setup step's keys on desktop (r068 V-BS-1). */
  footer?: ReactNode;
  /** Quiet mode: what the slider says about itself carries no number from the estimate (the position the person set is theirs). */
  quiet?: boolean;
}

const pctText = (x: number) => formatNumber(x, 1);
/** The body-fat rail runs 4–60 %: its two real ends and every 10 between, spaced by value (r068 V-BD-2: no unlabelled tail). */
const BODY_FAT_LABELS = [4, 10, 20, 30, 40, 50, 60].map((x) => ({ value: x, label: String(x) }));

/** Nearest engine fat anchor (dossier 14 T2) to a body-fat value. */
function nearestAnchor(anchors: readonly number[], bf: number): number {
  let best = 0;
  anchors.forEach((a, i) => {
    if (Math.abs(a - bf) < Math.abs((anchors[best] ?? 0) - bf)) best = i;
  });
  return best;
}

/** A row title with its switch at the right: the visible word, and "Use measured …" as the switch's name. */
function MeasureSwitch({ row, name, checked, onChange }: { row: string; name: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <Switch
      className="lm-body-measure__switch"
      labelStyle="sentence"
      label={
        <>
          <span aria-hidden="true">{row}</span>
          <span className="lm-sr">{name}</span>
        </>
      }
      checked={checked}
      onChange={onChange}
    />
  );
}

/**
 * Shape (r071; your-body.md §6): an input card. The body-fat scale, then "Fine-tune shape" (where it sits, muscle,
 * measurements); the head holds the (i) and "Reset to estimate" is the foot's link, shown only while the shape differs
 * from the estimate. Drawing-only controls live with the figure (Figure › Adjust the drawing).
 */
export function ShapeFace({ v, view, summary, units, onLive, onCommit, id, waistId, fineTune, onFineTuneChange, footer, quiet = false }: ShapeFaceProps) {
  const s = view.shown;
  // a key step still waiting for its 150 ms is written when the card goes (Next, Back, another page)
  useEffect(() => flushShapeCommits, []);
  const sex = summary.equationSex;
  const anchors = FAT_ANCHORS[sex];
  const bfTouched = v.shape.bodyFatPct !== undefined;
  const [lo, hi] = summary.bodyFatBand80;
  const waistOn = v.waist.use;
  const waistMeasured = waistOn && v.waist.cm !== null;
  const scale = lengthScale(units);
  const [wMin, wMax] = waistRange(units);
  const codes = new Set(summary.warnings.map((w) => w.code));
  const muscleTouched = v.shape.muscleUpper !== undefined || v.shape.muscleLower !== undefined;
  const rfm = summary.estimate.fusion.observations.find((o) => o.id === 'rfm');
  const implied = summary.estimate.visualWeightKg;
  const impliedText = implied !== undefined ? formatMass(implied, units, 0) : null;
  const panelId = id ? `${id}-fine` : undefined;

  const distSlider = (key: 'belly' | 'hips', label: string) => (
    <ShareScale
      v={v}
      view={view}
      region={key}
      label={label}
      drawingOnly={false}
      size="sm"
      min={-1}
      max={1}
      step={0.01}
      minorStep={0.1}
      majorStep={0.5}
      labels={SHAPE.distLabels}
      unit={SHAPE.shareUnit}
      locked={waistMeasured}
      lockedReason={waistMeasured ? SHAPE.bellyLocked : undefined}
      editable={false}
      note={
        key === 'belly' && waistMeasured ? (
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
      // words, not a number: body text in stone, never the readout's numeral style
      format={(x) => <span className="lm-body-words">{view.muscle.words(x)}</span>}
      valueText={(x) => `${label} muscle: ${view.muscle.words(x)} for your size and training`}
      editable={false}
      onLive={onLive}
      onCommit={onCommit}
    />
  );

  /** Under the body-fat slider: the reference nearest the thumb while it moves; after release, the figure-vs-estimate note. */
  const bodyFatNote = (liveValue: number | undefined): ReactNode => {
    const near = (x: number) => SHAPE.nearest(String(anchors[nearestAnchor(anchors, x)]), fatDescriptor(sex, nearestAnchor(anchors, x)));
    return (
      <>
        {liveValue !== undefined ? near(liveValue) : view.diverges ? null : bfTouched ? near(s.bodyFatPct) : null}
        {/* the one note for this slider while the figure and the estimate differ, shown once the gesture has ended; the
            live region stays mounted so a screen reader hears it appear and change */}
        <span aria-live="polite" aria-atomic="true">
          {liveValue === undefined && view.diverges ? (quiet ? FIGURE.divergesQuiet : FIGURE.diverges(formatNumber(view.bodyFatPct, 1), formatNumber(summary.bodyFatPct, 1))) : null}
        </span>
      </>
    );
  };

  const touched = Object.keys(v.shape).length > 0;
  const foot =
    touched || footer ? (
      <>
        {touched ? (
          // only while the shape differs from the estimate
          <CardFoot
            link={{
              label: SHAPE.reset,
              onClick: () => {
                resetShapeDraft();
                void sendCommand('profile.resetShape', {});
              },
            }}
          />
        ) : null}
        {footer ? <div className="lm-body-setup-foot">{footer}</div> : null}
      </>
    ) : undefined;

  return (
    <GradientCard id={id} className="lm-body-shape" domain="body" glow={LOW_BODY_GLOW} head={<CardHead icon={SlidersHorizontal} title={SHAPE.title} info={INFO.shape} />} foot={foot}>
      <div className="lm-body-shape__body">
        <ShapeScale
          shapeKey="bodyFatPct"
          label={SHAPE.bodyFat}
          value={s.bodyFatPct}
          min={4}
          max={60}
          step={0.1}
          minorStep={1}
          majorStep={5}
          // printed by value across the whole rail (the reference figures' anchors are uneven and stop at 42)
          labels={BODY_FAT_LABELS}
          format={pctText}
          unit="%"
          likelyRange={summary.bodyFatBand80}
          reference={view.diverges && !quiet ? { value: summary.bodyFatPct } : undefined}
          valueText={(x) => (quiet ? SHAPE.quietValueText(pctText(x)) : `body fat on the figure ${pctText(x)} percent. Estimate ${pctText(summary.bodyFatPct)} percent, likely ${pctText(lo)} to ${pctText(hi)}.`)}
          note={bodyFatNote}
          onLive={onLive}
          onCommit={onCommit}
        />

        <div className="lm-body-fine">
          <DisclosureRow open={fineTune} controls={panelId} onToggle={() => onFineTuneChange(!fineTune)}>
            {SHAPE.fineTune}
          </DisclosureRow>
          {fineTune ? (
            <div id={panelId} className="lm-body-fine__panel">
              <Section label={SHAPE.whereTitle}>
                {distSlider('belly', SHAPE.belly)}
                {distSlider('hips', SHAPE.hips)}
              </Section>

              <Section label={SHAPE.muscleTitle}>
                {muscleSlider('muscleUpper', SHAPE.upper)}
                {muscleSlider('muscleLower', SHAPE.lower)}
                {muscleTouched && bfTouched && codes.has('visualWeightMismatch') && impliedText ? (
                  <InlineWarning severity="info">{quiet ? SHAPE.mismatchQuiet : SHAPE.mismatch(`${formatNumber(impliedText.value, 0)} ${impliedText.unit}`)}</InlineWarning>
                ) : null}
                {muscleTouched && codes.has('trainingConsistency') ? <InlineWarning severity="info">{SHAPE.consistency}</InlineWarning> : null}
              </Section>

              <Section label={SHAPE.measuredTitle}>
                <div id={waistId} className="lm-body-measure">
                  <MeasureSwitch
                    row={SHAPE.waistRow}
                    name={SHAPE.waistSwitch}
                    checked={waistOn}
                    onChange={(on) => {
                      const cm = v.waist.cm ?? roundTo(view.waistCm, 0.5);
                      patchProfile({ waist: { use: on, cm } });
                      onCommit();
                    }}
                  />
                  {waistOn ? (
                    <>
                      <Rail min={wMin} max={wMax} value={scale.toDisplay(v.waist.cm ?? view.waistCm)}>
                        <ScaleSlider
                          label={
                            <>
                              <span className="lm-sr">{SHAPE.waistRow}</span> {SHAPE.waist}
                            </>
                          }
                          value={scale.toDisplay(v.waist.cm ?? view.waistCm)}
                          min={wMin}
                          max={wMax}
                          step={0.5}
                          minorStep={units === 'metric' ? 1 : 0.5}
                          majorStep={units === 'metric' ? 5 : 2}
                          labels={units === 'metric' ? [55, 80, 105, 130, 155] : [22, 32, 42, 52, 62]}
                          unit={scale.unit}
                          format={(x) => formatNumber(x, 1)}
                          note={SHAPE.waistHow}
                          onChange={(x) => {
                            onLive();
                            patchProfile({ waist: { cm: scale.toMetric(x) } });
                          }}
                          onCommit={onCommit}
                        />
                      </Rail>
                      {waistMeasured && (codes.has('waistTrunkFatAtBound') || codes.has('trunkLimbZAtBound')) && rfm ? (
                        <InlineWarning severity="info">{quiet ? SHAPE.waistPinQuiet : SHAPE.waistPin(formatNumber(rfm.valuePct, 0))}</InlineWarning>
                      ) : null}
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
                    </>
                  ) : null}
                </div>
                <div className="lm-body-measure">
                  <MeasureSwitch row={SHAPE.knownRow} name={SHAPE.knownSwitch} checked={v.knownBodyFat.use} onChange={(on) => patchProfile({ knownBodyFat: { use: on } })} />
                  {v.knownBodyFat.use ? (
                    <div className="lm-body-form">
                      <Field label={SHAPE.knownValue}>
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
                  ) : null}
                </div>
              </Section>
            </div>
          ) : null}
        </div>
      </div>
    </GradientCard>
  );
}
