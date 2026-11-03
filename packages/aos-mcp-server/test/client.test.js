import test from "node:test";
import assert from "node:assert/strict";
import { AosClient } from "../dist/aos-client.js";
import { loadConfig } from "../dist/config.js";

function config() {
  return loadConfig({
    AOS_BASE_URL: "https://aos.example.test/",
    AOS_ACCESS_TOKEN: "test-token",
    AOS_HTTP_TIMEOUT_MS: "1000"
  });
}

test("AOS client forwards bearer token and discovers intents", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://aos.example.test/intents");
    assert.equal(init.headers.Authorization, "Bearer test-token");
    return new Response(JSON.stringify([
      { type: "logistics.get_shipment_status", description: "Track shipment" }
    ]), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const client = new AosClient(config());
    const intents = await client.listIntents();
    assert.equal(intents[0].type, "logistics.get_shipment_status");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("structured intent submission is asynchronous and is not retried", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(init.body);
    assert.equal(body.operation, "logistics.get_shipment_status");
    assert.equal(body.async, true);
    assert.deepEqual(body.params, { shipmentId: "S-1" });
    return new Response(JSON.stringify({ id: "task-1", status: "processing" }), {
      status: 200
    });
  };
  try {
    const client = new AosClient(config());
    const result = await client.executeIntent("logistics.get_shipment_status", {
      shipmentId: "S-1"
    });
    assert.equal(result.id, "task-1");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects non-http AOS base URLs", () => {
  assert.throws(() => loadConfig({
    AOS_BASE_URL: "file:///tmp/aos",
    AOS_ACCESS_TOKEN: "token"
  }), /http or https/);
});

test("waiting returns once the task leaves await_callback", async () => {
  const originalFetch = globalThis.fetch;
  const statuses = ["await_callback", "running", "ok"];
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://aos.example.test/task?id=task-1");
    assert.equal(init.method, "GET");
    return new Response(JSON.stringify({ id: "task-1", status: statuses[calls++] }), { status: 200 });
  };
  try {
    const result = await new AosClient(config()).waitForTask("task-1", 10_000);
    assert.equal(result.settled, true);
    assert.equal(result.task.status, "ok");
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("waiting gives up at the timeout and reports the task still in flight", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ id: "task-1", status: "await_callback" }), { status: 200 });
  try {
    const result = await new AosClient(config()).waitForTask("task-1", 700);
    assert.equal(result.settled, false);
    assert.equal(result.task.status, "await_callback");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("waiting returns a human gate at once instead of waiting it out", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ id: "task-1", status: "await_human" }), { status: 200 });
  };
  try {
    const result = await new AosClient(config()).waitForTask("task-1", 10_000);
    assert.equal(result.settled, true);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
