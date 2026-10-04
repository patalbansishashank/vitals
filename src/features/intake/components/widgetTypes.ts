import { createContext } from 'react';
import type { CustomQuestion, FlowContext } from '../flow';

/** Contract of a composite turn ("custom" question): it renders inside the turn's fieldset and commits one value. */
export interface WidgetProps<V = unknown> {
  q: CustomQuestion;
  /** The current answer (when a receipt is reopened), else undefined. */
  value: V | undefined;
  /** All answers of the chapter (a widget may depend on earlier ones, e.g. weights on the kit). */
  values: Readonly<Record<string, unknown>>;
  ctx: FlowContext;
  onCommit: (value: V) => void;
  /** id of the turn's legend (for aria-labelledby on inner groups). */
  labelledBy: string;
}

/**
 * Inside a QuestionCard whose question has `ownFooter`: the element in the card's footer (after Back · Ask me later)
 * where the widget portals its keys. Null elsewhere: the widget renders its own footer.
 */
export const CardFootSlot = createContext<HTMLElement | null>(null);
