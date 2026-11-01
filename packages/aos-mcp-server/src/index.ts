import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { AosClient } from "./aos-client.js";

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
  "aos_list_tasks",
  {
    description:
      "List tasks visible to the authenticated AOS identity. AOS applies owner and audit/oversight scoping.",
    inputSchema: {}
  },
  async () => {
    try {
      return jsonResult(await aos.listTasks());
    } catch (error) {
      return errorResult(error);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
