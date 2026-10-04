import { describe, expect, it } from 'vitest';
import { ProviderError } from '@/ai';
import { serverErrorText } from '../ServerProviders';

describe('serverErrorText', () => {
  it('says the key was refused, naming the service, instead of "try again in a moment"', () => {
    const e = new ProviderError({ kind: 'server', status: 502, code: 'key_refused', message: 'NVIDIA NIM refused the key kept on your server. Replace it above.', retryable: false });
    expect(serverErrorText(e)).toBe('NVIDIA NIM refused the key kept on your server. Replace it above.');
  });
  it('falls back to a generic refused-key sentence', () => {
    const e = new ProviderError({ kind: 'server', status: 502, code: 'key_refused', message: 'HTTP 502', retryable: false });
    expect(serverErrorText(e)).toMatch(/refused the key/);
  });
});
