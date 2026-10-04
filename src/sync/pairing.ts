/**
 * Pairing without accounts (R7 §7.1, SUITE_SPEC §2.6): a 256-bit random owner secret, shown as 24 BIP39 words and as
 * `vitals-sync:1?u=<urlencoded relay URL>&s=<base64url secret>[&n=<label>]` (QR + copyable string).
 *
 * Words use `@scure/bip39` with the English list, the same library and list Evolu's `ownerSecretToMnemonic` uses, so
 * the words a user writes down restore the same Evolu owner.
 */
import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { fromBase64Url, randomBytes, toBase64Url } from './crypto';
import type { PairingCode } from './types';

export const PAIRING_SCHEME = 'vitals-sync';
export const PAIRING_VERSION = '1';

export function newOwnerSecret(): Uint8Array<ArrayBuffer> {
  return randomBytes(32);
}

export function secretToWords(secret: Uint8Array): string[] {
  if (secret.length !== 32) throw new Error('The owner secret must be 32 bytes.');
  return entropyToMnemonic(secret, wordlist).split(' ');
}

/** Accepts any whitespace, case and stray punctuation; throws with a user-facing message. */
export function wordsToSecret(words: string | string[]): Uint8Array {
  const list = (Array.isArray(words) ? words.join(' ') : words)
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (list.length !== 24) throw new Error(`A pairing code has 24 words; this one has ${list.length}.`);
  // positions, not the words: a misspelt word gives away the secret word it stands for, and errors end up in logs
  const unknown = list.flatMap((w, i) => (wordlist.includes(w) ? [] : [i + 1]));
  if (unknown.length > 0)
    throw new Error(`${unknown.length === 1 ? 'Word' : 'Words'} ${unknown.join(', ')} ${unknown.length === 1 ? "isn't" : "aren't"} in the pairing word list. Check the spelling.`);
  const phrase = list.join(' ');
  if (!validateMnemonic(phrase, wordlist)) throw new Error("These 24 words don't add up to a pairing code. Check the order and spelling.");
  return mnemonicToEntropy(phrase, wordlist);
}

/** Normalises what a user types into a relay URL: https/wss kept, ws/http only for loopback, no query or fragment. */
export function normalizeRelayUrl(input: string): string {
  let text = input.trim();
  if (!/^[a-z]+:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("That isn't a web address. Enter something like https://myserver.tailnet.ts.net");
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (!['https:', 'wss:', 'http:', 'ws:'].includes(url.protocol)) throw new Error('The sync address must start with https:// or wss://.');
  if ((url.protocol === 'http:' || url.protocol === 'ws:') && !loopback)
    throw new Error('The sync address must use https:// (only this computer, localhost, may use http://).');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

/** WebSocket URL of the relay endpoint: `https://h/x` → `wss://h/x/sync` (an explicit `/sync` path is kept). */
export function relaySocketUrl(relayUrl: string): string {
  const url = new URL(normalizeRelayUrl(relayUrl));
  url.protocol = url.protocol === 'http:' || url.protocol === 'ws:' ? 'ws:' : 'wss:';
  if (!url.pathname.endsWith('/sync')) url.pathname = `${url.pathname.replace(/\/$/, '')}/sync`;
  return url.toString();
}

/** HTTP base of the endpoint (for `/blobs`, `/health`): `wss://h/sync` → `https://h`. */
export function relayHttpBase(relayUrl: string): string {
  const url = new URL(normalizeRelayUrl(relayUrl));
  url.protocol = url.protocol === 'ws:' || url.protocol === 'http:' ? 'http:' : 'https:';
  url.pathname = url.pathname.replace(/\/sync$/, '');
  return url.toString().replace(/\/$/, '');
}

export function relayHost(relayUrl: string): string {
  try {
    return new URL(normalizeRelayUrl(relayUrl)).host;
  } catch {
    return '';
  }
}

export function formatPairingUri(relayUrl: string, secret: Uint8Array, label?: string): string {
  const params = [`u=${encodeURIComponent(normalizeRelayUrl(relayUrl))}`, `s=${toBase64Url(secret)}`];
  if (label) params.push(`n=${encodeURIComponent(label)}`);
  return `${PAIRING_SCHEME}:${PAIRING_VERSION}?${params.join('&')}`;
}

export function pairingCodeOf(relayUrl: string, secret: Uint8Array, label?: string): PairingCode {
  return { uri: formatPairingUri(relayUrl, secret, label), words: secretToWords(secret), relayUrl: normalizeRelayUrl(relayUrl), ...(label ? { label } : {}) };
}

export interface ParsedPairing {
  relayUrl: string;
  secret: Uint8Array;
  label?: string;
}

/** Parses a scanned or pasted `vitals-sync:1?…`; throws a user-facing message on anything else. */
export function parsePairingUri(text: string): ParsedPairing {
  const trimmed = text.trim();
  const m = /^vitals-sync:(\d+)\?(.*)$/i.exec(trimmed);
  if (!m) throw new Error("This isn't a Vitals pairing code. It should start with vitals-sync:1?");
  if (m[1] !== PAIRING_VERSION) throw new Error('This pairing code is from a newer Vitals. Update the app on this device, then try again.');
  const params = new URLSearchParams(m[2]);
  const u = params.get('u');
  const s = params.get('s');
  if (!u || !s) throw new Error('This pairing code is incomplete. Show it again on the other device and copy all of it.');
  let secret: Uint8Array;
  try {
    secret = fromBase64Url(s);
  } catch {
    throw new Error('This pairing code is damaged. Show it again on the other device.');
  }
  if (secret.length !== 32) throw new Error('This pairing code is damaged. Show it again on the other device.');
  const label = params.get('n') ?? undefined;
  return { relayUrl: normalizeRelayUrl(u), secret, ...(label ? { label } : {}) };
}
