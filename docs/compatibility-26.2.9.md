# Plasticity 26.2.9 on Windows

This branch starts at upstream commit `3bb84e8`. The Blender Bridge supports reading a live scene on Windows with Plasticity 26.2.9. The native adapter declares support for Plasticity 26.1.3. Native editing on 26.2.9 is unverified.

## Verified on November 19, 2026

On Windows with Node.js 22.17.0, the server built successfully and passed type checking and all three upstream test suites after the example and drawing fixes. An MCP client started the compiled server over stdio and listed 144 tools in the full catalog and 26 in the compact catalog.

The signed Windows MSI from the official 26.2.9 release matched its published SHA-256. Installation succeeded and the application process reported version 26.2.9. After enabling Server in Plasticity, the bridge smoke test connected to `127.0.0.1:8980`, completed the handshake and listed scene objects. A separate stdio MCP client called `connect`, `status` and `list_scene` with `includeMesh: true`. The response included mesh counts and bounding box fields for a solid. Native editing, Undo and file round trips remain unverified.

Run the checks from `mcp-server`.

```powershell
npm ci --ignore-scripts
npm run build
npm run typecheck
npm test
```

## Live acceptance checks

- For scene reading, start Plasticity normally, enable the built-in Blender Bridge under Preferences → Server, and run `npm run smoke` from `mcp-server`. Check that the scene listing belongs to the intended document.
- For native editing, use a new disposable document. Check that a 10 × 20 × 30 mm box has those bounds, Undo removes it, and Redo restores it. Save to a new file and reopen it. Recheck the bounds and solid count.

The catalog and automated tests run without a CAD session. Record the application version, connection result, and observed geometry before claiming native editing support.
