import type { ComponentType } from 'react';
import type { WidgetProps } from '../widgetTypes';
import { SleepWidget, SportRowsWidget, StepsWidget, WorkTimeWidget } from './activity';
import { PART_WIDGETS } from '../../chapters';
import { ModelsWidget, RoutesWidget, StreamsWidget } from './devices';
import { EatWidget, FastingDaysWidget, StaplesWidget, SupplementsWidget, TextWidget, WeekdaysWidget } from './food';
import { MeasuredWidget } from './measured';
import { ConditionsWidget, InjuriesWidget, KitWidget, PlaceDaysWidget, TrainTimeWidget, WeightsWidget, WillingnessWidget } from './training';

/** Composite answers by the `widget` id their question names (plus those the other packages' chapter files register). */
export const WIDGETS: Readonly<Record<string, ComponentType<WidgetProps<never>>>> = {
  workTime: WorkTimeWidget,
  steps: StepsWidget,
  sportRows: SportRowsWidget,
  sleep: SleepWidget,
  measured: MeasuredWidget,
  willingness: WillingnessWidget,
  placeDays: PlaceDaysWidget,
  kit: KitWidget,
  weights: WeightsWidget,
  trainTime: TrainTimeWidget,
  injuries: InjuriesWidget,
  conditions: ConditionsWidget,
  eat: EatWidget,
  weekdays: WeekdaysWidget,
  fastingDays: FastingDaysWidget,
  text: TextWidget,
  supplements: SupplementsWidget,
  staples: StaplesWidget,
  models: ModelsWidget,
  routes: RoutesWidget,
  streams: StreamsWidget,
  ...PART_WIDGETS,
} as unknown as Readonly<Record<string, ComponentType<WidgetProps<never>>>>;
