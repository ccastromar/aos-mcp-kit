import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { AosClient } from "./aos-client.js";
import { reviewText } from "./approval.js";

const config = loadConfig();
const aos = new AosClient(config);

const server = new McpServer({
  name: "aos-mcp-kit",
  version: "0.1.0"
});

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }]
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown AOS error";
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }]
  };
}

server.registerTool(
  "aos_list_intents",
  {
    description:
      "List AOS-declared intents that run without an LLM inside AOS, with their required parameters. This is discovery only; it does not execute anything.",
    inputSchema: {}
  },
  async () => {
    try {
      const intents = await aos.listIntents();
      return jsonResult(intents.filter((intent) => !intent.requires_llm));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "aos_execute_intent",
  {
    description:
      "Submit a declared AOS operation with structured parameters. Discover the operation using aos_list_intents first. This submits asynchronously and does not retry.",
    inputSchema: {
      operation: z.string().min(1).max(200),
      params: z.record(z.string(), z.string()).default({})
    }
  },
  async ({ operation, params }) => {
    try {
      return jsonResult(await aos.executeIntent(operation, params));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "aos_get_task",
  {
    description:
      "Retrieve the status/result of an AOS task. AOS enforces task ownership and oversight access.",
    inputSchema: { id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/) }
  },
  async ({ id }) => {
    try {
      return jsonResult(await aos.getTask(id));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "aos_wait_task",
  {
    description:
      "Wait up to timeoutSeconds (default 30, max 60) for an AOS task to leave pending/processing/running/await_callback, then return it. settled=false means it is still in flight: call again or report it as pending. Read-only; it never resubmits or answers a gate.",
    inputSchema: {
      id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
      timeoutSeconds: z.number().int().min(1).max(60).default(30)
    }
  },
  async ({ id, timeoutSeconds }, extra) => {
    try {
      return jsonResult(await aos.waitForTask(id, timeoutSeconds * 1_000, extra.signal));
    } catch (error) {
      return errorResult(error);
    }
  }
);

// The listing carries each task's full pipeline snapshot, params and step results (several KB a
// task); the model only needs to tell tasks apart. Details are one aos_get_task away.
function taskSummary(t: Record<string, any>) {
  const gate = t.gate || undefined;
  const waiting = gate === "clarification" ? "await_clarification" : gate === "await_callback" ? "await_callback" : gate ? "await_human" : "pending";
  return {
    id: t.id,
    intent: t.intent,
    pipeline: t.pipeline,
    // A task paused at a gate has no status of its own yet: the gate says what it waits for.
    status: t.status || waiting,
    gate,
    requestedBy: t.user_id,
    createdAt: t.created_at,
    completedSteps: t.completed_steps ?? []
  };
}

server.registerTool(
  "aos_list_tasks",
  {
    description:
      "List tasks visible to the authenticated AOS identity, one summary each (id, intent, status, gate, requester, creation time, completed steps). Use aos_get_task for a task's result. AOS applies owner and audit/oversight scoping.",
    inputSchema: {}
  },
  async () => {
    try {
      const tasks = await aos.listTasks();
      return jsonResult(Array.isArray(tasks) ? tasks.map(taskSummary) : tasks);
    } catch (error) {
      return errorResult(error);
    }
  }
);

// MCP Apps: hosts that render interactive UI show this card for aos_review_approval. It only
// shows the decision and links to the AOS console; no tool here approves or rejects.
// Hosts cache UI resources by URI, so the URI carries a hash of the card: a changed card is fetched anew.
const approvalCard = readFileSync(new URL("../ui/approval-card.html", import.meta.url), "utf8");
const APPROVAL_CARD_URI = `ui://aos/approval-card-${createHash("sha256").update(approvalCard).digest("hex").slice(0, 12)}.html`;

server.registerResource(
  "approval-card",
  APPROVAL_CARD_URI,
  { title: "AOS human step", mimeType: "text/html;profile=mcp-app", _meta: { ui: { prefersBorder: true } } },
  async () => ({ contents: [{ uri: APPROVAL_CARD_URI, mimeType: "text/html;profile=mcp-app", text: approvalCard }] })
);

server.registerTool(
  "aos_review_approval",
  {
    description:
      "Show what an AOS task waiting at a human step asks for and which checks it passed, so a person can decide it. Read-only: the decision is made in the AOS console by an overseer signed in as themselves; this tool never approves or rejects.",
    inputSchema: { id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/) },
    _meta: { ui: { resourceUri: APPROVAL_CARD_URI } }
  },
  async ({ id }) => {
    try {
      const review = await aos.reviewApproval(id);
      return { content: [{ type: "text" as const, text: reviewText(review) }], structuredContent: { ...review } };
    } catch (error) {
      return errorResult(error);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
