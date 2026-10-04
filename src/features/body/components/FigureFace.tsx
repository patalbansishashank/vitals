import { useMemo, useState, type Ref } from 'react';
import { Link, useLocation } from 'react-router';
import { Faceplate, InlineWarning, Key, KeyBank, KeyLink, formatNumber, toast } from '@/components';
import { paths } from '@/app/paths';
import { stateToAvatarParams } from '@/engine/body';
import {
  DEFAULT_CAPTION,
  type AvatarInteraction,
  type DragChannel,
  type DragRegion,
  type RegionDragDelta,
} from '@/features/body/avatar';
import { Figure3D, VisceralView, askDetailedFigure, isSlowDevice, saveDataPreferred, webgl2Available } from '@/features/body/figure3d';
import { BODY_RANGES, useProfileStore, type BodyProfileValues, type ShapeKey } from '@/state/profileStore';
import type { UnitSystem } from '@/state/settingsStore';
import { FIGURE, SHAPE } from '../copy';
import type { FigureView } from '../figure';
import type { BodySummary } from '../model';
import { patchProfile } from '../commands';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function heightText(cm: number, units: UnitSystem): string {
  if (units === 'metric') return `${Math.round(cm)} cm`;
  const inches = Math.round(cm / 2.54);
  return `${Math.floor(inches / 12)} ft ${inches % 12} in`;
}

export type StageView = 'figure' | 'visceral';

export interface FigureFaceProps {
  v: BodyProfileValues;
  view: FigureView;
  summary: BodySummary;
  units: UnitSystem;
  /** Coarse pointer (touch): handles only while "adjust on figure" is on. */
  coarse: boolean;
  /** Committed accessible name (updated on release, not per frame). */
  label: string;
  /** Called on every live frame of a gesture / on its commit (screen-reader snapshot, mini figure). */
  onLive: () => void;
  onCommit: () => void;
  /** Settings › show figure off, or gentle mode: the compact stand-in. */
  hidden: false | 'settings' | 'gentle';
  onShowGentle?: () => void;
  onHideGentle?: () => void;
  stageRef?: Ref<HTMLDivElement>;
  id?: string;
  /** Display only (setup · basics). */
  readOnly?: boolean;
  /** Two-layer drawing: lean tissue inside a see-through fat layer (Shape › Adjust the drawing). Default true. */
  twoLayer?: boolean;
  /** Caption-row link: open Shape › Adjust the drawing (nothing about the drawing sits near Basics). */
  onAdjustDrawing?: () => void;
}

/** Nudge a shape slider from its current value (touched, or the figure's own when untouched). */
function nudge(key: ShapeKey, delta: number, shownValue: number) {
  const st = useProfileStore.getState();
  const range =
    key === 'bodyFatPct'
      ? BODY_RANGES.bodyFatPct
      : key.startsWith('muscle')
        ? BODY_RANGES.muscle
        : BODY_RANGES.distribution;
  patchProfile({ shape: { [key]: clamp((st.shape[key] ?? shownValue) + delta, range[0], range[1]) } });
}

let slowToastShown = false;

/**
 * Figure faceplate (your-body.md §5, body-figure-v2.md §3-§6): perforated stage with the 3D figure (SVG while it loads
 * and whenever WebGL is unavailable), front + side, handles; the stage bar switches to the visceral view (waist slice
 * + side cutaway, drawn to scale from the estimate) in the same box.
 */
