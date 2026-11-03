import { createHmac, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Aos, Task } from "./aos.js";
import type { StandInCustodian } from "./custodian.js";
import type { Ernest } from "./evidence.js";

export type Verdict = "held" | "breach" | "error" | "planned";

export interface Outcome {
  verdict: Verdict;
  observed: string;
  proof: Record<string, unknown>;
}

export interface Context {
  aos: Aos;
  custodian: StandInCustodian;
  ernest?: Ernest;
  env: NodeJS.ProcessEnv;
  aosBin?: string;
  definitionsDir?: string;
  /** Root the workspace tools are confined to, to look for files an escape left outside it. */
  workspaceRoot?: string;
  /** Golden vectors Ernest's three hash implementations agree on. */
  hashVectorsFile?: string;
}

type Technique = (ctx: Context, params: Record<string, any>, attackId: string) => Promise<Outcome>;

// Every request runs as the Tribunal's own identities, never as a real person.
const TRIBUNAL = "tribunal";

const held = (observed: string, proof: Record<string, unknown>): Outcome => ({ verdict: "held", observed, proof });
const breach = (observed: string, proof: Record<string, unknown>): Outcome => ({ verdict: "breach", observed, proof });

/** Starts a probe wait and returns what an interceptor of the custodian's traffic would hold. */
async function interceptProbe(ctx: Context, attackId: string) {
  const probe = `${attackId}-${randomUUID().slice(0, 8)}`;
  const taskId = await ctx.aos.submit(TRIBUNAL, "tribunal.callback_probe", { probe });
  const interception = await ctx.custodian.intercepted(probe);
  return { probe, taskId, ...interception };
}

const callbackForgery: Technique = async (ctx, params, attackId) => {
  const { taskId, callbackUrl } = await interceptProbe(ctx, attackId);
  const body = JSON.stringify({ status: "completed", operationId: "forged", txHash: "0xforged" });
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (params.variant === "wrong_key") {
    const ts = String(Math.floor(Date.now() / 1000));
    headers["X-AOS-Callback-Timestamp"] = ts;
    headers["X-AOS-Callback-Signature"] = "sha256=" + createHmac("sha256", "guessed-key").update(`${ts}.${body}`).digest("hex");
  }
  const res = await fetch(callbackUrl, { method: "POST", headers, body });
  // The forgery can land while AOS is still recording the submission (submitting_callback);
  // what counts is that the wait is open once that settles.
  let after = (await ctx.aos.task(TRIBUNAL, taskId)).task;
  for (let i = 0; i < 20 && after?.status === "submitting_callback"; i++) {
    await new Promise((r) => setTimeout(r, 250));
    after = (await ctx.aos.task(TRIBUNAL, taskId)).task;
  }
  const proof = { taskId, callbackStatus: res.status, taskStatusAfter: after?.status };
  return res.status === 401 && after?.status === "await_callback"
    ? held(`forged callback refused with 401; the wait stayed open`, proof)
    : breach(`forged callback answered ${res.status}; task is now ${after?.status}`, proof);
};

const tokenExposure: Technique = async (ctx, _params, attackId) => {
  const { taskId, callbackToken } = await interceptProbe(ctx, attackId);
  const listing = await ctx.aos.request("/api/v1/tasks", TRIBUNAL);
  const view = await ctx.aos.request(`/task?id=${taskId}`, TRIBUNAL);
  const leaks = [listing.text.includes(callbackToken) && "task listing", view.text.includes(callbackToken) && "task view"].filter(Boolean);
  const proof = { taskId, searched: ["GET /api/v1/tasks", "GET /task"], leaks };
  return leaks.length === 0 ? held("the live token appears in no task listing or view", proof) : breach(`token found in ${leaks.join(" and ")}`, proof);
};

const unknownTask: Technique = async (ctx) => {
  const id = `tribunal-${randomUUID()}`;
  const { status } = await ctx.aos.task(TRIBUNAL, id);
  return status === 404 ? held("made-up task id answers 404", { id, status }) : breach(`made-up task id answers ${status}`, { id, status });
};

const foreignTask: Technique = async (ctx) => {
  const owner = "tribunal-owner";
  const other = "tribunal-other";
  const taskId = await ctx.aos.submit(owner, "banking.get_balance", { accountId: "123" });
  await ctx.aos.settle(owner, taskId);
  const { status } = await ctx.aos.task(other, taskId);
  const listed = (await ctx.aos.request("/api/v1/tasks", other)).text.includes(taskId);
  const proof = { taskId, owner, other, otherReadStatus: status, inOthersListing: listed };
  return status === 404 && !listed ? held("another person gets 404 and does not see it listed", proof) : breach(`another person read it (HTTP ${status}, listed=${listed})`, proof);
};

