import { useMemo, useState, type Ref } from 'react';
import { Link, useLocation } from 'react-router';
import { PersonStanding } from 'lucide-react';
import { CardFoot, CardHead, GradientCard, Key, KeyBank, formatNumber, toast, type InfoSpec } from '@/components';
import { paths } from '@/app/paths';
import { stateToAvatarParams } from '@/engine/body';
import { type AvatarInteraction, type DragChannel, type DragRegion, type RegionDragDelta } from '@/features/body/avatar';
import { Figure3D, VisceralView, askDetailedFigure, saveDataPreferred } from '@/features/body/figure3d';
import { BODY_RANGES, useProfileStore, type BodyProfileValues, type ShapeKey } from '@/state/profileStore';
import type { UnitSystem } from '@/state/settingsStore';
import { FIGURE, INFO, SHAPE } from '../copy';
import type { FigureView } from '../figure';
import type { BodySummary } from '../model';
import { patchProfile } from '../commands';
import { useDraftView, useShapeDragging } from '../shapeDraft';
import { DrawingPanel, type DrawingControls } from './DrawingPanel';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Figure3D redraws (the whole anatomy is placed again, about half a second) whenever its `views` prop changes
 * identity; its default is a fresh array each render, so every re-render of this card, a save-status flicker included,
 * paid for a full redraw. A constant keeps it for real changes only.
 */
const FRONT_VIEW = ['front'] as const;

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
  /** Two-layer drawing: lean tissue inside a see-through fat layer (Adjust the drawing). Default true. */
  twoLayer?: boolean;
  /** The "Adjust the drawing" disclosure under the layer switches; omitted = not shown. */
  drawing?: DrawingControls;
  drawingId?: string;
  /**
   * Quiet mode: no digit from a reading. The figure keeps its picture but loses the visceral view (its words are all
   * areas and masses) and the stage switch with it.
   */
  quiet?: boolean;
}

/** The card's (i): the whole panel, plus the one thing the figure costs that the person may want to know. */
const FIGURE_INFO: InfoSpec = INFO.figure;

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
 * Figure card (r071; your-body.md §5, body-figure-v2.md §3-§6): a flush tide card whose glow sits behind the torso. The
 * 3D figure stands on the card (SVG whenever WebGL is unavailable), with its layer switches and "Adjust the drawing"
 * under it; a mono-caps switch at the stage's top left shows the visceral view (waist slice + side cutaway, drawn to
 * scale from the estimate) in the same box. The head holds the (i) and nothing else; "Load detailed figure" and
 * "Hide figure" are the foot's links. Nothing here touches the figure itself.
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
  drawing,
  drawingId,
  quiet = false,
}: FigureFaceProps) {
  const { hash } = useLocation();
  const [stage, setStage] = useState<StageView>(() => (hash === '#visceral' ? 'visceral' : 'figure'));
  const [saveData, setSaveData] = useState(saveDataPreferred);
  // the slice is drawn from the estimate (not the figure as set), at the drawing's frame
  const visceralParams = useMemo(
    () => stateToAvatarParams(summary.estimate, { frame: view.frame }),
    [summary.estimate, view.frame],
  );
  const waistLocked = v.waist.use && v.waist.cm !== null;
  // the figure draws the shape sliders as they are being moved (at most once a frame); everything else reads `view`
  const drawn = useDraftView(v, view);
  // while a slider's draft is on show: no tween, one draw per update (a tween is a draw per animation frame)
  const dragging = useShapeDragging();

  const head = <CardHead icon={PersonStanding} title={FIGURE.title} info={FIGURE_INFO} />;

  if (hidden) {
    return (
      <GradientCard
        id={id}
        className="lm-body-figure"
        data-hidden="true"
        domain="body"
        head={head}
        foot={
          <CardFoot
            link={hidden === 'gentle' ? { onClick: onShowGentle, label: FIGURE.gentleShow } : { to: paths.settings('appearance'), label: FIGURE.settingsLink }}
          />
        }
      >
        <p className="lm-body-note">{hidden === 'gentle' ? FIGURE.gentleHidden : `${FIGURE.hiddenTitle} ${FIGURE.hiddenBody}`}</p>
      </GradientCard>
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
  // quiet mode keeps the figure and drops the visceral view: every number on it is an area or a mass
  const visceral = stage === 'visceral' && !quiet;
  // the readout says once what narrows the range (no waist yet); with a waist, the note says what it sets
  const how = (
    <>
      {FIGURE.visceralHow} {waistLocked ? `${FIGURE.visceralWaistSets} ` : ''}
      <Link className="lm-link" to={paths.evidenceTopic('body-composition-estimation')}>
        {FIGURE.visceralHowLink}
      </Link>
    </>
  );

  const bank = quiet ? null : (
    <div className="lm-body-viewbank">
      <KeyBank<StageView> size="sm" fit label={FIGURE.viewLabel} value={stage} onChange={setStage} options={FIGURE.views} />
    </div>
  );
  const loadDetailed = !visceral && saveData;
  const foot =
    loadDetailed || (hidden === false && onHideGentle) ? (
      <CardFoot state={{ word: FIGURE.foot }}>
        {loadDetailed ? (
          <Key
            size="sm"
            variant="text"
            onClick={() => {
              askDetailedFigure();
              setSaveData(false);
            }}
          >
            {FIGURE.loadDetailed}
          </Key>
        ) : null}
        {hidden === false && onHideGentle ? (
          <Key size="sm" variant="text" onClick={onHideGentle}>
            {FIGURE.gentleHide}
          </Key>
        ) : null}
      </CardFoot>
    ) : (
      <CardFoot state={{ word: FIGURE.foot }} />
    );

  return (
    <GradientCard
      id={id}
      variant="flush"
      className="lm-body-figure"
      domain="body"
      // one low glow behind the torso, never behind the figure's own colours (RESEARCH §3.3: at most a quarter alpha)
      glow={{ pos: '50% 46%', size: '92% 64%', a: 0.25 }}
      head={head}
      foot={foot}
    >
      {bank}
      {visceral ? (
        <div ref={stageRef} id="body-visceral" className="lm-body-stage lm-body-stage--visceral">
          <VisceralView
            params={visceralParams}
            caption={FIGURE.visceralCaption}
            how={how}
            waistMeasured={waistLocked}
          />
        </div>
      ) : (
        <div ref={stageRef} className="lm-body-stage">
          <Figure3D
            params={drawn.params}
            frame={drawn.frame}
            views={FRONT_VIEW}
            tween={!dragging}
            layers={twoLayer ? 'two-layer' : 'envelope'}
            size="fill"
            units={units}
            heightText={heightText(summary.heightCm, units)}
            interactive={interactive}
            label={label}
            caption={false}
            forceSvg={saveData}
            onFallback={(reason) => {
              if (reason === 'slow device' && !slowToastShown) {
                slowToastShown = true;
                toast(FIGURE.slowSwitch);
              }
            }}
          />
        </div>
      )}
      {drawing && !visceral && !readOnly ? <DrawingPanel id={drawingId} drawing={drawing} v={v} view={view} onLive={onLive} onCommit={onCommit} /> : null}
    </GradientCard>
  );
}
