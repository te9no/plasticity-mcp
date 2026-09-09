# Native runtime adapter

Verified locally on Windows / Plasticity 25.3.0, 2026-09-09.

The existing bridge at port 8980 was disabled. An existing Electron CDP endpoint at loopback port 9223 allowed a separate native adapter without modifying, restarting, or replacing the app.

## Reference discovery

1. Discover `/json/list`, filter Plasticity `app_window` renderer targets.
2. Require a caller-selected exact target ID. Titles are not unique.
3. Evaluate the existing `command-log.handleCommandStarted` callback.
4. Follow its `[[Scopes]]` using `Runtime.getProperties`. The `CommandLog` closure contains `editor`; the surrounding application closure contains native Factory classes.
5. Keep remote references in the CDP connection. Pass specific references to `Runtime.callFunctionOn`; no global injection or app patching is needed.
6. Release the object group and connection on disconnect. Never store remote object IDs across sessions.

This is an experimental integration against observable internal objects, not a documented Plasticity extension contract. Source for the application was not copied into this repository. Earlier upstream notes in `architecture.md` describe historical investigation, not the current implementation.

## Operations

Construct a native command from `editor.commands`, override its `execute` for the requested parameterized operation, and execute with `editor.exec`. Factories receive the Editor as constructor argument and are registered using `.resource(command)`. Calling `factory.commit()` within the command uses the app's transaction and history lifecycle. Exceptions captured within execution are propagated even if the native executor handles them internally. Commands are serialized within each MCP server process and refuse to start while the editor is busy. Separate MCP clients share a renderer-side write guard; concurrent GUI edits remain outside that guard.

Geometry records come from `editor.db.items`. Stable object IDs use `db.lookupStableId(view.versionId)`. Topology IDs from `view.high.edges.versionIds` / `faces.versionIds` are version-specific, and are resolved only against the specified current body.

Only records with stable IDs are included in the public scene. Sketching generates additional wire fragments and SketchIsland objects with no stable IDs; calling `getName` on those fails. Actual user curves are stable `Wire` objects. `CurveFactory` uses `CurveType.Polyline` (0) or `CurveType.NURBS` (1), with interpolation enabled by default. Circle creation sets both its plane orientation and a radial point in that plane.

Constraint solving is local damped least squares on 2D point positions, with fixed, coincident, horizontal, vertical and distance residuals in meters. The result is a reusable recipe, not persistent native constraints. Unsatisfied systems never reach the native command. Regeneration uses a CurveFactory whose `originalItems` contains the explicitly specified Wire, preserving its stable ID through the normal transaction; native Undo restores its previous geometry.

Native units are meters: the observed display conversion maps one millimeter to 0.001 model units. Bounds are derived from tessellated visual geometry and are approximate. OBJ exports use the indexed face mesh and its world matrix, not exact B-Rep data.

Boolean operation values were read from the running app's token descriptions: 15901 intersection, 15902 subtraction, 15903 union. Union, subtraction and intersection have been verified end-to-end.

Rotation sets `RotateItemAndEmptyFactory.rotation` with a normalized world-axis quaternion; mutating the `axis` proxy alone did not update the rotation reliably. Scaling uses `ProjectingScaleItemAndEmptyFactory.scale`. Both use explicit world pivots. A nonzero pivot and unequal XYZ scale factors were verified against expected bounds.

STEP export uses `ExportCadFactory.items` and `filePath`, preserving CAD B-Rep. It writes to a unique staging directory beside the output, validates the STEP envelope, then copies with exclusive creation to refuse overwrite. STEP import uses `ExchangeImportFactory.filePath` within the module's `ImportCommand` lifecycle, adding geometry to the document. The import command binding is obtained from the closure because it is not in `editor.commands`.

Direct IGES export failed on this local app. The public IGES tools therefore explicitly use an independent OCCT converter (pinned Python dependency) and native STEP exchange. They do not modify app licensing or call restricted IGES internals. Conversion subprocesses use argument arrays without a shell, stay local, have a 45-second timeout, and publish only through exclusive file creation. Geometry is transferred; assembly metadata and colors are not guaranteed.

## Verification evidence

- Separate newly created Plasticity test window; original two windows retained.
- MCP stdio initialization and tool listing.
- Native sphere, box and cylinder creation; box bounds and cylinder height checked.
- Translation bounds, Undo and Redo checked.
- Rotation by 90 degrees about a nonzero pivot, non-unit axis normalization, and nonuniform scaling checked numerically.
- STEP solid export/import preserves transformed bounds; existing file remains unchanged on duplicate export; import Undo/Redo checked.
- Selection and cylinder subtraction from box.
- OBJ creation, transformed coordinates and refusal to overwrite checked.
- Screenshot returned through MCP.
- Face extrusion increases object count; fillet increases face count; stale edges are rejected.
- Closed polyline bounds, oblique circle bounds, spline creation, sketch Undo/Redo.
- IGES box round trip, aggregate bounds, overwrite rejection and import Undo/Redo.
- MCP constraint recipe creation on XZ plane, dimension change from 30 to 50 mm with stable ID preservation, Undo/Redo, and unchanged scene/history for conflicting constraints.
- Solver unit tests include skewed rectangles, coincident/free points, degenerate initial distance, conflicting dimensions and invalid references.
- Mock CDP tests: explicit target choice, reference discovery, remote exceptions, timeout, disconnect rejection, reconnect and loopback restriction.

Full real-app tests produce artifacts in the ignored `artifacts/` directory. The ordinary test command does not touch the running app.

## Recovery and document operations

See [RELEASE-1.0.md](RELEASE-1.0.md) for the current durable journal, renderer lock, document guard, material/group APIs, native reopen and camera verification. Earlier process-local recovery has been replaced.
