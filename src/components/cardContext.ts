import { createContext, useContext } from 'react';

/**
 * What a GradientCard tells its CardHead (r071 AUDIT §5.2): the heading id the card is labelled by, the card's one
 * "open" target (a stretched title link, the (i) key sits above it), and a way for the head to register how to open its
 * (i) panel at the Table twin, so the card's `T` key can.
 */
export interface CardContextValue {
  titleId: string;
  href?: string;
  onOpen?: () => void;
  openLabel?: string;
  /** Called by a CardHead whose info has a twin; returns the unregister function. */
  registerInfo: (open: () => void) => () => void;
}

export const CardContext = createContext<CardContextValue | null>(null);
export const useCardContext = (): CardContextValue | null => useContext(CardContext);
