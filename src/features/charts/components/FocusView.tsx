/* ==========================================================================
   <FocusView> (CHART_SPEC §5.4): one lane at 280 px (220 mobile) with a full
   y-axis, band, start/end/min/max labels, threshold labels, event labels and
   the one-line mechanism; every other lane collapses to a 26 px strip so the
   crosshair still reads it. Hourly detail: `hourly` forces hourly samples at
   any zoom (M4-decimated to the pixel width). `Esc` exits.
   ========================================================================== */
import { memo, useEffect } from 'react';
import type { ChartController } from '../core/controller';
import type { Resolution } from '../types';
import { LaneStack, type LaneStackProps } from './LaneStack';

export interface FocusViewProps extends Omit<LaneStackProps, 'focusId' | 'onFocusChange'> {
  focusId: string;
  onFocusChange?: (id: string | null) => void;
  /** `auto` follows the zoom (CHART_SPEC §5.2); `hourly` shows hourly detail at any zoom. */
  resolution?: Resolution | 'auto';
  controller: ChartController;
}

export const FocusView = memo(function FocusView({ resolution = 'auto', controller, ...rest }: FocusViewProps) {
  useEffect(() => {
    const prev = controller.resolutionMode;
    controller.setResolutionMode(resolution);
    return () => controller.setResolutionMode(prev);
  }, [controller, resolution]);
  return <LaneStack {...rest} controller={controller} readout={rest.readout} />;
});
