/** The app version from package.json, injected at build time by vite.config.ts (`define`). Shown in Settings › About and written into exports. */
declare const __APP_VERSION__: string | undefined;
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';
/** Model release label (research dossiers 01–19). Replaced by the engine's own version when it exports one. */
export const MODEL_VERSION = '2026.09';
