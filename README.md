# AOS MCP Kit

An external integration package for AOS. It contains:
- an MCP server that calls the existing AOS HTTP API;
- an `aos-executor` Agent Skill;
- an `aos-pipeline-designer` Agent Skill for editing AOS YAML definitions in a checked-out AOS repository;
- an API contract note.

## Architecture

The MCP server is deliberately outside the AOS Go runtime. The calling agent interprets the request
and picks the intent; AOS runs the declared YAML pipeline with no LLM of its own:

`Agent -> Skill -> MCP (stdio) -> AOS HTTP API -> AOS runtime`

Start AOS with `AOS_EXECUTION_MODE=deterministic`. That instance has no LLM client: `/ask` is
disabled, tasks close with raw step results, and intents that need an LLM are refused and hidden.
Step results therefore reach the provider behind the calling agent, whatever they contain.

Prudence and Ernest stay available in this mode. Each deployment states them with `AOS_GOVERNANCE`
and `AOS_EVIDENCE`; the MCP server cannot change them.

The server forwards the caller's AOS bearer token. It does not mint tokens, use `/auth/login`,
share a privileged service identity, or bypass AOS RBAC/governance.

## Implemented tools

| Tool | AOS route | Notes |
|---|---|---|
| `aos_list_intents` | `GET /intents` | Hides intents that need an LLM inside AOS |
| `aos_execute_intent` | `POST /ask_structured` | Uses `async: true`; no automatic retries |
| `aos_get_task` | `GET /task?id=...` | Authenticated task access |
| `aos_list_tasks` | `GET /api/v1/tasks` | Authenticated, owner-scoped by AOS |

Human approval/rejection and clarification reply are intentionally not exposed in the initial MCP
surface. They should remain explicit human actions in the client, subject to AOS ownership,
oversight and incompatible-function checks.

## Requirements

- Node.js 20+
- An AOS instance reachable from the MCP process
- A valid AOS JWT/OIDC bearer token with the appropriate AOS governance functions
- AOS configured to authenticate that token

## Run locally

```bash
cd packages/aos-mcp-server
npm install
AOS_BASE_URL=http://localhost:8080 AOS_ACCESS_TOKEN="$AOS_ACCESS_TOKEN" npm run dev
```

The MCP server uses STDIO. Do not print logs to stdout; stdout is reserved for MCP messages.

For a local trial, `scripts/aos-local.sh` runs AOS in deterministic mode with mock tools, and
`scripts/aos-mcp.sh` starts the MCP server against it with a development token.

## Claude Code example

Configure the MCP server in the client's MCP configuration. Prefer an environment variable or
secret manager for the token; do not commit it.

```json
{
  "mcpServers": {
    "aos": {
      "command": "node",
      "args": ["/absolute/path/aos-mcp-kit/packages/aos-mcp-server/dist/index.js"],
      "env": {
        "AOS_BASE_URL": "https://your-aos.example",
        "AOS_ACCESS_TOKEN": "${AOS_ACCESS_TOKEN}"
      }
    }
  }
}
```

Variable interpolation is client-specific. If the client does not expand `${AOS_ACCESS_TOKEN}`,
inject it through the process environment or a secret manager instead.

## Install the skills

Copy the directories under `skills/` into the agent's supported skills directory. Agent Skills
support and directory conventions vary by client; use the client-specific installation guide.

## Important API semantics

- `/ask_structured` accepts `{operation, params, async}`. With `async: true`, it returns
  `{id, status}`. It has no idempotency-key contract in the inspected AOS implementation.
- Parameter values must be strings. A task with a missing required parameter or another value type
  ends in `error`.
- `/task?id=...` returns task state and may return `pending` while work continues.
- `/intents` returns `type`, `description`, optional `example`, `required_params`,
  `allow_dangerous` and `requires_llm`; this package tolerates older servers without the last three.
- AOS authentication middleware expects a bearer JWT/OIDC token. The `API_KEY` helper in selected
  handlers does not replace the global JWT middleware.

The MCP client has no retry logic for POST operations. A timeout is an unknown outcome, not proof
that AOS did not accept or execute the task. Query task state when an ID was received; do not
blindly submit again.

## Development

```bash
npm test
npm run build
```

The test suite uses mocked HTTP responses. It does not claim to test an actual AOS deployment.

## License

Apache-2.0. See [LICENSE](LICENSE).
