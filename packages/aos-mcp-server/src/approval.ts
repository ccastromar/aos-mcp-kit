// What a person needs to decide a human step, gathered from AOS for the approval card. The
// card only shows it: the decision is made in the AOS console, under the overseer's own sign-in,
// never through this server (whose identity is the requester's, and the model's).

export interface ApprovalReview {
  taskId: string;
  pending: boolean;
  status: string;
  gate?: string;
  intent?: string;
  pipeline?: string;
  requestedBy?: string;
  createdAt?: string;
  request: Record<string, string>;
  checks: Array<{ step: string; outcome: string }>;
  governance?: { aiSystemId?: string; decisionId?: string };
  decideAt?: string;
}

// Run variables AOS adds next to the request's own parameters: not part of what was asked.
const INTERNAL = new Set(["audit_hash", "trace_id", "callback_token", "callback_url"]);

/** One line per completed check, from the fields that say how it went. */
function outcome(result: Record<string, any>): string {
  const r = result.result && typeof result.result === "object" ? { ...result, ...result.result } : result;
  const parts: string[] = [];
  if (r.riskLevel) parts.push(`risk ${r.riskLevel}${r.riskScore !== undefined ? ` (${r.riskScore})` : ""}`);
  if (r.band) parts.push(`risk band ${r.band}${r.score !== undefined ? ` (${r.score})` : ""}`);
  if (r.sanctioned !== undefined) parts.push(r.sanctioned ? "sanctioned" : "not sanctioned");
  if (r.status && typeof r.status === "object" && r.status.state) parts.push(`review ${r.status.state}`);
  else if (typeof r.status === "string") parts.push(r.status);
  const texts = (r.artifacts ?? []).flatMap((a: any) => (a.parts ?? []).map((p: any) => p.text)).filter(Boolean);
  if (texts.length) parts.push(texts.join(" "));
  if (r.version) parts.push(`version ${r.version}`);
  return parts.join(" · ") || (r.ok ? "ok" : "done");
}

export function buildApprovalReview(
  task: { id: string; status: string; data?: any; gate?: string; params?: Record<string, string>; completed_steps?: string[] | null },
  listed: Record<string, any> | undefined,
  consoleUrl: string | undefined
): ApprovalReview {
  const pending = task.status === "await_human";
  // /task answers a waiting task with its gate and params; older AOS builds only list them.
  const params = (task.params ?? listed?.params ?? {}) as Record<string, string>;
  const request = Object.fromEntries(
    Object.entries(params).filter(([k]) => !k.includes(".") && !INTERNAL.has(k) && !k.endsWith("_decision") && !k.endsWith("_executed"))
  );
  // Step results are kept by tool name (completed_steps holds step ids); `_`-keys are AOS's own.
  const results = (listed?.step_results ?? {}) as Record<string, any>;
  const checks = Object.entries(results)
    .filter(([step, result]) => !step.startsWith("_") && result && typeof result === "object")
    .map(([step, result]) => ({ step, outcome: outcome(result) }));
  const base = consoleUrl?.replace(/\/+$/, "");
  return {
    taskId: task.id,
    pending,
    status: task.status,
    gate: task.gate ?? task.data?.gate ?? listed?.gate,
    intent: listed?.intent,
    pipeline: listed?.pipeline,
    requestedBy: listed?.user_id,
    createdAt: listed?.created_at,
    request,
    checks,
    governance: listed?.ai_system_id || listed?.decision_id ? { aiSystemId: listed.ai_system_id, decisionId: listed.decision_id } : undefined,
    decideAt: pending && base ? `${base}/?taskId=${encodeURIComponent(task.id)}` : undefined
  };
}

/** The same review as text, for hosts that do not render the card (and for the model). */
export function reviewText(r: ApprovalReview): string {
  if (!r.pending) return `Task ${r.taskId} is not waiting for a human decision (status: ${r.status}).`;
  const lines = [
    `Task ${r.taskId} is waiting at the human step "${r.gate}" (${r.intent ?? r.pipeline}).`,
    `Requested by ${r.requestedBy ?? "unknown"}${r.createdAt ? ` at ${r.createdAt}` : ""}.`,
    `Request: ${Object.entries(r.request).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}`,
    ...r.checks.map((c) => `Check ${c.step}: ${c.outcome}`),
    r.decideAt
      ? `An overseer decides it in the AOS console, signed in as themselves: ${r.decideAt}`
      : "An overseer decides it in the AOS console, signed in as themselves (AOS_CONSOLE_URL is not set, so no link).",
    "This assistant cannot approve or reject it."
  ];
  return lines.join("\n");
}
