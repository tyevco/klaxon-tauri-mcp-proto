# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
pnpm install

# Run the full app (Vite dev server + Tauri)
pnpm tauri dev

# Build
pnpm build        # UI only
pnpm tauri build  # Full Tauri app

# UI dev server only (no Tauri shell)
pnpm dev
```

No test suite exists yet.

## Architecture

Klaxon is a Tauri v2 desktop HUD. The data flow is:

```
Agent → HTTP (MCP/JSON-RPC) → Rust (axum) → KlaxonStore → broadcast channel
                                                                  ↓
                                                    Tauri UI events → React widgets
```

### Packages

- **`src-tauri/`** — Rust backend (Tauri v2 + axum)
  - `main.rs` — Tauri setup, command registration, event bridging
  - `store.rs` — `KlaxonStore`: in-memory `HashMap<Uuid, KlaxonItem>` with JSON persistence and a `broadcast::Sender<StoreEvent>` for real-time updates
  - `models.rs` — Shared Rust types (`KlaxonItem`, `KlaxonForm`, `FormField`, `KlaxonAction`, etc.)
  - `mcp_http.rs` — axum HTTP server implementing JSON-RPC 2.0 over `POST /mcp`, SSE stream on `GET /mcp`, and `GET /mcp/discover`

- **`packages/ui/`** — React + Vite frontend (`@klaxon/ui`)
  - Communicates with Rust via `@tauri-apps/api` `invoke()` (commands) and `listen()` (events)
  - `KlaxonWidget.tsx` — Main widget: lists open items, renders `KlaxonCard` with inline form rendering
  - `DraggablePanel.tsx` — Draggable overlay container; positions persisted in `localStorage`

- **`packages/protocol/`** — Shared TypeScript types (`@klaxon/protocol`)
  - Zod schemas for `KlaxonItem`, `FormField` (discriminated union by `type`), `KlaxonAction` (discriminated union by `kind`), `KlaxonAnswer`
  - This is the contract between Rust serialization and the UI

### MCP Server

- Starts on an ephemeral port (passed `0`) bound to `127.0.0.1`; actual address logged to stderr on startup
- Bearer token auto-generated (`mcp_<28 alphanumeric chars>`); printed to stderr and shown as a startup klaxon
- `GET /mcp/discover` returns `{ url, bearer, protocol_version }` — **no auth required** (prototype)
- MCP protocol version: `2025-03-26`
- Implemented tools: `klaxon.notify`, `klaxon.ask`, `klaxon.ack`, `klaxon.dismiss`
- Stub tools (return `{"ok":true,"stub":true}`): `timer.start/stop/switch`, `tokens.add`
- SSE notifications use method `notifications/klaxon` with `{ type: "created"|"updated"|"answered", ... }`

### Store persistence

`KlaxonStore` persists to `<app_data_dir>/klaxon_store.json` as a JSON array sorted by `created_at`. TTL expiry is lazy — items are expired on `list_open()` reads, not on a timer.

### Tauri commands registered

`klaxon_list_open`, `klaxon_ack`, `klaxon_dismiss`, `klaxon_answer`, `klaxon_run_action`, `klaxon_demo_create`

### Tauri events emitted (Rust → UI)

`klaxon.created`, `klaxon.updated`, `klaxon.answered`, `mcp.ready`
