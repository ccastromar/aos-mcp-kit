import test from "node:test";
import assert from "node:assert/strict";
import { buildApprovalReview, reviewText } from "../dist/approval.js";

const listed = {
  id: "task-1",
  intent: "banking.transfer_reviewed",
  pipeline: "pipeline_transfer_reviewed",
  user_id: "local-agent",
  created_at: "2026-11-03T15:00:00Z",
  ai_system_id: "sys-1",
  gate: "manager_review",
  params: {
    amount: "1500",
    currency: "EUR",
    audit_hash: "abc",
    trace_id: "task-1",
    "banking.aml_risk_check.riskLevel": "LOW",
    manager_review_decision: "pending",
    manager_review_executed: "true"
  },
  step_results: {
    "banking.aml_risk_check": { ok: true, riskLevel: "LOW", riskScore: 12, sanctioned: false },
    "risk.grpc_score": { result: { band: "medium", score: 0.54 } },
    "compliance.a2a_review": { result: { status: { state: "completed" }, artifacts: [{ parts: [{ text: "Compliance review approved" }] }] } }
  }
};
// As /task answers after its first read: the gate is only in the listing.
const waiting = { id: "task-1", status: "await_human", completed_steps: ["banking.aml_risk_check", "risk_score", "compliance_review"] };

test("the review shows what was asked, without AOS's own run variables", () => {
  const r = buildApprovalReview(waiting, listed, "http://console.test/");
  assert.deepEqual(r.request, { amount: "1500", currency: "EUR" });
  assert.equal(r.gate, "manager_review");
  assert.equal(r.requestedBy, "local-agent");
  assert.equal(r.decideAt, "http://console.test/?taskId=task-1");
});

test("each passed check reads as one outcome line", () => {
  const r = buildApprovalReview(waiting, listed, undefined);
  assert.deepEqual(r.checks, [
    { step: "banking.aml_risk_check", outcome: "risk LOW (12) · not sanctioned" },
    { step: "risk.grpc_score", outcome: "risk band medium (0.54)" },
    { step: "compliance.a2a_review", outcome: "review completed · Compliance review approved" }
  ]);
  assert.equal(r.decideAt, undefined);
});

test("a task that is not waiting offers no way to decide it", () => {
  const r = buildApprovalReview({ id: "task-2", status: "ok" }, undefined, "http://console.test");
  assert.equal(r.pending, false);
  assert.equal(r.decideAt, undefined);
  assert.match(reviewText(r), /not waiting for a human decision/);
});

test("the text says the assistant cannot decide", () => {
  const text = reviewText(buildApprovalReview(waiting, listed, "http://console.test"));
  assert.match(text, /cannot approve or reject/);
  assert.match(text, /signed in as themselves/);
});
