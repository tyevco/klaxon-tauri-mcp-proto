$ErrorActionPreference = "Stop"

# Example env vars for Claude Code telemetry -> local OTLP receiver (future).
$env:CLAUDE_CODE_ENABLE_TELEMETRY = "1"

pnpm install
pnpm tauri dev
