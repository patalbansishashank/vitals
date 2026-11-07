/**
 * Vitals design-system primitives (Ember). Import from '@/components'.
 * Usage, token rules and layout patterns: src/components/README.md.
 * Living gallery: /dev/components.
 */

/* surfaces + layout */
export { Faceplate, FaceplateHeader, Rule, Section, Engraved, Stage, KeyValueList } from './Faceplate';
export type { FaceplateProps, FaceplateVariant, FaceplateHeaderProps, SectionProps, EngravedProps, KeyValueListProps } from './Faceplate';
export { Columns, Page, ScrollRail, Stack, VisuallyHidden } from './Layout';
export type { ColumnsProps, PageProps, ScrollRailProps, StackProps } from './Layout';

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
export { Chip, Swatch, CATEGORY_LABEL, categoryColor, domainColor } from './Chip';
export type { ChipProps, SwatchProps, MetricCategory } from './Chip';
export { StatusCapsule } from './StatusCapsule';
export type { StatusCapsuleProps, StatusTone } from './StatusCapsule';

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
export type { SheetProps, SheetDetent, PanelConfirmProps } from './Sheet';
export { SidePanel, Drawer, ResponsivePanel } from './SidePanel';
export type { SidePanelProps, ResponsivePanelProps } from './SidePanel';
export { Popover, usePopover } from './Popover';
export type { PopoverProps } from './Popover';
export { Menu } from './Menu';
export type { MenuProps, MenuItem, MenuDivider, MenuSection, MenuEntry, MenuTriggerProps } from './Menu';

/* shared viz modules (SPEC A.3.2): tick strip, dotted fill, stat tiles, overnight trace, state strip, share bar, level bar,
   arc ruler, day disc, monitor sheet, freshness marks */
export * from './viz';

/* r071 foundation 0B: domains, mono meta and the reveal helpers (cards, pictures, grid and library follow below). The
   motion hooks themselves are in `@/app/motion`; `useReveal`, `useMotionEnabled`, `useCountUp` and `canAnimate` here are
   thin wrappers over them, kept for the pictures and the page code that call them. */
export { HUE_DOMAINS, DOMAINS, DOMAIN_LABEL, domainToken, isDomain, isHueDomain } from './domain';
export type { Domain, HueDomain, DomainName, DomainRole } from './domain';
export { MonoMeta } from './MonoMeta';
export type { MonoMetaProps } from './MonoMeta';
export { OverflowText } from './OverflowText';
export type { OverflowTextProps } from './OverflowText';
export { useReveal, useCountUp, useMotionEnabled } from './lib/reveal';
export { canAnimate } from './lib/motion';

/* r071 foundation 0B: the card, its parts, the layout and the library. The pictures come through './viz' above. */
export { GradientCard } from './GradientCard';
export type { GradientCardProps, CardGlow } from './GradientCard';
export { CardHead, InfoKey } from './CardHead';
export type { CardHeadProps, InfoKeyProps } from './CardHead';
export { InfoPanel, sourceText } from './InfoPanel';
export type { InfoPanelProps, InfoSpec, InfoEvidence, InfoSourceKind } from './InfoPanel';
export { CardFoot, StateWord } from './CardFoot';
export type { CardFootProps, StateWordProps, StateTone } from './CardFoot';
export { HeroNumber } from './HeroNumber';
export type { HeroNumberProps, HeroPart, HeroSize } from './HeroNumber';
export { StatusDot } from './StatusDot';
export type { StatusDotProps, StatusDotTone } from './StatusDot';
export { Rail, RailRow, RailNode, segmentArcs } from './Rail';
export type { RailProps, RailRowProps, RailNodeProps, RailStatus, SegmentArc } from './Rail';
export { CardGrid, packRows, BASE_SPAN } from './CardGrid';
export type { CardGridProps, CardGridItem, CardSize, GridCols, PackedItem } from './CardGrid';
export { CardLibrary, DEFAULT_LIBRARY_COPY, sizeOf, defaultSelection, sameSelection, groupItems, filterItems, SEARCH_ABOVE } from './CardLibrary';
export type { CardLibraryProps, LibraryItem, LibrarySelection, LibraryCopy } from './CardLibrary';

/* utilities for composites */
export { cx } from './lib/cx';
export { formatNumber, formatSigned, formatRange, formatBytes, parseNumber, MINUS, THIN_SPACE, GROUP_SPACE, EN_DASH, EM_DASH } from './lib/format';
export { KJ_PER_KCAL, toEnergyUnit, fromEnergyUnit, energyPerDayUnit, energyUnitSpoken, formatEnergy, formatEnergyRange, energyInText } from './lib/energy';
export type { EnergyUnitChoice, EnergyFormatOptions } from './lib/energy';
export { clamp, snap, pct, scaleTicks, niceStep, decimalsOf } from './lib/scale';
export { useMediaQuery, useReducedMotion, useControllableState, usePressAndHold, MQ } from './lib/hooks';
export { useFocusTrap, useRestoreFocus, getTabbables } from './lib/focus';
export { Portal, PortalContainerContext, usePortalContainer } from './lib/portal';
export { computePosition, useAnchoredPosition } from './lib/position';
export type { Placement } from './lib/position';
