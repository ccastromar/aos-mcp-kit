// A small AOS client for the Tribunal: it acts as several people (to test ownership and four
// eyes), so unlike the MCP server it signs in per identity. Lab only: identities come from AOS's
// development login; a production run supplies a token instead (TRIBUNAL_AOS_TOKEN).

export interface Task {
  id: string;
  status: string;
  data?: unknown;
  error?: string;
  completed_steps?: string[] | null;
}

const IN_FLIGHT = new Set(["pending", "processing", "running", "callback_received"]);

export class Aos {
  private tokens = new Map<string, string>();
  private roles = new Map<string, string[]>();

  constructor(readonly baseUrl: string, private readonly fixedToken?: string) {}

  /** Gives a development identity its roles (admin when not set). */
  as(user: string, roles: string[]): this {
    this.roles.set(user, roles);
    return this;
  }

  async token(user: string, roles: string[] = this.roles.get(user) ?? ["admin"]): Promise<string> {
    if (this.fixedToken) return this.fixedToken;
    const key = `${user}|${roles.join(",")}`;
    const cached = this.tokens.get(key);
    if (cached) return cached;
    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user, roles })
    });
    if (!res.ok) throw new Error(`AOS development login refused for ${user}: HTTP ${res.status}`);
    const { token } = (await res.json()) as { token: string };
    this.tokens.set(key, token);
    return token;
  }

  async request(path: string, user: string, init: RequestInit = {}): Promise<{ status: number; text: string }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${await this.token(user)}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers
      }
    });
    return { status: res.status, text: await res.text() };
  }

  async submit(user: string, operation: string, params: Record<string, string>): Promise<string> {
    const res = await this.request("/ask_structured", user, {
      method: "POST",
      body: JSON.stringify({ operation, params, async: true })
    });
    if (res.status >= 400) throw new Error(`AOS refused ${operation}: HTTP ${res.status} ${res.text.slice(0, 200)}`);
    return (JSON.parse(res.text) as { id: string }).id;
  }

  async task(user: string, id: string): Promise<{ status: number; task?: Task }> {
    const res = await this.request(`/task?id=${encodeURIComponent(id)}`, user);
    return { status: res.status, task: res.status === 200 ? (JSON.parse(res.text) as Task) : undefined };
  }

  /** Polls until the task leaves the in-flight states, or the timeout. */
  async settle(user: string, id: string, timeoutMs = 30_000): Promise<Task> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { status, task } = await this.task(user, id);
      if (status !== 200 || !task) throw new Error(`task ${id}: HTTP ${status}`);
      if (!IN_FLIGHT.has(task.status) || Date.now() > deadline) return task;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}
