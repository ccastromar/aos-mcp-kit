# AOS YAML model (based on internal/config/config.go)

## Intent

```yaml
intents:
  - type: domain.operation
    description: "Human-readable description"
    pipeline: pipeline_operation
    required_params:
      - entityId
    examples:
      - "Example request"
    allow_dangerous: false
```

The Go `Intent` struct also has guardrail fields such as `requires_amount`, `requires_phone`,
`max_amount` and `shadow_mode`. Verify exact current struct fields before using them.

## Pipeline

```yaml
pipelines:
  - name: pipeline_operation
    description: "Declared workflow"
    mode: linear
    steps:
      - tool: service.get_entity
      - analyst: true
```

Supported step fields in the inspected config struct include `id`, `type`, `agent`, `depends_on`,
`tool`, `with_params`, `analyst`, `human_approval`, `when`, `retries`, `timeout_ms` and
`backoff_ms`. Runtime semantics must be checked in the verifier/planner before use.

## Tool

The inspected `Tool` struct supports fields including `name`, `description`, `type`, `method`,
`url`, `mode`, `timeout`, `body`, `headers`, `target`, `service`, `operation`, `agent`,
`insecure`, `remote_tool` and `protocol_version`.

Never hardcode secrets. AOS supports environment expansion in tool definitions; use the existing
secret management guidance.

## RBAC

Add the intent's permission to `definitions/rbac/permissions.yaml` using least privilege. Unknown
intents are denied by default in the current example configuration.
