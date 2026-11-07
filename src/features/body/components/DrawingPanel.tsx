import { Switch } from '@/components';
import type { BodyProfileValues } from '@/state/profileStore';
import { DRAWING, SHAPE } from '../copy';
import type { FigureView } from '../figure';
import { DisclosureRow } from './Disclosure';
import { FrameSlider } from './FrameSlider';
import { ShareScale } from './ShapeScales';

/** Figure › Adjust the drawing: drawing-only controls (body-figure-v2.md §5.4). */
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

export interface DrawingPanelProps {
  drawing: DrawingControls;
  v: BodyProfileValues;
  view: FigureView;
  onLive: () => void;
  onCommit: () => void;
  /** Id of the disclosure (deep link `#drawing`); the panel is `${id}-panel`. */
  id?: string;
}

/**
 * The "Adjust the drawing" disclosure, in the Figure card right under the layer switches (it acts on the drawing, so
 * it sits with it): frame, chest and arms, and the two-layer switch. One line says none of it moves an estimate.
 */
export function DrawingPanel({ drawing, v, view, onLive, onCommit, id }: DrawingPanelProps) {
  const panelId = id ? `${id}-panel` : undefined;
  const share = (region: 'chest' | 'arms', label: string) => (
    <ShareScale
      v={v}
      view={view}
      region={region}
      label={label}
      drawingOnly
      size="sm"
      min={-1}
      max={1}
      step={0.01}
      minorStep={0.1}
      majorStep={0.5}
      labels={SHAPE.distLabels}
      unit={SHAPE.shareUnit}
      editable={false}
      onLive={onLive}
      onCommit={onCommit}
    />
  );
  return (
    <div id={id} className="lm-body-drawing">
      <DisclosureRow open={drawing.open} controls={panelId} onToggle={() => drawing.onOpenChange(!drawing.open)}>
        {DRAWING.title}
      </DisclosureRow>
      {drawing.open ? (
        <div id={panelId} className="lm-body-drawing__panel">
          <p className="lm-body-hint">{DRAWING.lead}</p>
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
          {share('chest', SHAPE.chest)}
          {share('arms', SHAPE.arms)}
          <Switch className="lm-body-measure__switch" labelStyle="sentence" label={DRAWING.layers} checked={drawing.twoLayer} onChange={drawing.onTwoLayerChange} />
        </div>
      ) : null}
    </div>
  );
}
