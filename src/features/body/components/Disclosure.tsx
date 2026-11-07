import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Icon } from '@/components';

/**
 * A card's disclosure row (r068 G-8): the full content width, its label on the content edge, the chevron at the
 * trailing edge (turned up when open), one hairline above it. The same look open and closed; it is a button, so it
 * reads as one.
 */
export function DisclosureRow({
  open,
  onToggle,
  controls,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  controls?: string;
  children: ReactNode;
}) {
  return (
    <button type="button" className="lm-body-disc" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      <span className="lm-body-disc__label">{children}</span>
      <Icon icon={ChevronDown} size={18} className="lm-body-disc__chev" />
    </button>
  );
}
