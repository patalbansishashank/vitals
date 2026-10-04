/**
 * Contract of the catalogue picker (`<CataloguePicker>`, design/COMPONENTS.md §14.5): one component for equipment,
 * cuisines, staples and pantry, used in the intake question cards, Settings › Kitchen and the Food tab's pantry page.
 * The picker is controlled: it never writes documents itself; its owner turns `PickerValue` into `kitchen.set` /
 * `pantry.add` (see `pickerToKitchenInput` / `pickerToPantryInput` in `./pickerValue.ts`).
 */
import type { KitchenKind, ParsedItem } from '@/catalogues/kitchen';

/** One selected item. Catalogue ids (`eq.*`, `cu.*`, `st.*`, `pa.*`) or `custom:<slug>` for the person's own words. */
export interface PickerEntry {
  id: string;
  /** The person's words (custom items; also kept for matched free text so the chip can say "matched: …"). */
  label?: string;
  /** Per-item note, ≤ 80 characters ("small OTG, 28 L"); equipment and pantry quantity text. */
  note?: string;
  /** Equipment only: owned but not used ("· not used"). */
  ownNotUsed?: boolean;
  /** Came from the region defaults and not touched yet (dashed outline until Done or a touch). */
  assumed?: boolean;
  source?: 'picker' | 'coach' | 'paste';
  /**
   * The catalogue's name of the item, added to the intake answer at Done so the answered list reads "matta rice", not
   * the id. Display only: never written to the kitchen or pantry documents (`label` stays the person's own words).
   */
  name?: string;
}

/** Selected entries in order (cuisines: rank = position + 1). */
export type PickerValue = readonly PickerEntry[];

export interface CataloguePickerProps {
  kind: KitchenKind;
  value: PickerValue;
  onChange: (next: PickerValue) => void;
  /**
   * Regions whose defaults apply (first = main). The note above the groups names the first one and offers
   * "Use another region" (calls `onRegionsChange`) and "Clear defaults" (removes the still-assumed entries).
   */
  regions?: readonly string[];
  onRegionsChange?: (regions: string[]) => void;
  /** Cuisines: show the rank numeral on chips (tap order). Default: true for cuisines. */
  ranked?: boolean;
  /** Per-item notes (✎). Default: true for equipment and pantry. */
  notes?: boolean;
  /** Paste-a-list disclosure. Default: true for pantry and staples. */
  paste?: boolean;
  /**
   * Resolves free text ("I also have…", paste-a-list) to catalogue ids. Default: the catalogue matcher over this kind
   * (pantry also matches staples). A Coach-backed resolver may be passed; unmatched words are always kept.
   */
  resolve?: (text: string) => Promise<ParsedItem[]>;
  /** Optional framing (pantry): no "required" marks, "Optional." note above the picker. */
  optional?: boolean;
  /** Accessible name of the whole picker, e.g. "Cooking equipment". */
  label: string;
  className?: string;
}
