import { describe, expect, it } from 'vitest';
import { AI_ERROR_STATUS, mapUpstreamError } from './providers.ts';

describe('a refused key is named as such (Q8-04)', () => {
  it.each([401, 403, 410])('upstream %i on a key service says the key was refused, by name', (status) => {
    const r = mapUpstreamError('nim', status, '{}') as { status: number; body: { error: { code: string; message: string; detail: { status: number } } } };
    expect(r.status).toBe(AI_ERROR_STATUS.key_refused);
    expect(r.status).not.toBe(401); // 401 would make the website think the device was unpaired
    expect(r.body.error.code).toBe('key_refused');
    expect(r.body.error.message).toBe('NVIDIA NIM refused the key kept on your server. Replace it above.');
    expect(r.body.error.detail.status).toBe(status);
  });
  it('names OpenCode Zen too, and leaves ChatGPT and other failures alone', () => {
    expect((mapUpstreamError('opencode-zen', 401, '') as { body: { error: { message: string } } }).body.error.message).toMatch(/^OpenCode Zen refused the key/);
    expect(mapUpstreamError('siwc', 401, '')).toMatchObject({ body: { error: { code: 'upstream_error' } } });
    expect(mapUpstreamError('nim', 500, '')).toMatchObject({ body: { error: { code: 'upstream_error' } } });
  });
});
