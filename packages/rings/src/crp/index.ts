/** CRP (`fdda`-profile) family for `@vitals/rings`: the family driver and its pure protocol pieces. */
export {
  CRP_ALL_ON_DEFAULT, CRP_STREAMS, R100_NAME, createCrpFamily, crp, crpAfterDiscovery, crpHandshake, crpMonitorCommands, crpResyncTime, matchCrp,
  type CrpMonitorSettings, type CrpOptions,
} from './family';
export {
  HISTORY_STALL_MS, QUIET_MS, REPLY_MS, SILENCE_MAX_MS, SLEEP_DEPTH_DAYS, TIMING_DEPTH_DAYS, createCrpProtocol, crpProtocol, decodeCursor, encodeCursor,
  planCrpSync, type CrpState,
} from './protocol';
export { EMPTY_ASSEMBLY, assemble, decodeCrp, toCrpRingEvents, type CrpAssembly, type CrpDecoded } from './decoder';
export { CMD, CRP_CMD_NOTIFY, CRP_SERVICE, CRP_STEPS_NOTIFY, CRP_WRITE, GROUP, crpFrame, frameCrp, setTime, setUserInfo, userInfoParams } from './commands';
