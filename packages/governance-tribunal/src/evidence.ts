// Reads Ernest's chain for the blocks that prove a run: Prudence's decision and AOS's
// execution evidence carry the run's id as correlationId (and AOS's events as traceId).

export interface ProofBlock {
  index: number;
  hash?: string;
  stage?: string;
  eventType?: string;
}

export class Ernest {
  constructor(readonly baseUrl: string, private readonly apiKey: string) {}

  private async blocks(): Promise<Array<Record<string, any>>> {
    const res = await fetch(`${this.baseUrl}/api/blocks/export`, { headers: { "X-Ernest-Api-Key": this.apiKey } });
    if (!res.ok) throw new Error(`Ernest export: HTTP ${res.status}`);
    const body = (await res.json()) as { blocks: Array<Record<string, any>> };
    return body.blocks;
  }

  /** The blocks that mention the run, waiting up to timeoutMs for batching to chain them. */
  async proofOf(runId: string, want: (found: ProofBlock[]) => boolean, timeoutMs = 30_000): Promise<ProofBlock[]> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found: ProofBlock[] = [];
      for (const b of await this.blocks()) {
        const data = typeof b.data === "string" ? JSON.parse(b.data) : b.data ?? {};
        const md = data.metadata ?? {};
        if (md.correlationId === runId || md.traceId === runId || JSON.stringify(data).includes(runId)) {
          found.push({ index: b.index, hash: b.hash, stage: md.stage, eventType: md.eventType ?? data.type });
        }
      }
      if (want(found) || Date.now() > deadline) return found;
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }

  async exportBlocks(): Promise<Array<Record<string, any> & { index: number; timestamp: number; data: any; previousHash: string; hash: string }>> {
    return (await this.blocks()) as any;
  }

  /** The subject Prudence recorded for a decision (its id is the evidence's inferenceId). */
  async subjectOf(decisionId: string): Promise<string | undefined> {
    for (const b of await this.blocks()) {
      const data = typeof b.data === "string" ? JSON.parse(b.data) : b.data ?? {};
      if (data.inferenceId === decisionId) return data.metadata?.subject;
    }
    return undefined;
  }

  async verify(): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/api/verify`, { headers: { "X-Ernest-Api-Key": this.apiKey } });
    return res.ok ? res.json() : { status: res.status };
  }
}
