#!/usr/bin/env bash
# Runs a local AOS in deterministic mode with mock tools, on port 8080. For development only: its
# development login gives anyone who can reach the port an admin token, and AOS listens on all
# interfaces. Stop it with Ctrl-C when not in use.
#
#   scripts/aos-local.sh                      # no Prudence
#   AOS_LOCAL_PRUDENCE=1 scripts/aos-local.sh # governed by a local Prudence; reads .local/prudence.env
#                                             # (system ids from Prudence's scripts/aos-demo-env.sh,
#                                             # plus PRUDENCE_PDP_URL and its client credentials)
#   AOS_LOCAL_ERNEST=1 scripts/aos-local.sh   # evidence to a local Ernest; reads .local/ernest.env
#                                             # (ERNEST_INGESTOR_URL, ERNEST_INGESTOR_API_KEY, AOS_EVIDENCE_KEY)
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
export APP_ENV=dev AOS_EXECUTION_MODE=deterministic AOS_STATE_STORE=memory JWT_SECRET=
export AUDIT_LOG_PATH="$LOCAL/audit.jsonl" AOS_EVIDENCE_KAFKA_BROKERS=
if [[ "${AOS_LOCAL_ERNEST:-}" == 1 ]]; then
  [[ -f "$LOCAL/ernest.env" ]] || { echo "AOS_LOCAL_ERNEST=1 needs $LOCAL/ernest.env" >&2; exit 1; }
  set -a; source "$LOCAL/ernest.env"; set +a
  export AOS_EVIDENCE=ernest
else
  export AOS_EVIDENCE=local ERNEST_INGESTOR_URL=
fi
if [[ "${AOS_LOCAL_PRUDENCE:-}" == 1 ]]; then
  [[ -f "$LOCAL/prudence.env" ]] || { echo "AOS_LOCAL_PRUDENCE=1 needs $LOCAL/prudence.env" >&2; exit 1; }
  set -a; source "$LOCAL/prudence.env"; set +a
  export AOS_GOVERNANCE=prudence
else
  export AOS_GOVERNANCE=none PRUDENCE_PDP_URL=
fi
# An organization's governance model, not the contract's default: the default deliberately keeps
# pre-functions behaviour, where whoever asks for a human step may also approve it. The banking
# template adds four eyes ([ai.use, oversight]). Approve as another development identity with the
# `oversight` role.
export AOS_GOVERNANCE_MODEL="${AOS_LOCAL_GOVERNANCE_MODEL:-$KIT/../prudence-governance/contract/governance/templates/banking.yaml}"
[[ -f "$AOS_GOVERNANCE_MODEL" ]] || { echo "governance model not found: $AOS_GOVERNANCE_MODEL (set AOS_LOCAL_GOVERNANCE_MODEL)" >&2; exit 1; }
# :9000 is taken by other local services, so the mocks stay on ports of their own; the gRPC risk
# mock backs protocols.customer_review.
export AOS_MOCK_PORT=18091 AOS_MOCK_BASE_URL=http://127.0.0.1:18091
export AOS_MOCK_GRPC_PORT=18092 AOS_MOCK_GRPC_TARGET=127.0.0.1:18092
export AOS_OPENAPI_TESTAPI_URL=http://127.0.0.1:18091/mock/openapi
# Without it AOS sends providers no callback URL, and await_callback pipelines wait until they time out.
export AOS_CALLBACK_BASE_URL=http://127.0.0.1:8080
# The custody mock signs its callbacks and AOS checks them; a fresh secret per run.
CUSTODY_CALLBACK_SECRET="$(openssl rand -hex 32)"
export CUSTODY_CALLBACK_SECRET AOS_MOCK_CALLBACK_SECRET="$CUSTODY_CALLBACK_SECRET"
# workspace.* pipelines read and write files here, never in the AOS checkout.
export AOS_WORKSPACE_ROOT="$LOCAL/workspace"
mkdir -p "$AOS_WORKSPACE_ROOT"
[[ -f "$AOS_WORKSPACE_ROOT/README.md" ]] || printf '# Workspace\n\nScratch area for AOS workspace pipelines.\n' > "$AOS_WORKSPACE_ROOT/README.md"

"$LOCAL/mocks" &
MOCKS=$!
trap 'kill "$MOCKS" 2>/dev/null' EXIT
"$LOCAL/aos" -port 8080
