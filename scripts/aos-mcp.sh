#!/usr/bin/env bash
# Starts the MCP server against the local AOS from aos-local.sh, with a fresh development token.
# stdout is reserved for MCP messages. Development login only: never point this at a real AOS.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AOS_BASE_URL="http://127.0.0.1:${AOS_LOCAL_PORT:-8080}"

response="$(curl -fsS --max-time 5 -X POST "$AOS_BASE_URL/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"local-agent","roles":["admin"]}')" || {
  echo "AOS is not reachable at $AOS_BASE_URL; start scripts/aos-local.sh first" >&2
  exit 1
}
AOS_ACCESS_TOKEN="$(node -e 'console.log(JSON.parse(process.argv[1]).token)' "$response")"

export AOS_BASE_URL AOS_ACCESS_TOKEN
# The AOS console (its ui/ dev server) where an overseer decides human steps; the approval card
# links there.
export AOS_CONSOLE_URL="${AOS_CONSOLE_URL:-http://localhost:5173}"
exec node "$KIT/packages/aos-mcp-server/dist/index.js"
