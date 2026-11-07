import type { CSSProperties, ReactNode } from 'react';
import { ScaleSlider, type ScaleSliderProps } from '@/components';
import type { BodyProfileValues, ShapeKey } from '@/state/profileStore';
import type { FigureView } from '../figure';
import { commitShape, dragShape, useDraftView, useLiveShape } from '../shapeDraft';

export type ShapeScaleProps = Omit<ScaleSliderProps, 'onChange' | 'onCommit' | 'note'> & {
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
export function ShapeScale({ shapeKey, value, note, onLive, onCommit, ...rest }: ShapeScaleProps) {
  const live = useLiveShape(shapeKey);
  const shown = live ?? value;
  return (
    <Rail min={rest.min} max={rest.max} value={shown}>
      <ScaleSlider
        {...rest}
        value={shown}
        note={typeof note === 'function' ? note(live) : note}
        onChange={(x) => {
          if (live === undefined) onLive();
          dragShape(shapeKey, x);
        }}
        onCommit={(x, via) => commitShape(shapeKey, x, via, onCommit)}
      />
    </Rail>
  );
}

/**
 * The rail around a scale (r071): it tells the CSS how far the scale is lit (`--lm-lit-from` to `--lm-lit-to`, in percent;
 * from the scale's start, or from the middle of one that runs both ways: Less ... Typical ... More) and the CSS draws the
 * lit part, the thumb's ring and its glow in the card's hue. The slider underneath is untouched.
 */
export function Rail({ min, max, value, children }: { min: number; max: number; value: number; children: ReactNode }) {
  const at = (x: number) => Math.min(100, Math.max(0, ((x - min) / (max - min || 1)) * 100));
  const pos = at(value);
  const origin = min < 0 && max > 0 ? at(0) : 0;
  return (
    <div className="lm-body-rail" style={{ '--lm-lit-from': `${Math.min(pos, origin)}%`, '--lm-lit-to': `${Math.max(pos, origin)}%` } as CSSProperties}>
      {children}
    </div>
  );
}

/** A plain scale slider on the rail: for the editors' scales that are not shape sliders (Habits). */
export function RailSlider(props: ScaleSliderProps) {
  return (
    <Rail min={props.min} max={props.max} value={props.value}>
      <ScaleSlider {...props} />
    </Rail>
  );
}

export type ShareRegion = 'belly' | 'hips' | 'chest' | 'arms';

/** A share-of-fat slider: its readout follows the drawing as it is being moved (the share needs the engine). */
export function ShareScale({
  v,
  view,
  region,
  label,
  drawingOnly,
  ...rest
}: Omit<ShapeScaleProps, 'format' | 'valueText' | 'value' | 'shapeKey'> & {
  v: BodyProfileValues;
  view: FigureView;
  region: ShareRegion;
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
