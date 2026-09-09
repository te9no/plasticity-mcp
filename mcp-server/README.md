> For the Windows / Plasticity 25.3.0 native adapter, see the [current setup guide](../README.ja.md). The bridge notes below are historical.

# plasticity-mcp

MCP server for [Plasticity](https://www.plasticity.xyz/) 26.1.x. Talks the existing built-in WebSocket protocol (the one used by the official Blender bridge), no fork required.

## Tools (Phase 1 MVP)

| Tool | Description |
|------|-------------|
| `connect` | Connect to `ws://localhost:8980` and handshake. |
| `status` | Report connection state, current filename/version, supported opcodes. |
| `list_scene` | List all (or only visible) objects. Optional `includeMesh` returns vertex/face counts and bbox. |
| `get_object` | Fetch a single object by id. |
| `subscribe_changes` / `unsubscribe_changes` | Live transaction event stream. |
| `drain_events` | Pull buffered scene events since last drain. |
| `refacet` | Request retessellation with quality params. Returns counts + bbox. |
| `push_mesh` | Upload a mesh into Plasticity (`PUT_SOME_1`). Supports n-gons via `sizes`. |

> Raw vertex/index/normal arrays are **never** returned to the LLM (they would blow up context). Only counts and bounding boxes. A future phase will add a binary export tool that writes geometry to disk.

## Setup

```bash
cd mcp-server
npm install
npm run build
```

## Quick verification (live Plasticity)

With Plasticity 26.1.x running and a document open:

```bash
npm run smoke
```

Connects, handshakes, lists scene, prints summary. Does not need an MCP client.

> Note: `push_mesh` requires the server to advertise `PUT_SOME_1` (opcode 31). Plasticity 26.1.2 stable does **not** advertise it; the tool will throw a clear error in that case. All other tools work.

## Run as MCP server

In Plasticity, make sure the WebSocket server is running (the Blender bridge add-on enables this implicitly; in 26.x it appears to be on by default — verify in Preferences if not).

```bash
node dist/index.js
# or for dev:
npm run dev
```

Override server with `PLASTICITY_SERVER=host:port` env var (default `localhost:8980`).

## Wiring into Claude Code

Add to your `claude_desktop_config.json` or project settings:

```json
{
  "mcpServers": {
    "plasticity": {
      "command": "node",
      "args": ["E:\\Projects\\PlasticityMCP\\mcp-server\\dist\\index.js"],
      "env": { "PLASTICITY_SERVER": "localhost:8980" }
    }
  }
}
```
