/** Shell-safe copy and review contract; experimental tracking is never a verified prescription. */
export const EXPERIMENTAL_TRACKING_NOTE = 'Experimental tracking: this exact program and its individual forecasts have not been clinically validated. Research exists on its components; results and muscle retention are uncertain.';

export interface ExperimentalTrackingReview {
  scope: 'experimentalTracking';
  startable: boolean;
  warnings: string[];
  blockers: string[];
}
