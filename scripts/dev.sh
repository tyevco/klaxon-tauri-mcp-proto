#!/usr/bin/env bash
set -euo pipefail

# Example env vars for Claude Code telemetry -> local OTLP receiver (future).
export CLAUDE_CODE_ENABLE_TELEMETRY=1

pnpm install
pnpm tauri dev
