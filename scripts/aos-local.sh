#!/usr/bin/env bash
# Runs a local AOS in deterministic mode with mock tools, on port 8080. For development only: it
# has no Prudence and its development login gives anyone who can reach the port an admin token,
# and AOS listens on all interfaces. Stop it with Ctrl-C when not in use.
set -euo pipefail

# Expects the AOS repository next to this one; set AOS_REPO otherwise.
KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AOS_REPO="${AOS_REPO:-$KIT/../aos-agentic-orchestration-system}"
LOCAL="$KIT/.local"
mkdir -p "$LOCAL"

cd "$AOS_REPO"
go build -o "$LOCAL/aos" ./cmd/aos
go build -o "$LOCAL/mocks" ./cmd/mocks

# Empty values win over AOS's own .env, which may point at the full suite.
export APP_ENV=dev AOS_EXECUTION_MODE=deterministic AOS_GOVERNANCE=none AOS_EVIDENCE=local AOS_STATE_STORE=memory JWT_SECRET=
export AUDIT_LOG_PATH="$LOCAL/audit.jsonl" PRUDENCE_PDP_URL= ERNEST_INGESTOR_URL= AOS_EVIDENCE_KAFKA_BROKERS=
# :9000 is taken by other local services, so the mocks stay on a port of their own.
export AOS_MOCK_PORT=18091 AOS_MOCK_GRPC_PORT=off AOS_MOCK_BASE_URL=http://127.0.0.1:18091

"$LOCAL/mocks" &
MOCKS=$!
trap 'kill "$MOCKS" 2>/dev/null' EXIT
"$LOCAL/aos" -port 8080
