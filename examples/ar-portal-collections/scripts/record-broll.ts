/**
 * Local-only B-roll re-record (no Solari usage): slower-paced portal takes.
 *  - lookup-<portal>.webm : just FINDING one invoice — the "same task, four UIs" beat
 *  - portal-<portal>.webm : lookup + the action, for the work montage
 *  - ar-corvus.webm       : posting to the legacy AR workstation
 *  - replay-beat.webm     : dashboard evidence panel showing the Solari replay links
 * Writes into recordings/latest WITHOUT touching dashboard.webm / export.json / meta.json.
 */
process.env.DEMO_MODE = "visible"
process.env.DEMO_PACE = "1.9"

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, type Page } from "playwright"
import { adapters, bindBaseUrl, postToAr } from "../src/portal-adapters.js"
import type { Invoice } from "../src/domain.js"

const base = process.env.DASHBOARD_URL ?? "http://127.0.0.1:4310"
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "recordings", "latest")
const SIZE = { width: 1920, height: 1080 }

const state = await (await fetch(`${base}/api/state`)).json() as { invoices: Invoice[] }
const invoice = (id: string): Invoice => {
  const found = state.invoices.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`missing ${id}`)
  return found
}

const browser = await chromium.launch({ headless: true })
async function take(file: string, run: (page: Page) => Promise<void>): Promise<void> {
  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, recordVideo: { dir: outDir, size: SIZE } })
  const page = await context.newPage()
  bindBaseUrl(page, base)
  await page.waitForTimeout(250)
  try {
    await run(page)
    await page.waitForTimeout(1000)
  } catch (error) {
    console.warn(`${file}: ${error instanceof Error ? error.message : error}`)
  }
  const video = page.video()
  await context.close()
  fs.renameSync(await video!.path(), path.join(outDir, file))
  console.log(`${file} done`)
}

await take("lookup-suppliernet.webm", (page) => adapters.meridian!.lookup(page, invoice("INV-24071")).then(() => {}))
await take("lookup-procurehub.webm", (page) => adapters.atlas!.lookup(page, invoice("INV-24077")).then(() => {}))
await take("lookup-tradelink.webm", (page) => adapters.halvorsen!.lookup(page, invoice("INV-24063")).then(() => {}))
await take("lookup-vendorcenter.webm", (page) => adapters.crestview!.lookup(page, invoice("INV-24087")).then(() => {}))

await take("portal-suppliernet.webm", async (page) => { await adapters.meridian!.lookup(page, invoice("INV-24071")); await adapters.meridian!.act(page, invoice("INV-24071"), "correct-and-resubmit") })
await take("portal-procurehub.webm", async (page) => { await adapters.atlas!.lookup(page, invoice("INV-24077")); await adapters.atlas!.act(page, invoice("INV-24077"), "respond-to-dispute") })
await take("portal-tradelink.webm", async (page) => { await adapters.halvorsen!.lookup(page, invoice("INV-24063")); await adapters.halvorsen!.act(page, invoice("INV-24063"), "request-status") })
await take("portal-vendorcenter.webm", async (page) => { await adapters.crestview!.lookup(page, invoice("INV-24087")); await adapters.crestview!.act(page, invoice("INV-24087"), "respond-to-dispute") })

await take("ar-corvus.webm", (page) => postToAr(page, invoice("INV-24031"), "promise", "2026-09-12", "Approved in SupplierNet — scheduled payment 2026-09-12.", "2026-09-12"))

await take("replay-beat.webm", async (page) => {
  await page.goto(base)
  await page.waitForTimeout(1200)
  await page.click('[data-view="done"]')
  await page.waitForTimeout(900)
  await page.click('[data-invoice-id="INV-24044"]')
  await page.waitForTimeout(2600)
  await page.click('[data-invoice-id="INV-24040"]')
  await page.waitForTimeout(2600)
})

await browser.close()
console.log("B-roll refreshed")