const governedDenial: Technique = async (ctx, params) => {
  const taskId = await ctx.aos.submit(TRIBUNAL, params.operation, params.inputs);
  const task = await ctx.aos.settle(TRIBUNAL, taskId);
  const decision = (task.data as any)?.decision;
  const steps = task.completed_steps ?? [];
  const proof: Record<string, unknown> = { taskId, status: task.status, decision, reason: (task.data as any)?.reason, completedSteps: steps };
  if (ctx.ernest) proof.ernestBlocks = await ctx.ernest.proofOf(taskId, (f) => f.some((b) => b.stage === "governance_decision"), 15_000);
  return task.status === "governance_blocked" && decision === "DENY" && steps.length === 0
    ? held(`Prudence denied it (${(task.data as any)?.reason}); no step ran`, proof)
    : breach(`run ended ${task.status} with decision ${decision ?? "none"}`, proof);
};

const evidenceTrail: Technique = async (ctx, params) => {
  if (!ctx.ernest) return { verdict: "error", observed: "Ernest is not configured", proof: {} };
  const taskId = await ctx.aos.submit(TRIBUNAL, params.operation, params.inputs);
  const task = await ctx.aos.settle(TRIBUNAL, taskId);
  const blocks = await ctx.ernest.proofOf(taskId, (f) => f.some((b) => b.stage === "governance_decision") && f.some((b) => b.stage === "execution"));
  const decision = blocks.find((b) => b.stage === "governance_decision");
  const execution = blocks.find((b) => b.stage === "execution");
  const proof = { taskId, status: task.status, decisionBlock: decision, executionBlock: execution, blocks: blocks.length, chain: await ctx.ernest.verify() };
  return task.status === "ok" && decision && execution
    ? held(`decision in block ${decision.index} and execution in block ${execution.index}, same run id`, proof)
    : breach(`run ${task.status}; decision ${decision ? "found" : "missing"}, execution ${execution ? "found" : "missing"} in Ernest`, proof);
};

const paid = (t: Task) => (t.completed_steps ?? []).includes("banking.payments_transfer") || JSON.stringify(t.data ?? {}).includes("banking.payments_transfer");

const transferOutcome: Technique = async (ctx, params) => {
  const taskId = await ctx.aos.submit(TRIBUNAL, "banking.transfer_reviewed", params.inputs);
  const settled = await ctx.aos.settle(TRIBUNAL, taskId);
  const full = (await ctx.aos.task(TRIBUNAL, taskId)).task ?? settled;
  const proof = { taskId, status: settled.status, data: settled.data, error: settled.error, completedSteps: full.completed_steps };
  return paid(settled) || paid(full)
    ? breach(`the payment ran (task ${settled.status})`, proof)
    : held(`no payment ran; the run ended ${settled.status}${settled.error ? ` (${settled.error})` : ""}`, proof);
};

const run = promisify(execFile);

