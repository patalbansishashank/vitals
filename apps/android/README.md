# Vitals for Android

The Capacitor app: the Vitals web app wrapped as an installable APK (`desi.creative.vitals`, minSdk 26, target 36), with
files shared into the app and exports saved out through the share sheet. Everything is entered by hand in the web app;
there is no Bluetooth, background service or boot receiver. The generated `android/` project's build
folders, `dist/` and the signing keys are git-ignored.

## Build

Needs JDK 21 (Capacitor 8) and the Android SDK (platform 36, build-tools 35 or 36).

```sh
export JAVA_HOME=/path/to/jdk-21 ANDROID_HOME=/path/to/android-sdk
pnpm --filter @vitals/android run build:debug   # web build, cap sync, app/build/outputs/apk/debug/app-debug.apk
pnpm --filter @vitals/android run build:apk     # same, release: app/build/outputs/apk/release/app-release-unsigned.apk
```

`versionName` is the root `package.json` version and `versionCode` is `major*10000 + minor*100 + patch`, so every
release installs over the one before.

**Signing.** The release workflow signs the unsigned APK afterwards (`scripts/release/sign-apk.sh`, secrets
`ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`). For a signed local
build, point Gradle at a keystore file through the environment; nothing about the key is written in the project:

```sh
ANDROID_KEYSTORE_FILE=/path/to/release.jks ANDROID_KEYSTORE_PASSWORD=… ANDROID_KEY_ALIAS=… ANDROID_KEY_PASSWORD=… \
  ./gradlew assembleRelease   # in apps/android/android; gives app-release.apk
```

Without `ANDROID_KEYSTORE_FILE` the release build stays unsigned.

## How it is put together

- **The web app** is the root Vite build (`dist/`), copied in by `cap sync`. Its origin is `https://localhost`, which
  the Vitals Server must list in `allowedOrigins`.
- **`VitalsShell`** (`android/app/src/main/java/desi/creative/vitals/`): files shared into
  the app ("Share to Vitals", opening a file with Vitals: copied into the cache and announced to the web layer) and
  files saved out of it (an export's download link opens the system share sheet, `src/platform/androidDownloads.ts`).
  App Links (`https://vitals.creative.desi/settings…`) open the app's own Settings page. The web side is
  `src/platform/androidShell.ts`.
- **Updates from the home server** (`vitals-research/ota/CONTRACT.md`): the web side (`src/platform/androidUpdates.ts`)
  asks the paired server for `GET /v1/apps/vitals/latest` on launch and every 24 h and hands new entries, with the
  device token, to the `VitalsUpdates` plugin. A web bundle is downloaded, checked (sha256, then ed25519 over the sha256
  hex with the key in `OtaVerify.kt`), unpacked to `files/ota/web/<version>/` and served from the next cold start:
  `MainActivity` gives that folder to the bridge builder (`ServerPath` BASE_PATH) before the bridge exists, so the
  first load is already the right bundle. The new bundle must call `ready()` (after the first render, `androidBoot.ts`)
  within 10 s, or `OtaBoot` rolls back to the last good bundle and never tries that version again (`OtaLogic.kt`). The
  APK's own bundle is the floor; a newer APK starts from it unless a downloaded bundle was built later. An APK update is
  downloaded to `files/ota/apk/`, checked, and installed only when the owner taps Install in Settings › About: through
  an install session (`OtaInstall.kt`, the way an app store installs), so the system's own confirmation shows. Opening
  the APK with `ACTION_VIEW` instead makes the system installer mark the install as a local file, and on Android 13+
  that keeps an app's accessibility service (the short-video counter) grey until the owner allows it in App info (⋮ ›
  Allow restricted settings; `RestrictedSettings.kt` has what is known about it, and the short-video limit card and the
  Ring permission rows show a 3-step guide with a key to Vitals' App info).
- **Release a web bundle:** `pnpm --dir ../.. run build && node ../../scripts/release/web-bundle.mjs --use-dist` writes
  `dist/bundle.json` and `release/web/vitals-web-<version>.zip` plus `.sig` (key:
  `~/.config/vitals-release/web-bundle-ed25519.key`, never in the repo). Build the APK from that same `dist/`
  (`cap sync android && ./gradlew assembleRelease`, not `build:apk`, which rebuilds `dist/` without `bundle.json`).
- **Home-screen widgets** (`android/app/src/main/java/desi/creative/vitals/widgets`, r071): one provider per card, so the
  picker is the library and pinning needs no configuration screen: Today (three rings), Heart rate (the class that was
  `RingWidgetProvider`), Energy, Sleep, Steps, Weight (off until Settings › Widgets turns it on), Log or record, Log. A
  provider's class name never changes (a renamed or removed one deletes the widgets placed from it). Plain `RemoteViews`,
  no Glance, no WorkManager, no network: each instance is drawn at its own size (`WidgetSize`: square, wide or strip, from
  the launcher's own options) from the snapshot the web app last published (`VitalsWidgetsPlugin.publish`, built by
  `src/features/widgets`, which reads the stores and models, never a card, and only for widgets that are placed) and the
  clock (`CardFormat`, pure and unit tested for every card, size and mode). Real `TextView`s carry every word and figure in
  Geist (static instances of the web's faces in `design/res/font`), the card's face, one glow in its domain hue and a
  hairline are a generated drawable, and the picture (ring of ticks, line, bars, hypnogram) is one bitmap from the pure
  painters in `widgets/viz` (no text in it), held under a quarter of the system's bitmap budget (`BitmapBudget`). The
  card's corner is the launcher's own radius from Android 12 and the foundation's below it. Quiet mode is words and
  parts of the day with no digit anywhere (enforced when the web sends it and again when it is read); weight is in a snapshot only
  with the `widgetWeight` device setting on. Taps are target ids from `design/widgets.json`, never paths.
  **The design is generated:** `pnpm android:design` (`scripts/android-design.mjs`) turns `design/tokens.css` and
  `design/widgets.json` into `design/res` (colours, the cards, the keys, the icons) and `design/kotlin`; a test fails when
  they are stale. **Previews:** `WidgetPreviewsTest` draws every widget from the sample numbers, `python3 -I
  scripts/android-previews.py` turns the renders into `res/drawable-nodpi/vw_preview_*.webp` (run both when a look changes).
  **Review without a phone:** `WidgetRenderTest` draws each widget in each state and size to `app/build/outputs/widgets/*.png`
  (the launcher itself, its font handling and its crop were not seen; nothing here runs on a device).
- **Brand:** the adaptive and legacy launcher icons, notification icon and the animated splash come from `brand/res/`
  (generated by `design/brand/vitals-mark.py`, `pnpm brand`; do not edit by hand).
- **No service worker.** `sw.js` is left out of the APK (the APK already holds every file, and a worker in the
  WebView kept serving the previous build after an update); `src/platform/androidBoot.ts` unregisters one left by an
  older build.
- **No bridge logging.** `loggingBehavior: 'none'`: Capacitor's debug logging would print every plugin call and
  result, shared and saved files included.
