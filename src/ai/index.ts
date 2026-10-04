/** Public surface of the AI layer (tier H). UI code imports from here; adapters and wire formats stay internal. */
export * from './providers';
export { CapabilityCache, degradeFor, isBasicTier, probeCapabilities, shouldReprobe } from './providers/probe';
export * from './tools';
export { createBrowserKeyVault, KeyVault, setSharedKeyVault, sharedKeyVault, type KeyMode, type KeyStatus } from './keys';
export { IdbKv, MemoryKv, type KvStore } from './storage/kv';
