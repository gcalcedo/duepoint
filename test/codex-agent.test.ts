import assert from "node:assert/strict"
import test from "node:test"
import { buildActionPrompt, buildLookupPrompt, summarizeEvent } from "../src/codex-agent.js"
import type { Invoice } from "../src/domain.js"

const invoice: Invoice = {
  id: "INV-24058", customer: "meridian", customerName: "Meridian Manufacturing", portal: "SupplierNet", poNumber: "MM-77201",
  amount: 27_300, invoiceDate: "2026-07-08", dueDate: "2026-08-07", daysOverdue: 25, apContact: "ap@meridianmfg.example", status: "queued",
}

test("lookup prompt is read-only and lists every invoice", () => {
  const prompt = buildLookupPrompt("meridian", [invoice], "http://127.0.0.1:4310/portal/meridian")
  assert.match(prompt, /READ-ONLY/)
  assert.match(prompt, /INV-24058 — PO MM-77201/)
  assert.match(prompt, /portal\/meridian/)
  for (const finding of ["paid", "approved-scheduled", "pending-approval", "not-received", "rejected", "disputed", "unknown"]) assert.match(prompt, new RegExp(`- ${finding} —`))
})

test("action prompt only covers the listed invoices and carries the rejection detail", () => {
  const prompt = buildActionPrompt("meridian", [{ invoice, action: "correct-and-resubmit", detail: "Purchase order number missing" }], "http://x")
  assert.match(prompt, /Purchase order number missing/)
  assert.match(prompt, /Do not act on any invoice that is not listed/)
})

test("JSONL events are summarised with the invoice ids they mention", () => {
  const started = summarizeEvent({ type: "item.started", item: { type: "mcp_tool_call", tool: "browser_type", arguments: { text: "INV-24058", ref: "e12" } } })
  assert.equal(started?.tool, "browser_type")
  assert.deepEqual(started?.invoiceIds, ["INV-24058"])
  assert.match(started!.text, /^type /)
  assert.equal(summarizeEvent({ type: "turn.started" }), undefined)
  assert.equal(summarizeEvent({ type: "item.completed", item: { type: "mcp_tool_call", tool: "browser_click" } }), undefined)
  assert.match(summarizeEvent({ type: "item.completed", item: { type: "agent_message", text: "Found INV-24058 pending." } })!.text, /pending/)
})