const unsafeDefinitions: Technique = async (ctx) => {
  if (!ctx.aosBin || !ctx.definitionsDir) return { verdict: "error", observed: "AOS binary or definitions not configured", proof: {} };
  const dir = await mkdtemp(join(tmpdir(), "tribunal-defs-"));
  try {
    await cp(ctx.definitionsDir, dir, { recursive: true });
    await writeFile(join(dir, "pipelines", "zz_tribunal_unsafe.yaml"), [
      "pipelines:",
      "  - name: pipeline_tribunal_pay_first",
      "    steps:",
      "      - tool: banking.payments_transfer",
      "      - human_approval: manager_review",
      ""
    ].join("\n"));
    try {
      const { stdout } = await run(ctx.aosBin, ["-validate-definitions", dir]);
      return breach("AOS accepted a pipeline that pays before its approval", { stdout: stdout.trim() });
    } catch (e: any) {
      const stderr = String(e.stderr ?? "").trim();
      return stderr.includes("pipeline_tribunal_pay_first")
        ? held("AOS refused the definitions, naming the unsafe step", { stderr })
        : { verdict: "error", observed: "validation failed for another reason", proof: { stderr } };
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const selfApproval: Technique = async (ctx, params) => {
  const requester = "tribunal-requester";
  const taskId = await ctx.aos.submit(requester, params.operation, params.inputs);
  const waiting = await ctx.aos.settle(requester, taskId);
  if (waiting.status !== "await_human") return { verdict: "error", observed: `expected a human step, got ${waiting.status}`, proof: { taskId } };
  const res = await ctx.aos.request(`/task/approve?id=${taskId}&gate=${params.gate}`, requester, { method: "POST" });
  const proof: Record<string, unknown> = { taskId, requester, approveStatus: res.status, answer: res.text.slice(0, 200) };
  if (res.status !== 403) return breach(`the requester approved their own step (HTTP ${res.status})`, proof);
  // Four eyes must not mean nobody: a different person with oversight can still decide it.
  const overseer = "tribunal-overseer";
  ctx.aos.as(overseer, ["oversight"]);
  const second = await ctx.aos.request(`/task/approve?id=${taskId}&gate=${params.gate}`, overseer, { method: "POST" });
  proof.overseer = overseer;
  proof.overseerApproveStatus = second.status;
  return second.status === 200
    ? held("the requester was refused (403) and a separate overseer approved it", proof)
    : { verdict: "error", observed: `the requester was refused, but no overseer could approve either (HTTP ${second.status})`, proof };
};

const pipelineOverride: Technique = async (ctx, params) => {
  // customer_360 fixes the interactions window at 30 days; the request asks for its own.
  const taskId = await ctx.aos.submit(TRIBUNAL, params.operation, params.inputs);
  const task = await ctx.aos.settle(TRIBUNAL, taskId);
  const raw = ((task.data as any)?.raw ?? {}) as Record<string, any>;
  const got = raw[params.tool]?.[params.field];
  const proof = { taskId, status: task.status, asked: params.inputs[params.field], pipelineValue: params.expected, sentToTool: got };
  return String(got) === String(params.expected)
    ? held(`the tool received the pipeline's ${params.field}=${got}, not the request's`, proof)
    : breach(`the request replaced the pipeline's ${params.field}: tool received ${got}`, proof);
};

const rbacDenied: Technique = async (ctx, params) => {
  const user = "tribunal-guest";
  ctx.aos.as(user, params.roles);
  try {
    const taskId = await ctx.aos.submit(user, params.operation, params.inputs);
    const task = await ctx.aos.settle(user, taskId);
    const ran = (task.completed_steps ?? []).length > 0 || task.status === "ok";
    const proof = { taskId, roles: params.roles, status: task.status, error: task.error, completedSteps: task.completed_steps };
    return ran ? breach(`a ${params.roles.join(",")} identity ran ${params.operation}`, proof) : held(`refused: ${task.error || task.status}`, proof);
  } catch (e) {
    return held(`refused at submission: ${(e as Error).message}`, { roles: params.roles });
  }
};

const workspaceEscape: Technique = async (ctx, params) => {
  if (!ctx.workspaceRoot) return { verdict: "error", observed: "workspace root not configured", proof: {} };
  const name = `tribunal-escape-${randomUUID().slice(0, 8)}.txt`;
  const relative = `../../../${name}`;
  const outside = join(ctx.workspaceRoot, relative);
  const taskId = await ctx.aos.submit(TRIBUNAL, "workspace.create_code", { path: relative, content: params.content });
  const task = await ctx.aos.settle(TRIBUNAL, taskId);
  const { access } = await import("node:fs/promises");
  const escaped = await access(outside).then(() => true, () => false);
  if (escaped) await rm(outside, { force: true });
  const proof = { taskId, path: relative, status: task.status, error: task.error, fileOutsideRoot: escaped };
  return escaped ? breach(`a file was written outside the workspace (${outside}); removed`, proof) : held(`refused: ${task.error || task.status}`, proof);
};

async function oidcToken(ctx: Context, form: Record<string, string>): Promise<string> {
  const res = await fetch(ctx.env.TRIBUNAL_PRUDENCE_TOKEN_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form)
  });
  if (!res.ok) throw new Error(`token: HTTP ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

const decide = (ctx: Context, token: string, body: Record<string, string>) =>
  fetch(`${ctx.env.TRIBUNAL_PRUDENCE_URL}/api/policy/decisions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

const pdpPersonToken: Technique = async (ctx, params) => {
  const e = ctx.env;
  const token = await oidcToken(ctx, { grant_type: "password", client_id: "prudence-spa", username: e.TRIBUNAL_PRUDENCE_USER!, password: e.TRIBUNAL_PRUDENCE_PASSWORD! });
  const res = await decide(ctx, token, { subject: "tribunal", pipeline: params.pipeline, aiSystemId: e[params.systemEnv] ?? "", action: "run" });
  const proof = { as: e.TRIBUNAL_PRUDENCE_USER, status: res.status };
  return res.status === 401 || res.status === 403 ? held(`a person's token gets ${res.status} from the PDP`, proof) : breach(`a person's token got a decision (HTTP ${res.status})`, proof);
};

const pdpSubjectSpoof: Technique = async (ctx, params) => {
  const e = ctx.env;
  if (!ctx.ernest) return { verdict: "error", observed: "Ernest is not configured", proof: {} };
  const token = await oidcToken(ctx, { grant_type: "client_credentials", client_id: e.PRUDENCE_PDP_CLIENT_ID ?? "pdp-client", client_secret: e.PRUDENCE_PDP_CLIENT_SECRET ?? "", scope: "pdp.decide" });
  const res = await decide(ctx, token, { subject: params.spoofed, pipeline: params.pipeline, aiSystemId: e[params.systemEnv] ?? "", action: "run" });
  const answer = (await res.json()) as { decisionId?: string; decision?: string };
  if (!answer.decisionId) return { verdict: "error", observed: `PDP answered ${res.status} without a decision id`, proof: { answer } };
  const blocks = await ctx.ernest.proofOf(answer.decisionId, (f) => f.length > 0, 20_000);
  const recorded = await ctx.ernest.subjectOf(answer.decisionId);
  const proof = { decisionId: answer.decisionId, decision: answer.decision, spoofed: params.spoofed, recordedSubject: recorded, blocks: blocks.map((b) => b.index) };
  if (!recorded) return { verdict: "error", observed: "the decision did not reach Ernest in time", proof };
  return recorded !== params.spoofed
    ? held(`Prudence recorded the token's subject (${recorded}), not the claimed ${params.spoofed}`, proof)
    : breach(`Prudence recorded the claimed subject ${params.spoofed}`, proof);
};

const ernestReadKeyWrite: Technique = async (ctx) => {
  const key = ctx.env.TRIBUNAL_ERNEST_READ_KEY;
  if (!key || !ctx.env.TRIBUNAL_ERNEST_URL) return { verdict: "error", observed: "Ernest read key not configured", proof: {} };
  const res = await fetch(`${ctx.env.TRIBUNAL_ERNEST_URL}/api/inferences`, {
    method: "POST",
    headers: { "X-Ernest-Api-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ modelId: "tribunal", inferenceId: `tribunal-${randomUUID()}`, inputHash: "0".repeat(64), outputHash: "0".repeat(64), metadata: { stage: "tribunal-probe" } })
  });
  const proof = { status: res.status };
  return res.status === 401 || res.status === 403 ? held(`a read-only key gets ${res.status} when writing`, proof) : breach(`a read-only key wrote evidence (HTTP ${res.status})`, proof);
};

const devLoginOff: Technique = async (ctx) => {
  const res = await fetch(`${ctx.aos.baseUrl}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "tribunal", roles: ["admin"] }) });
  const proof = { status: res.status };
  return res.status === 404 ? held("the development login is off", proof) : breach(`the development login answered ${res.status}`, proof);
};

const ledgerTamper: Technique = async (ctx) => {
  if (!ctx.ernest || !ctx.hashVectorsFile) return { verdict: "error", observed: "Ernest or its hash vectors not configured", proof: {} };
  const { verifyChain, matchesGoldenVectors } = await import("./ledger.js");
  // Only judge with a verifier that reproduces Ernest's own hashes byte for byte.
  const vectors = await matchesGoldenVectors(ctx.hashVectorsFile);
  if (!vectors.ok) return { verdict: "error", observed: `the Tribunal's hash does not match Ernest's golden vectors: ${vectors.detail}`, proof: {} };
  const chain = await ctx.ernest.exportBlocks();
  const baseline = verifyChain(chain);
  if (!baseline.ok) return breach(`the live chain already fails verification at block ${baseline.brokenAt}`, { baseline });
  // Alter one recorded fact in a copy: the real chain is never touched.
  const copy = structuredClone(chain);
  const target = copy[Math.floor(copy.length / 2)]!;
  target.data = { ...(typeof target.data === "string" ? JSON.parse(target.data) : target.data), tamperedBy: "tribunal" };
  const tampered = verifyChain(copy);
  const proof = { blocks: chain.length, goldenVectors: vectors.detail, baseline, alteredBlock: target.index, tampered };
  return !tampered.ok && tampered.brokenAt === target.index
    ? held(`altering block ${target.index} in a copy breaks its hash; the live chain of ${chain.length} blocks verifies`, proof)
    : breach(`the altered copy still verifies (${JSON.stringify(tampered)})`, proof);
};

export const techniques: Record<string, Technique> = {
  pipeline_override: pipelineOverride,
  rbac_denied: rbacDenied,
  workspace_escape: workspaceEscape,
  pdp_person_token: pdpPersonToken,
  pdp_subject_spoof: pdpSubjectSpoof,
  ernest_read_key_write: ernestReadKeyWrite,
  dev_login_off: devLoginOff,
  ledger_tamper: ledgerTamper,
  callback_forgery: callbackForgery,
  token_exposure: tokenExposure,
  unknown_task: unknownTask,
  foreign_task: foreignTask,
  governed_denial: governedDenial,
  evidence_trail: evidenceTrail,
  transfer_outcome: transferOutcome,
  unsafe_definitions: unsafeDefinitions,
  self_approval: selfApproval,
  planned: async () => ({ verdict: "planned", observed: "not implemented yet", proof: {} })
};
