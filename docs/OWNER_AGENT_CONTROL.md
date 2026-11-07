# Owner-delegated app control

The desktop app supports a full command session for an agent explicitly authorized by the local OS owner:

```sh
Vitals.AppImage --ozone-platform=headless --mcp --client codex --full-control
```

On macOS or Windows, omit the Linux `--ozone-platform=headless` argument. The bridge can start Vitals hidden and needs no mouse or keyboard automation.

This is a local administrative delegation, not an agent's normal permission. The private same-user socket is its trust boundary. A remote server token does not acquire this authority, and a tool argument such as `fullControl: true` cannot enable it. The flag is consumed by the native MCP launch, not by MCP tool inputs. The session always targets this computer's app and saved data; it does not forward to a paired server with a narrower scope. Closing the connection ends the delegation without changing any client's stored approval preferences.

In addition to the usual tools, the session exposes:

- `app_commands`: discover every registered command, including UI-only operations. Filter by `query`, request `schemas: true`, and page with `offset` and `limit`. The result identifies unimplemented commands.
- `app_execute`: run a discovered `commandId` with its `input` object. Consequential edits can apply directly. A destructive operation additionally requires `confirm: true` and authorization for that specific action.

Calls use the ordinary command bus with the local user recorded as acting on behalf of the named agent. Schema validation, clinical/precondition gates, idempotency, immutable history, confirmation and undo remain active. This enables profile edits, pending-change application, goals, practical limits, fasting opt-ins using confirmed facts, simulator and planner jobs, navigation and settings through one headless interface. Commands that require unavailable hardware or an unimplemented port still report that limitation.

Use `planner_inputs` to verify the exact profile, goals, equipment and limits received by the optimizer. After copying an option into the Simulator, `scenario_get` with `includeSchedule: true` reads its full saved meals, workouts, day overrides and fasting events; `sim_run` then simulates that actual prescription. This avoids inferring a regimen from its label or relying on a screen click to apply it.

Owner-delegated calls return the complete command result. The interactive Coach's context cap still applies to ordinary agent sessions; it does not trim prescriptions or day arrays returned to an explicitly delegated local file/headless client.

The mode does not grant a factual medical history, make a forecast clinically validated, or authorize invented measurements or acknowledgements. Keep default sessions restricted unless the person has requested and authorized full app control.
