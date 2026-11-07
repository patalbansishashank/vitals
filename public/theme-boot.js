/*
 * Vitals theme boot — runs synchronously in <head> before first paint. External
 * file (CSP script-src 'self'; no inline scripts). Mirrors src/app/theme.ts,
 * which takes over after load.
 * Dark only (Ember): data-theme="dark" always; the stored theme setting and any
 * ?theme= query are ignored. Only the reduce-motion choice is read here.
 */
(function () {
  var d = document.documentElement;
  d.setAttribute('data-theme', 'dark');
  d.style.colorScheme = 'dark';
  try {
    var raw = localStorage.getItem('vitals.settings') || localStorage.getItem('lumen.settings'); // lumen.*: the app's former name, before the one-time key migration
    var s = raw ? JSON.parse(raw).state || {} : {};
    if (s.reduceMotion === 'on') d.setAttribute('data-motion', 'reduce');
    else if (s.reduceMotion === 'off') d.setAttribute('data-motion', 'full');
  } catch (e) {
    /* storage blocked: follow the OS motion preference */
  }
})();
