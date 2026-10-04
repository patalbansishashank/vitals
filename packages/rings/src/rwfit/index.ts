/** RWfit (A00A, legacy 0x7E and JL 0xAB framings) family for `@vitals/rings`: the family driver and its pure protocol pieces. */
export { RWFIT_STREAMS, createRWfitFamily, matchRWfit, rwfit, rwfitHandshake } from './family';
export {
  BIO_STREAM, HISTORY_STALL_MS, JL_HISTORY, LEGACY_HISTORY, QUIET_MS, REPLY_MS, SILENCE_MAX_MS, createRWfitProtocol, decodeCursor, encodeCursor,
  frameRWfit, initialRWfitState, planRWfitSync, rwfitProtocol, type RWfitState,
} from './protocol';
export {
  JL_EPOCH_S, decodeJlHistory, decodeJlPayload, decodeLegacyPayload, decodeSyncManifest, jlSleepStage, jlTimeMs, legacyTimeMs, pendingStreams,
  type DecodeContext, type SyncManifest,
} from './decoder';
export {
  FRAMING_MARKERS, JL, JL_SERVICE, LEGACY, MANUFACTURER_PREFIXES, RWFIT_NOTIFY, RWFIT_SERVICE, RWFIT_WRITE, chooseFraming, crc16Arc, decodeJl,
  decodeLegacy, jlAck, jlFrame, legacyAck, legacyFrame, xorChecksum, type Framing,
} from './codec';
