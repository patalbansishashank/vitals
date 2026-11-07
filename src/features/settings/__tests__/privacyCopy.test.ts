import { PRIVACY_TEXT, PRIVACY_TEXT_SYNCED } from '../copy';
import { SERVER_COPY } from '../server/copy';
import { SYNC_COPY } from '../sync/copy';

describe('privacy copy in Settings', () => {
  it('says where the data is without promising it never leaves this device', () => {
    expect(PRIVACY_TEXT).toMatch(/saved on this device/);
    expect(PRIVACY_TEXT_SYNCED).toMatch(/on your own server for paired devices/);
  });

  it('does not describe the paired server as unreadable or omit the chosen AI provider', () => {
    expect(PRIVACY_TEXT).toMatch(/AI provider you choose/);
    expect(PRIVACY_TEXT_SYNCED).toMatch(/own server.*readable copy.*AI provider you choose/);
    expect(SYNC_COPY.introHome).toMatch(/holds a readable copy/);
    expect(SERVER_COPY.holdsRead).toMatch(/can read all of this/);
  });
});
