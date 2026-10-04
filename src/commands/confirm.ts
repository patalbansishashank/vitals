/**
 * Confirmation tokens for destructive commands (SUITE_SPEC §1.4): HMAC-SHA256 under a per-session in-memory key,
 * bound to the command id and the input digest, valid 60 s, single use.
 *
 * `mintConfirmation` is for confirm dialogs only (UI components). ESLint forbids importing it from `src/ai/**`,
 * `src/commands/adapters/**` and `packages/companion/**`, so no agent can confirm for the person.
 */
import { ulid } from '@/store';
import { canonicalJson, hmacSha256, sha256Hex, toHex, utf8 } from './schema';
import type { CommandId, ConfirmationToken } from './types';

export const CONFIRMATION_TTL_MS = 60_000;

let key: Uint8Array | null = null;
function sessionKey(): Uint8Array {
  if (!key) {
    key = new Uint8Array(32);
    const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
    if (c?.getRandomValues) c.getRandomValues(key);
    else for (let i = 0; i < 32; i++) key[i] = Math.floor(Math.random() * 256);
  }
  return key;
}

const used = new Set<string>();

export function inputDigest(input: unknown): string {
  return sha256Hex(canonicalJson(input ?? {}));
}

function macOf(t: Omit<ConfirmationToken, 'mac'>): string {
  return toHex(hmacSha256(sessionKey(), utf8(`${t.commandId}|${t.inputDigest}|${t.nonce}|${t.issuedAt}`)));
}

/** Mint a token after the person confirmed `commandId` with exactly this `input` in a dialog. */
export function mintConfirmation(commandId: CommandId, input: unknown, now: Date = new Date()): ConfirmationToken {
  const base = { commandId, inputDigest: inputDigest(input), nonce: ulid(now.getTime()), issuedAt: now.toISOString() };
  return { ...base, mac: macOf(base) };
}

export type ConfirmationCheck = 'ok' | 'missing' | 'forged' | 'mismatch' | 'expired' | 'used';

/** Verify and consume a token (single use). */
export function consumeConfirmation(token: ConfirmationToken | undefined, commandId: CommandId, input: unknown, now: number = Date.now()): ConfirmationCheck {
  if (!token) return 'missing';
  if (macOf({ commandId: token.commandId, inputDigest: token.inputDigest, nonce: token.nonce, issuedAt: token.issuedAt }) !== token.mac) return 'forged';
  if (token.commandId !== commandId || token.inputDigest !== inputDigest(input)) return 'mismatch';
  const age = now - Date.parse(token.issuedAt);
  if (!(age >= -5_000 && age <= CONFIRMATION_TTL_MS)) return 'expired';
  if (used.has(token.nonce)) return 'used';
  used.add(token.nonce);
  return 'ok';
}
