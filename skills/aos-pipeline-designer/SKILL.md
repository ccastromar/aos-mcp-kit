---
name: aos-pipeline-designer
description: Design, inspect and validate AOS YAML intents, pipelines, tools and agent definitions in a checked-out AOS repository. Use when a developer wants to extend AOS orchestration-as-code.
---

# AOS Pipeline Designer

This skill works on the AOS source repository, not through the runtime HTTP API. It must not claim
that a YAML definition is registered or active merely because a file was edited.

## Source of truth

Inspect the current repository before editing:
- `definitions/intents/*.yaml`
- `definitions/pipelines/*.yaml`
- `definitions/tools/*.yaml`
- `definitions/agents/*.yaml`
- `definitions/rbac/permissions.yaml`
- `internal/config/config.go` and relevant execution code

The Go config loader defines the actual YAML structs. Do not rely on guessed fields or examples
from older versions.

## Workflow

1. Inspect neighboring definitions for the same domain.
2. Identify the intended operation, inputs, outputs, external side effects and failure modes.
3. Reuse existing tools where appropriate; do not duplicate credentials or hardcode secrets.
4. Draft the intent with a unique `type`, description, pipeline reference and required parameters.
5. Draft the pipeline using only supported step fields and existing tool/agent names.
6. Add the required RBAC permission with least privilege.
7. If the pipeline has sensitive or consequential effects, inspect human gates and Prudence
   governance requirements. Do not weaken them to make a demo pass.
8. Validate cross-references between intent, pipeline, tools and agents.
9. Run `go test ./...` and any relevant focused tests.
10. Present the diff and validation output for human review.

## Constraints

- Do not invent runtime features or YAML keys.
- Do not write secrets into YAML, examples, tests or documentation. Use environment references and
  the configured secret-management mechanism.
- Do not add a permissive RBAC rule as a shortcut.
- Do not silently modify an existing intent or pipeline.
- Do not deploy, merge or activate definitions without explicit authorization.
- Do not assert that the LLM is the authorization boundary; AOS RBAC and governance are.