export function FigureFace({
  v,
  view,
  summary,
  units,
  coarse,
  label,
  onLive,
  onCommit,
  hidden,
  onShowGentle,
  onHideGentle,
  stageRef,
  id,
  readOnly,
  twoLayer = true,
  onAdjustDrawing,
}: FigureFaceProps) {
  const { hash } = useLocation();
  const [stage, setStage] = useState<StageView>(() => (hash === '#visceral' ? 'visceral' : 'figure'));
  const [saveData, setSaveData] = useState(saveDataPreferred);
  const [fallback, setFallback] = useState(() => !webgl2Available() || isSlowDevice());
  // the slice is drawn from the estimate (not the figure as set), at the drawing's frame
  const visceralParams = useMemo(
    () => stateToAvatarParams(summary.estimate, { frame: view.frame }),
    [summary.estimate, view.frame],
  );
  const waistLocked = v.waist.use && v.waist.cm !== null;

  if (hidden) {
    return (
      <Faceplate id={id} className="lm-body-figure" data-hidden="true" title={FIGURE.title}>
        <p className="lm-body-note">
          <b>{FIGURE.hiddenTitle}</b> {hidden === 'gentle' ? FIGURE.gentleHidden : FIGURE.hiddenBody}
        </p>
        <div className="lm-body-row">
          {hidden === 'gentle' ? (
            <Key size="sm" onClick={onShowGentle}>
              {FIGURE.gentleShow}
            </Key>
          ) : (
            <KeyLink size="sm" variant="quiet" to={paths.settings('appearance')}>
              {FIGURE.settingsLink}
            </KeyLink>
          )}
        </div>
      </Faceplate>
    );
  }

  const s = view.shown;
  const shares = view.shares;
  const onRegionDrag = (region: DragRegion, d: RegionDragDelta) => {
    if (d.phase === 'end') onCommit();
    else onLive();
    if (d.amount === 0) return;
    if (region === 'body') return nudge('bodyFatPct', d.amount, s.bodyFatPct);
    if (d.channel === 'muscle')
      return nudge(
        region === 'hips' ? 'muscleLower' : 'muscleUpper',
        d.amount,
        region === 'hips' ? s.muscleLower : s.muscleUpper,
      );
    if (region === 'waist') return nudge('belly', d.amount, s.belly);
    if (region === 'hips') return nudge('hips', d.amount, s.hips);
    return nudge(region, d.amount, s[region]);
  };
  const describe = (region: DragRegion, channel: DragChannel): string => {
    if (region === 'body') return SHAPE.dragBody(formatNumber(view.bodyFatPct, 1));
    if (channel === 'muscle')
      return region === 'hips'
        ? SHAPE.dragMuscle('lower', view.muscle.words(s.muscleLower))
        : SHAPE.dragMuscle('upper', view.muscle.words(s.muscleUpper));
    if (region === 'waist') return SHAPE.dragBelly(Math.round(shares.belly));
    if (region === 'hips') return SHAPE.dragHips(Math.round(shares.hips));
    return region === 'chest'
      ? SHAPE.dragChest(Math.round(shares.chest))
      : SHAPE.dragArms(Math.round(shares.arms));
  };
  const lock = waistLocked ? SHAPE.bellyLocked : undefined;
  const interaction: AvatarInteraction = {
    onRegionDrag,
    describe,
    handles: coarse ? 'always' : 'hover',
    disabled: { waist: lock, hips: lock },
    values: {
      waist: {
        value: s.belly,
        min: -1,
        max: 1,
        text: `belly and waist: ${Math.round(shares.belly)} percent of your fat`,
      },
      hips: {
        value: s.hips,
        min: -1,
        max: 1,
        text: `hips and thighs: ${Math.round(shares.hips)} percent of your fat`,
      },
      chest: {
        value: s.chest,
        min: -1,
        max: 1,
        text: `chest: ${Math.round(shares.chest)} percent of your fat, drawing only`,
      },
      arms: {
        value: s.arms,
        min: -1,
        max: 1,
        text: `arms: ${Math.round(shares.arms)} percent of your fat, drawing only`,
      },
    },
  };
  const interactive = readOnly ? undefined : interaction;
  const visceral = stage === 'visceral';
  const caption = (
    <>
      {DEFAULT_CAPTION}
      {onAdjustDrawing && !readOnly ? (
        <>
          {' '}
          <button type="button" className="lm-link lm-body-linkbtn" onClick={onAdjustDrawing}>
            {FIGURE.adjustDrawing}
          </button>
        </>
      ) : null}
    </>
  );
  const how = (
    <>
      {FIGURE.visceralHow} {waistLocked ? FIGURE.visceralWaistSets : FIGURE.visceralAddWaist}{' '}
      <Link className="lm-link" to={paths.evidenceTopic('body-composition-estimation')}>
        {FIGURE.visceralHowLink}
      </Link>
    </>
  );

  return (
    <Faceplate
      id={id}
      variant="flush"
      className="lm-body-figure"
      title={FIGURE.title}
      caption={visceral ? undefined : saveData || fallback ? 'Drag the figure to change its shape, or use the sliders.' : 'Drag the figure to turn it. Use the sliders to change its shape.'}
      actions={
        <div className="lm-body-row">
          <KeyBank<StageView>
            size="sm"
            label={FIGURE.viewLabel}
            value={stage}
            onChange={setStage}
            options={FIGURE.views}
          />
          {!visceral && saveData ? (
            <Key
              size="sm"
              variant="quiet"
              onClick={() => {
                askDetailedFigure();
                setSaveData(false);
              }}
            >
              {FIGURE.loadDetailed}
            </Key>
          ) : null}
          {hidden === false && onHideGentle ? (
            <Key size="sm" variant="quiet" onClick={onHideGentle}>
              {FIGURE.gentleHide}
            </Key>
          ) : null}
        </div>
      }
    >
      {visceral ? (
        <div ref={stageRef} id="body-visceral" className="lm-body-stage lm-body-stage--visceral">
          <VisceralView params={visceralParams} caption={FIGURE.visceralCaption} how={how} />
        </div>
      ) : (
        <div ref={stageRef} className="lm-body-stage">
          <Figure3D
            params={view.params}
            frame={view.frame}
            layers={twoLayer ? 'two-layer' : 'envelope'}
            size="fill"
            units={units}
            heightText={heightText(summary.heightCm, units)}
            interactive={interactive}
            label={label}
            caption={caption}
            forceSvg={saveData}
            onFallback={(reason) => {
              setFallback(true);
              if (reason === 'slow device' && !slowToastShown) {
                slowToastShown = true;
                toast(FIGURE.slowSwitch);
              }
            }}
          />
        </div>
      )}
      {view.diverges && !visceral ? (
        <div className="lm-body-figure__notes">
          <InlineWarning severity="info">
            {FIGURE.diverges(formatNumber(view.bodyFatPct, 1), formatNumber(summary.bodyFatPct, 1))}
          </InlineWarning>
        </div>
      ) : null}
    </Faceplate>
  );
}
