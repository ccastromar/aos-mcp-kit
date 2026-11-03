import { createServer, type Server } from "node:http";

// The stand-in custodian of pipeline_tribunal_callback_probe. AOS hands it the callback URL and
// token exactly as it would a real custodian; the Tribunal then plays whoever intercepted them.

export interface Interception {
  callbackUrl: string;
  callbackToken: string;
}

export class StandInCustodian {
  private server?: Server;
  private seen = new Map<string, Interception>();
  private waiters = new Map<string, (i: Interception) => void>();

  start(port: number): Promise<void> {
    this.server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const op = JSON.parse(body) as { probe?: string; callbackUrl?: string; callbackToken?: string };
          if (op.probe && op.callbackUrl && op.callbackToken) {
            const i = { callbackUrl: op.callbackUrl, callbackToken: op.callbackToken };
            this.seen.set(op.probe, i);
            this.waiters.get(op.probe)?.(i);
          }
        } catch {
          // not an operation: ignore
        }
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "accepted", operationId: "tribunal-probe" }));
      });
    });
    return new Promise((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(port, "127.0.0.1", () => resolve());
    });
  }

  intercepted(probe: string, timeoutMs = 10_000): Promise<Interception> {
    const known = this.seen.get(probe);
    if (known) return Promise.resolve(known);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`AOS sent no operation for probe ${probe} (is AOS_CALLBACK_BASE_URL set?)`)), timeoutMs);
      this.waiters.set(probe, (i) => {
        clearTimeout(timer);
        resolve(i);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}
