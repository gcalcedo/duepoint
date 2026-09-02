import fs from "node:fs"
import path from "node:path"
import { chromium } from "playwright"
import type { Invoice } from "../src/domain.js"
import { adapters, bindBaseUrl } from "../src/portal-adapters.js"

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:4310"
const output = path.resolve("demo-artifacts")
fs.mkdirSync(output, { recursive: true })

const state = await (await fetch(`${baseUrl}/api/state`)).json() as { invoices: Invoice[] }
const invoice = (id: string) => {
  const found = state.invoices.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`Invoice ${id} not in state`)
  return found
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 930 }, deviceScaleFactor: 1 })
bindBaseUrl(page, baseUrl)
try {
  await page.goto(baseUrl)
  await page.waitForTimeout(800)
  await page.screenshot({ path: path.join(output, "01-dashboard.png"), fullPage: true })

  const shots: Array<[string, string, string]> = [
    ["meridian", "INV-24071", "02-portal-suppliernet.png"],
    ["atlas", "INV-24077", "03-portal-procurehub.png"],
    ["halvorsen", "INV-24063", "04-portal-tradelink.png"],
    ["crestview", "INV-24087", "05-portal-vendor-center.png"],
  ]
  for (const [customer, id, file] of shots) {
    await adapters[customer as keyof typeof adapters]!.lookup(page, invoice(id))
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(output, file), fullPage: true })
  }

  await page.goto(`${baseUrl}/ar`)
  await page.getByLabel("Invoice number", { exact: true }).fill("INV-24031")
  await page.getByRole("button", { name: "Find", exact: true }).click()
  await page.getByTestId("ar-record").waitFor()
  await page.screenshot({ path: path.join(output, "06-corvus-ar.png"), fullPage: true })
} finally {
  await browser.close()
}

console.log(`Captured dashboard, four customer portals, and Corvus AR in ${output}`)
