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
