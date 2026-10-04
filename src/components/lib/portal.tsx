import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Where floating layers (tooltips, popovers, listboxes) mount. Defaults to
 * document.body; a modal Dialog/Sheet provides its own element so floating
 * layers stay inside the top layer instead of behind the inert page.
 */
export const PortalContainerContext = createContext<HTMLElement | null>(null);

export function usePortalContainer(): HTMLElement | null {
  const ctx = useContext(PortalContainerContext);
  if (ctx) return ctx;
  return typeof document === 'undefined' ? null : document.body;
}

export function Portal({ children }: { children: ReactNode }) {
  const container = usePortalContainer();
  if (!container) return null;
  return createPortal(children, container);
}
