/**
 * The passcode J-Style 2301 firmware V0789 requires in its 0x3C authentication frame before it answers any history
 * request. A protocol constant, like a firmware passcode: the driver sends it to every V0789 ring it talks to, so a person
 * never sees, types or chooses it, and no screen, setting or message mentions it.
 *
 * It is kept as bytes (what goes on the wire), and this file is the only place in the repository it may appear
 * (`__tests__/passcode.test.ts` scans every tracked file). Never log it, show it, put it in a fixture or a capture, or
 * send it anywhere but the ring's own 0x3C write; diagnostics use `redactOutbound`, which drops it.
 */
const V0789_PASSCODE = Uint8Array.of(0x30, 0x36, 0x32, 0x4a, 0x30, 0x55, 0x54, 0x38);

/** The V0789 passcode as the 1–14 character string `authenticationRequest` takes. */
export function builtInPasscode(): string {
  return String.fromCharCode(...V0789_PASSCODE);
}
