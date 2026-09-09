# PlasticityMCP

MCP server for [Plasticity](https://www.plasticity.xyz/) (v2026.1+) — lets an LLM generate and modify 3D geometry inside a running Plasticity instance.

**Status:** Phase 0 — recon. Not yet usable.

See [task.md](task.md) for scope and phases.

## How it works (planned)

```
LLM ──stdio──> MCP server ──WebSocket/JSON-RPC──> Plasticity (forked + bridge patch)
```

Plasticity already runs a built-in WebSocket server (used by the official [plasticity-blender-addon](https://github.com/nkallen/plasticity-blender-addon)) for scene sync and mesh push. We reuse that protocol directly — no fork needed for read/subscribe/push-mesh tools. For invoking CAD commands (extrude, fillet, boolean) we fork Plasticity and add a single `EXEC_COMMAND_1` opcode that calls into `CommandExecutor`.

## Roadmap

- [ ] **Phase 0** — Recon existing WS protocol (Blender addon source)
- [ ] **Phase 1** — MCP MVP: read/subscribe/mesh-push (no fork)
- [ ] **Phase 2** — Recon `CommandExecutor` in Plasticity source
- [ ] **Phase 3** — Fork + minimal `EXEC_COMMAND_1` opcode
- [ ] **Phase 4** — MCP CAD tools (extrude, boolean, fillet, …)
- [ ] **Phase 5** — Scene awareness (list/select/inspect)
- [ ] **Phase 6** — High-level generation tools
- [ ] **Phase 7** — Visual verification loop (screenshots)

## License

TBD. Plasticity itself is licensed under its own terms — see upstream repo before redistributing any forked binaries.
