# Windows / Plasticity 26.1.3 (experimental)

Verified against the locally installed Windows 26.1.3 application on 2026-09-22. This is an opt-in adaptation, not a claim that every 26.x release or distribution is supported.

## Connection

The standard `--remote-debugging-port=9223` endpoint was unavailable on the tested build. Launching with `--inspect=127.0.0.1:9230` exposes Electron's main-process Inspector. The adapter discovers application BrowserWindows there and relays CDP through the selected window's `webContents.debugger.sendCommand`. It still requires an exact `native_windows` target ID. It does not edit installed application files.

From PowerShell 7:

```powershell
./setup.ps1 -Experimental26
# Save your work and close any running Plasticity normally before this launcher.
./start-plasticity.ps1 -Experimental26
# Alternatively pass -Executable 'C:\full\path\to\Plasticity.exe'.
```

The launcher checks both the per-user and Program Files installation locations. It verifies that an existing main Inspector listener belongs to Plasticity and refuses an unverified occupied endpoint. It never kills existing application processes. `-Hidden` is optional for automated diagnostics; use a visible, disposable test window for modeling validation. Finish diagnostics by quitting Plasticity normally; closing a console is not a substitute for exiting the application.

The generated MCP config sets:

```json
{
  "PLASTICITY_MAIN_CDP_URL": "http://127.0.0.1:9230",
  "PLASTICITY_EXPERIMENTAL_26": "1"
}
```

`PLASTICITY_STATE_DIR` may point to a writable local directory for recovery journals. No remote Inspector endpoints or discovery redirects are accepted. The exact package name/version is checked before attaching to the selected renderer or installing its document guard.

## Runtime adaptations

- Geometry is enumerated through `db.geo.geometryModel` on 26.1.3; 25.3.0 keeps its existing `db.items` route.
- Names/materials and visibility use node keys on 26.1.3. Materials are enumerated through `materials.list()`.
- Face extrusion uses `ExtrudeFactory`; sketch vectors use the `Vector3` binding.
- Screenshots use `webContents.capturePage()` over the main-process transport. The original renderer screenshot route stays unchanged.
- Local doctor and stdio smoke clients explicitly forward `PLASTICITY_*` settings to the MCP child process.

## Verification

Build, protocol checks and all 16 automated tests pass. Tests cover the original CDP route, main-process forwarding, explicit window selection, multi-client attachment ownership, external debugger detach, destroyed-window cleanup, Inspector socket loss/reconnect, renderer exceptions, optional argument serialization, screenshots, version-validation ordering, and local endpoint restrictions.

Live tests used newly created disposable windows and verified:

| Test | Result |
| --- | --- |
| `doctor` with an explicit target | 37 tools, window discovery, connection and scene read |
| `smoke:native` | Box/cylinder/sphere, movement, Undo/Redo, selection, boolean difference, OBJ, PNG capture |
| `smoke:exchange` | Rotation, scale, exact STEP export/import, solid type and bounds, overwrite refusal |
| `smoke:document` | Rename, Undo/Redo, native save copy, unchanged active filename, overwrite refusal |
| `smoke:detail` | Topology, face extrusion, fillet and stale edge rejection |
| `smoke:constraints` | Constrained polyline creation/regeneration, stable ID and Undo/Redo |
| `smoke:parts` | Material assignment/listing, visibility, groups, deletion, backup-assisted native document reopening, camera fitting and screenshot |
| `smoke:batch` | Batch primitives, one-step Undo, validation and boolean union/intersection |
| `smoke:recovery` | Timeout, blocked repeat edit, reconnect, fingerprint validation and explicit recovery |
| `smoke:sketch` | Polyline, circle, spline, IGES export/import with bounds verification, overwrite refusal and Undo/Redo |
| `smoke:crash` | Killed MCP worker, durable operation journal, blocked repeat edit and restart recovery |
| `smoke:inspector` | External debugger detach, reconnection, stale-session isolation and final attachment cleanup |

The complete live suite was rerun after the transport lifecycle fixes. Normal application quit was also checked: no Plasticity processes or listening Inspector endpoint remained. IGES checks used Python 3.14.5 with the pinned `scripts/requirements-cad.txt` dependency in a project-local virtual environment.

To reproduce a live check, set `PLASTICITY_MAIN_CDP_URL`, `PLASTICITY_EXPERIMENTAL_26`, and an explicit `PLASTICITY_TARGET` returned by `npm run doctor`, then run the desired script from `mcp-server`. Use disposable documents: these scripts create and modify geometry. `smoke:sketch` also requires the optional IGES environment; `smoke:inspector` deliberately detaches the selected window's renderer debugger. Finish by exiting Plasticity normally.

## Boundaries

- The existing 25.3.0 code path has automated regression coverage, but was not rerun against a live 25.3.0 installation here.
- A hard MCP process kill or a lost main Inspector connection may leave an attachment session token in Electron's memory. Reconnecting the same client reclaims its token; later clients can also reuse the owned debugger. Stale tokens are cleared when the renderer debugger detaches, its window is destroyed, or Plasticity exits normally. A normal restart may be needed to release an attachment left by an abandoned client. The persistent operation journal must still be inspected and acknowledged; a timeout never authorizes replaying an edit.
- Simultaneous manual GUI edits are not covered by the adapter's write guard. Advanced script execution retains full application access.
- The integration depends on internal runtime bindings. Keep the exact version opt-in and revalidate after application updates.

Technical references: [Electron main-process debugging](https://www.electronjs.org/docs/latest/tutorial/debugging-main-process), [webContents debugger](https://www.electronjs.org/docs/latest/api/debugger).
