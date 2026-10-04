/** Environment variables between launch.ts (in the Electron main process) and the bridge child (node.ts). */

/** Set by launch.ts for the re-executed child: the bundle's `main()` runs only when it is `1`. */
export const BRIDGE_ENV = 'VITALS_MCP_BRIDGE';
/** JSON `{ path, args }`: the command that starts the app hidden when it is not running. */
export const APP_COMMAND_ENV = 'VITALS_APP_COMMAND';
/** Overrides the socket path (tests, unusual setups). */
export const SOCKET_ENV = 'VITALS_MCP_SOCKET';
