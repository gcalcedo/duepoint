import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import test from "node:test"

const port = 4321
const baseUrl = `http://127.0.0.1:${port}`

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastValue: T | undefined
  while (Date.now() < deadline) {
    try {
      lastValue = await read()
      if (accept(lastValue)) return lastValue
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Timed out waiting for state; last value: ${JSON.stringify(lastValue).slice(0, 2000)}`)
}

async function state() {
  const response = await fetch(`${baseUrl}/api/state`)
  if (!response.ok) throw new Error(`State request failed: ${response.status}`)
  return response.json() as Promise<any>
}

const post = (path: string) => fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })

test("parallel portal run, approval gate, and AR posting", { timeout: 150_000 }, async () => {
  const server = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), EXECUTION_PROVIDER: "local", DEMO_MODE: "headless" },
    stdio: "ignore",
  })

  try {
    await waitFor(state, (value) => value.runStatus === "ready")
    assert.equal((await post("/api/run")).status, 202)

    const completed = await waitFor(state, (value) => value.runStatus === "complete")
    assert.equal(completed.summary.totalInvoices, 24)
    assert.equal(completed.summary.processed, 18)
    assert.equal(completed.summary.pendingApproval, 6)
    assert.equal(completed.summary.confirmed, 93_495)
    assert.equal(completed.summary.unblocked, 204_080)

    const byId = (id: string) => completed.invoices.find((invoice: any) => invoice.id === id)
    assert.equal(byId("INV-24066").finding, "not-received")
    assert.equal(byId("INV-24066").resolution, "Resubmitted")
    assert.equal(byId("INV-24040").resolution, "Corrected & resubmitted")
    assert.equal(byId("INV-24044").resolution, "Matched & closed")
    assert.equal(byId("INV-24031").confirmation, "2026-09-12")
    assert.equal(byId("INV-24049").status, "needs-review") // $58k — above the approval threshold
    assert.equal(byId("INV-24038").finding, "no-portal")
    assert.ok(completed.invoices.filter((invoice: any) => invoice.status === "done").every((invoice: any) => invoice.confirmation))

    assert.equal((await post("/api/invoices/INV-24049/approve")).status, 202)
    await waitFor(state, (value) => value.invoices.find((invoice: any) => invoice.id === "INV-24049").status === "done")

    assert.equal((await post("/api/invoices/INV-24093/reject")).status, 200)

    const final = await state()
    assert.equal(final.summary.processed, 20)
    assert.equal(final.summary.pendingApproval, 4)
    assert.equal(final.summary.unblocked, 262_280)
    assert.equal(final.invoices.find((invoice: any) => invoice.id === "INV-24093").status, "escalated")
  } finally {
    server.kill("SIGTERM")
  }
})
