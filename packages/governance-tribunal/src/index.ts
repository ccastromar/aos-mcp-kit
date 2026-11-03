#!/usr/bin/env node
// The governance Tribunal: runs the attack catalog against a live stack, contains what gets
// through and files the record (report.json + expediente.html).
//
//   tribunal [--ring lab|production] [--only id,id] [--out dir] [--catalog file]
//
// Exit code: 0 every attack held, 2 at least one breach, 1 the run itself failed.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { Aos } from "./aos.js";
import { techniques, type Context, type Outcome, type Verdict } from "./attacks.js";
import { alert, suspendAiSystem, type PrudenceAccess } from "./containment.js";
import { StandInCustodian } from "./custodian.js";
import { Ernest } from "./evidence.js";
import { renderHtml, type AttackRecord, type Report } from "./report.js";

interface Attack {
  id: string;
  title: string;
  guarantee: string;
  rings: string[];
  technique: string;
  params?: Record<string, any>;
  expect: string;
  containment: "alert" | "suspend_ai_system";
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const env = process.env;
  const ring = arg("ring") ?? "lab";
  if (ring === "production" && env.TRIBUNAL_PRODUCTION_APPROVED !== "yes") {
    console.error("The production ring attacks a live stack: set TRIBUNAL_PRODUCTION_APPROVED=yes once its owner approved it and the decoy resources exist.");
    return 1;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const catalogPath = resolve(arg("catalog") ?? join(here, "..", "catalog.yaml"));
  const only = arg("only")?.split(",");
  const catalog = (parse(await readFile(catalogPath, "utf8")) as { attacks: Attack[] }).attacks
    .filter((a) => a.rings.includes(ring))
    .filter((a) => !only || only.includes(a.id));

  const aosUrl = env.TRIBUNAL_AOS_URL ?? "http://127.0.0.1:8080";
  const custodian = new StandInCustodian();
  await custodian.start(Number(env.TRIBUNAL_CUSTODIAN_PORT ?? 18099));
  const ernest = env.TRIBUNAL_ERNEST_URL && env.TRIBUNAL_ERNEST_KEY ? new Ernest(env.TRIBUNAL_ERNEST_URL, env.TRIBUNAL_ERNEST_KEY) : undefined;
  const prudence: PrudenceAccess | undefined =
    env.TRIBUNAL_PRUDENCE_URL && env.TRIBUNAL_PRUDENCE_TOKEN_URL && env.TRIBUNAL_PRUDENCE_USER && env.TRIBUNAL_PRUDENCE_PASSWORD
      ? {
          url: env.TRIBUNAL_PRUDENCE_URL,
          tokenUrl: env.TRIBUNAL_PRUDENCE_TOKEN_URL,
          clientId: env.TRIBUNAL_PRUDENCE_CLIENT_ID ?? "prudence-spa",
          user: env.TRIBUNAL_PRUDENCE_USER,
          password: env.TRIBUNAL_PRUDENCE_PASSWORD
        }
      : undefined;
  const ctx: Context = {
    aos: new Aos(aosUrl, env.TRIBUNAL_AOS_TOKEN),
    custodian,
    ernest,
    env,
    aosBin: env.TRIBUNAL_AOS_BIN,
    definitionsDir: env.TRIBUNAL_AOS_DEFINITIONS,
    workspaceRoot: env.TRIBUNAL_WORKSPACE_ROOT,
    hashVectorsFile: env.TRIBUNAL_ERNEST_HASH_VECTORS
  };

  const startedAt = new Date().toISOString();
  const records: AttackRecord[] = [];
  try {
    for (const a of catalog) {
      const t0 = Date.now();
      const technique = techniques[a.technique];
      let outcome: Outcome;
      try {
        outcome = technique ? await technique(ctx, a.params ?? {}, a.id) : { verdict: "error", observed: `unknown technique ${a.technique}`, proof: {} };
      } catch (e) {
        outcome = { verdict: "error", observed: (e as Error).message, proof: {} };
      }
      const record: AttackRecord = { id: a.id, title: a.title, guarantee: a.guarantee, expect: a.expect, rings: a.rings, ...outcome, startedAt: new Date(t0).toISOString(), durationMs: Date.now() - t0 };
      if (outcome.verdict === "breach") {
        record.containment =
          a.containment === "suspend_ai_system"
            ? await suspendAiSystem(prudence, env[a.params?.systemEnv ?? ""], a.id, outcome.observed)
            : alert(a.id, outcome.observed);
      }
      records.push(record);
      console.log(`${outcome.verdict.toUpperCase().padEnd(7)} ${a.id}: ${outcome.observed}`);
    }
  } finally {
    await custodian.stop();
  }

  const summary = { held: 0, breach: 0, error: 0, planned: 0 } as Record<Verdict, number>;
  for (const r of records) summary[r.verdict]++;
  const report: Report = {
    tribunal: "governance-tribunal/v1",
    ring,
    target: { aos: aosUrl, ernest: env.TRIBUNAL_ERNEST_URL, prudence: env.TRIBUNAL_PRUDENCE_URL },
    startedAt,
    finishedAt: new Date().toISOString(),
    summary,
    attacks: records
  };
  const out = resolve(arg("out") ?? join(env.TRIBUNAL_OUT ?? ".", startedAt.replace(/[:.]/g, "-")));
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await writeFile(join(out, "expediente.html"), renderHtml(report));
  console.log(`\n${summary.held} held · ${summary.breach} breach · ${summary.error} error · ${summary.planned} planned\nrecord: ${out}`);
  return summary.breach > 0 ? 2 : summary.error > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
