import { describe, expect, it } from 'vitest';
import { formatPairingUri, newOwnerSecret, normalizeRelayUrl, parsePairingUri, relayHttpBase, relaySocketUrl, secretToWords, wordsToSecret } from './pairing';

describe('pairing codes', () => {
  it('round-trips the secret through the 24 words and through the URI', () => {
    const secret = newOwnerSecret();
    const words = secretToWords(secret);
    expect(words).toHaveLength(24);
    expect(Array.from(wordsToSecret(`  ${words.join('  ').toUpperCase()}. `))).toEqual(Array.from(secret));
    const parsed = parsePairingUri(formatPairingUri('https://relay.example.ts.net/', secret, 'Laptop & phone'));
    expect(Array.from(parsed.secret)).toEqual(Array.from(secret));
    expect(parsed).toMatchObject({ relayUrl: 'https://relay.example.ts.net', label: 'Laptop & phone' });
  });

  it('names misspelt words by position and never repeats them (they give the secret word away)', () => {
    const words = secretToWords(newOwnerSecret());
    const typo = `${words[2]!.slice(0, -1)}q`;
    words[2] = typo;
    let message = '';
    try {
      wordsToSecret(words);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('Word 3');
    expect(message).not.toContain(typo);
  });

  it('rejects damaged codes with plain messages', () => {
    expect(() => wordsToSecret('abandon ability')).toThrow(/24 words; this one has 2/);
    expect(() => parsePairingUri('vitals-sync:2?u=x&s=y')).toThrow(/newer Vitals/);
    expect(() => parsePairingUri('vitals-sync:1?u=https%3A%2F%2Fh&s=AAAA')).toThrow(/damaged/);
    expect(() => parsePairingUri('hello')).toThrow(/isn't a Vitals pairing code/);
  });

  it('allows plain http only for this computer and maps the socket and HTTP addresses', () => {
    expect(() => normalizeRelayUrl('http://relay.example.com')).toThrow(/https/);
    expect(normalizeRelayUrl('http://localhost:4000/')).toBe('http://localhost:4000');
    expect(normalizeRelayUrl('http://[::1]:4000')).toBe('http://[::1]:4000');
    expect(normalizeRelayUrl('relay.example.com?x=1#y')).toBe('https://relay.example.com');
    expect(relaySocketUrl('https://h.example/base')).toBe('wss://h.example/base/sync');
    expect(relayHttpBase('wss://h.example/sync')).toBe('https://h.example');
  });
});
