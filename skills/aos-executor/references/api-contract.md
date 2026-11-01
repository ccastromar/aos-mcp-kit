# AOS HTTP API contract (inspected implementation)

Base URL is supplied by `AOS_BASE_URL`. All requests send `Authorization: Bearer <AOS_ACCESS_TOKEN>`.

## GET /intents

Current response is an array of objects with:
- `type`
- `description`
- optional `example`
- `required_params`
- `allow_dangerous`
- `requires_llm`

Consumers must tolerate older servers where the last three properties are absent. The MCP server
hides intents with `requires_llm: true`.

## POST /ask_structured

Request:
```json
{
  "operation": "logistics.get_shipment_status",
  "params": { "shipmentId": "123", "customerId": "C-1", "date": "2026-11-01" },
  "async": true
}
```

Response when async:
```json
{ "id": "task-id", "status": "processing" }
```

No idempotency header or idempotency field is implemented in the inspected handler.

## GET /task?id=task-id

Returns a task object with `id`, `status`, `data`, `error` and, for persisted tasks, additional
fields such as `pipeline`, `completed_steps`, `ai_system_id`, `decision_id`.
Exact fields depend on task state.

## GET /api/v1/tasks

Returns the authenticated user's task states. AOS permits `audit` or `oversight` functions to
see all users' tasks.

## Authentication and authorization

The HTTP middleware authenticates requests through AOS JWT/OIDC configuration. Forward the
end-user's bearer token. Do not assume `API_KEY` accepted by an individual handler bypasses the
global JWT middleware. Task ownership and governance functions are enforced server-side.
