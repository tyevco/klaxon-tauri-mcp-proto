# Klaxon (prototype)

A Tauri desktop HUD with overlay widgets:

- **Klaxon**: alerts + structured "ask the user" forms (implemented)
- **Time tracker**: per-issue timer (planned)
- **Token meter**: Claude Code telemetry / thresholds (planned)

## Dev

Prereqs:

- Node + pnpm
- Rust toolchain
- Tauri v2 prerequisites for your OS

Run:

```bash
pnpm install
pnpm tauri dev
```

## MCP Server

The app starts a local MCP-like JSON-RPC server over HTTP on `127.0.0.1`.

- `GET /mcp/discover` for `{ url, bearer }`
- `POST /mcp` for JSON-RPC requests
- `GET /mcp` for SSE notifications

See `docs/mcp-api.md`.
