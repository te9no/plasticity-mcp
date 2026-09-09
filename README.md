# Plasticity MCP 1.0

A Windows MCP server for **Plasticity 25.3.0**, with 37 tools for native CAD operations, scene inspection, materials, document handling, and exchange formats.

[日本語ガイド](README.ja.md) · [Supported scope and verification](docs/RELEASE-1.0.md) · [Runtime architecture](docs/native-runtime.md)

## Quick start

Requires Windows, Node.js 22 or later, and an installed copy of Plasticity 25.3.0.

```powershell
./setup.ps1
./start-plasticity.ps1
```

Setup installs locked dependencies, builds and tests the server, and writes an ignored `mcp-client.json` containing configuration for your MCP client. Use `./setup.ps1 -WithIges` to install the optional Python/Open CASCADE converter.

The server uses stdio. Connect to the local Plasticity debugging endpoint (default `http://127.0.0.1:9223`), call `native_windows`, then explicitly select a window with `native_connect`. Lengths and coordinates are **meters**, angles are degrees.

## Capabilities

- Native solids, batch creation, transforms, booleans, face extrusion and edge fillets.
- Curves, circles and a limited 2D constraint solver.
- Names, groups, materials, visibility, selection and Undo/Redo.
- STEP and IGES exchange, OBJ export, native document copies and backup-assisted opening.
- Camera controls, screenshots, durable recovery records and shared renderer write guards.

This is an unofficial adapter against internal runtime APIs, pinned to the tested app version. It does not modify or distribute Plasticity application files. Advanced script execution is not sandboxed. GUI edits performed concurrently are outside the write guard.

## Verification and example

```powershell
cd mcp-server
npm ci --ignore-scripts
npm run build
npm test
```

Unit tests do not require Plasticity. Live smoke tests require a separate disposable app window; see the release notes before running them.

The [Tokyo Station example](examples/tokyo-station.md) created 1,082 CAD parts using named MCP tools only. Its native save/reopen check preserved part names, materials and groups. Model outputs, local logs, uploaded references and personal configuration are excluded from this repository.

## Upstream and license status

This repository is a GitHub fork of [ozymandi/PlasticityMCP](https://github.com/ozymandi/PlasticityMCP), preserving its history. This fork adds the Windows 25.3.0 native adapter. The [original README](docs/upstream-README.md) describes the earlier bridge investigation.

Upstream has not specified a license. This fork does not assign a replacement license or claim permission for unrestricted redistribution. npm publication remains disabled. Plasticity and third-party dependencies retain their respective terms.
