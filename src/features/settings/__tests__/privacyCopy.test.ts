import { WELCOME, LIMITS_PAGE } from '@/features/onboarding/copy';
import { SETUP } from '@/features/body/copy';
import { DATA_LINE, PRIVACY_TEXT, PRIVACY_TEXT_SYNCED } from '../copy';
import { SYNC_COPY } from '../sync/copy';

describe('privacy copy across first run and Settings', () => {
  it('explains optional server sync without promising all data stays on one device', () => {
    expect(WELCOME.body).toMatch(/starts on this device.*connect your own server/);
    expect(SETUP.intro.basics).toMatch(/starts on this device.*sync/);
    expect(LIMITS_PAGE.data.join(' ')).toMatch(/connect your own server.*devices you pair/);
    expect(DATA_LINE.local).toMatch(/connect your own server/i);
  });

  it('does not describe the paired server as unreadable or omit the chosen AI provider', () => {
    expect(PRIVACY_TEXT).toMatch(/AI provider you choose/);
    expect(PRIVACY_TEXT_SYNCED).toMatch(/own server.*AI provider you choose/);
    expect(DATA_LINE.synced).toMatch(/server may hold a readable copy/);
    expect(SYNC_COPY.intro).toMatch(/server may hold a readable copy/);
  });
});
