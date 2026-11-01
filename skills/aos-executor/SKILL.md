---
name: aos-executor
description: Discover declared AOS intents, submit structured operations, and inspect task outcomes through the AOS MCP server. Use when the user asks to run a workflow managed by AOS.
---

# AOS Executor

AOS is a deterministic orchestration runtime with no LLM of its own in this mode. You interpret the
request, select a declared intent and supply its inputs; AOS owns authorization, validation, step
ordering and execution. Results come back raw, so summarize them yourself.

## Available MCP tools

- `aos_list_intents`
- `aos_execute_intent`
- `aos_get_task`
- `aos_list_tasks`

## Protocol

1. Call `aos_list_intents` before choosing a structured operation.
2. Match the user request to an exact declared `type`. Never invent operation names.
3. Collect every value in `required_params`, and ask the user for missing or ambiguous ones. If no
   declared intent fits, say so instead of forcing one.
4. Submit with `aos_execute_intent`. Every parameter value must be a string; AOS rejects others.
5. Submission is asynchronous. Preserve the returned task ID.
6. Use `aos_get_task` to inspect status and result. `pending` and `processing` are not success.
7. Report only facts present in the AOS response.

## Safety rules

- Never claim that an operation completed based only on task acceptance.
- Never blindly retry a POST after a timeout. The current AOS API does not expose an idempotency-key
  contract. A timeout means the outcome is unknown.
- Never bypass AOS by calling underlying tools directly.
- Never ask for or expose AOS service credentials.
- Never use a development login or mock identity in a production environment.
- Never approve/reject human gates or answer clarifications on behalf of a person.
- Treat `completed` and `ok` as success. Treat `governance_blocked`, `await_human`,
  `await_callback`, `error`, `timeout` and `timed_out` as distinct outcomes.
- Do not expose task results belonging to another user. AOS enforces this on the server.

## Human gates

When AOS reports that a task is awaiting a human decision or clarification, explain what is needed
and direct the user to the authorized AOS review interface. The initial MCP server deliberately
does not expose approval/rejection/reply tools.

## Output

Always include:
- operation/intent, if known;
- task ID;
- current status;
- result or blocking reason, when returned;
- whether the task is still pending.
