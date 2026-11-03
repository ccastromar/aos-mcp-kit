import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { canonicalizeEx } from "json-canonicalize";

// An independent verifier of Ernest's hash chain, so the Tribunal does not take Ernest's word
// for its own integrity. It must reproduce Ernest's calculateHash byte for byte: the same
// canonical JSON library and version (json-canonicalize 2.0.0), the same excluded keys and the
// same `index|timestamp|data|previousHash` layout, checked against Ernest's golden vectors.

const EXCLUDED = ["__v", "_id", "createdAt", "updatedAt", "hash"];

export interface Block {
  index: number;
  timestamp: number | string;
  data: any;
  previousHash: string;
  hash: string;
}

export function blockHash(b: Block): string {
  const data = typeof b.data === "string" ? JSON.parse(b.data) : b.data;
  const canonical = canonicalizeEx(data, { exclude: EXCLUDED });
  return createHash("sha256").update([b.index, String(b.timestamp), canonical, b.previousHash].join("|")).digest("hex");
}

/** Recomputes every hash and link; the first block that does not match breaks the chain. */
export function verifyChain(blocks: Block[]): { ok: boolean; checked: number; brokenAt?: number; why?: string } {
  const sorted = [...blocks].sort((a, b) => a.index - b.index);
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i]!;
    if (blockHash(b) !== b.hash) return { ok: false, checked: i, brokenAt: b.index, why: "hash does not match its contents" };
    if (i > 0 && b.previousHash !== sorted[i - 1]!.hash) return { ok: false, checked: i, brokenAt: b.index, why: "does not link to the previous block" };
  }
  return { ok: true, checked: sorted.length };
}

export async function matchesGoldenVectors(file: string): Promise<{ ok: boolean; detail: string }> {
  const fixture = JSON.parse(await readFile(file, "utf8")) as { vectors: Array<{ name: string; block: Block; expectedHash: string }> };
  const wrong = fixture.vectors.filter((v) => blockHash(v.block) !== v.expectedHash).map((v) => v.name);
  return wrong.length === 0
    ? { ok: true, detail: `${fixture.vectors.length} golden vectors reproduced` }
    : { ok: false, detail: `differs on ${wrong.join(", ")}` };
}
