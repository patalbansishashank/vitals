/**
 * Vitals design-system primitives. Import from '@/components'.
 * Usage, token rules and layout patterns: src/components/README.md.
 * Living gallery: /dev/components.
 */

/* surfaces + layout */
export { Faceplate, FaceplateHeader, Rule, Section, Engraved, Stage, KeyValueList } from './Faceplate';
export type { FaceplateProps, FaceplateVariant, FaceplateHeaderProps, SectionProps, EngravedProps, KeyValueListProps } from './Faceplate';
export { Page, ScrollRail, VisuallyHidden } from './Layout';
export type { PageProps, ScrollRailProps } from './Layout';

/* icons */
export { Icon } from './icons/Icon';
export type { IconProps, IconComponent } from './icons/Icon';
export * as Glyphs from './icons/glyphs';

/* keys */
export { Key, KeyLink, IconKey, IconKeyLink } from './Key';
export type { KeyProps, KeyLinkProps, IconKeyProps, IconKeyLinkProps, KeyVariant, KeySize } from './Key';
export { RunKey } from './RunKey';
export type { RunKeyProps, RunKeyState } from './RunKey';

/* choice */
export { KeyBank, LinkBank } from './KeyBank';
export type { KeyBankProps, KeyBankOption, LinkBankProps, LinkBankItem, BankSize } from './KeyBank';
/** Alias: KeyBank is the segmented control. */
export { KeyBank as SegmentedControl } from './KeyBank';
export { Tabs, TabList, Tab, TabPanel } from './Tabs';
export type { TabsProps, TabListProps, TabProps, TabPanelProps } from './Tabs';
export { Switch } from './Switch';
export type { SwitchProps } from './Switch';
export { Checkbox, RadioGroup } from './Checkbox';
export type { CheckboxProps, RadioGroupProps, RadioOption } from './Checkbox';
export { Select } from './Select';
export type { SelectProps, SelectOption } from './Select';
export { Chip, Swatch, CATEGORY_LABEL, categoryColor } from './Chip';
export type { ChipProps, SwatchProps, MetricCategory } from './Chip';

/* fields + numeric */
export { Field, Label, HelpText, ErrorText, TextInput, useField } from './Field';
export type { FieldProps, FieldContextValue, TextInputProps } from './Field';
export { NumberField, Stepper, MeasureStepper } from './NumberField';
export type { NumberFieldProps, StepperProps, MeasureStepperProps, Quantity } from './NumberField';
export { ScaleSlider } from './ScaleSlider';
export type { ScaleSliderProps, ScaleZone, ScaleLabel, ZoneTone } from './ScaleSlider';
/** Aliases from the task brief. */
export { ScaleSlider as TuningSlider } from './ScaleSlider';
export { ScaleRange } from './ScaleRange';
export type { ScaleRangeProps } from './ScaleRange';
export { ScaleRange as RangeSlider } from './ScaleRange';

/* readouts + evidence */
export { Readout, ReadoutInline, ReadoutStrip, RangeBar, RollingNumber } from './Readout';
export type { ReadoutProps, ReadoutStripProps, ReadoutStripItem, RangeBarProps } from './Readout';
export { GradeBadge, EvidenceBadge, GRADE_TEXT } from './GradeBadge';
export type { GradeBadgeProps, EvidenceGrade } from './GradeBadge';

/* feedback */
export { Notice, Banner, SeverityBanner, InlineWarning, StatusMark } from './Notice';
export type { NoticeProps, InlineWarningProps, StatusMarkProps, Severity } from './Notice';
export { Toaster, toast, dismissToast } from './Toast';
export type { ToastOptions } from './Toast';
export { Tooltip } from './Tooltip';
export type { TooltipProps } from './Tooltip';
export { ProgressRule, Spinner, Meter } from './Progress';
export type { ProgressRuleProps, SpinnerProps, MeterProps } from './Progress';
export { EmptyStage, EmptyState, EmptyRasterArt, Skeleton } from './EmptyStage';
export type { EmptyStageProps, SkeletonProps } from './EmptyStage';

/* overlays */
export { Dialog } from './Dialog';
export type { DialogProps } from './Dialog';
export { Sheet } from './Sheet';
export type { SheetProps, SheetDetent } from './Sheet';
export { SidePanel, Drawer, ResponsivePanel } from './SidePanel';
export type { SidePanelProps, ResponsivePanelProps } from './SidePanel';
export { Popover, usePopover } from './Popover';
export type { PopoverProps } from './Popover';
export { Menu } from './Menu';
export type { MenuProps, MenuItem, MenuTriggerProps } from './Menu';

/* utilities for composites */
export { cx } from './lib/cx';
export { formatNumber, formatSigned, formatRange, formatBytes, parseNumber, MINUS, THIN_SPACE, GROUP_SPACE, EN_DASH, EM_DASH } from './lib/format';
export { KJ_PER_KCAL, toEnergyUnit, fromEnergyUnit, energyPerDayUnit, energyUnitSpoken, formatEnergy, energyInText } from './lib/energy';
export type { EnergyUnitChoice, EnergyFormatOptions } from './lib/energy';
export { clamp, snap, pct, scaleTicks, niceStep, decimalsOf } from './lib/scale';
export { useMediaQuery, useReducedMotion, useControllableState, usePressAndHold, MQ } from './lib/hooks';
export { useFocusTrap, useRestoreFocus, getTabbables } from './lib/focus';
export { Portal, PortalContainerContext, usePortalContainer } from './lib/portal';
export { computePosition, useAnchoredPosition } from './lib/position';
export type { Placement } from './lib/position';
