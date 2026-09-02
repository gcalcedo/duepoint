import path from "node:path"
import { fileURLToPath } from "node:url"
import express from "express"
import { Solari } from "@solarisdk/browser"
import { customers, customerSlugs, summarize, type CustomerSlug } from "./domain.js"
import { previewAuth } from "./public-url.js"
import { ensureHosted, refreshPreview, stopHosted } from "./sandbox-host.js"
import { CollectionsOrchestrator } from "./orchestrator.js"
import { loadInvoices, Store } from "./store.js"

const directory = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT ?? 4310)
const host = process.env.HOST ?? "127.0.0.1"
const publicDirectory = path.resolve(directory, "../public")
const app = express()
const agentMode = process.env.AGENT_MODE === "codex" ? "codex" : "scripted"
const browserMcp = (process.env.BROWSER_MCP ?? (process.env.EXECUTION_PROVIDER === "solari" ? "solari" : "playwright")) as "playwright" | "solari"

// Any Solari browser (agent MCP or AR posting) must reach the portals over the public internet,
// so host them in a Solari sandbox automatically: reuse a live one or provision fresh.
const needsPublicPortals = (agentMode === "codex" && browserMcp === "solari") || process.env.EXECUTION_PROVIDER === "solari"
let baseUrl = process.env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`
let hostedSandboxId: string | undefined
previewAuth.token = process.env.PUBLIC_ACCESS_TOKEN
if (needsPublicPortals && process.env.HOSTED_INSIDE_SANDBOX !== "1") {
  const hosted = await ensureHosted()
  baseUrl = hosted.origin
  previewAuth.token = hosted.token
  hostedSandboxId = hosted.sandboxId
  // Preview tokens last ~1h — keep a fresh one while the server runs.
  setInterval(() => {
    void refreshPreview(hosted.sandboxId)
      .then(({ token }) => { previewAuth.token = token })
      .catch((error) => console.error(`preview token refresh failed: ${error instanceof Error ? error.message : error}`))
  }, 40 * 60_000).unref()
}
const store = new Store(await loadInvoices())
const orchestrator = new CollectionsOrchestrator(store, baseUrl, {
  agentMode,
  browserMcp,
  visible: process.env.DEMO_MODE === "visible",
  model: process.env.CODEX_MODEL,
  reasoningEffort: process.env.CODEX_REASONING_EFFORT,
})

const portalPages: Record<string, string> = {
  meridian: "portal-meridian.html",
  atlas: "portal-atlas.html",
  halvorsen: "portal-halvorsen.html",
  crestview: "portal-crestview.html",
}

function isCustomer(value: string): value is CustomerSlug {
  return (customerSlugs as string[]).includes(value)
}

function reference(prefix: string, invoiceId: string, action: string): string {
  const seed = `${invoiceId}:${action}`
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `${prefix}${String(hash % 10_000_000).padStart(7, "0")}`
}

app.use(express.json())
app.use(express.static(publicDirectory, { extensions: ["html"] }))

app.get("/portal/:customer", (request, response) => {
  const page = portalPages[request.params.customer]
  if (!page) return response.status(404).send("This customer has no portal")
  response.sendFile(path.join(publicDirectory, page))
})
app.get("/ar", (_request, response) => response.sendFile(path.join(publicDirectory, "ar.html")))

// ---- Dashboard API ----

app.get("/api/state", (_request, response) => {
  const state = store.snapshot()
  response.json({
    ...state,
    summary: summarize(state),
    customers,
    executionProvider: process.env.EXECUTION_PROVIDER ?? "local",
    agentMode,
    browserMcp,
    worker: orchestrator.describeWorker(),
  })
})

/** Everything a video/edit pipeline needs: state, timings, summary, customers, replay session ids. */
app.get("/api/export", (_request, response) => {
  const state = store.snapshot()
  response.json({
    exportedAt: new Date().toISOString(),
    worker: orchestrator.describeWorker(),
    baseUrl,
    runDurationMs: state.startedAt && state.completedAt ? Date.parse(state.completedAt) - Date.parse(state.startedAt) : null,
    summary: summarize(state),
    customers,
    ...state,
  })
})

/** Redirects to a fresh presigned Solari replay URL for a recorded browser session. */
let solariClient: Solari | undefined
app.get("/api/replay/:sessionId", async (request, response) => {
  if (!process.env.SOLARI_API_KEY) return response.status(404).json({ error: "Replays need SOLARI_API_KEY" })
  try {
    solariClient ??= new Solari({ apiKey: process.env.SOLARI_API_KEY })
    const replay = await solariClient.sessions.getReplayUrl(request.params.sessionId)
    response.redirect(replay.url)
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

app.post("/api/reset", (_request, response) => {
  if (orchestrator.isActive()) return response.status(409).json({ error: "Worker is active" })
  response.json(store.reset())
})

app.post("/api/run", async (_request, response) => {
  if (orchestrator.isActive()) return response.status(409).json({ error: "Worker is already active" })
  // When the portals live on a Solari preview URL, verify it still answers before spending agent turns on it.
  if (previewAuth.token) {
    const reachable = await fetch(`${baseUrl}/api/state?pt_token=${previewAuth.token}`).then((probe) => probe.ok).catch(() => false)
    if (!reachable) return response.status(409).json({ error: "The portal preview URL is not answering — run `npm run host:refresh` and restart the server." })
  }
  response.status(202).json({ ok: true })
  void orchestrator.runQueue().catch((error) => console.error(error))
})

app.post("/api/invoices/:id/approve", (request, response) => {
  if (orchestrator.isActive()) return response.status(409).json({ error: "Worker is active" })
  const invoice = store.invoice(request.params.id)
  if (!invoice || invoice.status !== "needs-review") return response.status(400).json({ error: "Invoice is not awaiting approval" })
  response.status(202).json({ ok: true })
  void orchestrator.approveInvoice(request.params.id).catch((error) => console.error(error))
})

app.post("/api/invoices/:id/reject", (request, response) => {
  try {
    orchestrator.rejectInvoice(request.params.id)
    response.json({ ok: true })
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

// ---- Customer portal back-ends (each portal mock reads only its own customer's records) ----

app.get("/api/portal/:customer/invoices", (request, response) => {
  const { customer } = request.params
  if (!isCustomer(customer)) return response.status(404).json({ error: "Unknown customer" })
  response.json(store.portalRecords(customer))
})

app.get("/api/portal/:customer/po/:po", (request, response) => {
  const { customer, po } = request.params
  if (!isCustomer(customer)) return response.status(404).json({ error: "Unknown customer" })
  const invoice = store.invoicesFor(customer).find((candidate) => candidate.poNumber.toUpperCase() === po.toUpperCase())
  if (!invoice) return response.status(404).json({ error: "Purchase order not found" })
  response.json({ poNumber: invoice.poNumber, buyer: customers[customer].name, supplier: "Northbridge Industrial Supply", amount: invoice.amount, currency: "USD", description: "Industrial fasteners & fittings — blanket release" })
})

app.get("/api/portal/:customer/open-pos", (request, response) => {
  const { customer } = request.params
  if (!isCustomer(customer)) return response.status(404).json({ error: "Unknown customer" })
  const invoiced = new Set(store.portalRecords(customer).map((record) => record.poNumber))
  response.json(store.invoicesFor(customer).filter((invoice) => !invoiced.has(invoice.poNumber)).map((invoice) => ({ poNumber: invoice.poNumber, amount: invoice.amount })))
})

const referencePrefixes: Record<string, string> = { meridian: "DOC-", atlas: "CIN-", halvorsen: "TL-", crestview: "VC-" }
app.post("/api/portal/:customer/submit", (request, response) => {
  const { customer } = request.params
  if (!isCustomer(customer)) return response.status(404).json({ error: "Unknown customer" })
  const { invoiceId, action } = request.body ?? {}
  if (!invoiceId || !action) return response.status(400).json({ error: "invoiceId and action are required" })
  response.json({ reference: reference(referencePrefixes[customer] ?? "REF-", String(invoiceId), String(action)), receivedAt: new Date().toISOString() })
})

// ---- Corvus AR (the supplier's receivables system) ----

app.get("/api/ar/invoices/:id", (request, response) => {
  const invoice = store.invoice(request.params.id.toUpperCase())
  if (!invoice) return response.status(404).json({ error: "Invoice not found" })
  response.json({ id: invoice.id, customerName: invoice.customerName, poNumber: invoice.poNumber, amount: invoice.amount, invoiceDate: invoice.invoiceDate, dueDate: invoice.dueDate, daysOverdue: invoice.daysOverdue })
})

app.post("/api/ar/post", (request, response) => {
  if (!store.invoice(String(request.body?.invoiceId))) return response.status(404).json({ error: "Invoice not found" })
  response.json({ ok: true, postedAt: new Date().toISOString() })
})

app.listen(port, host, () => {
  console.log(`\nDuePoint dashboard: http://127.0.0.1:${port}`)
  if (hostedSandboxId) console.log(`Portals hosted on Solari: ${baseUrl} (sandbox is killed automatically on exit; KEEP_SANDBOX=1 to keep it)`)
  console.log(`Portal worker: ${orchestrator.describeWorker()}`)
  console.log("Open the dashboard and click “Check portals”.\n")
})

// Kill the sandbox when the server goes away — no forgotten billable machines.
let shuttingDown = false
const shutdown = (signal: string) => {
  if (shuttingDown) return
  shuttingDown = true
  const finish = () => process.exit(0)
  if (hostedSandboxId && process.env.KEEP_SANDBOX !== "1") {
    console.log(`\n${signal} — killing the Solari sandbox (set KEEP_SANDBOX=1 to keep it warm)…`)
    void stopHosted(hostedSandboxId).then(finish, (error) => { console.error(error); finish() })
  } else {
    finish()
  }
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => shutdown(signal))
