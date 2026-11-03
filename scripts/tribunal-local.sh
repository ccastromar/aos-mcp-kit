#!/usr/bin/env bash
# Runs the governance Tribunal's lab ring against the local stack started by aos-local.sh
# (AOS_LOCAL_PRUDENCE=1 AOS_LOCAL_ERNEST=1), Prudence's backend-sso.sh and Keycloak.
# Lab only: it signs in through AOS's development login and contains breaches as the test
# realm's demo author. Never point it at a real deployment.
#
#   scripts/tribunal-local.sh                 # every lab attack
#   scripts/tribunal-local.sh --only self-approval,unknown-task
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL="$KIT/.local"
AOS_REPO="${AOS_REPO:-$KIT/../aos-agentic-orchestration-system}"
DOCS="${CHESTERTOWN_DOCS:-$KIT/../chestertown-docs}"

# AI system ids (Prudence's aos-demo-env.sh) and the Ernest key Prudence uses for reads.
set -a
[[ -f "$LOCAL/prudence.env" ]] && source "$LOCAL/prudence.env"
[[ -f "$LOCAL/prudence-ernest.env" ]] && source "$LOCAL/prudence-ernest.env"
# Ernest's read-only key, for the attack that tries to write with it.
[[ -f "$LOCAL/tribunal-ernest.env" ]] && source "$LOCAL/tribunal-ernest.env"
set +a
export TRIBUNAL_WORKSPACE_ROOT="${TRIBUNAL_WORKSPACE_ROOT:-$LOCAL/workspace}"
export TRIBUNAL_ERNEST_HASH_VECTORS="${TRIBUNAL_ERNEST_HASH_VECTORS:-$KIT/../ai-blockchain-provenance/testdata/hash-golden-vectors.json}"

export TRIBUNAL_AOS_URL="${TRIBUNAL_AOS_URL:-http://127.0.0.1:8080}"
export TRIBUNAL_AOS_BIN="${TRIBUNAL_AOS_BIN:-$LOCAL/aos}"
export TRIBUNAL_AOS_DEFINITIONS="${TRIBUNAL_AOS_DEFINITIONS:-$AOS_REPO/definitions}"
export TRIBUNAL_ERNEST_URL="${TRIBUNAL_ERNEST_URL:-http://127.0.0.1:3001}"
export TRIBUNAL_ERNEST_KEY="${TRIBUNAL_ERNEST_KEY:-${PRUDENCE_ERNEST_API_KEY:-}}"
export TRIBUNAL_PRUDENCE_URL="${TRIBUNAL_PRUDENCE_URL:-http://127.0.0.1:8099}"
export TRIBUNAL_PRUDENCE_TOKEN_URL="${TRIBUNAL_PRUDENCE_TOKEN_URL:-http://localhost:8081/realms/chestertown/protocol/openid-connect/token}"
# The test realm's demo author (Prudence scripts/README.md); containment opens incidents as them.
export TRIBUNAL_PRUDENCE_USER="${TRIBUNAL_PRUDENCE_USER:-alice}"
export TRIBUNAL_PRUDENCE_PASSWORD="${TRIBUNAL_PRUDENCE_PASSWORD:-alice}"
if [[ -d "$DOCS" ]]; then export TRIBUNAL_OUT="${TRIBUNAL_OUT:-$DOCS/tribunal}"; else export TRIBUNAL_OUT="${TRIBUNAL_OUT:-$LOCAL/tribunal}"; fi

node "$KIT/packages/governance-tribunal/dist/index.js" --ring lab "$@"
