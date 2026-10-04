/** Agent surfaces (SUITE_SPEC §1.4, §1.8, §14.4): WebMCP in this tab. Agents on other computers use the server's MCP address. */
export * from './manifest';
export {
  findTool,
  getAgentDispatcher,
  guardedCall,
  notifyAgentManifestChanged,
  setAgentDispatcher,
  subscribeAgentDispatcher,
  useAgentDispatcher,
  type AgentActor,
  type AgentCallOptions,
  type AgentDispatcher,
} from './dispatcher';
export {
  getModelContext,
  isWebMcpEnabled,
  isWebMcpSupported,
  registerWebMcpTools,
  setWebMcpEnabled,
  toWebMcpResult,
  useWebMcpEnabled,
  useWebMcpRegistration,
  useWebMcpSupported,
  webMcpFlag,
  type ModelContextLike,
  type WebMcpToolDescriptor,
  type WebMcpToolResult,
} from './webmcp';
export {
  getAgentActivity,
  isAgentActive,
  onStopAgents,
  recordAgentActivity,
  stopAgents,
  subscribeAgentActivity,
  useAgentActive,
  useAgentActivity,
  type AgentActivity,
} from './activity';
export { createDeviceFlag, useDeviceFlag, type DeviceFlag } from './deviceFlag';
export { AgentSurfaces } from './AgentSurfaces';
