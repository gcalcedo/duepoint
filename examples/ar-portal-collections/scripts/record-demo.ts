/**
 * Records the raw footage for the demo video against a LIVE Solari run:
 *
 *   1. dashboard.webm — 1920×1080 capture of the dashboard while 4 Codex agents work the
 *      portals on Solari cloud browsers, then a dispute approval and an escalation.
 *   2. portal-*.webm / ar.webm — B-roll of each portal UI being operated (scripted flows,
 *      deliberately paced) for cutaway shots.
 *   3. export.json + meta.json — the full run data and timestamped marks, used by the
 *      Remotion edit to compute cuts, speed ramps and labels.
 *
 * Precondition: `npm run demo:solari` is running locally with a fresh preview token.
 * Output: recordings/latest/ (a timestamped folder, symlink-free copy).
 */
process.env.DEMO_MODE = "visible" // paces the scripted B-roll flows

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, type Page } from "playwright"
import { adapters, bindBaseUrl, postToAr } from "../src/portal-adapters.js"
import type { Invoice } from "../src/domain.js"

const base = process.env.DASHBOARD_URL ?? "http://127.0.0.1:4310"
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const outDir = path.join(projectRoot, "recordings", "latest")
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

const SIZE = { width: 1920, height: 1080 }
const marks: Array<{ label: string; at: number }> = []
const mark = (label: string) => { marks.push({ label, at: Date.now() }); console.log(`  ◆ ${label} @ ${new Date().toISOString()}`) }

const api = async (pathname: string, method = "GET") => {
  const response = await fetch(`${base}${pathname}`, method === "GET" ? undefined : { method, headers: { "Content-Type": "application/json" }, body: "{}" })
  if (!response.ok) throw new Error(`${method} ${pathname} → ${response.status}: ${await response.text()}`)
  return response.json()
}
const state = () => api("/api/state")

// ---- Preconditions -------------------------------------------------------------------
const initial = await state()
if (initial.worker !== "Codex · Solari MCP" || initial.executionProvider !== "solari") {
  throw new Error(`Server is running "${initial.worker}" (provider ${initial.executionProvider}) — start it with \`npm run demo:solari\`.`)
}
console.log(`Recording against ${initial.worker}; output → ${outDir}`)

const browser = await chromium.launch({ headless: true })

// ---- 1. Dashboard: the real Solari run ------------------------------------------------
{
  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, recordVideo: { dir: outDir, size: SIZE } })
  const page = await context.newPage()
  const recordStartAt = Date.now()
  await page.goto(base)
  await page.waitForTimeout(2500)
  mark("establish")

  await page.click("#reset-button")
  await page.waitForTimeout(1200)
  mark("reset")

  await page.click("#run-button")
  mark("runStart")
  let current: any
  for (let i = 0; i < 900; i++) {
    current = await state()
    if (current.runStatus === "complete") break
    if (current.runStatus === "ready" && i > 5) throw new Error(`Run stopped early: ${current.events[0]?.message}`)
    await page.waitForTimeout(1000)
  }
  if (current.runStatus !== "complete") throw new Error("Run did not complete in time")
  mark("runComplete")
  await page.waitForTimeout(4000)

  await page.click('[data-view="review"]')
  await page.waitForTimeout(1500)
  mark("reviewFilter")

  await page.click('[data-invoice-id="INV-24077"]')
  await page.waitForTimeout(2000)
  mark("disputeSelected")
  await page.click('[data-approve="INV-24077"]')
  mark("approveClick")
  for (let i = 0; i < 240; i++) {
    current = await state()
    const invoice = current.invoices.find((candidate: any) => candidate.id === "INV-24077")
    if (invoice.status === "done") break
    if (invoice.status === "escalated") throw new Error("Approval failed")
    await page.waitForTimeout(1000)
  }
  mark("approveDone")
  await page.waitForTimeout(3000)

  await page.click('[data-invoice-id="INV-24093"]')
  await page.waitForTimeout(1200)
  await page.click('[data-reject="INV-24093"]')
  mark("escalate")
  await page.waitForTimeout(2000)

  await page.click('[data-view="done"]')
  await page.waitForTimeout(2500)
  mark("completedView")

  await page.click('[data-view="all"]')
  await page.waitForTimeout(4000)
  mark("end")

  const video = page.video()
  await context.close()
  const recordedPath = await video!.path()
  fs.renameSync(recordedPath, path.join(outDir, "dashboard.webm"))
  fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify({ recordStartAt, size: SIZE, marks }, null, 2))
  console.log("dashboard.webm done")
}

// ---- 2. Export the run data (after the approval/escalation) ---------------------------
fs.writeFileSync(path.join(outDir, "export.json"), JSON.stringify(await api("/api/export"), null, 2))

// ---- 3. B-roll: each portal operated by the scripted flows ----------------------------
const fullState = await state()
const invoiceOf = (id: string): Invoice => fullState.invoices.find((candidate: any) => candidate.id === id)
const broll: Array<{ file: string; run: (page: Page) => Promise<void> }> = [
  { file: "portal-suppliernet.webm", run: async (page) => { await adapters.meridian!.lookup(page, invoiceOf("INV-24071")); await adapters.meridian!.act(page, invoiceOf("INV-24071"), "correct-and-resubmit") } },
  { file: "portal-procurehub.webm", run: async (page) => { await adapters.atlas!.lookup(page, invoiceOf("INV-24077")); await adapters.atlas!.act(page, invoiceOf("INV-24077"), "respond-to-dispute") } },
  { file: "portal-tradelink.webm", run: async (page) => { await adapters.halvorsen!.lookup(page, invoiceOf("INV-24063")); await adapters.halvorsen!.act(page, invoiceOf("INV-24063"), "request-status") } },
  { file: "portal-vendorcenter.webm", run: async (page) => { await adapters.crestview!.lookup(page, invoiceOf("INV-24087")); await adapters.crestview!.act(page, invoiceOf("INV-24087"), "respond-to-dispute") } },
  { file: "ar-corvus.webm", run: async (page) => { await postToAr(page, invoiceOf("INV-24031"), "promise", "2026-09-12", "Approved in SupplierNet — scheduled payment 2026-09-12.", "2026-09-12") } },
]
for (const clip of broll) {
  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, recordVideo: { dir: outDir, size: SIZE } })
  const page = await context.newPage()
  bindBaseUrl(page, base)
  await page.waitForTimeout(300)
  try {
    await clip.run(page)
    await page.waitForTimeout(1200)
  } catch (error) {
    console.warn(`B-roll ${clip.file} incomplete: ${error instanceof Error ? error.message : error}`)
  }
  const video = page.video()
  await context.close()
  fs.renameSync(await video!.path(), path.join(outDir, clip.file))
  console.log(`${clip.file} done`)
}

await browser.close()
console.log(`\nAll footage in ${outDir}:`)
for (const file of fs.readdirSync(outDir)) console.log(`  ${file} (${(fs.statSync(path.join(outDir, file)).size / 1e6).toFixed(1)} MB)`)
