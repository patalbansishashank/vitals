/** YCBT family (R10M, TK5, SmartHealth rings) for `@vitals/rings`: the family driver and its pure protocol pieces. */
export { R10M_NAME, SMARTHEALTH_NAME, YCBT_SPOT_CEILING_MS, YCBT_STREAMS, createYcbtFamily, matchYcbt, variantFromName, ycbt, ycbtHandshake, ycbtVariantOf } from './family';
export {
  LIVE_STATUS_WAIT_MS, QUIET_MS, REPLY_MS, SILENCE_MAX_MS, STALL_MS, createYcbtProtocol, dayCursor, initialYcbtState, logicalFor, planYcbtSync,
  startupSequence, ycbtProtocol, type YcbtOptions, type YcbtState,
} from './protocol';
export { decodeFrame, decodeHistory, toRingEvents, type YcbtDecoded } from './decoder';
export {
  HISTORY_CATALOG, VARIANTS, YCBT_COMMAND, YCBT_SERVICE, YCBT_STREAM, assemble, crc16, frameLogical, ringTimeToMs, supportFunctions, topologyFailure,
  validateFrame, type Capability, type YcbtVariant,
} from './commands';
