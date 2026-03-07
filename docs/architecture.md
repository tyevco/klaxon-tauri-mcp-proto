# Klaxon Architecture

Klaxon is a Tauri-based desktop HUD with overlay widgets:

- **Klaxon**: alerts + structured "ask the user" forms
- **Time tracker**: per-issue timer (planned)
- **Token meter**: real-time usage + thresholds (planned, fed by Claude Code OTel)

## Key ideas

- **Widget Bus (Rust)**: single source of truth + persistence + validation + rate limits.
- **MCP Server (HTTP on localhost)**: agents call tools and read resources.
- **UI windows**: overlay widgets that subscribe to events and call commands.

## Data flows

Agent → MCP (HTTP) → Rust handlers → Store → UI event → Widgets
User → UI form submit → Rust store → MCP resource/event → Agent
