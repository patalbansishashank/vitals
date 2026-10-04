/*
 * Ring drivers for every supported family; owned by L-RINGS.
 * The app (src/) and the server (packages/companion) import them as `@vitals/rings`.
 */

/** The ring families this package will hold a driver for. */
export const RING_FAMILIES = [] as const satisfies readonly string[];
