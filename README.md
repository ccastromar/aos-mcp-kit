# AOS MCP Kit

An external integration package for AOS. It contains:
- an MCP server that calls the existing AOS HTTP API;
- an `aos-executor` Agent Skill;
- an `aos-pipeline-designer` Agent Skill for editing AOS YAML definitions in a checked-out AOS repository;
- an API contract note;
- the governance Tribunal (`packages/governance-tribunal`), which attacks a running stack and files
  what held (see [Governance Tribunal](#governance-tribunal)).

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
| `aos_wait_task` | `GET /task?id=...`, repeated | Polls with backoff for up to 60 s until the task leaves pending/processing/running/await_callback; read-only |
| `aos_list_tasks` | `GET /api/v1/tasks` | Authenticated, owner-scoped by AOS |
| `aos_review_approval` | `GET /task` + `GET /api/v1/tasks` | What a task waiting at a human step asks for and which checks it passed; read-only, with an MCP Apps card |

Human approval/rejection and clarification reply are intentionally not exposed in the initial MCP
surface. They should remain explicit human actions in the client, subject to AOS ownership,
oversight and incompatible-function checks.

### Approval card (MCP Apps)

`aos_review_approval` links to `ui://aos/approval-card-<hash>.html` (`text/html;profile=mcp-app`);
the hash of the card is part of the URI because hosts cache UI resources by URI.
Hosts that render MCP Apps show it as a card: the request, the checks already passed, the
Prudence decision, and a button that asks the host to open the AOS console on that task
(`AOS_CONSOLE_URL/?taskId=…`), where an overseer decides it signed in as themselves. The card
calls no tool, so neither it nor the model can approve or reject: this server signs in as the
requester, whom four eyes would refuse anyway. Other hosts get the same review as text.

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
- `/task?id=...` returns task state and may return `pending` while work continues. An id AOS never
  issued (or whose state expired) answers 404, so `aos_wait_task` reports it as an error instead
  of waiting out its timeout.
- `/intents` returns `type`, `description`, optional `example`, `required_params`,
  `allow_dangerous` and `requires_llm`; this package tolerates older servers without the last three.
- AOS authentication middleware expects a bearer JWT/OIDC token. The `API_KEY` helper in selected
  handlers does not replace the global JWT middleware.

The MCP client has no retry logic for POST operations. A timeout is an unknown outcome, not proof
that AOS did not accept or execute the task. Query task state when an ID was received; do not
blindly submit again.

## Governance Tribunal

`packages/governance-tribunal` runs a catalog of attacks (`catalog.yaml`) against a running
AOS · Prudence · Ernest stack. Each attack tries to break one guarantee: forged custody callbacks,
another user's task, self-approval, a dangerous step before its approval, a write with Ernest's read
key, a spoofed PDP subject. Each one states what must happen instead. When an attack gets through, the
Tribunal contains it at once (an alert, or suspending the AI system in Prudence) and proposes the
repair to a person; it never applies one. Every run files `report.json` and `expediente.html`.

```bash
cd packages/governance-tribunal && npm ci && npm run build
scripts/tribunal-local.sh                          # lab ring against the local stack
scripts/tribunal-local.sh --only self-approval     # selected attacks
```

`scripts/tribunal-local.sh` expects the stack from `scripts/aos-local.sh` (with
`AOS_LOCAL_PRUDENCE=1 AOS_LOCAL_ERNEST=1`), Prudence's `backend-sso.sh` and its test Keycloak. It
signs in through development logins and test-realm users, so never point it at a real deployment.
Records go to `.local/tribunal/` unless `TRIBUNAL_OUT` says otherwise; local overrides can live in
`.local/tribunal.env`. The `production` ring runs only the attacks with no lasting effect, against
decoy resources, and refuses to start without `TRIBUNAL_PRODUCTION_APPROVED=yes`, set once the
stack's owner has approved it.

Exit code: 0 when every attack held, 2 on a breach, 1 when the run itself failed.

## Development

```bash
cd packages/aos-mcp-server
npm test        # builds, then runs the tests
```

The test suite uses mocked HTTP responses. It does not claim to test an actual AOS deployment.

## License

Apache-2.0. See [LICENSE](LICENSE).
