/** (0.6.7) the client's wording reads the server's actual detect/2 reason codes. */
import { describe, expect, it } from 'vitest';
import { detectionReasonText } from '../detectionLabels';

describe('detect/2 reason codes', () => {
  it('the keyboard-treadmill pattern, a stationary fix, outdoor GPS and missing coverage read as intended', () => {
    expect(detectionReasonText('walk_possibly_treadmill', ['steady_cadence', 'ring_low', 'location_unknown'])).toMatch(/ring recorded very few/);
    expect(detectionReasonText('treadmill_walk', ['steady_cadence', 'stationary_location'])).not.toMatch(/\d/);
    expect(detectionReasonText('walk', ['gps_moving'])).toMatch(/location moved/);
    expect(detectionReasonText('walk', ['steady_cadence', 'phone_unknown'])).toMatch(/missing|adjust/i);
  });
});
