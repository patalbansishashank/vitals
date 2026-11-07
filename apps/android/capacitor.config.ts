import type { CapacitorConfig } from '@capacitor/cli';

// The Vitals web build wrapped for Android (SUITE_SPEC §15.7). The origin stays https://localhost, which the server
// lists in allowedOrigins (§15.5); a custom hostname would need the server changed too.
const config: CapacitorConfig = {
  appId: 'desi.creative.vitals',
  appName: 'Vitals',
  webDir: '../../dist',
  server: { androidScheme: 'https' },
  // Capacitor logs every plugin call and its result in debug builds (shared and saved files among them). Never log them.
  loggingBehavior: 'none',
  // Ember is dark only: the WebView paints the #090909 backdrop before the first frame (not white), and the system bars
  // keep light icons on a light-mode device too.
  backgroundColor: '#090909',
  android: { allowMixedContent: false },
  // SystemBarInsets.kt keeps the page edge-to-edge even on WebViews < 140 and publishes our --lm-safe-* tokens.
  // Don't let Capacitor's default listener add native padding over the page's backdrop as well.
  plugins: { SystemBars: { style: 'DARK', insetsHandling: 'disable' } },
};

export default config;
