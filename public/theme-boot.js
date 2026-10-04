/*
 * Vitals theme boot — runs synchronously in <head> before first paint so the
 * chassis never flashes the wrong theme. External file (CSP script-src 'self';
 * no inline scripts). Mirrors src/app/theme.ts, which takes over after load.
 */
(function () {
  var d = document.documentElement;
  try {
    var q = new URLSearchParams(location.search).get('theme');
    var raw = localStorage.getItem('vitals.settings') || localStorage.getItem('lumen.settings'); // lumen.*: the app's former name, before the one-time key migration
    var s = raw ? JSON.parse(raw).state || {} : {};
    var t = q === 'light' || q === 'dark' ? q : s.theme;
    if (t === 'light' || t === 'dark') d.setAttribute('data-theme', t);
    if (s.reduceMotion === 'on') d.setAttribute('data-motion', 'reduce');
    else if (s.reduceMotion === 'off') d.setAttribute('data-motion', 'full');
  } catch (e) {
    /* storage blocked: follow the OS */
  }
})();
