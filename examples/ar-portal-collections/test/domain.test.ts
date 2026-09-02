import assert from "node:assert/strict"
import test from "node:test"
import { invoiceSeeds, portalRecords } from "../src/data.js"
import { APPROVAL_THRESHOLD, arStatus, cashBucket, decide, summarize, type AppState, type Invoice } from "../src/domain.js"

const base = { amount: 10_000, poNumber: "PO-1", customerName: "Acme", apContact: "ap@acme.example" }

test("portal findings map to the right collections action", () => {
  assert.equal(decide("paid", "ACH-1", base).recommendedAction, "match-remittance")
  assert.equal(decide("approved-scheduled", "2026-09-12", base).recommendedAction, "record-promise")
  assert.equal(decide("pending-approval", "12 days", base).recommendedAction, "request-status")
  assert.equal(decide("not-received", "", base).recommendedAction, "resubmit-invoice")
  assert.equal(decide("rejected", "PO missing", base).recommendedAction, "correct-and-resubmit")
  assert.equal(decide("disputed", "price variance", base).recommendedAction, "respond-to-dispute")
  assert.equal(decide("no-portal", "", base).recommendedAction, "send-statement")
})

test("anything that could concede money, or is above the threshold, needs a human", () => {
  assert.equal(decide("disputed", "", base).requiresApproval, true)
  assert.equal(decide("no-portal", "", base).requiresApproval, true)
  assert.equal(decide("pending-approval", "", base).requiresApproval, false)
  assert.equal(decide("pending-approval", "", { ...base, amount: APPROVAL_THRESHOLD }).requiresApproval, true)
  assert.equal(decide("paid", "", { ...base, amount: APPROVAL_THRESHOLD + 1 }).requiresApproval, true)
})

test("cash buckets and AR statuses are consistent", () => {
  assert.equal(cashBucket("paid"), "confirmed")
  assert.equal(cashBucket("approved-scheduled"), "confirmed")
  assert.equal(cashBucket("rejected"), "unblocked")
  assert.equal(cashBucket("disputed"), "at-risk")
  assert.equal(arStatus("match-remittance"), "paid")
  assert.equal(arStatus("correct-and-resubmit"), "resubmitted")
})

test("seed data is internally consistent", () => {
  const ids = new Set(invoiceSeeds.map((seed) => seed.id))
  assert.equal(ids.size, invoiceSeeds.length)
  for (const record of portalRecords) assert.ok(ids.has(record.invoiceId), `${record.invoiceId} has no invoice`)
  const total = invoiceSeeds.reduce((sum, seed) => sum + seed.amount, 0)
  assert.equal(total, 433_025)
})

test("summary separates confirmed, unblocked and at-risk cash", () => {
  const invoice = (id: string, amount: number, status: Invoice["status"], finding?: Invoice["finding"]): Invoice => ({
    id, amount, status, finding, cashBucket: finding ? cashBucket(finding) : undefined,
    customer: "meridian", customerName: "Meridian", portal: "SupplierNet", poNumber: "PO", invoiceDate: "2026-07-01", dueDate: "2026-07-31", daysOverdue: 32, apContact: "ap@x",
  })
  const state: AppState = {
    runStatus: "complete",
    events: [],
    invoices: [
      invoice("A", 1_000, "done", "paid"),
      invoice("B", 2_000, "done", "not-received"),
      invoice("C", 4_000, "needs-review", "disputed"),
      invoice("D", 8_000, "escalated", "no-portal"),
      invoice("E", 16_000, "queued"),
    ],
  }
  const summary = summarize(state)
  assert.equal(summary.confirmed, 1_000)
  assert.equal(summary.unblocked, 2_000)
  assert.equal(summary.atRisk, 12_000)
  assert.equal(summary.processed, 3)
  assert.equal(summary.pendingApproval, 1)
  assert.equal(summary.overdue, 31_000)
})

test("unknown findings are never acted on automatically", () => {
  const decision = decide("unknown", "portal timed out", base)
  assert.equal(decision.requiresApproval, true)
  assert.equal(cashBucket("unknown"), "at-risk")
})
