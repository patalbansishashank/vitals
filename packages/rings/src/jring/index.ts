/** Jring ("56ff", SMART_RING) family for `@vitals/rings`: the family driver and its pure protocol pieces. */
export { JRING_DEFAULT_APP_ID, JRING_PRIORITY, JRING_STREAMS, createJringFamily, jring, jringHandshake, matchJring, type JringOptions } from './family';
export {
  HISTORY_STALL_MS, QUIET_MS, REPLY_MS, FORGET_MS, createJringProtocol, decodeCursor, encodeCursor, frameJring, jringProtocol, planJringSync, type JringState,
} from './protocol';
export { decodeJringPacket, ringDateMs, sleepStageFromByte, toJringRingEvents, type JringDecoded } from './decoder';
export {
  CMD, BIND, JRING_KEEPALIVE_MS, JRING_SERVICE, JRING_WRITE, JRING_NOTIFY, PACKET_SIZE, jringCapabilities, jringForget, jringKeepalive, jringResyncTime,
} from './commands';
