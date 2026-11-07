import { describe, expect, it } from 'vitest';
import { paths } from '../paths';

describe('paths', () => {
  it('links to the Install section of Settings', () => {
    expect(paths.settings('install')).toBe('/settings/install');
  });
});
