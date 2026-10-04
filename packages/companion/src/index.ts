/** Vitals Companion: relay, provider proxy, pairing, Sign in with ChatGPT, agent hub and MCP, on one loopback port. */
export { startCompanion, VERSION, type Companion, type CompanionOptions, type CompanionRole } from './server.ts';
export { contentSecurityPolicy } from './static.ts';
export { DEFAULT_ORIGINS, main, parseCli } from './cli.ts';
export { UPSTREAMS, rewriteSiwcBody } from './proxy.ts';
export { SIWC_ENDPOINTS } from './siwc.ts';
export { defaultConfigDir } from './config.ts';
