import type { CapacitorConfig } from '@capacitor/cli';

// The Vitals web build wrapped for Android (SUITE_SPEC §15.7). The origin stays https://localhost, which the server
// lists in allowedOrigins (§15.5); a custom hostname would need the server changed too.
const config: CapacitorConfig = {
  appId: 'desi.creative.vitals',
  appName: 'Vitals',
  webDir: '../../dist',
  server: { androidScheme: 'https' },
  // Capacitor logs every plugin call and its result in debug builds; for Bluetooth that would put ring frames (the
  // V0789 auth write among them) and the ring's advertised name in the console and logcat. Never log them.
  loggingBehavior: 'none',
  android: { allowMixedContent: false },
  plugins: {
    BluetoothLe: {
      displayStrings: {
        scanning: 'Looking for your ring…',
        cancel: 'Cancel',
        availableDevices: 'Rings nearby',
        noDeviceFound: 'No ring found',
      },
    },
  },
};

export default config;
