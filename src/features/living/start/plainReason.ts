/**
 * A refused lifecycle command (C5: start, adopt, resume, re-plan revalidate current safety) says why in plain words; its
 * leading rule codes ("HC-E3/E1: …") stay in the command record and never reach the screen.
 */
export function plainReason(message: string): string {
  const s = message.replace(/^(?:[A-Z][A-Z0-9]*-[A-Z0-9-]+(?:\/[A-Z0-9-]+)*[,;]?\s*)+:\s*/, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
