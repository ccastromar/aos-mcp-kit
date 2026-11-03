import type { Config } from "./config.js";
import { buildApprovalReview, type ApprovalReview } from "./approval.js";

export interface Intent {
  type: string;
  description: string;
  example?: string;
  required_params?: string[];
  allow_dangerous?: boolean;
  requires_llm?: boolean;
}

export class AosHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: string
  ) {
    super(message);
    this.name = "AosHttpError";
  }
}

export class AosClient {
  constructor(private readonly config: Config) {}

  private async request<T>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const url = new URL(path.replace(/^\//, ""), this.config.baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers
        }
      });

      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > this.config.maxResponseBytes) {
        throw new Error("AOS response exceeded AOS_MAX_RESPONSE_BYTES");
      }

      if (!response.ok) {
        throw new AosHttpError(
          `AOS returned HTTP ${response.status}`,
          response.status,
          text.slice(0, 2_000)
        );
      }

      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`AOS returned non-JSON response (HTTP ${response.status})`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async listIntents(): Promise<Intent[]> {
    return this.request<Intent[]>("intents", { method: "GET" });
  }

  async executeIntent(
    operation: string,
    params: Record<string, string>
  ): Promise<{ id: string; status: string; result?: unknown; error?: string }> {
    // async=true avoids tying an MCP request to AOS's 30-second synchronous wait.
    // There is intentionally no automatic retry: this API has no idempotency contract.
    return this.request("ask_structured", {
      method: "POST",
      body: JSON.stringify({ operation, params, async: true })
    });
  }

  async getTask(id: string): Promise<unknown> {
    const query = new URLSearchParams({ id });
    return this.request(`task?${query.toString()}`, { method: "GET" });
  }

  async listTasks(): Promise<unknown> {
    return this.request("api/v1/tasks", { method: "GET" });
  }

  /** What a person needs to decide a task's human step: the task, plus its request and checks. */
  async reviewApproval(id: string): Promise<ApprovalReview> {
    const task = (await this.getTask(id)) as { id: string; status: string; data?: unknown; gate?: string; params?: Record<string, string>; completed_steps?: string[] | null };
    const listing = (await this.listTasks()) as Array<Record<string, unknown>> | undefined;
    const listed = Array.isArray(listing) ? listing.find((t) => t.id === id) : undefined;
    return buildApprovalReview({ ...task, id }, listed, this.config.consoleUrl);
  }

  // waitForTask polls /task until the status leaves the in-flight set or timeoutMs elapses.
  // Human gates, clarifications and every final outcome return at once: the caller acts on them.
  async waitForTask(
    id: string,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<{ settled: boolean; waitedMs: number; task: unknown }> {
    const started = Date.now();
    let delayMs = 500;
    for (;;) {
      const task = await this.getTask(id);
      const status = (task as { status?: unknown } | undefined)?.status;
      const waitedMs = Date.now() - started;
      if (typeof status !== "string" || !IN_FLIGHT_STATUSES.has(status)) {
        return { settled: true, waitedMs, task };
      }
      const remainingMs = timeoutMs - waitedMs;
      if (remainingMs <= 0 || signal?.aborted) {
        return { settled: false, waitedMs, task };
      }
      await sleep(Math.min(delayMs, remainingMs), signal);
      delayMs = Math.min(delayMs * 2, 5_000);
    }
  }
}

// Statuses /task reports while AOS is still working or waiting on a provider callback.
export const IN_FLIGHT_STATUSES = new Set([
  "pending",
  "processing",
  "running",
  "await_callback",
  "callback_received"
]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
  });
}
